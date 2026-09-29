/**
 * In-app notifications: delivery rules, history, and the one function the
 * rest of the app calls to raise something.
 *
 * <p>Everything goes through {@link useNotify} rather than calling `toast()`
 * directly, so that the person's delivery preferences are actually honoured.
 * A direct `toast()` call would bypass quiet hours, snooze, the duration
 * setting and sound. The history is the other half of that bargain: a
 * notification suppressed by quiet hours is still recorded, so suppression
 * loses the interruption without losing the information.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast, type ExternalToast } from "sonner";

import { playTone, vibrate, type FeedbackTone } from "@/lib/feedback";
import { TOAST_DURATION_MS, isQuietNow } from "@/state/settings";
import { useSettings } from "@/state/settings-provider";

export type NotificationKind = "success" | "error" | "info" | "warning";

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string | undefined;
  /** Epoch ms. */
  at: number;
  /** True when delivery was held back by quiet hours or snooze. */
  suppressed: boolean;
  read: boolean;
}

export interface NotifyOptions {
  kind?: NotificationKind;
  body?: string | undefined;
  /** Skip quiet hours. For things the person is actively waiting on, such
   * as the result of a button they just pressed. */
  urgent?: boolean;
  action?: { label: string; onClick: () => void } | undefined;
  /** Overrides the duration preference, in ms. Used by the undo toast,
   * whose lifetime is the undo window rather than a reading time. */
  durationMs?: number | undefined;
}

interface NotificationsContextValue {
  history: NotificationRecord[];
  unreadCount: number;
  notify: (title: string, options?: NotifyOptions) => void;
  markAllRead: () => void;
  clearHistory: () => void;
  /** Suppress everything for a number of minutes, or null to resume. */
  snooze: (minutes: number | null) => void;
  isQuiet: boolean;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const HISTORY_STORAGE_KEY = "followthrough.notification-history";

const TONE_FOR_KIND: Record<NotificationKind, FeedbackTone> = {
  success: "success",
  error: "error",
  warning: "error",
  info: "neutral",
};

function loadHistory(): NotificationRecord[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Shape-check each row: this survives deploys and may predate fields.
    return parsed.filter(
      (row): row is NotificationRecord =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as NotificationRecord).id === "string" &&
        typeof (row as NotificationRecord).title === "string" &&
        typeof (row as NotificationRecord).at === "number",
    );
  } catch {
    return [];
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { settings, hydrated, update } = useSettings();
  const [history, setHistory] = useState<NotificationRecord[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch {
      // History is a convenience; losing it must not break notifying.
    }
  }, [history, hydrated]);

  // Quiet hours and snooze are time-dependent, so the banner and the
  // suppression decision need a clock. A minute is fine: quiet-hours
  // boundaries are minute-granular and a snooze ending 30s late is
  // imperceptible, while a per-second timer would re-render the whole tree
  // 60x more often for nothing.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const isQuiet = useMemo(
    () => (hydrated ? isQuietNow(settings, new Date(now)) : false),
    [hydrated, settings, now],
  );

  // Read through a ref inside notify() so the callback identity stays
  // stable; otherwise every consumer re-renders whenever a setting changes.
  const stateRef = useRef({ settings, isQuiet });
  stateRef.current = { settings, isQuiet };

  const notify = useCallback((title: string, options: NotifyOptions = {}) => {
    const { settings: current, isQuiet: quiet } = stateRef.current;
    const kind = options.kind ?? "info";
    const suppressed = quiet && !options.urgent;

    setHistory((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind,
          title,
          body: options.body,
          at: Date.now(),
          suppressed,
          read: false,
        },
        ...prev,
      ].slice(0, current.notificationHistoryLimit),
    );

    if (suppressed) return;

    // sonner treats Infinity as "never dismiss". An explicit durationMs
    // (the undo window) always wins over the preference.
    const preferred = TOAST_DURATION_MS[current.toastDuration];
    const payload: ExternalToast = { duration: options.durationMs ?? preferred };
    if (options.body !== undefined) payload.description = options.body;
    if (options.action !== undefined) payload.action = options.action;

    if (kind === "success") toast.success(title, payload);
    else if (kind === "error") toast.error(title, payload);
    else if (kind === "warning") toast.warning(title, payload);
    else toast(title, payload);

    if (current.soundEnabled) playTone(TONE_FOR_KIND[kind], current.soundVolume);
    if (current.hapticsEnabled) vibrate(TONE_FOR_KIND[kind]);
  }, []);

  const snooze = useCallback(
    (minutes: number | null) => {
      update({ snoozedUntil: minutes === null ? null : Date.now() + minutes * 60_000 });
      setNow(Date.now());
    },
    [update],
  );

  const markAllRead = useCallback(
    () => setHistory((prev) => prev.map((row) => (row.read ? row : { ...row, read: true }))),
    [],
  );
  const clearHistory = useCallback(() => setHistory([]), []);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      history,
      unreadCount: history.reduce((count, row) => count + (row.read ? 0 : 1), 0),
      notify,
      markAllRead,
      clearHistory,
      snooze,
      isQuiet,
    }),
    [history, notify, markAllRead, clearHistory, snooze, isQuiet],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within a NotificationsProvider");
  return ctx;
}

/** The narrow hook most callers want. */
export function useNotify(): NotificationsContextValue["notify"] {
  return useNotifications().notify;
}
