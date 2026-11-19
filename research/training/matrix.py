"""The training matrix: every model configuration the experiments use, and
how each is produced.

27 configurations = 3 model types x 3 sizes x 3 training resolutions, named
`<type>-<size>-<res>`:

    obj-n-640     object detection (ball, player, rim, net, backboard), trained
    court-m-960   court keypoints, trained
    player-x-1280 shooter pose: the stock COCO-pretrained YOLO26-pose, exported
                  at the resolution, not trained (there is no player-pose dataset)

The 18 trained configurations keep the epochs, optimizer and patience of each
type's original run (python/runs/detect/train and
python/runs/pose/train-MuSGD-1); other settings are Ultralytics defaults, so
the court recipe differs from that run's hand-tuned loss weights and
augmentation. Within a type only the model size and the training image size
vary. Every script in research/training/ takes its names and settings from here.
"""

from __future__ import annotations

from dataclasses import dataclass

SIZES = ("n", "m", "x")
RESOLUTIONS = (640, 960, 1280)

# Relative training cost of a model size at the same image size: measured
# per-epoch times scale far less than the FLOPs do, because data loading and
# augmentation are shared. Only used to order jobs longest first, and
# replaced by measured numbers after calibration.
SIZE_COST = {"n": 1.0, "m": 2.5, "x": 5.0}


@dataclass(frozen=True)
class ModelType:
    key: str
    trained: bool
    weights: str  # with {size}
    data: str = ""  # dataset yaml under the datasets root
    epochs: int = 0
    optimizer: str = "auto"
    patience: int = 100
    train_images: int = 0


TYPES = {
    "obj": ModelType(
        key="obj",
        trained=True,
        weights="yolo26{size}.pt",
        data="object-detection/train3-data-set.yolo26/data.yaml",
        epochs=75,
        optimizer="auto",
        patience=100,
        train_images=880,
    ),
    "court": ModelType(
        key="court",
        trained=True,
        weights="yolo26{size}-pose.pt",
        data="pose-model/train2-data-set.yolo26/data.yaml",
        epochs=150,
        optimizer="MuSGD",
        patience=25,
        train_images=363,
    ),
    "player": ModelType(key="player", trained=False, weights="yolo26{size}-pose.pt"),
}

# Settings shared by every trained configuration. seed and deterministic make
# reruns comparable; cache="ram" holds the resized images once instead of
# decoding a 4K JPEG per sample per epoch (what the model sees is the same);
# batch=-1 fits the batch to the GPU, and Ultralytics accumulates gradients to
# its nominal batch of 64, so the effective batch is the same everywhere.
COMMON_TRAIN_ARGS = {
    "seed": 0,
    "deterministic": True,
    "workers": 4,
    "cache": "ram",
    "batch": -1,
    "exist_ok": True,
    "plots": True,
}


@dataclass(frozen=True)
class Config:
    type: str
    size: str
    res: int

    @property
    def name(self) -> str:
        return f"{self.type}-{self.size}-{self.res}"

    @property
    def model_type(self) -> ModelType:
        return TYPES[self.type]

    @property
    def weights(self) -> str:
        return self.model_type.weights.format(size=self.size)

    def cost(self) -> float:
        """Relative cost of the whole run, for longest-first ordering."""
        t = self.model_type
        return SIZE_COST[self.size] * (self.res / 640) ** 2 * t.epochs * t.train_images


def parse(name: str) -> Config:
    kind, size, res = name.split("-")
    if kind not in TYPES or size not in SIZES or int(res) not in RESOLUTIONS:
        raise ValueError(f"not a configuration in the matrix: {name}")
    return Config(kind, size, int(res))


def all_configs() -> list[Config]:
    return [Config(t, s, r) for t in TYPES for s in SIZES for r in RESOLUTIONS]


def trained_configs() -> list[Config]:
    """The 18 trained configurations, longest first."""
    jobs = [c for c in all_configs() if c.model_type.trained]
    return sorted(jobs, key=lambda c: c.cost(), reverse=True)


def calibration_configs() -> list[Config]:
    """The two ends of each trained type, timed on every machine type."""
    return [Config(t, s, r) for t in ("obj", "court") for s, r in (("x", 1280), ("n", 640))]


if __name__ == "__main__":
    for c in trained_configs():
        print(f"{c.name:15} {c.weights:18} epochs {c.model_type.epochs:3}  relative cost {c.cost():12,.0f}")
    print(f"{len(all_configs())} configurations, {len(trained_configs())} trained")
