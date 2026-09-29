import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SessionForm } from "@/components/calendar/SessionForm";
import {
  CalendarPeriodNav,
  CalendarViewSwitch,
  TrainingCalendar,
} from "@/components/calendar/TrainingCalendar";
import { calendarPeriodLabel, type CalendarView } from "@/lib/calendar-period";
import { CalendarArt } from "@/components/calendar/CalendarArt";
import { HeroDivider, HeroStrong, PageHero } from "@/components/common/PageHero";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { AppShell, PageContainer } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { fmtMonthYear, titleCase } from "@/lib/format";
import { ApiError } from "@/services/http";
import { calendarService } from "@/services/followthrough";
import { calendarQuery, userQuery } from "@/services/queries";
import { useNotify } from "@/state/notifications";
import { useDestructiveAction } from "@/state/undo";
import type { CalendarEvent, CalendarEventInput } from "@/types/telemetry";

/** Turns a rejected save -- the backend's per-field validation errors, or
 * an overlap with another session -- into a message the user can actually
 * act on, instead of the form silently closing anyway. */
function describeSaveError(error: unknown): string {
  if (error instanceof ApiError && error.fieldErrors) {
    return Object.entries(error.fieldErrors)
      .map(([field, message]) => `${field}: ${message}`)
      .join(", ");
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Training Calendar — FollowThrough" },
      {
        name: "description",
        content:
          "Plan, reschedule and review basketball training sessions across month, week and day views.",
      },
      { property: "og:title", content: "Training Calendar — FollowThrough" },
      {
        property: "og:description",
        content: "Schedule shooting, skills and conditioning sessions in one place.",
      },
    ],
  }),
  component: CalendarRoute,
});

const iso = (d: Date) => d.toISOString().slice(0, 10);

