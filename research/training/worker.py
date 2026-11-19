"""The training worker: the same loop on every machine, AWS or local.

    python worker.py            # inside the training image (see Dockerfile)

It takes the longest unfinished job it can claim, trains it, uploads the
weights and takes the next, until every job is done. Work is coordinated
entirely through the S3 bucket:

    control/mode.json          what to run: {"mode": "calibrate" | "train" | "stop",
                               "epochs": {"obj": 75, "court": 150}}, or
                               {"mode": "probe", "job": "obj-n-640", "epochs": 2}
                               to check the whole path on one short job (probe/)
    claims/<job>               the lease on a job: who holds it, renewed every
                               minute with a conditional write; a lease not renewed
                               for LEASE_STALE_S may be taken over by any worker
    runs/<job>/                the run directory, checkpointed during training
    weights/<job>/             the finished run: best.pt, last.pt, best.half.onnx,
                               results.csv, args.yaml, DONE.json
    calibration/<label>/<job>.json   seconds per epoch on one machine type

A claimed job whose run directory already holds a checkpoint is resumed from
it, so a spot instance that disappears costs at most the epochs since its last
upload. Environment: BUCKET (required), MACHINE_LABEL (defaults to the EC2
instance type, or "local"), WORK (default /work), DATASETS (default
$WORK/datasets).
"""

from __future__ import annotations

import csv
import json
import os
import shutil
import socket
import sys
import threading
import time
import traceback
import urllib.request
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

sys.path.insert(0, str(Path(__file__).resolve().parent))
from matrix import COMMON_TRAIN_ARGS, Config, calibration_configs, parse, trained_configs  # noqa: E402

BUCKET = os.environ["BUCKET"]
WORK = Path(os.environ.get("WORK", "/work"))
DATASETS = Path(os.environ.get("DATASETS", WORK / "datasets"))
RUNS = WORK / "runs"
CHECKPOINT_EVERY_S = 300  # upload last.pt at most this often (it can be hundreds of MB)
LEASE_RENEW_S = 60
LEASE_STALE_S = 600
IDLE_POLL_S = 60
CALIBRATION_EPOCHS = 3

s3 = boto3.client("s3")


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


# ---------------------------------------------------------------- machine

def imds(path: str) -> str | None:
    """EC2 instance metadata (IMDSv2), or None off EC2."""
    try:
        token_req = urllib.request.Request(
            "http://169.254.169.254/latest/api/token",
            method="PUT",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"},
        )
        token = urllib.request.urlopen(token_req, timeout=1).read().decode()
        req = urllib.request.Request(
            f"http://169.254.169.254/latest/meta-data/{path}",
            headers={"X-aws-ec2-metadata-token": token},
        )
        return urllib.request.urlopen(req, timeout=1).read().decode()
    except Exception:
        return None


ON_EC2 = imds("instance-type") is not None
LABEL = os.environ.get("MACHINE_LABEL") or imds("instance-type") or "local"
WORKER_ID = f"{LABEL}/{imds('instance-id') or socket.gethostname()}"


# ---------------------------------------------------------------- S3 helpers

def get_json(key: str) -> tuple[dict | None, str | None]:
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=key)
        return json.loads(obj["Body"].read()), obj["ETag"]
    except ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None, None
        raise


def exists(key: str) -> bool:
    try:
        s3.head_object(Bucket=BUCKET, Key=key)
        return True
    except ClientError:
        return False


def download_prefix(prefix: str, local: Path) -> int:
    count = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix + "/"):
        for item in page.get("Contents", []):
            target = local / item["Key"][len(prefix) + 1 :]
            target.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(BUCKET, item["Key"], str(target))
            count += 1
    return count


def sync_datasets() -> None:
    """The datasets, downloaded once per machine."""
    marker = DATASETS / ".complete"
    if marker.exists():
        return
    log("downloading datasets")
    download_prefix("datasets", DATASETS)
    marker.touch()
    log("datasets ready")


# ---------------------------------------------------------------- leases

class Lease:
    """A claim on one job, held by renewing it with a conditional write."""

    def __init__(self, key: str):
        self.key = key
        self.etag: str | None = None
        self.lost = threading.Event()
        self._stop = threading.Event()

    def _body(self) -> bytes:
        return json.dumps({"worker": WORKER_ID, "label": LABEL, "renewed": time.time()}).encode()

    def acquire(self) -> bool:
        current, etag = get_json(self.key)
        try:
            if current is None:
                put = s3.put_object(Bucket=BUCKET, Key=self.key, Body=self._body(), IfNoneMatch="*")
            elif time.time() - current.get("renewed", 0) > LEASE_STALE_S:
                log(f"taking over stale lease {self.key} from {current.get('worker')}")
                put = s3.put_object(Bucket=BUCKET, Key=self.key, Body=self._body(), IfMatch=etag)
            else:
                return False
        except ClientError as e:
            if e.response["Error"]["Code"] in ("PreconditionFailed", "ConditionalRequestConflict", "412", "409"):
                return False
            raise
        self.etag = put["ETag"]
        threading.Thread(target=self._renew, daemon=True).start()
        return True

    def _renew(self) -> None:
        while not self._stop.wait(LEASE_RENEW_S):
            try:
                put = s3.put_object(Bucket=BUCKET, Key=self.key, Body=self._body(), IfMatch=self.etag)
                self.etag = put["ETag"]
            except ClientError as e:
                log(f"lease {self.key} lost: {e}")
                self.lost.set()
                return

    def release(self) -> None:
        self._stop.set()
        try:
            s3.delete_object(Bucket=BUCKET, Key=self.key)
        except ClientError:
            pass


