/**
* @file A JSON-RPC 2.0 WebSocket and HTTP server. The full specification (<a href="http://www.jsonrpc.org/specification">http://www.jsonrpc.org/specification</a>), including batched requests is supported.
* @version 0.4.1
* @author Patrick Bay
* @copyright MIT License
*
*/

//JSDoc typedefs:
/**
* HTTP response headers used with HTTP / HTTPS endpoints.
* @typedef {Array} HTTP_Headers_Array
* @default [{"Access-Control-Allow-Origin" : "*"},
*  {"Content-Type" : "application/json-rpc"}]
*/
/**
* Server objects exposed to API modules.
* @typedef {Object} Exposed_API_Objects
* @default {
*  namespace:namespace,<br/>
*  config:{@link config},<br/>
*  require:require,<br/>
*  Buffer:Buffer,<br/>
*  request:request,<br/>
*  console:console,<br/>
*  module:module,<br/>
*  setInterval:setInterval,<br/>
*  clearInterval:clearInterval,<br/>
*  setTimeout:setTimeout,<br/>
*  clearTimeout:clearTimeout,<br/>
*  crypto:crypto,<br/>
*  sendResult:{@link sendResult},<br/>
*  sendError:{@link sendError},<br/>
*  buildJSONRPC:{@link buildJSONRPC},<br/>
*  paramExists:{@link paramExists},<br/>
*  JSONRPC_ERRORS:{@link JSONRPC_ERRORS}
* }
*/

/**
* Server objects exposed to gateway modules. Note that
* because gateways are not executed in their own virtual machines
* they have access to most top-level objects.
* @typedef {Object} Exposed_Gateway_Objects
* @default {
*  config:{@link config},<br/>
*  validateJSONRPC:{@link validateJSONRPC},<br/>
*  paramExists:{@link paramExists},<br/>
*  processRPCRequest:{@link processRPCRequest},<br/>
*  invokeAPIFunction:{@link invokeAPIFunction},<br/>
*  sendError:{@link sendError},<br/>
*  sendResult:{@link sendResult},<br/>
*  buildJSONRPC:{@link buildJSONRPC},<br/>
*  handleHTTPRequest:{@link handleHTTPRequest}
* }
*/
/**
* @typedef {ws} wsserv A WebSocket endpoint ("ws" module).
*/
/**
* @typedef {http} httpserv A HTTP endpoint ("http" module).
*/
//Required installed modules:
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");
const https = require("https");
var Gateways = null; //loaded dynamically post-config
const websocket = require("ws");
const request = require("request");
const crypto = require("crypto");


/**
* @property {Object} namespace A global object containing references and data shared by API scripts.
*/
const namespace = new Object();
/**
* @property {String} configFile="./config.json" Location of JSON data file to load and parse into the
* {@link config} object. May be either a filesystem path or a URL.
*/
const configFile = "./config.json";
/**
* @property {Object} config Dynamic configuration options loaded at runtime.
*/
var config = new Object();
/**
* @property {httpserv} http_server The default HTTP endpoint.
*/
var http_server;
/**
* @property {wsserv} ws_server The default WebSocket endpoint.
*/
var ws_server;
/**
* @property {Gateways} gateways A reference to the gateways manager instance.
*/
var gateways;
/**
* @const {Number} [ws_ping_interval=15000] The number of milliseconds to ping connected
* WebSockets at in order to keep them alive.
*/
const ws_ping_interval = 15000;
/**
* @property {Number} ws_ping_intervalID The interval ID of the WebSocket server
* ping / keep-alive timer.
*/
var ws_ping_intervalID = null;

/**
* Defines all standard and application-specific JSON-RPC 2.0 error codes. Standard error codes are in the range -32700 to -32603 while application-specific
* error codes are in the range -32001 to -32099. Error codes in the range -32768 to -32000 are reserved for future use.
* @see http://www.jsonrpc.org/specification#error_object
*
* @property {Number} PARSE_ERROR=-32700 Invalid JSON was received (the request cannot be parsed).
* @property {Number} REQUEST_ERROR=-32600 The request is not a valid JSON-RPC 2.0 request.
* @property {Number} METHOD_NOT_FOUND_ERROR=-32601 The requested RPC method does not exist.
* @property {Number} INVALID_PARAMS_ERROR=-32602 The parameters supplied for the requested RPC method are invalid.
* @property {Number} INTERNAL_ERROR=-32603 There was an internal server error when attempting to process the RPC request.
* @property {Number} SESSION_CLOSE=-32001 The session is about to terminate and any current tokens / credentials will no longer be
* accepted.
* @property {Number} WRONG_TRANSPORT=-32002 The wrong transport was used to deliver API request (e.g. used "http" or "https" instead of "ws" or "wss").
* @property {Number} ACTION_DISALLOWED=-32003 The action being requested is not currently allowed.
* @property {Number} PLAYER_ACTION_ERROR=-32005 A player has committed a penalizable wrong or incorrect action.
*/
const JSONRPC_ERRORS = {
	PARSE_ERROR: -32700,
	REQUEST_ERROR: -32600,
	METHOD_NOT_FOUND_ERROR: -32601,
	INVALID_PARAMS_ERROR: -32602,
	INTERNAL_ERROR: -32603,
   SESSION_CLOSE: -32001,
   WRONG_TRANSPORT: -32002,
   ACTION_DISALLOWED: -32003,
   AUTH_FAILED: -32004,
   PLAYER_ACTION_ERROR: -32005
}

