import { firstDayOfWeek, fmtMonthDay, fmtMonthYear } from "@/lib/format";
import { dateFormatter } from "@/lib/intl";

/**
 * Which slice of the calendar is on screen, and the date arithmetic
 * that goes with it.
 *
 * <p>In `lib` rather than beside the grid because the band above the
 * calendar states the period and the controls that move it, so the
 * same logic is needed in two places -- and because date stepping
 * across month ends and week starts is worth having tests for.
 */
export type CalendarView = "MONTH" | "WEEK" | "DAY";

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Rolls back to the first day of the week, honouring the person's
 * "first day of week" setting. The modulo keeps the offset positive when
 * the week starts on a later weekday than today (e.g. a Saturday-first
 * week viewed on a Tuesday).
 */
export function startOfWeek(date: Date): Date {
  return addDays(date, -((date.getDay() - firstDayOfWeek() + 7) % 7));
}

/**
 * Weekday column headings in the active locale, rotated so the grid starts
 * on the configured first day. 2024-01-07 is a Sunday, so adding the index
 * walks Sunday..Saturday.
 */
export function weekdayHeadings(): string[] {
  const formatter = dateFormatter({ weekday: "short" });
  const start = firstDayOfWeek();
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(2024, 0, 7 + ((start + i) % 7))),
  );
}

/** What period is on screen, phrased for whichever view is open. */
export function calendarPeriodLabel(view: CalendarView, cursor: Date): string {
  if (view === "MONTH") return fmtMonthYear(cursor);
  if (view === "WEEK") return `Week of ${fmtMonthDay(startOfWeek(cursor))}`;
  return dateFormatter({ weekday: "long", month: "long", day: "numeric" }).format(cursor);
}

/**
 * One step forward or back, in whatever unit the current view is in.
 *
 * <p>Month stepping uses `setMonth`, which clamps: stepping back from
 * 31 March lands on 28 February rather than rolling into March again.
 */
export function stepPeriod(view: CalendarView, cursor: Date, direction: number): Date {
  if (view !== "MONTH") return addDays(cursor, direction * (view === "WEEK" ? 7 : 1));
  const d = new Date(cursor);
  d.setDate(1);
  d.setMonth(d.getMonth() + direction);
  return d;
}
