import { useCallback, useEffect, useState, type RefObject } from "react";

/**
 * Fullscreen for a video surface, on every browser.
 *
 * <p>The Fullscreen API is the obvious thing, and on a desktop and on
 * Android it is what this uses. Safari on an iPhone has none of it for
 * anything but a bare `<video>` -- and a bare video is exactly what the
 * app cannot show, because the overlay lives on a canvas beside it and
 * would be lost. So where the API is missing, the surface is pinned over
 * the page instead: fixed to the viewport, above the chrome, closed by
 * its own button or Escape. Either way the caller sees one `active` flag
 * and sizes the surface for it.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(false);
  const [pinned, setPinned] = useState(false);

  // Only a mounted surface can be the fullscreen element: with none, both
  // sides are null and a plain comparison would report fullscreen.
  const isFullscreen = useCallback(
    () =>
      typeof document !== "undefined" &&
      ref.current !== null &&
      document.fullscreenElement === ref.current,
    [ref],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setActive(isFullscreen() || pinned);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [isFullscreen, pinned]);

  // A pinned surface takes the whole viewport, so the page under it must
  // not scroll, and Escape must leave it as it leaves real fullscreen.
  useEffect(() => {
    if (!pinned) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  useEffect(() => {
    setActive(pinned || isFullscreen());
  }, [pinned, isFullscreen]);

  const enter = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof element.requestFullscreen === "function") {
      element.requestFullscreen().catch(() => setPinned(true));
    } else {
      setPinned(true);
    }
  }, [ref]);

  const exit = useCallback(() => {
    setPinned(false);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  }, []);

  const toggle = useCallback(() => {
    if (active) exit();
    else enter();
  }, [active, enter, exit]);

  return { active, enter, exit, toggle };
}