/**
* The default options for the RPC server.
*
* @property {String} api_dir="./api" A directory containing all available API methods that may be invoked. Each API method must match
* a filename and the entry function in that file must also have the same name.
* @property {Number} http_port=8080 The default listening port for the HTTP server. This value may be overriden by a {@link config} setting.
* @property {Number} ws_port=8090 The listening port for the WebSocket server. This value may be overriden by a {@link config} setting.
* @property {Number} max_batch_requests=5 The maximum allowable number of batched RPC calls in a single request. If more than this number
* of calls are encountered in a request batch a JSONRPC_INTERNAL_ERROR error is thrown.
* @property {HTTP_Headers_Array} http_headers Default headers to include in HTTP / HTTPS responses. Each array element is an object
* containing a name / value pair.
* @property {Exposed_API_Objects} exposed_api_objects Internal server references to expose to external API functions. Note that each internal
* reference may be assigned an alias instead of its actual name.
* @property {Number} api_timelimit=3000 The time limit, in milliseconds, to allow external API functions to execute.
* @property {Boolean} http_only_handshake=false Defines whether session handshakes are done only through HTTP/HTTPS (true),
* or if they can be done through the WebSocket server (false).
* @property {Number} max_ws_per_ip=10 The maximum number of concurrent WebSocket connections to allow from a single IP.
* @property {Exposed_Gateway_Objects} exposed_gateway_objects Internal server references to expose to communication gateways functions. Note that each internal
* reference may be assigned an alias instead of its actual name.
*/
var rpc_options = {
  api_dir: "./api",
  http_port: 8080,
  ws_port: 8090,
  max_batch_requests: 5,
  http_headers: [
		{"Access-Control-Allow-Origin" : "*"}, //CORS header for global access
		{"Content-Type" : "application/json-rpc"}
  ],
  exposed_api_objects: {
    namespace:namespace,
    config:config,
    require:require,
    Buffer:Buffer,
    request:request,
    console:console,
    module:module,
    setInterval:setInterval,
    clearInterval:clearInterval,
    setTimeout:setTimeout,
    clearTimeout:clearTimeout,
    crypto:crypto,
    sendResult:sendResult,
    sendError:sendError,
    buildJSONRPC:buildJSONRPC,
    paramExists:paramExists,
    JSONRPC_ERRORS:JSONRPC_ERRORS
  },
  api_timelimit: 3000,
  http_only_handshake: false,
  max_ws_per_ip:10,
  exposed_gateway_objects: {
     config:config,
     getConfigByPath:getConfigByPath,
     validateJSONRPC:validateJSONRPC,
     paramExists:paramExists,
     processRPCRequest:processRPCRequest,
     invokeAPIFunction:invokeAPIFunction,
     sendError:sendError,
     sendResult:sendResult,
     buildJSONRPC:buildJSONRPC,
     handleHTTPRequest:handleHTTPRequest
 }
}
rpc_options.exposed_api_objects.rpc_options = rpc_options; // expose the options too (circular reference!)

/**
* @const {Object} _APIFunctions Enumerated functions found in the API directory as specified in {@linkcode rpc_options}.
*/
var _APIFunctions = new Object();

/**
* Handles all uncaught exceptions, allowing the server to keep running and responding to requests.
* Additional error handling / tracking / reporting can be added here.
*
* @listens global -> uncaughtException
*/
process.on('uncaughtException', (err) => {
  console.error(err.stack);
});

