#!/bin/bash
# Fixture standing in for cpp/follow-through-batch.cpp's argv contract:
# $1 = input video path (ignored -- this fixture doesn't decode anything),
# $2 = output telemetry JSONL path. Writes a small, valid, canned
# telemetry stream and exits 0, so CppVideoProcessorTest can exercise the
# real ProcessBuilder/waitFor/file-read path without a GPU.
set -euo pipefail
output_path="$2"
cat > "$output_path" <<'EOF'
{"type":"metadata","fps":30.0,"frame_width":1920,"frame_height":1080}
{"type":"frame","frame_id":0,"frame_width":1920,"frame_height":1080,"potential_shot":false,"shot_started":false,"ball":null,"player":null,"rim":null,"net":null,"pose":null,"trail_frozen_at_rim":false,"apex_point":null,"player_distance_ft":null,"player_speed_mph":null,"player_stat_is_projected":false,"shot_designation":null,"time_to_apex":null,"shot_duration":null,"shot_distance_ft":null}
{"type":"frame","frame_id":30,"frame_width":1920,"frame_height":1080,"potential_shot":false,"shot_started":false,"ball":null,"player":null,"rim":null,"net":null,"pose":null,"trail_frozen_at_rim":false,"apex_point":null,"player_distance_ft":null,"player_speed_mph":null,"player_stat_is_projected":false,"shot_designation":"MID_RNG","time_to_apex":0.5,"shot_duration":1.2,"shot_distance_ft":15.0}
{"type":"shot_event","frame_id":30,"result":"make","makes":1,"misses":0,"shot_designation":"MID_RNG"}
{"type":"frame","frame_id":60,"frame_width":1920,"frame_height":1080,"potential_shot":false,"shot_started":false,"ball":null,"player":null,"rim":null,"net":null,"pose":null,"trail_frozen_at_rim":false,"apex_point":null,"player_distance_ft":null,"player_speed_mph":null,"player_stat_is_projected":false,"shot_designation":"NBA_3PT","time_to_apex":0.7,"shot_duration":1.5,"shot_distance_ft":24.0}
{"type":"shot_event","frame_id":60,"result":"miss","reason":"bounced_out","makes":1,"misses":1,"shot_designation":"NBA_3PT"}
EOF
exit 0
