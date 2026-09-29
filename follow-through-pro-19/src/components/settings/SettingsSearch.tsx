import { Search } from "lucide-react";
import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchSettings, type SettingsEntry, type SettingsTabId } from "@/lib/settings-index";
import { useT } from "@/state/settings-provider";

/**
 * Cross-tab settings search.
 *
 * <p>Results are links, not filters. Filtering the current tab would only
 * ever find what is already on screen; the problem being solved is that
 * the setting you want is behind a tab you are not on, so a result has to
 * be able to switch tabs and take you to the panel.
 *
 * <p>Implemented as a listbox rather than a datalist so the results can
 * show which tab each one lives in -- knowing that "Captions" is under
 * Usability is half the answer.
 */
export function SettingsSearch({
  onJump,
}: {
  onJump: (tab: SettingsTabId, anchor: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const listId = useId();
  const results: SettingsEntry[] = searchSettings(query, t);

  const TAB_LABEL: Record<SettingsTabId, string> = {
    profile: t("settings.tab.profile"),
    preferences: t("settings.tab.preferences"),
    usability: t("settings.tab.usability"),
    notifications: t("settings.tab.notifications"),
    subscription: t("settings.tab.subscription"),
  };

  return (
    <div className="relative w-full sm:w-64 sm:shrink-0">
      <Label htmlFor={`${listId}-input`} className="sr-only">
        {t("settings.searchLabel")}
      </Label>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={query.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={t("settings.searchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="pl-8"
      />

      {query.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("settings.searchLabel")}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">
              {t("common.noResults")}
            </li>
          ) : (
            results.map((entry) => (
              <li key={`${entry.tab}-${entry.anchor}`} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => {
                    setQuery("");
                    onJump(entry.tab, entry.anchor);
                  }}
                >
                  <span className="truncate">{t(entry.titleKey)}</span>
                  <span className="label-caps shrink-0">{TAB_LABEL[entry.tab]}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
