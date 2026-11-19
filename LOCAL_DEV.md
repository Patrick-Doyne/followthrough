# FollowThrough — Local Dev Runbook

How to run the whole local stack on this machine: the signaling relay, the
C++ live backend, the frontend dev server and the Spring Boot API with the
real offline-processing engine. `ARCHITECTURE.md` explains what each piece
does; `cpp/README.md` covers building the native side.

Last checked on 18 November 2026.

## The processes

| # | Process | Directory | Command | Listens on / connects to |
|---|---|---|---|---|
| 1 | Signaling relay | `js/` | `node mock-websocket.js` | `ws://localhost:8080` |
| 2 | C++ live backend | `cpp/build/` | `./follow_through_webrtc` | connects to the relay as the viewer |
| 3 | Frontend dev server | `follow-through-pro-19/` | `npm run dev` | `http://localhost:8081` (see the port note) |
| 4 | Spring Boot API | `springboot/` | `./mvnw spring-boot:run -Dspring-boot.run.jvmArguments="-Dfollowthrough.processing.engine=cpp"` | `http://localhost:8082/api/v1` |

Start them in this order the first time. The relay and the API are
independent of each other; the frontend needs the API for everything except
the login page's chrome, and the Live page needs the relay and the C++
backend as well.

### 1. Signaling relay

```bash
cd js
npm install        # once; it only needs `ws`
node mock-websocket.js
```

Ready when it prints `Local signaling relay listening on ws://localhost:8080`.
It is stateless and just forwards each client's messages to every other
client. It never needs restarting.

### 2. C++ live backend

```bash
cd cpp/build
./follow_through_webrtc
```

Must be run from `cpp/build/`: it loads the TensorRT engines by paths
relative to that directory (`../../python/runs/.../best.engine`,
`../../python/yolo26n-pose.engine`). Ready when it prints

```
All three engines ready.
...
[KVS] Peer connection ready. Waiting for offer from master...
```

It stays up across sessions: when a browser disconnects or a session fails
it logs `Session failed` → `Rebuilding peer connection` → `Ready for a new
viewer` and answers the next offer. Stop it with Ctrl+C or
`pkill -SIGINT -f follow_through_webrtc` (SIGINT, not `kill -9`, so it shuts
down through its own signal handler). Rebuild after editing either C++
source — see `cpp/README.md`.

### 3. Frontend dev server

```bash
cd follow-through-pro-19
npm install        # once
npm run dev
```

**Port note:** `npm run dev` pins Vite to **8081** (`vite dev --port 8081`
in `package.json`), because the relay holds 8080 and the API's CORS
allow-list is `http://localhost:8081` (`followthrough.cors.allowed-origins`
in `application.properties`). If something else already holds 8081, Vite
moves to the next free port and the API will reject the app's requests;
free the port or add the new origin to the allow-list.

`.env.local` points the app at the API (`VITE_API_BASE_URL=http://localhost:8082/api/v1`,
which is also the built-in default). `VITE_SIGNALING_RELAY_URL` overrides
the relay address (default `ws://localhost:8080`).

### 4. Spring Boot API

```bash
cd springboot
export FOLLOWTHROUGH_JWT_SECRET="$(openssl rand -base64 48)"   # any 32+ byte string; keep it for the session
./mvnw spring-boot:run -Dspring-boot.run.jvmArguments="-Dfollowthrough.processing.engine=cpp"
```

Ready when it prints `Started FollowthroughApiApplication`. The JWT signing
secret has no default on purpose: the API refuses to start without
`FOLLOWTHROUGH_JWT_SECRET`, and every issued token is invalidated when it
changes, so keep the same value for as long as you want existing sign-ins
to work. Tests supply their own value through the Maven surefire
configuration. Everything is
under the `/api/v1` context path:

```bash
curl http://localhost:8082/api/v1/actuator/health     # {"status":"UP"}
```

- Swagger UI: `http://localhost:8082/api/v1/swagger-ui/index.html` (spec at
  `/api/v1/v3/api-docs`).
