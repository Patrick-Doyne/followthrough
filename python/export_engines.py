"""Export the three models to TensorRT engines on this machine's GPU.

Engines are specific to the GPU and the TensorRT version they are built on,
so they are never copied between machines: run this where the C++ binaries
will run. The paths and sizes match what cpp/README.md says the binaries
load; override a size with FT_DETECT_IMGSZ, FT_COURT_IMGSZ or FT_POSE_IMGSZ
when exporting a different level of the experiment matrix.

    source ~/.venvs/followthrough/bin/activate
    cd python && python export_engines.py
"""

import os
from pathlib import Path

from ultralytics import YOLO

HERE = Path(__file__).resolve().parent

MODELS = [
    ("detector", HERE / "runs/detect/train/weights/best.pt", int(os.environ.get("FT_DETECT_IMGSZ", "640"))),
    ("court keypoints", HERE / "runs/pose/train-MuSGD-1/weights/best.pt", int(os.environ.get("FT_COURT_IMGSZ", "640"))),
    ("shooter pose", HERE / "yolo26n-pose.pt", int(os.environ.get("FT_POSE_IMGSZ", "480"))),
]

for name, weights, imgsz in MODELS:
    if not weights.exists():
        raise SystemExit(f"{name}: {weights} is missing (FETCH_PT=1 ./scripts/fetch-demo-assets.sh downloads it)")
    print(f"== {name}: {weights} at imgsz {imgsz}")
    out = YOLO(str(weights)).export(format="engine", imgsz=imgsz, half=True, device=0)
    print(f"   wrote {out}")
