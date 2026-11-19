"""The sweep worker: the same loop on every sweep machine.

    python worker.py            # inside the sweep image (see Dockerfile)

Phases, coordinated through the training bucket exactly as training is
(conditional-write leases, see research/training/worker.py):

  0. decode  Once per GPU type, before anything else: the backend's 4K H.264
             decode cost on this machine (decode/bench.cpp), median of 3
             passes, to <prefix>/decode/<GPU>.json. Skipped if present.
  1. build   Each of the 27 engines is built once per GPU type, from the
             FP16 ONNX in weights/<name>/, and shared:
                 weights/<name>/engines/<GPU_TAG>.engine
             An engine belongs to the GPU and TensorRT version it was built
             with, so every machine that measures must be the same type.
  2. sweep   A job is one engine variant (grid.py) with its 16 cadences. The
             worker downloads the three engines and the clip, runs the batch
             binary once per cadence, alone on the GPU, and uploads
                 <prefix>/runs/<run_id>/result.json      the summary
                 <prefix>/runs/<run_id>/telemetry.jsonl.gz
                 <prefix>/runs/<run_id>/timing.csv.gz    per-frame stage ms
                 <prefix>/runs/<run_id>/stdout.log.gz
             A run that already has result.json is skipped, so a lost spot
             instance costs at most the run it was in.

Control: <prefix>/control.json = {"mode": "run" | "stop"}.
Environment: BUCKET (required), WORK (default /work), BINARY (the batch
binary), SWEEP_PREFIX (default "sweep"), ONLY (comma-separated variants, for
a smoke test), MAX_CADENCES (likewise), MACHINE_LABEL, DECODE_BENCH (the
decode benchmark binary).
"""

from __future__ import annotations

import csv
import gzip
import json
import os
import shutil
import statistics
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parent / "training"))

import importlib.util  # noqa: E402

# research/training/worker.py: leases, S3 helpers, machine identity. Loaded by path,
# since this file has the same module name.
_spec = importlib.util.spec_from_file_location("training_worker", HERE.parent / "training" / "worker.py")
tw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tw)
from grid import (  # noqa: E402
    BASELINE,
    DECODE_STREAM,
    FLAG,
    FRAME_BUDGET_MS,
    VIDEO,
    WARMUP_FRAMES,
    Run,
    full_path,
    holds_real_time,
    runs_of,
    variants,
)

s3, BUCKET, log = tw.s3, tw.BUCKET, tw.log
WORK = Path(os.environ.get("WORK", "/work"))
BINARY = os.environ.get("BINARY", "/opt/sweep/follow_through_batch_gpu")
PREFIX = os.environ.get("SWEEP_PREFIX", "sweep")
ONLY = [v for v in os.environ.get("ONLY", "").split(",") if v]
MAX_CADENCES = int(os.environ.get("MAX_CADENCES", "16"))
TRT_VERSION = os.environ.get("TRT_VERSION", "11.2.1")
DECODE_BENCH = os.environ.get("DECODE_BENCH", "/opt/sweep/decode_bench")
DECODE_PASSES = 3
RUN_TIMEOUT_S = 1800
IDLE_POLL_S = 30


def gpu_name() -> str:
    out = subprocess.run(
        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, check=True
    )
    return out.stdout.strip().splitlines()[0]


GPU = gpu_name()
GPU_TAG = f"{GPU.replace('NVIDIA ', '').replace(' ', '_')}-trt{TRT_VERSION}"


def engine_key(name: str) -> str:
    return f"weights/{name}/engines/{GPU_TAG}.engine"


def result_key(run: Run) -> str:
    return f"{PREFIX}/runs/{run.id}/result.json"


# ---------------------------------------------------------------- phase 0: decode

def decode_key() -> str:
    return f"{PREFIX}/decode/{GPU.replace('NVIDIA ', '').replace(' ', '_')}.json"