- **Port 8082 is pinned** because 8080 is the relay and 8081 is Vite.
- **`-Dfollowthrough.processing.engine=cpp`** makes uploads run the real
  pipeline: `cpp/build/follow_through_batch_gpu` for detection (add
  `-Dfollowthrough.cpp.binary-path=../cpp/build/follow_through_batch_cpu`
  to use the CPU detector instead, as `WALKTHROUGH.md` does) and
  `follow-through-pro-19/scripts/prepare-playback.ts` (via `npx tsx`, so the
  frontend's `npm install` must have run) for the thumbnail and, when the
  codec is one no browser plays or the file carries a rotation flag, an
  upright H.264 copy. Without the flag the
  default `StubVideoProcessor` invents numbers and produces no telemetry,
  which is what the tests use. Neither engine ever modifies the uploaded
  file.
- **The database is H2 on disk** at `springboot/local-data/`, so sessions
  and the video library survive restarts; uploads, playback copies and
  thumbnails are under `springboot/local-video-storage/`. Delete
  `local-data/` (and, if you want the files gone too, `local-video-storage/`)
  to start clean. On an empty database `DataSeeder` creates the demo
  account **`patrick.doyne@followthrough.app` / `followthrough-dev`** with
  sample sessions, videos and calendar events. The seeder runs only when
  the users table is empty, so an existing `local-data/` keeps whatever
  password it was created with — if the demo login is rejected on an old
  checkout, that is why; there is no password-change endpoint yet.

### 5. Use it

Open `http://localhost:8081` in a browser and sign in with the demo
account. For a live session, open `/live` **on a machine with a camera**
(this environment is WSL2; a browser on the Windows host reaches
`localhost` through the automatic forwarding and uses the Windows webcam)
and click **Start session** — nothing connects until then; starting also
creates a training session for the run (unless it is a practice run).
**End session** stops the recording, uploads it with a progress toast and
queues it for the upload pipeline; the gallery shows it as processing until
that pass finishes, and its numbers are the offline pass's, not the live
preview's. Shot corrections made during the session are not carried over.
The backend serves **one live viewer at a time**: a second browser, or
`scripts/live-check.mjs` run during a phone test, makes the running session
fail.

For an upload, use **Upload video** on `/videos`: the file is `PUT` to the
API, queued, and the gallery polls until processing completes. Measured on
29 September 2026 with the 28 s 4K60 HEVC reference clip
(`python/videos/train3/burkelake8.MOV`, 165 MB): the `PUT` took 0.4 s and
the video went from `QUEUED` to `COMPLETE` in 24 s, including detection on
the RTX 3090, the thumbnail and the H.264 playback copy (22 MB); five
shots, 60%, 1,680 telemetry messages stored, session totals rolled up.

## Tests and checks

```bash
cd follow-through-pro-19
npm test              # vitest run, one shot (48 files)
npm run test:watch
npx tsc --noEmit
npm run lint          # eslint; the remaining warnings are react-refresh notes
npm run build         # production build (also regenerates .output/ and .wrangler/, both gitignored)

cd springboot
./mvnw test           # unit + slice tests against in-memory H2
./mvnw verify         # tests plus a JaCoCo report at target/site/jacoco/index.html
./mvnw org.pitest:pitest-maven:mutationCoverage   # mutation testing, slow, run on demand
```

React component and hook suites opt into jsdom per file
(`@vitest-environment jsdom`); everything else runs in node.

### Screenshot harness

```bash
cd follow-through-pro-19
npm run shots -- <outDir> "/analytics,/videos,/settings?tab=profile"
```

`scripts/shoot.mjs` signs into the **running** dev server with the demo
account (override with `FT_EMAIL` / `FT_PASSWORD`, and `BASE` for the URL)
and captures each route at a laptop width in dark and light and at a phone
width. It needs the API up; Playwright and its Chromium come with the
frontend's dev dependencies.

## Known quirks worth knowing before you assume something is broken

- **On the phone, use Microsoft Edge.** It is the browser the live session
  currently works best in on an iPhone (same WebKit engine as Safari, but
  Safari differed on the camera's frame rate, on a recording's rotation
  flag and on page caching during testing). Fullscreen on an iPhone is a
  surface pinned over the page, since iOS has no element fullscreen
  (`hooks/use-fullscreen.ts`).
- **Start a live session with the phone upright.** The recording keeps the
  shape the phone had when the session started (the live page draws the
  camera upright into a canvas of that shape, `LiveVideo.tsx`), and a
  part shot after turning the phone is drawn inside that frame with black
  bars; the offline pipeline crops to the picture (`picture_rect` in
  `cpp/follow-through-batch.cpp`) and the player follows the crop. Starting
  in portrait gives the vertical part full resolution and the horizontal
  part a cropped one; starting in landscape does the reverse. Portrait is
  the orientation the sessions that matter are shot in.

- **20-second connect timeout.** If the C++ backend cannot be reached (not
  running, relay down), the Live page gives up after 20 s and shows a
  connection-issue card rather than hanging on "Almost ready"
  (`services/webrtc-live.ts`, `CONNECT_TIMEOUT_MS`), then retries with
  backoff.
- **One benign backend log line on disconnect.** Right after
  `[KVS] Peer connection CLOSED.` you may see one `dataChannelSend failed:
  0x...` — the last in-flight telemetry send losing to the closing
  connection. The process stays up and re-arms.
- **The live pipeline measures its frame rate** from the arrival interval
  of the decoded frames (a running average, warmed up over the first 30
  frames), so a 60 fps phone and a 30 fps webcam both get correct flight
  and apex times; the `[PERF]` lines print it as `stream_fps`. The browser
  asks for the back-facing camera at 1280×720 at 60 fps
  (`config/streaming.ts`, asked again on the open track because Safari
  opens at 30), and the backend's answer declares H.264 level 4.0, which a
  phone's encoder plans its rate from (the SDK's default 3.1 held 720p to
  30). It prefers H.264 (the codec phones encode in hardware) and shows the
  encoder it got (name, size, rate, ms per frame) under the clock.
