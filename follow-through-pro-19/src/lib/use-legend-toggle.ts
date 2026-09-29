import { useState } from "react";

/**
 * Which series a chart's legend has switched off.
 *
 * <p>In `lib` rather than beside `ChartLegend` so that file exports only
 * components, which is what keeps fast refresh working -- the same reason
 * `chart-labels.ts` is split out from `chart-parts.tsx`.
 */
export function useLegendToggle() {
  const [hidden, setHidden] = useState<string[]>([]);
  return {
    hidden,
    toggle: (id: string) =>
      setHidden((current) =>
        current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
      ),
    isHidden: (id: string) => hidden.includes(id),
  };
}
