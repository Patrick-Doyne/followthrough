import type { RefObject } from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import {
  applyFrame,
  applyShotEvent,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  makeFreshPersistentState,
  remapFrameCoordinates,
  renderFromPersistent,
  staticPanelLayout,
  AUTHORED_VIEWPORT,
  type OverlayPanelLayout,
  type OverlayPersistentState,
} from "@/lib/overlay-renderer";
import { cn } from "@/lib/utils";
import type { WebRTCLiveSession } from "@/services/webrtc-live";

export interface FollowThroughOverlayHandle {
  /** Captures the canvas's own pixels (live frame + telemetry overlay,
   * already composited together) as a MediaStream for MediaRecorder. This
   * composited picture only ever exists here, client-side — the C++ backend
   * never sees it back — so this is the only place a recording of a live
   * session can come from (see LiveVideo). */
  captureStream: (fps?: number) => MediaStream;
}

/**
 * The real-time overlay surface: draws the live camera frame plus
 * `follow_through_webrtc`'s per-frame telemetry (detection boxes, pose/court
 * skeletons, shot trail, stat panels) on top of it. `videoEl` supplies the
 * background frame via drawImage — it is expected to be the same stream
 * `session` is publishing, kept decoding off-screen rather than shown
 * directly (see LiveVideo).
 *
 * Renders only when a telemetry message arrives (matching the reference
 * implementation's behavior exactly), not on a raf loop — so the canvas
 * stays black/last-frame until the backend's first message lands.
 */
export const FollowThroughOverlay = forwardRef<
  FollowThroughOverlayHandle,
  {
    videoRef: RefObject<HTMLVideoElement | null>;
    session: WebRTCLiveSession | null;
    className?: string;
    /** Where the viewer has put the panels. Omitted, they sit where the
     * artwork puts them. */
    panelLayout?: OverlayPanelLayout;
  }
>(function FollowThroughOverlay({ videoRef, session, className, panelLayout }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OverlayPersistentState>(makeFreshPersistentState());
  /*
   * Read through a ref because the only draw call is inside the telemetry
   * subscription, which is set up once per session. A prop read directly
   * there would be the one captured when that subscription was created,
   * so moving a panel mid-session would do nothing until reconnect.
   */
  const layoutRef = useRef<OverlayPanelLayout>(panelLayout ?? staticPanelLayout(AUTHORED_VIEWPORT));
  layoutRef.current = panelLayout ?? staticPanelLayout(AUTHORED_VIEWPORT);

  useEffect(() => {
    stateRef.current = makeFreshPersistentState();
  }, [session]);

  useEffect(() => {
    if (!session) return;

    return session.onTelemetry((message) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (message.type === "frame") {
        applyFrame(stateRef.current, remapFrameCoordinates(message));
      } else {
        applyShotEvent(stateRef.current, message);
      }
      renderFromPersistent(ctx, video, stateRef.current, AUTHORED_VIEWPORT, layoutRef.current);
    });
  }, [session, videoRef]);

  useImperativeHandle(
    ref,
    () => ({
      captureStream: (fps = 30) => {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error("FollowThroughOverlay canvas is not mounted yet");
        return canvas.captureStream(fps);
      },
    }),
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      className={cn("block size-full", className)}
    />
  );
});
