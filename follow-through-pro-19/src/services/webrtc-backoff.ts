/**
 * Retry schedule for the live WebRTC session.
 *
 * <p>Pure and separate from the transport, because `vitest` runs in a node
 * environment with no `WebSocket` and no `RTCPeerConnection`: the policy is
 * testable, the transport is not. Keeping the decision here also means the
 * session class holds no retry arithmetic.
 */

/** Delay before each attempt, in ms. Index 0 is the first *retry*. */
const SCHEDULE_MS = [500, 1000, 2000, 4000, 8000];
const CAP_MS = 10_000;

/** ±20%, so many clients reconnecting after a relay restart do not arrive
 * together and knock it over again. */
const JITTER = 0.2;

export const MAX_ATTEMPTS = 6;

/**
 * How long a connection must hold before the failure count is forgiven.
 *
 * <p>Resetting on `connected` alone would let a flapping link retry forever:
 * each brief success would clear the counter and the backoff would never
 * grow. The connection has to actually stay up.
 */
export const STABLE_AFTER_MS = 10_000;

/** First attempt waits longer: the C++ pipeline may still be starting, and
 * its model load takes many seconds. Retries can be far less patient. */
export const FIRST_ATTEMPT_TIMEOUT_MS = 20_000;
export const RETRY_TIMEOUT_MS = 8_000;

/**
 * Delay before retry number `attempt` (1-based), or null when the budget is
 * exhausted and the failure should be surfaced instead.
 *
 * @param random injectable so tests are deterministic.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number | null {
  if (attempt < 1 || attempt > MAX_ATTEMPTS) return null;
  const base = SCHEDULE_MS[attempt - 1] ?? CAP_MS;
  const spread = base * JITTER;
  // Centred on base, so the mean schedule is the one written above.
  return Math.round(base - spread + random() * spread * 2);
}

/** Timeout to allow for a given attempt (0 = the first connection). */
export function attemptTimeoutMs(attempt: number): number {
  return attempt === 0 ? FIRST_ATTEMPT_TIMEOUT_MS : RETRY_TIMEOUT_MS;
}
