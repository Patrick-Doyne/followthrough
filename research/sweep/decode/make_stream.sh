#!/usr/bin/env bash
# The decode benchmark's input: burkelake8 re-encoded as the live stream
# arrives, H.264 4K at 60 fps, no B-frames (WebRTC sends none), capped at the
# app's 4K bitrate (40 Mbit/s, BITRATE_AT_4K_BPS in webrtc-live.ts), as raw
# Annex B. Upload it to s3://$BUCKET/videos/bench/ once.
#
#   bash research/sweep/decode/make_stream.sh <burkelake8.MOV> <out.h264>
set -euo pipefail
ffmpeg -hide_banner -y -i "$1" -an -c:v libx264 -preset medium -profile:v high -bf 0 -g 120 \
  -b:v 40M -maxrate 40M -bufsize 40M -pix_fmt yuv420p -r 60 -bsf:v h264_mp4toannexb -f h264 "$2"
