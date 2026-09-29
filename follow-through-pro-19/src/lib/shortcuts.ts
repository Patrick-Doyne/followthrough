/**
 * The command registry and keyboard-combo handling.
 *
 * <p>Pure: this module knows what commands exist and how to turn a
 * `KeyboardEvent` into a comparable string, but nothing about React, the
 * router, or what any command actually does. Those are bound in
 * state/commands.tsx, which keeps this testable and keeps the list of
 * commands readable as a list.
 *
 * <p>Only *overrides* are persisted (`settings.shortcuts`), never the whole
 * map. A command added in a later release therefore ships with its default
 * binding working, instead of being dead for everyone whose stored map
 * predates it.
 */

import type { MessageKey } from "@/lib/i18n";

export type CommandGroup = "navigate" | "actions" | "appearance";

export interface CommandDef {
  id: string;
  titleKey: MessageKey;
  group: CommandGroup;
  /** Canonical combo, or null for a command reachable only by the palette. */
  defaultCombo: string | null;
  /** Extra English search terms, so the palette finds a command by what it
   * does as well as by what it is called. */
  keywords?: string[];
}

/**
 * Bindings avoid Ctrl/Cmd + a bare letter except for the palette itself,
 * because the browser owns most of that space (Cmd+D, Cmd+L, Cmd+T...) and
 * stealing it is worse than an extra modifier. Alt-based combos are almost
 * entirely free in every browser.
 */
export const COMMANDS: CommandDef[] = [
  { id: "palette.open", titleKey: "palette.open", group: "actions", defaultCombo: "mod+k" },

  { id: "nav.dashboard", titleKey: "nav.dashboard", group: "navigate", defaultCombo: "alt+1" },
  { id: "nav.live", titleKey: "nav.live", group: "navigate", defaultCombo: "alt+2" },
  { id: "nav.analytics", titleKey: "nav.analytics", group: "navigate", defaultCombo: "alt+3" },
  { id: "nav.videos", titleKey: "nav.videos", group: "navigate", defaultCombo: "alt+4" },
  { id: "nav.calendar", titleKey: "nav.calendar", group: "navigate", defaultCombo: "alt+5" },
  { id: "nav.settings", titleKey: "nav.settings", group: "navigate", defaultCombo: "alt+6" },

  {
    id: "appearance.toggleTheme",
    titleKey: "usability.theme",
    group: "appearance",
    defaultCombo: "alt+t",
    keywords: ["dark", "light", "theme"],
  },
  {
    id: "appearance.toggleContrast",
    titleKey: "usability.highContrast",
    group: "appearance",
    defaultCombo: "alt+h",
    keywords: ["contrast", "accessibility"],
  },
  {
    id: "appearance.toggleReading",
    titleKey: "usability.readingMode",
    group: "appearance",
    defaultCombo: "alt+r",
    keywords: ["focus", "reading", "distraction"],
  },
  {
    id: "appearance.textLarger",
    titleKey: "usability.textSize",
    group: "appearance",
    defaultCombo: "alt+=",
    keywords: ["bigger", "zoom", "text size increase"],
  },
  {
    id: "appearance.textSmaller",
    titleKey: "usability.textSize",
    group: "appearance",
    defaultCombo: "alt+-",
    keywords: ["smaller", "zoom out", "text size decrease"],
  },
  {
    id: "notifications.open",
    titleKey: "notifications.open",
    group: "actions",
    defaultCombo: "alt+n",
    keywords: ["alerts", "history", "inbox"],
  },
  // Bound to bare letters on purpose: they only fire on the live screen,
  // where the hands are on the keyboard between shots and a modifier would
  // make correcting a run of attempts slower than fixing them afterwards.
  {
    id: "shots.markMade",
    titleKey: "shots.markMade",
    group: "actions",
    defaultCombo: "m",
    keywords: ["correct", "make", "made", "fix"],
  },
  {
    id: "shots.markMissed",
    titleKey: "shots.markMissed",
    group: "actions",
    defaultCombo: "x",
    keywords: ["correct", "miss", "missed", "fix"],
  },
  {
    id: "shots.markNotAShot",
    titleKey: "shots.markNotAShot",
    group: "actions",
    defaultCombo: "Delete",
    keywords: ["false positive", "remove", "delete", "not a shot"],
  },
  {
    id: "notifications.snooze",
    titleKey: "notifications.snooze",
    group: "actions",
    defaultCombo: null,
    keywords: ["mute", "quiet", "pause"],
  },
];

