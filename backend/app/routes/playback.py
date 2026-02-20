"""
Playback / Recording routes.
"""
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Query
from fastapi.responses import FileResponse
from bson import ObjectId
import os

from app.database import recordings_collection, cameras_collection
from app.core.security import get_current_user
from app.models.recording import RecordingResponse, RecordingExportRequest, CalendarDay

router = APIRouter(prefix="/api/recordings", tags=["Playback"])


def _rec_doc_to_response(rec: dict, camera_name: str = None) -> RecordingResponse:
    return RecordingResponse(
        id=str(rec["_id"]),
        camera_id=str(rec.get("camera_id", "")),
        camera_name=camera_name,
        file_path=rec.get("file_path", ""),
        start_time=rec["start_time"],
        end_time=rec["end_time"],
        duration_seconds=rec.get("duration_seconds", 0),
        file_size_bytes=rec.get("file_size_bytes", 0),
        trigger_event_id=str(rec["trigger_event_id"]) if rec.get("trigger_event_id") else None,
        created_at=rec.get("created_at", rec["start_time"]),
    )


@router.get("", response_model=list[RecordingResponse])
async def list_recordings(
    camera_id: str | None = Query(None),
    date: str | None = Query(None, description="YYYY-MM-DD"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """List recordings with optional camera and date filters."""
    query = {}
    if camera_id:
        query["camera_id"] = camera_id
    if date:
        try:
            day_start = datetime.strptime(date, "%Y-%m-%d")
            day_end = datetime(day_start.year, day_start.month, day_start.day, 23, 59, 59)
            query["start_time"] = {"$gte": day_start, "$lte": day_end}
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    skip = (page - 1) * page_size
    cursor = (
        recordings_collection()
        .find(query)
        .sort("start_time", -1)
        .skip(skip)
        .limit(page_size)
    )
    recordings = await cursor.to_list(length=page_size)
    return [_rec_doc_to_response(r) for r in recordings]


@router.get("/calendar/{camera_id}")
async def get_recording_calendar(
    camera_id: str,
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    user: dict = Depends(get_current_user),
):
    """Get dates that have recordings for a camera in a given month."""
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)

    pipeline = [
        {
            "$match": {
                "camera_id": camera_id,
                "start_time": {"$gte": start, "$lt": end},
            }
        },
        {
            "$group": {
                "_id": {
                    "$dateToString": {"format": "%Y-%m-%d", "date": "$start_time"}
                },
                "count": {"$sum": 1},
                "total_duration": {"$sum": "$duration_seconds"},
            }
        },
        {"$sort": {"_id": 1}},
    ]

    cursor = recordings_collection().aggregate(pipeline)
    results = await cursor.to_list(length=31)

    return [
        CalendarDay(
            date=r["_id"],
            recording_count=r["count"],
            total_duration_seconds=r.get("total_duration", 0),
        )
        for r in results
    ]


@router.get("/{recording_id}/stream")
async def stream_recording(
    recording_id: str,
    user: dict = Depends(get_current_user),
):
    """Stream a recording file."""
    rec = await recordings_collection().find_one({"_id": ObjectId(recording_id)})
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")

    filepath = rec.get("file_path", "")
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Recording file not found on disk")

    return FileResponse(
        filepath,
        media_type="video/mp4",
        filename=os.path.basename(filepath),
    )


@router.post("/export")
async def export_recording(
    request: RecordingExportRequest,
    user: dict = Depends(get_current_user),
):
    """Export a recording segment (start/end time range)."""
    # TODO: Implement ffmpeg-based export in Phase 6
    return {
        "message": "Export request received",
        "camera_id": request.camera_id,
        "start_time": request.start_time.isoformat(),
        "end_time": request.end_time.isoformat(),
        "status": "pending_implementation",
    }
