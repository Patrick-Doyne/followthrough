import cv2
from ultralytics import YOLO
from collections import deque
import math


# ============================================================
# SETUP
# ============================================================

cap = cv2.VideoCapture("videos/train3/burkelake8.MOV")

model = YOLO("runs/detect/train/weights/best.pt")
model.to("cuda:0")

pose_model = YOLO("yolo26n-pose.pt")


# ============================================================
# GPU
# ============================================================

# Use CUDA GPU 0 for both object detection and pose detection.
DEVICE = 0


# ============================================================
# VIDEO FPS
# ============================================================

fps = cap.get(cv2.CAP_PROP_FPS)

if fps <= 0:
    fps = 30.0


# ============================================================
# STATE
# ============================================================

trajectory = []

shot_started = False
potential_shot = False
passed_net = False

net_crossed_frames = 0

previous_ball_center = None


# ============================================================
# SHOT STATISTICS
# ============================================================

shots = 0
makes = 0
misses = 0

shot_result_recorded = False


# ============================================================
# SHOT TIMING
# ============================================================

shot_start_frame = None
shot_end_frame = None

apex_frame = None
apex_point = None
apex_confirmed = False

time_to_apex = None
shot_duration = None


# ============================================================
# APEX TRACKING
# ============================================================

highest_ball_y = None
highest_ball_frame = None
highest_ball_point = None

# Number of consecutive downward frames required
# before we confirm that the apex has occurred.
APEX_CONFIRMATION_FRAMES = 3

downward_frames = 0


# ============================================================
# BALL HISTORY
# ============================================================

ball_history = deque(maxlen=10)


# ============================================================
# WRIST HISTORIES
# ============================================================

left_wrist_history = deque(maxlen=10)
right_wrist_history = deque(maxlen=10)


# ============================================================
# BALL-TO-WRIST DISTANCE HISTORIES
# ============================================================

ball_left_distance_history = deque(maxlen=10)
ball_right_distance_history = deque(maxlen=10)


# ============================================================
# WHICH WRIST IS INTERACTING WITH THE BALL
# ============================================================

shooting_wrist = None


# ============================================================
# LAST KNOWN WRISTS
# ============================================================

last_left_wrist = None
last_right_wrist = None


# ============================================================
# THRESHOLDS
# ============================================================

DETECTION_CONF = 0.8
POSE_CONF = 0.1

# Ball must cross upper 1/10 of player
UPPER_BODY_RATIO = 0.0125

# Maximum distance between ball and wrist to start
MAX_BALL_WRIST_DISTANCE = 120

# Minimum total ball/wrist separation
MIN_RELEASE_SEPARATION = 20

# Minimum ball movement upward
MIN_BALL_UPWARD_MOVEMENT = 8

# Frames used to evaluate release
RELEASE_FRAMES = 4

# Maximum amount of time allowed for release candidate
MAX_RELEASE_WINDOW = 12

# Number of consecutive frames the ball must remain
# below the net before the shot is ended
NET_RESET_FRAMES = 3


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def distance(point1, point2):

    return math.sqrt(
        (point1[0] - point2[0]) ** 2
        +
        (point1[1] - point2[1]) ** 2
    )


def clear_release_state():

    global potential_shot
    global shooting_wrist

    potential_shot = False
    shooting_wrist = None

    ball_history.clear()

    left_wrist_history.clear()
    right_wrist_history.clear()

    ball_left_distance_history.clear()
    ball_right_distance_history.clear()


def reset_apex_state():

    global apex_frame
    global apex_point
    global apex_confirmed
    global highest_ball_y
    global highest_ball_frame
    global highest_ball_point
    global downward_frames

    apex_frame = None
    apex_point = None
    apex_confirmed = False

    highest_ball_y = None
    highest_ball_frame = None
    highest_ball_point = None

    downward_frames = 0


# ============================================================
# MAIN LOOP
# ============================================================

frame_number = 0


