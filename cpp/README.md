# FollowThrough — C++ pipeline

The native side of FollowThrough: the detection pipeline that turns
basketball footage into per-frame telemetry. This file covers what is here,
how to build and run it, the telemetry contract, and how the toolchain was
set up so it can be replicated on another machine. `../ARCHITECTURE.md`
describes how the binaries fit into the rest of the system.

Last checked on 29 September 2026.

## What is here

```
cpp/
├── CMakeLists.txt
├── README.md
├── follow-through-batch.cpp     # offline/upload detection: video file in, telemetry JSONL out
├── follow-through-webrtc.cpp    # live detection: WebRTC video in, telemetry on a DataChannel out
├── third_party/onnxruntime/     # ONNX Runtime CPU build for follow_through_batch_cpu; downloaded, not committed
└── build/                       # CMake-generated; not version controlled
```

| Target | Source | Inference | Links | Used by |
| --- | --- | --- | --- | --- |
| `follow_through_batch_gpu` | `follow-through-batch.cpp` with `-DCV_BACKEND_TENSORRT` | TensorRT `.engine` files | OpenCV, nvinfer, cudart | the Spring Boot API, once per uploaded video (`CppVideoProcessor`) |
| `follow_through_batch_cpu` | `follow-through-batch.cpp` | ONNX Runtime on the `.onnx` exports | OpenCV, onnxruntime — **no CUDA** | the intended Fargate tier; not yet wired into the API |
| `follow_through_webrtc` | `follow-through-webrtc.cpp` | TensorRT `.engine` files | OpenCV, nvinfer, cudart, KVS WebRTC C SDK (`kvsWebrtcClient`), libwebsockets, libavcodec/libavutil | the Live page, through the signaling relay in `../js/mock-websocket.js` |

The two sources share the detection and shot-state-machine code verbatim;
they differ in where frames come from (a file via `FrameReader`, or the
WebRTC track via `H264Decoder` into a bounded frame queue) and where
telemetry goes (a JSONL file, or the DataChannel). **Keep them in step when
changing either.**

### Models

Loaded by paths relative to `cpp/build`, so every binary must be run from
there:

| Model | Path (from `cpp/build`) | Job |
| --- | --- | --- |
| Detector | `../../python/runs/detect/train/weights/best.engine` / `.onnx` | backboard, basketball, net, player, rim |
| Court keypoints | `../../python/runs/pose/train-MuSGD-1/weights/best.engine` / `.onnx` | seven court landmarks for the homography |
| Pose | `../../python/yolo26n-pose.engine` / `.onnx` | shoulders, elbows, wrists of the shooter |

The `.engine` files are tied to the exact CUDA/TensorRT versions they were
built with (see "Confirmed working configuration"); `python/README.md`
explains how they were trained and exported.

## Build

```bash
cd cpp
cmake -S . -B build              # after CMakeLists.txt changes or a fresh checkout
cmake --build build -j"$(nproc)" # builds all three targets
cmake --build build --target follow_through_batch_gpu   # or one target
```

Notes:

- **ONNX Runtime (CPU tier only).** `follow_through_batch_cpu` links the
  ONNX Runtime 1.30.0 Linux x64 CPU release, which is not committed
  (30 MB of binaries). Download `onnxruntime-linux-x64-1.30.0.tgz` from
  the ONNX Runtime GitHub releases and extract it so that
  `cpp/third_party/onnxruntime/include/onnxruntime_cxx_api.h` and
  `cpp/third_party/onnxruntime/lib/libonnxruntime.so` exist. Without it
  CMake prints a status line and skips only that target; the two GPU
  targets build regardless.
- `CMakeLists.txt` expects the KVS WebRTC C SDK at `$HOME/kvs-webrtc-sdk`
  (section 7 below) and CUDA at `/usr/local/cuda-13.3`; edit the two
  variables at the top of the relevant blocks if either lives elsewhere.
- No `CMAKE_BUILD_TYPE` is set, so the binaries are built without
  optimisation flags. Switching to `Release` is an open item: re-run the
  reference clip afterwards and confirm identical shot outcomes before
  relying on it.
