#!/usr/bin/env bash
#
# Downloads everything WALKTHROUGH.md needs that is too large for git:
#
#   - the 28 s 4K sample clip (burkelake8.MOV, 165 MB)
#   - the three ONNX model exports the CPU detector loads (about 100 MB)
#   - ONNX Runtime 1.30.0 (CPU build) for building follow_through_batch_cpu
#
# The clip and models come from this repository's GitHub release (tag
# v1-local by default); ONNX Runtime comes from Microsoft's releases. Files
# land in the git-ignored paths the binaries expect. Re-running is safe: a
# file that is already present is skipped.
#
#   ./scripts/fetch-demo-assets.sh            # clip + ONNX models + ONNX Runtime
#   FETCH_ORT=0 ./scripts/fetch-demo-assets.sh # without ONNX Runtime (live container)
#   FETCH_PT=1 ./scripts/fetch-demo-assets.sh # also the PyTorch weights, for
#                                             # exporting TensorRT engines on a GPU
#
# FOLLOWTHROUGH_REPO=owner/repo overrides the repository the assets are
# fetched from (default: parsed from this checkout's "origin" remote);
# FOLLOWTHROUGH_RELEASE_TAG overrides the release tag.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${FOLLOWTHROUGH_RELEASE_TAG:-v1-local}"
REPO="${FOLLOWTHROUGH_REPO:-}"

if [ -z "$REPO" ]; then
  origin="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
  REPO="$(printf '%s' "$origin" | sed -E 's#^(git@github\.com:|https://github\.com/|ssh://git@github\.com/)##; s#\.git$##')"
fi
if [ -z "$REPO" ]; then
  echo "Could not work out the GitHub repository from the 'origin' remote." >&2
  echo "Run with FOLLOWTHROUGH_REPO=owner/repo ./scripts/fetch-demo-assets.sh" >&2
  exit 1
fi

BASE="https://github.com/$REPO/releases/download/$TAG"

fetch() {
  local url="$1" dest="$2"
  if [ -s "$dest" ]; then
    echo "already present: ${dest#"$ROOT"/}"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  echo "downloading $(basename "$url") -> ${dest#"$ROOT"/}"
  if ! curl -fL --progress-bar -o "$dest.part" "$url"; then
    rm -f "$dest.part"
    echo "not available: $(basename "$url")" >&2
    return 1
  fi
  mv "$dest.part" "$dest"
}

# --- sample clip and models (this repository's release) -------------------
fetch "$BASE/burkelake8.MOV"              "$ROOT/python/videos/train3/burkelake8.MOV"
fetch "$BASE/detect-best.onnx"            "$ROOT/python/runs/detect/train/weights/best.onnx"
fetch "$BASE/court-keypoints-best.onnx"   "$ROOT/python/runs/pose/train-MuSGD-1/weights/best.onnx"
fetch "$BASE/yolo26n-pose.onnx"           "$ROOT/python/yolo26n-pose.onnx"
# FP16 exports with float32 input and output (python/wrap_fp16_onnx.py): the
# TensorRT engines are built from these, so they run in half precision as
# the measured ones did. TensorRT 11 takes precision from the ONNX itself.
# Optional: without them the engine builders fall back to FP32 and say so.
fetch "$BASE/detect-best.fp16.onnx"            "$ROOT/python/runs/detect/train/weights/best.fp16.onnx" || true
fetch "$BASE/court-keypoints-best.fp16.onnx"   "$ROOT/python/runs/pose/train-MuSGD-1/weights/best.fp16.onnx" || true
fetch "$BASE/yolo26n-pose.fp16.onnx"           "$ROOT/python/yolo26n-pose.fp16.onnx" || true

if [ "${FETCH_PT:-0}" = "1" ]; then
  fetch "$BASE/detect-best.pt"            "$ROOT/python/runs/detect/train/weights/best.pt"
  fetch "$BASE/court-keypoints-best.pt"   "$ROOT/python/runs/pose/train-MuSGD-1/weights/best.pt"
  fetch "$BASE/yolo26n-pose.pt"           "$ROOT/python/yolo26n-pose.pt"
fi

# --- ONNX Runtime, CPU build (Microsoft's release) -------------------------
# Only the CPU detector needs it; FETCH_ORT=0 skips it (the live container
# does, since it runs the TensorRT binary).
ORT_VERSION="1.30.0"
ORT_DIR="$ROOT/cpp/third_party/onnxruntime"
if [ "${FETCH_ORT:-1}" = "0" ]; then
  echo "skipping ONNX Runtime (FETCH_ORT=0)"
elif [ -f "$ORT_DIR/include/onnxruntime_cxx_api.h" ]; then
  echo "already present: cpp/third_party/onnxruntime"
else
  tmp="$(mktemp -d)"
  fetch "https://github.com/microsoft/onnxruntime/releases/download/v$ORT_VERSION/onnxruntime-linux-x64-$ORT_VERSION.tgz" "$tmp/onnxruntime.tgz"
  tar -xzf "$tmp/onnxruntime.tgz" -C "$tmp"
  mkdir -p "$ORT_DIR"
  cp -r "$tmp/onnxruntime-linux-x64-$ORT_VERSION/." "$ORT_DIR/"
  rm -rf "$tmp"
  echo "installed ONNX Runtime $ORT_VERSION -> cpp/third_party/onnxruntime"
fi

echo
echo "All assets in place. Next: build the CPU detector (WALKTHROUGH.md, step 3)."
