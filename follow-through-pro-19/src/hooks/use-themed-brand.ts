import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { brandTint, isUntinted, tintImage } from "@/lib/brand-tint";
import { DEFAULT_TRIAD } from "@/lib/theme";
import { loadSettings } from "@/state/settings";
import { useSettings } from "@/state/settings-provider";

/** Layout effects do not exist on the server; nothing here runs there. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * How many re-hued versions to keep.
 *
 * <p>Dragging the colour picker walks through accents one commit at a
 * time, and every one of them would otherwise be held forever. Four
 * covers going back to compare against the last few without turning the
 * cache into a leak.
 */
const CACHE_LIMIT = 4;

/** Shared across components, so the settings band and the auth page do
 * not each re-hue the same artwork. */
const cache = new Map<string, string>();

function remember(key: string, url: string): void {
  cache.set(key, url);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export interface ThemedBrand {
  /** What to draw. */
  src: string;
  /**
   * False only while a re-hue is known to be needed and is not finished.
   * The artwork must not be painted in that window: what is available
   * then is the file as shipped, which is the *wrong* colour, and
   * showing it is worse than showing nothing for a frame or two.
   */
  ready: boolean;
}

/**
 * The accent the viewer has actually chosen, before the provider says so.
 *
 * <p>`SettingsProvider` starts from the defaults and loads storage in a
 * plain effect, which by design runs *after* the first paint -- its
 * initial state has to match the server's markup for hydration to be
 * clean, and the boot script has already put the real palette on
 * `<html>` so nothing CSS-driven is wrong in the meantime.
 *
 * <p>The logo is not CSS-driven. Waiting for `hydrated` meant the first
 * paint drew the shipped orange, measured at roughly 370ms of it on a
 * reload with a violet theme. Reading storage in a layout effect closes
 * that: it runs after hydration but before the browser paints, so the
 * orange is never drawn at all. The same loader the provider uses, so
 * there is one answer to "what did they pick", not two.
 */
function useStoredAccent(): string | null {
  const [accent, setAccent] = useState<string | null>(null);
  useIsomorphicLayoutEffect(() => {
    try {
      setAccent(loadSettings().themeColors.accent);
    } catch {
      // Storage blocked or unreadable; the provider's default stands.
    }
  }, []);
  return accent;
}

/**
 * The logo artwork, re-hued to the viewer's accent.
 *
 * <p>Fed the **triad's** accent rather than a resolved `primary` token,
 * for the reason the video overlay is: those tokens are re-solved per
 * palette to clear contrast against a page background, and the logo has
 * no page background -- it sits on `--hero`, which is dark in all four
 * palettes.
 */
export function useThemedBrand(src: string): ThemedBrand {
  const { settings, hydrated } = useSettings();
  const stored = useStoredAccent();
  const accent = hydrated ? settings.themeColors.accent : (stored ?? DEFAULT_TRIAD.accent);

  const tint = useMemo(() => brandTint(accent, DEFAULT_TRIAD.accent), [accent]);
  const key = `${src}|${tint.dh}|${tint.cr}`;
  const resolved = isUntinted(tint) ? src : cache.get(key);

  const [url, setUrl] = useState(resolved ?? src);

  useEffect(() => {
    if (resolved) {
      setUrl(resolved);
      return;
    }
    let live = true;
    // Deliberately *not* falling back to the shipped file here. Doing
    // that put one frame of the original orange in the middle of the
    // palette cross-fade -- measured at 289ms into a 300ms fade, which
    // is exactly the "flash of orange" this was reported as. Holding the
    // previous accent's artwork instead means the mark is only ever one
    // of the two colours involved in the change, and the swap lands
    // inside the fade.
    void tintImage(src, tint).then((next) => {
      if (!live) return;
      remember(key, next);
      setUrl(next);
    });
    return () => {
      live = false;
    };
  }, [key, resolved, src, tint]);

  // Not ready while the answer we are holding is the shipped file but
  // the accent calls for something else.
  const ready = resolved !== undefined || url !== src;

  // Takes down the flag the boot script raised in the document head.
  // Before paint, so the mark appears in the same frame it becomes
  // correct rather than one frame later.
  useIsomorphicLayoutEffect(() => {
    if (ready) delete document.documentElement.dataset["brandTint"];
  }, [ready]);

  return { src: url, ready };
}
