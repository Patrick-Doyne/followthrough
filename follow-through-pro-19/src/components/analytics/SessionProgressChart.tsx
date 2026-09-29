import { useId, useMemo } from "react";

import { ChartCaption } from "@/components/analytics/chart-parts";
import { EmptyState } from "@/components/common/states";
import { fmtClock } from "@/lib/format";
import { isTakenBy, progressSeries } from "@/lib/shot-cursor";
import { cn } from "@/lib/utils";
import type { Shot } from "@/types/telemetry";

/*
 * Drawn in an abstract box and scaled by the viewBox, so the chart has
 * no pixel measurements to keep in step with its container.
 *
 * <p>The box is wider than tall on purpose. A square viewBox in a
 * wide container is letterboxed by `preserveAspectRatio`, and the
 * chart drew itself into the middle third with empty margins either
 * side. With the height left to the intrinsic ratio it fills its
 * column at any width instead.
 *
 * <p>The ratio is about 2.2:1 rather than the 3.3:1 it started at,
 * because the chart now lives in the narrow column. At 3.3:1 a 330px
 * column gave it 99px of height and 4.5px type -- drawn correctly and
 * impossible to read.
 */
const W = 220;
const H = 100;
const PAD_L = 18;
const PAD_R = 5;
const PAD_T = 6;
const PAD_B = 18;

/**
 * How the session went, shot by shot.
 *
 * <p>The distribution charts answer "where did I shoot from" and "how
 * far"; none of them answer "was I getting better or worse", which is
 * the question a coach asks of a single session and the one you can
 * only see against time.
 *
 * <p>Hand-authored SVG rather than Recharts: it needs a playhead and
 * a solid/ghosted split at an arbitrary x, which means drawing to the
 * same coordinates twice, and Tailwind's `fill-*`/`stroke-*` resolve
 * design tokens here where Recharts' generated presentation
 * attributes do not.
 */
export function SessionProgressChart({
  shots,
  durationSeconds,
  cursorSeconds,
  currentTime,
  onSelectShot,
  selectedShotId,
}: {
  shots: Shot[];
  durationSeconds: number;
  /** Quantised to shot boundaries -- what counts as already taken. */
  cursorSeconds?: number | undefined;
  /** The real playhead, for the marker. Unquantised, so it glides. */
  currentTime?: number | undefined;
  onSelectShot?: (shot: Shot) => void;
  selectedShotId?: string | undefined;
}) {
  const series = useMemo(() => progressSeries(shots), [shots]);
  // Scoped, because two of these on one page would otherwise share a
  // clip path and the second would be cut to the first one's cursor.
  const clipId = `${useId()}-taken`;

  const span = Math.max(durationSeconds, series.at(-1)?.at ?? 0, 1);
  const x = (seconds: number) => PAD_L + (seconds / span) * (W - PAD_L - PAD_R);
  const y = (percentage: number) => PAD_T + (1 - percentage / 100) * (H - PAD_T - PAD_B);

  if (series.length === 0) {
    return (
      <EmptyState
        title="No placed shots"
        message="This session has no shots with a position on the timeline."
      />
    );
  }

  const path = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at)} ${y(p.percentage)}`)
    .join(" ");
  const final = series.at(-1);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Running shooting percentage across the session, finishing at ${final?.percentage.toFixed(1)} percent over ${final?.attempts} shots`}
      >
        {/* Gridlines at the quarters, labelled on the left. */}
        {[0, 25, 50, 75, 100].map((pct) => (
          <g key={pct}>
            <line
              x1={PAD_L}
              y1={y(pct)}
              x2={W - PAD_R}
              y2={y(pct)}
              className="stroke-border"
              strokeWidth={0.22}
            />
            <text
              x={PAD_L - 3}
              y={y(pct) + 2.1}
              textAnchor="end"
              className="fill-muted-foreground text-[6px]"
            >
              {pct}
            </text>
          </g>
        ))}

        {/*
          The whole session is always drawn, faintly. Then the part up
          to the playhead is drawn again over it at full strength and
          clipped to the playhead -- so the line fills in as the video
          runs without the shape of the session ever disappearing.
        */}
        <path d={path} fill="none" className="stroke-primary" strokeWidth={0.5} opacity={0.22} />
        {cursorSeconds === undefined ? (
          <path d={path} fill="none" className="stroke-primary" strokeWidth={0.7} />
        ) : (
          <>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={x(cursorSeconds)} height={H} />
            </clipPath>
            <path
              d={path}
              fill="none"
              className="stroke-primary"
              strokeWidth={0.7}
              clipPath={`url(#${clipId})`}
            />
          </>
        )}

        {series.map((point) => {
          const taken = cursorSeconds === undefined || isTakenBy(point.shot, cursorSeconds);
          const selected = point.shot.shotId === selectedShotId;
          return (
            <g
              key={point.shot.shotId}
              role="button"
              tabIndex={0}
              aria-label={`Shot ${point.shot.shotNumber} at ${fmtClock(point.at)}, ${point.shot.result}, ${point.percentage.toFixed(1)} percent after`}
              className={cn(
                "cursor-pointer outline-none",
                "transition-opacity duration-200 motion-reduce:transition-none",
              )}
              opacity={taken ? 1 : 0.25}
              onClick={() => onSelectShot?.(point.shot)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectShot?.(point.shot);
                }
              }}
            >
              {/* A generous invisible target: the visible dot is under
                  a millimetre across at this scale. */}
              <circle cx={x(point.at)} cy={y(point.percentage)} r={2.2} fill="transparent" />
              <circle
                cx={x(point.at)}
                cy={y(point.percentage)}
                r={selected ? 1.3 : 0.8}
                className={cn(
                  point.shot.result === "MAKE" ? "fill-make" : "fill-miss",
                  selected && "stroke-foreground",
                )}
                strokeWidth={0.25}
              />
            </g>
          );
        })}

        {currentTime !== undefined && currentTime > 0 ? (
          <g aria-hidden>
            <line
              x1={x(currentTime)}
              y1={PAD_T}
              x2={x(currentTime)}
              y2={H - PAD_B}
              className="stroke-foreground"
              strokeWidth={0.3}
              opacity={0.6}
            />
            <circle cx={x(currentTime)} cy={PAD_T} r={0.9} className="fill-foreground" />
          </g>
        ) : null}

        {/* Time axis: start, middle and end are enough to orient. */}
        {[0, span / 2, span].map((seconds, i) => (
          <text
            key={seconds}
            x={x(seconds)}
            y={H - 5}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            className="fill-muted-foreground text-[6px]"
          >
            {fmtClock(seconds)}
          </text>
        ))}
      </svg>

      <ChartCaption>
        Dots are shots — green made, red missed. Click one to jump the video to it.
      </ChartCaption>
    </div>
  );
}
