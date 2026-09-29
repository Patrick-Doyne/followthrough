import { Keyboard } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCombo, isTypingTarget } from "@/lib/shortcuts";
import { useCommands } from "@/state/commands";
import { useT } from "@/state/settings-provider";

/**
 * The "?" sheet: every shortcut in one place.
 *
 * <p>Reads the live bindings rather than a hard-coded list, so a rebound
 * shortcut is shown as it actually is. A printed list that drifts from the
 * real bindings is worse than none.
 */
export function ShortcutSheet() {
  const [open, setOpen] = useState(false);
  const { commands } = useCommands();
  const t = useT();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || isTypingTarget(event.target)) return;
      event.preventDefault();
      setOpen((previous) => !previous);
    };
    addEventListener("keydown", onKeyDown);
    return () => removeEventListener("keydown", onKeyDown);
  }, []);

  const bound = commands.filter((command) => command.combo !== null);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Keyboard shortcuts"
      >
        <Keyboard className="size-4" aria-hidden />
        <kbd className="hidden rounded-sm border border-border bg-muted px-1.5 font-mono text-[0.6875rem] sm:inline">
          ?
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Change any of these under Settings, Usability.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border">
            <Row label="Start or end a session" combo="Space" />
            <Row label="Show this list" combo="?" />
            {bound.map((command) => (
              <Row
                key={command.id}
                label={t(command.titleKey)}
                combo={formatCombo(command.combo as string)}
              />
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, combo }: { label: string; combo: string }) {
  return (
    <li className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="min-w-0 truncate">{label}</span>
      <kbd className="shrink-0 rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
        {combo}
      </kbd>
    </li>
  );
}
