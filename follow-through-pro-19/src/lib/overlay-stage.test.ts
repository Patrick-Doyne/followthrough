import { describe, expect, it } from "vitest";

import { fromStage, stageMapping, toStage } from "@/lib/overlay-stage";
import { AUTHORED_VIEWPORT, viewportForFrame } from "@/lib/overlay-renderer";

describe("stageMapping", () => {
  it("letterboxes a portrait overlay inside a 16:9 stage", () => {
    // The drag handles have to land on the painted panels, and the
    // painted panels are inside the letterbox, not the box.
    const portrait = viewportForFrame(2160, 3840);
    const mapping = stageMapping(portrait, { width: 1200, height: 675 });
    expect(mapping.scale).toBeCloseTo(675 / 3840, 6);
    expect(mapping.offsetY).toBeCloseTo(0, 6);
    expect(mapping.offsetX).toBeGreaterThan(0);
  });

  it("fills a stage of the same shape edge to edge", () => {
    const mapping = stageMapping(AUTHORED_VIEWPORT, { width: 1280, height: 720 });
    expect(mapping.offsetX).toBeCloseTo(0, 6);
    expect(mapping.offsetY).toBeCloseTo(0, 6);
    expect(mapping.scale).toBeCloseTo(1280 / 3840, 6);
  });

  it("reports a zero scale before the stage has been measured", () => {
    // Rendering handles against a zero-sized box would stack them all in
    // the corner on the first paint.
    expect(stageMapping(AUTHORED_VIEWPORT, { width: 0, height: 0 }).scale).toBe(0);
  });
});

describe("toStage / fromStage", () => {
  it("round-trips a point", () => {
    const portrait = viewportForFrame(2160, 3840);
    const mapping = stageMapping(portrait, { width: 1200, height: 675 });
    for (const point of [
      { x: 0, y: 0 },
      { x: 1080, y: 1920 },
      { x: 2160, y: 3840 },
    ]) {
      const back = fromStage(toStage(point, mapping), mapping);
      expect(back.x).toBeCloseTo(point.x, 6);
      expect(back.y).toBeCloseTo(point.y, 6);
    }
  });

  it("puts the overlay's corners on the letterbox's corners", () => {
    const portrait = viewportForFrame(2160, 3840);
    const box = { width: 1200, height: 675 };
    const mapping = stageMapping(portrait, box);
    const topLeft = toStage({ x: 0, y: 0 }, mapping);
    const bottomRight = toStage({ x: portrait.width, y: portrait.height }, mapping);
    expect(topLeft.y).toBeCloseTo(0, 6);
    expect(bottomRight.y).toBeCloseTo(box.height, 6);
    // Centred horizontally, which is what object-contain does.
    expect(topLeft.x).toBeCloseTo(box.width - bottomRight.x, 6);
  });

  it("does not divide by zero before the stage is measured", () => {
    const mapping = stageMapping(AUTHORED_VIEWPORT, { width: 0, height: 0 });
    expect(fromStage({ x: 10, y: 10 }, mapping)).toEqual({ x: 0, y: 0 });
  });
});
