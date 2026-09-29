import type { OverlayViewport } from "@/lib/overlay-renderer";

/**
 * Converting between the overlay's own coordinates and the pixels on
 * screen.
 *
 * <p>The canvas and the video are both `object-contain` inside one box.
 * Because they are given the same aspect ratio they land on exactly the
 * same rectangle, which is what makes the overlay sit on the picture --
 * but that rectangle is not the box: it is letterboxed inside it, and
 * neither element exposes where. Anything that has to put a real DOM
 * element on top of something the canvas drew has to work it out, and
 * this is that arithmetic, in one place, so the drag handles and the
 * painted panels cannot drift apart.
 */

export interface StageBox {
  width: number;
  height: number;
}

export interface StageMapping {
  /** Overlay pixels to CSS pixels. */
  scale: number;
  /** Where the letterboxed picture starts inside the box. */
  offsetX: number;
  offsetY: number;
}

export function stageMapping(viewport: OverlayViewport, box: StageBox): StageMapping {
  if (!(box.width > 0) || !(box.height > 0) || !(viewport.width > 0) || !(viewport.height > 0)) {
    return { scale: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(box.width / viewport.width, box.height / viewport.height);
  return {
    scale,
    offsetX: (box.width - viewport.width * scale) / 2,
    offsetY: (box.height - viewport.height * scale) / 2,
  };
}

/** Overlay coordinates -> CSS offsets within the stage box. */
export function toStage(
  point: { x: number; y: number },
  mapping: StageMapping,
): { x: number; y: number } {
  return {
    x: mapping.offsetX + point.x * mapping.scale,
    y: mapping.offsetY + point.y * mapping.scale,
  };
}

/** CSS offsets within the stage box -> overlay coordinates. */
export function fromStage(
  point: { x: number; y: number },
  mapping: StageMapping,
): { x: number; y: number } {
  if (mapping.scale === 0) return { x: 0, y: 0 };
  return {
    x: (point.x - mapping.offsetX) / mapping.scale,
    y: (point.y - mapping.offsetY) / mapping.scale,
  };
}
