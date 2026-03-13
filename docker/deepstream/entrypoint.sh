#!/bin/bash
# ============================================================================
# Vision Pro DeepStream Entrypoint — x86 dGPU version
# For Jetson (ARM64), see: docker/jetson/entrypoint_jetson.sh
# ============================================================================
set -e

echo "🚀 Vision Pro DeepStream Pipeline Starting..."

# Resolve active model — check shared active_model.json first
ACTIVE_MODEL_FILE="/models/active_model.json"
IS_MERGED="false"
declare -a MERGED_PT_PATHS
declare -a MERGED_ENGINE_PATHS

if [ -f "$ACTIVE_MODEL_FILE" ]; then
    IS_MERGED=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(str(d.get('is_merged', False)).lower())")
    
    if [ "$IS_MERGED" = "true" ]; then
        echo "🧩 Active model is a MERGED model collection."
        MODEL_COUNT=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(len(d.get('models', [])))")
        
        for (( i=0; i<$MODEL_COUNT; i++ )); do
            pt=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['models'][$i]['pt_path'])")
            engine=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['models'][$i]['engine_path'])")
            
            MERGED_PT_PATHS[$i]=$pt
            MERGED_ENGINE_PATHS[$i]=$engine
            echo "   → Model $((i+1)): $pt"
        done
    else
        export YOLO_PT_PATH=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['pt_path'])")
        export TRT_ENGINE_PATH=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['engine_path'])")
        echo "📦 Active model from UI: $YOLO_PT_PATH"
        MERGED_PT_PATHS[0]=$YOLO_PT_PATH
        MERGED_ENGINE_PATHS[0]=$TRT_ENGINE_PATH
    fi
else
    export YOLO_PT_PATH="${YOLO_PT_PATH:-/models/yolo/yolov8n.pt}"
    export TRT_ENGINE_PATH="${TRT_ENGINE_PATH:-/models/yolo/yolov8n.engine}"
    echo "📦 Default model: $YOLO_PT_PATH"
    MERGED_PT_PATHS[0]=$YOLO_PT_PATH
    MERGED_ENGINE_PATHS[0]=$TRT_ENGINE_PATH
fi

for (( i=0; i<${#MERGED_PT_PATHS[@]}; i++ )); do
    PT_PATH=${MERGED_PT_PATHS[$i]}
    ENGINE_PATH=${MERGED_ENGINE_PATHS[$i]}
    # Convert to TensorRT engine if not already done
    if [ ! -f "$ENGINE_PATH" ]; then
        echo "⚙️  TensorRT engine not found — converting $PT_PATH → engine (FP16)..."
        YOLO_PT_PATH="$PT_PATH" TRT_ENGINE_PATH="$ENGINE_PATH" python3 /app/app/deepstream/trt_convert.py
        echo "✅ TensorRT engine ready at $ENGINE_PATH"
    else
        echo "✅ TensorRT engine found: $ENGINE_PATH"
    fi
done

echo "🎥 Starting GStreamer DeepStream pipeline..."
exec python3 /app/app/deepstream/pipeline.py
