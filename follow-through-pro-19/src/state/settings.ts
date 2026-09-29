/**
 * Usability preferences: the typed schema, its defaults, its migrations, and
 * the functions that apply them to the document.
 *
 * <p>This is the single settings store the whole app reads from. It holds
 * everything describing how the product should look and behave for one
 * person -- theme, text size, density, motion, language, regional formats,
 * captions, feedback, safety nets, keyboard shortcuts -- as one versioned,
 * typed document.
 *
 * <p>It is persisted to localStorage first so it applies before the first
 * paint with no network round trip, then synced to the account when signed
 * in (see settings-sync.ts) so it follows the person across devices.
 *
 * <p>{@link applyDocumentChrome} is intentionally free of React and of any
 * DOM API beyond `documentElement`, because it runs twice: once from an
 * inline script in the HTML shell before React has loaded, and again from
 * the provider whenever a setting changes. Both paths must produce identical
 * attributes or the page would visibly correct itself on hydration; a test
 * sweeps every combination to enforce that.
 */

import { isStorableMark } from "@/lib/brand-mark";
import { formatOklch, parseOklch } from "@/lib/color";
import {
  DEFAULT_TRIAD,
  isDefaultTriad,
  resolveAllPalettes,
  THEME_TOKEN_NAMES,
  type PaletteKey,
  type ThemeTriad,
} from "@/lib/theme";
import type { PanelSizes } from "@/lib/overlay-panels";

export const SETTINGS_STORAGE_KEY = "followthrough.usability";

/**
 * Bump when the shape changes, and extend {@link migrateSettings}.
 *
 * <p>v1: theme, textScale, density, highContrast, motion, autoplayVideo,
 * focusOnRouteChange, announceRouteChange.
 * <p>v2: adds reading mode, captions, sound/haptics, toast duration, undo,
 * session timeout, language/region/time zone, notification delivery and
 * keyboard shortcuts.
 * <p>v3: adds the accent colour.
 * <p>v4: replaces the accent preset id with a three-colour theme
 * (accent, base, neutral) plus the palettes resolved from it.
 * <p>v5: adds the brand mark.
 * <p>v6: adds the video overlay's panel layout.
 * <p>v7: keeps only the panels' sizes. Their positions turned out to
 * belong to the recording rather than to the viewer -- see
 * useOverlayPanels -- so they are worked out per playback instead.
 */
export const SETTINGS_VERSION = 7;

export type ThemeChoice = "light" | "dark" | "system";

/**
 * The hues the v3 accent presets stood for.
 *
 * <p>Kept only so a document written before the three-colour theme lands
 * on the colour its owner chose rather than being reset to orange.
 */
const LEGACY_ACCENT_HUE: Record<string, number> = {
  rim: 52,
  hardwood: 75,
  lane: 27,
  net: 190,
  baseline: 250,
  jersey: 300,
  chalk: 150,
};
export type MotionChoice = "system" | "reduce" | "full";
export type Density = "compact" | "comfortable" | "spacious";
export type TextScale = "base" | "large" | "larger" | "largest";
export type CaptionSize = "small" | "medium" | "large" | "xlarge";
export type CaptionFont = "sans" | "serif" | "mono" | "dyslexic";
export type CaptionColor = "white" | "yellow" | "cyan" | "green";
export type CaptionBackground = "none" | "solid" | "translucent" | "outline";
export type ToastDuration = "short" | "normal" | "long" | "sticky";
export type LanguageChoice = "system" | "en" | "es" | "fr" | "de";
export type RegionChoice = "system" | "en-US" | "en-GB" | "es-ES" | "fr-FR" | "de-DE" | "ja-JP";
export type FirstDayOfWeek = "region" | "sunday" | "monday" | "saturday";
export type HourCycle = "region" | "h12" | "h23";
export type DigestFrequency = "off" | "daily" | "weekly" | "monthly";

export interface UsabilitySettings {
  version: number;

