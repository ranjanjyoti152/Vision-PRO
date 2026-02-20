"""
Analytics routes.
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from app.database import events_collection
from app.core.security import get_current_user

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/overview")
async def get_analytics_overview(
    days: int = Query(7, ge=1, le=90),
    user: dict = Depends(get_current_user),
):
    """Get analytics dashboard overview."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    pipeline = [
        {"$match": {"timestamp": {"$gte": cutoff}}},
        {
            "$group": {
                "_id": "$event_type",
                "count": {"$sum": 1},
                "avg_confidence": {"$avg": "$confidence"},
            }
        },
    ]

    cursor = events_collection().aggregate(pipeline)
    type_stats = await cursor.to_list(length=50)

    total = sum(s["count"] for s in type_stats)

    return {
        "period_days": days,
        "total_events": total,
        "by_type": {
            s["_id"]: {"count": s["count"], "avg_confidence": round(s["avg_confidence"], 3)}
            for s in type_stats
        },
    }


@router.get("/trends")
async def get_detection_trends(
    days: int = Query(7, ge=1, le=90),
    camera_id: str | None = Query(None),
    user: dict = Depends(get_current_user),
):
    """Get hourly detection trends."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    match_stage = {"timestamp": {"$gte": cutoff}}
    if camera_id:
        match_stage["camera_id"] = camera_id

    pipeline = [
        {"$match": match_stage},
        {
            "$group": {
                "_id": {
                    "hour": {"$hour": "$timestamp"},
                    "type": "$event_type",
                },
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"_id.hour": 1}},
    ]

    cursor = events_collection().aggregate(pipeline)
    results = await cursor.to_list(length=500)

    # Reshape into hourly buckets
    hourly = {}
    for r in results:
        hour = r["_id"]["hour"]
        event_type = r["_id"]["type"]
        if hour not in hourly:
            hourly[hour] = {}
        hourly[hour][event_type] = r["count"]

    return {"period_days": days, "hourly_trends": hourly}
