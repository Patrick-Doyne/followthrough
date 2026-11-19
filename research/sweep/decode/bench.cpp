// The backend's per-frame decode cost on this machine's GPU.
//
// Built by build.sh with the H264Decoder class copied verbatim from
// cpp/follow-through-webrtc.cpp above this file, so the measured path is the
// live one: NVDEC (h264_cuvid), the frame brought down to system memory, and
// NV12 -> BGR on the CPU. Feeds a raw Annex B H.264 file one access unit at a
// time, as the WebRTC frame callback does, and times each decode() call.
//
//   decode_bench <file.h264> [warmup_frames=60]
//
// The last line printed is one JSON object; the decoder's own log line above
// it says whether NVDEC or the software fallback was used.
extern "C" {
#include <libavformat/avformat.h>
}
#include <numeric>

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: decode_bench <file.h264> [warmup_frames]\n"); return 2; }
    const int warmup = argc > 2 ? std::atoi(argv[2]) : 60;
    AVFormatContext* fmt = nullptr;
    if (avformat_open_input(&fmt, argv[1], nullptr, nullptr) < 0) { std::fprintf(stderr, "open failed\n"); return 1; }
    avformat_find_stream_info(fmt, nullptr);
    H264Decoder dec;
    if (!dec.isReady()) { std::fprintf(stderr, "decoder not ready\n"); return 1; }
    AVPacket* pkt = av_packet_alloc();
    int frames = 0, width = 0, height = 0;
    double measured_ms = 0.0;
    int measured_frames = 0;
    std::vector<double> per_call;  // calls that produced a frame, after warm-up
    while (av_read_frame(fmt, pkt) >= 0) {
        auto t0 = std::chrono::steady_clock::now();
        std::vector<cv::Mat> out = dec.decode(pkt->data, pkt->size);
        double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        av_packet_unref(pkt);
        if (out.empty()) continue;
        width = out.back().cols; height = out.back().rows;
        frames += static_cast<int>(out.size());
        if (frames <= warmup) continue;
        measured_ms += ms;
        measured_frames += static_cast<int>(out.size());
        per_call.push_back(ms / out.size());
    }
    if (measured_frames == 0) { std::fprintf(stderr, "no frames after warm-up\n"); return 1; }
    std::sort(per_call.begin(), per_call.end());
    auto pct = [&](double q) { return per_call[std::min(per_call.size() - 1, static_cast<size_t>(q / 100.0 * (per_call.size() - 1) + 0.5))]; };
    std::printf("{\"frames\": %d, \"warmup_frames\": %d, \"width\": %d, \"height\": %d, "
                "\"mean_ms\": %.3f, \"p50_ms\": %.3f, \"p95_ms\": %.3f, \"max_ms\": %.3f}\n",
                frames, warmup, width, height, measured_ms / measured_frames, pct(50), pct(95), per_call.back());
    return 0;
}
