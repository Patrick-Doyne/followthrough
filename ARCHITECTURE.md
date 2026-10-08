# FollowThrough — Architecture

What is built today, how the pieces fit, and where the seams are. Planned
and open work lives in `BACKLOG.md`; how to run the stack lives in
`LOCAL_DEV.md`; the C++ toolchain lives in `cpp/README.md`. Where something
is a local stand-in for future AWS infrastructure, it says so.

Last checked against the code on 29 September 2026.

---

## The one-sentence version

A C++ detection pipeline turns basketball footage into per-frame telemetry
(ball, player, rim, court, shots), the browser draws the analysis over the
footage from that telemetry, and a Spring Boot API stores the recordings,
the telemetry and the session statistics derived from it. **Nothing is ever
painted into a video file.**

---

## Components

| Component | Source | Runs as |
|---|---|---|
| Signaling relay | `js/mock-websocket.js` | Node, `ws://localhost:8080` |
| Live detection backend | `cpp/follow-through-webrtc.cpp` → `follow_through_webrtc` | native; CUDA/TensorRT, KVS WebRTC C SDK, libavcodec |
| Offline detection binary | `cpp/follow-through-batch.cpp` → `follow_through_batch_gpu` (TensorRT) and `follow_through_batch_cpu` (ONNX Runtime) | native; one run per uploaded video, started by the API |
| Playback preparation | `follow-through-pro-19/scripts/prepare-playback.ts` | Node (`npx tsx`), started by the API alongside detection |
| REST API | `springboot/` | Spring Boot 4.1, Java 17; `http://localhost:8082/api/v1` |
| Web app | `follow-through-pro-19/` | React 19 + TanStack Start; Vite dev server on `http://localhost:8081` |
| Models | `python/` | TensorRT `.engine` files and their `.onnx` exports; training is documented in `python/README.md` |

The whole tree is one repository. The web app was scaffolded with Lovable
in August 2026 (see its `AGENTS.md`); it is no longer connected to it.

---

## The detection pipeline (shared by both binaries)

`follow-through-batch.cpp` and `follow-through-webrtc.cpp` carry the same
detection and shot-state-machine code; they differ in where frames come
from and where telemetry goes. Keep the two in step when changing either.

Per frame:

1. **Detection** — a YOLO detector (`python/runs/detect/train/weights/best`)
   finds the backboard, basketball, net, player and rim. Exactly one of
   each is selected by confidence (the ball by confidence, the player by
   proximity to its previous box). A ball that vanishes briefly is coasted
   from its last velocity and flagged `predicted`.
2. **Court calibration** — a keypoint model
   (`python/runs/pose/train-MuSGD-1/weights/best`) locates seven court
   landmarks roughly every `COURT_CALIBRATION_INTERVAL` frames; a homography
   from those pixels to `COURT_POINTS` (feet, rim-centred) gives the
   shooter's distance from the rim and speed.
3. **Pose** — `yolo26n-pose` runs on a crop of the player whenever the ball
   is near the release zone, giving shoulders, elbows and wrists.
4. **Shot state machine** — ball leaving a wrist upward starts a
   *potential* shot; a sustained flight promotes it to `shot_started`; the
   ball crossing the net (or settling below the rim) decides **make** or
   **miss**. Each decided shot is emitted as a `shot_event` with its
   designation by distance (`LAY_UP` < 5 ft, `CLS_RNG` < 10, `MID_RNG` <
   19.9, `HS_3PT` < 22, `NCAA_3PT` < 23, else `NBA_3PT`), the shooter's
   court position **at release**, flight duration and time to apex.
5. **Telemetry** — one JSON `frame` message per frame, plus `shot_event`
   messages. A `[PERF]` line every `PERF_REPORT_INTERVAL` frames reports the
   per-stage cost.

Both binaries load their models by paths relative to `cpp/build`
(`../../python/...`), so they must be run from there.

### Telemetry schema

The frontend's `src/types/overlay-telemetry.ts` is the authoritative mirror
of what the C++ emits; the backend's `TelemetryJsonlParser` reads the same
lines.

