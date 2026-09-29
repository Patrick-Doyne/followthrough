/**
 * Translation between the coordinate spaces this app deals in.
 *
 * <p>There are two, and confusing them is the easiest way to plot a shot
 * in the wrong half of the court:
 *
 * <ol>
 *   <li><b>Pipeline space</b> — what `shot_event` carries. Feet, origin at
 *   the rim, negative y out onto the court and positive y behind the rim
 *   toward the baseline. Set by `COURT_POINTS` in the C++.
 *   <li><b>Court space</b> — the metre-based half-court the Eagle-Eye
 *   diagram draws. Origin at the baseline-left corner, y increasing away
 *   from the baseline. Its dimensions are {@link COURT}.
 * </ol>
 *
 * <p>Keeping all three conversions here means visual components never
 * transform payloads themselves.
 */

import type { CourtLocation, CourtZone } from "@/types/telemetry";

/**
 * The half-court the Eagle-Eye diagram draws, in metres: a 15 m wide,
 * 11 m deep half court with the rim centred 1.6 m in from the baseline.
 * Every court-space location in the app is expressed against this box, and
 * ShotLocationChart draws its outline from the same numbers, so a shot is
 * plotted where it is classified.
 */
export const COURT = {
  width: 15,
  depth: 11,
  rim: { x: 7.5, y: 1.6 },
} as const;

const METRES_PER_FOOT = 0.3048;

/**
 * Pipeline space (feet, rim-centred) to court space (metres, baseline
 * origin).
 *
 * <p>The y axis flips: the pipeline measures negative y *out onto the
 * court*, while the diagram measures y increasing away from the baseline.
 * Getting that sign wrong mirrors every shot through the rim, which looks
 * plausible enough to miss.
 *
 * <p>Returns null when the pipeline could not determine a position —
 * uncalibrated court, or the shooter not detected at release. Callers must
 * skip those rather than substituting a default; substituting the rim is
 * exactly the defect this replaces, which stacked every shot on one spot.
 */
export function fromPipelineFeet(
  courtXFt: number | null | undefined,
  courtYFt: number | null | undefined,
): CourtLocation | null {
  if (typeof courtXFt !== "number" || typeof courtYFt !== "number") return null;
  if (!Number.isFinite(courtXFt) || !Number.isFinite(courtYFt)) return null;

  /*
   * X is negated.
   *
   * <p>The pipeline's frame is defined by COURT_POINTS in the
   * detector, whose keypoints are labelled from the court's own side
   * -- so its +x is the opposite hand to the +x of a diagram drawn
   * from where the camera stands. Taking the sign straight through
   * put every shot on the wrong side of the floor: a corner three
   * from the left wing appeared on the right.
   *
   * <p>Y needs no flip, only an inversion of direction: the
   * pipeline's +y runs behind the baseline, the diagram's +y runs
   * away from it.
   */
  const x = COURT.rim.x - courtXFt * METRES_PER_FOOT;
  const y = COURT.rim.y - courtYFt * METRES_PER_FOOT;

  // A shot from outside the modelled half-court is real (a heave from the
  // far end), but plotting it outside the diagram is not useful. Clamping
  // to the edge keeps it visible and honest about being at the limit.
  return {
    x: Number(Math.min(COURT.width, Math.max(0, x)).toFixed(2)),
    y: Number(Math.min(COURT.depth, Math.max(0, y)).toFixed(2)),
  };
}

/**
 * The inverse of {@link fromPipelineFeet}: court metres back to the
 * pipeline's rim-centred feet.
 *
 * <p>Needed wherever something has to produce what the detector would
 * have emitted -- a test fixture built from a stored shot. Keeping it
 * beside the forward conversion is the only way the two stay each other's
 * inverse; a second copy of the arithmetic somewhere else is how they
 * drift.
 */
export function toPipelineFeet(location: CourtLocation): { courtXFt: number; courtYFt: number } {
  return {
    courtXFt: (COURT.rim.x - location.x) / METRES_PER_FOOT,
    courtYFt: (COURT.rim.y - location.y) / METRES_PER_FOOT,
  };
}

