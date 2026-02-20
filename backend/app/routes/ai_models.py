"""
AI model management routes.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from bson import ObjectId
import os
import json
import aiofiles

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
    """Persist the active model selection to a shared JSON file."""
    os.makedirs(settings.MODELS_PATH, exist_ok=True)
    data = {
        "pt_path": pt_path,
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
    return {
        "pt_path": str(settings.YOLO_MODELS_DIR / "yolov8n.pt"),
        "engine_path": str(settings.YOLO_MODELS_DIR / "yolov8n.engine"),
        "model_name": "yolov8n",
        "updated_at": None,
    }


@router.post("/download")
async def download_model(
    request: ModelDownloadRequest,
    admin: dict = Depends(require_admin),
):
    """Download a YOLO model. Runs in background."""
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
        "metadata": {"status": "downloading"},
        "created_at": now,
    }

    result = await ai_models_collection().insert_one(doc)
    return {
        "message": f"Download started for {request.model_name}",
        "model_id": str(result.inserted_id),
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
        "active_model_file": ACTIVE_MODEL_FILE,
    }


@router.post("/deepstream/reload")
async def reload_deepstream(admin: dict = Depends(require_admin)):
    """
    Restart the DeepStream Docker container so it picks up the new model.
    Requires the Docker socket to be mounted: /var/run/docker.sock
    """
    if not settings.DEEPSTREAM_ENABLED:
        raise HTTPException(status_code=400, detail="DeepStream is not enabled")

    try:
        import docker  # pip install docker
        client = docker.from_env()
        container = client.containers.get("visionpro-deepstream")
        container.restart(timeout=5)
        return {
            "message": "DeepStream container restarting — new model will be loaded",
            "container": container.name,
            "status": "restarting",
        }
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Could not restart DeepStream container: {e}. "
                "Run manually: docker restart visionpro-deepstream"
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


