import { describe, expect, it } from "vitest";

import {
  apexRatio,
  apexRatioBuckets,
  bestRun,
  deviationBuckets,
  distanceBands,
  designationRates,
  distanceBaseline,
  fieldCoverage,
  expectedRate,
  insights,
  longestRun,
  MIN_CLAIM_SAMPLE,
  MIN_FIT_SAMPLE,
  MIN_SAMPLE,
  rateOf,
  ratesDiffer,
  rateStandardError,
  beatsNoise,
  releaseDeviation,
  releaseFit,
  rollingRate,
  sessionCount,
  sessionThirds,
  sessionTrend,
  qualityTrend,
  trimEmptyEnds,
  splitAtWindow,
} from "@/lib/shot-insights";
import type { CourtLocation, Shot, ShotResult } from "@/types/telemetry";

function shot(overrides: Partial<Shot> & { result?: ShotResult } = {}, index = 0): Shot {
  return {
    shotId: `shot-${index}`,
    sessionId: "session-1",
    shotNumber: index + 1,
    timestamp: new Date(Date.UTC(2026, 0, 1, 10, 0, index)).toISOString(),
    result: "MAKE",
    shotType: "MID_RNG",
    shotDistance: 14,
    shotDuration: 1,
    timeToApex: 0.6,
    ...overrides,
  };
}

/** n shots with the first `makes` of them made. */
function run(n: number, makes: number, overrides: Partial<Shot> = {}): Shot[] {
  return Array.from({ length: n }, (_, i) =>
    shot({ ...overrides, result: i < makes ? "MAKE" : "MISS" }, i),
  );
}

describe("rateOf", () => {
  it("scores a single attempt, so a chart can draw from one shot", () => {
    expect(MIN_SAMPLE).toBe(1);
    const rate = rateOf(run(1, 1));
    expect(rate.attempts).toBe(1);
    expect(rate.percentage).toBe(100);
  });

  it("reports zero attempts as null, not as 0%", () => {
    // 0% would read as "you missed everything from here".
    expect(rateOf([]).percentage).toBeNull();
  });

  it("still honours a caller that asks for a higher floor", () => {
    expect(rateOf(run(4, 2), 5).percentage).toBeNull();
    expect(rateOf(run(5, 2), 5).percentage).toBe(40);
  });
});

describe("distanceBands", () => {
  it("puts a shot in exactly one band", () => {
    const shots = [5, 9.9, 10, 19.8, 19.9, 22.9, 23, 40].map((d, i) =>
      shot({ shotDistance: d }, i),
    );
    const total = distanceBands(shots).reduce((sum, b) => sum + b.attempts, 0);
    expect(total).toBe(shots.length);
  });

  it("aligns its edges with the pipeline's own shot-type cuts", () => {
    // classify_shot_type in the C++ cuts at 5 / 10 / 19.9 / 22 / 23, so no
    // band may straddle one of those values.
    const edges = distanceBands([]).flatMap((b) => [b.from, b.to]);
    for (const cut of [5, 10, 19.9, 23]) {
      expect(edges).toContain(cut);
    }
  });

  it("keeps the last band open-ended", () => {
    const bands = distanceBands([shot({ shotDistance: 90 })]);
    expect(bands.at(-1)?.attempts).toBe(1);
  });
});

