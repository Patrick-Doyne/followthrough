from ultralytics import YOLO
import cv2
import time
import numpy as np


# ============================================================
# SETUP
# ============================================================

VIDEO_PATH = "videos/train5/burnside7.MOV"
MODEL_PATH = "runs/detect/train2-final/weights/best.pt"

DEVICE = 0

# Number of GPU warmup inferences
WARMUP_FRAMES = 20

# Number of frames used for each benchmark
TEST_FRAMES = 120

# Resolution sent to YOLO
FRAME_WIDTH = 1280
FRAME_HEIGHT = 720

# Start testing at this detection rate
START_FPS = 10

# Increase by this amount each test
FPS_STEP = 2

# Maximum detection rate to test
MAX_TEST_FPS = 60

# We require this much headroom.
#
# Example:
# 30 FPS target with 35 ms processing time
# = 28.57 FPS theoretical capacity
#
# A 20% safety margin prevents us from calling a borderline
# rate "maintainable."
SAFETY_MARGIN = 0.20

# ============================================================
# LOAD VIDEO
# ============================================================

cap = cv2.VideoCapture(VIDEO_PATH)

if not cap.isOpened():
    print("ERROR: Could not open video.")
    exit()

VIDEO_FPS = cap.get(cv2.CAP_PROP_FPS)

print("=" * 60)
print("MAINTAINABLE DETECTION CEILING TEST")
print("=" * 60)
print(f"Source video FPS: {VIDEO_FPS:.2f}")
print(f"Resolution sent to model: {FRAME_WIDTH}x{FRAME_HEIGHT}")
print()

# ============================================================
# LOAD MODEL
# ============================================================

model = YOLO(MODEL_PATH)

model.to("cuda:0")

print("Model loaded on:", model.device)
print()


# ============================================================
# LOAD TEST FRAMES
# ============================================================

print("Loading test frames...")

test_frames = []

for i in range(TEST_FRAMES):

    success, frame = cap.read()

    if not success:
        break

  #  frame = cv2.resize(
  #      frame,
  #      (FRAME_WIDTH, FRAME_HEIGHT)
   # )

    test_frames.append(frame)

cap.release()

if len(test_frames) == 0:
    print("ERROR: No frames could be loaded.")
    exit()

print(f"Loaded {len(test_frames)} test frames.")
print()

# ============================================================
# BENCHMARK FUNCTION
# ============================================================

def benchmark_detection_rate(target_fps):

    # How much time is available for each detection
    allowed_time = 1.0 / target_fps

    processing_times = []

    start_time = time.perf_counter()

    for frame in test_frames:

        frame_start = time.perf_counter()

        model(
            frame,
            device=DEVICE,
            verbose=False
        )

        frame_end = time.perf_counter()

        processing_times.append(
            frame_end - frame_start
        )

    total_time = time.perf_counter() - start_time

    processing_times = np.array(processing_times)

    average_time = np.mean(processing_times)

    median_time = np.median(processing_times)

    p90_time = np.percentile(
        processing_times,
        90
    )

    p95_time = np.percentile(
        processing_times,
        95
    )

    worst_time = np.max(processing_times)

    actual_fps = 1.0 / average_time

    # We use P90 for the maintainability test.
    #
    # This means 90% of detections must fit inside the
    # available time budget.
    maintainable = (
        p90_time <=
        allowed_time * (1.0 - SAFETY_MARGIN)
    )

    return {
        "target_fps": target_fps,
        "allowed_time": allowed_time,
        "average_time": average_time,
        "median_time": median_time,
        "p90_time": p90_time,
        "p95_time": p95_time,
        "worst_time": worst_time,
        "actual_fps": actual_fps,
        "maintainable": maintainable,
        "total_time": total_time
    }


# ============================================================
# FIND CEILING
# ============================================================

results = []

highest_maintainable = None

print("=" * 60)
print("TESTING DETECTION RATES")
print("=" * 60)
print()

target_fps = START_FPS

while target_fps <= MAX_TEST_FPS:

    print(f"Testing {target_fps} detections/sec...")

    result = benchmark_detection_rate(target_fps)

    results.append(result)

    print(
        f"  Average:   {result['average_time'] * 1000:.2f} ms"
    )

    print(
        f"  Median:    {result['median_time'] * 1000:.2f} ms"
    )

    print(
        f"  P90:       {result['p90_time'] * 1000:.2f} ms"
    )

    print(
        f"  P95:       {result['p95_time'] * 1000:.2f} ms"
    )

    print(
        f"  Worst:     {result['worst_time'] * 1000:.2f} ms"
    )

    print(
        f"  Theoretical processing FPS: "
        f"{result['actual_fps']:.2f}"
    )

    if result["maintainable"]:

        print("  RESULT:    MAINTAINABLE")

        highest_maintainable = result

    else:

        print("  RESULT:    NOT MAINTAINABLE")

        print()
        print("Ceiling reached.")

        break

    print()

    target_fps += FPS_STEP


# ============================================================
# FINAL RESULTS
# ============================================================

print()
print("=" * 60)
print("FINAL RESULTS")
print("=" * 60)

if highest_maintainable is None:

    print("No tested detection rate was maintainable.")

else:

    ceiling = highest_maintainable["target_fps"]

    print(
        f"Highest maintainable detection rate: "
        f"{ceiling} FPS"
    )

    print(
        f"Average inference time: "
        f"{highest_maintainable['average_time'] * 1000:.2f} ms"
    )

    print(
        f"P90 inference time: "
        f"{highest_maintainable['p90_time'] * 1000:.2f} ms"
    )

    print(
        f"Theoretical average capacity: "
        f"{highest_maintainable['actual_fps']:.2f} FPS"
    )

    print()

    # ========================================================
    # SOURCE VIDEO COMPARISON
    # ========================================================

    if ceiling >= VIDEO_FPS:

        print(
            f"Your detector can maintain every frame of the "
            f"{VIDEO_FPS:.2f} FPS source video."
        )

        print(
            "No frame skipping is required."
        )

    else:

        frames_per_detection = VIDEO_FPS / ceiling

        print(
            f"Source video FPS: "
            f"{VIDEO_FPS:.2f}"
        )

        print(
            f"Maintainable detection FPS: "
            f"{ceiling:.2f}"
        )

        print(
            f"Source frames per detection: "
            f"{frames_per_detection:.2f}"
        )

        print()

        print(
            "Example:"
        )

        print(
            f"Process approximately 1 detection every "
            f"{frames_per_detection:.2f} source frames."
        )

print()
print("=" * 60)
print("ALL TESTED RATES")
print("=" * 60)

for result in results:

    status = (
        "MAINTAINABLE"
        if result["maintainable"]
        else
        "NOT MAINTAINABLE"
    )

    print(
        f"{result['target_fps']:>3} FPS | "
        f"avg "
        f"{result['average_time'] * 1000:>6.2f} ms | "
        f"P90 "
        f"{result['p90_time'] * 1000:>6.2f} ms | "
        f"{status}"
    )

print()