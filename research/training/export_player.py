"""The 9 player-keypoint configurations: the stock COCO-pretrained YOLO26-pose
at each size, exported at each training resolution. Nothing is trained; there
is no player-pose dataset.

    python research/training/export_player.py          # on the GPU machine, from the repo root

Writes python/models/player-<size>-<res>/best.half.onnx (FP16, as the workers
export the trained configurations); research/training/fetch_and_build.sh turns these
into engines with the trained ones.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

from ultralytics import YOLO

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from matrix import RESOLUTIONS, SIZES, Config  # noqa: E402

PYTHON = HERE.parents[1] / "python"
MODELS = PYTHON / "models"

for size in SIZES:
    for res in RESOLUTIONS:
        config = Config("player", size, res)
        out = MODELS / config.name / "best.half.onnx"
        if out.exists():
            print(f"== {config.name}: exists")
            continue
        # Exported from a copy in the configuration's own directory: Ultralytics
        # writes the export beside the weights it read, and beside the
        # originals it would overwrite python/yolo26n-pose.onnx, the export the
        # engine in use was built from.
        out.parent.mkdir(parents=True, exist_ok=True)
        weights = out.parent / config.weights
        shutil.copy(PYTHON / config.weights, weights)
        print(f"== {config.name}: {config.weights} at {res}")
        exported = Path(YOLO(str(weights)).export(format="onnx", imgsz=res, half=True, device=0))
        shutil.move(exported, out)
        weights.unlink()
