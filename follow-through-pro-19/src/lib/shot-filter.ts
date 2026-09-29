import type { Shot } from "@/types/telemetry";

/**
 * The analytics filters, applied client-side.
 *
 * <p>These used to be query parameters on `GET /analytics/shots`. That
 * endpoint does not exist on the backend -- it answers 404 "No such
 * endpoint" -- and the shots themselves now come from each video's own
 * telemetry, the same source the session and video pages read. Once the
 * shots are already in hand, filtering them here is both cheaper and the
 * only way to keep the three pages agreeing about what a session contains.
 *
 * <p>Deliberately one tested function rather than a `.filter()` inline in
 * the route, so that a second caller cannot implement the date bounds or
 * the "ALL" sentinel slightly differently.
 */

export interface ShotFilter {
  /** "ALL" means every session. */
  sessionId?: string;
  /** Inclusive, an ISO date. */
  from?: string;
  /** Inclusive to the end of that day, an ISO date. */
  to?: string;
  result?: string;
  shotType?: string;
  zone?: string;
}

/** The sentinel every one of the filter selects uses for "no filter". */
const ALL = "ALL";

export function filterShots(shots: Shot[], filter: ShotFilter): Shot[] {
  const from = filter.from ? new Date(filter.from).getTime() : null;
  // To the end of the named day, not to midnight at its start -- otherwise
  // picking the same date for both bounds would match nothing.
  const to = filter.to ? new Date(`${filter.to.slice(0, 10)}T23:59:59.999Z`).getTime() : null;

  return shots.filter((shot) => {
    if (filter.sessionId && filter.sessionId !== ALL && shot.sessionId !== filter.sessionId) {
      return false;
    }
    if (filter.result && filter.result !== ALL && shot.result !== filter.result) return false;
    if (filter.shotType && filter.shotType !== ALL && shot.shotType !== filter.shotType) {
      return false;
    }
    // A shot the pipeline could not place has no zone at all, so a zone
    // filter excludes it rather than matching it by accident.
    if (filter.zone && filter.zone !== ALL && shot.zone !== filter.zone) return false;

    if (from !== null || to !== null) {
      const time = new Date(shot.timestamp).getTime();
      if (Number.isNaN(time)) return false;
      if (from !== null && time < from) return false;
      if (to !== null && time > to) return false;
    }
    return true;
  });
}
