#include <opencv2/opencv.hpp>
#include <opencv2/dnn.hpp>
#include "NvInfer.h"
#include <cuda_runtime.h>

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
#include <cmath>
#include <limits>
#include <map>
#include <csignal>

// WEBRTC INPUT/OUTPUT -- frames arrive on a live WebRTC video track
// (via the KVS WebRTC C SDK's PeerConnection/DataChannel primitives,
// signaling through the local relay in js/mock-websocket.js) and
// telemetry goes back on a DataChannel. Reuses the SDK's own bundled
// libwebsockets rather than adding a separate WebSocket dependency.
#include <libwebsockets.h>

extern "C" {
#include <com/amazonaws/kinesis/video/webrtcclient/Include.h>
#include <libavcodec/avcodec.h>
}

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

    // Non-blocking variant, for signalingLoop --
    // that thread has nothing else to do while waiting for a
    // message, but still needs to wake periodically to check
    // gInterrupted rather than block forever on a message that might
    // never arrive (e.g. shutdown before the browser ever connects).
    // Purely additive: existing put()/get() callers are unaffected.
    /** Discards everything queued. Used when a session ends so frames from
     * the old stream are not consumed as part of the next one. */
    void clear() {

        {
            std::lock_guard<std::mutex> lock(mutex_);
            std::queue<T> empty;
            std::swap(queue_, empty);
        }

        not_full_.notify_all();
    }

    bool try_get(T& out) {

        std::lock_guard<std::mutex> lock(mutex_);

        if (queue_.empty()) {

            return false;
        }

        out = std::move(queue_.front());

        queue_.pop();

        not_full_.notify_one();

        return true;
    }

private:

    std::queue<T> queue_;
    size_t max_size_;
    std::mutex mutex_;
    std::condition_variable not_full_;
    std::condition_variable not_empty_;
};


// ============================================================
// Frames arrive live via the WebRTC video track (decoded by
// H264Decoder, pushed into gFrameQueue by sampleVideoFrameHandler);
// the BoundedBlockingQueue above is that queue. The offline sibling,
// follow-through-batch.cpp, feeds the same consumer loop from a
// file via its FrameReader instead.
// ============================================================


// ============================================================
// TENSORRT LOGGER
// ============================================================

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

    TensorRTEngine(const std::string& engine_path, cudaStream_t stream)
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
// MAIN -- the live pipeline. Nothing is drawn here: every frame
// produces one JSON telemetry message (see the schema mirrored in
// follow-through-pro-19/src/types/overlay-telemetry.ts) that is sent
// to the browser on the DataChannel, and the browser draws the
// overlay. The detection/state-machine code is the same as
// follow-through-batch.cpp's; keep the two in step when changing
// either. Console prints for SHOT STARTED / MAKE / MISS and [PERF]
// are the operator's view of what the pipeline is doing.
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

// ============================================================
// H264 DECODER -- libavcodec, one frame in, one BGR cv::Mat out. The
// YUV420P -> BGR conversion goes through an explicit flat-buffer
// copy rather than assuming AVFrame's planes are tightly packed:
// they carry their own linesize padding, and reading them as if
// packed shears the picture.
// ============================================================

class H264Decoder {

public:

    // Hardware first: NVDEC through libavcodec's h264_cuvid decoder. It
    // decodes a 4K frame in a few milliseconds and, unlike libavcodec's
    // frame threading, does not pipeline several frames at once -- frame
    // threading buys throughput by holding (threads - 1) frames back, which
    // is latency a live overlay cannot afford. The software decoder is only
    // the fallback for a machine without NVDEC, and there it runs with a
    // small number of frame threads so 4K still keeps up, at the cost of
    // that delay.
    H264Decoder() {

        const AVCodec* hw = avcodec_find_decoder_by_name("h264_cuvid");
        if (hw != nullptr && openWith(hw, 1)) {
            std::cout << "H264 decoder: NVDEC (h264_cuvid), hardware" << std::endl;
        } else {
            const AVCodec* sw = avcodec_find_decoder(AV_CODEC_ID_H264);
            if (sw == nullptr) {
                std::cerr << "H264 decoder not found (is libavcodec built with H264 support?)" << std::endl;
                return;
            }
            if (!openWith(sw, SOFTWARE_DECODE_THREADS)) {
                std::cerr << "Failed to open H264 decoder context." << std::endl;
                return;
            }
            std::cout << "H264 decoder: software (libavcodec h264), " << SOFTWARE_DECODE_THREADS
                      << " frame threads -- adds up to " << (SOFTWARE_DECODE_THREADS - 1)
                      << " frames of decode latency; NVDEC was not available" << std::endl;
        }

        frame_ = av_frame_alloc();
        packet_ = av_packet_alloc();
        ready_ = true;
    }

    static constexpr int SOFTWARE_DECODE_THREADS = 4;

