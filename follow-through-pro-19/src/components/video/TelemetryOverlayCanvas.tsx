import { useCallback, useEffect, useMemo, useState } from "react";

import { OverlayPanelControls } from "@/components/video/OverlayPanelControls";
import { useOverlayPanels } from "@/hooks/use-overlay-panels";

import { DEFAULT_TRIAD } from "@/lib/theme";
import { createOverlayReplay } from "@/lib/overlay-replay";
import { renderOverlayFromPersistent, setOverlayAccent } from "@/lib/overlay-renderer";
import { useSettings } from "@/state/settings-provider";

/**
 * The analysis overlay, drawn over the video as it plays.
 *
 * <p>This replaces burning the overlay into the exported file. Drawing it
 * at playback keeps the recording itself clean, means an improvement to
 * the artwork reaches every video already in the library without
 * re-encoding a single one, and lets the overlay follow the theme -- which
 * a pixel baked into an mp4 can never do.
 *
 * <p>The canvas stays at the 4K surface the artwork was authored against
 * and is scaled by CSS, so every coordinate, stroke width and font size in
 * the renderer means what it meant when it was approved. Resizing the
 * canvas instead would rescale the artwork and clear it on every change.
 *
 * <p>Driven by `requestAnimationFrame` rather than the video's `timeupdate`,
 * which fires about four times a second -- far too coarse for a ball trail.
 */
export function TelemetryOverlayCanvas({
  video,
  messages,
  fps,
  paused,
  onCanvas,
}: {
  /** The element being played. */
  video: HTMLVideoElement | null;
  /** The processing run's own telemetry, in pipeline order. */
  messages: unknown[];
  fps: number;
  /** Skip the loop entirely when there is nothing moving. */
  paused?: boolean;
  /** Reports the canvas so the page can composite it for a download. */
  onCanvas?: (canvas: HTMLCanvasElement | null) => void;
}) {
  /*
   * The canvas is held in state behind a *stable* callback ref, not a
   * `useRef` with an inline arrow.
   *
   * <p>An inline arrow ref is a new function on every render, so React
   * detaches and reattaches it each time -- and this one reports the node
   * upward, which renders again. The draw loop ended up holding a node
   * that was no longer the one on screen: it painted happily, into
   * nothing, while the visible canvas kept whatever it had from the first
   * pass. That is what made the overlay ignore a theme change even though
   * every colour underneath it had already rotated.
   *
   * <p>State rather than a ref so the effect re-runs when the element
   * actually changes, which is the whole point.
   */
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const attach = useCallback(
    (node: HTMLCanvasElement | null) => {
      setCanvas(node);
      onCanvas?.(node);
    },
    [onCanvas],
  );
  const { settings, hydrated } = useSettings();

  const replay = useMemo(() => createOverlayReplay(messages), [messages]);
  /*
   * The surface carries the source's aspect ratio, so this canvas and the
   * <video> beneath it are two `object-contain` boxes of the same shape in
   * the same container -- which lands them on exactly the same rectangle
   * with nothing to measure and nothing to keep in sync on resize.
   */
  const viewport = replay.viewport;
  const panels = useOverlayPanels({ viewport, frames: replay.frames });
  const rate = fps > 0 ? fps : 30;

  /*
   * The overlay follows the accent the user picked -- the triad itself,
   * not the `primary` token resolved for the current palette.
   *
   * <p>Those tokens are re-solved per palette so the accent clears
   * contrast against a page background. The overlay has no page
   * background: it is drawn on video, which is dark in light mode and
   * dark mode alike. Reading `primary` handed it the light palette's
   * darkened accent and high contrast's five-degree hue shift, neither of
   * which is about anything the overlay sits on.
   *
   * <p>Set outside the draw loop: it is a lookup over a cached table, not
   * per-frame work.
   */
  const accent = hydrated ? settings.themeColors.accent : DEFAULT_TRIAD.accent;

  useEffect(() => {
    setOverlayAccent(accent, DEFAULT_TRIAD.accent);
  }, [accent]);

  useEffect(() => {
    if (!canvas || !video) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let raf = 0;
    let lastFrameId = -1;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const frameId = Math.round(video.currentTime * rate);
      // Nothing has changed between two animation frames of a 30fps
      // recording on a 120Hz display, which is most of them.
      if (frameId === lastFrameId) return;
      lastFrameId = frameId;

      const state = replay.stateAt(frameId);
      context.clearRect(0, 0, viewport.width, viewport.height);
      renderOverlayFromPersistent(context, state, viewport, panels.layout);
    };

    draw();
    return () => cancelAnimationFrame(raf);
    // `panels.layout` is a dependency so moving a panel repaints at once
    // rather than on the next frame the video happens to advance to --
    // which, on a paused video, would be never.
    // `paused` is a dependency so a paused video stops the loop and a
    // seek while paused still redraws on the next mount of the effect.
  }, [canvas, video, replay, viewport, rate, accent, paused, panels.layout]);

  return (
    <>
      <canvas
        ref={attach}
        width={viewport.width}
        height={viewport.height}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full object-contain"
      />
      <OverlayPanelControls
        viewport={viewport}
        layout={panels.layout}
        customised={panels.customised}
        onPreview={panels.onPreview}
        onCommit={panels.onCommit}
        onReset={panels.onReset}
      />
    </>
  );
}
