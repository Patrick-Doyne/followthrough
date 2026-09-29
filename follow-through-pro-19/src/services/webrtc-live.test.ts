import { describe, expect, it } from "vitest";

import { WebRTCLiveSession } from "@/services/webrtc-live";
import type { OverlayTelemetryMessage } from "@/types/overlay-telemetry";

/**
 * Tests for the telemetry replay buffer only.
 *
 * <p>The transport itself is not testable here: `vitest.config.ts` runs in a
 * node environment with no `WebSocket` and no `RTCPeerConnection`. The buffer
 * is the part that is pure bookkeeping, and it is also the part that silently
 * loses data when it is wrong, so it is worth testing on its own.
 *
 * <p>The private members are reached through a cast rather than by standing up
 * a peer connection. That is deliberate: the alternative is no coverage at all
 * for a mechanism whose failure mode is an invisibly incomplete overlay.
 */
interface BufferInternals {
  telemetryBuffer: OverlayTelemetryMessage[];
  telemetryListeners: Set<(m: OverlayTelemetryMessage) => void>;
  deliverTelemetry: (raw: string) => void;
}

function internals(session: WebRTCLiveSession): BufferInternals {
  return session as unknown as BufferInternals;
}

/**
 * Feeds a message through the real delivery path.
 *
 * <p>Calls the production method rather than restating what it does. An
 * earlier version of this helper reimplemented the buffering rules, which
 * meant the test kept passing after the real rules changed — the failure
 * mode a hand-written double is supposed to prevent, not cause.
 */
function deliver(session: WebRTCLiveSession, message: OverlayTelemetryMessage) {
  internals(session).deliverTelemetry(JSON.stringify(message));
}

function frame(id: number): OverlayTelemetryMessage {
  return { type: "frame", frame_id: id } as OverlayTelemetryMessage;
}

describe("telemetry replay buffer", () => {
  it("replays messages that arrived before anything subscribed", () => {
    // This is the real bug it exists for: connect() runs before React has
    // committed the subscription, and court_keypoints are only sent when they
    // change, so a dropped early frame is lost for the whole session.
    const session = new WebRTCLiveSession("ws://unused");
    deliver(session, frame(1));
    deliver(session, frame(2));

    const seen: number[] = [];
    session.onTelemetry((m) => seen.push((m as { frame_id: number }).frame_id));

    expect(seen).toEqual([1, 2]);
  });

  it("preserves arrival order", () => {
    const session = new WebRTCLiveSession("ws://unused");
    for (const id of [5, 6, 7, 8]) deliver(session, frame(id));

    const seen: number[] = [];
    session.onTelemetry((m) => seen.push((m as { frame_id: number }).frame_id));

    expect(seen).toEqual([5, 6, 7, 8]);
  });

  it("replays to every subscriber that mounts before the first live message", () => {
    // The canvas renderer, the health monitor and the score all subscribe,
    // in the same commit. Handing the backlog to only the first meant
    // whichever effect ran first won it, and the canvas could be left
    // without the court keypoints it receives only once.
    const session = new WebRTCLiveSession("ws://unused");
    deliver(session, frame(1));

    const drawing: number[] = [];
    session.onTelemetry((m) => drawing.push((m as { frame_id: number }).frame_id));
    const health: number[] = [];
    session.onTelemetry((m) => health.push((m as { frame_id: number }).frame_id));

    expect(drawing).toEqual([1]);
    expect(health).toEqual([1]);
  });

  it("stops replaying once a live message has been delivered", () => {
    const session = new WebRTCLiveSession("ws://unused");
    deliver(session, frame(1));

    const first: number[] = [];
    session.onTelemetry((m) => first.push((m as { frame_id: number }).frame_id));
    expect(first).toEqual([1]);

    // A live message means the backlog has served its purpose.
    deliver(session, frame(2));

    const late: number[] = [];
    session.onTelemetry((m) => late.push((m as { frame_id: number }).frame_id));
    expect(late).toEqual([]);

    deliver(session, frame(3));
    expect(first).toEqual([1, 2, 3]);
    expect(late).toEqual([3]);
  });

  it("caps the buffer and drops the oldest, not the newest", () => {
    // A session that never attaches a listener must not grow without bound,
    // and the newest state is the more useful half to keep.
    const session = new WebRTCLiveSession("ws://unused");
    for (let id = 0; id < 200; id++) deliver(session, frame(id));

    const seen: number[] = [];
    session.onTelemetry((m) => seen.push((m as { frame_id: number }).frame_id));

    expect(seen).toHaveLength(120);
    expect(seen[0]).toBe(80);
    expect(seen[seen.length - 1]).toBe(199);
  });

  it("does not replay anything when nothing was buffered", () => {
    const session = new WebRTCLiveSession("ws://unused");
    const seen: number[] = [];
    session.onTelemetry((m) => seen.push((m as { frame_id: number }).frame_id));
    expect(seen).toEqual([]);
  });

  it("clears the buffer on disconnect", () => {
    // Otherwise the previous session's frames replay into the next session's
    // accumulator, which is worse than losing them.
    const session = new WebRTCLiveSession("ws://unused");
    deliver(session, frame(1));
    session.disconnect();

    const seen: number[] = [];
    session.onTelemetry((m) => seen.push((m as { frame_id: number }).frame_id));
    expect(seen).toEqual([]);
  });
});
