import { CalendarDays, X } from "lucide-react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FeatureGate } from "@/state/subscription";
import { fmtShortDate, fmtShotType, titleCase } from "@/lib/format";
import type { TrainingSession } from "@/types/telemetry";

export interface AnalyticsFilters {
  sessionId: string; // "ALL" or a sessionId
  comparisonSessionId: string; // "NONE" or a sessionId
  from: string;
  to: string;
  result: "ALL" | "MAKE" | "MISS";
  shotType: string;
  zone: string;
}

export const DEFAULT_FILTERS: AnalyticsFilters = {
  sessionId: "ALL",
  comparisonSessionId: "NONE",
  from: "",
  to: "",
  result: "ALL",
  shotType: "ALL",
  zone: "ALL",
};

const SHOT_TYPES = ["ALL", "LAY_UP", "CLS_RNG", "MID_RNG", "HS_3PT", "NCAA_3PT", "NBA_3PT"];
const ZONES = [
  "ALL",
  "PAINT",
  "FREE_THROW_LINE",
  "MID_RANGE_LEFT",
  "MID_RANGE_CENTER",
  "MID_RANGE_RIGHT",
  "CORNER_LEFT",
  "CORNER_RIGHT",
  "WING_LEFT",
  "WING_RIGHT",
  "TOP_OF_KEY",
];

