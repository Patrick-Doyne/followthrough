import { afterEach, describe, expect, it } from "vitest";

import {
  fmtClock,
  fmtDate,
  fmtDistance,
  fmtDistanceOrUnknown,
  fmtDuration,
  fmtNumber,
  fmtPercent,
  fmtSeconds,
  fmtShotType,
  fmtTime,
  titleCase,
} from "@/lib/format";
import { DEFAULT_FORMAT_CONFIG, resolveFormatConfig, setFormatConfig } from "@/lib/intl";
import { DEFAULT_SETTINGS, type RegionChoice } from "@/state/settings";

/** Points the module-level formatters at one region, the way the provider
 * does when someone changes "Regional format". */
function useRegion(region: RegionChoice, extra: Partial<typeof DEFAULT_SETTINGS> = {}) {
  setFormatConfig(
    resolveFormatConfig({
      ...DEFAULT_SETTINGS,
      regionFormat: region,
      timeZone: "UTC",
      ...extra,
    }),
  );
}

afterEach(() => setFormatConfig(DEFAULT_FORMAT_CONFIG));

describe("US output is unchanged by the move to Intl", () => {
  // These functions were hard-coded to en-US before becoming
  // locale-aware, and they feed ~110 call sites. Anything that renders
  // differently for a US user is a regression, not a feature.
  it("matches the previous strings", () => {
    useRegion("en-US");
    expect(fmtNumber(1234.567, 0)).toBe("1,235");
    expect(fmtNumber(1234.5, 1)).toBe("1,234.5");
    expect(fmtPercent(45)).toBe("45.0%");
    expect(fmtPercent(45, 0)).toBe("45%");
    expect(fmtDistance(23.45)).toBe("23.5 ft");
    expect(fmtSeconds(1.234)).toBe("1.23 s");
    expect(fmtDate("2025-03-12T15:30:00Z")).toBe("Mar 12, 2025");
  });

  it("leaves the non-localised helpers alone", () => {
    // A scrubber duration is not a time of day: no locale should turn
    // "02:05" into a 12-hour clock or a different separator.
    expect(fmtClock(125)).toBe("02:05");
    expect(fmtClock(3725)).toBe("1:02:05");
    useRegion("de-DE");
    expect(fmtClock(125)).toBe("02:05");

    expect(fmtDuration(90)).toBe("1h 30m");
    expect(fmtShotType("NBA_3PT")).toBe("NBA 3PT");
    expect(fmtShotType("UNKNOWN_CODE")).toBe("UNKNOWN_CODE");
    expect(titleCase("LAY_UP")).toBe("Lay Up");
  });
});

describe("regional format actually changes output", () => {
  it("reorders the date for the UK", () => {
    useRegion("en-GB");
    expect(fmtDate("2025-03-12T15:30:00Z")).toBe("12 Mar 2025");
  });

  it("switches the decimal and grouping separators for Germany", () => {
    useRegion("de-DE");
    expect(fmtNumber(1234.5, 1)).toBe("1.234,5");
  });

  it("uses a 24-hour clock where the region does, and a 12-hour one where it does not", () => {
    useRegion("en-US");
    expect(fmtTime("2025-03-12T15:30:00Z")).toMatch(/03:30\s?PM/i);
    useRegion("de-DE");
    expect(fmtTime("2025-03-12T15:30:00Z")).toMatch(/15:30/);
  });

  it("lets the clock preference override the region", () => {
    // This is the point of keeping hourCycle separate: wanting a 24-hour
    // clock does not mean wanting German date order.
    useRegion("en-US", { hourCycle: "h23" });
    expect(fmtTime("2025-03-12T15:30:00Z")).toMatch(/15:30/);
    useRegion("de-DE", { hourCycle: "h12" });
    expect(fmtTime("2025-03-12T15:30:00Z")).toMatch(/3:30/);
  });

  it("renders times in the chosen zone, not the machine's", () => {
    setFormatConfig(
      resolveFormatConfig({
        ...DEFAULT_SETTINGS,
        regionFormat: "en-GB",
        timeZone: "Asia/Tokyo",
        hourCycle: "h23",
      }),
    );
    // 15:30 UTC is 00:30 the next day in Tokyo.
    expect(fmtTime("2025-03-12T15:30:00Z")).toMatch(/00:30/);
    expect(fmtDate("2025-03-12T15:30:00Z")).toBe("13 Mar 2025");
  });
});

describe("fmtDistanceOrUnknown", () => {
  it("reads a measured distance", () => {
    expect(fmtDistanceOrUnknown(12.4)).toBe(fmtDistance(12.4));
  });

  it("says nothing rather than 'under the rim' when it was not recorded", () => {
    // Zero is the sentinel for a distance the pipeline did not report.
    // Rendering it as "0.0 ft" claims the shot was taken from under
    // the basket, which is the one reading the data must never suggest.
    expect(fmtDistanceOrUnknown(0)).toBe("—");
    expect(fmtDistanceOrUnknown(null)).toBe("—");
    expect(fmtDistanceOrUnknown(undefined)).toBe("—");
  });
});
