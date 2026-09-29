import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A settings panel.
 *
 * <p>The app's card. A 3px edge along the top in the theme's accent, and
 * the section's icon in the same. Two saturated marks, everything else
 * neutral -- enough to lift a card off the page without it turning into
 * a paint chart.
 *
 * <p>Every card uses the same colour. Walking it down a shade per
 * section distinguished them, but only one of the steps was the one
 * worth looking at, and the icon and title were already saying which
 * section you were in.
 *
 * <p>Started as the settings page's own card and was promoted when the
 * rest of the app moved onto the same language; `Panel` is what it
 * replaces.
 */
export function SectionCard({
  id,
  icon: Icon,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  id?: string;
  icon: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
}) {
  return (
    <section id={id} className={cn("sheet flex flex-col", className)}>
      {/* nowrap plus a shrinking text column: with flex-wrap the actions
          dropped to their own line as soon as a description ran long,
          so one card in a row put its Reset under the title while its
          partner kept it on the right. */}
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 pt-4 pb-3.5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {/* The symbol itself in the accent, with nothing behind it.
              A solid block with the glyph knocked out of it was the
              original device; across a page of cards it read as a column
              of buttons rather than as a set of labels. */}
          <span className="shrink-0 pt-0.5 text-[var(--sec)]" aria-hidden>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm leading-tight font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn("min-w-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
