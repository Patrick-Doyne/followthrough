import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_ATTEMPTS } from "@/services/webrtc-backoff";
import { WebRTCLiveSession } from "@/services/webrtc-live";
import type { WebRTCConnectionState } from "@/types/overlay-telemetry";

/**
 * The reconnection state machine, driven through injected fakes.
 *
 * <p>`vitest` runs in node, so there is no real `WebSocket` or
 * `RTCPeerConnection` and the transport cannot be exercised. The state
 * machine can: generation handling, offer state, candidate ordering and the
 * retry budget are where every bug in this file lived, and all of them are
 * reachable with stubs. Each test below names the specific defect it pins.
 */

type Listener = (event: unknown) => void;

class FakeTarget {
  listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, fn: Listener, options?: { signal?: AbortSignal }) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
    // The real contract: aborting the signal removes the listener. The
    // production code depends on this to make a superseded attempt inert.
    options?.signal?.addEventListener("abort", () => set.delete(fn));
  }
  emit(type: string, event: unknown = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
  }
  countFor(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeWebSocket extends FakeTarget {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  sentTypes() {
    return this.sent.map((s) => (JSON.parse(s) as { type: string }).type);
  }
  deliver(message: unknown) {
    this.emit("message", { data: JSON.stringify(message) });
  }
}

class FakePeerConnection extends FakeTarget {
  static instances: FakePeerConnection[] = [];
  static failCreateOffer = false;
  static failSetRemote = false;
  connectionState = "new";
  remoteDescription: unknown = null;
  addedCandidates: unknown[] = [];
  closed = false;
  constructor() {
    super();
    FakePeerConnection.instances.push(this);
  }
  addTrack() {}
  createDataChannel() {
    return new FakeTarget();
  }
  async createOffer() {
    if (FakePeerConnection.failCreateOffer) throw new Error("createOffer blew up");
    return { type: "offer", sdp: "fake-sdp" };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    if (FakePeerConnection.failSetRemote) throw new Error("bad answer");
    this.remoteDescription = { type: "answer" };
  }
  async addIceCandidate(c: unknown) {
    this.addedCandidates.push(c);
  }
  async getStats() {
    return new Map();
  }
  close() {
    this.closed = true;
  }
  becomeConnected() {
    this.connectionState = "connected";
    this.emit("connectionstatechange");
  }
  drop(state = "failed") {
    this.connectionState = state;
    this.emit("connectionstatechange");
  }
}

const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  FakePeerConnection.instances = [];
  FakePeerConnection.failCreateOffer = false;
  FakePeerConnection.failSetRemote = false;
  g["WebSocket"] = FakeWebSocket;
  g["RTCPeerConnection"] = FakePeerConnection;
  g["RTCSessionDescription"] = class {
    constructor(public init: unknown) {}
  };
});

afterEach(() => {
  vi.useRealTimers();
});

function start() {
  const session = new WebRTCLiveSession("ws://relay");
  const states: WebRTCConnectionState[] = [];
  session.onStateChange((s) => states.push(s));
  session.connect({ getTracks: () => [] } as unknown as MediaStream);
  return { session, states };
}

const latestWs = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
const latestPc = () => FakePeerConnection.instances[FakePeerConnection.instances.length - 1]!;

