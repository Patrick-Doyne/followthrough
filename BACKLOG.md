# FollowThrough backlog

Known gaps and future work, kept here so they survive across development
sessions. Delete an item once it ships. `ARCHITECTURE.md` describes what is
built; nothing below is.

Last reviewed against the code on 18 November 2026.

## Open

### Bugs found on 29 September 2026 (not yet fixed)

- **Deleting a session leaves its videos' derived files behind.**
  `TrainingSessionService.delete` removes the video rows directly
  (`videoRepository::delete`) instead of going through
  `VideoAssetService.delete`, so nothing on disk is removed for the
  cascaded videos — upload, playback copy and thumbnail all stay under
  `local-video-storage/sessions/{id}/`, and the telemetry record is left
  too (verified after `DELETE /sessions/{id}` on 29 September 2026). Route
  the cascade through the video service's delete, or remove the same
  three files and the telemetry record there.
- **Seeded videos have no telemetry, so every page that derives shots
  requests `GET /videos/{id}/telemetry` for them and logs a 404** (eight
  per page load with the demo library). Harmless — the client treats a
  missing stream as no shots — but noisy; either seed a small stream or
  skip the request for videos the seeder created.
- **Hydration-mismatch warnings in the dev console** on every route
  (`A tree hydrated but some attributes of the server rendered HTML didn't
  match`): the boot script sets theme attributes on `<html>` before React
  hydrates. Dev-only console noise, but worth suppressing at the source.

### Product and pipeline

- **Shot corrections are client-only.** `services/shot-corrections.ts`
  keeps a person's make/miss/false-positive overrides in memory for the
  page load, and the UI says so. Persisting them needs an endpoint of the
  shape already written in that file's header
  (`PUT`/`DELETE /sessions/{id}/shots/{sequence}/correction`) and a place
  to store them — the backend has no shot-level rows, only per-video
  telemetry streams. On the live page they are lost when the session
  ends: the saved session is scored by the offline pass over the
  recording (`routes/live.tsx`), which never sees them.
- **The live overlay is not delayed to match the loop latency.** The
  camera preview is drawn as soon as the frame is captured and the overlay
  when the telemetry for that frame returns, so the overlay trails the
  picture by the round trip. Holding the preview back by the measured
  delay and keying it to the frame id would align them.
- **ONNX Runtime 1.30.0 is no longer on Microsoft's GitHub releases** (the
  `v1.30.0` tag answers 404 as of 18 November 2026), so
  `scripts/fetch-demo-assets.sh` fails at that step and `WALKTHROUGH.md`'s
  CPU detector cannot be built from a fresh clone. The live container skips
  it (`FETCH_ORT=0`). Point the script at a release that exists and confirm
  the CPU binary still builds and matches the five-shot result.
- **CPU tier is built but not deployed.** `follow_through_batch_cpu` runs
  the ONNX exports on ONNX Runtime without CUDA (the Fargate shape), but the
  API only ever invokes the GPU binary. The GPU tier is packaged in
  `deploy/docker/Dockerfile` (the API in the container runs
  `follow_through_batch_gpu`); the CPU tier has no container.
- **Live capture above 720p60.** The backend answers H.264 level 4.0,
  which allows 720p at 60 but not 1080p at 60; that needs level 4.1 or
  above in `transceiverSetFmtp` (`cpp/follow-through-webrtc.cpp`) and a
  per-frame budget the detection loop does not have at 1080p60.
- **One live viewer per backend.** `follow_through_webrtc` ignores offers
  while a session is up, so a second phone (or `scripts/live-check.mjs`
  during a phone test) makes the running session fail. More viewers means
  a process per session (the planned ECS shape) or a multi-peer backend.
- **No bandwidth feedback from the backend.** The KVS WebRTC C SDK sends
  neither transport-wide congestion control nor REMB, so the browser's
  estimate only decays and `services/webrtc-live.ts` substitutes a
  round-trip-based control from the sender's own statistics. Real feedback
  would let the sender use what a link carries instead of inferring it.
- **A turned part of a live recording is kept at reduced resolution.**
  The recording keeps the shape the session started in and letterboxes
  the other orientation (`LiveVideo.tsx`); the offline pass crops to the
  picture (`picture_rect`), so that part is analysed at the letterboxed
  size. Full size for both would need a recording that can change shape
  mid-file, or one file per orientation.
- **Unused live-telemetry path in the API.** `POST /sessions/{id}/videos`,
  `PUT /videos/{id}/telemetry` and `LiveRecordingPreparer` stored a live
  session's own telemetry; no page calls them since the saved session goes
  through `/process`. Remove them, or keep them for a client that scores on
  the device.
- **The by-hand deployment runs the stub processor.**
  `deploy/systemd/ft-api.service` sets no processing engine, although
  `deploy/ec2-setup.sh` builds `follow_through_batch_gpu`; the container
  path runs it. Add the `--followthrough.processing.engine=cpp` and
  `--followthrough.cpp.*` flags from `deploy/docker/start-api.sh` to the
  unit to match.
- **C++ builds have no `CMAKE_BUILD_TYPE`**, so both binaries compile
  without optimisation flags. Before switching to `Release`, re-run the
  reference clip and confirm the shot outcomes and telemetry are unchanged,
  then re-measure.
- **Real signaling.** SDP/ICE go through `js/mock-websocket.js`; the C++
  links only `kvsWebrtcClient`, not `kvsWebrtcSignalingClient`. Swapping in
  a KVS signaling channel is confined to `services/webrtc-live.ts` and the
  C++ signaling loop.
