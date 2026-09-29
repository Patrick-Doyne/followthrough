// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useShotCorrections } from "@/hooks/use-shot-corrections";

/**
 * Render-stability checks.
 *
 * <p>These exist because of a bug that no pure test could have caught: the
 * hook returned a fresh object literal every render, a component used that
 * object as an effect dependency, and the effect set state in a provider —
 * an infinite render loop that typechecked, linted and passed every unit
 * test. Anything a component will put in a dependency array has to be
 * stable, and the only way to know is to render it.
 */

// Explicit rather than a shared setup file: `cleanup` needs a DOM, and a
// global setup would run for the node-environment suites too.
afterEach(cleanup);

function Harness({
  persist,
  onRenderCount,
}: {
  persist: () => Promise<unknown>;
  onRenderCount: (n: number) => void;
}) {
  const api = useShotCorrections("session-1", persist);

  // Depending on the whole returned object is exactly what the real call
  // site does; if it is not stable this effect runs forever.
  useEffect(() => {
    onRenderCount(1);
  }, [api, onRenderCount]);

  return (
    <button onClick={() => api.correct(1, "make")}>
      {api.corrections[1] ?? "none"}|{api.pending.length}
    </button>
  );
}

describe("useShotCorrections render stability", () => {
  it("returns a stable object across renders with no state change", () => {
    let effectRuns = 0;
    const count = () => {
      effectRuns += 1;
    };
    const persist = vi.fn(() => Promise.resolve());

    const { rerender } = render(<Harness persist={persist} onRenderCount={count} />);
    rerender(<Harness persist={persist} onRenderCount={count} />);
    rerender(<Harness persist={persist} onRenderCount={count} />);

    // One run on mount, and none for the re-renders: the identity held.
    expect(effectRuns).toBe(1);
  });

  it("applies optimistically and settles", async () => {
    let resolve!: () => void;
    const persist = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<Harness persist={persist} onRenderCount={() => {}} />);

    await act(async () => {
      screen.getByRole("button").click();
    });
    // Visible before the write completes, and marked pending.
    expect(screen.getByRole("button").textContent).toBe("make|1");

    await act(async () => {
      resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button").textContent).toBe("make|0");
  });

  it("rolls back when the write fails", async () => {
    const persist = vi.fn(() => Promise.reject(new Error("offline")));
    const onError = vi.fn();

    function Failing() {
      const api = useShotCorrections("session-1", persist, onError);
      return <button onClick={() => api.correct(7, "miss")}>{api.corrections[7] ?? "none"}</button>;
    }

    render(<Failing />);
    await act(async () => {
      screen.getByRole("button").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button").textContent).toBe("none");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
