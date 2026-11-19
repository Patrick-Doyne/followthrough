import {
  AlertTriangle,
  Camera,
  CameraOff,
  Loader2,
  Maximize,
  Minimize,
  Radio,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { FollowThroughOverlay } from "@/components/video/FollowThroughOverlay";
import { OverlayPanelControls } from "@/components/video/OverlayPanelControls";
import { useOverlayPanels } from "@/hooks/use-overlay-panels";
import { AUTHORED_VIEWPORT, viewportForFrame } from "@/lib/overlay-renderer";
import { fmtClock } from "@/lib/format";
import { stageMapping } from "@/lib/overlay-stage";
import { cn } from "@/lib/utils";
import { describeError, reportDiagnostic, setDiagnosticsReporter } from "@/lib/live-diagnostics";
import { recordingMimeType } from "@/lib/live-recording";
import { classifyCameraError, createCameraSource, type CameraSource } from "@/services/camera";
import { useEventCallback } from "@/hooks/use-event-callback";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useLiveHealth } from "@/hooks/use-live-health";
import { describeEncoderStats } from "@/services/webrtc-live";
import { useLiveScore, type LiveScore } from "@/hooks/use-live-score";
import { useScreenWakeLock } from "@/hooks/use-screen-wake-lock";
import { deriveLiveStatus, type CameraState } from "@/lib/live-status";
import { videosService } from "@/services/followthrough";
import { WebRTCLiveSession } from "@/services/webrtc-live";
import type { WebRTCConnectionState } from "@/types/overlay-telemetry";

/** The recorder's video rate, in bits per second. See the recorder effect
 * for why it is capped at all. */
const RECORDING_VIDEO_BPS = 2_500_000;
/** At 60 frames a second the same quality needs more bits. */
const RECORDING_VIDEO_BPS_60 = 4_000_000;
/** The recording's frame rate when the camera's is unknown. */
const RECORDING_FPS_FALLBACK = 30;

/** The recording format for this browser (lib/live-recording.ts has the
 * order and the reason for it), or undefined to let it pick its own. */
function pickRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return recordingMimeType((type) => MediaRecorder.isTypeSupported(type));
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
      // The recording keeps the shape the phone has when the session
      // starts, so the start is the moment that decides it.
      message: "Hold the phone upright, then start the session.",
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
    <div className="flex size-full flex-col items-center justify-center gap-2 bg-[oklch(0.13_0.008_250)] px-4 text-center text-muted-foreground">
      {icon}
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-[280px] text-xs">{message}</p>
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
  onRecordingProgress,
  onScoreChange,
  onEndSession,
  practiceRun = false,
}: {
  elapsedSeconds: number;
  active: boolean;
  overlay?: ReactNode;
  /** The training session a finished recording gets attached to (see
   * onRecordingUploaded) once the live session ends; null until the page
   * has created one, or for good on a practice run. */
  sessionId: string | null;
  onRecordingUploaded?: (result: RecordingUploaded) => void;
  onRecordingError?: (error: unknown) => void;
  /** The save's progress as a fraction, null once it is over (saved or
   * not). The page shows it and keeps the screen awake through it. */
  onRecordingProgress?: (fraction: number | null) => void;
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
  const surfaceRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(surfaceRef);
  // The camera's frame shape, read off the element: a phone held upright
  // gives portrait frames, and the stage and the overlay surface follow
  // it rather than squashing them into a 16:9 box. Portrait is the shape
  // the sessions that matter are shot in.
  const [frameShape, setFrameShape] = useState<{ width: number; height: number } | null>(null);
  const viewport = useMemo(
    () => (frameShape ? viewportForFrame(frameShape.width, frameShape.height) : AUTHORED_VIEWPORT),
    [frameShape],
  );
  // No lookahead in a live session, so the panels take the fixed default
  // until the viewer moves them -- see useOverlayPanels.
  const panels = useOverlayPanels({ viewport });
  const sourceRef = useRef<CameraSource | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<WebRTCLiveSession | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  // True while mounted. Set in the mount effect's body and cleared in its
  // cleanup, so it survives the effect being re-run (React's development
  // double-invoke, or a dependency change): cleanup clears it, the re-run
  // sets it again. Setting it only in the initialiser left it false for
  // good after the first cleanup, and the camera's stream was then thrown
  // away as if the component had gone.
  const mountedRef = useRef(true);

  // Latched so that a parent passing an inline arrow cannot change their
  // identity and restart the camera and peer connection on every render.
  // finishRecordingAndUpload then depends on sessionId alone.
  const emitRecordingUploaded = useEventCallback(onRecordingUploaded);
  const emitRecordingError = useEventCallback(onRecordingError);
  const emitRecordingProgress = useEventCallback(onRecordingProgress);
  const emitScoreChange = useEventCallback(onScoreChange);
  const emitEndSession = useEventCallback(onEndSession);
  // Read through a ref, not a dependency: adding it to
  // finishRecordingAndUpload's deps would make that callback unstable,
  // which the camera effect depends on -- the exact coupling phase 0
  // closed.
  const practiceRunRef = useRef(practiceRun);
  practiceRunRef.current = practiceRun;
  // Read at upload time through a ref: the session row is created after the
  // camera starts, and a changing dependency would restart the camera.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
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
  // Held through the save as well: a phone that locks mid-upload suspends
  // the page, and the recording never arrives.
  const [saving, setSaving] = useState(false);
  useScreenWakeLock(active || saving);

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
    setDiagnosticsReporter(null);
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

    const sessionId = sessionIdRef.current;
    if (!sessionId) {
      emitRecordingError(new Error("No training session was created for this recording."));
      return;
    }

    const durationSeconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    emitRecordingProgress(0);
    setSaving(true);
    try {
      const upload = await videosService.getUploadUrl(sessionId, blob.type || "video/webm");
      await videosService.uploadRecording(upload.uploadUrl, blob, (fraction) =>
        emitRecordingProgress(fraction),
      );
      emitRecordingUploaded({
        storageKey: upload.storageKey,
        durationSeconds,
        sizeMb: blob.size / (1024 * 1024),
      });
    } catch (err) {
      reportDiagnostic(
        `upload failed after ${Math.round(blob.size / 1024 / 1024)} MB: ${describeError(err)}`,
      );
      emitRecordingError(err);
    } finally {
      setSaving(false);
      emitRecordingProgress(null);
    }
  }, [emitRecordingUploaded, emitRecordingError, emitRecordingProgress]);

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
      setDiagnosticsReporter((detail) => webrtcSession.report(detail));
      reportDiagnostic(`page ${typeof navigator === "undefined" ? "?" : navigator.userAgent}`);
      const settings = stream.getVideoTracks()[0]?.getSettings();
      if (settings) {
        reportDiagnostic(
          `camera ${settings.width ?? "?"}x${settings.height ?? "?"} at ${settings.frameRate ?? "?"} fps${settings.facingMode ? ` (${settings.facingMode})` : ""}`,
        );
      }
      webrtcSession.onStateChange((next) => {
        if (mountedRef.current) setWebrtcState(next);
      });
      webrtcSession.connect(stream);
      setSession(webrtcSession);
    } catch (err) {
      source.stop();
      reportDiagnostic(`camera failed: ${describeError(err)}`);
      if (!mountedRef.current) return;
      setCameraState(classifyCameraError(err));
    }
  }, [stopStream]);

  useEffect(() => {
    mountedRef.current = true;
    // Errors anywhere on the page while a session is up, for the relay's
    // log: a phone shows nothing else of them.
    const onError = (event: ErrorEvent) => {
      reportDiagnostic(`page error: ${describeError(event.error ?? event.message)}`);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportDiagnostic(`unhandled rejection: ${describeError(event.reason)}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
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
      const shape = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          setFrameShape({ width: video.videoWidth, height: video.videoHeight });
        }
      };
      shape();
      video.addEventListener("loadedmetadata", shape);
      video.addEventListener("resize", shape);
      return () => {
        video.removeEventListener("loadedmetadata", shape);
        video.removeEventListener("resize", shape);
      };
    }
    setFrameShape(null);
    return undefined;
  }, [cameraState]);

  /**
   * Records the session the moment the camera is up. The recording is
   * the session's record: when it ends it goes through the offline
   * pipeline like an upload (routes/live.tsx), and the overlay is drawn at
   * playback from that pass, in whatever theme the viewer has then. The
   * live telemetry is a preview and is not kept.
   *
   * <p>What is recorded is the picture as the phone shows it, drawn frame
   * by frame into a canvas of the camera's shape, not the camera track
   * itself. A phone's recorder writes the sensor's frames with a rotation
   * flag that some players apply and some do not, and that no longer
   * describes the frames once the phone is turned mid-session; a canvas
   * holds upright pixels and nothing else, so the file plays the same in
   * every browser and the pipeline analyses exactly what was seen. The
   * canvas keeps the shape the session started in; a part shot the other
   * way round is drawn inside it with black at the sides.
   *
   * <p>finishRecordingAndUpload -- triggered by the effect above when the
   * session ends -- is the only place this recorder gets stopped.
   */
  useEffect(() => {
    if (cameraState !== "connected") return;
    const video = videoRef.current;
    if (!video) return;

    let recorder: MediaRecorder | null = null;
    let loop: number | null = null;
    let cancelled = false;

    const begin = () => {
      if (cancelled || video.videoWidth === 0 || video.videoHeight === 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        emitRecordingError(new Error("The recording surface could not be created."));
        return;
      }
      const draw = () => {
        loop = requestAnimationFrame(draw);
        if (video.readyState < 2) return;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (vw === canvas.width && vh === canvas.height) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          return;
        }
        // The phone has been turned: the frame is the other shape. Fit it
        // inside, upright, with black at the sides.
        const fit = stageMapping({ width: vw, height: vh }, canvas);
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, fit.offsetX, fit.offsetY, vw * fit.scale, vh * fit.scale);
      };
      draw();

      // The recording runs at the camera's own rate: a phone gives 60.
      const cameraFps =
        streamRef.current?.getVideoTracks()[0]?.getSettings().frameRate ?? RECORDING_FPS_FALLBACK;
      const fps = cameraFps > 45 ? 60 : 30;
      try {
        const mimeType = pickRecordingMimeType();
        // The rate is capped: a phone's own recorder wrote 720p at about
        // 9.5 Mbit/s, which made a session of a few minutes hundreds of
        // megabytes. 2.5 Mbit/s keeps 720p30 clean enough for the offline
        // pipeline at about 19 MB a minute.
        recorder = new MediaRecorder(canvas.captureStream(fps), {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: fps === 60 ? RECORDING_VIDEO_BPS_60 : RECORDING_VIDEO_BPS,
        });
      } catch (err) {
        if (loop !== null) cancelAnimationFrame(loop);
        reportDiagnostic(`recorder failed: ${describeError(err)}`);
        emitRecordingError(err);
        return;
      }
      reportDiagnostic(
        `recording ${canvas.width}x${canvas.height} at ${fps} fps as ${recorder.mimeType || "the browser's default type"}`,
      );
      recordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
    };

    // The camera's shape is known once the element has its first frame.
    if (video.videoWidth > 0 && video.videoHeight > 0) begin();
    else video.addEventListener("loadedmetadata", begin, { once: true });

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", begin);
      if (loop !== null) cancelAnimationFrame(loop);
      // Only fires when the component goes away mid-session; the normal end
      // of a session clears mediaRecorderRef in finishRecordingAndUpload
      // first, so this sees nothing to do. Stopping here at least flushes the
      // final chunk. The blob itself cannot be uploaded from a cleanup --
      // there is no time to await -- which is why teardown is asynchronous
      // in the effect above and this is the last-resort path.
      if (recorder && mediaRecorderRef.current === recorder && recorder.state !== "inactive") {
        recorder.stop();
        mediaRecorderRef.current = null;
        recordingStartedAtRef.current = null;
      }
    };
  }, [cameraState, emitRecordingError]);

  return (
    <div
      ref={surfaceRef}
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-black",
        // Full (the Fullscreen API's, or pinned over the page on a phone
        // without it): the stage keeps the frames' shape, as wide as the
        // viewport allows and no taller than it, centred on black. The
        // overlay canvas is sized from this box, so the box must keep
        // that shape or the picture would stretch.
        // m-0 as well: the page stacks it with space-y, whose top margin
        // would otherwise shorten the pinned surface by that much.
        fullscreen.active &&
          "fixed inset-0 z-50 m-0 flex items-center justify-center rounded-none border-0",
      )}
    >
      <div
        className="relative w-full"
        style={{
          aspectRatio: `${viewport.width} / ${viewport.height}`,
          ...(fullscreen.active
            ? {
                width: `min(100%, calc(100dvh * ${(viewport.width / viewport.height).toFixed(4)}))`,
              }
            : {}),
        }}
      >
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
              videoRef={videoRef}
              session={session}
              viewport={viewport}
              panelLayout={panels.layout}
            />
            <OverlayPanelControls
              viewport={viewport}
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
            <span className="flex flex-col items-end gap-1">
              <span className="metric-value rounded-sm bg-black/70 px-2 py-1 text-xs text-white">
                {fmtClock(elapsedSeconds)}
              </span>
              {!offline && health.encoder ? (
                <span
                  className="metric-value rounded-sm bg-black/70 px-2 py-1 text-[10px] text-white/80"
                  title="The browser's video encoder: implementation, output size, frame rate and mean encode time per frame"
                >
                  {describeEncoderStats(health.encoder)}
                </span>
              ) : null}
            </span>
          </div>
          <div className="flex items-end justify-between gap-2">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="pointer-events-auto size-8 bg-black/70 text-white hover:bg-black/80 hover:text-white"
              aria-label={fullscreen.active ? "Exit fullscreen" : "Fullscreen"}
              onClick={fullscreen.toggle}
            >
              {fullscreen.active ? (
                <Minimize className="size-4" aria-hidden />
              ) : (
                <Maximize className="size-4" aria-hidden />
              )}
            </Button>
            <div>{overlay}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