| Message | Fields |
|---|---|
| `metadata` (offline only, first line) | `fps`, `frame_width`, `frame_height` |
| `frame` | `frame_id`, `frame_width`, `frame_height`, `potential_shot`, `shot_started`, `trail_frozen_at_rim`, `ball` (box + centre, `predicted`), `player`, `rim`, `net`, `court_keypoints` (only when calibration changed), `pose`, `apex_point`, `player_distance_ft`, `player_speed_mph`, `player_stat_is_projected`, `shot_designation`, `time_to_apex`, `shot_duration`, `shot_distance_ft` |
| `shot_event` | `frame_id`, `result` (`make`/`miss`), running `makes`/`misses`, `shot_designation`, `court_x`/`court_y` (feet, rim-centred; `null` when the court was not calibrated or the shooter not detected at release), `shot_distance`, `shot_duration`, `time_to_apex` |
| `eos` (offline only, last line) | — |

Coordinates are in the source frame's own pixel space. Consumers must treat
a `null` court position as "not plottable" rather than substituting a
default — substituting the rim is what once stacked every shot on one spot.

---

## Pipeline A — live session

```
browser camera ──getUserMedia──> LiveVideo.tsx
       │
       │  WebRTC (browser is the MASTER; SDP/ICE via the relay)
       ▼
js/mock-websocket.js  <──ready/offer/answer/ice──>  follow_through_webrtc
                                                      │ H.264 track → libavcodec → frame queue
                                                      │ detection + shot state machine
                                                      ▼
                       DataChannel (created by the backend) ──telemetry per frame──> browser
                                                                                        │
                                                          applyFrame / applyShotEvent   ▼
                                                          renderFromPersistent(canvas)  (video + overlay in ONE canvas)
                                                                                        │
                                              canvas.captureStream() → MediaRecorder → upload → POST /sessions/{id}/videos
```

- `services/webrtc-live.ts` (`WebRTCLiveSession`) owns the
  `RTCPeerConnection` and relay client. Two rules are load-bearing: the
  offer is sent only once the relay forwards the backend's `ready` message
  (the native process can connect before the browser does, and a
  send-on-open would broadcast into an empty room), and telemetry is read
  from the DataChannel the **backend** creates, because a channel received
  via `ondatachannel` can finish opening before its handler is registered.
  Connection attempts time out after `CONNECT_TIMEOUT_MS` (20 s) and are
  retried with backoff (`services/webrtc-backoff.ts`).
- The backend answers viewers one after another: on `FAILED` /
  `DISCONNECTED` / `CLOSED` its signaling thread tears the peer connection
  down, flushes the decoder, drains the frame queue and rebuilds
  (`restartSession`); `readyRetryLoop` advertises `ready` for the life of
  the process and goes quiet while a session is up. Detection state (makes,
  misses, shot history) survives a reconnect on purpose: it is the same
  training session, and a reloaded browser resynchronises to the pipeline's
  running totals.
- The frame queue is two deep, so a slow inference loop applies
  backpressure instead of drifting away from real time. The backend
  measures the stream's frame rate from the arrival interval of the
  decoded frames, so timings follow the real camera rate.
- The browser asks for the back-facing camera at 4K60 as a preference,
  puts H.264 first in the codec preference (the codec phones encode in
  hardware), caps the upload at 40 Mbit/s so 4K is not downscaled on a
  LAN, and reads the sender's encoder statistics (implementation, output
  size, rate, encode time per frame) into `hooks/use-live-health.ts`,
  which the Live page shows under the clock. The backend decodes with
  NVDEC when libavcodec has it.
- On the page, **every number comes from the DataChannel**: the score bug
  and counters (`hooks/use-live-score.ts`), the shot feed
  (`components/video/ShotFeed.tsx`), the running-percentage chart and the
  Eagle-Eye markers (`lib/live-shot.ts`). `hooks/use-live-health.ts` and
  `lib/live-status.ts` derive the badge from whether telemetry and the
  camera clock are both moving, so it can only say *Live* when they are.
  `hooks/use-screen-wake-lock.ts` keeps a propped phone from locking.
- **Recording** is the live canvas (`captureStream` + `MediaRecorder`), so
  the saved file carries the overlay as it was drawn during the session.
  When the session ends the browser asks for an upload URL
  (`POST /videos/upload-url`), `PUT`s the blob, then ingests it with the
  pipeline's own totals (`POST /sessions/{id}/videos`, `VideoIngestRequest`)
  so nothing is re-processed.
