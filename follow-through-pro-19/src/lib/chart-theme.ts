import { useMemo } from "react";

import { DEFAULT_TRIAD, resolveAllPalettes, type PaletteKey } from "@/lib/theme";
import { paletteKeyFor } from "@/state/settings";
import { useSettings } from "@/state/settings-provider";

/**
 * Chart palette, resolved from the design tokens at runtime.
 *
 * <p>Recharts writes SVG **presentation attributes**, which cannot resolve
 * `var()`. So the colours have to reach it as literal strings, which is why
 * they were previously hard-coded here — and why every chart in the app
 * rendered dark-theme colours regardless of the theme, ignoring light and
 * high-contrast completely.
 *
 * <p>The values come from the same resolved palette the document's
 * tokens are written from, not from `getComputedStyle`. Reading the
 * document was the obvious implementation and it has two faults now
 * that the tokens are registered with `@property` and animate: a read
 * taken while a cross-fade is running samples a colour part-way
 * through it, and the read has to be deferred to a microtask, which
 * costs an extra render. Deriving the palette makes it a pure value
 * that lands in the same commit as everything else.
 *
 * <p>That the derived palette equals the rendered one is not an
 * assumption: `resolveAllPalettes(DEFAULT_TRIAD)` reproduces all 51
 * tokens in styles.css exactly, which theme.test.ts asserts for every
 * palette.
 *
 * <p>Hand-authored SVG does **not** need this — there, Tailwind's
 * `fill-*`/`stroke-*` utilities resolve tokens normally. See
 * ShotLocationChart, which uses classes.
 */

export interface ChartPalette {
  primary: string;
  secondary: string;
  tertiary: string;
  make: string;
  miss: string;
  warn: string;
  grid: string;
  axis: string;
  court: string;
  surface: string;
}

/**
 * Which theme token backs each palette entry, by its name without the
 * leading dashes -- the key the resolved palettes are stored under.
 *
 * <p>Every entry follows the theme, data colours included. That was briefly
 * not true: the series were frozen so a make would be one green everywhere.
 * The call went the other way in the end, on the condition that meaning
 * never rests on the colour alone -- every chart names its marks in an
 * interactive legend, so a swatch that changes with the theme still says
 * what it is. See `ChartLegend`.
 */
const TOKEN_FOR: Record<keyof ChartPalette, string> = {
  primary: "chart-1",
  secondary: "chart-2",
  tertiary: "chart-4",
  make: "make",
  miss: "miss",
  warn: "warn",
  grid: "grid",
  axis: "muted-foreground",
  court: "court-line",
  surface: "surface",
};

/** The palettes a user who never opened the picker is looking at. */
const DEFAULT_PALETTES = resolveAllPalettes(DEFAULT_TRIAD);

/**
 * Used on the server and for the first paint before hydration, where
 * `getComputedStyle` does not exist. These are the dark theme's values,
 * which is the default, so the fallback is never visibly wrong.
 */
export const CHART_FALLBACK: ChartPalette = {
  primary: "oklch(0.72 0.166 52)",
  secondary: "oklch(0.72 0.13 220)",
  tertiary: "oklch(0.75 0.14 300)",
  make: "oklch(0.72 0.16 155)",
  miss: "oklch(0.57 0.183 27)",
  warn: "oklch(0.78 0.15 85)",
  grid: "oklch(0.3 0.01 258)",
  axis: "oklch(0.715 0.023 257)",
  court: "oklch(0.42 0.012 258)",
  surface: "oklch(0.217 0.011 261)",
};

function paletteFrom(tokens: Record<string, string>): ChartPalette {
  const entries = Object.entries(TOKEN_FOR) as [keyof ChartPalette, string][];
  const resolved = {} as ChartPalette;
  for (const [key, token] of entries) {
    resolved[key] = tokens[token] ?? CHART_FALLBACK[key];
  }
  return resolved;
}

/**
 * The palette for the theme currently applied to the document.
 *
 * <p>Recomputes when anything that can change a token changes: the theme
 * itself, high contrast, and the user's accent when that lands. Those all
 * flow through the settings provider, so its values are the trigger.
 */
export function useChartTheme(): ChartPalette {
  const { settings, resolvedTheme, hydrated } = useSettings();
  const { themeTokens, highContrast } = settings;

  return useMemo(() => {
    // Before hydration the document is still on whatever the boot
    // script wrote, and the stored settings are not in hand yet.
    if (!hydrated) return CHART_FALLBACK;
    const key: PaletteKey = paletteKeyFor(resolvedTheme, highContrast);
    // Null means the default triad, where the tokens are removed from
    // the root and the stylesheet's own values apply.
    return paletteFrom(themeTokens?.[key] ?? DEFAULT_PALETTES[key]);
  }, [hydrated, resolvedTheme, highContrast, themeTokens]);
}

/** Axis styling derived from the active palette. */
export function useAxisProps() {
  const chart = useChartTheme();
  return useMemo(
    () => ({
      stroke: chart.axis,
      tick: { fill: chart.axis, fontSize: 11 },
      tickLine: false,
      axisLine: { stroke: chart.grid },
    }),
    [chart],
  );
}
