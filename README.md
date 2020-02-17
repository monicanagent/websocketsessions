<p align="center"><img src="https://user-images.githubusercontent.com/9059336/58511806-90a82a80-8169-11e9-9175-7643effc9b00.png" width="25%" height="25%"></p>

# WebSocket Sessions Server & Client (Browser) Libraries

A Node.js server and accompanying [ECMAScript 2017](https://www.ecma-international.org/ecma-262/8.0/) browser libraries for WebSocket API services and peer-to-peer communications / tunneling.

## Using the Server

#### Install the Server

1. Install [Node.js](https://nodejs.org/).
2. Copy or clone the GitHub repository.
2. In a terminal / command line window, change to the `node` directory and run: `npm install`

#### Configure the Server

1. Update the `config.json` file located in the `node` directory.

   Some common options include:

   - **Change the listening port of the WebSocket server** => Change the `WSS.API.RPC.wss.port` property to the desired port number.
   - **Enable HTTP handshaking** => Change the `WSS.API.RPC.http.enabled` property to `true` to  and change `WSS.API.RPC.http.port` to the desired HTTP listening port.
   - **Enable WSST tunneled connections to the server** => Change `WSS.API.gateways.WSSTunnel.enable` and `WSS.API.gateways.WSSTunnel.start` properties to `true`, update `WSS.API.gateways.WSSTunnel.host` to the URL of the WSST tunneling server, then enter an entry such as `{"alias":null, "allow":"*", "socketOptions":null}` to the `tunnels` array for each tunnel you want to open to the server.
   - **Enable SSH tunneled connections to the server** => Change `WSS.API.gateways.SSHTunnel.enable` and `WSS.API.gateways.SSHTunnel.start` properties to `true`.

#### Run the Server

1. In a terminal / command line window, in the `node` directory type: `npm start`


## Using the Client / Web Libraries

_See the `browser/index.html` file for a demonstration of the topics below. You can load this file directly from the file system (no web server is required)._

### Include the JavaScript library bundle in your page `<head>`

`<script src="https://monicanagent.github.io/websocketsessions/browser/bundle.js" type="text/javascript" language="javascript"></script>`

### Connect to WSS Server (Standard Connection)

```
var serverAddress = "ws://localhost:8090"; //change to your server's address and port
var client = new WSSClient(serverAddress);
client.connect().then(success => {
   console.log ("Successfully connected to WSS server @ " + client.handshakeServerAddr);
   console.log ("User token: " + client.userToken);
   console.log ("Server token: " + client.serverToken);
   console.log ("Private ID: " + client.privateID);
   console.log ("Currently connected peers: " + client.peers); //list of private IDs
}).catch (error => {
   console.error ("Couldn't connect to WSS server: "+error);
})
```

### Connect to WSS Server (Tunneled Connection)

```
var tunnelingServerAddress = "ws://localhost:8090"; //change to your tunneling server's address and port
var tunnelParams = new Object();
tunnelParams.endpoint = new Object();
tunnelParams.endpoint.aliases = ["tunnelAlias1","tunnelAlias2"]; //replace with the tunnel aliases for the endpoint server
var client = new WSSTunnel(serverAddress, false, {tunnelParams:tunnelParams});
client.connect().then(success => {
   console.log ("Successfully connected to endpoint through WSS tunneling server @ " + client.handshakeServerAddr);
   console.log ("User token (tunneled): " + client.userToken);
   console.log ("Server token (tunneled): " + client.serverToken);
   console.log ("Private ID (tunneled): " + client.privateID);
   console.log ("Currently connected peers (tunneled): " + client.peers); //list of private IDs
}).catch (error => {
   console.error ("Couldn't connect to WSS tunneling server or endpoint: "+error);
})
```

### Peer-to-Peer Functionality
_Note that "PID" values are peer "Private IDs" assigned to each peer when connected and used when sending private / direct communications. Broadcasts messages don't use PIDs._

#### Detecting Peer Connections & Disconnections

```
function onPeerConnect(event) {
   var jsonRPC = event.data;
   var connectedPID = jsonRPC.result.connect;
   console.log ("A peer has connected: " + connectedPID);
}

function onPeerDisconnect(event) {
   var jsonRPC = event.data;
   var disconnectedPID = jsonRPC.result.disconnect;
   console.log ("A peer has disconnected: " + disconnectedPID);
}
```
#### Receiving Messages
```
function onReceiveMessage(event) {
   var jsonRPC = event.data;
   console.log("Message received (from PID: "+ jsonRPC.result.from +"): "+jsonRPC.result.data);
}


client.addEventListener("peerconnect", onPeerConnect);
client.addEventListener("peerdisconnect", onPeerDisconnect);
client.addEventListener("message", onReceiveMessage);

```

#### Sending Messages

```
function sendToPrivateID(recipientPID, message) {
   client.send (message, [recipientPID]); //array can include multiple recipient PIDs or just one
}

function sendToEveryone(message) {
   client.broadcast (message); //note no PIDs (broadcast to every connected peer)
}
```

#### Disconnecting


```
client.disconnect();
```

#### To Do

- Include instructions on establishing connections via a [Services Descriptor Bundle](https://github.com/monicanagent/sdb).
- Minimize client library bundle.
- Add project to npm for easier installation (e.g. `npm i websocketsessions`)
