import { describe, expect, it } from "vitest";

import type { OverlayTelemetryMessage } from "@/types/overlay-telemetry";

/**
 * The scoring rules from use-live-score, exercised directly.
 *
 * <p>The hook itself needs React and a session; the interesting part is the
 * reducer logic, so it is restated here as a pure fold over the same
 * messages. If the hook's rules change, these change with them.
 */
interface Score {
  makes: number;
  misses: number;
  attempts: number;
  percentage: number | null;
  streak: number;
  bestStreak: number;
}

const EMPTY: Score = {
  makes: 0,
  misses: 0,
  attempts: 0,
  percentage: null,
  streak: 0,
  bestStreak: 0,
};

function apply(prev: Score, message: Extract<OverlayTelemetryMessage, { type: "shot_event" }>) {
  const made = message.result === "make";
  const makes = message.makes ?? prev.makes + (made ? 1 : 0);
  const misses = message.misses ?? prev.misses + (made ? 0 : 1);
  const attempts = makes + misses;
  const streak = made ? prev.streak + 1 : 0;
  return {
    makes,
    misses,
    attempts,
    percentage: attempts === 0 ? null : Math.round((makes / attempts) * 100),
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
  };
}

const shot = (
  result: "make" | "miss",
  makes: number,
  misses: number,
): Extract<OverlayTelemetryMessage, { type: "shot_event" }> =>
  ({ type: "shot_event", result, makes, misses }) as Extract<
    OverlayTelemetryMessage,
    { type: "shot_event" }
  >;

const fold = (seq: ["make" | "miss", number, number][]) =>
  seq.reduce((acc, [r, m, x]) => apply(acc, shot(r, m, x)), EMPTY);

describe("live score", () => {
  it("shows no percentage before the first attempt", () => {
    // Not 0%, which reads as "missed everything" rather than "nothing yet".
    expect(EMPTY.percentage).toBeNull();
  });

  it("tracks makes, attempts and percentage", () => {
    const score = fold([
      ["make", 1, 0],
      ["miss", 1, 1],
      ["make", 2, 1],
    ]);
    expect(score).toMatchObject({ makes: 2, misses: 1, attempts: 3, percentage: 67 });
  });

  it("prefers the pipeline's own totals over local increments", () => {
    // A dropped message would otherwise leave the DOM count permanently
    // behind the canvas count, which is the divergence this replaces.
    const score = fold([
      ["make", 1, 0],
      ["make", 7, 3],
    ]);
    expect(score.makes).toBe(7);
    expect(score.misses).toBe(3);
    expect(score.attempts).toBe(10);
  });

  it("resets the streak on a miss but remembers the best", () => {
    const score = fold([
      ["make", 1, 0],
      ["make", 2, 0],
      ["make", 3, 0],
      ["miss", 3, 1],
      ["make", 4, 1],
    ]);
    expect(score.streak).toBe(1);
    expect(score.bestStreak).toBe(3);
  });

  it("rounds percentage rather than truncating", () => {
    expect(fold([["make", 2, 1]]).percentage).toBe(67);
    expect(fold([["make", 1, 2]]).percentage).toBe(33);
  });
});
