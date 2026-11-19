#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 GPU instance (AWS "Deep Learning
# Base OSS Nvidia Driver GPU AMI") for the FollowThrough live pipeline, web
# app, API, signaling relay, reverse proxy and public tunnel.
#
#   ssh ubuntu@<ip>
#   git clone https://github.com/Patrick-Doyne/followthrough.git ~/followthrough
#   bash ~/followthrough/deploy/ec2-setup.sh
#
# Every step checks for its own result first, so the script can be rerun
# after a failure and continues where it stopped. Expect 60 to 90 minutes,
# most of it the KVS SDK build and the TensorRT engine export.
#
# Versions are pinned to what the engines and binaries were built with on
# the development machine (cpp/README.md "Confirmed working configuration"):
# CUDA 13.3, TensorRT 11.2.1. Changing either means re-exporting the engines,
# which this script does anyway because engines are specific to the GPU.
set -euo pipefail

ROOT="$HOME/followthrough"            # no spaces: the KVS SDK's OpenSSL sub-build cannot cope with them
SDK_DIR="$HOME/kvs-webrtc-sdk"
SDK_TAG="v1.20.0"
VENV="$HOME/.venvs/followthrough"
CUDA_VER="13.3"
TRT_VER="11.2.1.2-1+cuda13.3"
TRT_PIP="11.2.1"

log() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

[ -d "$ROOT/.git" ] || { echo "Clone the repository to $ROOT first (see the header)." >&2; exit 1; }

log "1/12 apt packages"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential cmake git curl m4 pkg-config unzip \
  libopencv-dev nlohmann-json3-dev libavcodec-dev libavutil-dev libavformat-dev libswscale-dev \
  libssl-dev libcurl4-openssl-dev liblog4cplus-dev \
  openjdk-17-jdk-headless python3-venv python3-pip

log "2/12 Node 22"
if ! node --version 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node --version

log "3/12 NVIDIA driver check"
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader

log "4/12 CUDA toolkit $CUDA_VER"
if ! dpkg -s cuda-keyring >/dev/null 2>&1; then
  curl -fsSLo /tmp/cuda-keyring.deb \
    https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb
  sudo dpkg -i /tmp/cuda-keyring.deb
  sudo apt-get update -y
fi
if [ ! -x "/usr/local/cuda-$CUDA_VER/bin/nvcc" ]; then
  sudo apt-get install -y "cuda-toolkit-${CUDA_VER/./-}"
fi
"/usr/local/cuda-$CUDA_VER/bin/nvcc" --version | tail -1
grep -q "cuda-$CUDA_VER/bin" "$HOME/.bashrc" || {
  echo "export PATH=/usr/local/cuda-$CUDA_VER/bin:\$PATH" >> "$HOME/.bashrc"
  echo "export LD_LIBRARY_PATH=/usr/local/cuda-$CUDA_VER/lib64:\$LD_LIBRARY_PATH" >> "$HOME/.bashrc"
}
export PATH="/usr/local/cuda-$CUDA_VER/bin:$PATH"
export LD_LIBRARY_PATH="/usr/local/cuda-$CUDA_VER/lib64:${LD_LIBRARY_PATH:-}"

log "5/12 TensorRT $TRT_VER (C++ SDK from NVIDIA's apt repository)"
if ! dpkg -s libnvinfer-dev 2>/dev/null | grep -q "Version: $TRT_VER"; then
  if ! apt-cache madison libnvinfer-dev | grep -q "$TRT_VER"; then
    echo "TensorRT $TRT_VER is not in the apt repository for this Ubuntu. Available:" >&2
    apt-cache madison libnvinfer-dev | head -5 >&2
    echo "Install the matching local repo .deb from NVIDIA's TensorRT download page, then rerun." >&2
    exit 1
  fi
  sudo apt-get install -y --allow-downgrades \
    "libnvinfer11=$TRT_VER" "libnvinfer-dev=$TRT_VER" "libnvinfer-headers-dev=$TRT_VER" \
    "libnvinfer-safe-headers-dev=$TRT_VER" "libnvinfer-headers-python-plugin-dev=$TRT_VER" \
    "libnvinfer-plugin11=$TRT_VER" "libnvinfer-plugin-dev=$TRT_VER" "libnvinfer-headers-plugin-dev=$TRT_VER" \
    "libnvinfer-lean11=$TRT_VER" "libnvinfer-lean-dev=$TRT_VER" \
    "libnvinfer-dispatch11=$TRT_VER" "libnvinfer-dispatch-dev=$TRT_VER" \
    "libnvinfer-vc-plugin11=$TRT_VER" "libnvinfer-vc-plugin-dev=$TRT_VER" \
    "libnvonnxparsers11=$TRT_VER" "libnvonnxparsers-dev=$TRT_VER"
  sudo apt-mark hold libnvinfer11 libnvinfer-dev libnvinfer-headers-dev
