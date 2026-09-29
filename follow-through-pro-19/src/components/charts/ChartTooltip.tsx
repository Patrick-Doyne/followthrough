import type { ReactNode } from "react";

export function TooltipShell({
  title,
  subtitle,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-40 rounded-sm border border-border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="font-semibold text-popover-foreground">{title}</p>
      {subtitle ? <p className="mt-0.5 text-muted-foreground">{subtitle}</p> : null}
      {children ? <div className="mt-2 space-y-1">{children}</div> : null}
    </div>
  );
}

export function TooltipRow({
  label,
  value,
  color,
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {color ? (
          <span className="size-2 rounded-[2px]" style={{ backgroundColor: color }} aria-hidden />
        ) : null}
        {label}
      </span>
      <span className="metric-value text-popover-foreground">{value}</span>
    </div>
  );
}
