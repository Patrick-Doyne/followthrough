import { HeroArt } from "@/components/common/PageHero";

/**
 * The review band's drawing: a frame being scrubbed through.
 *
 * <p>Each band draws its own page's subject — a half court on settings, a
 * wall calendar on the calendar, the camera on the gallery. The gallery is
 * about the recordings; this page is about moving through one of them, so
 * the subject is the scrubber rather than the camera that made it.
 *
 * <p>The ticks under the bar are the shot markers this page actually
 * carries, which is what keeps the drawing specific to FollowThrough instead
 * of being the generic play triangle every video player already uses. The
 * playhead sits on one of them, because that is the page's whole gesture:
 * jump to a shot, watch it.
 */
export function ReplayArt() {
  return (
    <HeroArt viewBox="0 0 34 30" ratio="34 / 30">
      <g strokeWidth="0.55" strokeLinejoin="round">
        {/* The frame, with a corner notch so it reads as a viewport
            rather than as a plain rectangle. */}
        <path d="M3.4 5.2h27.2v15.4H3.4z" />
        <path d="M3.4 8.6h3.1" />
        <path d="M27.5 17.2h3.1" />

        {/* A play triangle, small and off-centre: enough to say video,
            not so large that it becomes the whole drawing. */}
        <path d="M14.6 9.9v6l5-3z" />

        {/* The scrub bar. */}
        <path d="M3.4 24.6h27.2" />

        {/* Shot markers along it — the thing this page is for. */}
        <path d="M7.1 23.3v2.6" />
        <path d="M11.9 23.3v2.6" />
        <path d="M19.8 23.3v2.6" />
        <path d="M24.3 23.3v2.6" />
        <path d="M28.1 23.3v2.6" />
      </g>

      {/* The playhead, parked on a marker. One filled mark, so the eye has
          somewhere to land without the drawing turning into a block. */}
      <circle cx="19.8" cy="24.6" r="1.15" fill="currentColor" stroke="none" />
    </HeroArt>
  );
}
