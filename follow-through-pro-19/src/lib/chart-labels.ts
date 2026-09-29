import type { ChartPalette } from "@/lib/chart-theme";
import { MIN_SAMPLE, type Rate } from "@/lib/shot-insights";

/**
 * The wording and colouring the analysis charts share.
 *
 * <p>Here rather than repeated per chart because these are the parts that
 * have to agree: a chart that silently drops a thin band while its
 * neighbour paints the same band at 0% is telling the user two different
 * things about the same shots.
 */

/** What a chart says instead of a percentage when the sample is too thin. */
export function thinSampleNote(attempts: number): string {
  return attempts === 0
    ? "No attempts"
    : `${attempts} attempt${attempts === 1 ? "" : "s"} — needs ${MIN_SAMPLE} to score`;
}

/** A rate as text, never inventing a percentage the sample cannot support. */
export function rateText(rate: Rate): string {
  return rate.percentage === null
    ? thinSampleNote(rate.attempts)
    : `${rate.percentage.toFixed(0)}% · ${rate.makes}/${rate.attempts}`;
}

export type RateTone = "make" | "miss" | "neutral";

/**
 * Which colour a rate earns, relative to the player's overall rate.
 *
 * <p>Five points either side rather than a bare comparison, so a band one
 * make away from the average is not painted as a strength or a weakness.
 */
export function rateTone(percentage: number | null, overall: number | null): RateTone {
  if (percentage === null || overall === null) return "neutral";
  if (percentage >= overall + 5) return "make";
  if (percentage <= overall - 5) return "miss";
  return "neutral";
}

export function toneColor(tone: RateTone, chart: ChartPalette): string {
  if (tone === "make") return chart.make;
  if (tone === "miss") return chart.miss;
  return chart.primary;
}
