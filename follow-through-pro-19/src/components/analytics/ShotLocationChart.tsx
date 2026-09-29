import { useMemo, useState } from "react";

import { ChartCaption } from "@/components/analytics/chart-parts";
import { EmptyState } from "@/components/common/states";
import { COURT } from "@/services/court-geometry";
import { fmtDistanceOrUnknown, fmtSecondsOrUnknown, fmtShotType } from "@/lib/format";
import { isTakenBy } from "@/lib/shot-cursor";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { SHOT_ZONE_GROUPS, zoneGroupOf, type ShotZoneGroup } from "@/services/court-geometry";
import { cn } from "@/lib/utils";
import type { CourtLocation, Shot } from "@/types/telemetry";

/**
 * F. Half-court shot chart. Rendered as SVG so the geometry is basketball
 * specific: keys, arcs and the three-point line are drawn to scale.
 */
const W = COURT.width; // 15m
const D = COURT.depth;
const RIM = COURT.rim;
const PAD = 0.4;

export function ShotLocationChart({
  shots,
  mode = "SHOTS",
  onSelectShot,
  selectedShotId,
  cursorSeconds,
  showZoneFilters = false,
}: {
  shots: Shot[];
  mode?: "SHOTS" | "DENSITY";
  onSelectShot?: (shot: Shot) => void;
  selectedShotId?: string | undefined;
  /**
   * Where playback has reached, in seconds.
   *
   * <p>Given one, shots that have not happened yet are ghosted rather
   * than hidden. Hiding them makes marks appear from nowhere and
   * destroys the spatial pattern, which is the whole point of the
   * view; ghosting keeps the session's shape visible while still
   * showing it fill in. They stay clickable, because scrubbing
   * forward to a shot you can see is a reasonable thing to want.
   *
   * <p>Omit it for a chart that is not tied to playback, where every
   * shot is simply present.
   */
  cursorSeconds?: number | undefined;
  /** Show the zone filter chips. Off where the chart is a small inset. */
  showZoneFilters?: boolean;
}) {
  const [hovered, setHovered] = useState<Shot | null>(null);
  const [zones, setZones] = useState<ShotZoneGroup[]>([]);

  // A shot the pipeline could not place is not plottable. It is counted and
  // reported rather than dropped silently or parked at the rim -- both of
  // which misrepresent where someone actually shot from.
  const placed = useMemo(
    () => shots.filter((s): s is Shot & { location: CourtLocation } => s.location !== undefined),
    [shots],
  );
  const unplaced = shots.length - placed.length;

  // An empty selection means "everything", not "nothing" -- a filter row
  // that starts by hiding all the data reads as a broken chart.
  const plottable = useMemo(
    () =>
      zones.length === 0 ? placed : placed.filter((s) => zones.includes(zoneGroupOf(s.location))),
    [placed, zones],
  );

  const cells = useMemo(() => {
    const size = 1.5;
    const map = new Map<string, { x: number; y: number; total: number; makes: number }>();
    plottable.forEach((s) => {
      const cx = Math.floor(s.location.x / size) * size + size / 2;
      const cy = Math.floor(s.location.y / size) * size + size / 2;
      const key = `${cx}:${cy}`;
      const cell = map.get(key) ?? { x: cx, y: cy, total: 0, makes: 0 };
      cell.total += 1;
      if (s.result === "MAKE") cell.makes += 1;
      map.set(key, cell);
    });
    return [...map.values()];
  }, [plottable]);

  if (shots.length === 0) {
    return (
      <EmptyState
        title="No shots yet"
        message="Shots appear on the court as the pipeline detects them."
      />
    );
  }

  const maxTotal = Math.max(...cells.map((c) => c.total), 1);

  return (
    <div className="relative">
      {showZoneFilters ? (
        <div
          role="group"
          aria-label="Filter shots by court zone"
          className="mb-2 flex flex-wrap gap-1"
        >
          {SHOT_ZONE_GROUPS.map((group) => {
            const on = zones.includes(group.value);
            const count = placed.filter((s) => zoneGroupOf(s.location) === group.value).length;
            return (
              <button
                key={group.value}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setZones((prev) =>
                    prev.includes(group.value)
                      ? prev.filter((z) => z !== group.value)
                      : [...prev, group.value],
                  )
                }
                className={cn(
                  "rounded-sm px-2 py-1 text-[0.6875rem] font-medium transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  on
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {group.label}
                {/* The count is what makes an empty zone legible as "no
                    shots from there" rather than "filter is broken". */}
                <span className="ml-1.5 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <svg
        viewBox={`${-PAD} ${-PAD} ${W + PAD * 2} ${D + PAD * 2}`}
        className="w-full"
        role="img"
        aria-label={`Half court shot chart with ${shots.length} shots`}
      >
        {/* court surface */}
        <rect
          x={0}
          y={0}
          width={W}
          height={D}
          className="fill-court-surface stroke-court-line"
          strokeWidth={0.08}
        />
        {/* paint */}
        <rect
          x={W / 2 - 2.45}
          y={0}
          width={4.9}
          height={5.8}
          fill="none"
          className="stroke-court-line"
          strokeWidth={0.07}
        />
        {/* free throw circle */}
        <circle
          cx={W / 2}
          cy={5.8}
          r={1.8}
          fill="none"
          className="stroke-court-line"
          strokeWidth={0.07}
        />
        {/* restricted area */}
        <path
          d={`M ${RIM.x - 1.25} ${RIM.y} A 1.25 1.25 0 0 0 ${RIM.x + 1.25} ${RIM.y}`}
          fill="none"
          className="stroke-court-line"
          strokeWidth={0.06}
        />
        {/* three point line */}
        <path
          d={`M 0.9 0 L 0.9 2.6 A 6.75 6.75 0 0 0 ${W - 0.9} 2.6 L ${W - 0.9} 0`}
          fill="none"
          className="stroke-court-line"
          strokeWidth={0.07}
        />
        {/* backboard + rim */}
        <line
          x1={RIM.x - 0.9}
          y1={1.05}
          x2={RIM.x + 0.9}
          y2={1.05}
          className="stroke-court-line"
          strokeWidth={0.09}
        />
        <circle
          cx={RIM.x}
          cy={RIM.y}
          r={0.23}
          fill="none"
          className="stroke-primary"
          strokeWidth={0.08}
        />

        {mode === "DENSITY"
          ? cells.map((cell) => (
              <rect
                key={`${cell.x}-${cell.y}`}
                x={cell.x - 0.75}
                y={cell.y - 0.75}
                width={1.5}
                height={1.5}
                rx={0.08}
                style={{
                  fill: cell.makes / cell.total >= 0.5 ? "var(--make)" : "var(--miss)",
                }}
                fillOpacity={0.12 + (cell.total / maxTotal) * 0.6}
              >
                <title>{`${cell.total} attempts · ${((cell.makes / cell.total) * 100).toFixed(0)}% FG`}</title>
              </rect>
            ))
          : plottable.map((shot) => {
              const selected = shot.shotId === selectedShotId;
              const make = shot.result === "MAKE";
              const ghost = cursorSeconds !== undefined && !isTakenBy(shot, cursorSeconds);
              const cx = shot.location.x;
              const cy = shot.location.y;
              return (
                <g
                  key={shot.shotId}
                  tabIndex={0}
                  role="button"
                  aria-label={`Shot ${shot.shotNumber}, ${shot.result}, ${fmtDistanceOrUnknown(shot.shotDistance)}`}
                  className={cn(
                    "cursor-pointer outline-none focus-visible:opacity-100",
                    // Instant under reduced motion: a mark quietly
                    // fading up as the video plays is exactly the kind
                    // of ambient movement that setting turns off.
                    "transition-opacity duration-200 motion-reduce:transition-none",
                  )}
                  opacity={ghost ? 0.22 : 1}
                  onMouseEnter={() => setHovered(shot)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(shot)}
                  onBlur={() => setHovered(null)}
                  onClick={() => onSelectShot?.(shot)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectShot?.(shot);
                    }
                  }}
                >
                  {make ? (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={selected ? 0.28 : 0.19}
                      className={selected ? "fill-make stroke-foreground" : "fill-make stroke-none"}
                      fillOpacity={0.8}
                      strokeWidth={0.06}
                    />
                  ) : (
                    <g
                      className="stroke-miss"
                      strokeWidth={selected ? 0.13 : 0.09}
                      strokeOpacity={0.85}
                    >
                      <line x1={cx - 0.18} y1={cy - 0.18} x2={cx + 0.18} y2={cy + 0.18} />
                      <line x1={cx - 0.18} y1={cy + 0.18} x2={cx + 0.18} y2={cy - 0.18} />
                    </g>
                  )}
                </g>
              );
            })}
      </svg>

      {/* The same key every other chart uses, so a make reads the same
          here as it does on the scatter. The counts sit beside it rather
          than in a separate line: they answer "is anything missing from
          this picture", which belongs with the picture. */}
      <ChartLegend
        items={[
          { id: "make", label: "Make", color: "var(--make)", mark: "circle" },
          { id: "miss", label: "Miss", color: "var(--miss)", mark: "cross" },
        ]}
      />
      <ChartCaption>
        {plottable.length} {plottable.length === 1 ? "shot" : "shots"} plotted
        {unplaced > 0 ? (
          // Said out loud rather than quietly omitted: a chart showing
          // fewer shots than the session took, with no explanation, reads
          // as a bug or worse as a lower attempt count.
          <span className="text-warn">
            {" · "}
            {unplaced} without a location
            {plottable.length === 0 ? " — the court had not calibrated" : ""}
          </span>
        ) : null}
      </ChartCaption>

      {hovered ? (
        <div className="pointer-events-none absolute top-2 right-2 rounded-sm border border-border bg-popover/95 px-3 py-2 text-xs shadow-lg">
          <p className="font-semibold">
            Shot #{hovered.shotNumber} · {hovered.result}
          </p>
          <p className="text-muted-foreground">
            {fmtShotType(hovered.shotType)} · {fmtDistanceOrUnknown(hovered.shotDistance)} ·{" "}
            {fmtSecondsOrUnknown(hovered.shotDuration)} · apex{" "}
            {fmtSecondsOrUnknown(hovered.timeToApex)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