  // -- Appearance ------------------------------------------------------
  theme: ThemeChoice;
  /**
   * The three colours the whole palette is built from. The default
   * reproduces the stylesheet exactly, so an untouched account sees the
   * product's own colours and nothing is written inline.
   */
  themeColors: ThemeTriad;
  /**
   * Those three colours resolved into all four palettes, or null while
   * the triad is the default one.
   *
   * <p>Persisted rather than recomputed because the render-blocking boot
   * script has to apply the theme before first paint and must not run the
   * resolver. Storing the result means the boot script and
   * {@link applyDocumentChrome} read the same object instead of running
   * the same algorithm twice, which is the only way the two stay
   * byte-identical as the resolver changes.
   */
  themeTokens: Record<PaletteKey, Record<string, string>> | null;
  /**
   * The logo on the settings name plate, as a data URL, or null for the
   * FollowThrough mark.
   *
   * <p>Stored beside the theme because it is the other half of the same
   * thing: this is where an account says whose it is. Always a
   * rasterised 192px thumbnail produced by
   * {@link prepareBrandMark} -- never the file the user picked, which is
   * routinely hundreds of kilobytes and would have to be carried in
   * every settings write.
   */
  brandMark: string | null;
  textScale: TextScale;
  density: Density;
  highContrast: boolean;
  motion: MotionChoice;
  /** Hides navigation chrome and narrows body text to a reading measure. */
  readingMode: boolean;

  // -- Media -----------------------------------------------------------
  autoplayVideo: boolean;
  captionsEnabled: boolean;
  captionSize: CaptionSize;
  captionFont: CaptionFont;
  captionColor: CaptionColor;
  captionBackground: CaptionBackground;
  /** Background opacity percentage, 0-100. Ignored when there is none. */
  captionOpacity: number;

  // -- Feedback --------------------------------------------------------
  soundEnabled: boolean;
  /** 0-100. */
  soundVolume: number;
  hapticsEnabled: boolean;
  toastDuration: ToastDuration;

  // -- Safety nets -----------------------------------------------------
  /** Perform destructive actions immediately with an undo window, instead
   * of interrupting with a confirmation dialog first. */
  undoInsteadOfConfirm: boolean;
  undoWindowSeconds: number;
  autoSaveDrafts: boolean;

  // -- Navigation and screen readers -----------------------------------
  focusOnRouteChange: boolean;
  announceRouteChange: boolean;

  // -- Session ---------------------------------------------------------
  /** Minutes of inactivity before sign-out. 0 disables the timeout. */
  sessionTimeoutMinutes: number;
  /** How long the warning shows before the timeout fires. */
  sessionWarningSeconds: number;

  // -- Language and region ---------------------------------------------
  /** Interface language. Deliberately separate from `regionFormat`: wanting
   * the interface in one language while keeping another region's date and
   * number conventions is common and normal. */
  language: LanguageChoice;
  /** Locale used for dates, times and numbers only. */
  regionFormat: RegionChoice;
  /** IANA zone, or "system". */
  timeZone: string;
  firstDayOfWeek: FirstDayOfWeek;
  hourCycle: HourCycle;

  // -- Notification delivery -------------------------------------------
  quietHoursEnabled: boolean;
  /** "HH:MM", 24-hour, in the person's own time zone. */
  quietHoursStart: string;
  quietHoursEnd: string;
  /** Epoch ms until which all notifications are suppressed, or null. */
  snoozedUntil: number | null;
  digestFrequency: DigestFrequency;
  /** How many delivered notifications to retain for the history panel. */
  notificationHistoryLimit: number;

  // -- Keyboard --------------------------------------------------------
  /** Command id -> key combo. Only overrides are stored; anything absent
   * uses the command's default, so newly added commands ship working. */
  shortcuts: Record<string, string>;
  /**
   * How big the video overlay's two panels are drawn, or null for the
   * default size.
   *
   * <p>Size only. Where the panels go is decided per recording, from that
   * recording's own telemetry, because the rim is on the left in one clip
   * and the right in the next -- so a remembered position would only ever
   * be accidentally right. How big they should be is about the viewer's
   * screen rather than the footage, so that part does follow them, into
   * live sessions included.
   */
  overlayPanelSizes: PanelSizes | null;
}

