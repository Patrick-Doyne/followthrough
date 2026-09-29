import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contrastRatio, formatOklch, parseOklch, type Oklch } from "@/lib/color";
import { DEFAULT_TRIAD, PALETTE_KEYS, resolveTheme } from "@/lib/theme";

/**
 * WCAG contrast checks for every palette, measured from styles.css itself.
 *
 * <p>Colour tokens are the easiest thing in a design system to regress:
 * nudging one lightness to make a panel look better can quietly drop every
 * piece of secondary text below the readable threshold, and nothing fails.
 * Parsing the shipped stylesheet rather than duplicating values here means
 * the test measures what actually ships.
 *
 * <p>The maths lives in `src/lib/color.ts` rather than inline, so that this
 * file and anything that generates colours cannot drift apart. An earlier
 * inline version double-applied the sRGB transfer function and reported mid
 * grey on white as 13.4:1 instead of 4.5:1 — wrong in the direction that
 * hides failures on light surfaces and invents them on dark ones.
 */

const CSS = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

type Tokens = Record<string, Oklch>;

function block(selector: string): Tokens {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Tolerates a selector list: the accent blocks are emitted with both a
  // root form and a descendant form so a swatch can scope one locally,
  // and an exact-match regex silently found nothing for those.
  const match = new RegExp(`${escaped}\\s*(?:,[^{]*)?\\{(.*?)\\n\\}`, "s").exec(CSS);
  if (!match?.[1]) return {};
  const tokens: Tokens = {};
  for (const [, name, value] of match[1].matchAll(
    /--([\w-]+):\s*(oklch\([^)]*\))\s*;/g,
  ) as Iterable<RegExpMatchArray>) {
    const parsed = name && value ? parseOklch(value) : null;
    if (name && parsed) tokens[name] = parsed;
  }
  return tokens;
}

function contrast(tokens: Tokens, fg: string, bg: string): number {
  const a = tokens[fg];
  const b = tokens[bg];
  if (!a || !b) throw new Error(`missing token: ${!a ? fg : bg}`);
  return contrastRatio(a, b);
}

const dark = block(":root");
const light = { ...dark, ...block(":root.light") };
const darkHigh = { ...dark, ...block(':root[data-contrast="high"]') };
const lightHigh = {
  ...light,
  ...block(':root[data-contrast="high"]'),
  ...block(':root.light[data-contrast="high"]'),
};

const PALETTES: [string, Tokens][] = [
  ["dark", dark],
  ["light", light],
  ["dark high-contrast", darkHigh],
  ["light high-contrast", lightHigh],
];

/** 4.5:1, the AA threshold for body-sized text. */
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  // Every block of text in a chart card now sits on a tier rather than
  // straight on the card, so the same floors have to hold there.
  ["foreground", "tier"],
  ["muted-foreground", "tier"],
  ["primary-foreground", "primary"],
  ["destructive-foreground", "destructive"],
  ["miss-foreground", "miss"],
  ["make-foreground", "make"],
  ["sidebar-foreground", "sidebar"],
];

/**
 * 3:1, the AA threshold for UI component boundaries and focus indicators
 * (WCAG 1.4.11). `border` is excluded deliberately — it draws decorative
 * separation between panels, which the rule does not cover. `input`
 * outlines a real control, so it does.
 */
const UI_PAIRS: [string, string][] = [
  ["input", "background"],
  ["input", "card"],
  ["ring", "background"],
  ["primary", "background"],
  ["primary", "card"],
  ["make", "card"],
  ["miss", "card"],
  ["primary", "tier"],
  ["make", "tier"],
  ["miss", "tier"],
];

describe.each(PALETTES)("%s palette", (_name, tokens) => {
  it("defines every token the checks reference", () => {
    for (const [fg, bg] of [...TEXT_PAIRS, ...UI_PAIRS]) {
      expect(tokens[fg], fg).toBeDefined();
      expect(tokens[bg], bg).toBeDefined();
    }
  });

  it.each(TEXT_PAIRS)("text: %s on %s reaches 4.5:1", (fg, bg) => {
    expect(contrast(tokens, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)("ui: %s on %s reaches 3:1", (fg, bg) => {
    expect(contrast(tokens, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

/*
 * The accent-preset blocks that used to be asserted here are gone. The
 * theme is three user-chosen colours now, resolved in src/lib/theme.ts,
 * so "does every reachable accent stay legible" is a sweep over the
 * colour space rather than a check of seven committed CSS blocks. It
 * lives in theme.test.ts.
 */

describe("settings surface", () => {
  /**
   * The five section shades are declared statically in styles.css so a
   * user on the default theme needs no inline properties at all, and
   * they are also produced by resolveTheme for everyone else. Two
   * sources for one set of values, so they are checked against each
   * other rather than each being trusted.
   */
  it("the static section colour matches what the resolver produces", () => {
    // On :root, not on [data-settings] -- see the note there.
    const declared = block(":root");
    const resolved = resolveTheme(DEFAULT_TRIAD, "dark");
    for (const name of ["sec", "sec-on"]) {
      expect(declared[name], `--${name} is missing from styles.css`).toBeDefined();
      expect(formatOklch(declared[name]!), `--${name}`).toBe(resolved[name]);
    }
  });

  it("the static hero tokens match what the resolver produces", () => {
    const declared = block(":root");
    const resolved = resolveTheme(DEFAULT_TRIAD, "dark");
    for (const name of ["hero", "hero-2", "hero-fg", "hero-muted", "hero-art"]) {
      expect(declared[name], `--${name} is missing from styles.css`).toBeDefined();
      expect(formatOklch(declared[name]!), `--${name}`).toBe(resolved[name]);
    }
  });

  it("hero text clears both ends of the gradient, in every palette", () => {
    // The band is a gradient, so text has to survive the lighter stop as
    // well as the darker one -- checking only --hero would pass a
    // --hero-2 that text disappeared into.
    for (const key of PALETTE_KEYS) {
      const t = resolveTheme(DEFAULT_TRIAD, key);
      for (const stop of ["hero", "hero-2"] as const) {
        expect(
          contrastRatio(parseOklch(t["hero-fg"]!)!, parseOklch(t[stop]!)!),
          `hero-fg on ${stop} (${key})`,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(parseOklch(t["hero-muted"]!)!, parseOklch(t[stop]!)!),
          `hero-muted on ${stop} (${key})`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    // The jersey plate is --primary on the hero, not on the page ground.
    expect(contrastRatio(dark["primary-foreground"]!, dark["primary"]!)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
