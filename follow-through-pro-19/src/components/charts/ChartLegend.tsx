import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The key to a chart's marks.
 *
 * <p>Every chart carries one, and that is the condition on the data
 * colours following the theme. A swatch whose colour changes with the
 * theme is fine as long as the chart says, in the same view, what the mark
 * means -- without that, a green line is only meaningful to someone who
 * already knows the convention, and a custom accent makes it meaningless
 * to everyone.
 *
 * <p>The swatch draws the mark's real shape, not a generic square. That is
 * not decoration: in the light palette the make green and the miss red
 * measure 1.035:1 against each other, so they are the same brightness and
 * a reader who cannot separate the hues has nothing else to go on. Circle
 * against cross, solid against hatched and solid against dashed all still
 * read.
 *
 * <p>Interactive where the chart can support it: clicking an entry hides
 * that series, which is the quickest way to answer "which line is which"
 * and to read a busy plot one series at a time.
 */

export type LegendMark =
  "line" | "dashed" | "bar" | "barHatched" | "circle" | "cross" | "band" | "hollow";

export interface LegendItem {
  id: string;
  label: string;
  /** The colour the mark is actually drawn in, so the two cannot drift. */
  color: string;
  mark: LegendMark;
  /**
   * Which side's axis to read this against, on a chart with two.
   *
   * <p>The side only -- "left", "right". The units belong to the axis
   * ticks and the tooltip; repeating them here doubled the width of every
   * entry, which on a phone was the difference between a legend that fits
   * two to a line and one that takes a line each.
   */
  axis?: "left" | "right";
  /**
   * The series this entry switches, when it is not the entry's own id.
   *
   * <p>For a series drawn in two colours -- a signed bar above and below
   * zero -- which needs two swatches but is one thing to hide.
   */
  controls?: string;
}

function Swatch({
  mark,
  color,
  patternId,
}: {
  mark: LegendMark;
  color: string;
  patternId: string;
}) {
  const common = { width: 22, height: 14, "aria-hidden": true, className: "shrink-0" } as const;

  switch (mark) {
    case "circle":
      return (
        <svg {...common} viewBox="0 0 22 14">
          <circle cx="11" cy="7" r="4" fill={color} />
        </svg>
      );
    case "cross":
      return (
        <svg {...common} viewBox="0 0 22 14">
          <path d="M11 2.5v9M6.5 7h9" stroke={color} strokeWidth="2.75" strokeLinecap="butt" />
        </svg>
      );
    case "bar":
      return (
        <svg {...common} viewBox="0 0 22 14">
          <rect x="3" y="2" width="16" height="10" rx="1.5" fill={color} fillOpacity={0.85} />
        </svg>
      );
    case "barHatched":
      return (
        <svg {...common} viewBox="0 0 22 14">
          <defs>
            <pattern
              id={patternId}
              patternUnits="userSpaceOnUse"
              width="4"
              height="4"
              patternTransform="rotate(45)"
            >
              <rect width="4" height="4" fill={color} fillOpacity={0.3} />
              <line x1="0" y1="0" x2="0" y2="4" stroke={color} strokeWidth="2" />
            </pattern>
          </defs>
          <rect x="3" y="2" width="16" height="10" rx="1.5" fill={`url(#${patternId})`} />
        </svg>
      );
    case "hollow":
      // An outlined square with nothing in it, matching the shot strip,
      // where a miss is drawn hollow so the sequence survives being read
      // without colour.
      return (
        <svg {...common} viewBox="0 0 22 14">
          <rect
            x="4.5"
            y="2.5"
            width="13"
            height="9"
            rx="1.5"
            fill="none"
            stroke={color}
            strokeWidth="1.6"
          />
        </svg>
      );
    case "band":
      return (
        <svg {...common} viewBox="0 0 22 14">
          <rect
            x="3"
            y="2"
            width="16"
            height="10"
            fill={color}
            fillOpacity={0.14}
            stroke={color}
            strokeOpacity={0.5}
            strokeDasharray="3 2"
          />
        </svg>
      );
    case "dashed":
      return (
        <svg {...common} viewBox="0 0 22 14">
          <path d="M1 7h20" stroke={color} strokeWidth="2.25" strokeDasharray="4 3" />
        </svg>
      );
    default:
      return (
        <svg {...common} viewBox="0 0 22 14">
          <path d="M1 7h20" stroke={color} strokeWidth="2.25" />
        </svg>
      );
  }
}

