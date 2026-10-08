#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>

// ============================================================
// INFERENCE BACKEND
//
// This file builds twice, into two binaries:
//
//   follow_through_batch_gpu  -DCV_BACKEND_TENSORRT  links nvinfer + cudart
//   follow_through_batch_cpu  (default)              links ONNX Runtime
//
// The CPU binary must not link CUDA at all -- it is meant for Fargate,
// where no GPU and no CUDA runtime exist, so a binary that merely
// references libcudart would fail to start.
//
// Everything below the engine class is backend-agnostic: detection state
// machine, shot logic and telemetry emission are shared verbatim.
// Only model loading and the forward pass differ, which is why this is a
// compile-time switch in one file rather than two near-identical files.
// ============================================================
#ifdef CV_BACKEND_TENSORRT
#include "NvInfer.h"
#include <cuda_runtime.h>
#define MODEL_EXT ".engine"
#else
// ONNX Runtime rather than cv::dnn: the installed OpenCV (4.10) has no TopK
// operator, which every one of these exports contains because Ultralytics
// bakes NMS into the graph. A custom TopK layer was tried and got close, but
// the surrounding integer Div/Mod on the returned indices does not behave to
// spec in 4.10, so detections came out mis-associated (right boxes, wrong
// classes). ORT implements the full spec, so the exported graph runs exactly
// as authored -- no custom layers, no semantic gaps.
#include <onnxruntime_cxx_api.h>
#define MODEL_EXT ".onnx"
#endif

#include <iostream>
#include <fstream>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <atomic>
#include <chrono>
#include <vector>
#include <string>
#include <optional>
#include <cstring>
#include <algorithm>
#include <array>
#include <memory>
#include <cmath>
#include <limits>
#include <map>

// NEW DEPENDENCY -- not previously part of this project. Single-
// header, MIT-licensed (https://github.com/nlohmann/json). Needed
// to build the per-frame JSON payload reliably: hand-rolling JSON
// string construction for a schema this nested (arrays, optional/
// null fields) is genuinely bug-prone (missed commas, incorrect
// null handling) compared to a well-tested library. Vendor
// json.hpp into your include path (or `apt install
// nlohmann-json3-dev` on Ubuntu) before this will compile.
#include <nlohmann/json.hpp>
using json = nlohmann::json;


#ifdef CV_BACKEND_TENSORRT

// A CUDA stream on the GPU build; an inert placeholder on the CPU build, so
// the call sites below stay identical across both.
using StreamHandle = cudaStream_t;

#define CUDA_CHECK(call)                                              \
    do {                                                              \
        cudaError_t err = (call);                                     \
        if (err != cudaSuccess) {                                     \
            std::cerr                                                 \
                << "CUDA error at " << __FILE__ << ":" << __LINE__     \
                << " -- " << cudaGetErrorString(err)                   \
                << std::endl;                                          \
            std::exit(1);                                             \
        }                                                             \
    } while (0)

#else

using StreamHandle = int;  // no device stream exists; kept for signature parity

#endif


// ============================================================
// BOUNDED BLOCKING QUEUE (proven working)
// ============================================================

template <typename T>
class BoundedBlockingQueue {

public:

    explicit BoundedBlockingQueue(size_t max_size)
        : max_size_(max_size) {}

    void put(T item) {

        std::unique_lock<std::mutex> lock(mutex_);

        not_full_.wait(lock, [this] { return queue_.size() < max_size_; });

        queue_.push(std::move(item));

        lock.unlock();

        not_empty_.notify_one();
    }

    T get() {

        std::unique_lock<std::mutex> lock(mutex_);

        not_empty_.wait(lock, [this] { return !queue_.empty(); });

        T item = std::move(queue_.front());

        queue_.pop();

        lock.unlock();

        not_full_.notify_one();

        return item;
    }

private:

    std::queue<T> queue_;
    size_t max_size_;
    std::mutex mutex_;
    std::condition_variable not_full_;
    std::condition_variable not_empty_;
};


// ============================================================
// FRAME READER (proven working)
// ============================================================

class FrameReader {

public:

    FrameReader(cv::VideoCapture& capture, size_t queue_size)
        : capture_(capture),
          frame_queue_(queue_size),
          stopped_(false) {}

    FrameReader& start() {

        thread_ = std::thread(&FrameReader::read_loop, this);

        return *this;
    }

    std::pair<bool, cv::Mat> read() {

        return frame_queue_.get();
    }

    void stop() {

        stopped_ = true;
    }

    void join() {

        if (thread_.joinable()) {

            thread_.join();
        }
    }

private:

    void read_loop() {

        while (!stopped_) {

            cv::Mat frame;

            bool success = capture_.read(frame);

            if (!success) {

                frame_queue_.put({false, cv::Mat()});

                break;
            }

            frame_queue_.put({true, frame});
        }
    }

    cv::VideoCapture& capture_;
    BoundedBlockingQueue<std::pair<bool, cv::Mat>> frame_queue_;
    std::atomic<bool> stopped_;
    std::thread thread_;
};


// ============================================================
// TENSORRT LOGGER
// ============================================================

#ifdef CV_BACKEND_TENSORRT

class Logger : public nvinfer1::ILogger {

public:

    void log(Severity severity, const char* msg) noexcept override {

        if (severity <= Severity::kWARNING) {

            std::cout << "[TensorRT] " << msg << std::endl;
        }
    }
};

static Logger g_logger;


// ============================================================
// READ + STRIP ULTRALYTICS METADATA HEADER
// ============================================================

std::vector<char> read_engine_file(const std::string& path) {

    std::ifstream file(path, std::ios::binary | std::ios::ate);

    if (!file.good()) {

        throw std::runtime_error("Failed to open engine file: " + path);
    }

    size_t total_size = file.tellg();

    file.seekg(0, std::ios::beg);

    uint32_t metadata_length = 0;

    file.read(reinterpret_cast<char*>(&metadata_length), sizeof(metadata_length));

    if (!file.good() || metadata_length >= total_size) {

        throw std::runtime_error("Metadata length header looks invalid for: " + path);
    }

    file.seekg(metadata_length, std::ios::cur);

    size_t engine_size = total_size - sizeof(metadata_length) - metadata_length;

    std::vector<char> buffer(engine_size);

    file.read(buffer.data(), engine_size);

    return buffer;
}


// ============================================================
// TENSORRT ENGINE WRAPPER
// ============================================================

class TensorRTEngine {

public:

    // The size hint is ignored here on purpose: a TensorRT engine knows its
    // own input dimensions, so this build keeps deriving the real value and
    // cannot silently drift from what the engine actually expects. Only the
    // CPU backend uses it.
    TensorRTEngine(const std::string& engine_path, StreamHandle stream, int /*input_size_hint*/)
        : stream_(stream) {

        std::cout << "Loading engine: " << engine_path << std::endl;

        std::vector<char> engine_data = read_engine_file(engine_path);

        runtime_ = nvinfer1::createInferRuntime(g_logger);

        engine_ = runtime_->deserializeCudaEngine(
            engine_data.data(),
            engine_data.size()
        );

        if (!engine_) {

            throw std::runtime_error("Failed to deserialize engine: " + engine_path);
        }

        context_ = engine_->createExecutionContext();

        int32_t num_tensors = engine_->getNbIOTensors();

        for (int32_t i = 0; i < num_tensors; i++) {

            const char* name = engine_->getIOTensorName(i);

            nvinfer1::Dims shape = engine_->getTensorShape(name);

            nvinfer1::TensorIOMode mode = engine_->getTensorIOMode(name);

            size_t elements = 1;

            for (int32_t d = 0; d < shape.nbDims; d++) {

                elements *= shape.d[d];
            }

            void* device_ptr = nullptr;

            CUDA_CHECK(cudaMalloc(&device_ptr, elements * sizeof(float)));

            context_->setTensorAddress(name, device_ptr);

            if (mode == nvinfer1::TensorIOMode::kINPUT) {

                input_device_ptr_ = device_ptr;
                input_element_count_ = elements;
                input_shape_ = shape;

            } else {

                output_device_ptr_ = device_ptr;
                output_element_count_ = elements;
            }
        }

        input_host_.resize(input_element_count_);
        output_host_.resize(output_element_count_);

        std::cout
            << "  input size: " << input_size() << "x" << input_size()
            << "  output rows: " << detection_row_count()
            << "  row width: " << row_width()
            << std::endl;
    }

    int input_size() const {

        return input_shape_.d[input_shape_.nbDims - 1];
    }

    size_t detection_row_count() const {

        return 300;
    }

    size_t row_width() const {

        return output_element_count_ / detection_row_count();
    }

    std::vector<float>& input_buffer() {

        return input_host_;
    }

