import { HeroArt } from "@/components/common/PageHero";

/**
 * The calendar band's drawing: a wall calendar, in outline.
 *
 * <p>The settings band shows a half court because that page is about
 * the player. Repeating the court on every screen would make it
 * wallpaper rather than a subject, so each band draws the thing its
 * page is about.
 *
 * <p>A few cells are filled rather than drawn as outlines. An empty
 * grid at this opacity reads as graph paper; a handful of booked days
 * is what makes it a *training* calendar, and it echoes the month grid
 * directly below the band.
 */
export function CalendarArt() {
  /* 7 columns of 4 units across a 28-unit page, and a 6-unit header
     band above them -- the proportions of an actual wall calendar, so
     it survives the band's crop still looking like one. */
  return (
    <HeroArt viewBox="0 0 32 30" ratio="32 / 30">
      <g strokeWidth="0.45">
        {/* The two hangers, clipped by the top of the band. */}
        <path d="M9 0.5V4" />
        <path d="M23 0.5V4" />

        {/* The page, and the rule under its header. */}
        <rect x="2" y="2.5" width="28" height="26.5" rx="2.5" />
        <path d="M2 10h28" />

        {/* The month grid: six inner columns, three inner rows. */}
        {[1, 2, 3, 4, 5, 6].map((c) => (
          <path key={`c${c}`} d={`M${2 + c * 4} 10v19`} />
        ))}
        {[1, 2, 3].map((r) => (
          <path key={`r${r}`} d={`M2 ${10 + r * 4.75}h28`} />
        ))}
      </g>

      {/* Booked days. Inset from the cell so the grid line still reads
          around them, and filled so they carry at this opacity. */}
      <g fill="currentColor" stroke="none">
        {[
          [1, 0],
          [3, 0],
          [4, 1],
          [0, 2],
          [5, 2],
          [2, 3],
          [6, 3],
        ].map(([col, row]) => (
          <rect
            key={`${col}-${row}`}
            x={2 + (col as number) * 4 + 0.9}
            y={10 + (row as number) * 4.75 + 1.1}
            width="2.2"
            height="2.55"
            rx="0.6"
          />
        ))}
      </g>
    </HeroArt>
  );
}
