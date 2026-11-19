# The configuration-sweep worker: the offline batch binary (Release build)
# and research/sweep/worker.py, nothing else. Built by build_image.sh, which
# stages a context laid out as cpp/, training/ and sweep/:
#
#   bash research/sweep/build_image.sh
#
# CUDA 13.3 and TensorRT 11.2.1, the versions the app image and the measured
# binaries use (deploy/docker/Dockerfile); trtexec builds the engines on the
# GPU that runs them. Needs the NVIDIA container toolkit at run time.
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG TRT_VER=11.2.1.2-1+cuda13.3
ENV PATH=/usr/local/cuda-13.3/bin:/usr/src/tensorrt/bin:$PATH
ENV LD_LIBRARY_PATH=/usr/local/cuda-13.3/lib64

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg build-essential cmake pkg-config \
      libopencv-dev nlohmann-json3-dev python3 python3-boto3 \
    && rm -rf /var/lib/apt/lists/*

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

# The leases use S3 conditional writes (IfNoneMatch / IfMatch), which need
# boto3 1.36 or later; Ubuntu's python3-boto3 is older.
RUN apt-get update && apt-get install -y --no-install-recommends python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir --break-system-packages "boto3>=1.36"

# Only the batch target; Release, since latency is what is measured.
COPY cpp /src/cpp
RUN cmake -S /src/cpp -B /src/cpp/build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /src/cpp/build --target follow_through_batch_gpu -j"$(nproc)" \
    && mkdir -p /opt/sweep && cp /src/cpp/build/follow_through_batch_gpu /opt/sweep/ \
    && rm -rf /src/cpp/build

# The decode benchmark (research/sweep/decode): the backend's own H264Decoder, so the
# decode constant is measured on the GPU and CPU that run the sweep.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libavcodec-dev libavformat-dev libavutil-dev \
    && rm -rf /var/lib/apt/lists/*
COPY sweep/decode /src/decode
RUN bash /src/decode/build.sh /src/cpp/follow-through-webrtc.cpp /opt/sweep/decode_bench

COPY training/worker.py training/matrix.py /opt/training/
COPY sweep/grid.py sweep/worker.py /opt/sweep/

ENV WORK=/work TRT_VERSION=11.2.1 BINARY=/opt/sweep/follow_through_batch_gpu
ENV NVIDIA_VISIBLE_DEVICES=all NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
WORKDIR /opt/sweep
CMD ["python3", "-u", "worker.py"]