# ---------------------------------------------------------------- training

class Checkpointer:
    """Uploads the run directory's progress from the training callback."""

    def __init__(self, job: str, lease: Lease):
        self.prefix = f"runs/{job}"
        self.lease = lease
        self.last_upload = 0.0
        self.lock = threading.Lock()
        self.save_dir: Path | None = None

    def push(self, force: bool = False) -> None:
        if self.save_dir is None:
            return
        with self.lock:
            if not force and time.time() - self.last_upload < CHECKPOINT_EVERY_S:
                return
            for rel in ("weights/last.pt", "weights/best.pt", "results.csv", "args.yaml"):
                path = self.save_dir / rel
                if path.exists():
                    s3.upload_file(str(path), BUCKET, f"{self.prefix}/{rel}")
            self.last_upload = time.time()

    def on_epoch(self, trainer) -> None:
        self.save_dir = Path(trainer.save_dir)
        s3.put_object(
            Bucket=BUCKET,
            Key=f"{self.prefix}/progress.json",
            Body=json.dumps(
                {"epoch": trainer.epoch + 1, "epochs": trainer.epochs, "worker": WORKER_ID, "at": time.time()}
            ).encode(),
        )
        self.push(force=trainer.epoch + 1 >= trainer.epochs)
        if self.lease.lost.is_set():
            raise RuntimeError("lease lost: another worker has this job")


def watch_spot(checkpointer: Checkpointer, done: threading.Event) -> None:
    """On the two-minute spot interruption notice, upload what there is."""
    while not done.wait(5):
        if imds("spot/instance-action"):
            log("spot interruption notice: uploading the checkpoint")
            checkpointer.push(force=True)
            checkpointer.lease.release()
            return


def checkpoint_finished(path: Path) -> bool:
    """Whether Ultralytics would refuse to resume this checkpoint as finished.

    A stripped checkpoint has epoch -1; one uploaded on the last epoch, before
    the strip, has epoch = epochs - 1.
    """
    import torch

    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    epoch = ckpt.get("epoch", 0)
    return epoch == -1 or epoch + 1 >= int(ckpt.get("train_args", {}).get("epochs", 0) or 0) > 0


def train(config: Config, epochs: int, prefix_root: str, lease: Lease) -> Path:
    """Trains (or resumes) one configuration; returns its run directory."""
    from ultralytics import YOLO

    run_dir = RUNS / prefix_root.replace("/", "_")
    checkpointer = Checkpointer(prefix_root, lease)
    checkpointer.save_dir = run_dir
    done = threading.Event()
    if ON_EC2:
        threading.Thread(target=watch_spot, args=(checkpointer, done), daemon=True).start()

    resumed = download_prefix(f"runs/{prefix_root}", run_dir) > 0 and (run_dir / "weights/last.pt").exists()
    try:
        if resumed and checkpoint_finished(run_dir / "weights/last.pt"):
            # Training ended but the worker died before exporting (for
            # instance killed for memory in the final validation): there is
            # nothing to resume, only the export left.
            log(f"{prefix_root}: the uploaded checkpoint is finished; exporting it")
        elif resumed:
            log(f"{prefix_root}: resuming from the uploaded checkpoint")
            model = YOLO(str(run_dir / "weights/last.pt"))
            model.add_callback("on_fit_epoch_end", checkpointer.on_epoch)
            model.train(resume=True, batch=-1)
        else:
            t = config.model_type
            model = YOLO(config.weights)
            model.add_callback("on_fit_epoch_end", checkpointer.on_epoch)
            model.train(
                data=str(DATASETS / t.data),
                epochs=epochs,
                imgsz=config.res,
                optimizer=t.optimizer,
                patience=t.patience,
                project=str(RUNS),
                name=run_dir.name,
                device=0,
                **COMMON_TRAIN_ARGS,
            )
        checkpointer.push(force=True)
    finally:
        done.set()
    return run_dir


def final_metrics(run_dir: Path) -> dict:
    rows = list(csv.DictReader((run_dir / "results.csv").open()))
    if not rows:
        return {}
    return {k.strip(): float(v) for k, v in rows[-1].items() if k and v not in ("", None)}


def epoch_seconds(run_dir: Path) -> float:
    """Seconds per epoch, excluding the first (which includes warm-up)."""
    times = [float(r["time"]) for r in csv.DictReader((run_dir / "results.csv").open())]
    if len(times) < 2:
        return times[0] if times else 0.0
    return (times[-1] - times[0]) / (len(times) - 1)


