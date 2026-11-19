"""The sweep's master script: starts and stops the workers, reports progress
and collects the results.

    python research/sweep/enqueue.py upload-videos      # once: python/videos -> s3://<bucket>/videos/
    python research/sweep/enqueue.py start              # workers build engines, then run the 432
    python research/sweep/enqueue.py status             # engines built, runs done per variant, who holds what
    python research/sweep/enqueue.py requeue <variant>  # forget a variant's results; it runs again
    python research/sweep/enqueue.py stop               # workers start nothing new
    python research/sweep/enqueue.py collect            # every result.json -> research/sweep/results/runs.{jsonl,csv}

The bucket is the training one ($BUCKET, or the training storage stack's
Terraform output). Workers (worker.py) poll <prefix>/control.json; nothing
here talks to a machine directly. --prefix selects another sweep (a smoke
test writes to sweep-probe/).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from grid import CADENCES, full_path, holds_real_time, runs, variants  # noqa: E402

REPO = HERE.parents[1]  # the repository root (this file is research/sweep/enqueue.py)
GPU_TAG = os.environ.get("GPU_TAG", "A10G-trt11.2.1")  # the g5's engines (worker.py names them)
LEASE_STALE_S = 600


def bucket_name() -> str:
    if os.environ.get("BUCKET"):
        return os.environ["BUCKET"]
    out = subprocess.run(
        ["terraform", "output", "-raw", "bucket"],
        cwd=REPO / "research/training/terraform/storage",
        capture_output=True,
        text=True,
        check=True,
    )
    return out.stdout.strip()


BUCKET = bucket_name()
s3 = boto3.client("s3")


def get_json(key: str) -> dict | None:
    try:
        return json.loads(s3.get_object(Bucket=BUCKET, Key=key)["Body"].read())
    except ClientError:
        return None


def keys(prefix: str) -> list[str]:
    out = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix):
        out += [o["Key"] for o in page.get("Contents", [])]
    return out


def set_mode(prefix: str, mode: str) -> None:
    s3.put_object(Bucket=BUCKET, Key=f"{prefix}/control.json", Body=json.dumps({"mode": mode}).encode())
    print(f"{prefix}/control.json = {{\"mode\": \"{mode}\"}}")


def upload_videos() -> None:
    subprocess.run(
        ["aws", "s3", "sync", str(REPO / "python/videos"), f"s3://{BUCKET}/videos/",
         "--exclude", "yolo/*", "--exclude", "*.pyc", "--only-show-errors"],
        check=True,
    )
    print(f"python/videos -> s3://{BUCKET}/videos/")


def status(prefix: str) -> None:
    print(f"mode: {get_json(f'{prefix}/control.json')}")
    engines = {k.split("/")[1] for k in keys("weights/") if k.endswith(f"/engines/{GPU_TAG}.engine")}
    print(f"engines built for {GPU_TAG}: {len(engines)}/27")
    done = {k.split("/")[2] for k in keys(f"{prefix}/runs/") if k.endswith("/result.json")}
    claims = {k.rsplit("/", 1)[1]: get_json(k) for k in keys(f"{prefix}/claims/")}
    now = time.time()
    print(f"runs done: {len(done)}/{len(runs())}\n")
    print(f"{'variant':15} {'runs':>6}  where")
    for v in variants():
        n = sum(1 for c in CADENCES if f"{v.name}__{c.name}" in done)
        claim = claims.get(f"job-{v.name}")
        where = ""
        if claim:
            where = claim["worker"] + ("" if now - claim["renewed"] < LEASE_STALE_S else "  (stale)")
        print(f"{v.name:15} {n:>3}/16  {where}")
    building = [k for k in claims if k.startswith("build-")]
    if building:
        print("\nbuilding: " + ", ".join(b.split("-", 3)[-1] if b.count("-") >= 3 else b for b in building))


def requeue(prefix: str, variant: str) -> None:
    gone = [k for k in keys(f"{prefix}/runs/") if k.split("/")[2].startswith(f"{variant}__")]
    for i in range(0, len(gone), 1000):
        s3.delete_objects(Bucket=BUCKET, Delete={"Objects": [{"Key": k} for k in gone[i : i + 1000]]})
    s3.delete_object(Bucket=BUCKET, Key=f"{prefix}/claims/job-{variant}")
    print(f"{variant}: {len(gone)} object(s) removed; it runs again")


CSV_FIELDS = [
    "run_id", "variant", "changed_type", "engine_obj", "engine_court", "engine_player",
    "court_every", "pose", "detect_every", "cadence", "real_time_60fps",
    "encode_ms", "decode_ms", "backend_ms", "rate_ms",
    "mean_ms", "p50_ms", "p95_ms", "p99_ms", "max_ms", "wait_mean_ms", "crop_mean_ms",
    "detect_runs", "court_runs", "pose_runs", "frames", "shots", "machine", "gpu", "exit_code", "wall_seconds",
]


def collect(prefix: str) -> None:
    result_keys = [k for k in keys(f"{prefix}/runs/") if k.endswith("/result.json")]
    with ThreadPoolExecutor(16) as pool:
        results = [r for r in pool.map(get_json, result_keys) if r]
    results.sort(key=lambda r: r["run_id"])
    # The gate is re-derived here from the measured pipeline and grid.py's
    # constants, so a change to the constants needs no rerun.
    for r in results:
        mean = (r.get("latency_ms") or {}).get("mean")
        r["per_frame_ms"] = full_path(mean)
        r["real_time_60fps"] = bool(r["exit_code"] == 0 and holds_real_time(mean))
    out = HERE / "results" / ("" if prefix == "sweep" else prefix)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "runs.jsonl", "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    with open(out / "runs.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for r in results:
            lat = r.get("latency_ms") or {}
            runs_ = r.get("model_runs") or {}
            w.writerow({
                "run_id": r["run_id"], "variant": r["variant"], "changed_type": r["changed_type"],
                "engine_obj": r["engines"]["obj"], "engine_court": r["engines"]["court"],
                "engine_player": r["engines"]["player"],
                "court_every": r["cadence"]["court_every"], "pose": r["cadence"]["pose"],
                "detect_every": r["cadence"]["detect_every"], "cadence": r["cadence"]["name"],
                "real_time_60fps": r["real_time_60fps"],
                **{f"{k}_ms": (r["per_frame_ms"] or {}).get(k) for k in ("encode", "decode", "backend", "rate")},
                "mean_ms": lat.get("mean"), "p50_ms": lat.get("p50"), "p95_ms": lat.get("p95"),
                "p99_ms": lat.get("p99"), "max_ms": lat.get("max"),
                "wait_mean_ms": r.get("wait_mean_ms"), "crop_mean_ms": r.get("crop_mean_ms"),
                "detect_runs": runs_.get("detect"), "court_runs": runs_.get("court"), "pose_runs": runs_.get("pose"),
                "frames": r["frames"], "shots": len(r["shots"]), "machine": r["machine"], "gpu": r["gpu"],
                "exit_code": r["exit_code"], "wall_seconds": r["wall_seconds"],
            })
    rt = sum(1 for r in results if r["real_time_60fps"])
    print(f"{len(results)} run(s) -> {out}/runs.jsonl, runs.csv; {rt} real time at 60 fps")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", default="sweep")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("upload-videos", "start", "status", "stop", "collect"):
        sub.add_parser(name)
    rq = sub.add_parser("requeue")
    rq.add_argument("variant")
    args = parser.parse_args()
    if args.cmd == "upload-videos":
        upload_videos()
    elif args.cmd == "start":
        set_mode(args.prefix, "run")
    elif args.cmd == "stop":
        set_mode(args.prefix, "stop")
    elif args.cmd == "status":
        status(args.prefix)
    elif args.cmd == "requeue":
        requeue(args.prefix, args.variant)
    elif args.cmd == "collect":
        collect(args.prefix)


if __name__ == "__main__":
    main()
