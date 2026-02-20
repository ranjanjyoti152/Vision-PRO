"""
Event routes.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Query
from bson import ObjectId

from app.database import events_collection, cameras_collection, faces_collection
from app.core.security import get_current_user
from app.models.event import EventResponse, EventType

router = APIRouter(prefix="/api/events", tags=["Events"])


async def _enrich_event(event: dict) -> EventResponse:
    """Convert event document to response with camera/face names."""
    camera_name = None
    if event.get("camera_id"):
        cam = await cameras_collection().find_one(
            {"_id": ObjectId(event["camera_id"])}, {"name": 1}
        )
        if cam:
            camera_name = cam["name"]

    face_name = None
    if event.get("face_id"):
        face = await faces_collection().find_one(
            {"_id": ObjectId(event["face_id"])}, {"name": 1}
        )
        if face:
            face_name = face.get("name")

    return EventResponse(
        id=str(event["_id"]),
        camera_id=str(event.get("camera_id", "")),
        camera_name=camera_name,
        event_type=event["event_type"],
        confidence=event.get("confidence", 0),
        timestamp=event["timestamp"],
        snapshot_path=event.get("snapshot_path", ""),
        video_clip_path=event.get("video_clip_path", ""),
        bounding_box=event.get("bounding_box"),
        ai_summary=event.get("ai_summary", ""),
        detected_objects=event.get("detected_objects", []),
        face_id=str(event["face_id"]) if event.get("face_id") else None,
        face_name=face_name,
        metadata=event.get("metadata", {}),
        created_at=event.get("created_at", event["timestamp"]),
    )


@router.get("", response_model=list[EventResponse])
async def list_events(
    camera_id: str | None = Query(None),
    event_type: EventType | None = Query(None),
    face_id: str | None = Query(None),
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    min_confidence: float = Query(0.0, ge=0.0, le=1.0),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """List events with filtering and pagination."""
    query = {}
    if camera_id:
        query["camera_id"] = camera_id
    if event_type:
        query["event_type"] = event_type.value
    if face_id:
        query["face_id"] = face_id
    if start_date:
        query.setdefault("timestamp", {})["$gte"] = start_date
    if end_date:
        query.setdefault("timestamp", {})["$lte"] = end_date
    if min_confidence > 0:
        query["confidence"] = {"$gte": min_confidence}

    skip = (page - 1) * page_size
    cursor = (
        events_collection()
        .find(query)
        .sort("timestamp", -1)
        .skip(skip)
        .limit(page_size)
    )
    events = await cursor.to_list(length=page_size)
    return [await _enrich_event(e) for e in events]


@router.get("/count")
async def count_events(
    camera_id: str | None = Query(None),
    event_type: EventType | None = Query(None),
    start_date: datetime | None = Query(None),
    end_date: datetime | None = Query(None),
    user: dict = Depends(get_current_user),
):
    """Get total count of events matching filters."""
    query = {}
    if camera_id:
        query["camera_id"] = camera_id
    if event_type:
        query["event_type"] = event_type.value
    if start_date:
        query.setdefault("timestamp", {})["$gte"] = start_date
    if end_date:
        query.setdefault("timestamp", {})["$lte"] = end_date

    count = await events_collection().count_documents(query)
    return {"count": count}


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(event_id: str, user: dict = Depends(get_current_user)):
    """Get event details by ID."""
    event = await events_collection().find_one({"_id": ObjectId(event_id)})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return await _enrich_event(event)


@router.delete("/{event_id}")
async def delete_event(event_id: str, user: dict = Depends(get_current_user)):
    """Delete an event."""
    result = await events_collection().delete_one({"_id": ObjectId(event_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"message": "Event deleted successfully"}
