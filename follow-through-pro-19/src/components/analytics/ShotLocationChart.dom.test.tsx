// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ShotLocationChart } from "@/components/analytics/ShotLocationChart";
import { COURT } from "@/services/court-geometry";
import type { Shot } from "@/types/telemetry";

afterEach(cleanup);

let n = 0;
function shot(partial: Partial<Shot> & { unplaced?: boolean } = {}): Shot {
  n += 1;
  const { unplaced, ...rest } = partial;
  const built: Shot = {
    shotId: `s${n}`,
    sessionId: "session-1",
    shotNumber: n,
    timestamp: "2026-01-01T00:00:00Z",
    result: "MAKE",
    shotType: "MID_RNG",
    shotDistance: 15,
    shotDuration: 1,
    timeToApex: 0.5,
    zone: "PAINT",
    location: { x: COURT.rim.x, y: COURT.rim.y },
    ...rest,
  };
  // `exactOptionalPropertyTypes` forbids assigning an explicit undefined,
  // so an unplaced shot omits the key entirely -- which is what the wire
  // actually produces.
  if (unplaced) delete built.location;
  return built;
}

describe("unplottable shots", () => {
  it("reports shots without a location instead of hiding them", () => {
    // A chart showing fewer shots than the session took, with no
    // explanation, reads as a bug or as a lower attempt count.
    render(
      <ShotLocationChart shots={[shot(), shot({ unplaced: true }), shot({ unplaced: true })]} />,
    );
    expect(screen.getByText(/1 shot plotted/)).toBeTruthy();
    expect(screen.getByText(/2 without a location/)).toBeTruthy();
  });

  it("explains why when nothing could be placed", () => {
    render(<ShotLocationChart shots={[shot({ unplaced: true })]} />);
    expect(screen.getByText(/the court had not calibrated/)).toBeTruthy();
  });

  it("says nothing about locations when every shot has one", () => {
    render(<ShotLocationChart shots={[shot(), shot()]} />);
    expect(screen.queryByText(/without a location/)).toBeNull();
  });
});

describe("zone filters", () => {
  const spread = [
    shot({ location: { x: COURT.rim.x, y: COURT.rim.y } }), // paint
    shot({ location: { x: 0.4, y: 1 } }), // corner three
    shot({ location: { x: COURT.rim.x, y: 9.5 } }), // above the break
    shot({ location: { x: COURT.rim.x + 4, y: 4 } }), // midrange
  ];

  it("shows everything when nothing is selected", () => {
    // An empty selection must mean "all", not "none" — a filter row that
    // starts by hiding the data reads as broken.
    render(<ShotLocationChart shots={spread} showZoneFilters />);
    expect(screen.getByText(/4 shots plotted/)).toBeTruthy();
  });

  it("narrows to the chosen zone and back", () => {
    render(<ShotLocationChart shots={spread} showZoneFilters />);
    const paint = screen.getByRole("button", { name: /Paint/ });

    fireEvent.click(paint);
    expect(paint.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/1 shot plotted/)).toBeTruthy();

    fireEvent.click(paint);
    expect(screen.getByText(/4 shots plotted/)).toBeTruthy();
  });

  it("combines selected zones rather than replacing them", () => {
    render(<ShotLocationChart shots={spread} showZoneFilters />);
    fireEvent.click(screen.getByRole("button", { name: /Paint/ }));
    fireEvent.click(screen.getByRole("button", { name: /Corner three/ }));
    expect(screen.getByText(/2 shots plotted/)).toBeTruthy();
  });

  it("shows a per-zone count so an empty zone is legible", () => {
    render(<ShotLocationChart shots={spread} showZoneFilters />);
    // One shot in each of the four zones.
    for (const label of ["Paint", "Midrange", "Corner three", "Above the break"]) {
      expect(screen.getByRole("button", { name: new RegExp(`${label}\\s*1`) }), label).toBeTruthy();
    }
  });

  it("is hidden where the chart is a small inset", () => {
    render(<ShotLocationChart shots={spread} />);
    expect(screen.queryByRole("group", { name: /Filter shots by court zone/ })).toBeNull();
  });
});
