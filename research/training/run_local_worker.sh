#!/usr/bin/env bash
# Runs the training worker on this machine's GPU, in the same image the AWS
# workers run, with this machine's AWS credentials.
#
#   bash research/training/run_local_worker.sh          # from the repo root
#   docker logs -f ft-train-worker
#   docker rm -f ft-train-worker               # stop it (its job resumes elsewhere)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUCKET="${BUCKET:-$(terraform -chdir="$ROOT/research/training/terraform/storage" output -raw bucket)}"
WORK="${WORK_DIR:-$HOME/ft-train-work}"
mkdir -p "$WORK"

docker rm -f ft-train-worker >/dev/null 2>&1 || true
docker run -d --name ft-train-worker --restart unless-stopped \
  --gpus all --shm-size 8g \
  -e BUCKET="$BUCKET" -e AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}" \
  -e MACHINE_LABEL="${MACHINE_LABEL:-local-rtx3090}" \
  -v "$HOME/.aws:/root/.aws:ro" \
  -v "$WORK:/work" \
  followthrough-train:latest
echo "worker started: docker logs -f ft-train-worker"
