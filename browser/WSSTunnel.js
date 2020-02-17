/**
* @file Extends a WebSocket Sessions client interface to enable tunneling capabilities.
*
* @version 0.4.1
*/

/**
* @class A tunneling WebSocket Sessions interface based on {@link WSSClient}.
* Once established, a tunneled connection appears and behaves nearly identically to a
* {@link WSSClient} connection.
*
* @extends WSSClient
*/
class WSSTunnel extends WSSClient {

   /**
   * Creates an instance of WSSTunnel.
   *
   * @param {String} [handshakeServerAddress] The address of the WSS handshake
   * server (available as {@link handshakeServerAddr}). If not provided and
   * {@link connect} is called then the socket server address will be assigned
   * to the handshake server address and used for both.
   */
   constructor(handshakeServerAddress) {
      super(handshakeServerAddress);
   }

   /**
   * @property {Object} tunnelInfo=null Contains a <code>userToken</code>, <code>serverToken</code>,
   * and <code>privateID</code> used to establish a connection with the tunneling server.
   * Use these credentials when communicating with the tunneling server instead
   * of the standard class properties which are used with the tunneled endpoint.
   */
   get tunnelInfo() {
      if (this._tunnelInfo == undefined) {
         this._tunnelInfo = null;
      }
      return (this._tunnelInfo);
   }

   /**
   * Creates a WebSocket Session tunnel by performing a handshake, subsequent
   * connection to the WSS server, opening the tunnel, and finally connecting to the
   * tunneled server endpoint via [connectEndpoint]{@link WSSTunnel#connectEndpoint}
   *
   * @param {String} [socketServerAddr=null] The WebSocket Sessions tunneling server
   * address to connect to. If omitted, the assigned handshake server address will be used for
   * both the handshake and the connection.
   * @param {Boolean} [useHTTPHandshake=false] If true, a HTTP /  HTTPS
   * request is used for the handshake otherwise the handshake and
   * connection both happen on the same WebSocket connection.
   * @param {Object} connectData Data to include with the connect and tunelling API calls
   * @param {Object} [connectData.tunnelParams] An object containing the tunelling parameters.
   * @param {Object} [connectData.tunnelParams.endpoint] An object containing the
   * tunneling endpoint candidates and associated parameters.
   * @param {Array} [connectData.tunnelParams.endpoint.aliases] An indexed array of
   * tunnel candidate aliases (usually based on the endpoint private ID). The connection
   * process will attempt to connect to each alias in the order provided.
   *
   * @throws {Error} Thrown when a valid handshake / socket server address was
   * not supplied, tunelling information was omitted or erroneous, or the connection could not be
   * established.
   */
   async connect(socketServerAddress=null, useHTTPHandshake=false, connectData=null) {
      if (typeof(connectData.tunnelParams) != "object") {
         throw (new Error("Tunnel parameters not an object or missing."));
      }
      if (typeof(connectData.tunnelParams.endpoint) != "object") {
         throw (new Error("Tunnel endpoint information not an object or missing."));
      }
      if (typeof(connectData.tunnelParams.endpoint.aliases) != "object") {
         throw (new Error("Tunnel endpoint aliases not an object or missing."));
      }
      if (typeof(connectData.tunnelParams.endpoint.aliases.length) != "number") {
         throw (new Error("Tunnel endpoint aliases object is not an array."));
      }
      connectData.listeners = false; //disable event handling in parent class
      var result = await super.connect(socketServerAddress, useHTTPHandshake, connectData);
      this._tunnelInfo = new Object();
      this._tunnelInfo.privateID = this.privateID;
      this._tunnelInfo.userToken = this.userToken;
      this._tunnelInfo.serverToken = this.serverToken;
      var endpointAliases = connectData.tunnelParams.endpoint.aliases;
      for (var count = 0; count < endpointAliases.length; count++) {
         var currentAlias = endpointAliases[count];
         var tunnelRequest = new Object();
         tunnelRequest.action = "joinAlias";
         tunnelRequest.alias = currentAlias;
         tunnelRequest.tunnelServerMessages = false; //send non-status messages from the tunneling server?
         tunnelRequest.user_token = this._tunnelInfo.userToken;
         tunnelRequest.server_token = this._tunnelInfo.serverToken;
         var message_event = await RPC("WSS_Tunnel", tunnelRequest, this.webSocket);
         var rpc_result = JSON.parse(message_event.data);
         if (rpc_result.error == undefined) {
            if (rpc_result.result.status == "joined") {
               var endpointConnectResult = await this.connectEndpoint(connectData);
               return (true);
            }
         }
      }
      throw (new Error("No available tunnel endpoints to connect to."));
      return (false);
   }

