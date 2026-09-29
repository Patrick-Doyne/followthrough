import { useThemedBrand } from "@/hooks/use-themed-brand";
import { BRAND_LOCKUP } from "@/lib/brand-asset";
import { THEME_SHIFT_MS } from "@/state/settings";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** What the logo says, for the places that render it as the page's name. */
export const BRAND_ALT =
  "FollowThrough — smarter shots, better habits. Computer vision shot tracker.";

/**
 * The artwork's own proportions, so a width is enough to place it -- and
 * so the box is reserved before the image has decoded, which is what
 * keeps the page from reflowing when the mark arrives.
 *
 * <p>Taken from the generated module rather than written here: the asset
 * is trimmed to ink, so its dimensions move whenever the keying does.
 * An inline style, not an `aspect-[w/h]` utility, because Tailwind
 * cannot build a class name out of a value it only learns at runtime.
 */
const RATIO = { aspectRatio: `${BRAND_LOCKUP.width} / ${BRAND_LOCKUP.height}` };

/**
 * The logo, whole: the ball in its focus brackets, FOLLOW THROUGH, the
 * tagline and the line naming what the product is.
 *
 * <p>Artwork, not drawing code. This used to be a hand-built SVG crest
 * that set the name letter by letter and took its colour from
 * `currentColor`, so it followed whatever accent the viewer had chosen.
 * The supplied logo replaces it, and it still follows the accent: the
 * pixels are re-hued in OKLCH by the recipe in `brand-tint.ts` rather
 * than the fill being swapped, which is the only move a raster allows.
 *
 * <p>The artwork's black ground is keyed out by undoing its composite
 * rather than by thresholding, so the glow keeps its falloff instead of
 * dragging a rectangle of dark grey fog around with it.
 *
 * <p>**It still has to sit on a dark ground.** "FOLLOW" is silver and
 * the tagline is white; on a light surface both vanish and only
 * "THROUGH" is left. So the well is part of the component, and a call
 * site opts out only by saying the ground is already dark -- which is
 * one token, `--hero`, and that token is dark in all four palettes.
 */
export function BrandLockup({
  className,
  ground = "well",
  decorative = false,
}: {
  className?: string | undefined;
  /**
   * `"well"` draws the dark plate the artwork needs. `"dark"` is for the
   * places that already have one -- the page band -- where a second
   * plate would read as a box inside a box.
   */
  ground?: "well" | "dark";
  /** True where the name is already in the text beside it. */
  decorative?: boolean;
}) {
  // Re-hued to the viewer's accent. A raster cannot take `currentColor`,
  // so the pixels are moved instead -- in OKLCH, by the same recipe the
  // video overlay uses, which keeps the artwork's lightness ramp intact
  // and leaves its silver and white neutral.
  const { src, ready } = useThemedBrand(BRAND_LOCKUP.src);
  const { outgoing, lit, settle } = useArtworkFade(src, ready);

  const face = cn(
    "brand-artwork brand-fade h-full w-full object-contain",
    ground === "well" && "p-[6%]",
  );
  const img = (
    <span className="relative block h-full w-full">
      {/* The previous accent's artwork, held underneath until the new one
          has finished fading over it. Without it the incoming image
          fades up from the panel's own ground, which reads as the logo
          blinking rather than as it changing colour. */}
      {outgoing ? (
        <img src={outgoing} alt="" aria-hidden className={cn(face, "absolute inset-0")} />
      ) : null}
      {/* Keyed on the artwork, so a new accent mounts a *new* element.
          Re-using the old one meant the browser had an opacity of 1 to
          transition away from and the mark dipped out before easing
          back in; a fresh element starts at zero and only ever goes up. */}
      <img
        key={src}
        src={src}
        alt={decorative ? "" : BRAND_ALT}
        aria-hidden={decorative || undefined}
        onTransitionEnd={settle}
        className={cn(face, outgoing && "absolute inset-0", (!lit || !ready) && "opacity-0")}
      />
    </span>
  );
  return ground === "dark" ? (
    <span style={RATIO} className={cn("block", className)}>
      {img}
    </span>
  ) : (
    // --hero, not a colour of its own: this is the same ground the mark
    // stands on in every page band, so the two read as one treatment.
    <span style={RATIO} className={cn("block rounded-sm bg-[var(--hero)]", className)}>
      {img}
    </span>
  );
}

/**
 * Holds the previous artwork while the next one fades in over it.
 *
 * <p>Only while the accent is actually changing: with one image there is
 * no second layer, no transition and nothing to go wrong on first paint.
 */
function useArtworkFade(
  src: string,
  ready: boolean,
): { outgoing: string | null; lit: boolean; settle: () => void } {
  const [shown, setShown] = useState<string | null>(ready ? src : null);
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const [lit, setLit] = useState(ready);

  const settle = useCallback(() => {
    setShown(src);
    setOutgoing(null);
  }, [src]);

  useEffect(() => {
    if (!ready) {
      // Whatever is being held is the file as shipped, not this
      // accent's artwork -- the first render cannot know the accent yet,
      // so it starts out holding the wrong thing. Forget it. Keeping it
      // meant the incoming violet faded in *over the orange* and walked
      // through every magenta in between on the way, which is the third
      // colour in "orange, then the right one, then a darker one".
      if (shown !== null) {
        setShown(null);
        setOutgoing(null);
      }
      return;
    }
    if (src === shown) return;

    // Only the *second* artwork onwards has something to fade from; the
    // first good one simply eases up from the band.
    if (shown !== null) setOutgoing(shown);
    setLit(false);

    // Two frames, not one. A rAF callback runs *before* the paint of the
    // frame it was scheduled in, so lighting the image from inside the
    // first one means the browser never paints it at zero and has no
    // value to transition away from -- measured, the opacity went
    // straight to 1 and no fade ran at all. The second rAF is after that
    // paint, which is the earliest the transition can actually start.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setLit(true));
    });

    // The layer underneath comes off when the fade above it *ends*, not
    // when a timer says it should have. Those are not the same moment:
    // the transition cannot start until the palette change has finished
    // occupying the main thread, so a plain THEME_SHIFT_MS timer pulled
    // the old artwork out while the new one was still at 85% and the
    // mark went briefly see-through. This timer is only the fallback for
    // the case where no transition runs at all -- reduced motion, where
    // `transition: none` fires no event.
    const fallback = setTimeout(settle, THEME_SHIFT_MS * 3);
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      clearTimeout(fallback);
    };
  }, [src, shown, ready, settle]);

  return { outgoing, lit, settle };
}
