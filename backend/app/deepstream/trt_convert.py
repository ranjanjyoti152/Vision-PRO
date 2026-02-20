"""
TensorRT model conversion — runs inside the DeepStream container at startup.
Converts yolov8n.pt → yolov8n.engine (FP16, imgsz=640).
"""
import os
import shutil
import logging

logger = logging.getLogger(__name__)

MODEL_PT   = os.environ.get("YOLO_PT_PATH", "/models/yolo/yolov8n.pt")
ENGINE_OUT = os.environ.get("TRT_ENGINE_PATH", "/models/yolo/yolov8n.engine")


def convert_if_needed() -> str:
    """Convert .pt → .engine if the engine file doesn't exist yet."""
    if os.path.exists(ENGINE_OUT):
        logger.info(f"✅ TensorRT engine already exists: {ENGINE_OUT}")
        return ENGINE_OUT

    if not os.path.exists(MODEL_PT):
        logger.info(f"📥 Downloading yolov8n.pt ...")
        from ultralytics import YOLO
        YOLO("yolov8n")  # triggers auto-download to current dir
        if os.path.exists("yolov8n.pt"):
            os.makedirs(os.path.dirname(MODEL_PT), exist_ok=True)
            shutil.move("yolov8n.pt", MODEL_PT)

    logger.info(f"⚙️  Converting {MODEL_PT} → TensorRT engine (FP16) ...")
    from ultralytics import YOLO
    model = YOLO(MODEL_PT)
    model.export(
        format="engine",
        imgsz=640,
        half=True,       # FP16 — halves VRAM, ~2× faster on Ampere+
        device=0,
        workspace=4,     # GB for TensorRT optimization workspace
        verbose=False,
    )
    # Ultralytics writes to the same dir as the .pt file
    generated = MODEL_PT.replace(".pt", ".engine")
    if generated != ENGINE_OUT:
        os.makedirs(os.path.dirname(ENGINE_OUT), exist_ok=True)
        shutil.move(generated, ENGINE_OUT)

    logger.info(f"✅ Engine saved: {ENGINE_OUT}")
    return ENGINE_OUT


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    convert_if_needed()
