import { Lightbulb, TrendingDown, TrendingUp } from "lucide-react";

import { insights, type Insight, type InsightKind } from "@/lib/shot-insights";
import { cn } from "@/lib/utils";
import type { Shot } from "@/types/telemetry";

/**
 * What the charts add up to, in words.
 *
 * <p>The answer to "I dont want just random information I want structured
 * information that is useful to the user": the charts hold the evidence, and
 * this says which of them is worth looking at for this particular set of
 * shots. Every line is generated from a measured gap that cleared a sample
 * floor, and each one quotes the numbers behind it so it can be checked
 * against the chart below.
 *
 * <p>It renders nothing at all when nothing in the data clears a threshold.
 * That is the honest result for a short or an unremarkable session, and
 * padding it with "you took 24 shots" would put the thing this replaced
 * straight back.
 */

const ICON: Record<InsightKind, typeof TrendingUp> = {
  strength: TrendingUp,
  gap: TrendingDown,
  note: Lightbulb,
};

/* The symbol carries the colour on its own, with no tile behind it --
   the same treatment the cards and the dashboard metrics use. The tone
   still encodes what kind of insight this is; it just no longer needs a
   block to say it on. */
const TONE: Record<InsightKind, string> = {
  strength: "text-make",
  gap: "text-miss",
  note: "text-primary",
};

export function InsightList({ shots, className }: { shots: Shot[]; className?: string }) {
  const found = insights(shots);
  if (found.length === 0) return null;
  return (
    <ul className={cn("grid gap-2 md:grid-cols-2", className)}>
      {found.map((insight) => (
        <InsightRow key={insight.title} insight={insight} />
      ))}
    </ul>
  );
}

function InsightRow({ insight }: { insight: Insight }) {
  const Icon = ICON[insight.kind];
  return (
    // The same tier the chart cards use for their own blocks of text --
    // these sat on bg-card inside a card of the same colour, so they had
    // a border and no depth at all.
    <li className="tier flex gap-3 px-3 py-2.5">
      <span className={cn("mt-0.5 shrink-0", TONE[insight.kind])} aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-foreground">{insight.title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {insight.detail}
        </span>
      </span>
    </li>
  );
}