- Live sessions currently attach to a fixed seeded session
  (`LIVE_SESSION_ID = "session-001"` in `routes/live.tsx`); creating a
  session per live run is an open item in `BACKLOG.md`.

### What is real vs. stand-in

| Piece | Today |
|---|---|
| Media and DataChannel transport | real — KVS WebRTC C SDK `PeerConnection` / `DataChannel` |
| Signaling | **local relay** (`js/mock-websocket.js`), not AWS. The C++ links `kvsWebrtcClient` only, not `kvsWebrtcSignalingClient`; swapping in real signaling is confined to `webrtc-live.ts` and the C++ signaling loop |
| Overlay | drawn in the browser from the DataChannel; the backend draws nothing |

---

## Pipeline B — uploaded video

```
browser: pick a file ─> POST /videos/upload-url ─> PUT bytes to uploadUrl
                     ─> POST /sessions/{id}/videos/process ─> 202, status=QUEUED
                                          │
                              VideoProcessingRunner (@Async)  status=PROCESSING
                                          │
                                  CppVideoProcessor
                        ┌─────────────────┴─────────────────┐   (started TOGETHER)
                        ▼                                   ▼
          follow_through_batch_gpu (C++)          prepare-playback.ts (Node)
            writes telemetry.jsonl   ──tails──>     waits for metadata, reads frames
            flushes every 30 frames                 until the first shot apex, then:
            ends with {"type":"eos"}                  ├─ ffmpeg seek + 1 frame = gallery thumbnail
                                                      │    (footage only — no overlay on it)
                                                      └─ IF the codec is one no browser decodes
                                                         (HEVC from a phone): an H.264 copy,
                                                         written BESIDE the upload

                        The uploaded recording is NEVER modified.
```

Then, back in Java: `TelemetryJsonlParser` turns the file into the
aggregate `ProcessingResult` (shots, shooting percentage, average distance,
duration and time to apex) plus the ordered message stream;
`VideoProcessingTransactions` applies the result to the video, rolls the
totals up into the parent session, stores the stream through
`TelemetryStore` (`RelationalTelemetryStore`, a `VideoTelemetryRecord` per
video), relocates the thumbnail into storage and records the playback
copy's key if one was made; status becomes `COMPLETE`, or `FAILED` if either
subprocess fails, times out or cannot start (`VideoProcessingException`).
The gallery polls while anything is `QUEUED`/`PROCESSING`.

Detection is awaited first: if it fails, the preparation script is killed
immediately rather than left waiting on a file nobody will finish.

`followthrough.processing.engine=stub|cpp` selects `StubVideoProcessor`
(the default: invents plausible numbers, produces no telemetry, thumbnail or
playback copy, and is what every test runs against) or `CppVideoProcessor`.
The API always invokes the GPU binary
(`followthrough.cpp.binary-path=../cpp/build/follow_through_batch_gpu`).

### The telemetry file is a streaming contract

`follow_through_batch_gpu` writes JSONL and `prepare-playback.ts` reads it
**while it is still being written**. Three rules make that safe:

1. **The first line is `{"type":"metadata", ...}`** with fps and frame
   size. The preparation script blocks on it, because it needs fps to turn a
   frame id into a seek offset.
2. **The file is flushed every 30 frames** (`TELEMETRY_FLUSH_FRAMES`). The
   script only needs the stream up to the first shot apex, so the interval
   sets how soon after that apex the thumbnail (and any transcode) can
   start — about 0.3 s — not throughput.
3. **The stream ends with `{"type":"eos"}`.** Completion is *not* inferred
   from EOF: while the producer is alive, EOF only means "nothing written
   yet". A file that goes silent for 30 s without the marker is treated as a
   **failure**, so a detector that dies mid-video cannot pass as one that
   finished early.

### Playback renditions, and why they exist

Phones shoot HEVC, and no Chromium-based browser decodes it:
`canPlayType('video/mp4; codecs="hvc1"')` returns the empty string and the
element reports `videoWidth === 0`, which draws as a black rectangle with a
correct overlay floating on it. So `prepare-playback.ts` transcodes
**deliberately and conditionally**:

