/**
* @file WebSocket Session initiation API endpoint.
*
* @example
* Client Request -> {"jsonrpc":"2.0","method":"WSS_Handshake","id":"1","params":{"user_token":"7060939278321507"}}
* Server Response -> {"jsonrpc":"2.0","result":{"message":"accept","numconnections":1,"maxconnections":3,"peerconnections":1,"server_token":"9789091435706088"},"id":"1"}
*
* @version 0.4.1
*/
async function WSS_Handshake (sessionObj) {
   if ((sessionObj.endpoint.startsWith("http") == false)  && (rpc_options.http_only_handshake)) {
      sendError(JSONRPC_ERRORS.WRONG_TRANSPORT, "Session handshake must be made through HTTP / HTTPS service.", sessionObj);
      return (false);
   }
   if ((namespace.wss["connections"] == undefined) || (namespace.wss["connections"] == null)) {
      namespace.wss.connections = new Object();
   }
   var requestData = sessionObj.requestObj;
   var requestParams = requestData.params;
   var responseObj = new Object();
   var connectionID = namespace.wss.makeConnectionID(sessionObj);
   var num_activeconnections = 0; //number of currently active WebSocket connections namespace.wssly
   for (var item in namespace.wss.connections) {
      if ((namespace.wss.connections[item] != undefined) && (namespace.wss.connections[item] != null)) {
         //we also need to ook at multiple connections from the same IP (if allowed)...
         for (var count = 0; count < namespace.wss.connections[item].length; count++) {
            var websocketObj = namespace.wss.connections[item][count];
            if (websocketObj.user_token == requestParams.user_token) {
               //when the IP is the same then the user token can't be!
               sendError(JSONRPC_ERRORS.SESSION_CLOSE, "User token already exists for your IP.", sessionObj);
               return;
            }
            num_activeconnections++;
         }
      }
   }
   var server_token = await namespace.wss.makeConnectionToken();
   if ((namespace.wss.connections[connectionID] == undefined) || (namespace.wss.connections[connectionID] == null)) {
      var connectionObj = new Object();
      connectionObj.user_token = requestParams.user_token;
      connectionObj.socket = null; //not yet connected
      connectionObj.last_update = new Date();
      connectionObj.server_token = server_token;
      connectionObj.tunnels = new Array();
      namespace.wss.connections[connectionID] = new Array();
      namespace.wss.connections[connectionID].push(connectionObj);
      num_activeconnections++; //new connection just added
      responseObj.message = "accept";
      responseObj.numconnections = 1;
      responseObj.maxconnections = rpc_options.max_ws_per_ip;
      responseObj.peerconnections = num_activeconnections;
      responseObj.server_token = server_token;
      sendResult(responseObj, sessionObj);
   } else {
      let num_activeconnections = namespace.wss.connections[connectionID].length;
      if (num_activeconnections >= rpc_options.max_ws_per_ip) {
         var infoObj = new Object();
         infoObj.numconnections = num_activeconnections;
         infoObj.maxconnections = rpc_options.max_ws_per_ip;
         responseObj.peerconnections = num_activeconnections;
         sendError(JSONRPC_ERRORS.SESSION_CLOSE, "Too many connections from your IP.", sessionObj, infoObj);
      } else {
         connectionObj = new Object();
         connectionObj.user_token = requestParams.user_token;
         connectionObj.socket = null; //not yet connected
         connectionObj.last_update = Date.now();
         connectionObj.server_token = server_token;
         connectionObj.tunnels = new Array();
         namespace.wss.connections[connectionID].push(connectionObj);
         responseObj.message = "accept";
         num_activeconnections++; //new connection just added
         responseObj.numconnections = num_activeconnections;
         responseObj.maxconnections = rpc_options.max_ws_per_ip;
         responseObj.peerconnections = num_activeconnections;
         responseObj.server_token = server_token;
         sendResult(responseObj, sessionObj);
      }
   }
   return (true);
}

/**
* Returns a connection object from <code>namespace.wss.connections</code>
* based on a connection ID.
*
* @param {String} connectionID The connection ID for which to retrieve the
* connection object.
* @param {String} userToken The user-generated token stored with the specific
* connection object.
* @param {String} serverToken The server-generated token stored with the specific
* connection object.
*
* @return {Object} The connection object matching all parameters, or <code>null</code>
* if no such connection exists. In the unlikely event that more than one matchibng
* connection object exists, only the first one is returned.
*/
function getConnectionByCID(connectionID, userToken, serverToken) {
   if ((namespace.wss.connections == undefined) || (namespace.wss.connections == null)) {
      namespace.wss.connections = new Object();
      return (null);
   }
   if ((namespace.wss.connections[connectionID] == undefined) || (namespace.wss.connections[connectionID] == null)) {
      retrun (null);
   }
   var connectionsArr = namespace.wss.connections[connectionID];
   for (var count=0; count < connectionsArr.length; count++) {
      var connectionObj = connectionsArr[count];
      if ((connectionObj.user_token == userToken) && (connectionObj.server_token == serverToken)) {
         return (connectionObj);
      }
   }
   return (null);
}

