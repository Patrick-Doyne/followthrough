from ultralytics import YOLO

# 1. Initialize a mid-to-large YOLO26 Pose model for stronger feature extraction
# Medium (m) strikes the perfect balance of capacity and memory safety on an RTX 3090.
model = YOLO("yolo26m-pose.pt")

# 2. Kick off the custom optimized training run
results = model.train(
    # --- Dataset and Paths ---
    data="./data-sets/pose-model/train2-data-set.yolo26/data.yaml",       # Path to your custom 7-keypoint configuration
    epochs=150,                     # 500 images need slightly longer to settle down
    patience=25,                    # Early stopping if validation mAP stalls
   
    # --- Hardware & Batch Sizing Configuration (Bypasses 3090 Crashing) ---
    imgsz=1280,                     # High-res to preserve fine lines and court corners
    batch = 8,                        # Safe physical VRAM limit per loop at 1280px
    nbs = 32,
    #accumulate=8,                   # 4 * 8 = 32 effective batch size for extreme stability
    workers=0,                      # Prevent CPU bottlenecks during image loading
   
    # --- Optimization Mechanics ---
    optimizer="MuSGD",              # YOLO26's native structured gradient optimizer
    lr0=0.01,                       # Baseline learning rate
    lrf=0.01,                       # Deeply decay learning rate to lock onto thin lines
    warmup_epochs=4.0,              # Give localization heads time to map angles gently
   
    # --- Loss Balancing for Concentrated Subsets ---
    pose=25.0,                      # Heavily penalize wrong (x,y) keypoint placement
    kobj=2.0,                       # Prioritize confidence tracking on the 7 points
    box=1.5,                        # Keep box loss low since your labels are already tight
   
    # --- CRITICAL FIX: Disable Geometric Destruction ---
    mosaic=0.0,                     # Slicing the court lines breaks global linear features
    mixup=0.0,                      # Blending courts destroys line definitions
    degrees=0.0,                    # Disabled: Rotations blur the 8-angle symmetry lines
    perspective=0.0,                # Disabled: Artificial warping breaks fixed court ratios
    fliplr=0.0,                     # CRITICAL: Flipping N/S or E/W coordinates scrambles keypoint orders!
    flipud=0.0,                     # Disabled: Keeps court orientations absolute
   
    # --- Safe Color/Lighting Augmentations (Compensates for lighting shifts) ---
    hsv_h=0.015,                    # Slight hue modifications
    hsv_s=0.7,                      # Saturation variance for different stadium lightings
    hsv_v=0.4,                      # Brightness adjustments
   
    plots=True                      # Generate validation images to review your fixes
)