"""
Analytics routes – Detection trends, camera summaries, event heatmap data.
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from app.database import events_collection, cameras_collection
from app.core.security import get_current_user

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])


@router.get("/overview")
async def get_analytics_overview(
    days: int = Query(7, ge=1, le=90),
    user: dict = Depends(get_current_user),
):
    """Get analytics dashboard overview: totals by event type."""
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
    """Get hourly detection count trends grouped by event type."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    match_stage: dict = {"timestamp": {"$gte": cutoff}}
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
    hourly: dict = {}
    for r in results:
        hour = r["_id"]["hour"]
        event_type = r["_id"]["type"]
        if hour not in hourly:
            hourly[hour] = {}
        hourly[hour][event_type] = r["count"]

    return {"period_days": days, "hourly_trends": hourly}


@router.get("/daily")
async def get_daily_trends(
    days: int = Query(30, ge=7, le=90),
    camera_id: str | None = Query(None),
    user: dict = Depends(get_current_user),
):
    """Get daily event counts for the past N days, grouped by event type."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    match_stage: dict = {"timestamp": {"$gte": cutoff}}
    if camera_id:
        match_stage["camera_id"] = camera_id

    pipeline = [
        {"$match": match_stage},
        {
            "$group": {
                "_id": {
                    "year": {"$year": "$timestamp"},
                    "month": {"$month": "$timestamp"},
                    "day": {"$dayOfMonth": "$timestamp"},
                    "type": "$event_type",
                },
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"_id.year": 1, "_id.month": 1, "_id.day": 1}},
    ]

    cursor = events_collection().aggregate(pipeline)
    results = await cursor.to_list(length=500)

    # Reshape into daily map: "YYYY-MM-DD" -> {type: count}
    daily: dict = {}
    for r in results:
        d = r["_id"]
        date_str = f"{d['year']}-{d['month']:02d}-{d['day']:02d}"
        event_type = d["type"]
        if date_str not in daily:
            daily[date_str] = {}
        daily[date_str][event_type] = r["count"]

    return {"period_days": days, "daily_trends": daily}


@router.get("/cameras")
async def get_per_camera_stats(
    days: int = Query(7, ge=1, le=90),
    user: dict = Depends(get_current_user),
):
    """Return per-camera event counts sorted descending."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    pipeline = [
        {"$match": {"timestamp": {"$gte": cutoff}}},
        {
            "$group": {
                "_id": "$camera_id",
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"count": -1}},
        {"$limit": 20},
    ]

    cursor = events_collection().aggregate(pipeline)
    results = await cursor.to_list(length=20)

    # Enrich with camera names
    enriched = []
    for r in results:
        cam = await cameras_collection().find_one({"_id": __import__("bson").ObjectId(r["_id"])}, {"name": 1})
        enriched.append({
            "camera_id": r["_id"],
            "camera_name": cam["name"] if cam else r["_id"],
            "event_count": r["count"],
        })

    return {"period_days": days, "cameras": enriched}


@router.get("/top-hours")
async def get_top_activity_hours(
    days: int = Query(7, ge=1, le=90),
    user: dict = Depends(get_current_user),
):
    """Return the top 5 busiest hours of the day."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    pipeline = [
        {"$match": {"timestamp": {"$gte": cutoff}}},
        {"$group": {"_id": {"$hour": "$timestamp"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]

    cursor = events_collection().aggregate(pipeline)
    results = await cursor.to_list(length=5)

    return {
        "period_days": days,
        "top_hours": [{"hour": r["_id"], "count": r["count"]} for r in results],
    }
