import { classifyShotType } from "@/lib/shot-type";
import { classifyZone } from "@/services/court-geometry";
import type { LiveShot } from "@/hooks/use-live-score";
import type { Shot } from "@/types/telemetry";

/**
 * Turns a live detection into the shape the court chart plots.
 *
 * <p>Extracted from the live route so the derivation can be tested. It is
 * the place where "what the pipeline told us" becomes "what we display",
 * and every field here is either measured or derived from something
 * measured — nothing is invented:
 *
 * <ul>
 *   <li><b>timestamp</b> is when the event arrived, recorded per shot.
 *   Reading the clock at render time gave every shot one shared value that
 *   drifted whenever the list recomputed.
 *   <li><b>distance</b> is the pipeline's own measurement, or the distance
 *   implied by the release position, which is exact.
 *   <li><b>type</b> is the pipeline's classification, or the one that
 *   follows from the distance.
 *   <li><b>duration, apex and confidence</b> are left at zero when unknown.
 *   The display renders zero as "not recorded", because a shot cannot take
 *   zero seconds and a detector does not report zero confidence.
 * </ul>
 *
 * @returns null when the shot has no court position and therefore cannot
 *   be placed on the diagram.
 */
export function toPlottableShot(shot: LiveShot, sessionId: string): Shot | null {
  const location = shot.location;
  if (!location) return null;

  const shotDistance = shot.distanceFt ?? 0;

  return {
    shotId: `live-${shot.sequence}`,
    sessionId,
    shotNumber: shot.sequence,
    timestamp: new Date(shot.at).toISOString(),
    result: shot.result === "make" ? "MAKE" : "MISS",
    shotType: shot.designation ?? classifyShotType(shotDistance),
    shotDistance,
    shotDuration: shot.durationSeconds ?? 0,
    timeToApex: shot.timeToApexSeconds ?? 0,
    zone: classifyZone(location),
    location,
  };
}

export interface RunningSeriesPoint {
  index: number;
  percentage: number;
  shotDuration: number;
  timeToApex: number;
  shotDistance: number;
  result: "MAKE" | "MISS";
}

/**
 * The live charts' data, accumulated in shooting order.
 *
 * <p>`history` is newest-first because that is the order the feed wants,
 * so it has to be reversed before a running percentage is accumulated —
 * otherwise the line is computed backwards and the first point shows the
 * *last* shot's cumulative average.
 */
export function toRunningSeries(history: LiveShot[]): RunningSeriesPoint[] {
  const chronological = [...history].reverse();
  let madeSoFar = 0;
  return chronological.map((shot, i) => {
    if (shot.result === "make") madeSoFar += 1;
    return {
      index: i + 1,
      percentage: Number(((madeSoFar / (i + 1)) * 100).toFixed(1)),
      shotDuration: shot.durationSeconds ?? 0,
      timeToApex: shot.timeToApexSeconds ?? 0,
      shotDistance: shot.distanceFt ?? 0,
      result: shot.result === "make" ? "MAKE" : "MISS",
    };
  });
}