- `needsPlaybackRendition` (`src/lib/playback-format.ts`) allow-lists the
  codecs known to play; an unrecognised codec costs one unnecessary
  transcode, whereas guessing the other way ships a black player.
- The copy (`libx264`, high profile, `yuv420p`, `veryfast`/CRF 23,
  `+faststart`, AAC audio when the source has audio) is written beside the
  upload as `<key>-playback.mp4`, recorded on `VideoAsset.playbackStorageKey`
  and returned by `GET /videos/{id}/playback-url`. `storageKey` still points
  at the untouched original.
- It is capped at a 1920 long edge, only ever downwards, and only when a
  re-encode was already unavoidable.

Measured on a 28 s 3840×2160 HEVC upload: 11 s, 172 MB down to 22 MB. An
upload that is already H.264/VP9/AV1 is not re-encoded at all.

### Playback with the overlay

`GET /videos/{id}/telemetry` returns the stored stream.
`components/video/TelemetryOverlayCanvas.tsx` lays a transparent canvas
over the `<video>` and draws it with `renderOverlayFromPersistent`.
`lib/overlay-replay.ts` keeps a cursor into the stream: moving forward
applies the frames in between, as live does, and a jump backwards rebuilds
the state from a bounded window (`REBUILD_WINDOW`, 360 frames — longer
than any shot, which is the longest-lived thing in the state) rather than
from the start, seeding the court keypoints from the last frame that
carried any. The overlay therefore takes
the viewer's current theme (`lib/overlay-palette.ts`, `setOverlayAccent`),
and its panels are placed per recording by `lib/overlay-panels.ts` /
`hooks/use-overlay-panels.ts` so they avoid the hoop; the viewer can drag
them and the choice is remembered. `DownloadOverlayButton` /
`lib/overlay-export.ts` composites video and overlay into a downloadable
file in the browser, in real time, for anyone who wants a copy with the
analysis on it.

### Shots on the client

The backend stores no shot-level rows. `lib/telemetry-shots.ts` derives
`Shot` records from a video's stream (`shot_event`s, with the release
position converted from pipeline feet to court metres by
`services/court-geometry.ts` and classified into zones); `hooks/use-session-shots.ts`
and `hooks/use-all-shots.ts` gather them for one session or the whole
library, and every chart reads those. Human corrections to a detected shot
(`services/shot-corrections.ts`, `hooks/use-shot-corrections.ts`) are
client-only and last for the page load; the UI says so. Corrections need a
backend endpoint to persist (`BACKLOG.md`).

---

## The shared renderer

`follow-through-pro-19/src/lib/overlay-renderer.ts` is the single source of
truth for what the overlay looks like. Nothing else draws overlay graphics.
It is a pure drawing + state module: `makeFreshPersistentState()`,
`applyFrame()`, `applyShotEvent()` accumulate shot counts, per-category
records, the ball trail (a least-squares ballistic arc fitted to the
tracked points), streaks, recent form and animation timers; two draw entry
points differ only in what sits behind the overlay:

| Entry point | Background | Used by |
|---|---|---|
| `renderFromPersistent(ctx, videoEl, state, viewport, layout)` | draws the video frame | live session (`FollowThroughOverlay.tsx`) — one canvas so `captureStream()` records both |
| `renderOverlayFromPersistent(ctx, state, viewport, layout)` | transparent | playback (`TelemetryOverlayCanvas.tsx`) — sits over the `<video>` |

Rules for anyone editing it:

1. **All animation is driven by `frame_id`, never wall-clock time.** Live
   draws as messages arrive; playback replays the stream as fast as the
   machine allows on a seek. `frame_id` is the video's own clock and makes
   both agree.
2. **Everything is authored against a 2160-px short edge** (`OverlayViewport`);
   a portrait clip keeps the same short edge and a taller long edge, so
   every hard-coded size keeps its meaning at either shape.
3. **No font family in a stack may begin with a hyphen** (`-apple-system`):
   a Canvas2D implementation that rejects the whole string falls back to
   10 px sans-serif silently.
4. **Draw state is per-frame; don't cache derived geometry across frames**
   unless it is keyed by something frame-invariant (the glyph-width cache
   is safe because advance width is a pure function of font and glyph).
