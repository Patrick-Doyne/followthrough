#!/bin/bash
# Fixture simulating detection failing outright (e.g. an unreadable/
# corrupt video file) -- non-zero exit, no output file written.
echo "simulated detection failure" >&2
exit 1
