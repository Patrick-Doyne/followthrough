import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

import { fmtRounded } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  unit,
  delta,
  deltaSuffix = "",
  hint,
  icon,
  loading = false,
  invertDelta = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: number | undefined;
  deltaSuffix?: string;
  hint?: string | undefined;
  icon?: ReactNode | undefined;
  loading?: boolean;
  invertDelta?: boolean;
}) {
  if (loading) {
    return (
      <div className="panel p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-7 w-20" />
        <Skeleton className="mt-3 h-3 w-16" />
      </div>
    );
  }

  const positive = delta !== undefined && (invertDelta ? delta < 0 : delta > 0);
  const negative = delta !== undefined && (invertDelta ? delta > 0 : delta < 0);
  const DeltaIcon =
    delta === undefined || delta === 0 ? Minus : positive ? TrendingUp : TrendingDown;

  return (
    /*
     * The card's colour comes from its own accent tile and falls away
     * from it -- see the `glow` utility. The tile is the source, which is
     * why the glow is anchored top-left with it rather than washed across
     * the card.
     *
     * One hue, not a hue per metric. A ramp of section colours was tried
     * on the settings page and collapsed back to one, because only one
     * step was ever the one worth looking at and the rest were saturation
     * nobody had chosen.
     */
    /* The glow sits behind the card rather than over its surface -- see
       the `glow` utility. The card's own colour is untouched. */
    <div className="panel glow p-4">
      <div className="flex items-start gap-2.5">
        {/* The symbol itself in the accent, with no tile behind it. A
            solid block with a dark glyph knocked out of it is the card
            header's device; at this size, on eight cards in a row, it
            read as eight buttons. */}
        {icon ? <span className="shrink-0 pt-0.5 text-[var(--sec)]">{icon}</span> : null}
        {/* Two lines' worth of room whether the label needs them or
            not. "Shooting percentage" wraps where the others do not, and
            without this its card's value sat a line lower than the three
            beside it. */}
        <p className="label-caps flex min-h-8 min-w-0 items-center">{label}</p>
      </div>
      <p className="metric-value mt-2.5 text-2xl font-semibold">
        {value}
        {unit ? <span className="ml-1 text-sm text-muted-foreground">{unit}</span> : null}
      </p>
      <div className="mt-2 flex items-center gap-1.5 text-xs">
        {delta !== undefined ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              positive && "text-make",
              negative && "text-miss",
              !positive && !negative && "text-muted-foreground",
            )}
          >
            <DeltaIcon className="size-3.5" aria-hidden />
            {delta > 0 ? "+" : ""}
            {fmtRounded(delta)}
            {deltaSuffix}
          </span>
        ) : null}
        {hint ? <span className="text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}
