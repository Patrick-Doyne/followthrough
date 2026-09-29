from ultralytics import YOLO
import cv2
import cvzone
import math
import time


# ============================================================
# SETUP
# ============================================================

VIDEO_PATH = "videos/train5/burnside7.MOV"
MODEL_PATH = "runs/detect/train2-final/weights/best.pt"

cap = cv2.VideoCapture(VIDEO_PATH)

if not cap.isOpened():
    print("ERROR: Could not open video.")
    exit()

VIDEO_FPS = cap.get(cv2.CAP_PROP_FPS)

model = YOLO(MODEL_PATH)
model.to("cuda:0")

classNames = [
    "Backboard",
    "Basketball",
    "",
    "Net",
    "Player",
    "Rim"
]


# ============================================================
# TEST SETTINGS
# ============================================================

TEST_FRAMES = 300

frame_count = 0

processing_times = []

start_time = time.perf_counter()


# ============================================================
# PROCESS VIDEO
# ============================================================

while True:

    success, img = cap.read()

    if not success:
        break

    frame_start = time.perf_counter()

    # --------------------------------------------------------
    # YOLO
    # --------------------------------------------------------

    results = model(
        img,
        device=0,
        verbose=False
    )

    # --------------------------------------------------------
    # DRAW DETECTIONS
    # --------------------------------------------------------

    for r in results:

        boxes = r.boxes

        for box in boxes:

            x1, y1, x2, y2 = box.xyxy[0]

            x1 = int(x1)
            y1 = int(y1)
            x2 = int(x2)
            y2 = int(y2)

            cvzone.cornerRect(
                img,
                (
                    x1,
                    y1,
                    x2 - x1,
                    y2 - y1
                )
            )

            conf = math.ceil(
                (box.conf[0] * 100)
            ) / 100

            cls = int(box.cls[0])

            cvzone.putTextRect(
                img,
                f'{classNames[cls]} {conf}',
                (
                    max(0, x1),
                    max(35, y1)
                ),
                scale=1.5,
                thickness=2
            )

    # --------------------------------------------------------
    # NO DISPLAY
    # --------------------------------------------------------

    # cv2.imshow() intentionally removed
    # cv2.waitKey() intentionally removed

    # --------------------------------------------------------
    # TIMING
    # --------------------------------------------------------

    frame_end = time.perf_counter()

    processing_time = (
        frame_end - frame_start
    )

    processing_times.append(
        processing_time
    )

    frame_count += 1

    # --------------------------------------------------------
    # STOP AFTER TEST FRAMES
    # --------------------------------------------------------

    if frame_count >= TEST_FRAMES:
        break


# ============================================================
# RESULTS
# ============================================================

total_time = (
    time.perf_counter() - start_time
)

cap.release()


if len(processing_times) == 0:

    print("ERROR: No frames were processed.")
    exit()


average_time = (
    sum(processing_times)
    / len(processing_times)
)

processing_fps = 1.0 / average_time

print()
print("=" * 60)
print("TEST D RESULTS")
print("=" * 60)

print(
    f"Source FPS:                 "
    f"{VIDEO_FPS:.2f}"
)

print(
    f"Frames tested:              "
    f"{frame_count}"
)

print(
    f"Total test time:            "
    f"{total_time:.2f} s"
)

print(
    f"Average processing time:    "
    f"{average_time * 1000:.2f} ms"
)

print(
    f"Processing FPS:             "
    f"{processing_fps:.2f}"
)

print()

if processing_fps >= VIDEO_FPS:

    print(
        "RESULT: YOLO + drawing can maintain "
        "the source FPS."
    )

else:

    print(
        "RESULT: YOLO + drawing cannot maintain "
        "the source FPS."
    )

print("=" * 60)