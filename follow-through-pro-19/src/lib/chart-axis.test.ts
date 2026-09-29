import { describe, expect, it } from "vitest";

import { evenAxis, niceStep } from "@/lib/chart-axis";

const gaps = (ticks: number[]) => ticks.slice(1).map((t, i) => Number((t - ticks[i]!).toFixed(6)));

describe("niceStep", () => {
  it("rounds up to a round number", () => {
    expect(niceStep(2.3)).toBe(5);
    expect(niceStep(5)).toBe(5);
    expect(niceStep(5.75)).toBe(10);
    expect(niceStep(0.023)).toBeCloseTo(0.05);
    expect(niceStep(140)).toBe(200);
  });

  it("survives nonsense rather than producing NaN ticks", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
    expect(niceStep(-4)).toBe(1);
  });
});

describe("evenAxis", () => {
  it("spaces every tick equally", () => {
    // The actual defect: a 40-70ms range came back 40, 48, 56, 70.
    const axis = evenAxis([48, 49, 52, 56], { minStep: 1, minSpan: 20 });
    const steps = new Set(gaps(axis.ticks));
    expect(steps.size).toBe(1);
  });

  it("gives both axes of one chart the same number of ticks", () => {
    // Gridlines come from one axis only, so a mismatch makes the other
    // axis's labels float between the lines.
    const left = evenAxis([59.5, 60.3], { intervals: 4, minStep: 1, minSpan: 8 });
    const right = evenAxis([48, 56], { intervals: 4, minStep: 1, minSpan: 20 });
    expect(left.ticks).toHaveLength(5);
    expect(right.ticks).toHaveLength(5);
  });

  it("covers every value it was given", () => {
    for (const values of [[1, 29], [0.51, 1.58], [48, 56], [-3, 3], [7]]) {
      const axis = evenAxis(values, { minStep: 0.01 });
      expect(axis.domain[0]).toBeLessThanOrEqual(Math.min(...values) + 1e-9);
      expect(axis.domain[1]).toBeGreaterThanOrEqual(Math.max(...values) - 1e-9);
    }
  });

  it("keeps a quiet series quiet via minSpan", () => {
    // Without a floor on the span, a 0.8-point wobble would be stretched
    // across the whole plot and read as volatility.
    const axis = evenAxis([59.5, 60.3], { minStep: 1, minSpan: 8 });
    expect(axis.domain[1] - axis.domain[0]).toBeGreaterThanOrEqual(8);
  });

  it("centres the data rather than parking it on the floor", () => {
    const axis = evenAxis([59.5, 60.3], { minStep: 1, minSpan: 8 });
    const middle = (axis.domain[0] + axis.domain[1]) / 2;
    expect(Math.abs(middle - 59.9)).toBeLessThanOrEqual(axis.ticks[1]! - axis.ticks[0]!);
  });

  it("never goes negative for a quantity that cannot", () => {
    const axis = evenAxis([1, 4], { minStep: 1, minSpan: 20, floorAtZero: true });
    expect(axis.domain[0]).toBe(0);
  });

  it("respects the smallest allowed step", () => {
    const axis = evenAxis([10, 10.2], { minStep: 1, minSpan: 0 });
    expect(gaps(axis.ticks).every((g) => g >= 1)).toBe(true);
  });

  it("produces a usable axis for a single value", () => {
    const axis = evenAxis([42], { minStep: 1, minSpan: 10 });
    expect(axis.ticks).toHaveLength(5);
    expect(axis.domain[0]).toBeLessThanOrEqual(42);
    expect(axis.domain[1]).toBeGreaterThanOrEqual(42);
  });

  it("produces a usable axis for no values at all", () => {
    const axis = evenAxis([], { minStep: 5 });
    expect(axis.ticks).toHaveLength(5);
    expect(axis.ticks.every(Number.isFinite)).toBe(true);
  });
});