function Field({
  label,
  children,
  active = false,
}: {
  label: string;
  children: React.ReactNode;
  /** Whether this control is currently narrowing the data. */
  active?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className={cn("label-caps", active && "text-[var(--sec)]")}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * A control that is currently narrowing the data.
 *
 * <p>Eight controls all rendered identically say nothing about which of
 * them is doing something. The set ones take the accent on their label
 * and a ring on the field, so the row reads at a glance instead of having
 * to be compared against its defaults one field at a time.
 */
const ACTIVE_FIELD = "border-[var(--sec)] ring-1 ring-[var(--sec)]/40 text-foreground";

/**
 * A date input wearing the same clothes as the selects beside it.
 *
 * <p>The calendar button is the app's own icon rather than the browser's:
 * see the `.date-field` rules in styles.css for why the native one had to
 * go.
 */
function DateField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type="date"
        data-filled={value ? "true" : "false"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn("date-field pr-9", value && ACTIVE_FIELD)}
      />
      <button
        type="button"
        // The input is the labelled control; this only opens its picker,
        // so it is hidden from assistive tech rather than announced as a
        // second thing to operate.
        tabIndex={-1}
        aria-hidden
        onClick={() => ref.current?.showPicker?.()}
        className={cn(
          "absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-sm",
          "text-muted-foreground hover:text-[var(--sec)]",
        )}
      >
        <CalendarDays className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Filter bar. Changing a value updates local state only — no page reload. */
export function ChartFilters({
  filters,
  sessions,
  onChange,
  onReset,
}: {
  filters: AnalyticsFilters;
  sessions: TrainingSession[];
  onChange: (next: AnalyticsFilters) => void;
  onReset: () => void;
}) {
  const set = <K extends keyof AnalyticsFilters>(key: K, value: AnalyticsFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const active = activeFilters(filters, sessions);

  return (
    <div className="space-y-3">
      {/*
       * What is currently narrowing the data, as chips you can take off
       * one at a time.
       *
       * <p>Eight selects in a grid tell you what you *can* filter by and
       * not what you *have*: finding the one you set meant reading all
       * eight and comparing each against its default. The chips say it in
       * one line, and removing one is a click rather than a hunt.
       */}
      {active.length > 0 ? (
        <div className="tier tier-lead flex flex-wrap items-center gap-1.5 py-2 pr-3 pl-4">
          <span className="label-caps mr-1">Showing</span>
          {active.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange({ ...filters, ...chip.clear })}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs",
                "bg-[color-mix(in_oklab,var(--sec)_16%,transparent)] text-foreground",
                "hover:bg-[color-mix(in_oklab,var(--sec)_26%,transparent)]",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
            >
              {chip.label}
              <X className="size-3" aria-hidden />
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={onReset} className="ml-auto">
            Clear all
          </Button>
        </div>
      ) : (
        <p className="tier px-3 py-2 text-xs text-muted-foreground">
          Showing every shot in your library. Narrow it with the controls below.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Field label="Training session" active={filters.sessionId !== "ALL"}>
          <Select value={filters.sessionId} onValueChange={(v) => set("sessionId", v)}>
            <SelectTrigger
              aria-label="Training session"
              className={cn(filters.sessionId !== "ALL" && ACTIVE_FIELD)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All sessions</SelectItem>
              {sessions.map((s) => (
                <SelectItem key={s.sessionId} value={s.sessionId}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Shot result" active={filters.result !== "ALL"}>
          <Select
            value={filters.result}
            onValueChange={(v) => set("result", v as AnalyticsFilters["result"])}
          >
            <SelectTrigger
              aria-label="Shot result"
              className={cn(filters.result !== "ALL" && ACTIVE_FIELD)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Makes & misses</SelectItem>
              <SelectItem value="MAKE">Makes only</SelectItem>
              <SelectItem value="MISS">Misses only</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Shot type" active={filters.shotType !== "ALL"}>
          <Select value={filters.shotType} onValueChange={(v) => set("shotType", v)}>
            <SelectTrigger
              aria-label="Shot type"
              className={cn(filters.shotType !== "ALL" && ACTIVE_FIELD)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHOT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "ALL" ? "All types" : fmtShotType(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Court location" active={filters.zone !== "ALL"}>
          <Select value={filters.zone} onValueChange={(v) => set("zone", v)}>
            <SelectTrigger
              aria-label="Court location"
              className={cn(filters.zone !== "ALL" && ACTIVE_FIELD)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ZONES.map((z) => (
                <SelectItem key={z} value={z}>
                  {z === "ALL" ? "All locations" : titleCase(z)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="From" active={Boolean(filters.from)}>
          <DateField
            value={filters.from}
            onChange={(next) => set("from", next)}
            label="From date"
          />
        </Field>

        <Field label="To" active={Boolean(filters.to)}>
          <DateField value={filters.to} onChange={(next) => set("to", next)} label="To date" />
        </Field>

        <div className="min-w-0 space-y-1.5">
          <Label
            className={cn(
              "label-caps",
              filters.comparisonSessionId !== "NONE" && "text-[var(--sec)]",
            )}
          >
            Compare with
          </Label>
          <FeatureGate
            feature="comparisonMode"
            fallback={
              <Button variant="outline" size="sm" className="w-full justify-start" disabled>
                Session comparison — Basic plan
              </Button>
            }
          >
            <Select
              value={filters.comparisonSessionId}
              onValueChange={(v) => set("comparisonSessionId", v)}
            >
              <SelectTrigger
                aria-label="Comparison session"
                className={cn(filters.comparisonSessionId !== "NONE" && ACTIVE_FIELD)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No comparison</SelectItem>
                {sessions.map((s) => (
                  <SelectItem key={s.sessionId} value={s.sessionId}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FeatureGate>
        </div>
      </div>
    </div>
  );
}

interface FilterChip {
  key: string;
  label: string;
  /** The patch that takes this one filter back off. */
  clear: Partial<AnalyticsFilters>;
}

/**
 * The filters that are actually narrowing something, in reading order.
 *
 * <p>Only non-default values appear.
 */
function activeFilters(filters: AnalyticsFilters, sessions: TrainingSession[]): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.sessionId !== "ALL") {
    const session = sessions.find((s) => s.sessionId === filters.sessionId);
    chips.push({
      key: "sessionId",
      label: session ? session.name : "One session",
      clear: { sessionId: "ALL" },
    });
  }
  if (filters.result !== "ALL") {
    chips.push({
      key: "result",
      label: filters.result === "MAKE" ? "Makes only" : "Misses only",
      clear: { result: "ALL" },
    });
  }
  if (filters.shotType !== "ALL") {
    chips.push({
      key: "shotType",
      label: fmtShotType(filters.shotType),
      clear: { shotType: "ALL" },
    });
  }
  if (filters.zone !== "ALL") {
    chips.push({
      key: "zone",
      label: titleCase(filters.zone.replace(/_/g, " ")),
      clear: { zone: "ALL" },
    });
  }
  if (filters.from || filters.to) {
    // Read back in the same words the rest of the app writes dates in.
    // The raw value is an ISO string, and "From 2026-07-01" in a chip
    // beside "Makes only" reads as a machine's output rather than a
    // choice somebody made.
    const day = (iso: string) => fmtShortDate(new Date(`${iso}T00:00:00`).toISOString());
    chips.push({
      key: "dates",
      label:
        filters.from && filters.to
          ? `${day(filters.from)} – ${day(filters.to)}`
          : filters.from
            ? `From ${day(filters.from)}`
            : `Until ${day(filters.to)}`,
      clear: { from: "", to: "" },
    });
  }
  if (filters.comparisonSessionId !== "NONE") {
    const session = sessions.find((s) => s.sessionId === filters.comparisonSessionId);
    chips.push({
      key: "comparison",
      label: `Compared with ${session ? session.name : "another session"}`,
      clear: { comparisonSessionId: "NONE" },
    });
  }
  return chips;
}
