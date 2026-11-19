"""The master script: tells every worker what to run and reports progress.

    python enqueue.py upload-datasets      # once: python/data-sets -> s3://<bucket>/datasets
    python enqueue.py probe [--job obj-n-640] [--epochs 2]   # the whole path on one short job
    python enqueue.py calibrate            # each worker times the two ends of each type
    python enqueue.py report               # calibration: seconds per epoch, projected wall time
    python enqueue.py start [--obj-epochs N] [--court-epochs N]
    python enqueue.py status               # every job: queued, running where and at which epoch, done
    python enqueue.py requeue <name>       # forget a job's lease and run directory; it starts again
    python enqueue.py stop                 # workers finish nothing new

The bucket comes from $BUCKET, or the storage stack's Terraform output.
Workers (worker.py) poll control/mode.json, so nothing here talks to a
machine directly.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from matrix import TYPES, calibration_configs, trained_configs  # noqa: E402

REPO = HERE.parents[1]  # the repository root (this file is research/training/enqueue.py)
LEASE_STALE_S = 600


def bucket_name() -> str:
    if os.environ.get("BUCKET"):
        return os.environ["BUCKET"]
    out = subprocess.run(
        ["terraform", "output", "-raw", "bucket"],
        cwd=HERE / "terraform/storage",
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


def put_json(key: str, value: dict) -> None:
    s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(value, indent=2).encode())


def set_mode(mode: dict) -> None:
    put_json("control/mode.json", mode)
    print(f"control/mode.json = {json.dumps(mode)}")


def upload_datasets() -> None:
    for t in TYPES.values():
        if not t.trained:
            continue
        local = REPO / "python/data-sets" / Path(t.data).parts[0] / Path(t.data).parts[1]
        prefix = f"s3://{BUCKET}/datasets/{Path(t.data).parts[0]}/{Path(t.data).parts[1]}"
        print(f"{local} -> {prefix}")
        subprocess.run(["aws", "s3", "sync", str(local), prefix, "--only-show-errors"], check=True)


def calibration_rows() -> list[dict]:
    rows = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix="calibration/"):
        for item in page.get("Contents", []):
            if item["Key"].endswith(".json"):
                rows.append(get_json(item["Key"]) or {})
    return rows


def report() -> None:
    """Seconds per epoch measured at each type's two ends, and a projection.

    Per-epoch time between the measured ends is interpolated on the same
    cost model matrix.py orders jobs by; the projection schedules the jobs
    longest first onto the machines that reported, as the workers will.
    """
    rows = calibration_rows()
    if not rows:
        print("no calibration results yet")
        return
    by_machine: dict[str, dict[str, float]] = {}
    for r in rows:
        by_machine.setdefault(r["machine"], {})[r["name"]] = r["seconds_per_epoch"]
    print(f"{'machine':18} " + " ".join(f"{c.name:>14}" for c in calibration_configs()))
    for machine, seconds in sorted(by_machine.items()):
        print(f"{machine:18} " + " ".join(f"{seconds.get(c.name, float('nan')):13.1f}s" for c in calibration_configs()))

    def estimate(machine: str, config) -> float | None:
        seconds = by_machine[machine]
        lo, hi = seconds.get(f"{config.type}-n-640"), seconds.get(f"{config.type}-x-1280")
        if lo is None or hi is None:
            return None
        from matrix import Config

        c_lo, c_hi = Config(config.type, "n", 640).cost(), Config(config.type, "x", 1280).cost()
        f = (config.cost() - c_lo) / (c_hi - c_lo)
        return (lo + f * (hi - lo)) * config.model_type.epochs

    machines = [m for m in by_machine if all(estimate(m, c) is not None for c in trained_configs())]
    if not machines:
        return
    ref = machines[0]
    total = sum(estimate(ref, c) for c in trained_configs())
    print(f"\nall 18 runs back to back on {ref}: {total / 3600:.1f} h")
    print("projection, longest first, one worker per machine type that reported:")
    free = {m: 0.0 for m in machines}
    for c in trained_configs():
        m = min(free, key=free.get)
        free[m] += estimate(m, c)
    print(f"  {len(machines)} workers: done in {max(free.values()) / 3600:.1f} h")


def status() -> None:
    mode = get_json("control/mode.json")
    print(f"mode: {json.dumps(mode)}\n")
    now = time.time()
    print(f"{'job':15} {'state':10} {'where':32} {'progress':>12} {'detail'}")
    for c in trained_configs():
        done = get_json(f"weights/{c.name}/DONE.json")
        if done:
            m = done.get("metrics", {})
            score = m.get("metrics/mAP50-95(P)", m.get("metrics/mAP50-95(B)"))
            print(f"{c.name:15} {'done':10} {done['machine']:32} {done['wall_seconds'] / 3600:10.2f} h  mAP50-95 {score}")
            continue
        claim = get_json(f"claims/{c.name}")
        progress = get_json(f"runs/{c.name}/progress.json")
        where = claim["worker"] if claim else ""
        state = "queued"
        if claim:
            state = "running" if now - claim["renewed"] < LEASE_STALE_S else "stale"
        elif progress:
            state = "paused"  # a checkpoint exists, nobody holds it: the next free worker resumes it
        p = f"{progress['epoch']}/{progress['epochs']}" if progress else ""
        print(f"{c.name:15} {state:10} {where:32} {p:>12}")


def requeue(name: str) -> None:
    s3.delete_object(Bucket=BUCKET, Key=f"claims/{name}")
    for prefix in (f"runs/{name}/", f"weights/{name}/"):
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix):
            keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if keys:
                s3.delete_objects(Bucket=BUCKET, Delete={"Objects": keys})
    print(f"{name} will start again from scratch")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("upload-datasets")
    probe = sub.add_parser("probe")
    probe.add_argument("--job", default="obj-n-640")
    probe.add_argument("--epochs", type=int, default=2)
    sub.add_parser("calibrate")
    sub.add_parser("report")
    start = sub.add_parser("start")
    start.add_argument("--obj-epochs", type=int, default=TYPES["obj"].epochs)
    start.add_argument("--court-epochs", type=int, default=TYPES["court"].epochs)
    sub.add_parser("status")
    rq = sub.add_parser("requeue")
    rq.add_argument("name")
    sub.add_parser("stop")
    args = parser.parse_args()

    if args.cmd == "upload-datasets":
        upload_datasets()
    elif args.cmd == "probe":
        set_mode({"mode": "probe", "job": args.job, "epochs": args.epochs})
    elif args.cmd == "calibrate":
        set_mode({"mode": "calibrate"})
    elif args.cmd == "report":
        report()
    elif args.cmd == "start":
        set_mode({"mode": "train", "epochs": {"obj": args.obj_epochs, "court": args.court_epochs}})
    elif args.cmd == "status":
        status()
    elif args.cmd == "requeue":
        requeue(args.name)
    elif args.cmd == "stop":
        set_mode({"mode": "stop"})


if __name__ == "__main__":
    main()