export const DEFAULT_SETTINGS: UsabilitySettings = {
  version: SETTINGS_VERSION,

  // "system" for theme, motion, language and region so the OS and browser
  // choices win out of the box. Most people never open a settings page, so
  // the untouched default has to already be the accessible, correct one.
  theme: "system",
  themeColors: DEFAULT_TRIAD,
  themeTokens: null,
  brandMark: null,
  overlayPanelSizes: null,
  textScale: "base",
  density: "comfortable",
  highContrast: false,
  motion: "system",
  readingMode: false,

  autoplayVideo: false,
  captionsEnabled: false,
  captionSize: "medium",
  captionFont: "sans",
  captionColor: "white",
  captionBackground: "translucent",
  captionOpacity: 75,

  soundEnabled: false,
  soundVolume: 50,
  hapticsEnabled: true,
  toastDuration: "normal",

  // Undo by default: a confirmation dialog interrupts every action to guard
  // against the rare mistake, while undo costs nothing until one happens.
  undoInsteadOfConfirm: true,
  undoWindowSeconds: 8,
  autoSaveDrafts: true,

  focusOnRouteChange: true,
  announceRouteChange: true,

  // Off by default. An unexpected sign-out mid-session is worse for most
  // people than the risk it mitigates; those who need it can opt in.
  sessionTimeoutMinutes: 0,
  sessionWarningSeconds: 60,

  language: "system",
  regionFormat: "system",
  timeZone: "system",
  firstDayOfWeek: "region",
  hourCycle: "region",

  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  snoozedUntil: null,
  digestFrequency: "weekly",
  notificationHistoryLimit: 50,

  shortcuts: {},
};

/** Root font size per step. Everything in the app is sized in rem, so this
 * one value rescales the entire layout rather than just body copy. */
/*
 * The root font size each step sets, in px.
 *
 * <p>`base` is 20 rather than the browser's 16. Almost everything in
 * the app is sized in rem -- including `--spacing`, which every
 * padding and gap derives from -- so the root size is the app's
 * overall scale, and 16 left the interface small and spread out on a
 * laptop. 20 is 16 x 1.25, which puts the default where the app
 * looked right at 125% browser zoom.
 *
 * <p>The other steps keep their ratios to base (1.125, 1.25, 1.5), so
 * the text-size setting still means the same thing relative to it.
 */
export const TEXT_SCALE_PX: Record<TextScale, number> = {
  base: 20,
  large: 22.5,
  larger: 25,
  largest: 30,
};

/** Milliseconds a toast stays up. "sticky" never auto-dismisses, which is
 * what someone using a screen reader or a switch device often needs, since
 * a four-second window can easily expire before the toast is even reached. */
export const TOAST_DURATION_MS: Record<ToastDuration, number> = {
  short: 2000,
  normal: 4000,
  long: 10000,
  sticky: Infinity,
};

const THEMES: ThemeChoice[] = ["light", "dark", "system"];
const MOTIONS: MotionChoice[] = ["system", "reduce", "full"];
const DENSITIES: Density[] = ["compact", "comfortable", "spacious"];
const TEXT_SCALES: TextScale[] = ["base", "large", "larger", "largest"];
const CAPTION_SIZES: CaptionSize[] = ["small", "medium", "large", "xlarge"];
const CAPTION_FONTS: CaptionFont[] = ["sans", "serif", "mono", "dyslexic"];
const CAPTION_COLORS: CaptionColor[] = ["white", "yellow", "cyan", "green"];
const CAPTION_BACKGROUNDS: CaptionBackground[] = ["none", "solid", "translucent", "outline"];
const TOAST_DURATIONS: ToastDuration[] = ["short", "normal", "long", "sticky"];
const LANGUAGES: LanguageChoice[] = ["system", "en", "es", "fr", "de"];
const REGIONS: RegionChoice[] = ["system", "en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "ja-JP"];
const FIRST_DAYS: FirstDayOfWeek[] = ["region", "sunday", "monday", "saturday"];
const HOUR_CYCLES: HourCycle[] = ["region", "h12", "h23"];
const DIGESTS: DigestFrequency[] = ["off", "daily", "weekly", "monthly"];

function oneOf<T extends string>(allowed: T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** "HH:MM" on a 24-hour clock, or the fallback. */
function timeOfDay(value: unknown, fallback: string): string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

/** An IANA zone this runtime actually knows, or "system". */
function knownTimeZone(value: unknown, fallback: string): string {
  if (value === "system") return "system";
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    // A zone this runtime does not recognise would throw on every format
    // call, so it must not be allowed into the store.
    return fallback;
  }
}

/** A flat string->string map, ignoring any entry that is not one. */
function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    // Guard against prototype keys arriving from a hand-edited payload.
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (typeof entry === "string" && entry.length > 0) out[key] = entry;
  }
  return out;
}

