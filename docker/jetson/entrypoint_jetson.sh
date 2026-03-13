#!/bin/bash
# ============================================================================
# Vision Pro NVR – Jetson DeepStream Entrypoint
# ============================================================================
# Conversion chain:  .pt → .onnx → .engine (FP16, built on-device)
# ============================================================================
set -e

echo "🚀 Vision Pro DeepStream Pipeline Starting (Jetson Mode)..."
echo "   Platform: $(uname -m) | JetPack: $(cat /etc/nv_tegra_release 2>/dev/null | head -1 || echo 'N/A')"

# ── Resolve active model ────────────────────────────────────────────────────
ACTIVE_MODEL_FILE="/models/active_model.json"
IS_MERGED="false"
declare -a MERGED_PT_PATHS
declare -a MERGED_ONNX_PATHS
declare -a MERGED_ENGINE_PATHS

if [ -f "$ACTIVE_MODEL_FILE" ]; then
    IS_MERGED=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(str(d.get('is_merged', False)).lower())")
    
    if [ "$IS_MERGED" = "true" ]; then
        echo "🧩 Active model is a MERGED model collection."
        MODEL_COUNT=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(len(d.get('models', [])))")
        
        for (( i=0; i<$MODEL_COUNT; i++ )); do
            pt=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['models'][$i]['pt_path'])")
            onnx=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['models'][$i]['onnx_path'])")
            engine=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['models'][$i]['engine_path'])")
            
            MERGED_PT_PATHS[$i]=$pt
            MERGED_ONNX_PATHS[$i]=$onnx
            MERGED_ENGINE_PATHS[$i]=$engine
            echo "   → Model $((i+1)): $pt"
        done
    else
        export YOLO_PT_PATH=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['pt_path'])")
        export ONNX_MODEL_PATH=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d.get('onnx_path', d['pt_path'].replace('.pt', '.onnx')))")
        export TRT_ENGINE_PATH=$(python3 -c "import json; d=json.load(open('$ACTIVE_MODEL_FILE')); print(d['engine_path'])")
        echo "📦 Active model from UI: $YOLO_PT_PATH"
        MERGED_PT_PATHS[0]=$YOLO_PT_PATH
        MERGED_ONNX_PATHS[0]=$ONNX_MODEL_PATH
        MERGED_ENGINE_PATHS[0]=$TRT_ENGINE_PATH
    fi
else
    export YOLO_PT_PATH="${YOLO_PT_PATH:-/models/yolo/yolov8n.pt}"
    export ONNX_MODEL_PATH="${ONNX_MODEL_PATH:-/models/onnx/yolov8n.onnx}"
    export TRT_ENGINE_PATH="${TRT_ENGINE_PATH:-/models/yolo/yolov8n.engine}"
    echo "📦 Default model: $YOLO_PT_PATH"
    MERGED_PT_PATHS[0]=$YOLO_PT_PATH
    MERGED_ONNX_PATHS[0]=$ONNX_MODEL_PATH
    MERGED_ENGINE_PATHS[0]=$TRT_ENGINE_PATH
fi

# ── Function to convert a single model ──────────────────────────────────────
convert_model() {
    local PT=$1
    local ONNX=$2
    local ENGINE=$3
    
    # ── Step 1: Convert .pt → .onnx if needed ───────────────────────────────────
    if [ ! -f "$ONNX" ]; then
        echo "⚙️  ONNX model not found — converting $PT → ONNX..."
        YOLO_PT_PATH="$PT" ONNX_MODEL_PATH="$ONNX" python3 -c "
from app.deepstream.onnx_convert import convert_pt_to_onnx
import os
pt = os.environ['YOLO_PT_PATH']
onnx = os.environ['ONNX_MODEL_PATH']
convert_pt_to_onnx(pt, onnx)
"
        echo "✅ ONNX model ready at $ONNX"
    else
        echo "✅ ONNX model found: $ONNX"
    fi

    # ── Step 2: Convert .onnx → .engine (TensorRT FP16) if needed ───────────────
    if [ ! -f "$ENGINE" ]; then
        echo "⚙️  TensorRT engine not found — building from ONNX (FP16, workspace=${TRT_WORKSPACE_GB:-2}GB)..."
        echo "   This may take 5-15 minutes on Jetson (first run only)..."

        /usr/src/tensorrt/bin/trtexec \
            --onnx="$ONNX" \
            --saveEngine="$ENGINE" \
            --fp16 \
            --memPoolSize=workspace:${TRT_WORKSPACE_GB:-2}G \
            2>&1 | tail -20

        if [ ! -f "$ENGINE" ]; then
            echo "❌ trtexec failed — falling back to ultralytics PT → engine conversion..."
            YOLO_PT_PATH="$PT" TRT_ENGINE_PATH="$ENGINE" python3 -c "
from ultralytics import YOLO
import shutil, os
model = YOLO(os.environ['YOLO_PT_PATH'])
model.export(format='engine', imgsz=640, half=True, device=0, workspace=int(os.environ.get('TRT_WORKSPACE_GB', '2')))
generated = os.environ['YOLO_PT_PATH'].replace('.pt', '.engine')
engine_out = os.environ['TRT_ENGINE_PATH']
if generated != engine_out and os.path.exists(generated):
    os.makedirs(os.path.dirname(engine_out), exist_ok=True)
    shutil.move(generated, engine_out)
print(f'✅ Engine saved to {engine_out}')
"
        fi

        echo "✅ TensorRT engine ready at $ENGINE"
    else
        echo "✅ TensorRT engine found: $ENGINE"
    fi
}

# ── Loop through all configured models ──────────────────────────────────────
for (( i=0; i<${#MERGED_PT_PATHS[@]}; i++ )); do
    convert_model "${MERGED_PT_PATHS[$i]}" "${MERGED_ONNX_PATHS[$i]}" "${MERGED_ENGINE_PATHS[$i]}"
done

# ── Step 1: Convert .pt → .onnx if needed ───────────────────────────────────


echo "🎥 Starting GStreamer DeepStream pipeline..."
exec python3 /app/app/deepstream/pipeline.py
