import { describe, expect, it } from "vitest";

import { mergeSessionShots, shotsFromTelemetry } from "@/lib/telemetry-shots";
import type { Shot, VideoTelemetryResponse } from "@/types/telemetry";

const CONTEXT = {
  videoId: "video-001",
  sessionId: "session-001",
  startedAt: "2026-08-11T17:00:00.000Z",
};

const shotEvent = (over: Record<string, unknown> = {}) => ({
  type: "shot_event",
  frame_id: 300,
  result: "make",
  makes: 1,
  misses: 0,
  shot_designation: "MID_RNG",
  court_x: 3,
  court_y: 12,
  shot_distance: 12.4,
  shot_duration: 0.93,
  time_to_apex: 0.57,
  ...over,
});

const telemetry = (messages: unknown[], fps = 30): VideoTelemetryResponse => ({ fps, messages });

describe("shotsFromTelemetry", () => {
  it("reads a shot straight off the processing output", () => {
    const { shots } = shotsFromTelemetry(telemetry([shotEvent()]), CONTEXT);
    expect(shots).toHaveLength(1);
    const shot = shots[0]!;
    expect(shot.result).toBe("MAKE");
    expect(shot.shotDistance).toBe(12.4);
    expect(shot.shotDuration).toBe(0.93);
    expect(shot.timeToApex).toBe(0.57);
    expect(shot.location).toBeDefined();
    expect(shot.zone).toBeDefined();
  });

  it("converts frames to seconds, which is what a playhead is in", () => {
    const { shots } = shotsFromTelemetry(telemetry([shotEvent({ frame_id: 900 })], 30), CONTEXT);
    expect(shots[0]?.videoOffset).toBe(30);
    const at60 = shotsFromTelemetry(telemetry([shotEvent({ frame_id: 900 })], 60), CONTEXT);
    expect(at60.shots[0]?.videoOffset).toBe(15);
  });

  it("falls back to 30fps rather than stacking every shot at zero", () => {
    const { shots } = shotsFromTelemetry(telemetry([shotEvent({ frame_id: 300 })], 0), CONTEXT);
    expect(shots[0]?.videoOffset).toBe(10);
  });

  it("ignores everything that is not a decided shot", () => {
    const { shots } = shotsFromTelemetry(
      telemetry([
        { type: "metadata", fps: 30 },
        { type: "frame", frame_id: 1 },
        shotEvent(),
        { type: "shot_event", result: "unknown" },
      ]),
      CONTEXT,
    );
    expect(shots).toHaveLength(1);
  });

  it("numbers shots in the order they were decided", () => {
    const { shots } = shotsFromTelemetry(
      telemetry([shotEvent({ frame_id: 100 }), shotEvent({ frame_id: 900, result: "miss" })]),
      CONTEXT,
    );
    expect(shots.map((s) => s.shotNumber)).toEqual([1, 2]);
    expect(shots.map((s) => s.result)).toEqual(["MAKE", "MISS"]);
  });

  it("trusts the pipeline's own totals over counting the array", () => {
    // It counted every attempt it decided, including any this reader
    // could not parse.
    const { makes, misses } = shotsFromTelemetry(
      telemetry([shotEvent({ makes: 7, misses: 5 })]),
      CONTEXT,
    );
    expect(makes).toBe(7);
    expect(misses).toBe(5);
  });

  describe("when the pipeline could not measure something", () => {
    it("keeps a shot with no court position, and counts it as unplaced", () => {
      // Dropping it would take it out of the running totals; parking
      // it at the rim is the bug that stacked every shot on one spot.
      const { shots, unplaced } = shotsFromTelemetry(
        telemetry([shotEvent({ court_x: null, court_y: null, shot_distance: null })]),
        CONTEXT,
      );
      expect(shots).toHaveLength(1);
      expect(unplaced).toBe(1);
      expect(shots[0]?.location).toBeUndefined();
      expect(shots[0]?.zone).toBeUndefined();
    });

    it("derives the distance from the release position when it was not reported", () => {
      const { shots } = shotsFromTelemetry(
        telemetry([shotEvent({ shot_distance: null, court_x: 3, court_y: 4 })]),
        CONTEXT,
      );
      expect(shots[0]?.shotDistance).toBe(5);
    });

    it("leaves unreported timings at zero rather than guessing", () => {
      const { shots } = shotsFromTelemetry(
        telemetry([shotEvent({ shot_duration: null, time_to_apex: null })]),
        CONTEXT,
      );
      expect(shots[0]?.shotDuration).toBe(0);
      expect(shots[0]?.timeToApex).toBe(0);
    });

    it("classifies the shot type from distance when there is no designation", () => {
      const { shots } = shotsFromTelemetry(
        telemetry([shotEvent({ shot_designation: null, shot_distance: 3 })]),
        CONTEXT,
      );
      expect(shots[0]?.shotType).toBe("LAY_UP");
    });
  });

  it("is empty for a run that decided nothing", () => {
    expect(shotsFromTelemetry(telemetry([{ type: "metadata", fps: 30 }]), CONTEXT).shots).toEqual(
      [],
    );
  });
});