describe("designationRates", () => {
  it("returns the pipeline's six classes in order, even when unattempted", () => {
    const rates = designationRates([shot({ shotType: "MID_RNG" })]);
    expect(rates.map((r) => r.shotType)).toEqual([
      "LAY_UP",
      "CLS_RNG",
      "MID_RNG",
      "HS_3PT",
      "NCAA_3PT",
      "NBA_3PT",
    ]);
    // A class with no attempts is shown as empty rather than dropped, so
    // the reader can see where they never shoot from.
    expect(rates.find((r) => r.shotType === "LAY_UP")?.attempts).toBe(0);
  });

  it("counts every shot exactly once", () => {
    const shots = (["LAY_UP", "CLS_RNG", "MID_RNG", "MID_RNG", "NBA_3PT"] as const).map((t, i) =>
      shot({ shotType: t }, i),
    );
    expect(designationRates(shots).reduce((sum, r) => sum + r.attempts, 0)).toBe(shots.length);
  });

  it("does not need a court position, unlike the floor-zone split it replaced", () => {
    // The whole point: these shots carry no location at all.
    const shots = Array.from({ length: 6 }, (_, i) =>
      shot({ shotType: "MID_RNG", result: i < 4 ? "MAKE" : "MISS" }, i),
    );
    const mid = designationRates(shots).find((r) => r.shotType === "MID_RNG");
    expect(mid?.attempts).toBe(6);
    expect(mid?.percentage).toBeCloseTo((4 / 6) * 100);
  });

  it("carries the distance range for each class so a bar can be labelled", () => {
    expect(designationRates([]).find((r) => r.shotType === "NBA_3PT")?.range).toBe("23 ft and out");
  });
});

describe("apexRatio", () => {
  it("is the share of the flight spent rising", () => {
    expect(apexRatio(shot({ timeToApex: 0.6, shotDuration: 1 }))).toBeCloseTo(0.6);
  });

  it("is null when a timing was never measured", () => {
    // The pipeline leaves these at zero when it could not measure them.
    // Returning 0 would file the shot as the flattest arc in the session.
    expect(apexRatio(shot({ timeToApex: 0, shotDuration: 1 }))).toBeNull();
    expect(apexRatio(shot({ timeToApex: 0.5, shotDuration: 0 }))).toBeNull();
  });

  it("rejects an apex at or after the rim", () => {
    expect(apexRatio(shot({ timeToApex: 1, shotDuration: 1 }))).toBeNull();
    expect(apexRatio(shot({ timeToApex: 1.4, shotDuration: 1 }))).toBeNull();
  });
});

describe("apexRatioBuckets and bestRun", () => {
  it("scores every bucket that has anything in it", () => {
    const shots = [
      ...run(10, 10, { timeToApex: 0.61, shotDuration: 1 }),
      ...run(2, 0, { timeToApex: 0.46, shotDuration: 1 }),
    ];
    const scored = apexRatioBuckets(shots).filter((b) => b.percentage !== null);
    expect(scored).toHaveLength(2);
  });

  it("will not shade a window around a bucket too thin to name", () => {
    // Two misses at a flat arc and ten makes at a high one. Both buckets
    // plot, but only the ten-shot one may be called the best window.
    const shots = [
      ...run(10, 10, { timeToApex: 0.61, shotDuration: 1 }),
      ...run(2, 2, { timeToApex: 0.46, shotDuration: 1 }),
    ];
    const window = bestRun(apexRatioBuckets(shots));
    expect(window?.from).toBeCloseTo(0.6);
  });

  it("returns null when no bucket reached the claim floor", () => {
    // Three shots plot fine; none of them earns a shaded "best window".
    expect(apexRatioBuckets(run(3, 2)).some((b) => b.percentage !== null)).toBe(true);
    expect(bestRun(apexRatioBuckets(run(3, 2)))).toBeNull();
  });

  it("widens the window across buckets that are as good as the best", () => {
    const shots = [
      ...run(10, 10, { timeToApex: 0.46, shotDuration: 1 }),
      ...run(10, 10, { timeToApex: 0.49, shotDuration: 1 }),
      ...run(10, 1, { timeToApex: 0.7, shotDuration: 1 }),
    ];
    const win = bestRun(apexRatioBuckets(shots));
    expect(win?.from).toBeCloseTo(0.45);
    expect(win?.to).toBeCloseTo(0.51);
  });
});

