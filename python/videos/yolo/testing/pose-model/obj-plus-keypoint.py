import cv2
import numpy as np
from ultralytics import YOLO
from collections import deque
import math
import time
import threading
import queue
import torch


# ============================================================
# HARDWARE DETECTION
# ============================================================

# Deployment target (ECS/Fargate) isn't guaranteed to have a GPU —
# Fargate specifically never does (EC2-backed GPU capacity
# providers are the only way to get one on ECS), and even when a
# GPU IS available on EC2, the exact card isn't guaranteed to stay
# the same across deploys. So: detect what's actually there at
# startup and adapt, rather than assuming CUDA exists.

GPU_AVAILABLE = torch.cuda.is_available()

DEVICE = 0 if GPU_AVAILABLE else "cpu"

# fp16 is a real, large win on GPU tensor cores. On CPU it's a
# coin flip at best (most x86/ARM CPUs just upcast fp16 back to
# fp32 internally, so you pay conversion overhead for nothing) —
# so only request it when a GPU is actually present. This keeps
# one codebase correct on whichever ECS launch type it lands on.
INFERENCE_QUANTIZE = "fp16" if GPU_AVAILABLE else "fp32"


# ============================================================
# SETUP
# ============================================================

cap = cv2.VideoCapture("python/videos/train3/burkelake8.MOV")

# Fail loudly here instead of silently — OpenCV doesn't raise an
# exception for a bad path, it just returns a capture object that's
# never "opened", and every .read() after that quietly returns
# (False, None) forever. Left unchecked, that looks exactly like a
# clean, silent exit with zero error output, right after startup —
# a real, painful-to-diagnose failure mode this catches immediately
# instead of one that emerges via the main loop later.
if not cap.isOpened():

    raise RuntimeError(
        "Failed to open video source — check that the path above "
        "is correct relative to wherever this script is actually "
        "being run from. This is the first thing to check after "
        "moving files/folders around."
    )

# Swapped to the TensorRT engines exported for this 3090. NOTE: this
# breaks the CPU/no-GPU fallback path that GPU_AVAILABLE was built
# for earlier — a .engine file requires an NVIDIA GPU (the specific
# one it was compiled for) just to load, let alone run. That's fine
# while we're working locally on the 3090, but before this goes back
# toward ECS/Fargate with unpinned hardware, this needs to either
# fall back to the .pt files when no matching GPU is present, or the
# deployment target needs to be locked to hardware these engines
# actually match.
model = YOLO("python/runs/detect/train/weights/best.engine")

court_model = YOLO("python/runs/pose/train-MuSGD-1/weights/best.engine")

pose_model = YOLO("python/yolo26n-pose.engine")

# .to("cuda:0") confirmed (via real runtime testing) to not be a
# valid call on a TensorRT engine — a *.pt PyTorch model is
# required for that method; exported formats like .engine only
# support predict/val, with device passed directly on each
# inference call instead (already done throughout this file via
# device=DEVICE on every model.track()/court_model()/pose_model()
# call). No longer calling .to() at all now that this is settled —
# it was never going to do anything useful for an engine model.

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

# Separate from trajectory/ball_history, which exist for DETECTION
# logic and have their own semantics (cleared/rebuilt at specific
# points that don't line up with what looks continuous on screen).
# This one continuously accumulates points across the whole
# potential_shot -> shot_started transition with no rebuild or
# source-switch at any point, so the drawn line can never have a
# seam at the confirmation moment. Cleared only at true reset
# points: a candidate getting rejected, a shot fully ending, or a
# manual reset — never touched by clear_release_state() itself,
# since that's called both on rejection AND right after a
# successful confirmation, and only the former should clear this.
visual_ball_trail = []

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
# PER-CATEGORY SHOT STATISTICS
# ============================================================

CATEGORY_ORDER = [
    "LAY_UP",
    "CLS_RNG",
    "MID_RNG",
    "HS_3PT",
    "NCAA_3PT",
    "NBA_3PT",
]

CATEGORY_LABELS = {
    "LAY_UP": "LAYUP",
    "CLS_RNG": "CLOSE",
    "MID_RNG": "MID RANGE",
    "HS_3PT": "HS 3PT",
    "NCAA_3PT": "NCAA 3PT",
    "NBA_3PT": "NBA 3PT",
}

category_stats = {
    name: {"makes": 0, "misses": 0}
    for name in CATEGORY_ORDER
}


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

shot_distance = None
shot_designation = None


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
# LAST KNOWN WRISTS / POSE POINTS
# ============================================================

last_left_wrist = None
last_right_wrist = None

last_left_elbow = None
last_right_elbow = None

last_left_shoulder = None
last_right_shoulder = None

# Snapshot of the previous pose update, used to interpolate the
# drawn skeleton smoothly across the skipped frames instead of
# holding it frozen then jumping on the next real pose inference —
# purely cosmetic, the same "bounce" fix as the court skeleton.
# usable_left_wrist/usable_right_wrist (used for actual shot-start
# detection) always use last_left_wrist/last_right_wrist directly,
# never this interpolated draw position.
pose_prev_left_wrist = None
pose_prev_right_wrist = None
pose_prev_left_elbow = None
pose_prev_right_elbow = None
pose_prev_left_shoulder = None
pose_prev_right_shoulder = None
pose_last_update_frame = None
pose_prev_update_gap = 1  # corrected to the real interval on first pose update


# ============================================================
# THRESHOLDS
# ============================================================

DETECTION_CONF = 0.8
POSE_CONF = 0.1

# Ball must cross upper 1/80 of player
UPPER_BODY_RATIO = 0.0125

# A much wider zone than UPPER_BODY_RATIO — purely a lead-time
# signal to switch pose to full frequency BEFORE the precise
# release gate needs accurate wrist data, not a detection threshold
# itself. Computed only from ball position and the player's box
# (detect model output), never from pose, so it's always fresh
# regardless of pose's own schedule — that's what breaks the
# chicken-and-egg problem where potential_shot (wrist-distance
# dependent) can't reliably trigger pose freshness on its own,
# since the wrist reading it needs might still be stale at that
# exact moment. Entering this wider zone gives pose several real
# frames to catch up before the precise gate evaluates.
EARLY_POSE_TRIGGER_RATIO = 0.20

# Maximum distance between ball and wrist to start, expressed as a
# fraction of the player's OWN box height rather than a fixed pixel
# count. A fixed pixel value can't simultaneously be tight enough
# to exclude dribbles/self-passes and loose enough to catch every
# real release, because wrist localization error scales with how
# large the player appears in frame — the same absolute pixel
# threshold is too tight for a close-up shot and too loose for a
# distant one. Scaling by player_height adapts per-shot instead.
# Starting value; needs real tuning against your footage.
MAX_BALL_WRIST_RATIO = 0.20

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
# ROBUSTNESS THRESHOLDS (SHOT DETECTION HARDENING)
# ============================================================

# Lower confidence accepted for the basketball ONLY when the
# detection's tracker ID matches the ball we are already
# following — lets us survive motion blur without opening the
# door to arbitrary low-confidence junk becoming "the ball".
CONTINUATION_CONF = 0.5

# How many consecutive frames we're willing to "coast" the ball
# forward using its last known velocity when detection drops out
# mid-shot (occlusion by rim/net/defender, motion blur, etc.)
MAX_BALL_COAST_FRAMES = 6

# Frames to ignore new release candidates right after a shot ends,
# so grabbing a rebound immediately after a miss can't be
# mistaken for the start of a brand new shot.
SHOT_COOLDOWN_FRAMES = 12

# Hard ceiling (seconds) on how long a shot is allowed to stay
# "active" before we force it to resolve. Prevents the tracker
# from getting permanently stuck if the net/rim is lost mid-flight.
MAX_SHOT_DURATION_SEC = 4.0

# Real-time ceiling (seconds) on the release evaluation window,
# measured in actual video time rather than count of successful
# ball detections, so sparse detections can't stretch it out.
MAX_RELEASE_WINDOW_SEC = 0.6

# How far below the rim (in pixels) the ball must be to count as
# "clearly past the hoop" for the net-independent fallback
# shot-end check.
RIM_FALLBACK_MARGIN = 40

# Consecutive frames the ball must stay below that margin before
# the fallback end triggers (used when the net isn't visible).
RIM_FALLBACK_FRAMES = 8

# Frames to wait after a make condition first triggers before
# finalizing it, so a ball that briefly disappears behind the net
# (normal on a make) can be told apart from one that bounces out.
MAKE_SETTLE_FRAMES = 6

# Shots this close to the rim (feet) get relaxed release
# thresholds, since dunks/layups have very little separation and
# upward travel between the wrist and the ball before release.
CLOSE_RANGE_FT = 6.0
CLOSE_RANGE_UPWARD_SCALE = 0.5
CLOSE_RANGE_SEPARATION_SCALE = 0.5

# ------------------------------------------------------------
# RELEASE TREND QUALITY (discriminates a real release from
# incidental ball/hand separation, e.g. a dribble or self-pass,
# without leaning on exact wrist pixel placement)
# ------------------------------------------------------------

# Small tolerance for frame-to-frame jitter in the ball-wrist
# distance signal — not a hard zero, since pose/detection noise
# alone can produce tiny negative deltas even during a genuine,
# real separation.
REVERSAL_TOLERANCE = 5

# A real release shows a distinct "snap" — separation grows
# fastest in the first frame or two right after the ball leaves
# the hand. Minimum required growth in that opening window. Reuses
# CLOSE_RANGE_SEPARATION_SCALE for the close-range case, same as
# MIN_RELEASE_SEPARATION, so layups/dunks aren't penalized for
# having very little room to show that snap in.
MIN_RELEASE_ACCEL = 8

# ============================================================
# PERFORMANCE / REAL-TIME PLAYBACK
# ============================================================

# The ball moves fast and every shot-timing number in this file
# (time_to_apex, shot_duration) is derived from frame_number, so
# the primary detector (ball/net/player/rim) always runs every
# frame. Court calibration changes slowly and has a "reuse the
# last known value" fallback, so it's still safe to amortize.
#
# Pose has no periodic interval anymore — its run frequency is
# entirely state-driven now (see run_pose_model_this_frame in the
# main loop): off outside the ball_near_release_zone -> apex_
# confirmed window, on every frame within it. There's no fixed
# schedule left to name here.
COURT_CALIBRATION_INTERVAL = 10   # frames between court-model inferences