/**
* Asynchronously loads and parses an external JSON configuration file, making it available
* as the global {@link config} object.
*
* @param {String} [filePath={@link configFile}] The URL or filesystem path of the
* external configuration file to load. If the <code>RPCOptions.host</code> property
* is included (the request is being made to a shared hosting environment), this URL
* should contain the server IP rather than the domain name.
* @param {Object} [RPCOptions=null] If the <code>filePath</code> points to a
* JSON-RPC 2.0 endpoint, this object contains additional properties to use
* for the call.
* @param {String} RPCOptions.method The RPC method to invoke in order
* to retrieve the configuation data.
* @param {String} [RPCOptions.params] The RPC parameters to include
* when invoking the <code>RPCOptions.method</code>. If not defined, an empty
* <code>params</code> object is included with the request.
* @param {String} [RPCOptions.host] If defined, this property sets the "Host" HTTP
* header in the request when accessing a shared hosting environment. The
* <code>filePath</code> parameter should contain the server's IP address rather
* than a domain name.
*
* @return {Promise} The promise resolves with the loaded and parsed configuration
* object and rejects with the error when the file could not be loaded or parsed.
*/
function loadConfig(filePath=configFile, RPCOptions=null) {
   var promise = new Promise(function(resolve, reject) {
      filePath = filePath.trim();
      var isURL = false;
      if (filePath.toLowerCase().startsWith("http://") || filePath.toLowerCase().startsWith("https://")) {
         isURL = true;
      }
      if (isURL) {
         if (RPCOptions != null) {
            if ((RPCOptions.method == undefined) || (RPCOptions.method == null) || (RPCOptions.method == "")) {
               reject("No JSON-RPC 2.0 \"method\" defined for request.");
               return;
            }
            if (typeof(RPCOptions.params) != "object") {
               RPCOptions.params = new Object();
            }
            var headers = {"Content-Type": "application/json-rpc"};
            if (typeof(RPCOptions.host) == "string") {
               console.log ("Loading external configuration from RPC: "+filePath+" (shared host: "+RPCOptions.host+")");
               headers.Host = RPCOptions.host;
            } else {
               console.log ("Loading external configuration from RPC: "+filePath);
            }
            var requestObj = {
               "jsonrpc":"2.0",
               "id":"0",
               "method":RPCOptions.method,
               "params":RPCOptions.params
            }
            request({
               url: filePath,
               method: "POST",
               body: requestObj,
               headers: headers,
               json:true
            }, (error, response, body) => {
               if (error) {
                  reject(error);
               } else {
                  if ((body.error == undefined)) {
                     config = body.result;
                     resolve(config);
                  } else {
                     reject(body.error);
                  }
               }
            });
         } else {
            console.log ("Loading external configuration from URL: "+filePath);
            request({
               url: filePath,
               method: "GET",
               json: true
            }, (error, response, body) => {
               if (error) {
                  reject(error);
               } else {
                  config = body;
                  resolve(body);
               }
            });
         }
      } else {
         console.log ("Loading external configuration from filesystem: "+filePath);
         try {
            var JSONData = fs.readFileSync(filePath);
            config = JSON.parse(JSONData);
            resolve (config);
         } catch (err) {
            reject (err);
         }
      }
   });
   return (promise);
}

/**
* Loads and verifies all API functions in the directory specified in {@linkcode rpc_options} and optionally invokes one or more functions when completed.
*
* @param {...Function} [postLoadFunctions] Any function(s) to invoke once the API functions have been loaded and verified.
*/
function loadAPIFunctions(...postLoadFunctions) {
  if (fs.existsSync(rpc_options.api_dir) == false) {
    throw (new Error(`API directory "${rpc_options.api_dir}" is not accessible.`));
  }
  if (fs.lstatSync(rpc_options.api_dir).isDirectory() == false) {
    throw (new Error(`"${rpc_options.api_dir}" is not a directory.`));
  }
  //rpc_options.api_dir exists and is a directory
  var fileList = fs.readdirSync(rpc_options.api_dir);
  fileList.forEach(registerAPIFunction);
  for (var count=0; count<postLoadFunctions.length; count++) {
    postLoadFunctions[count]();
  }
}

/**
* Registers an API function handler stored in a specified file in the internal {@linkcode _APIFunctions} array.
*
* @param {String} filename The full path of the file to register as an API handler.
*/
function registerAPIFunction(fileName) {
  var folderPrefix = rpc_options.api_dir;
  if (folderPrefix.endsWith("/") == false) {
    folderPrefix += "/";
  }
  var fullPath = folderPrefix + fileName;
  if ((fs.lstatSync(fullPath).isDirectory() == false) &&
    (fullPath.endsWith(".js") || fullPath.endsWith(".javascript"))) {
    //only process files ending in ".js" or ".javascript"
    var script = fs.readFileSync(fullPath, {encoding:"UTF-8"});
    var vmContext = new Object();
    vmContext = Object.assign(rpc_options.exposed_api_objects, vmContext);
    var context = vm.createContext(vmContext);
    try {
      vm.runInContext(script, context, {timeout:rpc_options.api_timelimit});
   } catch (err) {
      console.error ("Error registering API function: \n"+err.stack);
      return;
   }
    var functionName = path.basename(fullPath).split(".")[0];
    if (typeof(context[functionName]) == "function") {
      var functionObj = new Object();
      functionObj.script = script;
      _APIFunctions[functionName] = functionObj;
      console.log(`Registered external API function "${functionName}" (${fullPath}).`);
    } else {
      console.log(`External reference "${functionName}" (${fullPath}) is not a function. Not registered.`);
    }
  }
}

/**
* Returns a configuration setting from the configuration data such as the
* global application {@link config} via a do-notation path string (as in
* standard JavaScript dot notation).
*
* @param {String} configPath The path of the object within the configuration object
* to retrieve.
* @param {Object} [configObj=config] The current configuration object being evaluated.
* This reference is passed for recursion but may be used to limit the search to specific
* child objects only.
*
* @return {*} The first matching configuration object or property, or <code>null</code> if
* it can't be found.
*/
function getConfigByPath(configPath, configObj=config) {
   var pathSplit = configPath.split(".")
   var currentItem = pathSplit.shift();
   var found = null;
   for (var configItem in configObj) {
      if (configItem == currentItem) {
         if (pathSplit.length > 0) {
            found = getConfigByPath(pathSplit.join("."), configObj[configItem])
         } else {
            return (configObj[configItem]);
         }
      }
   }
   return (found);
}

