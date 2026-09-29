import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The frame every band drawing uses.
 *
 * <p>The drawing is the page's own subject, not one house image
 * repeated on every screen -- a half court on the settings band, a
 * calendar on the calendar band. This fixes how it is placed and
 * coloured so that only the paths differ.
 *
 * <p>`ratio` must match the viewBox. The band crops the drawing rather
 * than fitting it, so a wrong ratio stretches it instead of cropping
 * it, which is the difference between a deliberate crop and a mistake.
 */
export function HeroArt({
  viewBox,
  ratio,
  children,
}: {
  viewBox: string;
  /** A CSS aspect-ratio, e.g. `"50 / 26"`. Matches the viewBox. */
  ratio: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      aria-hidden
      className="hero-art"
      style={{ "--hero-art-ratio": ratio } as CSSProperties}
    >
      <g stroke="currentColor" strokeLinecap="round">
        {children}
      </g>
    </svg>
  );
}

/**
 * Painted half-court lines.
 *
 * <p>Drawn rather than imported as an asset so it inherits
 * `currentColor` and needs no second network request. The proportions
 * are a real half court (key 16ft wide against a 50ft floor), because a
 * made-up arc is the kind of thing that reads as generic sports
 * clip-art.
 */
export function CourtArt() {
  /* The viewBox is the half court from the baseline out to just past the
     arc -- 50ft by 26ft, which is about 2:1 and therefore fits a wide
     band without cropping away the parts that make it recognisable.
     Earlier versions showed a square court in a letterbox and what
     survived the crop was a circle and two stray lines. */
  return (
    <HeroArt viewBox="0 0 50 26" ratio="50 / 26">
      <g strokeWidth="0.42">
        {/* baseline */}
        <path d="M0 0.2h50" />
        {/* the key, free-throw line and circle */}
        <path d="M17 0.2v19h16V0.2" />
        <circle cx="25" cy="19.2" r="6" />
        {/* backboard and rim */}
        <path d="M22 4h6" />
        <circle cx="25" cy="5.25" r="0.75" />
        {/* restricted area */}
        <path d="M21 5.25a4 4 0 0 0 8 0" />
        {/* three-point line: corners, then the arc */}
        <path d="M3 0.2v13.8a22 22 0 0 0 44 0V0.2" />
      </g>
    </HeroArt>
  );
}

/**
 * The band at the top of a page.
 *
 * <p>It is the page's header, and the reason it exists is that the
 * routes it replaced had none worth the name: a small line of text
 * above a field of grey panels, saying what you already knew from the
 * nav. The band states where you are and what is in front of you, and
 * gives the page a focal point to be quiet against.
 *
 * <p>It stays dark in both themes on purpose -- see the note on
 * `--hero` -- and it carries **no controls**. Its ground is painted
 * court lines, and anything interactive placed on them has the arcs
 * running straight through it. Buttons, search and filters go below
 * the band, not in it.
 */
export function PageHero({
  eyebrow,
  title,
  meta,
  art,
  leading,
  toolbar,
  className,
}: {
  /** The page's name, set small above the title. */
  eyebrow: string;
  /** The largest thing on the page. */
  title: ReactNode;
  /** The line under the title: whatever this page is actually about. */
  meta?: ReactNode;
  /** The line drawing behind it: this page's subject, not a default. */
  art: ReactNode;
  /** A square block on the left -- a name plate, a section icon. */
  leading?: ReactNode;
  /**
   * A row of controls under the identity block, inside the band.
   *
   * <p>Only for controls that bring their own opaque background. The
   * drawing behind them is faint but it is still line work, and a
   * transparent field on top of it is unreadable -- which is how the
   * settings search ended up below the band instead of in it.
   */
  toolbar?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section className={cn("hero mb-5 px-5 py-5 sm:px-7", className)}>
      {art}

      <div className="relative flex flex-wrap items-center gap-5">
        {leading}

        <div className="min-w-0 flex-1">
          <p className="mb-1.5 flex items-center gap-2 text-[0.625rem] font-semibold tracking-[0.2em] text-[var(--hero-muted)] uppercase">
            <span aria-hidden className="h-px w-5 bg-[var(--sec)]" />
            {eyebrow}
          </p>
          <h2 className="metric-value text-2xl leading-tight font-bold tracking-tight text-[var(--hero-fg)] sm:text-3xl">
            {title}
          </h2>
          {meta ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-[var(--hero-muted)]">
              {meta}
            </p>
          ) : null}
        </div>
      </div>

      {toolbar ? (
        <div className="relative mt-3.5 flex flex-wrap items-center gap-3">{toolbar}</div>
      ) : null}
    </section>
  );
}

/** A `/` between two facts on the band's meta line. */
export function HeroDivider() {
  return <span aria-hidden>/</span>;
}

/** A fact on the meta line that should read as the important one. */
export function HeroStrong({ children }: { children: ReactNode }) {
  return (
    <span className="font-semibold tracking-[0.12em] text-[var(--hero-fg)] uppercase">
      {children}
    </span>
  );
}
