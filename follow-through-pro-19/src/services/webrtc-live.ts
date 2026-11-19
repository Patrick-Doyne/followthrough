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

import { LIVE_CAPTURE, signalingConfig } from "@/config/streaming";
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
  /** Periodic diagnostics while connected (reportStats). */
  statsTimer: ReturnType<typeof setInterval> | null;
  /** The delay control's pacing (controlRate). */
  rateTimer: ReturnType<typeof setInterval> | null;
  /** The video sender, for the delay control to cap. */
  videoSender: RTCRtpSender | null;
  /** The delay control's state. */
  sendCapKbps: number;
  cleanChecks: number;
  /** The lowest round trip seen on this link, the delay control's baseline. */
  rttFloorMs: number | null;
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

/** One line for the live page's HUD: "MediaCodec · 1280×720 · 60 fps · 4.1 ms/frame".
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

/** The upload bit-rate cap, start and floor for one captured size. */
export interface BitrateEnvelope {
  maxBps: number;
  /** The same cap in kbit/s, the unit the SDP and the delay control use. */
  maxKbps: number;
  startKbps: number;
  minKbps: number;
}

/** The cap at 3840x2160, scaled down with the captured area. WebRTC's
 * default cap is a few megabits, which makes a large picture downscale
 * silently; this keeps the picture intact on a LAN and leaves the real
 * limit to be the encoder. It is scaled rather than fixed because a phone
 * encoder given a 40 Mbit/s target for 720p spends it on nothing and stalls
 * on the bursts. */
const BITRATE_AT_4K_BPS = 40_000_000;
const PIXELS_AT_4K = 3840 * 2160;
const BITRATE_FLOOR_BPS = 2_500_000;
/** Where a session starts sending and the least it may send, in kbit/s,
 * whatever the capture size.
 *
 * The floor is the rate a session runs at. The backend sends none of the
 * feedback the sender's estimator grows on, so the estimate only ever
 * falls, and it reaches the floor within ten seconds of connecting even
 * on a loss-free LAN (measured: 2000, 1280, 800 at a round trip of 0 ms).
 * So the floor is chosen as the rate the worst link in use carries: a
 * phone's cellular uplink at a court, which at 4.4 Mbit/s pinned queued
 * five seconds of round trip and lost frames by the dozen, and carries
 * about 1 Mbit/s cleanly. At that rate the encoder, told to keep its
 * frame rate (addLocalTrack), sends 30 fps at about 960x540; the detector
 * letterboxes every frame to 640 pixels and sees no difference. */
const START_KBPS = 2_000;
const MIN_KBPS = 1_000;

/**
 * The sender's own delay control, since the backend offers none.
 *
 * Browsers back a sender off on packet loss, and off delay only with the
 * transport feedback the KVS SDK does not send. A cellular uplink rarely
 * drops packets: it queues them, and a queue is invisible to a loss-based
 * controller until it is seconds deep -- which is exactly what the court
 * logs show, a round trip climbing from 40 ms to 9 s while the sender
 * reported no loss. So the session measures the round trip itself every
 * two seconds and caps the encoder on how far it has risen above the
 * lowest round trip seen on this link: a queue is delay that grows, while
 * a cellular link's own latency can sit at 600 ms with nothing queued
 * (measured, and a first version that cut on the absolute value starved
 * the picture to 360x640 for no gain). Cut when the rise passes 200 ms,
 * climb back gently once it has stayed under 80 ms for three checks,
 * never below 800 kbit/s -- below that the picture is too small for the
 * detector to be worth sending -- and never above the envelope. The
 * encoder is set to keep its frame rate, so a cut shrinks the picture and
 * the frames keep coming.
 */
const RATE_CONTROL_INTERVAL_MS = 2_000;
const RATE_CONTROL_RISE_HIGH_MS = 200;
const RATE_CONTROL_RISE_LOW_MS = 80;
const RATE_CONTROL_CUT = 0.75;
const RATE_CONTROL_CLIMB = 1.25;
const RATE_CONTROL_CLEAN_CHECKS = 3;
const RATE_CONTROL_MIN_KBPS = 800;

/** Pure: the next cap in kbit/s given the current one, the round trip and
 * the lowest round trip seen so far on this link. */