def decode_phase() -> None:
    """Once per GPU type: the backend's 4K H.264 decode cost on this machine
    (research/sweep/decode/bench.cpp), the decode constant the real-time gate uses."""
    if not Path(DECODE_BENCH).exists() or tw.exists(decode_key()):
        return
    stream = WORK / DECODE_STREAM
    if not stream.exists():
        stream.parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(BUCKET, DECODE_STREAM, str(stream) + ".part")
        os.replace(str(stream) + ".part", stream)
    passes, logs = [], []
    for _ in range(DECODE_PASSES):
        out = subprocess.run([DECODE_BENCH, str(stream)], capture_output=True, text=True, timeout=600)
        text = out.stdout + out.stderr
        logs.append(text)
        lines = [l for l in out.stdout.splitlines() if l.startswith("{")]
        if out.returncode != 0 or not lines:
            log(f"decode bench failed ({out.returncode}): {text[-500:]}")
            return
        passes.append(json.loads(lines[-1]))
    hardware = all("NVDEC (h264_cuvid), hardware" in t for t in logs)
    means = sorted(p["mean_ms"] for p in passes)
    result = {
        "gpu": GPU, "machine": tw.LABEL, "worker": tw.WORKER_ID, "stream": DECODE_STREAM,
        "decoder": "NVDEC (h264_cuvid)" if hardware else "software fallback",
        "passes": passes, "mean_ms": means[len(means) // 2],
    }
    s3.put_object(Bucket=BUCKET, Key=decode_key(), Body=json.dumps(result, indent=2).encode())
    log(f"decode: {result['decoder']}, {result['mean_ms']:.3f} ms/frame (median of {DECODE_PASSES}) -> {decode_key()}")


# ---------------------------------------------------------------- phase 1: engines

def trtexec() -> str:
    for candidate in (shutil.which("trtexec"), "/usr/src/tensorrt/bin/trtexec"):
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("trtexec not found")


def build_engine(name: str) -> None:
    """trtexec from the FP16 ONNX, written in the layout the C++ reads:
    a 4-byte length, that many bytes of JSON metadata, the engine
    (as deploy/docker/build-engines.sh does)."""
    work = WORK / "build" / name
    work.mkdir(parents=True, exist_ok=True)
    onnx = work / "best.fp16.onnx"
    s3.download_file(BUCKET, f"weights/{name}/best.fp16.onnx", str(onnx))
    raw = work / "raw.engine"
    started = time.time()
    proc = subprocess.run(
        [trtexec(), f"--onnx={onnx}", f"--saveEngine={raw}", "--memPoolSize=workspace:2048"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"trtexec failed for {name}:\n{proc.stdout[-3000:]}\n{proc.stderr[-2000:]}")
    meta = json.dumps(
        {"builder": "trtexec (research/sweep/worker.py)", "source": f"weights/{name}/best.fp16.onnx", "half": True,
         "gpu": GPU, "tensorrt": TRT_VERSION}
    ).encode()
    engine = work / "best.engine"
    with open(engine, "wb") as out:
        out.write(struct.pack("<I", len(meta)))
        out.write(meta)
        out.write(raw.read_bytes())
    s3.upload_file(str(engine), BUCKET, engine_key(name))
    log(f"engine {name} for {GPU_TAG}: {engine.stat().st_size / 1e6:.0f} MB in {time.time() - started:.0f} s")
    shutil.rmtree(work, ignore_errors=True)


def build_phase() -> bool:
    """Builds one missing engine if any can be claimed; True if it did."""
    # The baseline engines first: every job needs them.
    order = list(BASELINE.values()) + [v for v in variants() if v not in BASELINE.values()]
    for config in order:
        if ONLY and config.name not in ONLY and config not in BASELINE.values():
            continue
        if tw.exists(engine_key(config.name)):
            continue
        lease = tw.Lease(f"{PREFIX}/claims/build-{GPU_TAG}-{config.name}")
        if not lease.acquire():
            continue
        try:
            if not tw.exists(engine_key(config.name)):
                build_engine(config.name)
        except Exception as e:
            log(f"build {config.name} failed: {e}")
        finally:
            lease.release()
        return True
    return False


# ---------------------------------------------------------------- phase 2: runs

def local_engine(name: str) -> Path:
    path = WORK / "engines" / GPU_TAG / f"{name}.engine"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(BUCKET, engine_key(name), str(path) + ".part")
        os.replace(str(path) + ".part", path)
    return path


def local_video() -> Path:
    path = WORK / VIDEO
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(BUCKET, VIDEO, str(path) + ".part")
        os.replace(str(path) + ".part", path)
    return path


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q / 100 * (len(ordered) - 1))))]


