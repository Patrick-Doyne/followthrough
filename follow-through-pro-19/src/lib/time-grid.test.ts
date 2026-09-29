import { describe, expect, it } from "vitest";

import {
  GRID_HOURS,
  HOUR_REM,
  MIN_BLOCK_REM,
  STACK_STEP_REM,
  gridHeight,
  layoutColumn,
  minutesOf,
  offsetOf,
  rowHeights,
  rowTop,
  spanOf,
  type Placement,
} from "@/lib/time-grid";

const at = (startTime: string, endTime: string) => spanOf({ startTime, endTime });
const lane = (p: Placement | undefined) => (p?.kind === "lane" ? p : null);
const stack = (p: Placement | undefined) => (p?.kind === "stack" ? p : null);
const flat = rowHeights(new Array(24).fill(0));

describe("spanOf", () => {
  it("reads a span in minutes from midnight", () => {
    expect(at("09:30", "11:00")).toEqual({ start: 570, end: 660 });
  });

  it("carries a session that runs past midnight into the next day", () => {
    // Otherwise the block has a negative height and vanishes.
    expect(at("22:00", "01:00")).toEqual({ start: 1320, end: 1500 });
    expect(minutesOf("00:00")).toBe(0);
  });
});

describe("GRID_HOURS", () => {
  it("is every hour of the day", () => {
    expect(GRID_HOURS).toHaveLength(24);
    expect(GRID_HOURS[0]).toBe(0);
    expect(GRID_HOURS.at(-1)).toBe(23);
  });
});

describe("layoutColumn", () => {
  it("gives a lone session the whole column", () => {
    expect(lane(layoutColumn([at("09:00", "10:00")]).placements[0])).toEqual({
      kind: "lane",
      lane: 0,
      lanes: 1,
    });
  });

  it("keeps back-to-back sessions full width", () => {
    // One ends exactly as the next starts, so they never share a row.
    const { placements } = layoutColumn([at("09:00", "10:00"), at("10:00", "11:00")]);
    expect(placements.map((p) => lane(p)?.lanes)).toEqual([1, 1]);
  });

  it("splits overlapping sessions into lanes and agrees on the count", () => {
    const { placements } = layoutColumn([
      at("09:00", "12:00"),
      at("09:30", "10:30"),
      at("10:00", "11:00"),
    ]);
    expect(placements.map((p) => lane(p)?.lanes)).toEqual([3, 3, 3]);
    expect(new Set(placements.map((p) => lane(p)?.lane)).size).toBe(3);
  });

  it("reuses a lane that has been vacated", () => {
    const { placements } = layoutColumn([
      at("09:00", "13:00"),
      at("09:30", "10:30"),
      at("11:00", "12:00"),
    ]);
    expect(lane(placements[1])?.lane).toBe(1);
    expect(lane(placements[2])?.lane).toBe(1);
  });

  describe("when the column runs out of horizontal room", () => {
    const three = [at("10:00", "12:00"), at("10:30", "11:30"), at("11:00", "12:30")];

    it("stacks each session inside the hour it starts in", () => {
      // The regression this guards: stacking the whole cluster from
      // its first start ran the blocks down through the hours after
      // it, so the 11:00 session was drawn against 10:00 on the axis.
      const { placements } = layoutColumn(three, 2);
      expect(placements.map((p) => stack(p)?.hour)).toEqual([10, 10, 11]);
    });

    it("indexes them within their own hour, not across the cluster", () => {
      const { placements } = layoutColumn(three, 2);
      expect(placements.map((p) => stack(p)?.index)).toEqual([0, 1, 0]);
    });

    it("asks each hour for exactly the slots it needs", () => {
      const { stackSlots } = layoutColumn(three, 2);
      expect(stackSlots[10]).toBe(2);
      expect(stackSlots[11]).toBe(1);
      expect(stackSlots[9]).toBe(0);
      expect(stackSlots[12]).toBe(0);
    });

    it("keeps side-by-side placement while it still fits", () => {
      expect(layoutColumn(three, 3).placements.every((p) => p.kind === "lane")).toBe(true);
      expect(layoutColumn(three, 3).stackSlots.every((s) => s === 0)).toBe(true);
    });

    it("only stacks the cluster that is too crowded", () => {
      const { placements } = layoutColumn([...three, at("15:00", "16:00")], 2);
      expect(placements[3]?.kind).toBe("lane");
      expect(placements[0]?.kind).toBe("stack");
    });
  });
});

