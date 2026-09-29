import cv2
from ultralytics import YOLO


# ============================================================
# SETUP
# ============================================================

model = YOLO(
    "runs/pose/train-MuSGD-1/weights/best.pt"
)

video_path = "videos/train3/burkelake7.MOV"


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
# CONFIDENCE THRESHOLDS
# ============================================================

DETECTION_CONF_THRESHOLD = 0.05

KEYPOINT_CONF_THRESHOLD = 0.50


# ============================================================
# DUPLICATE DETECTION FILTER
# ============================================================

# If two detections have this much bounding-box overlap,
# they are considered to be detecting the same court geometry.

DUPLICATE_IOU_THRESHOLD = 0.05


# ============================================================
# TEMPORAL SMOOTHING
# ============================================================

SMOOTHING_ALPHA = 0.15

# Maximum distance in pixels that a detection's bounding-box
# center can move between frames and still be considered the
# same detection.

MAX_TRACK_DISTANCE = 200


# Each tracked detection will have:
#
# {
#     track_id: {
#         "center": (x, y),
#         "points": previous keypoints
#     }
# }

tracks = {}

next_track_id = 0


# ============================================================
# HELPER FUNCTION
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
print("COURT KEYPOINT VIDEO TEST")
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

while True:

    # ========================================================
    # READ FRAME
    # ========================================================

    if not paused:

        success, frame = cap.read()

        if not success:
            break


        # ====================================================
        # RUN MODEL
        # ====================================================

        results = model(
            frame,
            conf=DETECTION_CONF_THRESHOLD,
            verbose=False
        )

        result = results[0]


        # ====================================================
        # CHECK FOR DETECTION
        # ====================================================

        if (
            result.boxes is not None
            and len(result.boxes) > 0
            and result.keypoints is not None
        ):

            # =================================================
            # GET KEYPOINT DATA
            # =================================================

            points = (
                result.keypoints.xy
                .cpu()
                .numpy()
            )

            confidences = (
                result.keypoints.conf
                .cpu()
                .numpy()
            )


            # =================================================
            # GET BOUNDING BOXES
            # =================================================

            boxes = (
                result.boxes.xyxy
                .cpu()
                .numpy()
            )

            box_confidences = (
                result.boxes.conf
                .cpu()
                .numpy()
            )


            # =================================================
            # REMOVE DUPLICATE / OVERLAPPING DETECTIONS
            # =================================================
            #
            # Sort detections by confidence.
            #
            # The highest-confidence detection gets priority.
            #
            # If another detection overlaps it sufficiently,
            # that detection is discarded.
            #
            # This allows genuinely separate detections to
            # remain while eliminating duplicate predictions
            # on top of each other.
            # =================================================

            sorted_indices = sorted(
                range(len(boxes)),
                key=lambda i: box_confidences[i],
                reverse=True
            )


            kept_indices = []


            for candidate_index in sorted_indices:

                is_duplicate = False


                for kept_index in kept_indices:

                    iou = calculate_iou(
                        boxes[candidate_index],
                        boxes[kept_index]
                    )


                    if (
                        iou
                        >= DUPLICATE_IOU_THRESHOLD
                    ):

                        is_duplicate = True

                        break


                if not is_duplicate:

                    kept_indices.append(
                        candidate_index
                    )


            # =================================================
            # APPLY DUPLICATE FILTER
            # =================================================

            points = points[
                kept_indices
            ]

            confidences = confidences[
                kept_indices
            ]

            boxes = boxes[
                kept_indices
            ]

            box_confidences = (
                box_confidences[
                    kept_indices
                ]
            )


            # =================================================
            # CALCULATE DETECTION CENTERS
            # =================================================

            detection_centers = []

            for box in boxes:

                x1, y1, x2, y2 = box

                center_x = (
                    x1 + x2
                ) / 2

                center_y = (
                    y1 + y2
                ) / 2

                detection_centers.append(
                    (
                        center_x,
                        center_y
                    )
                )


            # =================================================
            # MATCH CURRENT DETECTIONS TO EXISTING TRACKS
            # =================================================

            unmatched_track_ids = set(
                tracks.keys()
            )

            detection_track_ids = {}

            possible_matches = []


            for detection_index, center in enumerate(
                detection_centers
            ):

                current_x, current_y = center


                for track_id in unmatched_track_ids:

                    previous_x, previous_y = (
                        tracks[track_id]["center"]
                    )


                    distance = (
                        (
                            current_x
                            - previous_x
                        ) ** 2
                        +
                        (
                            current_y
                            - previous_y
                        ) ** 2
                    ) ** 0.5


                    if (
                        distance
                        <= MAX_TRACK_DISTANCE
                    ):

                        possible_matches.append(
                            (
                                distance,
                                detection_index,
                                track_id
                            )
                        )


            # =================================================
            # SORT MATCHES BY DISTANCE
            # =================================================

            possible_matches.sort(
                key=lambda x: x[0]
            )


            # =================================================
            # ASSIGN MATCHES
            # =================================================

            matched_detections = set()
            matched_tracks = set()


            for (
                distance,
                detection_index,
                track_id
            ) in possible_matches:

                if (
                    detection_index
                    in matched_detections
                ):
                    continue


                if track_id in matched_tracks:
                    continue


                detection_track_ids[
                    detection_index
                ] = track_id


                matched_detections.add(
                    detection_index
                )

                matched_tracks.add(
                    track_id
                )


            # =================================================
            # CREATE NEW TRACKS
            # =================================================

            for detection_index in range(
                len(detection_centers)
            ):

                if (
                    detection_index
                    in detection_track_ids
                ):
                    continue


                track_id = next_track_id

                next_track_id += 1


                detection_track_ids[
                    detection_index
                ] = track_id


            # =================================================
            # REMOVE OLD TRACKS
            # =================================================

            active_track_ids = set(
                detection_track_ids.values()
            )


            old_track_ids = [
                track_id
                for track_id in tracks
                if track_id
                not in active_track_ids
            ]


            for track_id in old_track_ids:

                del tracks[
                    track_id
                ]


            # =================================================
            # PROCESS EVERY DETECTION
            # =================================================

            for detection_index in range(
                len(points)
            ):

                detection_points = (
                    points[
                        detection_index
                    ].copy()
                )

                detection_conf = (
                    confidences[
                        detection_index
                    ]
                )

                detection_center = (
                    detection_centers[
                        detection_index
                    ]
                )

                track_id = (
                    detection_track_ids[
                        detection_index
                    ]
                )


                # =================================================
                # DETERMINE WHICH POINTS ARE VALID
                # =================================================

                valid_points = (
                    detection_conf
                    >= KEYPOINT_CONF_THRESHOLD
                )


                # =================================================
                # TEMPORAL SMOOTHING
                # =================================================

                if track_id not in tracks:

                    smoothed_points = (
                        detection_points.copy()
                    )

                else:

                    previous_points = (
                        tracks[
                            track_id
                        ]["points"]
                    )


                    smoothed_points = (
                        detection_points.copy()
                    )


                    for keypoint_id in range(
                        len(detection_points)
                    ):

                        if (
                            detection_conf[
                                keypoint_id
                            ]
                            >= KEYPOINT_CONF_THRESHOLD
                        ):

                            smoothed_points[
                                keypoint_id
                            ] = (
                                SMOOTHING_ALPHA
                                * detection_points[
                                    keypoint_id
                                ]
                                +
                                (1 - SMOOTHING_ALPHA)
                                * previous_points[
                                    keypoint_id
                                ]
                            )

                        else:

                            smoothed_points[
                                keypoint_id
                            ] = previous_points[
                                keypoint_id
                            ]


                # =================================================
                # UPDATE TRACK
                # =================================================

                tracks[track_id] = {
                    "center": detection_center,
                    "points": smoothed_points.copy()
                }


                # =================================================
                # DRAW SKELETON
                # =================================================

                for id1, id2 in SKELETON:

                    # Only draw connection when BOTH
                    # keypoints are confident enough

                    if not valid_points[id1]:
                        continue

                    if not valid_points[id2]:
                        continue

                    x1, y1 = (
                        smoothed_points[id1]
                    )

                    x2, y2 = (
                        smoothed_points[id2]
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
                # DRAW KEYPOINTS
                # =================================================

                for keypoint_id in range(7):

                    if not valid_points[
                        keypoint_id
                    ]:
                        continue


                    x, y = (
                        smoothed_points[
                            keypoint_id
                        ]
                    )


                    conf = (
                        detection_conf[
                            keypoint_id
                        ]
                    )


                    x = int(x)
                    y = int(y)


                    # ---------------------------------------------
                    # POINT
                    # ---------------------------------------------

                    cv2.circle(
                        frame,
                        (x, y),
                        7,
                        (0, 0, 255),
                        -1
                    )


                    # ---------------------------------------------
                    # LABEL
                    # ---------------------------------------------

                    label = (
                        f"{KEYPOINT_NAMES[keypoint_id]} "
                        f"{conf:.2f}"
                    )


                    cv2.putText(
                        frame,
                        label,
                        (x + 8, y - 8),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.55,
                        (0, 255, 255),
                        2,
                        cv2.LINE_AA
                    )


                # =================================================
                # DRAW BOUNDING BOX
                # =================================================

                box = boxes[
                    detection_index
                ]


                x1, y1, x2, y2 = (
                    box.astype(int)
                )


                cv2.rectangle(
                    frame,
                    (x1, y1),
                    (x2, y2),
                    (255, 0, 0),
                    2
                )


                # =================================================
                # DRAW DETECTION LABEL
                # =================================================

                box_conf = (
                    box_confidences[
                        detection_index
                    ]
                )


                cv2.putText(
                    frame,
                    f"FreeThrowKeyPoints "
                    f"{box_conf:.2f}",
                    (
                        x1,
                        max(y1 - 10, 20)
                    ),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (255, 0, 0),
                    2,
                    cv2.LINE_AA
                )


                # =================================================
                # DRAW TRACK ID
                # =================================================

                if len(points) > 1:

                    cv2.putText(
                        frame,
                        f"Track {track_id}",
                        (
                            x1,
                            min(
                                y2 + 25,
                                height - 10
                            )
                        ),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        (255, 255, 255),
                        2,
                        cv2.LINE_AA
                    )


            # =================================================
            # DISPLAY INFO
            # =================================================

            best_index = (
                box_confidences.argmax()
            )


            best_valid_points = (
                confidences[
                    best_index
                ]
                >= KEYPOINT_CONF_THRESHOLD
            )


            visible_count = int(
                best_valid_points.sum()
            )


            cv2.putText(
                frame,
                f"Detections: {len(points)}",
                (30, 35),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2,
                cv2.LINE_AA
            )


            cv2.putText(
                frame,
                f"Best Points: "
                f"{visible_count}/7",
                (30, 65),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2,
                cv2.LINE_AA
            )


        # ====================================================
        # NO DETECTION
        # ====================================================

        else:

            tracks.clear()

            cv2.putText(
                frame,
                "NO COURT KEYPOINT DETECTION",
                (30, 50),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (0, 0, 255),
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
        "Court Keypoint Video Test",
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