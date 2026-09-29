/**
 * Wire schema for the per-frame telemetry the C++ detection pipeline
 * produces. The same schema arrives two ways:
 *
 *  - live, one JSON message per frame from `follow_through_webrtc` over
 *    the WebRTC DataChannel, driving the real-time canvas overlay; and
 *  - stored, as the JSONL that `follow_through_batch_gpu` writes for an
 *    uploaded video, which the backend keeps and serves back from
 *    `GET /videos/{id}/telemetry` for playback and for the charts.
 *
 * Field shapes mirror the C++ `build_frame_json` / shot-event emitters
 * exactly (see cpp/follow-through-webrtc.cpp and
 * cpp/follow-through-batch.cpp). Coordinates arrive in the source frame's
 * own pixel space (frame_width/frame_height), not the overlay canvas's.
 */

export interface OverlayBox {
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
}

export interface BallBox extends OverlayBox {
  center_x: number | null;
  center_y: number | null;
  predicted?: boolean;
}

export interface OverlayPoint {
  x: number;
  y: number;
  valid: boolean;
}

export interface PoseKeypoints {
  left_shoulder?: OverlayPoint | null;
  right_shoulder?: OverlayPoint | null;
  left_elbow?: OverlayPoint | null;
  right_elbow?: OverlayPoint | null;
  left_wrist?: OverlayPoint | null;
  right_wrist?: OverlayPoint | null;
}

export interface ApexPoint {
  x: number;
  y: number;
}

/**
 * Distance-from-rim shot bands (feet): LAY_UP < 5 · CLS_RNG 5–10 ·
 * MID_RNG 10–19.9 · HS_3PT 19.9–21.9 · NCAA_3PT 22–22.9 · NBA_3PT >= 23.
 */
export type ShotDesignation = "LAY_UP" | "CLS_RNG" | "MID_RNG" | "HS_3PT" | "NCAA_3PT" | "NBA_3PT";

export interface FrameTelemetry {
  type: "frame";
  frame_id: number;
  frame_width: number;
  frame_height: number;
  potential_shot: boolean;
  shot_started: boolean;
  ball: BallBox | null;
  player: OverlayBox | null;
  rim: OverlayBox | null;
  net: OverlayBox | null;
  /** Only present on frames where calibration actually changed (~every 10 frames). */
  court_keypoints?: OverlayPoint[];
  pose: PoseKeypoints | null;
  trail_frozen_at_rim: boolean;
  apex_point: ApexPoint | null;
  player_distance_ft: number | null;
  player_speed_mph: number | null;
  player_stat_is_projected: boolean;
  shot_designation: ShotDesignation | null;
  time_to_apex: number | null;
  shot_duration: number | null;
  shot_distance_ft: number | null;
}

export interface ShotEventMessage {
  type: "shot_event";
  frame_id: number;
  result: "make" | "miss";
  reason?: string;
  makes: number;
  misses: number;
  shot_designation: ShotDesignation | null;
  /**
   * The shooter's position at release, in feet on a rim-centred frame
   * (positive x to one side of the rim, positive y away from the baseline).
   * This is court space, not pixels -- unlike every other coordinate in this
   * file.
   *
   * <p>Null when the court had not calibrated or the shooter was not
   * detected at release. Consumers must treat that as "not plottable"; the
   * previous behaviour of substituting the rim position put every shot on
   * the same spot.
   *
   * <p>Optional because recordings produced before this field existed are
   * still replayed.
   */
  court_x?: number | null;
  court_y?: number | null;
  /**
   * The three shot metrics, measured for this shot.
   *
   * <p>They were carried on `frame` messages first, which meant a
   * consumer had to keep the most recent non-null of each and hope
   * none belonged to the previous attempt. Emitting them on the event
   * itself makes a shot self-contained.
   *
   * <p>Optional, because a recording made before the pipeline emitted
   * them is still replayed -- a consumer should fall back to the
   * frame-carried values and then to "not recorded".
   */
  shot_distance?: number | null;
  shot_duration?: number | null;
  time_to_apex?: number | null;
}

export type OverlayTelemetryMessage = FrameTelemetry | ShotEventMessage;

/** The RTCPeerConnection/signaling-relay lifecycle. */
export type WebRTCConnectionState =
  | "idle"
  | "connecting-relay"
  | "waiting-for-viewer"
  | "connected"
  /** A session was established and dropped; a retry is scheduled or in
   * flight. Distinct from "disconnected", which is now terminal. */
  | "reconnecting"
  | "disconnected"
  | "failed";

/** Signaling messages relayed verbatim between master and viewer. Shape
 * matches KVS's serializeSessionDescriptionInit/deserializeSessionDescriptionInit
 * exactly — do not change without also changing the C++ side. */
export type SignalingMessage =
  | { type: "ready" }
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice-candidate"; candidate: RTCIceCandidateInit };
