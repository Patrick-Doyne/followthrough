import { useCallback, useMemo, useState } from "react";

import {
  bestPanelLayout,
  clampPlacement,
  DEFAULT_PANEL_SIZES,
  subjectOccupancy,
  type PanelSizes,
} from "@/lib/overlay-panels";
import {
  staticPanelLayout,
  type OverlayPanelLayout,
  type OverlayViewport,
  type PanelId,
  type PanelPlacement,
} from "@/lib/overlay-renderer";
import { useSettings } from "@/state/settings-provider";
import type { FrameTelemetry } from "@/types/overlay-telemetry";

/**
 * Where the overlay's panels are, for whichever screen is drawing them.
 *
 * <p>Two halves of a layout, kept deliberately apart:
 *
 * <p>**Position is per recording and never persisted.** Picking a video
 * places the pair together in whichever corner clears the player, the
 * ball and the rim for *that* clip. A position carried over from the last
 * video would only be accidentally right -- the rim is on the left in one
 * and the right in the next -- so moving a panel applies to the playback
 * in front of you and the next clip works itself out again.
 *
 * <p>**Size is a preference and does persist.** How big the panels should
 * be is about the viewer and their screen, not about the footage, so it
 * follows them from clip to clip and into a live session.
 *
 * <p>A live session has no lookahead, and panels that rearranged
 * themselves mid-possession would be worse than panels slightly in the
 * way, so it uses the fixed default.
 */
export function useOverlayPanels({
  viewport,
  frames,
}: {
  viewport: OverlayViewport;
  /** The recording's frames, when they are all available up front. */
  frames?: FrameTelemetry[];
}) {
  const { settings, update, hydrated } = useSettings();
  const sizes: PanelSizes = (hydrated ? settings.overlayPanelSizes : null) ?? DEFAULT_PANEL_SIZES;

  /*
   * Where this recording puts the panels before anyone touches them.
   * Its object identity doubles as the identity of the recording: when
   * the frames or the frame shape change, this is a new object, and any
   * position the viewer had set on the previous clip is dropped with it.
   */
  const home = useMemo(
    () =>
      frames && frames.length > 0
        ? bestPanelLayout(viewport, subjectOccupancy(frames, viewport), sizes)
        : withSizes(staticPanelLayout(viewport), sizes, viewport),
    // `sizes` is intentionally not a dependency: resizing must not move a
    // panel the viewer has already placed. The scale the viewer dragged to
    // is already in `moved`, and a clip they have not touched re-reads
    // this on its next mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frames, viewport],
  );

  const [moved, setMoved] = useState<{
    home: OverlayPanelLayout;
    layout: OverlayPanelLayout;
  } | null>(null);
  const layout = moved?.home === home ? moved.layout : home;

  const set = useCallback(
    (next: OverlayPanelLayout, commit: boolean) => {
      setMoved({ home, layout: next });
      if (commit) {
        update({
          overlayPanelSizes: { summary: next.summary.scale, tracker: next.tracker.scale },
        });
      }
    },
    [home, update],
  );

  return {
    layout,
    /** Whether anything has been moved or resized on this playback. */
    customised: moved?.home === home || (hydrated && settings.overlayPanelSizes !== null),
    onPreview: useCallback((next: OverlayPanelLayout) => set(next, false), [set]),
    onCommit: useCallback((next: OverlayPanelLayout) => set(next, true), [set]),
    onReset: useCallback(() => {
      setMoved(null);
      update({ overlayPanelSizes: null });
    }, [update]),
  };
}

/** The authored layout at the viewer's chosen sizes. */
function withSizes(
  layout: OverlayPanelLayout,
  sizes: PanelSizes,
  viewport: OverlayViewport,
): OverlayPanelLayout {
  const at = (id: PanelId, placement: PanelPlacement) =>
    clampPlacement({ ...placement, scale: sizes[id] }, id, viewport);
  return {
    summary: at("summary", layout.summary),
    tracker: at("tracker", layout.tracker),
  };
}
