#!/bin/bash
# ============================================================================
# Vision Pro NVR – Manual ONNX + TensorRT Conversion Helper (Jetson)
# ============================================================================
# Usage (inside the DeepStream container):
#   docker exec visionpro-deepstream-jetson /convert_to_onnx.sh [model.pt]
#
# If no argument given, converts the default yolov8n.pt
# ============================================================================
set -e

PT_FILE="${1:-/models/yolo/yolov8n.pt}"
BASENAME=$(basename "$PT_FILE" .pt)
ONNX_FILE="/models/onnx/${BASENAME}.onnx"
ENGINE_FILE="/models/yolo/${BASENAME}.engine"
WORKSPACE_GB="${TRT_WORKSPACE_GB:-2}"

echo "============================================"
echo "  Vision Pro – Jetson Model Conversion"
echo "============================================"
echo "  Input:  $PT_FILE"
echo "  ONNX:   $ONNX_FILE"
echo "  Engine: $ENGINE_FILE"
echo "  FP16:   yes"
echo "  TRT Workspace: ${WORKSPACE_GB}GB"
echo "============================================"

# Step 1: PT → ONNX
if [ -f "$ONNX_FILE" ]; then
    echo "✅ ONNX already exists: $ONNX_FILE"
else
    echo "⚙️  Step 1/2: Converting $PT_FILE → ONNX..."
    python3 -c "
from ultralytics import YOLO
import shutil, os

model = YOLO('$PT_FILE')
result = model.export(format='onnx', imgsz=640, opset=12, simplify=True)
print(f'ONNX exported to: {result}')

# Move to standard ONNX directory
os.makedirs(os.path.dirname('$ONNX_FILE'), exist_ok=True)
if result and result != '$ONNX_FILE':
    shutil.move(result, '$ONNX_FILE')
"
    echo "✅ ONNX saved: $ONNX_FILE"
fi

# Step 2: ONNX → TensorRT Engine
if [ -f "$ENGINE_FILE" ]; then
    echo "✅ TensorRT engine already exists: $ENGINE_FILE"
else
    echo "⚙️  Step 2/2: Building TensorRT engine from ONNX (this may take 5-15 min)..."

    /usr/src/tensorrt/bin/trtexec \
        --onnx="$ONNX_FILE" \
        --saveEngine="$ENGINE_FILE" \
        --fp16 \
        --memPoolSize=workspace:${WORKSPACE_GB}G

    echo "✅ Engine saved: $ENGINE_FILE"
fi

echo ""
echo "============================================"
echo "  ✅ Conversion complete!"
echo "  ONNX:   $ONNX_FILE"
echo "  Engine: $ENGINE_FILE"
echo "============================================"
