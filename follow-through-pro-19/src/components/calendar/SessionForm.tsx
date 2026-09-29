import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDraft } from "@/hooks/use-draft";
import { findConflicts } from "@/lib/session-conflicts";
import { titleCase } from "@/lib/format";
import { STATUS_ICON, STATUS_TEXT } from "@/components/calendar/event-status";
import { cn } from "@/lib/utils";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventStatus,
  TrainingType,
} from "@/types/telemetry";

const TRAINING_TYPES: TrainingType[] = [
  "SHOOTING",
  "SKILLS",
  "CONDITIONING",
  "SCRIMMAGE",
  "RECOVERY",
];

/*
 * Every status the calendar can draw, in the order a session moves
 * through them.
 *
 * <p>`IN_PROGRESS` is included because the calendar renders it and the
 * data model carries it, so leaving it out of the only place a status
 * can be set would make it unreachable.
 */
const STATUSES: CalendarEventStatus[] = ["UPCOMING", "IN_PROGRESS", "COMPLETED", "MISSED"];

const empty = (date: string, duration: number): CalendarEventInput => ({
  title: "",
  date,
  startTime: "17:00",
  endTime: `${String(17 + Math.max(1, Math.round(duration / 60))).padStart(2, "0")}:00`,
  location: "",
  notes: "",
  trainingType: "SHOOTING",
  goals: "",
  // A session you are creating has not happened yet. Stated rather
  // than left undefined so the control always has a value and the
  // server is never the one deciding.
  status: "UPCOMING",
});

export function SessionForm({
  open,
  onOpenChange,
  initialEvent,
  existingEvents = [],
  defaultDate,
  defaultDuration = 75,
  onSubmit,
  onDelete,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEvent?: CalendarEvent | null;
  /**
   * Everything already on the calendar, so a clash can be caught
   * before it is saved rather than drawn afterwards.
   */
  existingEvents?: CalendarEvent[];
  defaultDate: string;
  defaultDuration?: number;
  onSubmit: (input: CalendarEventInput) => void;
  onDelete?: (eventId: string) => void;
  pending?: boolean;
}) {
  const [form, setForm] = useState<CalendarEventInput>(empty(defaultDate, defaultDuration));
  const [restored, setRestored] = useState(false);
  // Drafts are only kept for the new-session form. Editing an existing
  // event already has a source of truth on the server, and resurrecting a
  // stale draft over it would silently undo someone else's change.
  const draft = useDraft<CalendarEventInput>("calendar.new-session");

  useEffect(() => {
    if (!open) return;
    if (!initialEvent) {
      const saved = draft.read();
      if (saved) {
        setForm(saved);
        setRestored(true);
        return;
      }
    }
    setRestored(false);
    setForm(
      initialEvent
        ? {
            title: initialEvent.title,
            date: initialEvent.date,
            startTime: initialEvent.startTime,
            endTime: initialEvent.endTime,
            location: initialEvent.location,
            notes: initialEvent.notes ?? "",
            trainingType: initialEvent.trainingType,
            goals: initialEvent.goals ?? "",
            status: initialEvent.status,
          }
        : empty(defaultDate, defaultDuration),
    );
    // `draft` is rebuilt whenever the auto-save preference changes; adding
    // it here would re-run this and clobber what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialEvent, defaultDate, defaultDuration]);

  const set = <K extends keyof CalendarEventInput>(key: K, value: CalendarEventInput[K]) =>
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (!initialEvent) draft.write(next);
      return next;
    });

  /*
   * Two sessions cannot occupy the same time.
   *
   * <p>Checked as you type rather than only on submit, so the clash
   * is visible while the times are still under your hands. The
   * session being edited is excluded -- it always overlaps itself.
   */
  const conflicts = findConflicts(
    { date: form.date, startTime: form.startTime, endTime: form.endTime },
    existingEvents.filter((event) => event.eventId !== initialEvent?.eventId),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initialEvent ? "Edit training session" : "New training session"}
          </DialogTitle>
          <DialogDescription>
            Scheduled sessions appear on the calendar and drive training reminders.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            // Belt as well as braces: the button is disabled on a
            // clash, but a form can still be submitted by pressing
            // Enter in a field.
            if (conflicts.length > 0) return;
            // Clear before submitting: a draft that outlives its own
            // submission reappears the next time the form opens.
            draft.clear();
            setRestored(false);
            onSubmit(form);
          }}
        >
          {restored ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              <span>Restored an unsaved draft.</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  draft.clear();
                  setRestored(false);
                  setForm(empty(defaultDate, defaultDuration));
                }}
              >
                Discard
              </Button>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="cv-title">Title</Label>
            <Input
              id="cv-title"
              required
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Perimeter volume block"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cv-date">Date</Label>
              <Input
                id="cv-date"
                type="date"
                required
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv-start">Start</Label>
              <Input
                id="cv-start"
                type="time"
                required
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv-end">End</Label>
              <Input
                id="cv-end"
                type="time"
                required
                value={form.endTime}
                onChange={(e) => set("endTime", e.target.value)}
              />
            </div>
          </div>

          {conflicts.length > 0 ? (
            /* Under the times rather than beside the button: this is
               about the times, and it is what has to change. */
            <p
              role="alert"
              className="rounded-md border border-miss/40 bg-miss/10 px-3 py-2 text-xs text-miss"
            >
              {conflicts.length === 1
                ? "This clashes with "
                : `This clashes with ${conflicts.length} sessions, including `}
              <span className="font-semibold">{conflicts[0]?.title}</span>{" "}
              <span className="metric-value">
                ({conflicts[0]?.startTime}–{conflicts[0]?.endTime})
              </span>
              . Sessions cannot overlap — back to back is fine.
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cv-location">Location</Label>
              <Input
                id="cv-location"
                required
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Riverside Fieldhouse"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Training type</Label>
              <Select
                value={form.trainingType}
                onValueChange={(v) => set("trainingType", v as TrainingType)}
              >
                <SelectTrigger aria-label="Training type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {titleCase(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={form.status ?? "UPCOMING"}
              onValueChange={(v) => set("status", v as CalendarEventStatus)}
            >
              <SelectTrigger aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((status) => {
                  const Icon = STATUS_ICON[status];
                  return (
                    <SelectItem key={status} value={status}>
                      <span className="flex items-center gap-2">
                        <Icon className={cn("size-3.5", STATUS_TEXT[status])} aria-hidden />
                        {titleCase(status)}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              What the calendar colours this session by.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cv-goals">Goals (optional)</Label>
            <Input
              id="cv-goals"
              value={form.goals ?? ""}
              onChange={(e) => set("goals", e.target.value)}
              placeholder="38%+ from the arc"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cv-notes">Notes</Label>
            <Textarea
              id="cv-notes"
              rows={3}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {initialEvent && onDelete ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(initialEvent.eventId)}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || conflicts.length > 0}>
                {initialEvent ? "Save changes" : "Create session"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