- **Real storage and database.** Uploads live under
  `springboot/local-video-storage/` behind the `UploadUrlService` /
  `PlaybackUrlService` / `VideoFileStore` seams (S3 presigned URLs are the
  target); the database is H2 on disk with the PostgreSQL driver on the
  classpath but unconfigured.

### Accounts

- **Auth hardening**: rate limiting on `/auth/login`, logout and token
  revocation, a refresh-token flow.
- **Forgot / change password.** There is no password-change endpoint at
  all, which is also why an old `local-data/` database can hold a demo
  password that no longer matches the seeder's default. Prefer a free,
  well-known transactional email service if one fits; otherwise scaffold
  the tokens, endpoints and a send interface now and wire a real sender
  (AWS SES is the email service; SNS is pub/sub) later.
- **Email lookup is likely case-sensitive.** `findByEmail` /
  `existsByEmail` do a plain equality match; normalise (lowercase) on both
  register and login.
- **No roles or permissions.** Every account has identical, flat
  permissions. A "coach views their athletes" feature needs a real
  authorization model.

### Preferences with no consumer yet

- **Notification delivery.** `UserPreferences.notifications` and the
  usability settings' quiet hours, snooze and `digestFrequency` are
  captured and synced, but no email/push sender or digest scheduler exists.
- **Captions.** `captionsEnabled` and the caption styling are honoured by
  `video::cue`, but no caption data is produced anywhere.

### Frontend

- **Dark theme `--muted-foreground`** (`oklch(0.68 …)`) measures under
  4.5:1 on the dark background; raising it to about `oklch(0.78 …)` clears
  the text threshold. Left alone so far because it changes the established
  look; high-contrast mode already remedies it.
- **No search** across sessions, videos or events beyond date filtering and
  pagination; **no export** (CSV/PDF) of analytics or session history.

## Shipped (brief history, newest first)

- **18 Nov 2026 — deployed, and the phone made a real client.** One EC2
  GPU instance from Terraform and a single Docker image (supervisord, Caddy,
  Cloudflare tunnel), image in ECR. Live from an iPhone: 720p at 60 with the
  answer at H.264 level 4.0, a sender with its own delay-based rate control
  for cellular uplinks, a display-sized live canvas, and phone-side
  diagnostics in the relay's log. The live recording is the upright picture
  drawn into a canvas and is analysed by the offline pipeline, which
  auto-rotates and crops letterboxed frames to the picture. Upright playback
  copies for any rotation flag, recordings stored under their real type,
  page served no-cache. Phone layout: fullscreen on an iPhone, calendar,
  sessions list, filters; playback controls that fade.

- **29 Sept 2026 — mock layer removed; docs rewritten.** The frontend now
  talks only to the real API (`VITE_API_MOCKS`, the in-memory stores and
  the synthetic shot stream are gone); the html reference pages, the
  unused shadcn primitives and 22 npm dependencies were deleted; the dead
  ByteTrack tracker, class-name and skeleton tables and write-only
  histories were removed from both C++ sources (about 1,070 lines each)
  with byte-identical telemetry on the reference clip; the live backend no
  longer writes an unconsumed `telemetry_log.jsonl`.
- **Overlay drawn at playback, never burned in.** Processing writes
  telemetry, a thumbnail and (only for codecs no browser decodes) an H.264
  playback copy beside the upload; `TelemetryOverlayCanvas` draws the
  analysis over the `<video>` from the stored stream in the viewer's theme,
  with per-recording panel placement and a client-side download-with-overlay
  export. This removed the Node/ffmpeg compositor and about 88% of an
  upload's processing cost.
- **Live backend accepts viewers one after another** (peer connection
  rebuilt by the signaling thread on failure; detection state survives),
  and `shot_event` carries the shooter's court position at release.
- **Live page reads only the DataChannel**: score bug, counters, shot feed,
  running chart and Eagle-Eye markers all come from the detection pipeline;
  the badge is derived from telemetry and camera liveness; reconnection with
  backoff, health monitoring and a screen wake lock were added.
- **Offline pipeline**: `CppVideoProcessor` runs detection and playback
  preparation concurrently, with the telemetry file as a streaming contract
  (metadata first, flush every 30 frames, explicit `eos`). A CPU tier on
  ONNX Runtime was added after `cv::dnn` proved unable to run the exports.
- **Visual layer strip-back (26 Sept 2026)** — see
  `docs/decisions/2026-09-26-visual-layer-strip-back.md`.
- **Usability and accessibility pass**: the versioned settings document,
  no-flash boot script, contrast suite, i18n and regional formats,
  shortcuts and command palette, undo, notifications — see
  `ARCHITECTURE.md` § "Usability, accessibility and preferences".
- **REST CRUD, JWT auth, offline upload flow with polling, thumbnails from
  the first shot apex, seeded demo account.**

## Standing architecture decisions (for the AWS version)

Two decisions are settled and should not be re-litigated without new
information:

- **Shot telemetry goes to a non-relational store, not the relational
  database.** The relational database is for users, sessions, calendar
  events and other structured entities. Shot events go to a document or
  key-value store (DynamoDB-style) because the shot schema is expected to
  keep changing, ad-hoc queries over it are wanted, and new fields must be
  tolerable as nulls without relational migrations. Today's
  `RelationalTelemetryStore` is the local stand-in behind the
  `TelemetryStore` seam.
- **Live-session compute is one dedicated task per user session, not a
  shared GPU process.** An explicit start-session request from the frontend
  creates a KVS signaling channel and launches an ECS task running
  `follow_through_webrtc` for that session; the task ends with the session,
  so cost is paid only while one is active. Fargate has no GPU tasks, so
  this needs an EC2-backed ECS capacity provider with a GPU instance
  family. The trigger is the explicit request, never inferred from stream
  activity.