describe("mergeSessionShots", () => {
  const shot = (id: string, timestamp: string, n: number): Shot =>
    ({ shotId: id, shotNumber: n, timestamp, result: "MAKE" }) as Shot;

  it("renumbers across the session so two videos do not both start at one", () => {
    const merged = mergeSessionShots([
      [shot("a1", "2026-08-11T17:00:10Z", 1), shot("a2", "2026-08-11T17:00:40Z", 2)],
      [shot("b1", "2026-08-11T18:00:10Z", 1)],
    ]);
    expect(merged.map((s) => s.shotNumber)).toEqual([1, 2, 3]);
    expect(merged.map((s) => s.shotId)).toEqual(["a1", "a2", "b1"]);
  });

  it("orders by when the shot happened, not by which file it came from", () => {
    // A session recorded in two halves should read in the order it
    // was played, whichever order the files come back in.
    const merged = mergeSessionShots([
      [shot("late", "2026-08-11T18:00:00Z", 1)],
      [shot("early", "2026-08-11T17:00:00Z", 1)],
    ]);
    expect(merged.map((s) => s.shotId)).toEqual(["early", "late"]);
  });

  it("is empty for a session with no telemetry at all", () => {
    expect(mergeSessionShots([])).toEqual([]);
    expect(mergeSessionShots([[], []])).toEqual([]);
  });
});

