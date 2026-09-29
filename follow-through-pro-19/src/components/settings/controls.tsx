import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * A segmented control built on native radio inputs.
 *
 * <p>Native radios are used rather than styled buttons with ARIA roles
 * because the platform already implements the whole interaction correctly:
 * arrow-key navigation within the group, a single tab stop, and the "N of
 * M" group semantics screen readers announce. Reimplementing that with
 * role="radiogroup" would be more code and worse. The inputs are visually
 * hidden but not display:none, so they stay focusable, and the focus ring
 * is drawn on the label via `has-[:focus-visible]`.
 */
export function ChoiceGroup<T extends string>({
  name,
  label,
  description,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  description?: string | undefined;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      <div className="field-row mt-2 flex gap-1 bg-surface p-1">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex-1 cursor-pointer rounded-sm px-2 py-1.5 text-center text-sm transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-surface",
                selected
                  ? "bg-[var(--sec)] font-medium text-[var(--sec-on)]"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: ReactNode;
  description?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const describedBy = description ? `${id}-description` : undefined;
  return (
    <div
      className="toggle-row flex items-start justify-between gap-4 px-3 py-2.5"
      data-on={checked}
    >
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-normal">
          {label}
        </Label>
        {description ? (
          <p id={describedBy} className="mt-1 text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}

export function SelectRow<T extends string>({
  id,
  label,
  description,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  description?: string | undefined;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A slider with its current value shown as text.
 *
 * <p>The readout is not decoration: a slider with no numeric output is
 * unusable for anyone who cannot judge the thumb position, and it is what
 * `aria-valuetext` should agree with.
 */
export function SliderRow({
  id,
  label,
  description,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  id: string;
  label: string;
  description?: string | undefined;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <span className="metric-value text-xs text-muted-foreground">{format(value)}</span>
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <Slider
        id={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        aria-valuetext={format(value)}
        onValueChange={([next]) => next !== undefined && onChange(next)}
      />
    </div>
  );
}

export function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick}>
      <RotateCcw className="size-3.5" aria-hidden />
      {label}
    </Button>
  );
}
