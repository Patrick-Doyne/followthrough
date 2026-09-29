import { describe, expect, it } from "vitest";

import {
  cursorBoundaries,
  isTakenBy,
  quantiseCursor,
  shotAt,
  progressSeries,
  splitByCursor,
  tallyAt,
  tallyOf,
} from "@/lib/shot-cursor";
import type { Shot } from "@/types/telemetry";

let n = 0;
const shot = (videoOffset: number | undefined, result: "MAKE" | "MISS" = "MAKE"): Shot =>
  ({
    shotId: `s${++n}`,
    sessionId: "session-001",
    shotNumber: n,
    timestamp: new Date().toISOString(),
    result,
    shotType: "MID_RNG",
    zone: "TOP_OF_KEY",
    shotDistance: 15,
    shotDuration: 0.9,
    timeToApex: 0.55,
    ...(videoOffset === undefined ? {} : { videoOffset }),
  }) as Shot;

describe("isTakenBy", () => {
  it("takes a shot once the playhead reaches it", () => {
    const s = shot(60);
    expect(isTakenBy(s, 59.9)).toBe(false);
    expect(isTakenBy(s, 60)).toBe(true);
    expect(isTakenBy(s, 61)).toBe(true);
  });

  it("counts a shot with no offset as taken", () => {
    // It is a real shot the pipeline could not place in time. Hiding
    // it would silently drop it from the totals.
    expect(isTakenBy(shot(undefined), 0)).toBe(true);
  });
});

describe("splitByCursor", () => {
  const shots = [shot(10, "MAKE"), shot(20, "MISS"), shot(30, "MAKE")];

  it("splits at the playhead and keeps the given order", () => {
    const { taken, upcoming } = splitByCursor(shots, 20);
    expect(taken.map((s) => s.videoOffset)).toEqual([10, 20]);
    expect(upcoming.map((s) => s.videoOffset)).toEqual([30]);
  });

  it("has everything upcoming before the session starts", () => {
    expect(splitByCursor(shots, 0).taken).toEqual([]);
  });

  it("has everything taken at the end", () => {
    expect(splitByCursor(shots, 9999).upcoming).toEqual([]);
  });

  it("gives back the same answer when the cursor moves backwards", () => {
    // The reason this derives rather than accumulates: scrubbing back
    // must un-take the shots that have been rewound past.
    const forward = splitByCursor(shots, 30).taken.length;
    expect(forward).toBe(3);
    expect(splitByCursor(shots, 15).taken.length).toBe(1);
  });
});

describe("tallyOf / tallyAt", () => {
  it("is zero rather than NaN with nothing attempted", () => {
    expect(tallyOf([])).toEqual({ attempts: 0, makes: 0, percentage: 0 });
  });

  it("counts only what has happened by the cursor", () => {
    const shots = [shot(10, "MAKE"), shot(20, "MISS"), shot(30, "MAKE"), shot(40, "MAKE")];
    expect(tallyAt(shots, 25)).toEqual({ attempts: 2, makes: 1, percentage: 50 });
    expect(tallyAt(shots, 9999)).toEqual({ attempts: 4, makes: 3, percentage: 75 });
  });
});

describe("shotAt", () => {
  const shots = [shot(10), shot(20), shot(21)];

  it("finds the shot the playhead is sitting on", () => {
    expect(shotAt(shots, 10.5)?.videoOffset).toBe(10);
  });

  it("does not look ahead", () => {
    expect(shotAt(shots, 9.9)).toBeNull();
  });

  it("lets go once the window has passed", () => {
    expect(shotAt(shots, 13.5)).toBeNull();
  });

  it("picks the closest when two are in range", () => {
    // 20 and 21 are both within 3s of 21.5; only one can be current.
    expect(shotAt(shots, 21.5)?.videoOffset).toBe(21);
  });

  it("ignores shots that have no offset", () => {
    expect(shotAt([shot(undefined)], 0)).toBeNull();
  });
});

describe("cursorBoundaries / quantiseCursor", () => {
  const shots = [shot(30), shot(10), shot(10), shot(20), shot(undefined)];

  it("is the sorted, de-duplicated set of offsets", () => {
    expect(cursorBoundaries(shots)).toEqual([10, 20, 30]);
  });

  it("quantises to the last boundary reached", () => {
    const boundaries = cursorBoundaries(shots);
    expect(quantiseCursor(0, boundaries)).toBe(-1);
    expect(quantiseCursor(9.9, boundaries)).toBe(-1);
    expect(quantiseCursor(10, boundaries)).toBe(10);
    expect(quantiseCursor(19.9, boundaries)).toBe(10);
    expect(quantiseCursor(25, boundaries)).toBe(20);
    expect(quantiseCursor(1000, boundaries)).toBe(30);
  });

  it("gives the same split as the raw cursor", () => {
    // The point of quantising: re-render once per shot, not per frame,
    // without changing the answer.
    const boundaries = cursorBoundaries(shots);
    for (const raw of [0, 5, 10, 15, 20, 25, 30, 45]) {
      expect(splitByCursor(shots, quantiseCursor(raw, boundaries)).taken.length).toBe(
        splitByCursor(shots, raw).taken.length,
      );
    }
  });
});

describe("progressSeries", () => {
  it("accumulates the percentage shot by shot", () => {
    const series = progressSeries([
      shot(10, "MAKE"),
      shot(20, "MISS"),
      shot(30, "MAKE"),
      shot(40, "MAKE"),
    ]);
    expect(series.map((p) => p.attempts)).toEqual([1, 2, 3, 4]);
    expect(series.map((p) => p.makes)).toEqual([1, 1, 2, 3]);
    expect(series.map((p) => Math.round(p.percentage))).toEqual([100, 50, 67, 75]);
  });

  it("orders by time, whatever order it was given", () => {
    const series = progressSeries([shot(30), shot(10), shot(20)]);
    expect(series.map((p) => p.at)).toEqual([10, 20, 30]);
  });

  it("drops shots that cannot be placed on a time axis", () => {
    // Putting them at zero would invent a run of attempts that never
    // happened at the start of the session.
    expect(progressSeries([shot(undefined), shot(10)]).map((p) => p.at)).toEqual([10]);
  });

  it("ends on the session's own percentage", () => {
    const shots = [shot(10, "MAKE"), shot(20, "MISS"), shot(30, "MAKE")];
    expect(progressSeries(shots).at(-1)?.percentage).toBeCloseTo(tallyOf(shots).percentage, 6);
  });

  it("is empty for a session with nothing placed", () => {
    expect(progressSeries([])).toEqual([]);
  });
});