- A source-file rename needs `cmake -S . -B build` again, not just a build;
  a content-only edit does not.

## Run

```bash
cd cpp/build

# Offline: one video in, telemetry out. Prints SHOT STARTED / MAKE / MISS and [PERF] lines.
./follow_through_batch_gpu ../../python/videos/train3/burkelake8.MOV /tmp/telemetry.jsonl
./follow_through_batch_cpu ../../python/videos/train3/burkelake8.MOV /tmp/telemetry-cpu.jsonl

# Live: connects to the relay (ws://localhost:8080) and waits for the browser's offer.
./follow_through_webrtc
```

Reference clip `burkelake8.MOV` (28 s, 3840×2160, 60 fps, 1,674 frames,
five shots) on this machine's RTX 3090 and 32 cores, measured 29 September
2026: the GPU binary finishes in 18.5 s wall (the `[PERF]` line reports
≈ 10 ms of pipeline compute per frame, ≈ 100 fps); the CPU binary takes
66.8 s (≈ 44 ms/frame). Both produce the same five shots with the same
results and designations.

`follow_through_webrtc` prints `All three engines ready.` and then
`[KVS] Peer connection ready. Waiting for offer from master...`. It stays up
across sessions: after a viewer disconnects or a session fails it logs
`Session failed` → `Rebuilding peer connection` → `Ready for a new viewer`
and answers the next offer (see "Viewers one after another" below). Stop it
with SIGINT (Ctrl+C or `pkill -SIGINT -f follow_through_webrtc`).

## Telemetry

Both binaries emit the same JSON messages; the frontend's
`follow-through-pro-19/src/types/overlay-telemetry.ts` is the authoritative
mirror of the schema and the API's `TelemetryJsonlParser` reads the same
lines.

- **`frame`** — once per frame: `frame_id`, `frame_width`, `frame_height`,
  `potential_shot`, `shot_started`, `trail_frozen_at_rim`, `ball` (box,
  centre, `predicted` when coasted), `player`, `rim`, `net`,
  `court_keypoints` (only on frames where calibration changed), `pose`,
  `apex_point`, `player_distance_ft`, `player_speed_mph`,
  `player_stat_is_projected`, `shot_designation`, `time_to_apex`,
  `shot_duration`, `shot_distance_ft`. Coordinates are in the source frame's
  own pixels.
- **`shot_event`** — once per decided shot: `frame_id`, `result`
  (`make`/`miss`), running `makes`/`misses`, `shot_designation`,
  `court_x`/`court_y`, `shot_distance`, `shot_duration`, `time_to_apex`.
- **`metadata`** (offline only, first line): `fps`, `frame_width`,
  `frame_height`. **`eos`** (offline only, last line).

Shot designations by distance from the rim: `LAY_UP` < 5 ft, `CLS_RNG` <
10, `MID_RNG` < 19.9, `HS_3PT` < 22, `NCAA_3PT` < 23, else `NBA_3PT`
(`get_shot_designation`). The client owns the human-readable labels.

### `shot_event` carries the shooter's court position

`court_x` / `court_y` are the shooter's position **at release**, in feet, on
the rim-centred frame that `COURT_POINTS` defines (the frame the homography
solves for). Captured at release, not when the make or miss is decided —
that fires once the ball has settled at the rim, by which time the shooter
has usually moved. Both are `null` when the court had not calibrated or the
shooter was not detected at release; consumers must treat null as "not
plottable" rather than substituting a default (the frontend once
substituted the rim, which stacked every shot on one spot).

Verified against `burkelake8.MOV` — the distances implied by the
coordinates agree with the independently derived designations:

| Court position (ft) | Distance | Designation |
| --- | --- | --- |
| (8.48, -14.04) | 16.4 ft | `MID_RNG` |
| (-4.57, -3.31) | 5.6 ft | `CLS_RNG` |
| (-0.20, 0.87) | 0.9 ft | `LAY_UP` |

### The offline file is a streaming contract

`follow_through_batch_gpu`'s output is consumed **while it is being
written**: the API starts `prepare-playback.ts` alongside it, and that
script tails the file to find the first shot apex for the gallery
thumbnail. Three properties are load-bearing:

