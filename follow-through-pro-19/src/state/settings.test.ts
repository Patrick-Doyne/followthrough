import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { settingsBootScript } from "@/lib/settings-boot";
import { DEFAULT_TRIAD, resolveAllPalettes, type ThemeTriad } from "@/lib/theme";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  SETTINGS_VERSION,
  applyDocumentChrome,
  isQuietNow,
  migrateSettings,
  type Density,
  type MotionChoice,
  type TextScale,
  type ThemeChoice,
  type UsabilitySettings,
} from "@/state/settings";

/** The observable result of applying settings, for comparing the two paths. */
interface AppliedState {
  classes: string[];
  colorScheme: string;
  fontSize: string;
  density: string;
  contrast: string;
  motion: string;
  reading: string;
  /** Every CSS custom property the theme wrote, which is the part the
   * boot script and applyDocumentChrome most easily disagree about. */
  properties: Record<string, string>;
}

/**
 * The subset of an HTMLElement that applyDocumentChrome and the boot script
 * touch. A stub rather than jsdom because both paths only ever write --
 * there is no layout or cascade to simulate, and the tests run in node.
 */
function makeRoot() {
  const classes = new Set<string>();
  return {
    classList: {
      toggle(name: string, force: boolean) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    // setProperty/removeProperty are real here, not props on a bag: the
    // three-colour theme is applied through them, so a stub that
    // silently swallowed the calls would let the two paths diverge with
    // the parity test still green.
    style: {
      properties: {} as Record<string, string>,
      setProperty(name: string, value: string) {
        this.properties[name] = value;
      },
      removeProperty(name: string) {
        delete this.properties[name];
      },
    } as Record<string, string> & {
      properties: Record<string, string>;
      setProperty(name: string, value: string): void;
      removeProperty(name: string): void;
    },
    dataset: {} as Record<string, string>,
    snapshot(): AppliedState {
      return {
        classes: [...classes].sort(),
        colorScheme: this.style["colorScheme"] ?? "",
        fontSize: this.style["fontSize"] ?? "",
        density: this.dataset["density"] ?? "",
        contrast: this.dataset["contrast"] ?? "",
        motion: this.dataset["motion"] ?? "",
        reading: this.dataset["reading"] ?? "",
        properties: { ...this.style.properties },
      };
    },
  };
}

/** Runs the inline boot script against a stubbed browser. */
function runBootScript(stored: string | null, prefersLight: boolean, prefersReduce: boolean) {
  const root = makeRoot();
  runInNewContext(settingsBootScript(), {
    document: { documentElement: root },
    localStorage: {
      getItem: (key: string) => (key === SETTINGS_STORAGE_KEY ? stored : null),
    },
    matchMedia: (query: string) => ({
      matches: query.includes("prefers-color-scheme: light") ? prefersLight : prefersReduce,
    }),
  });
  return root.snapshot();
}

/** Applies settings the way the provider does, with the OS stubbed. */
function runApply(settings: UsabilitySettings, prefersLight: boolean, prefersReduce: boolean) {
  const root = makeRoot();
  const original = globalThis.matchMedia;
  globalThis.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-color-scheme: light") ? prefersLight : prefersReduce,
  })) as typeof globalThis.matchMedia;
  try {
    applyDocumentChrome(root as unknown as HTMLElement, settings);
  } finally {
    globalThis.matchMedia = original;
  }
  return root.snapshot();
}

const THEMES: ThemeChoice[] = ["light", "dark", "system"];
const MOTIONS: MotionChoice[] = ["system", "reduce", "full"];
const DENSITIES: Density[] = ["compact", "comfortable", "spacious"];
const TEXT_SCALES: TextScale[] = ["base", "large", "larger", "largest"];
/**
 * Two is enough to prove the theme is carried across: the default, which
 * writes nothing because the stylesheet already says it, and a custom
 * triad, which writes every token. Those are the two branches. Sweeping
 * the colour space belongs in theme.test.ts, which does it.
 */
const TRIADS: (ThemeTriad | null)[] = [
  null,
  { accent: "oklch(0.7 0.18 190)", base: "oklch(0.2 0.05 300)", neutral: "oklch(0.6 0.04 120)" },
];

describe("boot script / applyDocumentChrome equivalence", () => {
  // The boot script necessarily duplicates applyDocumentChrome's logic,
  // because a render-blocking inline script cannot import a module. If the
  // two ever disagree, the page corrects itself visibly on hydration --
  // exactly the flash the boot script exists to prevent. This test is what
  // keeps them honest, so it sweeps the whole matrix rather than
  // spot-checking, and it is the reason a new pre-paint setting cannot be
  // added to one path only.
  const cases: UsabilitySettings[] = [];
  for (const theme of THEMES) {
    for (const motion of MOTIONS) {
      for (const density of DENSITIES) {
        for (const textScale of TEXT_SCALES) {
          for (const highContrast of [true, false]) {
            for (const readingMode of [true, false]) {
              for (const triad of TRIADS) {
                cases.push({
                  ...DEFAULT_SETTINGS,
                  theme,
                  motion,
                  density,
                  textScale,
                  highContrast,
                  readingMode,
                  themeColors: triad ?? DEFAULT_TRIAD,
                  themeTokens: triad ? resolveAllPalettes(triad) : null,
                });
              }
            }
          }
        }
      }
    }
  }

  for (const prefersLight of [true, false]) {
    for (const prefersReduce of [true, false]) {
      it(`matches for every setting (OS light=${prefersLight}, reduce=${prefersReduce})`, () => {
        for (const settings of cases) {
          const expected = runApply(settings, prefersLight, prefersReduce);
          const actual = runBootScript(JSON.stringify(settings), prefersLight, prefersReduce);
          expect(actual, `settings: ${JSON.stringify(settings)}`).toEqual(expected);
        }
      });
    }
  }
});