function CalendarRoute() {
  const qc = useQueryClient();
  const notify = useNotify();
  const { perform } = useDestructiveAction();
  const user = useQuery(userQuery());

  const [view, setView] = useState<CalendarView>("MONTH");
  const [cursor, setCursor] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [defaultDate, setDefaultDate] = useState(iso(new Date()));

  // Previous/current/next month around whatever's in view, so paging the
  // grid a month at a time only ever needs at most one extra fetch on
  // either side — not true pagination, since the grid needs every event
  // in its visible window, not an arbitrary slice of them.
  const monthWindow = useMemo(() => {
    const from = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0);
    return { from: iso(from), to: iso(to) };
  }, [cursor]);

  const events = useQuery(calendarQuery(monthWindow.from, monthWindow.to));
  // Independent of the grid's window on purpose: "what's coming up" should
  // stay correct even while browsing a past/future month on the grid.
  const upcomingEvents = useQuery(calendarQuery());

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["calendar"] });

  const onSaveError = (error: unknown) =>
    toast.error("Couldn't save the session", { description: describeSaveError(error) });

  const createEvent = useMutation({
    mutationFn: (input: CalendarEventInput) => calendarService.create(input),
    onSuccess: invalidate,
    onError: onSaveError,
  });
  const updateEvent = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CalendarEventInput }) =>
      calendarService.update(id, input),
    onSuccess: invalidate,
    onError: onSaveError,
  });
  const removeEvent = useMutation({
    mutationFn: (id: string) => calendarService.remove(id),
    onSuccess: invalidate,
    onError: (error) =>
      notify("Couldn't delete the session", {
        kind: "error",
        body: describeSaveError(error),
        // The person is standing at the result of their own action, so
        // this must show even during quiet hours.
        urgent: true,
      }),
  });

  // Memoised because the band's figures key off it: `?? []` is a new
  // array on every render, which would recompute them every time.
  const list = useMemo(() => events.data ?? [], [events.data]);
  const upcoming = (upcomingEvents.data ?? [])
    .filter((e) => e.date >= iso(new Date()) && e.status !== "COMPLETED")
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
    // Enough to fill the card beside the month grid rather than leave
    // most of it empty; the body scrolls past that.
    .slice(0, 30);

  /*
   * What the band says: the month's training volume.
   *
   * <p>Always the cursor's month, whichever view is open, and the meta
   * line names the month so that is never ambiguous. The card below
   * carries the period you are actually navigating, so the two do not
   * repeat each other.
   */
  const month = useMemo(() => {
    const events = list.filter((event) => {
      const [y, m] = event.date.split("-");
      return Number(y) === cursor.getFullYear() && Number(m) === cursor.getMonth() + 1;
    });
    const minutes = events.reduce((total, event) => {
      const [sh, sm] = event.startTime.split(":").map(Number);
      const [eh, em] = event.endTime.split(":").map(Number);
      // An end before its start is an overnight session, not a negative one.
      const span = (eh ?? 0) * 60 + (em ?? 0) - ((sh ?? 0) * 60 + (sm ?? 0));
      return total + (span < 0 ? span + 24 * 60 : span);
    }, 0);
    return {
      total: events.length,
      completed: events.filter((event) => event.status === "COMPLETED").length,
      missed: events.filter((event) => event.status === "MISSED").length,
      hours: Math.round(minutes / 60),
    };
  }, [list, cursor]);

  const isPending = events.isPending || upcomingEvents.isPending;
  const isError = events.isError || upcomingEvents.isError;
  const retry = () => {
    void events.refetch();
    void upcomingEvents.refetch();
  };

  return (
    <AppShell>
      {/* hideHeader: the band below is this page's header. */}
      <PageContainer title="Training Calendar" hideHeader>
        {/* Everything above the grid lives in the band: the month and
            its figures, the view switcher and the one action. The page
            then runs band -> calendar with nothing in between, which is
            what makes the two read as one surface.

            The controls are allowed here, unlike the settings search,
            because each of them brings its own opaque background. The
            drawing behind them is faint but it is still line work. */}
        <PageHero
          art={<CalendarArt />}
          eyebrow="Training calendar"
          title={calendarPeriodLabel(view, cursor)}
          meta={
            <>
              {/* The figures are the month's, so when the title is a
                  week or a day the month has to be named or they read
                  as figures for what is on screen. */}
              {view !== "MONTH" ? (
                <>
                  <HeroStrong>{fmtMonthYear(cursor)}</HeroStrong>
                  <HeroDivider />
                </>
              ) : null}
              <span>{month.completed} completed</span>
              {month.missed > 0 ? (
                <>
                  <HeroDivider />
                  <span>{month.missed} missed</span>
                </>
              ) : null}
              <HeroDivider />
              <span>
                {month.hours} {month.hours === 1 ? "hour" : "hours"}
              </span>
            </>
          }
          toolbar={
            <>
              <CalendarViewSwitch variant="band" view={view} onViewChange={setView} />
              {/* shadow-none is the load-bearing part.

                  The button and the "Month" segment beside it are the
                  same 36px box with the same top and bottom, but the
                  button carried the default `shadow-xs`, which paints
                  outside the box and made it read as the larger of
                  the two however the boxes were measured. */}
              <Button
                className="h-9 gap-1.5 px-3 text-xs shadow-none"
                onClick={() => {
                  setEditing(null);
                  setDefaultDate(iso(cursor));
                  setFormOpen(true);
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                New session
              </Button>
              <CalendarPeriodNav view={view} cursor={cursor} onCursorChange={setCursor} />
            </>
          }
        />

        {isPending ? (
          <LoadingState rows={6} label="Loading schedule…" />
        ) : isError ? (
          <ErrorState
            title="Your calendar didn't load"
            message="Check your connection, then try again."
            onRetry={retry}
          />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]">
            <TrainingCalendar
              events={list}
              view={view}
              cursor={cursor}
              onSelectEvent={(event) => {
                setEditing(event);
                setDefaultDate(event.date);
                setFormOpen(true);
              }}
              onOpenDay={(dateIso) => {
                setCursor(new Date(`${dateIso}T12:00:00`));
                setView("DAY");
              }}
              onCreateOn={(dateIso) => {
                setEditing(null);
                setDefaultDate(dateIso);
                setFormOpen(true);
              }}
            />

            {/* The calendar sets the height of the row; this follows
                it and scrolls whatever does not fit.

                From `xl` the card is taken out of flow inside an empty
                wrapper, which is the only reliable way to stop it
                sizing the row: an `auto` grid track is sized by its
                items' max-content, and `min-height: 0` does not touch
                that. Left in flow, thirty upcoming sessions fixed
                every view at 1005px and the calendar -- stretched to
                match -- carried a 738px empty tail in week view and
                870px in day view.

                Below `xl` the grid is a single column, so the card
                stays in flow and simply sizes to its content. */}
            <div className="relative">
              {/* The positioning goes on this plain div, not on the
                  card: `.sheet` sets `position: relative` in an
                  unlayered rule, which wins over Tailwind's layered
                  `absolute` utility, so the card silently stayed in
                  flow. */}
              <div className="flex xl:absolute xl:inset-0">
                <SectionCard
                  icon={CalendarClock}
                  title="Upcoming"
                  description="Next scheduled sessions"
                  className="min-h-0 w-full"
                  bodyClassName="min-h-0 overflow-y-auto p-0"
                >
                  {upcoming.length === 0 ? (
                    <div className="p-3">
                      <EmptyState
                        title="Nothing scheduled"
                        message="Pick a day on the calendar to plan a session."
                      />
                    </div>
                  ) : (
                    <ul className="divide-y divide-border">
                      {upcoming.map((event) => (
                        <li key={event.eventId}>
                          <button
                            type="button"
                            className="w-full px-3 py-2.5 text-left hover:bg-accent/40"
                            onClick={() => {
                              setEditing(event);
                              setDefaultDate(event.date);
                              setFormOpen(true);
                            }}
                          >
                            <p className="text-sm font-medium">{event.title}</p>
                            <p className="metric-value text-xs text-muted-foreground">
                              {event.date} · {event.startTime}–{event.endTime} ·{" "}
                              {titleCase(event.trainingType)}
                            </p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionCard>
              </div>
            </div>
          </div>
        )}

        <SessionForm
          open={formOpen}
          onOpenChange={setFormOpen}
          initialEvent={editing}
          /* Both windows: the grid's is the months around the cursor,
             and the upcoming query reaches further out, so a clash
             with something outside the visible month is still caught. */
          existingEvents={[
            ...list,
            ...(upcomingEvents.data ?? []).filter(
              (event) => !list.some((seen) => seen.eventId === event.eventId),
            ),
          ]}
          defaultDate={defaultDate}
          defaultDuration={user.data?.preferences.defaultSessionDuration ?? 75}
          pending={createEvent.isPending || updateEvent.isPending}
          onSubmit={(input) => {
            const onSuccess = () => setFormOpen(false);
            if (editing) updateEvent.mutate({ id: editing.eventId, input }, { onSuccess });
            else createEvent.mutate(input, { onSuccess });
          }}
          onDelete={(eventId) => {
            const target = list.find((event) => event.eventId === eventId);
            perform({
              title: "Delete this training session?",
              description: target
                ? `"${target.title}" will be removed from your calendar.`
                : undefined,
              confirmLabel: "Delete",
              undoMessage: "Training session deleted",
              // Closing the form is the optimistic step: the event vanishes
              // from view immediately, while the request is held back until
              // the undo window closes.
              optimistic: () => setFormOpen(false),
              commit: () => removeEvent.mutate(eventId),
              rollback: () => invalidate(),
            });
          }}
        />
      </PageContainer>
    </AppShell>
  );
}
