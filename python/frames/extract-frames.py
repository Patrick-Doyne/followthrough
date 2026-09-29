import cv2
import os

# Video and Directory name to save the frames to
video_path = "videos/train5/burnside7.MOV"
output_dir = "frames/pose-keypoint/train2-frames/burnside7"

# Create a new directory if not already existing
os.makedirs(output_dir, exist_ok=True)

# Load the video into CV
cap = cv2.VideoCapture(video_path)

# Get the total frames and the target frames
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
num_frames = 75

# Get the partitioned frames so we get meaningful data
frame_indices = set(
    int(i * (total_frames - 1) / (num_frames - 1))
    for i in range(num_frames)
)

frame_number = 0
saved = 0

# Loop through and create each frame as a jpg in the spec dir
while True:
    success, frame = cap.read()

    if not success:
        break

    if frame_number in frame_indices:
        filename = os.path.join(
            output_dir,
            f"frame_{saved:04d}.jpg"
        )
        cv2.imwrite(filename, frame)
        saved += 1

    frame_number += 1

cap.release()

print(f"Extracted {saved} frames to '{output_dir}'")