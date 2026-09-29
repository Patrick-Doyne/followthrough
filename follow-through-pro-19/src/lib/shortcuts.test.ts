import { describe, expect, it } from "vitest";

import { createTranslate, resolveLanguage } from "@/lib/i18n";
import { resolveFormatConfig } from "@/lib/intl";
import { searchSettings } from "@/lib/settings-index";
import {
  COMMANDS,
  eventCombo,
  findConflict,
  formatCombo,
  normalizeCombo,
  resolveBindings,
} from "@/lib/shortcuts";
import { DEFAULT_SETTINGS } from "@/state/settings";

/** Minimal stand-in for the fields eventCombo reads. */
function keyEvent(
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
): KeyboardEvent {
  return {
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
  } as KeyboardEvent;
}

describe("eventCombo", () => {
  it("normalises Ctrl and Cmd to the same binding", () => {
    // One stored binding has to work on both platforms, or every shortcut
    // would need recording twice.
    expect(eventCombo(keyEvent("k", { meta: true }))).toBe("mod+k");
    expect(eventCombo(keyEvent("k", { ctrl: true }))).toBe("mod+k");
  });

  it("orders modifiers consistently regardless of which are held", () => {
    expect(eventCombo(keyEvent("K", { meta: true, shift: true, alt: true }))).toBe(
      "mod+alt+shift+k",
    );
  });

  it("returns null for a lone modifier", () => {
    // Otherwise holding Shift while reaching for a key would immediately
    // "record" Shift as the binding.
    for (const key of ["Shift", "Control", "Alt", "Meta"]) {
      expect(eventCombo(keyEvent(key, { shift: true }))).toBeNull();
    }
  });

  it("gives space and plus stable names", () => {
    expect(eventCombo(keyEvent(" ", { alt: true }))).toBe("alt+space");
    expect(eventCombo(keyEvent("+", { alt: true }))).toBe("alt+=");
  });

  it("is case-insensitive on letters", () => {
    expect(eventCombo(keyEvent("T", { alt: true }))).toBe("alt+t");
    expect(eventCombo(keyEvent("t", { alt: true }))).toBe("alt+t");
  });
});

describe("normalizeCombo", () => {
  it("accepts the aliases people actually write", () => {
    for (const written of ["Cmd+K", "ctrl + k", "META+k", "mod+k", "Control+K"]) {
      expect(normalizeCombo(written), written).toBe("mod+k");
    }
    expect(normalizeCombo("option+1")).toBe("alt+1");
  });

  it("rejects a combo that is only modifiers, or has an unknown one", () => {
    expect(normalizeCombo("mod+shift")).toBeNull();
    expect(normalizeCombo("")).toBeNull();
    expect(normalizeCombo("hyper+k")).toBeNull();
  });
});

describe("formatCombo", () => {
  it("uses platform-appropriate symbols", () => {
    expect(formatCombo("mod+shift+k", true)).toBe("⌘⇧K");
    expect(formatCombo("mod+shift+k", false)).toBe("Ctrl+Shift+K");
  });

  it("names non-printing keys rather than showing them raw", () => {
    expect(formatCombo("alt+arrowup", false)).toBe("Alt+↑");
    expect(formatCombo("alt+=", false)).toBe("Alt++");
  });
});

