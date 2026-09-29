/**
 * A searchable index of every settings panel.
 *
 * <p>Settings are spread across five tabs, which means the thing you want
 * is usually behind a tab you are not looking at. Search fixes that only
 * if it can see across tabs, so the index is a hand-maintained list rather
 * than something derived from the rendered DOM: the DOM only ever contains
 * the active tab.
 *
 * <p>Keywords carry the words people actually search for, which are often
 * not the words on the control -- "dark mode" for Theme, "font size" for
 * Text size, "vibrate" for Haptics.
 */

import type { MessageKey } from "@/lib/i18n";

export type SettingsTabId =
  "profile" | "preferences" | "usability" | "notifications" | "subscription";

export interface SettingsEntry {
  /** DOM id of the panel to scroll to. */
  anchor: string;
  tab: SettingsTabId;
  titleKey: MessageKey;
  /** English search terms, matched in addition to the translated title. */
  keywords: string[];
}

export const SETTINGS_INDEX: SettingsEntry[] = [
  {
    anchor: "profile",
    tab: "profile",
    titleKey: "settings.tab.profile",
    keywords: ["name", "email", "position", "team", "avatar", "account", "sign out"],
  },
  {
    anchor: "training-defaults",
    tab: "preferences",
    titleKey: "settings.tab.preferences",
    keywords: ["session duration", "units", "metric", "imperial", "feet", "meters"],
  },
  {
    anchor: "analytics-defaults",
    tab: "preferences",
    titleKey: "settings.tab.preferences",
    keywords: ["default metric", "chart type", "trendlines", "dense tables"],
  },

  {
    anchor: "appearance",
    tab: "usability",
    titleKey: "usability.appearance",
    keywords: ["theme", "dark mode", "light mode", "contrast", "reading mode", "focus mode"],
  },
  {
    anchor: "text-and-spacing",
    tab: "usability",
    titleKey: "usability.textAndSpacing",
    keywords: ["text size", "font size", "zoom", "bigger", "density", "compact", "spacing"],
  },
  {
    anchor: "motion-and-media",
    tab: "usability",
    titleKey: "usability.motionAndMedia",
    keywords: ["animation", "reduce motion", "autoplay", "video"],
  },
  {
    anchor: "captions",
    tab: "usability",
    titleKey: "usability.captions",
    keywords: ["captions", "subtitles", "cc", "caption size", "caption colour"],
  },
  {
    anchor: "feedback",
    tab: "usability",
    titleKey: "usability.feedback",
    keywords: ["sound", "volume", "haptics", "vibrate", "toast", "notification duration"],
  },
  {
    anchor: "safety",
    tab: "usability",
    titleKey: "usability.safety",
    keywords: ["undo", "confirm", "confirmation dialog", "drafts", "auto-save"],
  },
  {
    anchor: "navigation",
    tab: "usability",
    titleKey: "usability.navigation",
    keywords: ["focus", "screen reader", "announce", "route change", "keyboard"],
  },
  {
    anchor: "session",
    tab: "usability",
    titleKey: "usability.session",
    keywords: ["timeout", "inactivity", "sign out", "session expiry", "idle"],
  },
  {
    anchor: "language",
    tab: "usability",
    titleKey: "usability.language",
    keywords: [
      "language",
      "locale",
      "region",
      "date format",
      "time zone",
      "24 hour",
      "first day of week",
    ],
  },
  {
    anchor: "shortcuts",
    tab: "usability",
    titleKey: "usability.shortcuts",
    keywords: ["keyboard", "shortcut", "hotkey", "key binding", "command palette"],
  },

  {
    anchor: "notification-types",
    tab: "notifications",
    titleKey: "settings.tab.notifications",
    keywords: ["reminders", "session complete", "digest", "missed session", "alerts"],
  },
  {
    anchor: "notification-delivery",
    tab: "notifications",
    titleKey: "notifications.delivery",
    keywords: ["quiet hours", "snooze", "do not disturb", "digest frequency", "history"],
  },

  {
    anchor: "usage",
    tab: "subscription",
    titleKey: "settings.tab.subscription",
    keywords: ["usage", "storage", "limits", "videos processed"],
  },
  {
    anchor: "plans",
    tab: "subscription",
    titleKey: "settings.tab.subscription",
    keywords: ["plan", "billing", "upgrade", "tier", "free", "premium", "price"],
  },
];

/** Case- and accent-insensitive substring match over title and keywords. */
export function searchSettings(
  query: string,
  translate: (key: MessageKey) => string,
): SettingsEntry[] {
  const needle = fold(query);
  if (needle.length === 0) return [];
  return SETTINGS_INDEX.filter((entry) => {
    if (fold(translate(entry.titleKey)).includes(needle)) return true;
    return entry.keywords.some((keyword) => fold(keyword).includes(needle));
  });
}

/** Lowercases and strips diacritics, so "sesion" finds "sesión". */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
