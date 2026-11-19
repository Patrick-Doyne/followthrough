#!/usr/bin/env bash
# Builds the three TensorRT engines on this GPU with trtexec, from the ONNX
# exports, and writes them in the layout the C++ loaders read: a
# little-endian 4-byte length, that many bytes of JSON metadata, then the
# serialized engine (cpp/README.md, "Ultralytics .engine files are NOT raw
# TensorRT engines"). Engines are specific to the GPU and TensorRT version,
# so this runs where the backend runs, once; the entrypoint keeps the result
# in a volume so a restart does not rebuild.
#
#   build-engines.sh <python dir> <cache dir>
set -euo pipefail

PYTHON_DIR="$1"
CACHE_DIR="$2"
# libnvinfer-bin's trtexec, wherever this TensorRT release puts it.
TRTEXEC="$(command -v trtexec || ls /usr/src/tensorrt/bin/trtexec /usr/lib/x86_64-linux-gnu/tensorrt/bin/trtexec 2>/dev/null | head -1)"
[ -x "$TRTEXEC" ] || { echo "trtexec not found (libnvinfer-bin)" >&2; exit 1; }
GPU="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 | tr ' /' '__' || echo unknown-gpu)"
CACHE="$CACHE_DIR/$GPU"
mkdir -p "$CACHE"

build() {
  local onnx="$1"
  local engine="$2"
  local cached="$CACHE/$(basename "$(dirname "$onnx")")-$(basename "$engine")"
  if [ -s "$cached" ]; then
    echo "== $engine: cached for $GPU"
    cp "$cached" "$engine"
    return
  fi
  # Precision follows the ONNX (TensorRT 11 has no separate FP16 switch), so
  # the FP16 export with float32 I/O (python/wrap_fp16_onnx.py) is used when
  # it is present, which is how the measured engines were built.
  local half=false
  if [ -s "${onnx%.onnx}.fp16.onnx" ]; then onnx="${onnx%.onnx}.fp16.onnx"; half=true; fi
  echo "== $engine: building from $onnx on $GPU (half=$half)"
  local raw; raw="$(mktemp)"
  "$TRTEXEC" --onnx="$onnx" --saveEngine="$raw" --memPoolSize=workspace:2048 > "$raw.log" 2>&1 \
    || { tail -20 "$raw.log"; echo "trtexec failed for $onnx" >&2; exit 1; }
  python3 - "$raw" "$engine" "$onnx" "$half" <<'EOF'
import json, struct, sys
raw, engine, onnx, half = sys.argv[1:5]
meta = json.dumps({"builder": "trtexec (deploy/docker/build-engines.sh)", "source": onnx, "half": half == "true"}).encode()
with open(engine, "wb") as out, open(raw, "rb") as src:
    out.write(struct.pack("<I", len(meta)))
    out.write(meta)
    out.write(src.read())
EOF
  rm -f "$raw" "$raw.log"
  cp "$engine" "$cached"
  echo "   wrote $engine ($(du -m "$engine" | cut -f1) MB)"
}

build "$PYTHON_DIR/runs/detect/train/weights/best.onnx"       "$PYTHON_DIR/runs/detect/train/weights/best.engine"
build "$PYTHON_DIR/runs/pose/train-MuSGD-1/weights/best.onnx" "$PYTHON_DIR/runs/pose/train-MuSGD-1/weights/best.engine"
build "$PYTHON_DIR/yolo26n-pose.onnx"                         "$PYTHON_DIR/yolo26n-pose.engine"
