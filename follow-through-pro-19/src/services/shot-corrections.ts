/**
 * Human corrections to what the detector decided.
 *
 * <p>Detection is good, not perfect: it occasionally scores a rebound as a
 * make, or fires on someone walking under the rim. A correction is the
 * person overruling it.
 *
 * <p>**Deliberately local, and not routed through `request()`.** There is
 * no shot endpoint on the server — shots live inside a per-video JSON blob
 * and are not individually addressable — so calling one would 404 and roll
 * back every correction, which is worse than not offering the feature.
 * This keeps corrections working for the session while being honest that
 * they do not survive a reload; the UI says so.
 *
 * <p>When the endpoint lands it takes the shape already written below, and
 * only the body of these two functions changes. Call sites stay as they
 * are.
 *
 * <pre>
 *   PUT    /sessions/{sessionId}/shots/{sequence}/correction  { correction }
 *   DELETE /sessions/{sessionId}/shots/{sequence}/correction
 * </pre>
 */

export type ShotCorrection = "make" | "miss" | "false-positive";

export interface CorrectionRecord {
  sessionId: string;
  /** The shot's position in the session, as the pipeline numbered it. */
  sequence: number;
  correction: ShotCorrection;
}

export type CorrectionStore = Record<string, CorrectionRecord>;

/** A short asynchronous delay, so the optimistic update and rollback in
 * useShotCorrections are exercised in development rather than
 * short-circuited by a store that resolves before React can render. The
 * real endpoint will have real latency. */
const SIMULATED_LATENCY_MS = 180;

export const correctionKey = (sessionId: string, sequence: number) => `${sessionId}#${sequence}`;

/** Pure: apply a correction to a store, returning a new one. */
export function recordCorrection(
  store: CorrectionStore,
  sessionId: string,
  sequence: number,
  correction: ShotCorrection,
): CorrectionStore {
  return {
    ...store,
    [correctionKey(sessionId, sequence)]: { sessionId, sequence, correction },
  };
}

/** Pure: remove a correction from a store, returning a new one. */
export function removeCorrection(
  store: CorrectionStore,
  sessionId: string,
  sequence: number,
): CorrectionStore {
  const next = { ...store };
  delete next[correctionKey(sessionId, sequence)];
  return next;
}

/**
 * Module-level, so a correction made on one screen is visible on another
 * within the same page load. Not persisted: a reload starts empty, and the
 * UI says so.
 */
let store: CorrectionStore = {};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const shotCorrectionsService = {
  async correct(
    sessionId: string,
    sequence: number,
    correction: ShotCorrection,
  ): Promise<CorrectionRecord> {
    await delay(SIMULATED_LATENCY_MS);
    store = recordCorrection(store, sessionId, sequence, correction);
    return store[correctionKey(sessionId, sequence)]!;
  },

  async clear(sessionId: string, sequence: number): Promise<void> {
    await delay(SIMULATED_LATENCY_MS);
    store = removeCorrection(store, sessionId, sequence);
  },

  read(): CorrectionStore {
    return { ...store };
  },

  /** Test seam. */
  reset() {
    store = {};
  },
};
