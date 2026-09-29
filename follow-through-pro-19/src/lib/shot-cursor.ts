import type { Shot } from "@/types/telemetry";

/**
 * Which shots have happened yet, at a given point in a session.
 *
 * <p>The one piece replay and live share. A recorded video hands it
 * the playhead; a live session hands it "now". Both get the same
 * answer, so the charts and the court view have one behaviour rather
 * than one for each source.
 *
 * <p>Everything here **derives** from the cursor rather than
 * accumulating as it moves. Accumulating looks equivalent until
 * someone scrubs backwards, at which point the shots they have
 * rewound past are still marked as taken -- and on the live side,
 * until a reconnect backfills shots that arrive out of order.
 */

/** A shot with no offset cannot be placed on the timeline at all. */
export function hasOffset(shot: Shot): boolean {
  return typeof shot.videoOffset === "number" && Number.isFinite(shot.videoOffset);
}

/**
 * True once the playhead has reached the shot.
 *
 * <p>A shot with no offset counts as taken: it is a real shot that the
 * pipeline could not place in time, and hiding it would silently drop
 * data from the totals. It simply never ghosts.
 */
export function isTakenBy(shot: Shot, cursorSeconds: number): boolean {
  if (!hasOffset(shot)) return true;
  return (shot.videoOffset as number) <= cursorSeconds;
}

export interface ShotSplit {
  /** In the order given. */
  taken: Shot[];
  upcoming: Shot[];
}

export function splitByCursor(shots: Shot[], cursorSeconds: number): ShotSplit {
  const taken: Shot[] = [];
  const upcoming: Shot[] = [];
  for (const shot of shots) (isTakenBy(shot, cursorSeconds) ? taken : upcoming).push(shot);
  return { taken, upcoming };
}

export interface Tally {
  attempts: number;
  makes: number;
  /** 0-100, and 0 when nothing has been attempted -- not NaN. */
  percentage: number;
}

export function tallyOf(shots: Shot[]): Tally {
  const attempts = shots.length;
  const makes = shots.filter((shot) => shot.result === "MAKE").length;
  return { attempts, makes, percentage: attempts === 0 ? 0 : (makes / attempts) * 100 };
}

/** The running figures at the cursor, beside the session's own. */
export function tallyAt(shots: Shot[], cursorSeconds: number): Tally {
  return tallyOf(splitByCursor(shots, cursorSeconds).taken);
}

/**
 * The shot the playhead is sitting on, if any.
 *
 * <p>`window` is how long after its offset a shot stays "current" --
 * long enough to read the caption, short enough that two shots are
 * never both current. The closest one wins when they overlap.
 */
export function shotAt(shots: Shot[], cursorSeconds: number, window = 3): Shot | null {
  let best: Shot | null = null;
  let bestDistance = Infinity;
  for (const shot of shots) {
    if (!hasOffset(shot)) continue;
    const distance = cursorSeconds - (shot.videoOffset as number);
    if (distance < 0 || distance > window) continue;
    if (distance < bestDistance) {
      best = shot;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The offsets at which the set of taken shots changes.
 *
 * <p>Shots are discrete and sparse -- roughly one a minute -- so
 * nothing needs to be recomputed per frame. A consumer can quantise
 * the playhead to these boundaries and re-render at most once per
 * shot for the whole session.
 */
export function cursorBoundaries(shots: Shot[]): number[] {
  const offsets = shots.filter(hasOffset).map((shot) => shot.videoOffset as number);
  return [...new Set(offsets)].sort((a, b) => a - b);
}

/**
 * The last boundary at or before the cursor, or -1 before the first.
 *
 * <p>Quantising to this and using it as the cursor means a component
 * re-renders when a shot lands, not sixty times a second while the
 * answer stays the same.
 */
export function quantiseCursor(cursorSeconds: number, boundaries: number[]): number {
  let quantised = -1;
  for (const boundary of boundaries) {
    if (boundary > cursorSeconds) break;
    quantised = boundary;
  }
  return quantised;
}

export interface ProgressPoint {
  shot: Shot;
  /** Where it sits on the timeline, in seconds. */
  at: number;
  attempts: number;
  makes: number;
  /** Running percentage *after* this shot, 0-100. */
  percentage: number;
}

/**
 * The session as it accumulated: the running percentage after each
 * shot, in order.
 *
 * <p>This is the series behind "did I get better or worse as the
 * session went on", which a distribution chart cannot answer. Shared
 * with live for the same reason the rest of this file is -- a live
 * session is this series with fewer points so far.
 *
 * <p>Shots with no offset are dropped rather than piled at zero:
 * they cannot be placed on a time axis, and putting them at the start
 * would invent a run of attempts that never happened.
 */
export function progressSeries(shots: Shot[]): ProgressPoint[] {
  const placed = shots
    .filter(hasOffset)
    .slice()
    .sort((a, b) => (a.videoOffset as number) - (b.videoOffset as number));

  let attempts = 0;
  let makes = 0;
  return placed.map((shot) => {
    attempts += 1;
    if (shot.result === "MAKE") makes += 1;
    return {
      shot,
      at: shot.videoOffset as number,
      attempts,
      makes,
      percentage: (makes / attempts) * 100,
    };
  });
}