    bool openWith(const AVCodec* codec, int threads) {

        AVCodecContext* ctx = avcodec_alloc_context3(codec);
        if (ctx == nullptr) return false;
        ctx->thread_count = threads;
        ctx->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;
        ctx->pkt_timebase = AVRational{1, 90000};  // RTP's clock; silences the cuvid timebase warning
        if (avcodec_open2(ctx, codec, nullptr) < 0) {
            avcodec_free_context(&ctx);
            return false;
        }
        codec_ = codec;
        context_ = ctx;
        return true;
    }

    ~H264Decoder() {

        if (packet_ != nullptr) av_packet_free(&packet_);
        if (frame_ != nullptr) av_frame_free(&frame_);
        if (context_ != nullptr) avcodec_free_context(&context_);
    }

    /** Drops any state carried over from a previous stream. A reconnect
     * brings a new SPS/PPS and a new IDR; without this the decoder tries to
     * continue the old sequence and emits nothing. */
    void reset() {

        if (context_ != nullptr) {

            avcodec_flush_buffers(context_);
        }
    }

    bool isReady() const {

        return ready_;
    }

    std::vector<cv::Mat> decode(const uint8_t* data, size_t size) {

        std::vector<cv::Mat> results;

        if (!ready_) {

            return results;
        }

        packet_->data = const_cast<uint8_t*>(data);
        packet_->size = static_cast<int>(size);

        int sendResult = avcodec_send_packet(context_, packet_);

        if (sendResult < 0) {

            std::cerr << "avcodec_send_packet failed: " << sendResult << std::endl;
            return results;
        }

        while (true) {

            int receiveResult = avcodec_receive_frame(context_, frame_);

            if (receiveResult == AVERROR(EAGAIN) || receiveResult == AVERROR_EOF) {

                break;

            } else if (receiveResult < 0) {

                std::cerr << "avcodec_receive_frame failed: " << receiveResult << std::endl;
                break;
            }

            results.push_back(convertToBgr(frame_));
            av_frame_unref(frame_);
        }

        return results;
    }

private:

    cv::Mat convertToBgr(AVFrame* frame) {

        int width = frame->width;
        int height = frame->height;

        if (frame->format == AV_PIX_FMT_NV12) {
            // NVDEC's output: a Y plane and one interleaved UV plane.
            cv::Mat yuv(height * 3 / 2, width, CV_8UC1);
            for (int row = 0; row < height; row++) {
                std::memcpy(yuv.ptr(row), frame->data[0] + static_cast<size_t>(row) * frame->linesize[0], width);
            }
            for (int row = 0; row < height / 2; row++) {
                std::memcpy(yuv.ptr(height + row), frame->data[1] + static_cast<size_t>(row) * frame->linesize[1], width);
            }
            cv::Mat bgr;
            cv::cvtColor(yuv, bgr, cv::COLOR_YUV2BGR_NV12);
            return bgr;
        }

        int uvWidth = width / 2;
        int uvHeight = height / 2;

        std::vector<uint8_t> flatBuffer(
            static_cast<size_t>(width) * height + 2 * static_cast<size_t>(uvWidth) * uvHeight);
        uint8_t* dst = flatBuffer.data();

        for (int row = 0; row < height; row++) {

            std::memcpy(dst + static_cast<size_t>(row) * width,
                        frame->data[0] + static_cast<size_t>(row) * frame->linesize[0], width);
        }
        dst += static_cast<size_t>(width) * height;

        for (int row = 0; row < uvHeight; row++) {

            std::memcpy(dst + static_cast<size_t>(row) * uvWidth,
                        frame->data[1] + static_cast<size_t>(row) * frame->linesize[1], uvWidth);
        }
        dst += static_cast<size_t>(uvWidth) * uvHeight;

        for (int row = 0; row < uvHeight; row++) {

            std::memcpy(dst + static_cast<size_t>(row) * uvWidth,
                        frame->data[2] + static_cast<size_t>(row) * frame->linesize[2], uvWidth);
        }

        cv::Mat yuvI420(height * 3 / 2, width, CV_8UC1, flatBuffer.data());

        cv::Mat bgr;
        cv::cvtColor(yuvI420, bgr, cv::COLOR_YUV2BGR_I420);
        return bgr;
    }

    const AVCodec* codec_ = nullptr;
    AVCodecContext* context_ = nullptr;
    AVFrame* frame_ = nullptr;
    AVPacket* packet_ = nullptr;
    bool ready_ = false;
};

// ============================================================
// WEBRTC CONNECTION -- signaling over the local relay, the KVS SDK's
// PeerConnection for media and the DataChannel, and a
// sampleVideoFrameHandler that pushes each decoded frame into
// gFrameQueue (a BoundedBlockingQueue<cv::Mat>) for the main() loop
// below to consume.
// ============================================================

std::atomic<bool> gInterrupted{false};

struct lws* gWsi = nullptr;
struct lws_context* gWsContext = nullptr;