1. **The first line is `{"type":"metadata", ...}`** — the script blocks on
   it, because it needs `fps` to turn a frame id into a seek offset.
2. **The file is flushed every 30 frames** (`TELEMETRY_FLUSH_FRAMES`). The
   consumer only needs the stream up to the first apex, so this sets how
   soon after it the thumbnail can start (~0.3 s), not throughput.
3. **The stream ends with `{"type":"eos"}`.** Completion is *not* inferred
   from EOF — while the binary is alive, EOF only means "nothing written
   yet". A consumer that guessed from a timeout would silently treat a
   crashed detector as a finished one; the script instead fails after 30 s
   of silence without the marker.

## Viewers one after another (`follow_through_webrtc`)

The live pipeline used to answer exactly one offer per process. It now
recovers:

- `onConnectionStateChange` raises a flag on `FAILED` / `DISCONNECTED` /
  `CLOSED`, but only once a session was actually established, so it does
  not fight a handshake still in progress.
- The **signaling thread** owns the peer-connection lifecycle and performs
  the rebuild (`buildPeerConnection()` / `teardownPeerConnection()` /
  `restartSession()`). Tearing down from inside the SDK's own callback
  would be a use-after-free, and one owner means no lock around
  `gPeerConnection`.
- Teardown clears the data channel under its mutex first, then flushes the
  H.264 decoder and drains the frame queue — the next viewer sends a new
  stream, and a decoder still holding the previous SPS/PPS rejects its first
  IDR.
- `gAnswered` is cleared **last**, once the replacement connection exists.
- `readyRetryLoop` runs for the process lifetime and goes quiet while a
  session is up; the browser re-sends its offer on every `ready` it sees.

Detection state (makes, misses, shot history) deliberately survives a
reconnect: it is the same training session, and the client resynchronises
to the pipeline's running totals. Verified with a scripted viewer: a first
offer answered, ICE left to fail, `Session failed` → `Rebuilding peer
connection` → `Ready for a new viewer`, and a second offer answered by the
same process about 12 s later (the SDK's ICE failure detection, not the
rebuild).

Two more live-specific details: the backend creates the DataChannel itself
rather than relying on the one the browser creates, because a channel
received via `onDataChannel` can finish its open handshake before the
handler is registered; and the frame queue is two deep so a slow inference
loop applies backpressure instead of drifting away from real time. The
stream's frame rate is measured from the arrival interval of the decoded
frames (an exponential moving average, warmed up over 30 frames, reset on
every new peer connection) and printed on the `[PERF]` line as
`stream_fps`. The decoder is NVDEC (`h264_cuvid`, NV12 output) when the
system libavcodec provides it, with the per-frame decode time on the
`[PERF]` line; when it does not, the fallback is software decoding on four
frame threads, which adds three frames of latency and is logged at
startup.

## Confirmed working configuration

- **Platform**: WSL2, Ubuntu 26.04 LTS ("resolute")
- **GPU**: NVIDIA GeForce RTX 3090
- **Windows host driver**: 591.86 (reported as "Driver Version" by
  `nvidia-smi` inside WSL — the Windows driver passed through, not a
  separate Linux driver)
- **CUDA Toolkit**: 13.3 (update 1)
- **TensorRT**: 11.2.1.2, `cuda-13.3` package variant
- **OpenCV**: 4.10.0 (system package, `libopencv-dev`)
- **nlohmann/json**: whatever `nlohmann-json3-dev` ships on Ubuntu 26.04
- **ONNX Runtime**: 1.30.0 Linux x64 CPU build under
  `third_party/onnxruntime` (downloaded; see Build)
- **FFmpeg libraries**: system `libavcodec`/`libavutil` dev packages, for
  the live H.264 decoder
- **CMake**: 4.2 (the KVS SDK's sub-builds need
  `CMAKE_POLICY_VERSION_MINIMUM=3.5` exported — see gotchas)

The CUDA/TensorRT versions are **not arbitrary**: they match the versions
used on the Python side, because `.engine` files are tied to their exact
build environment. If the Python-side versions change, this whole chain
needs re-verifying.

