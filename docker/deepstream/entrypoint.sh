#!/bin/bash
set -e

echo "🚀 Vision Pro DeepStream Pipeline Starting..."

# Convert YOLO model to TensorRT engine if not present
ENGINE_PATH="/models/yolo/yolov8n.engine"
if [ ! -f "$ENGINE_PATH" ]; then
    echo "⚙️  TensorRT engine not found — converting yolov8n.pt → engine..."
    python3 /app/app/deepstream/trt_convert.py
    echo "✅ TensorRT engine ready at $ENGINE_PATH"
else
    echo "✅ TensorRT engine found: $ENGINE_PATH"
fi

echo "🎥 Starting GStreamer DeepStream pipeline..."
exec python3 /app/app/deepstream/pipeline.py