# Inference resolution, per model. DETECT_IMGSZ stays full-size —
# the ball is small and fast, and this is the one place resolution
# genuinely buys detection range.
#
# COURT_IMGSZ reverted to 640 from 1280 — the 4x pixel area wasn't
# earning its cost; court keypoints are large, slow features that
# don't need that much resolution, and it's already amortized by
# COURT_CALIBRATION_INTERVAL besides.
#
# POSE_IMGSZ dropped to 320 as part of switching pose to a
# crop-to-player workflow (see POSE DETECTION in the main loop):
# pose_model now runs on a tight crop around the player's box
# instead of the full frame. That crop is resized to POSE_IMGSZ
# same as before, but since the player now fills most of that
# crop instead of being a small region of a full frame, the
# EFFECTIVE resolution on the player is higher at 320 post-crop
# than it was at 480 pre-crop — this is a real compute cut
# (imgsz cost scales roughly with the square, so 480->320 is
# close to a 2.25x reduction), not just a scheduling change.
DETECT_IMGSZ = 640
COURT_IMGSZ = 640
POSE_IMGSZ = 480

# Fixed pixel crop size around the player, centered on their box.
# NOT sized off the player's own (constantly changing) bounding
# box — that was the first version, and it meant the crop's pixel
# dimensions varied almost every frame. cuDNN often does a one-time
# "which kernel algorithm is fastest for this exact input shape"
# search the first time it sees a new tensor shape; with a
# constantly-changing crop size that search was likely re-triggering
# often instead of hitting a warm cache, eating the compute savings
# the smaller POSE_IMGSZ should have bought. A fixed crop size keeps
# the tensor shape identical call to call. Biased slightly upward
# (see the y-offset in the main loop) since a shooting motion raises
# the arms well above the head — cut that too tight and the wrist/
# elbow can fall outside the crop right when it matters most. These
# are generous starting sizes; shrink them once you've confirmed
# visually that the crop reliably contains the player at your
# camera's typical distance.
POSE_CROP_WIDTH = 384
POSE_CROP_HEIGHT = 480
POSE_CROP_UPWARD_BIAS_RATIO = 0.15  # shifts crop center up, as a fraction of the player's box height

# Precision: current Ultralytics uses `quantize` (accepting "fp16",
# "fp32", "int8", etc.) as the canonical precision argument for
# both export() and predict()/track() calls; `half=True` is only
# kept around as a deprecated backward-compat alias. INFERENCE_QUANTIZE
# is set above based on GPU_AVAILABLE so this stays correct whether
# or not a GPU is present at runtime.

# How often (seconds of wall-clock time) to print the benchmark
# table to the console.
PERF_LOG_INTERVAL_SEC = 1.0

# Frame queue depth for the threaded reader.
FRAME_QUEUE_SIZE = 2

# Playback pacing ("ceiling"). None = pace to the source video's
# own fps (recommended — keeps the shot-timing math and the
# on-screen playback speed in agreement). Set a number (e.g. 60.0)
# to force a specific rate regardless of source fps.
TARGET_PLAYBACK_FPS = None

# Local dev/debug visibility only. In the real deployment target
# (a live feed, no local GUI, annotated frames funneled to a
# frontend instead), this should be False — imshow and the
# keyboard-check call were both purely about the local debug
# window's existence, not anything the detection/annotation
# pipeline itself needs. Measured combined cost on this machine:
# ~11ms/frame (imshow ~2ms + the key check ~9ms) that a headless
# deployment pays for nothing. NOTE: the 'q'-to-quit and
# 'r'-to-reset keyboard controls only work while this is True —
# they're inherently tied to having a window capturing keyboard
# focus. A headless deployment needs its own stop/reset mechanism
# (e.g. a signal handler, or control coming from whatever's
# consuming the funneled frames) — that's a separate piece of work
# this flag doesn't provide by itself.
SHOW_DISPLAY_WINDOW = True


# ============================================================
# THEME COLORS (BGR) — black / orange / grey
# ============================================================

THEME_BG = (16, 16, 16)              # near-black panel fill
THEME_BORDER = (85, 85, 85)          # grey border
THEME_DIVIDER = (55, 55, 55)         # darker grey divider
THEME_ACCENT = (0, 140, 255)         # orange accent
THEME_ACCENT_SOFT = (0, 95, 175)     # muted/darker orange
THEME_TEXT_PRIMARY = (240, 240, 240) # near-white text
THEME_TEXT_SECONDARY = (165, 165, 165)  # grey text (labels / misses)
THEME_TEXT_MUTED = (110, 110, 110)   # dim grey
THEME_DETECT_GREY = (190, 190, 190)  # light structural grey for detection outlines


# ============================================================
# COURT KEYPOINTS / DISTANCE CALIBRATION
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


COURT_DETECTION_CONF = 0.05
COURT_KEYPOINT_CONF = 0.50
SMOOTHING_ALPHA = 0.15


COURT_POINTS = np.array([
    [-6.0, -13.9],   # FT-Right
    [ 0.0, -13.9],   # FT-Middle
    [ 6.0, -13.9],   # FT-Left
    [ 0.0, -19.9],   # TopKey
    [-6.0,   5.1],   # Base-Right
    [ 6.0,   5.1],   # Base-Left
    [ 0.0,   5.1],   # Base-Middle
], dtype=np.float32)


# Rim center is the origin of the calibrated court plane.
RIM_COURT_POINT = np.array(
    [[0.0, 0.0]],
    dtype=np.float32
)


homography = None
last_court_points = None

# Persists across frames (not just inside the calibration block) so
# the last known court skeleton can still be drawn on frames where
# the court model is skipped for performance.
current_court_valid_points = np.zeros(7, dtype=bool)

# Snapshot of the state BEFORE the most recent successful
# calibration, used to interpolate the drawn skeleton smoothly
# across the skipped frames instead of holding it frozen then
# jumping to the new position — that jump is what read as
# "bouncing". Purely cosmetic: homography/distance math always
# uses last_court_points directly, never the interpolated draw
# position.
court_points_prev = None
court_points_prev_valid = np.zeros(7, dtype=bool)
court_last_calibration_frame = None
court_prev_calibration_gap = COURT_CALIBRATION_INTERVAL


# ============================================================
# ROBUSTNESS STATE
# ============================================================

last_ball_track_id = None
last_real_ball_center = None
ball_velocity = (0.0, 0.0)
ball_coast_frames = 0

previous_player_box = None
player_miss_frames = 0

shot_cooldown_counter = 0
potential_shot_start_frame = None

pending_make = False
pending_make_frame = None

below_rim_frames = 0

player_distance_history = deque(maxlen=5)


# ============================================================
# PERFORMANCE TRACKING STATE
# ============================================================

stage_timings = {
    "court_model": deque(maxlen=120),
    "detection_model": deque(maxlen=120),
    "pose_model": deque(maxlen=120),
    "pose_ran_flag": deque(maxlen=120),
    "overlay_draw": deque(maxlen=120),
    "imshow_display": deque(maxlen=120),
    "frame_logic": deque(maxlen=120),
    "logic_selection_player": deque(maxlen=120),
    "logic_net_rim": deque(maxlen=120),
    "logic_pose_match_draw": deque(maxlen=120),
    "logic_release_evaluation": deque(maxlen=120),
    "logic_trajectory_draw": deque(maxlen=120),
    "logic_ball_shot": deque(maxlen=120),
    "waitkey_delay": deque(maxlen=120),
    "pace_sleep": deque(maxlen=120),
    "frame_total": deque(maxlen=120),
}

last_perf_log_time = time.perf_counter()


# ============================================================
# THREADED FRAME READER
# ============================================================

# Video decode (cap.read()) is a real cost on its own for
# compressed formats like .MOV, and it was previously fully
# serialized in front of three GPU inference calls every frame.
# Reading on a background thread lets the next frame decode while
# the current one is still being processed/displayed. The queue
# uses a BLOCKING put (no drops), so frame_number stays an exact
# 1:1 match with video frames and every shot-timing calculation
# in this file stays exactly as accurate as before.