/**
 * Coerces whatever is in storage (or on the server) into a valid settings
 * object.
 *
 * <p>Written defensively rather than trusting the stored shape: this data
 * outlives deploys, so it may have been written by an older build, edited by
 * hand, or truncated. An unreadable value falls back to the default for that
 * one field instead of discarding the whole object, so a single bad key
 * cannot reset everything else the person chose. That per-field coercion is
 * also what makes most version upgrades free: a field added in a later
 * version simply takes its default when reading an older document.
 */
/**
 * The panels' stored sizes, or null.
 *
 * <p>Checked rather than trusted, like everything else here: this
 * document is hand-editable and arrives from the account, and a NaN
 * reaching the renderer would size a panel to nothing. Anything malformed
 * falls back to null, which means "use the default size" rather than
 * losing other settings.
 *
 * <p>Also reads a v6 document, which stored whole placements. Only the
 * scales survive the upgrade -- the positions are now worked out per
 * recording -- and taking them across means a viewer who had already
 * sized the panels does not find them back at the default.
 */
function readPanelSizes(stored: Record<string, unknown>): PanelSizes | null {
  const size = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "object" && value !== null) {
      const scale = (value as Record<string, unknown>)["scale"];
      if (typeof scale === "number" && Number.isFinite(scale) && scale > 0) return scale;
    }
    return null;
  };
  const source = (stored["overlayPanelSizes"] ?? stored["overlayPanels"]) as unknown;
  if (typeof source !== "object" || source === null) return null;
  const record = source as Record<string, unknown>;
  const summary = size(record["summary"]);
  const tracker = size(record["tracker"]);
  return summary !== null && tracker !== null ? { summary, tracker } : null;
}