describe("proportional sizing", () => {
  const heightOf = (span: { start: number; end: number }, heights: number[]) =>
    offsetOf(span.end, heights) - offsetOf(span.start, heights);

  it("gives a two-hour session both hour blocks", () => {
    const { minHeights, stackSlots } = layoutColumn([at("10:00", "12:00")]);
    const heights = rowHeights(stackSlots, minHeights);
    expect(heightOf(at("10:00", "12:00"), heights)).toBeCloseTo(2 * HOUR_REM, 5);
  });

  it("gives a half-hour session half its hour", () => {
    const { minHeights, stackSlots } = layoutColumn([at("10:00", "10:30")]);
    const heights = rowHeights(stackSlots, minHeights);
    expect(heights[10]).toBe(HOUR_REM);
    expect(heightOf(at("10:00", "10:30"), heights)).toBeCloseTo(HOUR_REM / 2, 5);
  });

  it("divides an hour into exact thirds for three back-to-back blocks", () => {
    // Flooring each block at the readable minimum instead would make
    // them overlap each other inside a one-hour row. The hour grows
    // and the proportions hold.
    const blocks = [at("10:00", "10:20"), at("10:20", "10:40"), at("10:40", "11:00")];
    const { minHeights, stackSlots, placements } = layoutColumn(blocks);
    const heights = rowHeights(stackSlots, minHeights);
    expect(placements.every((p) => p.kind === "lane" && p.lanes === 1)).toBe(true);

    const drawn = blocks.map((b) => heightOf(b, heights));
    expect(drawn[0]).toBeCloseTo(drawn[1] ?? 0, 5);
    expect(drawn[1]).toBeCloseTo(drawn[2] ?? 0, 5);
    expect(drawn.reduce((a, b) => a + b, 0)).toBeCloseTo(heights[10] ?? 0, 5);
    for (const h of drawn) expect(h).toBeGreaterThanOrEqual(MIN_BLOCK_REM - 1e-9);
  });

  it("stacks them in chronological order down the hour", () => {
    const blocks = [at("10:40", "11:00"), at("10:00", "10:20"), at("10:20", "10:40")];
    const { minHeights, stackSlots } = layoutColumn(blocks);
    const heights = rowHeights(stackSlots, minHeights);
    const tops = blocks.map((b) => offsetOf(b.start, heights));
    expect(tops[1]).toBeLessThan(tops[2] ?? 0);
    expect(tops[2]).toBeLessThan(tops[0] ?? 0);
  });

  it("does not stretch an hour for a session that spans several", () => {
    const { minHeights } = layoutColumn([at("09:00", "13:00")]);
    expect(rowHeights([], minHeights).every((h) => h === HOUR_REM)).toBe(true);
  });

  it("caps how far one very short session can stretch its hour", () => {
    const { minHeights, stackSlots } = layoutColumn([at("10:00", "10:02")]);
    expect(rowHeights(stackSlots, minHeights)[10]).toBeLessThanOrEqual(HOUR_REM * 4);
  });
});

describe("rowHeights", () => {
  it("leaves an hour alone when nothing stacks in it", () => {
    expect(flat.every((h) => h === HOUR_REM)).toBe(true);
    expect(flat).toHaveLength(24);
  });

  it("grows an hour to hold the stack inside it", () => {
    const slots = new Array(24).fill(0);
    slots[10] = 6;
    const heights = rowHeights(slots);
    expect(heights[10]).toBeGreaterThan(6 * STACK_STEP_REM);
    expect(heights[9]).toBe(HOUR_REM);
  });

  it("never shrinks an hour below its normal height", () => {
    const slots = new Array(24).fill(0);
    slots[10] = 1;
    expect(rowHeights(slots)[10]).toBe(HOUR_REM);
  });
});

describe("offsetOf", () => {
  it("measures down the axis an hour at a time", () => {
    expect(offsetOf(0, flat)).toBe(0);
    expect(offsetOf(60, flat)).toBe(HOUR_REM);
    expect(offsetOf(90, flat)).toBeCloseTo(HOUR_REM * 1.5, 5);
    expect(gridHeight(flat)).toBe(24 * HOUR_REM);
  });

  it("carries the extra height of an expanded hour into everything below it", () => {
    // The whole point of accumulating rather than using percentages:
    // an hour that grew must push later hours down, and the axis
    // labels use the same function so they cannot drift.
    const slots = new Array(24).fill(0);
    slots[10] = 6;
    const heights = rowHeights(slots);
    const extra = (heights[10] ?? 0) - HOUR_REM;
    expect(offsetOf(10 * 60, heights)).toBe(10 * HOUR_REM);
    expect(offsetOf(11 * 60, heights)).toBeCloseTo(11 * HOUR_REM + extra, 5);
    expect(rowTop(11, heights)).toBeCloseTo(11 * HOUR_REM + extra, 5);
    expect(gridHeight(heights)).toBeCloseTo(24 * HOUR_REM + extra, 5);
  });

  it("keeps a session that runs past midnight inside the day", () => {
    expect(offsetOf(at("22:00", "01:00").end, flat)).toBe(gridHeight(flat));
  });
});
