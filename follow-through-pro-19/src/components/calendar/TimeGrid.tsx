import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { STATUS_BAR, STATUS_ICON, STATUS_TEXT } from "@/components/calendar/event-status";
import { fmtWeekdayDay, titleCase } from "@/lib/format";
import {
  GRID_HOURS,
  STACK_BLOCK_REM,
  STACK_STEP_REM,
  gridHeight,
  layoutColumn,
  offsetOf,
  rowHeights,
  rowTop,
  spanOf,
} from "@/lib/time-grid";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/types/telemetry";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The width of the hour axis. Shared by the grid template and the now
 * line, which has to start exactly where the columns do. */
const GUTTER = "3.75rem";
const GUTTER_REM = 3.75;

/** The narrowest a side-by-side block may get before the sessions in
 * that slot stack instead. Below roughly this a block is a sliver
 * holding an icon and no readable title. */
const MIN_LANE_REM = 4.5;

const rem = (value: number) => `${value}rem`;

/**
 * The week and day views, as a time grid.
 *
 * <p>Hours run down the Y axis and each day is a column, the way every
 * calendar people already use works. What it replaces was a list of
 * sessions per day: it said what was on but not when, so a morning and
 * an evening session looked like two sessions back to back, and the
 * shape of a training day -- where the gaps are -- was invisible.
 *
 * <p>Day view is the same component with one column, so the two cannot
 * drift apart.
 *
 * <p>Rows are not all the same height: an hour holding stacked
 * sessions grows to fit them, so everything is positioned by
 * accumulating row heights rather than as a percentage of the day.
 */