describe("apexRatioBuckets: every measured shot is on the chart", () => {
  it("covers ratios that fall outside the old fixed 0.45-0.75 range", () => {
    // A flat line drive and a very high arc. Under the fixed range both
    // were counted by no bucket at all, while the readout above the chart
    // still claimed every shot had been measured.
    const shots = [
      shot({ timeToApex: 0.2, shotDuration: 1 }, 0),
      shot({ timeToApex: 0.6, shotDuration: 1 }, 1),
      shot({ timeToApex: 0.9, shotDuration: 1 }, 2),
    ];
    const buckets = apexRatioBuckets(shots);
    expect(buckets.reduce((sum, b) => sum + b.attempts, 0)).toBe(3);
  });

  it("puts the largest ratio inside a bucket, not on an exclusive edge", () => {
    // 0.6 sits exactly on the 0.03 grid; the top edge has to clear it.
    const shots = [shot({ timeToApex: 0.6, shotDuration: 1 }, 0)];
    expect(apexRatioBuckets(shots).reduce((sum, b) => sum + b.attempts, 0)).toBe(1);
  });

  it("bars every shot the readout counts as measured", () => {
    const shots = Array.from({ length: 40 }, (_, i) =>
      shot({ timeToApex: 0.35 + i * 0.012, shotDuration: 1 }, i),
    );
    const measured = shots.filter((s) => apexRatio(s) !== null).length;
    expect(apexRatioBuckets(shots).reduce((sum, b) => sum + b.attempts, 0)).toBe(measured);
  });

  it("returns nothing when no shot has a measurable ratio", () => {
    expect(apexRatioBuckets(run(5, 2, { timeToApex: 0, shotDuration: 0 }))).toEqual([]);
  });
});

describe("splitAtWindow", () => {
  it("counts each placed shot on exactly one side", () => {
    const shots = run(20, 10, { timeToApex: 0.6, shotDuration: 1 });
    const split = splitAtWindow(shots, apexRatio, { from: 0.55, to: 0.65 });
    expect(split.inside.attempts).toBe(20);
    expect(split.outside.attempts).toBe(0);
  });

  it("drops shots with no measurable value from both sides", () => {
    const split = splitAtWindow(run(10, 5, { timeToApex: 0 }), apexRatio, { from: 0, to: 1 });
    expect(split.inside.attempts + split.outside.attempts).toBe(0);
  });
});

describe("releaseFit", () => {
  it("recovers a known line", () => {
    const shots = Array.from({ length: 20 }, (_, i) =>
      shot({ shotDistance: 5 + i, shotDuration: 0.5 + 0.03 * (5 + i) }, i),
    );
    const fit = releaseFit(shots);
    expect(fit?.slope).toBeCloseTo(0.03, 6);
    expect(fit?.intercept).toBeCloseTo(0.5, 6);
    expect(fit?.residualSd).toBeCloseTo(0, 6);
    expect(fit?.r2).toBeCloseTo(1, 6);
  });

  it("refuses to fit a line through fewer than three shots", () => {
    // Two points define a line exactly: the scatter around it would come
    // out as zero and the chart would claim a perfect release off two shots.
    expect(MIN_FIT_SAMPLE).toBe(3);
    expect(releaseFit(run(2, 1))).toBeNull();
    expect(releaseFit(run(3, 1))).not.toBeNull();
  });

  it("does not divide by zero when every shot is from one spot", () => {
    const fit = releaseFit(
      Array.from({ length: 12 }, (_, i) =>
        shot({ shotDistance: 15, shotDuration: 1 + i * 0.01 }, i),
      ),
    );
    expect(fit?.slope).toBe(0);
    expect(Number.isFinite(fit?.residualSd ?? NaN)).toBe(true);
  });

  it("measures scatter around the line, not around the mean duration", () => {
    // Duration rises steeply with distance, so the spread of durations is
    // large while the spread around the line is small. A consistency score
    // taken from raw duration would call this player wildly inconsistent.
    const shots = Array.from({ length: 24 }, (_, i) =>
      shot(
        { shotDistance: 5 + i, shotDuration: 0.5 + 0.03 * (5 + i) + (i % 2 === 0 ? 0.01 : -0.01) },
        i,
      ),
    );
    const fit = releaseFit(shots);
    expect(fit!.residualSd).toBeLessThan(0.02);
  });
});

