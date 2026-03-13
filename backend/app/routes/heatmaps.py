"""
Heatmap routes – Activity heatmap data generated from detection bounding boxes.
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from bson import ObjectId

from app.database import events_collection, cameras_collection
from app.core.security import get_current_user

router = APIRouter(prefix="/api/heatmaps", tags=["Heatmaps"])


def _extract_event_bboxes(event: dict) -> list[dict]:
    """Return all usable bounding boxes from an event.

    Prefer per-object boxes from detected_objects (merged-model friendly),
    and fall back to the legacy primary bounding_box.
    """
    boxes: list[dict] = []

    for obj in event.get("detected_objects", []) or []:
        bbox = obj.get("bbox") if isinstance(obj, dict) else None
        if not isinstance(bbox, dict):
            continue
        if all(k in bbox for k in ("x", "y", "w", "h")):
            boxes.append(bbox)

    if boxes:
        return boxes

    bbox = event.get("bounding_box")
    if isinstance(bbox, dict) and all(k in bbox for k in ("x", "y", "w", "h")):
        return [bbox]

    return []


@router.get("/{camera_id}")
async def get_heatmap(
    camera_id: str,
    hours: int = Query(24, ge=1, le=168),
    grid_w: int = Query(32, ge=8, le=64),
    grid_h: int = Query(18, ge=4, le=36),
    user: dict = Depends(get_current_user),
):
    """
    Generate a bounding-box based activity heatmap at grid_w x grid_h resolution.
    Returns a flat grid where each cell holds a detection count.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    # Lookup camera for resolution info (allows % normalisation)
    cam = await cameras_collection().find_one({"_id": ObjectId(camera_id)}, {"resolution": 1})

    # Pull events that have at least one usable detection box
    cursor = events_collection().find(
        {
            "camera_id": camera_id,
            "timestamp": {"$gte": cutoff},
            "$or": [
                {"detected_objects": {"$exists": True, "$ne": []}},
                {"bounding_box": {"$exists": True, "$ne": None}},
            ],
        },
        {"bounding_box": 1, "detected_objects": 1},
    )

    events = await cursor.to_list(length=5000)

    # Initialise empty grid
    grid = [[0] * grid_w for _ in range(grid_h)]

    # Use camera resolution if available for proper normalisation
    frame_w, frame_h = 1920, 1080
    resolution = (cam or {}).get("resolution") if isinstance(cam, dict) else None
    if isinstance(resolution, dict):
        frame_w = int(resolution.get("width", frame_w) or frame_w)
        frame_h = int(resolution.get("height", frame_h) or frame_h)
    frame_w = max(frame_w, 1)
    frame_h = max(frame_h, 1)

    total_heat = 0
    for event in events:
        for bbox in _extract_event_bboxes(event):
            bx = int(bbox.get("x", 0))
            by = int(bbox.get("y", 0))
            bw = int(bbox.get("w", 0))
            bh = int(bbox.get("h", 0))

            # Centre of the bounding box
            cx = bx + bw // 2
            cy = by + bh // 2

            # Normalize to grid coordinates
            gx = min(int(cx / frame_w * grid_w), grid_w - 1)
            gy = min(int(cy / frame_h * grid_h), grid_h - 1)

            grid[gy][gx] += 1
            total_heat += 1

    # Flatten to a 1D list for JSON serialization
    flat = [val for row in grid for val in row]

    return {
        "camera_id": camera_id,
        "period_hours": hours,
        "grid_width": grid_w,
        "grid_height": grid_h,
        "total_detections": total_heat,
        "heatmap_data": flat,
    }


@router.get("/")
async def list_camera_heatmap_summary(
    hours: int = Query(24, ge=1, le=168),
    user: dict = Depends(get_current_user),
):
    """Return high-level heatmap activity summary for all cameras."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    pipeline = [
        {
            "$match": {
                "timestamp": {"$gte": cutoff},
                "$or": [
                    {"detected_objects": {"$exists": True, "$ne": []}},
                    {"bounding_box": {"$exists": True, "$ne": None}},
                ],
            }
        },
        {
            "$project": {
                "camera_id": 1,
                "det_count": {
                    "$let": {
                        "vars": {
                            "obj_count": {"$size": {"$ifNull": ["$detected_objects", []]}}
                        },
                        "in": {"$cond": [{"$gt": ["$$obj_count", 0]}, "$$obj_count", 1]},
                    }
                },
            }
        },
        {"$group": {"_id": "$camera_id", "count": {"$sum": "$det_count"}}},
        {"$sort": {"count": -1}},
    ]

    cursor = events_collection().aggregate(pipeline)
    results = await cursor.to_list(length=50)

    enriched = []
    for r in results:
        cam = await cameras_collection().find_one({"_id": ObjectId(r["_id"])}, {"name": 1})
        enriched.append({
            "camera_id": r["_id"],
            "camera_name": cam["name"] if cam else r["_id"],
            "detection_count": r["count"],
        })

    return {"period_hours": hours, "cameras": enriched}
