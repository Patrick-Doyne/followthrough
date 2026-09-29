import { RotateCcw, Upload } from "lucide-react";
import { useId } from "react";

import { BrandLockup } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { useBrandMarkUpload } from "@/hooks/use-brand-mark-upload";
import { MARK_ERROR_COPY, MARK_PIXELS } from "@/lib/brand-mark";

/**
 * The logo on the name plate.
 *
 * <p>Defaults to the FollowThrough mark and takes an upload otherwise --
 * a school crest, a club badge. The file is never stored as picked: it
 * is drawn into a 192px square and re-encoded first, because this lives
 * in the settings document and that document is written on every
 * settings change and mirrored to the account.
 *
 * <p>The preview is the real plate, at the real size, with the real
 * accent behind it. A logo that disappears against the accent or that
 * letterboxes badly is something you want to find out here rather than
 * after saving.
 */
export function BrandMarkPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const id = useId();
  const { inputRef, open, onChange: onFile, error, busy } = useBrandMarkUpload(onChange);

  return (
    <div>
      <p className="text-sm font-medium text-foreground">Name plate logo</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Shown on your settings name plate — yours if you upload one, ours if you don&apos;t. Uploads
        are scaled to {MARK_PIXELS}px and kept square.
      </p>

      <div
        data-interactive
        className="field-row mt-2 flex items-center gap-3 px-3 py-2.5"
        onClick={open}
        role="presentation"
      >
        {/* The plate as it will actually render, not a swatch of it. */}
        {value ? (
          <span
            className="notch plate grid size-12 shrink-0 place-items-center overflow-hidden"
            aria-hidden
          >
            <img src={value} alt="" className="size-[78%] object-contain" />
          </span>
        ) : (
          /* The plate has no fill of its own, and this row is not the
             dark band it normally sits on -- so here the logo brings
             the ground with it. Wide, because that is the shape the
             real plate takes when it is showing the logo. */
          <BrandLockup decorative className="notch h-14 w-[5.75rem] shrink-0 overflow-hidden" />
        )}

        <div className="min-w-0 flex-1">
          <span className="text-sm text-foreground">
            {value ? "Your logo" : "FollowThrough logo"}
          </span>
          {/* One line, and short enough to stay one line once the hint
              opens beside it -- a description that rewraps on hover
              makes the row grow taller just for being pointed at. */}
          <p className="mt-0.5 text-xs text-muted-foreground">PNG, JPEG, WebP or SVG.</p>
        </div>

        <span className="row-hint shrink-0 text-xs text-[var(--sec)]">
          <span className="flex items-center gap-1 ps-3">
            <Upload className="size-3.5" aria-hidden />
            Click to upload
          </span>
        </span>
      </div>

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => void onFile(e)}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={open}>
          <Upload className="size-3.5" aria-hidden />
          {busy ? "Processing…" : value ? "Replace logo" : "Upload a logo"}
        </Button>
        {value ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            <RotateCcw className="size-3.5" aria-hidden />
            Use the FollowThrough mark
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-miss">
          {MARK_ERROR_COPY[error]}
        </p>
      ) : null}
    </div>
  );
}
