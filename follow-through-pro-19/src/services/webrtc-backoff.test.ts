import { describe, expect, it } from "vitest";

import {
  attemptTimeoutMs,
  FIRST_ATTEMPT_TIMEOUT_MS,
  MAX_ATTEMPTS,
  retryDelayMs,
  RETRY_TIMEOUT_MS,
} from "@/services/webrtc-backoff";

describe("retryDelayMs", () => {
  it("grows, then caps", () => {
    const mid = () => 0.5; // no jitter
    const delays = Array.from({ length: MAX_ATTEMPTS }, (_, i) => retryDelayMs(i + 1, mid));
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 10000]);
  });

  it("gives up rather than retrying forever", () => {
    // A spinner that never ends is worse than an honest failure the person
    // can act on.
    expect(retryDelayMs(MAX_ATTEMPTS + 1)).toBeNull();
    expect(retryDelayMs(0)).toBeNull();
  });

  it("jitters within ±20% of the scheduled delay", () => {
    expect(retryDelayMs(2, () => 0)).toBe(800);
    expect(retryDelayMs(2, () => 1)).toBe(1200);
    expect(retryDelayMs(2, () => 0.5)).toBe(1000);
  });

  it("never returns a negative or zero delay", () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      for (const r of [0, 0.25, 0.5, 0.75, 1]) {
        expect(retryDelayMs(attempt, () => r)!).toBeGreaterThan(0);
      }
    }
  });
});

describe("attemptTimeoutMs", () => {
  it("is patient for the first attempt and brisk for retries", () => {
    // The pipeline loads three models on start; a retry is against a
    // process that is already up.
    expect(attemptTimeoutMs(0)).toBe(FIRST_ATTEMPT_TIMEOUT_MS);
    expect(attemptTimeoutMs(1)).toBe(RETRY_TIMEOUT_MS);
    expect(attemptTimeoutMs(5)).toBe(RETRY_TIMEOUT_MS);
    expect(attemptTimeoutMs(0)).toBeGreaterThan(attemptTimeoutMs(1));
  });
});