    const std::vector<float>& run() {

        CUDA_CHECK(cudaMemcpyAsync(
            input_device_ptr_,
            input_host_.data(),
            input_host_.size() * sizeof(float),
            cudaMemcpyHostToDevice,
            stream_
        ));

        context_->enqueueV3(stream_);

        CUDA_CHECK(cudaMemcpyAsync(
            output_host_.data(),
            output_device_ptr_,
            output_host_.size() * sizeof(float),
            cudaMemcpyDeviceToHost,
            stream_
        ));

        CUDA_CHECK(cudaStreamSynchronize(stream_));

        return output_host_;
    }

    ~TensorRTEngine() {

        cudaFree(input_device_ptr_);
        cudaFree(output_device_ptr_);

        delete context_;
        delete engine_;
        delete runtime_;
    }

private:

    nvinfer1::IRuntime* runtime_ = nullptr;
    nvinfer1::ICudaEngine* engine_ = nullptr;
    nvinfer1::IExecutionContext* context_ = nullptr;
    cudaStream_t stream_;

    void* input_device_ptr_ = nullptr;
    void* output_device_ptr_ = nullptr;
    size_t input_element_count_ = 0;
    size_t output_element_count_ = 0;
    nvinfer1::Dims input_shape_{};

    std::vector<float> input_host_;
    std::vector<float> output_host_;
};

using InferenceEngine = TensorRTEngine;

inline StreamHandle make_stream() {
    cudaStream_t s;
    CUDA_CHECK(cudaStreamCreate(&s));
    return s;
}

inline void destroy_stream(StreamHandle s) { CUDA_CHECK(cudaStreamDestroy(s)); }

#else  // ---- CPU backend: ONNX Runtime over the ONNX exports ----

// Mirrors TensorRTEngine's interface exactly so every call site below is
// backend-agnostic. The ONNX files are the same models the .engine files
// were built from, so detections are equivalent, just slower: measured on
// this host, detect ~37ms/frame and pose ~151ms/frame against ~18s total
// for the whole GPU pass.

class OnnxEngine {

public:

    // input_size_hint is required here because, unlike a TensorRT engine,
    // the session's declared input dimensions are not consulted before the
    // caller has already letterboxed a frame to size. The TensorRT build
    // ignores the hint and keeps deriving the real value from the engine,
    // so the two cannot silently disagree.
    OnnxEngine(const std::string& model_path, StreamHandle, int input_size_hint)
        : input_size_(input_size_hint),
          memory_info_(Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault)) {

        std::cout << "Loading ONNX model: " << model_path << std::endl;

        Ort::SessionOptions options;

        // Detection already runs inside a process that is compositing in
        // parallel, so let ORT use a modest thread count rather than
        // grabbing every core and fighting ffmpeg for them.
        options.SetIntraOpNumThreads(4);
        options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

        session_ = std::make_unique<Ort::Session>(env_, model_path.c_str(), options);

        Ort::AllocatorWithDefaultOptions allocator;
        input_name_ = session_->GetInputNameAllocated(0, allocator).get();
        output_name_ = session_->GetOutputNameAllocated(0, allocator).get();

        input_host_.resize(static_cast<size_t>(3) * input_size_ * input_size_);

        // One warm-up pass: it primes ORT's arena so the first real frame is
        // not an outlier, and tells us the true output width, which the
        // row-parsing code below needs up front.
        const std::vector<float>& probe = run();
        row_width_ = probe.size() / detection_row_count();

        std::cout
            << "  input size: " << input_size() << "x" << input_size()
            << "  output rows: " << detection_row_count()
            << "  row width: " << row_width()
            << std::endl;
    }

    int input_size() const { return input_size_; }

    size_t detection_row_count() const { return 300; }

    size_t row_width() const { return row_width_; }

    std::vector<float>& input_buffer() { return input_host_; }

    const std::vector<float>& run() {

        const std::array<int64_t, 4> shape{
            1, 3, input_size_, input_size_
        };

        Ort::Value input = Ort::Value::CreateTensor<float>(
            memory_info_,
            input_host_.data(),
            input_host_.size(),
            shape.data(),
            shape.size()
        );

        const char* input_names[] = {input_name_.c_str()};
        const char* output_names[] = {output_name_.c_str()};

        auto outputs = session_->Run(
            Ort::RunOptions{nullptr},
            input_names,
            &input,
            1,
            output_names,
            1
        );

        const float* data = outputs[0].GetTensorData<float>();
        size_t count = outputs[0].GetTensorTypeAndShapeInfo().GetElementCount();

        output_host_.assign(data, data + count);

        return output_host_;
    }

private:

    Ort::Env env_{ORT_LOGGING_LEVEL_WARNING, "follow-through"};
    std::unique_ptr<Ort::Session> session_;
    Ort::MemoryInfo memory_info_;

    std::string input_name_;
    std::string output_name_;

    int input_size_ = 0;
    size_t row_width_ = 0;

    std::vector<float> input_host_;
    std::vector<float> output_host_;
};

using InferenceEngine = OnnxEngine;

inline StreamHandle make_stream() { return 0; }

inline void destroy_stream(StreamHandle) {}

#endif  // CV_BACKEND_TENSORRT


// ============================================================
// LETTERBOX PREPROCESSING
// ============================================================

struct LetterboxResult {
    cv::Mat image;
    float scale;
    int pad_x;
    int pad_y;
};

LetterboxResult letterbox(const cv::Mat& frame, int target_size) {

    int original_width = frame.cols;
    int original_height = frame.rows;

    float scale = std::min(
        static_cast<float>(target_size) / original_width,
        static_cast<float>(target_size) / original_height
    );

    int scaled_width = static_cast<int>(original_width * scale);
    int scaled_height = static_cast<int>(original_height * scale);

    cv::Mat resized;

    cv::resize(frame, resized, cv::Size(scaled_width, scaled_height));

    int pad_x = (target_size - scaled_width) / 2;
    int pad_y = (target_size - scaled_height) / 2;

    cv::Mat padded(
        target_size,
        target_size,
        frame.type(),
        cv::Scalar(114, 114, 114)
    );

    resized.copyTo(padded(cv::Rect(pad_x, pad_y, scaled_width, scaled_height)));

    return {padded, scale, pad_x, pad_y};
}

cv::Point2f unletterbox_point(float x, float y, const LetterboxResult& lb) {

    return cv::Point2f(
        (x - lb.pad_x) / lb.scale,
        (y - lb.pad_y) / lb.scale
    );
}

