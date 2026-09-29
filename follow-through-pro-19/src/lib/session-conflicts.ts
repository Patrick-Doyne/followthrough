import { spanOf } from "@/lib/time-grid";

/**
 * Two training sessions cannot occupy the same time.
 *
 * <p>The calendar can draw an overlap -- it has to, because data
 * written before this rule existed may contain one -- but nothing in
 * the app should create a new one. The check lives here rather than in
 * the form so that the rule is one testable function, and so a second
 * caller later cannot implement it slightly differently.
 */

export interface Scheduled {
  /** yyyy-MM-dd */
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * The session's span in minutes from an arbitrary fixed origin, so
 * sessions on different dates are directly comparable.
 *
 * <p>Absolute rather than minutes-from-midnight because a session that
 * runs past midnight belongs partly to the next date, and comparing it
 * against that date's sessions is the whole reason this is not just a
 * same-day check.
 */
export function absoluteSpan(session: Scheduled): { start: number; end: number } {
  const [y, m, d] = session.date.split("-").map(Number);
  const day = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
  const { start, end } = spanOf(session);
  return { start: day * 1440 + start, end: day * 1440 + end };
}

/**
 * Every session the candidate would collide with.
 *
 * <p>Touching is allowed: a session ending at 10:00 and one starting
 * at 10:00 are back to back, not overlapping, and back-to-back blocks
 * are the normal shape of a training day.
 */
export function findConflicts<T extends Scheduled>(candidate: Scheduled, others: T[]): T[] {
  const a = absoluteSpan(candidate);
  if (a.end <= a.start) return [];
  return others.filter((other) => {
    const b = absoluteSpan(other);
    return a.start < b.end && b.start < a.end;
  });
}
