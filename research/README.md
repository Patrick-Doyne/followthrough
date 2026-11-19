# Research: accuracy, latency and telemetry trade-offs

This folder is a study run on the app, not part of it. The app runs without
anything here; nothing outside this folder imports it. It asks how far model
choice and inference cadence can trade latency against accuracy and the
fidelity of the telemetry a player sees, for one phone camera streaming to
one cloud GPU.

| Folder | What it does |
| --- | --- |
| [training/](training/README.md) | Trains the 27 engines: 3 model types (object detection, court keypoints, shooter pose) × 3 sizes (n, m, x) × 3 training image sizes (640, 960, 1280), on AWS spot and on-demand GPUs coordinated through S3 |
| [sweep/](sweep/README.md) | Runs the 432 configurations (27 engine variants × 16 cadences) on EC2 g5.xlarge, measures the decode cost on that GPU, scores every configuration against `burkelake8`'s ground truth, and draws the figures for the three levers |

The sweep drives the app's own offline binary, `cpp/follow-through-batch.cpp`,
through command-line options (`--detect`, `--court`, `--pose`,
`--court-every`, `--pose-every-frame`, `--detect-every`, `--timing`; see
[cpp/README.md](../cpp/README.md)). Without those options the binary runs the
app's models at the app's cadence, so the study adds no behaviour to the app.

The results and figures are committed in `sweep/results/`. Everything large
(datasets, weights, engines, per-run telemetry) lives in the S3 bucket that
`training/terraform/storage` creates; nothing large is kept here.