BoundedBlockingQueue<std::string> gIncomingMessages(64);
std::string gReceiveBuffer;

std::mutex gOutgoingMutex;
std::queue<std::string> gOutgoingMessages;

PRtcPeerConnection gPeerConnection = nullptr;
PRtcRtpTransceiver gVideoTransceiver = nullptr;
std::atomic<bool> gDataChannelOpen{false};
PRtcDataChannel gDataChannel = nullptr;
std::mutex gDataChannelMutex;
std::atomic<bool> gAnswered{false};
/**
 * Set when an established session drops, cleared when the replacement peer
 * connection is ready.
 *
 * <p>Only the signaling thread ever tears down or rebuilds the peer
 * connection. The state-change callback merely raises this flag, because it
 * runs on the SDK's own thread and freeing the connection from inside its
 * own callback is a use-after-free. Keeping one owner also removes the need
 * for a lock around gPeerConnection.
 */
std::atomic<bool> gRestartRequested{false};

H264Decoder gDecoder;
BoundedBlockingQueue<cv::Mat> gFrameQueue(FRAME_QUEUE_SIZE);

void sigintHandler(int) {

    gInterrupted = true;
}

void sendToRelay(const std::string& message) {

    {
        std::lock_guard<std::mutex> lock(gOutgoingMutex);
        gOutgoingMessages.push(message);
    }

    if (gWsi != nullptr) {

        lws_callback_on_writable(gWsi);
    }
}

void sendToRelay(const json& message) {

    sendToRelay(message.dump());
}

// ============================================================
// SENDING TELEMETRY -- the actual point of Step 2. A genuinely
// different mechanism from sendToRelay above: this goes over the
// KVS DataChannel (dataChannelSend), not the signaling relay
// (lws_write) -- two unrelated transports that happen to sit next
// to each other in this file. Guarded by gDataChannelOpen since the
// pipeline can start processing frames before the DataChannel has
// actually finished opening; sending before then would just fail,
// not queue.
// ============================================================

void sendTelemetry(const std::string& payload) {

    if (!gDataChannelOpen) {

        return;
    }

    std::lock_guard<std::mutex> lock(gDataChannelMutex);

    if (gDataChannel == nullptr) {

        return;
    }

    STATUS status = dataChannelSend(
        gDataChannel, FALSE,
        reinterpret_cast<PBYTE>(const_cast<char*>(payload.c_str())),
        static_cast<UINT32>(payload.size()));

    if (STATUS_FAILED(status)) {

        std::cerr << "dataChannelSend failed: 0x" << std::hex << status << std::dec << std::endl;
    }
}

int wsCallback(struct lws* wsi, enum lws_callback_reasons reason, void* /*user*/, void* in, size_t len) {

    switch (reason) {

        case LWS_CALLBACK_CLIENT_ESTABLISHED: {

            std::cout << "[WS] Connected to local relay." << std::endl;
            break;
        }

        case LWS_CALLBACK_CLIENT_RECEIVE: {

            gReceiveBuffer.append(static_cast<char*>(in), len);

            size_t remaining = lws_remaining_packet_payload(wsi);

            if (remaining == 0 && lws_is_final_fragment(wsi)) {

                gIncomingMessages.put(std::move(gReceiveBuffer));
                gReceiveBuffer.clear();
            }
            break;
        }

        case LWS_CALLBACK_CLIENT_WRITEABLE: {

            std::string outgoing;
            bool haveMessage = false;

            {
                std::lock_guard<std::mutex> lock(gOutgoingMutex);

                if (!gOutgoingMessages.empty()) {

                    outgoing = std::move(gOutgoingMessages.front());
                    gOutgoingMessages.pop();
                    haveMessage = true;
                }
            }

            if (haveMessage) {

                std::vector<unsigned char> buffer(LWS_PRE + outgoing.size());
                std::memcpy(buffer.data() + LWS_PRE, outgoing.data(), outgoing.size());
                lws_write(wsi, buffer.data() + LWS_PRE, outgoing.size(), LWS_WRITE_TEXT);
            }

            bool moreQueued;
            {
                std::lock_guard<std::mutex> lock(gOutgoingMutex);
                moreQueued = !gOutgoingMessages.empty();
            }

            if (moreQueued) {

                lws_callback_on_writable(wsi);
            }
            break;
        }

        case LWS_CALLBACK_CLIENT_CONNECTION_ERROR:
            std::cerr << "[WS] Connection error -- is js/mock-websocket.js running?" << std::endl;
            gInterrupted = true;
            break;

        case LWS_CALLBACK_CLIENT_CLOSED:
            std::cout << "[WS] Relay connection closed." << std::endl;
            gInterrupted = true;
            break;

        default:
            break;
    }

    return 0;
}

