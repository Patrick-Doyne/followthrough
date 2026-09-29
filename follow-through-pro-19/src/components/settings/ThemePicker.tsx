import { Check, Pipette, RotateCcw } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { contrastRatio, hexToOklch, formatOklch, oklchToHex, parseOklch } from "@/lib/color";
import {
  DEFAULT_TRIAD,
  isDefaultTriad,
  resolveTheme,
  THEME_PRESETS,
  type PaletteKey,
  type ThemeTriad,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The theme, as three colours.
 *
 * <p>Replaces the seven accent presets. Those could only ever change one
 * hue, and the page they were set on used five invented colours of its
 * own, so the one screen where a user chose their colours was the screen
 * that ignored them.
 *
 * <p>Free colour inputs are safe here in a way they were not before. The
 * user supplies hue and chroma; the palette supplies lightness. Nothing
 * a picker can return changes how light a surface is, so no choice can
 * push text under its contrast floor — which is asserted over the whole
 * hue circle in theme.test.ts rather than hoped for.
 */

const ROLES = [
  {
    key: "accent" as const,
    label: "Accent",
    hint: "Buttons, links and focus rings.",
  },
  {
    key: "base" as const,
    label: "Base",
    hint: "The page, cards and sidebar.",
  },
  {
    key: "neutral" as const,
    label: "Neutral",
    hint: "Borders, outlines and secondary text.",
  },
];

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-6 shrink-0 rounded-sm border border-border"
      style={{ backgroundColor: color }}
    />
  );
}

export function ThemePicker({
  value,
  palette,
  onChange,
}: {
  value: ThemeTriad;
  /** The palette in use, so the preview shows what will actually render. */
  palette: PaletteKey;
  onChange: (next: ThemeTriad) => void;
}) {
  const id = useId();
  const resolved = resolveTheme(value, palette);

  const setRole = (role: keyof ThemeTriad, hex: string) => {
    const parsed = hexToOklch(hex);
    if (!parsed) return;
    onChange({ ...value, [role]: formatOklch(parsed) });
  };

  return (
    // The picker's groups are peers of the card's other groups, so
    // they share the card's 16px beat rather than keeping an inner
    // rhythm of their own -- two beats in one card read as two
    // competing grids stacked on each other.
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-medium text-foreground">Preset themes</legend>
        <p className="mt-1 text-xs text-muted-foreground">
          A starting point. Rim orange is the palette the app ships with.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {THEME_PRESETS.map((preset) => {
            const selected =
              preset.triad.accent === value.accent &&
              preset.triad.base === value.base &&
              preset.triad.neutral === value.neutral;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onChange(preset.triad)}
                aria-pressed={selected}
                title={preset.label}
                className={cn(
                  // transition-all, not transition-colors: the selected
                  // state is a ring, which is a box-shadow, and colours
                  // alone left it snapping on while the border eased.
                  "touch-target flex items-center gap-1.5 rounded-sm border p-1.5",
                  "transition-all duration-200 ease-out",
                  selected
                    ? "border-[var(--sec)] ring-1 ring-[var(--sec)]"
                    : "border-border hover:border-[var(--sec)] hover:bg-[color-mix(in_oklab,var(--sec)_8%,transparent)]",
                )}
              >
                {/* Each preset previews its own three colours resolved for
                    the palette in use, not an approximation of them. */}
                {(["primary", "background", "muted-foreground"] as const).map((token) => (
                  <span
                    key={token}
                    aria-hidden
                    className="size-4 rounded-[2px] border border-border"
                    style={{ backgroundColor: resolveTheme(preset.triad, palette)[token] }}
                  />
                ))}
                <span className="sr-only">{preset.label}</span>
                {selected ? <Check className="size-3.5" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        {/* Said once, as this group's own hint, rather than floating
            between the swatches and the rows with nothing to attach
            to. The rows themselves have to stay one line: the hint
            that opens on hover takes width from them, and a
            description that rewraps makes a row grow taller just for
            being pointed at. */}
        <p className="text-sm font-medium text-foreground">Colours</p>
        <p className="mt-1 text-xs text-muted-foreground">
          You choose the hue and saturation of each; the light or dark theme decides how light it
          is, which is what keeps every combination readable.
        </p>
        <div className="mt-2 space-y-2">
          {ROLES.map((role) => {
            const inputId = `${id}-${role.key}`;
            const hex = oklchToHex(
              parseOklch(value[role.key]) ?? parseOklch(DEFAULT_TRIAD[role.key])!,
            );
            return (
              // A label, not a div: clicking anywhere on the row opens the
              // picker, rather than only the swatch at its left edge.
              <label
                key={role.key}
                htmlFor={inputId}
                data-interactive
                className="field-row flex items-center gap-3 px-3 py-2.5"
              >
                <input
                  id={inputId}
                  type="color"
                  value={hex}
                  onChange={(e) => setRole(role.key, e.target.value)}
                  className="touch-target size-9 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent"
                />
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-foreground">{role.label}</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">{role.hint}</p>
                </div>
                {/* Value first, hint second: the hint opens to its right
                  and slides the hex over, instead of appearing beside a
                  value that stays pinned in place. */}
                <span className="flex shrink-0 items-center">
                  <span className="metric-value text-xs text-muted-foreground uppercase">
                    {hex}
                  </span>
                  <span className="row-hint text-xs text-[var(--sec)]">
                    <span className="flex items-center gap-1 ps-3">
                      <Pipette className="size-3.5" aria-hidden />
                      Click to change
                    </span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* What the three colours actually became. Worth showing because
          the base and neutral are tints rather than literal fills, and
          a swatch of the input alone would misrepresent that. */}
      <div className="field-note space-y-2 px-3 py-2.5">
        <p className="label-caps">Resolved</p>
        <div className="flex flex-wrap items-center gap-3">
          {(
            [
              ["Page", "background"],
              ["Card", "card"],
              ["Text", "foreground"],
              ["Secondary", "muted-foreground"],
              ["Border", "input"],
              ["Accent", "primary"],
            ] as const
          ).map(([label, token]) => (
            <span key={token} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Swatch color={resolved[token]!} />
              {label}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Body text reads at{" "}
          <span className="metric-value">
            {contrastRatio(
              parseOklch(resolved["foreground"]!)!,
              parseOklch(resolved["background"]!)!,
            ).toFixed(2)}
            :1
          </span>{" "}
          on the page, and secondary text at{" "}
          <span className="metric-value">
            {contrastRatio(
              parseOklch(resolved["muted-foreground"]!)!,
              parseOklch(resolved["background"]!)!,
            ).toFixed(2)}
            :1
          </span>
          . Both stay above 4.5:1 for every colour you can pick.
        </p>
      </div>

      {isDefaultTriad(value) ? null : (
        <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_TRIAD)}>
          <RotateCcw className="size-3.5" aria-hidden />
          Back to the default theme
        </Button>
      )}
    </div>
  );
}