   /**
   * Attempts to connect to a tunneled WebSocket Sessions endpoint. Existing
   * [userToken]{@link WSSTunnel#userToken}, [serverToken]{@link WSSTunnel#serverToken}, and
   * [ privateID]{@link WSSTunnel#privateID} values will be replaced with ones generated for / by the
   * endpoint.
   *
   * @param {Object} [connectData=null] Endpoint and peer connection information.
   * @param {Object} [connectData.options] Peer connectivity options to advertise
   * to other peers through the endpoint.
   * @param {Object} [connectData.options.wss=true] Defines if WebSocket Sessions
   * connectivity is available (true), or not (false).
   * @param {Object} [connectData.options.webrtc=false] Defines if WebRTC
   * connectivity is available (true), or not (false).
   * @param {Object} [connectData.options.ortc=false] Defines if ObjectRTC
   * connectivity is available (true), or not (false).
   *
   * @throws {Error} Thrown when a valid handshake / socket server address was
   * not supplied, or the connection could not be established.
   */
   async connectEndpoint(connectData=null) {
      this._userToken = String(Math.random()).split("0.").join("");
      var event = await RPC("WSS_Handshake", {"user_token":this.userToken}, this.webSocket);
      var resultData = JSON.parse(event.data);
      if (typeof(resultData["error"]) == "object") {
         throw (new Error("Server responded with an error ("+resultData.error.code+"): "+resultData.error.message));
      } else {
         this._serverToken = resultData.result.server_token;
      }
      var connectObj = new Object();
      if (connectData == null) {
         connectData = new Object();
      }
      connectObj.options = new Object();
      if ((connectData["options"] == undefined) || (connectData["options"] == null)) {
         //default connection options (as of v0.4.1)
         connectObj.options.wss = true;
         connectObj.options.webrtc = false;
         connectObj.options.ortc = false;
      } else {
         connectObj.options.wss = connectData.options.wss;
         connectObj.options.webrtc = connectData.options.webrtc;
         connectObj.options.ortc = connectData.options.ortc;
      }
      connectObj.user_token = this.userToken;
      connectObj.server_token = this.serverToken;
      var message_event = await RPC("WSS_Connect", connectObj, this.webSocket); //connect the WebSocket
      var rpc_result_obj = JSON.parse(message_event.data);
      if (rpc_result_obj.error != undefined) {
         throw (new Error("Couldn't establish WebSocket Session: ("+rpc_result_obj.error.code+") "+rpc_result_obj.error.message));
      }
      if ((rpc_result_obj.result["private_id"] != undefined) && (rpc_result_obj.result["private_id"] != null)) {
         this._privateID = rpc_result_obj.result.private_id;
         //the following concatenation pattern matches the server
         //implementation:
         //var hash_source_str = this.serverToken+ ":" +this.userToken;
         //var generated_pid = await this.SHA256(hash_source_str);
         //console.log ("Are they the same? "+(this._privateID == generated_pid));
      } else {
         throw (new Error("No private ID returned in WSS_Connect response."));
      }
      super._peers = new Array(); //reset peers array (previous contents are probably those of the tunneling server)
      super._peerOptions = new Object();
      if ((rpc_result_obj.result["connect"] != undefined) && (rpc_result_obj.result["connect"] != null)) {
         var connectedPeersList = rpc_result_obj.result["connect"];
         var optionsList = rpc_result_obj.result["options"]; //as of v0.4.1
         if (typeof(connectedPeersList) == "object") {
            connectedPeersList.forEach (function (peerPID, index, sourcArr) {
               this.peers.push(peerPID);
               this.peerOptions[peerPID] = optionsList[index];
            }, this);
         }
      }
      this.webSocket.addEventListener("message", this.handleSocketMessage);
      this.webSocket.addEventListener("close", this.handleSocketClose);
      return (message_event);
   }

   /**
   * Handles WebSocket message events for the tunnel. Any messages that are
   * not tunnels-specific are passed to the parent
   * [WSSClient.handleSocketMessage]{@link WSSClient#handleSocketMessage} function.
   *
   * @param {Event} eventObj A "message" event dispatched by the tunneled
   * WebSocket instance.
   */
   handleSocketMessage(eventObj) {
      try {
         var dataObj = JSON.parse(eventObj.data);
         switch (dataObj.result.type) {
            case "tunnel":
               var tunnelStatus = dataObj.result.status;
               switch (tunnelStatus) {
                  case "close":
                     super.handleSocketClose(eventObj);
                     return;
                     break;
                  default:
                     console.error("Unrecognized tunnel status: \""+tunnelStatus+"\"");
                     super.handleSocketMessage(eventObj); //maybe it's a standard WSS message?
                     return;
                     break;
               }
               break;
            default:
               super.handleSocketMessage(eventObj);
               break;
         }
      } catch (err) {
         super.handleSocketMessage(eventObj);
         return;
      }
   }

   toString() {
      return ("WSSTunnel");
   }

}
