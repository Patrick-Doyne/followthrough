import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { fmtClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettings } from "@/state/settings-provider";

const SPEEDS = ["0.25", "0.5", "1", "1.5", "2"];

/** How long the player goes untouched before its controls fade. Three
 * seconds is what the common players settle on. */
const CONTROLS_IDLE_MS = 3000;

/**
 * What a caller can do to the player from outside it.
 *
 * <p>Imperative rather than a `seekTo` prop, because seeking is an
 * event, not a state. As a prop, asking to seek to the same second
 * twice -- clicking the same shot again after scrubbing away -- would
 * not change the value and nothing would happen.
 */
export interface VideoPlayerHandle {
  seek: (seconds: number) => void;
}

/**
 * Professional video surface. `overlay` is rendered above the video frame so
 * telemetry can later be synchronised to `onTimeUpdate`.
 */
export function VideoPlayer({
  src,
  poster,
  startAt = 0,
  overlay,
  renderOverlay,
  onVideoElement,
  onTimeUpdate,
  className,
  handleRef,
  shape,
}: {
  src: string;
  poster?: string;
  startAt?: number;
  overlay?: ReactNode;
  /**
   * An overlay that needs the element itself -- a canvas synchronised to
   * `currentTime`, say. Called again once the video mounts, because a ref
   * alone is still null on the render that would use it.
   */
  renderOverlay?: (video: HTMLVideoElement | null, paused: boolean) => ReactNode;
  /** Reports the element itself, for a caller that needs to composite it. */
  onVideoElement?: (video: HTMLVideoElement | null) => void;
  onTimeUpdate?: (seconds: number) => void;
  className?: string;
  handleRef?: Ref<VideoPlayerHandle>;
  /**
   * The shape of the picture, from the analysis that was run on it (see
   * TelemetryOverlayCanvas.onViewport). The stage takes this shape; until
   * it is known the stage is 16:9. Not read off the video element: a
   * browser may report a rotated file's size before or after rotation.
   */
  shape?: { width: number; height: number } | null;
}) {
  const { settings, hydrated } = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  /* Mirrored into state as well as a ref: `renderOverlay` runs during
     render, where the ref is still null on the first pass. */
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState("1");
  const fullscreen = useFullscreen(containerRef);
  const shown = shape && shape.width > 0 && shape.height > 0 ? shape : { width: 16, height: 9 };
  const portraitShown = shown.height > shown.width;
  // Until the shape is known the picture is hidden, so the stage never
  // shows it in one shape and then jumps to another.
  const ready = shape !== null && shape !== undefined;
  // The stage's width as laid out, re-measured on every resize and turn
  // of the phone, so its height can follow it (see the stage's style).
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const measure = () => setStageWidth(node.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [fullscreen.active, shown.width, shown.height]);
  // With an overlay the picture is drawn on the overlay's canvas (see
  // TelemetryOverlayCanvas) and the element itself only decodes, unseen.
  // Transparent rather than display:none, which stops some browsers
  // decoding it.
  const composited = Boolean(renderOverlay);

  useEffect(() => {
    const video = videoRef.current;
    if (video && startAt > 0) video.currentTime = startAt;
  }, [startAt, src]);

  useImperativeHandle(
    handleRef,
    () => ({
      seek: (seconds) => {
        const video = videoRef.current;
        if (!video) return;
        // Clamped: a shot's offset can sit a hair past the decoded
        // duration, and assigning past it is ignored by some browsers
        // and throws in others.
        video.currentTime = Math.max(0, Math.min(seconds, video.duration || seconds));
        setCurrent(video.currentTime);
        onTimeUpdate?.(video.currentTime);
      },
    }),
    [onTimeUpdate],
  );

  // Driven from an effect rather than the `autoPlay` attribute: the stored
  // preference is only known after hydration, and by then the element has
  // already loaded, so flipping the attribute would have no effect.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hydrated || !settings.autoplayVideo) return;
    void video.play().catch(() => {
      // Browsers refuse unmuted autoplay until the page has been interacted
      // with. Staying paused is the correct outcome -- the play control is
      // right there -- so this is not worth surfacing as an error.
    });
  }, [hydrated, settings.autoplayVideo, src]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  /*
   * The controls fade out while the video plays and nothing has touched
   * the player for a few seconds, as every video player does, and come
   * back on any mouse movement, touch, key or turn of the phone. They
   * stay while the video is paused and while the pointer rests on them.
   */
  const [controlsIdle, setControlsIdle] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overControlsRef = useRef(false);
  const wakeControls = useCallback(() => {
    setControlsIdle(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused && !overControlsRef.current) setControlsIdle(true);
    }, CONTROLS_IDLE_MS);
  }, []);
  useEffect(() => {
    if (!playing) {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setControlsIdle(false);
      return;
    }
    wakeControls();
    window.addEventListener("resize", wakeControls);
    window.addEventListener("orientationchange", wakeControls);
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener("resize", wakeControls);
      window.removeEventListener("orientationchange", wakeControls);
    };
  }, [playing, wakeControls]);

  return (
    <div
      ref={containerRef}
      onPointerMove={wakeControls}
      onPointerDown={wakeControls}
      onTouchStart={wakeControls}
      onKeyDown={wakeControls}
      onFocusCapture={wakeControls}
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-black",
        controlsIdle && "cursor-none",
        // Full: the surface is the viewport (the Fullscreen API's, or
        // pinned over the page where a phone has none), the picture
        // takes all of it and the controls ride over its foot.
        fullscreen.active && "fixed inset-0 z-50 m-0 flex flex-col rounded-none border-0",
        className,
      )}
    >
      {/* The stage is the shape of the picture, not a fixed 16:9 box: a
          portrait recording on a phone held upright used to be a thin
          strip in a wide black box. A portrait stage is held to the
          viewport's height and centred, so on a wide screen it is a
          column rather than a tower. */}
      <div
        className={cn(
          "relative mx-auto w-full overflow-hidden",
          fullscreen.active && "min-h-0 flex-1",
        )}
        ref={stageRef}
        style={
          fullscreen.active
            ? undefined
            : {
                // Height set from the measured width rather than through
                // CSS aspect-ratio: Safari on a phone kept the old height
                // after a rotation changed the width, leaving the picture
                // small in a stage of the wrong size.
                height: stageWidth > 0 ? (stageWidth * shown.height) / shown.width : undefined,
                aspectRatio: stageWidth > 0 ? undefined : `${shown.width} / ${shown.height}`,
                maxWidth: portraitShown
                  ? `calc(75vh * ${(shown.width / shown.height).toFixed(4)})`
                  : undefined,
              }
        }
      >
        <video
          ref={(node) => {
            videoRef.current = node;
            setVideoEl(node);
            onVideoElement?.(node);
          }}
          src={src}
          poster={poster}
          playsInline
          className={cn("size-full object-contain", (!ready || composited) && "opacity-0")}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onTimeUpdate={(e) => {
            setCurrent(e.currentTarget.currentTime);
            onTimeUpdate?.(e.currentTarget.currentTime);
          }}
          onClick={toggle}
        >
          {/* No caption data exists for these recordings yet, so this is a
              placeholder track. The default mode still honours the
              preference, so captions appear as soon as a real track is
              attached; styling comes from the ::cue rules in styles.css. */}
          <track kind="captions" default={settings.captionsEnabled} />
        </video>
        {overlay ? <div className="pointer-events-none absolute inset-0">{overlay}</div> : null}
        {renderOverlay ? (
          <div className="pointer-events-none absolute inset-0">
            {renderOverlay(videoEl, !playing)}
          </div>
        ) : null}
      </div>

      <div
        onPointerEnter={() => {
          overControlsRef.current = true;
        }}
        onPointerLeave={() => {
          overControlsRef.current = false;
          wakeControls();
        }}
        className={cn(
          "absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 border-t border-white/15 bg-black/70 px-3 py-2 text-white backdrop-blur transition-opacity duration-300 [&_.text-muted-foreground]:text-white/70",
          controlsIdle && "pointer-events-none opacity-0",
        )}
        aria-hidden={controlsIdle}
      >
        <Button
          size="icon"
          variant="ghost"
          onClick={toggle}
          aria-label={playing ? "Pause video" : "Play video"}
        >
          {playing ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
        </Button>

        <span className="metric-value text-xs text-muted-foreground tabular-nums">
          {fmtClock(current)} / {fmtClock(duration)}
        </span>

        <Slider
          value={[duration ? (current / duration) * 100 : 0]}
          max={100}
          step={0.1}
          aria-label="Seek"
          className="min-w-[120px] flex-1"
          onValueChange={([v]) => {
            const video = videoRef.current;
            if (video && duration) video.currentTime = ((v ?? 0) / 100) * duration;
          }}
        />

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              video.muted = !muted;
              setMuted(!muted);
            }}
          >
            {muted ? (
              <VolumeX className="size-4" aria-hidden />
            ) : (
              <Volume2 className="size-4" aria-hidden />
            )}
          </Button>
          <Slider
            value={[volume * 100]}
            max={100}
            aria-label="Volume"
            className="hidden w-20 sm:flex"
            onValueChange={([v]) => {
              const next = (v ?? 0) / 100;
              setVolume(next);
              if (videoRef.current) videoRef.current.volume = next;
            }}
          />
        </div>

        <Select
          value={speed}
          onValueChange={(v) => {
            setSpeed(v);
            if (videoRef.current) videoRef.current.playbackRate = Number(v);
          }}
        >
          <SelectTrigger className="w-[74px]" aria-label="Playback speed">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEEDS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="icon"
          variant="ghost"
          aria-label={fullscreen.active ? "Exit fullscreen" : "Fullscreen"}
          onClick={fullscreen.toggle}
        >
          {fullscreen.active ? (
            <Minimize className="size-4" aria-hidden />
          ) : (
            <Maximize className="size-4" aria-hidden />
          )}
        </Button>
      </div>
    </div>
  );
}