describe("releaseDeviation and deviationBuckets", () => {
  const fit = { slope: 0.03, intercept: 0.5, residualSd: 0.05, r2: 0.9, samples: 30 };

  it("is positive when the shot hung longer than the line expects", () => {
    expect(releaseDeviation(shot({ shotDistance: 10, shotDuration: 0.9 }), fit)).toBeCloseTo(0.1);
  });

  it("counts every measurable shot, including wild outliers", () => {
    const shots = [
      ...run(10, 5, { shotDistance: 10, shotDuration: 0.8 }),
      // Ten standard deviations out; must land in an outer bucket, not vanish.
      shot({ shotDistance: 10, shotDuration: 1.3 }, 99),
    ];
    const total = deviationBuckets(shots, fit).reduce((sum, b) => sum + b.attempts, 0);
    expect(total).toBe(shots.length);
  });

  it("has no buckets when there is no scatter to measure", () => {
    expect(deviationBuckets(run(10, 5), { ...fit, residualSd: 0 })).toEqual([]);
  });
});

describe("rollingRate", () => {
  it("withholds the window rate until the window is full", () => {
    const points = rollingRate(run(12, 12), 10);
    expect(points.slice(0, 9).every((p) => p.percentage === null)).toBe(true);
    expect(points[9]?.percentage).toBe(100);
  });

  it("tracks a late cold run that the cumulative rate hides", () => {
    // 40 makes then 10 misses: cumulative is still 80%, the window is 0%.
    const shots = [...run(40, 40), ...run(10, 0).map((s, i) => ({ ...s, shotNumber: 41 + i }))];
    const last = rollingRate(shots, 10).at(-1);
    expect(last?.cumulative).toBeCloseTo(80);
    expect(last?.percentage).toBe(0);
  });
});

describe("sessionThirds", () => {
  it("leaves no shot out when the count does not divide by three", () => {
    const thirds = sessionThirds(run(31, 15));
    expect(thirds.reduce((sum, t) => sum + t.attempts, 0)).toBe(31);
  });

  it("splits by shot count, so a long break cannot skew a stretch", () => {
    const thirds = sessionThirds(run(30, 10));
    expect(thirds.map((t) => t.attempts)).toEqual([10, 10, 10]);
    expect(thirds[0]?.percentage).toBe(100);
    expect(thirds[2]?.percentage).toBe(0);
  });

  it("labels each stretch with the player's own shot numbers", () => {
    // The shot log and the rhythm chart number shots the same way, so the
    // ranges here have to match them rather than array indices.
    const thirds = sessionThirds(run(31, 15));
    expect(thirds[0]).toMatchObject({ fromShot: 1, toShot: 10 });
    expect(thirds[1]).toMatchObject({ fromShot: 11, toShot: 20 });
    // The last stretch absorbs the remainder.
    expect(thirds[2]).toMatchObject({ fromShot: 21, toShot: 31 });
  });
});

