import type { WebRTCConnectionState } from "@/types/overlay-telemetry";

/**
 * Derives the one status a person actually needs from the several the system
 * tracks.
 *
 * <p>Pure, and deliberately separate from the transport. `WebRTCLiveSession`
 * knows about sockets and peer connections; it does not know whether frames
 * have stopped arriving, and it should not. Composition happens here, which
 * is also what makes this testable — `vitest` runs in node with no
 * `RTCPeerConnection` to stand up.
 *
 * <p>The rule this exists to enforce: **a picture that is no longer current
 * must never be presented as live.** Until now the visible indicator
 * reported a different stream entirely, and the copy claimed to be
 * reconnecting when nothing reconnects.
 */

export type CameraState =
  "idle" | "initializing" | "connected" | "denied" | "unavailable" | "error";

export type LiveStatusKind = "idle" | "connecting" | "live" | "reconnecting" | "disconnected";

export interface LiveStatusInput {
  /** Whether the person has started a session at all. */
  active: boolean;
  camera: CameraState;
  webrtc: WebRTCConnectionState;
  /** Telemetry has gone quiet past the stale threshold. */
  telemetryStale: boolean;
  /** The camera's own clock has stopped advancing — the screen-lock case. */
  videoStalled: boolean;
  /** The tab is backgrounded, so quiet is expected rather than a fault. */
  hidden: boolean;
}

export interface LiveStatus {
  kind: LiveStatusKind;
  /** Short label for the pill. Sentence case, from the user's perspective. */
  label: string;
  /** One line of detail. Says what to do where there is something to do. */
  detail: string;
  /** Present when there is an action the person can take. One name per
   * action, kept identical wherever that action appears. */
  action?: "Try again" | "Restart session";
  /**
   * The canvas is showing a frame that is no longer current. The picture is
   * deliberately kept on screen — it is still information — but it must be
   * visibly marked rather than passed off as live.
   */
  stalePicture: boolean;
}

export function deriveLiveStatus(input: LiveStatusInput): LiveStatus {
  const { active, camera, webrtc, telemetryStale, videoStalled, hidden } = input;

  if (!active) {
    return {
      kind: "idle",
      label: "Not started",
      detail: "Point the camera at the rim and start a session to begin tracking.",
      stalePicture: false,
    };
  }

  // Camera problems are the person's to fix, so they outrank pipeline state:
  // telling someone the pipeline is connecting when their camera is blocked
  // sends them to the wrong place.
  if (camera === "denied") {
    return {
      kind: "disconnected",
      label: "Camera blocked",
      detail: "Allow camera access in your browser, then try again.",
      action: "Try again",
      stalePicture: false,
    };
  }
  if (camera === "unavailable") {
    return {
      kind: "disconnected",
      label: "No camera",
      detail: "Connect a camera to this device, then try again.",
      action: "Try again",
      stalePicture: false,
    };
  }
  if (camera === "error") {
    return {
      kind: "disconnected",
      label: "Camera error",
      detail: "The camera stopped unexpectedly. Try again.",
      action: "Try again",
      stalePicture: false,
    };
  }
  if (camera === "idle" || camera === "initializing") {
    return {
      kind: "connecting",
      label: "Starting camera",
      detail: "Waiting for camera access.",
      stalePicture: false,
    };
  }

  if (webrtc === "failed") {
    return {
      kind: "disconnected",
      label: "Pipeline unreachable",
      detail: "Reconnecting did not help. End the session and start it again.",
      action: "Restart session",
      stalePicture: true,
    };
  }
  if (webrtc === "idle" || webrtc === "connecting-relay" || webrtc === "waiting-for-viewer") {
    return {
      kind: "connecting",
      label: "Connecting",
      detail: "Linking up with the processing pipeline.",
      stalePicture: false,
    };
  }
  // The client now retries on its own, so this is a state to wait out
  // rather than one to act on. No action is offered, because offering one
  // would invite someone to restart a session that is already recovering.
  if (webrtc === "reconnecting") {
    return {
      kind: "reconnecting",
      label: "Reconnecting",
      detail: "The link dropped. Trying to pick the session back up.",
      stalePicture: true,
    };
  }
  if (webrtc === "disconnected") {
    return {
      kind: "reconnecting",
      label: "Connection lost",
      detail: "The link to the processing pipeline dropped.",
      stalePicture: true,
    };
  }

  // webrtc === "connected" from here.

  // A backgrounded tab is throttled by the browser, so silence is expected
  // and reporting a fault would be wrong. The picture is stale in the
  // literal sense, but nobody is looking at it.
  if (hidden) {
    return {
      kind: "live",
      label: "Live",
      detail: "Tracking shots.",
      stalePicture: false,
    };
  }

  // The camera's own clock stopping is a different failure from telemetry
  // stopping, and the more likely one on a propped phone that locks its
  // screen. It is named separately because the fix is different.
  if (videoStalled) {
    return {
      kind: "reconnecting",
      label: "Camera paused",
      detail: "The camera stopped sending frames. Wake the device to resume.",
      stalePicture: true,
    };
  }

  if (telemetryStale) {
    return {
      kind: "reconnecting",
      label: "Waiting for frames",
      detail: "Connected, but the pipeline has stopped sending results.",
      stalePicture: true,
    };
  }

  return { kind: "live", label: "Live", detail: "Tracking shots.", stalePicture: false };
}
