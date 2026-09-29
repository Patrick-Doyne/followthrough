/**
 * A usage row: label, tabular readout, and a segmented meter.
 *
 * <p>Two things changed from the plain progress bar this replaces. The
 * meter is twenty discrete slots, which can be counted rather than
 * estimated; and its colour tracks how close the number is to its limit,
 * so the row that needs attention is the one that looks different. All
 * three rows were previously the same orange whether they sat at 36% or
 * at 70%, which is colour spent for nothing.
 */
const SLOTS = 20;

/** Where the meter changes colour. Chosen so "nearly out" arrives before
 * it is too late to do anything about it, not at 99%. */
const WARN = 0.6;
const CRITICAL = 0.85;

export function UsageMeter({
  label,
  value,
  limit,
  unit,
}: {
  label: string;
  value: number;
  limit: number;
  unit: string;
}) {
  const ratio = limit > 0 ? Math.min(1, value / limit) : 0;
  const lit = Math.round(ratio * SLOTS);
  const tone = ratio >= CRITICAL ? "critical" : ratio >= WARN ? "warn" : "ok";
  // Deliberately neutral until there is something to say, and then a
  // semantic colour rather than the brand one. A meter that is coloured
  // at every level spends its colour on the rows that are fine; a meter
  // that warns in --primary says nothing at all to someone whose accent
  // is already that colour.
  const meter =
    tone === "critical"
      ? "var(--color-miss)"
      : tone === "warn"
        ? "var(--color-warn)"
        : "color-mix(in oklab, var(--color-foreground) 45%, transparent)";
  const remaining = Math.max(0, limit - value);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="metric-value text-sm">
          <span className="font-bold text-foreground">
            {value}
            {unit}
          </span>
          <span className="text-muted-foreground">
            {" / "}
            {limit}
            {unit}
          </span>
        </span>
      </div>
      <div
        className="meter"
        style={{ ["--meter" as string]: meter }}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuetext={`${value}${unit} of ${limit}${unit} used`}
        aria-label={label}
      >
        {Array.from({ length: SLOTS }, (_, i) => (
          <span key={i} className="meter-slot" data-lit={i < lit} />
        ))}
      </div>
      {/* Only when there is something to say. The meter carries severity
          by colour and colour cannot be the only channel, so warn and
          critical get words -- but a line under every row saying what the
          readout above it already says is three sentences of noise. */}
      {tone === "ok" ? null : (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {tone === "critical" ? "Nearly used up — " : "Running low — "}
          {remaining}
          {unit} left this month.
        </p>
      )}
    </div>
  );
}