describe("sessionTrend", () => {
  const session = (id: string, day: number, n: number, makes: number) =>
    Array.from({ length: n }, (_, i) =>
      shot(
        {
          sessionId: id,
          result: i < makes ? "MAKE" : "MISS",
          timestamp: new Date(Date.UTC(2026, 0, day, 10, 0, i)).toISOString(),
          shotDistance: 5 + (i % 20),
          shotDuration: 0.5 + 0.03 * (5 + (i % 20)) + (i % 3) * 0.01,
        },
        i,
      ),
    );

  it("returns one point per session, oldest first", () => {
    const trend = sessionTrend([...session("b", 9, 20, 10), ...session("a", 3, 20, 15)]);
    expect(trend.map((p) => p.sessionId)).toEqual(["a", "b"]);
    expect(trend[0]?.attempts).toBe(20);
  });

  it("dates a session by its earliest shot, not by whichever sorted first", () => {
    const shuffled = [...session("a", 3, 12, 6)].reverse();
    expect(sessionTrend(shuffled)[0]?.date).toBe(
      new Date(Date.UTC(2026, 0, 3, 10, 0, 0)).toISOString(),
    );
  });

  it("leaves the release scatter null for a session too short to fit a line", () => {
    const point = sessionTrend(session("a", 3, 2, 1))[0];
    expect(point?.residualSd).toBeNull();
    // The arc is a plain average, so it survives where the fit does not.
    expect(point?.apexRatio).not.toBeNull();
    expect(point?.attempts).toBe(2);
  });

  it("measures scatter per session rather than pooling them", () => {
    // One tight session and one loose one must not average into each other.
    const tight = Array.from({ length: 20 }, (_, i) =>
      shot({ sessionId: "tight", shotDistance: 10 + i, shotDuration: 0.5 + 0.03 * (10 + i) }, i),
    ).map((s) => ({ ...s, timestamp: new Date(Date.UTC(2026, 0, 3, 10, 0, 0)).toISOString() }));
    const loose = Array.from({ length: 20 }, (_, i) =>
      shot(
        {
          sessionId: "loose",
          shotDistance: 10 + i,
          shotDuration: 0.5 + 0.03 * (10 + i) + (i % 2 ? 0.2 : -0.2),
        },
        i,
      ),
    ).map((s) => ({ ...s, timestamp: new Date(Date.UTC(2026, 0, 9, 10, 0, 0)).toISOString() }));
    const trend = sessionTrend([...tight, ...loose]);
    expect(trend[0]!.residualSd!).toBeLessThan(0.01);
    expect(trend[1]!.residualSd!).toBeGreaterThan(0.15);
  });
});

describe("expectedRate and qualityTrend", () => {
  /** n shots at one distance, `makes` of them made, in one session. */
  const at = (distance: number, n: number, makes: number, sessionId: string, day: number) =>
    Array.from({ length: n }, (_, i) =>
      shot(
        {
          sessionId,
          shotDistance: distance,
          result: i < makes ? "MAKE" : "MISS",
          timestamp: new Date(Date.UTC(2026, 0, day, 10, 0, i)).toISOString(),
        },
        i,
      ),
    );

  it("scores a set of shots at the baseline rate for their distances", () => {
    const history = [...at(3, 20, 18, "h", 1), ...at(25, 20, 8, "h", 1)];
    const baseline = distanceBaseline(history);
    // Ten layups and ten long threes: 90% and 40%, so 65% expected.
    const mixed = [...at(3, 10, 0, "x", 2), ...at(25, 10, 10, "x", 2)];
    expect(expectedRate(mixed, baseline)).toBeCloseTo(65, 6);
  });

  it("ignores whether those shots actually went in", () => {
    const history = [...at(3, 20, 18, "h", 1), ...at(25, 20, 8, "h", 1)];
    const baseline = distanceBaseline(history);
    const allMade = at(3, 12, 12, "x", 2);
    const allMissed = at(3, 12, 0, "x", 2);
    expect(expectedRate(allMade, baseline)).toBe(expectedRate(allMissed, baseline));
  });

  it("returns null when the baseline knows nothing about these distances", () => {
    const baseline = distanceBaseline(at(3, 20, 18, "h", 1));
    expect(expectedRate(at(25, 20, 8, "x", 2), baseline)).toBeNull();
  });

  it("separates a good percentage from good shooting", () => {
    // Two sessions at the same 60% actual. One took only layups, where this
    // player shoots 80%; the other took only long threes, where they shoot
    // 40%. The first underperformed its shot selection, the second beat it.
    const easy = at(3, 20, 12, "easy", 2);
    const hard = at(25, 20, 12, "hard", 3);
    const history = [...at(3, 40, 32, "h", 1), ...at(25, 40, 16, "h", 1)];
    const trend = qualityTrend([...history, ...easy, ...hard]);
    const easyPoint = trend.find((p) => p.sessionId === "easy");
    const hardPoint = trend.find((p) => p.sessionId === "hard");
    expect(easyPoint?.actual).toBeCloseTo(60);
    expect(hardPoint?.actual).toBeCloseTo(60);
    expect(easyPoint!.gap!).toBeLessThan(0);
    expect(hardPoint!.gap!).toBeGreaterThan(0);
  });

  it("orders sessions oldest first", () => {
    const history = [...at(3, 40, 32, "h", 1), ...at(25, 40, 16, "h", 1)];
    const trend = qualityTrend([
      ...history,
      ...at(3, 20, 12, "later", 9),
      ...at(3, 20, 12, "earlier", 5),
    ]);
    const ids = trend.map((p) => p.sessionId);
    expect(ids.indexOf("earlier")).toBeLessThan(ids.indexOf("later"));
  });
});