/**
* Verifies whether a data object is a valid JSON-RPC 2.0 request.
*
* @param {Object} dataObj The parsed object to check for validity.
*
* @return {String} A description of the validation failure, or null if the validation passed.
* @see http://www.jsonrpc.org/specification
*/
function validateJSONRPC (dataObj) {
  if ((dataObj["jsonrpc"] == null) || (dataObj["jsonrpc"] == undefined)) {
    return (`Missing "jsonrpc" property.`);
  }
  if (dataObj.jsonrpc != "2.0") {
		return (`Expecting JSON-RPC version "2.0" (exactly). Got "${dataObj.jsonrpc}""`);
	}
	if ((dataObj["method"] == undefined) || (dataObj["method"] == null)) {
		return (`Missing "method" property.`);
	}
  try {
  	if (dataObj.method.split(" ").join("") == "") {
  		return (`Property "method" is empty.`);
  	}
  } catch (err) {
    return (`Property "method" must be a string.`);
  }
  return (null);
}

/**
* Main RPC request handler for all endpoints. Successfully parsed requests are passed to {@link invokeAPIFunction} otherwise an
* error is immediately returned.
*
* @param {String} requestData The raw, unparsed request body.
* @param {Object} sessionObj An object containing data for the current sesssion.
* The contents of this object will differ depending on the type of endpoint that received the original request.
* @param {String} sessionObj.endpoint The source / target endpoint type associated with this session object. Valid values include:<br/>
* "ws" - WebSocket<br/>
* "wss" - secure WebSocket<br/>
* "wstunnel" - WebSocket tunnel<br/>
* "http" - HTTP<br/>
* "https" - secure HTTP
* @param {Object} sessionObj.requestObj The full, parsed JSON-RPC 2.0 object as received in the original request.
* @param {String} sessionObj.serverRequest The functional request object, either an <a href="https://nodejs.org/api/http.html#http_class_http_incomingmessage">IncomingMessage</a> instance when
* the endpoint is "http" or "https", or the source WebSocket connection when the endpoint is "ws" or "wss".
* Tunneled endpoints are usually handled by custom [Gateway]{@link libs/Gateway.js}-based classes such as [WSSTunnel]{@link libs/gateways/WSSTunnel.js}.
* @param {String} sessionObj.serverResponse The functional response object either a <a href="https://nodejs.org/api/http.html#http_class_http_serverresponse">ServerResponse</a> instance when
* the endpoint is "http" or "https", or the target WebSocket connection when the endpoint is "ws" or "wss".
* Tunneled endpoints are usually handled by custom [Gateway]{@link libs/Gateway.js}-based classes such as [WSSTunnel]{@link libs/gateways/WSSTunnel.js}
*/
function processRPCRequest(requestData, sessionObj) {
   var parsed = false;
   try {
      sessionObj.requestObj = JSON.parse(requestData);
      if ((sessionObj.requestObj != null) && (sessionObj.requestObj != undefined) && (sessionObj.requestObj != "")) {
         parsed = true;
      }
   } catch (err) {
   } finally {
    if (!parsed) {
      sessionObj.requestObj = new Object();
		sendError(JSONRPC_ERRORS.PARSE_ERROR, "Request empty or malformed.", sessionObj);
		return;
    }
   }
	if (isNaN(sessionObj.requestObj.length)) {
      //single request
      var validationResult = validateJSONRPC(sessionObj.requestObj);
      if (validationResult != null) {
        sendError(JSONRPC_ERRORS.REQUEST_ERROR, validationResult, sessionObj);
        return;
      } else {
        invokeAPIFunction(sessionObj);
      }
	} else {
    //batched requests
		if (sessionObj.requestObj.length > rpc_options.max_batch_requests) {
      var errString = `No more than ${rpc_options.max_batch_requests} batched requests allowed. Request has ${sessionObj.requestObj.length} requests.`;
			sendError(JSONRPC_ERRORS.INTERNAL_ERROR, validationResult, sessionObj);
			return;
		}
		var batchResponses = new Object();
		batchResponses.responses = new Array();
		batchResponses.total = sessionObj.requestObj.length;
		for (var count = 0; count < sessionObj.requestObj.length; count++) {
         var validationResult = validateJSONRPC(sessionObj.requestObj[count]);
         if (validationResult != null) {
           sendError(JSONRPC_ERRORS.REQUEST_ERROR, validationResult, sessionObj);
           return;
         } else {
             invokeAPIFunction(sessionObj, count);
         }
		}
	}
}

