import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useSettings } from "@/state/settings-provider";

/** Focus target that {@link RouteAnnouncer} hands focus to after a navigation. */
export const PAGE_TITLE_ATTR = "data-page-title";
/** Landing spot for the skip link, and the fallback focus target. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * Restores the two things a single-page app breaks about navigation: where
 * keyboard focus goes, and whether a screen reader is told anything happened.
 *
 * <p>A real page load moves focus to the top of the new document and the
 * screen reader reads its title. Client-side routing swaps the DOM out from
 * under the user and does neither, so focus is left on the link that was
 * just clicked -- often inside a nav that no longer reflects the page -- and
 * a screen reader user gets no indication the view changed at all. This
 * component restores both: it moves focus to the new page's heading and
 * announces that heading through a live region.
 *
 * <p>Both behaviours are preferences rather than hard-coded, because focus
 * moves are not universally welcome: some sighted keyboard users find the
 * jump disorienting, and some screen reader setups already announce route
 * changes on their own and would double up.
 */
export function RouteAnnouncer() {
  const { settings } = useSettings();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [announcement, setAnnouncement] = useState("");
  // The first render is a real page load: the browser and the screen reader
  // have already done the right thing, so anything we do here is duplication.
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Wait a frame so the incoming route has actually committed its heading;
    // reading it in the same tick would find the outgoing page's title.
    const frame = requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>(`[${PAGE_TITLE_ATTR}]`);
      const target = heading ?? document.getElementById(MAIN_CONTENT_ID);

      if (settings.focusOnRouteChange && target) {
        target.focus({ preventScroll: true });
        // Focusing mid-page would otherwise leave the viewport where the
        // previous page was scrolled to.
        scrollTo({ top: 0, behavior: "auto" });
      }

      if (settings.announceRouteChange) {
        const label = heading?.textContent?.trim() || document.title || pathname;
        // A live region only fires on a change, so an identical string would
        // be silently dropped. The trailing marker makes repeat navigations
        // to the same title still announce, without being read aloud.
        setAnnouncement((prev) => (prev === label ? `${label} ` : label));
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [pathname, settings.focusOnRouteChange, settings.announceRouteChange]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      // The region has to exist and be empty before the first announcement,
      // otherwise assistive tech may not have registered it in time.
      role="status"
    >
      {announcement}
    </div>
  );
}

/**
 * The first thing in the tab order: lets keyboard users jump past the sidebar
 * and header straight to the page content. Visually hidden until focused.
 */
export function SkipToContentLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      Skip to main content
    </a>
  );
}
