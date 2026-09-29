import { describe, expect, it } from "vitest";

import {
  classifyZone,
  COURT,
  distanceFromRimFt,
  fromPipelineFeet,
  toPipelineFeet,
  zoneGroupOf,
} from "@/services/court-geometry";

describe("fromPipelineFeet", () => {
  it("puts a shot at the rim on the rim", () => {
    const at = fromPipelineFeet(0, 0)!;
    expect(at.x).toBeCloseTo(COURT.rim.x, 2);
    expect(at.y).toBeCloseTo(COURT.rim.y, 2);
  });

  it("flips the y axis", () => {
    // The pipeline measures negative y out onto the court; the diagram
    // measures y increasing away from the baseline. Getting this wrong
    // mirrors every shot through the rim, which looks plausible enough to
    // ship by accident.
    const out = fromPipelineFeet(0, -10)!;
    const behind = fromPipelineFeet(0, 10)!;
    expect(out.y).toBeGreaterThan(COURT.rim.y);
    expect(behind.y).toBeLessThan(COURT.rim.y);
  });

  it("converts feet to metres, on the correct side of the rim", () => {
    // 10ft is 3.05m, and the pipeline's +x is the diagram's left --
    // this used to assert +3.05, which is what put every shot on the
    // wrong wing.
    const at = fromPipelineFeet(10, 0)!;
    expect(Math.abs(at.x - COURT.rim.x)).toBeCloseTo(3.05, 2);
    expect(at.x).toBeLessThan(COURT.rim.x);
  });

  it("returns null rather than a default when the position is unknown", () => {
    // Substituting the rim is the defect this replaces: it stacked every
    // unplaced shot on one spot and read as a real cluster.
    expect(fromPipelineFeet(null, null)).toBeNull();
    expect(fromPipelineFeet(undefined, undefined)).toBeNull();
    expect(fromPipelineFeet(1, null)).toBeNull();
    expect(fromPipelineFeet(NaN, 0)).toBeNull();
  });

  it("clamps a shot from beyond the modelled half-court to its edge", () => {
    const heave = fromPipelineFeet(0, -200)!;
    expect(heave.y).toBe(COURT.depth);
    expect(heave.y).toBeLessThanOrEqual(COURT.depth);
  });

  it("agrees with the real pipeline output", () => {
    // Values taken from follow_through_batch_gpu against burkelake8.MOV.
    // Each designation was derived independently by the C++, so agreement
    // is a genuine cross-check rather than a restatement.
    const cases: [number, number, string][] = [
      [8.48, -14.04, "MID_RNG"],
      [-4.57, -3.31, "CLS_RNG"],
      [-0.2, 0.87, "LAY_UP"],
    ];
    for (const [fx, fy, designation] of cases) {
      const at = fromPipelineFeet(fx, fy)!;
      expect(at.x, designation).toBeGreaterThanOrEqual(0);
      expect(at.x, designation).toBeLessThanOrEqual(COURT.width);
      expect(at.y, designation).toBeGreaterThanOrEqual(0);
      expect(at.y, designation).toBeLessThanOrEqual(COURT.depth);
    }
    // The lay-up must land essentially on the rim.
    const layup = fromPipelineFeet(-0.2, 0.87)!;
    expect(Math.hypot(layup.x - COURT.rim.x, layup.y - COURT.rim.y)).toBeLessThan(0.4);
  });
});

describe("distanceFromRimFt", () => {
  it("matches the designations the pipeline assigned", () => {
    expect(distanceFromRimFt(-0.2, 0.87)).toBeLessThan(5); // LAY_UP
    expect(distanceFromRimFt(-4.57, -3.31)).toBeLessThan(10); // CLS_RNG
    expect(distanceFromRimFt(8.48, -14.04)).toBeGreaterThan(10); // MID_RNG
  });
});

describe("zoneGroupOf", () => {
  const at = (x: number, y: number) => zoneGroupOf({ x, y });

  it("puts a shot under the rim in the paint", () => {
    expect(at(COURT.rim.x, COURT.rim.y)).toBe("PAINT");
  });

  it("recognises a corner three", () => {
    expect(at(0.4, 1.0)).toBe("CORNER_THREE");
    expect(at(COURT.width - 0.4, 1.0)).toBe("CORNER_THREE");
  });

  it("does not call a shot in the same corner but further out a corner three", () => {
    // Past the corner section the line becomes the arc, so this is above
    // the break even though it is near the sideline.
    expect(at(0.4, 6.0)).toBe("ABOVE_BREAK_THREE");
  });

  it("recognises an above-the-break three", () => {
    expect(at(COURT.rim.x, COURT.rim.y + 7.5)).toBe("ABOVE_BREAK_THREE");
  });

  it("puts a shot between the paint and the arc in midrange", () => {
    expect(at(COURT.rim.x + 4, COURT.rim.y + 3)).toBe("MID_RANGE");
  });

  it("classifies every point on the court as exactly one group", () => {
    const groups = new Set<string>();
    for (let x = 0; x <= COURT.width; x += 0.5) {
      for (let y = 0; y <= COURT.depth; y += 0.5) {
        groups.add(at(x, y));
      }
    }
    // All four are reachable, and nothing falls through.
    expect([...groups].sort()).toEqual(["ABOVE_BREAK_THREE", "CORNER_THREE", "MID_RANGE", "PAINT"]);
  });
});

