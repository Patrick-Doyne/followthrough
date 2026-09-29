/**
 * A diagonal hatch, so a stacked bar's two halves are told apart by more
 * than their colour.
 *
 * <p>Needed because the make green and the miss red are the same
 * brightness in the light palette -- 1.035:1 against each other. Stacked
 * one on the other they are two blocks of identical tone, which a
 * greyscale print or a red-green colour-blind reader cannot separate at
 * all. The hatch does not depend on seeing the hue.
 *
 * <p>Rendered in its own zero-size SVG **beside** the chart rather than as
 * a `<defs>` child of it. Recharts accepts a `<defs>` child but drops the
 * `<pattern>` inside it, which left the bars referencing a fill that did
 * not exist and painted them as nothing at all -- the misses silently
 * disappeared from the chart. A `url(#id)` fill resolves against the whole
 * document, so defining it anywhere on the page works.
 */
export function HatchPattern({ id, color }: { id: string; color: string }) {
  return (
    <svg width="0" height="0" aria-hidden className="absolute" focusable="false">
      <defs>
        <pattern
          id={id}
          patternUnits="userSpaceOnUse"
          width="5"
          height="5"
          patternTransform="rotate(45)"
        >
          {/* A wash of the same colour under the stripes, so the block
              still reads as one shape at small sizes rather than
              dissolving into separate lines. */}
          <rect width="5" height="5" fill={color} fillOpacity={0.3} />
          <line x1="0" y1="0" x2="0" y2="5" stroke={color} strokeWidth="2.5" strokeOpacity={0.95} />
        </pattern>
      </defs>
    </svg>
  );
}
