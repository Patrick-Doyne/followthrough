#!/bin/bash
# Fixture: a preparation run that never finishes. It closes its output
# straight away, so the caller reads to the end at once and then waits on a
# process that is still running -- the timeout path.
exec >&- 2>&-
sleep 30
