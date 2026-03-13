"""
ROI Zones CRUD + YOLO class-list endpoint.
"""
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from bson import ObjectId

from app.core.security import get_current_user
from app.database import roi_zones_collection, cameras_collection

router = APIRouter(prefix="/api/roi-zones", tags=["ROI Zones"])


# ── Schemas ──────────────────────────────────────────────────────────

class ROIZoneCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    camera_id: str
    points: list[list[float]]  # [[x,y], ...] normalised 0-1
    trigger_type: str = Field(default="enter")  # enter | exit | loiter | enter_exit
    trigger_classes: list[str] = Field(default=["person", "vehicle"])
    enabled: bool = True
    color: str = Field(default="#FF5722")
    notify: bool = True
    loiter_seconds: int = Field(default=10, ge=1, le=300)


class ROIZoneUpdate(BaseModel):
    name: Optional[str] = None
    points: Optional[list[list[float]]] = None
    trigger_type: Optional[str] = None
    trigger_classes: Optional[list[str]] = None
    enabled: Optional[bool] = None
    color: Optional[str] = None
    notify: Optional[bool] = None
    loiter_seconds: Optional[int] = None


# ── YOLO COCO-80 class names (standard) ─────────────────────────────

COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
    "truck", "boat", "traffic light", "fire hydrant", "stop sign",
    "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep",
    "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard",
    "sports ball", "kite", "baseball bat", "baseball glove", "skateboard",
    "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork",
    "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
    "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv",
    "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave",
    "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase",
    "scissors", "teddy bear", "hair drier", "toothbrush",
]


def _doc_to_resp(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


# ── Routes ───────────────────────────────────────────────────────────

@router.get("/classes")
async def get_yolo_classes(user: dict = Depends(get_current_user)):
    """Return available YOLO detection class names."""
    import logging
    _logger = logging.getLogger(__name__)

    # Strategy 1: Read from the running detection worker's loaded engine
    try:
        from app.workers.yolo_worker import detection_worker, MergedYOLOEngine, YOLOEngine
        engine = detection_worker.engine

        if isinstance(engine, MergedYOLOEngine) and engine.engines:
            # Merged model — collect classes from all sub-models
            all_names: list[str] = []
            for sub in engine.engines:
                if sub.model is not None:
                    all_names.extend(sub.model.names.values())
            if all_names:
                return {"classes": sorted(set(all_names))}

        if isinstance(engine, YOLOEngine) and engine.model is not None:
            names = list(engine.model.names.values())
            return {"classes": sorted(names)}
    except Exception as e:
        _logger.warning(f"Could not read classes from detection worker: {e}")

    # Strategy 2: Load from active_model.json
    try:
        import json, os
        from app.config import settings
        active_path = os.path.join(settings.MODELS_PATH, "active_model.json")
        if os.path.exists(active_path):
            with open(active_path) as f:
                info = json.load(f)

            if info.get("is_merged") and "models" in info:
                # Merged model — load classes from each sub-model's .pt file
                from ultralytics import YOLO
                all_names = []
                for m in info["models"]:
                    pt_path = m.get("pt_path", "")
                    if pt_path and os.path.exists(pt_path):
                        tmp = YOLO(pt_path)
                        all_names.extend(tmp.names.values())
                        del tmp
                if all_names:
                    return {"classes": sorted(set(all_names))}
            else:
                pt_path = info.get("pt_path", "")
                if pt_path and os.path.exists(pt_path):
                    from ultralytics import YOLO
                    tmp_model = YOLO(pt_path)
                    names = list(tmp_model.names.values())
                    _logger.info(f"Loaded classes from active model file: {pt_path}")
                    return {"classes": sorted(names)}
    except Exception as e:
        _logger.warning(f"Could not read classes from active model file: {e}")

    # Strategy 3: Fallback to standard COCO-80 class list
    _logger.info("Falling back to default COCO-80 class list")
    return {"classes": COCO_CLASSES}



@router.get("")
async def list_zones(
    camera_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """List all ROI zones, optionally filtered by camera_id."""
    query = {}
    if camera_id:
        query["camera_id"] = camera_id
    cursor = roi_zones_collection().find(query).sort("created_at", -1)
    zones = await cursor.to_list(length=500)
    return {"zones": [_doc_to_resp(z) for z in zones]}


@router.post("")
async def create_zone(
    zone: ROIZoneCreate,
    user: dict = Depends(get_current_user),
):
    """Create a new ROI zone."""
    # Validate camera exists
    cam = await cameras_collection().find_one({"_id": ObjectId(zone.camera_id)})
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    if len(zone.points) < 3:
        raise HTTPException(status_code=400, detail="A polygon requires at least 3 points")

    now = datetime.now(timezone.utc)
    doc = {
        **zone.model_dump(),
        "created_at": now,
        "updated_at": now,
    }
    result = await roi_zones_collection().insert_one(doc)
    doc["_id"] = result.inserted_id
    return {"zone": _doc_to_resp(doc)}


@router.put("/{zone_id}")
async def update_zone(
    zone_id: str,
    update: ROIZoneUpdate,
    user: dict = Depends(get_current_user),
):
    """Update an existing ROI zone."""
    existing = await roi_zones_collection().find_one({"_id": ObjectId(zone_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Zone not found")

    updates = {k: v for k, v in update.model_dump().items() if v is not None}
    if "points" in updates and len(updates["points"]) < 3:
        raise HTTPException(status_code=400, detail="A polygon requires at least 3 points")

    updates["updated_at"] = datetime.now(timezone.utc)
    await roi_zones_collection().update_one(
        {"_id": ObjectId(zone_id)}, {"$set": updates}
    )

    updated = await roi_zones_collection().find_one({"_id": ObjectId(zone_id)})
    return {"zone": _doc_to_resp(updated)}


@router.delete("/{zone_id}")
async def delete_zone(
    zone_id: str,
    user: dict = Depends(get_current_user),
):
    """Delete an ROI zone."""
    result = await roi_zones_collection().delete_one({"_id": ObjectId(zone_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Zone not found")
    return {"message": "Zone deleted", "id": zone_id}