/** Lets queued signalling promises settle without advancing timers. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("stale attempts cannot affect the current one", () => {
  it("a superseded socket closing does not mark the new session down", async () => {
    // The original bug: close/error handlers captured `this`, not the
    // socket generation, so a quick stop then start had the OLD socket's
    // close event mark the NEW session disconnected.
    const { session, states } = start();
    const firstWs = latestWs();

    session.disconnect();
    session.connect({ getTracks: () => [] } as unknown as MediaStream);
    const secondWs = latestWs();
    expect(secondWs).not.toBe(firstWs);

    states.length = 0;
    firstWs.emit("close");
    await settle();

    expect(states).not.toContain("reconnecting");
    expect(states).not.toContain("failed");
  });

  it("aborting an attempt physically removes its listeners", () => {
    // The structural guarantee, not just a guard inside each handler.
    const { session } = start();
    const ws = latestWs();
    expect(ws.countFor("message")).toBe(1);
    session.disconnect();
    expect(ws.countFor("message")).toBe(0);
  });
});

describe("offer state", () => {
  it("retries the offer on the next beacon after createOffer fails", async () => {
    // The original bug: `offerSent = true` was set BEFORE the await, so a
    // throwing createOffer() latched the flag and no later "ready" could
    // ever produce an offer.
    FakePeerConnection.failCreateOffer = true;
    start();
    latestWs().deliver({ type: "ready" });
    await settle();
    expect(latestWs().sentTypes()).not.toContain("offer");

    FakePeerConnection.failCreateOffer = false;
    latestWs().deliver({ type: "ready" });
    await settle();
    expect(latestWs().sentTypes()).toContain("offer");
  });

  it("sends only one offer for repeated ready messages", async () => {
    // The pipeline beacons "ready" once a second; answering each one would
    // renegotiate continuously.
    start();
    for (let i = 0; i < 4; i++) latestWs().deliver({ type: "ready" });
    await settle();
    expect(
      latestWs()
        .sentTypes()
        .filter((t) => t === "offer"),
    ).toHaveLength(1);
  });
});

describe("ICE candidate ordering", () => {
  it("buffers candidates that arrive before the answer, then applies them", async () => {
    // The relay broadcasts, so ordering is not guaranteed. Candidates were
    // previously discarded if they landed first, which can leave a
    // connection that never establishes and nothing to show for it.
    start();
    const ws = latestWs();
    ws.deliver({ type: "ready" });
    await settle();

    ws.deliver({ type: "ice-candidate", candidate: { candidate: "early-1" } });
    ws.deliver({ type: "ice-candidate", candidate: { candidate: "early-2" } });
    await settle();
    expect(latestPc().addedCandidates).toHaveLength(0);

    ws.deliver({ type: "answer", sdp: "answer-sdp" });
    await settle();
    expect(latestPc().addedCandidates).toHaveLength(2);
  });

  it("holds local candidates until the socket is open", async () => {
    start();
    const ws = latestWs();
    ws.readyState = 0; // still connecting
    latestPc().emit("icecandidate", { candidate: { toJSON: () => ({ candidate: "local-1" }) } });
    expect(ws.sentTypes()).not.toContain("ice-candidate");

    ws.readyState = 1;
    ws.emit("open");
    await settle();
    expect(ws.sentTypes()).toContain("ice-candidate");
  });
});

describe("retry budget", () => {
  it("retries with growing delays and eventually gives up", async () => {
    const { states } = start();
    latestPc().becomeConnected();
    await settle();
    expect(states).toContain("connected");

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      latestPc().drop("failed");
      await settle();
      await vi.advanceTimersByTimeAsync(15_000);
      await settle();
    }

    latestPc().drop("failed");
    await settle();
    // A spinner that never ends is worse than an honest failure.
    expect(states[states.length - 1]).toBe("failed");
  });

  it("does not retry after the session is ended deliberately", async () => {
    const { session } = start();
    latestPc().becomeConnected();
    await settle();
    const created = FakePeerConnection.instances.length;

    session.disconnect();
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();

    expect(FakePeerConnection.instances.length).toBe(created);
  });

  it("forgives the retry budget only after the link has held", async () => {
    // Resetting on every "connected" would let a flapping link retry
    // forever, because each brief success would clear the backoff.
    const { states } = start();
    latestPc().becomeConnected();
    await settle();

    // Drop again well before the stability window elapses.
    await vi.advanceTimersByTimeAsync(2_000);
    latestPc().drop("failed");
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();

    latestPc().becomeConnected();
    await settle();
    // Held this time.
    await vi.advanceTimersByTimeAsync(15_000);
    await settle();

    latestPc().drop("failed");
    await settle();
    expect(states).toContain("reconnecting");
    expect(states[states.length - 1]).not.toBe("failed");
  });
});

describe("failure handling", () => {
  it("fails the attempt instead of leaving a rejection unhandled", async () => {
    // Previously `void this.handleSignalingMessage(...)` had no catch, so a
    // bad payload hung the session until the connect timeout with nothing
    // reported.
    const { states } = start();
    latestWs().emit("message", { data: "{not json" });
    await settle();
    // Malformed JSON is tolerated, not fatal.
    expect(states).not.toContain("failed");

    // A genuinely unusable answer does fail the attempt, rather than
    // rejecting into nowhere and hanging until the timeout.
    FakePeerConnection.failSetRemote = true;
    latestWs().deliver({ type: "ready" });
    await settle();
    latestWs().deliver({ type: "answer", sdp: "unusable" });
    await settle();
    expect(states).toContain("reconnecting");
  });

  it("counts one failure when several listeners see the same drop", async () => {
    const { session } = start();
    latestPc().becomeConnected();
    await settle();
    const before = FakePeerConnection.instances.length;

    const ws = latestWs();
    const pc = latestPc();
    pc.drop("failed");
    ws.emit("close");
    ws.emit("error");
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    await settle();

    // Exactly one replacement attempt, not three.
    expect(FakePeerConnection.instances.length).toBe(before + 1);
    session.disconnect();
  });
});
