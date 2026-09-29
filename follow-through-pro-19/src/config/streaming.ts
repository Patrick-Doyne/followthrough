/**
 * Live-session signaling configuration.
 *
 * The browser is the WebRTC *master*: it captures the camera, sends it to
 * `follow_through_webrtc` (the C++ viewer) and receives per-frame overlay
 * telemetry back over a DataChannel. SDP offers, answers and ICE
 * candidates are exchanged through a plain WebSocket relay
 * (`js/mock-websocket.js`), which is the AWS-free stand-in for a KVS
 * signaling channel. Swapping in real signaling later is expected to be an
 * isolated change to `services/webrtc-live.ts`, not a UI change.
 */
export interface SignalingConfig {
  relayUrl: string;
}

export const signalingConfig: SignalingConfig = {
  relayUrl:
    (import.meta.env["VITE_SIGNALING_RELAY_URL"] as string | undefined) ?? "ws://localhost:8080",
};
