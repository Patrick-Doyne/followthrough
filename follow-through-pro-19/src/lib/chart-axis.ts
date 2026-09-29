/**
 * Axis domains and tick marks for the Recharts charts.
 *
 * <p>Here rather than inside a component because two charts kept getting
 * it wrong in the same two ways, and one of them is only visible on a
 * chart with two y-axes.
 *
 * <p>**Recharts will not leave a domain alone.** Given `domain` but no
 * `ticks` it picks its own, and its choice is not always evenly spaced: a
 * 40-70ms range came out 40, 48, 56, 70 — two steps of 8 and one of 14.
 * Naming the ticks is the only way to be sure.
 *
 * <p>**Two y-axes must have the same number of ticks.** Gridlines are drawn
 * from one axis only, so when the left had five and the right had four the
 * right-hand labels floated between the lines and the chart read as broken.
 */

const NICE = [1, 2, 5, 10];

/** The smallest "round" number at or above `raw`: 1, 2, 5, 10, 20, 50 … */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const step of NICE) {
    const candidate = step * magnitude;
    if (candidate >= raw - 1e-12) return candidate;
  }
  return 10 * magnitude;
}

export interface Axis {
  domain: [number, number];
  ticks: number[];
}

export interface EvenAxisOptions {
  /** Gaps between labels. Both axes of one chart must use the same number,
   * or their gridlines cannot line up. */
  intervals?: number;
  /** Never step finer than this — whole feet, whole milliseconds. */
  minStep?: number;
  /** Never show a range narrower than this, so a quiet series stays quiet
   * instead of having its noise magnified to fill the plot. */
  minSpan?: number;
  /** For quantities that cannot go below zero, like a distance. */
  floorAtZero?: boolean;
}

/**
 * A domain covering `values`, with evenly spaced ticks on round numbers.
 *
 * <p>Centred on the data rather than anchored at its lower edge, so a
 * series sits in the middle of its plot instead of hugging the floor.
 */
export function evenAxis(
  values: number[],
  { intervals = 4, minStep = 1, minSpan = 0, floorAtZero = false }: EvenAxisOptions = {},
): Axis {
  const build = (from: number, step: number): Axis => {
    const ticks = Array.from({ length: intervals + 1 }, (_, i) =>
      Number((from + i * step).toFixed(6)),
    );
    return { domain: [ticks[0] as number, ticks[intervals] as number], ticks };
  };

  if (values.length === 0) return build(0, minStep);

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const middle = (lo + hi) / 2;
  const span = Math.max(hi - lo, minSpan) * 1.15;

  let step = Math.max(minStep, niceStep(span / intervals));
  // Widen until the range actually covers the data. Bounded because each
  // pass multiplies the step, so it terminates long before the guard.
  for (let guard = 0; guard < 24; guard += 1) {
    const width = step * intervals;
    let from = Math.round((middle - width / 2) / step) * step;
    if (floorAtZero) from = Math.max(0, from);
    if (from <= lo + 1e-9 && from + width >= hi - 1e-9) return build(from, step);
    step = niceStep(step * 1.01);
  }
  // Unreachable in practice; a covering axis beats none.
  return build(floorAtZero ? 0 : lo, Math.max(minStep, (hi - lo) / intervals || minStep));
}