VOID onIceCandidateHandler(UINT64 /*customData*/, PCHAR candidateJson) {

    if (candidateJson == nullptr) {

        std::cout << "[KVS] ICE candidate gathering finished." << std::endl;
        return;
    }

    try {

        json candidateObj = json::parse(candidateJson);
        json message;
        message["type"] = "ice-candidate";
        message["candidate"] = candidateObj;
        sendToRelay(message);

    } catch (const std::exception& e) {

        std::cerr << "[KVS] Failed to parse/forward ICE candidate: " << e.what() << std::endl;
    }
}

/**
 * Asks the signaling thread to rebuild the session.
 *
 * <p>Ignored unless a session was actually established: these states also
 * occur while a first connection is still being negotiated, and restarting
 * then would fight the handshake instead of recovering from a drop.
 */
void requestSessionRestart(const char* reason) {

    if (!gAnswered) {

        return;
    }

    if (!gRestartRequested.exchange(true)) {

        std::cout << "[KVS] Session " << reason << " -- will accept a new viewer." << std::endl;
    }
}

VOID onConnectionStateChange(UINT64 /*customData*/, RTC_PEER_CONNECTION_STATE newState) {

    switch (newState) {

        case RTC_PEER_CONNECTION_STATE_CONNECTED:
            std::cout << "[KVS] Peer connection CONNECTED." << std::endl;
            break;
        case RTC_PEER_CONNECTION_STATE_FAILED:
            std::cout << "[KVS] Peer connection FAILED." << std::endl;
            requestSessionRestart("failed");
            break;
        case RTC_PEER_CONNECTION_STATE_DISCONNECTED:
            std::cout << "[KVS] Peer connection DISCONNECTED." << std::endl;
            requestSessionRestart("disconnected");
            break;
        case RTC_PEER_CONNECTION_STATE_CLOSED:
            std::cout << "[KVS] Peer connection CLOSED." << std::endl;
            requestSessionRestart("closed");
            break;
        default:
            break;
    }
}

// Decoded frames are pushed into gFrameQueue for main()'s inference
// loop to consume. BoundedBlockingQueue::put()
// blocks if the queue is full -- deliberately, at a small
// FRAME_QUEUE_SIZE, so a slow inference loop applies backpressure
// rather than letting decoded frames pile up and drift the pipeline
// away from real time.
// Measured stream frame rate: an exponential moving average of the
// interval between decoded frames, taken where they arrive. main()
// converts frame counts to seconds with it (shot duration, time to
// apex, shooter speed, the release window), so the time base follows
// whatever the camera and the WebRTC track negotiate -- a 60 fps phone
// or a 30 fps webcam -- instead of an assumed constant.
std::atomic<double> gDecodeMsTotal{0.0};   // H.264 decode + BGR conversion, summed on the SDK thread
std::atomic<long> gDecodeFrames{0};
std::atomic<double> gArrivalIntervalSec{0.0};
std::atomic<long> gArrivalCount{0};
static std::chrono::steady_clock::time_point gLastArrival;
static bool gHaveLastArrival = false;
const double ARRIVAL_EMA_ALPHA = 0.05;
const double MAX_PLAUSIBLE_INTERVAL_SEC = 1.0;  // longer gaps are stalls, not pacing
const long ARRIVAL_WARMUP_FRAMES = 30;

static void resetArrivalRate() {
    gHaveLastArrival = false;
    gArrivalCount.store(0);
    gArrivalIntervalSec.store(0.0);
}

VOID sampleVideoFrameHandler(UINT64 /*customData*/, PFrame pFrame) {

    auto decode_start = std::chrono::steady_clock::now();
    std::vector<cv::Mat> decoded = gDecoder.decode(pFrame->frameData, pFrame->size);

    auto arrival = std::chrono::steady_clock::now();
    if (!decoded.empty()) {
        double ms = std::chrono::duration<double, std::milli>(arrival - decode_start).count();
        double prev = gDecodeMsTotal.load();
        while (!gDecodeMsTotal.compare_exchange_weak(prev, prev + ms)) {}
        gDecodeFrames.fetch_add(static_cast<long>(decoded.size()));
    }

    for (cv::Mat& mat : decoded) {

        if (gHaveLastArrival) {
            double dt = std::chrono::duration<double>(arrival - gLastArrival).count();
            if (dt > 0.0 && dt < MAX_PLAUSIBLE_INTERVAL_SEC) {
                double prev = gArrivalIntervalSec.load();
                gArrivalIntervalSec.store(prev <= 0.0 ? dt : prev + ARRIVAL_EMA_ALPHA * (dt - prev));
                gArrivalCount.fetch_add(1);
            }
        }
        gLastArrival = arrival;
        gHaveLastArrival = true;

        gFrameQueue.put(std::move(mat));
    }
}

