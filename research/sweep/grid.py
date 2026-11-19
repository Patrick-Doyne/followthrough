"""The 432 runs of the configuration sweep.

    27 engine variants x 16 cadence settings = 432 runs, on burkelake8.

An engine variant changes ONE model's engine and holds the other two at the
baseline (the n-640 engine of their type), so every run differs from the
baseline in at most one engine. The baseline triple itself therefore appears
three times (obj-n-640, court-n-640, player-n-640 each name it), which is
kept as a repeatability check.

A cadence is how often each model runs:
    court keypoints every 1 / 5 / 10 / 20 frames (held in between)
    shooter pose near the release zone ("gate") or on every frame ("every")
    detector on every frame (1) or every other frame with coasting (2)

Run ids read `<variant>__c<N>-p<gate|every>-d<K>`, e.g. `obj-m-960__c10-pgate-d1`.
A job is one variant with its 16 cadences, so a worker loads its engines once.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "training"))
from matrix import RESOLUTIONS, SIZES, TYPES, Config, all_configs  # noqa: E402

VIDEO = "videos/train3/burkelake8.MOV"  # key in the bucket
DECODE_STREAM = "videos/bench/burkelake8-4k60-h264.h264"  # research/sweep/decode/make_stream.sh
FRAME_BUDGET_MS = 1000.0 / 60.0  # real time at 60 fps
WARMUP_FRAMES = 60  # dropped from the latency figures

# The rest of the live path, held constant so configurations are compared
# offline, in a vacuum. Both are 4K figures; burkelake8 is 4K.
#   ENCODE_MS: the progress report's expectation (CS692 notes §4).
#   DECODE_MS: measured on the sweep's own machine type, an EC2 g5.xlarge
#     (A10G), by research/sweep/decode (the backend's H264Decoder on burkelake8 as 4K at
#     60 fps H.264 at the app's 40 Mbit/s): median of 3 passes, s3://<bucket>/sweep/decode/A10G.json.
#     The same benchmark gives 4.28 ms on the RTX 3090 (the live backend logged 4.7).
ENCODE_MS = 10.0  # phone H.264 hardware encode (iPhone VideoToolbox): expected from published figures, not measured
DECODE_MS = 6.37  # backend H.264 decode on NVDEC incl. NV12->BGR, on the A10G (g5.xlarge)


def backend_ms(pipeline_ms: float) -> float:
    """Decode then pipeline, one after the other on the GPU machine."""
    return DECODE_MS + pipeline_ms


def rate_ms(pipeline_ms: float) -> float:
    """The rate-setting stage: phone and backend work in parallel, so the
    slower of the two sets the frame rate. Real time at 60 fps is this <= budget."""
    return max(ENCODE_MS, backend_ms(pipeline_ms))


def full_path(pipeline_mean_ms: float | None) -> dict | None:
    """A run's per-frame figures with the constants added (what result.json and runs.csv carry)."""
    if pipeline_mean_ms is None:
        return None
    return {
        "encode": ENCODE_MS,
        "decode": DECODE_MS,
        "pipeline": round(pipeline_mean_ms, 3),
        "backend": round(backend_ms(pipeline_mean_ms), 3),
        "rate": round(rate_ms(pipeline_mean_ms), 3),
    }


def holds_real_time(pipeline_mean_ms: float | None) -> bool:
    return pipeline_mean_ms is not None and rate_ms(pipeline_mean_ms) <= FRAME_BUDGET_MS

BASELINE = {t: Config(t, "n", 640) for t in TYPES}  # obj, court, player
FLAG = {"obj": "--detect", "court": "--court", "player": "--pose"}

COURT_EVERY = (1, 5, 10, 20)
POSE = ("gate", "every")
DETECT_EVERY = (1, 2)


@dataclass(frozen=True)
class Cadence:
    court_every: int
    pose: str
    detect_every: int

    @property
    def name(self) -> str:
        return f"c{self.court_every}-p{self.pose}-d{self.detect_every}"

    def flags(self) -> list[str]:
        f = ["--court-every", str(self.court_every), "--detect-every", str(self.detect_every)]
        if self.pose == "every":
            f.append("--pose-every-frame")
        return f


CADENCES = [Cadence(c, p, d) for c, p, d in product(COURT_EVERY, POSE, DETECT_EVERY)]


@dataclass(frozen=True)
class Run:
    variant: Config  # the one engine this run changes
    cadence: Cadence

    @property
    def id(self) -> str:
        return f"{self.variant.name}__{self.cadence.name}"

    def engines(self) -> dict[str, Config]:
        """Model type -> engine config used by this run."""
        e = dict(BASELINE)
        e[self.variant.type] = self.variant
        return e


def variants() -> list[Config]:
    return list(all_configs())


def runs() -> list[Run]:
    return [Run(v, c) for v in variants() for c in CADENCES]


def runs_of(variant: Config) -> list[Run]:
    return [Run(variant, c) for c in CADENCES]


assert len(variants()) == 27 and len(CADENCES) == 16 and len(runs()) == 432
assert len(SIZES) == 3 and len(RESOLUTIONS) == 3
