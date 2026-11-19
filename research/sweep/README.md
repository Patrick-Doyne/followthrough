# The configuration sweep

432 runs of the offline pipeline on one ground-truth clip,
`python/videos/train3/burkelake8.MOV` (28 s, 4K, 60 fps, 1,674 frames, 5 shots):

- **27 engine variants.** Each run swaps in one of the 27 engines
  (`research/training/matrix.py`). The other two models stay at the baseline, the
  n-640 engine of their type. The baseline triple appears three times, once
  under each type, which doubles as a repeatability check.
- **16 cadences.** Court keypoints run every 1, 5, 10 or 20 frames. Shooter
  pose runs near the release zone or on every frame. The detector runs on
  every frame, or every other frame with coasting.

Run ids read `<variant>__c<N>-p<gate|every>-d<K>`, for example
`obj-m-960__c10-pgate-d1`. `grid.py` is the single source for both.

## What is measured

- **Latency.** Each run records the pipeline time per frame: from the frame
  in hand to its telemetry written, excluding decode. The first 60 frames
  are warm-up and are dropped.
- **Why decode is excluded.** The live backend decodes on NVDEC separately.
  The batch binary decodes 4K HEVC on the CPU, and that is reported apart.
- **Real time, on the full per-frame path.** Phone encode and backend
  decode are held constant (`grid.py`), so configurations are compared
  offline. Both are 4K figures:

  | Stage | ms per frame, 4K | |
  | --- | --- | --- |
  | Phone H.264 encode | 10.0 | constant: iPhone hardware encoder, expected from published figures, not measured |
  | Backend H.264 decode | 6.37 | constant: NVDEC incl. conversion to BGR, measured on the g5.xlarge (A10G) by `research/sweep/decode` (4.28 on the RTX 3090) |
  | Detection pipeline | measured | each run's mean on the A10G |
  | Backend total | decode + pipeline | one after the other on the GPU machine |
  | Rate-setting stage | max(encode, backend total) | phone and backend run in parallel |

  A run holds real time at 60 fps when its rate-setting stage is at or under
  the 16.7 ms budget, so the pipeline may take at most 10.3 ms. `collect`
  re-derives the gate from the measured pipeline, so changing a constant
  needs no rerun. p50, p95, p99 and the per-stage means are stored beside it.
- **Hardware.** Every run is on an EC2 g5.xlarge (NVIDIA A10G), the GPU
  chosen to define real time for the study; the deploy stack runs on a
  `g6e.xlarge` by default and also takes a `g5.xlarge` (`deploy/README.md`).
  Engines are built on that GPU type with TensorRT 11.2.1 and stay FP16.

- **How the decode constant was measured.** `decode/` holds a benchmark
  built from the live backend's own `H264Decoder` class (`build.sh` copies
  it out of `cpp/follow-through-webrtc.cpp` unchanged): NVDEC, the frame
  brought to system memory, NV12 to BGR on the CPU. Its input is burkelake8
  re-encoded as the phone sends it, H.264 at 4K and 60 fps with no B-frames at the
  app's 40 Mbit/s cap (`decode/make_stream.sh`, uploaded to
  `videos/bench/`). A worker runs it once per GPU type before anything else
  and writes `sweep/decode/<GPU>.json` in the bucket. The A10G measured 6.37 ms (median of
  3 passes); the RTX 3090 measured 4.28 ms.

**Accuracy** is each model's mAP50-95, in `model_scores.json` with its
source: the best epoch of each training run for the detector and court
models, and COCO val2017 for the stock pose models. The three types are
scored on different validation sets, so values compare only within a type.

**Fidelity** is scored against `ground_truth/burkelake8.json` by
`score.py`, which writes `scores.csv` for the real-time runs. `report.py`
scores every configuration with the same function for its charts:

| Metric | How it is scored |
| --- | --- |
| Shots detected | Predicted shots matched one-to-one to recorded ones by result frame, within ±60 frames; charts show shots found out of 5, and `scores.csv` also keeps F1 |
| Make or miss | Against the recorded shots: makes called right of the 3 recorded and misses of the 2 recorded; a recorded shot not found counts as wrong |
| Shot category | Share of matched shots whose range class equals the recorded one |
| Distance | Mean absolute error in feet against the ground-truth distance |

The ground-truth file holds each shot's frames, result, distance and range
class. Shot count and make or miss are the session's recorded outcomes.
Distance and range class are the reference configuration's output for the
clip: the app's models, with the detector on every frame, court keypoints
every 10 frames and pose near release. That configuration was accepted as
ground truth, so these values are not tape measurements. The file's `source`
field says so.

## Running it

```bash
export BUCKET=$(terraform -chdir=research/training/terraform/storage output -raw bucket)
python research/sweep/enqueue.py upload-videos                 # once: python/videos -> s3://$BUCKET/videos/

bash research/sweep/build_image.sh                             # followthrough-sweep:latest
terraform -chdir=research/sweep/terraform init && terraform -chdir=research/sweep/terraform apply   # ECR repo, groups at 0
REPO=$(terraform -chdir=research/sweep/terraform output -raw ecr_repository)
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
docker tag followthrough-sweep "$REPO:latest" && docker push "$REPO:latest"

python research/sweep/enqueue.py start
terraform -chdir=research/sweep/terraform apply -var spot=2 -var on_demand=2
python research/sweep/enqueue.py status                        # engines built, runs done per variant

python research/sweep/enqueue.py collect                       # result.json files -> research/sweep/results/runs.{jsonl,csv}
python research/sweep/score.py                                 # -> research/sweep/results/scores.csv
python research/sweep/report.py                                # -> the figures below, PNG and SVG

terraform -chdir=research/sweep/terraform apply -var spot=0 -var on_demand=0   # stop paying
```

**The figures** (`research/sweep/results/`), in the order of the three levers:

| Lever | Figure | What it shows |
| --- | --- | --- |
| Speed | `latency_matrix` | Every configuration's rate-setting stage, ms per frame, with the per-frame stage table on top |
| Accuracy | `model_accuracy` | The 27 models' mAP50-95 ranked within each type, the app's model as a grey bar |
| Fidelity | `shots_detected`, `make_miss`, `shot_category`, `distance_error` | Each metric against ms per frame for every configuration, the real-time band shaded |
| Fidelity | `top_15_real_time` | The 15 best real-time configurations on each metric; those in all four lists marked |
| All three | `final_top_10` | Speed and accuracy as gates, ranked by shots found, then make/miss |

**How the workers split the work.** Workers (`worker.py`) coordinate through
the bucket with the same conditional-write leases as training. They first
build the 27 engines, one lease per engine, and upload each to
`weights/<name>/engines/<GPU>-trt<version>.engine`. Then each worker claims
one variant at a time and runs its 16 cadences one after another, alone on
its GPU.

**What each run uploads**, to `sweep/runs/<run_id>/`:

- `result.json` is the summary.
- The telemetry, the per-frame timing CSV and the binary's log are gzipped
  beside it.

A run with a `result.json` is never repeated, so a lost spot instance costs
at most the run in progress. Run a smoke test against another prefix with
`SWEEP_PREFIX=sweep-probe ONLY=obj-n-640 MAX_CADENCES=2`.

**The batch binary's options** (`cpp/follow-through-batch.cpp`) are
`--detect`, `--court`, `--pose`, `--court-every`, `--pose-every-frame`,
`--detect-every` and `--timing`. Without them it behaves as the app expects.