describe("resolveBindings", () => {
  it("uses each command's default when there are no overrides", () => {
    const bindings = resolveBindings({});
    expect(bindings.get("palette.open")).toBe("mod+k");
    expect(bindings.get("nav.dashboard")).toBe("alt+1");
    // A command with no default is simply absent, not bound to "".
    expect(bindings.has("notifications.snooze")).toBe(false);
  });

  it("applies an override and leaves the rest on their defaults", () => {
    const bindings = resolveBindings({ "nav.live": "Cmd+Shift+L" });
    expect(bindings.get("nav.live")).toBe("mod+shift+l");
    expect(bindings.get("nav.dashboard")).toBe("alt+1");
  });

  it("treats an empty override as deliberately unbound", () => {
    // Different from having no override at all, which means "use the
    // default". Without the distinction, clearing a binding would be
    // impossible -- it would just come back.
    const bindings = resolveBindings({ "nav.live": "" });
    expect(bindings.has("nav.live")).toBe(false);
    expect(bindings.get("nav.dashboard")).toBe("alt+1");
  });

  it("normalises the hand-written defaults", () => {
    // An un-normalised default never matches a real keypress, because
    // eventCombo lowercases everything. Silent, and only visible as a
    // shortcut that does nothing.
    const bindings = resolveBindings({});
    for (const command of COMMANDS) {
      if (!command.defaultCombo) continue;
      const resolved = bindings.get(command.id);
      expect(resolved, command.id).toBe(normalizeCombo(command.defaultCombo));
      expect(resolved, `${command.id} must already be normalised`).toBe(
        resolved ? normalizeCombo(resolved) : resolved,
      );
    }
  });

  it("ships a newly added command working, despite an older stored map", () => {
    // Only overrides are persisted, so a stored map written before a
    // command existed cannot leave that command dead.
    const stored = { "nav.live": "alt+9" };
    const bindings = resolveBindings(stored);
    for (const command of COMMANDS) {
      if (command.defaultCombo && !(command.id in stored)) {
        expect(bindings.get(command.id), command.id).toBe(normalizeCombo(command.defaultCombo));
      }
    }
  });

  it("has no duplicate default bindings", () => {
    // A shipped conflict would make one of the two commands unreachable.
    const seen = new Map<string, string>();
    for (const command of COMMANDS) {
      if (!command.defaultCombo) continue;
      const combo = normalizeCombo(command.defaultCombo)!;
      expect(seen.has(combo), `${combo} is bound twice`).toBe(false);
      seen.set(combo, command.id);
    }
  });
});

describe("findConflict", () => {
  it("names the command already holding a combo, ignoring the one being edited", () => {
    const bindings = resolveBindings({});
    expect(findConflict(bindings, "alt+1", "nav.live")).toBe("nav.dashboard");
    expect(findConflict(bindings, "alt+1", "nav.dashboard")).toBeNull();
    expect(findConflict(bindings, "alt+0", "nav.live")).toBeNull();
  });
});

describe("resolveLanguage", () => {
  it("returns an explicit choice unchanged", () => {
    expect(resolveLanguage("es")).toBe("es");
    expect(resolveLanguage("de")).toBe("de");
  });
});

describe("createTranslate", () => {
  it("falls back to English for an untranslated key", () => {
    // The fallback is what lets translations ship incrementally without
    // ever rendering a raw key at someone.
    const t = createTranslate("fr");
    expect(t("nav.dashboard")).toBe("Tableau de bord");
    expect(t("usability.hapticsHint")).toBe(createTranslate("en")("usability.hapticsHint"));
  });

  it("interpolates named placeholders", () => {
    const t = createTranslate("en");
    expect(t("usability.sessionExpiringBody", { seconds: 30 })).toContain("30");
  });

  it("leaves an unknown placeholder in place rather than printing undefined", () => {
    const t = createTranslate("en");
    expect(t("usability.themeFollowing", {})).toContain("{theme}");
  });
});

