import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { titleCase } from "@/lib/format";
import type { TrainingType } from "@/types/telemetry";

const TRAINING_TYPES: TrainingType[] = [
  "SHOOTING",
  "SKILLS",
  "CONDITIONING",
  "SCRIMMAGE",
  "RECOVERY",
];

interface FormFields {
  title: string;
  location: string;
  trainingType: TrainingType;
}

export interface UploadVideoFormValues extends FormFields {
  file: File;
  /** Read straight off the file itself (see readDuration below) -- never
   * asked for, since the user already recorded this and may not know it. */
  durationSeconds: number;
}

const empty = (): FormFields => ({ title: "", location: "", trainingType: "SHOOTING" });

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

/** Loads just enough of the file to read its real duration -- preload
 *="metadata" means the browser only fetches the container header, not the
 * whole file, even for a large recording. Some formats/browsers report
 * Infinity until a seek happens; that's treated the same as a read
 * failure (falls back to 0) rather than blocking the upload on it. */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const cleanup = () => URL.revokeObjectURL(url);
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    video.onerror = () => {
      cleanup();
      resolve(0);
    };
    video.src = url;
  });
}

/**
 * For a recording made without live-streaming (couldn't make it to the
 * gym with a laptop, say). Only asks for what the uploader actually knows
 * off the top of their head (title, location, training type) plus the
 * file itself -- duration comes from the file's own metadata, and date
 * comes from the file's last-modified timestamp, both read automatically
 * rather than asked for (see routes/videos.index.tsx for what happens
 * with these values: create-session -> upload -> process).
 */
export function UploadVideoDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UploadVideoFormValues) => void;
  pending?: boolean;
}) {
  const [form, setForm] = useState<FormFields>(empty());
  const [file, setFile] = useState<File | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [readingDuration, setReadingDuration] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(empty());
    setFile(null);
    setDurationSeconds(null);
    setReadingDuration(false);
  }, [open]);

  const set = <K extends keyof FormFields>(key: K, value: FormFields[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onFileChange = (selected: File | null) => {
    setFile(selected);
    setDurationSeconds(null);
    if (!selected) return;
    setReadingDuration(true);
    void readDuration(selected).then((seconds) => {
      setDurationSeconds(seconds);
      setReadingDuration(false);
    });
  };

  const canSubmit = !!file && !readingDuration && durationSeconds !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a recorded video</DialogTitle>
          <DialogDescription>
            Couldn&apos;t live-stream this session? Upload the recording and FollowThrough will
            process it for shot stats in the background.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit || !file || durationSeconds === null) return;
            onSubmit({ ...form, file, durationSeconds });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="uv-title">Title</Label>
            <Input
              id="uv-title"
              required
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Wednesday shooting workout"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="uv-location">Location</Label>
              <Input
                id="uv-location"
                required
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Riverside Fieldhouse"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Training type</Label>
              <Select
                value={form.trainingType}
                onValueChange={(v) => set("trainingType", v as TrainingType)}
              >
                <SelectTrigger aria-label="Training type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {titleCase(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="uv-file">Video file</Label>
            <Input
              id="uv-file"
              type="file"
              accept="video/*"
              required
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                {readingDuration
                  ? " · Reading video info…"
                  : durationSeconds !== null
                    ? ` · ${formatDuration(durationSeconds)}`
                    : null}
              </p>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending ? "Uploading…" : "Upload & process"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
