# Visual layer strip-back — 2026-09-26

> **Status (29 September 2026): historical record.** This documents a
> single event and is kept so the rejected redesign can be reasoned about
> without re-reading a diff. Two things changed after it was written:
>
> - The 21 `ui/` primitives and 17 npm dependencies this note says were
>   *restored* have since been removed again, together with 7 more
>   primitives and 5 more dependencies, because nothing imported them. The
>   19 primitives that remain are all in use.
> - The "mock shot stream" referred to below no longer exists at all: the
>   frontend's mock layer was deleted on 29 September 2026, and every
>   number on the live page comes from the detection pipeline's
>   DataChannel. The last reference to the deleted `--rail` /
>   `--bug-foreground` tokens (in `OverlayPanelControls.tsx`) was fixed at
>   the same time.
>
> Everything below is as written on 26 September 2026.

The Broadcast redesign was rejected. This records exactly what was removed,
what was kept, and why, so a full revert (or a restart) can be reasoned about
without re-reading the diff.

## Removed — the visual layer

| Thing | Where it was |
| --- | --- |
| Broadcast palette (42 dark tokens) | reverted to HEAD values, incl. `--radius: 0.375rem` |
| `--bug`, `--bug-foreground`, `--rail` | deleted from `styles.css`, `@theme inline` and the contrast test |
| `--dur-quick/base/wipe/count`, `--ease-bug` | deleted; nothing referenced them |
| Archivo self-hosted webfont | `@font-face`, the `<link rel=preload>`, `public/fonts/archivo-latin-var.woff2` (88 KB) |
| `display-condensed` utility | deleted; call sites back to `metric-value` |
| `field-label` | reverted to `label-caps` across 13 files |
| `LiveScoreBug.tsx` (142 lines) | score bug + made-shot lower third, deleted |
| `LiveStageChrome.tsx` (171 lines) | ModeBadge, DiagnosticsPanel, FloatingToolbar, deleted |
| On-video HUD layer in `LiveVideo.tsx` | status pill, mode badge, diagnostics, score bug, made-shot graphic |
| Replay HUD on `/videos/$videoId` | ModeBadge + running score bug over the playback overlay |
| `BoxScore.tsx` + its DOM test (237 lines) | deleted; `MetricCard` tile grid restored on the dashboard |
| `lib/live-mode.ts`, `lib/replay.ts` + tests | orphaned once the badges and replay HUD went |

The 21 `ui/` primitives the retheme deleted were **restored** at the time,
along with the 17 npm dependencies that were removed with them (see the
status note above for what happened next).

## Restored to the original

- `LiveVideo`'s pre-existing `LIVE`/`Offline` badge, elapsed clock and
  `overlay` slot are back, in their original markup.
- `/live`'s **Start session / End session** buttons are back in the page
  header where they were.
- `/videos/$videoId`'s single nearest-shot chip is back, in its original markup.
- The dashboard's eight `MetricCard` tiles are back verbatim.

## Kept, deliberately

These are not visual work. Removing them would re-introduce a bug.

| Kept | Why |
| --- | --- |
| `deriveLiveStatus` driving the badge | the old badge read a synthetic shot stream, so it said "Live" with the pipeline dead |
| The failure veil on the stage | replaces copy that claimed to be reconnecting when no reconnection existed |
| `webrtc-live.ts` rewrite (541 lines) | generation tokens, ICE buffering both directions, `offerSent` ordering, unhandled rejections, replay buffer |
| C++ reconnection + `court_x`/`court_y` | proven end-to-end with two sequential viewers on one process |
| `use-event-callback`, recorder cleanup, `captureStream` guard | the parent-render camera-restart coupling, and losing a recording on unmount |
| `use-live-health`, `use-screen-wake-lock` | a propped phone locking itself was silent total loss |
| `use-live-score`, `ShotFeed`, `live-shot.ts` | the live screen's numbers now come from the DataChannel instead of synthetic events |
| `lib/color.ts` | the contrast maths was double-applying the sRGB transfer function |
| Court tokens `--court-*` | `ShotLocationChart` had hard-coded colours and ignored light and high-contrast entirely |
| Shot corrections (client-only) | requested feature, unrelated to the look |
| All 28 usability/accessibility settings | separate, earlier, accepted work |

## Three deliberate differences from HEAD

1. **`--input` 0.30 → 0.50 (dark).** At 0.30 a form field outline measures
   **1.42:1** against the background — under WCAG 1.4.11's 3:1. 0.50 is the
   minimum that clears it on both background and card. Visibly brighter field
   borders.
2. **`--destructive` 0.60 → 0.575, `--miss` 0.63 → 0.57 (dark).** Their own
   foregrounds measured **4.12:1** and **3.53:1**, under 4.5:1. Barely
   perceptible change.

   All three only surfaced because the contrast test's maths was fixed. The
   original palette always failed these; the old test inflated every ratio and
   hid it.
3. **Accent presets remain** (311 lines of generated CSS, `data-accent`, the
   picker). The default `rim` reproduces HEAD's `oklch(0.72 0.166 52)` exactly,
   so **dark mode is pixel-identical by default**. This was an explicit request
   ("custom per user, default to the current orange"), so it was kept rather
   than assumed dead.

## Verification after the strip-back

- `npx tsc --noEmit` — clean
- `npx eslint src` — 0 errors, 19 warnings (all pre-existing fast-refresh notes)
- `npx vitest run` — 400 passed, 19 files
- `npx vite build` — clean
- Dev-server SSR: `/`, `/live`, `/videos`, `/analytics`, `/calendar` → 200;
  `/settings` → 307 → 200