def summarise(run: Run, timing: Path, telemetry: Path, wall_s: float, exit_code: int) -> dict:
    rows = list(csv.DictReader(timing.open())) if timing.exists() else []
    measured = rows[WARMUP_FRAMES:]

    def col(name: str) -> list[float]:
        return [float(r[name]) for r in measured]

    shots = []
    if telemetry.exists():
        for line in telemetry.open():
            if '"shot_event"' in line:
                e = json.loads(line)
                shots.append({k: e.get(k) for k in (
                    "frame_id", "result", "reason", "shot_designation", "shot_distance",
                    "court_x", "court_y", "time_to_apex", "shot_duration")})

    stages = ["preprocess_ms", "detect_infer_ms", "detect_decode_ms", "court_preprocess_ms", "court_infer_ms",
              "court_decode_ms", "pose_crop_ms", "pose_infer_ms", "pose_decode_ms", "state_machine_ms", "json_ms"]
    pipeline = col("pipeline_ms") if measured else []
    mean_ms = statistics.fmean(pipeline) if pipeline else None
    return {
        "run_id": run.id,
        "variant": run.variant.name,
        "changed_type": run.variant.type,
        "engines": {t: c.name for t, c in run.engines().items()},
        "cadence": {"court_every": run.cadence.court_every, "pose": run.cadence.pose,
                    "detect_every": run.cadence.detect_every, "name": run.cadence.name},
        "machine": tw.LABEL,
        "worker": tw.WORKER_ID,
        "gpu": GPU,
        "gpu_tag": GPU_TAG,
        "exit_code": exit_code,
        "wall_seconds": round(wall_s, 2),
        "frames": len(rows),
        "warmup_frames": WARMUP_FRAMES,
        "latency_ms": None if not pipeline else {
            "mean": round(mean_ms, 3),
            "p50": round(percentile(pipeline, 50), 3),
            "p95": round(percentile(pipeline, 95), 3),
            "p99": round(percentile(pipeline, 99), 3),
            "max": round(max(pipeline), 3),
        },
        "stage_mean_ms": {s.removesuffix("_ms"): round(statistics.fmean(col(s)), 3) for s in stages} if measured else {},
        "wait_mean_ms": round(statistics.fmean(col("wait_ms")), 3) if measured else None,
        "crop_mean_ms": round(statistics.fmean(col("crop_ms")), 3) if measured else None,
        "model_runs": {k: sum(int(r[f"ran_{k}"]) for r in rows) for k in ("detect", "court", "pose")} if rows else {},
        "frame_budget_ms": round(FRAME_BUDGET_MS, 3),
        "per_frame_ms": full_path(mean_ms),
        "real_time_60fps": bool(exit_code == 0 and holds_real_time(mean_ms)),
        "shots": shots,
    }


