/**
 * Destructive actions: undo window, or confirmation dialog.
 *
 * <p>A confirmation dialog taxes every action to guard against the rare
 * mistake, and people learn to dismiss it without reading. An undo window
 * inverts that: the action happens, and only a mistake costs anything. This
 * module lets a call site describe a destructive action once and get
 * whichever treatment the person has chosen.
 *
 * <p>Undo is implemented by *deferring* the irreversible call, not by
 * reversing it. The UI updates immediately via `optimistic()`, the real
 * `commit()` fires when the window expires, and undoing simply cancels it
 * and calls `rollback()`. The alternative -- delete now, recreate on undo --
 * cannot restore server-assigned identity or timestamps, so links and
 * references would break in a way the person never asked for.
 *
 * <p>Known limitation: a pending commit is flushed when the provider
 * unmounts and when the tab is hidden, but a tab killed mid-window cannot
 * be flushed reliably, since `beforeunload` cannot await a request. The
 * window is seconds long and the outcome of losing it is that the item is
 * *not* deleted, which is the safe direction to fail.
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

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useNotify } from "@/state/notifications";
import { useSettings } from "@/state/settings-provider";

export interface DestructiveAction {
  /** Dialog heading, e.g. "Delete this session?". */
  title: string;
  description?: string | undefined;
  /** Confirmation button label, e.g. "Delete". */
  confirmLabel: string;
  /** Toast shown while the undo window is open, e.g. "Session deleted". */
  undoMessage: string;
  /** The irreversible call. Deferred until the undo window expires. */
  commit: () => void | Promise<void>;
  /** Hide the item from the UI right away. */
  optimistic?: () => void;
  /** Put it back, if undone. */
  rollback?: () => void;
}

interface UndoContextValue {
  /** Runs `action` under whichever safety model the person prefers. */
  perform: (action: DestructiveAction) => void;
  /** Commits anything still waiting. Call before an action that depends on
   * the deletion having actually happened. */
  flush: () => void;
  hasPending: boolean;
}

const UndoContext = createContext<UndoContextValue | null>(null);

interface Pending {
  action: DestructiveAction;
  timer: ReturnType<typeof setTimeout>;
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const notify = useNotify();
  const [confirming, setConfirming] = useState<DestructiveAction | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(0);
  const [pendingCount, setPendingCount] = useState(0);

  const runCommit = useCallback((action: DestructiveAction) => {
    try {
      const result = action.commit();
      if (result instanceof Promise) {
        void result.catch(() => {
          // The call site owns error reporting through its own mutation;
          // swallowing here only stops an unhandled rejection.
        });
      }
    } catch {
      // Same reasoning: a throwing commit must not take the provider down.
    }
  }, []);

  const settle = useCallback(
    (id: number, undone: boolean) => {
      const entry = pending.current.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.current.delete(id);
      setPendingCount(pending.current.size);
      if (undone) entry.action.rollback?.();
      else runCommit(entry.action);
    },
    [runCommit],
  );

  const flush = useCallback(() => {
    for (const id of [...pending.current.keys()]) settle(id, false);
  }, [settle]);

  // A pending commit must not be lost because the person navigated away or
  // switched tabs. Hiding the tab is the last reliable moment to act.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      flush();
    };
  }, [flush]);

  const perform = useCallback(
    (action: DestructiveAction) => {
      if (!settings.undoInsteadOfConfirm) {
        setConfirming(action);
        return;
      }

      const id = nextId.current++;
      action.optimistic?.();

      const windowMs = settings.undoWindowSeconds * 1000;
      const timer = setTimeout(() => settle(id, false), windowMs);
      pending.current.set(id, { action, timer });
      setPendingCount(pending.current.size);

      notify(action.undoMessage, {
        kind: "info",
        // The person is mid-action and waiting on this, so it must appear
        // even during quiet hours -- it is the only way back.
        urgent: true,
        durationMs: windowMs,
        action: { label: "Undo", onClick: () => settle(id, true) },
      });
    },
    [settings.undoInsteadOfConfirm, settings.undoWindowSeconds, notify, settle],
  );

  const value = useMemo<UndoContextValue>(
    () => ({ perform, flush, hasPending: pendingCount > 0 }),
    [perform, flush, pendingCount],
  );

  return (
    <UndoContext.Provider value={value}>
      {children}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.title}</AlertDialogTitle>
            {confirming?.description ? (
              <AlertDialogDescription>{confirming.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirming) return;
                confirming.optimistic?.();
                runCommit(confirming);
                setConfirming(null);
              }}
            >
              {confirming?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UndoContext.Provider>
  );
}

export function useDestructiveAction(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error("useDestructiveAction must be used within an UndoProvider");
  return ctx;
}
