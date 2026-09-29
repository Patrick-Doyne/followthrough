import { useCallback, useMemo, useRef } from "react";

import { useSettings } from "@/state/settings-provider";

const DRAFT_PREFIX = "followthrough.draft.";

/**
 * Keeps what someone typed in a form if they navigate away or reload.
 *
 * <p>Deliberately explicit rather than automatic: the form decides when to
 * `write` (on change), when to `read` (on mount), and when to `clear` (on a
 * successful submit). An automatic version would have to guess what counts
 * as a meaningful change and when a draft has been superseded, and would
 * quietly resurrect a draft the person had already submitted.
 *
 * <p>Writes are debounced because a controlled form fires on every
 * keystroke, and JSON-serialising into localStorage on each one is enough
 * synchronous work to be felt while typing.
 */
export function useDraft<T>(key: string) {
  const { settings } = useSettings();
  const enabled = settings.autoSaveDrafts;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKey = `${DRAFT_PREFIX}${key}`;

  const read = useCallback((): T | null => {
    if (!enabled || typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }, [enabled, storageKey]);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Nothing to recover from: the draft is at worst stale, and `read`
      // is only ever consulted by a form the person deliberately opened.
    }
  }, [storageKey]);

  const write = useCallback(
    (value: T) => {
      if (!enabled) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        try {
          localStorage.setItem(storageKey, JSON.stringify(value));
        } catch {
          // Storage full or blocked; the form still works.
        }
      }, 400);
    },
    [enabled, storageKey],
  );

  // Memoised for the same reason as useShotCorrections: an unstable
  // identity from a hook is a render loop waiting for the first call site
  // that puts it in a dependency array.
  return useMemo(() => ({ read, write, clear, enabled }), [read, write, clear, enabled]);
}
