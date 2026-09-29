import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Standards for user-facing copy, enforced across the app.
 *
 * <p>The brief asks for empty, loading and error states written as
 * direction — never vague, apologetic, or written in the language of the
 * implementation. Those rules are easy to agree with and easy to drift
 * from one component at a time, which is what this guards.
 *
 * <p>It reads the source rather than rendering, so it covers every screen
 * including ones with no test of their own.
 */

const SRC = fileURLToPath(new URL("./", import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // ui/ is vendored shadcn; its copy is not ours to police.
      if (entry !== "ui" && entry !== "mocks") sourceFiles(path, out);
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC);

/** title="..." / message="..." literals, which is where state copy lives. */
function copyStrings(source: string): string[] {
  return [...source.matchAll(/(?:title|message|description)="([^"]{4,})"/g)].map((m) => m[1]!);
}

/**
 * The English message catalogue, parsed from source.
 *
 * <p>It holds most of the app's user-facing text and lives in a `.ts`
 * file, so the JSX scan above misses it entirely — which is how an error
 * string naming an internal service survived the sweep of every screen.
 */
function catalogueStrings(): [string, string][] {
  const source = readFileSync(join(SRC, "lib/i18n.ts"), "utf8");
  const start = source.indexOf("const en = {");
  const end = source.indexOf("} as const;", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/"([\w.]+)":\s*\n?\s*"([^"]+)"/g)].map((m) => [m[1]!, m[2]!]);
}

describe("message catalogue", () => {
  it("finds the catalogue", () => {
    expect(catalogueStrings().length).toBeGreaterThan(100);
  });

  it("never names an internal service", () => {
    const banned =
      /\b(service|endpoint|API|backend|server)\b.*(didn't|did not|failed|unavailable)/i;
    for (const [key, text] of catalogueStrings()) {
      expect(banned.test(text), `${key}: ${text}`).toBe(false);
    }
  });

  it("does not apologise", () => {
    const banned = /\b(sorry|oops|whoops|unfortunately)\b/i;
    for (const [key, text] of catalogueStrings()) {
      expect(banned.test(text), `${key}: ${text}`).toBe(false);
    }
  });
});

describe("user-facing copy", () => {
  it("finds copy to check", () => {
    // Guards the guard: a regex that matches nothing would pass silently.
    const all = FILES.flatMap((f) => copyStrings(readFileSync(f, "utf8")));
    expect(all.length).toBeGreaterThan(20);
  });

  it("never names an internal service", () => {
    // "The analytics service didn't respond" is a log line. It tells the
    // person nothing they can act on and leaks the architecture.
    const banned =
      /\b(service|endpoint|API|backend|server|pipeline service)\b.*(didn't|did not|failed|unavailable)/i;
    for (const file of FILES) {
      for (const line of copyStrings(readFileSync(file, "utf8"))) {
        expect(banned.test(line), `${file}: ${line}`).toBe(false);
      }
    }
  });

  it("does not apologise", () => {
    const banned = /\b(sorry|oops|whoops|uh[- ]oh|unfortunately)\b/i;
    for (const file of FILES) {
      for (const line of copyStrings(readFileSync(file, "utf8"))) {
        expect(banned.test(line), `${file}: ${line}`).toBe(false);
      }
    }
  });

  it("does not shout", () => {
    // All-caps survives only in the box score's column heads, which are
    // written inline rather than as title/message copy. Genuine acronyms
    // are not shouting -- "NCAA three" is the name of the thing.
    const ACRONYMS = new Set(["NCAA", "FIBA", "WNBA", "WCAG"]);
    for (const file of FILES) {
      for (const line of copyStrings(readFileSync(file, "utf8"))) {
        const shouted = line
          .split(/\s+/)
          .map((w) => w.replace(/[^A-Za-z]/g, ""))
          .filter((w) => /^[A-Z]{4,}$/.test(w) && !ACRONYMS.has(w));
        expect(shouted, `${file}: ${line}`).toEqual([]);
      }
    }
  });

  it("ends a message with a full stop", () => {
    // A message is a sentence; a title is a label. Mixing them reads as
    // sloppy at a glance even when the words are right.
    for (const file of FILES) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/message="([^"]{8,})"/g)) {
        const text = m[1]!;
        if (text.includes("{")) continue; // interpolated, checked where built
        expect(/[.!?]$/.test(text), `${file}: ${text}`).toBe(true);
      }
    }
  });
});
