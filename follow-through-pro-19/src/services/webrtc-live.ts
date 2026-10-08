/**
 * WebRTC master connection to `follow_through_webrtc`.
 *
 * Sends the local camera to the backend over a local signaling relay
 * (`js/mock-websocket.js` — the AWS-free stand-in for KVS's
 * SignalingClient) and receives per-frame overlay telemetry back on a
 * DataChannel. Two gotchas are load-bearing; preserve them exactly when
 * touching this file:
 *
 *  - The offer is sent only once the relay forwards a "ready" message from
 *    the viewer, not as soon as our own socket opens. The viewer (a native
 *    C++ process) can finish connecting to the relay before we do, so a
 *    one-shot send-on-open would broadcast into an empty room and be lost.
 *    `sendOffer` is idempotent so a repeated "ready" is harmless.
 *  - Telemetry arrives on the DataChannel the backend creates itself
 *    (`pc.ondatachannel`), never on the one we create here. The one we
 *    create exists only for symmetry; do not attach a message listener to
 *    it expecting telemetry.
 *
 * Sending anything from the browser back over the DataChannel is a known,
 * unresolved dead end on the C++ side — this session never attempts it.
 *
 * The pipeline used to answer exactly one offer per process, so a dropped
 * session could never be recovered without restarting it. That limit has
 * been removed on the C++ side (see cpp/README.md), which is what makes the
 * retry loop here worth having.
 */

import { signalingConfig } from "@/config/streaming";
import {
  attemptTimeoutMs,
  MAX_ATTEMPTS,
  retryDelayMs,
  STABLE_AFTER_MS,
} from "@/services/webrtc-backoff";
import type {
  OverlayTelemetryMessage,
  SignalingMessage,
  WebRTCConnectionState,
} from "@/types/overlay-telemetry";

export type OverlayTelemetryListener = (message: OverlayTelemetryMessage) => void;

/**
 * One connection attempt and everything it owns.
 *
 * <p>Grouping them means teardown is a single operation that cannot leave a
 * listener attached to a half-dead socket.
 */
interface Attempt {
  readonly generation: number;
  readonly ws: WebSocket;
  readonly pc: RTCPeerConnection;
  /** Aborting removes every listener registered with its signal. */
  readonly abort: AbortController;
  offerState: "none" | "creating" | "sent";
  pendingRemoteCandidates: RTCIceCandidateInit[];
  pendingLocalCandidates: RTCIceCandidateInit[];
  /** Serialises signalling handlers so they cannot interleave. */
  queue: Promise<void>;
  disposed: boolean;
}
export type WebRTCStateListener = (state: WebRTCConnectionState, detail: string) => void;

/**
 * What the browser's encoder is doing with the camera track, from the
 * sender's `outbound-rtp` statistics. `encodeMsPerFrame` is the mean
 * encode time between two readings, so it needs a previous sample.
 */
export interface EncoderStats {
  /** The browser's name for its encoder: a hardware one on a phone
   * (VideoToolbox, MediaCodec, ExternalEncoder), OpenH264 when software. */
  implementation: string | null;
  codec: string | null;
  width: number | null;
  height: number | null;
  framesPerSecond: number | null;
  /** Mean milliseconds the encoder spent per frame since the previous sample. */
  encodeMsPerFrame: number | null;
  /** "none" when the encoder keeps the requested resolution and rate;
   * "cpu" or "bandwidth" when WebRTC is cutting one of them. */
  qualityLimitation: string | null;
}

/** One line for the live page's HUD: "MediaCodec · 3840×2160 · 60 fps · 4.1 ms/frame".
 * Parts the browser has not reported yet are left out. */
export function describeEncoderStats(encoder: EncoderStats): string {
  const parts: string[] = [];
  if (encoder.implementation) parts.push(encoder.implementation);
  if (encoder.width && encoder.height) parts.push(`${encoder.width}×${encoder.height}`);
  if (encoder.framesPerSecond != null) parts.push(`${Math.round(encoder.framesPerSecond)} fps`);
  if (encoder.encodeMsPerFrame != null)
    parts.push(`${encoder.encodeMsPerFrame.toFixed(1)} ms/frame`);
  if (encoder.qualityLimitation && encoder.qualityLimitation !== "none") {
    parts.push(`${encoder.qualityLimitation}-limited`);
  }
  return parts.join(" · ");
}

