"""
Camera management routes.
"""
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, status, Depends, WebSocket, WebSocketDisconnect
from bson import ObjectId

from app.database import cameras_collection
from app.core.security import get_current_user, require_admin
from app.core.websocket import ws_manager
from app.models.camera import CameraCreate, CameraUpdate, CameraResponse

router = APIRouter(prefix="/api/cameras", tags=["Cameras"])


def _cam_doc_to_response(cam: dict) -> CameraResponse:
    """Convert MongoDB camera document to response model."""
    return CameraResponse(
        id=str(cam["_id"]),
        name=cam["name"],
        rtsp_url=cam["rtsp_url"],
        location=cam.get("location", ""),
        enabled=cam.get("enabled", True),
        detection_config=cam.get("detection_config", {}),
        recording_config=cam.get("recording_config", {}),
        resolution=cam.get("resolution", {"width": 1920, "height": 1080}),
        fps=cam.get("fps", 25),
        status=cam.get("status", "offline"),
        created_at=cam["created_at"],
        updated_at=cam.get("updated_at", cam["created_at"]),
    )


@router.get("", response_model=list[CameraResponse])
async def list_cameras(user: dict = Depends(get_current_user)):
    """List all cameras."""
    cursor = cameras_collection().find()
    cameras = await cursor.to_list(length=500)
    return [_cam_doc_to_response(c) for c in cameras]


@router.post("", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
async def create_camera(
    camera: CameraCreate,
    admin: dict = Depends(require_admin),
):
    """Add a new camera (admin only)."""
    # Check for duplicate name
    existing = await cameras_collection().find_one({"name": camera.name})
    if existing:
        raise HTTPException(status_code=409, detail="Camera name already exists")

    now = datetime.now(timezone.utc)
    cam_doc = {
        **camera.model_dump(),
        "status": "offline",
        "created_at": now,
        "updated_at": now,
    }

    result = await cameras_collection().insert_one(cam_doc)
    cam_doc["_id"] = result.inserted_id
    return _cam_doc_to_response(cam_doc)


@router.get("/{camera_id}", response_model=CameraResponse)
async def get_camera(camera_id: str, user: dict = Depends(get_current_user)):
    """Get camera details by ID."""
    cam = await cameras_collection().find_one({"_id": ObjectId(camera_id)})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return _cam_doc_to_response(cam)


@router.put("/{camera_id}", response_model=CameraResponse)
async def update_camera(
    camera_id: str,
    update: CameraUpdate,
    admin: dict = Depends(require_admin),
):
    """Update camera configuration (admin only)."""
    update_dict = {
        k: v for k, v in update.model_dump(exclude_unset=True).items() if v is not None
    }
    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_dict["updated_at"] = datetime.now(timezone.utc)

    result = await cameras_collection().find_one_and_update(
        {"_id": ObjectId(camera_id)},
        {"$set": update_dict},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Camera not found")

    return _cam_doc_to_response(result)


@router.delete("/{camera_id}")
async def delete_camera(camera_id: str, admin: dict = Depends(require_admin)):
    """Remove a camera (admin only)."""
    result = await cameras_collection().delete_one({"_id": ObjectId(camera_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Camera not found")
    return {"message": "Camera deleted successfully"}
