import { HeroArt } from "@/components/common/PageHero";

/**
 * The session band's drawing: a shot's flight, with its apex marked.
 *
 * <p>Each band draws its own page's subject. A rising bar chart would have
 * been the obvious choice and the wrong one — it is the generic symbol for
 * analytics and says nothing about this product. What a FollowThrough session
 * actually measures is the flight: where the ball was released, how high it
 * rose, how long it took to get there. This page's charts are all readings
 * of that curve, so the curve is the subject.
 *
 * <p>The apex tick is the detail that makes it this product's drawing
 * rather than a generic parabola: time to apex is the measurement the
 * release charts on this page are built from.
 */
export function ArcArt() {
  return (
    <HeroArt viewBox="0 0 40 26" ratio="40 / 26">
      <g strokeWidth="0.55" strokeLinejoin="round">
        {/* The flight, released low on the left and dropping through the
            rim on the right. */}
        <path d="M4.2 21.5C11 4.4 24.6 2.6 31.4 12.1" />

        {/* The apex, and the dropped line that measures it. */}
        <path d="M17.8 4.9v17.2" strokeDasharray="1.1 1.3" strokeWidth="0.4" />

        {/* Backboard and rim. */}
        <path d="M34.6 6.4v7.3" />
        <path d="M30.2 12.1h4.4" />
        {/* The net, three strokes gathering to a point. */}
        <path d="M30.6 12.1 31.7 15" />
        <path d="M32.4 12.1v3.1" />
        <path d="M34.2 12.1 33.1 15" />

        {/* The floor, cropped at both ends so the band frames it. */}
        <path d="M1.5 21.5h9" />
        <path d="M27 21.5h11.5" />
      </g>

      {/* The release point and the apex. Two filled marks: the pair the
          charts on this page are all measured between. */}
      <circle cx="4.2" cy="21.5" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="17.8" cy="4.9" r="0.95" fill="currentColor" stroke="none" />
    </HeroArt>
  );
}
