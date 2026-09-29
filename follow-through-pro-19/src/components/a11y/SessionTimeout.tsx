import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/state/auth";
import { useSettings, useT } from "@/state/settings-provider";

/** Activity that counts as "still here". Pointer and key events cover
 * normal use; scroll covers reading a long page without touching anything
 * else, which is exactly the case a naive idle timer gets wrong. */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "focus"] as const;

/**
 * Inactivity sign-out, with a warning and a way to stay.
 *
 * <p>Opt-in (the default is no timeout) and never silent: being logged out
 * without warning mid-task is the failure this is built to avoid, so the
 * warning appears with a live countdown and a button that cancels it. The
 * countdown is announced politely rather than assertively, so it does not
 * interrupt a screen reader every second.
 */
export function SessionTimeout() {
  const { settings, hydrated } = useSettings();
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const t = useT();

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());

  const active = hydrated && isAuthenticated && settings.sessionTimeoutMinutes > 0;

  const dismiss = useCallback(() => {
    lastActivity.current = Date.now();
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    if (!active) {
      setSecondsLeft(null);
      return;
    }

    const onActivity = () => {
      // While the warning is up, ordinary activity must not silently cancel
      // it: the person may be typing elsewhere without having seen it. Only
      // the explicit button dismisses.
      if (secondsLeft === null) lastActivity.current = Date.now();
    };
    for (const name of ACTIVITY_EVENTS) {
      addEventListener(name, onActivity, { passive: true, capture: true });
    }
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        removeEventListener(name, onActivity, { capture: true });
      }
    };
  }, [active, secondsLeft]);

  useEffect(() => {
    if (!active) return;

    const timeoutMs = settings.sessionTimeoutMinutes * 60_000;
    const warnMs = settings.sessionWarningSeconds * 1000;

    // One second is the coarsest tick that still renders a countdown
    // honestly; anything longer would visibly skip numbers.
    const id = setInterval(() => {
      const idleFor = Date.now() - lastActivity.current;
      const remaining = timeoutMs - idleFor;

      if (remaining <= 0) {
        logout();
        void navigate({ to: "/login", replace: true });
        return;
      }
      setSecondsLeft(remaining <= warnMs ? Math.ceil(remaining / 1000) : null);
    }, 1000);

    return () => clearInterval(id);
  }, [active, settings.sessionTimeoutMinutes, settings.sessionWarningSeconds, logout, navigate]);

  return (
    <Dialog open={secondsLeft !== null} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("usability.sessionExpiring")}</DialogTitle>
          <DialogDescription aria-live="polite">
            {t("usability.sessionExpiringBody", { seconds: secondsLeft ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={dismiss}>{t("usability.staySignedIn")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
