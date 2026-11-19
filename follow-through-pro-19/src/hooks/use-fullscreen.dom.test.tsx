// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFullscreen } from "@/hooks/use-fullscreen";

/**
 * Both routes to fullscreen: the Fullscreen API where the browser has it,
 * and pinning the surface over the page where it does not (Safari on an
 * iPhone, for anything but a bare video). The caller only ever sees the
 * one `active` flag, so that is what these check.
 */

afterEach(() => {
  cleanup();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  document.body.style.overflow = "";
});

function surface(requestFullscreen?: () => Promise<void>) {
  const element = document.createElement("div");
  if (requestFullscreen) {
    Object.defineProperty(element, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
  } else {
    Object.defineProperty(element, "requestFullscreen", { configurable: true, value: undefined });
  }
  return { current: element };
}

describe("useFullscreen", () => {
  it("pins the surface when the Fullscreen API is missing, and Escape unpins it", () => {
    const ref = surface();
    const { result } = renderHook(() => useFullscreen(ref));
    expect(result.current.active).toBe(false);

    act(() => result.current.enter());
    expect(result.current.active).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.active).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  it("ignores keys other than Escape while pinned", () => {
    const ref = surface();
    const { result } = renderHook(() => useFullscreen(ref));
    act(() => result.current.enter());

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });
    expect(result.current.active).toBe(true);
  });

  it("uses the Fullscreen API where it exists and follows fullscreenchange", async () => {
    const request = vi.fn(() => Promise.resolve());
    const ref = surface(request);
    const { result } = renderHook(() => useFullscreen(ref));

    act(() => result.current.enter());
    expect(request).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: ref.current,
    });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.active).toBe(true);

    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    act(() => result.current.toggle());
    expect(exitFullscreen).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.active).toBe(false);
  });

  it("falls back to pinning when the browser refuses fullscreen", async () => {
    const ref = surface(() => Promise.reject(new Error("not allowed")));
    const { result } = renderHook(() => useFullscreen(ref));

    await act(async () => {
      result.current.enter();
    });
    expect(result.current.active).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.active).toBe(false);
  });

  it("does nothing without a surface to show", () => {
    const { result } = renderHook(() => useFullscreen({ current: null }));
    act(() => result.current.enter());
    expect(result.current.active).toBe(false);
  });
});
