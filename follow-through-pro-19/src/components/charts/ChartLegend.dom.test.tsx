// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChartLegend, type LegendItem } from "@/components/charts/ChartLegend";

afterEach(cleanup);

const ITEMS: LegendItem[] = [
  { id: "make", label: "Make", color: "oklch(0.72 0.16 155)", mark: "circle" },
  { id: "miss", label: "Miss", color: "oklch(0.57 0.2 22)", mark: "cross" },
  {
    id: "fit",
    label: "Your usual release",
    color: "oklch(0.72 0.17 52)",
    mark: "line",
    axis: "right",
  },
];

describe("ChartLegend", () => {
  it("names every mark, which is what lets the colours follow the theme", () => {
    render(<ChartLegend items={ITEMS} />);
    for (const item of ITEMS) expect(screen.getByText(item.label)).toBeTruthy();
  });

  it("draws each mark in the colour it is actually plotted in", () => {
    // The swatch and the series must not drift apart; both read the same
    // live palette value.
    const { container } = render(<ChartLegend items={ITEMS} />);
    const svg = container.innerHTML;
    for (const item of ITEMS) expect(svg).toContain(item.color);
  });

  it("distinguishes make from miss by shape, not only colour", () => {
    // In the light palette the two colours measure 1.035:1 against each
    // other -- the same brightness -- so shape is doing the real work.
    const { container } = render(<ChartLegend items={ITEMS} />);
    expect(container.querySelector("circle")).toBeTruthy();
    // The cross is a stroked path, not a circle or a rect.
    expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(2);
  });

  it("says which axis a series is read against when a chart has two", () => {
    render(<ChartLegend items={ITEMS} />);
    expect(screen.getByText("(right)")).toBeTruthy();
  });

  it("is a static key when nothing can be toggled", () => {
    render(<ChartLegend items={ITEMS} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("toggles a series and reports its state to assistive tech", () => {
    const onToggle = vi.fn();
    render(<ChartLegend items={ITEMS} hidden={["miss"]} onToggle={onToggle} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);

    const missButton = buttons[1] as HTMLElement;
    expect(missButton.getAttribute("aria-pressed")).toBe("false");
    expect((buttons[0] as HTMLElement).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(missButton);
    expect(onToggle).toHaveBeenCalledWith("miss");
  });

  it("renders nothing rather than an empty rail when there is no key", () => {
    const { container } = render(<ChartLegend items={[]} />);
    expect(container.querySelector("ul")).toBeNull();
  });

  it("gives its pattern a unique id per instance", () => {
    // Two hatched swatches on one page must not share a pattern id, or the
    // second silently reuses the first's colour.
    const hatched: LegendItem[] = [
      { id: "miss", label: "Misses", color: "oklch(0.57 0.2 22)", mark: "barHatched" },
    ];
    const { container: a } = render(<ChartLegend items={hatched} />);
    const { container: b } = render(<ChartLegend items={hatched} />);
    const idA = a.querySelector("pattern")?.getAttribute("id");
    const idB = b.querySelector("pattern")?.getAttribute("id");
    expect(idA).toBeTruthy();
    expect(idA).not.toBe(idB);
  });
});
