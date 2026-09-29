from ultralytics import YOLO
import cv2
import cvzone
import math

cap = cv2.VideoCapture("videos/train5/burnside6.MOV")

model = YOLO("runs/detect/train2-final/weights/best.pt")
#model.to("cuda:0")

classNames = [
    "Backboard",
    "Basketball",
    "",
    "Net",
    "Player",
    "Rim"
]

frame_count = 0

while True:
    success, img = cap.read()

    if not success:
        break

    frame_count += 1

    # Skip every other source frame
    if frame_count % 2 == 0:
        continue

    # Run YOLO on every frame that remains
    results = model(
        img,
        stream=True,
        #device=0,
        quantize="fp16"
    )

    # Draw detections
    for r in results:
        boxes = r.boxes

        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0]

            x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)

            cvzone.cornerRect(
                img,
                (x1, y1, x2 - x1, y2 - y1)
            )

            conf = math.ceil((box.conf[0] * 100)) / 100
            cls = int(box.cls[0])

            cvzone.putTextRect(
                img,
                f'{classNames[cls]} {conf}',
                (max(0, x1), max(35, y1)),
                scale=1.5,
                thickness=2
            )

    cv2.imshow("Image", img)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()