export const COMMANDS_BY_ID: Record<string, CommandDef> = Object.fromEntries(
  COMMANDS.map((command) => [command.id, command]),
);

const MOD_ORDER = ["mod", "alt", "shift"] as const;

/** Whether "mod" means Cmd (Apple) or Ctrl (everything else). */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/**
 * Canonical string for a keyboard event, e.g. "mod+shift+k".
 *
 * <p>Ctrl and Cmd both normalise to "mod" so one stored binding works on
 * every platform. Returns null for a lone modifier press, which matters
 * while recording a new binding -- otherwise holding Shift would
 * immediately "record" Shift as the shortcut.
 */
export function eventCombo(event: KeyboardEvent): string | null {
  const key = event.key;
  if (key === "Control" || key === "Meta" || key === "Alt" || key === "Shift") return null;

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(normalizeKey(key));
  return parts.join("+");
}

function normalizeKey(key: string): string {
  if (key === " ") return "space";
  if (key === "+") return "=";
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

/** Parses a stored combo, tolerating whitespace and modifier aliases. */
export function normalizeCombo(combo: string): string | null {
  const raw = combo
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (raw.length === 0) return null;

  const key = raw[raw.length - 1];
  if (key === undefined || MOD_ORDER.includes(key as (typeof MOD_ORDER)[number])) return null;

  const mods = new Set<string>();
  for (const part of raw.slice(0, -1)) {
    if (
      part === "cmd" ||
      part === "meta" ||
      part === "ctrl" ||
      part === "control" ||
      part === "mod"
    )
      mods.add("mod");
    else if (part === "alt" || part === "option") mods.add("alt");
    else if (part === "shift") mods.add("shift");
    else return null;
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), normalizeKey(key)].join("+");
}

const KEY_LABEL: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "↵",
  escape: "Esc",
  space: "Space",
  "=": "+",
};

/** Human-readable combo for display, using platform-correct symbols. */
export function formatCombo(combo: string, apple = isApplePlatform()): string {
  const parts = combo.split("+");
  const key = parts[parts.length - 1] ?? "";
  const mods = parts.slice(0, -1);
  const out: string[] = [];
  if (mods.includes("mod")) out.push(apple ? "⌘" : "Ctrl");
  if (mods.includes("alt")) out.push(apple ? "⌥" : "Alt");
  if (mods.includes("shift")) out.push(apple ? "⇧" : "Shift");
  out.push(KEY_LABEL[key] ?? (key.length === 1 ? key.toUpperCase() : titleiseKey(key)));
  return apple ? out.join("") : out.join("+");
}

function titleiseKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * The effective binding for every command: its default, unless an override
 * is stored. An override of "" means the person cleared the binding, which
 * is different from having no override at all.
 */
export function resolveBindings(overrides: Record<string, string>): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const command of COMMANDS) {
    const override = overrides[command.id];
    // Defaults are normalised too. They are written by hand in COMMANDS
    // above, and an un-normalised one ("Delete" rather than "delete")
    // silently never matches, because eventCombo always lowercases. Every
    // default happened to be lowercase already, so this went unnoticed
    // until the first capitalised key name was added.
    const combo =
      override !== undefined
        ? normalizeCombo(override)
        : command.defaultCombo
          ? normalizeCombo(command.defaultCombo)
          : null;
    if (combo) bindings.set(command.id, combo);
  }
  return bindings;
}

/** Command id currently bound to `combo`, ignoring `exceptId`. */
export function findConflict(
  bindings: Map<string, string>,
  combo: string,
  exceptId: string,
): string | null {
  for (const [id, bound] of bindings) {
    if (id !== exceptId && bound === combo) return id;
  }
  return null;
}

/**
 * Whether a keystroke in this target should be ignored.
 *
 * <p>Typing "alt+1" inside a text field must insert a character rather than
 * navigate. The palette's own binding is exempt: being able to reach it
 * from a search box is the point of a command palette.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // Radix combobox/listbox surfaces are not form elements but are
  // keyboard-driven and own their arrow and letter keys.
  return target.closest('[role="combobox"],[role="listbox"],[role="menu"]') !== null;
}
