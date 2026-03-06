"""
ONNX Model Conversion — Jetson-specific conversion pipeline.

On Jetson (ARM64), TensorRT engines must be built on-device.
The standard path is:
    .pt → .onnx  (ultralytics export, portable)
    .onnx → .engine  (trtexec or TensorRT Python API, device-specific FP16)

This module handles both steps and is used by the Jetson entrypoint
and by the backend API when a model is set as default in Jetson mode.
"""
import os
import shutil
import subprocess
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Defaults from environment
DEFAULT_PT   = os.environ.get("YOLO_PT_PATH",    "/models/yolo/yolov8n.pt")
DEFAULT_ONNX = os.environ.get("ONNX_MODEL_PATH", "/models/onnx/yolov8n.onnx")
DEFAULT_ENG  = os.environ.get("TRT_ENGINE_PATH",  "/models/yolo/yolov8n.engine")
TRT_WORKSPACE_GB = int(os.environ.get("TRT_WORKSPACE_GB", "2"))


def convert_pt_to_onnx(
    pt_path: str = DEFAULT_PT,
    onnx_path: str = DEFAULT_ONNX,
    imgsz: int = 640,
    opset: int = 12,
    simplify: bool = True,
) -> str:
    """
    Convert a YOLO .pt model to ONNX format.

    Args:
        pt_path:   Path to the .pt weights file.
        onnx_path: Desired output path for the .onnx file.
        imgsz:     Input image size (square).
        opset:     ONNX opset version (12 works well with TRT 8.6+).
        simplify:  Run onnxsim to simplify the graph.

    Returns:
        Path to the generated .onnx file.
    """
    if os.path.exists(onnx_path):
        logger.info(f"✅ ONNX model already exists: {onnx_path}")
        return onnx_path

    # Download the model if .pt doesn't exist
    if not os.path.exists(pt_path):
        logger.info(f"📥 Downloading model weights: {pt_path}")
        from ultralytics import YOLO
        model_name = Path(pt_path).stem  # e.g. "yolov8n"
        YOLO(model_name)  # triggers auto-download
        downloaded = f"{model_name}.pt"
        if os.path.exists(downloaded):
            os.makedirs(os.path.dirname(pt_path), exist_ok=True)
            shutil.move(downloaded, pt_path)

    logger.info(f"⚙️  Converting {pt_path} → ONNX (opset={opset}, imgsz={imgsz})...")
    from ultralytics import YOLO
    model = YOLO(pt_path)
    result = model.export(
        format="onnx",
        imgsz=imgsz,
        opset=opset,
        simplify=simplify,
    )

    # Move to the requested output path if ultralytics wrote it elsewhere
    if result and str(result) != onnx_path:
        os.makedirs(os.path.dirname(onnx_path), exist_ok=True)
        shutil.move(str(result), onnx_path)

    # Also check the default ultralytics output location
    default_out = pt_path.replace(".pt", ".onnx")
    if default_out != onnx_path and os.path.exists(default_out):
        os.makedirs(os.path.dirname(onnx_path), exist_ok=True)
        shutil.move(default_out, onnx_path)

    logger.info(f"✅ ONNX model saved: {onnx_path}")
    return onnx_path


def convert_onnx_to_engine(
    onnx_path: str = DEFAULT_ONNX,
    engine_path: str = DEFAULT_ENG,
    fp16: bool = True,
    workspace_gb: int = TRT_WORKSPACE_GB,
    pt_path: str = DEFAULT_PT,
) -> str:
    """
    Convert an ONNX model to a TensorRT engine using trtexec.

    This must run ON the target device (Jetson) because engines are
    architecture-specific.

    Args:
        onnx_path:    Path to the .onnx model.
        engine_path:  Desired output path for the .engine file.
        fp16:         Enable FP16 inference (recommended for Jetson).
        workspace_gb: TensorRT builder workspace in GB.
        pt_path:      Path to original .pt file (used by fallback conversion).

    Returns:
        Path to the generated .engine file.
    """
    if os.path.exists(engine_path):
        logger.info(f"✅ TensorRT engine already exists: {engine_path}")
        return engine_path

    if not os.path.exists(onnx_path):
        raise FileNotFoundError(f"ONNX model not found: {onnx_path}")

    os.makedirs(os.path.dirname(engine_path), exist_ok=True)

    # Try trtexec first (fastest, most reliable on Jetson)
    trtexec_paths = [
        "/usr/src/tensorrt/bin/trtexec",
        "/usr/bin/trtexec",
        "trtexec",
    ]

    trtexec_bin = None
    for p in trtexec_paths:
        if os.path.exists(p) or shutil.which(p):
            trtexec_bin = p
            break

    if trtexec_bin:
        # TensorRT 10.x uses --memPoolSize, older versions use --workspace
        # Try --memPoolSize first (TRT 10.x / JetPack 6.x), fall back to --workspace
        cmd = [
            trtexec_bin,
            f"--onnx={onnx_path}",
            f"--saveEngine={engine_path}",
            f"--memPoolSize=workspace:{workspace_gb}G",
        ]
        if fp16:
            cmd.append("--fp16")

        logger.info(f"⚙️  Running trtexec: {' '.join(cmd)}")
        logger.info(f"   This may take 5-15 minutes on Jetson...")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600,  # 1 hour max
        )

        if result.returncode == 0 and os.path.exists(engine_path):
            logger.info(f"✅ TensorRT engine built: {engine_path}")
            return engine_path
        else:
            logger.warning(f"trtexec failed (rc={result.returncode}): {result.stderr[-500:]}")
            logger.info("Falling back to ultralytics PT → engine conversion...")

    # Fallback: use ultralytics to export directly from .pt → .engine
    # (ultralytics cannot export from .onnx, only from .pt)
    if pt_path and os.path.exists(pt_path):
        try:
            logger.info(f"⚙️  Fallback: Converting via ultralytics ({pt_path} → engine)...")
            from ultralytics import YOLO
            model = YOLO(pt_path)
            model.export(
                format="engine",
                imgsz=640,
                half=fp16,
                device=0,
                workspace=workspace_gb,
                verbose=False,
            )
            generated = pt_path.replace(".pt", ".engine")
            if generated != engine_path and os.path.exists(generated):
                shutil.move(generated, engine_path)
            if os.path.exists(engine_path):
                logger.info(f"✅ TensorRT engine built (fallback): {engine_path}")
                return engine_path
        except Exception as e:
            logger.error(f"❌ Fallback engine conversion also failed: {e}")

    raise RuntimeError(
        f"Failed to build TensorRT engine from {onnx_path}. "
        "Ensure trtexec is available or ultralytics + torch are installed."
    )


def convert_if_needed_jetson(
    pt_path: str = DEFAULT_PT,
    onnx_path: str = DEFAULT_ONNX,
    engine_path: str = DEFAULT_ENG,
) -> str:
    """
    Full Jetson conversion pipeline: .pt → .onnx → .engine

    Checks each step and only runs conversions that haven't been done yet.

    Returns:
        Path to the TensorRT engine file.
    """
    logger.info("🔧 Jetson model conversion check...")

    # Step 1: PT → ONNX
    onnx_path = convert_pt_to_onnx(pt_path, onnx_path)

    # Step 2: ONNX → TensorRT Engine
    engine_path = convert_onnx_to_engine(onnx_path, engine_path, pt_path=pt_path)

    return engine_path


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    convert_if_needed_jetson()
