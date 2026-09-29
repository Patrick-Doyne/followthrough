import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/format";
import type { SubscriptionTier } from "@/types/telemetry";

/**
 * A plan.
 *
 * <p>The three were previously identical cards distinguished by a faint
 * border, with the plan you are *on* wearing the only grey button and the
 * two you are not shouting in orange. That is the hierarchy upside down.
 * Here the current plan is the solid one, and switching is an outline
 * action -- which is also the honest emphasis, since the common reason to
 * open this tab is to check what you have.
 */
export function PlanCard({
  tier,
  price,
  features,
  current,
  disabled,
  onSelect,
}: {
  tier: SubscriptionTier;
  price: string;
  features: string[];
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={cn(
        "sheet flex flex-col",
        // The hue edge is the "this is the one" mark, so the plans you are
        // not on drop it -- three identical coloured edges say nothing,
        // which is exactly what the three identical cards used to do.
        current ? "ring-1 ring-[var(--sec)]" : "sheet-quiet",
      )}
    >
      <div
        className={cn(
          "flex items-baseline justify-between gap-3 px-4 pt-4 pb-3",
          current && "bg-[color-mix(in_oklab,var(--sec)_10%,transparent)]",
        )}
      >
        <div>
          <h3 className="label-caps !text-foreground">{titleCase(tier)}</h3>
          <p className="metric-value mt-1 text-2xl leading-none font-bold text-foreground">
            {price.split(" / ")[0]}
            <span className="text-sm font-medium text-muted-foreground">
              {" / "}
              {price.split(" / ")[1]}
            </span>
          </p>
        </div>
        {current ? (
          <span className="notch bg-[var(--sec)] px-2 py-1 text-[0.625rem] font-semibold tracking-[0.14em] text-[var(--sec-on)] uppercase">
            Current
          </span>
        ) : null}
      </div>

      <ul className="flex-1 space-y-2 border-t border-border px-4 py-3.5 text-sm text-muted-foreground">
        {features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--sec)]" aria-hidden />
            {feature}
          </li>
        ))}
      </ul>

      <div className="px-4 pb-4">
        <Button
          size="sm"
          className="w-full"
          variant={current ? "secondary" : "outline"}
          disabled={current || disabled}
          onClick={onSelect}
        >
          {current ? "Your plan" : `Switch to ${titleCase(tier)}`}
        </Button>
      </div>
    </div>
  );
}
