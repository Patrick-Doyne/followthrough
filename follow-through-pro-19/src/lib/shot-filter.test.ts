import { describe, expect, it } from "vitest";

import { filterShots } from "@/lib/shot-filter";
import type { Shot } from "@/types/telemetry";

function shot(overrides: Partial<Shot> = {}, index = 0): Shot {
  return {
    shotId: `shot-${index}`,
    sessionId: "session-1",
    shotNumber: index + 1,
    timestamp: "2026-07-12T10:00:00.000Z",
    result: "MAKE",
    shotType: "MID_RNG",
    shotDistance: 14,
    shotDuration: 1,
    timeToApex: 0.6,
    ...overrides,
  };
}

describe("filterShots", () => {
  it("returns everything when every filter is the ALL sentinel", () => {
    const shots = [shot({}, 0), shot({ sessionId: "session-2" }, 1)];
    expect(
      filterShots(shots, { sessionId: "ALL", result: "ALL", shotType: "ALL", zone: "ALL" }),
    ).toHaveLength(2);
  });

  it("returns everything when no filter is set at all", () => {
    expect(filterShots([shot()], {})).toHaveLength(1);
  });

  it("narrows to one session", () => {
    const shots = [shot({}, 0), shot({ sessionId: "session-2" }, 1)];
    expect(filterShots(shots, { sessionId: "session-2" }).map((s) => s.shotId)).toEqual(["shot-1"]);
  });

  it("narrows by result and by shot type", () => {
    const shots = [shot({ result: "MAKE" }, 0), shot({ result: "MISS", shotType: "LAY_UP" }, 1)];
    expect(filterShots(shots, { result: "MISS" })).toHaveLength(1);
    expect(filterShots(shots, { shotType: "LAY_UP" })).toHaveLength(1);
  });

  it("excludes a shot with no zone when a zone is asked for", () => {
    // An unplaced shot has no zone; matching it would invent a direction.
    const shots = [shot({ zone: "PAINT" }, 0), shot({}, 1)];
    expect(filterShots(shots, { zone: "PAINT" }).map((s) => s.shotId)).toEqual(["shot-0"]);
  });

  it("treats both date bounds as inclusive of the whole named day", () => {
    // The same date for both bounds must match that day, not nothing.
    const shots = [
      shot({ timestamp: "2026-07-12T00:00:01.000Z" }, 0),
      shot({ timestamp: "2026-07-12T23:59:59.000Z" }, 1),
      shot({ timestamp: "2026-07-13T00:00:01.000Z" }, 2),
    ];
    const sameDay = filterShots(shots, { from: "2026-07-12", to: "2026-07-12" });
    expect(sameDay.map((s) => s.shotId)).toEqual(["shot-0", "shot-1"]);
  });

  it("applies a lower bound and an upper bound independently", () => {
    const shots = [
      shot({ timestamp: "2026-07-10T10:00:00.000Z" }, 0),
      shot({ timestamp: "2026-07-20T10:00:00.000Z" }, 1),
    ];
    expect(filterShots(shots, { from: "2026-07-15" }).map((s) => s.shotId)).toEqual(["shot-1"]);
    expect(filterShots(shots, { to: "2026-07-15" }).map((s) => s.shotId)).toEqual(["shot-0"]);
  });

  it("combines filters conjunctively", () => {
    const shots = [
      shot({ sessionId: "a", result: "MAKE" }, 0),
      shot({ sessionId: "a", result: "MISS" }, 1),
      shot({ sessionId: "b", result: "MAKE" }, 2),
    ];
    expect(filterShots(shots, { sessionId: "a", result: "MAKE" }).map((s) => s.shotId)).toEqual([
      "shot-0",
    ]);
  });

  it("drops a shot whose timestamp cannot be read, rather than keeping it", () => {
    const shots = [shot({ timestamp: "not a date" }, 0)];
    expect(filterShots(shots, { from: "2026-01-01" })).toHaveLength(0);
    // With no date filter it is left alone -- the date is only consulted
    // when a bound was actually asked for.
    expect(filterShots(shots, {})).toHaveLength(1);
  });

  it("returns a new array and does not mutate the input", () => {
    const shots = [shot({}, 0), shot({ result: "MISS" }, 1)];
    const before = [...shots];
    filterShots(shots, { result: "MAKE" });
    expect(shots).toEqual(before);
  });
});
