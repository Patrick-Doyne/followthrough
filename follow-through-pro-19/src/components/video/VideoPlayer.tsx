import { Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
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
import { fmtClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSettings } from "@/state/settings-provider";

const SPEEDS = ["0.25", "0.5", "1", "1.5", "2"];

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

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden rounded-md border border-border bg-black", className)}
    >
      <div className="relative aspect-video w-full">
        <video
          ref={(node) => {
            videoRef.current = node;
            setVideoEl(node);
            onVideoElement?.(node);
          }}
          src={src}
          poster={poster}
          playsInline
          className="size-full object-contain"
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

      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-2">
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
          aria-label="Fullscreen"
          onClick={() => void containerRef.current?.requestFullscreen?.()}
        >
          <Maximize className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