export function migrateSettings(raw: unknown): UsabilitySettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const stored = raw as Record<string, unknown>;

  // v1 -> v2 and v2 -> v3 added fields only, with no renames, so the
  // field-wise coercion below covers both: any field missing from an older
  // document takes its default. A future version that renames or re-scales
  // a field branches on stored["version"] here, before the coercion.
  return {
    version: SETTINGS_VERSION,

    theme: oneOf(THEMES, stored["theme"], DEFAULT_SETTINGS.theme),
    ...readThemeColors(stored),
    // Re-validated on the way out of storage, not just on the way in: a
    // settings document is hand-editable and arrives from the account,
    // so what ends up in an `img` src has to be checked here.
    brandMark: isStorableMark(stored["brandMark"]) ? stored["brandMark"] : null,
    overlayPanelSizes: readPanelSizes(stored),
    textScale: oneOf(TEXT_SCALES, stored["textScale"], DEFAULT_SETTINGS.textScale),
    density: oneOf(DENSITIES, stored["density"], DEFAULT_SETTINGS.density),
    highContrast: bool(stored["highContrast"], DEFAULT_SETTINGS.highContrast),
    motion: oneOf(MOTIONS, stored["motion"], DEFAULT_SETTINGS.motion),
    readingMode: bool(stored["readingMode"], DEFAULT_SETTINGS.readingMode),

    autoplayVideo: bool(stored["autoplayVideo"], DEFAULT_SETTINGS.autoplayVideo),
    captionsEnabled: bool(stored["captionsEnabled"], DEFAULT_SETTINGS.captionsEnabled),
    captionSize: oneOf(CAPTION_SIZES, stored["captionSize"], DEFAULT_SETTINGS.captionSize),
    captionFont: oneOf(CAPTION_FONTS, stored["captionFont"], DEFAULT_SETTINGS.captionFont),
    captionColor: oneOf(CAPTION_COLORS, stored["captionColor"], DEFAULT_SETTINGS.captionColor),
    captionBackground: oneOf(
      CAPTION_BACKGROUNDS,
      stored["captionBackground"],
      DEFAULT_SETTINGS.captionBackground,
    ),
    captionOpacity: clampInt(stored["captionOpacity"], 0, 100, DEFAULT_SETTINGS.captionOpacity),

    soundEnabled: bool(stored["soundEnabled"], DEFAULT_SETTINGS.soundEnabled),
    soundVolume: clampInt(stored["soundVolume"], 0, 100, DEFAULT_SETTINGS.soundVolume),
    hapticsEnabled: bool(stored["hapticsEnabled"], DEFAULT_SETTINGS.hapticsEnabled),
    toastDuration: oneOf(TOAST_DURATIONS, stored["toastDuration"], DEFAULT_SETTINGS.toastDuration),

    undoInsteadOfConfirm: bool(
      stored["undoInsteadOfConfirm"],
      DEFAULT_SETTINGS.undoInsteadOfConfirm,
    ),
    undoWindowSeconds: clampInt(
      stored["undoWindowSeconds"],
      3,
      30,
      DEFAULT_SETTINGS.undoWindowSeconds,
    ),
    autoSaveDrafts: bool(stored["autoSaveDrafts"], DEFAULT_SETTINGS.autoSaveDrafts),

    focusOnRouteChange: bool(stored["focusOnRouteChange"], DEFAULT_SETTINGS.focusOnRouteChange),
    announceRouteChange: bool(stored["announceRouteChange"], DEFAULT_SETTINGS.announceRouteChange),

    sessionTimeoutMinutes: clampInt(
      stored["sessionTimeoutMinutes"],
      0,
      480,
      DEFAULT_SETTINGS.sessionTimeoutMinutes,
    ),
    sessionWarningSeconds: clampInt(
      stored["sessionWarningSeconds"],
      15,
      300,
      DEFAULT_SETTINGS.sessionWarningSeconds,
    ),

    language: oneOf(LANGUAGES, stored["language"], DEFAULT_SETTINGS.language),
    regionFormat: oneOf(REGIONS, stored["regionFormat"], DEFAULT_SETTINGS.regionFormat),
    timeZone: knownTimeZone(stored["timeZone"], DEFAULT_SETTINGS.timeZone),
    firstDayOfWeek: oneOf(FIRST_DAYS, stored["firstDayOfWeek"], DEFAULT_SETTINGS.firstDayOfWeek),
    hourCycle: oneOf(HOUR_CYCLES, stored["hourCycle"], DEFAULT_SETTINGS.hourCycle),

    quietHoursEnabled: bool(stored["quietHoursEnabled"], DEFAULT_SETTINGS.quietHoursEnabled),
    quietHoursStart: timeOfDay(stored["quietHoursStart"], DEFAULT_SETTINGS.quietHoursStart),
    quietHoursEnd: timeOfDay(stored["quietHoursEnd"], DEFAULT_SETTINGS.quietHoursEnd),
    snoozedUntil:
      typeof stored["snoozedUntil"] === "number" && Number.isFinite(stored["snoozedUntil"])
        ? stored["snoozedUntil"]
        : null,
    digestFrequency: oneOf(DIGESTS, stored["digestFrequency"], DEFAULT_SETTINGS.digestFrequency),
    notificationHistoryLimit: clampInt(
      stored["notificationHistoryLimit"],
      10,
      500,
      DEFAULT_SETTINGS.notificationHistoryLimit,
    ),

    shortcuts: stringMap(stored["shortcuts"]),
  };
}

export function loadSettings(): UsabilitySettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return migrateSettings(JSON.parse(raw));
  } catch {
    // Private browsing, disabled site data, or corrupt JSON. Defaults are a
    // perfectly good app; failing to read preferences must never be fatal.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: UsabilitySettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked -- the in-memory setting still applies for this
    // session, it just will not survive a reload.
  }
}

/** Resolves the "follow the OS" choices into concrete values. */
export function resolveTheme(theme: ThemeChoice): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof matchMedia !== "function") return "dark";
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveMotion(motion: MotionChoice): "reduce" | "full" {
  if (motion !== "system") return motion;
  if (typeof matchMedia !== "function") return "full";
  return matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "full";
}

