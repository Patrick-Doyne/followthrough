import cv2
import numpy as np
import cvzone
from ultralytics import YOLO

model = YOLO("./YoloWeights/yolo26x.pt")
results = model("image1.jpg")
cv2.imshow("Result", results[0].plot())
cv2.waitKey(0)
cv2.destroyAllWindows()