while True:

    success, frame = cap.read()

    if not success:
        break


    frame_number += 1


    # ========================================================
    # FOLLOW THROUGH DETECTION
    # ========================================================

    # GPU OBJECT DETECTION
    results = model.track(
        frame,
        persist=True,
        tracker="bytetrack.yaml",
        conf=DETECTION_CONF,
        device=DEVICE,
        quantize="fp16",
        imgsz=640,
        verbose=False
    )


    basketball = None
    net = None
    player = None
    rim = None


    # ========================================================
    # READ FOLLOW THROUGH DETECTIONS
    # ========================================================

    for result in results:

        for box in result.boxes:

            cls = int(box.cls[0])
            conf = float(box.conf[0])

            if conf < 0.8:
                continue


            x1, y1, x2, y2 = map(
                int,
                box.xyxy[0]
            )


            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2


            # Basketball = 1
            if cls == 1:

                basketball = {
                    "center": (cx, cy),
                    "box": (x1, y1, x2, y2),
                    "conf": conf
                }


            # Net = 3
            elif cls == 3:

                net = {
                    "box": (x1, y1, x2, y2),
                    "conf": conf
                }


            # Player = 4
            elif cls == 4:

                player = {
                    "box": (x1, y1, x2, y2),
                    "conf": conf
                }


            # Rim = 5
            elif cls == 5:

                rim = {
                    "box": (x1, y1, x2, y2),
                    "conf": conf
                }


    # ========================================================
    # PLAYER
    # ========================================================

    upper_bound = None

    if player:

        px1, py1, px2, py2 = player["box"]

        player_height = py2 - py1

        upper_bound = int(
            py1 +
            player_height * UPPER_BODY_RATIO
        )


        cv2.rectangle(
            frame,
            (px1, py1),
            (px2, py2),
            (255, 255, 0),
            2
        )


        cv2.line(
            frame,
            (px1, upper_bound),
            (px2, upper_bound),
            (255, 0, 255),
            2
        )


    # ========================================================
    # NET
    # ========================================================

    net_bottom = None

    if net:

        nx1, ny1, nx2, ny2 = net["box"]

        net_bottom = ny2


        cv2.rectangle(
            frame,
            (nx1, ny1),
            (nx2, ny2),
            (0, 255, 255),
            2
        )


        cv2.line(
            frame,
            (nx1, net_bottom),
            (nx2, net_bottom),
            (0, 0, 255),
            2
        )


    # ========================================================
    # RIM
    # ========================================================

    rim_center_y = None
    rim_left = None
    rim_right = None

    if rim:

        rx1, ry1, rx2, ry2 = rim["box"]

        rim_center_y = (ry1 + ry2) // 2

        rim_left = rx1
        rim_right = rx2


        cv2.rectangle(
            frame,
            (rx1, ry1),
            (rx2, ry2),
            (0, 165, 255),
            2
        )


        cv2.line(
            frame,
            (rx1, rim_center_y),
            (rx2, rim_center_y),
            (0, 165, 255),
            2
        )


    # ========================================================
    # POSE DETECTION
    # ========================================================

    # GPU POSE DETECTION
    pose_results = pose_model(
        frame,
        conf=POSE_CONF,
        device=DEVICE,
        quantize="fp16",
        imgsz=640,
        verbose=False
    )


    left_wrist = None
    right_wrist = None

    left_elbow = None
    right_elbow = None

    left_shoulder = None
    right_shoulder = None


    # ========================================================
    # MATCH POSE TO PLAYER
    # ========================================================

    for pose_result in pose_results:

        if pose_result.keypoints is None:
            continue

        if len(pose_result.keypoints.xy) == 0:
            continue


        best_pose = None
        best_overlap = 0


        if player:

            px1, py1, px2, py2 = player["box"]

            player_area = (
                (px2 - px1)
                *
                (py2 - py1)
            )


            for person_index in range(
                len(pose_result.keypoints.xy)
            ):

                keypoints = (
                    pose_result.keypoints.xy[
                        person_index
                    ]
                )


                pose_x1 = float(
                    keypoints[:, 0].min()
                )

                pose_y1 = float(
                    keypoints[:, 1].min()
                )

                pose_x2 = float(
                    keypoints[:, 0].max()
                )

                pose_y2 = float(
                    keypoints[:, 1].max()
                )


                ix1 = max(px1, pose_x1)
                iy1 = max(py1, pose_y1)

                ix2 = min(px2, pose_x2)
                iy2 = min(py2, pose_y2)


                if ix2 <= ix1 or iy2 <= iy1:
                    continue


                intersection = (
                    (ix2 - ix1)
                    *
                    (iy2 - iy1)
                )


                overlap = (
                    intersection
                    /
                    max(player_area, 1)
                )


                if overlap > best_overlap:

                    best_overlap = overlap
                    best_pose = person_index


        # ====================================================
        # GET PLAYER KEYPOINTS
        # ====================================================

        if best_pose is not None:

            keypoints = pose_result.keypoints.xy[
                best_pose
            ]


            confidences = (
                pose_result.keypoints.conf[
                    best_pose
                ]
                if pose_result.keypoints.conf is not None
                else None
            )


            def get_keypoint(index):

                if index >= len(keypoints):
                    return None


                if confidences is not None:

                    if float(
                        confidences[index]
                    ) < POSE_CONF:

                        return None


                return (
                    int(keypoints[index][0]),
                    int(keypoints[index][1])
                )


            # COCO keypoints

            left_shoulder = get_keypoint(5)
            right_shoulder = get_keypoint(6)

            left_elbow = get_keypoint(7)
            right_elbow = get_keypoint(8)

            left_wrist = get_keypoint(9)
            right_wrist = get_keypoint(10)


            # =================================================
            # UPDATE LAST KNOWN WRISTS
            # =================================================

            if left_wrist is not None:

                last_left_wrist = left_wrist


            if right_wrist is not None:

                last_right_wrist = right_wrist


            # =================================================
            # DRAW POSE
            # =================================================

            for point in [
                left_shoulder,
                right_shoulder,
                left_elbow,
                right_elbow,
                left_wrist,
                right_wrist
            ]:

                if point is not None:

                    cv2.circle(
                        frame,
                        point,
                        6,
                        (0, 255, 255),
                        -1
                    )


            # Left arm

            if (
                left_shoulder is not None
                and
                left_elbow is not None
            ):

                cv2.line(
                    frame,
                    left_shoulder,
                    left_elbow,
                    (0, 255, 255),
                    3
                )


            if (
                left_elbow is not None
                and
                left_wrist is not None
            ):

                cv2.line(
                    frame,
                    left_elbow,
                    left_wrist,
                    (0, 255, 255),
                    3
                )


            # Right arm

            if (
                right_shoulder is not None
                and
                right_elbow is not None
            ):

                cv2.line(
                    frame,
                    right_shoulder,
                    right_elbow,
                    (0, 255, 255),
                    3
                )


            if (
                right_elbow is not None
                and
                right_wrist is not None
            ):

                cv2.line(
                    frame,
                    right_elbow,
                    right_wrist,
                    (0, 255, 255),
                    3
                )


    # ========================================================
    # BASKETBALL
    # ========================================================

    if basketball:

        ball_center = basketball["center"]

        ball_x, ball_y = ball_center

        x1, y1, x2, y2 = basketball["box"]


        cv2.rectangle(
            frame,
            (x1, y1),
            (x2, y2),
            (0, 255, 0),
            2
        )


        cv2.putText(
            frame,
            f"Basketball {basketball['conf']:.2f}",
            (x1, y1 - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (0, 255, 0),
            2
        )


        cv2.circle(
            frame,
            ball_center,
            5,
            (0, 0, 255),
            -1
        )


        # ====================================================
        # USE LAST KNOWN WRIST IF CURRENT FRAME MISSES IT
        # ====================================================

        usable_left_wrist = (
            left_wrist
            if left_wrist is not None
            else last_left_wrist
        )


        usable_right_wrist = (
            right_wrist
            if right_wrist is not None
            else last_right_wrist
        )


        # ====================================================
        # BALL → WRIST DISTANCES
        # ====================================================

        left_distance = None
        right_distance = None


        if usable_left_wrist is not None:

            left_distance = distance(
                ball_center,
                usable_left_wrist
            )


        if usable_right_wrist is not None:

            right_distance = distance(
                ball_center,
                usable_right_wrist
            )


        # ====================================================
        # SHOT START DETECTION
        # ====================================================

        if not shot_started:

            crossed_upper_bound = False


            if (
                upper_bound is not None
                and
                previous_ball_center is not None
            ):

                if (
                    previous_ball_center[1]
                    >= upper_bound
                    and
                    ball_y
                    < upper_bound
                ):

                    crossed_upper_bound = True


            # ------------------------------------------------
            # FIND CLOSEST WRIST
            # ------------------------------------------------

            closest_distance = None
            closest_side = None


            if left_distance is not None:

                closest_distance = left_distance
                closest_side = "left"


            if (
                right_distance is not None
                and
                (
                    closest_distance is None
                    or
                    right_distance < closest_distance
                )
            ):

                closest_distance = right_distance
                closest_side = "right"


            # ------------------------------------------------
            # CREATE RELEASE CANDIDATE
            # ------------------------------------------------

            if (
                crossed_upper_bound
                and
                closest_distance is not None
                and
                closest_distance
                <= MAX_BALL_WRIST_DISTANCE
            ):

                potential_shot = True

                shooting_wrist = closest_side

                ball_history.clear()

                left_wrist_history.clear()
                right_wrist_history.clear()

                ball_left_distance_history.clear()
                ball_right_distance_history.clear()


            # ------------------------------------------------
            # RECORD RELEASE WINDOW
            # ------------------------------------------------

            if potential_shot:

                ball_history.append(
                    ball_center
                )


                left_wrist_history.append(
                    usable_left_wrist
                )

                right_wrist_history.append(
                    usable_right_wrist
                )


                if left_distance is not None:

                    ball_left_distance_history.append(
                        left_distance
                    )


                if right_distance is not None:

                    ball_right_distance_history.append(
                        right_distance
                    )


                # =================================================
                # RELEASE ANALYSIS
                # =================================================

                if len(ball_history) >= RELEASE_FRAMES:

                    if shooting_wrist == "left":

                        distances = list(
                            ball_left_distance_history
                        )

                    else:

                        distances = list(
                            ball_right_distance_history
                        )


                    # ---------------------------------------------
                    # BALL MOVEMENT
                    # ---------------------------------------------

                    ball_start = ball_history[0]

                    ball_end = ball_history[-1]


                    ball_upward = (
                        ball_start[1]
                        -
                        ball_end[1]
                    )


                    ball_moving_up = (
                        ball_upward
                        >= MIN_BALL_UPWARD_MOVEMENT
                    )


                    # ---------------------------------------------
                    # BALL/WRIST SEPARATION
                    # ---------------------------------------------

                    ball_separated = False
                    distance_increasing = False


                    if len(distances) >= 3:

                        separation = (
                            distances[-1]
                            -
                            distances[0]
                        )


                        ball_separated = (
                            separation
                            >=
                            MIN_RELEASE_SEPARATION
                        )


                        distance_increasing = (
                            distances[-1]
                            >
                            distances[-2]
                            and
                            distances[-2]
                            >
                            distances[-3]
                        )


                    # ---------------------------------------------
                    # RELEASE CONFIRMATION
                    # ---------------------------------------------

                    if (
                        ball_moving_up
                        and
                        (
                            ball_separated
                            or
                            distance_increasing
                        )
                    ):

                        shot_started = True

                        passed_net = False

                        net_crossed_frames = 0

                        shot_result_recorded = False


                        # -----------------------------------------
                        # START VIDEO-TIME TRACKING
                        # -----------------------------------------

                        shot_start_frame = frame_number

                        shot_end_frame = None

                        reset_apex_state()

                        time_to_apex = None
                        shot_duration = None


                        # COUNT SHOT ATTEMPT

                        shots += 1


                        trajectory = list(
                            ball_history
                        )


                        # Initialize apex from the
                        # current release trajectory

                        for i, point in enumerate(
                            trajectory
                        ):

                            if (
                                highest_ball_y is None
                                or
                                point[1] < highest_ball_y
                            ):

                                highest_ball_y = point[1]

                                highest_ball_frame = (
                                    shot_start_frame
                                    -
                                    len(trajectory)
                                    +
                                    i
                                    +
                                    1
                                )

                                highest_ball_point = point


                        clear_release_state()


            # =================================================
            # RELEASE WINDOW EXPIRED
            # =================================================

            if (
                potential_shot
                and
                len(ball_history)
                >= MAX_RELEASE_WINDOW
            ):

                clear_release_state()


        # ========================================================
        # SHOT TRACKING
        # ========================================================

        if shot_started:

            trajectory.append(
                ball_center
            )


            # ====================================================
            # APEX TRACKING
            # ====================================================

            if not apex_confirmed:

                # Ball is still going higher

                if (
                    highest_ball_y is None
                    or
                    ball_y < highest_ball_y
                ):

                    highest_ball_y = ball_y

                    highest_ball_frame = frame_number

                    highest_ball_point = ball_center

                    downward_frames = 0


                # Ball has moved downward relative
                # to the previous frame

                elif (
                    previous_ball_center is not None
                    and
                    ball_y > previous_ball_center[1]
                ):

                    downward_frames += 1


                else:

                    downward_frames = 0


                # Confirm apex only after the ball has
                # consistently started moving downward

                if (
                    downward_frames
                    >=
                    APEX_CONFIRMATION_FRAMES
                ):

                    apex_confirmed = True

                    apex_frame = highest_ball_frame

                    apex_point = highest_ball_point


                    time_to_apex = (
                        apex_frame
                        -
                        shot_start_frame
                    ) / fps


            # ====================================================
            # MAKE DETECTION
            # ====================================================

            if (
                not shot_result_recorded
                and
                rim_center_y is not None
                and
                rim_left is not None
                and
                rim_right is not None
                and
                previous_ball_center is not None
            ):

                previous_ball_y = previous_ball_center[1]


                ball_moving_down = (
                    ball_y > previous_ball_y
                )


                ball_reached_rim = (
                    ball_y >= rim_center_y
                )


                ball_inside_rim = (
                    ball_x >= rim_left
                    and
                    ball_x <= rim_right
                )


                if (
                    ball_moving_down
                    and
                    ball_reached_rim
                    and
                    ball_inside_rim
                ):

                    makes += 1

                    shot_result_recorded = True


            # ====================================================
            # BALL PASSES ABOVE NET
            # ====================================================

            if net_bottom is not None:

                if ball_y < net_bottom:

                    passed_net = True

                    net_crossed_frames = 0


                if passed_net:

                    if ball_y > net_bottom:

                        net_crossed_frames += 1

                    else:

                        net_crossed_frames = 0


                    # =================================================
                    # END SHOT
                    # =================================================

                    if (
                        net_crossed_frames
                        >=
                        NET_RESET_FRAMES
                    ):

                        # ---------------------------------------------
                        # FINALIZE SHOT TIMING
                        # ---------------------------------------------

                        shot_end_frame = frame_number


                        if shot_start_frame is not None:

                            shot_duration = (
                                shot_end_frame
                                -
                                shot_start_frame
                            ) / fps


                        # If shot has not already been classified
                        # as a make, classify it as a miss.

                        if not shot_result_recorded:

                            misses += 1

                            shot_result_recorded = True


                        # ------------------------------------------------
                        # END SHOT
                        # ------------------------------------------------

                        shot_started = False

                        passed_net = False

                        net_crossed_frames = 0

                        trajectory = []

                        # IMPORTANT:
                        # Clear the apex marker when the shot ends.
                        apex_frame = None
                        apex_point = None
                        apex_confirmed = False

                        clear_release_state()


        previous_ball_center = ball_center


        # ====================================================
        # DRAW APEX MARKER
        # ====================================================

        # Only draw the X while the current shot is active.
        # It disappears immediately when the shot ends.

        if (
            shot_started
            and
            apex_confirmed
            and
            apex_point is not None
        ):

            ax, ay = apex_point

            cv2.drawMarker(
                frame,
                (ax, ay),
                (0, 0, 255),
                markerType=cv2.MARKER_TILTED_CROSS,
                markerSize=24,
                thickness=4
            )


    # ========================================================
    # DRAW TRAJECTORY
    # ========================================================

    if shot_started:

        for i, point in enumerate(
            trajectory
        ):

            cv2.circle(
                frame,
                point,
                4,
                (255, 0, 0),
                -1
            )


            if i > 0:

                cv2.line(
                    frame,
                    trajectory[i - 1],
                    point,
                    (255, 0, 0),
                    2
                )


        # Draw ONE apex marker on top of trajectory.

        if (
            apex_confirmed
            and
            apex_point is not None
        ):

            cv2.drawMarker(
                frame,
                apex_point,
                (0, 0, 255),
                markerType=cv2.MARKER_TILTED_CROSS,
                markerSize=24,
                thickness=4
            )


    # ========================================================
    # CALCULATE FG%
    # ========================================================

    if shots > 0:

        fg_percentage = (
            makes
            /
            shots
            *
            100
        )

    else:

        fg_percentage = 0


    # ========================================================
    # STATUS
    # ========================================================

    if shot_started:

        status = "SHOT TRACKING"

    elif potential_shot:

        status = "RELEASE CANDIDATE"

    else:

        status = "WAITING"


    # ========================================================
    # LARGE STATISTICS OVERLAY
    # ========================================================

    overlay_x = 20
    overlay_y = 20

    overlay_width = 390
    overlay_height = 315


    overlay = frame.copy()

    cv2.rectangle(
        overlay,
        (
            overlay_x,
            overlay_y
        ),
        (
            overlay_x + overlay_width,
            overlay_y + overlay_height
        ),
        (20, 20, 20),
        -1
    )


    frame = cv2.addWeighted(
        overlay,
        0.82,
        frame,
        0.18,
        0
    )


    # Border

    cv2.rectangle(
        frame,
        (
            overlay_x,
            overlay_y
        ),
        (
            overlay_x + overlay_width,
            overlay_y + overlay_height
        ),
        (255, 255, 255),
        2
    )


    # ========================================================
    # TITLE
    # ========================================================

    cv2.putText(
        frame,
        "FOLLOW THROUGH",
        (
            overlay_x + 20,
            overlay_y + 35
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.85,
        (255, 255, 255),
        2
    )


    # ========================================================
    # STATUS
    # ========================================================

    cv2.putText(
        frame,
        status,
        (
            overlay_x + 20,
            overlay_y + 68
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (0, 255, 255),
        2
    )


    # ========================================================
    # DIVIDER
    # ========================================================

    cv2.line(
        frame,
        (
            overlay_x + 20,
            overlay_y + 82
        ),
        (
            overlay_x + overlay_width - 20,
            overlay_y + 82
        ),
        (150, 150, 150),
        1
    )


    # ========================================================
    # SHOTS
    # ========================================================

    cv2.putText(
        frame,
        f"SHOTS        {shots}",
        (
            overlay_x + 25,
            overlay_y + 120
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.70,
        (255, 255, 255),
        2
    )


    # ========================================================
    # MAKES
    # ========================================================

    cv2.putText(
        frame,
        f"MAKES        {makes}",
        (
            overlay_x + 25,
            overlay_y + 155
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.70,
        (0, 255, 0),
        2
    )


    # ========================================================
    # MISSES
    # ========================================================

    cv2.putText(
        frame,
        f"MISSES       {misses}",
        (
            overlay_x + 25,
            overlay_y + 190
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.70,
        (0, 100, 255),
        2
    )


    # ========================================================
    # FG%
    # ========================================================

    cv2.putText(
        frame,
        f"FG%          {fg_percentage:.1f}%",
        (
            overlay_x + 25,
            overlay_y + 225
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.70,
        (255, 255, 0),
        2
    )


    # ========================================================
    # TIME TO APEX
    # ========================================================

    if time_to_apex is not None:

        apex_text = f"{time_to_apex:.2f} s"

    else:

        apex_text = "--"


    cv2.putText(
        frame,
        f"TIME TO APEX {apex_text}",
        (
            overlay_x + 25,
            overlay_y + 260
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (255, 255, 255),
        2
    )


    # ========================================================
    # SHOT DURATION
    # ========================================================

    if shot_duration is not None:

        duration_text = f"{shot_duration:.2f} s"

    else:

        duration_text = "--"


    cv2.putText(
        frame,
        f"SHOT DURATION {duration_text}",
        (
            overlay_x + 25,
            overlay_y + 295
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (255, 255, 255),
        2
    )


    # ========================================================
    # DISPLAY
    # ========================================================

    cv2.imshow(
        "Follow Through",
        frame
    )


    key = cv2.waitKey(1) & 0xFF


    if key == ord("q"):
        break


    # ========================================================
    # MANUAL RESET
    # ========================================================

    if key == ord("r"):

        shot_started = False

        passed_net = False

        net_crossed_frames = 0

        trajectory = []

        clear_release_state()

        previous_ball_center = None

        last_left_wrist = None
        last_right_wrist = None

        shot_result_recorded = False

        shot_start_frame = None
        shot_end_frame = None

        time_to_apex = None
        shot_duration = None

        reset_apex_state()


cap.release()

cv2.destroyAllWindows()