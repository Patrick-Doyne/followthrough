// The conventional upload glyph -- an arrow rising out of a tray --
// rather than a picture-frame variant. This is the one people have
// already learned, and a hover affordance is the wrong place to ask
// someone to learn a new one.
import { Upload } from "lucide-react";

import { BrandLockup } from "@/components/brand/BrandMark";
import { CourtArt, HeroDivider, HeroStrong, PageHero } from "@/components/common/PageHero";
import { cn } from "@/lib/utils";

import type { SubscriptionTier } from "@/types/telemetry";

/** The plate's image, shared by the static and the clickable form. */
function PlateContents({ mark }: { mark: string | null }) {
  return mark ? (
    <img src={mark} alt="" className="col-start-1 row-start-1 size-[78%] object-contain" />
  ) : (
    // The logo entire, with its wordmark and both lines of type. The
    // band it sits on is --hero, dark in every palette, so it needs no
    // plate of its own -- which is also why the plate itself has no
    // fill. Uploads are square and the plate is square for them; the
    // logo is 866x526 and the plate widens to suit rather than
    // letterboxing the type down to a smudge.
    <BrandLockup ground="dark" className="col-start-1 row-start-1 w-[96%]" />
  );
}

/**
 * How wide the plate has to be to hold what is on it.
 *
 * <p>The logo's slot is bigger than an uploaded mark's, and bigger than
 * it was: at 80px tall its two lines of fine print were a texture
 * rather than words. The widths are its heights times the artwork's
 * ratio -- the plate is the shape of what is on it. The mark is
 * `object-contain`, so a stale number letterboxes rather than
 * distorting, but it is kept in step with `BRAND_LOCKUP` anyway.
 */
function plateShape(mark: string | null) {
  return mark ? "size-20 sm:size-24" : "h-24 w-[10.3rem] sm:h-32 sm:w-[13.73rem]";
}

const TIER_COPY: Record<SubscriptionTier, string> = {
  FREE: "Free",
  BASIC: "Basic",
  PREMIUM: "Premium",
};

/**
 * The identity band at the top of the settings page.
 *
 * <p>The page had no focal point: five tabs of grey form fields opened
 * onto more grey form fields, and nothing said whose account you were
 * editing. A settings page is the one screen that is unambiguously
 * *about the person*, so it leads with them.
 *
 * <p>Everything about the band itself -- the gradient, the court art,
 * the eyebrow, the rule that it carries no controls -- lives in
 * PageHero, which every page now uses. What is specific here is the
 * name plate: the only place in the app you can click your own logo to
 * change it.
 */
export function SettingsHero({
  eyebrow,
  mark,
  onEditMark,
  name,
  position,
  team,
  tier,
}: {
  /** What page this is. The band is the page's header. */
  eyebrow: string;
  /** The account's own logo, or null for the FollowThrough mark. */
  mark: string | null;
  /** Opens the file picker. The plate is the most obvious thing on the
   * page to click to change your logo, so it is a control, not a badge. */
  onEditMark?: (() => void) | undefined;
  name: string;
  position: string;
  team: string;
  /** Absent until the account loads; the chip is hidden rather than
   * guessing a plan. */
  tier?: SubscriptionTier | undefined;
}) {
  /* The jersey plate. Square, cut corner -- the one loud element on the
     page, and the anchor the rest is quiet against.

     An uploaded logo gets a little padding; the FollowThrough mark is
     drawn larger because it was designed for the crop. Either way the
     plate, not the image, is what carries the shape. */
  const plate = onEditMark ? (
    <button
      type="button"
      onClick={onEditMark}
      className={cn(
        "notch plate plate-edit grid shrink-0 place-items-center overflow-hidden",
        plateShape(mark),
      )}
    >
      <PlateContents mark={mark} />
      <span className="plate-edit-veil">
        <Upload className="size-4" aria-hidden />
        <span className="text-[0.5625rem] leading-none font-semibold tracking-[0.1em] uppercase">
          Upload
        </span>
      </span>
    </button>
  ) : (
    <span
      className={cn(
        "notch plate grid shrink-0 place-items-center overflow-hidden",
        plateShape(mark),
      )}
      aria-hidden
    >
      <PlateContents mark={mark} />
    </span>
  );

  return (
    <PageHero
      art={<CourtArt />}
      eyebrow={eyebrow}
      title={name}
      leading={plate}
      meta={
        <>
          <span className="tracking-[0.12em] uppercase">{position}</span>
          <HeroDivider />
          <span>{team}</span>
          {tier ? (
            <>
              <HeroDivider />
              {/* Reads as part of the identity line rather than as a
                  separate badge floating over the court art, which is
                  where it was competing with the lines behind it. */}
              <HeroStrong>{TIER_COPY[tier]}</HeroStrong>
            </>
          ) : null}
        </>
      }
    />
  );
}
