import { RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { COMMANDS, eventCombo, findConflict, formatCombo } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useCommands } from "@/state/commands";
import { useSettings, useT } from "@/state/settings-provider";

/**
 * Rebindable keyboard shortcuts.
 *
 * <p>Bindings are recorded by pressing the combination rather than typed
 * into a text field, because a text field requires knowing the app's
 * spelling for every key and silently accepts combinations the browser
 * will never deliver. Recording also lets conflicts be reported against
 * the exact keystroke.
 *
 * <p>A conflicting binding is refused rather than silently stealing the
 * other command's keys, and the message names which command already owns
 * it so the person can go and change that one instead.
 */
export function ShortcutEditor() {
  const { settings, update } = useSettings();
  const { bindings } = useCommands();
  const t = useT();
  const [recording, setRecording] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ id: string; with: string } | null>(null);

  const stop = useCallback(() => setRecording(null), []);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // Capture phase and preventDefault, or recording "mod+k" would open
      // the palette instead of being recorded.
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        stop();
        return;
      }
      const combo = eventCombo(event);
      if (!combo) return; // A modifier on its own is not a binding yet.

      const clash = findConflict(bindings, combo, recording);
      if (clash) {
        setConflict({ id: recording, with: clash });
        return;
      }
      update({ shortcuts: { ...settings.shortcuts, [recording]: combo } });
      setConflict(null);
      stop();
    };

    addEventListener("keydown", onKeyDown, { capture: true });
    return () => removeEventListener("keydown", onKeyDown, { capture: true });
  }, [recording, bindings, settings.shortcuts, update, stop]);

  const clearOverride = (id: string) => {
    const next = { ...settings.shortcuts };
    delete next[id];
    update({ shortcuts: next });
  };

  /** An explicit empty string means "deliberately unbound", which is
   * different from having no override and therefore using the default. */
  const unbind = (id: string) => update({ shortcuts: { ...settings.shortcuts, [id]: "" } });

  return (
    <ul className="field-row divide-y divide-border">
      {COMMANDS.map((command) => {
        const combo = bindings.get(command.id) ?? null;
        const isRecording = recording === command.id;
        const overridden = settings.shortcuts[command.id] !== undefined;
        const clash = conflict?.id === command.id ? conflict.with : null;

        return (
          <li key={command.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm">{t(command.titleKey)}</p>
              {clash ? (
                <p className="mt-0.5 text-xs text-destructive">
                  {t("usability.shortcutConflict", {
                    command: t(COMMANDS.find((c) => c.id === clash)?.titleKey ?? command.titleKey),
                  })}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setConflict(null);
                  setRecording(isRecording ? null : command.id);
                }}
                aria-label={`${t(command.titleKey)} — ${combo ? formatCombo(combo) : t("usability.shortcutRecording")}`}
                className={cn(
                  "min-w-20 rounded-sm border px-2 py-1 font-mono text-xs transition-colors",
                  isRecording
                    ? "animate-pulse border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted hover:border-primary/50",
                )}
              >
                {isRecording ? t("usability.shortcutRecording") : combo ? formatCombo(combo) : "—"}
              </button>

              {combo ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => unbind(command.id)}
                  aria-label={`${t("common.delete")} — ${t(command.titleKey)}`}
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              ) : null}

              {overridden ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => clearOverride(command.id)}
                  aria-label={`${t("usability.shortcutReset")} — ${t(command.titleKey)}`}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