describe("resolveFormatConfig", () => {
  it("maps an explicit region straight through", () => {
    const config = resolveFormatConfig({ ...DEFAULT_SETTINGS, regionFormat: "en-GB" });
    expect(config.locale).toBe("en-GB");
  });

  it("honours an explicit first day of week over the region's", () => {
    const sunday = resolveFormatConfig({
      ...DEFAULT_SETTINGS,
      regionFormat: "de-DE",
      firstDayOfWeek: "sunday",
    });
    expect(sunday.firstDayOfWeek).toBe(0);
    const saturday = resolveFormatConfig({
      ...DEFAULT_SETTINGS,
      regionFormat: "en-US",
      firstDayOfWeek: "saturday",
    });
    expect(saturday.firstDayOfWeek).toBe(6);
  });

  it("derives the first day from the region when asked to", () => {
    // 0 = Sunday, 1 = Monday. The US starts on Sunday, Germany on Monday.
    expect(
      resolveFormatConfig({ ...DEFAULT_SETTINGS, regionFormat: "en-US", firstDayOfWeek: "region" })
        .firstDayOfWeek,
    ).toBe(0);
    expect(
      resolveFormatConfig({ ...DEFAULT_SETTINGS, regionFormat: "de-DE", firstDayOfWeek: "region" })
        .firstDayOfWeek,
    ).toBe(1);
  });

  it("maps the clock choice to Intl's hour12 flag", () => {
    expect(resolveFormatConfig({ ...DEFAULT_SETTINGS, hourCycle: "h12" }).hour12).toBe(true);
    expect(resolveFormatConfig({ ...DEFAULT_SETTINGS, hourCycle: "h23" }).hour12).toBe(false);
    // "region" must stay undefined so the locale's own preference wins.
    expect(
      resolveFormatConfig({ ...DEFAULT_SETTINGS, hourCycle: "region" }).hour12,
    ).toBeUndefined();
  });

  it("passes no time zone through when following the device", () => {
    expect(
      resolveFormatConfig({ ...DEFAULT_SETTINGS, timeZone: "system" }).timeZone,
    ).toBeUndefined();
    expect(resolveFormatConfig({ ...DEFAULT_SETTINGS, timeZone: "Asia/Tokyo" }).timeZone).toBe(
      "Asia/Tokyo",
    );
  });
});

describe("searchSettings", () => {
  const t = createTranslate("en");

  it("finds a panel by a keyword that is not its title", () => {
    // "dark mode" appears nowhere in the Appearance panel's title, but it
    // is what people type.
    const results = searchSettings("dark mode", t);
    expect(results.map((entry) => entry.anchor)).toContain("appearance");
  });

  it("searches across tabs, not just the active one", () => {
    const tabs = new Set(searchSettings("e", t).map((entry) => entry.tab));
    expect(tabs.size).toBeGreaterThan(1);
  });

  it("ignores case and diacritics", () => {
    const withAccent = searchSettings("sesión", createTranslate("es"));
    const plain = searchSettings("SESION", createTranslate("es"));
    expect(plain.map((e) => e.anchor)).toEqual(withAccent.map((e) => e.anchor));
    expect(plain.length).toBeGreaterThan(0);
  });

  it("returns nothing for an empty query", () => {
    expect(searchSettings("", t)).toEqual([]);
    expect(searchSettings("   ", t).length).toBe(0);
  });

  it("points every entry at a tab the settings page actually has", () => {
    const tabs = ["profile", "preferences", "usability", "notifications", "subscription"];
    for (const entry of searchSettings("e", t)) {
      expect(tabs).toContain(entry.tab);
    }
  });
});

describe("correction bindings", () => {
  it("binds the correction keys as bare letters", () => {
    // Deliberate: on the live screen the hands are on the keyboard between
    // shots, and a modifier would make fixing a run of attempts slower
    // than leaving them until afterwards.
    const bindings = resolveBindings({});
    expect(bindings.get("shots.markMade")).toBe("m");
    expect(bindings.get("shots.markMissed")).toBe("x");
    expect(bindings.get("shots.markNotAShot")).toBe("delete");
  });

  it("keeps the correction keys clear of every other binding", () => {
    // They are bare letters, so a collision would make an ordinary key
    // unusable across the whole app.
    const bindings = resolveBindings({});
    for (const id of ["shots.markMade", "shots.markMissed", "shots.markNotAShot"]) {
      const combo = bindings.get(id)!;
      expect(findConflict(bindings, combo, id), `${id} (${combo})`).toBeNull();
    }
  });
});
