// ============================================================
// LOCAL SIGNALING RELAY -- the AWS-free stand-in for KVS's
// SignalingClient during local development. Its only job: forward
// whatever one connected client sends to every OTHER connected
// client. No AWS involved, no credentials, nothing but plain JSON
// message passing over a local WebSocket.
//
// This is deliberately dumb -- it doesn't parse or care about the
// content of messages (offer/answer/ICE candidate), it just relays
// them. That mirrors what KVS's own SignalingClient does: hand SDP/
// ICE data between peers without understanding it itself. Swapping
// this relay out for the real AWS SignalingClient later should be a
// small, isolated change specifically because this relay does
// nothing more than that one job.
//
// Setup (from this directory):
//   npm install
//   node mock-websocket.js
//
// Listens on ws://localhost:8080. Its two clients are the frontend's
// live page (the WebRTC master, services/webrtc-live.ts) and the C++
// backend follow_through_webrtc (the viewer). Start order does not
// matter: the backend announces itself with a "ready" message when it
// connects, and the frontend re-sends its offer on every "ready" it
// sees.
// ============================================================

const WebSocket = require("ws");

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[relay] client connected (${clients.size} total)`);

  ws.on("message", (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch (e) {
      console.log("[relay] received non-JSON message, forwarding as-is");
      parsed = null;
    }

    if (parsed && parsed.type) {
      console.log(`[relay] forwarding "${parsed.type}" message`);
    }

    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(data.toString());
      }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[relay] client disconnected (${clients.size} total)`);
  });

  ws.on("error", (err) => {
    console.log("[relay] client error:", err.message);
  });
});

console.log(`Local signaling relay listening on ws://localhost:${PORT}`);
console.log("Waiting for the frontend live page and follow_through_webrtc to connect...");