def finish(config: Config, run_dir: Path, started: float, prefix: str) -> None:
    from ultralytics import YOLO

    best = run_dir / "weights/best.pt"
    log(f"{config.name}: exporting FP16 ONNX at {config.res}")
    onnx_path = Path(YOLO(str(best)).export(format="onnx", imgsz=config.res, half=True, device=0))
    out = run_dir / "export"
    out.mkdir(exist_ok=True)
    shutil.copy(onnx_path, out / "best.half.onnx")
    for rel in ("weights/best.pt", "weights/last.pt", "results.csv", "args.yaml"):
        if (run_dir / rel).exists():
            s3.upload_file(str(run_dir / rel), BUCKET, f"{prefix}/{Path(rel).name}")
    s3.upload_file(str(out / "best.half.onnx"), BUCKET, f"{prefix}/best.half.onnx")
    s3.put_object(
        Bucket=BUCKET,
        Key=f"{prefix}/DONE.json",
        Body=json.dumps(
            {
                "name": config.name,
                "worker": WORKER_ID,
                "machine": LABEL,
                "wall_seconds": round(time.time() - started),
                "seconds_per_epoch": round(epoch_seconds(run_dir), 2),
                "metrics": final_metrics(run_dir),
            },
            indent=2,
        ).encode(),
    )
    log(f"{config.name}: done")


# ---------------------------------------------------------------- the loop

def next_job(mode: dict) -> tuple[str, Config, int, Lease] | None:
    """The first job, in matrix order, that is unfinished and claimable."""
    if mode["mode"] == "probe":
        config = parse(mode["job"])
        if exists(f"probe/weights/{config.name}/DONE.json"):
            return None
        lease = Lease(f"claims/probe/{config.name}")
        if lease.acquire():
            return f"probe/{config.name}", config, int(mode.get("epochs", 2)), lease
        return None
    if mode["mode"] == "calibrate":
        for config in calibration_configs():
            key = f"calibration/{LABEL}/{config.name}.json"
            if exists(key):
                continue
            lease = Lease(f"claims/calibration/{LABEL}/{config.name}")
            if lease.acquire():
                return f"calibration/{LABEL}/{config.name}", config, CALIBRATION_EPOCHS, lease
        return None
    epochs = mode.get("epochs", {})
    for config in trained_configs():
        if exists(f"weights/{config.name}/DONE.json"):
            continue
        lease = Lease(f"claims/{config.name}")
        if lease.acquire():
            return config.name, config, int(epochs.get(config.type, config.model_type.epochs)), lease
    return None


def all_done(mode: dict) -> bool:
    if mode["mode"] == "probe":
        return exists(f"probe/weights/{mode['job']}/DONE.json")
    if mode["mode"] == "calibrate":
        return all(exists(f"calibration/{LABEL}/{c.name}.json") for c in calibration_configs())
    return all(exists(f"weights/{c.name}/DONE.json") for c in trained_configs())


def main() -> None:
    log(f"worker {WORKER_ID} on bucket {BUCKET}")
    sync_datasets()
    while True:
        mode, _ = get_json("control/mode.json")
        if not mode or mode.get("mode") == "stop":
            log("no work (control/mode.json is absent or says stop); waiting")
            time.sleep(IDLE_POLL_S)
            continue
        job = next_job(mode)
        if job is None:
            if all_done(mode):
                log(f"every {mode['mode']} job is done; waiting for new work")
            time.sleep(IDLE_POLL_S)
            continue
        prefix, config, epochs, lease = job
        started = time.time()
        log(f"claimed {prefix}: {config.weights} at {config.res}, {epochs} epochs")
        try:
            run_dir = train(config, epochs, prefix, lease)
            if mode["mode"] == "calibrate":
                s3.put_object(
                    Bucket=BUCKET,
                    Key=f"calibration/{LABEL}/{config.name}.json",
                    Body=json.dumps(
                        {"name": config.name, "machine": LABEL, "seconds_per_epoch": epoch_seconds(run_dir)}
                    ).encode(),
                )
                shutil.rmtree(run_dir, ignore_errors=True)
                s3_delete_prefix(f"runs/{prefix}")
            elif mode["mode"] == "probe":
                finish(config, run_dir, started, f"probe/weights/{config.name}")
            else:
                finish(config, run_dir, started, f"weights/{config.name}")
            # Everything worth keeping is in the bucket now; a run directory
            # is hundreds of MB to a few GB, and the local machine is short
            # of space.
            shutil.rmtree(run_dir, ignore_errors=True)
        except Exception:
            log(f"{prefix} failed:\n{traceback.format_exc()}")
        finally:
            lease.release()


def s3_delete_prefix(prefix: str) -> None:
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=BUCKET, Prefix=prefix + "/"):
        keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
        if keys:
            s3.delete_objects(Bucket=BUCKET, Delete={"Objects": keys})


if __name__ == "__main__":
    main()
