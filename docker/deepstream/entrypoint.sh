#!/bin/bash
set -e

echo "🚀 Vision Pro DeepStream Pipeline Starting..."

# Resolve active model — check shared active_model.json first
ACTIVE_MODEL_FILE="/models/active_model.json"
if [ -f "$ACTIVE_MODEL_FILE" ]; then
    export YOLO_PT_PATH=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['pt_path'])")
    export TRT_ENGINE_PATH=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['engine_path'])")
    echo "📦 Active model from UI: $YOLO_PT_PATH"
else
    export YOLO_PT_PATH="${YOLO_PT_PATH:-/models/yolo/yolov8n.pt}"
    export TRT_ENGINE_PATH="${TRT_ENGINE_PATH:-/models/yolo/yolov8n.engine}"
    echo "📦 Default model: $YOLO_PT_PATH"
fi

# Convert to TensorRT engine if not already done
if [ ! -f "$TRT_ENGINE_PATH" ]; then
    echo "⚙️  TensorRT engine not found — converting $YOLO_PT_PATH → engine (FP16)..."
    python3 /app/app/deepstream/trt_convert.py
    echo "✅ TensorRT engine ready at $TRT_ENGINE_PATH"
else
    echo "✅ TensorRT engine found: $TRT_ENGINE_PATH"
fi

echo "🎥 Starting GStreamer DeepStream pipeline..."
exec python3 /app/app/deepstream/pipeline.py
