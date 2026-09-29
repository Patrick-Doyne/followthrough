// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHART_FALLBACK, useAxisProps, useChartTheme } from "@/lib/chart-theme";
import { DEFAULT_TRIAD, resolveAllPalettes, type ThemeTriad } from "@/lib/theme";

/**
 * Charts must follow the theme, marks included.
 *
 * <p>Before this, every chart rendered dark-theme colours no
 * matter the theme, because the palette was a hard-coded mirror of the
 * tokens. Light mode and high contrast were silently ignored — and a
 * high-contrast user got the palette specifically tuned *not* to be high
 * contrast.
 *
 * <p>The palette is derived from the settings the document's tokens are
 * written from, not read back off the document. Reading the document
 * cannot work now that the tokens animate: a read taken during a
 * cross-fade samples a colour part-way through it. That the derived
 * palette matches the rendered one is asserted in theme.test.ts, which
 * checks `resolveAllPalettes(DEFAULT_TRIAD)` against styles.css.
 */

const CUSTOM: ThemeTriad = { ...DEFAULT_TRIAD, accent: "oklch(0.72 0.14 200)" };

let mockSettings: {
  highContrast: boolean;
  themeTokens: Record<string, Record<string, string>> | null;
};
let mockTheme: "light" | "dark";
let mockHydrated: boolean;
vi.mock("@/state/settings-provider", () => ({
  useSettings: () => ({
    settings: mockSettings,
    resolvedTheme: mockTheme,
    hydrated: mockHydrated,
  }),
}));

function readPalette(): Record<string, string> {
  let palette: Record<string, string> = {};
  function Probe() {
    palette = useChartTheme() as unknown as Record<string, string>;
    return null;
  }
  render(<Probe />);
  return palette;
}

beforeEach(() => {
  mockSettings = { highContrast: false, themeTokens: null };
  mockTheme = "dark";
  mockHydrated = true;
});
afterEach(cleanup);

describe("useChartTheme", () => {
  it("uses the palette the default theme actually renders", () => {
    const expected = resolveAllPalettes(DEFAULT_TRIAD).dark;
    const palette = readPalette();
    expect(palette["primary"]).toBe(expected["chart-1"]);
    expect(palette["make"]).toBe(expected["make"]);
    expect(palette["axis"]).toBe(expected["muted-foreground"]);
  });

  it("follows a theme the user picked, data colours included", () => {
    // The regression guard. The palette used to depend only on the
    // light/dark choice and high contrast, so choosing a different accent
    // repainted the whole app and left every chart on the old one.
    //
    // The data colours were briefly frozen so a make would be one green
    // everywhere; that was reversed, on the condition that no chart relies
    // on colour to carry meaning. Every chart now names its marks in a
    // legend drawn in the live colour -- see ChartLegend.
    const before = readPalette()["primary"];
    cleanup();

    mockSettings = { highContrast: false, themeTokens: resolveAllPalettes(CUSTOM) };
    const after = readPalette();

    expect(after["primary"]).not.toBe(before);
    expect(after["primary"]).toBe(resolveAllPalettes(CUSTOM).dark["chart-1"]);
    expect(after["make"]).toBe(resolveAllPalettes(CUSTOM).dark["make"]);
  });

  it("follows light, dark and high contrast", () => {
    const dark = readPalette()["grid"];
    cleanup();

    mockTheme = "light";
    const light = readPalette()["grid"];
    cleanup();

    mockTheme = "dark";
    mockSettings = { highContrast: true, themeTokens: null };
    const highContrast = readPalette()["grid"];

    expect(new Set([dark, light, highContrast]).size).toBe(3);
  });

  it("falls back before hydration, where the stored theme is not in hand", () => {
    // SSR and the pre-hydration paint. The fallback is the dark theme,
    // which is also the default, so it is never visibly wrong.
    mockHydrated = false;
    expect(readPalette()["grid"]).toBe(CHART_FALLBACK.grid);
  });

  it("falls back for a token the palette does not carry", () => {
    mockSettings = { highContrast: false, themeTokens: { dark: {} } as never };
    expect(readPalette()["grid"]).toBe(CHART_FALLBACK.grid);
  });

  it("produces something usable as an SVG paint value", () => {
    // Recharts writes presentation attributes, which cannot resolve var().
    // A value of "var(--chart-1)" here would render nothing at all.
    for (const [key, value] of Object.entries(readPalette())) {
      expect(value, key).not.toContain("var(");
      expect(value.length, key).toBeGreaterThan(0);
    }
  });
});

describe("useAxisProps", () => {
  it("derives axis styling from the active palette", () => {
    let props: { stroke?: string } = {};
    function AxisProbe() {
      props = useAxisProps();
      return null;
    }
    render(<AxisProbe />);
    expect(props.stroke).toBe(resolveAllPalettes(DEFAULT_TRIAD).dark["muted-foreground"]);
  });
});
