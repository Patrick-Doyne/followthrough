import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  clampPlacement,
  panelRect,
  resizeFromCorner,
  type PanelCorner,
} from "@/lib/overlay-panels";
import type {
  OverlayPanelLayout,
  OverlayViewport,
  PanelId,
  PanelPlacement,
} from "@/lib/overlay-renderer";
import { fromStage, stageMapping, toStage, type StageMapping } from "@/lib/overlay-stage";

/**
 * Drag handles for the overlay's panels.
 *
 * <p>The panels themselves are painted on a canvas, so there is nothing
 * to click: this puts a transparent DOM element over each one and lets
 * that be the control. Hit-testing the canvas instead would have meant
 * writing the same geometry by hand and getting none of what the platform
 * gives a real element -- focus, keyboard, a screen-reader name, and the
 * 44px touch floor this app holds itself to.
 *
 * <p>Everything outside a panel stays `pointer-events-none`, so clicking
 * the picture still plays and pauses it.
 *
 * <p>Nothing here is drawn. The cursor is the whole affordance -- a move
 * cursor over the body, a diagonal resize cursor in each corner -- which
 * is what every draggable thing on a desktop already does. An earlier
 * version outlined the panel on hover and put a square in each corner,
 * and both read as clutter sitting on top of footage. The one exception
 * is a keyboard focus ring, because a control you can Tab to has to show
 * you where you are.
 */

const PANEL_LABELS: Record<PanelId, string> = {
  summary: "Shot summary panel",
  tracker: "Shot tracker panel",
};

const CORNERS: { id: PanelCorner; cursor: string; at: { x: 0 | 1; y: 0 | 1 } }[] = [
  { id: "nw", cursor: "nwse-resize", at: { x: 0, y: 0 } },
  { id: "ne", cursor: "nesw-resize", at: { x: 1, y: 0 } },
  { id: "se", cursor: "nwse-resize", at: { x: 1, y: 1 } },
  { id: "sw", cursor: "nesw-resize", at: { x: 0, y: 1 } },
];

/**
 * How big a corner's grab zone is on screen.
 *
 * <p>44px is the floor this app holds every target to, but it cannot be
 * the only rule. A panel is only a couple of hundred CSS pixels wide in a
 * typical player, and four 44px corners anchored *inside* it cover the
 * whole thing -- which is not a cosmetic problem: it means there is
 * nowhere left to grab in order to move the panel, so dragging it only
 * ever resizes. The zones therefore straddle the corner rather than sit
 * inside it, and shrink on a genuinely small panel.
 */
function handleSize(width: number, height: number): number {
  return Math.max(14, Math.min(44, Math.min(width, height) * 0.4));
}

/** How far one arrow-key press moves a panel, as a fraction of the frame.
 * Shift multiplies it, the way a nudge usually works in an editor. */
const NUDGE = 0.01;
const NUDGE_FAST = 0.05;
/** One step of keyboard resizing. */
const SCALE_STEP = 0.05;

type Drag =
  | { kind: "move"; id: PanelId; grabX: number; grabY: number }
  | { kind: "resize"; id: PanelId; corner: PanelCorner };

