import { HeroArt } from "@/components/common/PageHero";

/**
 * The gallery band's drawing: the camera that made these recordings.
 *
 * <p>Each band draws the thing its page is about -- a half court on
 * settings, a calendar on the calendar. A film strip was the obvious
 * choice here and the wrong one: it is the generic symbol for video,
 * it says nothing about this product, and at low opacity a run of
 * sprocket holes is just texture. A camera on a tripod is what a
 * FollowThrough recording actually comes from, and it has a silhouette
 * that survives being faint.
 */
export function FilmArt() {
  return (
    <HeroArt viewBox="0 0 30 30" ratio="30 / 30">
      <g strokeWidth="0.55" strokeLinejoin="round">
        {/* Body, with the viewfinder hump and the lens barrel. */}
        <rect x="5.5" y="7.6" width="13" height="8" rx="1.2" />
        <path d="M8 7.6V6a0.6 0.6 0 0 1 0.6-0.6h3.4a0.6 0.6 0 0 1 0.6 0.6v1.6" />
        <path d="M18.5 10.2h2.2v3h-2.2" />
        <circle cx="23" cy="11.7" r="2.4" />
        <circle cx="23" cy="11.7" r="1" />

        {/* The head, then the column, then the legs. */}
        <path d="M11 15.6v1.1" />
        <path d="M9.6 16.7h2.8" />
        <path d="M11 16.7v2.6" />
        <path d="M11 19.3 6.4 27.2" />
        <path d="M11 19.3v7.9" />
        <path d="M11 19.3 15.6 27.2" />
        {/* The spreader, which is what stops three lines reading as an
            arrow rather than a tripod. */}
        <path d="M8.7 23.3h4.6" />
      </g>

      {/* The record light. One filled mark, so the eye has somewhere
          to land without the drawing turning into a block. */}
      <circle cx="7.9" cy="9.6" r="0.75" fill="currentColor" stroke="none" />
    </HeroArt>
  );
}