5. Theme colours go through `warm()`; hoisting an accent into a
   module-level constant freezes it at import time, before any theme is
   applied (`overlay-theming.test.ts` proves the theme reaches the pixels).

---

## Data, storage and the API

### Persistence (Spring Boot)

| Entity | What it holds |
|---|---|
| `User` + `UserPreferences` | account, tier, usage counters, chart/notification preferences, and the opaque `usabilitySettings` JSON document |
| `TrainingSession` | name, date, duration, type, location, and the rolled-up stats (`shots`, `makes`, averages, status) |
| `VideoAsset` | title, date, duration, size, status, `storageKey` (the untouched upload), `playbackStorageKey`, `thumbnailUrl`, analysed-shot stats |
| `VideoTelemetryRecord` | the ordered telemetry stream and fps for one processed video (`TelemetryStore`) |
| `CalendarEvent` | scheduled training; may link to a session. The calendar form refuses two sessions at the same time (`lib/session-conflicts.ts`); the API does not check overlaps itself |

The database is **H2 on disk** (`springboot/local-data/`), so the library
survives restarts; deleting that directory starts clean and re-runs
`DataSeeder`, which seeds a demo account (`patrick.doyne@followthrough.app`
/ `followthrough-dev`) with sessions, videos and events **only when the
users table is empty**. Tests run against in-memory H2. The PostgreSQL
driver is on the classpath but not configured.

Files live in `springboot/local-video-storage/` behind two seams that
stand in for S3 presigned URLs: `LocalUploadUrlService` hands out
`PUT /videos/local-blob/{storageKey}` (authenticated) and
`LocalPlaybackUrlService` hands out `GET /videos/local-blob/{key}` (public,
because a `<video src>` cannot carry a bearer token and a real presigned
URL carries its auth in the URL). Deleting a video removes the upload, its
playback copy, its thumbnail and its telemetry, then recounts its session.

### REST surface (`/api/v1`, bearer JWT except where noted)

| Method and path | Purpose |
|---|---|
| `POST /auth/register`, `POST /auth/login` | public; return a token and the profile |
| `GET`/`PUT /users/me` | profile and preferences (`preferences` is a partial patch) |
| `GET /sessions`, `POST /sessions`, `GET`/`PUT`/`DELETE /sessions/{id}` | training sessions (unpaginated on purpose: the dashboard and pickers need them all) |
| `GET /sessions/{id}/videos` | a session's videos |
| `POST /sessions/{id}/videos` | ingest a live recording with known stats |
| `POST /sessions/{id}/videos/process` | queue an upload for offline processing |
| `GET /videos?page&size`, `GET`/`PUT`/`DELETE /videos/{id}` | the library (the one paginated resource) |
| `GET /videos/{id}/telemetry`, `GET /videos/{id}/playback-url` | stored telemetry; a short-lived playback URL, fetched right before playing |
| `POST /videos/upload-url` | somewhere to `PUT` a recording |
| `PUT`/`GET /videos/local-blob/{key}` | the local stand-in for S3 (PUT authenticated, GET public) |
| `GET /analytics/summary`, `GET /analytics/shooting` | lifetime totals with recent-vs-prior deltas; per-session series |
| `GET`/`POST /calendar/events`, `PUT`/`DELETE /calendar/events/{id}` | calendar, with `from`/`to` for a date window |
| `GET /actuator/health`, `/swagger-ui/index.html`, `/v3/api-docs` | health, interactive docs, OpenAPI |

Errors are RFC 7807 problem details (`GlobalExceptionHandler`), with
`fieldErrors` on validation failures; the frontend's `services/http.ts`
turns them into `ApiError`. Every query is scoped to the caller's account:
a resource that belongs to someone else looks identical to one that does
not exist. Auth is HS256 JWT (`JwtService`, subject = user id, 24 h); the signing
secret comes from the `FOLLOWTHROUGH_JWT_SECRET` environment variable and
has no default. CORS allows `http://localhost:8081`.

### Swappable seams (local stand-ins for AWS)

