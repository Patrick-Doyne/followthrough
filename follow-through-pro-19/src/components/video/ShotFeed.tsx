import { Check, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ResultBadge } from "@/components/common/ResultBadge";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import type { LiveShot } from "@/hooks/use-live-score";
import type { ShotCorrectionsApi } from "@/hooks/use-shot-corrections";
import { fmtShotType } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCommands } from "@/state/commands";

/**
 * The live shot list, with correction.
 *
 * <p>Selection is what makes the keyboard layer unambiguous: M, X and
 * Delete act on the selected shot, and the newest shot is selected
 * automatically so the common case — fixing the attempt that just happened
 * — needs no selection at all.
 *
 * <p>Rows are buttons rather than list items with click handlers, so they
 * are reachable and operable from the keyboard without any ARIA.
 */
export function ShotFeed({
  shots,
  corrections,
  active,
  onHintShortcut,
}: {
  shots: LiveShot[];
  corrections: ShotCorrectionsApi;
  active: boolean;
  /** Called when someone corrects by clicking, so the UI can mention the
   * keyboard equivalent once. */
  onHintShortcut?: () => void;
}) {
  const { registerCommand } = useCommands();
  const newest = shots[0]?.sequence ?? null;
  const [selected, setSelected] = useState<number | null>(null);
  const effective = selected ?? newest;

  // Following the newest shot keeps the keyboard useful without anyone
  // having to select anything, but only until a deliberate selection is
  // made -- moving the target out from under someone mid-correction would
  // be worse than requiring a click.
  useEffect(() => {
    if (selected !== null && !shots.some((s) => s.sequence === selected)) setSelected(null);
  }, [shots, selected]);

  // Claimed through the command registry rather than a private key
  // listener, so the bindings are rebindable, appear in the shortcut sheet
  // and the palette, and — because they are released on unmount — "m" and
  // "x" stay ordinary letters everywhere else in the app.
  useEffect(() => {
    if (!active || effective === null) return;
    const unregister = [
      registerCommand("shots.markMade", () => corrections.correct(effective, "make")),
      registerCommand("shots.markMissed", () => corrections.correct(effective, "miss")),
      registerCommand("shots.markNotAShot", () => corrections.correct(effective, "false-positive")),
    ];
    return () => unregister.forEach((off) => off());
  }, [active, effective, corrections, registerCommand]);

  const apply = useCallback(
    (sequence: number, correction: Parameters<ShotCorrectionsApi["correct"]>[1]) => {
      corrections.correct(sequence, correction);
      onHintShortcut?.();
    },
    [corrections, onHintShortcut],
  );

  if (shots.length === 0) {
    return (
      <div className="p-3">
        <EmptyState
          title={active ? "Watching for shots" : "Not tracking yet"}
          message={
            active
              ? "Take a shot. Detected attempts appear here as they happen."
              : "Point the camera at the rim and start a session."
          }
        />
      </div>
    );
  }

  return (
    <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
      {shots.map((shot) => {
        const correction = corrections.corrections[shot.sequence];
        const removed = correction === "false-positive";
        const result = correction === "make" ? "MAKE" : correction === "miss" ? "MISS" : null;
        const isSelected = effective === shot.sequence;
        const isPending = corrections.pending.includes(shot.sequence);

        return (
          <li key={shot.sequence}>
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-2 text-sm",
                isSelected && "bg-accent/60",
                removed && "opacity-50",
              )}
            >
              <button
                type="button"
                onClick={() => setSelected(shot.sequence)}
                aria-pressed={isSelected}
                className="min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="metric-value font-semibold">
                  Shot {shot.sequence}
                  {removed ? " — not a shot" : ""}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {shot.designation ? fmtShotType(shot.designation) : "Classifying"}
                  {correction && !removed ? " · corrected" : ""}
                  {isPending ? " · saving" : ""}
                </span>
              </button>

              <ResultBadge
                result={result ?? (shot.result === "make" ? "MAKE" : "MISS")}
                className={removed ? "invisible" : ""}
              />

              <div className="flex shrink-0 items-center gap-0.5">
                {correction ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => corrections.revert(shot.sequence)}
                    aria-label={`Undo the correction to shot ${shot.sequence}`}
                  >
                    <Undo2 className="size-3.5" aria-hidden />
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => apply(shot.sequence, "make")}
                      aria-label={`Mark shot ${shot.sequence} as made`}
                    >
                      <Check className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => apply(shot.sequence, "miss")}
                      aria-label={`Mark shot ${shot.sequence} as missed`}
                    >
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
