"""Build the three TensorRT engines from the ONNX exports, on this GPU, with
nothing but the TensorRT Python package: no PyTorch, no Ultralytics.

Engines are specific to the GPU and TensorRT version they are built on, so
they are never copied between machines; this is what a fresh instance (or
container) runs once. It writes the same file layout Ultralytics' export
does, which is what the C++ loaders expect: a little-endian 4-byte length,
that many bytes of JSON metadata, then the serialized engine
(cpp/README.md, "Ultralytics .engine files are NOT raw TensorRT engines").

    python build_engines.py [--force] [--out DIR]

Reads   runs/detect/train/weights/best[.fp16].onnx   -> best.engine
        runs/pose/train-MuSGD-1/weights/best[.fp16].onnx -> best.engine
        yolo26n-pose[.fp16].onnx                     -> yolo26n-pose.engine
(the ONNX files come from scripts/fetch-demo-assets.sh; the .fp16 ones are
preferred, see wrap_fp16_onnx.py). Input sizes are whatever the ONNX was
exported at; the C++ reads them from the engine.
--out DIR writes the engines under DIR in the same layout instead of beside
the ONNX files (for checking a build without touching the ones in use).
ONNX paths given as arguments are built instead of the three above.
"""

import json
import struct
import sys
from pathlib import Path

import onnx
import tensorrt as trt

HERE = Path(__file__).resolve().parent
MODELS = [
    HERE / "runs/detect/train/weights/best.onnx",
    HERE / "runs/pose/train-MuSGD-1/weights/best.onnx",
    HERE / "yolo26n-pose.onnx",
]
# TensorRT 11 takes precision from the ONNX itself (there is no weakly-typed
# FP16 switch any more), so the engines are built from the FP16 exports
# (<name>.fp16.onnx, made by wrap_fp16_onnx.py with float32 input and
# output) when those are present, and from the FP32 exports otherwise.
FORCE = "--force" in sys.argv
OUT = Path(sys.argv[sys.argv.index("--out") + 1]).resolve() if "--out" in sys.argv else HERE


def metadata_for(model: onnx.ModelProto, half: bool) -> dict:
    """The metadata Ultralytics writes ahead of an engine, read back from
    the ONNX export it put the same keys on (none of it is needed by the
    C++, which skips the header, but keeping it makes the file inspectable)."""
    props = {p.key: p.value for p in model.metadata_props}
    meta = {}
    for key in ("description", "author", "date", "version", "license", "docs", "stride", "task", "batch", "imgsz", "names"):
        if key in props:
            value = props[key]
            if key in ("stride", "batch", "imgsz", "names"):
                try:
                    value = json.loads(value.replace("'", '"'))
                except ValueError:
                    pass
            meta[key] = value
    meta["half"] = half
    meta["builder"] = f"build_engines.py / TensorRT {trt.__version__}"
    return meta


def build(onnx_path: Path) -> Path:
    engine_path = OUT / onnx_path.relative_to(HERE).with_suffix(".engine")
    fp16_path = onnx_path.with_suffix(".fp16.onnx")
    half = fp16_path.exists()
    if half:
        onnx_path = fp16_path
    else:
        print(f"   note: {fp16_path.name} not found, building FP32 from {onnx_path.name}")
    engine_path.parent.mkdir(parents=True, exist_ok=True)
    if engine_path.exists() and not FORCE:
        print(f"== {engine_path} exists, keeping it (--force rebuilds)")
        return engine_path
    print(f"== {onnx_path.relative_to(HERE)} -> {engine_path} ({'fp16' if half else 'fp32'})", flush=True)
    logger = trt.Logger(trt.Logger.WARNING)
    builder = trt.Builder(logger)
    network = builder.create_network(0)
    parser = trt.OnnxParser(network, logger)
    if not parser.parse(onnx_path.read_bytes()):
        for i in range(parser.num_errors):
            print("   parser:", parser.get_error(i))
        raise SystemExit(f"{onnx_path}: ONNX parse failed")
    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 2 << 30)
    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise SystemExit(f"{onnx_path}: engine build failed")
    meta = json.dumps(metadata_for(onnx.load(onnx_path, load_external_data=False), half)).encode()
    with open(engine_path, "wb") as f:
        f.write(struct.pack("<I", len(meta)))
        f.write(meta)
        f.write(bytes(serialized))
    print(f"   wrote {engine_path} ({engine_path.stat().st_size / 1e6:.1f} MB)", flush=True)
    return engine_path


# Paths on the command line (under this directory) are built instead of the
# three in use, e.g. the training matrix's python/models/<name>/best.onnx
# (research/training/fetch_and_build.sh); only its .fp16.onnx sibling need exist.
OUT_ARG = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else None
TARGETS = [Path(a).resolve() for a in sys.argv[1:] if not a.startswith("--") and a != OUT_ARG] or MODELS

for onnx_path in TARGETS:
    if not onnx_path.exists() and not onnx_path.with_suffix(".fp16.onnx").exists():
        raise SystemExit(f"{onnx_path} is missing: run scripts/fetch-demo-assets.sh first")
    build(onnx_path)
