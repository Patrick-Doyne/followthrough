#!/bin/bash
# Fixture simulating the preparation script exiting non-zero.
echo "prepare step exploded" >&2
exit 1
