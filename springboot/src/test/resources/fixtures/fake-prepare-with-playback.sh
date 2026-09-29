#!/bin/bash
# Fixture simulating an upload no browser can decode (HEVC from a phone):
# the script writes both the thumbnail and a browser-playable copy at $4.
# The upload at $1 is still left exactly as it was.
set -euo pipefail
echo "fake thumbnail bytes" > "$3"
echo "fake h264 playback bytes" > "$4"
exit 0
