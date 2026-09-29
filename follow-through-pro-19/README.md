# FollowThrough — web app

The browser front end of FollowThrough, a basketball training and analytics
product. It records or uploads training footage, shows the C++ detection
pipeline's analysis drawn over the video, and presents the shot statistics
the Spring Boot API derives from it. The wider system — pipeline, API,
storage — is described in `../ARCHITECTURE.md`; how to run everything
locally is in `../LOCAL_DEV.md`.

## Stack

- React 19, TypeScript, TanStack Start (file-based routing, SSR entry in
  `src/server.ts`), TanStack Query
- Tailwind v4 with a token-based theme (`src/styles.css`,
  `src/theme-properties.css`), shadcn-style primitives under
  `src/components/ui/` (only the ones in use), Recharts, lucide icons,
  sonner toasts
- Vite (through `@lovable.dev/vite-tanstack-config`), vitest, ESLint +
  Prettier, Playwright for the screenshot harness

## Run

```bash
npm install
npm run dev          # http://localhost:8081 (8080 is taken by the signaling relay)
```

The app talks only to the real API: there is no mock mode. Start the Spring
Boot API first (`../LOCAL_DEV.md`), and for the Live page also the signaling
relay and the C++ backend. Sign in with the seeded demo account
(`patrick.doyne@followthrough.app` / `followthrough-dev`).

Configuration is read from `.env.local` (gitignored):

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8082/api/v1` | the API's base URL, including its context path |
| `VITE_SIGNALING_RELAY_URL` | `ws://localhost:8080` | the WebRTC signaling relay for live sessions |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm run build` / `npm run preview` | Vite dev server / production build (Nitro) / preview |
| `npm test` / `npm run test:watch` | vitest, one shot or watching |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run shots -- <outDir> "<path>[,<path>]"` | `scripts/shoot.mjs`: signs into the running dev server and screenshots the given routes at laptop (dark and light) and phone widths; `FT_EMAIL`, `FT_PASSWORD`, `BASE` override the defaults |
| `npm run brand` | `scripts/gen-brand-assets.ts`: regenerates `public/brand/` and the favicons from `brand-source/followthrough-logo.png` |

Two more scripts are not run from npm: `scripts/prepare-playback.ts` is
invoked by the API for every uploaded video (thumbnail plus a conditional
H.264 playback copy — the upload is never modified), and
`scripts/gen-theme-properties.ts` regenerates `src/theme-properties.css`
(the `@property` registrations for the theme tokens) and
`scripts/gen-theme-recipe.ts` regenerates `src/lib/theme-recipe.ts` (the
palette recipe extracted from `src/styles.css`); both outputs are committed
(see their header comments).

## Where things are

```
src/
  routes/          file-based routes (see routes/README.md); __root.tsx is the shell + providers
  services/        http.ts (transport, bearer token, ApiError) → followthrough.ts (one function per
                   endpoint) → queries.ts (TanStack Query options); webrtc-live.ts (the live
                   RTCPeerConnection + relay client); camera.ts; court-geometry.ts (pipeline feet ↔
                   court metres, zones); shot-corrections.ts (client-only overrides)
  types/           telemetry.ts (API models), api.ts (envelopes), overlay-telemetry.ts (the C++ wire schema)
  lib/             overlay-renderer.ts (the analysis overlay), overlay-replay/-panels/-palette/-export,
                   telemetry-shots.ts + live-shot.ts (shots derived from telemetry), shot-insights.ts
                   (chart maths), format.ts / intl.ts / i18n.ts, theme.ts, settings-boot.ts, shortcuts.ts
  state/           providers: auth, settings (+ sync), notifications, undo, commands, subscription
  hooks/           use-live-score, use-live-health, use-session-shots, use-all-shots, use-overlay-panels, …
  components/      video/ (LiveVideo, FollowThroughOverlay, TelemetryOverlayCanvas, VideoPlayer,
                   VideoGallery, UploadVideoDialog, ShotFeed, DownloadOverlayButton), analytics/ (charts),
                   calendar/, dashboard/, settings/, layout/AppShell, common/, a11y/, brand/, ui/
  styles.css       design tokens for light, dark and high-contrast; theme-properties.css is generated
scripts/           prepare-playback.ts, shoot.mjs, gen-brand-assets.ts, gen-theme-*.ts
public/brand/      logo lockup and badge; brand-source/ holds the supplied original
```

## How data flows

- **API.** Components never call `fetch`. `services/followthrough.ts` maps
  1:1 onto the REST contract; `services/queries.ts` wraps it in query
  options; routes and components use those. Errors arrive as RFC 7807
  problem details and become `ApiError` (with `fieldErrors` for validation).
  The bearer token lives in `localStorage` under `followthrough.token`.
- **Shots.** The backend stores per-video telemetry streams and session
  aggregates, not individual shots. `lib/telemetry-shots.ts` derives `Shot`
  records from a video's stream (`GET /videos/{id}/telemetry`), and
  `use-session-shots` / `use-all-shots` gather them for the charts.
- **Playback.** `VideoPlayer` plays the recording (or its browser-playable
  copy) and `TelemetryOverlayCanvas` draws the analysis over it from the
  stored telemetry, in the current theme; `DownloadOverlayButton` records
  video and overlay together for a copy with the analysis on it.
- **Live.** `LiveVideo` captures the camera, `WebRTCLiveSession` sends it to
  the C++ backend and receives per-frame telemetry on a DataChannel,
  `FollowThroughOverlay` draws video and overlay into one canvas, and that
  canvas is what gets recorded and uploaded when the session ends. Every
  number on the page (score, counters, feed, chart, Eagle-Eye) comes from
  that DataChannel.
- **Settings.** One versioned document (`state/settings.ts`) is stored in
  `localStorage` first and synced to the account once per session; a boot
  script applies theme, density, contrast and motion before first paint.

## Tests

```bash
npm test
```

Pure modules run in node; component and hook suites opt into jsdom with a
`@vitest-environment jsdom` comment. Notable suites: `settings.test.ts`
(the boot script and the runtime must agree for every pre-paint
combination), `styles.contrast.test.ts` (WCAG ratios measured from the
shipped CSS), `overlay-theming.test.ts` (the theme reaches the canvas),
`webrtc-live*.test.ts` (offer ordering and reconnection),
`telemetry-shots.test.ts` and `court-geometry.test.ts` (pipeline output to
chart data, including a real `shot_event` fixture).

## Origin

The app was scaffolded with Lovable in August 2026 (the TanStack Start
template and the shadcn primitives under `src/components/ui/` come from
that) and has been developed in this repository since. It is not connected
to a Lovable project any more.