/** The upload bit-rate cap. WebRTC's default is a few megabits, which is
 * far too low for 4K60 and makes it downscale silently; 40 Mbit/s keeps 4K
 * intact on a LAN and leaves the real limit to be the encoder. */
const MAX_VIDEO_BITRATE_BPS = 40_000_000;

/**
 * Pure: the encoder statistics from a stats report, given the previous
 * report's counters so a per-frame encode time can be formed.
 */
export function parseEncoderStats(
  report: Iterable<Record<string, unknown>>,
  previous: { totalEncodeTime: number; framesEncoded: number } | null,
): { stats: EncoderStats; counters: { totalEncodeTime: number; framesEncoded: number } } | null {
  let outbound: Record<string, unknown> | null = null;
  const codecs = new Map<string, string>();
  for (const entry of report) {
    if (entry["type"] === "outbound-rtp" && entry["kind"] === "video") outbound = entry;
    if (
      entry["type"] === "codec" &&
      typeof entry["id"] === "string" &&
      typeof entry["mimeType"] === "string"
    ) {
      codecs.set(entry["id"], entry["mimeType"]);
    }
  }
  if (!outbound) return null;
  const num = (key: string) =>
    typeof outbound![key] === "number" ? (outbound![key] as number) : null;
  const totalEncodeTime = num("totalEncodeTime") ?? 0;
  const framesEncoded = num("framesEncoded") ?? 0;
  const deltaFrames = previous ? framesEncoded - previous.framesEncoded : 0;
  const encodeMsPerFrame =
    previous && deltaFrames > 0
      ? Math.round(((1000 * (totalEncodeTime - previous.totalEncodeTime)) / deltaFrames) * 100) /
        100
      : null;
  const codecId = typeof outbound["codecId"] === "string" ? outbound["codecId"] : null;
  return {
    stats: {
      implementation:
        typeof outbound["encoderImplementation"] === "string"
          ? outbound["encoderImplementation"]
          : null,
      codec: codecId ? (codecs.get(codecId) ?? null) : null,
      width: num("frameWidth"),
      height: num("frameHeight"),
      framesPerSecond: num("framesPerSecond"),
      encodeMsPerFrame,
      qualityLimitation:
        typeof outbound["qualityLimitationReason"] === "string"
          ? outbound["qualityLimitationReason"]
          : null,
    },
    counters: { totalEncodeTime, framesEncoded },
  };
}

export class WebRTCLiveSession {
  private state: WebRTCConnectionState = "idle";
  private lastDetail = "";
  /**
   * Monotonic. Every attempt captures its value, and anything holding an
   * older one is stale by definition. This is what makes a superseded
   * attempt unable to affect the current one, rather than relying on each
   * handler to remember to check.
   */
  private generation = 0;
  private attempt: Attempt | null = null;
  private retryCount = 0;
  private localStream: MediaStream | null = null;
  /** Set by disconnect(), so a socket closing during teardown is not
   * mistaken for a drop worth retrying. */
  private intentionallyClosed = false;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private stableTimerId: ReturnType<typeof setTimeout> | null = null;
  private readonly telemetryListeners = new Set<OverlayTelemetryListener>();
  /**
   * Telemetry that arrived before anything was listening.
   *
   * <p>`connect()` is called before React has committed the subscription, so
   * without this the opening messages are dropped. That is not a cosmetic
   * loss: `applyFrame` is an incremental accumulator and `court_keypoints`
   * are only sent when they change, so one dropped early frame means the
   * court skeleton is missing for the rest of the session.
   *
   * <p>Capped because a session that never attaches a listener must not grow
   * without bound; the cap is generous enough to cover a commit (a couple of
   * seconds at ~30fps would be ~60 messages) and old entries are the ones
   * dropped, since the newest state is what matters most.
   */
  private static readonly TELEMETRY_BUFFER_MAX = 120;
  private telemetryBuffer: OverlayTelemetryMessage[] = [];
  private readonly stateListeners = new Set<WebRTCStateListener>();