describe("boot script resilience", () => {
  // The boot script is render-blocking: an uncaught throw here would leave
  // the page unstyled, so it must survive anything storage hands it.
  const hostile = [
    null,
    "",
    "not json",
    "null",
    "[]",
    '"a string"',
    "42",
    '{"theme":"neon"}',
    '{"textScale":"enormous","density":7,"highContrast":"yes","motion":null}',
    '{"__proto__":{"polluted":true}}',
  ];

  for (const stored of hostile) {
    it(`falls back to sane values for ${JSON.stringify(stored)}`, () => {
      const state = runBootScript(stored, false, false);
      expect(state.classes).toEqual(["dark"]);
      expect(state.colorScheme).toBe("dark");
      expect(state.motion).toBe("full");
      expect(state.reading).toBe("off");
      expect(state.properties).toEqual({});
      // An unrecognised scale must not produce "undefinedpx".
      expect(state.fontSize === "" || /^\d+px$/.test(state.fontSize)).toBe(true);
    });
  }
});

describe("migrateSettings", () => {
  it("returns defaults for anything that is not an object", () => {
    for (const raw of [null, undefined, 42, "x", true]) {
      expect(migrateSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("upgrades a v1 document by defaulting every field v1 never had", () => {
    // This is the real upgrade path for anyone who used the app before the
    // v2 settings shipped: their stored document has eight of thirty-odd
    // fields, and none of the others may come back undefined.
    const v1 = {
      version: 1,
      theme: "light",
      textScale: "large",
      density: "compact",
      highContrast: true,
      motion: "reduce",
      autoplayVideo: true,
      focusOnRouteChange: false,
      announceRouteChange: false,
    };

    const result = migrateSettings(v1);

    expect(result.version).toBe(SETTINGS_VERSION);
    // The v1 choices survive.
    expect(result.theme).toBe("light");
    expect(result.textScale).toBe("large");
    expect(result.density).toBe("compact");
    expect(result.highContrast).toBe(true);
    expect(result.motion).toBe("reduce");
    expect(result.autoplayVideo).toBe(true);
    expect(result.focusOnRouteChange).toBe(false);
    // Everything new takes its default, and nothing is undefined.
    expect(result.language).toBe(DEFAULT_SETTINGS.language);
    expect(result.captionSize).toBe(DEFAULT_SETTINGS.captionSize);
    expect(result.shortcuts).toEqual({});
    expect(result.themeColors).toEqual(DEFAULT_SETTINGS.themeColors);
    expect(result.themeTokens).toBeNull();
    expect(result.brandMark).toBeNull();
    for (const [key, value] of Object.entries(result)) {
      expect(value, `field ${key} must not be undefined`).not.toBeUndefined();
    }
  });

  it("keeps valid fields when a sibling field is invalid", () => {
    const result = migrateSettings({
      theme: "light",
      textScale: "bogus",
      density: "spacious",
      highContrast: "nope",
      motion: "reduce",
    });
    expect(result.theme).toBe("light");
    expect(result.density).toBe("spacious");
    expect(result.motion).toBe("reduce");
    expect(result.textScale).toBe(DEFAULT_SETTINGS.textScale);
    expect(result.highContrast).toBe(DEFAULT_SETTINGS.highContrast);
  });

  it("clamps numbers into their allowed range instead of rejecting them", () => {
    const result = migrateSettings({
      captionOpacity: 500,
      soundVolume: -20,
      undoWindowSeconds: 9999,
      sessionTimeoutMinutes: -5,
      sessionWarningSeconds: 1,
      notificationHistoryLimit: 100000,
    });
    expect(result.captionOpacity).toBe(100);
    expect(result.soundVolume).toBe(0);
    expect(result.undoWindowSeconds).toBe(30);
    expect(result.sessionTimeoutMinutes).toBe(0);
    expect(result.sessionWarningSeconds).toBe(15);
    expect(result.notificationHistoryLimit).toBe(500);
  });

  it("rejects a time zone this runtime cannot format with", () => {
    // Letting one through would make every date in the app throw.
    expect(migrateSettings({ timeZone: "Mars/Olympus_Mons" }).timeZone).toBe("system");
    expect(migrateSettings({ timeZone: "Europe/London" }).timeZone).toBe("Europe/London");
    expect(migrateSettings({ timeZone: "system" }).timeZone).toBe("system");
  });

  it("rejects malformed quiet-hours times", () => {
    expect(migrateSettings({ quietHoursStart: "25:00" }).quietHoursStart).toBe("22:00");
    expect(migrateSettings({ quietHoursStart: "7:00" }).quietHoursStart).toBe("22:00");
    expect(migrateSettings({ quietHoursStart: "07:30" }).quietHoursStart).toBe("07:30");
  });

  it("does not let a stored shortcuts map pollute the prototype", () => {
    const result = migrateSettings({
      shortcuts: { "nav.live": "alt+9", __proto__: "alt+0", bad: 42 },
    });
    expect(result.shortcuts).toEqual({ "nav.live": "alt+9" });
    expect(({} as Record<string, unknown>)["__proto__"]).not.toBe("alt+0");
  });

  it("round-trips a full valid object", () => {
    const settings: UsabilitySettings = {
      ...DEFAULT_SETTINGS,
      theme: "light",
      textScale: "largest",
      density: "compact",
      highContrast: true,
      motion: "reduce",
      readingMode: true,
      autoplayVideo: true,
      captionsEnabled: true,
      captionSize: "xlarge",
      language: "es",
      regionFormat: "en-GB",
      timeZone: "Europe/London",
      shortcuts: { "nav.live": "alt+9" },
    };
    expect(migrateSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });
});

describe("isQuietNow", () => {
  const base: UsabilitySettings = {
    ...DEFAULT_SETTINGS,
    quietHoursEnabled: true,
    timeZone: "UTC",
  };
  const at = (hhmm: string) => new Date(`2025-03-12T${hhmm}:00Z`);

  it("is inactive when quiet hours are off", () => {
    expect(isQuietNow({ ...base, quietHoursEnabled: false }, at("23:00"))).toBe(false);
  });

  it("covers a window that wraps midnight", () => {
    // 22:00 to 07:00 is the common case and the easy one to get wrong: a
    // naive start <= now < end comparison reports quiet all day.
    const settings = { ...base, quietHoursStart: "22:00", quietHoursEnd: "07:00" };
    expect(isQuietNow(settings, at("23:30"))).toBe(true);
    expect(isQuietNow(settings, at("03:00"))).toBe(true);
    expect(isQuietNow(settings, at("06:59"))).toBe(true);
    expect(isQuietNow(settings, at("07:00"))).toBe(false);
    expect(isQuietNow(settings, at("12:00"))).toBe(false);
    expect(isQuietNow(settings, at("21:59"))).toBe(false);
    expect(isQuietNow(settings, at("22:00"))).toBe(true);
  });

  it("covers a window inside one day", () => {
    const settings = { ...base, quietHoursStart: "09:00", quietHoursEnd: "17:00" };
    expect(isQuietNow(settings, at("08:59"))).toBe(false);
    expect(isQuietNow(settings, at("09:00"))).toBe(true);
    expect(isQuietNow(settings, at("16:59"))).toBe(true);
    expect(isQuietNow(settings, at("17:00"))).toBe(false);
  });

  it("treats an equal start and end as a zero-length window, not all day", () => {
    const settings = { ...base, quietHoursStart: "09:00", quietHoursEnd: "09:00" };
    expect(isQuietNow(settings, at("09:00"))).toBe(false);
    expect(isQuietNow(settings, at("21:00"))).toBe(false);
  });

  it("evaluates the window in the chosen time zone, not the device's", () => {
    // 10:00 UTC is 06:00 in New York (EDT on this date), so the same
    // instant falls outside a 22:00-07:00 window for a UTC user and inside
    // it for a New York one. Reading the device clock would get one wrong.
    const utc = { ...base, timeZone: "UTC", quietHoursStart: "22:00", quietHoursEnd: "07:00" };
    const newYork = { ...utc, timeZone: "America/New_York" };
    expect(isQuietNow(utc, at("10:00"))).toBe(false);
    expect(isQuietNow(newYork, at("10:00"))).toBe(true);
  });

  it("suppresses everything while snoozed, regardless of quiet hours", () => {
    const now = at("12:00");
    const snoozed = {
      ...base,
      quietHoursEnabled: false,
      snoozedUntil: now.getTime() + 60_000,
    };
    expect(isQuietNow(snoozed, now)).toBe(true);
    // ...and stops the moment it expires.
    expect(isQuietNow({ ...snoozed, snoozedUntil: now.getTime() - 1 }, now)).toBe(false);
  });
});

describe("the brand mark is re-validated on the way out of storage", () => {
  // The settings document is hand-editable and arrives from the account,
  // so a stored mark is untrusted input that ends up in an `img` src.
  it("keeps a rasterised data URL", () => {
    const mark = "data:image/webp;base64,UklGRhoAAABXRUJQ";
    expect(migrateSettings({ brandMark: mark }).brandMark).toBe(mark);
  });

  it("drops anything else, including SVG", () => {
    for (const value of [
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "https://example.com/crest.png",
      "javascript:alert(1)",
      42,
      {},
    ]) {
      expect(migrateSettings({ brandMark: value }).brandMark, String(value)).toBeNull();
    }
  });
});
