#!/bin/bash
# Run inside the DeepStream container to convert yolov8n.pt → TensorRT .engine
# Usage: docker exec visionpro-deepstream /app/docker/deepstream/convert_model.sh
set -e

echo "Converting YOLOv8n → TensorRT engine (FP16, imgsz=640)..."
python3 -c "
from ultralytics import YOLO
import shutil, os

model = YOLO('/models/yolo/yolov8n.pt')
model.export(
    format='engine',
    imgsz=640,
    half=True,          # FP16
    device=0,           # GPU 0
    workspace=4,        # GB TensorRT workspace
    verbose=False,
)
# ultralytics writes to ./yolov8n.engine by default — move it
if os.path.exists('yolov8n.engine'):
    shutil.move('yolov8n.engine', '/models/yolo/yolov8n.engine')
    print('✅ Engine saved to /models/yolo/yolov8n.engine')
else:
    print('✅ Engine already at correct location')
"
