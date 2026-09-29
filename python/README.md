# FollowThrough — Python Environment Setup

Documents the Python side: environment, key packages, model files,
and the supporting scripts. This is the side that *produces* model
artifacts (training, TensorRT export) and runs the original
Python/OpenCV real-time pipeline; the C++ side (see the other
README) *consumes* the exported `.engine` files it never regenerates
on its own.

## Confirmed working configuration

- **Platform**: WSL2, Ubuntu 26.04 LTS
- **GPU**: NVIDIA GeForce RTX 3090
- **Python**: 3.14
- **Virtual environment**: `~/.venvs/followthrough`
- **Ultralytics**: 8.4.121
- **PyTorch**: 2.13.0+cu130
- **TensorRT (Python package)**: 11.2.1.2
- **CUDA (via pip nvidia-cuda-* packages)**: 13.0.x

The CUDA/TensorRT versions here are the ones the C++ side's install
was specifically matched against. If either changes here, the C++
TensorRT install needs re-verifying against the new versions before
assuming existing `.engine` files will still load correctly.

## Virtual environment

```bash
python3 -m venv ~/.venvs/followthrough
source ~/.venvs/followthrough/bin/activate
```

Key packages (install via `pip`, not system apt — this environment
is intentionally isolated from any system-level Python):
- `ultralytics`
- `torch` (CUDA-enabled build matching the CUDA line above)
- `tensorrt` (matching the version above — installs the Python
  bindings and pulls in the `nvidia-cuda-*` runtime packages as
  dependencies; this is a *separate* installation from the C++
  TensorRT SDK, sharing no files with it)
- `opencv-python`
- `numpy`

## Folder structure

```
OpenCV Video Processing/
└── python/
    ├── follow_through.py           # main real-time pipeline
    ├── export_tensorrt.py        # .pt -> .engine export
    ├── train_detect.py           # detect model training
    ├── train_detect_480.py       # detect model training (480 variant, ruled out)
    ├── validate_detect.py        # accuracy comparison across trained variants
    ├── videos/
    │   └── train3/
    │       └── burkelake8.MOV
    ├── runs/
    │   ├── detect/train/weights/
    │   │   ├── best.pt
    │   │   └── best.engine
    │   └── pose/train-MuSGD-1/weights/
    │       ├── best.pt
    │       └── best.engine
    └── yolo26n-pose.pt / yolo26n-pose.engine
```

## Model files — what each one is for

Three models, each with a `.pt` and a matching `.engine`:
1. **detect** — ball / net / player / rim bounding-box detection
   (custom-trained, `runs/detect/train/weights/`)
2. **court** — 7-keypoint court calibration (custom-trained,
   pose-type model, `runs/pose/train-MuSGD-1/weights/`)
3. **pose** — human joint keypoints (off-the-shelf COCO pose model,
   `yolo26n-pose`)

`.pt` files are only ever used by the Python-side training/export
scripts — never loaded at real-time inference time, in Python or
C++. `.engine` files are what `follow_through.py` actually runs
against, and what the C++ port loads directly.

**Engines are tied to their exact build environment** (GPU, driver,
CUDA, TensorRT version). Re-export whenever any of those change —
see `export_tensorrt.py`.

## Running the export

```bash
python export_tensorrt.py
```

Exports all three models to `.engine` at the `imgsz`/precision
settings currently configured in the script. Takes a few minutes
per model on first export — TensorRT is profiling kernel
implementations for this exact GPU, not just converting a file
format.

## Training / validation scripts

`train_detect.py` and `train_detect_480.py` were used to test
whether training at a different resolution than 640 would allow a
lower `DETECT_IMGSZ` at inference with less accuracy cost.
`validate_detect.py` ran the resulting models through `model.val()`
at multiple resolutions to compare. Conclusion: the original
640-trained model, evaluated at 640, remained the best result
across all three experiments — the 480 and 1280 variants are kept
for reference but are not what `follow_through.py` should be pointed
at.

## Running the real-time pipeline

```bash
python follow_through.py
```

Reads from the video path hardcoded near the top of the file —
update it if the video moves, same relative-path caution as
everywhere else in this project (OpenCV fails silently on a bad
path rather than raising an exception).

`SHOW_DISPLAY_WINDOW` near the top controls whether a local debug
window is shown. Set `True` for local development/testing; the
production target (frames funneled to a frontend via Kinesis Video
Streams, not displayed locally) should run with this `False`.