- **The sender runs its own rate control.** The backend sends no bandwidth
  feedback, so the browser's estimate only falls. The sender starts at
  2 Mbit/s, floors at 1 Mbit/s, keeps its frame rate by shrinking the
  picture, and every 2 s cuts its cap when the round trip rises well above
  the link's lowest (`services/webrtc-live.ts`, logged as `rate cap` in the
  relay). A cellular uplink carries about 1 Mbit/s cleanly, so the live
  preview works on a smaller picture than the recording.
- **H.264 decode uses NVDEC** (`h264_cuvid`) when libavcodec has it, which
  the system package does under WSL2; otherwise it falls back to software
  decoding on four frame threads, which adds three frames of latency and
  is logged as such at startup. One NVDEC decoder follows a phone's
  resolution changes in place (its frame pool is pre-sized to NVDEC's
  ceiling; see cpp/README.md), so a stream that steps up from 720p a few
  seconds in no longer stalls the session.
- **Package manager.** The frontend uses npm and commits
  `package-lock.json`; there is no bun lockfile any more.

- **A phone's side of a session is in the relay's log.** The live page
  sends `diagnostic` lines to the relay (`lib/live-diagnostics.ts`):
  browser and camera, connection states, candidates and the selected
  path, the encoder's output every five seconds, and any page error. On a
  phone there is no console, so when a session misbehaves, read
  `grep diagnostic` on the relay's output (or `relay.log` in a
  deployment) next to the backend's log before guessing.

## Publishing the sample assets (maintainer note)

`scripts/fetch-demo-assets.sh` and `WALKTHROUGH.md` expect these files on
the GitHub release tagged `v1-local`, under exactly these asset names:

| Asset name | Local file |
| --- | --- |
| `burkelake8.MOV` | `python/videos/train3/burkelake8.MOV` |
| `detect-best.onnx` | `python/runs/detect/train/weights/best.onnx` |
| `court-keypoints-best.onnx` | `python/runs/pose/train-MuSGD-1/weights/best.onnx` |
| `yolo26n-pose.onnx` | `python/yolo26n-pose.onnx` |
| `detect-best.pt` (optional, `FETCH_PT=1`) | `python/runs/detect/train/weights/best.pt` |
| `court-keypoints-best.pt` (optional) | `python/runs/pose/train-MuSGD-1/weights/best.pt` |
| `yolo26n-pose.pt` (optional) | `python/yolo26n-pose.pt` |

The two `best.*` files share a basename, so copy them under the asset names
before uploading (the release page or `gh release upload` both keep the
file's own name). ONNX Runtime is fetched from Microsoft's releases and is
not part of ours.

## Running on an EC2 instance

`deploy/README.md` puts the same stack on one GPU instance behind Caddy and
a Cloudflare quick tunnel, as one container (Terraform and Docker) or as
systemd units. The two
settings that make that possible also apply locally: the backend reads
`FT_RELAY_HOST` / `FT_RELAY_PORT` (default `localhost:8080`) and
`FT_STUN_URL` (default Google's STUN server; `FT_TURN_URL` adds a relay),
and the web app, when served from anywhere but `localhost`, talks to its
own origin for the API (`/api/v1`) and the relay (`/relay`) unless
`VITE_API_BASE_URL` / `VITE_SIGNALING_RELAY_URL` say otherwise.
`npm run build:node` produces the node-server build those units run.

## Where things live

- `js/mock-websocket.js` — the relay.
- `cpp/follow-through-webrtc.cpp` — live backend; `cpp/follow-through-batch.cpp`
  — offline detection (GPU and CPU targets); `cpp/README.md` — toolchain,
  build, telemetry contract.
- `follow-through-pro-19/src/services/webrtc-live.ts` — the browser side
  of the live connection; `src/types/overlay-telemetry.ts` — the telemetry
  schema; `src/lib/overlay-renderer.ts` — the overlay; `src/components/video/`
  — live and playback surfaces; `scripts/prepare-playback.ts` — thumbnail
  and playback copy for uploads.
- `springboot/src/main/java/com/followthrough/api/` — controllers, services
  (`CppVideoProcessor`, `VideoProcessingRunner`, `TelemetryJsonlParser`,
  `RelationalTelemetryStore`, the `Local*` storage seams), JPA entities,
  security; `src/main/resources/application.properties` — ports, paths,
  engine selection.
- `python/` — models, training and the reference clips (`python/README.md`).

The whole tree is one git repository.