  constructor(private readonly relayUrl: string = signalingConfig.relayUrl) {}

  getState() {
    return this.state;
  }

  /**
   * Round-trip time in milliseconds from the selected ICE candidate pair, or
   * null when it is not yet known.
   *
   * <p>Read-only, and deliberately the *only* stats surface exposed. Note
   * there is no inbound video track to measure — the backend returns JSON
   * over a DataChannel, not pixels — so the usual `inbound-rtp` frame stats
   * do not exist here. Candidate-pair RTT is the honest measure of link
   * latency, and frame rate is derived from telemetry arrival instead.
   */
  private encoderCounters: { totalEncodeTime: number; framesEncoded: number } | null = null;

  /**
   * The browser encoder's current behaviour, or null before the connection
   * is up or when the browser exposes no outbound video statistics. Call it
   * periodically: the per-frame encode time is a mean between two calls.
   */
  async readEncoderStats(): Promise<EncoderStats | null> {
    const pc = this.attempt?.pc;
    if (!pc || pc.connectionState !== "connected") return null;
    try {
      const report = await pc.getStats();
      const entries: Record<string, unknown>[] = [];
      report.forEach((entry: RTCStats) =>
        entries.push(entry as unknown as Record<string, unknown>),
      );
      const parsed = parseEncoderStats(entries, this.encoderCounters);
      if (!parsed) return null;
      this.encoderCounters = parsed.counters;
      return parsed.stats;
    } catch {
      return null;
    }
  }

  async readRoundTripTimeMs(): Promise<number | null> {
    const pc = this.attempt?.pc;
    if (!pc || pc.connectionState !== "connected") return null;
    try {
      const report = await pc.getStats();
      let rtt: number | null = null;
      report.forEach((entry: RTCStats) => {
        if (
          entry.type === "candidate-pair" &&
          (entry as RTCIceCandidatePairStats).state === "succeeded" &&
          typeof (entry as RTCIceCandidatePairStats).currentRoundTripTime === "number"
        ) {
          const seconds = (entry as RTCIceCandidatePairStats).currentRoundTripTime as number;
          rtt = Math.round(seconds * 1000);
        }
      });
      return rtt;
    } catch {
      // Stats are diagnostic; never let them affect the session.
      return null;
    }
  }

  onTelemetry(listener: OverlayTelemetryListener) {
    this.telemetryListeners.add(listener);

    // Replay to *every* subscriber that arrives before the first live
    // message, in arrival order, so each accumulator sees the sequence it
    // would have seen live.
    //
    // Not just the first subscriber: three things subscribe here — the
    // canvas renderer, the health monitor and the score — and they mount
    // in the same commit. Draining on first subscribe handed the backlog
    // to whichever effect happened to run first, which could leave the
    // canvas without the court keypoints it only receives once. That it
    // worked at all depended on React running child effects before parent
    // ones, which is not something this class should rely on.
    if (this.telemetryBuffer.length > 0) {
      for (const message of [...this.telemetryBuffer]) listener(message);
    }

    return () => this.telemetryListeners.delete(listener) as unknown as void;
  }

  onStateChange(listener: WebRTCStateListener) {
    this.stateListeners.add(listener);
    listener(this.state, "");
    return () => this.stateListeners.delete(listener) as unknown as void;
  }

  /**
   * Starts a session and keeps it up.
   *
   * <p>Each attempt owns its socket, peer connection and listeners as one
   * {@link Attempt}. Disposing an attempt aborts its `AbortSignal`, which
   * physically removes every listener it registered — a disposed attempt
   * cannot deliver an event at all. That replaces the previous arrangement
   * where a closing socket's handler could still fire and mark the *new*
   * session disconnected, which is what made a quick stop/start report a
   * false failure.
   *
   * <p>`AbortSignal` cannot cancel a promise already in flight, so every
   * `await` is followed by a generation check as well. The two guards cover
   * different failure modes and both are needed.
   */
  connect(localStream: MediaStream) {
    this.teardown();
    this.retryCount = 0;
    this.localStream = localStream;
    this.openAttempt();
  }

