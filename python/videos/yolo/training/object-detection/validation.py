from ultralytics import YOLO


DATA_YAML = "./data-sets/object-detection/train3-data-set.yolo26/data.yaml"

# Path to the weights from the 1280 training run. Update this to
# wherever that run actually saved best.pt (Ultralytics prints the
# exact path at the end of training, under runs/detect/<name>/weights/).
WEIGHTS_PATH = "runs/detect/train/weights/best.pt"

# The resolutions to compare. 1280 is what the model was trained
# at (the reference point); 640/480 are the candidates for a lower
# DETECT_IMGSZ in follow_through.py. Add/remove values here as needed.
VAL_IMGSZ_VALUES = [1280, 640, 480]


if __name__ == "__main__":

    model = YOLO(WEIGHTS_PATH)

    results_by_imgsz = {}

    for imgsz in VAL_IMGSZ_VALUES:

        print(f"\n{'=' * 60}")
        print(f"Validating at imgsz={imgsz}")
        print(f"{'=' * 60}")

        metrics = model.val(
            data=DATA_YAML,
            imgsz=imgsz,
            device=0,
        )

        results_by_imgsz[imgsz] = metrics

    # Summary: overall mAP50-95 plus the Basketball class
    # specifically, side by side across resolutions — that class
    # is the one this whole experiment is actually about, since
    # it's the small, fast-moving object DETECT_IMGSZ reduction
    # risks hurting most.

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print(f"{'=' * 60}")
    print(f"{'imgsz':<8} {'overall mAP50-95':<20} {'Basketball mAP50-95'}")

    for imgsz, metrics in results_by_imgsz.items():

        overall_map = metrics.box.map

        # class_result returns per-class metrics; index depends on
        # class order in your data.yaml. Based on the yaml shared
        # earlier (alphabetical Roboflow export), Basketball is
        # index 1: ['Backboard', 'Basketball', 'FollowThroughDataSet',
        # 'Net', 'Player', 'Rim']. Double check this matches your
        # actual data.yaml if you've changed the class list since.
        basketball_class_index = 1

        try:

            basketball_map = metrics.box.maps[basketball_class_index]

        except (IndexError, AttributeError):

            basketball_map = None

        basketball_map_str = (
            f"{basketball_map:.4f}"
            if basketball_map is not None
            else "n/a"
        )

        print(f"{imgsz:<8} {overall_map:<20.4f} {basketball_map_str}")