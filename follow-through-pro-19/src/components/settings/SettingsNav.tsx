import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { SettingsTabId } from "@/lib/settings-index";

/**
 * The section switcher, as a scoreboard strip.
 *
 * <p>Still Radix `Tabs` underneath -- roving focus, arrow keys and the
 * tab/panel wiring are all load-bearing and there is no reason to
 * reimplement them. What changes is that a tab is a solid segment rather
 * than a word: the active one is filled with its section's hue and the
 * whole strip sits on one dark rail, so the page always states where you
 * are instead of underlining it faintly.
 *
 * <p>It scrolls horizontally rather than wrapping. Five segments will not
 * fit across a phone, and a nav that reflows to two rows moves the
 * content below it every time the label lengths change with the locale.
 */
export function SettingsNav({
  tabs,
  active,
  className,
}: {
  tabs: { id: SettingsTabId; label: string; icon: LucideIcon }[];
  active: SettingsTabId;
  /** Lets the caller place the rail in a row beside something else. */
  className?: string | undefined;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  // On a phone the strip is wider than the screen, so arriving on
  // /settings?tab=subscription would show four tabs and leave the one you
  // are actually on off the right edge. Scrolls the rail, not the page --
  // scrollIntoView would drag the whole document sideways.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[data-state="active"]');
    if (!list || !current) return;
    const overshootRight =
      current.offsetLeft + current.offsetWidth - (list.scrollLeft + list.clientWidth);
    const overshootLeft = list.scrollLeft - current.offsetLeft;
    if (overshootRight > 0) list.scrollLeft += overshootRight + 8;
    else if (overshootLeft > 0) list.scrollLeft -= overshootLeft + 8;
  }, [active]);

  return (
    <TabsList
      ref={listRef}
      className={cn(
        "flex h-auto w-full min-w-0 justify-start gap-1 overflow-x-auto rounded-md bg-surface p-1",
        // The scrollbar would sit under the segments and clip the active
        // fill; the strip is short enough to swipe.
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {tabs.map(({ id, label, icon: Icon }) => (
        <TabsTrigger
          key={id}
          value={id}
          className={cn(
            "group relative shrink-0 gap-2 rounded-sm px-3 py-2 text-sm font-medium",
            "text-muted-foreground transition-colors hover:text-foreground",
            "data-[state=active]:bg-[var(--sec)] data-[state=active]:text-[var(--sec-on)]",
            "data-[state=active]:shadow-none",
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
