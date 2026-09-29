from ultralytics import YOLO


if __name__ == "__main__":

    model = YOLO("yolo26n.pt")

    model.train(
        data="./data-sets/object-detection/train3-data-set.yolo26/data.yaml",
        epochs=75,
        imgsz=480,
        device=0,

        # Was 0 — that disables parallel data loading, so every
        # batch loads on the main thread instead of overlapping
        # with GPU compute. Bump this toward your CPU core count
        # (leave a couple free) unless workers=0 was intentional
        # for a specific reason (debugging, a known dataloader
        # issue) rather than a leftover default.
        workers=0,

        # Widened from the likely default (~0.5) specifically for
        # the train-high/test-low experiment: this randomly scales
        # objects during augmentation, so a wider range explicitly
        # exposes the model to smaller apparent object sizes during
        # training — closer to what the ball will look like if you
        # later run inference at a lower imgsz than 1280. Mosaic
        # (on by default) already gives some scale diversity; this
        # pushes it further and more deliberately toward the small
        # end specifically.
       # scale=0.9,
    )

    # After training: the only way to actually know if this
    # experiment paid off is to validate at the resolution you'd
    # actually deploy at, not just at the training resolution.
    # model.val() takes its own imgsz independent of what you
    # trained with — run it at a few candidates (e.g. 1280, 640,
    # 480) and compare mAP, especially for the ball class
    # specifically, before deciding whether a lower DETECT_IMGSZ
    # is actually viable:
    #
    #   model.val(data="...", imgsz=1280)
    #   model.val(data="...", imgsz=640)
    #   model.val(data="...", imgsz=480)