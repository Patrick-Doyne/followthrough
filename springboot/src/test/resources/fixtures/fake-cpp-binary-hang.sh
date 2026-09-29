#!/bin/bash
# Fixture simulating a hung/stuck detection process, to exercise
# CppVideoProcessor's waitFor(timeout) + destroyForcibly() path.
sleep 60
