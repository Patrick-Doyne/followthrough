import { HeroArt } from "@/components/common/PageHero";

/**
 * The dashboard band's drawing: a scoreboard.
 *
 * <p>Each band draws its own page's subject. The dashboard is not about a
 * shot or a session or a recording — it is the standing summary of all of
 * them, read at a glance, which is exactly what a scoreboard is for. It
 * also belongs to the product's broadcast vocabulary, where the score bug
 * is the device for making state legible from a distance.
 *
 * <p>Drawn as the panel and its numerals rather than as literal digits:
 * segment blocks read as a scoreboard at any size, where real numbers
 * would either be unreadable at band scale or would claim to be somebody's
 * actual figures.
 */
export function ScoreboardArt() {
  /** Two rows of segment blocks, the way a board sets its numerals. */
  const digits = (x: number, y: number, count: number) =>
    Array.from({ length: count }, (_, i) => (
      <g key={`${x}-${y}-${i}`} transform={`translate(${x + i * 4.6} ${y})`}>
        <path d="M0 0h3.2" />
        <path d="M0 3.4h3.2" />
        <path d="M0 6.8h3.2" />
        <path d="M0 0v3.4" />
        <path d="M3.2 0v3.4" />
        <path d="M0 3.4v3.4" />
        <path d="M3.2 3.4v3.4" />
      </g>
    ));

  return (
    <HeroArt viewBox="0 0 44 26" ratio="44 / 26">
      <g strokeWidth="0.55" strokeLinejoin="round">
        {/* The board, hung from its frame. */}
        <path d="M6 4.4h32v15.4H6Z" />
        {/* The rule that splits the headline figure from the line under
            it, which is the board's own hierarchy. */}
        <path d="M6 14.2h32" strokeWidth="0.4" opacity="0.7" />

        {/* The hanger. */}
        <path d="M22 4.4V1.6" strokeWidth="0.4" />
        <path d="M17.6 1.6h8.8" strokeWidth="0.4" />
      </g>

      {/* The headline figure, and the smaller line beneath it. */}
      <g strokeWidth="0.45" strokeLinecap="round" opacity="0.9">
        {digits(9.2, 6.2, 3)}
      </g>
      <g strokeWidth="0.35" strokeLinecap="round" opacity="0.55">
        {digits(9.2, 16, 2)}
        {digits(27.8, 16, 2)}
      </g>

      {/* A ball resting at the board's foot: the sport, kept to one mark
          so the drawing stays a scoreboard rather than a collage. */}
      <g strokeWidth="0.5">
        <circle cx="38.6" cy="22" r="2.6" />
        <path d="M36 22h5.2" strokeWidth="0.35" />
        <path d="M38.6 19.4v5.2" strokeWidth="0.35" />
      </g>
    </HeroArt>
  );
}