## Environment setup

### 1. Compiler and CMake

```bash
sudo apt update
sudo apt install build-essential cmake
g++ --version && cmake --version
```

### 2. OpenCV (C++ dev package)

**Not the same as `pip install opencv-python`** — that is a private copy
bundled for Python only.

```bash
sudo apt install libopencv-dev
```

OpenCV does not need GStreamer support for anything here: the live binary
receives video through the KVS WebRTC C SDK and decodes it with libavcodec,
and the offline binary reads files with `cv::VideoCapture`.

### 3. CUDA Toolkit — WSL2 has a critical gotcha here

**Do not install the `cuda`, `cuda-13-x`, or `cuda-drivers` meta-packages
under WSL2.** WSL2 gets GPU access by stubbing in the *Windows host's* driver
as `libcuda.so`; the standard installer bundles a Linux driver that can
overwrite that stub and break GPU access entirely. Install the toolkit-only
package from the WSL-specific repository:

```bash
wget https://developer.download.nvidia.com/compute/cuda/repos/wsl-ubuntu/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt-get update
sudo apt-get -y install cuda-toolkit-13-3
```

Double-check any generated command uses `/repos/wsl-ubuntu/` and installs
`cuda-toolkit-13-3` specifically. `nvcc` is not on `PATH` afterwards:

```bash
echo 'export PATH=/usr/local/cuda-13.3/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=/usr/local/cuda-13.3/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc
nvcc --version    # 13.3.x
nvidia-smi        # must still show the same GPU/driver as before
```

**Do not** `sudo apt install nvidia-cuda-toolkit` — that is Ubuntu's own,
unrelated CUDA package and would introduce a second, conflicting install.

### 4. TensorRT C++ SDK

From NVIDIA's TensorRT download page, select version **11.2.1**, the
Ubuntu-version-matched local-repo DEB, and the **`cuda-13.3`** variant (not
`cuda-12.9`):

```bash
wget <exact URL from the download page>
sudo dpkg -i nv-tensorrt-local-repo-<ubuntu-version>-11.2.1-cuda-13.3_1.0-1_amd64.deb
ls /var/ | grep nv-tensorrt          # confirm the exact repo directory name
sudo cp /var/nv-tensorrt-local-repo-<exact-name>/*-keyring.gpg /usr/share/keyrings/
sudo apt-get update
sudo apt-get install tensorrt-dev
find /usr -name "NvInfer.h"          # /usr/include/x86_64-linux-gnu/NvInfer.h
```

`tensorrt-dev` pulls in `libnvinfer-dev`, the runtime libs and plugin
headers. The ONNX parser and Python packages are not needed (`.engine`
files are loaded directly) but are harmless.

### 5. CRITICAL: Ultralytics `.engine` files are NOT raw TensorRT engines

**Ultralytics prepends its own metadata to every exported `.engine` file.**
The on-disk format is a 4-byte little-endian `uint32` length, that many
bytes of JSON metadata, then the raw TensorRT engine. Handing the whole
file to `IRuntime::deserializeCudaEngine()` produces

```
Serialization assertion header.magicTag == kEXPECTED_MAGIC_TAG failed.
Trying to load an engine created with incompatible serialization
version (693 != 1953657958)...
```

which reads exactly like a CUDA/TensorRT version mismatch and is not one.
Chasing that reading cost real time (an "Enterprise" TAR distribution, three
different `libnvinfer.so` builds, all failing identically — which was the
clue). **The plain GA DEB package is sufficient.** The fix is to read the
length prefix, skip that many bytes and deserialize the remainder:
`read_engine_file()` in both sources does this, and it has to be replicated
anywhere an `.engine` file is loaded.

### 6. nlohmann/json

Both binaries build their telemetry with it — the per-frame payload is
nested (arrays of keypoints, many nullable fields) and hand-rolled string
concatenation is an easy way to emit unparseable JSON.

```bash
sudo apt install nlohmann-json3-dev
find /usr -name "json.hpp" -path "*nlohmann*"   # /usr/include/nlohmann/json.hpp
```

