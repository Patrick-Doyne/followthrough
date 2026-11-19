import { afterEach, describe, expect, it } from "vitest";
import { describeError, reportDiagnostic, setDiagnosticsReporter } from "./live-diagnostics";

afterEach(() => setDiagnosticsReporter(null));

describe("reportDiagnostic", () => {
  it("delivers to the current reporter", () => {
    const lines: string[] = [];
    setDiagnosticsReporter((d) => lines.push(d));
    reportDiagnostic("a");
    reportDiagnostic("b");
    expect(lines).toEqual(["a", "b"]);
  });
});

describe("describeError", () => {
  it("joins the message and the first frames on one line", () => {
    const error = new TypeError("x is not a function");
    error.stack =
      "TypeError: x is not a function\n    at draw (overlay.ts:10:3)\n    at paint (live.tsx:20:5)";
    expect(describeError(error)).toBe(
      "TypeError: x is not a function | at draw (overlay.ts:10:3) | at paint (live.tsx:20:5)",
    );
  });

  it("copes with things that are not errors", () => {
    expect(describeError("plain")).toBe("plain");
    expect(describeError({ code: 7 })).toBe('{"code":7}');
  });
});
