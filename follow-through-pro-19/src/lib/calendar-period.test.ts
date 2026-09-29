import { describe, expect, it } from "vitest";

import { addDays, calendarPeriodLabel, startOfWeek, stepPeriod } from "@/lib/calendar-period";

/** Local noon, so a timezone shift cannot move the date under the test. */
const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

describe("stepPeriod", () => {
  it("moves a day at a time in day view", () => {
    expect(ymd(stepPeriod("DAY", on(2026, 9, 27), 1))).toBe("2026-09-28");
    expect(ymd(stepPeriod("DAY", on(2026, 9, 27), -1))).toBe("2026-09-26");
  });

  it("moves a week at a time in week view", () => {
    expect(ymd(stepPeriod("WEEK", on(2026, 9, 27), 1))).toBe("2026-10-04");
  });

  it("crosses a year boundary", () => {
    expect(ymd(stepPeriod("MONTH", on(2026, 12, 15), 1))).toBe("2027-01-01");
    expect(ymd(stepPeriod("MONTH", on(2026, 1, 15), -1))).toBe("2025-12-01");
  });

  it("does not skip a month when the day does not exist in the next one", () => {
    // The regression this guards: `setMonth` on the 31st rolls forward
    // into the following month, so stepping from 31 March would land in
    // March again and the arrow would appear not to work. Stepping from
    // the first of the month avoids it entirely.
    expect(ymd(stepPeriod("MONTH", on(2026, 3, 31), -1))).toBe("2026-02-01");
    expect(ymd(stepPeriod("MONTH", on(2026, 1, 31), 1))).toBe("2026-02-01");
    expect(ymd(stepPeriod("MONTH", on(2026, 5, 31), 1))).toBe("2026-06-01");
  });

  it("is reversible for every month of a year", () => {
    for (let m = 1; m <= 12; m++) {
      const start = on(2026, m, 1);
      expect(ymd(stepPeriod("MONTH", stepPeriod("MONTH", start, 1), -1))).toBe(ymd(start));
    }
  });
});

describe("startOfWeek", () => {
  it("rolls back to the configured first day and stays put once there", () => {
    // Default settings put the first day on Sunday. 2026-09-27 is one.
    const sunday = on(2026, 9, 27);
    expect(sunday.getDay()).toBe(0);
    expect(ymd(startOfWeek(sunday))).toBe("2026-09-27");
    expect(ymd(startOfWeek(on(2026, 10, 3)))).toBe("2026-09-27");
    expect(ymd(startOfWeek(on(2026, 9, 30)))).toBe("2026-09-27");
  });
});

describe("addDays", () => {
  it("does not mutate what it is given", () => {
    const start = on(2026, 9, 27);
    addDays(start, 10);
    expect(ymd(start)).toBe("2026-09-27");
  });
});

describe("calendarPeriodLabel", () => {
  it("names the period at the granularity of the view", () => {
    const d = on(2026, 9, 30);
    expect(calendarPeriodLabel("MONTH", d)).toMatch(/September/);
    expect(calendarPeriodLabel("WEEK", d)).toMatch(/^Week of /);
    // The day label carries the weekday, which is what tells you a
    // single-day view apart from a month one at a glance.
    expect(calendarPeriodLabel("DAY", d)).toMatch(/Wednesday/);
  });
});
