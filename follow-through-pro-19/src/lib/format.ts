/**
 * Display formatting.
 *
 * <p>Every function here reads the active regional format from intl.ts
 * rather than hard-coding a locale, so changing "Regional format" in
 * settings changes the whole app. The signatures are unchanged from when
 * they were `en-US`-only, which is why the ~110 call sites did not have to
 * move to a hook.
 *
 * <p>Units (feet, seconds) stay in the strings on purpose: the measurement
 * system is an account preference (`UserPreferences.units`), not a
 * consequence of the display locale, and conflating the two would switch
 * someone to metric just for asking for UK date order.
 */

import { dateFormatter, getFormatConfig, numberFormatter } from "@/lib/intl";

export const fmtNumber = (value: number, digits = 0) =>
  numberFormatter({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

export const fmtPercent = (value: number, digits = 1) =>
  numberFormatter({
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value / 100);

/** Shot distance is reported in feet. */
export const fmtDistance = (value: number) => `${fmtNumber(value, 1)} ft`;

/** Shot duration / time to apex, in seconds. */
export const fmtSeconds = (value: number) => `${fmtNumber(value, 2)} s`;

/**
 * Seconds, or an em dash when the value is missing or non-positive.
 *
 * <p>A shot cannot take zero seconds, so a zero is the pipeline not having
 * reported the measurement rather than a measurement of zero. Rendering it
 * as "0.00 s" presents a gap as data, which is worse than admitting the
 * gap — especially on the live screen, where some values only arrive on
 * the frames around a completed shot.
 */
export const fmtSecondsOrUnknown = (value: number | null | undefined) =>
  typeof value === "number" && value > 0 ? fmtSeconds(value) : "—";

/**
 * Distance, or "not recorded".
 *
 * <p>Zero is the sentinel for a distance the pipeline did not report --
 * the same convention the timings use. It needs its own formatter
 * because "0.0 ft" does not read as missing, it reads as *shot from
 * under the rim*, which is the one reading the data must never
 * suggest.
 */
export const fmtDistanceOrUnknown = (value: number | null | undefined) =>
  typeof value === "number" && value > 0 ? fmtDistance(value) : "—";

export const SHOT_TYPE_LABEL: Record<string, string> = {
  LAY_UP: "Lay-up",
  CLS_RNG: "Close range",
  MID_RNG: "Mid range",
  HS_3PT: "HS 3PT",
  NCAA_3PT: "NCAA 3PT",
  NBA_3PT: "NBA 3PT",
};

export const fmtShotType = (value: string) => SHOT_TYPE_LABEL[value] ?? value;

export function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Elapsed time on a media scrubber.
 *
 * <p>Deliberately not localised: this is a duration counting up from zero,
 * not a time of day, so a 12-hour clock or a region's time separator would
 * both be wrong. `h:mm:ss` is the universal convention for this.
 */
export function fmtClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const fmtDate = (iso: string) =>
  dateFormatter({ month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));

export const fmtShortDate = (iso: string) =>
  dateFormatter({ month: "short", day: "numeric" }).format(new Date(iso));

export const fmtTime = (iso: string) =>
  dateFormatter({ hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** "12 March 2025, 14:30" -- a date and time together. */
export const fmtDateTime = (value: string | Date) =>
  dateFormatter({
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(typeof value === "string" ? new Date(value) : value);

/** Calendar header, e.g. "March 2025". */
export const fmtMonthYear = (date: Date) =>
  dateFormatter({ month: "long", year: "numeric" }).format(date);

/** Calendar column heading, e.g. "Wed 12". */
export const fmtWeekdayDay = (date: Date) =>
  dateFormatter({ weekday: "short", day: "numeric" }).format(date);

/** Calendar range label, e.g. "Mar 12". */
export const fmtMonthDay = (date: Date) =>
  dateFormatter({ month: "short", day: "numeric" }).format(date);

/** A relative phrase like "in 3 days" or "2 hours ago". */
export function fmtRelative(target: Date | number, now: Date = new Date()): string {
  const deltaMs = (typeof target === "number" ? target : target.getTime()) - now.getTime();
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  try {
    const rtf = new Intl.RelativeTimeFormat(getFormatConfig().locale, { numeric: "auto" });
    for (const [unit, ms] of units) {
      if (Math.abs(deltaMs) >= ms) return rtf.format(Math.round(deltaMs / ms), unit);
    }
    return rtf.format(Math.round(deltaMs / 1000), "second");
  } catch {
    return fmtDateTime(new Date(typeof target === "number" ? target : target.getTime()));
  }
}

/** The day of the week the calendar grid should start on, 0 = Sunday. */
export const firstDayOfWeek = () => getFormatConfig().firstDayOfWeek;

export const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

/**
 * A number, rounded to at most `places` decimals, with trailing zeros
 * dropped.
 *
 * <p>For values that arrive computed rather than authored. A delta of
 * -0.020000000000000018 is what floating-point subtraction hands you, and
 * printed straight it fills a card with digits nobody asked for. This
 * gives "-0.02", and "9" rather than "9.00" when there is nothing after
 * the point worth showing.
 */
export function fmtRounded(value: number, places = 2): string {
  if (!Number.isFinite(value)) return "—";
  return String(Number(value.toFixed(places)));
}
