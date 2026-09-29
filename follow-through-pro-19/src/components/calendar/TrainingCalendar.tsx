import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo } from "react";

import { STATUS_BAR, STATUS_ICON, STATUS_TEXT } from "@/components/calendar/event-status";
import { TimeGrid } from "@/components/calendar/TimeGrid";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState } from "@/components/common/states";
import { firstDayOfWeek, fmtMonthDay, fmtMonthYear, fmtWeekdayDay, titleCase } from "@/lib/format";
import { dateFormatter } from "@/lib/intl";
import { cn } from "@/lib/utils";
import {
  addDays,
  calendarPeriodLabel,
  startOfWeek,
  stepPeriod,
  weekdayHeadings,
  type CalendarView,
} from "@/lib/calendar-period";
import type { CalendarEvent, CalendarEventStatus } from "@/types/telemetry";

/** The hover-and-focus "add a session here" affordance on a day. */
function AddOnDay({ dateIso, onCreateOn }: { dateIso: string; onCreateOn: (iso: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCreateOn(dateIso)}
      aria-label={`Add training session on ${dateIso}`}
      /* Hidden with opacity, never display:none -- it has to stay in
         the tab order and reachable by a screen reader on a day that
         is not being hovered. */
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0",
        "transition-opacity group-hover/day:opacity-100 focus-visible:opacity-100",
        "hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Plus className="size-3.5" aria-hidden />
    </button>
  );
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Previous / next / today.
 *
 * <p>It sits on the band, beside the period it moves. It used to be in
 * the calendar's own header, which meant pressing an arrow changed a
 * heading in a different card further up the page.
 */
export function CalendarPeriodNav({
  view,
  cursor,
  onCursorChange,
}: {
  view: CalendarView;
  cursor: Date;
  onCursorChange: (date: Date) => void;
}) {
  return (
    // No inner padding: every control in this row is one 36px block,
    // so the buttons fill the rail rather than floating inside it.
    <div className="hero-rail flex h-9 items-center overflow-hidden rounded-md">
      {(
        [
          [-1, "Previous period", ChevronLeft],
          [1, "Next period", ChevronRight],
        ] as const
      ).map(([dir, label, Icon]) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          onClick={() => onCursorChange(stepPeriod(view, cursor, dir))}
          className={cn(
            "grid h-9 w-9 place-items-center transition-colors",
            "text-[var(--hero-muted)] hover:bg-white/10 hover:text-[var(--hero-fg)]",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
      <button
        type="button"
        onClick={() => onCursorChange(new Date())}
        className={cn(
          "h-9 px-3 text-xs font-medium transition-colors",
          "text-[var(--hero-muted)] hover:bg-white/10 hover:text-[var(--hero-fg)]",
        )}
      >
        Today
      </button>
    </div>
  );
}

/**
 * Month / Week / Day.
 *
 * <p>Separate from the calendar so the page can put it on the band with
 * the rest of the controls.
 */
export function CalendarViewSwitch({
  view,
  onViewChange,
  variant = "page",
}: {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  /**
   * `band` is the smaller form that rides the hero.
   *
   * <p>It cannot use the page's surface for its rail -- the band is
   * dark in both themes, so in light mode that would be a near-white
   * slab dropped onto it. `.hero-rail` is the band's own scrim.
   */
  variant?: "page" | "band";
}) {
  const onBand = variant === "band";

  return (
    // The same rail the settings tabs sit on: one strip, the active
    // segment filled with the section hue. Three outlined buttons with
    // gaps between them read as three buttons, not as one control with
    // one answer.
    <ToggleGroup
      type="single"
      value={view}
      onValueChange={(v) => v && onViewChange(v as CalendarView)}
      className={cn(
        "w-auto justify-start gap-0 rounded-md",
        onBand ? "hero-rail h-9 overflow-hidden" : "h-auto bg-surface p-1",
      )}
    >
      {(
        [
          ["MONTH", "Month"],
          ["WEEK", "Week"],
          ["DAY", "Day"],
        ] as const
      ).map(([value, label]) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={`${label} view`}
          className={cn(
            "shrink-0 font-medium transition-colors",
            onBand
              ? "h-9 rounded-none px-3 text-xs text-[var(--hero-muted)] hover:text-[var(--hero-fg)]"
              : "rounded-sm px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
            "data-[state=on]:bg-[var(--sec)] data-[state=on]:text-[var(--sec-on)]",
          )}
        >
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function EventChip({
  event,
  onSelect,
  detailed = false,
}: {
  event: CalendarEvent;
  onSelect: (event: CalendarEvent) => void;
  detailed?: boolean;
}) {
  const Icon = STATUS_ICON[event.status];
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={cn(
        "relative flex w-full overflow-hidden rounded-sm bg-surface/70 text-left transition-colors",
        "hover:bg-accent/50 focus-visible:bg-accent/50",
        detailed ? "items-start gap-2 p-2 pl-3" : "items-center gap-1.5 py-1 pr-1.5 pl-2.5",
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-[3px]", STATUS_BAR[event.status])}
        aria-hidden
      />
      <Icon
        className={cn("size-3 shrink-0", STATUS_TEXT[event.status], detailed && "mt-0.5")}
        aria-hidden
      />
      <span className="sr-only">{titleCase(event.status)}: </span>
      {detailed ? (
        /* One fact per line. As a single run it wrapped inside a
           160px week column into four lines with the separators
           stranded at the ends of them. */
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-xs font-medium text-foreground">{event.title}</span>
          <span className="metric-value mt-0.5 block text-[0.625rem] text-muted-foreground">
            {event.startTime}–{event.endTime}
          </span>
          <span className="block truncate text-[0.625rem] text-muted-foreground">
            {titleCase(event.trainingType)}
            {event.location ? ` · ${event.location}` : ""}
          </span>
        </span>
      ) : (
        /* No start time in the month cell. A column is about 160px
           wide, and a bar, a glyph and a right-aligned time left the
           title roughly 90px -- every session rendered as "Cond…".
           The month answers what is on and how much of it; week and
           day answer when. */
        <span className="min-w-0 flex-1 truncate text-[0.6875rem] font-medium text-foreground">
          {event.title}
        </span>
      )}
    </button>
  );
}

export function TrainingCalendar({
  events,
  view,
  cursor,
  onSelectEvent,
  onCreateOn,
  onOpenDay,
}: {
  events: CalendarEvent[];
  view: CalendarView;
  cursor: Date;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreateOn: (dateIso: string) => void;
  /** Opens one day on its own. The month is a summary; this is how
   * you get from a crowded cell to the hour it actually happened. */
  onOpenDay: (dateIso: string) => void;
}) {
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((e) => {
      map.set(e.date, [...(map.get(e.date) ?? []), e]);
    });
    map.forEach((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [events]);

  return (
    /* No header. The band directly above states the period and holds the
       navigation, the view switcher and the action, so a header here
       would repeat all of it two lines later. The accent top edge stays,
       so this is still a card in the same system -- one that happens to
       be all body. */
    <div className="sheet">
      {view === "MONTH" ? (
        <MonthGrid
          cursor={cursor}
          byDate={byDate}
          onSelectEvent={onSelectEvent}
          onCreateOn={onCreateOn}
          onOpenDay={onOpenDay}
        />
      ) : (
        <TimeGrid
          days={
            view === "WEEK"
              ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i))
              : [cursor]
          }
          byDate={byDate}
          onSelectEvent={onSelectEvent}
          onCreateOn={onCreateOn}
          showDayHeaders={view === "WEEK"}
        />
      )}

      {/*
          The key: the glyphs and nothing around them.

          A row of solid colour chips was the loudest thing on the
          card and competed with the sessions above it, which are the
          part worth looking at. Boxing the glyphs instead was quieter
          but still four more rectangles on a page made of them. The
          glyph and its colour already say the whole thing.
      */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border bg-surface/40 px-3 py-2 text-[0.6875rem] text-muted-foreground">
        {(["COMPLETED", "IN_PROGRESS", "UPCOMING", "MISSED"] as CalendarEventStatus[]).map(
          (status) => {
            const Icon = STATUS_ICON[status];
            return (
              <li key={status} className="flex items-center gap-1.5">
                <Icon className={cn("size-3.5 shrink-0", STATUS_TEXT[status])} aria-hidden />
                {titleCase(status)}
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
}

function MonthGrid({
  cursor,
  byDate,
  onSelectEvent,
  onCreateOn,
  onOpenDay,
}: {
  cursor: Date;
  byDate: Map<string, CalendarEvent[]>;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreateOn: (dateIso: string) => void;
  onOpenDay: (dateIso: string) => void;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const todayIso = iso(new Date());

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* The weekday strip sits on its own ground so the grid reads
            as a table with a head, not as seven columns of the same
            thing. */}
        <div className="grid grid-cols-7 border-b border-border bg-surface/50">
          {weekdayHeadings().map((d, i) => (
            <div
              key={d}
              className={cn(
                "label-caps px-2 py-2 text-center",
                isWeekendColumn(i) && "text-muted-foreground/60",
              )}
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const key = iso(day);
            const dayEvents = byDate.get(key) ?? [];
            const inMonth = day.getMonth() === cursor.getMonth();
            const isToday = key === todayIso;
            const weekend = day.getDay() === 0 || day.getDay() === 6;

            return (
              <div
                key={key}
                className={cn(
                  "group/day relative min-h-[104px] border-r border-b border-border/60 p-1.5",
                  // The seventh cell of every row is against the card
                  // edge, where a border doubles up with the card's own.
                  "[&:nth-child(7n)]:border-r-0",
                  // Structure without decoration: the weekend columns
                  // are a shade recessed, so the eye finds a week
                  // without having to count.
                  weekend && "bg-foreground/[0.04]",
                  // Days from the neighbouring months are recessed
                  // rather than faded. Fading the whole cell took the
                  // sessions on them down with it, and those are real
                  // sessions you can still click.
                  !inMonth && "bg-background/50",
                  isToday && "bg-primary/[0.07]",
                )}
              >
                {/* Today gets the same 3px accent edge a card carries,
                    which is the app's existing "this one" mark. */}
                {isToday ? (
                  <span className="absolute inset-x-0 top-0 h-[3px] bg-primary" aria-hidden />
                ) : null}

                <div className="mb-1 flex items-center justify-between gap-1">
                  {/* The date opens the day. A month cell shows at
                      most three sessions and no times at all, so the
                      way out of a crowded day has to be the obvious
                      thing to click on it. */}
                  <button
                    type="button"
                    onClick={() => onOpenDay(key)}
                    aria-label={`Open ${key}`}
                    className={cn(
                      "metric-value grid size-5 place-items-center text-[0.6875rem] transition-colors",
                      isToday
                        ? // The notch again, at its smallest scale.
                          "notch bg-primary font-bold text-primary-foreground hover:brightness-110"
                        : inMonth
                          ? "rounded-sm text-foreground/75 hover:bg-accent hover:text-accent-foreground"
                          : "rounded-sm text-muted-foreground/50 hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {day.getDate()}
                  </button>
                  <AddOnDay dateIso={key} onCreateOn={onCreateOn} />
                </div>

                <div className="space-y-1">
                  {dayEvents.slice(0, 3).map((event) => (
                    <EventChip key={event.eventId} event={event} onSelect={onSelectEvent} />
                  ))}
                  {dayEvents.length > 3 ? (
                    <button
                      type="button"
                      onClick={() => onOpenDay(key)}
                      className="rounded-sm pt-0.5 pl-1 text-[0.625rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      +{dayEvents.length - 3} more
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Whether a column of the grid is a weekend, allowing for the
 * configured first day of the week. */
function isWeekendColumn(index: number): boolean {
  const weekday = (firstDayOfWeek() + index) % 7;
  return weekday === 0 || weekday === 6;
}