/**
* Invokes an external API function as requested by a RPC call.
*
* @param {Object} sessionObj An object containing data for the current sesssion.
* The contents of this object will differ depending on the type of endpoint that received the original request.
* @param {String} sessionObj.endpoint The source / target endpoint type associated with this session object. Valid values include:<br/>
* "ws" - WebSocket<br/>
* "wss" - secure WebSocket<br/>
* "wstunnel" - WebSocket tunnel<br/>
* "http" - HTTP<br/>
* "https" - secure HTTP
* @param {Object} sessionObj.requestObj The full, parsed JSON-RPC 2.0 object as received in the original request.
* @param {String} sessionObj.serverRequest The functional request object, either an <a href="https://nodejs.org/api/http.html#http_class_http_incomingmessage">IncomingMessage</a> instance when
* the endpoint is "http" or "https", or the source WebSocket connection when the endpoint is "ws" or "wss".
* Tunneled endpoints are usually handled by custom [Gateway]{@link libs/Gateway.js}-based classes such as [WSSTunnel]{@link libs/gateways/WSSTunnel.js}.
* @param {String} sessionObj.serverResponse The functional response object either a <a href="https://nodejs.org/api/http.html#http_class_http_serverresponse">ServerResponse</a> instance when
* the endpoint is "http" or "https", or the target WebSocket connection when the endpoint is "ws" or "wss".
* Tunneled endpoints are usually handled by custom [Gateway]{@link libs/Gateway.js}-based classes such as [WSSTunnel]{@link libs/gateways/WSSTunnel.js}.
* @param {Number} [requestNum=null] The index of the batched request within sessionObj.requestObj to process if the request is a batched request. If null or omitted then the requests is processed as
* a single request.
*/
function invokeAPIFunction(sessionObj, requestNum=null) {
  if (requestNum == undefined) {
    requestNum = null;
  }
  if (requestNum != null) {
    var requestMethod = sessionObj.requestObj[requestNum].method;
  } else {
    requestMethod = sessionObj.requestObj.method;
  }
  if (_APIFunctions[requestMethod] == undefined) {
     if (requestMethod.trim().startsWith("rpc:")) {
        //an optional proposal for the JSON-RPC 2.0 spec (system extensions)
        sendError(JSONRPC_ERRORS.REQUEST_ERROR, "System extensions (\"rpc:\") are not implemented.", sessionObj);
     } else {
        sendError(JSONRPC_ERRORS.METHOD_NOT_FOUND_ERROR, "Method \""+requestMethod+"\" does not exist.", sessionObj);
     }
    return;
  } else {
    var script = _APIFunctions[requestMethod].script;
    var vmContext = new Object();
    vmContext = Object.assign(rpc_options.exposed_api_objects, vmContext);
    var context = vm.createContext(vmContext);
    vm.runInContext(script, context, {timeout:rpc_options.api_timelimit});
    context[requestMethod](sessionObj).catch(err => {
       sendError(JSONRPC_ERRORS.INTERNAL_ERROR, "An internal server error occurred while processing your request.", sessionObj);
       console.error ("API invocation error: \n"+err.stack);
    });
  }
}

/**
* Generates a final JSON-RPC 2.0 error object and sends it to the requestor via the source endpoint.
*
* @param {Number} code A RPC error result code to include in the response. This code is non-standard and is defined on a per-application basis.
* @param {String} message A human-readable error message to include in the response.
* @param {Object} sessionObj An object containing data for the current sesssion.
* The contents of this object will differ depending on the type of endpoint that received the original request.
* @param {String} sessionObj.endpoint The source / target endpoint type associated with this session object. Valid values include:<br/>
* "ws" - WebSocket<br/>
* "wss" - secure WebSocket<br/>
* "wstunnel" - WebSocket tunnel<br/>
* "http" - HTTP<br/>
* "https" - secure HTTP
* @param {Object} sessionObj.requestObj The full, parsed JSON-RPC 2.0 object as received in the original request.
* @param {String} sessionObj.serverRequest The functional request object, either an <a href="https://nodejs.org/api/http.html#http_class_http_incomingmessage">IncomingMessage</a> instance when
* the endpoint is "http" or "https", or the source WebSocket connection when the endpoint is "ws" or "wss".
* Tunneled endpoints are usually handled by custom [Gateway]{@link libs/Gateway.js}-based classes such as [WSSTunnel]{@link libs/gateways/WSSTunnel.js}.
* @param {String} sessionObj.serverResponse The functional response object either a <a href="https://nodejs.org/api/http.html#http_class_http_serverresponse">ServerResponse</a> instance when
* the endpoint is "http" or "https", or the target WebSocket connection when the endpoint is "ws" or "wss".
* Tunneled endpoints are usually handled by custom [Gateway]{@link libs/Gateway.js}-based classes such as [WSSTunnel]{@link libs/gateways/WSSTunnel.js}.
* @param {Object} sessionObj.batchResponses An object containing batched responses if the original request was a batched request.
* @param {*} [data] Any additional relevant data to include in the response.
*/
function sendError(code, message, sessionObj, data) {
	var requestData = sessionObj.requestObj;
	var responseData = buildJSONRPC(null, false); //use default version,  create error message (isResult=false)
	if ((requestData["id"] == null) || (requestData["id"] == undefined)) {
		responseData.id = null;
	} else {
		responseData.id = requestData.id;
	}
	responseData.error = new Object();
	responseData.error.code = code;
	responseData.error.message = message;
	if (data != undefined) {
		responseData.error.data = data;
	}
   try {
      if (sessionObj.batchResponses != null) {
         //handle batched responses
   		sessionObj.batchResponses.responses.push(responseData);
   		if (sessionObj.batchResponses.total == sessionObj.batchResponses.responses.length) {
            switch (sessionObj.endpoint) {
              case "http":
                setDefaultHeaders(sessionObj.serverResponse);
        			  sessionObj.serverResponse.end(JSON.stringify(sessionObj.batchResponses.responses));
                break;
              case "https":
                break;
              case "ws":
                sessionObj.serverResponse.send(JSON.stringify(sessionObj.batchResponses.responses));
                break;
              case "wss":
                break;
             case "wstunnel":
               sessionObj.serverResponse.send(JSON.stringify(sessionObj.batchResponses.responses));
               break;
              default:
                throw (new Error(`Unsupported endpoint type ${sessionObj.endpoint}`));
                break;
            }
   		}
   	} else {
       //handle single response
       switch (sessionObj.endpoint) {
         case "http":
           setDefaultHeaders(sessionObj.serverResponse);
           sessionObj.serverResponse.end(JSON.stringify(responseData));
           break;
         case "https":
           setDefaultHeaders(sessionObj.serverResponse);
           sessionObj.serverResponse.end(JSON.stringify(responseData));
           break;
         case "ws":
           sessionObj.serverResponse.send(JSON.stringify(responseData));
           break;
         case "wss":
           break;
        case "wstunnel":
          sessionObj.serverResponse.send(JSON.stringify(responseData));
          break;
         default:
           throw (new Error(`Unsupported endpoint type ${sessionObj.endpoint}`));
           break;
       }
    }
   } catch (err) {
      console.error(err.stack);
   }
}