VOID dataChannelOnMessageCallback(UINT64 /*customData*/, PRtcDataChannel /*pDataChannel*/, BOOL isBinary, PBYTE pMessage, UINT32 pMessageLen) {

    // Known, accepted limitation (see the corresponding discussion
    // this project reached) -- receiving from the browser triggers
    // an unresolved internal SDK error. Not needed for the real
    // deployment (telemetry flows server->client only), so this
    // callback is registered for completeness but intentionally does
    // nothing beyond logging.
    if (isBinary) {

        std::cout << "[DataChannel] Received binary message, " << pMessageLen << " bytes." << std::endl;

    } else {

        std::string message(reinterpret_cast<char*>(pMessage), pMessageLen);
        std::cout << "[DataChannel] Received: " << message << std::endl;
    }
}

VOID dataChannelOnOpenCallback(UINT64 /*customData*/, PRtcDataChannel pDataChannel) {

    std::cout << "[DataChannel] Opened: " << pDataChannel->name << std::endl;

    STATUS status = dataChannelOnMessage(pDataChannel, 0, dataChannelOnMessageCallback);

    if (STATUS_FAILED(status)) {

        std::cerr << "dataChannelOnMessage failed: 0x" << std::hex << status << std::dec << std::endl;
    }

    {
        std::lock_guard<std::mutex> lock(gDataChannelMutex);
        gDataChannel = pDataChannel;
    }
    gDataChannelOpen = true;
}

VOID onDataChannel(UINT64 /*customData*/, PRtcDataChannel pRtcDataChannel) {

    std::cout << "[KVS] New DataChannel received: " << pRtcDataChannel->name << std::endl;

    STATUS status = dataChannelOnOpen(pRtcDataChannel, 0, dataChannelOnOpenCallback);

    if (STATUS_FAILED(status)) {

        std::cerr << "dataChannelOnOpen failed: 0x" << std::hex << status << std::dec << std::endl;
    }
}

/**
 * Builds a peer connection ready to receive one viewer.
 *
 * <p>Extracted from main() so a dropped session can be replaced. Everything
 * here was previously inline and ran exactly once, which is the other half
 * of why reconnection was impossible.
 *
 * @return false if any step failed; the caller decides whether that is fatal
 *   (first connection) or worth retrying (a rebuild).
 */
bool buildPeerConnection() {

    STATUS kvsStatus = STATUS_SUCCESS;

    RtcConfiguration configuration;
    std::memset(&configuration, 0, sizeof(configuration));

    kvsStatus = createPeerConnection(&configuration, &gPeerConnection);
    if (STATUS_FAILED(kvsStatus)) {
        std::cerr << "createPeerConnection failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return false;
    }

    kvsStatus = peerConnectionOnIceCandidate(gPeerConnection, 0, onIceCandidateHandler);
    if (STATUS_FAILED(kvsStatus)) {
        std::cerr << "peerConnectionOnIceCandidate failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return false;
    }

    kvsStatus = peerConnectionOnConnectionStateChange(gPeerConnection, 0, onConnectionStateChange);
    if (STATUS_FAILED(kvsStatus)) {
        std::cerr << "peerConnectionOnConnectionStateChange failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return false;
    }

    kvsStatus = peerConnectionOnDataChannel(gPeerConnection, 0, onDataChannel);
    if (STATUS_FAILED(kvsStatus)) {
        std::cerr << "peerConnectionOnDataChannel failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return false;
    }

    kvsStatus = addSupportedCodec(gPeerConnection, RTC_CODEC_H264_PROFILE_42E01F_LEVEL_ASYMMETRY_ALLOWED_PACKETIZATION_MODE);
    if (STATUS_FAILED(kvsStatus)) {
        std::cerr << "addSupportedCodec failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return false;
    }

    RtcMediaStreamTrack videoTrack;
    std::memset(&videoTrack, 0, sizeof(videoTrack));
    videoTrack.kind = MEDIA_STREAM_TRACK_KIND_VIDEO;
    videoTrack.codec = RTC_CODEC_H264_PROFILE_42E01F_LEVEL_ASYMMETRY_ALLOWED_PACKETIZATION_MODE;
    STRCPY(videoTrack.streamId, "followThroughStream");
    STRCPY(videoTrack.trackId, "followThroughVideoTrack");

    RtcRtpTransceiverInit videoTransceiverInit;
    std::memset(&videoTransceiverInit, 0, sizeof(videoTransceiverInit));
    videoTransceiverInit.direction = RTC_RTP_TRANSCEIVER_DIRECTION_RECVONLY;

    kvsStatus = addTransceiver(gPeerConnection, &videoTrack, &videoTransceiverInit, &gVideoTransceiver);
    if (STATUS_FAILED(kvsStatus)) {
        std::cerr << "addTransceiver failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return false;
    }

    kvsStatus = transceiverOnFrame(gVideoTransceiver, 0, sampleVideoFrameHandler);
    if (STATUS_FAILED(kvsStatus)) {
        std::cerr << "transceiverOnFrame failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return false;
    }

    // The viewer creates its OWN DataChannel here, rather than
    // relying solely on the one onDataChannel receives from the
    // master. Receiving a channel is inherently racy for the "open"
    // callback: by the time onDataChannel fires and we register the
    // handler, the channel may have already finished its open
    // handshake, so the registration misses a one-time event that
    // already occurred -- the same class of bug as registering a
    // WebSocket "open" listener after the socket has already opened.
    // Creating our own channel means the "open" callback is
    // registered synchronously, immediately after creation, with no
    // async gap for that race to happen in. (onDataChannel/
    // onDataChannel's own registration above is left in place for
    // completeness -- logging whatever the master creates -- but
    // gDataChannel, what sendTelemetry actually uses, now points at
    // this one instead.)
    PRtcDataChannel pOwnDataChannel = nullptr;

    // A real mutable buffer, not a string literal directly -- silences
    // the (harmless, but avoidable) "ISO C++ forbids converting a
    // string constant to PCHAR" warning, matching how nearby STRCPY
    // calls already handle this same C-style-API mismatch.
    char channelName[] = "telemetry";

    kvsStatus = createDataChannel(gPeerConnection, channelName, nullptr, &pOwnDataChannel);
    if (STATUS_FAILED(kvsStatus)) {
        std::cerr << "createDataChannel failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return false;
    }

    kvsStatus = dataChannelOnOpen(pOwnDataChannel, 0, dataChannelOnOpenCallback);
    if (STATUS_FAILED(kvsStatus)) {
        std::cerr << "dataChannelOnOpen (own channel) failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return false;
    }


    return true;
}