export function nextSendCapKbps(
  capKbps: number,
  rttMs: number | null,
  baselineMs: number | null,
  cleanChecks: number,
  maxKbps: number,
): { capKbps: number; cleanChecks: number } {
  if (rttMs === null || baselineMs === null) return { capKbps, cleanChecks };
  const rise = rttMs - baselineMs;
  if (rise > RATE_CONTROL_RISE_HIGH_MS) {
    return {
      capKbps: Math.max(RATE_CONTROL_MIN_KBPS, Math.round(capKbps * RATE_CONTROL_CUT)),
      cleanChecks: 0,
    };
  }
  if (rise < RATE_CONTROL_RISE_LOW_MS) {
    const clean = cleanChecks + 1;
    if (clean >= RATE_CONTROL_CLEAN_CHECKS && capKbps < maxKbps) {
      return {
        capKbps: Math.min(maxKbps, Math.round(capKbps * RATE_CONTROL_CLIMB)),
        cleanChecks: 0,
      };
    }
    return { capKbps, cleanChecks: clean };
  }
  return { capKbps, cleanChecks: 0 };
}

/**
 * The envelope for a captured size: the cap scaled to the picture, a start
 * a cellular uplink can carry and a floor the encoder can still keep its
 * frame rate at once it is told to shrink the picture rather than skip
 * frames (addLocalTrack). The C++ backend receives through the KVS
 * WebRTC C SDK, which sends none of the feedback Chromium uses to grow its
 * estimate from the 300 kbit/s it starts at; left alone, the sender stays at
 * the floor forever and the picture arrives tiny. These become Chromium's SDP knobs for
 * exactly that case, ignored by browsers that lack them. An unknown size
 * takes the live capture policy's.
 */
export function bitrateEnvelope(width: number, height: number): BitrateEnvelope {
  const pixels =
    width > 0 && height > 0 ? width * height : LIVE_CAPTURE.width * LIVE_CAPTURE.height;
  const scaled = Math.round((BITRATE_AT_4K_BPS * pixels) / PIXELS_AT_4K);
  const maxBps = Math.min(BITRATE_AT_4K_BPS, Math.max(BITRATE_FLOOR_BPS, scaled));
  const maxKbps = Math.round(maxBps / 1000);
  return {
    maxBps,
    maxKbps,
    startKbps: Math.min(maxKbps, START_KBPS),
    minKbps: Math.min(maxKbps, MIN_KBPS),
  };
}

/** How often a connected session reports its statistics to the relay's log,
 * and how soon after connecting the first report goes. */
const DIAGNOSTIC_INTERVAL_MS = 5_000;
const DIAGNOSTIC_FIRST_AFTER_MS = 1_500;
const DIAGNOSTIC_BACKLOG_MAX = 20;

/** Counters from the previous statistics report, for rates. */
export interface StatsCounters {
  at: number;
  bytesSent: number;
}

function statNumber(entry: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = entry?.[key];
  return typeof value === "number" ? value : null;
}

function statString(entry: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = entry?.[key];
  return typeof value === "string" ? value : null;
}

function describeCandidateEntry(entry: Record<string, unknown> | undefined): string {
  if (!entry) return "?";
  const type = statString(entry, "candidateType") ?? "?";
  const protocol = statString(entry, "protocol") ?? "";
  const address = statString(entry, "address") ?? statString(entry, "ip") ?? "?";
  const port = statNumber(entry, "port") ?? "?";
  return `${type} ${protocol} ${address}:${port}`.replace(/\s+/g, " ");
}

/** One ICE candidate as "host udp 10.0.0.2:51234", from the browser's object. */
export function describeCandidate(candidate: RTCIceCandidate): string {
  const type = candidate.type ?? "?";
  const protocol = candidate.protocol ?? "";
  const address = candidate.address ?? "?";
  const port = candidate.port ?? "?";
  return `${type} ${protocol} ${address}:${port}`.replace(/\s+/g, " ");
}

/** The same for a candidate that came over signaling, from its SDP line. */
export function describeCandidateInit(candidate: RTCIceCandidateInit): string {
  const line = candidate.candidate ?? "";
  const fields = line.replace(/^candidate:/, "").split(" ");
  const type = /typ (\S+)/.exec(line)?.[1] ?? "?";
  return `${type} ${(fields[2] ?? "").toLowerCase()} ${fields[4] ?? "?"}:${fields[5] ?? "?"}`.replace(
    /\s+/g,
    " ",
  );
}