/**
 * Writes the settings that affect the very first paint onto the root
 * element.
 *
 * <p>Kept deliberately narrow: this is the exact set the inline boot script
 * duplicates, so anything added here must be added there too, and a test
 * enforces that. Settings that cannot cause a flash -- caption styling,
 * sound, shortcuts -- are applied by the provider instead, via
 * {@link applyCaptionStyle}.
 */
/**
 * Reads the three-colour theme out of a stored document, whatever
 * version wrote it.
 *
 * <p>A v3 document has an accent preset id instead. Rather than dropping
 * it, the id is mapped back to the hue it stood for, so someone who
 * chose violet keeps violet; the base and neutral they never had a say
 * over take the defaults.
 *
 * <p>The resolved palettes are recomputed here rather than trusted from
 * storage. They are a pure function of the triad, so recomputing costs
 * nothing and means a change to the resolver reaches existing accounts
 * on their next load instead of leaving them on a stale palette.
 */
function readThemeColors(
  stored: Record<string, unknown>,
): Pick<UsabilitySettings, "themeColors" | "themeTokens"> {
  const triad = coerceTriad(stored["themeColors"]) ?? legacyTriad(stored["accent"]);
  return {
    themeColors: triad,
    themeTokens: isDefaultTriad(triad) ? null : resolveAllPalettes(triad),
  };
}

/** Accepts only three parseable oklch strings; anything else is junk from
 * a hand-edited document and falls back rather than half-applying. */
function coerceTriad(value: unknown): ThemeTriad | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const parts = (["accent", "base", "neutral"] as const).map((k) => {
    const v = raw[k];
    return typeof v === "string" ? parseOklch(v) : null;
  });
  if (parts.some((p) => p === null)) return null;
  return {
    accent: formatOklch(parts[0]!),
    base: formatOklch(parts[1]!),
    neutral: formatOklch(parts[2]!),
  };
}

function legacyTriad(accent: unknown): ThemeTriad {
  const hue = typeof accent === "string" ? LEGACY_ACCENT_HUE[accent] : undefined;
  if (hue === undefined) return DEFAULT_TRIAD;
  return { ...DEFAULT_TRIAD, accent: formatOklch({ l: 0.72, c: 0.166, h: hue }) };
}

/**
 * Writes or clears the resolved palette on the root element.
 *
 * <p>Always one or the other, never a partial update: going back to the
 * default theme has to remove every property a custom one set, or the
 * stylesheet's own values stay shadowed by whatever was there before.
 */
export function applyThemeTokens(root: HTMLElement, tokens: Record<string, string> | null): void {
  for (const name of THEME_TOKEN_NAMES) {
    const value = tokens?.[name];
    if (value) root.style.setProperty(`--${name}`, value);
    else root.style.removeProperty(`--${name}`);
  }
}

/** How long the whole-document colour cross-fade runs for. Matches
 * THEME_SHIFT_MS in styles.css. */
export const THEME_SHIFT_MS = 300;

const THEME_SHIFT_CLASS = "theme-shifting";
let themeShiftTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Cross-fades the document from one palette to the next.
 *
 * <p>Changing a theme colour replaces around fifty custom properties at
 * once, and without this every surface, border and label in the app
 * changes in a single frame. It is correct and it looks like a glitch.
 *
 * <p>A class rather than a permanent transition on the tokens
 * themselves: colour transitions on every element are not something to
 * leave switched on during navigation and scrolling, and custom
 * properties are not animatable without `@property` declarations for
 * each one. Adding the class for the length of the fade and taking it
 * off again keeps the cost to the moment it buys something.
 *
 * <p>Deliberately not called from {@link applyDocumentChrome}: that
 * runs on first paint too, where there is no previous palette to fade
 * from, and its output is held byte-identical to the boot script's.
 */
export function beginThemeShift(root: HTMLElement): void {
  if (typeof window === "undefined") return;
  // The people who asked not to be shown motion are also the people for
  // whom a full-page colour fade is worst.
  if (root.dataset["motion"] === "reduce") return;
  root.classList.add(THEME_SHIFT_CLASS);
  clearTimeout(themeShiftTimer);
  themeShiftTimer = setTimeout(() => root.classList.remove(THEME_SHIFT_CLASS), THEME_SHIFT_MS);
}