/**
 * Releases the current session's resources.
 *
 * <p>Called only from the signaling thread. The data channel pointer is
 * cleared under its mutex first, so the inference thread cannot send into a
 * channel that is about to be freed.
 */
void teardownPeerConnection() {
    resetArrivalRate();

    {
        std::lock_guard<std::mutex> lock(gDataChannelMutex);
        gDataChannel = nullptr;
    }
    gDataChannelOpen = false;

    if (gPeerConnection != nullptr) {

        closePeerConnection(gPeerConnection);
        freePeerConnection(&gPeerConnection);
        gPeerConnection = nullptr;
    }

    gVideoTransceiver = nullptr;

    // The next viewer sends a new H.264 stream, and anything still queued
    // belongs to the old one.
    gDecoder.reset();
    gFrameQueue.clear();
}

/**
 * Replaces a dropped session with a fresh one.
 *
 * <p>Order matters: gAnswered is cleared only once the new connection is
 * built, because clearing it earlier would let the signaling loop accept an
 * offer against a connection that does not exist yet.
 */
bool restartSession() {

    std::cout << "[KVS] Rebuilding peer connection for the next viewer..." << std::endl;

    teardownPeerConnection();

    if (!buildPeerConnection()) {

        std::cerr << "[KVS] Rebuild failed. No further viewers can attach." << std::endl;
        return false;
    }

    gAnswered = false;
    std::cout << "[KVS] Ready for a new viewer." << std::endl;
    return true;
}

/**
 * Announces readiness to the relay for as long as no viewer is attached.
 *
 * <p>This used to exit permanently once the first offer was answered, which
 * is half of why a browser could never reconnect: even after the flag that
 * gates offers was cleared, nothing told the next viewer that the pipeline
 * was available. It now runs for the process lifetime and simply goes quiet
 * while a session is up.
 */
void readyRetryLoop() {

    while (!gInterrupted) {

        if (!gAnswered) {

            json ready;
            ready["type"] = "ready";
            sendToRelay(ready);
        }

        std::this_thread::sleep_for(std::chrono::seconds(1));
    }
}