/**
 * Pure: one line summarising a getStats() report for the relay's log -- the
 * selected candidate pair (the path the media takes, with its round-trip time
 * and the sender's bandwidth estimate), what the encoder is sending (frames,
 * rate since the previous report, size, frame rate, what limits it) and what
 * the backend's receiver reports back (loss). Every field is optional: Safari
 * and Chromium expose different subsets.
 */
export function summariseStats(
  entries: Iterable<Record<string, unknown>>,
  previous: StatsCounters | null,
  now: number,
): { line: string; counters: StatsCounters | null } {
  const byId = new Map<string, Record<string, unknown>>();
  let outbound: Record<string, unknown> | null = null;
  let remoteInbound: Record<string, unknown> | null = null;
  let transport: Record<string, unknown> | null = null;
  const pairs: Record<string, unknown>[] = [];
  for (const entry of entries) {
    const id = statString(entry, "id");
    if (id) byId.set(id, entry);
    const kind = statString(entry, "kind") ?? statString(entry, "mediaType");
    switch (entry["type"]) {
      case "outbound-rtp":
        if (kind === "video" || outbound === null) outbound = entry;
        break;
      case "remote-inbound-rtp":
        if (kind === "video" || remoteInbound === null) remoteInbound = entry;
        break;
      case "transport":
        transport = entry;
        break;
      case "candidate-pair":
        pairs.push(entry);
        break;
    }
  }

  const parts: string[] = [];

  const selectedId = statString(transport, "selectedCandidatePairId");
  const selected =
    pairs.find((pair) => statString(pair, "id") === selectedId) ??
    pairs.find((pair) => pair["nominated"] === true && pair["state"] === "succeeded") ??
    pairs.find((pair) => pair["state"] === "succeeded") ??
    null;
  if (selected) {
    const local = byId.get(statString(selected, "localCandidateId") ?? "");
    const remote = byId.get(statString(selected, "remoteCandidateId") ?? "");
    parts.push(`path ${describeCandidateEntry(local)} -> ${describeCandidateEntry(remote)}`);
    const rtt = statNumber(selected, "currentRoundTripTime");
    if (rtt !== null) parts.push(`rtt ${Math.round(rtt * 1000)} ms`);
    const estimate = statNumber(selected, "availableOutgoingBitrate");
    if (estimate !== null) parts.push(`estimate ${Math.round(estimate / 1000)} kbit/s`);
    const requests = statNumber(selected, "requestsSent");
    const responses = statNumber(selected, "responsesReceived");
    if (requests !== null && responses !== null) parts.push(`checks ${responses}/${requests}`);
  } else {
    parts.push("path none");
  }

  if (outbound) {
    const frames = statNumber(outbound, "framesSent") ?? statNumber(outbound, "framesEncoded");
    parts.push(`sent ${frames ?? "?"} frames`);
    const bytes = statNumber(outbound, "bytesSent");
    if (previous && bytes !== null && now > previous.at) {
      parts.push(`${Math.round(((bytes - previous.bytesSent) * 8) / (now - previous.at))} kbit/s`);
    }
    const width = statNumber(outbound, "frameWidth");
    const height = statNumber(outbound, "frameHeight");
    if (width && height) parts.push(`${width}x${height}`);
    const fps = statNumber(outbound, "framesPerSecond");
    if (fps !== null) parts.push(`${Math.round(fps)} fps`);
    const target = statNumber(outbound, "targetBitrate");
    if (target !== null) parts.push(`target ${Math.round(target / 1000)} kbit/s`);
    const limitation = statString(outbound, "qualityLimitationReason");
    if (limitation && limitation !== "none") parts.push(`limited by ${limitation}`);
    const implementation = statString(outbound, "encoderImplementation");
    if (implementation) parts.push(implementation);
    const nacks = statNumber(outbound, "nackCount");
    if (nacks) parts.push(`nack ${nacks}`);
    const plis = statNumber(outbound, "pliCount");
    if (plis) parts.push(`pli ${plis}`);
  } else {
    parts.push("no outbound video statistics");
  }

  if (remoteInbound) {
    const reported: string[] = [];
    const lost = statNumber(remoteInbound, "packetsLost");
    if (lost !== null) reported.push(`lost ${lost}`);
    const fraction = statNumber(remoteInbound, "fractionLost");
    if (fraction !== null) reported.push(`loss ${(fraction * 100).toFixed(1)}%`);
    const rtt = statNumber(remoteInbound, "roundTripTime");
    if (rtt !== null) reported.push(`rtt ${Math.round(rtt * 1000)} ms`);
    if (reported.length > 0) parts.push(`backend reports ${reported.join(" ")}`);
  }

  const bytesSent = statNumber(outbound, "bytesSent");
  const counters = bytesSent !== null ? { at: now, bytesSent } : null;
  return { line: parts.join(" · "), counters };
}

