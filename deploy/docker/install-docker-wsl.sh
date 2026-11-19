#!/usr/bin/env bash
# Docker Engine plus the NVIDIA container toolkit inside this WSL2 Ubuntu,
# so deploy/docker/Dockerfile can be built and run with the GPU here before
# an instance is involved. Needs the distro's systemd (it is on) and sudo.
#
#   sudo bash deploy/docker/install-docker-wsl.sh
#   # then open a new shell (group membership) and: docker run --rm --gpus all ubuntu:24.04 nvidia-smi
#
# The alternative is Docker Desktop on Windows with "WSL integration" turned
# on for this distro in its settings, which provides the same two things.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
TARGET_USER="${SUDO_USER:-$USER}"

apt-get update
apt-get install -y docker.io docker-compose-v2 curl gnupg
systemctl enable --now docker
usermod -aG docker "$TARGET_USER"

# NVIDIA container toolkit (official repository), configured for Docker.
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  > /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt-get update
apt-get install -y nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker
systemctl restart docker

echo "Docker $(docker --version | cut -d' ' -f3) with the NVIDIA runtime is installed."
echo "Open a new shell as $TARGET_USER, then: docker run --rm --gpus all ubuntu:24.04 nvidia-smi"