class FrameReader:

    def __init__(self, capture, queue_size=FRAME_QUEUE_SIZE):

        self.capture = capture
        self.frame_queue = queue.Queue(maxsize=queue_size)
        self.stopped = False

        self.thread = threading.Thread(
            target=self._read_loop,
            daemon=True
        )


    def start(self):

        self.thread.start()

        return self


    def _read_loop(self):

        while not self.stopped:

            success, frame = self.capture.read()

            if not success:

                self.frame_queue.put((False, None))
                break


            self.frame_queue.put((True, frame))


    def read(self):

        return self.frame_queue.get()


    def stop(self):

        self.stopped = True


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def distance(point1, point2):

    return math.sqrt(
        (point1[0] - point2[0]) ** 2
        +
        (point1[1] - point2[1]) ** 2
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

    return math.sqrt(
        dx ** 2
        +
        dy ** 2
    )


def get_shot_designation(shot_distance):

    if shot_distance is None:
        return None

    if shot_distance >= 19.9 and shot_distance <= 21.9:
        return "HS_3PT"

    if shot_distance >= 22.0 and shot_distance <= 22.9:
        return "NCAA_3PT"

    if shot_distance >= 23.0:
        return "NBA_3PT"

    if shot_distance >= 10.0:
        return "MID_RNG"

    if shot_distance >= 5.0:
        return "CLS_RNG"

    return "LAY_UP"


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


def select_best_by_conf(candidates):

    if not candidates:
        return None

    return max(
        candidates,
        key=lambda item: item["conf"]
    )


def select_basketball_detection(candidates, last_track_id):

    if not candidates:
        return None

    # Prefer whichever candidate carries the tracker ID we were
    # already following — this is what lets a lower-confidence,
    # motion-blurred detection still count as "the ball".
    if last_track_id is not None:

        for item in candidates:

            if (
                item["id"] == last_track_id
                and item["conf"] >= CONTINUATION_CONF
            ):

                return item


    strong_candidates = [
        item for item in candidates
        if item["conf"] >= DETECTION_CONF
    ]

    if strong_candidates:

        return max(
            strong_candidates,
            key=lambda item: item["conf"]
        )

    return None


def select_player_detection(candidates, previous_box):

    if not candidates:
        return None

    if previous_box is None:

        return max(
            candidates,
            key=lambda item: item["conf"]
        )


    px1, py1, px2, py2 = previous_box

    prev_center = (
        (px1 + px2) / 2,
        (py1 + py2) / 2
    )


    def box_center(item):

        x1, y1, x2, y2 = item["box"]

        return (
            (x1 + x2) / 2,
            (y1 + y2) / 2
        )


    return min(
        candidates,
        key=lambda item: distance(box_center(item), prev_center)
    )


def interpolate_joint(prev_point, target_point, t):

    # Linear interpolation between a joint's previous drawn
    # position and its latest known position, used to smooth the
    # court skeleton and pose skeleton across frames where their
    # models were skipped for performance. Purely cosmetic — never
    # used for any actual detection logic.

    if target_point is None:
        return None

    if prev_point is None or t >= 1.0:
        return target_point

    return (
        int(prev_point[0] * (1.0 - t) + target_point[0] * t),
        int(prev_point[1] * (1.0 - t) + target_point[1] * t)
    )


def clear_release_state():

    global potential_shot
    global shooting_wrist
    global potential_shot_start_frame
    global ball_coast_frames

    potential_shot = False
    shooting_wrist = None
    potential_shot_start_frame = None
    ball_coast_frames = 0

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


def finalize_shot_end():

    # Central "close out this shot" routine. Called from three
    # different places: the normal net-crossing path, the
    # net-independent rim fallback, and the hard timeout — so a
    # shot can ALWAYS be brought to a close even if the net/rim
    # detector drops out mid-flight.

    global shot_end_frame
    global shot_duration
    global misses
    global shot_result_recorded
    global shot_started
    global passed_net
    global net_crossed_frames
    global trajectory
    global visual_ball_trail
    global apex_frame
    global apex_point
    global apex_confirmed
    global below_rim_frames
    global shot_cooldown_counter

    shot_end_frame = frame_number

    if shot_start_frame is not None:

        shot_duration = (
            shot_end_frame
            -
            shot_start_frame
        ) / fps


    # If a make is still pending confirmation (settle window),
    # don't call this a miss out from under it — let the pending
    # make resolution logic decide once it's had time to settle.
    if not shot_result_recorded and not pending_make:

        misses += 1

        if shot_designation in category_stats:

            category_stats[shot_designation]["misses"] += 1

        shot_result_recorded = True


    shot_started = False

    passed_net = False

    net_crossed_frames = 0

    trajectory = []

    visual_ball_trail = []

    apex_frame = None
    apex_point = None
    apex_confirmed = False

    below_rim_frames = 0

    clear_release_state()

    shot_cooldown_counter = SHOT_COOLDOWN_FRAMES


def log_performance():

    global last_perf_log_time

    now = time.perf_counter()

    if now - last_perf_log_time < PERF_LOG_INTERVAL_SEC:
        return

    last_perf_log_time = now


    def avg_ms(stage_name):

        values = stage_timings[stage_name]

        if not values:
            return 0.0

        return sum(values) / len(values)


    court_ms = avg_ms("court_model")
    detect_ms = avg_ms("detection_model")
    pose_ms = avg_ms("pose_model")
    draw_ms = avg_ms("overlay_draw")
    imshow_ms = avg_ms("imshow_display")
    logic_ms = avg_ms("frame_logic")
    total_ms = avg_ms("frame_total")
    pace_ms = avg_ms("pace_sleep")
    waitkey_ms = avg_ms("waitkey_delay")

    logic_selection_player_ms = avg_ms("logic_selection_player")
    logic_net_rim_ms = avg_ms("logic_net_rim")
    logic_pose_match_draw_ms = avg_ms("logic_pose_match_draw")
    logic_release_evaluation_ms = avg_ms("logic_release_evaluation")
    logic_trajectory_draw_ms = avg_ms("logic_trajectory_draw")
    logic_ball_shot_ms = avg_ms("logic_ball_shot")

    court_amortized = court_ms / COURT_CALIBRATION_INTERVAL

    # avg_ms() just averages whatever's in the deque regardless of
    # units — reused here on a deque of 1.0/0.0 flags, so this is
    # actually computing the FRACTION of the last 120 frames pose
    # ran on. Multiplying that by pose's own average per-call cost
    # gives the true amortized contribution, correctly reflecting
    # a state-driven run frequency instead of assuming a fixed one.
    pose_run_rate = avg_ms("pose_ran_flag")
    pose_amortized = pose_ms * pose_run_rate

    effective_fps = (
        1000.0 / total_ms
        if total_ms > 0
        else 0.0
    )

    print(
        f"[PERF] per-call ms  -> "
        f"court:{court_ms:6.1f}  "
        f"detect:{detect_ms:6.1f}  "
        f"pose:{pose_ms:6.1f}  "
        f"draw:{draw_ms:6.1f}  "
        f"imshow:{imshow_ms:5.1f}  "
        f"logic:{logic_ms:6.1f}"
    )

    print(
        f"       logic breakdown -> "
        f"selection+player:{logic_selection_player_ms:5.1f}  "
        f"net+rim:{logic_net_rim_ms:5.1f}  "
        f"pose_match+draw:{logic_pose_match_draw_ms:5.1f}  "
        f"ball+shot_state+trajectory:{logic_ball_shot_ms:5.1f}"
    )

    # Nested sub-breakdown of the "ball+shot_state+trajectory" bucket
    # above — these two are INSIDE that span, not additional to it,
    # so don't add them into any total; they exist purely to show
    # where within that broad bucket the time is actually going.
    print(
        f"         (of which) release_evaluation:{logic_release_evaluation_ms:5.1f}  "
        f"trajectory_draw:{logic_trajectory_draw_ms:5.1f}"
    )

    # pose_amortized is deliberately NOT in this sum — pose_model()
    # is called from inside the span logic_ms already measures
    # (candidate selection through trajectory draw), so it's already
    # counted once via logic_ms. Adding it again here was the second,
    # smaller double-count (same shape as the pose_match_draw one
    # fixed last round) — this is what "other" being consistently
    # around -2ms even after that fix was pointing at. court_amortized
    # doesn't have this problem: court_model() is called upstream of
    # where logic_ms starts timing, so it's genuinely separate.
    accounted_ms = (
        court_amortized + detect_ms
        + draw_ms + imshow_ms + logic_ms + waitkey_ms
    )

    unaccounted_ms = total_ms - accounted_ms

    print(
        f"       per-frame ms -> "
        f"court:{court_amortized:6.1f}  "
        f"detect:{detect_ms:6.1f}  "
        f"pose:{pose_amortized:6.1f} "
        f"(ran {pose_run_rate * 100:4.1f}% of last 120 frames, "
        f"in logic, not summed separately)  "
        f"draw:{draw_ms:6.1f}  "
        f"imshow:{imshow_ms:5.1f}  "
        f"logic:{logic_ms:6.1f}  "
        f"waitkey:{waitkey_ms:5.1f}  "
        f"other:{unaccounted_ms:5.1f}  "
        f"= total:{total_ms:6.1f}ms  "
        f"(~{effective_fps:4.1f} FPS uncapped, "
        f"pacing_sleep:{pace_ms:5.1f}ms, "
        f"source {fps:.1f} FPS)"
    )

    # PLAYBACK SPEED: real elapsed wall-clock seconds since playback
    # began (excludes warmup) vs. how many seconds of VIDEO content
    # have been processed (frame_number/fps, the source's own time
    # terms). These should track closely if real-time playback is
    # actually being achieved — the uncapped FPS figure above can
    # look fine while this still reveals a growing gap if pacing_
    # sleep has been at 0 for a while (i.e. still behind despite
    # the current per-frame cost being low enough now).
    elapsed_wall_seconds = time.perf_counter() - playback_start_time
    elapsed_video_seconds = frame_number / fps
    playback_delay_seconds = elapsed_wall_seconds - elapsed_video_seconds

    print(
        f"       playback -> "
        f"video time:{elapsed_video_seconds:8.2f}s  "
        f"wall time:{elapsed_wall_seconds:8.2f}s  "
        f"delay:{playback_delay_seconds:+7.2f}s "
        f"({'behind' if playback_delay_seconds > 0 else 'on pace'})"
    )


# ============================================================
# GPU WARMUP
# ============================================================

# The very first call to a newly loaded model pays a real,
# one-time cost — CUDA context init, cuDNN/half-precision kernel
# autotuning, CUDA memory pool growth. Left uncounted, that cost
# pollutes the rolling [PERF] average for a long time. Running each
# model a few times on a throwaway frame before the timed loop
# starts gets that one-time cost out of the way so the benchmark
# reflects true steady-state numbers from frame 1. Pose is warmed
# up on a plausible crop-sized region rather than the full frame,
# to match how it's actually called in the main loop now.

_warmup_success, _warmup_frame = cap.read()

if _warmup_success:

    _warmup_h, _warmup_w = _warmup_frame.shape[:2]

    _warmup_crop = _warmup_frame[
        0:min(_warmup_h, POSE_CROP_HEIGHT),
        0:min(_warmup_w, POSE_CROP_WIDTH)
    ]

    for _ in range(3):

        court_model(
            _warmup_frame,
            conf=COURT_DETECTION_CONF,
            device=DEVICE,
            quantize=INFERENCE_QUANTIZE,
            imgsz=COURT_IMGSZ,
            verbose=False
        )

        model.track(
            _warmup_frame,
            persist=False,
            tracker="bytetrack.yaml",
            conf=CONTINUATION_CONF,
            device=DEVICE,
            quantize=INFERENCE_QUANTIZE,
            imgsz=DETECT_IMGSZ,
            verbose=False
        )

        pose_model(
            _warmup_crop,
            conf=POSE_CONF,
            device=DEVICE,
            quantize=INFERENCE_QUANTIZE,
            imgsz=POSE_IMGSZ,
            verbose=False
        )

    # Rewind so warmup doesn't consume a real frame from the
    # actual playback / shot timeline — frame_number still starts
    # at the video's true first frame.
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

    # GUI/window-system warmup — same rationale as the model warmup
    # above, different subsystem. The first-ever imshow()+key-check
    # call has to actually create the OS display window, which is
    # its own one-time cost (measured at ~109ms on this machine)
    # with the identical decay-then-settle shape as the CUDA/
    # TensorRT first-call cost the model warmup above absorbs.
    # Doing it here, before the timed loop starts, keeps that cost
    # out of the rolling waitkey_delay average from frame 1 onward.
    # Uses pollKey() to match exactly what the real loop calls now —
    # warming up a different call than the one actually used
    # wouldn't necessarily absorb the same one-time cost. Skipped
    # entirely when there's no window to warm up in the first place.
    if SHOW_DISPLAY_WINDOW:

        cv2.imshow("Follow Through", _warmup_frame)
        cv2.pollKey()


# ============================================================
# MAIN LOOP
# ============================================================

frame_number = 0

# Marks the true start of playback — right after warmup, before
# the first real frame is read — so it excludes warmup entirely.
# Compared each log tick against frame_number/fps (how much VIDEO
# content has been processed, in the source's own time terms) to
# show whether real-time playback is actually being kept up with,
# not just inferred from the uncapped FPS number.
playback_start_time = time.perf_counter()

frame_reader = FrameReader(cap).start()


while True:

    frame_total_start = time.perf_counter()

    success, frame = frame_reader.read()

    if not success:
        break


    frame_number += 1


    # Reset per-frame ball readings so a stale value from a
    # previous frame can never leak into this frame's checks.
    ball_x = None
    ball_y = None
    ball_is_predicted = False


    # ========================================================
    # COURT DISTANCE CALIBRATION
    # ========================================================

    run_court_model_this_frame = (
        homography is None
        or (frame_number % COURT_CALIBRATION_INTERVAL == 0)
    )

    if run_court_model_this_frame:

        _stage_start = time.perf_counter()

        court_results = court_model(
            frame,
            conf=COURT_DETECTION_CONF,
            device=DEVICE,
            quantize=INFERENCE_QUANTIZE,
            imgsz=COURT_IMGSZ,
            verbose=False
        )

        stage_timings["court_model"].append(
            (time.perf_counter() - _stage_start) * 1000
        )

        court_result = court_results[0]


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

            box_confidences = (
                court_result.boxes.conf
                .cpu()
                .numpy()
            )

            best_index = box_confidences.argmax()

            detection_points = (
                points[best_index].copy()
            )

            detection_conf = (
                confidences[best_index]
            )

            new_valid_points = (
                detection_conf >= COURT_KEYPOINT_CONF
            )

            if new_valid_points.sum() >= 4:

                # Snapshot the pre-update state for interpolation
                # (see the drawing section below) before committing
                # the new one.
                if last_court_points is not None:

                    court_points_prev = last_court_points.copy()
                    court_points_prev_valid = current_court_valid_points.copy()

                    if court_last_calibration_frame is not None:

                        court_prev_calibration_gap = max(
                            frame_number - court_last_calibration_frame,
                            1
                        )

                court_last_calibration_frame = frame_number

                # Only now does the mask used for drawing actually
                # change — never on a detection too weak to use.
                current_court_valid_points = new_valid_points

                if last_court_points is None:

                    smoothed_court_points = (
                        detection_points.copy()
                    )

                else:

                    smoothed_court_points = (
                        last_court_points.copy()
                    )

                    for keypoint_id in range(7):

                        if current_court_valid_points[keypoint_id]:

                            smoothed_court_points[
                                keypoint_id
                            ] = (
                                SMOOTHING_ALPHA
                                * detection_points[keypoint_id]
                                +
                                (1 - SMOOTHING_ALPHA)
                                * last_court_points[keypoint_id]
                            )

                last_court_points = (
                    smoothed_court_points.copy()
                )

                image_points = []
                real_points = []

                for keypoint_id in range(7):

                    if not current_court_valid_points[keypoint_id]:
                        continue

                    x, y = smoothed_court_points[keypoint_id]

                    image_points.append([x, y])
                    real_points.append(COURT_POINTS[keypoint_id])

                image_points = np.array(
                    image_points,
                    dtype=np.float32
                )

                real_points = np.array(
                    real_points,
                    dtype=np.float32
                )

                if len(image_points) >= 4:

                    new_homography, status = cv2.findHomography(
                        image_points,
                        real_points,
                        cv2.RANSAC,
                        3.0
                    )

                    if new_homography is not None:
                        homography = new_homography


    # Drawing runs every frame (cheap) using the last known court
    # skeleton. Interpolated toward the target position across the
    # frames between calibrations instead of holding frozen then
    # jumping — smooth motion instead of "bounce". Only cosmetic:
    # the coordinates used for homography/distance are always
    # last_court_points directly, never this interpolated draw
    # position.

    if last_court_points is not None:

        if (
            court_points_prev is not None
            and court_last_calibration_frame is not None
            and court_prev_calibration_gap > 0
        ):

            court_interp_t = (
                (frame_number - court_last_calibration_frame)
                / court_prev_calibration_gap
            )

            court_interp_t = max(0.0, min(1.0, court_interp_t))

        else:

            court_interp_t = 1.0


        display_court_points = last_court_points

        if court_points_prev is not None and court_interp_t < 1.0:

            display_court_points = last_court_points.copy()

            for keypoint_id in range(7):

                if (
                    current_court_valid_points[keypoint_id]
                    and court_points_prev_valid[keypoint_id]
                ):

                    display_court_points[keypoint_id] = (
                        court_points_prev[keypoint_id]
                        * (1.0 - court_interp_t)
                        +
                        last_court_points[keypoint_id]
                        * court_interp_t
                    )


        for id1, id2 in SKELETON:

            if not current_court_valid_points[id1]:
                continue

            if not current_court_valid_points[id2]:
                continue

            x1, y1 = display_court_points[id1]
            x2, y2 = display_court_points[id2]

            cv2.line(
                frame,
                (int(x1), int(y1)),
                (int(x2), int(y2)),
                THEME_DETECT_GREY,
                2,
                cv2.LINE_AA
            )

        for keypoint_id in range(7):

            if not current_court_valid_points[keypoint_id]:
                continue

            x, y = display_court_points[keypoint_id]

            cv2.circle(
                frame,
                (int(x), int(y)),
                7,
                THEME_ACCENT,
                -1
            )


    # ========================================================
    # FOLLOW THROUGH DETECTION
    # ========================================================

    # GPU OBJECT DETECTION
    # NOTE: conf is intentionally set to the lower CONTINUATION_CONF
    # floor here, not DETECTION_CONF — the per-class filtering (with
    # DETECTION_CONF for everything except the ball) happens in our
    # own candidate-gathering loop below. Filtering at DETECTION_CONF
    # here would silently discard the lower-confidence ball
    # detections the continuation logic depends on.

    _stage_start = time.perf_counter()

    results = model.track(
        frame,
        persist=True,
        tracker="bytetrack.yaml",
        conf=CONTINUATION_CONF,
        device=DEVICE,
        quantize=INFERENCE_QUANTIZE,
        imgsz=DETECT_IMGSZ,
        verbose=False
    )

    stage_timings["detection_model"].append(
        (time.perf_counter() - _stage_start) * 1000
    )

    _annotate_start = time.perf_counter()


    ball_candidates = []
    net_candidates = []
    player_candidates = []
    rim_candidates = []


    # ========================================================
    # READ FOLLOW THROUGH DETECTIONS
    # ========================================================

    # Same fix applied to pose a few rounds back: pull every box's
    # cls/conf/id/xyxy off the GPU in ONE bulk transfer per result,
    # instead of the previous per-box, per-field access (box.cls[0],
    # box.conf[0], etc.) — each of those was a separate CUDA sync,
    # paid 3-4 times over for every single detected box, every
    # frame. That's the likely source of the gap between "logic"
    # and its sub-buckets in the benchmark: this loop's cost was
    # landing inside logic_selection_player but wasn't visible as
    # its own line.

    for result in results:

        if result.boxes is None or len(result.boxes) == 0:
            continue

        all_cls = result.boxes.cls.cpu().numpy()
        all_conf = result.boxes.conf.cpu().numpy()
        all_xyxy = result.boxes.xyxy.cpu().numpy()

        all_ids = (
            result.boxes.id.cpu().numpy()
            if result.boxes.id is not None
            else None
        )

        for i in range(len(all_cls)):

            cls = int(all_cls[i])
            conf = float(all_conf[i])

            track_id = (
                int(all_ids[i])
                if all_ids is not None
                else None
            )


            # The basketball keeps a lower confidence floor so a
            # matching tracker ID can carry it through motion blur.
            if cls == 1:

                if conf < CONTINUATION_CONF:
                    continue

            else:

                if conf < DETECTION_CONF:
                    continue


            x1, y1, x2, y2 = map(
                int,
                all_xyxy[i]
            )


            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2


            candidate = {
                "center": (cx, cy),
                "box": (x1, y1, x2, y2),
                "conf": conf,
                "id": track_id,
                "predicted": False
            }


            # Basketball = 1
            if cls == 1:

                ball_candidates.append(candidate)


            # Net = 3
            elif cls == 3:

                net_candidates.append(candidate)


            # Player = 4
            elif cls == 4:

                player_candidates.append(candidate)


            # Rim = 5
            elif cls == 5:

                rim_candidates.append(candidate)


    basketball = select_basketball_detection(
        ball_candidates,
        last_ball_track_id
    )

    net = select_best_by_conf(net_candidates)

    player = select_player_detection(
        player_candidates,
        previous_player_box
    )

    rim = select_best_by_conf(rim_candidates)


    # ========================================================
    # PLAYER CONTINUITY
    # ========================================================

    if player is not None:

        previous_player_box = player["box"]

        player_miss_frames = 0

    else:

        player_miss_frames += 1

        # Give up on continuity after a long gap so we don't
        # latch onto a stale location if the player re-enters
        # somewhere else in frame.
        if player_miss_frames > 45:

            previous_player_box = None


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
            THEME_DETECT_GREY,
            2
        )


        cv2.line(
            frame,
            (px1, upper_bound),
            (px2, upper_bound),
            THEME_ACCENT,
            2
        )


    # ========================================================
    # EARLY POSE-FREQUENCY TRIGGER
    # ========================================================

    # Wrist-independent, always-fresh signal (ball + player box
    # only, from detect) that a release might be imminent — used
    # below to switch pose to full frequency BEFORE the precise,
    # wrist-distance-dependent release gate needs accurate data.
    # See EARLY_POSE_TRIGGER_RATIO for why this can't just be
    # potential_shot itself.

    ball_near_release_zone = False

    if player and basketball is not None:

        _, by = basketball["center"]

        early_trigger_bound = int(
            py1 + player_height * EARLY_POSE_TRIGGER_RATIO
        )

        ball_near_release_zone = by <= early_trigger_bound


    # ========================================================
    # PLAYER DISTANCE
    # ========================================================

    player_distance = None

    if (
        homography is not None
        and player is not None
    ):

        player_ground_pixel = get_player_ground_pixel(
            player["box"]
        )

        player_court_point = pixel_to_court(
            player_ground_pixel,
            homography
        )

        player_distance = calculate_distance_to_rim(
            player_court_point
        )

        player_distance_history.append(player_distance)

        cv2.circle(
            frame,
            (
                int(player_ground_pixel[0]),
                int(player_ground_pixel[1])
            ),
            8,
            THEME_ACCENT,
            -1
        )


    stage_timings["logic_selection_player"].append(
        (time.perf_counter() - _annotate_start) * 1000
    )

    _sub_stage_start = time.perf_counter()


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
            THEME_DETECT_GREY,
            2
        )


        cv2.line(
            frame,
            (nx1, net_bottom),
            (nx2, net_bottom),
            THEME_ACCENT,
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
            THEME_ACCENT_SOFT,
            2
        )


        cv2.line(
            frame,
            (rx1, rim_center_y),
            (rx2, rim_center_y),
            THEME_ACCENT_SOFT,
            2
        )


    stage_timings["logic_net_rim"].append(
        (time.perf_counter() - _sub_stage_start) * 1000
    )

    _sub_stage_start = time.perf_counter()


    # ========================================================
    # POSE DETECTION (CROPPED TO PLAYER)
    # ========================================================

    # pose_model now runs on a tight crop around the player's box
    # instead of the full frame — see the constants/comment above
    # POSE_IMGSZ for why this is a real compute cut, not just a
    # scheduling change. Two side effects worth knowing:
    #   1. No player detected this frame -> no crop -> pose is
    #      skipped entirely this frame (falls back to cached
    #      last-known wrist/elbow/shoulder positions, same as
    #      before).
    #   2. The old "MATCH POSE TO PLAYER" search across every
    #      detected person is gone — the crop already isolates
    #      the player, so we just take the highest-confidence
    #      detected pose within it (mirrors how the court model
    #      already picks its best detection).

    # Runs ONLY within the window wrist position actually matters:
    # from the ball entering the wider early-warning zone, through
    # release evaluation. Nothing downstream of shot_started ever
    # reads wrist position at all — not apex tracking, not make
    # detection, not the net/rim end-of-shot logic, all of which
    # only care about the ball. So pose stops the instant a release
    # actually confirms (potential_shot -> shot_started), not at
    # apex — there was never anything for it to inform past that
    # point. No periodic idle-time fallback either — outside this
    # window pose doesn't run at all, not even amortized.
    # ball_near_release_zone comes from detect-model data only
    # (always fresh, no chicken-and-egg problem with wrist-
    # dependent gates).
    run_pose_model_this_frame = (
        player is not None
        and (
            ball_near_release_zone
            or potential_shot
        )
    )

    # Tracked every frame regardless of the outcome above — this is
    # what lets the benchmark compute pose's TRUE amortized cost
    # now that its run frequency is state-driven instead of a fixed
    # interval. A fixed divisor can't represent "0% of frames for a
    # long idle stretch, then 100% during a brief shot window."
    stage_timings["pose_ran_flag"].append(
        1.0 if run_pose_model_this_frame else 0.0
    )

    left_wrist = None
    right_wrist = None

    left_elbow = None
    right_elbow = None

    left_shoulder = None
    right_shoulder = None


    if run_pose_model_this_frame:

        frame_height, frame_width = frame.shape[:2]

        px1, py1, px2, py2 = player["box"]

        player_center_x = (px1 + px2) // 2

        player_center_y = (
            (py1 + py2) // 2
            -
            int((py2 - py1) * POSE_CROP_UPWARD_BIAS_RATIO)
        )

        half_w = POSE_CROP_WIDTH // 2
        half_h = POSE_CROP_HEIGHT // 2

        crop_x1 = player_center_x - half_w
        crop_x2 = player_center_x + half_w
        crop_y1 = player_center_y - half_h
        crop_y2 = player_center_y + half_h

        # Shift the crop inward at frame edges instead of shrinking
        # it, so the crop's pixel size stays fixed (POSE_CROP_WIDTH x
        # POSE_CROP_HEIGHT) in the common case — that's the whole
        # point, keeping the tensor shape fed to pose_model constant
        # call to call. Only actually clamped/shrunk if the frame
        # itself is smaller than the crop, which shouldn't happen at
        # normal video resolutions.

        if crop_x1 < 0:
            crop_x2 -= crop_x1
            crop_x1 = 0

        if crop_y1 < 0:
            crop_y2 -= crop_y1
            crop_y1 = 0

        if crop_x2 > frame_width:
            crop_x1 -= (crop_x2 - frame_width)
            crop_x2 = frame_width

        if crop_y2 > frame_height:
            crop_y1 -= (crop_y2 - frame_height)
            crop_y2 = frame_height

        crop_x1 = max(0, crop_x1)
        crop_y1 = max(0, crop_y1)
        crop_x2 = min(frame_width, crop_x2)
        crop_y2 = min(frame_height, crop_y2)

        if crop_x2 > crop_x1 and crop_y2 > crop_y1:

            player_crop = frame[crop_y1:crop_y2, crop_x1:crop_x2]

            _stage_start = time.perf_counter()

            pose_results = pose_model(
                player_crop,
                conf=POSE_CONF,
                device=DEVICE,
                quantize=INFERENCE_QUANTIZE,
                imgsz=POSE_IMGSZ,
                verbose=False
            )

            stage_timings["pose_model"].append(
                (time.perf_counter() - _stage_start) * 1000
            )

            # Reset the sub-stage timer here, AFTER the model call —
            # it previously started before this call, which meant
            # the model's own cost was being counted both in its own
            # bucket above AND inside logic_pose_match_draw below.
            # That double-count is what was showing up as a sharply
            # negative "other" in the benchmark output.
            _sub_stage_start = time.perf_counter()


            # ====================================================
            # PICK THE PLAYER'S POSE
            # ====================================================

            for pose_result in pose_results:

                if pose_result.keypoints is None:
                    continue

                if len(pose_result.keypoints.xy) == 0:
                    continue


                # Pull everything off the GPU in ONE transfer
                # instead of dozens of individual per-element syncs.
                all_keypoints_xy = pose_result.keypoints.xy.cpu().numpy()

                all_keypoints_conf = (
                    pose_result.keypoints.conf.cpu().numpy()
                    if pose_result.keypoints.conf is not None
                    else None
                )


                best_pose = None

                if (
                    pose_result.boxes is not None
                    and len(pose_result.boxes) > 0
                ):

                    box_confidences = pose_result.boxes.conf.cpu().numpy()

                    best_pose = int(box_confidences.argmax())


                # ====================================================
                # GET PLAYER KEYPOINTS
                # ====================================================

                if best_pose is not None:

                    keypoints = all_keypoints_xy[
                        best_pose
                    ]


                    confidences = (
                        all_keypoints_conf[
                            best_pose
                        ]
                        if all_keypoints_conf is not None
                        else None
                    )


                    def get_keypoint(index):

                        if index >= len(keypoints):
                            return None


                        if confidences is not None:

                            if confidences[index] < POSE_CONF:

                                return None


                        # Translate from crop-local coordinates
                        # back to full-frame coordinates.
                        return (
                            int(keypoints[index][0]) + crop_x1,
                            int(keypoints[index][1]) + crop_y1
                        )


                    # COCO keypoints

                    left_shoulder = get_keypoint(5)
                    right_shoulder = get_keypoint(6)

                    left_elbow = get_keypoint(7)
                    right_elbow = get_keypoint(8)

                    left_wrist = get_keypoint(9)
                    right_wrist = get_keypoint(10)


        # ====================================================
        # SNAPSHOT PREVIOUS STATE FOR INTERPOLATION, THEN CACHE
        # ====================================================

        pose_prev_left_shoulder = last_left_shoulder
        pose_prev_right_shoulder = last_right_shoulder
        pose_prev_left_elbow = last_left_elbow
        pose_prev_right_elbow = last_right_elbow
        pose_prev_left_wrist = last_left_wrist
        pose_prev_right_wrist = last_right_wrist

        if pose_last_update_frame is not None:

            pose_prev_update_gap = max(
                frame_number - pose_last_update_frame,
                1
            )

        pose_last_update_frame = frame_number


        if left_shoulder is not None:
            last_left_shoulder = left_shoulder

        if right_shoulder is not None:
            last_right_shoulder = right_shoulder

        if left_elbow is not None:
            last_left_elbow = left_elbow

        if right_elbow is not None:
            last_right_elbow = right_elbow

        if left_wrist is not None:
            last_left_wrist = left_wrist

        if right_wrist is not None:
            last_right_wrist = right_wrist


    # ========================================================
    # DRAW POSE (EVERY FRAME, INTERPOLATED FOR SMOOTH MOTION)
    # ========================================================

    # Same fix as the court skeleton: interpolate toward the
    # target across the skipped frames instead of holding frozen
    # then jumping on the next real pose inference. Purely
    # cosmetic — usable_left_wrist/usable_right_wrist (used for
    # actual shot-start detection, below) always read
    # last_left_wrist/last_right_wrist directly, never these
    # interpolated draw positions.

    if (
        pose_last_update_frame is not None
        and pose_prev_update_gap > 0
    ):

        pose_interp_t = (
            (frame_number - pose_last_update_frame)
            / pose_prev_update_gap
        )

        pose_interp_t = max(0.0, min(1.0, pose_interp_t))

    else:

        pose_interp_t = 1.0

    draw_left_shoulder = interpolate_joint(
        pose_prev_left_shoulder, last_left_shoulder, pose_interp_t
    )

    draw_right_shoulder = interpolate_joint(
        pose_prev_right_shoulder, last_right_shoulder, pose_interp_t
    )

    draw_left_elbow = interpolate_joint(
        pose_prev_left_elbow, last_left_elbow, pose_interp_t
    )

    draw_right_elbow = interpolate_joint(
        pose_prev_right_elbow, last_right_elbow, pose_interp_t
    )

    draw_left_wrist = interpolate_joint(
        pose_prev_left_wrist, last_left_wrist, pose_interp_t
    )

    draw_right_wrist = interpolate_joint(
        pose_prev_right_wrist, last_right_wrist, pose_interp_t
    )


    # Matches the pose-computation window's confirmed-shot cutoff:
    # wrist data is never consumed once shot_started fires, so
    # there's nothing meaningful left to display past that point
    # either. Skeleton is visible only during potential_shot — from
    # the moment the trajectory starts plotting through the instant
    # a release confirms, never before and never after. This is
    # what actually fixes the stale-skeleton-left-on-screen problem:
    # the old code drew every single frame unconditionally off
    # whatever last_left_wrist/etc. happened to hold, with nothing
    # ever clearing it once pose stopped updating.
    show_pose_skeleton = potential_shot

    if show_pose_skeleton:

        for point in [
            draw_left_shoulder,
            draw_right_shoulder,
            draw_left_elbow,
            draw_right_elbow,
            draw_left_wrist,
            draw_right_wrist
        ]:

            if point is not None:

                cv2.circle(
                    frame,
                    point,
                    6,
                    THEME_DETECT_GREY,
                    -1
                )


        # Left arm

        if (
            draw_left_shoulder is not None
            and
            draw_left_elbow is not None
        ):

            cv2.line(
                frame,
                draw_left_shoulder,
                draw_left_elbow,
                THEME_DETECT_GREY,
                3
            )


        if (
            draw_left_elbow is not None
            and
            draw_left_wrist is not None
        ):

            cv2.line(
                frame,
                draw_left_elbow,
                draw_left_wrist,
                THEME_DETECT_GREY,
                3
            )


        # Right arm

        if (
            draw_right_shoulder is not None
            and
            draw_right_elbow is not None
        ):

            cv2.line(
                frame,
                draw_right_shoulder,
                draw_right_elbow,
                THEME_DETECT_GREY,
                3
            )


        if (
            draw_right_elbow is not None
            and
            draw_right_wrist is not None
        ):

            cv2.line(
                frame,
                draw_right_elbow,
                draw_right_wrist,
                THEME_DETECT_GREY,
                3
            )


    stage_timings["logic_pose_match_draw"].append(
        (time.perf_counter() - _sub_stage_start) * 1000
    )

    _sub_stage_start = time.perf_counter()


    # ========================================================
    # BALL DETECTION CONTINUITY (SHORT-TERM COASTING)
    # ========================================================

    if basketball is not None:

        if basketball["id"] is not None:

            last_ball_track_id = basketball["id"]

        ball_coast_frames = 0

    elif (
        (potential_shot or shot_started)
        and last_real_ball_center is not None
        and ball_coast_frames < MAX_BALL_COAST_FRAMES
    ):

        # Ball wasn't detected this frame but a shot is actively
        # being evaluated/tracked — bridge the gap with a simple
        # constant-velocity prediction rather than dropping the
        # frame entirely.
        ball_coast_frames += 1

        predicted_center = (
            int(
                last_real_ball_center[0]
                +
                ball_velocity[0] * ball_coast_frames
            ),
            int(
                last_real_ball_center[1]
                +
                ball_velocity[1] * ball_coast_frames
            )
        )

        basketball = {
            "center": predicted_center,
            "box": None,
            "conf": 0.0,
            "id": last_ball_track_id,
            "predicted": True
        }


    # ========================================================
    # BASKETBALL
    # ========================================================

    if basketball:

        ball_center = basketball["center"]

        ball_x, ball_y = ball_center

        ball_is_predicted = basketball["predicted"]


        if not ball_is_predicted:

            bx1, by1, bx2, by2 = basketball["box"]


            cv2.rectangle(
                frame,
                (bx1, by1),
                (bx2, by2),
                THEME_ACCENT,
                2
            )


            cv2.circle(
                frame,
                ball_center,
                5,
                THEME_TEXT_PRIMARY,
                -1
            )


            # Update the velocity estimate and last known real
            # position — this is what powers the coasting
            # prediction above on frames the ball is missed.
            if last_real_ball_center is not None:

                ball_velocity = (
                    ball_center[0] - last_real_ball_center[0],
                    ball_center[1] - last_real_ball_center[1]
                )

            last_real_ball_center = ball_center

        else:

            # Hollow marker distinguishes a coasted/predicted
            # position from a real detection at a glance.
            cv2.circle(
                frame,
                ball_center,
                8,
                THEME_ACCENT_SOFT,
                2
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

        _release_eval_start = time.perf_counter()

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

            # Scaled by the player's own box height this frame —
            # crossed_upper_bound being True guarantees player was
            # actually detected this frame, so player_height is
            # always fresh here, never a stale value from an
            # earlier frame.
            scaled_max_wrist_distance = (
                player_height * MAX_BALL_WRIST_RATIO
            )

            if (
                crossed_upper_bound
                and
                closest_distance is not None
                and
                closest_distance
                <= scaled_max_wrist_distance
                and
                shot_cooldown_counter <= 0
            ):

                potential_shot = True

                shooting_wrist = closest_side

                potential_shot_start_frame = frame_number

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
                    # CLOSE-RANGE THRESHOLD SCALING
                    # ---------------------------------------------

                    if (
                        player_distance is not None
                        and player_distance <= CLOSE_RANGE_FT
                    ):

                        upward_threshold = (
                            MIN_BALL_UPWARD_MOVEMENT
                            * CLOSE_RANGE_UPWARD_SCALE
                        )

                        separation_threshold = (
                            MIN_RELEASE_SEPARATION
                            * CLOSE_RANGE_SEPARATION_SCALE
                        )

                        accel_threshold = (
                            MIN_RELEASE_ACCEL
                            * CLOSE_RANGE_SEPARATION_SCALE
                        )

                    else:

                        upward_threshold = MIN_BALL_UPWARD_MOVEMENT

                        separation_threshold = MIN_RELEASE_SEPARATION

                        accel_threshold = MIN_RELEASE_ACCEL


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
                        >= upward_threshold
                    )


                    # ---------------------------------------------
                    # BALL/WRIST SEPARATION TREND
                    # ---------------------------------------------

                    # Total separation and frame-to-frame deltas
                    # across the whole release-candidate window, not
                    # just the last 3 samples — this is what lets
                    # the entry gate (MAX_BALL_WRIST_RATIO) stay
                    # loose without dribbles/self-passes slipping
                    # through: a real release keeps separating in
                    # one direction for the whole window, an
                    # incidental hand-ball separation tends to be
                    # short-lived or reverse.

                    ball_separated = False
                    no_reversal = False
                    early_accel_ok = False


                    if len(distances) >= 3:

                        separation = (
                            distances[-1]
                            -
                            distances[0]
                        )


                        ball_separated = (
                            separation
                            >=
                            separation_threshold
                        )


                        deltas = [
                            distances[i] - distances[i - 1]
                            for i in range(1, len(distances))
                        ]


                        # Small tolerance for jitter, not a hard
                        # zero — real noise can dip slightly even
                        # during genuine one-directional separation.
                        no_reversal = all(
                            delta >= -REVERSAL_TOLERANCE
                            for delta in deltas
                        )


                        # The "snap" — separation should grow fast
                        # in the opening frame(s) right after the
                        # ball leaves the hand, not build up slowly.
                        early_accel_ok = (
                            deltas[0] >= accel_threshold
                        )


                    # ---------------------------------------------
                    # RELEASE CONFIRMATION
                    # ---------------------------------------------

                    # no_reversal is required regardless of which
                    # separation signal fires — that's the actual
                    # discriminator between a real release and an
                    # incidental separation (dribble, self-pass)
                    # that happens to pass one of the two checks by
                    # coincidence over a short window.

                    if (
                        ball_moving_up
                        and
                        no_reversal
                        and
                        (
                            ball_separated
                            or
                            early_accel_ok
                        )
                    ):

                        shot_started = True


                        # FREEZE THE PLAYER'S DISTANCE FOR THIS SHOT
                        # Averaged over recent frames instead of a
                        # single noisy homography sample.
                        if len(player_distance_history) > 0:

                            shot_distance = (
                                sum(player_distance_history)
                                /
                                len(player_distance_history)
                            )

                        else:

                            shot_distance = player_distance


                        shot_designation = get_shot_designation(
                            shot_distance
                        )

                        passed_net = False

                        net_crossed_frames = 0

                        shot_result_recorded = False

                        pending_make = False
                        pending_make_frame = None

                        below_rim_frames = 0


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

            release_window_timed_out = (
                potential_shot
                and potential_shot_start_frame is not None
                and (
                    (frame_number - potential_shot_start_frame)
                    / fps
                ) > MAX_RELEASE_WINDOW_SEC
            )

            if (
                (
                    potential_shot
                    and
                    len(ball_history)
                    >= MAX_RELEASE_WINDOW
                )
                or release_window_timed_out
            ):

                # A candidate that never confirmed — clear the
                # visual trail too, so a rejected dribble/self-pass
                # doesn't leave a stray line hanging on screen.
                # clear_release_state() itself deliberately does NOT
                # touch visual_ball_trail, since it's also called
                # right after a successful confirmation, where the
                # trail needs to keep going, not reset.
                visual_ball_trail = []

                clear_release_state()


        stage_timings["logic_release_evaluation"].append(
            (time.perf_counter() - _release_eval_start) * 1000
        )


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
            # MAKE DETECTION (PENDING / SETTLE-WINDOW)
            # ====================================================

            if (
                not shot_result_recorded
                and not pending_make
                and rim_center_y is not None
                and rim_left is not None
                and rim_right is not None
                and previous_ball_center is not None
                and not ball_is_predicted
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


                # Dunks/layups may not get a confirmed apex before
                # reaching the rim — allow those through directly.
                apex_ok = (
                    apex_confirmed
                    or (
                        shot_distance is not None
                        and shot_distance <= CLOSE_RANGE_FT
                    )
                )


                if (
                    ball_moving_down
                    and
                    ball_reached_rim
                    and
                    ball_inside_rim
                    and
                    apex_ok
                ):

                    pending_make = True

                    pending_make_frame = frame_number


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
                    # END SHOT (NET-BASED)
                    # =================================================

                    if (
                        net_crossed_frames
                        >=
                        NET_RESET_FRAMES
                    ):

                        finalize_shot_end()


            # ====================================================
            # NET-INDEPENDENT FALLBACK SHOT END
            # ====================================================

            # If the net detector drops out mid-flight (very common
            # right as the ball scores), this ends the shot purely
            # off the rim once the ball has clearly fallen well past
            # it for several frames — so tracking can never get
            # permanently stuck waiting on a net box that never
            # reappears.

            if (
                shot_started
                and apex_confirmed
                and rim_center_y is not None
            ):

                if ball_y > rim_center_y + RIM_FALLBACK_MARGIN:

                    below_rim_frames += 1

                else:

                    below_rim_frames = 0


                if below_rim_frames >= RIM_FALLBACK_FRAMES:

                    finalize_shot_end()


        previous_ball_center = ball_center


        # ====================================================
        # VISUAL BALL TRAIL (CONTINUOUS ACROSS THE
        # POTENTIAL_SHOT -> SHOT_STARTED TRANSITION)
        # ====================================================

        # Appended here, after both SHOT START DETECTION and SHOT
        # TRACKING above have already run this frame, so
        # potential_shot/shot_started reflect this frame's final,
        # settled state — not a stale value from before this
        # frame's confirmation check ran.

        if potential_shot or shot_started:

            visual_ball_trail.append(ball_center)


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
                THEME_TEXT_PRIMARY,
                markerType=cv2.MARKER_TILTED_CROSS,
                markerSize=24,
                thickness=4
            )


    # ========================================================
    # SHOT TIMEOUT SAFEGUARD
    # ========================================================

    # Absolute last resort: if a shot has been "active" longer
    # than any real shot could plausibly take (net AND rim both
    # lost), force it closed so the tracker never locks up.

    if shot_started and shot_start_frame is not None:

        elapsed_shot_seconds = (
            frame_number - shot_start_frame
        ) / fps

        if elapsed_shot_seconds > MAX_SHOT_DURATION_SEC:

            finalize_shot_end()


    # ========================================================
    # PENDING MAKE RESOLUTION (NET-OCCLUSION SETTLE WINDOW)
    # ========================================================

    if pending_make:

        frames_since_pending = frame_number - pending_make_frame


        reappeared_above_rim = (
            basketball is not None
            and not basketball["predicted"]
            and rim_center_y is not None
            and basketball["center"][1]
            < rim_center_y - (RIM_FALLBACK_MARGIN / 2)
        )


        if reappeared_above_rim:

            # The ball bounced back out — this was not a make.
            pending_make = False
            pending_make_frame = None

            # If the shot already closed out while we were
            # waiting to confirm, resolve it as a miss now.
            if not shot_result_recorded and not shot_started:

                misses += 1

                if shot_designation in category_stats:

                    category_stats[shot_designation]["misses"] += 1

                shot_result_recorded = True


        elif frames_since_pending >= MAKE_SETTLE_FRAMES:

            makes += 1

            if shot_designation in category_stats:

                category_stats[shot_designation]["makes"] += 1

            shot_result_recorded = True

            pending_make = False
            pending_make_frame = None


    # ========================================================
    # COOLDOWN DECAY
    # ========================================================

    if shot_cooldown_counter > 0:

        shot_cooldown_counter -= 1


    # ========================================================
    # DRAW TRAJECTORY
    # ========================================================

    # Draws from visual_ball_trail — a single list continuously
    # appended to across the whole potential_shot -> shot_started
    # transition (see VISUAL BALL TRAIL above), never rebuilt or
    # swapped between two different sources at the confirmation
    # moment. That's what guarantees the line has no seam: there's
    # only ever one growing list, so there's nothing to reset.
    # Purely visual — detection logic still runs on ball_history/
    # trajectory exactly as before, completely unaffected.

    _trajectory_draw_start = time.perf_counter()

    if visual_ball_trail:

        if len(visual_ball_trail) > 1:

            trajectory_points = np.array(
                visual_ball_trail,
                dtype=np.int32
            ).reshape((-1, 1, 2))

            cv2.polylines(
                frame,
                [trajectory_points],
                False,
                THEME_ACCENT,
                2
            )


        for point in visual_ball_trail:

            cv2.circle(
                frame,
                point,
                4,
                THEME_ACCENT,
                -1
            )


    if shot_started:

        # Draw ONE apex marker on top of trajectory. Stays gated to
        # a confirmed shot — an apex is only meaningful once a
        # release is actually confirmed, unlike the raw path above.

        if (
            apex_confirmed
            and
            apex_point is not None
        ):

            cv2.drawMarker(
                frame,
                apex_point,
                THEME_TEXT_PRIMARY,
                markerType=cv2.MARKER_TILTED_CROSS,
                markerSize=24,
                thickness=4
            )


    # Isolated because this is the one piece of per-frame cost that
    # plausibly SCALES over the course of a single shot — more
    # points in visual_ball_trail as a shot's flight extends means
    # more work for both polylines and the per-point circles, unlike
    # most other per-frame costs here which are roughly constant
    # regardless of how long a shot has been in flight.
    stage_timings["logic_trajectory_draw"].append(
        (time.perf_counter() - _trajectory_draw_start) * 1000
    )


    # ========================================================
    # LARGE STATISTICS OVERLAY (SHOT SUMMARY TABLE)
    # ========================================================

    stage_timings["logic_ball_shot"].append(
        (time.perf_counter() - _sub_stage_start) * 1000
    )

    stage_timings["frame_logic"].append(
        (time.perf_counter() - _annotate_start) * 1000
    )

    _overlay_draw_start = time.perf_counter()

    overlay_x = 20
    overlay_y = 20

    overlay_width = 560
    overlay_height = 460


    panel_region = frame[
        overlay_y:overlay_y + overlay_height,
        overlay_x:overlay_x + overlay_width
    ]

    panel_fill = panel_region.copy()

    cv2.rectangle(
        panel_fill,
        (0, 0),
        (overlay_width, overlay_height),
        THEME_BG,
        -1
    )

    cv2.addWeighted(
        panel_fill,
        0.85,
        panel_region,
        0.15,
        0,
        dst=panel_region
    )


    # Left accent bar (modern flat-UI touch)

    cv2.rectangle(
        frame,
        (
            overlay_x,
            overlay_y
        ),
        (
            overlay_x + 6,
            overlay_y + overlay_height
        ),
        THEME_ACCENT,
        -1
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
        THEME_BORDER,
        2
    )


    # ========================================================
    # TITLE
    # ========================================================

    cv2.putText(
        frame,
        "FOLLOW THROUGH",
        (
            overlay_x + 28,
            overlay_y + 45
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.05,
        THEME_TEXT_PRIMARY,
        2
    )


    # ========================================================
    # SUBTITLE
    # ========================================================

    cv2.putText(
        frame,
        "Shot Summary",
        (
            overlay_x + 28,
            overlay_y + 85
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        THEME_ACCENT,
        2
    )


    # ========================================================
    # DIVIDER
    # ========================================================

    cv2.line(
        frame,
        (
            overlay_x + 25,
            overlay_y + 105
        ),
        (
            overlay_x + overlay_width - 25,
            overlay_y + 105
        ),
        THEME_DIVIDER,
        1
    )


    # ========================================================
    # TABLE COLUMN POSITIONS
    # ========================================================

    category_col_x = overlay_x + 32
    makes_col_x = overlay_x + 260
    misses_col_x = overlay_x + 355
    fg_col_x = overlay_x + 450


    # ========================================================
    # TABLE HEADER ROW
    # ========================================================

    header_y = overlay_y + 138

    cv2.putText(
        frame,
        "CATEGORY",
        (category_col_x, header_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        THEME_TEXT_SECONDARY,
        1
    )

    cv2.putText(
        frame,
        "MAKE",
        (makes_col_x, header_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        THEME_TEXT_SECONDARY,
        1
    )

    cv2.putText(
        frame,
        "MISS",
        (misses_col_x, header_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        THEME_TEXT_SECONDARY,
        1
    )

    cv2.putText(
        frame,
        "FG%",
        (fg_col_x, header_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        THEME_TEXT_SECONDARY,
        1
    )


    cv2.line(
        frame,
        (overlay_x + 25, header_y + 14),
        (overlay_x + overlay_width - 25, header_y + 14),
        THEME_DIVIDER,
        1
    )


    # ========================================================
    # CATEGORY ROWS
    # ========================================================

    row_y = header_y + 48
    row_spacing = 38


    for category_name in CATEGORY_ORDER:

        category_makes = category_stats[category_name]["makes"]
        category_misses = category_stats[category_name]["misses"]

        category_attempts = category_makes + category_misses


        if category_attempts > 0:

            category_pct = (
                category_makes
                /
                category_attempts
                *
                100
            )

            category_pct_text = f"{category_pct:.1f}%"

        else:

            category_pct_text = "--"


        cv2.putText(
            frame,
            CATEGORY_LABELS[category_name],
            (category_col_x, row_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            THEME_TEXT_PRIMARY,
            1
        )

        cv2.putText(
            frame,
            str(category_makes),
            (makes_col_x, row_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            THEME_ACCENT,
            2
        )

        cv2.putText(
            frame,
            str(category_misses),
            (misses_col_x, row_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            THEME_TEXT_SECONDARY,
            2
        )

        cv2.putText(
            frame,
            category_pct_text,
            (fg_col_x, row_y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            THEME_TEXT_PRIMARY,
            2
        )

        row_y += row_spacing


    # ========================================================
    # TOTAL ROW
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


    total_divider_y = row_y - (row_spacing - 20)

    cv2.line(
        frame,
        (overlay_x + 25, total_divider_y),
        (overlay_x + overlay_width - 25, total_divider_y),
        THEME_ACCENT,
        2
    )

    total_row_y = row_y + 12


    cv2.putText(
        frame,
        "TOTAL",
        (category_col_x, total_row_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        THEME_TEXT_PRIMARY,
        2
    )

    cv2.putText(
        frame,
        str(makes),
        (makes_col_x, total_row_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        THEME_ACCENT,
        2
    )

    cv2.putText(
        frame,
        str(misses),
        (misses_col_x, total_row_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        THEME_TEXT_SECONDARY,
        2
    )

    cv2.putText(
        frame,
        f"{fg_percentage:.1f}%",
        (fg_col_x, total_row_y),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        THEME_TEXT_PRIMARY,
        2
    )


    # ========================================================
    # SHOT TRACKER OVERLAY
    # ========================================================

    shot_overlay_x = (
        overlay_x
        +
        overlay_width
        +
        20
    )

    shot_overlay_y = overlay_y
    shot_overlay_width = 500
    shot_overlay_height = 330


    shot_panel_region = frame[
        shot_overlay_y:shot_overlay_y + shot_overlay_height,
        shot_overlay_x:shot_overlay_x + shot_overlay_width
    ]

    shot_panel_fill = shot_panel_region.copy()

    cv2.rectangle(
        shot_panel_fill,
        (0, 0),
        (shot_overlay_width, shot_overlay_height),
        THEME_BG,
        -1
    )

    cv2.addWeighted(
        shot_panel_fill,
        0.85,
        shot_panel_region,
        0.15,
        0,
        dst=shot_panel_region
    )


    # Left accent bar

    cv2.rectangle(
        frame,
        (
            shot_overlay_x,
            shot_overlay_y
        ),
        (
            shot_overlay_x + 6,
            shot_overlay_y + shot_overlay_height
        ),
        THEME_ACCENT,
        -1
    )


    # Border

    cv2.rectangle(
        frame,
        (
            shot_overlay_x,
            shot_overlay_y
        ),
        (
            shot_overlay_x + shot_overlay_width,
            shot_overlay_y + shot_overlay_height
        ),
        THEME_BORDER,
        2
    )


    # ========================================================
    # TITLE
    # ========================================================

    cv2.putText(
        frame,
        "SHOT TRACKER",
        (
            shot_overlay_x + 28,
            shot_overlay_y + 45
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.05,
        THEME_TEXT_PRIMARY,
        2
    )


    # ========================================================
    # STATUS
    # ========================================================

    if shot_started:

        shot_metric_status = "SHOT TRACKING"

    else:

        shot_metric_status = "LAST SHOT"


    cv2.putText(
        frame,
        shot_metric_status,
        (
            shot_overlay_x + 28,
            shot_overlay_y + 85
        ),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        THEME_ACCENT,
        2
    )


    # ========================================================
    # DIVIDER
    # ========================================================

    cv2.line(
        frame,
        (
            shot_overlay_x + 25,
            shot_overlay_y + 105
        ),
        (
            shot_overlay_x + shot_overlay_width - 25,
            shot_overlay_y + 105
        ),
        THEME_DIVIDER,
        1
    )


    # ========================================================
    # LABEL / VALUE COLUMNS
    # ========================================================

    metric_label_x = shot_overlay_x + 32
    metric_value_x = shot_overlay_x + 290


    # ========================================================
    # SHOT DESIGNATION
    # ========================================================

    if shot_designation is not None:

        designation_text = shot_designation

    else:

        designation_text = "--"


    cv2.putText(
        frame,
        "DESIGNATION",
        (metric_label_x, shot_overlay_y + 155),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        THEME_TEXT_SECONDARY,
        1
    )

    cv2.putText(
        frame,
        designation_text,
        (metric_value_x, shot_overlay_y + 155),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        THEME_ACCENT,
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
        "TIME TO APEX",
        (metric_label_x, shot_overlay_y + 201),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        THEME_TEXT_SECONDARY,
        1
    )

    cv2.putText(
        frame,
        apex_text,
        (metric_value_x, shot_overlay_y + 201),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        THEME_TEXT_PRIMARY,
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
        "SHOT DURATION",
        (metric_label_x, shot_overlay_y + 247),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        THEME_TEXT_SECONDARY,
        1
    )

    cv2.putText(
        frame,
        duration_text,
        (metric_value_x, shot_overlay_y + 247),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        THEME_TEXT_PRIMARY,
        2
    )


    # ========================================================
    # DISTANCE
    # ========================================================

    if shot_distance is not None:

        shot_distance_text = f"{shot_distance:.2f} ft"

    else:

        shot_distance_text = "--"


    cv2.putText(
        frame,
        "DISTANCE",
        (metric_label_x, shot_overlay_y + 293),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        THEME_TEXT_SECONDARY,
        1
    )

    cv2.putText(
        frame,
        shot_distance_text,
        (metric_value_x, shot_overlay_y + 293),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        THEME_TEXT_PRIMARY,
        2
    )


    # ========================================================
    # CONTINUOUS PLAYER DISTANCE
    # ========================================================

    if player and player_distance is not None:

        px1, py1, px2, py2 = player["box"]

        distance_label = f"{player_distance:.2f} ft"

        text_size = cv2.getTextSize(
            distance_label,
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            2
        )[0]

        padding_x = 13
        padding_y = 9

        box_x1 = (
            int(
                (px1 + px2) / 2
                -
                text_size[0] / 2
                -
                padding_x
            )
        )

        box_x2 = (
            int(
                (px1 + px2) / 2
                +
                text_size[0] / 2
                +
                padding_x
            )
        )

        box_y2 = int(py2 - 5)
        box_y1 = int(box_y2 - text_size[1] - (padding_y * 2))

        if box_x1 < 5:

            shift = 5 - box_x1
            box_x1 += shift
            box_x2 += shift

        if box_x2 > frame.shape[1] - 5:

            shift = box_x2 - (frame.shape[1] - 5)
            box_x1 -= shift
            box_x2 -= shift

        cv2.rectangle(
            frame,
            (
                box_x1,
                box_y1
            ),
            (
                box_x2,
                box_y2
            ),
            THEME_BG,
            -1
        )

        cv2.rectangle(
            frame,
            (
                box_x1,
                box_y1
            ),
            (
                box_x2,
                box_y2
            ),
            THEME_ACCENT,
            1
        )

        cv2.putText(
            frame,
            distance_label,
            (
                int(
                    (px1 + px2) / 2
                    -
                    text_size[0] / 2
                ),
                int(
                    box_y2
                    -
                    padding_y
                )
            ),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            THEME_TEXT_PRIMARY,
            2
        )


    stage_timings["overlay_draw"].append(
        (time.perf_counter() - _overlay_draw_start) * 1000
    )


    # DISPLAY
    # ========================================================

    # Confirmed on this machine: pollKey() didn't reduce the ~9ms
    # cost (still GUI-backend overhead either way, not the
    # intentional wait itself) — but for the real deployment target
    # (live feed, no local GUI, frames funneled to a frontend
    # instead) neither imshow nor any key-check are needed at all,
    # so the actual fix is skipping this whole section entirely
    # rather than continuing to optimize a call that shouldn't be
    # in the production hot path in the first place. SHOW_DISPLAY_
    # WINDOW=False costs nothing here — both timers just record 0.

    if SHOW_DISPLAY_WINDOW:

        _imshow_start = time.perf_counter()

        cv2.imshow(
            "Follow Through",
            frame
        )

        stage_timings["imshow_display"].append(
            (time.perf_counter() - _imshow_start) * 1000
        )

        _waitkey_start = time.perf_counter()

        key = cv2.pollKey() & 0xFF

        stage_timings["waitkey_delay"].append(
            (time.perf_counter() - _waitkey_start) * 1000
        )

    else:

        key = 0xFF

        stage_timings["imshow_display"].append(0.0)
        stage_timings["waitkey_delay"].append(0.0)


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

        visual_ball_trail = []

        clear_release_state()

        previous_ball_center = None

        last_left_wrist = None
        last_right_wrist = None

        last_left_elbow = None
        last_right_elbow = None

        last_left_shoulder = None
        last_right_shoulder = None

        pose_prev_left_wrist = None
        pose_prev_right_wrist = None
        pose_prev_left_elbow = None
        pose_prev_right_elbow = None
        pose_prev_left_shoulder = None
        pose_prev_right_shoulder = None
        pose_last_update_frame = None
        pose_prev_update_gap = 1

        shot_result_recorded = False

        shot_start_frame = None
        shot_end_frame = None

        time_to_apex = None
        shot_duration = None

        shot_distance = None
        shot_designation = None

        pending_make = False
        pending_make_frame = None

        below_rim_frames = 0

        shot_cooldown_counter = 0

        last_ball_track_id = None
        last_real_ball_center = None
        ball_velocity = (0.0, 0.0)
        ball_coast_frames = 0

        previous_player_box = None
        player_miss_frames = 0

        player_distance_history.clear()

        reset_apex_state()


    # ========================================================
    # PLAYBACK PACING ("CEILING")
    # ========================================================

    # frame_total is measured HERE now — after waitKey and manual
    # reset handling, not before — so it's an honest measurement of
    # everything that actually consumes wall-clock time in a frame,
    # matching exactly what the pacing decision below uses. Both
    # reuse the same elapsed value rather than computing it twice,
    # so there's no way for them to silently drift apart again the
    # way frame_total (pre-waitKey) and the pacing calculation
    # (post-waitKey) used to.

    elapsed_this_frame = time.perf_counter() - frame_total_start

    stage_timings["frame_total"].append(elapsed_this_frame * 1000)

    log_performance()

    target_fps = (
        TARGET_PLAYBACK_FPS
        if TARGET_PLAYBACK_FPS is not None
        else fps
    )

    target_frame_interval = 1.0 / target_fps

    pace_sleep_seconds = target_frame_interval - elapsed_this_frame

    if pace_sleep_seconds > 0:

        time.sleep(pace_sleep_seconds)

        stage_timings["pace_sleep"].append(pace_sleep_seconds * 1000)

    else:

        stage_timings["pace_sleep"].append(0.0)


frame_reader.stop()

cap.release()

cv2.destroyAllWindows()