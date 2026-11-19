#!/usr/bin/env bash
# Builds the TensorRT engine of every finished configuration on this machine
# (an engine belongs to the GPU that builds it, so it is never built on the
# training instances) and uploads it beside the weights. Nothing is kept
# locally: whatever needs an engine pulls it from the bucket.
#
#   bash research/training/fetch_and_build.sh            # from the repo root
#
# In the bucket, weights/<name>/ holds best.pt (trained ones), best.half.onnx
# (FP16 export), best.fp16.onnx (with float32 ends), best.engine (built on
# this machine's GPU) and DONE.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUCKET="${BUCKET:-$(terraform -chdir="$ROOT/research/training/terraform/storage" output -raw bucket)}"

built=0
for name in $(aws s3 ls "s3://$BUCKET/weights/" | awk '{print $2}' | tr -d /); do
  remote="s3://$BUCKET/weights/$name"
  aws s3 ls "$remote/DONE.json" >/dev/null 2>&1 || continue
  aws s3 ls "$remote/best.engine" >/dev/null 2>&1 && continue
  # Built under python/ because build_engines.py names engines by their path
  # there; the directory is removed once the engine is uploaded.
  dir="$ROOT/python/models/$name"
  mkdir -p "$dir"
  aws s3 cp "$remote/best.half.onnx" "$dir/best.half.onnx" --only-show-errors
  # TensorRT 11 takes precision from the ONNX; the C++ binaries copy float32
  # in and out, so the FP16 export gets float32 ends (python/wrap_fp16_onnx.py).
  python3 "$ROOT/python/wrap_fp16_onnx.py" "$dir/best.half.onnx" "$dir/best.fp16.onnx"
  python3 "$ROOT/python/build_engines.py" "$dir/best.onnx"
  aws s3 cp "$dir/best.fp16.onnx" "$remote/best.fp16.onnx" --only-show-errors
  aws s3 cp "$dir/best.engine" "$remote/best.engine" --only-show-errors
  rm -rf "$dir"
  built=$((built + 1))
done
rmdir "$ROOT/python/models" 2>/dev/null || true
total=$(aws s3 ls "s3://$BUCKET/weights/" --recursive | grep -c '/best.engine$' || true)
echo "== $built engine(s) built now; $total configurations have an engine in s3://$BUCKET/weights/"
