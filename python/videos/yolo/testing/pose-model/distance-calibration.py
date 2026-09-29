import cv2
import numpy as np
from ultralytics import YOLO


# ============================================================
# SETUP
# ============================================================

court_model = YOLO(
    "runs/pose/train-MuSGD-1/weights/best.pt"
)

player_model = YOLO(
    "runs/detect/train2-final/weights/best.pt"
)

video_path = "videos/train3/burkelake8.MOV"


# ============================================================
# KEYPOINT NAMES
# ============================================================

KEYPOINT_NAMES = {
    0: "FT-Right",
    1: "FT-Middle",
    2: "FT-Left",
    3: "TopKey",
    4: "Base-Right",
    5: "Base-Left",
    6: "Base-Middle",
}


# ============================================================
# SKELETON
# ============================================================

SKELETON = [
    (0, 1),
    (1, 2),
    (0, 2),

    (3, 0),
    (3, 1),
    (3, 2),

    (0, 4),
    (0, 5),
    (0, 6),

    (1, 4),
    (1, 5),
    (1, 6),

    (2, 4),
    (2, 5),
    (2, 6),

    (3, 4),
    (3, 5),
    (3, 6),

    (4, 5),
    (5, 6),
    (4, 6),
]


# ============================================================
# CLASS IDs
# ============================================================

BASKETBALL_CLASS = 1
NET_CLASS = 3
PLAYER_CLASS = 4
RIM_CLASS = 5


# ============================================================
# CONFIDENCE THRESHOLDS
# ============================================================

COURT_DETECTION_CONF = 0.05
COURT_KEYPOINT_CONF = 0.50

PLAYER_DETECTION_CONF = 0.50
RIM_DETECTION_CONF = 0.50


# ============================================================
# COURT GEOMETRY
# ============================================================

# Free throw line = 12 feet wide.
#
# FT-Middle -> Rim Center = 13.9 ft
# FT-Middle -> Baseline   = 19.0 ft
# TopKey -> FT-Middle     = 6.0 ft
#
# Therefore:
#
# FT-Left / FT-Right = 6 ft from FT-Middle
#
# Baseline is:
#
# 19.0 - 13.9 = 5.1 ft
#
# beyond the rim center.

FT_TO_RIM = 13.9
FT_TO_BASELINE = 19.0
TOPKEY_TO_FT = 6.0
FREE_THROW_WIDTH = 12.0


# ============================================================
# COURT COORDINATE SYSTEM
# ============================================================

# Rim Center = (0, 0)
#
# X = left/right across the court
# Y = direction along the court
#
# FT-Middle is 13.9 ft from the rim.
#
# TopKey is 6 ft farther away from the rim.
#
# Baseline is 19 ft from FT-Middle and therefore 5.1 ft
# beyond the rim on the opposite side.

COURT_POINTS = np.array([
    [-6.0, -13.9],   # FT-Right
    [ 0.0, -13.9],   # FT-Middle
    [ 6.0, -13.9],   # FT-Left
    [ 0.0, -19.9],   # TopKey
    [-6.0,   5.1],   # Base-Right
    [ 6.0,   5.1],   # Base-Left
    [ 0.0,   5.1],   # Base-Middle
], dtype=np.float32)


# ============================================================
# RIM COURT COORDINATE
# ============================================================

RIM_COURT_POINT = np.array(
    [[0.0, 0.0]],
    dtype=np.float32
)


# ============================================================
# TEMPORAL SMOOTHING
# ============================================================

SMOOTHING_ALPHA = 0.15

MAX_TRACK_DISTANCE = 200

tracks = {}

next_track_id = 0


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def calculate_iou(box1, box2):

    x1 = max(
        box1[0],
        box2[0]
    )

    y1 = max(
        box1[1],
        box2[1]
    )

    x2 = min(
        box1[2],
        box2[2]
    )

    y2 = min(
        box1[3],
        box2[3]
    )

    intersection_width = max(
        0,
        x2 - x1
    )

    intersection_height = max(
        0,
        y2 - y1
    )

    intersection_area = (
        intersection_width
        * intersection_height
    )

    box1_area = (
        max(0, box1[2] - box1[0])
        *
        max(0, box1[3] - box1[1])
    )

    box2_area = (
        max(0, box2[2] - box2[0])
        *
        max(0, box2[3] - box2[1])
    )

    union_area = (
        box1_area
        + box2_area
        - intersection_area
    )

    if union_area <= 0:
        return 0.0

    return (
        intersection_area
        / union_area
    )


def pixel_to_court(pixel_point, homography):

    point = np.array(
        [[pixel_point]],
        dtype=np.float32
    )

    transformed = cv2.perspectiveTransform(
        point,
        homography
    )

    return transformed[0][0]


def calculate_distance_to_rim(court_point):

    dx = court_point[0]
    dy = court_point[1]

    return (
        dx ** 2
        +
        dy ** 2
    ) ** 0.5


def get_player_ground_pixel(player_box):

    x1, y1, x2, y2 = player_box

    ground_x = (
        x1 + x2
    ) / 2

    ground_y = y2

    return (
        ground_x,
        ground_y
    )