def execute(run: Run, video: Path) -> None:
    out = WORK / "out" / run.id
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    cmd = [BINARY]
    for model_type, config in run.engines().items():
        cmd += [FLAG[model_type], str(local_engine(config.name))]
    cmd += run.cadence.flags()
    cmd += ["--timing", str(out / "timing.csv"), str(video), str(out / "telemetry.jsonl")]
    started = time.time()
    with open(out / "stdout.log", "w") as stdout:
        try:
            code = subprocess.run(cmd, stdout=stdout, stderr=subprocess.STDOUT, cwd=out, timeout=RUN_TIMEOUT_S).returncode
        except subprocess.TimeoutExpired:
            code = -9
    wall = time.time() - started
    result = summarise(run, out / "timing.csv", out / "telemetry.jsonl", wall, code)
    result["command"] = " ".join(Path(c).name if c.startswith(str(WORK)) else c for c in cmd)
    for name in ("telemetry.jsonl", "timing.csv", "stdout.log"):
        src = out / name
        if src.exists():
            with open(src, "rb") as f_in, gzip.open(f"{src}.gz", "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
            s3.upload_file(f"{src}.gz", BUCKET, f"{PREFIX}/runs/{run.id}/{name}.gz")
    # Last, so its presence means the run is complete.
    s3.put_object(Bucket=BUCKET, Key=result_key(run), Body=json.dumps(result, indent=2).encode())
    lat = result["latency_ms"] or {}
    log(f"{run.id}: exit {code}, mean {lat.get('mean')} ms, p95 {lat.get('p95')} ms, "
        f"{'REAL TIME' if result['real_time_60fps'] else 'not real time'}, {len(result['shots'])} shots, {wall:.0f} s")
    shutil.rmtree(out, ignore_errors=True)


def job_runs(variant) -> list[Run]:
    return runs_of(variant)[:MAX_CADENCES]


def sweep_phase(interrupted: threading.Event) -> bool:
    """Runs one job if any can be claimed; True if it did."""
    # Highest training cost first, a rough proxy for the longest jobs (pose
    # variants carry no training cost, so they run last).
    for variant in sorted(variants(), key=lambda c: -c.cost()):
        if ONLY and variant.name not in ONLY:
            continue
        pending = [r for r in job_runs(variant) if not tw.exists(result_key(r))]
        if not pending:
            continue
        needed = {c.name for c in pending[0].engines().values()}
        if not all(tw.exists(engine_key(n)) for n in needed):
            continue
        lease = tw.Lease(f"{PREFIX}/claims/job-{variant.name}")
        if not lease.acquire():
            continue
        try:
            log(f"claimed {variant.name}: {len(pending)} run(s)")
            video = local_video()
            for run in pending:
                if interrupted.is_set() or lease.lost.is_set():
                    break
                if tw.exists(result_key(run)):
                    continue
                execute(run, video)
        except Exception as e:
            log(f"job {variant.name} failed: {e}")
        finally:
            lease.release()
        return True
    return False


def all_done() -> bool:
    return all(tw.exists(result_key(r)) for v in variants() if not ONLY or v.name in ONLY for r in job_runs(v))


def watch_spot(interrupted: threading.Event) -> None:
    while not interrupted.wait(5):
        if tw.imds("spot/instance-action"):
            log("spot interruption notice: finishing nothing new")
            interrupted.set()


def main() -> None:
    log(f"sweep worker {tw.WORKER_ID} on {GPU} ({GPU_TAG}), bucket {BUCKET}, prefix {PREFIX}")
    interrupted = threading.Event()
    if tw.ON_EC2:
        threading.Thread(target=watch_spot, args=(interrupted,), daemon=True).start()
    try:
        decode_phase()
    except Exception as e:  # the sweep itself must not depend on it
        log(f"decode bench skipped: {e}")
    announced = False
    while not interrupted.is_set():
        mode, _ = tw.get_json(f"{PREFIX}/control.json")
        if not mode or mode.get("mode") != "run":
            time.sleep(IDLE_POLL_S)
            continue
        if build_phase() or sweep_phase(interrupted):
            announced = False
            continue
        if all_done() and not announced:
            log("every run is done; waiting")
            announced = True
        time.sleep(IDLE_POLL_S)


if __name__ == "__main__":
    main()
