import { HeroArt } from "@/components/common/PageHero";

/**
 * The analytics band's drawing: the same shot, taken many times.
 *
 * <p>Each band draws its own page's subject, and the obvious choice here
 * — a rising bar chart — is the generic symbol for analytics and says
 * nothing about this product. It would also repeat the session page,
 * whose band is a single flight with its apex marked.
 *
 * <p>What this page is actually for is *comparison*: it pools every shot
 * the filters admit, across sessions, and asks where they agree and where
 * they scatter. So the drawing is one release point with several flights
 * leaving it — a tight pair through the rim, and two that miss high and
 * short — with the envelope they span drawn faintly behind. That spread
 * is the thing the charts on this page measure.
 */
export function SpreadArt() {
  return (
    <HeroArt viewBox="0 0 44 26" ratio="44 / 26">
      {/* The envelope the attempts span: the page's subject, drawn as the
          ground the individual flights sit on. */}
      <path
        d="M5 21.6C13 2.2 28 1.2 36.5 11.2V15.4C28 7 13.5 8.6 5 21.6Z"
        fill="currentColor"
        opacity="0.07"
        stroke="none"
      />

      <g strokeWidth="0.5" strokeLinecap="round">
        {/* Short, and high: the two ways an attempt misses. Dashed, so
            they read as the outliers rather than as four equal readings. */}
        <path d="M5 21.6C12 3.4 26 2 33.4 9.8" strokeDasharray="1.2 1.4" opacity="0.75" />
        <path d="M5 21.6C14 9.4 27 10.4 33 16.6" strokeDasharray="1.2 1.4" opacity="0.75" />
      </g>

      <g strokeWidth="0.6" strokeLinecap="round">
        {/* The two that went in, close enough together to read as one
            repeatable shot -- which is what the page is looking for. */}
        <path d="M5 21.6C12.6 5 27 4.2 34.8 12.4" />
        <path d="M5 21.6C13.4 6.6 27.4 5.8 34.8 12.4" opacity="0.85" />
      </g>

      <g strokeWidth="0.55" strokeLinejoin="round">
        {/* Backboard and rim, at the end every flight is measured to. */}
        <path d="M38.4 6.8v7.2" />
        <path d="M34 12.4h4.4" />
        <path d="M34.4 12.4 35.5 15.2" />
        <path d="M36.2 12.4v3.1" />
        <path d="M38 12.4 36.9 15.2" />

        {/* The floor, cropped at both ends so the band frames it. */}
        <path d="M1.5 21.6h10" />
        <path d="M30 21.6h12.5" />
      </g>

      {/* The one release point every attempt shares. Filled, because it is
          the fixed end of the comparison. */}
      <circle cx="5" cy="21.6" r="1" fill="currentColor" stroke="none" />
    </HeroArt>
  );
}
