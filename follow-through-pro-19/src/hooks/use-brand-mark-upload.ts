import { useCallback, useRef, useState } from "react";

import { prepareBrandMark, type MarkError } from "@/lib/brand-mark";

/**
 * Owns a hidden file input and the work of turning what comes out of it
 * into something storable.
 *
 * <p>A hook rather than a component because two places offer the same
 * action -- the row in the Appearance card and the name plate itself --
 * and each needs its own input element. Sharing one input across both
 * would mean whichever mounted last owned it.
 */
export function useBrandMarkUpload(onPicked: (dataUrl: string) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<MarkError | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback(() => {
    setError(null);
    inputRef.current?.click();
  }, []);

  const onChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Cleared straight away so picking the same file twice still fires
      // a change event.
      event.target.value = "";
      if (!file) return;
      setBusy(true);
      setError(null);
      const result = await prepareBrandMark(file);
      setBusy(false);
      if (result.ok) onPicked(result.dataUrl);
      else setError(result.error);
    },
    [onPicked],
  );

  return { inputRef, open, onChange, error, busy };
}
