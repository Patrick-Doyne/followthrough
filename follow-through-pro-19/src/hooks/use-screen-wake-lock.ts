import { useEffect } from "react";

/**
 * Keeps the screen awake while a session is running.
 *
 * <p>The primary device for a live session is a phone propped at the edge of
 * the court, and a phone left alone locks itself. When it does, the browser
 * suspends the camera and the recorder while the peer connection may still
 * report itself connected — so the session dies silently and the recording
 * is incomplete, with nothing on screen to say so.
 *
 * <p>Best-effort by design. The API is unsupported in some browsers, refused
 * without a user gesture, and refused on low battery. All of those are
 * acceptable: the health monitor still detects the resulting stall and the
 * UI still reports it. This only makes the stall less likely.
 *
 * <p>The lock is released automatically whenever the page is hidden, so it
 * has to be re-acquired on return — that is not optional bookkeeping, it is
 * how the API works.
 */
export function useScreenWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      if (released || document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Unsupported, refused, or battery-saver. Nothing to do; the stall
        // detector is the backstop.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible" && sentinel === null) void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {
        // Already released by the browser; nothing to recover.
      });
      sentinel = null;
    };
  }, [enabled]);
}
