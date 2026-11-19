import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import {
  applyFrame,
  applyShotEvent,
  makeFreshPersistentState,
  remapFrameCoordinates,
  renderFromPersistent,
  setOverlayAccent,
  staticPanelLayout,
  type OverlayPanelLayout,
  type OverlayViewport,
  type OverlayPersistentState,
} from "@/lib/overlay-renderer";
import { backingSize } from "@/lib/overlay-stage";
import { DEFAULT_TRIAD } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { WebRTCLiveSession } from "@/services/webrtc-live";
import { useSettings } from "@/state/settings-provider";

/**
 * The real-time overlay surface: draws the live camera frame plus
 * `follow_through_webrtc`'s per-frame telemetry (detection boxes, pose/court
 * skeletons, shot trail, stat panels) on top of it. `videoEl` supplies the
 * background frame via drawImage — it is expected to be the same stream
 * `session` is publishing, kept decoding off-screen rather than shown
 * directly (see LiveVideo).
 *
 * Paints every display frame once the backend's first message has landed:
 * the camera frame fresh from the element, the overlay from the latest
 * telemetry. The overlay's own state still changes only when telemetry
 * arrives, so nothing in it is driven by wall-clock time; what the loop
 * buys is a picture that moves at the camera's rate whatever the network
 * does. Painting only on telemetry arrival, as the reference did, made
 * the picture stutter in step with the link: on a cellular uplink the
 * round trip swung between 30 ms and two seconds, every frame still got
 * through, and the camera was redrawn in bursts. Until the first message
 * the canvas stays black.
 *
 * The backing store is the size the canvas is displayed at (backingSize),
 * not the authored surface: painting a 4K bitmap every frame is more than a
 * phone can give. The renderer still draws in authored coordinates through
 * a scale transform, so nothing on screen moves.
 */
export function FollowThroughOverlay({
  videoRef,
  session,
  viewport,
  className,
  panelLayout,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  session: WebRTCLiveSession | null;
  /** The surface to draw on, shaped like the camera's frames: portrait
   * for a phone held upright (see LiveVideo). The telemetry's own
   * coordinates are remapped onto it. */
  viewport: OverlayViewport;
  className?: string;
  /** Where the viewer has put the panels. Omitted, they sit where the
   * artwork puts them. */
  panelLayout?: OverlayPanelLayout;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OverlayPersistentState>(makeFreshPersistentState());
  // The live overlay follows the accent the person picked, exactly as the
  // playback overlay does (TelemetryOverlayCanvas): the same renderer draws
  // both, and before this it was only ever told the accent on playback, so a
  // live session drew in the default orange whatever the theme was.
  const { settings, hydrated } = useSettings();
  const accent = hydrated ? settings.themeColors.accent : DEFAULT_TRIAD.accent;
  useEffect(() => {
    setOverlayAccent(accent, DEFAULT_TRIAD.accent);
  }, [accent]);
  /*
   * Read through a ref because paint runs from the animation-frame loop
   * set up once per session; a prop read directly there would be the one
   * captured when the loop started, so moving a panel mid-session would do
   * nothing until reconnect.
   */
  const layoutRef = useRef<OverlayPanelLayout>(panelLayout ?? staticPanelLayout(viewport));
  layoutRef.current = panelLayout ?? staticPanelLayout(viewport);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  useEffect(() => {
    stateRef.current = makeFreshPersistentState();
  }, [session]);

  const paintRequestRef = useRef<number | null>(null);
  const paint = useCallback(() => {
    paintRequestRef.current = null;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // The renderer never sets or resets the transform itself (its own
    // translate/scale calls sit inside save/restore pairs), so this is the
    // one place the authored surface is mapped onto the backing store.
    ctx.setTransform(canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0);
    renderFromPersistent(ctx, video, stateRef.current, viewport, layoutRef.current);
  }, [videoRef, viewport]);

  const requestPaint = useCallback(() => {
    if (paintRequestRef.current !== null) return;
    if (typeof requestAnimationFrame !== "function") {
      paint();
      return;
    }
    paintRequestRef.current = requestAnimationFrame(paint);
  }, [paint]);

  // Size the backing store to the displayed box, and again whenever that
  // box changes (rotating a phone, resizing a window). Setting the size
  // clears the canvas, so the last picture is put back straight away.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const size = backingSize(
        { width: canvas.clientWidth, height: canvas.clientHeight },
        window.devicePixelRatio || 1,
        viewport,
      );
      if (!size || (canvas.width === size.width && canvas.height === size.height)) return;
      canvas.width = size.width;
      canvas.height = size.height;
      if (stateRef.current.lastFrame) paint();
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(canvas);
    window.addEventListener("resize", fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [paint, viewport]);

  useEffect(() => {
    if (!session) return;

    const unsubscribe = session.onTelemetry((message) => {
      if (message.type === "frame") {
        applyFrame(stateRef.current, remapFrameCoordinates(message, viewportRef.current));
      } else {
        applyShotEvent(stateRef.current, message);
      }
      requestPaint();
    });
    // The display-rate loop. It paints only once telemetry has arrived,
    // and only while the camera element has a frame to give, so a stalled
    // camera shows its last picture rather than black.
    let loop: number | null = null;
    const tick = () => {
      loop = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!stateRef.current.lastFrame || !video || video.readyState < 2) return;
      requestPaint();
    };
    if (typeof requestAnimationFrame === "function") loop = requestAnimationFrame(tick);
    return () => {
      unsubscribe();
      if (loop !== null) cancelAnimationFrame(loop);
      if (paintRequestRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(paintRequestRef.current);
        paintRequestRef.current = null;
      }
    };
  }, [session, requestPaint, videoRef]);

  // No width/height attributes: the backing store is sized by the layout
  // effect above (backingSize), which would only clear an attribute's size.
  return <canvas ref={canvasRef} className={cn("block size-full", className)} />;
}
