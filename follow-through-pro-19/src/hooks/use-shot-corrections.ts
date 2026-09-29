import { useCallback, useMemo, useRef, useState } from "react";

import { shotCorrectionsService, type ShotCorrection } from "@/services/shot-corrections";

/**
 * Optimistic shot corrections, with rollback.
 *
 * <p>Applies the correction to the UI immediately and reverts it if the
 * write fails. Waiting for a round trip before showing the change would
 * make correcting a run of shots feel broken, and the failure case is rare
 * enough that optimism is the right default.
 *
 * <p>This is the codebase's first optimistic-mutation pattern, so it is
 * deliberately small and explicit rather than routed through TanStack
 * Query: live shots are not a query, they arrive over a DataChannel and
 * have no cache entry to write into.
 *
 * <p>The persist function is injectable so the rollback path can be tested
 * without standing up a failing server.
 */

export type PersistCorrection = (
  sessionId: string,
  sequence: number,
  correction: ShotCorrection,
) => Promise<unknown>;

export interface ShotCorrectionsApi {
  /** Corrections by shot sequence. Absent means the detector's call stands. */
  corrections: Record<number, ShotCorrection>;
  /** Sequences with a write still in flight, for showing pending state. */
  pending: number[];
  correct: (sequence: number, correction: ShotCorrection) => void;
  revert: (sequence: number) => void;
  /** The last write that failed, for surfacing once rather than per attempt. */
  lastError: string | null;
}

export function useShotCorrections(
  sessionId: string,
  persist: PersistCorrection = shotCorrectionsService.correct,
  onError?: (message: string) => void,
): ShotCorrectionsApi {
  const [corrections, setCorrections] = useState<Record<number, ShotCorrection>>({});
  const [pending, setPending] = useState<number[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  // Read inside the async callback so a stale closure cannot restore a
  // value the person has since changed again.
  const latest = useRef(corrections);
  latest.current = corrections;

  const correct = useCallback(
    (sequence: number, correction: ShotCorrection) => {
      const previous = latest.current[sequence];

      setCorrections((prev) => ({ ...prev, [sequence]: correction }));
      setPending((prev) => (prev.includes(sequence) ? prev : [...prev, sequence]));
      setLastError(null);

      void persist(sessionId, sequence, correction)
        .catch(() => {
          // Restore exactly what was there before, which may itself have
          // been a correction rather than nothing.
          setCorrections((prev) => {
            const next = { ...prev };
            if (previous === undefined) delete next[sequence];
            else next[sequence] = previous;
            return next;
          });
          const message = `Couldn't save the correction to shot ${sequence}.`;
          setLastError(message);
          onError?.(message);
        })
        .finally(() => {
          setPending((prev) => prev.filter((s) => s !== sequence));
        });
    },
    [sessionId, persist, onError],
  );

  const revert = useCallback((sequence: number) => {
    setCorrections((prev) => {
      const next = { ...prev };
      delete next[sequence];
      return next;
    });
  }, []);

  // Memoised because call sites put this object in dependency arrays. An
  // unstable identity here caused an infinite render loop: ShotFeed's
  // effect re-ran on every render, and that effect registers a command,
  // which sets state in the commands provider, which renders again.
  return useMemo(
    () => ({ corrections, pending, correct, revert, lastError }),
    [corrections, pending, correct, revert, lastError],
  );
}