| Interface | Local implementation | Eventual |
|---|---|---|
| `UploadUrlService` / `PlaybackUrlService` / `VideoFileStore` | `Local*` + `LocalBlobStorageController` | S3 presigned URLs |
| `TelemetryStore` | `RelationalTelemetryStore` (H2/JPA) | one document per video in a NoSQL store |
| `VideoProcessor` | `StubVideoProcessor` (default) / `CppVideoProcessor` | unchanged |
| signaling | `js/mock-websocket.js` | KVS signaling channel |
| database | H2 on disk | Postgres |

---

## CPU vs GPU detection tiers

`cpp/follow-through-batch.cpp` builds twice from one source through a
compile-time backend switch:

| Target | Backend | Links CUDA | Detection time, reference clip |
|---|---|---|---|
| `follow_through_batch_gpu` | TensorRT `.engine` | yes | 18.5 s wall (≈ 10 ms/frame of pipeline compute, ≈ 100 fps) |
| `follow_through_batch_cpu` | ONNX Runtime, `.onnx` exports | **no** (verified with `ldd`) | 66.8 s wall (≈ 44 ms/frame, ≈ 23 fps) |

Reference clip: `python/videos/train3/burkelake8.MOV`, 28 s of 3840×2160
at 60 fps, 1,674 frames, five shots. Both binaries produce the same five
shots with the same results and designations on it (measured 29 September
2026; release positions agree to within a few hundredths of a foot). One source rather than two files because the backends
differ only in the engine class; two *binaries* because the CPU one must
not link `libcudart` at all or it would fail to start on Fargate.

**Why ONNX Runtime and not `cv::dnn`.** OpenCV 4.10 has no `TopK`
operator, and every export contains one because Ultralytics bakes NMS into
the graph. A custom `TopK` layer got close, but the surrounding integer
`Div`/`Mod` on the returned indices does not behave to spec in 4.10, so
rows were mis-associated: right boxes, wrong classes, zero shots detected.
ORT implements the full spec and was also ~3.8× faster than `cv::dnn` had
been. It is vendored at `cpp/third_party/onnxruntime` (CPU-only build) and
linked with an rpath so the binary finds it without `LD_LIBRARY_PATH`.

The intended deployment is GPU (`g*` instances) for live and CPU on Fargate
spot for uploads; the CPU binary exists, but the API only invokes the GPU
one and there is no container packaging yet (`BACKLOG.md`).

---

## Frontend structure

- **Routes** (`src/routes/`, file-based): `/` dashboard, `/analytics`,
  `/calendar`, `/live`, `/login`, `/register`, `/settings`,
  `/sessions/$sessionId`, `/videos`, `/videos/$videoId`. `__root.tsx` is
  the shell and the provider stack.
- **Data access**: `services/http.ts` (transport, bearer token, `ApiError`)
  → `services/followthrough.ts` (one function per endpoint) →
  `services/queries.ts` (TanStack Query options) → routes and components.
  Components never call `fetch`.
- **Provider order**, load-bearing, in `__root.tsx`: Query → Auth →
  Settings → Notifications → Undo → Commands. Settings needs auth (whether
  to sync to an account), notifications need settings (quiet hours,
  duration, sound), undo needs notifications (the undo toast), commands
  need all three.
- **Theme**: `styles.css` holds the tokens, with light, dark and
  high-contrast variants; `lib/theme.ts` turns a three-colour triad into a
  full palette using `lib/theme-recipe.ts`, which
  `scripts/gen-theme-recipe.ts` extracts from `styles.css`;
  `scripts/gen-theme-properties.ts` generates `src/theme-properties.css`
  (the `@property` registrations that make the tokens animatable). Both
  generated files are committed. `styles.contrast.test.ts` parses the CSS,
  converts oklch to sRGB and asserts WCAG ratios.
- **Brand**: `public/brand/` and the favicons are derived from
  `brand-source/followthrough-logo.png` by `scripts/gen-brand-assets.ts`;
  `components/brand/BrandMark.tsx` draws the crest.

### Usability, accessibility and preferences

One versioned, typed document (`src/state/settings.ts`, `SETTINGS_VERSION = 2`)
holds every preference describing how the product should look and behave for
one person: theme, text size, density, contrast, reading mode, motion,
captions, sound and haptics, toast duration, undo behaviour, draft
auto-save, session timeout, language, regional formats, notification
delivery and keyboard bindings. It is read through `SettingsProvider` /
`useSettings()` and edited on the Settings page's **Usability** tab.

