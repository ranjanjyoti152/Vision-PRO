"""
Camera management routes – CRUD + live stream control.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, status, Depends, WebSocket, WebSocketDisconnect, Response
from bson import ObjectId

from app.database import cameras_collection
from app.core.security import get_current_user, require_admin
from app.core.websocket import ws_manager
from app.models.camera import CameraCreate, CameraUpdate, CameraResponse
from app.config import settings

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


# ─── CRUD ────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CameraResponse])
async def list_cameras(user: dict = Depends(get_current_user)):
    """List all cameras."""
    cursor = cameras_collection().find()
    cameras = await cursor.to_list(length=500)
    return [_cam_doc_to_response(c) for c in cameras]


@router.get("/streams/all-status")
async def get_all_stream_statuses(user: dict = Depends(get_current_user)):
    """Get health status for all active streams."""
    from app.services.stream_manager import stream_manager
    return stream_manager.get_all_statuses()


@router.post("", response_model=CameraResponse, status_code=status.HTTP_201_CREATED)
async def create_camera(
    camera: CameraCreate,
    admin: dict = Depends(require_admin),
):
    """Add a new camera and auto-start its stream (admin only)."""
    from app.services.stream_manager import stream_manager

    existing = await cameras_collection().find_one({"name": camera.name})
    if existing:
        raise HTTPException(status_code=409, detail="Camera name already exists")

    now = datetime.now(timezone.utc)
    cam_doc = {
        **camera.model_dump(),
        "status": "connecting",
        "created_at": now,
        "updated_at": now,
    }

    result = await cameras_collection().insert_one(cam_doc)
    cam_doc["_id"] = result.inserted_id
    cam_id = str(result.inserted_id)

    # Auto-start stream if enabled
    if camera.enabled:
        fps = min(camera.fps, settings.STREAM_MAX_FPS)
        stream_manager.start_stream(cam_id, camera.rtsp_url, fps)
        await cameras_collection().update_one(
            {"_id": result.inserted_id}, {"$set": {"status": "connecting"}}
        )

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
    """Update camera configuration (admin only). Restarts stream if RTSP URL changes."""
    from app.services.stream_manager import stream_manager

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

    # If RTSP URL or FPS changed, restart the stream
    if "rtsp_url" in update_dict or "fps" in update_dict:
        fps = min(result.get("fps", 25), settings.STREAM_MAX_FPS)
        await stream_manager.restart_stream(camera_id, result["rtsp_url"], fps)

    # If toggled enabled/disabled
    if "enabled" in update_dict:
        if update_dict["enabled"]:
            fps = min(result.get("fps", 25), settings.STREAM_MAX_FPS)
            stream_manager.start_stream(camera_id, result["rtsp_url"], fps)
        else:
            await stream_manager.stop_stream(camera_id)

    return _cam_doc_to_response(result)


@router.delete("/{camera_id}")
async def delete_camera(camera_id: str, admin: dict = Depends(require_admin)):
    """Remove a camera and stop its stream (admin only)."""
    from app.services.stream_manager import stream_manager

    await stream_manager.stop_stream(camera_id)
    result = await cameras_collection().delete_one({"_id": ObjectId(camera_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Camera not found")
    return {"message": "Camera deleted successfully"}


# ─── Stream Control ──────────────────────────────────────────────────────

@router.post("/{camera_id}/start")
async def start_stream(camera_id: str, admin: dict = Depends(require_admin)):
    """Manually start a camera stream (admin only)."""
    from app.services.stream_manager import stream_manager

    cam = await cameras_collection().find_one({"_id": ObjectId(camera_id)})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    if stream_manager.is_streaming(camera_id):
        return {"message": "Stream already running", "camera_id": camera_id}

    fps = min(cam.get("fps", 25), settings.STREAM_MAX_FPS)
    stream_manager.start_stream(camera_id, cam["rtsp_url"], fps)

    await cameras_collection().update_one(
        {"_id": ObjectId(camera_id)}, {"$set": {"status": "connecting"}}
    )
    return {"message": "Stream started", "camera_id": camera_id}


@router.post("/{camera_id}/stop")
async def stop_stream(camera_id: str, admin: dict = Depends(require_admin)):
    """Manually stop a camera stream (admin only)."""
    from app.services.stream_manager import stream_manager

    if not stream_manager.is_streaming(camera_id):
        return {"message": "Stream not running", "camera_id": camera_id}

    await stream_manager.stop_stream(camera_id)

    await cameras_collection().update_one(
        {"_id": ObjectId(camera_id)}, {"$set": {"status": "offline"}}
    )
    return {"message": "Stream stopped", "camera_id": camera_id}


@router.get("/{camera_id}/snapshot")
async def get_snapshot(camera_id: str, user: dict = Depends(get_current_user)):
    """Return the latest JPEG frame from a camera stream."""
    from app.services.stream_manager import stream_manager

    # Verify camera exists
    cam = await cameras_collection().find_one({"_id": ObjectId(camera_id)})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    jpeg = stream_manager.get_snapshot(camera_id)
    if jpeg is None:
        raise HTTPException(status_code=503, detail="No frame available – stream may be offline")

    return Response(content=jpeg, media_type="image/jpeg")


@router.get("/{camera_id}/stream-status")
async def get_stream_status(camera_id: str, user: dict = Depends(get_current_user)):
    """Get the health/status of a camera stream."""
    from app.services.stream_manager import stream_manager

    health = stream_manager.get_stream_status(camera_id)
    if health is None:
        return {
            "camera_id": camera_id,
            "connected": False,
            "fps_actual": 0,
            "frame_count": 0,
            "error_count": 0,
            "reconnect_count": 0,
            "last_error": "Stream not started",
            "uptime_seconds": 0,
        }
    return health


# ─── WebSocket Live Feed ─────────────────────────────────────────────────

@router.websocket("/ws/{camera_id}/live")
async def websocket_live_feed(websocket: WebSocket, camera_id: str):
    """
    WebSocket endpoint for live MJPEG camera feed.
    Binary frames are JPEG-encoded and sent as bytes.
    The StreamManager broadcasts to this channel automatically.
    """
    channel = f"camera:{camera_id}"
    await ws_manager.connect(websocket, channel)
    try:
        # Keep connection alive — just wait for disconnect
        while True:
            # We don't expect messages from the client, but read to detect disconnect
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(websocket, channel)