export function OverlayPanelControls({
  viewport,
  layout,
  customised,
  onPreview,
  onCommit,
  onReset,
}: {
  viewport: OverlayViewport;
  /** Where the panels currently are, in overlay coordinates. */
  layout: OverlayPanelLayout;
  /** Whether the viewer has moved anything, which is what Reset undoes. */
  customised: boolean;
  /** Fires continuously during a drag, so the canvas keeps up. */
  onPreview: (layout: OverlayPanelLayout) => void;
  /** Fires once a drag ends -- this is the one worth persisting. */
  onCommit: (layout: OverlayPanelLayout) => void;
  onReset: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const dragRef = useRef<Drag | null>(null);
  // Read inside pointer handlers that are attached once, so they must not
  // close over a stale layout.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // The stage is sized by its container, and the letterbox inside it moves
  // whenever that changes -- a window resize, the sidebar collapsing, the
  // density setting. Observed rather than measured once.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setBox({ width: host.clientWidth, height: host.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const mapping = stageMapping(viewport, box);

  const apply = useCallback(
    (id: PanelId, next: PanelPlacement, commit: boolean) => {
      const updated: OverlayPanelLayout = { ...layoutRef.current, [id]: next };
      layoutRef.current = updated;
      onPreview(updated);
      if (commit) onCommit(updated);
    },
    [onPreview, onCommit],
  );

  const pointerToOverlay = useCallback(
    (event: React.PointerEvent | PointerEvent, map: StageMapping) => {
      const host = hostRef.current;
      if (!host) return { x: 0, y: 0 };
      const rect = host.getBoundingClientRect();
      return fromStage({ x: event.clientX - rect.left, y: event.clientY - rect.top }, map);
    },
    [],
  );

  // One set of window listeners for the whole gesture, rather than per
  // element: a fast drag routinely leaves the 44px handle behind, and a
  // handler bound to the handle would simply stop hearing about it.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const map = stageMapping(viewport, box);
      const point = pointerToOverlay(event, map);
      const current = layoutRef.current[drag.id];
      if (drag.kind === "move") {
        apply(
          drag.id,
          clampPlacement(
            { x: point.x - drag.grabX, y: point.y - drag.grabY, scale: current.scale },
            drag.id,
            viewport,
          ),
          false,
        );
      } else {
        apply(drag.id, resizeFromCorner(current, drag.id, drag.corner, point, viewport), false);
      }
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      onCommit(layoutRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [apply, box, onCommit, pointerToOverlay, viewport]);

  const startMove = (id: PanelId) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerToOverlay(event, mapping);
    const at = layoutRef.current[id];
    dragRef.current = { kind: "move", id, grabX: point.x - at.x, grabY: point.y - at.y };
  };

  const startResize = (id: PanelId, corner: PanelCorner) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { kind: "resize", id, corner };
  };

  const onKeyDown = (id: PanelId) => (event: React.KeyboardEvent) => {
    const at = layoutRef.current[id];
    const step = event.shiftKey ? NUDGE_FAST : NUDGE;
    const move = (dx: number, dy: number) =>
      apply(
        id,
        clampPlacement(
          { x: at.x + dx * viewport.width, y: at.y + dy * viewport.height, scale: at.scale },
          id,
          viewport,
        ),
        true,
      );
    switch (event.key) {
      case "ArrowLeft":
        move(-step, 0);
        break;
      case "ArrowRight":
        move(step, 0);
        break;
      case "ArrowUp":
        move(0, -step);
        break;
      case "ArrowDown":
        move(0, step);
        break;
      case "+":
      case "=":
        apply(id, clampPlacement({ ...at, scale: at.scale + SCALE_STEP }, id, viewport), true);
        break;
      case "-":
      case "_":
        apply(id, clampPlacement({ ...at, scale: at.scale - SCALE_STEP }, id, viewport), true);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  if (mapping.scale === 0) {
    return <div ref={hostRef} className="absolute inset-0" aria-hidden />;
  }

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0">
      {(Object.keys(PANEL_LABELS) as PanelId[]).map((id) => {
        const rect = panelRect(id, layout[id]);
        const origin = toStage(rect, mapping);
        const width = rect.width * mapping.scale;
        const height = rect.height * mapping.scale;
        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            aria-label={`${PANEL_LABELS[id]}. Drag to move, or use the arrow keys. Plus and minus resize it.`}
            onPointerDown={startMove(id)}
            onKeyDown={onKeyDown(id)}
            // touch-none: without it a drag on a phone scrolls the page
            // instead of moving the panel.
            className={cn(
              "pointer-events-auto absolute touch-none cursor-move outline-none",
              // No hover treatment: the cursor is the affordance. The
              // focus ring stays, because a control reachable by Tab has
              // to be visible to someone using Tab.
              "focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            )}
            style={{ left: origin.x, top: origin.y, width, height }}
          >
            {CORNERS.map((corner) => {
              const size = handleSize(width, height);
              return (
                <span
                  key={corner.id}
                  onPointerDown={startResize(id, corner.id)}
                  aria-hidden
                  // Invisible by design: the cursor says what this is.
                  className="absolute touch-none"
                  style={{
                    width: size,
                    height: size,
                    left: corner.at.x * width,
                    top: corner.at.y * height,
                    transform: "translate(-50%, -50%)",
                    cursor: corner.cursor,
                  }}
                />
              );
            })}
          </div>
        );
      })}

      {customised ? (
        <button
          type="button"
          onClick={onReset}
          className={cn(
            "pointer-events-auto absolute bottom-2 right-2 flex items-center gap-1.5",
            "rounded-sm bg-black/70 px-2 py-1 text-xs text-white",
            "opacity-0 transition-opacity focus-visible:opacity-100",
            "hover:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset panels
        </button>
      ) : null}
    </div>
  );
}