export function paletteKeyFor(theme: "dark" | "light", highContrast: boolean): PaletteKey {
  if (theme === "dark") return highContrast ? "darkHigh" : "dark";
  return highContrast ? "lightHigh" : "light";
}

export function applyDocumentChrome(root: HTMLElement, settings: UsabilitySettings): void {
  const theme = resolveTheme(settings.theme);
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;

  root.dataset["density"] = settings.density;
  root.dataset["contrast"] = settings.highContrast ? "high" : "normal";
  root.dataset["motion"] = resolveMotion(settings.motion);
  root.dataset["reading"] = settings.readingMode ? "on" : "off";
  applyThemeTokens(
    root,
    settings.themeTokens?.[paletteKeyFor(theme, settings.highContrast)] ?? null,
  );
  root.style.fontSize = `${TEXT_SCALE_PX[settings.textScale]}px`;
}

const CAPTION_SIZE_REM: Record<CaptionSize, string> = {
  small: "0.9rem",
  medium: "1.15rem",
  large: "1.5rem",
  xlarge: "2rem",
};

const CAPTION_FONT_STACK: Record<CaptionFont, string> = {
  sans: "var(--font-sans)",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "var(--font-mono)",
  // No webfont is shipped for this; the stack names the common OpenDyslexic
  // install names and falls back to Verdana, which is still a clear change
  // in letterforms from the default UI face for anyone without it.
  dyslexic: "'OpenDyslexic', 'Open Dyslexic', Verdana, sans-serif",
};

const CAPTION_TEXT_COLOR: Record<CaptionColor, string> = {
  white: "#ffffff",
  yellow: "#ffe81a",
  cyan: "#3ff0ff",
  green: "#7dff6b",
};

/**
 * Publishes caption styling as custom properties for the `::cue` rules in
 * styles.css. Separate from {@link applyDocumentChrome} because captions
 * cannot cause a flash, so the boot script does not need to know about them.
 */
export function applyCaptionStyle(root: HTMLElement, settings: UsabilitySettings): void {
  const alpha = Math.min(100, Math.max(0, settings.captionOpacity)) / 100;
  const background =
    settings.captionBackground === "solid"
      ? `rgba(0, 0, 0, ${alpha})`
      : settings.captionBackground === "translucent"
        ? `rgba(0, 0, 0, ${alpha * 0.7})`
        : "transparent";
  // An outline is the readable option over bright video, where any box would
  // obscure the picture.
  const shadow =
    settings.captionBackground === "outline"
      ? "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 0 6px #000"
      : "none";

  root.style.setProperty("--caption-size", CAPTION_SIZE_REM[settings.captionSize]);
  root.style.setProperty("--caption-font", CAPTION_FONT_STACK[settings.captionFont]);
  root.style.setProperty("--caption-color", CAPTION_TEXT_COLOR[settings.captionColor]);
  root.style.setProperty("--caption-background", background);
  root.style.setProperty("--caption-shadow", shadow);
}

/**
 * Whether notifications should be suppressed right now.
 *
 * <p>Quiet hours are evaluated in the person's chosen time zone rather than
 * the device's, so "no alerts after 22:00" keeps meaning their 22:00 when
 * they travel. A window whose end is before its start (22:00 to 07:00)
 * wraps midnight, which is the common case and easy to get wrong.
 */
export function isQuietNow(settings: UsabilitySettings, now: Date = new Date()): boolean {
  if (settings.snoozedUntil !== null && now.getTime() < settings.snoozedUntil) return true;
  if (!settings.quietHoursEnabled) return false;

  const zone = settings.timeZone === "system" ? undefined : settings.timeZone;
  let minutes: number;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      ...(zone ? { timeZone: zone } : {}),
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    minutes = hour * 60 + minute;
  } catch {
    minutes = now.getHours() * 60 + now.getMinutes();
  }

  const [startH = 0, startM = 0] = settings.quietHoursStart.split(":").map(Number);
  const [endH = 0, endM = 0] = settings.quietHoursEnd.split(":").map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;

  // Equal start and end means a zero-length window, not an all-day one.
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