describe("classifyZone", () => {
  it("no longer reports every shot as the paint", () => {
    // It was hard-coded to "PAINT" for every shot, which made the value
    // meaningless and a zone filter useless.
    const zones = new Set([
      classifyZone({ x: COURT.rim.x, y: COURT.rim.y }),
      classifyZone({ x: 0.4, y: 1 }),
      classifyZone({ x: COURT.width - 0.4, y: 1 }),
      classifyZone({ x: COURT.rim.x, y: 9 }),
      classifyZone({ x: 1.5, y: 8 }),
      classifyZone({ x: COURT.rim.x + 4, y: 4 }),
    ]);
    expect(zones.size).toBeGreaterThan(3);
  });

  it("gets left and right the right way round", () => {
    expect(classifyZone({ x: 0.4, y: 1 })).toBe("CORNER_LEFT");
    expect(classifyZone({ x: COURT.width - 0.4, y: 1 })).toBe("CORNER_RIGHT");
  });

  it("names the free-throw line separately from the rest of the paint", () => {
    expect(classifyZone({ x: COURT.rim.x, y: 5.8 })).toBe("FREE_THROW_LINE");
    expect(classifyZone({ x: COURT.rim.x, y: 1.6 })).toBe("PAINT");
  });
});

describe("which side of the floor a shot lands on", () => {
  it("puts the pipeline's positive x on the diagram's left", () => {
    // The detector's keypoints are labelled from the court's own side,
    // so its +x is the opposite hand to a diagram drawn from where the
    // camera stands. Without the flip every shot appeared on the wrong
    // wing -- which is invisible in aggregate and obvious to anyone
    // who watched the session.
    const rim = fromPipelineFeet(0, 0)!;
    const pipelinePositiveX = fromPipelineFeet(18, -8)!;
    const pipelineNegativeX = fromPipelineFeet(-18, -8)!;
    expect(pipelinePositiveX.x).toBeLessThan(rim.x);
    expect(pipelineNegativeX.x).toBeGreaterThan(rim.x);
  });

  it("keeps a shot away from the baseline as the court gets deeper", () => {
    const close = fromPipelineFeet(0, -5)!;
    const far = fromPipelineFeet(0, -20)!;
    expect(far.y).toBeGreaterThan(close.y);
  });
});

describe("toPipelineFeet", () => {
  it("is the inverse of fromPipelineFeet", () => {
    // The two live beside each other precisely so this holds. A second
    // copy of the arithmetic elsewhere is how they drift apart.
    // Negative Y is toward half court: the pipeline's origin is the
    // rim, and +Y runs behind the baseline, where nobody shoots from.
    for (const [xFt, yFt] of [
      [0, 0],
      [3, -12],
      [-8, -20],
      [10, -4],
    ]) {
      const location = fromPipelineFeet(xFt, yFt);
      expect(location).not.toBeNull();
      const back = toPipelineFeet(location!);
      expect(back.courtXFt).toBeCloseTo(xFt as number, 1);
      expect(back.courtYFt).toBeCloseTo(yFt as number, 1);
    }
  });

  it("does not round-trip a position outside the modelled half court", () => {
    // fromPipelineFeet clamps to the diagram's edge on purpose, so a
    // heave from the far end stays visible. The clamp is lossy, and
    // this records that rather than pretending the pair is exact
    // everywhere.
    const behindBaseline = fromPipelineFeet(3, 12)!;
    expect(behindBaseline.y).toBe(0);
    expect(toPipelineFeet(behindBaseline).courtYFt).not.toBeCloseTo(12, 1);
  });

  it("puts the rim at the origin", () => {
    const rim = fromPipelineFeet(0, 0)!;
    const back = toPipelineFeet(rim);
    expect(back.courtXFt).toBeCloseTo(0, 6);
    expect(back.courtYFt).toBeCloseTo(0, 6);
  });
});
