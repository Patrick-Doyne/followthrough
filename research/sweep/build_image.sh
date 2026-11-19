#!/usr/bin/env bash
# Builds the sweep image from a context holding only what research/sweep/Dockerfile
# copies (the batch binary's source, the two worker modules, the decode
# benchmark), so the build
# never sends the repository's videos, datasets or app builds to Docker.
#
#   bash research/sweep/build_image.sh [tag]            # default followthrough-sweep:latest
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="${1:-followthrough-sweep:latest}"
CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/cpp" "$CTX/training" "$CTX/sweep/decode"
cp "$ROOT"/cpp/CMakeLists.txt "$ROOT"/cpp/*.cpp "$CTX/cpp/"
cp "$ROOT"/research/training/worker.py "$ROOT"/research/training/matrix.py "$CTX/training/"
cp "$ROOT"/research/sweep/grid.py "$ROOT"/research/sweep/worker.py "$ROOT"/research/sweep/Dockerfile "$CTX/sweep/"
cp "$ROOT"/research/sweep/decode/bench.cpp "$ROOT"/research/sweep/decode/build.sh "$CTX/sweep/decode/"
# Host network: the default build network has no DNS under WSL here.
docker build --network host -f "$CTX/sweep/Dockerfile" -t "$TAG" "$CTX"
