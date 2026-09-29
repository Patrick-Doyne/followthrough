cmake_minimum_required(VERSION 3.10)

project(FollowThroughCpp)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ============================================================
# follow_through_batch_gpu -- offline/upload detection pass.
# Reads a video file, writes telemetry JSONL, exits. Consumed by
# the Spring Boot pipeline (CppVideoProcessor) while it runs; see
# cpp/README.md for the streaming contract.
#
# GPU-only: links nvinfer/cudart and loads TensorRT .engine files.
# A CPU sibling (follow_through_batch_cpu, ONNX Runtime + the .onnx
# exports) is the intended path for Fargate, where no GPU exists.
# ============================================================

find_package(OpenCV REQUIRED)
find_package(Threads REQUIRED)

set(CUDA_TOOLKIT_ROOT "/usr/local/cuda-13.3")

add_executable(follow_through_batch_gpu follow-through-batch.cpp)
target_compile_definitions(follow_through_batch_gpu PRIVATE CV_BACKEND_TENSORRT)

target_include_directories(
    follow_through_batch_gpu
    PRIVATE
    ${OpenCV_INCLUDE_DIRS}
    /usr/include/x86_64-linux-gnu
    ${CUDA_TOOLKIT_ROOT}/include
    ${NLOHMANN_JSON_INCLUDE_DIR}
)

target_link_directories(
    follow_through_batch_gpu
    PRIVATE
    ${CUDA_TOOLKIT_ROOT}/lib64
)

target_link_libraries(
    follow_through_batch_gpu
    PRIVATE
    ${OpenCV_LIBS}
    Threads::Threads
    nvinfer
    cudart
)

# ============================================================
# follow_through_batch_cpu -- same source, CPU inference.
# Runs the .onnx exports instead of TensorRT engines. Deliberately links
# NO CUDA: this is the Fargate/spot target, where a binary referencing
# libcudart would not start at all (verified with ldd).
#
# Inference runs on ONNX Runtime (vendored under third_party/onnxruntime),
# not cv::dnn: the installed OpenCV 4.10 has no TopK operator, which all
# three exports contain. See the note above the include in the source.
# ============================================================
set(ONNXRUNTIME_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/third_party/onnxruntime)

# The ORT download is not committed (see README.md "Build"); without it the
# GPU targets still configure and build, and only this one is skipped.
if(EXISTS "${ONNXRUNTIME_ROOT}/include/onnxruntime_cxx_api.h")

add_executable(follow_through_batch_cpu follow-through-batch.cpp)

target_include_directories(
    follow_through_batch_cpu
    PRIVATE
    ${ONNXRUNTIME_ROOT}/include
    ${OpenCV_INCLUDE_DIRS}
    /usr/include/x86_64-linux-gnu
    ${NLOHMANN_JSON_INCLUDE_DIR}
)

target_link_directories(
    follow_through_batch_cpu
    PRIVATE
    ${ONNXRUNTIME_ROOT}/lib
)

# rpath so the binary finds the vendored .so without LD_LIBRARY_PATH --
# it ships alongside the binary in the container image.
set_target_properties(
    follow_through_batch_cpu
    PROPERTIES
    BUILD_RPATH ${ONNXRUNTIME_ROOT}/lib
    INSTALL_RPATH ${ONNXRUNTIME_ROOT}/lib
)

target_link_libraries(
    follow_through_batch_cpu
    PRIVATE
    onnxruntime
    ${OpenCV_LIBS}
    Threads::Threads
)

else()
    message(STATUS "ONNX Runtime not found under ${ONNXRUNTIME_ROOT}; skipping follow_through_batch_cpu (see README.md)")
endif()

# ============================================================
# follow_through_webrtc -- the live-session backend. Receives the
# browser's camera over WebRTC, runs the same detection pipeline
# per frame, and sends telemetry back on a DataChannel. Two
# dependencies beyond the GPU target's, both produced by the KVS
# WebRTC C SDK build described in README.md (section 7), not
# fetched separately:
#   - the KVS WebRTC C SDK itself (PeerConnection/DataChannel)
#   - libwebsockets, which the SDK builds as its own sub-dependency
#     -- reused here for the signaling-relay connection so no third
#     WebSocket library is needed.
# Plus libavcodec/libavutil (system FFmpeg) for H.264 decoding of
# the incoming track.
# KVS_SDK_DIR is where README.md's SDK build puts it
# ($HOME/kvs-webrtc-sdk) -- update this if the SDK was built
# somewhere else.
# ============================================================

set(KVS_SDK_DIR "$ENV{HOME}/kvs-webrtc-sdk")

add_executable(follow_through_webrtc follow-through-webrtc.cpp)

target_include_directories(
    follow_through_webrtc
    PRIVATE
    ${OpenCV_INCLUDE_DIRS}
    /usr/include/x86_64-linux-gnu
    ${CUDA_TOOLKIT_ROOT}/include
    ${NLOHMANN_JSON_INCLUDE_DIR}
    ${KVS_SDK_DIR}/src/include
    ${KVS_SDK_DIR}/open-source/include
)

target_link_directories(
    follow_through_webrtc
    PRIVATE
    ${CUDA_TOOLKIT_ROOT}/lib64
    ${KVS_SDK_DIR}/build
    ${KVS_SDK_DIR}/open-source/lib
)

target_link_libraries(
    follow_through_webrtc
    PRIVATE
    ${OpenCV_LIBS}
    Threads::Threads
    nvinfer
    cudart
    kvsWebrtcClient
    websockets
    avcodec
    avutil
)

set_target_properties(
    follow_through_webrtc
    PROPERTIES
    BUILD_RPATH "${KVS_SDK_DIR}/build;${KVS_SDK_DIR}/open-source/lib"
)