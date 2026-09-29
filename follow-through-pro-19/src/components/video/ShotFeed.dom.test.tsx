// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShotFeed } from "@/components/video/ShotFeed";
import type { LiveShot } from "@/hooks/use-live-score";
import type { ShotCorrectionsApi } from "@/hooks/use-shot-corrections";

/**
 * The correction surface, rendered.
 *
 * <p>The command registry is stubbed rather than wrapping the real
 * provider: what matters here is that the feed *claims and releases* the
 * correction commands, because leaving them claimed is what makes "m" stop
 * working as an ordinary letter everywhere else in the app.
 */

afterEach(cleanup);

const registered = new Map<string, () => void>();
vi.mock("@/state/commands", () => ({
  useCommands: () => ({
    registerCommand: (id: string, handler: () => void) => {
      registered.set(id, handler);
      return () => registered.delete(id);
    },
  }),
}));

const base = {
  at: 1_700_000_000_000,
  location: null,
  distanceFt: null,
  durationSeconds: null,
  timeToApexSeconds: null,
};

const shots: LiveShot[] = [
  { ...base, result: "make", designation: "MID_RNG", sequence: 3 },
  { ...base, result: "miss", designation: "LAY_UP", sequence: 2 },
];

function api(overrides: Partial<ShotCorrectionsApi> = {}): ShotCorrectionsApi {
  return {
    corrections: {},
    pending: [],
    correct: vi.fn(),
    revert: vi.fn(),
    lastError: null,
    ...overrides,
  };
}

describe("ShotFeed", () => {
  it("claims the correction commands while a session is active", () => {
    registered.clear();
    const { unmount } = render(<ShotFeed shots={shots} corrections={api()} active />);
    expect([...registered.keys()].sort()).toEqual([
      "shots.markMade",
      "shots.markMissed",
      "shots.markNotAShot",
    ]);

    // Released on unmount, or "m" and "x" stay hijacked app-wide.
    unmount();
    expect(registered.size).toBe(0);
  });

  it("claims nothing while no session is running", () => {
    registered.clear();
    render(<ShotFeed shots={shots} corrections={api()} active={false} />);
    expect(registered.size).toBe(0);
  });

  it("targets the newest shot without needing a selection", () => {
    registered.clear();
    const correct = vi.fn();
    render(<ShotFeed shots={shots} corrections={api({ correct })} active />);

    registered.get("shots.markMade")!();
    // Newest first, so sequence 3.
    expect(correct).toHaveBeenCalledWith(3, "make");
  });

  it("retargets once a shot is selected", () => {
    registered.clear();
    const correct = vi.fn();
    render(<ShotFeed shots={shots} corrections={api({ correct })} active />);

    fireEvent.click(screen.getByText(/Shot 2/).closest("button")!);
    registered.get("shots.markMissed")!();
    expect(correct).toHaveBeenCalledWith(2, "miss");
  });

  it("shows a corrected shot as corrected, and offers undo instead of re-correcting", () => {
    render(<ShotFeed shots={shots} corrections={api({ corrections: { 3: "miss" } })} active />);
    expect(screen.getByText(/corrected/)).toBeTruthy();
    expect(screen.getByLabelText(/Undo the correction to shot 3/)).toBeTruthy();
  });

  it("marks a false positive as not a shot rather than deleting the row", () => {
    // Keeping the row visible is what makes the correction undoable and
    // keeps the numbering stable.
    render(
      <ShotFeed shots={shots} corrections={api({ corrections: { 3: "false-positive" } })} active />,
    );
    expect(screen.getByText(/Shot 3 — not a shot/)).toBeTruthy();
  });

  it("surfaces an in-flight write", () => {
    render(<ShotFeed shots={shots} corrections={api({ pending: [3] })} active />);
    expect(screen.getByText(/saving/)).toBeTruthy();
  });

  it("gives direction, not an apology, when there is nothing yet", () => {
    render(<ShotFeed shots={[]} corrections={api()} active={false} />);
    expect(screen.getByText(/Point the camera at the rim/)).toBeTruthy();
  });
});
