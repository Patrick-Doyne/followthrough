import { describe, expect, it } from "vitest";

import {
  applyFrame,
  makeFreshPersistentState,
  renderOverlayFromPersistent,
  setOverlayAccent,
} from "@/lib/overlay-renderer";
import { DEFAULT_TRIAD, THEME_PRESETS } from "@/lib/theme";
import type { FrameTelemetry } from "@/types/overlay-telemetry";

/**
 * Proof that the theme reaches the pixels.
 *
 * <p>The first attempt at this wired every accent through a lookup and
 * still drew orange, because four of them were hoisted into module-level
 * constants: a `const` is evaluated once at import, before any theme has
 * been applied, so the rotation never reached the thing doing the
 * drawing. Nothing short of recording what the renderer actually assigns
 * to the canvas catches that.
 */

/** A canvas context that records the colours it is asked to paint with. */
function recordingContext() {
  const colours: string[] = [];
  const noop = () => undefined;
  const target: Record<string, unknown> = {
    canvas: { width: 3840, height: 2160 },
    measureText: () => ({ width: 100 }),
    createLinearGradient: () => ({ addColorStop: (_: number, c: string) => colours.push(c) }),
    createRadialGradient: () => ({ addColorStop: (_: number, c: string) => colours.push(c) }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop as string];
      return noop;
    },
    set(obj, prop, value) {
      if (
        (prop === "fillStyle" || prop === "strokeStyle" || prop === "shadowColor") &&
        typeof value === "string"
      ) {
        colours.push(value);
      }
      obj[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, colours };
}

/** Enough of a frame for the renderer to draw its panels and marks. */
const FRAME = {
  type: "frame",
  frame_id: 10,
  frame_width: 3840,
  frame_height: 2160,
  potential_shot: false,
  shot_started: false,
  trail_frozen_at_rim: false,
  ball: { center_x: 1900, center_y: 700, x1: 1870, y1: 670, x2: 1930, y2: 730 },
  player: { x1: 1500, y1: 900, x2: 1700, y2: 1600 },
  rim: { x1: 1900, y1: 500, x2: 2100, y2: 560, center_x: 2000, center_y: 530 },
  net: null,
  player_distance_ft: 18.4,
  shot_designation: "MID_RNG",
} as unknown as FrameTelemetry;

function paint(): string[] {
  const state = makeFreshPersistentState();
  applyFrame(state, FRAME);
  const { ctx, colours } = recordingContext();
  renderOverlayFromPersistent(ctx, state);
  return colours;
}

describe("overlay theming reaches the canvas", () => {
  it("paints something at all, or the rest of this proves nothing", () => {
    setOverlayAccent(DEFAULT_TRIAD.accent, DEFAULT_TRIAD.accent);
    expect(paint().length).toBeGreaterThan(10);
  });

  it("draws the shipped theme exactly as the artwork was approved", () => {
    setOverlayAccent(DEFAULT_TRIAD.accent, DEFAULT_TRIAD.accent);
    const first = paint();
    setOverlayAccent(DEFAULT_TRIAD.accent, DEFAULT_TRIAD.accent);
    expect(paint()).toEqual(first);
  });

  it("actually repaints when the theme changes", () => {
    setOverlayAccent(DEFAULT_TRIAD.accent, DEFAULT_TRIAD.accent);
    const orange = paint();

    const red = THEME_PRESETS.find((p) => p.label === "Lane red");
    setOverlayAccent(red!.triad.accent, DEFAULT_TRIAD.accent);
    const lane = paint();

    expect(lane).not.toEqual(orange);
    // and the overlay's signature accent is no longer the shipped orange
    expect(orange).toContain("#ff8c00");
    expect(lane).not.toContain("#ff8c00");
  });

  it("changes for every preset that is not the shipped one", () => {
    setOverlayAccent(DEFAULT_TRIAD.accent, DEFAULT_TRIAD.accent);
    const base = paint().join("|");

    for (const preset of THEME_PRESETS) {
      setOverlayAccent(preset.triad.accent, DEFAULT_TRIAD.accent);
      const painted = paint().join("|");
      if (preset.triad.accent === DEFAULT_TRIAD.accent) {
        expect(painted, preset.label).toBe(base);
      } else {
        expect(painted, preset.label).not.toBe(base);
      }
    }
  });

  it("leaves the neutral chrome alone whatever the theme", () => {
    // The panel body and its text are the dark surface the overlay sits
    // on, not brand, and must not rotate with the accent.
    const red = THEME_PRESETS.find((p) => p.label === "Lane red");
    setOverlayAccent(red!.triad.accent, DEFAULT_TRIAD.accent);
    const lane = paint();
    expect(lane.some((c) => c.includes("rgba(11,13,17"))).toBe(true);
  });

  it("leaves no colour from the original palette behind", () => {
    /*
     * The assertion that "the paint changed" is too weak: it passed while
     * the glow, the floor wash and the make burst were still orange,
     * because they were written as `rgba(255,140,0,...)` and the sweep
     * that found the accent family had only looked at `#rrggbb` literals.
     * Everything warm has to move, in whatever notation it is written.
     */
    const WARM_HEX = [
      "#2a1400",
      "#4a2400",
      "#5c2f00",
      "#5e2f00",
      "#a55200",
      "#af5f00",
      "#b25a00",
      "#bd6200",
      "#c96a00",
      "#ff8c00",
      "#ff9410",
      "#ffb249",
      "#ffd071",
      "#ffd992",
      "#ffd9a0",
      "#ffe0b0",
      "#ffe2a8",
      "#fff3d6",
      "#fff3d8",
    ];
    // The same three colours as they appear with an alpha channel.
    const WARM_RGB = ["255,140,0", "255,178,73", "255,243,214"];

    const violet = THEME_PRESETS.find((p) => p.label === "Jersey violet");
    setOverlayAccent(violet!.triad.accent, DEFAULT_TRIAD.accent);
    const painted = paint().join("|").toLowerCase();

    for (const hex of WARM_HEX) {
      expect(painted, `${hex} was not rotated`).not.toContain(hex);
    }
    for (const rgb of WARM_RGB) {
      expect(painted, `rgba(${rgb}) was not rotated`).not.toContain(rgb);
    }
  });

  it("goes back to the artwork when the theme is reset", () => {
    const red = THEME_PRESETS.find((p) => p.label === "Lane red");
    setOverlayAccent(red!.triad.accent, DEFAULT_TRIAD.accent);
    paint();
    setOverlayAccent(DEFAULT_TRIAD.accent, DEFAULT_TRIAD.accent);
    expect(paint()).toContain("#ff8c00");
  });
});
