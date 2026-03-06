"""
AI model management routes.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, BackgroundTasks
from bson import ObjectId
import os
import json
import asyncio
import logging
import aiofiles

logger = logging.getLogger(__name__)

from app.database import ai_models_collection
from app.core.security import get_current_user, require_admin
from app.models.ai_model import (
    AIModelResponse,
    ModelDownloadRequest,
    ModelUploadMeta,
    AVAILABLE_YOLO_MODELS,
)
from app.config import settings

router = APIRouter(prefix="/api/models", tags=["AI Models"])

# Shared active-model config — written here, read by the DeepStream entrypoint
ACTIVE_MODEL_FILE = os.path.join(settings.MODELS_PATH, "active_model.json")


def _model_doc_to_response(doc: dict) -> AIModelResponse:
    return AIModelResponse(
        id=str(doc["_id"]),
        name=doc["name"],
        type=doc["type"],
        version=doc["version"],
        file_path=doc.get("file_path", ""),
        file_size_bytes=doc.get("file_size_bytes", 0),
        is_default=doc.get("is_default", False),
        is_custom=doc.get("is_custom", False),
        metadata=doc.get("metadata", {}),
        created_at=doc["created_at"],
    )


def _write_active_model(pt_path: str, model_name: str) -> None:
    """Persist the active model selection to a shared JSON file.

    Includes the ONNX path so the Jetson entrypoint knows where to find/create it.
    """
    os.makedirs(settings.MODELS_PATH, exist_ok=True)
    onnx_dir = os.path.join(settings.MODELS_PATH, "onnx")
    os.makedirs(onnx_dir, exist_ok=True)
    basename = os.path.splitext(os.path.basename(pt_path))[0]
    data = {
        "pt_path": pt_path,
        "onnx_path": os.path.join(onnx_dir, f"{basename}.onnx"),
        "engine_path": pt_path.replace(".pt", ".engine"),
        "model_name": model_name,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    with open(ACTIVE_MODEL_FILE, "w") as f:
        json.dump(data, f, indent=2)


@router.get("", response_model=list[AIModelResponse])
async def list_models(user: dict = Depends(get_current_user)):
    """List all downloaded/uploaded AI models."""
    cursor = ai_models_collection().find().sort("created_at", -1)
    models = await cursor.to_list(length=100)
    return [_model_doc_to_response(m) for m in models]


@router.get("/available")
async def list_available_models(user: dict = Depends(get_current_user)):
    """List YOLO models available for download."""
    return AVAILABLE_YOLO_MODELS


@router.get("/active")
async def get_active_model(user: dict = Depends(get_current_user)):
    """Return the currently active model (read from shared config file)."""
    if os.path.exists(ACTIVE_MODEL_FILE):
        with open(ACTIVE_MODEL_FILE) as f:
            return json.load(f)
    # Default fallback
    onnx_dir = os.path.join(settings.MODELS_PATH, "onnx")
    return {
        "pt_path": str(settings.YOLO_MODELS_DIR / "yolov8n.pt"),
        "onnx_path": os.path.join(onnx_dir, "yolov8n.onnx"),
        "engine_path": str(settings.YOLO_MODELS_DIR / "yolov8n.engine"),
        "model_name": "yolov8n",
        "updated_at": None,
    }


# ─── Background download worker ─────────────────────────────────────────────

async def _update_progress(model_id: str, **kwargs):
    """Helper to update model progress in MongoDB."""
    await ai_models_collection().update_one(
        {"_id": ObjectId(model_id)},
        {"$set": {f"metadata.{k}": v for k, v in kwargs.items()}},
    )


def _download_model_sync(model_name: str, dest_path: str) -> int:
    """Synchronous download using ultralytics (runs in thread).

    Ultralytics may rename models (e.g. yolov5m → yolov5mu), so we
    use model.ckpt_path to find the actual downloaded file.
    """
    from ultralytics import YOLO
    import shutil
    import glob

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)

    # Let ultralytics download the model
    model = YOLO(f"{model_name}.pt")

    # 1. Try model.ckpt_path (most reliable)
    actual_path = getattr(model, 'ckpt_path', None)
    if actual_path:
        actual_path = str(actual_path)

    # 2. Find the actual file and copy to dest
    if actual_path and os.path.exists(actual_path):
        if os.path.abspath(actual_path) != os.path.abspath(dest_path):
            shutil.copy2(actual_path, dest_path)
    elif not os.path.exists(dest_path):
        # 3. Fallback: search CWD for the file ultralytics may have downloaded
        candidates = [
            f"{model_name}.pt",                    # exact name
            *glob.glob(f"{model_name}*.pt"),        # name variants (e.g. yolov5mu.pt)
        ]
        for candidate in candidates:
            if os.path.exists(candidate):
                shutil.copy2(candidate, dest_path)
                break

    return os.path.getsize(dest_path) if os.path.exists(dest_path) else 0


async def _background_download(model_id: str, model_name: str):
    """Background task: download model, then optionally convert to ONNX/TRT."""
    dest_path = str(settings.YOLO_MODELS_DIR / f"{model_name}.pt")
    try:
        # Phase 1: Download
        await _update_progress(model_id, status="downloading", progress=10, phase="Downloading model...")

        loop = asyncio.get_event_loop()
        file_size = await loop.run_in_executor(None, _download_model_sync, model_name, dest_path)

        if not os.path.exists(dest_path) or file_size == 0:
            await _update_progress(model_id, status="error", progress=0, phase="Download failed")
            return

        await _update_progress(model_id, status="downloading", progress=60, phase="Download complete")
        await ai_models_collection().update_one(
            {"_id": ObjectId(model_id)},
            {"$set": {"file_path": dest_path, "file_size_bytes": file_size}},
        )

        # Phase 2: ONNX conversion (Jetson only)
        if settings.IS_JETSON:
            await _update_progress(model_id, status="converting", progress=65, phase="Converting to ONNX format...")
            try:
                from app.deepstream.onnx_convert import convert_pt_to_onnx, convert_onnx_to_engine
                onnx_dir = os.path.join(settings.MODELS_PATH, "onnx")
                os.makedirs(onnx_dir, exist_ok=True)
                basename = os.path.splitext(os.path.basename(dest_path))[0]
                onnx_path = os.path.join(onnx_dir, f"{basename}.onnx")
                await loop.run_in_executor(None, convert_pt_to_onnx, dest_path, onnx_path)
                await _update_progress(model_id, status="converting", progress=75, phase="ONNX conversion complete")

                # Phase 3: TensorRT engine build (Jetson)
                engine_path = os.path.join(str(settings.YOLO_MODELS_DIR), f"{basename}.engine")
                if not os.path.exists(engine_path):
                    await _update_progress(model_id, status="converting", progress=78,
                                           phase="Building TensorRT engine (5-15 min)...")
                    await loop.run_in_executor(
                        None, convert_onnx_to_engine, onnx_path, engine_path, True,
                        int(os.environ.get("TRT_WORKSPACE_GB", "2")), dest_path,
                    )
                    await _update_progress(model_id, status="converting", progress=98,
                                           phase="TensorRT engine built ✅")
                else:
                    await _update_progress(model_id, status="converting", progress=98,
                                           phase="TensorRT engine already exists ✅")
            except Exception as e:
                logger.warning(f"Conversion failed for {model_name}: {e}")
                await _update_progress(model_id, status="converting", progress=98,
                                       phase=f"Conversion skipped: {str(e)[:80]}")

        # Final: Ready
        await _update_progress(model_id, status="ready", progress=100, phase="Ready")
        logger.info(f"✅ Model {model_name} download complete")

    except Exception as e:
        logger.error(f"❌ Download failed for {model_name}: {e}")
        await _update_progress(model_id, status="error", progress=0, phase=f"Error: {str(e)[:100]}")


@router.post("/download")
async def download_model(
    request: ModelDownloadRequest,
    background_tasks: BackgroundTasks,
    admin: dict = Depends(require_admin),
):
    """Download a YOLO model. Runs download in background with progress tracking."""
    existing = await ai_models_collection().find_one({"name": request.model_name})
    if existing:
        raise HTTPException(status_code=409, detail="Model already downloaded")

    now = datetime.now(timezone.utc)
    doc = {
        "name": request.model_name,
        "type": "yolo",
        "version": request.model_name.replace("yolo", "").replace("v", ""),
        "file_path": str(settings.YOLO_MODELS_DIR / f"{request.model_name}.pt"),
        "file_size_bytes": 0,
        "is_default": False,
        "is_custom": False,
        "metadata": {"status": "queued", "progress": 0, "phase": "Queued for download..."},
        "created_at": now,
    }

    result = await ai_models_collection().insert_one(doc)
    model_id = str(result.inserted_id)

    # Fire background download
    background_tasks.add_task(_background_download, model_id, request.model_name)

    return {
        "message": f"Download started for {request.model_name}",
        "model_id": model_id,
    }


@router.get("/{model_id}/progress")
async def get_model_progress(
    model_id: str,
    user: dict = Depends(get_current_user),
):
    """Get download/conversion progress for a model."""
    model = await ai_models_collection().find_one({"_id": ObjectId(model_id)})
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    meta = model.get("metadata", {})
    return {
        "model_id": model_id,
        "name": model["name"],
        "status": meta.get("status", "unknown"),
        "progress": meta.get("progress", 0),
        "phase": meta.get("phase", ""),
        "file_size_bytes": model.get("file_size_bytes", 0),
    }


@router.put("/{model_id}/default")
async def set_default_model(
    model_id: str,
    admin: dict = Depends(require_admin),
):
    """
    Set a model as the default detection model.
    Also writes active_model.json so the DeepStream container picks it up on restart.
    """
    model = await ai_models_collection().find_one({"_id": ObjectId(model_id)})
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # Unset current default of same type
    await ai_models_collection().update_many(
        {"type": model["type"], "is_default": True},
        {"$set": {"is_default": False}},
    )

    # Set new default
    await ai_models_collection().update_one(
        {"_id": ObjectId(model_id)},
        {"$set": {"is_default": True}},
    )

    # Write to shared volume config so DeepStream picks it up on restart
    pt_path = model.get("file_path", str(settings.YOLO_MODELS_DIR / f"{model['name']}.pt"))
    _write_active_model(pt_path, model["name"])

    # On Jetson: trigger ONNX conversion in the background so it's ready
    # before the user restarts the DeepStream container
    onnx_converted = False
    if settings.IS_JETSON:
        try:
            from app.deepstream.onnx_convert import convert_pt_to_onnx
            onnx_dir = os.path.join(settings.MODELS_PATH, "onnx")
            basename = os.path.splitext(os.path.basename(pt_path))[0]
            onnx_path = os.path.join(onnx_dir, f"{basename}.onnx")
            convert_pt_to_onnx(pt_path, onnx_path)
            onnx_converted = True
        except Exception as e:
            pass  # ONNX conversion will happen at DeepStream startup too

    # Also hot-reload the standard YOLO worker if not using DeepStream
    if not settings.DEEPSTREAM_ENABLED:
        try:
            from app.workers.yolo_worker import detection_worker
            await detection_worker.reload_model(pt_path)
        except Exception as e:
            pass  # Non-critical for standard mode

    return {
        "message": f"{model['name']} set as default",
        "deepstream_restart_required": settings.DEEPSTREAM_ENABLED,
        "jetson_mode": settings.IS_JETSON,
        "onnx_pre_converted": onnx_converted,
        "active_model_file": ACTIVE_MODEL_FILE,
    }


@router.post("/deepstream/reload")
async def reload_deepstream(admin: dict = Depends(require_admin)):
    """
    Restart the DeepStream Docker container so it picks up the new model.
    Requires the Docker socket to be mounted: /var/run/docker.sock
    """
    if not settings.DEEPSTREAM_ENABLED:
        return {"message": "DeepStream is not enabled — using OpenCV pipeline", "status": "skipped"}

    try:
        import docker  # pip install docker
        client = docker.from_env()
        # Container name is configurable; default includes Jetson suffix when in Jetson mode
        container_name = os.environ.get(
            "DEEPSTREAM_CONTAINER_NAME",
            "visionpro-deepstream-jetson" if settings.IS_JETSON else "visionpro-deepstream"
        )
        container = client.containers.get(container_name)
        container.restart(timeout=5)
        return {
            "message": "DeepStream container restarting — new model will be loaded",
            "container": container.name,
            "status": "restarting",
        }
    except Exception as e:
        container_name = os.environ.get(
            "DEEPSTREAM_CONTAINER_NAME",
            "visionpro-deepstream-jetson" if settings.IS_JETSON else "visionpro-deepstream"
        )
        raise HTTPException(
            status_code=503,
            detail=(
                f"Could not restart DeepStream container: {e}. "
                f"Run manually: docker restart {container_name}"
            ),
        )


@router.post("/upload")
async def upload_custom_model(
    file: UploadFile = File(...),
    name: str = "custom_model",
    admin: dict = Depends(require_admin),
):
    """Upload a custom YOLO model."""
    os.makedirs(settings.YOLO_MODELS_DIR, exist_ok=True)
    filepath = str(settings.YOLO_MODELS_DIR / file.filename)

    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    file_size = os.path.getsize(filepath)
    now = datetime.now(timezone.utc)

    doc = {
        "name": name,
        "type": "yolo",
        "version": "custom",
        "file_path": filepath,
        "file_size_bytes": file_size,
        "is_default": False,
        "is_custom": True,
        "metadata": {"original_filename": file.filename},
        "created_at": now,
    }

    result = await ai_models_collection().insert_one(doc)
    doc["_id"] = result.inserted_id
    return _model_doc_to_response(doc)


@router.delete("/{model_id}")
async def delete_model(model_id: str, admin: dict = Depends(require_admin)):
    """Delete an AI model."""
    model = await ai_models_collection().find_one({"_id": ObjectId(model_id)})
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    if model.get("file_path") and os.path.exists(model["file_path"]):
        os.remove(model["file_path"])

    await ai_models_collection().delete_one({"_id": ObjectId(model_id)})
    return {"message": "Model deleted successfully"}