// Handles the offer/answer/ICE exchange on its own thread, separate
// from the main inference loop -- the inference loop needs to stay
// dedicated to consuming frames from gFrameQueue and running
// detection, not interleaved with signaling message processing the
// way the standalone connection tests did (which had nothing else
// competing for the thread).
void signalingLoop() {

    while (!gInterrupted) {

        // Session lifecycle is handled here, on the one thread that owns
        // the peer connection, rather than in the SDK callback that
        // detected the drop.
        if (gRestartRequested.exchange(false)) {

            // Messages queued against the connection being torn down are
            // meaningless to its replacement.
            std::string discarded;
            while (gIncomingMessages.try_get(discarded)) {
            }

            if (!restartSession()) {

                break;
            }

            continue;
        }

        std::string raw;

        if (!gIncomingMessages.try_get(raw)) {

            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            continue;
        }

        json message;

        try {

            message = json::parse(raw);

        } catch (const std::exception& e) {

            std::cerr << "[Signaling] Failed to parse incoming message: " << e.what() << std::endl;
            continue;
        }

        std::string type = message.value("type", "");

        if (type == "offer" && !gAnswered) {

            RtcSessionDescriptionInit offerInit;
            std::memset(&offerInit, 0, sizeof(offerInit));
            STATUS deserializeStatus = deserializeSessionDescriptionInit(
                const_cast<PCHAR>(raw.c_str()), static_cast<UINT32>(raw.size()), &offerInit);

            if (STATUS_FAILED(deserializeStatus)) {

                std::cerr << "deserializeSessionDescriptionInit (offer) failed: 0x"
                           << std::hex << deserializeStatus << std::dec << std::endl;
                continue;
            }

            STATUS remoteStatus = setRemoteDescription(gPeerConnection, &offerInit);

            if (STATUS_FAILED(remoteStatus)) {

                std::cerr << "setRemoteDescription failed: 0x" << std::hex << remoteStatus << std::dec << std::endl;
                continue;
            }
            std::cout << "[KVS] Remote offer set." << std::endl;

            RtcSessionDescriptionInit answerInit;
            std::memset(&answerInit, 0, sizeof(answerInit));

            STATUS localStatus = setLocalDescription(gPeerConnection, &answerInit);

            if (STATUS_FAILED(localStatus)) {

                std::cerr << "setLocalDescription failed: 0x" << std::hex << localStatus << std::dec << std::endl;
                continue;
            }

            STATUS answerStatus = createAnswer(gPeerConnection, &answerInit);

            if (STATUS_FAILED(answerStatus)) {

                std::cerr << "createAnswer failed: 0x" << std::hex << answerStatus << std::dec << std::endl;
                continue;
            }
            std::cout << "[KVS] Answer created." << std::endl;

            UINT32 buffLen = 0;
            serializeSessionDescriptionInit(&answerInit, nullptr, &buffLen);

            std::vector<char> answerBuffer(buffLen);
            STATUS serializeStatus = serializeSessionDescriptionInit(&answerInit, answerBuffer.data(), &buffLen);

            if (STATUS_FAILED(serializeStatus)) {

                std::cerr << "serializeSessionDescriptionInit (answer) failed: 0x"
                           << std::hex << serializeStatus << std::dec << std::endl;
                continue;
            }

            sendToRelay(std::string(answerBuffer.data()));
            std::cout << "[KVS] Answer sent." << std::endl;

            gAnswered = true;

        } else if (type == "ice-candidate") {

            if (!message.contains("candidate")) {

                continue;
            }

            std::string candidateJson = message["candidate"].dump();

            RtcIceCandidateInit iceCandidateInit;
            std::memset(&iceCandidateInit, 0, sizeof(iceCandidateInit));
            STATUS iceStatus = deserializeRtcIceCandidateInit(
                const_cast<PCHAR>(candidateJson.c_str()), static_cast<UINT32>(candidateJson.size()), &iceCandidateInit);

            if (STATUS_FAILED(iceStatus)) {

                std::cerr << "deserializeRtcIceCandidateInit failed: 0x" << std::hex << iceStatus << std::dec << std::endl;
                continue;
            }

            STATUS addStatus = addIceCandidate(gPeerConnection, iceCandidateInit.candidate);

            if (STATUS_FAILED(addStatus)) {

                std::cerr << "addIceCandidate failed: 0x" << std::hex << addStatus << std::dec << std::endl;
            }
        }
    }
}

