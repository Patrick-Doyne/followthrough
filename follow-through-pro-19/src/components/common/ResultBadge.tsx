import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProcessingStatus, ShotResult } from "@/types/telemetry";

/** MAKE/MISS is never communicated by color alone — an icon is always present. */
export function ResultBadge({
  result,
  className,
  size = "sm",
}: {
  result: ShotResult;
  className?: string;
  size?: "sm" | "md";
}) {
  const isMake = result === "MAKE";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 font-medium tracking-wide uppercase",
        size === "sm" ? "py-0.5 text-[0.6875rem]" : "py-1 text-xs",
        isMake ? "border-make/40 bg-make/10 text-make" : "border-miss/40 bg-miss/10 text-miss",
        className,
      )}
    >
      {isMake ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
      {result}
    </span>
  );
}

const STATUS_STYLES: Record<ProcessingStatus, string> = {
  COMPLETE: "border-make/40 bg-make/10 text-make",
  PROCESSING: "border-primary/40 bg-primary/10 text-primary",
  QUEUED: "border-border bg-muted text-muted-foreground",
  FAILED: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ProcessingStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[0.6875rem] font-medium tracking-wide uppercase",
        STATUS_STYLES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {status.toLowerCase()}
    </span>
  );
}
