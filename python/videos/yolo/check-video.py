import cv2

cap = cv2.VideoCapture("videos/train2/burkelake1.MOV")

fps = cap.get(cv2.CAP_PROP_FPS)
frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)

print("FPS:", fps)
print("Frames:", frame_count)
print("Resolution:", width, "x", height)
print("Duration:", frame_count / fps, "seconds")

cap.release()