export function TimeGrid({
  days,
  byDate,
  onSelectEvent,
  onCreateOn,
  showDayHeaders,
}: {
  days: Date[];
  byDate: Map<string, CalendarEvent[]>;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreateOn: (dateIso: string) => void;
  /** Week view labels its columns; day view is already titled by the band. */
  showDayHeaders: boolean;
}) {
  const now = new Date();
  const todayIso = iso(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const showsToday = days.some((d) => iso(d) === todayIso);

  /*
   * How wide one day column actually is, so the layout can tell when
   * side-by-side placement has run out of room. There is no way to
   * know it from the markup alone: it depends on the viewport, the
   * sidebar beside the calendar and how many days are shown.
   */
  const bodyRef = useRef<HTMLDivElement>(null);
  const [maxLanes, setMaxLanes] = useState(Infinity);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const column = (el.clientWidth - GUTTER_REM * root) / days.length;
      setMaxLanes(Math.max(1, Math.floor(column / (MIN_LANE_REM * root))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [days.length]);

  const { columns, heights } = useMemo(() => {
    const laid = days.map((day) => {
      const key = iso(day);
      const events = byDate.get(key) ?? [];
      const spans = events.map(spanOf);
      return { day, key, events, spans, ...layoutColumn(spans, maxLanes) };
    });
    // A row spans every column, so it has to be as tall as the
    // hungriest column needs it.
    const slots = GRID_HOURS.map((hour) =>
      Math.max(...laid.map((c) => c.stackSlots[hour] ?? 0), 0),
    );
    const mins = GRID_HOURS.map((hour) => Math.max(...laid.map((c) => c.minHeights[hour] ?? 0), 0));
    return { columns: laid, heights: rowHeights(slots, mins) };
  }, [days, byDate, maxLanes]);

  const template: CSSProperties = {
    gridTemplateColumns: `${GUTTER} repeat(${days.length}, minmax(0, 1fr))`,
  };

  return (
    /*
     * `height: max-content` is load-bearing.
     *
     * <p>Setting `overflow-x` makes this a scroll container in both
     * axes -- CSS computes `overflow-y: auto` when only one is given --
     * and a scroll container reports a collapsed height to the grid
     * above it. The card came out 115px shorter than its contents and
     * clipped the legend off the bottom.
     */
    <div className="overflow-x-auto" style={{ height: "max-content" }}>
      <div style={{ minWidth: days.length > 1 ? "48rem" : undefined }}>
        {showDayHeaders ? (
          <div className="grid border-b border-border bg-surface/50" style={template}>
            {/* The gutter has no heading; the hours label themselves. */}
            <div />
            {columns.map(({ day, key }) => (
              <div
                key={key}
                className={cn(
                  "flex items-center justify-between gap-1 border-l border-border/60 px-2 py-2",
                  key === todayIso && "bg-primary/[0.07]",
                )}
              >
                <span className={cn("label-caps truncate", key === todayIso && "text-primary")}>
                  {fmtWeekdayDay(day)}
                </span>
                {/* The keyboard route to booking a day. The hour cells
                    below are pointer affordances and are kept out of
                    the tab order -- seven days of twenty-four hours
                    would otherwise put 168 empty slots between this
                    rail and whatever comes after it. */}
                <button
                  type="button"
                  onClick={() => onCreateOn(key)}
                  aria-label={`Add training session on ${key}`}
                  className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="size-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div
          ref={bodyRef}
          className="relative grid"
          style={{ ...template, height: rem(gridHeight(heights)) }}
        >
          {/* The hour axis. Same row heights as the columns, from the
              same array, so an expanded hour cannot put the two out of
              step. */}
          <div className="relative">
            {GRID_HOURS.map((hour) => (
              <div
                key={hour}
                className="metric-value border-b border-border/40 px-2 pt-1 text-right text-[0.6875rem] text-muted-foreground"
                style={{ height: rem(heights[hour] ?? 0) }}
              >
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {columns.map(({ key, events, spans, placements }) => (
            <div
              key={key}
              className={cn(
                "group/col relative border-l border-border/60",
                key === todayIso && "bg-primary/[0.05]",
              )}
            >
              {GRID_HOURS.map((hour) => (
                <button
                  key={hour}
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onClick={() => onCreateOn(key)}
                  /* `block` matters: a button is inline-level, and the
                     leading on each line box made every hour row 6px
                     taller than its label in the gutter -- by the
                     bottom of the grid the two were 96px apart. */
                  className="block w-full border-b border-border/40 transition-colors hover:bg-accent/25"
                  style={{ height: rem(heights[hour] ?? 0) }}
                />
              ))}

              {events.map((event, i) => {
                const span = spans[i];
                const place = placements[i];
                if (!span || !place) return null;
                const stacked = place.kind === "stack";
                const top = stacked
                  ? rowTop(place.hour, heights) + 0.3 + place.index * STACK_STEP_REM
                  : offsetOf(span.start, heights);
                /*
                 * Exactly its share of the hours it covers -- a two
                 * hour session fills two rows, a twenty minute one a
                 * third of its row. No floor is applied: the row grew
                 * instead, so flooring here would only break the
                 * proportions it grew to preserve.
                 */
                const height = stacked ? STACK_BLOCK_REM : offsetOf(span.end, heights) - top;
                const Icon = STATUS_ICON[event.status];

                return (
                  <button
                    key={event.eventId}
                    type="button"
                    onClick={() => onSelectEvent(event)}
                    className={cn(
                      "absolute overflow-hidden rounded-sm bg-surface text-left ring-1 ring-border/70",
                      "transition-colors hover:bg-accent/60 focus-visible:bg-accent/60",
                    )}
                    style={{
                      top: rem(top),
                      height: rem(height),
                      // Stacked blocks take the full column; laned ones
                      // divide it, with a hair of inset so neighbours
                      // read as separate rather than as one striped
                      // column.
                      left: stacked ? "2px" : `calc(${(place.lane / place.lanes) * 100}% + 2px)`,
                      width: stacked ? "calc(100% - 4px)" : `calc(${100 / place.lanes}% - 4px)`,
                    }}
                  >
                    <span
                      className={cn("absolute inset-y-0 left-0 w-[3px]", STATUS_BAR[event.status])}
                      aria-hidden
                    />
                    <span className="block px-1.5 py-1 pl-2.5">
                      <span className="flex items-center gap-1">
                        <Icon
                          className={cn("size-3 shrink-0", STATUS_TEXT[event.status])}
                          aria-hidden
                        />
                        <span className="sr-only">{titleCase(event.status)}: </span>
                        <span className="truncate text-[0.6875rem] font-medium text-foreground">
                          {event.title}
                        </span>
                      </span>
                      {/* A stacked block is one line tall; its times
                          are on the session itself. */}
                      {stacked ? null : (
                        <span className="metric-value mt-0.5 block truncate text-[0.625rem] text-muted-foreground">
                          {event.startTime}–{event.endTime}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}

          {showsToday ? (
            /* The now line runs the width of the grid rather than one
               column, which is how you read "where am I in the day"
               across a week at a glance. */
            <div
              className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
              style={{ top: rem(offsetOf(nowMinutes, heights)), paddingInlineStart: GUTTER }}
              aria-hidden
            >
              <span className="-ms-[3px] size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="h-px flex-1 bg-primary" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
