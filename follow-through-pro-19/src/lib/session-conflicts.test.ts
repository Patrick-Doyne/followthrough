import { describe, expect, it } from "vitest";

import { absoluteSpan, findConflicts, type Scheduled } from "@/lib/session-conflicts";

const s = (date: string, startTime: string, endTime: string): Scheduled => ({
  date,
  startTime,
  endTime,
});

const DAY = "2026-09-27";
const NEXT = "2026-09-28";

describe("findConflicts", () => {
  it("finds a session that starts inside another", () => {
    expect(findConflicts(s(DAY, "10:30", "11:30"), [s(DAY, "10:00", "12:00")])).toHaveLength(1);
  });

  it("finds one that wholly contains another", () => {
    expect(findConflicts(s(DAY, "09:00", "13:00"), [s(DAY, "10:00", "11:00")])).toHaveLength(1);
  });

  it("finds one that is wholly contained", () => {
    expect(findConflicts(s(DAY, "10:15", "10:45"), [s(DAY, "10:00", "11:00")])).toHaveLength(1);
  });

  it("allows back-to-back sessions", () => {
    // The normal shape of a training day: a block ends and the next
    // begins. Treating touching as a clash would make the rule
    // unusable.
    expect(findConflicts(s(DAY, "10:00", "11:00"), [s(DAY, "11:00", "12:00")])).toEqual([]);
    expect(findConflicts(s(DAY, "11:00", "12:00"), [s(DAY, "10:00", "11:00")])).toEqual([]);
  });

  it("allows three back-to-back twenty-minute blocks", () => {
    const blocks = [s(DAY, "10:00", "10:20"), s(DAY, "10:20", "10:40"), s(DAY, "10:40", "11:00")];
    for (const block of blocks) {
      const others = blocks.filter((b) => b !== block);
      expect(findConflicts(block, others)).toEqual([]);
    }
  });

  it("ignores a session on another date", () => {
    expect(findConflicts(s(DAY, "10:00", "11:00"), [s(NEXT, "10:00", "11:00")])).toEqual([]);
  });

  it("catches a session that runs past midnight into the next day's first block", () => {
    // The reason spans are absolute rather than minutes-from-midnight.
    expect(findConflicts(s(DAY, "22:00", "01:00"), [s(NEXT, "00:30", "02:00")])).toHaveLength(1);
    expect(findConflicts(s(DAY, "22:00", "01:00"), [s(NEXT, "01:00", "02:00")])).toEqual([]);
  });

  it("reports every session it clashes with, not just the first", () => {
    const clashes = findConflicts(s(DAY, "09:00", "13:00"), [
      s(DAY, "09:30", "10:00"),
      s(DAY, "11:00", "11:30"),
      s(DAY, "14:00", "15:00"),
    ]);
    expect(clashes).toHaveLength(2);
  });

  it("says nothing about a session with no duration", () => {
    // spanOf reads an end at or before the start as running past
    // midnight; a genuine zero-length span cannot clash with anything.
    expect(findConflicts(s(DAY, "10:00", "10:00"), [s(DAY, "09:00", "23:00")])).toHaveLength(1);
  });
});

describe("absoluteSpan", () => {
  it("orders sessions across dates", () => {
    expect(absoluteSpan(s(DAY, "23:00", "23:30")).start).toBeLessThan(
      absoluteSpan(s(NEXT, "00:00", "01:00")).start,
    );
  });

  it("carries an overnight session into the following day", () => {
    const overnight = absoluteSpan(s(DAY, "23:00", "01:00"));
    expect(overnight.end - overnight.start).toBe(120);
  });
});
