/**
 * Presentation-side derivations only.
 *
 * <p>Real analytics computation belongs to the backend; this merely shapes
 * already-returned telemetry for a chart.
 *
 * <p>Most of what used to live here -- generic histogram binning, box-plot
 * quartiles, a distance binner and a shot-type tally -- went with the charts
 * that consumed it. The binning was generic because the charts were generic,
 * which was the problem: a histogram of flight times is a histogram of how
 * far away the player stood. The replacements in `lib/shot-insights` bin
 * against the player's own baseline instead, and each carries its own edges
 * because the edges are the point.
 */

export const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
