#!/usr/bin/env bash
# Builds decode_bench: the backend's H264Decoder class, copied out of
# cpp/follow-through-webrtc.cpp unchanged, with bench.cpp as its driver.
#
#   bash research/sweep/decode/build.sh <follow-through-webrtc.cpp> <out-binary>
set -euo pipefail
SRC="$1"; OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
FULL="$(mktemp --suffix=.cpp)"
trap 'rm -f "$FULL"' EXIT
{
  printf '%s\n' '#include <opencv2/opencv.hpp>' 'extern "C" {' '#include <libavcodec/avcodec.h>' \
    '#include <libavutil/hwcontext.h>' '}' '#include <algorithm>' '#include <chrono>' '#include <cstdio>' \
    '#include <cstdlib>' '#include <cstring>' '#include <iostream>' '#include <string>' '#include <vector>'
  sed -n '/^class H264Decoder {/,/^};/p' "$SRC"
  cat "$HERE/bench.cpp"
} > "$FULL"
g++ -O2 -std=c++17 "$FULL" -o "$OUT" $(pkg-config --cflags --libs libavcodec libavformat libavutil opencv4)
echo "built $OUT"