fi
dpkg -s libnvinfer-dev | grep Version

log "6/12 KVS WebRTC C SDK $SDK_TAG at $SDK_DIR"
if [ ! -f "$SDK_DIR/build/libkvsWebrtcClient.so" ]; then
  [ -d "$SDK_DIR" ] || git clone --depth 1 --branch "$SDK_TAG" \
    https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-c.git "$SDK_DIR"
  mkdir -p "$SDK_DIR/build"
  ( cd "$SDK_DIR/build" && export CMAKE_POLICY_VERSION_MINIMUM=3.5 && cmake .. -DBUILD_SAMPLE=OFF && make -j"$(nproc)" )
fi
ls "$SDK_DIR/build/libkvsWebrtcClient.so" "$SDK_DIR/open-source/lib"/libwebsockets.so* | head -2

log "7/12 sample clip, ONNX exports, PyTorch weights, ONNX Runtime"
( cd "$ROOT" && FETCH_PT=1 ./scripts/fetch-demo-assets.sh )

log "8/12 Python environment for exporting engines on this GPU"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/pip" install --upgrade pip >/dev/null
# The pip tensorrt version must equal the C++ libnvinfer version, or the
# engines will not load; ultralytics does the export.
"$VENV/bin/pip" install "tensorrt==$TRT_PIP.*" "ultralytics==8.4.121"
"$VENV/bin/python" -c "import tensorrt, ultralytics; print('tensorrt', tensorrt.__version__, 'ultralytics', ultralytics.__version__)"

log "9/12 TensorRT engines (built on this GPU; takes a few minutes per model)"
if [ ! -f "$ROOT/python/yolo26n-pose.engine" ]; then
  ( cd "$ROOT/python" && "$VENV/bin/python" export_engines.py )
fi
ls -la "$ROOT/python/runs/detect/train/weights/best.engine" "$ROOT/python/runs/pose/train-MuSGD-1/weights/best.engine" "$ROOT/python/yolo26n-pose.engine"

log "10/12 C++ binaries"
( cd "$ROOT" && export CMAKE_POLICY_VERSION_MINIMUM=3.5 && cmake -S cpp -B cpp/build \
    && cmake --build cpp/build --target follow_through_webrtc follow_through_batch_gpu -j"$(nproc)" )

log "11/12 relay, web app (node-server build) and API jar"
( cd "$ROOT/js" && npm ci --omit=dev )
( cd "$ROOT/follow-through-pro-19" && rm -f .env.local && npm ci && npm run build:node )
( cd "$ROOT/springboot" && ./mvnw -q -DskipTests package )
ls "$ROOT/springboot/target"/followthrough-api-*.jar

log "12/12 Caddy, cloudflared, systemd units"
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -y && sudo apt-get install -y caddy
fi
if [ ! -x /usr/local/bin/cloudflared ]; then
  curl -fsSLo /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i /tmp/cloudflared.deb
fi
sudo install -m 644 "$ROOT/deploy/Caddyfile" /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo mkdir -p /etc/followthrough
if [ ! -f /etc/followthrough/api.env ]; then
  printf 'FOLLOWTHROUGH_JWT_SECRET=%s\nFT_PUBLIC_ORIGIN=http://localhost\n' "$(openssl rand -base64 48)" | sudo tee /etc/followthrough/api.env >/dev/null
  sudo chmod 600 /etc/followthrough/api.env
fi
sudo install -m 644 "$ROOT"/deploy/systemd/ft-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ft-relay ft-backend ft-api ft-web ft-tunnel
sleep 8
sudo systemctl --no-pager --lines=0 status ft-relay ft-backend ft-api ft-web ft-tunnel caddy | grep -E "●|Active:"

log "done"
echo "Next: sudo $ROOT/deploy/set-public-origin.sh   # reads the tunnel URL, hands it to the API"
echo "Then open that URL on the phone, sign in as the demo account and start a live session."