  disconnect() {
    this.intentionallyClosed = true;
    this.teardown();
    this.localStream = null;
    this.setState("idle", "Session ended.");
  }

  private openAttempt() {
    const stream = this.localStream;
    if (!stream) return;

    this.intentionallyClosed = false;
    const generation = ++this.generation;
    const abort = new AbortController();
    const { signal } = abort;

    const ws = new WebSocket(this.relayUrl);
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    const attempt: Attempt = {
      generation,
      ws,
      pc,
      abort,
      offerState: "none",
      pendingRemoteCandidates: [],
      pendingLocalCandidates: [],
      queue: Promise.resolve(),
      disposed: false,
    };
    this.attempt = attempt;

    this.setState(
      this.retryCount === 0 ? "connecting-relay" : "reconnecting",
      this.retryCount === 0
        ? "Connecting to the processing pipeline."
        : `Reconnecting (attempt ${this.retryCount} of ${MAX_ATTEMPTS}).`,
    );

    this.armTimeout(attempt);

    ws.addEventListener(
      "open",
      () => {
        if (this.isStale(attempt)) return;
        // Candidates gathered before the socket opened would otherwise be
        // dropped, and a lost candidate can mean a connection that never
        // establishes with nothing to show for it.
        this.flushLocalCandidates(attempt);
        if (this.retryCount === 0) {
          this.setState("waiting-for-viewer", "Waiting for the processing pipeline.");
        }
      },
      { signal },
    );

    ws.addEventListener(
      "error",
      () => {
        if (this.isStale(attempt)) return;
        this.failAttempt(attempt, "Cannot reach the signaling relay.");
      },
      { signal },
    );

    ws.addEventListener(
      "close",
      () => {
        if (this.isStale(attempt)) return;
        this.failAttempt(attempt, "The signaling relay closed the connection.");
      },
      { signal },
    );

    stream.getTracks().forEach((track) => this.addLocalTrack(pc, track, stream));

    pc.addEventListener(
      "connectionstatechange",
      () => {
        if (this.isStale(attempt)) return;
        if (pc.connectionState === "connected") {
          this.onConnected(attempt);
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed" ||
          pc.connectionState === "disconnected"
        ) {
          this.failAttempt(attempt, `The connection ${pc.connectionState}.`);
        }
      },
      { signal },
    );

    pc.addEventListener(
      "icecandidate",
      (event) => {
        if (this.isStale(attempt) || !event.candidate) return;
        const candidate = event.candidate.toJSON();
        if (ws.readyState === WebSocket.OPEN) {
          this.send(ws, { type: "ice-candidate", candidate });
        } else {
          attempt.pendingLocalCandidates.push(candidate);
        }
      },
      { signal },
    );

    // Created for symmetry with the backend; the backend's own channel is
    // what actually carries telemetry.
    pc.createDataChannel("telemetry");

    pc.addEventListener(
      "datachannel",
      (event) => {
        if (this.isStale(attempt)) return;
        event.channel.addEventListener(
          "message",
          (e: MessageEvent<string>) => {
            if (this.isStale(attempt)) return;
            this.deliverTelemetry(e.data);
          },
          { signal },
        );
      },
      { signal },
    );

    ws.addEventListener(
      "message",
      (event: MessageEvent<string>) => {
        if (this.isStale(attempt)) return;
        // Serialised: two messages arriving back to back could otherwise
        // interleave setRemoteDescription with addIceCandidate. One chain
        // also gives every handler a single catch site, so a rejection can
        // no longer go unhandled and hang the session until the timeout.
        attempt.queue = attempt.queue
          .then(() => this.handleSignalingMessage(attempt, event.data))
          .catch(() => this.failAttempt(attempt, "The pipeline sent something unusable."));
      },
      { signal },
    );
  }