/**
* Generates a final JSON-RPC 2.0 response (result) object and sends it to the requestor via the source endpoint.
*
* @param {Object} result The result object to include with the JSON-RPC response object, usually the result of the RPC call.
* @param {Object} sessionObj An object containing data for the current sesssion.
* The contents of this object will differ depending on the type of endpoint that received the original request.
* @param {String} sessionObj.endpoint The source / target endpoint type associated with this session object. Valid values include:<br/>
* "ws" - WebSocket<br/>
* "wss" - secure WebSocket<br/>
* "wstunnel" - WebSocket tunnel<br/>
* "http" - HTTP<br/>
* "https" - secure HTTP
* @param {Object} sessionObj.requestObj The full, parsed JSON-RPC 2.0 object as received in the original request.
* @param {String} sessionObj.serverRequest The functional request object, either an <a href="https://nodejs.org/api/http.html#http_class_http_incomingmessage">IncomingMessage</a> instance when
* the endpoint is "http" or "https", or the source WebSocket connection when the endpoint is "ws" or "wss".
* Tunneled endpoints are usually handled by custom [Gateway]{@link libs/Gateway.js}-based classes such as [WSSTunnel]{@link libs/gateways/WSSTunnel.js}.
* @param {String} sessionObj.serverResponse The functional response object either a <a href="https://nodejs.org/api/http.html#http_class_http_serverresponse">ServerResponse</a> instance when
* the endpoint is "http" or "https", or the target WebSocket connection when the endpoint is "ws" or "wss".
* Tunneled endpoints are usually handled by custom [Gateway]{@link libs/Gateway.js}-based classes such as [WSSTunnel]{@link libs/gateways/WSSTunnel.js}.
* @param {Object} sessionObj.batchResponses An object containing batched responses if the original request was a batched request.
*/
function sendResult(result, sessionObj) {;
	var requestData = sessionObj.requestObj;
	var responseData = buildJSONRPC();
  //copy id from request to maintain session continuity
	if ((requestData["id"] == null) || (requestData["id"] == undefined)) {
		responseData.id = null;
	} else {
		responseData.id = requestData.id;
	}
	responseData.result = result;
   try {
   	if (sessionObj.batchResponses != null) {
         //handle batched responses
   		sessionObj.batchResponses.responses.push(responseData);
   		if (sessionObj.batchResponses.total == sessionObj.batchResponses.responses.length) {
            switch (sessionObj.endpoint) {
              case "http":
                 setDefaultHeaders(sessionObj.serverResponse);
        			  sessionObj.serverResponse.end(JSON.stringify(sessionObj.batchResponses.responses));
                break;
              case "https":
                break;
              case "ws":
                sessionObj.serverResponse.send(sessionObj.batchResponses.responses);
                break;
              case "wss":
                break;
             case "wstunnel":
               sessionObj.serverResponse.send(sessionObj.batchResponses.responses);
               break;
              default:
                throw (new Error(`Unsupported endpoint type ${sessionObj.endpoint}`));
                break;
            }
   		}
      } else {
          //handle single response
          switch (sessionObj.endpoint) {
            case "http":
              setDefaultHeaders(sessionObj.serverResponse);
              sessionObj.serverResponse.end(JSON.stringify(responseData));
              break;
            case "https":
              setDefaultHeaders(sessionObj.serverResponse);
              sessionObj.serverResponse.end(JSON.stringify(responseData));
              break;
            case "ws":
              sessionObj.serverResponse.send(JSON.stringify(responseData));
              break;
            case "wss":
              break;
           case "wstunnel":
             sessionObj.serverResponse.send(JSON.stringify(responseData));
             break;
            default:
              throw (new Error(`Unsupported endpoint type ${sessionObj.endpoint}`));
              break;
          }
      }
   } catch (err) {
      console.error(err);
   }
}

