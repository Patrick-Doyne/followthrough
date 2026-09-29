import { describe, expect, it } from "vitest";

import { toPlottableShot, toRunningSeries } from "@/lib/live-shot";
import { COURT } from "@/services/court-geometry";
import type { LiveShot } from "@/hooks/use-live-score";

const base: LiveShot = {
  result: "make",
  designation: null,
  sequence: 1,
  at: Date.parse("2026-03-01T12:00:00Z"),
  location: { x: COURT.rim.x, y: COURT.rim.y },
  distanceFt: null,
  durationSeconds: null,
  timeToApexSeconds: null,
};

const make = (patch: Partial<LiveShot> = {}) => toPlottableShot({ ...base, ...patch }, "s1");

describe("toPlottableShot", () => {
  it("returns null for a shot the pipeline could not place", () => {
    expect(make({ location: null })).toBeNull();
  });

  it("uses the arrival time of that shot, not the current clock", () => {
    // Reading the clock at render time gave every shot one shared
    // timestamp that drifted whenever the list recomputed.
    const a = make({ sequence: 1, at: Date.parse("2026-03-01T12:00:00Z") })!;
    const b = make({ sequence: 2, at: Date.parse("2026-03-01T12:05:00Z") })!;
    expect(a.timestamp).toBe("2026-03-01T12:00:00.000Z");
    expect(b.timestamp).not.toBe(a.timestamp);
  });

  it("prefers the pipeline's distance", () => {
    expect(make({ distanceFt: 18.2 })!.shotDistance).toBe(18.2);
  });

  it("derives the shot type from the distance when unclassified", () => {
    // Previously hard-coded to MID_RNG, which mislabels a lay-up.
    expect(make({ distanceFt: 2 })!.shotType).toBe("LAY_UP");
    expect(make({ distanceFt: 25 })!.shotType).not.toBe("LAY_UP");
  });

  it("keeps the pipeline's own classification when it has one", () => {
    expect(make({ designation: "NBA_3PT", distanceFt: 2 })!.shotType).toBe("NBA_3PT");
  });

  it("classifies the zone from the position rather than defaulting", () => {
    expect(make({ location: { x: 0.4, y: 1 } })!.zone).toBe("CORNER_LEFT");
    expect(make({ location: { x: COURT.rim.x, y: COURT.rim.y } })!.zone).toBe("PAINT");
  });

  it("leaves unknown metrics at zero, which the UI renders as not recorded", () => {
    // Deliberate: a shot cannot take zero seconds and a detector does not
    // report zero confidence, so zero is unambiguous as "no value".
    const shot = make()!;
    expect(shot.shotDuration).toBe(0);
    expect(shot.timeToApex).toBe(0);
  });

  it("carries real metrics through when the pipeline reported them", () => {
    const shot = make({ durationSeconds: 0.94, timeToApexSeconds: 0.51 })!;
    expect(shot.shotDuration).toBe(0.94);
    expect(shot.timeToApex).toBe(0.51);
  });

  it("maps the result to the app's casing", () => {
    expect(make({ result: "make" })!.result).toBe("MAKE");
    expect(make({ result: "miss" })!.result).toBe("MISS");
  });

  it("gives each shot a stable id derived from its sequence", () => {
    expect(make({ sequence: 7 })!.shotId).toBe("live-7");
  });
});

describe("toRunningSeries", () => {
  const shot = (result: "make" | "miss", sequence: number): LiveShot => ({
    ...base,
    result,
    sequence,
  });

  it("accumulates in shooting order, not feed order", () => {
    // history is newest-first. Accumulating without reversing makes the
    // first plotted point the *last* shot's cumulative average, so the
    // line reads backwards — a wrong chart that still looks like a chart.
    const history = [shot("miss", 3), shot("make", 2), shot("make", 1)];
    const series = toRunningSeries(history);

    expect(series.map((p) => p.result)).toEqual(["MAKE", "MAKE", "MISS"]);
    expect(series.map((p) => p.percentage)).toEqual([100, 100, 66.7]);
  });

  it("numbers points from one", () => {
    expect(toRunningSeries([shot("make", 1)])[0]?.index).toBe(1);
  });

  it("is empty for no shots", () => {
    expect(toRunningSeries([])).toEqual([]);
  });

  it("carries real metrics and zeroes the unknown ones", () => {
    const series = toRunningSeries([
      { ...base, result: "make", sequence: 1, durationSeconds: 0.9, distanceFt: 17 },
    ]);
    expect(series[0]).toMatchObject({ shotDuration: 0.9, shotDistance: 17, timeToApex: 0 });
  });
});