# ============================================================
# OPEN VIDEO
# ============================================================

cap = cv2.VideoCapture(video_path)

if not cap.isOpened():
    raise RuntimeError(
        f"Could not open video: {video_path}"
    )


# ============================================================
# VIDEO INFORMATION
# ============================================================

fps = cap.get(cv2.CAP_PROP_FPS)
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

print()
print("=" * 60)
print("COURT DISTANCE TEST")
print("=" * 60)

print(f"Resolution: {width} x {height}")
print(f"FPS:        {fps:.2f}")

print()
print("Controls:")
print("Q = Quit")
print("P = Pause / Resume")


# ============================================================
# MAIN LOOP
# ============================================================

paused = False

homography = None

last_court_points = None

last_rim_center = None

while True:

    # ========================================================
    # READ FRAME
    # ========================================================

    if not paused:

        success, frame = cap.read()

        if not success:
            break


        # ====================================================
        # RUN COURT KEYPOINT MODEL
        # ====================================================

        court_results = court_model(
            frame,
            conf=COURT_DETECTION_CONF,
            verbose=False
        )

        court_result = court_results[0]


        # ====================================================
        # COURT KEYPOINT DETECTION
        # ====================================================

        if (
            court_result.boxes is not None
            and len(court_result.boxes) > 0
            and court_result.keypoints is not None
        ):

            points = (
                court_result.keypoints.xy
                .cpu()
                .numpy()
            )

            confidences = (
                court_result.keypoints.conf
                .cpu()
                .numpy()
            )

            boxes = (
                court_result.boxes.xyxy
                .cpu()
                .numpy()
            )

            box_confidences = (
                court_result.boxes.conf
                .cpu()
                .numpy()
            )


            # =================================================
            # SELECT HIGHEST CONFIDENCE COURT DETECTION
            # =================================================

            best_index = box_confidences.argmax()

            detection_points = (
                points[best_index].copy()
            )

            detection_conf = (
                confidences[best_index]
            )


            # =================================================
            # VALID KEYPOINTS
            # =================================================

            valid_points = (
                detection_conf
                >= COURT_KEYPOINT_CONF
            )


            # =================================================
            # UPDATE COURT POINTS
            # =================================================

            if valid_points.sum() >= 4:

                if last_court_points is None:

                    smoothed_court_points = (
                        detection_points.copy()
                    )

                else:

                    smoothed_court_points = (
                        last_court_points.copy()
                    )

                    for keypoint_id in range(7):

                        if valid_points[keypoint_id]:

                            smoothed_court_points[
                                keypoint_id
                            ] = (
                                SMOOTHING_ALPHA
                                * detection_points[
                                    keypoint_id
                                ]
                                +
                                (1 - SMOOTHING_ALPHA)
                                * last_court_points[
                                    keypoint_id
                                ]
                            )

                last_court_points = (
                    smoothed_court_points.copy()
                )


                # =================================================
                # BUILD HOMOGRAPHY
                # =================================================

                image_points = []
                real_points = []

                for keypoint_id in range(7):

                    if not valid_points[keypoint_id]:
                        continue

                    x, y = (
                        smoothed_court_points[
                            keypoint_id
                        ]
                    )

                    image_points.append(
                        [x, y]
                    )

                    real_points.append(
                        COURT_POINTS[
                            keypoint_id
                        ]
                    )


                image_points = np.array(
                    image_points,
                    dtype=np.float32
                )

                real_points = np.array(
                    real_points,
                    dtype=np.float32
                )


                if len(image_points) >= 4:

                    new_homography, status = (
                        cv2.findHomography(
                            image_points,
                            real_points,
                            cv2.RANSAC,
                            3.0
                        )
                    )

                    if new_homography is not None:

                        homography = (
                            new_homography
                        )


            # =================================================
            # DRAW COURT SKELETON
            # =================================================

            if last_court_points is not None:

                for id1, id2 in SKELETON:

                    if not valid_points[id1]:
                        continue

                    if not valid_points[id2]:
                        continue

                    x1, y1 = (
                        last_court_points[id1]
                    )

                    x2, y2 = (
                        last_court_points[id2]
                    )

                    x1 = int(x1)
                    y1 = int(y1)

                    x2 = int(x2)
                    y2 = int(y2)

                    cv2.line(
                        frame,
                        (x1, y1),
                        (x2, y2),
                        (255, 255, 255),
                        2,
                        cv2.LINE_AA
                    )


                # =================================================
                # DRAW COURT KEYPOINTS
                # =================================================

                for keypoint_id in range(7):

                    if not valid_points[
                        keypoint_id
                    ]:
                        continue

                    x, y = (
                        last_court_points[
                            keypoint_id
                        ]
                    )

                    x = int(x)
                    y = int(y)

                    conf = detection_conf[
                        keypoint_id
                    ]

                    cv2.circle(
                        frame,
                        (x, y),
                        7,
                        (0, 0, 255),
                        -1
                    )

                    cv2.putText(
                        frame,
                        f"{KEYPOINT_NAMES[keypoint_id]} "
                        f"{conf:.2f}",
                        (x + 8, y - 8),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.55,
                        (0, 255, 255),
                        2,
                        cv2.LINE_AA
                    )


        # ====================================================
        # RUN PLAYER / RIM DETECTOR
        # ====================================================

        detection_results = player_model(
            frame,
            conf=PLAYER_DETECTION_CONF,
            verbose=False
        )

        detection_result = (
            detection_results[0]
        )


        player_box = None
        rim_center = None


        if (
            detection_result.boxes is not None
            and len(detection_result.boxes) > 0
        ):

            boxes = (
                detection_result.boxes.xyxy
                .cpu()
                .numpy()
            )

            classes = (
                detection_result.boxes.cls
                .cpu()
                .numpy()
                .astype(int)
            )

            confidences = (
                detection_result.boxes.conf
                .cpu()
                .numpy()
            )


            # =================================================
            # FIND PLAYER
            # =================================================

            player_indices = [
                i
                for i, cls in enumerate(classes)
                if cls == PLAYER_CLASS
            ]

            if len(player_indices) > 0:

                best_player = max(
                    player_indices,
                    key=lambda i: confidences[i]
                )

                player_box = boxes[
                    best_player
                ]

                x1, y1, x2, y2 = (
                    player_box.astype(int)
                )

                cv2.rectangle(
                    frame,
                    (x1, y1),
                    (x2, y2),
                    (255, 0, 0),
                    2
                )


                # =================================================
                # PLAYER GROUND POSITION
                # =================================================

                player_ground_pixel = (
                    get_player_ground_pixel(
                        player_box
                    )
                )

                cv2.circle(
                    frame,
                    (
                        int(player_ground_pixel[0]),
                        int(player_ground_pixel[1])
                    ),
                    8,
                    (0, 255, 0),
                    -1
                )


            # =================================================
            # FIND RIM
            # =================================================

            rim_indices = [
                i
                for i, cls in enumerate(classes)
                if (
                    cls == RIM_CLASS
                    and confidences[i]
                    >= RIM_DETECTION_CONF
                )
            ]

            if len(rim_indices) > 0:

                best_rim = max(
                    rim_indices,
                    key=lambda i: confidences[i]
                )

                rim_box = boxes[
                    best_rim
                ]

                rx1, ry1, rx2, ry2 = (
                    rim_box.astype(int)
                )

                rim_center = (
                    (rx1 + rx2) / 2,
                    (ry1 + ry2) / 2
                )

                last_rim_center = (
                    rim_center
                )

                cv2.rectangle(
                    frame,
                    (rx1, ry1),
                    (rx2, ry2),
                    (0, 165, 255),
                    2
                )

                cv2.circle(
                    frame,
                    (
                        int(rim_center[0]),
                        int(rim_center[1])
                    ),
                    8,
                    (0, 165, 255),
                    -1
                )

                cv2.putText(
                    frame,
                    "RIM CENTER",
                    (
                        int(rim_center[0]) + 10,
                        int(rim_center[1])
                    ),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 165, 255),
                    2,
                    cv2.LINE_AA
                )


        # ====================================================
        # CALCULATE PLAYER DISTANCE
        # ====================================================

        if (
            homography is not None
            and player_box is not None
        ):

            player_ground_pixel = (
                get_player_ground_pixel(
                    player_box
                )
            )


            player_court_point = (
                pixel_to_court(
                    player_ground_pixel,
                    homography
                )
            )


            # ------------------------------------------------
            # Distance to rim center
            # ------------------------------------------------

            distance = (
                calculate_distance_to_rim(
                    player_court_point
                )
            )


            # =================================================
            # DISPLAY DISTANCE
            # =================================================

            cv2.putText(
                frame,
                f"PLAYER DISTANCE: {distance:.2f} ft",
                (30, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (0, 255, 0),
                2,
                cv2.LINE_AA
            )


            # =================================================
            # DISPLAY COURT COORDINATES
            # =================================================

            cv2.putText(
                frame,
                f"Court X: {player_court_point[0]:.2f} ft",
                (30, 75),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2,
                cv2.LINE_AA
            )

            cv2.putText(
                frame,
                f"Court Y: {player_court_point[1]:.2f} ft",
                (30, 105),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2,
                cv2.LINE_AA
            )


        else:

            cv2.putText(
                frame,
                "DISTANCE: CALIBRATING...",
                (30, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (0, 255, 255),
                2,
                cv2.LINE_AA
            )


    # ========================================================
    # PAUSED INDICATOR
    # ========================================================

    if paused:

        cv2.putText(
            frame,
            "PAUSED",
            (30, 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.9,
            (0, 255, 255),
            2,
            cv2.LINE_AA
        )


    # ========================================================
    # DISPLAY
    # ========================================================

    cv2.imshow(
        "Court Distance Test",
        frame
    )


    # ========================================================
    # KEYBOARD INPUT
    # ========================================================

    key = cv2.waitKey(1) & 0xFF

    if key == ord("q"):
        break

    elif key == ord("p"):
        paused = not paused


# ============================================================
# CLEANUP
# ============================================================

cap.release()

cv2.destroyAllWindows()