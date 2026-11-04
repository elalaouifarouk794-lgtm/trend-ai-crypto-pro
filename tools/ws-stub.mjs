// Browser stub for the Node-only `ws` package that ethers pulls in for
// WebSocketProvider. The trading UI uses JsonRpcProvider/BrowserProvider only,
// so this must never be reachable — and it fails loudly if it ever is.
export class WebSocket {
  constructor() {
    throw new Error("ws transport is unavailable in the browser build");
  }
}
export default WebSocket;