export function ChartLegend({
  items,
  title,
  hidden,
  onToggle,
  className,
}: {
  items: LegendItem[];
  /**
   * What this key belongs to, when a card carries more than one.
   *
   * <p>Rendered inside the panel rather than above it. A label floating
   * over its own key reads as a rival to the chart's title; inside, it is
   * plainly part of the thing it names.
   */
  title?: string | undefined;
  /** Ids currently hidden. Omit for a static key. */
  hidden?: string[];
  /** Omit to render a static key rather than buttons. */
  onToggle?: ((id: string) => void) | undefined;
  className?: string | undefined;
}) {
  const scope = useId();
  if (items.length === 0) return null;

  const key = (
    <ul
      className={cn(
        /*
         * A panel of its own, not a line of text under the plot.
         *
         * <p>Unboxed, the key read as though it had been dropped below the
         * chart rather than belonging to it -- the swatches were the only
         * thing separating it from the caption underneath. A border and a
         * tint of the card's own muted surface give it an edge to sit
         * inside, which is what makes it findable at a glance.
         *
         * <p>Two columns on a narrow screen, one row once there is room.
         * Left to wrap, a four-entry key took four separate lines on a
         * phone -- a ragged column under every chart.
         */
        // The same tier every other block of text in a chart card sits
        // on, rather than its own translucent muted fill: three panels
        // that each looked slightly different read as three accidents.
        // A titled key moves the tier to the wrapper instead.
        title ? "mt-1.5" : "tier mt-3 px-3 py-2",
        "grid grid-cols-2 items-stretch gap-x-4 gap-y-1.5 text-xs",
        "sm:flex sm:flex-wrap sm:items-center sm:gap-x-5",
        title ? undefined : className,
      )}
      aria-label="What each mark on this chart means"
    >
      {items.map((item) => {
        const controls = item.controls ?? item.id;
        const isHidden = hidden?.includes(controls) ?? false;
        const body = (
          <>
            <Swatch
              mark={item.mark}
              color={item.color}
              patternId={`${scope}-${item.id}`.replace(/[^\w-]/g, "")}
            />
            <span className={cn("min-w-0 text-foreground", isHidden && "line-through")}>
              {item.label}
              {item.axis ? (
                /*
                 * Dropped on a phone, where the key is a two-column grid
                 * and the hint is exactly what tips a label into wrapping:
                 * it pushed "Percentage made" onto a second line and ran
                 * the entry into its neighbour. Little is lost -- at that
                 * width the chart is a single column with both axes in
                 * view, so the side reads off the plot itself.
                 */
                <span className="hidden text-muted-foreground sm:inline"> ({item.axis})</span>
              ) : null}
            </span>
          </>
        );

        return (
          <li key={item.id} className="min-w-0">
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(controls)}
                aria-pressed={!isHidden}
                title={isHidden ? `Show ${item.label}` : `Hide ${item.label}`}
                className={cn(
                  "flex h-full w-full cursor-pointer items-start gap-1.5 rounded-sm px-1 py-0.5 text-left",
                  "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isHidden && "opacity-45",
                )}
              >
                {body}
              </button>
            ) : (
              <span className="flex h-full items-start gap-1.5 px-1 py-0.5">{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );

  if (!title) return key;
  return (
    <div className={cn("tier mt-3 px-3 py-2", className)}>
      <p className="text-xs font-medium text-foreground">{title}</p>
      {key}
    </div>
  );
}