/**
* Returns a connection object from <code>namespace.wss.connections</code>
* based on a private ID.
*
* @param {String} privateID The private ID for which to retrieve the
* connection object.
*
* @return {Object} The connection object matching the private ID or <code>null</code>
* if no such connection exists. In the unlikely event that more than one matchibng
* connection object exists, only the first one is returned.
*/
function getConnectionByPID(privateID) {
   if ((namespace.wss.connections == undefined) || (namespace.wss.connections == null)) {
      namespace.wss.connections = new Object();
      return (null);
   }
   for (var connectionID in namespace.wss.connections) {
      var connectionsArr = namespace.wss.connections[connectionID];
      for (var count=0; count < connectionsArr.length; count++) {
         var connectionObj = connectionsArr[count];
         if (connectionObj.private_id == privateID) {
            return (connectionObj);
         }
      }
   }
   return (null);
}

/**
* Returns a connection object from <code>namespace.wss.connections</code>
* based on a <code>socket</code> instance.
*
* @param {Object} socket The socket reference to find within the <code>namespace.wss.connections</code>
* object.
*
* @return {Object} The connection object matching the socket reference or <code>null</code>
* if no such connection exists. In the unlikely event that more than one matchibng
* connection object exists, only the first one is returned.
*/
function getConnectionBySocket(socket) {
   if ((namespace.wss.connections == undefined) || (namespace.wss.connections == null)) {
      namespace.wss.connections = new Object();
      return (null);
   }
   for (var connectionID in namespace.wss.connections) {
      var connectionsArr = namespace.wss.connections[connectionID];
      for (var count=0; count < connectionsArr.length; count++) {
         var connectionObj = connectionsArr[count];
         if (connectionObj.socket == socket) {
            return (connectionObj);
         }
      }
   }
   return (null);
}

/**
* Returns a connection identifier based on information provided via an active WebSocket
* within a session object.
*
* @param {Object} sessionObj A session object such as that generated by a WSS JSON-RPC 2.0
* server.
* @return {String} A connection identifier based on the remote (client) endpoint's
* protocol family (IPv4 or IPv6), and IP. The port is omitted since it may change.
*/
function makeConnectionID (sessionObj) {
   if ((sessionObj.serverRequest["socket"] != null) && (sessionObj.serverRequest["socket"] != undefined)) {
      var socket = sessionObj.serverRequest.socket; //http core socket reference
   } else {
      socket = sessionObj.serverRequest._socket; //WebSocket core socket reference
   }
   var requestIP = socket.remoteAddress;
   var IPFamily = socket.remoteFamily;
   //var requestPort = socket.remotePort; //not currently used
   var connectionID = IPFamily + ":" + requestIP;
   return (connectionID);
}

/**
* Creates a private session identifier from given server and user tokens.
*
* @param {Object} sessionObj A session object such as that generated by a WSS JSON-RPC 2.0
* server. No validation is performed on the session object's <code>server_token</code>,
* <code>user_token</code> properties (this should be done prior to invoking this function).
*
* @return {String} The SHA256 hash of the server token concatenated with a semi-colon
* and the user token: <code>SHA256(server_token + ":" + user_token)</code>. <code>null</code>
* is returned if either of the input parameters is invalid.
*/
function makePrivateID (sessionObj) {
   try {
      var requestData = sessionObj.requestObj; //JSON-RPC 2.0 object
      var requestParams = requestData.params; //JSON-RPC request parameters
      var server_token = requestParams.server_token;
      var user_token = requestParams.user_token;
   } catch (err) {
      return (null);
   }
   if (typeof(server_token) != "string") {
      return (null);
   }
   if (typeof(user_token) != "string") {
      return (null);
   }
   if (server_token.length == 0) {
      return (null);
   }
   if (user_token.length == 0) {
      return (null);
   }
   let hash = crypto.createHash('sha256');
   hash.update(server_token + ":" +user_token);
   var hexOutput = hash.digest('hex');
   return (hexOutput);
}

