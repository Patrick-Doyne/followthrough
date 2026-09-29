#!/bin/bash
# Fixture simulating a run that succeeds but found no frame worth showing
# (prepare-playback.ts's own "telemetry described zero frames" case) --
# exits 0 leaving both outputs untouched, so ProcessingOutcome should
# carry nulls rather than paths to nonexistent files.
set -euo pipefail
exit 0
