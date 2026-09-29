#!/bin/bash
# Fixture standing in for the real Node preparation script's argv
# contract: $1 = input video, $2 = telemetry JSONL (ignored here), $3 =
# thumbnail output path, $4 = playback output path.
#
# This one simulates the common case: an upload the browser can already
# play. It writes the thumbnail and deliberately leaves $4 alone, because
# the ABSENCE of that file is how the script says "no transcode was
# needed". Nothing is written to $1 -- the upload is never modified.
set -euo pipefail
echo "fake thumbnail bytes" > "$3"
exit 0
