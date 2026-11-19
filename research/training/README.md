# Training the model matrix

The experiments use 27 model configurations: 3 model types × 3 sizes × 3
training resolutions, named `<type>-<size>-<res>`.

| Type | What it is | Produced by |
| --- | --- | --- |
| `obj` | object detection (ball, player, rim, net, backboard) | trained on `python/data-sets/object-detection/train3-data-set.yolo26`, 75 epochs |
| `court` | court keypoints | trained on `python/data-sets/pose-model/train2-data-set.yolo26`, 150 epochs, MuSGD |
| `player` | shooter pose | the stock COCO-pretrained YOLO26-pose, exported at the resolution, not trained (there is no player-pose dataset) |

Sizes `n`, `m`, `x`; resolutions 640, 960, 1280 (`obj-n-640`, `court-x-1280`,
`player-m-960`). `matrix.py` is the single source for names and settings.
Each type keeps the epochs, optimizer and patience of the run its current
model came from; other settings are Ultralytics defaults, so the court
recipe differs from that run's hand-tuned loss weights and augmentation.
Only the size and image size vary within a type. Every trained configuration uses `seed=0`,
`deterministic=True`, images cached in RAM, and a batch fitted to the GPU
with Ultralytics accumulating gradients to its nominal batch of 64, so the
effective batch is the same everywhere.

## How the work is spread

The 18 trained configurations run on up to four AWS GPU instances (two spot,
two on-demand, the limit of an 8-vCPU quota for each at 4 vCPUs an instance)
and the local GPU, all running the same worker, `worker.py`. Workers
coordinate through one S3 bucket, never with each other:

- A worker takes the longest unfinished job it can **claim**. A claim is an
  object under `claims/` written with a conditional write, renewed every
  minute; one not renewed for ten minutes may be taken over.
- During training it uploads the checkpoint at most every five minutes and on
  the last epoch (`runs/<name>/`). A worker that claims a job with a
  checkpoint resumes it, so a lost spot instance costs at most those minutes.
  On a spot interruption notice the worker uploads at once and lets go.
  A claimed job whose checkpoint already holds its last epoch skips
  training and goes straight to export (a run that stopped early is not
  recognised as finished this way).
- When a job finishes it exports the best weights to FP16 ONNX at the job's
  resolution and uploads the result to `weights/<name>/` with `DONE.json`
  (machine, wall time, seconds per epoch, final metrics).

`enqueue.py` is the master: it sets `control/mode.json`, which every worker
polls, and reports progress.

## Running it

```bash
# once
cd research/training/terraform/storage && terraform init && terraform apply     # the bucket (survives everything else)
cd ../compute && terraform init && terraform apply                      # ECR repo, roles, worker groups at 0
python research/training/enqueue.py upload-datasets

# the image
docker build -t followthrough-train research/training/
REPO=$(terraform -chdir=research/training/terraform/compute output -raw ecr_repository)
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
docker tag followthrough-train "$REPO:latest" && docker push "$REPO:latest"

# calibrate: every worker times the smallest and largest run of each type
python research/training/enqueue.py calibrate
terraform -chdir=research/training/terraform/compute apply -var spot=1
bash research/training/run_local_worker.sh                 # the local GPU as a worker
python research/training/enqueue.py report                 # seconds per epoch, projected wall time

# the run (optionally --obj-epochs / --court-epochs to shorten every run alike)
python research/training/enqueue.py start
terraform -chdir=research/training/terraform/compute apply -var spot=2 -var on_demand=2
python research/training/enqueue.py status

# the player configurations, and engines for all 27
python research/training/export_player.py
bash research/training/fetch_and_build.sh                  # engines built here, uploaded to weights/<name>/

# stop paying
terraform -chdir=research/training/terraform/compute apply -var spot=0 -var on_demand=0
```

Engines are built only on the machine that runs them (`fetch_and_build.sh`,
using `python/wrap_fp16_onnx.py` and `python/build_engines.py`), because a
TensorRT engine belongs to the GPU and TensorRT version it was built with.
Engines stay FP16. Nothing is kept locally: every file of every
configuration (`best.pt`, both ONNX files, `best.engine`, `DONE.json`) lives
in `s3://<bucket>/weights/<name>/`, and the latency sweep pulls each engine
from there when it needs it.

## Cost

About $1.00 an hour per on-demand `g5.xlarge` and $0.40 to $0.50 per spot one,
so two of each for eight hours is about $25. The bucket holds a few GB.
Checkpoints under `runs/` expire after a week; finished weights are kept.
