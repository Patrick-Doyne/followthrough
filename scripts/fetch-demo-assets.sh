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
  curl -fL --progress-bar -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

# --- sample clip and models (this repository's release) -------------------
fetch "$BASE/burkelake8.MOV"              "$ROOT/python/videos/train3/burkelake8.MOV"
fetch "$BASE/detect-best.onnx"            "$ROOT/python/runs/detect/train/weights/best.onnx"
fetch "$BASE/court-keypoints-best.onnx"   "$ROOT/python/runs/pose/train-MuSGD-1/weights/best.onnx"
fetch "$BASE/yolo26n-pose.onnx"           "$ROOT/python/yolo26n-pose.onnx"

if [ "${FETCH_PT:-0}" = "1" ]; then
  fetch "$BASE/detect-best.pt"            "$ROOT/python/runs/detect/train/weights/best.pt"
  fetch "$BASE/court-keypoints-best.pt"   "$ROOT/python/runs/pose/train-MuSGD-1/weights/best.pt"
  fetch "$BASE/yolo26n-pose.pt"           "$ROOT/python/yolo26n-pose.pt"
fi

# --- ONNX Runtime, CPU build (Microsoft's release) -------------------------
ORT_VERSION="1.30.0"
ORT_DIR="$ROOT/cpp/third_party/onnxruntime"
if [ -f "$ORT_DIR/include/onnxruntime_cxx_api.h" ]; then
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
