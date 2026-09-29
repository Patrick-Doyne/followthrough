#!/bin/bash
# Fixture simulating detection "succeeding" (exit 0) but never actually
# writing the telemetry file it was told to -- exercises
# CppVideoProcessor's readLines() IOException path. The caller
# pre-creates an empty placeholder at $2 (java.nio.file.Files.
# createTempFile), so this has to actually delete it -- merely not
# writing to it would leave a valid, readable (if empty) file.
rm -f "$2"
exit 0
