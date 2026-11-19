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

/**
 * The relay's address when nothing says otherwise: the local relay in
 * development, and away from localhost this page's own origin at `/relay`,
 * which the reverse proxy in front of a deployed instance forwards to the
 * relay. Secure pages get `wss`, so a phone's camera page can connect.
 */
function defaultRelayUrl(): string {
  if (typeof window !== "undefined") {
    const { hostname, host, protocol } = window.location;
    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      return `${protocol === "https:" ? "wss" : "ws"}://${host}/relay`;
    }
  }
  return "ws://localhost:8080";
}

export const signalingConfig: SignalingConfig = {
  relayUrl:
    (import.meta.env["VITE_SIGNALING_RELAY_URL"] as string | undefined) || defaultRelayUrl(),
};

/**
 * What the live page asks the camera for, as preferences (`ideal`), so a
 * device that cannot meet them still starts: a phone's back camera gives
 * 1280x720 at 60, a laptop webcam gives its 30.
 *
 * 1280x720 is the size the pipeline's answer permits: the backend declares
 * H.264 level 4.0 (62.9 M luma samples a second, see follow-through-webrtc
 * .cpp), which allows 720p at 60 and no more at that size, and Safari's
 * hardware encoder plans its frame rate from that level. The models lose
 * little at 720p: the detector and court model letterbox every frame to
 * 640 and the pose model letterboxes the player crop to 480. The phone
 * also runs three consumers of the camera at once (the WebRTC encoder,
 * the session recorder and the overlay canvas), and 720p keeps all three
 * cheap. The backend's loop keeps up with 60 frames a second on the
 * reference GPU; at 1080p60 it would not, and the level would not allow
 * it either.
 */
export const LIVE_CAPTURE = { width: 1280, height: 720, frameRate: 60 } as const;
