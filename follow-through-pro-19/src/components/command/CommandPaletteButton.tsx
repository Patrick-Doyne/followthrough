import { Search } from "lucide-react";

import { formatCombo } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useCommands } from "@/state/commands";
import { useT } from "@/state/settings-provider";

/**
 * Visible entry point to the command palette.
 *
 * <p>A palette reachable only by a keystroke is invisible to everyone who
 * does not already know it exists, which is most people. The button shows
 * the binding next to it, so using the mouse once teaches the shortcut.
 */
export function CommandPaletteButton({ compact = false }: { compact?: boolean }) {
  const { setPaletteOpen, bindings } = useCommands();
  const t = useT();
  const combo = bindings.get("palette.open");

  return (
    /*
     * Shaped like the field it stands in for, not like an icon button.
     *
     * <p>It opens a dialog, so it is a button and not an input -- but
     * an icon in a corner is the one thing nobody clicks. Wearing the
     * shape of a search field is what makes it read as "you can search
     * from here", and it is the same shape the settings search has.
     */
    <button
      type="button"
      onClick={() => setPaletteOpen(true)}
      aria-label={t("palette.open")}
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border border-border bg-surface/60 px-2.5 text-left",
        "text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        // The compact form is icon-only at every width: it is the one
        // shown while the sidebar is collapsed, where the bar already
        // carries the menu button, the wordmark, the bell and the
        // account and has no room for a field.
        compact ? "w-9 justify-center" : "w-64 justify-start",
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      {compact ? null : (
        <>
          {/* One word, not the aria label. "Open command palette" is what
          the control does and belongs to the screen reader; it does
          not fit a field, and every locale's version of it is longer
          still. The field's own shape says the rest. */}
          <span className="flex-1 truncate text-sm">{t("common.search")}</span>
          {combo ? (
            <kbd className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.6875rem]">
              {formatCombo(combo)}
            </kbd>
          ) : null}
        </>
      )}
    </button>
  );
}