/**
 * Pure: the SDP with the video bit-rate knobs set, for both our offer and the
 * backend's answer (Chromium reads them from either). Adds `b=AS` to each
 * video section and the `x-google-*-bitrate` parameters to every H.264
 * format line; lines that already carry them are left alone.
 */
export function tuneVideoSdp(sdp: string, bitrate: BitrateEnvelope): string {
  const { maxKbps } = bitrate;
  const lines = sdp.split(/\r?\n/);
  const out: string[] = [];
  let inVideo = false;
  for (const line of lines) {
    if (line.startsWith("m=")) inVideo = line.startsWith("m=video");
    if (
      inVideo &&
      line.startsWith("a=fmtp:") &&
      /profile-level-id=/i.test(line) &&
      !/x-google-start-bitrate/.test(line)
    ) {
      out.push(
        `${line};x-google-start-bitrate=${bitrate.startKbps};x-google-min-bitrate=${bitrate.minKbps};x-google-max-bitrate=${maxKbps}`,
      );
      continue;
    }
    out.push(line);
    if (line.startsWith("m=video") && !lines.some((l) => l.startsWith("b=AS:")))
      out.push(`b=AS:${maxKbps}`);
  }
  return out.join("\r\n");
}

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
  /** The envelope for the stream being sent; set from the camera track's
   * settings when an attempt opens. */
  private bitrate: BitrateEnvelope = bitrateEnvelope(0, 0);
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
  /** Diagnostics reported before a relay socket was open (see report). */
  private diagnosticBacklog: string[] = [];
  private statsCounters: StatsCounters | null = null;
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
      statsTimer: null,
      rateTimer: null,
      videoSender: null,
      sendCapKbps: 0,
      cleanChecks: 0,
      rttFloorMs: null,
    };
    this.attempt = attempt;
    this.statsCounters = null;

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
        this.flushDiagnostics(attempt);
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

    const settings = stream.getVideoTracks?.()[0]?.getSettings?.();
    this.bitrate = bitrateEnvelope(settings?.width ?? 0, settings?.height ?? 0);
    attempt.sendCapKbps = this.bitrate.maxKbps;
    this.report(
      `bitrate cap ${this.bitrate.maxKbps} kbit/s, start ${this.bitrate.startKbps}, floor ${this.bitrate.minKbps}`,
    );
    stream.getTracks().forEach((track) => this.addLocalTrack(attempt, pc, track, stream));

    pc.addEventListener(
      "iceconnectionstatechange",
      () => {
        if (!this.isStale(attempt)) this.report(`ice ${pc.iceConnectionState}`);
      },
      { signal },
    );

    pc.addEventListener(
      "connectionstatechange",
      () => {
        if (this.isStale(attempt)) return;
        this.report(`connection ${pc.connectionState}`);
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
        this.report(`local candidate ${describeCandidate(event.candidate)}`);
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
   * there); a bit-rate cap sized to the capture so the picture is not
   * silently downscaled (bitrateEnvelope);
   * and frame rate held under load, so a poor link shrinks the picture
   * rather than thinning the frames the detector needs. Everything here is
   * optional API, feature-detected, so an older browser (or the test
   * environment) falls back to a plain addTrack.
   */
  private addLocalTrack(
    attempt: Attempt,
    pc: RTCPeerConnection,
    track: MediaStreamTrack,
    stream: MediaStream,
  ) {
    if (track.kind !== "video" || typeof pc.addTransceiver !== "function") {
      pc.addTrack(track, stream);
      return;
    }
    const transceiver = pc.addTransceiver(track, {
      direction: "sendonly",
      streams: [stream],
      sendEncodings: [{ maxBitrate: this.bitrate.maxBps }],
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
      // Frame rate over resolution: when the link cannot carry the rate,
      // the encoder sends a smaller picture at the full rate rather than a
      // full picture at a few frames a second. The detector works on a
      // 640-pixel letterbox of the frame, so a smaller picture costs it
      // little; a missing frame costs the shot.
      params.degradationPreference = "maintain-framerate";
      if (params.encodings.length > 0) params.encodings[0]!.maxBitrate = this.bitrate.maxBps;
      void transceiver.sender.setParameters(params).catch(() => undefined);
      attempt.videoSender = transceiver.sender;
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

    if (attempt.statsTimer === null) {
      attempt.statsTimer = setInterval(
        () => void this.reportStats(attempt),
        DIAGNOSTIC_INTERVAL_MS,
      );
      setTimeout(() => void this.reportStats(attempt), DIAGNOSTIC_FIRST_AFTER_MS);
    }
    if (attempt.rateTimer === null && attempt.videoSender) {
      attempt.rateTimer = setInterval(
        () => void this.controlRate(attempt),
        RATE_CONTROL_INTERVAL_MS,
      );
    }

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
    this.report(`attempt ${this.retryCount + 1} failed: ${detail}`);
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
        new RTCSessionDescription({ type: "answer", sdp: tuneVideoSdp(msg.sdp, this.bitrate) }),
      );
      if (this.isStale(attempt)) return;
      await this.flushRemoteCandidates(attempt);
    } else if (msg.type === "ice-candidate") {
      this.report(`remote candidate ${describeCandidateInit(msg.candidate)}`);
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
      const created = await attempt.pc.createOffer();
      if (this.isStale(attempt)) return;
      const offer = created.sdp
        ? { type: created.type, sdp: tuneVideoSdp(created.sdp, this.bitrate) }
        : created;
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
    if (attempt.statsTimer !== null) {
      clearInterval(attempt.statsTimer);
      attempt.statsTimer = null;
    }
    if (attempt.rateTimer !== null) {
      clearInterval(attempt.rateTimer);
      attempt.rateTimer = null;
    }
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

  /**
   * Sends one line of phone-side diagnostics to the relay's log (see
   * src/lib/live-diagnostics.ts). Lines reported before the relay socket is
   * open wait for it, a few of them, so what went wrong while connecting is
   * not lost either.
   */
  report(detail: string) {
    const line = `${new Date().toISOString()} ${detail}`;
    const ws = this.attempt?.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.send(ws, { type: "diagnostic", detail: line });
    } else if (this.diagnosticBacklog.length < DIAGNOSTIC_BACKLOG_MAX) {
      this.diagnosticBacklog.push(line);
    }
  }

  private flushDiagnostics(attempt: Attempt) {
    const waiting = this.diagnosticBacklog;
    this.diagnosticBacklog = [];
    for (const line of waiting) this.send(attempt.ws, { type: "diagnostic", detail: line });
  }

  /** One step of the delay control (see RATE_CONTROL_INTERVAL_MS). */
  private async controlRate(attempt: Attempt) {
    if (this.isStale(attempt) || attempt.pc.connectionState !== "connected") return;
    const sender = attempt.videoSender;
    if (!sender) return;
    const rtt = await this.readRoundTripTimeMs();
    if (rtt !== null && (attempt.rttFloorMs === null || rtt < attempt.rttFloorMs)) {
      attempt.rttFloorMs = rtt;
    }
    const { maxKbps } = this.bitrate;
    const next = nextSendCapKbps(
      attempt.sendCapKbps,
      rtt,
      attempt.rttFloorMs,
      attempt.cleanChecks,
      maxKbps,
    );
    attempt.cleanChecks = next.cleanChecks;
    if (next.capKbps === attempt.sendCapKbps) return;
    try {
      const params = sender.getParameters();
      if (params.encodings.length === 0) return;
      params.encodings[0]!.maxBitrate = next.capKbps * 1000;
      await sender.setParameters(params);
      const was = attempt.sendCapKbps;
      attempt.sendCapKbps = next.capKbps;
      this.report(
        `rate cap ${was} -> ${next.capKbps} kbit/s (rtt ${rtt} ms, link floor ${attempt.rttFloorMs} ms)`,
      );
    } catch {
      // Best effort: the encoder keeps its current cap.
    }
  }

  /** What the browser is sending and over which path, from getStats(). */
  private async reportStats(attempt: Attempt) {
    if (this.isStale(attempt) || attempt.pc.connectionState !== "connected") return;
    try {
      const report = await attempt.pc.getStats();
      const entries: Record<string, unknown>[] = [];
      report.forEach((entry: RTCStats) =>
        entries.push(entry as unknown as Record<string, unknown>),
      );
      const summary = summariseStats(entries, this.statsCounters, Date.now());
      this.statsCounters = summary.counters;
      this.report(summary.line);
    } catch (err) {
      this.report(`stats unavailable: ${String(err)}`);
    }
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
