// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MissingField } from "@/components/analytics/chart-parts";
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
    shotDuration: 0,
    timeToApex: 0,
    ...overrides,
  };
}

afterEach(cleanup);

describe("MissingField", () => {
  it("names the missing fields and shows the counts behind the claim", () => {
    // The case that prompted it: a clip processed by a build of the
    // pipeline that wrote distances but no timings.
    const shots = Array.from({ length: 5 }, (_, i) => shot({ location: { x: 7, y: 3 } }, i));
    render(<MissingField shots={shots} needs={["duration", "apex"]} />);

    expect(screen.getByText(/None of these 5 shots/)).toBeTruthy();
    expect(screen.getByText(/a flight time or a time to apex/)).toBeTruthy();
    // Re-processing is the fix, and the message has to say so.
    expect(screen.getByText(/Re-process the video/)).toBeTruthy();

    // The counts let the reader check the sentence rather than trust it.
    const rows = screen.getAllByRole("definition").map((el) => el.textContent);
    expect(rows).toEqual(["5/5", "0/5", "0/5", "5/5"]);
  });

  it("reports a partial gap as partial rather than as none", () => {
    const shots = [
      shot({ shotDuration: 1.1 }, 0),
      shot({ shotDuration: 1.2 }, 1),
      shot({}, 2),
      shot({}, 3),
    ];
    render(<MissingField shots={shots} needs={["duration"]} />);
    const rows = screen.getAllByRole("definition").map((el) => el.textContent);
    // distance 4/4, duration 2/4, apex 0/4, location 0/4
    expect(rows).toEqual(["4/4", "2/4", "0/4", "0/4"]);
  });
});
