/**
 * Locale resolution and cached `Intl` formatters.
 *
 * <p>Language and regional format are deliberately independent settings:
 * wanting the interface in one language while keeping another region's date
 * and number conventions is ordinary (an English interface with UK dates, a
 * Spanish interface with US dates). Only {@link FormatConfig} -- the
 * regional half -- lives here; the interface language is in i18n.ts.
 *
 * <p>The active config is module-level rather than threaded through React
 * context because the ~110 `fmt*` call sites across the app are plain
 * function calls, not hooks. The provider keeps it in step and remounts the
 * tree when it changes (see SettingsProvider), so nothing can render with a
 * stale locale. Changing region is a rare, deliberate action, which is what
 * makes a remount an acceptable price for leaving every call site alone.
 *
 * <p>`Intl` formatter construction is genuinely expensive -- it is the slow
 * part of `toLocaleDateString`, which is why calling that in a table cell
 * rebuilds a formatter per row. Every formatter here is cached by its full
 * option set.
 */

import type { HourCycle, RegionChoice, UsabilitySettings } from "@/state/settings";

export interface FormatConfig {
  /** Resolved BCP-47 tag for dates, times and numbers. */
  locale: string;
  /** Resolved IANA zone, or undefined to mean the runtime's own. */
  timeZone: string | undefined;
  /** Resolved clock, or undefined to mean whatever the locale prefers. */
  hour12: boolean | undefined;
  /** 0 = Sunday .. 6 = Saturday. */
  firstDayOfWeek: number;
}

/** Used on the server and before the provider has resolved anything. */
export const FALLBACK_LOCALE = "en-US";

export const DEFAULT_FORMAT_CONFIG: FormatConfig = {
  locale: FALLBACK_LOCALE,
  timeZone: undefined,
  hour12: undefined,
  firstDayOfWeek: 0,
};

let active: FormatConfig = DEFAULT_FORMAT_CONFIG;

export function getFormatConfig(): FormatConfig {
  return active;
}

export function setFormatConfig(next: FormatConfig): void {
  active = next;
}

/** The browser's preferred region, or the fallback when there is no browser. */
function systemRegion(): string {
  if (typeof navigator === "undefined") return FALLBACK_LOCALE;
  const tag = navigator.language;
  if (!tag) return FALLBACK_LOCALE;
  try {
    // Reject a tag this runtime cannot actually format with, rather than
    // letting every later format call throw.
    new Intl.DateTimeFormat(tag);
    return tag;
  } catch {
    return FALLBACK_LOCALE;
  }
}

function resolveHour12(cycle: HourCycle): boolean | undefined {
  if (cycle === "h12") return true;
  if (cycle === "h23") return false;
  return undefined;
}

/**
 * Which weekday the calendar grid starts on.
 *
 * <p>`Intl.Locale.getWeekInfo()` is the correct source and is widely
 * supported, but it is recent enough to still be missing in some runtimes,
 * and returns 1-7 with Monday as 1 -- not the 0-6 Sunday-first indexing the
 * rest of the date code uses. The fallback covers only the regions this app
 * offers.
 */
function regionFirstDay(locale: string): number {
  interface WeekInfoCapable {
    getWeekInfo?: () => { firstDay: number };
    weekInfo?: { firstDay: number };
  }
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & WeekInfoCapable;
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info && Number.isFinite(info.firstDay)) {
      // 1 = Monday .. 7 = Sunday  ->  0 = Sunday .. 6 = Saturday
      return info.firstDay % 7;
    }
  } catch {
    // Fall through to the table below.
  }
  const region = locale.split("-")[1]?.toUpperCase();
  if (region === "US" || region === "JP" || region === "CA") return 0;
  return 1;
}

export function resolveFormatConfig(settings: UsabilitySettings): FormatConfig {
  const locale: string =
    settings.regionFormat === "system" ? systemRegion() : (settings.regionFormat as RegionChoice);
  const firstDayOfWeek =
    settings.firstDayOfWeek === "sunday"
      ? 0
      : settings.firstDayOfWeek === "monday"
        ? 1
        : settings.firstDayOfWeek === "saturday"
          ? 6
          : regionFirstDay(locale);

  return {
    locale,
    timeZone: settings.timeZone === "system" ? undefined : settings.timeZone,
    hour12: resolveHour12(settings.hourCycle),
    firstDayOfWeek,
  };
}

/** A string that changes whenever anything about formatting changes. */
export function formatConfigKey(config: FormatConfig): string {
  return `${config.locale}|${config.timeZone ?? ""}|${config.hour12 ?? ""}|${config.firstDayOfWeek}`;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

export function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const config = active;
  const key = `${formatConfigKey(config)}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    const resolved: Intl.DateTimeFormatOptions = { ...options };
    if (config.timeZone) resolved.timeZone = config.timeZone;
    // Only override the locale's own clock when the person asked; passing
    // hour12 explicitly otherwise would override correct locale defaults.
    if (config.hour12 !== undefined && (options.hour || options.timeStyle)) {
      resolved.hour12 = config.hour12;
    }
    try {
      formatter = new Intl.DateTimeFormat(config.locale, resolved);
    } catch {
      formatter = new Intl.DateTimeFormat(FALLBACK_LOCALE, options);
    }
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

export function numberFormatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${active.locale}|${JSON.stringify(options)}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(active.locale, options);
    } catch {
      formatter = new Intl.NumberFormat(FALLBACK_LOCALE, options);
    }
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

/** The list offered in settings, labelled in each region's own convention. */
export const REGION_OPTIONS: { value: RegionChoice; label: string }[] = [
  { value: "system", label: "Use browser setting" },
  { value: "en-US", label: "United States (English)" },
  { value: "en-GB", label: "United Kingdom (English)" },
  { value: "es-ES", label: "España (Español)" },
  { value: "fr-FR", label: "France (Français)" },
  { value: "de-DE", label: "Deutschland (Deutsch)" },
  { value: "ja-JP", label: "日本 (日本語)" },
];

/**
 * A short, representative sample of how the current choices render, for the
 * live preview in settings. Seeing an actual formatted date answers "what
 * does en-GB mean here" far faster than the tag does.
 */
export function formatSample(config: FormatConfig, now: Date = new Date()): string[] {
  const previous = active;
  setFormatConfig(config);
  try {
    return [
      dateFormatter({ dateStyle: "medium" }).format(now),
      dateFormatter({ hour: "2-digit", minute: "2-digit" }).format(now),
      numberFormatter({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1234.5),
    ];
  } finally {
    setFormatConfig(previous);
  }
}

/** IANA zones offered in settings, plus whatever the browser reports. */
export function timeZoneOptions(): string[] {
  const common = [
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "America/Sao_Paulo",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Madrid",
    "Africa/Lagos",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Shanghai",
    "Asia/Tokyo",
    "Australia/Sydney",
    "Pacific/Auckland",
  ];
  try {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local && !common.includes(local)) return [local, ...common];
  } catch {
    // Keep the static list.
  }
  return common;
}
