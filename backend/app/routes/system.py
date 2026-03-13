"""
System monitoring routes – GPU, CPU, RAM, storage stats.
"""
import psutil
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
import asyncio
import logging

from app.core.security import get_current_user
from app.core.gpu import get_gpu_info, is_gpu_available, get_gpu_count
from app.core.websocket import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system", tags=["System Monitor"])


@router.get("/stats")
async def get_system_stats(user: dict = Depends(get_current_user)):
    """Get current system resource statistics."""
    # CPU
    cpu_percent = psutil.cpu_percent(interval=0.5)
    cpu_count = psutil.cpu_count()
    cpu_freq = psutil.cpu_freq()

    # Memory
    mem = psutil.virtual_memory()

    # Disk
    disk = psutil.disk_usage("/")

    # GPU
    gpus = get_gpu_info()
    gpu_data = [
        {
            "id": g.id,
            "name": g.name,
            "memory_total_mb": g.memory_total_mb,
            "memory_used_mb": g.memory_used_mb,
            "memory_free_mb": g.memory_free_mb,
            "gpu_utilization": g.gpu_utilization,
            "memory_utilization": g.memory_utilization,
            "temperature": g.temperature,
        }
        for g in gpus
    ]

    return {
        "cpu": {
            "percent": cpu_percent,
            "cores": cpu_count,
            "frequency_mhz": cpu_freq.current if cpu_freq else 0,
        },
        "memory": {
            "total_gb": round(mem.total / (1024**3), 2),
            "used_gb": round(mem.used / (1024**3), 2),
            "available_gb": round(mem.available / (1024**3), 2),
            "percent": mem.percent,
        },
        "disk": {
            "total_gb": round(disk.total / (1024**3), 2),
            "used_gb": round(disk.used / (1024**3), 2),
            "free_gb": round(disk.free / (1024**3), 2),
            "percent": disk.percent,
        },
        "gpu": {
            "available": is_gpu_available(),
            "count": get_gpu_count(),
            "devices": gpu_data,
        },
    }


@router.get("/info")
async def get_system_info(user: dict = Depends(get_current_user)):
    """Get overall system information."""
    import platform

    return {
        "platform": platform.system(),
        "platform_release": platform.release(),
        "architecture": platform.machine(),
        "processor": platform.processor(),
        "python_version": platform.python_version(),
        "cpu_count": psutil.cpu_count(),
        "ram_total_gb": round(psutil.virtual_memory().total / (1024**3), 2),
        "gpu_available": is_gpu_available(),
        "gpu_count": get_gpu_count(),
        "gpu_devices": [
            {"id": g.id, "name": g.name, "vram_mb": g.memory_total_mb}
            for g in get_gpu_info()
        ],
    }


@router.websocket("/ws/monitor")
async def system_monitor_websocket(websocket: WebSocket):
    """Live system metrics via WebSocket."""
    channel = "system_monitor"
    await ws_manager.connect(websocket, channel)
    try:
        while True:
            cpu_percent = psutil.cpu_percent(interval=0)
            mem = psutil.virtual_memory()
            gpus = get_gpu_info()

            data = {
                "cpu_percent": cpu_percent,
                "ram_percent": mem.percent,
                "ram_used_gb": round(mem.used / (1024**3), 2),
                "gpus": [
                    {
                        "id": g.id,
                        "gpu_util": g.gpu_utilization,
                        "mem_util": g.memory_utilization,
                        "temp": g.temperature,
                    }
                    for g in gpus
                ],
            }

            await websocket.send_json(data)
            await asyncio.sleep(2)  # Update every 2 seconds
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket, channel)


@router.post("/backfill-embeddings")
async def backfill_event_embeddings(user: dict = Depends(get_current_user)):
    """Backfill all existing MongoDB events into Qdrant vector DB."""
    from app.database import events_collection, cameras_collection
    from app.vector_db import build_event_text, upsert_event_embedding, get_qdrant
    from bson import ObjectId

    if get_qdrant() is None:
        return {"status": "error", "message": "Qdrant is not connected"}

    # Pre-fetch all camera names
    camera_names = {}
    async for cam in cameras_collection().find():
        camera_names[str(cam["_id"])] = cam.get("name", str(cam["_id"]))

    cursor = events_collection().find().sort("timestamp", -1)
    total = 0
    embedded = 0
    failed = 0

    async for event_doc in cursor:
        total += 1
        try:
            cam_id = event_doc.get("camera_id", "")
            camera_name = camera_names.get(cam_id, cam_id)
            text = build_event_text(event_doc, camera_name)

            metadata = {
                "event_type": event_doc.get("event_type", ""),
                "camera_id": cam_id,
                "camera_name": camera_name,
                "confidence": event_doc.get("confidence", 0),
                "timestamp": event_doc.get("timestamp", "").isoformat() if event_doc.get("timestamp") else "",
                "ai_summary": event_doc.get("ai_summary", ""),
                "snapshot_path": event_doc.get("snapshot_path", ""),
                "detected_objects": [obj.get("class", obj.get("className", "")) for obj in event_doc.get("detected_objects", [])],
            }

            point_id = str(event_doc["_id"])
            ok = await upsert_event_embedding(point_id, text, metadata)
            if ok:
                embedded += 1
            else:
                failed += 1
        except Exception as e:
            failed += 1
            logger.warning(f"Backfill failed for event {event_doc.get('_id')}: {e}")

    logger.info(f"📌 Backfill complete: {embedded}/{total} events embedded ({failed} failed)")
    return {
        "status": "success",
        "total_events": total,
        "embedded": embedded,
        "failed": failed,
    }