/** Straight-line distance from the rim, in feet, in pipeline space. */
export function distanceFromRimFt(courtXFt: number, courtYFt: number): number {
  return Math.hypot(courtXFt, courtYFt);
}

/* ------------------------------------------------------------------ *
 * Zone classification
 * ------------------------------------------------------------------ */

/**
 * Geometry of the half-court the diagram draws, in metres. These mirror
 * the shapes in ShotLocationChart so a shot is classified into the zone it
 * visually sits in — if they drift, a shot lands in the paint on screen
 * and reports as mid-range.
 */
const PAINT_HALF_WIDTH = 2.45; // 4.9m key, centred on the rim's x
const PAINT_DEPTH = 5.8;
const THREE_POINT_RADIUS = 6.75;
/** The straight corner sections run to this depth before the arc starts. */
const CORNER_DEPTH = 2.6;
/** Inset of the corner line from each sideline. */
const CORNER_INSET = 0.9;
const FREE_THROW_BAND = 0.75;

/** The four groupings the shot chart filters by. */
export type ShotZoneGroup = "PAINT" | "MID_RANGE" | "CORNER_THREE" | "ABOVE_BREAK_THREE";

export const SHOT_ZONE_GROUPS: { value: ShotZoneGroup; label: string }[] = [
  { value: "PAINT", label: "Paint" },
  { value: "MID_RANGE", label: "Midrange" },
  { value: "CORNER_THREE", label: "Corner three" },
  { value: "ABOVE_BREAK_THREE", label: "Above the break" },
];

function isCorner(location: CourtLocation): boolean {
  return (
    location.y <= CORNER_DEPTH &&
    (location.x <= CORNER_INSET || location.x >= COURT.width - CORNER_INSET)
  );
}

function isThree(location: CourtLocation): boolean {
  if (isCorner(location)) return true;
  return Math.hypot(location.x - COURT.rim.x, location.y - COURT.rim.y) >= THREE_POINT_RADIUS;
}

/** Which of the four filter groups a shot falls in. */
export function zoneGroupOf(location: CourtLocation): ShotZoneGroup {
  if (isThree(location)) {
    return isCorner(location) ? "CORNER_THREE" : "ABOVE_BREAK_THREE";
  }
  const inPaint =
    Math.abs(location.x - COURT.rim.x) <= PAINT_HALF_WIDTH && location.y <= PAINT_DEPTH;
  return inPaint ? "PAINT" : "MID_RANGE";
}

/**
 * The finer-grained zone stored on a shot.
 *
 * <p>Left and right are from the perspective of someone looking at the
 * diagram, which is also how a coach describes them while watching.
 */
export function classifyZone(location: CourtLocation): CourtZone {
  const group = zoneGroupOf(location);
  const side = location.x < COURT.rim.x ? "LEFT" : "RIGHT";

  if (group === "CORNER_THREE") return side === "LEFT" ? "CORNER_LEFT" : "CORNER_RIGHT";

  if (group === "ABOVE_BREAK_THREE") {
    // Straight-on threes are the top of the key; anything meaningfully off
    // centre is a wing.
    if (Math.abs(location.x - COURT.rim.x) <= PAINT_HALF_WIDTH) return "TOP_OF_KEY";
    return side === "LEFT" ? "WING_LEFT" : "WING_RIGHT";
  }

  if (group === "PAINT") {
    return Math.abs(location.y - PAINT_DEPTH) <= FREE_THROW_BAND &&
      Math.abs(location.x - COURT.rim.x) <= PAINT_HALF_WIDTH
      ? "FREE_THROW_LINE"
      : "PAINT";
  }

  if (Math.abs(location.x - COURT.rim.x) <= PAINT_HALF_WIDTH) return "MID_RANGE_CENTER";
  return side === "LEFT" ? "MID_RANGE_LEFT" : "MID_RANGE_RIGHT";
}