describe("rollingRate and sessionThirds across sessions", () => {
  const session = (id: string, n: number, makes: number, from = 0) =>
    Array.from({ length: n }, (_, i) =>
      shot({ sessionId: id, result: i < makes ? "MAKE" : "MISS" }, from + i),
    );

  it("never lets the trailing window reach back into the previous session", () => {
    // Session A is all makes, session B all misses. B's very first point
    // must read 0%, not 90-something from A's tail.
    const shots = [...session("a", 20, 20), ...session("b", 20, 0, 20)];
    const points = rollingRate(shots, 10, 1);
    const firstOfB = points.find((p) => p.startsSession);
    expect(firstOfB?.index).toBe(21);
    expect(firstOfB?.percentage).toBe(0);
  });

  it("runs the cumulative line through everything, which is the trend", () => {
    const shots = [...session("a", 20, 20), ...session("b", 20, 0, 20)];
    expect(rollingRate(shots, 10, 1).at(-1)?.cumulative).toBeCloseTo(50);
  });

  it("indexes across the whole set, because shot numbers restart", () => {
    const shots = [...session("a", 3, 3), ...session("b", 3, 0)];
    // Both sessions number their shots 1..3; the axis needs 1..6.
    expect(rollingRate(shots).map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rollingRate(shots).map((p) => p.shotNumber)).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it("flags only the first shot of each session after the first", () => {
    const shots = [...session("a", 3, 3), ...session("b", 3, 0), ...session("c", 3, 3)];
    expect(
      rollingRate(shots)
        .filter((p) => p.startsSession)
        .map((p) => p.index),
    ).toEqual([4, 7]);
  });

  it("pools each session's own thirds rather than cutting the set in three", () => {
    // Every session starts hot and finishes cold. A single three-way cut
    // over the pooled shots would report the *sessions* in order and miss
    // it entirely; pooling by position within each session finds it.
    const hotStartColdEnd = (id: string) => [
      ...session(id, 3, 3),
      ...session(id, 3, 3),
      ...session(id, 3, 0),
    ];
    const thirds = sessionThirds([
      ...hotStartColdEnd("a"),
      ...hotStartColdEnd("b"),
      ...hotStartColdEnd("c"),
    ]);
    expect(thirds[0]?.percentage).toBe(100);
    expect(thirds[2]?.percentage).toBe(0);
    expect(thirds.reduce((sum, t) => sum + t.attempts, 0)).toBe(27);
  });

  it("leaves shot-number labels off when the stretches are pooled", () => {
    const thirds = sessionThirds([...session("a", 9, 5), ...session("b", 9, 5)]);
    expect(thirds[0]?.fromShot).toBe(0);
    expect(thirds[0]?.attempts).toBe(6);
  });

  it("drops a session too short to split rather than filing it all as opening", () => {
    const thirds = sessionThirds([...session("a", 9, 9), ...session("tiny", 2, 0)]);
    expect(thirds.reduce((sum, t) => sum + t.attempts, 0)).toBe(9);
  });
});

describe("longestRun", () => {
  it("finds the longest unbroken stretch", () => {
    const results: ShotResult[] = ["MAKE", "MAKE", "MISS", "MAKE", "MAKE", "MAKE", "MISS"];
    const shots = results.map((result, i) => shot({ result }, i));
    expect(longestRun(shots, "MAKE")).toBe(3);
    expect(longestRun(shots, "MISS")).toBe(1);
  });

  it("is zero when the result never occurs", () => {
    expect(longestRun(run(10, 10), "MISS")).toBe(0);
  });
});

describe("rateStandardError, beatsNoise and ratesDiffer", () => {
  it("does not report a perfect record as a certainty", () => {
    // Eight for eight is 100% with zero observed variance. Left unadjusted
    // its standard error would be exactly 0, making any gap "significant".
    expect(rateStandardError(rateOf(run(8, 8)))).toBeGreaterThan(5);
  });

  it("shrinks as the sample grows", () => {
    const small = rateStandardError(rateOf(run(10, 5)));
    const large = rateStandardError(rateOf(run(200, 100)));
    expect(large).toBeLessThan(small / 2);
  });

  it("rejects the nine-attempt strength that prompted this check", () => {
    // 7 from 9 is 78% against a 63% average: a 15-point gap on a standard
    // error of about 13 points.
    expect(beatsNoise(rateOf(run(9, 7)), 63)).toBe(false);
  });

  it("accepts the same gap once the sample is large enough", () => {
    expect(beatsNoise(rateOf(run(120, 94)), 63)).toBe(true);
  });

  it("will not separate two fifteen-shot samples three makes apart", () => {
    expect(ratesDiffer(rateOf(run(15, 11)), rateOf(run(15, 8)))).toBe(false);
  });

  it("separates the same rates at ten times the sample", () => {
    expect(ratesDiffer(rateOf(run(150, 110)), rateOf(run(150, 80)))).toBe(true);
  });

  it("will not state a claim off a sample too small to write a sentence about", () => {
    // Four from four clears two sigma against 53% on the arithmetic alone.
    // The chart may plot it; the findings panel may not say it out loud,
    // because a sentence carries no sample size in it.
    expect(MIN_CLAIM_SAMPLE).toBe(5);
    expect(rateOf(run(4, 4)).percentage).toBe(100);
    expect(ratesDiffer(rateOf(run(4, 4)), rateOf(run(150, 80)))).toBe(false);
    expect(beatsNoise(rateOf(run(4, 4)), 50)).toBe(false);
    // One more attempt and the claim floor is met.
    expect(beatsNoise(rateOf(run(5, 5)), 50)).toBe(true);
  });
});

describe("trimEmptyEnds", () => {
  const bucket = (attempts: number, from: number) => ({
    from,
    to: from + 1,
    mid: from + 0.5,
    label: String(from),
    attempts,
    makes: 0,
    percentage: null,
  });

  it("drops empty buckets from both ends", () => {
    const trimmed = trimEmptyEnds([bucket(0, 0), bucket(3, 1), bucket(2, 2), bucket(0, 3)]);
    expect(trimmed.map((b) => b.from)).toEqual([1, 2]);
  });

  it("keeps an empty bucket in the middle, because a gap is information", () => {
    const trimmed = trimEmptyEnds([bucket(3, 0), bucket(0, 1), bucket(2, 2)]);
    expect(trimmed).toHaveLength(3);
  });

  it("returns nothing when every bucket is empty", () => {
    expect(trimEmptyEnds([bucket(0, 0), bucket(0, 1)])).toEqual([]);
  });
});

describe("sessionCount", () => {
  it("counts the distinct sessions the shots came from", () => {
    const shots = [
      shot({ sessionId: "a" }, 0),
      shot({ sessionId: "a" }, 1),
      shot({ sessionId: "b" }, 2),
    ];
    expect(sessionCount(shots)).toBe(2);
  });

  it("is zero for no shots", () => {
    expect(sessionCount([])).toBe(0);
  });
});

describe("insights", () => {
  it("says nothing at all about a session too short to read", () => {
    expect(insights(run(5, 3))).toEqual([]);
  });

  it("names the busiest range when it falls well short of the best one", () => {
    const shots = [
      ...Array.from({ length: 30 }, (_, i) =>
        shot({ shotDistance: 25, result: i < 6 ? "MAKE" : "MISS" }, i),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        shot({ shotDistance: 3, result: i < 10 ? "MAKE" : "MISS" }, 30 + i),
      ),
    ];
    const titles = insights(shots).map((i) => i.title);
    expect(titles.some((t) => t.includes("busiest range"))).toBe(true);
  });

  it("does not call a band busy when it holds a small share of the attempts", () => {
    // Four bands of roughly equal volume: none of them is where "most of
    // your attempts" go, however badly one of them shoots.
    const shots = [10, 13, 17, 21].flatMap((distance, band) =>
      Array.from({ length: 12 }, (_, i) =>
        shot(
          { shotDistance: distance, result: i < (band === 3 ? 1 : 9) ? "MAKE" : "MISS" },
          band * 12 + i,
        ),
      ),
    );
    expect(insights(shots).some((i) => i.title.includes("busiest range"))).toBe(false);
  });

  it("says nothing about fading across shots from more than one session", () => {
    // Shot numbers restart per session, so "the closing third" would just be
    // whichever session sorted last.
    const first = run(15, 15).map((s) => ({ ...s, sessionId: "session-1" }));
    const second = run(15, 2).map((s, i) => ({
      ...s,
      sessionId: "session-2",
      shotNumber: 16 + i,
    }));
    const spanning = insights([...first, ...second]);
    expect(spanning.some((i) => i.title.includes("colder"))).toBe(false);
    // The same shots inside one session do produce the finding.
    const single = insights([...first, ...second.map((s) => ({ ...s, sessionId: "session-1" }))]);
    expect(single.some((i) => i.title.includes("colder"))).toBe(true);
  });

  it("reports a fade when the closing third is well down on the opening", () => {
    const shots = [...run(15, 15), ...run(15, 2).map((s, i) => ({ ...s, shotNumber: 16 + i }))];
    const fade = insights(shots).find((i) => i.title.includes("colder"));
    expect(fade?.kind).toBe("gap");
    expect(fade?.detail).toMatch(/%/);
  });

  it("reports a warm-up when the session runs the other way", () => {
    const shots = [...run(15, 2), ...run(15, 15).map((s, i) => ({ ...s, shotNumber: 16 + i }))];
    expect(insights(shots).some((i) => i.title.includes("warmed"))).toBe(true);
  });

  it("will not call a nine-attempt band the player's best range", () => {
    // The finding this whole noise check was added for.
    const shots = [
      ...Array.from({ length: 9 }, (_, i) =>
        shot({ shotDistance: 7, result: i < 7 ? "MAKE" : "MISS" }, i),
      ),
      ...Array.from({ length: 45 }, (_, i) =>
        shot({ shotDistance: 17, result: i < 28 ? "MAKE" : "MISS" }, 9 + i),
      ),
    ];
    expect(insights(shots).some((i) => i.title.includes("best range"))).toBe(false);
  });

  it("stays silent on a flat session with nothing to separate", () => {
    // Even, unremarkable shooting from one spot: no gap clears a threshold.
    const shots = Array.from({ length: 60 }, (_, i) =>
      shot({ shotDistance: 15, result: i % 2 === 0 ? "MAKE" : "MISS" }, i),
    );
    expect(insights(shots)).toEqual([]);
  });
});