  /**
   * Adds the camera track with the sender configured for the research
   * setting rather than for a video call: H.264 first, because that is the
   * codec every phone encodes in hardware (VP8/VP9 are often software
   * there); a bit-rate cap high enough that 4K is not silently downscaled;
   * and resolution held under load, so a frame rate that falls is visible
   * as such instead of being hidden by a smaller picture. Everything here is
   * optional API, feature-detected, so an older browser (or the test
   * environment) falls back to a plain addTrack.
   */
  private addLocalTrack(pc: RTCPeerConnection, track: MediaStreamTrack, stream: MediaStream) {
    if (track.kind !== "video" || typeof pc.addTransceiver !== "function") {
      pc.addTrack(track, stream);
      return;
    }
    const transceiver = pc.addTransceiver(track, {
      direction: "sendonly",
      streams: [stream],
      sendEncodings: [{ maxBitrate: MAX_VIDEO_BITRATE_BPS }],
    });
    try {
      const capabilities = RTCRtpSender.getCapabilities?.("video");
      if (capabilities && typeof transceiver.setCodecPreferences === "function") {
        const h264 = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() === "video/h264");
        const others = capabilities.codecs.filter((c) => c.mimeType.toLowerCase() !== "video/h264");
        if (h264.length > 0) transceiver.setCodecPreferences([...h264, ...others]);
      }
    } catch {
      // Codec preference is an optimisation; the backend decodes whatever is negotiated.
    }
    try {
      const params = transceiver.sender.getParameters();
      params.degradationPreference = "maintain-resolution";
      if (params.encodings.length > 0) params.encodings[0]!.maxBitrate = MAX_VIDEO_BITRATE_BPS;
      void transceiver.sender.setParameters(params).catch(() => undefined);
    } catch {
      // Same: best effort.
    }
  }

  private deliverTelemetry(raw: string) {
    let parsed: OverlayTelemetryMessage;
    try {
      parsed = JSON.parse(raw) as OverlayTelemetryMessage;
    } catch {
      return; // a partial or malformed message is not worth failing over
    }
    if (this.telemetryListeners.size === 0) {
      this.telemetryBuffer.push(parsed);
      if (this.telemetryBuffer.length > WebRTCLiveSession.TELEMETRY_BUFFER_MAX) {
        this.telemetryBuffer.shift();
      }
      return;
    }
    // Something is listening now, so the backlog has done its job. Anyone
    // subscribing after this point is asking for what happens next, not
    // for history.
    if (this.telemetryBuffer.length > 0) this.telemetryBuffer = [];
    this.telemetryListeners.forEach((listener) => listener(parsed));
  }

  private onConnected(attempt: Attempt) {
    this.clearTimer();
    this.setState("connected", "Tracking shots.");

    // The retry budget is restored only once the link has actually held.
    // Clearing it on every "connected" would let a flapping connection
    // retry indefinitely, because each brief success would reset the
    // backoff before it had grown.
    this.stableTimerId = setTimeout(() => {
      if (!this.isStale(attempt)) this.retryCount = 0;
    }, STABLE_AFTER_MS);
  }

  private armTimeout(attempt: Attempt) {
    this.clearTimer();
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.failAttempt(attempt, "The processing pipeline did not respond.");
    }, attemptTimeoutMs(this.retryCount));
  }

  /**
   * Ends this attempt and schedules the next, or gives up.
   *
   * <p>Idempotent per attempt: several listeners can observe the same
   * failure (the socket closing *and* the peer connection failing), and
   * only the first should count against the retry budget.
   */
  private failAttempt(attempt: Attempt, detail: string) {
    if (this.isStale(attempt) || this.intentionallyClosed) return;
    this.disposeAttempt(attempt);

    const nextAttempt = this.retryCount + 1;
    const delay = retryDelayMs(nextAttempt);

    if (delay === null) {
      this.setState(
        "failed",
        `${detail} Reconnecting did not help — end the session and start it again.`,
      );
      return;
    }

    this.retryCount = nextAttempt;
    this.setState("reconnecting", `${detail} Retrying.`);
    this.timerId = setTimeout(() => {
      this.timerId = null;
      this.openAttempt();
    }, delay);
  }

  private async handleSignalingMessage(attempt: Attempt, raw: string) {
    let msg: SignalingMessage;
    try {
      msg = JSON.parse(raw) as SignalingMessage;
    } catch {
      return;
    }

    if (msg.type === "ready") {
      await this.sendOffer(attempt);
    } else if (msg.type === "answer") {
      await attempt.pc.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp: msg.sdp }),
      );
      if (this.isStale(attempt)) return;
      await this.flushRemoteCandidates(attempt);
    } else if (msg.type === "ice-candidate") {
      // A candidate that arrives before the answer cannot be added yet.
      // The relay broadcasts, so that ordering is not guaranteed, and
      // silently dropping one can mean a connection that never completes.
      if (attempt.pc.remoteDescription === null) {
        attempt.pendingRemoteCandidates.push(msg.candidate);
        return;
      }
      await this.addIceCandidate(attempt, msg.candidate);
    }
  }

  private async sendOffer(attempt: Attempt) {
    // Three states, not a boolean: the previous code latched a flag before
    // awaiting createOffer(), so a failure there left it permanently set
    // and no later "ready" could ever retry.
    if (attempt.offerState !== "none") return;
    attempt.offerState = "creating";
    try {
      const offer = await attempt.pc.createOffer();
      if (this.isStale(attempt)) return;
      await attempt.pc.setLocalDescription(offer);
      if (this.isStale(attempt)) return;
      if (offer.sdp) this.send(attempt.ws, { type: "offer", sdp: offer.sdp });
      attempt.offerState = "sent";
    } catch {
      // Reset rather than fail the attempt. The pipeline beacons "ready"
      // every second, so the cheapest recovery is to let the next one try
      // again on the same connection; the attempt timeout is the backstop
      // if it never succeeds. This is the whole reason offerState is three
      // states and not the boolean it used to be -- that latched true
      // before the await and could never be retried.
      attempt.offerState = "none";
    }
  }

  private async flushRemoteCandidates(attempt: Attempt) {
    const pending = attempt.pendingRemoteCandidates;
    attempt.pendingRemoteCandidates = [];
    await Promise.allSettled(pending.map((c) => this.addIceCandidate(attempt, c)));
  }

  private flushLocalCandidates(attempt: Attempt) {
    const pending = attempt.pendingLocalCandidates;
    attempt.pendingLocalCandidates = [];
    for (const candidate of pending) {
      if (attempt.ws.readyState === WebSocket.OPEN) {
        this.send(attempt.ws, { type: "ice-candidate", candidate });
      }
    }
  }

  private async addIceCandidate(attempt: Attempt, candidate: RTCIceCandidateInit) {
    try {
      await attempt.pc.addIceCandidate(candidate);
    } catch {
      // A late or duplicate candidate is non-fatal and must not fail the
      // attempt, which is why this is swallowed here rather than by the
      // queue's catch.
    }
  }

  /** True once this attempt has been superseded or disposed. */
  private isStale(attempt: Attempt) {
    return attempt.disposed || attempt.generation !== this.generation;
  }

  private disposeAttempt(attempt: Attempt) {
    attempt.disposed = true;
    attempt.abort.abort();
    try {
      attempt.pc.close();
    } catch {
      /* already closed */
    }
    try {
      attempt.ws.close();
    } catch {
      /* already closed */
    }
    if (this.attempt === attempt) this.attempt = null;
  }

  private teardown() {
    this.generation++;
    if (this.attempt) this.disposeAttempt(this.attempt);
    this.clearTimer();
    // A buffer left over from the previous session would replay into the
    // next one's first subscriber with frames from a different session.
    this.telemetryBuffer = [];
  }

  private clearTimer() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.stableTimerId) {
      clearTimeout(this.stableTimerId);
      this.stableTimerId = null;
    }
  }

  private send(ws: WebSocket, message: SignalingMessage) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  private setState(next: WebRTCConnectionState, detail: string) {
    // Compare the detail too. Consecutive retries are all "reconnecting"
    // but carry a different attempt number, and comparing only the state
    // would silently drop every update after the first.
    if (this.state === next && this.lastDetail === detail) return;
    this.state = next;
    this.lastDetail = detail;
    this.stateListeners.forEach((listener) => listener(next, detail));
  }
}