describe("shotsFromTelemetry: metrics carried on frame records", () => {
  const context = { videoId: "video-1", sessionId: "session-1", startedAt: "2026-07-12T10:00:00Z" };

  /** A frame record as follow-through-batch.cpp writes one. Note
   * `shot_distance_ft`, which the shot event spells `shot_distance`. */
  const frame = (
    frameId: number,
    metrics: { duration?: number | null; apex?: number | null; distance?: number | null } = {},
  ) => ({
    type: "frame",
    frame_id: frameId,
    shot_duration: metrics.duration ?? null,
    time_to_apex: metrics.apex ?? null,
    shot_distance_ft: metrics.distance ?? null,
  });

  /** A shot event from a build that predates attach_shot_metrics: it
   * carries the result and the court position and nothing else. */
  const oldEvent = (frameId: number, result: "make" | "miss") => ({
    type: "shot_event",
    frame_id: frameId,
    result,
    makes: result === "make" ? 1 : 0,
    misses: result === "miss" ? 1 : 0,
    court_x: 3,
    court_y: 12,
  });

  it("recovers the timings from the frames when the event has none", () => {
    // This is the case that left a whole library's Release tab blank: the
    // clip was processed before the pipeline attached metrics to the event.
    const { shots } = shotsFromTelemetry(
      {
        fps: 30,
        messages: [
          frame(100, { apex: 0.55 }),
          oldEvent(130, "make"),
          frame(130, { duration: 1.1, apex: 0.55, distance: 18.4 }),
        ],
      } as never,
      context,
    );
    expect(shots).toHaveLength(1);
    expect(shots[0]?.shotDuration).toBeCloseTo(1.1);
    expect(shots[0]?.timeToApex).toBeCloseTo(0.55);
    expect(shots[0]?.shotDistance).toBeCloseTo(18.4);
  });

  it("prefers the event's apex and distance over the frames", () => {
    const { shots } = shotsFromTelemetry(
      {
        fps: 30,
        messages: [
          { ...oldEvent(130, "make"), time_to_apex: 0.5, shot_distance: 22 },
          frame(130, { apex: 0.55, distance: 18.4 }),
        ],
      } as never,
      context,
    );
    expect(shots[0]?.timeToApex).toBeCloseTo(0.5);
    expect(shots[0]?.shotDistance).toBeCloseTo(22);
  });

  it("prefers the FRAME's duration over the event's, which is measured late", () => {
    // The one field where the event is the worse source. A make is written
    // six settle frames after the ball clears the rim, and older builds
    // measured the duration to that frame -- inflating makes only, which
    // drags their time-to-apex ratio down and fakes a link between a flat
    // arc and a make. The frame record measures to shot_end_frame.
    const { shots } = shotsFromTelemetry(
      {
        fps: 30,
        messages: [
          { ...oldEvent(136, "make"), shot_duration: 1.3 },
          frame(136, { duration: 1.1, apex: 0.66 }),
        ],
      } as never,
      context,
    );
    expect(shots[0]?.shotDuration).toBeCloseTo(1.1);
    // And so the arc ratio is the true one, not the depressed one.
    expect(shots[0]!.timeToApex / shots[0]!.shotDuration).toBeCloseTo(0.6);
  });

  it("never takes the next shot's duration for a shot that has none", () => {
    // The reason the forward search is bounded. Shot one ends without a
    // duration ever being written; shot two's must not be borrowed.
    const { shots } = shotsFromTelemetry(
      {
        fps: 30,
        messages: [
          oldEvent(100, "miss"),
          frame(150, { apex: 0.5 }),
          oldEvent(200, "make"),
          frame(200, { duration: 1.4, apex: 0.7, distance: 25 }),
        ],
      } as never,
      context,
    );
    expect(shots).toHaveLength(2);
    expect(shots[0]?.shotDuration).toBe(0);
    expect(shots[1]?.shotDuration).toBeCloseTo(1.4);
  });

  it("looks backward for a value set before the event was written", () => {
    // time_to_apex is assigned mid-flight, so it can already be on a frame
    // that precedes the shot event.
    const { shots } = shotsFromTelemetry(
      { fps: 30, messages: [frame(90, { apex: 0.6 }), oldEvent(120, "make")] } as never,
      context,
    );
    expect(shots[0]?.timeToApex).toBeCloseTo(0.6);
  });

  it("does not reach back past the previous shot", () => {
    const { shots } = shotsFromTelemetry(
      {
        fps: 30,
        messages: [
          frame(10, { apex: 0.9, duration: 2, distance: 30 }),
          oldEvent(50, "make"),
          oldEvent(200, "miss"),
        ],
      } as never,
      context,
    );
    // The second shot may not inherit the first shot's frame values.
    expect(shots[1]?.timeToApex).toBe(0);
    expect(shots[1]?.shotDuration).toBe(0);
  });

  it("still falls back to the court position when no frame carries a distance", () => {
    const { shots } = shotsFromTelemetry(
      { fps: 30, messages: [oldEvent(120, "make")] } as never,
      context,
    );
    expect(shots[0]?.shotDistance).toBeGreaterThan(0);
  });

  it("leaves a genuinely unmeasured shot at zero rather than inventing one", () => {
    const { shots } = shotsFromTelemetry(
      { fps: 30, messages: [frame(120), oldEvent(120, "miss")] } as never,
      context,
    );
    expect(shots[0]?.shotDuration).toBe(0);
    expect(shots[0]?.timeToApex).toBe(0);
  });
});