/**
* Builds a JSON-RPC message object.
*
* @param {String} [version="2.0"] The JSON-RPC version to designate the object as.
* Currently only JSON-RPC 2.0 message formatting is supported and other versions
* will throw an error. If this parameter is null, the default value is assumed.
* @param {Boolean} [isResult=true] True if this is a result object or
* notification, false if it's an error.
* @param {Boolean} [includeUniqueID=false] A uniquely generated message ID
* will be generated if true otherwise no ID is included (e.g. notification).
*/
function buildJSONRPC(version="2.0", isResult=true, includeUniqueID=false) {
   var jsonObj = new Object();
   if (version == null) {
      version = "2.0";
   }
   version = version.trim();
   if (version != "2.0") {
      throw (new Error("Unsupported JSON-RPC message format version (\"" + version + "\")"));
   }
   jsonObj.jsonrpc = version;
   if (includeUniqueID) {
      jsonObj.id = String(Date.now()).split("0.").join("");
   }
   if (isResult) {
      jsonObj.result = new Object();
   } else {
      jsonObj.error = new Object();
      jsonObj.error.message = "An error occurred.";
      jsonObj.error.code = JSONRPC_ERRORS.INTERNAL_ERROR;
   }
   return (jsonObj);
}

/**
* Adds the default HTTP headers, as defined in rpc_options.http_headers,
* to a HTTP / HTTPS response object.
*
* @param {Object} serverResponse The
* <a href="https://nodejs.org/api/http.html#http_class_http_serverresponse">
* ServerResponse</a> object to add default headers to.
*/
function setDefaultHeaders(serverResponse) {
	for (var count=0; count < rpc_options.http_headers.length; count++) {
		var headerData = rpc_options.http_headers[count];
		for (var headerType in headerData) {
			serverResponse.setHeader(headerType, headerData[headerType]);
		}
	}
}

/**
* Empty (no operation) function provided as a parameter to the WebSocket ping
* function in {@link ping}.
*/
function noop() {}

/**
* Invoked when a WebSocket client pong is received in response to a {@link ping}.
* Note that this function is invoked in the context of the responding WebSocket
* instance.
*/
function heartbeat() {
   //console.log ("Received pong from: "+this._socket.remoteAddress);
   this.isAlive = true;
}

/**
* Pings all connnected WebSocket clients to ensure that they're still alive
* and active. This function is usually invoked through a timer created by the
* {@link startWSServer} function. Any WebSocket connnections that do not respond to
* pings are automatically closed.
*/
function ping() {
   ws_server.clients.forEach(function each(ws) {
    if (ws.isAlive === false) {
      return (ws.terminate());
    }
    ws.isAlive = false;
    ws.ping(noop);
   });
}

/**
* Checks a JSON-RPC 2.0 request object for the existence of a specific parameter.
*
* @param {Object} requestObj The JSON-RPC 2.0 request object to check for a parameter.
* @param {String} param The parameter name to check for.
* @param {Boolean} [nullAllowed=true] If true, null values are considered as existing, otherwise they are considered as non-existent.
*
* @return {Boolean} True if the specified parameter exists, false otherwise.
*/
function paramExists(requestObj, param, nullAllowed = true) {
   if ((requestObj == null) || (requestObj == undefined)) {
      return (false);
   }
	if ((requestObj["params"] == null) || (requestObj["params"] == undefined)) {
  	   return (false);
	}
	if (requestObj.params[param] == undefined) {
    return (false);
	}
   if ((requestObj.params[param] == null) && (nullAllowed == false)) {
    return (false);
   }
  return (true);
}

/**
* Attempts to start the JSON-RPC 2.0 HTTP server using the default {@link rpc_options}. The {@link onStartHTTPServer} function is invoked when
* the server is successfully started. The {@link handleHTTPRequest} function handles requests.
*
* @async
*/
async function startHTTPServer() {
   if (rpc_options.http_port < 1) {
      console.log ("HTTP server disabled.")
   } else {
   	console.log (`Starting JSON-RPC 2.0 HTTP server on port ${rpc_options.http_port}...`);
   	http_server = http.createServer(handleHTTPRequest);
   	http_server.listen(rpc_options.http_port, onStartHTTPServer);
   }
}


/**
* Attempts to start the JSON-RPC 2.0 WebSocket server using the default {@link rpc_options}. The {@link onStartWSServer} function is invoked when
* the server is successfully started.
*/
function startWSServer() {
   if (rpc_options.ws_port < 1) {
      console.log ("WebSocket server disabled.");
   } else {
   	console.log (`Starting JSON-RPC 2.0 WebSocket server on port ${rpc_options.ws_port}...`);
   	try {
         ws_server = new websocket.Server({ port: rpc_options.ws_port });
         ws_server.on("listening", onStartWSServer);
         ws_server.on("connection", onWSConnection);
         ws_ping_intervalID = setInterval(ping, ws_ping_interval);
   	} catch (err) {
   		console.error (err);
   	}
   }
}