cv::Rect2f unletterbox_box(
    float x1, float y1, float x2, float y2,
    const LetterboxResult& lb
) {

    cv::Point2f p1 = unletterbox_point(x1, y1, lb);
    cv::Point2f p2 = unletterbox_point(x2, y2, lb);

    return cv::Rect2f(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
}

void fill_chw_buffer(const cv::Mat& letterboxed_bgr, std::vector<float>& out, int size) {

    cv::Mat blob = cv::dnn::blobFromImage(
        letterboxed_bgr,
        1.0 / 255.0,
        cv::Size(size, size),
        cv::Scalar(0, 0, 0),
        true,
        false
    );

    std::memcpy(out.data(), blob.ptr<float>(), out.size() * sizeof(float));
}


// ============================================================
// DETECTION THRESHOLDS / COURT GEOMETRY
// ============================================================

const float COURT_KEYPOINT_CONF = 0.50f;

const float DETECTION_CONF = 0.8f;
const float CONTINUATION_CONF = 0.5f;

// Real-world court coordinates (feet, rim-centered origin) -- used
// server-side to build the homography. The client never needs this:
// it only ever receives already-transformed outputs (player_distance_ft,
// player_speed_mph) and raw pixel keypoint positions for drawing, not
// real-world coordinates to transform itself.
const std::vector<cv::Point2f> COURT_POINTS = {
    {-6.0f, -13.9f},
    { 0.0f, -13.9f},
    { 6.0f, -13.9f},
    { 0.0f, -19.9f},
    {-6.0f,   5.1f},
    { 6.0f,   5.1f},
    { 0.0f,   5.1f},
};

const float CLOSE_RANGE_FT = 6.0f;
const float CLOSE_RANGE_UPWARD_SCALE = 0.5f;
const float CLOSE_RANGE_SEPARATION_SCALE = 0.5f;
const float POSE_CONF = 0.10f;

// ============================================================
// SHOT CATEGORIES
// ============================================================

const std::vector<std::string> CATEGORY_ORDER = {
    "LAY_UP", "CLS_RNG", "MID_RNG", "HS_3PT", "NCAA_3PT", "NBA_3PT"
};

// The client owns the human-readable labels for these categories;
// the pipeline only ever sends the raw key (e.g. "MID_RNG").

std::optional<std::string> get_shot_designation(const std::optional<float>& shot_distance) {

    if (!shot_distance.has_value()) {

        return std::nullopt;
    }

    float d = *shot_distance;

    if (d >= 19.9f && d <= 21.9f) return std::string("HS_3PT");
    if (d >= 22.0f && d <= 22.9f) return std::string("NCAA_3PT");
    if (d >= 23.0f) return std::string("NBA_3PT");
    if (d >= 10.0f) return std::string("MID_RNG");
    if (d >= 5.0f) return std::string("CLS_RNG");

    return std::string("LAY_UP");
}


// ============================================================
// DETECTION STRUCT + SELECTION
// ============================================================

struct Detection {

    cv::Rect2f box;
    cv::Point2f center;
    float confidence = 0.0f;
    bool predicted = false;
};

std::optional<Detection> select_best_by_conf(const std::vector<Detection>& candidates) {

    if (candidates.empty()) {

        return std::nullopt;
    }

    return *std::max_element(
        candidates.begin(), candidates.end(),
        [](const Detection& a, const Detection& b) {
            return a.confidence < b.confidence;
        }
    );
}

std::optional<Detection> select_player_detection(
    const std::vector<Detection>& candidates,
    const std::optional<cv::Rect2f>& previous_box
) {

    if (candidates.empty()) {

        return std::nullopt;
    }

    if (!previous_box.has_value()) {

        return select_best_by_conf(candidates);
    }

    cv::Point2f prev_center(
        previous_box->x + previous_box->width / 2,
        previous_box->y + previous_box->height / 2
    );

    return *std::min_element(
        candidates.begin(), candidates.end(),
        [&](const Detection& a, const Detection& b) {
            return cv::norm(a.center - prev_center) < cv::norm(b.center - prev_center);
        }
    );
}


// ============================================================
// MAIN -- the offline/upload pipeline. Same detection/state-machine
// code and same JSON telemetry schema as follow-through-webrtc.cpp
// (keep the two in step), with three differences: (1) the input
// video path and output telemetry path are CLI arguments, since this
// runs once per uploaded file; (2) a {"type":"metadata",...} line is
// written first, carrying fps (needed to convert a message's
// frame_id into a video-time offset) plus frame_width/frame_height;
// (3) the stream is flushed every TELEMETRY_FLUSH_FRAMES frames and
// terminated with {"type":"eos"}, because prepare-playback.ts reads
// the file while it is still being written. No live feed -- this
// reads one whole file, as fast as the machine allows, and exits.
// ============================================================

const size_t FRAME_QUEUE_SIZE = 2;

const float UPPER_BODY_RATIO = 0.0125f;
const float EARLY_POSE_TRIGGER_RATIO = 0.20f;
const float MAX_BALL_WRIST_RATIO = 0.20f;
const float MIN_RELEASE_SEPARATION = 20.0f;
const float MIN_BALL_UPWARD_MOVEMENT = 8.0f;
const int RELEASE_FRAMES = 4;
const int MAX_RELEASE_WINDOW = 12;
const int SHOT_COOLDOWN_FRAMES = 12;
const float MAX_RELEASE_WINDOW_SEC = 0.6f;
const float REVERSAL_TOLERANCE = 5.0f;
const float MIN_RELEASE_ACCEL = 8.0f;

const int MAX_BALL_COAST_FRAMES = 6;

const int COURT_CALIBRATION_INTERVAL = 10;

const int APEX_CONFIRMATION_FRAMES = 3;
const int NET_RESET_FRAMES = 3;
const float RIM_FALLBACK_MARGIN = 40.0f;
const int RIM_FALLBACK_FRAMES = 8;
const int MAKE_SETTLE_FRAMES = 6;
const float MAX_SHOT_DURATION_SEC = 4.0f;

const int POSE_CROP_WIDTH = 384;
const int POSE_CROP_HEIGHT = 480;
const float POSE_CROP_UPWARD_BIAS_RATIO = 0.15f;

int main(int argc, char** argv) {

    if (argc != 3) {

        std::cerr
            << "Usage: " << argv[0] << " <input video path> <output telemetry JSONL path>"
            << std::endl;

        return 1;
    }

    const char* input_video_path = argv[1];
    const char* output_telemetry_path = argv[2];

    StreamHandle stream = make_stream();

    // Same three models either way -- .engine files are built from these
    // very .onnx exports -- so detections are equivalent across backends.
    InferenceEngine detect_engine(
        "../../python/runs/detect/train/weights/best" MODEL_EXT, stream, 640
    );

    InferenceEngine court_engine(
        "../../python/runs/pose/train-MuSGD-1/weights/best" MODEL_EXT, stream, 640
    );

    InferenceEngine pose_engine(
        "../../python/yolo26n-pose" MODEL_EXT, stream, 480
    );

    std::cout << "All three engines ready.\n" << std::endl;

    cv::VideoCapture cap(input_video_path);

    if (!cap.isOpened()) {

        std::cerr
            << "Failed to open video source -- check that the path "
            << "is correct relative to wherever this program is "
            << "actually being run from."
            << std::endl;

        return 1;
    }

    double fps = cap.get(cv::CAP_PROP_FPS);

    if (fps <= 0) {

        fps = 30.0;
    }

    std::cout << "Source FPS: " << fps << std::endl;

    // Telemetry log -- one JSON object per line (JSONL). First line is
    // a metadata record (fps + source resolution) the caller needs to
    // convert a frame_id into a video-time offset; every line after
    // that is the same frame/shot_event schema follow-through-webrtc.cpp
    // sends over its DataChannel.
    std::ofstream telemetry_log(output_telemetry_path);

    {
        json meta;
        meta["type"] = "metadata";
        meta["fps"] = fps;
        meta["frame_width"] = cap.get(cv::CAP_PROP_FRAME_WIDTH);
        meta["frame_height"] = cap.get(cv::CAP_PROP_FRAME_HEIGHT);
        telemetry_log << meta.dump() << "\n";
    }

    FrameReader frame_reader(cap, FRAME_QUEUE_SIZE);

    frame_reader.start();

    // trail_frozen_at_rim: kept as server-side STATE (its
    // computation is tuned, real logic -- see the comment at its
    // computation site below) and sent to the client as a flag. The
    // visual_ball_trail VECTOR itself is gone: nothing server-side
    // reads it (it was purely a drawing accumulator), and the client
    // now reconstructs the trail itself from ball position +
    // potential_shot/shot_started/trail_frozen_at_rim each frame.
    bool trail_frozen_at_rim = false;

    std::optional<float> last_known_rim_center_y, last_known_rim_left, last_known_rim_right;

    std::optional<cv::Rect2f> previous_player_box;
    int player_miss_frames = 0;

    // ------------------------------------------------------
    // COURT CALIBRATION STATE
    // ------------------------------------------------------

    bool ever_calibrated = false;

    std::vector<cv::Point2f> persistent_court_points(7);
    std::vector<bool> persistent_court_valid(7, false);

    cv::Mat homography;

    std::vector<float> player_distance_history;

    const int PLAYER_SPEED_WINDOW_FRAMES = 15;
    std::vector<std::pair<long, cv::Point2f>> player_position_history;

    const float STAT_SMOOTHING_ALPHA = 0.2f;
    std::optional<float> smoothed_player_distance;
    std::optional<float> smoothed_player_speed_mph;

    std::optional<cv::Point2f> last_known_court_position;
    // The shooter's court position at the moment of release, in feet on the
    // rim-centred frame COURT_POINTS defines. Captured at release rather
    // than at the make/miss event, which fires once the ball has settled at
    // the rim -- by then the shooter has usually moved, and plotting that
    // position would put the shot in the wrong place on the chart.
    std::optional<cv::Point2f> shot_release_court_position;
    long last_known_court_position_frame = 0;
    cv::Point2f smoothed_velocity_ft_per_sec(0.0f, 0.0f);

    const int MAX_PLAYER_PROJECTION_FRAMES = 20;

    // ------------------------------------------------------
    // BALL COASTING STATE
    // ------------------------------------------------------

    cv::Point2f ball_velocity(0.0f, 0.0f);
    std::optional<cv::Point2f> last_real_ball_center;
    int ball_coast_frames = 0;

    // ------------------------------------------------------
    // RELEASE DETECTION STATE
    // ------------------------------------------------------

    long frame_number = 0;
    constexpr long TELEMETRY_FLUSH_FRAMES = 30;

    bool potential_shot = false;
    bool shot_started = false;

    std::optional<std::string> shooting_wrist;
    long potential_shot_start_frame = 0;
    int shot_cooldown_counter = 0;

    std::vector<cv::Point2f> ball_history;
    std::vector<float> ball_left_distance_history;
    std::vector<float> ball_right_distance_history;

    std::optional<cv::Point2f> last_left_wrist;
    std::optional<cv::Point2f> last_right_wrist;

    std::optional<cv::Point2f> previous_ball_center;

    auto clear_release_state = [&]() {

        potential_shot = false;
        shooting_wrist.reset();
        potential_shot_start_frame = 0;

        ball_history.clear();
        ball_left_distance_history.clear();
        ball_right_distance_history.clear();
    };

    // ------------------------------------------------------
    // SHOT TRACKING STATE
    // ------------------------------------------------------

    long shot_start_frame = 0;
    long shot_end_frame = 0;
    long apex_frame = 0;
    std::optional<cv::Point2f> apex_point;
    bool apex_confirmed = false;
    std::optional<float> time_to_apex;
    std::optional<float> shot_duration;
    std::optional<float> shot_distance;

    /*
     * The three shot metrics, written into every shot_event alongside
     * the position they were measured from.
     *
     * <p>The duration is derived here rather than read from the
     * `shot_duration` variable. That one is only assigned inside
     * finalize_shot_end, which runs *after* the make and bounced-out
     * events are emitted -- so reading it at those sites would
     * publish the previous shot's duration against this shot.
     *
     * <p>Null where a metric was not derivable: the release position
     * was never established, or the ball was not tracked cleanly
     * enough to find an apex. Consumers must skip rather than
     * substitute, the way they already do for court_x/court_y.
     */
    auto attach_shot_metrics = [&](json& event) {
        event["shot_distance"] =
            shot_distance.has_value() ? json(*shot_distance) : json(nullptr);
        event["time_to_apex"] =
            time_to_apex.has_value() ? json(*time_to_apex) : json(nullptr);
        // Measured to when the shot ENDED, not to the frame this event is
        // written on. A make is only confirmed MAKE_SETTLE_FRAMES after the
        // ball clears the rim, so using frame_number added that settle delay
        // to every make and left misses alone -- 0.2s on a ~1.1s flight,
        // which drags a make's time-to-apex ratio down by ~16% and invents a
        // relationship between arc and result that is not there.
        const long duration_end_frame = shot_end_frame > shot_start_frame
            ? shot_end_frame
            : frame_number;
        event["shot_duration"] =
            shot_start_frame > 0 && fps > 0.0
                ? json(static_cast<float>(duration_end_frame - shot_start_frame) / static_cast<float>(fps))
                : json(nullptr);
    };
    std::optional<std::string> shot_designation;

    std::optional<float> highest_ball_y;
    long highest_ball_frame = 0;
    std::optional<cv::Point2f> highest_ball_point;
    int downward_frames = 0;

    bool passed_net = false;
    int net_crossed_frames = 0;

    bool pending_make = false;
    long pending_make_frame = 0;

    int below_rim_frames = 0;

    int makes = 0;
    int misses = 0;
    bool shot_result_recorded = false;

    auto finalize_shot_end = [&]() {

        shot_end_frame = frame_number;

        if (shot_start_frame > 0) {

            shot_duration = static_cast<float>(shot_end_frame - shot_start_frame) / fps;
        }

        if (!shot_result_recorded && !pending_make) {

            misses++;

            shot_result_recorded = true;

            std::cout
                << "\n--- MISS (frame " << frame_number
                << ")  total: " << makes << "-" << misses << " ---\n"
                << std::endl;

            json event;
            event["type"] = "shot_event";
            event["frame_id"] = frame_number;
            event["result"] = "miss";
            event["reason"] = "net_or_timeout";
            event["makes"] = makes;
            event["misses"] = misses;
            event["shot_designation"] = shot_designation.has_value() ? json(*shot_designation) : json(nullptr);
            // Court-space release position, feet, rim-centred origin. Null when
            // the homography or the shooter was unavailable at release.
            event["court_x"] = shot_release_court_position.has_value()
                ? json(shot_release_court_position->x)
                : json(nullptr);
            event["court_y"] = shot_release_court_position.has_value()
                ? json(shot_release_court_position->y)
                : json(nullptr);
            attach_shot_metrics(event);
            telemetry_log << event.dump() << "\n";
        }

        shot_started = false;
        passed_net = false;
        net_crossed_frames = 0;
        apex_frame = 0;
        apex_point.reset();
        apex_confirmed = false;
        below_rim_frames = 0;

        trail_frozen_at_rim = false;

        clear_release_state();

        shot_cooldown_counter = SHOT_COOLDOWN_FRAMES;
    };

    // ---- per-stage timing accumulators ----
    //
    // These measure pure decode/select/calibration/keypoint-extraction
    // compute; t_json_build is the schema construction + write cost.
    // Reported as a [PERF] line every PERF_REPORT_INTERVAL frames.

    double t_preprocess = 0, t_infer_detect = 0, t_decode_detect = 0;
    double t_infer_court = 0, t_decode_court = 0;
    double t_pose_crop_preprocess = 0, t_infer_pose = 0, t_decode_pose = 0;
    double t_state_machine = 0, t_json_build = 0, t_total = 0;
    int perf_frame_count = 0;

    auto last_perf_print = std::chrono::steady_clock::now();

    while (true) {

        auto frame_total_start = std::chrono::steady_clock::now();

        auto [success, frame] = frame_reader.read();

        if (!success) {

            break;
        }

        frame_number++;

        // ---- preprocess (shared by detect + court) ----

        auto t0 = std::chrono::steady_clock::now();

        int detect_size = detect_engine.input_size();

        LetterboxResult lb_640 = letterbox(frame, detect_size);

        fill_chw_buffer(lb_640.image, detect_engine.input_buffer(), detect_size);

        court_engine.input_buffer() = detect_engine.input_buffer();

        auto t1 = std::chrono::steady_clock::now();
        t_preprocess += std::chrono::duration<double, std::milli>(t1 - t0).count();

        // ---- detect inference ----

        const auto& detect_output = detect_engine.run();

        auto t2 = std::chrono::steady_clock::now();
        t_infer_detect += std::chrono::duration<double, std::milli>(t2 - t1).count();

        // ---- decode: detect (drawing removed) ----

        auto t_decode_start = std::chrono::steady_clock::now();

        std::vector<Detection> ball_candidates;
        std::vector<Detection> net_candidates;
        std::vector<Detection> player_candidates;
        std::vector<Detection> rim_candidates;

        for (size_t i = 0; i < detect_engine.detection_row_count(); i++) {

            size_t row = i * detect_engine.row_width();

            float conf = detect_output[row + 4];
            int cls = static_cast<int>(detect_output[row + 5]);

            if (cls == 1) {

                if (conf < CONTINUATION_CONF) {

                    continue;
                }

            } else {

                if (conf < DETECTION_CONF) {

                    continue;
                }
            }

            cv::Rect2f box = unletterbox_box(
                detect_output[row + 0], detect_output[row + 1],
                detect_output[row + 2], detect_output[row + 3],
                lb_640
            );

            Detection det;
            det.box = box;
            det.center = cv::Point2f(box.x + box.width / 2, box.y + box.height / 2);
            det.confidence = conf;

            switch (cls) {

                case 1: ball_candidates.push_back(det); break;
                case 3: net_candidates.push_back(det); break;
                case 4: player_candidates.push_back(det); break;
                case 5: rim_candidates.push_back(det); break;
                default: break;
            }
        }

        // ---- select: exactly one of each, or none ----
        //
        // Plain confidence-based selection. A ByteTrack (Kalman +
        // Hungarian) tracker was tried here and produced worse ball
        // continuity than this, so it was removed.

        std::optional<Detection> basketball = select_best_by_conf(ball_candidates);

        std::optional<Detection> net = select_best_by_conf(net_candidates);
        std::optional<Detection> player = select_player_detection(player_candidates, previous_player_box);
        std::optional<Detection> rim = select_best_by_conf(rim_candidates);

        // ---- ball coasting ----

        bool ball_is_predicted = false;

        if (basketball.has_value()) {

            ball_coast_frames = 0;

        } else if ((potential_shot || shot_started) &&
                   last_real_ball_center.has_value() &&
                   ball_coast_frames < MAX_BALL_COAST_FRAMES) {

            ball_coast_frames++;

            cv::Point2f predicted_center(
                last_real_ball_center->x + ball_velocity.x * ball_coast_frames,
                last_real_ball_center->y + ball_velocity.y * ball_coast_frames
            );

            Detection predicted;
            predicted.center = predicted_center;
            predicted.confidence = 0.0f;
            predicted.predicted = true;

            basketball = predicted;
            ball_is_predicted = true;
        }

        if (basketball.has_value() && !ball_is_predicted) {

            if (last_real_ball_center.has_value()) {

                ball_velocity = cv::Point2f(
                    basketball->center.x - last_real_ball_center->x,
                    basketball->center.y - last_real_ball_center->y
                );
            }

            last_real_ball_center = basketball->center;
        }

        if (player.has_value()) {

            previous_player_box = player->box;
            player_miss_frames = 0;

        } else {

            player_miss_frames++;

            if (player_miss_frames > 45) {

                previous_player_box.reset();

                player_position_history.clear();
                smoothed_player_distance.reset();
                smoothed_player_speed_mph.reset();
                last_known_court_position.reset();
                smoothed_velocity_ft_per_sec = cv::Point2f(0.0f, 0.0f);
            }
        }

        std::optional<cv::Rect2f> player_box = player.has_value()
            ? std::optional<cv::Rect2f>(player->box)
            : std::nullopt;

        bool ball_near_release_zone = false;

        if (player.has_value() && basketball.has_value()) {

            float early_trigger_bound =
                player->box.y + player->box.height * EARLY_POSE_TRIGGER_RATIO;

            ball_near_release_zone = basketball->center.y <= early_trigger_bound;
        }

        // ---- player distance (feet from rim) + speed ----

        std::optional<float> player_distance;
        std::optional<float> player_speed_mph;
        bool player_stat_is_projected = false;

        if (!homography.empty() && player.has_value()) {

            cv::Point2f ground_pixel(
                player->box.x + player->box.width / 2.0f,
                player->box.y + player->box.height
            );

            std::vector<cv::Point2f> src = {ground_pixel};
            std::vector<cv::Point2f> dst;

            cv::perspectiveTransform(src, dst, homography);

            float dx = dst[0].x;
            float dy = dst[0].y;

            player_distance = std::sqrt(dx * dx + dy * dy);

            player_distance_history.push_back(*player_distance);

            if (player_distance_history.size() > 5) {

                player_distance_history.erase(player_distance_history.begin());
            }

            player_position_history.push_back({frame_number, dst[0]});

            if (static_cast<int>(player_position_history.size()) > PLAYER_SPEED_WINDOW_FRAMES) {

                player_position_history.erase(player_position_history.begin());
            }

            if (player_position_history.size() >= 2) {

                size_t n = player_position_history.size();
                const auto& prev = player_position_history[n - 2];
                const auto& curr = player_position_history[n - 1];

                long dt_frames = curr.first - prev.first;

                if (dt_frames > 0) {

                    float dt_seconds = static_cast<float>(dt_frames) / fps;
                    cv::Point2f instant_velocity = (curr.second - prev.second) / dt_seconds;

                    smoothed_velocity_ft_per_sec =
                        STAT_SMOOTHING_ALPHA * instant_velocity
                        + (1.0f - STAT_SMOOTHING_ALPHA) * smoothed_velocity_ft_per_sec;
                }
            }

            last_known_court_position = dst[0];
            last_known_court_position_frame = frame_number;

        } else if (!homography.empty() && !player.has_value() &&
                   last_known_court_position.has_value() &&
                   (frame_number - last_known_court_position_frame) <= MAX_PLAYER_PROJECTION_FRAMES) {

            float gap_seconds =
                static_cast<float>(frame_number - last_known_court_position_frame) / fps;

            cv::Point2f projected_position =
                *last_known_court_position + smoothed_velocity_ft_per_sec * gap_seconds;

            player_distance = cv::norm(projected_position);
            player_speed_mph = cv::norm(smoothed_velocity_ft_per_sec) * 0.681818f;
            player_stat_is_projected = true;
        }

        if (player_position_history.size() >= 2 && !player_stat_is_projected) {

            float total_path_ft = 0.0f;

            for (size_t i = 1; i < player_position_history.size(); i++) {

                total_path_ft += cv::norm(
                    player_position_history[i].second - player_position_history[i - 1].second
                );
            }

            long frame_span =
                player_position_history.back().first - player_position_history.front().first;

            if (frame_span > 0) {

                float elapsed_seconds = static_cast<float>(frame_span) / fps;
                float speed_ft_per_sec = total_path_ft / elapsed_seconds;

                player_speed_mph = speed_ft_per_sec * 0.681818f;
            }
        }

        if (player_distance.has_value()) {

            smoothed_player_distance = smoothed_player_distance.has_value()
                ? (STAT_SMOOTHING_ALPHA * (*player_distance) + (1.0f - STAT_SMOOTHING_ALPHA) * (*smoothed_player_distance))
                : *player_distance;
        }

        if (player_speed_mph.has_value()) {

            smoothed_player_speed_mph = smoothed_player_speed_mph.has_value()
                ? (STAT_SMOOTHING_ALPHA * (*player_speed_mph) + (1.0f - STAT_SMOOTHING_ALPHA) * (*smoothed_player_speed_mph))
                : *player_speed_mph;
        }

        std::optional<float> net_bottom;
        std::optional<float> rim_center_y, rim_left, rim_right;

        if (net.has_value()) {

            net_bottom = net->box.y + net->box.height;
        }

        if (rim.has_value()) {

            rim_center_y = rim->box.y + rim->box.height / 2.0f;
            rim_left = rim->box.x;
            rim_right = rim->box.x + rim->box.width;

            last_known_rim_center_y = rim_center_y;
            last_known_rim_left = rim_left;
            last_known_rim_right = rim_right;
        }

        // (ball/net/player/rim drawing removed)

        auto t_after_detect_decode = std::chrono::steady_clock::now();
        t_decode_detect +=
            std::chrono::duration<double, std::milli>(t_after_detect_decode - t_decode_start).count();

        // ---- court inference: gated to the calibration interval ----

        bool run_court_model_this_frame =
            !ever_calibrated || (frame_number % COURT_CALIBRATION_INTERVAL == 0);

        auto t_before_court = std::chrono::steady_clock::now();
        double court_infer_ms_this_frame = 0.0;

        // Tracks whether persistent_court_points/valid actually
        // changed this frame (a successful recalibration) -- the
        // client-facing schema only needs to receive updated court
        // keypoints on the frames they actually change, not every
        // frame redundantly (see the JSON build section below).
        bool court_calibration_updated_this_frame = false;

        if (run_court_model_this_frame) {

            const auto& court_output = court_engine.run();

            auto t_after_court_infer = std::chrono::steady_clock::now();
            court_infer_ms_this_frame =
                std::chrono::duration<double, std::milli>(t_after_court_infer - t_before_court).count();
            t_infer_court += court_infer_ms_this_frame;

            size_t best_row = 0;
            float best_conf = -1.0f;

            for (size_t i = 0; i < court_engine.detection_row_count(); i++) {

                size_t row = i * court_engine.row_width();

                float conf = court_output[row + 4];

                if (conf > best_conf) {

                    best_conf = conf;
                    best_row = row;
                }
            }

            if (best_conf > 0.05f) {

                std::vector<cv::Point2f> new_points(7);
                std::vector<bool> new_valid(7, false);
                int valid_count = 0;

                for (int k = 0; k < 7; k++) {

                    float kx = court_output[best_row + 6 + k * 3 + 0];
                    float ky = court_output[best_row + 6 + k * 3 + 1];
                    float kconf = court_output[best_row + 6 + k * 3 + 2];

                    if (kconf >= COURT_KEYPOINT_CONF) {

                        new_points[k] = unletterbox_point(kx, ky, lb_640);
                        new_valid[k] = true;
                        valid_count++;
                    }
                }

                if (valid_count >= 4) {

                    persistent_court_points = new_points;
                    persistent_court_valid = new_valid;
                    ever_calibrated = true;
                    court_calibration_updated_this_frame = true;

                    std::vector<cv::Point2f> image_points;
                    std::vector<cv::Point2f> real_points;

                    for (int k = 0; k < 7; k++) {

                        if (new_valid[k]) {

                            image_points.push_back(new_points[k]);
                            real_points.push_back(COURT_POINTS[k]);
                        }
                    }

                    if (image_points.size() >= 4) {

                        cv::Mat new_homography = cv::findHomography(
                            image_points, real_points, cv::RANSAC, 3.0
                        );

                        if (!new_homography.empty()) {

                            homography = new_homography;
                        }
                    }
                }
            }
        }

        // Nothing is drawn here: persistent_court_points/valid are
        // sent to the client, which draws the court itself.

        auto t4 = std::chrono::steady_clock::now();
        t_decode_court +=
            std::chrono::duration<double, std::milli>(t4 - t_before_court).count()
            - court_infer_ms_this_frame;

        // Crop, preprocess and inference inside the pose block are timed on their
        // own; the pose decode figure below is the remainder of the block.
        double pose_crop_infer_ms_this_frame = 0.0;

        // ---- pose: crop + preprocess + infer + decode -- captures
        // all six tracked keypoints (shoulders, elbows, wrists) into
        // frame-scoped variables for the JSON schema; the wrists are
        // also persisted for release detection. ----

        // COCO indices: 5,6 shoulders  7,8 elbows  9,10 wrists
        std::vector<cv::Point2f> pose_kpts(17);
        std::vector<bool> pose_valid(17, false);

        if (player_box.has_value() && (ball_near_release_zone || potential_shot)) {

            int frame_w = frame.cols;
            int frame_h = frame.rows;

            int center_x = static_cast<int>(player_box->x + player_box->width / 2);

            int center_y = static_cast<int>(
                player_box->y + player_box->height / 2
                - player_box->height * POSE_CROP_UPWARD_BIAS_RATIO
            );

            int half_w = POSE_CROP_WIDTH / 2;
            int half_h = POSE_CROP_HEIGHT / 2;

            int crop_x1 = center_x - half_w;
            int crop_x2 = center_x + half_w;
            int crop_y1 = center_y - half_h;
            int crop_y2 = center_y + half_h;

            if (crop_x1 < 0) { crop_x2 -= crop_x1; crop_x1 = 0; }
            if (crop_y1 < 0) { crop_y2 -= crop_y1; crop_y1 = 0; }
            if (crop_x2 > frame_w) { crop_x1 -= (crop_x2 - frame_w); crop_x2 = frame_w; }
            if (crop_y2 > frame_h) { crop_y1 -= (crop_y2 - frame_h); crop_y2 = frame_h; }

            crop_x1 = std::max(0, crop_x1);
            crop_y1 = std::max(0, crop_y1);
            crop_x2 = std::min(frame_w, crop_x2);
            crop_y2 = std::min(frame_h, crop_y2);

            if (crop_x2 > crop_x1 && crop_y2 > crop_y1) {

                auto tp0 = std::chrono::steady_clock::now();

                cv::Mat player_crop = frame(
                    cv::Rect(crop_x1, crop_y1, crop_x2 - crop_x1, crop_y2 - crop_y1)
                );

                int pose_size = pose_engine.input_size();

                LetterboxResult lb_pose = letterbox(player_crop, pose_size);

                fill_chw_buffer(lb_pose.image, pose_engine.input_buffer(), pose_size);

                auto tp1 = std::chrono::steady_clock::now();
                t_pose_crop_preprocess +=
                    std::chrono::duration<double, std::milli>(tp1 - tp0).count();

                const auto& pose_output = pose_engine.run();

                auto tp2 = std::chrono::steady_clock::now();
                t_infer_pose += std::chrono::duration<double, std::milli>(tp2 - tp1).count();
                pose_crop_infer_ms_this_frame =
                    std::chrono::duration<double, std::milli>(tp2 - tp0).count();

                size_t best_row = 0;
                float best_conf = -1.0f;

                for (size_t i = 0; i < pose_engine.detection_row_count(); i++) {

                    size_t row = i * pose_engine.row_width();

                    float conf = pose_output[row + 4];

                    if (conf > best_conf) {

                        best_conf = conf;
                        best_row = row;
                    }
                }

                if (best_conf > POSE_CONF) {

                    for (int k = 5; k <= 10; k++) {

                        float kx = pose_output[best_row + 6 + k * 3 + 0];
                        float ky = pose_output[best_row + 6 + k * 3 + 1];
                        float kconf = pose_output[best_row + 6 + k * 3 + 2];

                        if (kconf >= POSE_CONF) {

                            cv::Point2f local = unletterbox_point(kx, ky, lb_pose);

                            pose_kpts[k] = cv::Point2f(
                                local.x + crop_x1,
                                local.y + crop_y1
                            );

                            pose_valid[k] = true;
                        }
                    }

                    if (pose_valid[9]) {

                        last_left_wrist = pose_kpts[9];
                    }

                    if (pose_valid[10]) {

                        last_right_wrist = pose_kpts[10];
                    }

                    // (pose skeleton drawing removed)
                }
            }
        }

        auto t_after_pose = std::chrono::steady_clock::now();
        t_decode_pose +=
            std::chrono::duration<double, std::milli>(t_after_pose - t4).count()
            - pose_crop_infer_ms_this_frame;

        // ------------------------------------------------------
        // SHOT START DETECTION (release evaluation) -- unchanged,
        // no drawing was ever in this section.
        // ------------------------------------------------------

        if (!shot_started && basketball.has_value() && player.has_value()) {

            cv::Rect2f player_rect = player->box;

            float player_height = player_rect.height;

            int upper_bound = static_cast<int>(
                player_rect.y + player_height * UPPER_BODY_RATIO
            );

            cv::Point2f ball_center = basketball->center;

            bool crossed_upper_bound = false;

            if (previous_ball_center.has_value()) {

                if (previous_ball_center->y >= upper_bound && ball_center.y < upper_bound) {

                    crossed_upper_bound = true;
                }
            }

            std::optional<cv::Point2f> usable_left_wrist = last_left_wrist;
            std::optional<cv::Point2f> usable_right_wrist = last_right_wrist;

            std::optional<float> left_distance, right_distance;

            if (usable_left_wrist.has_value()) {

                left_distance = cv::norm(ball_center - *usable_left_wrist);
            }

            if (usable_right_wrist.has_value()) {

                right_distance = cv::norm(ball_center - *usable_right_wrist);
            }

            std::optional<float> closest_distance;
            std::optional<std::string> closest_side;

            if (left_distance.has_value()) {

                closest_distance = left_distance;
                closest_side = "left";
            }

            if (right_distance.has_value() &&
                (!closest_distance.has_value() || *right_distance < *closest_distance)) {

                closest_distance = right_distance;
                closest_side = "right";
            }

            float scaled_max_wrist_distance = player_height * MAX_BALL_WRIST_RATIO;

            if (crossed_upper_bound && closest_distance.has_value() &&
                *closest_distance <= scaled_max_wrist_distance &&
                shot_cooldown_counter <= 0) {

                potential_shot = true;
                shooting_wrist = closest_side;
                potential_shot_start_frame = frame_number;

                ball_history.clear();
                ball_left_distance_history.clear();
                ball_right_distance_history.clear();
            }

            if (potential_shot) {

                const size_t HISTORY_MAXLEN = 10;

                ball_history.push_back(ball_center);
                if (ball_history.size() > HISTORY_MAXLEN) ball_history.erase(ball_history.begin());

                if (left_distance.has_value()) {

                    ball_left_distance_history.push_back(*left_distance);
                    if (ball_left_distance_history.size() > HISTORY_MAXLEN) ball_left_distance_history.erase(ball_left_distance_history.begin());
                }

                if (right_distance.has_value()) {

                    ball_right_distance_history.push_back(*right_distance);
                    if (ball_right_distance_history.size() > HISTORY_MAXLEN) ball_right_distance_history.erase(ball_right_distance_history.begin());
                }

                if (static_cast<int>(ball_history.size()) >= RELEASE_FRAMES) {

                    std::vector<float>& distances =
                        (shooting_wrist.has_value() && *shooting_wrist == "left")
                            ? ball_left_distance_history
                            : ball_right_distance_history;

                    float upward_threshold, separation_threshold, accel_threshold;

                    if (player_distance.has_value() && *player_distance <= CLOSE_RANGE_FT) {

                        upward_threshold = MIN_BALL_UPWARD_MOVEMENT * CLOSE_RANGE_UPWARD_SCALE;
                        separation_threshold = MIN_RELEASE_SEPARATION * CLOSE_RANGE_SEPARATION_SCALE;
                        accel_threshold = MIN_RELEASE_ACCEL * CLOSE_RANGE_SEPARATION_SCALE;

                    } else {

                        upward_threshold = MIN_BALL_UPWARD_MOVEMENT;
                        separation_threshold = MIN_RELEASE_SEPARATION;
                        accel_threshold = MIN_RELEASE_ACCEL;
                    }

                    cv::Point2f ball_start = ball_history.front();
                    cv::Point2f ball_end = ball_history.back();

                    float ball_upward = ball_start.y - ball_end.y;

                    bool ball_moving_up = ball_upward >= upward_threshold;

                    bool ball_separated = false;
                    bool no_reversal = false;
                    bool early_accel_ok = false;

                    if (distances.size() >= 3) {

                        float separation = distances.back() - distances.front();

                        ball_separated = separation >= separation_threshold;

                        std::vector<float> deltas;

                        for (size_t i = 1; i < distances.size(); i++) {

                            deltas.push_back(distances[i] - distances[i - 1]);
                        }

                        no_reversal = true;

                        for (float d : deltas) {

                            if (d < -REVERSAL_TOLERANCE) {

                                no_reversal = false;
                                break;
                            }
                        }

                        early_accel_ok = !deltas.empty() && deltas[0] >= accel_threshold;
                    }

                    if (ball_moving_up && no_reversal && (ball_separated || early_accel_ok)) {

                        shot_started = true;
                        shot_start_frame = frame_number;
                        // May be empty when the court has not calibrated yet
                        // or the shooter was not detected; the client treats
                        // a null position as "not plottable" rather than
                        // guessing.
                        shot_release_court_position = last_known_court_position;

                        if (!player_distance_history.empty()) {

                            float sum = 0.0f;

                            for (float d : player_distance_history) {

                                sum += d;
                            }

                            shot_distance = sum / player_distance_history.size();

                        } else {

                            shot_distance = player_distance;
                        }

                        shot_designation = get_shot_designation(shot_distance);

                        shot_result_recorded = false;
                        pending_make = false;
                        pending_make_frame = 0;
                        below_rim_frames = 0;
                        passed_net = false;
                        net_crossed_frames = 0;
                        apex_confirmed = false;
                        apex_frame = 0;
                        apex_point.reset();
                        time_to_apex.reset();
                        shot_duration.reset();

                        highest_ball_y.reset();
                        highest_ball_frame = frame_number;
                        highest_ball_point.reset();
                        downward_frames = 0;

                        for (size_t hi = 0; hi < ball_history.size(); hi++) {

                            if (!highest_ball_y.has_value() || ball_history[hi].y < *highest_ball_y) {

                                highest_ball_y = ball_history[hi].y;
                                highest_ball_frame = frame_number - static_cast<long>(ball_history.size() - 1 - hi);
                                highest_ball_point = ball_history[hi];
                            }
                        }

                        std::cout
                            << "\n*** SHOT STARTED at frame " << frame_number
                            << " (wrist=" << (shooting_wrist.has_value() ? *shooting_wrist : "?")
                            << ") ***\n"
                            << std::endl;

                        clear_release_state();
                    }
                }
            }

            bool release_window_timed_out =
                potential_shot && potential_shot_start_frame > 0 &&
                ((frame_number - potential_shot_start_frame) / fps) > MAX_RELEASE_WINDOW_SEC;

            if ((potential_shot && static_cast<int>(ball_history.size()) >= MAX_RELEASE_WINDOW) ||
                release_window_timed_out) {

                trail_frozen_at_rim = false;

                clear_release_state();
            }
        }

        // ------------------------------------------------------
        // SHOT TRACKING (apex / make / net-crossing / rim-fallback)
        // -- unchanged, no drawing was ever in this section (the
        // apex marker draw call, which WAS separate, is removed
        // below).
        // ------------------------------------------------------

        if (shot_started && basketball.has_value()) {

            float ball_x = basketball->center.x;
            float ball_y = basketball->center.y;

            if (!apex_confirmed) {

                if (!highest_ball_y.has_value() || ball_y < *highest_ball_y) {

                    highest_ball_y = ball_y;
                    highest_ball_frame = frame_number;
                    highest_ball_point = basketball->center;
                    downward_frames = 0;

                } else if (previous_ball_center.has_value() && ball_y > previous_ball_center->y) {

                    downward_frames++;

                } else {

                    downward_frames = 0;
                }

                if (downward_frames >= APEX_CONFIRMATION_FRAMES) {

                    apex_confirmed = true;
                    apex_frame = highest_ball_frame;
                    apex_point = highest_ball_point;

                    time_to_apex = static_cast<float>(apex_frame - shot_start_frame) / fps;
                }
            }

            if (!shot_result_recorded && !pending_make &&
                rim_center_y.has_value() && rim_left.has_value() && rim_right.has_value() &&
                previous_ball_center.has_value() && !ball_is_predicted) {

                bool ball_moving_down = ball_y > previous_ball_center->y;
                bool ball_reached_rim = ball_y >= *rim_center_y;
                bool ball_inside_rim = ball_x >= *rim_left && ball_x <= *rim_right;

                bool apex_ok = apex_confirmed ||
                    (shot_distance.has_value() && *shot_distance <= CLOSE_RANGE_FT);

                if (ball_moving_down && ball_reached_rim && ball_inside_rim && apex_ok) {

                    pending_make = true;
                    pending_make_frame = frame_number;
                }
            }

            if (net_bottom.has_value()) {

                if (ball_y < *net_bottom) {

                    passed_net = true;
                    net_crossed_frames = 0;
                }

                if (passed_net) {

                    if (ball_y > *net_bottom) {

                        net_crossed_frames++;

                    } else {

                        net_crossed_frames = 0;
                    }

                    if (net_crossed_frames >= NET_RESET_FRAMES) {

                        finalize_shot_end();
                    }
                }
            }

            if (shot_started && apex_confirmed && rim_center_y.has_value()) {

                if (ball_y > *rim_center_y + RIM_FALLBACK_MARGIN) {

                    below_rim_frames++;

                } else {

                    below_rim_frames = 0;
                }

                if (below_rim_frames >= RIM_FALLBACK_FRAMES) {

                    finalize_shot_end();
                }
            }
        }

        // (apex marker drawing removed -- apex_point/apex_confirmed
        // are sent to the client, which draws its own marker)

        if (shot_started && shot_start_frame > 0) {

            float elapsed_shot_seconds = static_cast<float>(frame_number - shot_start_frame) / fps;

            if (elapsed_shot_seconds > MAX_SHOT_DURATION_SEC) {

                finalize_shot_end();
            }
        }

        if (pending_make) {

            long frames_since_pending = frame_number - pending_make_frame;

            bool reappeared_above_rim =
                basketball.has_value() && !basketball->predicted && rim_center_y.has_value() &&
                basketball->center.y < *rim_center_y - (RIM_FALLBACK_MARGIN / 2.0f);

            if (reappeared_above_rim) {

                pending_make = false;
                pending_make_frame = 0;

                if (!shot_result_recorded && !shot_started) {

                    misses++;

                    shot_result_recorded = true;

                    std::cout
                        << "\n--- MISS (bounced out, frame " << frame_number
                        << ")  total: " << makes << "-" << misses << " ---\n"
                        << std::endl;

                    json event;
                    event["type"] = "shot_event";
                    event["frame_id"] = frame_number;
                    event["result"] = "miss";
                    event["reason"] = "bounced_out";
                    event["makes"] = makes;
                    event["misses"] = misses;
                    event["shot_designation"] = shot_designation.has_value() ? json(*shot_designation) : json(nullptr);
                    // Court-space release position, feet, rim-centred origin. Null when
                    // the homography or the shooter was unavailable at release.
                    event["court_x"] = shot_release_court_position.has_value()
                        ? json(shot_release_court_position->x)
                        : json(nullptr);
                    event["court_y"] = shot_release_court_position.has_value()
                        ? json(shot_release_court_position->y)
                        : json(nullptr);
                    attach_shot_metrics(event);
                    telemetry_log << event.dump() << "\n";
                }

            } else if (frames_since_pending >= MAKE_SETTLE_FRAMES) {

                makes++;

                shot_result_recorded = true;
                pending_make = false;
                pending_make_frame = 0;

                std::cout
                    << "\n+++ MAKE (frame " << frame_number
                    << ")  total: " << makes << "-" << misses << " +++\n"
                    << std::endl;

                json event;
                event["type"] = "shot_event";
                event["frame_id"] = frame_number;
                event["result"] = "make";
                event["makes"] = makes;
                event["misses"] = misses;
                event["shot_designation"] = shot_designation.has_value() ? json(*shot_designation) : json(nullptr);
                // Court-space release position, feet, rim-centred origin. Null when
                // the homography or the shooter was unavailable at release.
                event["court_x"] = shot_release_court_position.has_value()
                    ? json(shot_release_court_position->x)
                    : json(nullptr);
                event["court_y"] = shot_release_court_position.has_value()
                    ? json(shot_release_court_position->y)
                    : json(nullptr);
                attach_shot_metrics(event);
                telemetry_log << event.dump() << "\n";
            }
        }

        if (basketball.has_value()) {

            previous_ball_center = basketball->center;

            // Trail-freeze determination -- kept as real server-side
            // logic (tuned multiplier, persisted last-known-rim
            // fallback) and sent to the client as a boolean, rather
            // than reimplemented client-side. The actual point-
            // accumulation into a trail array is now the client's
            // job, driven by potential_shot/shot_started/
            // trail_frozen_at_rim -- nothing here pushes to a vector
            // anymore.
            if ((potential_shot || shot_started) && !trail_frozen_at_rim) {

                if (last_known_rim_center_y.has_value() && last_known_rim_left.has_value() &&
                    last_known_rim_right.has_value() &&
                    !basketball->predicted && basketball->box.width > 0.0f) {

                    const float RIM_FREEZE_RADIUS_MULTIPLIER = 2.5f;

                    float ball_radius = (basketball->box.width + basketball->box.height) / 4.0f;
                    cv::Point2f rim_center_point(
                        (*last_known_rim_left + *last_known_rim_right) / 2.0f, *last_known_rim_center_y
                    );

                    float dist_to_rim = cv::norm(basketball->center - rim_center_point);

                    if (dist_to_rim <= ball_radius * RIM_FREEZE_RADIUS_MULTIPLIER) {

                        trail_frozen_at_rim = true;
                    }
                }
            }
        }

        if (shot_cooldown_counter > 0) {

            shot_cooldown_counter--;
        }

        auto t_after_state_machine = std::chrono::steady_clock::now();
        t_state_machine +=
            std::chrono::duration<double, std::milli>(t_after_state_machine - t_after_pose).count();

        // ============================================================
        // PER-FRAME JSON TELEMETRY -- replaces DRAW TRAJECTORY and the
        // LARGE STATISTICS OVERLAY block entirely. Fields correspond
        // directly to what those blocks used to draw; see the schema
        // discussion this was built from for the reasoning behind each
        // field's presence/omission (e.g. court_keypoints only sent on
        // the frames it actually changes, matching its own real update
        // cadence rather than being redundantly resent every frame).
        // ============================================================

        auto t_json_start = std::chrono::steady_clock::now();

        {
            json f;
            f["type"] = "frame";
            f["frame_id"] = frame_number;
            f["frame_width"] = frame.cols;
            f["frame_height"] = frame.rows;
            f["potential_shot"] = potential_shot;
            f["shot_started"] = shot_started;

            if (basketball.has_value()) {

                json ball_j;

                if (!basketball->predicted) {

                    ball_j["x1"] = basketball->box.x;
                    ball_j["y1"] = basketball->box.y;
                    ball_j["x2"] = basketball->box.x + basketball->box.width;
                    ball_j["y2"] = basketball->box.y + basketball->box.height;

                } else {

                    // Coasted/predicted position has no real box; the
                    // client draws it as a hollow marker.
                    ball_j["x1"] = nullptr;
                    ball_j["y1"] = nullptr;
                    ball_j["x2"] = nullptr;
                    ball_j["y2"] = nullptr;
                }

                ball_j["center_x"] = basketball->center.x;
                ball_j["center_y"] = basketball->center.y;
                ball_j["predicted"] = basketball->predicted;

                f["ball"] = ball_j;

            } else {

                f["ball"] = nullptr;
            }

            if (player.has_value()) {

                f["player"] = {
                    {"x1", player->box.x}, {"y1", player->box.y},
                    {"x2", player->box.x + player->box.width},
                    {"y2", player->box.y + player->box.height}
                };

            } else {

                f["player"] = nullptr;
            }

            if (rim.has_value()) {

                f["rim"] = {
                    {"x1", rim->box.x}, {"y1", rim->box.y},
                    {"x2", rim->box.x + rim->box.width},
                    {"y2", rim->box.y + rim->box.height}
                };

            } else {

                f["rim"] = nullptr;
            }

            if (net.has_value()) {

                f["net"] = {
                    {"x1", net->box.x}, {"y1", net->box.y},
                    {"x2", net->box.x + net->box.width},
                    {"y2", net->box.y + net->box.height}
                };

            } else {

                f["net"] = nullptr;
            }

            // Court keypoints: only included on frames where
            // recalibration actually changed them (~every
            // COURT_CALIBRATION_INTERVAL frames) -- the client holds
            // the last received value across frames in between,
            // matching exactly how persistent_court_points/valid
            // work server-side. Omitted (not present as a key) on
            // every other frame, rather than redundantly resent.
            if (court_calibration_updated_this_frame) {

                json kpts = json::array();

                for (int k = 0; k < 7; k++) {

                    kpts.push_back({
                        {"x", persistent_court_points[k].x},
                        {"y", persistent_court_points[k].y},
                        {"valid", persistent_court_valid[k]}
                    });
                }

                f["court_keypoints"] = kpts;
            }

            // Pose: only included if at least one tracked keypoint
            // was actually found this frame (pose is gated and often
            // doesn't run at all) -- omitted entirely otherwise,
            // rather than sending an all-invalid block.
            bool any_pose_valid = pose_valid[5] || pose_valid[6] || pose_valid[7] ||
                                   pose_valid[8] || pose_valid[9] || pose_valid[10];

            if (any_pose_valid) {

                auto kp = [&](int idx) {
                    return json{
                        {"x", pose_valid[idx] ? json(pose_kpts[idx].x) : json(nullptr)},
                        {"y", pose_valid[idx] ? json(pose_kpts[idx].y) : json(nullptr)},
                        {"valid", pose_valid[idx]}
                    };
                };

                f["pose"] = {
                    {"left_shoulder", kp(5)}, {"right_shoulder", kp(6)},
                    {"left_elbow", kp(7)}, {"right_elbow", kp(8)},
                    {"left_wrist", kp(9)}, {"right_wrist", kp(10)}
                };
            }

            f["trail_frozen_at_rim"] = trail_frozen_at_rim;

            if (shot_started && apex_confirmed && apex_point.has_value()) {

                f["apex_point"] = {{"x", apex_point->x}, {"y", apex_point->y}};

            } else {

                f["apex_point"] = nullptr;
            }

            f["player_distance_ft"] = smoothed_player_distance.has_value()
                ? json(*smoothed_player_distance) : json(nullptr);
            f["player_speed_mph"] = smoothed_player_speed_mph.has_value()
                ? json(*smoothed_player_speed_mph) : json(nullptr);
            f["player_stat_is_projected"] = player_stat_is_projected;

            f["shot_designation"] = shot_designation.has_value()
                ? json(*shot_designation) : json(nullptr);
            f["time_to_apex"] = time_to_apex.has_value()
                ? json(*time_to_apex) : json(nullptr);
            f["shot_duration"] = shot_duration.has_value()
                ? json(*shot_duration) : json(nullptr);
            f["shot_distance_ft"] = shot_distance.has_value()
                ? json(*shot_distance) : json(nullptr);

            telemetry_log << f.dump() << "\n";

            // Flush in small batches so prepare-playback.ts, which tails
            // this file to find the first shot apex for the thumbnail,
            // can act while detection is still running. It only needs
            // the stream up to that apex, so this interval sets how long
            // after it the consumer sees it: 30 frames is ~0.3s. Going
            // finer buys tenths of a second for many times the syscall
            // count.
            if (frame_number % TELEMETRY_FLUSH_FRAMES == 0) {
                telemetry_log.flush();
            }
        }

        auto t_after_json = std::chrono::steady_clock::now();
        t_json_build += std::chrono::duration<double, std::milli>(t_after_json - t_json_start).count();


        t_total += std::chrono::duration<double, std::milli>(t_after_json - frame_total_start).count();
        perf_frame_count++;

        auto now = std::chrono::steady_clock::now();

        if (std::chrono::duration<double>(now - last_perf_print).count() >= 1.0) {

            std::cout
                << "[PERF] preprocess:" << (t_preprocess / perf_frame_count)
                << "  detect_infer:" << (t_infer_detect / perf_frame_count)
                << "  detect_decode:" << (t_decode_detect / perf_frame_count)
                << "  court_infer:" << (t_infer_court / perf_frame_count)
                << "  court_decode:" << (t_decode_court / perf_frame_count)
                << "  pose_crop:" << (t_pose_crop_preprocess / perf_frame_count)
                << "  pose_infer:" << (t_infer_pose / perf_frame_count)
                << "  pose_decode:" << (t_decode_pose / perf_frame_count)
                << "  state_machine:" << (t_state_machine / perf_frame_count)
                << "  json_build:" << (t_json_build / perf_frame_count)
                << "  = total:" << (t_total / perf_frame_count)
                << "ms  (~" << (1000.0 * perf_frame_count / t_total) << " FPS)"
                << std::endl;

            t_preprocess = t_infer_detect = t_decode_detect = 0;
            t_infer_court = t_decode_court = 0;
            t_pose_crop_preprocess = t_infer_pose = t_decode_pose = 0;
            t_state_machine = t_json_build = t_total = 0;
            perf_frame_count = 0;

            last_perf_print = now;
        }
    }

    frame_reader.stop();
    frame_reader.join();

    cap.release();
    // Explicit end-of-stream marker: prepare-playback.ts reads this file
    // while it is still being written, so it cannot treat "no more bytes
    // right now" as "no more telemetry". Without this it would have to
    // guess from a timeout whether detection had finished or merely
    // stalled.
    telemetry_log << "{\"type\":\"eos\"}" << "\n";
    telemetry_log.flush();
    telemetry_log.close();

    destroy_stream(stream);

    return 0;
}