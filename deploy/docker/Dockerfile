# The whole FollowThrough stack in one image, for one GPU instance: the C++
# live backend, the signaling relay, the web app (node-server build), the
# REST API, Caddy in front of the three and a Cloudflare quick tunnel for a
# public https address. Built from the repository root:
#
#   docker build -f deploy/docker/Dockerfile -t followthrough .
#
# Needs the NVIDIA container toolkit at run time (deploy/docker/compose.yaml
# asks for every GPU with the compute and video capabilities; the backend
# decodes H.264 on NVDEC). The TensorRT engines are not in the image: they
# are specific to the GPU they are built on, so the entrypoint builds them
# on first start from the ONNX exports and keeps them in a volume.
#
# Versions are pinned to what the binaries were built and measured with on
# the development machine (cpp/README.md): CUDA 13.3, TensorRT 11.2.1.
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG TRT_VER=11.2.1.2-1+cuda13.3
ARG KVS_SDK_TAG=v1.20.0
ENV HOME=/root
ENV PATH=/usr/local/cuda-13.3/bin:$PATH
ENV LD_LIBRARY_PATH=/usr/local/cuda-13.3/lib64

# --- toolchain, libraries, runtimes -----------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git build-essential cmake m4 pkg-config unzip ffmpeg \
      libopencv-dev nlohmann-json3-dev \
      libavcodec-dev libavutil-dev libavformat-dev libswscale-dev \
      libssl-dev libcurl4-openssl-dev liblog4cplus-dev \
      openjdk-17-jdk-headless python3 supervisor \
    && rm -rf /var/lib/apt/lists/*

# Node 22 (web app build and server, relay, the playback-preparation script)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# CUDA 13.3 (compiler and runtime libraries only) and TensorRT 11.2.1 from
# NVIDIA's repository; libnvinfer-bin brings trtexec, which builds the
# engines at first start.
RUN curl -fsSLo /tmp/cuda-keyring.deb \
      https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb \
    && dpkg -i /tmp/cuda-keyring.deb && rm /tmp/cuda-keyring.deb \
    && apt-get update && apt-get install -y --no-install-recommends \
      cuda-minimal-build-13-3 cuda-libraries-dev-13-3 \
      libnvinfer11=$TRT_VER libnvinfer-dev=$TRT_VER libnvinfer-headers-dev=$TRT_VER \
      libnvinfer-safe-headers-dev=$TRT_VER libnvinfer-headers-python-plugin-dev=$TRT_VER \
      libnvinfer-plugin11=$TRT_VER libnvinfer-plugin-dev=$TRT_VER libnvinfer-headers-plugin-dev=$TRT_VER \
      libnvinfer-lean11=$TRT_VER libnvinfer-lean-dev=$TRT_VER \
      libnvinfer-dispatch11=$TRT_VER libnvinfer-dispatch-dev=$TRT_VER \
      libnvinfer-vc-plugin11=$TRT_VER libnvinfer-vc-plugin-dev=$TRT_VER \
      libnvonnxparsers11=$TRT_VER libnvonnxparsers-dev=$TRT_VER \
      libnvinfer-bin=$TRT_VER \
    && rm -rf /var/lib/apt/lists/*

# Caddy (reverse proxy) and cloudflared (public https without a domain)
RUN curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /usr/local/bin/caddy \
    && chmod +x /usr/local/bin/caddy \
    && curl -fsSLo /tmp/cloudflared.deb \
      https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
    && dpkg -i /tmp/cloudflared.deb && rm /tmp/cloudflared.deb

# --- KVS WebRTC C SDK (the live backend's transport) ------------------------
# At $HOME/kvs-webrtc-sdk, where cpp/CMakeLists.txt looks for it. Its OpenSSL
# sub-build cannot cope with spaces in the path, hence the plain location.
WORKDIR /root
RUN git clone --depth 1 --branch $KVS_SDK_TAG \
      https://github.com/awslabs/amazon-kinesis-video-streams-webrtc-sdk-c.git kvs-webrtc-sdk \
    && mkdir kvs-webrtc-sdk/build && cd kvs-webrtc-sdk/build \
    && CMAKE_POLICY_VERSION_MINIMUM=3.5 cmake .. -DBUILD_SAMPLE=OFF \
    && make -j"$(nproc)"

# --- the application ---------------------------------------------------------
WORKDIR /app
COPY . /app

# Sample clip and the ONNX exports (the engines are built from them at first
# start) from the GitHub release. ONNX Runtime is the CPU detector's and is
# not needed here.
RUN FOLLOWTHROUGH_REPO=Patrick-Doyne/followthrough FETCH_ORT=0 ./scripts/fetch-demo-assets.sh

# Live backend
RUN CMAKE_POLICY_VERSION_MINIMUM=3.5 cmake -S cpp -B cpp/build \
    && cmake --build cpp/build --target follow_through_webrtc follow_through_batch_gpu -j"$(nproc)"

# Relay, web app (node-server build) and API jar
RUN cd js && npm ci --omit=dev
RUN cd follow-through-pro-19 && rm -f .env.local && npm ci && npm run build:node
RUN cd springboot && ./mvnw -q -DskipTests package

# --- runtime wiring -------------------------------------------------------------
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/docker/supervisord.conf /etc/supervisor/conf.d/followthrough.conf
COPY deploy/docker/entrypoint.sh deploy/docker/build-engines.sh deploy/docker/start-api.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/build-engines.sh /usr/local/bin/start-api.sh \
    && mkdir -p /var/log/followthrough /var/lib/followthrough/engines

ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
