#!/bin/bash
# cloud-init for the FollowThrough monolith instance (deploy/terraform/main.tf).
# Runs once as root on first boot. The Deep Learning Base AMI already has
# the NVIDIA driver, Docker and the NVIDIA container toolkit; this clones
# the repository, gets the image (from ECR when it is there, otherwise by
# building it here and pushing it) and starts the container.
#
# Follow it with:  tail -f /var/log/followthrough-setup.log
set -euo pipefail
exec > >(tee -a /var/log/followthrough-setup.log) 2>&1
echo "== $(date -u +%FT%TZ) FollowThrough setup starting"

REPO_URL="${repo_url}"
REPO_REF="${repo_ref}"
ECR_URL="${ecr_url}"
IMAGE_TAG="${image_tag}"
REGION="${region}"
CHECKOUT=/opt/followthrough

# Docker and the GPU runtime, as shipped with the AMI.
systemctl enable --now docker
for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done
docker compose version || apt-get install -y docker-compose-plugin
nvidia-smi --query-gpu=name --format=csv,noheader
docker run --rm --gpus all ubuntu:24.04 true && echo "== GPU runtime works"

# The checkout the image is built from (and compose.yaml runs from).
if [ ! -d "$CHECKOUT/.git" ]; then
  git clone --branch "$REPO_REF" "$REPO_URL" "$CHECKOUT"
else
  git -C "$CHECKOUT" fetch --all && git -C "$CHECKOUT" checkout "$REPO_REF" && git -C "$CHECKOUT" pull --ff-only || true
fi

# The API's signing secret, kept out of the image and the repository.
mkdir -p /etc/followthrough
if [ ! -f /etc/followthrough/api.env ]; then
  echo "FOLLOWTHROUGH_JWT_SECRET=$(openssl rand -base64 48)" > /etc/followthrough/api.env
  chmod 600 /etc/followthrough/api.env
fi

# The image: pull from ECR, or build here and push so the next instance pulls.
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$${ECR_URL%%/*}"
if docker pull "$ECR_URL:$IMAGE_TAG"; then
  echo "== using the image from ECR ($IMAGE_TAG)"
  docker tag "$ECR_URL:$IMAGE_TAG" followthrough:latest
else
  echo "== no image in ECR for $IMAGE_TAG; building it here (30-45 min)"
  cd "$CHECKOUT/deploy/docker"
  docker compose build
  docker tag followthrough:latest "$ECR_URL:$IMAGE_TAG"
  docker push "$ECR_URL:$IMAGE_TAG" && echo "== pushed $ECR_URL:$IMAGE_TAG"
fi

cd "$CHECKOUT/deploy/docker"
docker compose up -d --no-build
echo "== container started; engines build on first start (a few minutes), then the tunnel address is at:"
echo "   docker exec followthrough cat /var/log/followthrough/public-origin"
echo "== $(date -u +%FT%TZ) FollowThrough setup done"