/**
* Invoked when a WebSocket connection is established on the WebSocket server.
*
* @param {WebSocket} wsInstance The WebSocket instance that was just connected.
* @param {Object} request The request object included with the new connection.
* @listens ws_server -> connection
*/
function onWSConnection (wsInstance, request) {
  //console.log (`Established WebSocket connection on -> ${request.connection.remoteAddress}`);
  wsInstance._req = request;
  wsInstance.isAlive = true;
  wsInstance.on('pong', heartbeat);
  wsInstance.on("message", handleWSRequest);
  wsInstance.on("close", handleWSDisconnect);
}


/**
* Function invoked by {@link startHTTPServer} when the HTTP server has been successfully started.
*/
function onStartHTTPServer() {
	console.log (`JSON-RPC 2.0 HTTP server listening on port ${rpc_options.http_port}.`);
}

/**
* Function invoked by {@link startWSServer} when the WebSocket server has been successfully started.
*/
function onStartWSServer () {
	console.log (`JSON-RPC 2.0 WebSocket server listening on port ${rpc_options.ws_port}.`);
}

/**
* Function invoked when a single WebSocket connection is closed / disconnected.
*/
function handleWSDisconnect() {
   //console.log ("WebSocket connection closed");
}

/**
* Handles a WebSocket request by creating a session object and invoking
* {@link processRPCRequest}.
*
* @param {Object} requestData The raw, unparsed request body.
*/
function handleWSRequest(requestData) {
  var sessionObj = new Object();
  sessionObj.endpoint = "ws";
  sessionObj.serverRequest = this;
  sessionObj.serverResponse = this;
  processRPCRequest(requestData, sessionObj);
}

/**
* Handles data received through the HTTP endpoint and invokes {@link processRPCRequest} when a full request is received via a POST
* method. This endpoint may also used to call functionailty through GET requests.
*
* @param {Object} requestObj HTTP request object <a href="https://nodejs.org/api/http.html#http_class_http_incomingmessage">https://nodejs.org/api/http.html#http_class_http_incomingmessage</a>
* @param {Object} responseObj HTTP response object <a href="https://nodejs.org/api/http.html#http_class_http_serverresponse">https://nodejs.org/api/http.html#http_class_http_serverresponse</a>
*/
function handleHTTPRequest(requestObj, responseObj){
	//only headers received at this point so read following POST data in chunks...
	if (requestObj.method == 'POST') {
		var requestData = new String();
		requestObj.on('data', function(chunk) {
			//reading message body...
			if ((chunk != undefined) && (chunk != null)) {
				requestData += chunk;
			}
		});
		requestObj.on('end', function() {
			//message body fully read
         var sessionObj = new Object();
         sessionObj.endpoint = "http";
         sessionObj.serverRequest = requestObj;
         sessionObj.serverResponse = responseObj;
			processRPCRequest(requestData, sessionObj);
		});
   } else if (requestObj.method == 'GET') {
      //process GET request
      //responseObj.send("HTTP response...");
   }
}

/**
* Adjusts various settings and properties based on the detected runtime environment. For example,
* Zeit (NOW) deployments require only a single WebSocket connection that must be on port 80 (this
* may change).
*/
function adjustEnvironment() {
   //NOW_DC and NOW_REGION are defined for Zeit's Data Centre settings
   if ((typeof(process.env["NOW_DC"]) == "string") && (typeof(process.env["NOW_REGION"]) == "string")) {
      console.log ("Detected Zeit (NOW) runtime environment.")
      rpc_options.http_port = -1; //disable HTTP server altogether
      rpc_options.ws_port = 80; //WebSocket server can only listen on port 80 (forwarded from a secure connection)
      rpc_options.http_only_handshake = false; //enable WebSockets for handshakes (since HTTP server is disabled)
   }
}

/**
* Function invoked after the main configuration data is loaded and parsed but
* before API functions are loaded, the account system initialized, and the
* server endpoints started.
*
* @async
* @private
*/
async function postLoadConfig() {
   loadAPIFunctions(startHTTPServer, startWSServer); //load available API functions and then start servers
   return (true);
}

//Application entry point:


//load external configuration data from default location
loadConfig().then (configObj => {
   console.log ("Configuration data successfully loaded and parsed.");
   rpc_options.exposed_api_objects.config = config;
   if (config.WSS.API.RPC.http.enabled == true) {
      rpc_options.http_port = config.WSS.API.RPC.http.port;
   } else {
      rpc_options.http_port = -1;
   }
   if (config.WSS.API.RPC.wss.enabled == true) {
      rpc_options.ws_port = config.WSS.API.RPC.wss.port;
   } else {
      rpc_options.ws_port = -1;
   }
   adjustEnvironment(); //adjust for local runtime environment
	postLoadConfig().then(success => {
		if (success != true) {
	      throw (new Error("Post-load configuration failed."));
	   }
		if (config.WSS.API.gateways.enable == true) {
	   	rpc_options.exposed_gateway_objects.config = config;
	   	Gateways = require("./libs/Gateways.js");
	   	gateways = new Gateways(rpc_options.exposed_gateway_objects, config.WSS.API.gateways);
	   	gateways.initialize();
		}
	})
}).catch (err => {
   console.error ("Couldn't load or parse configuration data.");
   console.error (err);
})