**Storage: local first, account second.** `localStorage` is the first read,
because it is the only store readable synchronously before first paint. When
signed in, `settings-sync.ts` reconciles with the account exactly once per
session: on the first successful account load the server's document wins
(**adopt**), and after that local edits are authoritative and written back,
debounced by 800 ms (**push**). Adopting only once matters — adopting on
every fetch would let a background refetch overwrite a change made seconds
earlier. Signing out re-arms adoption. Sync failures are silent by design.
The server stores the whole document as one opaque JSON string
(`UserPreferences.usabilitySettings`), because the client already owns the
schema, its version and its migrations.

**Migration.** `migrateSettings()` coerces field by field: an unreadable
value falls back to that field's default rather than discarding the object.
Numbers are clamped, time zones are validated against `Intl`, and the
shortcuts map drops prototype keys.

**No flash on load.** `settings-boot.ts` generates a synchronous script that
`__root.tsx` inlines into `<head>`; it applies theme, `color-scheme`,
density, contrast, motion, reading mode and root font size to `<html>`
before the browser paints. It necessarily duplicates `applyDocumentChrome()`
(a render-blocking inline script cannot import a module), so
`settings.test.ts` sweeps all 432 pre-paint combinations across the four
OS-preference combinations and asserts both paths produce identical DOM
state.

**How each preference reaches the pixels:**

| Preference | Mechanism |
| --- | --- |
| Theme | `.light` / `.dark` on `<html>`; accent presets via `data-accent` |
| Text size | Root `font-size` in px; everything downstream is `rem` |
| Density | Overrides Tailwind v4's single `--spacing` token (7/8 and 9/8 of default) |
| High contrast | `data-contrast="high"` re-points border, muted-foreground and primary tokens, and thickens `:focus-visible` |
| Motion | `data-motion="reduce"` collapses durations to `0.01ms` (not `none`, so `transitionend` still fires). UI chrome only: the analysis overlay is content, and its animation is driven by the video's own frame clock |
| Reading mode | `data-reading="on"` hides the sidebar and caps the page container at 78ch |
| Captions | `applyCaptionStyle()` publishes custom properties consumed by `video::cue` (no caption data exists yet) |
| Toast duration | `AppToaster` reads `TOAST_DURATION_MS`; "until dismissed" forces the close button on |

**Language and regional format are separate settings.** `i18n.ts` owns the
interface language (English is the source of truth; es/fr/de cover the
shell, headings, shared states and the settings surface, and the Usability
tab shows the live coverage count); `intl.ts` owns dates, times and numbers,
published to a module-level slot so the ~110 `fmt*` call sites stay plain
functions. `format.test.ts` pins US output byte-for-byte.

**Commands and shortcuts.** `shortcuts.ts` is pure (registry, combo
normalisation with Ctrl and Cmd folding to `mod`, conflict detection);
`state/commands.tsx` binds handlers and owns the global key listener. Only
overrides are persisted, and an explicit empty string means "deliberately
unbound".

**Undo instead of confirmation.** `state/undo.tsx` defers the irreversible
call rather than reversing it: the UI updates immediately, the real commit
fires when the window expires, and undoing cancels it. A tab killed
mid-window cannot be flushed reliably; the failure direction is that the
item is *not* deleted, which is the safe one.

**Notifications** all go through `useNotify()`, so quiet hours, snooze,
duration and sound are honoured; a suppressed notification is still
recorded in the history panel, and `urgent` ones (undo, a failed delete)
are never suppressed.

**Route-change focus** (`RouteAnnouncer`) moves focus to the new page's
`<h1>` and announces it through an `aria-live` region; both are toggleable.

**Contrast is measured, not eyeballed.** `styles.contrast.test.ts` asserts
4.5:1 for text pairs and 3:1 for component boundaries and focus indicators
across all palettes. The dark theme's `--input` was raised to
`oklch(0.51 …)` after its outline measured 1.42:1; the dark
`--muted-foreground` (`oklch(0.68 …)`) is still below 4.5:1 on the
background and is left as an open item (`BACKLOG.md`), which high-contrast
mode already remedies.
