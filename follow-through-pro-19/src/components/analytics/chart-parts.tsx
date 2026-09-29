import type { ReactNode } from "react";

import { EmptyState } from "@/components/common/states";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { rateText, rateTone } from "@/lib/chart-labels";
import { fieldCoverage, type Rate } from "@/lib/shot-insights";
import { cn } from "@/lib/utils";
import type { Shot } from "@/types/telemetry";

/**
 * The furniture the analysis charts share.
 *
 * <p>The readout strip and the category bar row: the two pieces of chart
 * chrome that appear on more than one of them. The wording and colour rules
 * they use live in lib/chart-labels.
 */

/**
 * The tier carrying a chart's answer, whether that is numbers or a
 * sentence.
 *
 * <p>Exactly one of these per card. It is the only tier that takes the
 * accent edge, so it has to stay the thing the eye lands on first.
 */
export function ChartAnswer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("tier tier-lead mb-3 py-2 pr-3 pl-4 text-xs", className)}>{children}</div>
  );
}

/**
 * The one or two numbers a chart is really reporting, above the plot.
 *
 * <p>Reading order down a chart card is what -> question -> answer ->
 * evidence -> key -> caveat, and this is the answer: the line that has to
 * be readable without looking at the plot at all.
 */
export function ChartReadout({
  items,
  className,
}: {
  items: { label: string; value: ReactNode; tone?: "make" | "miss" | "default" }[];
  className?: string | undefined;
}) {
  return (
    <ChartAnswer className={cn("flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground", className)}>
      {items.map((item) => (
        <span key={item.label}>
          {item.label}{" "}
          <span
            className={cn(
              "metric-value",
              item.tone === "make" && "text-make",
              item.tone === "miss" && "text-miss",
              (item.tone ?? "default") === "default" && "text-foreground",
            )}
          >
            {item.value}
          </span>
        </span>
      ))}
    </ChartAnswer>
  );
}

/**
 * The caveat under a chart: the last thing in the card, and the only
 * thing none of the surfaces above it could say.
 *
 * <p>A tier of its own rather than a loose paragraph. These used to be
 * bare text hanging off the bottom of the plot, which made a note about
 * how the data was gathered look like part of the chart it qualifies.
 *
 * <p>No accent edge -- that belongs to the readout alone, and a caveat
 * competing with the answer for the eye is precisely backwards.
 */
export function ChartCaption({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <p className={cn("tier mt-3 px-3 py-2 text-xs text-muted-foreground", className)}>{children}</p>
  );
}

/**
 * What every chart says when it has been handed no shots at all.
 *
 * <p>Distinct from each chart's own "these shots lack the field I need"
 * state, and the distinction matters: with an empty library those messages
 * said things like "these shots carry no release or apex time", which
 * blames the data for what is really nothing having been processed yet and
 * sends the reader hunting for a bug in the chart.
 *
 * <p>It names both possible causes rather than picking one, because a chart
 * handed an empty array genuinely cannot tell them apart. The page above it
 * can, and says which -- see the analytics route, where an empty library
 * gets its own message naming how many videos have been processed.
 */
export function NoShots() {
  return (
    <EmptyState
      title="No shots to chart"
      message="Either no processed video has written shot telemetry yet, or the current filters exclude everything."
    />
  );
}

/**
 * Why a chart went blank, in terms of what the pipeline recorded.
 *
 * <p>Replaces a bare "no flight timings", which is true and unhelpful: it
 * does not say whether the field is missing on some shots or all of them,
 * nor what to do about it. The most common cause by far is a clip processed
 * by a build of the pipeline that predates the field, and that is fixed by
 * re-processing -- so the message says so, with the counts behind it.
 */
export function MissingField({
  shots,
  needs,
}: {
  shots: Shot[];
  /** Which fields this chart cannot do without. */
  needs: ("distance" | "duration" | "apex" | "location")[];
}) {
  const coverage = fieldCoverage(shots);
  const LABEL = {
    distance: "a shot distance",
    duration: "a flight time",
    apex: "a time to apex",
    location: "a court position",
  } as const;

  return (
    <EmptyState
      title="Your clips were processed without these measurements"
      message={`None of these ${coverage.shots} shots carries ${needs.map((n) => LABEL[n]).join(" or ")}. Re-process the video with the current pipeline to record them — clips processed by an earlier build have none.`}
      action={
        /* The counts behind the sentence, so it can be checked rather than
           taken on trust, and so a partial gap is visible as a partial one. */
        <dl className="grid w-full max-w-md grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          {(["distance", "duration", "apex", "location"] as const).map((field) => (
            <div key={field} className="flex items-baseline justify-between gap-2">
              <dt className="text-muted-foreground">{LABEL[field].replace(/^an? /, "")}</dt>
              <dd
                className={cn(
                  "metric-value",
                  coverage[field] === 0 ? "text-miss" : "text-foreground",
                )}
              >
                {coverage[field]}/{coverage.shots}
              </dd>
            </div>
          ))}
        </dl>
      }
    />
  );
}

/**
 * What the bar colours in a `BarRow` list mean.
 *
 * <p>These lists are hand-authored rather than Recharts, so the key is
 * static -- there is nothing to toggle. It is still needed: above and
 * below average are told apart by colour alone here, and the colours
 * follow the theme, so without a key a reader has to already know the
 * convention.
 */
export function RateToneKey({ className }: { className?: string }) {
  return (
    <ChartLegend
      className={className}
      items={[
        { id: "make", label: "5+ above overall", color: "var(--make)", mark: "bar" },
        { id: "miss", label: "5+ below overall", color: "var(--miss)", mark: "bar" },
        { id: "mid", label: "Within 5", color: "var(--primary)", mark: "bar" },
      ]}
    />
  );
}

/**
 * A horizontal bar row, for the charts whose axis is a handful of named
 * categories.
 *
 * <p>Hand-authored rather than a Recharts layout: with four or five rows a
 * chart library buys nothing, and DOM rows can put the attempt count beside
 * every bar and say "No attempts" in place of one, which is awkward to do
 * with a plotted label.
 */
export function BarRow({
  label,
  sublabel,
  rate,
  overall,
}: {
  label: string;
  sublabel?: string;
  rate: Rate;
  overall: number | null;
}) {
  const tone = rateTone(rate.percentage, overall);
  return (
    <div className="grid w-full grid-cols-[minmax(6.5rem,auto)_1fr_auto] items-center gap-3 px-1.5 py-1 text-left">
      <span className="min-w-0">
        <span className="block truncate text-xs text-foreground">{label}</span>
        {sublabel ? (
          <span className="block truncate text-[0.6875rem] text-muted-foreground">{sublabel}</span>
        ) : null}
      </span>
      <span className="relative h-2 overflow-hidden rounded-[2px] bg-muted" aria-hidden>
        {rate.percentage === null ? null : (
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-[2px]",
              tone === "make" && "bg-make",
              tone === "miss" && "bg-miss",
              tone === "neutral" && "bg-primary",
            )}
            style={{ width: `${Math.max(1.5, rate.percentage)}%` }}
          />
        )}
      </span>
      <span
        className={cn(
          "metric-value w-32 shrink-0 text-right text-xs",
          rate.percentage === null && "font-normal text-muted-foreground",
          tone === "make" && "text-make",
          tone === "miss" && "text-miss",
          rate.percentage !== null && tone === "neutral" && "text-foreground",
        )}
      >
        {rateText(rate)}
      </span>
    </div>
  );
}
