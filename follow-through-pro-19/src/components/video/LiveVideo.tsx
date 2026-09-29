import { AlertTriangle, Camera, CameraOff, Loader2, Radio, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  FollowThroughOverlay,
  type FollowThroughOverlayHandle,
} from "@/components/video/FollowThroughOverlay";
import { OverlayPanelControls } from "@/components/video/OverlayPanelControls";
import { useOverlayPanels } from "@/hooks/use-overlay-panels";
import { AUTHORED_VIEWPORT } from "@/lib/overlay-renderer";
import { fmtClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import { classifyCameraError, createCameraSource, type CameraSource } from "@/services/camera";
import { useEventCallback } from "@/hooks/use-event-callback";
import { useLiveHealth } from "@/hooks/use-live-health";
import { useLiveScore, type LiveScore } from "@/hooks/use-live-score";
import { useScreenWakeLock } from "@/hooks/use-screen-wake-lock";
import { deriveLiveStatus, type CameraState } from "@/lib/live-status";
import { videosService } from "@/services/followthrough";
import { WebRTCLiveSession } from "@/services/webrtc-live";
import type { WebRTCConnectionState } from "@/types/overlay-telemetry";

/** First MIME type MediaRecorder actually supports on this browser. Chrome
 * and Firefox both support vp9/webm; Safari support is spottier, hence the
 * plain "video/webm" fallback and the final undefined (let the browser pick
 * its own default) so recording never just silently fails to start. */
function pickRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const type of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

export interface RecordingUploaded {
  storageKey: string;
  durationSeconds: number;
  sizeMb: number;
}

function CameraPlaceholder({
  state,
  onRetry,
}: {
  state: Exclude<CameraState, "connected">;
  onRetry: () => void;
}) {
  const copy: Record<
    Exclude<CameraState, "connected">,
    { icon: ReactNode; title: string; message: string }
  > = {
    idle: {
      icon: <Camera className="size-6" aria-hidden />,
      title: "Ready to start",
      message: "Start a session to begin the live camera feed.",
    },
    initializing: {
      icon: <Loader2 className="size-6 animate-spin" aria-hidden />,
      title: "Initializing camera",
      message: "Requesting access to your default webcam…",
    },
    denied: {
      icon: <CameraOff className="size-6" aria-hidden />,
      title: "Camera permission denied",
      message: "Allow camera access in your browser to see the live feed.",
    },
    unavailable: {
      icon: <CameraOff className="size-6" aria-hidden />,
      title: "No camera available",
      message: "We couldn't find a webcam on this device.",
    },
    error: {
      icon: <AlertTriangle className="size-6" aria-hidden />,
      title: "Camera error",
      message: "Something went wrong while accessing the camera.",
    },
  };

  const { icon, title, message } = copy[state];

  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 bg-[oklch(0.13_0.008_250)] text-muted-foreground">
      {icon}
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs">{message}</p>
      {state !== "initializing" && state !== "idle" ? (
        <Button variant="outline" size="sm" className="mt-1 gap-1.5" onClick={onRetry}>
          <RefreshCw className="size-3.5" aria-hidden />
          Try Again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Live camera surface. While `active`, captures the user's default webcam
 * and publishes it to the `follow_through_webrtc` backend over a WebRTC peer
 * connection (see services/webrtc-live.ts), then composites the backend's
 * per-frame telemetry on top of the live frame via FollowThroughOverlay. The
 * camera element itself is kept decoding off-screen — FollowThroughOverlay's
 * canvas is the visible surface once connected.
 */
export function LiveVideo({
  elapsedSeconds,
  active,
  overlay,
  sessionId,
  onRecordingUploaded,
  onRecordingError,
  onScoreChange,
  onEndSession,
  practiceRun = false,
}: {
  elapsedSeconds: number;
  active: boolean;
  overlay?: ReactNode;
  /** The training session a finished recording gets attached to (see
   * onRecordingUploaded) once the live session ends. */
  sessionId: string;
  onRecordingUploaded?: (result: RecordingUploaded) => void;
  onRecordingError?: (error: unknown) => void;
  /** Reports the DataChannel-derived score so the page can show the shot
   * feed and counters from the same source as the bug. Latched, so passing
   * an inline arrow here cannot restart the camera. */
  onScoreChange?: (score: LiveScore) => void;
  /** Ends the session from the failure veil. Terminal failure is the one
   * state retries cannot fix, so it needs a control rather than only
   * advice. */
  onEndSession?: () => void;
  /** The person chose a practice run, so this is a test whatever the
   * transports say. */
  practiceRun?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<FollowThroughOverlayHandle>(null);
  // No lookahead in a live session, so the panels take the fixed default
  // until the viewer moves them -- see useOverlayPanels.
  const panels = useOverlayPanels({ viewport: AUTHORED_VIEWPORT });
  const sourceRef = useRef<CameraSource | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<WebRTCLiveSession | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  // Set in the initialiser, not in an effect. The mount effect below used to
  // assign this, which was correct only because its dependency happened to be
  // stable -- a re-run would have briefly left it true after unmount.
  const mountedRef = useRef(true);

  // Latched so that a parent passing an inline arrow cannot change their
  // identity and restart the camera and peer connection on every render.
  // finishRecordingAndUpload then depends on sessionId alone.
  const emitRecordingUploaded = useEventCallback(onRecordingUploaded);
  const emitRecordingError = useEventCallback(onRecordingError);
  const emitScoreChange = useEventCallback(onScoreChange);
  const emitEndSession = useEventCallback(onEndSession);
  // Read through a ref, not a dependency: adding it to
  // finishRecordingAndUpload's deps would make that callback unstable,
  // which the camera effect depends on -- the exact coupling phase 0
  // closed.
  const practiceRunRef = useRef(practiceRun);
  practiceRunRef.current = practiceRun;
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [session, setSession] = useState<WebRTCLiveSession | null>(null);
  const [webrtcState, setWebrtcState] = useState<WebRTCConnectionState>("idle");

  const health = useLiveHealth(session, videoRef);
  const score = useLiveScore(session);

  useEffect(() => {
    emitScoreChange(score);
  }, [score, emitScoreChange]);

  // A propped phone locks itself, which suspends the camera and the recorder
  // while the peer connection still looks healthy. Best-effort; the health
  // monitor is the backstop when this is refused.
  useScreenWakeLock(active);

  const status = deriveLiveStatus({
    active,
    camera: cameraState,
    webrtc: webrtcState,
    telemetryStale: health.telemetryStale,
    videoStalled: health.videoStalled,
    hidden: health.hidden,
  });
  const showVeil = status.kind !== "live" && status.kind !== "idle";
  // The badge reads the derived status, so it can only say Live when
  // telemetry and the camera clock are both actually moving -- not merely
  // when a connection exists.
  const offline = status.kind !== "live";

  const stopStream = useCallback(() => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setSession(null);
    setWebrtcState("idle");
    sourceRef.current?.stop();
    sourceRef.current = null;
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /** Stops the in-progress recording (if any), assembles its Blob, uploads
   * it, and ingests it against sessionId. Resolves once that whole chain
   * settles (success or failure reported via the on* callbacks) so callers
   * can sequence camera/webrtc teardown after the last frame is captured. */
  const finishRecordingAndUpload = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const startedAt = recordingStartedAtRef.current;
    mediaRecorderRef.current = null;
    recordingStartedAtRef.current = null;
    if (!recorder || recorder.state === "inactive") return;

    const blob = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        "stop",
        () =>
          resolve(
            new Blob(recordingChunksRef.current, { type: recorder.mimeType || "video/webm" }),
          ),
        { once: true },
      );
      recorder.stop();
    });
    recordingChunksRef.current = [];
    if (blob.size === 0) return;

    // A practice run is discarded here rather than uploaded and left
    // unlinked. Uploading a blob nothing references would leave orphaned
    // storage and would make "not saved" untrue in the only sense that
    // costs anything.
    if (practiceRunRef.current) return;

    const durationSeconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    try {
      const upload = await videosService.getUploadUrl(sessionId, blob.type || "video/webm");
      await videosService.uploadRecording(upload.uploadUrl, blob);
      emitRecordingUploaded({
        storageKey: upload.storageKey,
        durationSeconds,
        sizeMb: blob.size / (1024 * 1024),
      });
    } catch (err) {
      emitRecordingError(err);
    }
  }, [sessionId, emitRecordingUploaded, emitRecordingError]);

  const initCamera = useCallback(async () => {
    stopStream();
    setCameraState("initializing");

    const source = createCameraSource();
    sourceRef.current = source;

    try {
      const stream = await source.start();
      if (!mountedRef.current) {
        source.stop();
        return;
      }
      streamRef.current = stream;
      setCameraState("connected");

      const webrtcSession = new WebRTCLiveSession();
      sessionRef.current = webrtcSession;
      webrtcSession.onStateChange((next) => {
        if (mountedRef.current) setWebrtcState(next);
      });
      webrtcSession.connect(stream);
      setSession(webrtcSession);
    } catch (err) {
      source.stop();
      if (!mountedRef.current) return;
      setCameraState(classifyCameraError(err));
    }
  }, [stopStream]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      stopStream();
    };
  }, [stopStream]);

  useEffect(() => {
    if (active) {
      void initCamera();
    } else {
      void finishRecordingAndUpload().finally(() => {
        stopStream();
        setCameraState("idle");
      });
    }
  }, [active, initCamera, stopStream, finishRecordingAndUpload]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream) {
      video.srcObject = stream;
      void video.play();
    }
  }, [cameraState]);

  /** Starts recording the overlay canvas (video + telemetry composited)
   * the moment it's mounted, so the recording covers the whole session.
   * finishRecordingAndUpload -- triggered by the effect above when the
   * session ends -- is the only place this recorder gets stopped. */
  useEffect(() => {
    if (cameraState !== "connected") return;
    const overlayHandle = overlayRef.current;
    if (!overlayHandle) return;

    let stream: MediaStream;
    try {
      stream = overlayHandle.captureStream(30);
    } catch (err) {
      // The handle throws when its canvas is gone. Previously uncaught, which
      // would take the whole component tree down rather than losing a
      // recording.
      emitRecordingError(err);
      return;
    }
    const mimeType = pickRecordingMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordingChunksRef.current.push(event.data);
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    recordingStartedAtRef.current = Date.now();

    return () => {
      // Only fires when the component goes away mid-session; the normal end
      // of a session clears mediaRecorderRef in finishRecordingAndUpload
      // first, so this sees nothing to do. Stopping here at least flushes the
      // final chunk instead of abandoning the recorder against a dead canvas
      // stream. The blob itself cannot be uploaded from a cleanup -- there is
      // no time to await -- which is why teardown is asynchronous in the
      // effect above and this is the last-resort path.
      if (mediaRecorderRef.current === recorder && recorder.state !== "inactive") {
        recorder.stop();
        mediaRecorderRef.current = null;
        recordingStartedAtRef.current = null;
      }
    };
  }, [cameraState, emitRecordingError]);

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-black">
      <div className="relative aspect-video w-full">
        {cameraState === "connected" ? (
          <>
            {/* Visually hidden, not display:none -- some browsers (mobile
                Safari especially) throttle or stop decoding a display:none
                video element, which would mean the overlay's drawImage()
                pulling a stale or black frame. */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="pointer-events-none absolute size-px opacity-0"
            />
            <FollowThroughOverlay
              ref={overlayRef}
              videoRef={videoRef}
              session={session}
              panelLayout={panels.layout}
            />
            {/* A sibling of the overlay, not a wrapper around it: the
                recording reads the canvas through an imperative handle,
                and interposing anything between LiveVideo and that
                component has silently broken it before. */}
            <OverlayPanelControls
              viewport={AUTHORED_VIEWPORT}
              layout={panels.layout}
              customised={panels.customised}
              onPreview={panels.onPreview}
              onCommit={panels.onCommit}
              onReset={panels.onReset}
            />
            {showVeil ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 px-4 text-center text-white">
                <p className="text-sm font-medium">{status.label}</p>
                <p className="max-w-[280px] text-xs text-white/70">{status.detail}</p>
                {status.action ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    onClick={status.action === "Try again" ? initCamera : () => emitEndSession()}
                  >
                    {status.action}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <CameraPlaceholder state={cameraState} onRetry={initCamera} />
        )}

        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-black/70 px-2 py-1 text-[11px] font-semibold tracking-[0.16em] text-white uppercase">
              <Radio
                className={cn("size-3", offline ? "text-white/50" : "text-live")}
                aria-hidden
              />
              {offline ? "Offline" : "Live"}
            </span>
            <span className="metric-value rounded-sm bg-black/70 px-2 py-1 text-xs text-white">
              {fmtClock(elapsedSeconds)}
            </span>
          </div>
          <div className="flex justify-end">{overlay}</div>
        </div>
      </div>
    </div>
  );
}