/**
* Returns a private session identifier from given server and user tokens.
*
* @param {Object} sessionObj A session object such as that generated by a WSS JSON-RPC 2.0
* server. No validation is performed on the session object's <code>server_token</code>,
* <code>user_token</code> properties (this should be done prior to invoking this function).
*
* @return {String} The private identifier associated with the established
* session, or <code>null</code> if no identifier can be found.
*/
function getPrivateID(sessionObj) {
   try {
      var requestData = sessionObj.requestObj; //JSON-RPC 2.0 object
      var requestParams = requestData.params; //JSON-RPC request parameters
      var server_token = requestParams.server_token;
      var user_token = requestParams.user_token;
   } catch (err) {
      return (null);
   }
   var connectionID = namespace.wss.makeConnectionID(sessionObj);
   if ((namespace.wss.connections[connectionID] == undefined) || (namespace.wss.connections[connectionID] == null)) {
      namespace.wss.connections[connectionID] = new Array();
      return (null);
   }
   if (typeof(server_token) != "string") {
      return (null);
   }
   if (typeof(user_token) != "string") {
      return (null);
   }
   if (server_token.length == 0) {
      return (null);
   }
   if (user_token.length == 0) {
      return (null);
   }
   for (var count = 0; count < namespace.wss.connections[connectionID].length; count++) {
      var connectionObj = namespace.wss.connections[connectionID][count];
      if ((user_token == connectionObj.user_token) && (server_token == connectionObj.server_token)){
         return (connectionObj.private_id);
      }
   }
   return (null);
}

/**
* Generates a random server connection token to be used for authentication (for example,
* to be used as a <code>server_token</code>).
*
* @return {String} A randomly generated server connection token.
*
*/
function makeConnectionToken() {
   var promise = new Promise((resolve, reject) => {
      crypto.randomBytes(32, (err, buf) => {
         if (err) {
            reject (err);
         }
         resolve (buf.toString("hex"));
      });
   })
   return (promise);
}

/**
* Verifies whether a handshake for a specific session has been successfully established.
*
* @param {Object} sessionObj The session object associated with the incoming request.
* @return {Boolean} True if the session specified by the parameter has been successfully
* established, false if the information doesn't match a live internal session record.
*/
function handshakeOK(sessionObj) {
   var connectionID = namespace.wss.makeConnectionID(sessionObj);
   if ((namespace.wss.connections[connectionID] == null) || (namespace.wss.connections[connectionID] == undefined)) {
      return (false)
   }
   if (namespace.wss.connections[connectionID].length == 0) {
      return (false);
   }
   for (var count = 0; count < namespace.wss.connections[connectionID].length; count++) {
      var connectionObj = namespace.wss.connections[connectionID][count];
      if (connectionObj.user_token == sessionObj.requestObj.params.user_token) {
         if (connectionObj.server_token == sessionObj.requestObj.params.server_token) {
            return (true);
         } else {
            return (false);
         }
      }
   }
   return (false);
}

/**
* Returns an array of all currently registered and (optionally) active sesssions
* being handled by the server.
*
* @param {Boolean} [activeOnly=true] If true, only live or active sessions (i.e.
* those that have successfully established a handshake and connected), are returned,
* otherwise all registered (but not necessarily connected), sessions are returned.
* @return {Array} A list of all registered and (optionally) active sessions currently
* being handled by the server.
*/
function allSessions(activeOnly = true) {
   var returnArr = new Array();
   if ((namespace.wss == undefined) || (namespace.wss == null)) {
      namespace.wss = new Object();
      return (returnArr);
   }
   if ((namespace.wss.connections == undefined) || (namespace.wss.connections == null)) {
      namespace.wss.connections = new Object();
      return (returnArr);
   }
   for (var cid in namespace.wss.connections) {
      if ((namespace.wss.connections[cid] == undefined) || (namespace.wss.connections[cid] == null)) {
         namespace.wss.connections[cid] = new Array();
         return (returnArr);
      }
      for (var count = 0; count < namespace.wss.connections[cid].length; count++) {
         var connectionObj = namespace.wss.connections[cid][count];
         if (activeOnly) {
            if (connectionObj.socket != null) {
               returnArr.push(connectionObj);
            }
         } else {
            returnArr.push(connectionObj);
         }
      }
   }
   return (returnArr);
}

if (namespace.wss == undefined) {
   namespace.wss = new Object();
}

namespace.wss.makeConnectionID = makeConnectionID;
namespace.wss.getConnectionByCID = getConnectionByCID;
namespace.wss.getConnectionByPID = getConnectionByPID;
namespace.wss.getConnectionBySocket = getConnectionBySocket;
namespace.wss.getPrivateID = getPrivateID;
namespace.wss.makePrivateID = makePrivateID;
namespace.wss.makeConnectionToken = makeConnectionToken;
namespace.wss.handshakeOK = handshakeOK;
namespace.wss.allSessions = allSessions;
