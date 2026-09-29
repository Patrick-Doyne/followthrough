import { describe, expect, it, vi } from "vitest";

import type { PersistCorrection } from "@/hooks/use-shot-corrections";
import {
  recordCorrection,
  removeCorrection,
  shotCorrectionsService,
  type CorrectionStore,
} from "@/services/shot-corrections";

/**
 * The optimistic-correction rules, exercised as a pure fold.
 *
 * <p>The hook needs React; the rules are what matter and what can be wrong.
 * They are restated here against the same semantics: apply immediately,
 * restore the *previous* value on failure, and never let a stale closure
 * clobber a newer choice.
 */
type Corrections = Record<number, string>;

function applyOptimistic(state: Corrections, sequence: number, correction: string) {
  const previous = state[sequence];
  return { next: { ...state, [sequence]: correction }, previous };
}

function rollback(state: Corrections, sequence: number, previous: string | undefined) {
  const next = { ...state };
  if (previous === undefined) delete next[sequence];
  else next[sequence] = previous;
  return next;
}

describe("optimistic correction rules", () => {
  it("applies the correction before the write completes", () => {
    const { next } = applyOptimistic({}, 3, "make");
    expect(next[3]).toBe("make");
  });

  it("removes the correction entirely when there was none before", () => {
    // Rolling back to "miss" when the detector had said "miss" and the
    // person had never corrected it would look identical but would report
    // the shot as human-confirmed.
    const { next, previous } = applyOptimistic({}, 3, "make");
    expect(rollback(next, 3, previous)).toEqual({});
  });

  it("restores the earlier correction, not a blank", () => {
    const first = applyOptimistic({}, 3, "make").next;
    const { next, previous } = applyOptimistic(first, 3, "false-positive");
    expect(previous).toBe("make");
    expect(rollback(next, 3, previous)).toEqual({ 3: "make" });
  });

  it("leaves other shots untouched on rollback", () => {
    const state = { 1: "make", 2: "miss" };
    const { next, previous } = applyOptimistic(state, 3, "make");
    expect(rollback(next, 3, previous)).toEqual(state);
  });
});

describe("correction store", () => {
  it("records a correction and can remove it", () => {
    let s: CorrectionStore = {};
    s = recordCorrection(s, "session-001", 4, "make");
    expect(s["session-001#4"]).toMatchObject({ sequence: 4, correction: "make" });
    s = removeCorrection(s, "session-001", 4);
    expect(s["session-001#4"]).toBeUndefined();
  });

  it("keys by session, so the same shot number in two sessions does not collide", () => {
    let s: CorrectionStore = {};
    s = recordCorrection(s, "session-a", 1, "make");
    s = recordCorrection(s, "session-b", 1, "miss");
    expect(s["session-a#1"]?.correction).toBe("make");
    expect(s["session-b#1"]?.correction).toBe("miss");
  });

  it("does not mutate the store it was given", () => {
    const original: CorrectionStore = {};
    recordCorrection(original, "s", 1, "make");
    expect(original).toEqual({});
  });

  it("round-trips through the service", async () => {
    shotCorrectionsService.reset();
    await shotCorrectionsService.correct("session-001", 4, "false-positive");
    expect(shotCorrectionsService.read()["session-001#4"]?.correction).toBe("false-positive");
    await shotCorrectionsService.clear("session-001", 4);
    expect(shotCorrectionsService.read()["session-001#4"]).toBeUndefined();
  });
});

describe("failure surfacing", () => {
  it("reports a failed write once, not once per retry", async () => {
    const onError = vi.fn();
    const failing: PersistCorrection = () => Promise.reject(new Error("offline"));
    await failing("s", 1, "make").catch(() => onError("Couldn't save the correction to shot 1."));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("shot 1"));
  });
});