int main() {

    cudaStream_t stream;

    CUDA_CHECK(cudaStreamCreate(&stream));

    TensorRTEngine detect_engine(
        "../../python/runs/detect/train/weights/best.engine", stream
    );

    TensorRTEngine court_engine(
        "../../python/runs/pose/train-MuSGD-1/weights/best.engine", stream
    );

    TensorRTEngine pose_engine(
        "../../python/yolo26n-pose.engine", stream
    );

    std::cout << "All three engines ready.\n" << std::endl;

    signal(SIGINT, sigintHandler);

    // ---- Connect to the local signaling relay ----

    struct lws_protocols protocols[] = {
        { "relay-protocol", wsCallback, 0, 0, 0, nullptr, 0 },
        LWS_PROTOCOL_LIST_TERM
    };

    struct lws_context_creation_info contextInfo;
    std::memset(&contextInfo, 0, sizeof(contextInfo));
    contextInfo.port = CONTEXT_PORT_NO_LISTEN;
    contextInfo.protocols = protocols;

    gWsContext = lws_create_context(&contextInfo);

    if (gWsContext == nullptr) {

        std::cerr << "Failed to create libwebsockets context." << std::endl;
        return 1;
    }

    struct lws_client_connect_info connectInfo;
    std::memset(&connectInfo, 0, sizeof(connectInfo));
    connectInfo.context = gWsContext;
    connectInfo.address = "localhost";
    connectInfo.port = 8080;
    connectInfo.path = "/";
    connectInfo.host = connectInfo.address;
    connectInfo.origin = connectInfo.address;
    connectInfo.protocol = protocols[0].name;
    connectInfo.pwsi = &gWsi;

    if (lws_client_connect_via_info(&connectInfo) == nullptr) {

        std::cerr << "Failed to initiate connection to relay." << std::endl;
        return 1;
    }

    std::thread wsThread([]() {

        while (!gInterrupted) {

            lws_service(gWsContext, 50);
        }
    });

    // ---- Initialize KVS WebRTC and the peer connection ----

    STATUS kvsStatus = initKvsWebRtc();

    if (STATUS_FAILED(kvsStatus)) {

        std::cerr << "initKvsWebRtc failed: 0x" << std::hex << kvsStatus << std::dec << std::endl;
        return 1;
    }
    std::cout << "[KVS] WebRTC initialized." << std::endl;

    if (!buildPeerConnection()) {

        return 1;
    }

    std::cout << "[KVS] Peer connection ready. Waiting for offer from master..." << std::endl;

    std::thread readyThread(readyRetryLoop);
    std::thread signalingThread(signalingLoop);

    // fps: measured from the arrival interval of decoded frames (see
    // gArrivalIntervalSec), re-read every frame below. 30.0 is only the
    // placeholder for the first ARRIVAL_WARMUP_FRAMES frames of a
    // session, before the running average can be trusted.
    double fps = 30.0;
    bool fps_measured = false;
    std::cout << "Stream frame rate: measured from frame arrival (placeholder " << fps
              << " fps until " << ARRIVAL_WARMUP_FRAMES << " frames have arrived)" << std::endl;

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
            std::string event_payload = event.dump();
            sendTelemetry(event_payload);
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
    // compute; t_json_build is the schema construction + send cost.
    // Reported as a [PERF] line every PERF_REPORT_INTERVAL frames.

    double t_preprocess = 0, t_infer_detect = 0, t_decode_detect = 0;
    double t_infer_court = 0, t_decode_court = 0;
    double t_pose_crop_preprocess = 0, t_infer_pose = 0, t_decode_pose = 0;
    double t_state_machine = 0, t_json_build = 0, t_total = 0;
    int perf_frame_count = 0;

    auto last_perf_print = std::chrono::steady_clock::now();

    while (!gInterrupted) {

        auto frame_total_start = std::chrono::steady_clock::now();

        cv::Mat frame;

        // Non-blocking + short sleep, not a blocking get() -- the
        // loop needs to wake periodically to check gInterrupted for
        // clean shutdown, the same reasoning as signalingLoop's own
        // try_get usage. This is a live stream now, not a file with
        // a natural end, so there's no "success=false" signal to
        // break on anymore -- gInterrupted (Ctrl+C) is the only exit
        // condition.
        if (!gFrameQueue.try_get(frame)) {

            std::this_thread::sleep_for(std::chrono::milliseconds(5));
            continue;
        }

        frame_number++;

        // ---- time base: follow the measured stream rate ----
        {
            double interval = gArrivalIntervalSec.load();
            if (gArrivalCount.load() >= ARRIVAL_WARMUP_FRAMES && interval > 0.0) {
                fps = 1.0 / interval;
                if (!fps_measured) {
                    std::cout << "Stream frame rate measured: " << fps << " fps" << std::endl;
                    fps_measured = true;
                }
            }
        }

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
                    std::string event_payload = event.dump();
                    sendTelemetry(event_payload);
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
                std::string event_payload = event.dump();
                sendTelemetry(event_payload);
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
            // Added so a client (the live renderer, specifically)
            // can size its canvas to match the actual source
            // resolution instead of assuming one -- box/keypoint
            // coordinates are in this frame's pixel space, and a
            // client that doesn't know it will draw everything
            // crammed into a corner if it guesses wrong. Sent every
            // frame (not once) since it's cheap and needs no
            // separate synchronization; older recordings without
            // this field simply fall back to whatever default the
            // client already had.
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

            std::string frame_payload = f.dump();
            sendTelemetry(frame_payload);
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
                << "  stream_fps:" << fps
                << "  decode(ms/frame, SDK thread):" << (gDecodeFrames.load() > 0 ? gDecodeMsTotal.load() / gDecodeFrames.load() : 0.0)
                << std::endl;
            gDecodeMsTotal.store(0.0);
            gDecodeFrames.store(0);

            t_preprocess = t_infer_detect = t_decode_detect = 0;
            t_infer_court = t_decode_court = 0;
            t_pose_crop_preprocess = t_infer_pose = t_decode_pose = 0;
            t_state_machine = t_json_build = t_total = 0;
            perf_frame_count = 0;

            last_perf_print = now;
        }
    }

    std::cout << "Shutting down..." << std::endl;

    wsThread.join();
    readyThread.join();
    signalingThread.join();

    if (gPeerConnection != nullptr) {

        closePeerConnection(gPeerConnection);
        freePeerConnection(&gPeerConnection);
    }

    lws_context_destroy(gWsContext);

    CUDA_CHECK(cudaStreamDestroy(stream));

    return 0;
}