`CMakeLists.txt` includes the header directly rather than using
`find_package(nlohmann_json)`, because this distro's package did not ship a
usable CMake config.

### 7. AWS KVS WebRTC C SDK (live binary only)

Needed by `follow_through_webrtc` for its `PeerConnection` / `DataChannel`
primitives; the batch binaries do not use it. **Only `kvsWebrtcClient` is
linked, not the AWS-specific `kvsWebrtcSignalingClient`**: during local
development SDP offers/answers and ICE candidates go through the relay in
`../js/mock-websocket.js`, and real signaling is a later, isolated swap.

The SDK builds its own dependencies (OpenSSL, libsrtp, libusrsctp,
libwebsockets, libjsmn) from source; what is needed ahead of time is the
toolchain:

```bash
sudo apt-get install cmake m4 pkg-config libssl-dev libcurl4-openssl-dev liblog4cplus-dev
```

Clone and build **outside this project's folder tree, in a path with no
spaces** (see gotchas: OpenSSL's build script breaks on a space anywhere in
the path):

```bash
export CMAKE_POLICY_VERSION_MINIMUM=3.5     # needed with CMake 4.x, see gotchas
SDK_DIR="$HOME/kvs-webrtc-sdk"
git clone https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-c.git --single-branch -b main "$SDK_DIR"
mkdir -p "$SDK_DIR/build" && cd "$SDK_DIR/build"
cmake ..
make
grep ENABLE_DATA_CHANNEL "$SDK_DIR/CMakeLists.txt"   # must be ON
find . -name "libkvsWebrtcClient*"                    # the library CMakeLists.txt links
```

The build produces `libkvsWebrtcClient.so` and
`libkvsWebrtcSignalingClient.so` as separate shared libraries, plus
`libwebsockets` under `open-source/lib`, which `CMakeLists.txt` reuses for
the relay connection so no third WebSocket library is needed. GStreamer is
not used or required. The live binary also needs the system FFmpeg
development packages (`libavcodec-dev`, `libavutil-dev`) for its H.264
decoder.

## Known gotchas (so they are not re-discovered)

- **The KVS SDK's OpenSSL sub-build breaks on spaces in the path.** Its
  `config` script does unquoted shell comparisons, and this project's own
  folder has a space in it; the failure is `Can't open perl script
  "/home/.../V1-LocalDev": Is a directory` followed by `This system
  (linux-x86_64) is not supported`. Build the SDK at a space-free path such
  as `$HOME/kvs-webrtc-sdk`; referencing it from a spaced path afterwards is
  fine.
- **The SDK's sub-dependencies fail under CMake 4.x** because
  `libwebsockets` declares compatibility with a CMake older than 3.5, which
  4.0+ refuses to parse. Export `CMAKE_POLICY_VERSION_MINIMUM=3.5` as an
  **environment variable** (not just a `-D` flag) before running `cmake`,
  so it reaches the nested sub-builds.
- **Relative paths are relative to where the binary is run from**
  (`cpp/build`), not to the source file. OpenCV fails silently on a bad
  video path (a capture object that never opens), so `cap.isOpened()` is
  always checked.
- **A source file's name and its CMake target name are independent**:
  `add_executable(follow_through_batch_gpu follow-through-batch.cpp)`
  produces `follow_through_batch_gpu` (underscores) from a hyphenated file.
  Renaming a source does not rename its binary.
- **A suspiciously fast, clean build after a large edit is a red flag** —
  usually the edited file was not the one being built.
- **Linking a bare library name (`-lnvinfer`) does not reliably prefer a
  custom `target_link_directories` path over the system search path.** If
  a specific non-default library ever has to be forced, link the `.so` by
  full path in `target_link_libraries`; rpath settings only affect runtime
  lookup, not link-time selection.
- **`find_package(nlohmann_json REQUIRED)` failed with "could not find a
  package configuration file"** on this setup even with the package
  installed, which is why `CMakeLists.txt` includes the header directly.
- **Ultralytics `.engine` header** — section 5 above. The error message is
  a red herring.
