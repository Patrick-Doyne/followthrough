#!/usr/bin/env bash
# First boot of a training worker: pull the training image and run the
# worker in it. Restarted by Docker if it exits, and on reboot.
set -euxo pipefail
exec > >(tee -a /var/log/followthrough-train.log) 2>&1

REGION="${region}"
IMAGE="${image}"
BUCKET="${bucket}"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$${IMAGE%%/*}"
until docker pull "$IMAGE"; do sleep 20; done

mkdir -p /opt/ft-work
# Host network so the worker can read the instance metadata (its instance
# type, and the spot interruption notice); the image's PyTorch dataloader
# needs more shared memory than Docker's default.
docker run -d --name worker --restart unless-stopped \
  --gpus all --network host --shm-size 8g \
  -e BUCKET="$BUCKET" -e AWS_DEFAULT_REGION="$REGION" \
  -v /opt/ft-work:/work \
  "$IMAGE"
