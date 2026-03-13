"""
AI Assistant routes – Chat with RAG (event context injection + semantic search).
"""
import json
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from app.core.security import get_current_user
from app.services.llm_service import llm_service
from app.database import events_collection, cameras_collection, chat_history_collection, settings_collection
from app.vector_db import search_similar_events
from app.config import settings
import re
import logging

logger = logging.getLogger(__name__)

# API_BASE_URL is derived from the incoming request at runtime

router = APIRouter(prefix="/api/assistant", tags=["AI Assistant"])


async def _get_display_tz() -> ZoneInfo:
    """Get the user's display timezone from DB settings."""
    try:
        doc = await settings_collection().find_one({"key": "display_timezone"})
        if doc and doc.get("value"):
            return ZoneInfo(doc["value"])
    except Exception:
        pass
    return ZoneInfo("Asia/Kolkata")


def _to_local(dt: datetime, tz: ZoneInfo) -> datetime:
    """Convert a UTC (or naive) datetime to the local timezone."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz)


async def _fetch_event_context(user_msg: str, base_url: str) -> dict:
    """Fetch relevant events from MongoDB based on the user's question."""
    now = datetime.now(timezone.utc)
    local_tz = await _get_display_tz()
    msg_lower = user_msg.lower()

    # Determine time range from the query
    start = None
    end = now
    time_label = "last 24 hours"

    # Check for relative time expressions first ("20 minutes ago", "3 hours ago", etc.)
    rel_match = re.search(r'(\d+)\s*(min(?:ute)?s?|hours?|hrs?|days?)\s*ago', msg_lower)
    if rel_match:
        amount = int(rel_match.group(1))
        unit = rel_match.group(2)
        if unit.startswith("min"):
            delta = timedelta(minutes=max(amount * 2, 30))  # widen window around the mentioned time
            time_label = f"last {amount * 2} minutes"
        elif unit.startswith("h"):
            delta = timedelta(hours=max(amount * 2, 2))
            time_label = f"last {amount * 2} hours"
        else:
            delta = timedelta(days=amount + 1)
            time_label = f"last {amount + 1} days"
        start = now - delta
    elif any(w in msg_lower for w in ["today", "today's", "this morning", "this afternoon"]):
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        time_label = "today"
    elif any(w in msg_lower for w in ["last hour", "past hour"]):
        start = now - timedelta(hours=1)
        time_label = "last hour"
    elif any(w in msg_lower for w in ["recently", "recent", "lately"]):
        start = now - timedelta(hours=6)
        time_label = "last 6 hours"
    elif any(w in msg_lower for w in ["last 24 hours", "past 24"]):
        start = now - timedelta(hours=24)
        time_label = "last 24 hours"
    elif any(w in msg_lower for w in ["yesterday"]):
        start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(hour=23, minute=59, second=59)
        time_label = "yesterday"
    elif any(w in msg_lower for w in ["this week", "past week", "last 7 days"]):
        start = now - timedelta(days=7)
        time_label = "this week"
    elif any(w in msg_lower for w in ["this month", "past month"]):
        start = now - timedelta(days=30)
        time_label = "this month"

    if start is None:
        start = now - timedelta(hours=24)
        time_label = "last 24 hours"

    # Build MongoDB query
    query = {"timestamp": {"$gte": start, "$lte": end}}

    # Filter by event type if mentioned
    if any(w in msg_lower for w in ["vehicle", "car", "truck", "bus"]):
        query["event_type"] = "vehicle"
    elif any(w in msg_lower for w in ["person", "people", "human", "pedestrian"]):
        query["event_type"] = "person"
    elif any(w in msg_lower for w in ["animal", "dog", "cat"]):
        query["event_type"] = "animal"
    elif any(w in msg_lower for w in ["face", "unknown face", "recognized"]):
        query["event_type"] = "person"  # faces are a subset of person events

    # Fetch events (limit to 200 for context window)
    cursor = events_collection().find(query).sort("timestamp", -1).limit(200)
    events = await cursor.to_list(length=200)

    # Get total count for the period
    total_count = await events_collection().count_documents(query)

    # Aggregate stats
    type_counts = {}
    camera_counts = {}
    hourly_counts = {}
    recent_events = []

    for evt in events:
        etype = evt.get("event_type", "unknown")
        type_counts[etype] = type_counts.get(etype, 0) + 1

        cam_id = evt.get("camera_id", "unknown")
        camera_counts[cam_id] = camera_counts.get(cam_id, 0) + 1

        ts = evt.get("timestamp")
        if ts:
            local_ts = _to_local(ts, local_tz)
            hour_key = local_ts.strftime("%H:00")
            hourly_counts[hour_key] = hourly_counts.get(hour_key, 0) + 1

    # Get camera names (resolve before building recent_events)
    camera_names = {}
    if camera_counts:
        cam_ids = list(camera_counts.keys())
        from bson import ObjectId
        cam_cursor = cameras_collection().find(
            {"_id": {"$in": [ObjectId(cid) for cid in cam_ids if ObjectId.is_valid(cid)]}}
        )
        async for cam in cam_cursor:
            camera_names[str(cam["_id"])] = cam.get("name", str(cam["_id"]))

    # Get the 20 most recent events with details
    for evt in events[:20]:
        snapshot = evt.get("snapshot_path", "")
        snapshot_url = f"{base_url}{snapshot}" if snapshot else ""
        cam_id = evt.get("camera_id", "")
        recent_events.append({
            "time": _to_local(evt["timestamp"], local_tz).strftime("%Y-%m-%d %H:%M:%S") if evt.get("timestamp") else "",
            "type": evt.get("event_type", ""),
            "confidence": round(evt.get("confidence", 0), 2),
            "camera": camera_names.get(cam_id, cam_id),
            "summary": evt.get("ai_summary", ""),
            "snapshot_url": snapshot_url,
            "video_clip_url": f"{base_url}{evt.get('video_clip_path', '')}" if evt.get("video_clip_path") else "",
        })

    # Build camera stats with names
    camera_stats = {}
    for cam_id, count in camera_counts.items():
        name = camera_names.get(cam_id, cam_id)
        camera_stats[name] = count

    # Semantic search: find events most relevant to the user's message
    semantic_results = []
    try:
        hits = await search_similar_events(user_msg, limit=10)
        for hit in hits:
            snapshot = hit.get("snapshot_path", "")
            snapshot_url = f"{base_url}{snapshot}" if snapshot else ""
            # Convert semantic hit timestamp string to local time
            sem_time = hit.get("timestamp", "")
            if sem_time and isinstance(sem_time, str):
                try:
                    sem_dt = datetime.fromisoformat(sem_time)
                    sem_time = _to_local(sem_dt, local_tz).strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    pass
            semantic_results.append({
                "score": round(hit.get("score", 0), 3),
                "type": hit.get("event_type", ""),
                "time": sem_time,
                "confidence": round(hit.get("confidence", 0), 2),
                "camera": hit.get("camera_name", hit.get("camera_id", "")),
                "summary": hit.get("ai_summary", ""),
                "snapshot_url": snapshot_url,
                "objects": hit.get("detected_objects", []),
            })
    except Exception as e:
        logger.warning(f"Semantic search failed: {e}")

    now_local = _to_local(now, local_tz)

    return {
        "time_range": time_label,
        "current_local_time": now_local.strftime("%Y-%m-%d %I:%M %p"),
        "total_events": total_count,
        "fetched_events": len(events),
        "type_breakdown": type_counts,
        "camera_breakdown": camera_stats,
        "hourly_distribution": dict(sorted(hourly_counts.items())),
        "recent_events": recent_events,
        "semantic_matches": semantic_results,
    }


def _build_system_prompt(context: dict) -> str:
    """Build a system prompt with event context data."""
    lines = [
        "You are 'Vision AI' — a chill, street-smart security buddy who watches the cameras for the user.",
        "Think of yourself as the user's friend who's always got eyes on things. You're casual, witty, and observant.",
        "",
        "## YOUR PERSONALITY:",
        "- Talk like a real person texting a friend, NOT a corporate bot",
        "- Use casual language: 'bro', 'yo', 'lol', 'ngl', 'my bad', 'gotchu', 'heads up'",
        "- Be blunt and specific: 'She walked in at 7:12 PM, opened the fridge first thing, stood there for a bit'",
        "- Keep it SHORT. One-liners when possible. No walls of text",
        "- Use emojis naturally but don't overdo it",
        "- When greeted ('hi', 'hey', 'bro'), reply casually: 'Yo what's up!', 'Yeah I'm here lol. What's up?'",
        "- Have opinions: 'That's kinda sus ngl', 'All good, nothing weird'",
        "- Be proactive: suggest things like 'Want me to keep an eye on that?', 'I can set up alerts for this'",
        "- For weekly/daily reports: narrate like you're telling a story, not listing data",
        "- Describe what you see in snapshots like a friend would: 'Looks like someone left the gate open again'",
        "- Use **bold** for important stuff",
        "",
        "## RESPONSE STYLE EXAMPLES:",
        "- User: 'what happened today?' → 'Pretty quiet day tbh. **12 events** total — mostly just people walking by the front gate. One car pulled up around 3 PM but left after a few mins. Nothing sketchy 👍'",
        "- User: 'any vehicles?' → 'Yeah, **3 vehicles** spotted. Two at the front gate, one in the backyard cam around 5 PM. Want me to pull up the snapshots?'",
        "- User: 'hi' → 'Hey! 👋 What's good? Everything's been chill on the cameras today'",
        "- User: 'weekly report pls' → 'Alright here's your week in review: **45 events** total. Monday was the busiest — 12 hits mostly on the front gate...'",
        "",
        "## RULES:",
        "1. NEVER make up names, events, times, or cameras that aren't in the data below",
        "2. If you don't have info, say so casually: 'Hmm I don't have anything on that in the recent logs'",
        "3. Stick STRICTLY to facts from the data — but present them in your casual style",
        "4. You CAN show event snapshots: use ![description](snapshot_url)",
        "5. When describing events, tell it like a story — times, actions, cameras, what happened",
        "6. All times shown are in the user's LOCAL timezone. Use 12-hour format (e.g., 2:30 PM) when talking to the user.",
        "",
        f"## CURRENT TIME: {context.get('current_local_time', 'unknown')}",
        f"## DATA ({context['time_range']}): {context['total_events']} events",
        f"- **Total events:** {context['total_events']}",
        f"- **Events analyzed:** {context['fetched_events']}",
        "",
        "### Event Type Breakdown:",
    ]

    for etype, count in context["type_breakdown"].items():
        lines.append(f"- {etype}: {count}")

    lines.append("")
    lines.append("### Camera Activity:")
    for cam_name, count in context["camera_breakdown"].items():
        lines.append(f"- {cam_name}: {count} events")

    if context.get("hourly_distribution"):
        lines.append("")
        lines.append("### Hourly Distribution:")
        for hour, count in context["hourly_distribution"].items():
            lines.append(f"- {hour}: {count} events")

    if context.get("recent_events"):
        lines.append("")
        lines.append("### Recent Events (latest 20):")
        for evt in context["recent_events"]:
            snapshot_info = f" | Snapshot: {evt['snapshot_url']}" if evt.get('snapshot_url') else ""
            video_info = f" | Video: {evt['video_clip_url']}" if evt.get('video_clip_url') else ""
            lines.append(
                f"- [{evt['time']}] {evt['type']} (conf: {evt['confidence']}) "
                f"on camera {evt['camera']}: {evt['summary']}{snapshot_info}{video_info}"
            )

    if context.get("semantic_matches"):
        lines.append("")
        lines.append("### Semantically Relevant Events (AI-matched to the user's question):")
        if context.get("total_events", 0) == 0:
            lines.append("**IMPORTANT**: The time-based query returned 0 events, but these semantic matches were found. USE THESE to answer the user — mention when they happened even if outside the time window.")
        else:
            lines.append("These events were found by semantic similarity to the user's query. Use these for detailed, specific answers.")
        for evt in context["semantic_matches"]:
            snapshot_info = f" | Snapshot: {evt['snapshot_url']}" if evt.get('snapshot_url') else ""
            obj_info = f" | Objects: {', '.join(evt['objects'])}" if evt.get('objects') else ""
            lines.append(
                f"- [{evt['time']}] {evt['type']} (conf: {evt['confidence']}, relevance: {evt['score']}) "
                f"on camera {evt['camera']}: {evt['summary']}{obj_info}{snapshot_info}"
            )

    return "\n".join(lines)


@router.post("/chat")
async def chat(
    message: dict,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Send a message to the AI assistant with event context."""
    user_msg = message.get("message", "")
    if not user_msg:
        return {"response": "Please provide a message."}

    # Derive base URL from the incoming request
    base_url = str(request.base_url).rstrip('/')

    # Fetch relevant event context from database
    try:
        context = await _fetch_event_context(user_msg, base_url)
        system_prompt = _build_system_prompt(context)
    except Exception as e:
        logger.error(f"Failed to fetch event context: {e}")
        context = {"total_events": 0, "type_breakdown": {}, "camera_breakdown": {}, "recent_events": []}
        system_prompt = (
            "You are an AI security assistant for Vision Pro NVR. "
            "The event database is temporarily unavailable. "
            "Answer based on your general knowledge."
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_msg},
    ]

    response_text = await llm_service.chat(messages)

    return {
        "response": response_text,
        "query": user_msg,
        "context": {
            "total_events": context.get("total_events", 0),
            "time_range": context.get("time_range", ""),
            "type_breakdown": context.get("type_breakdown", {}),
        },
        "status": "success",
    }


@router.post("/chat/stream")
async def chat_stream(
    message: dict,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Stream AI assistant response via Server-Sent Events."""
    user_msg = message.get("message", "")
    if not user_msg:
        async def empty():
            yield f"data: {json.dumps({'type': 'content', 'text': 'Please provide a message.'})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'text': ''})}\n\n"
        return StreamingResponse(empty(), media_type="text/event-stream")

    base_url = str(request.base_url).rstrip('/')

    try:
        context = await _fetch_event_context(user_msg, base_url)
        system_prompt = _build_system_prompt(context)
    except Exception as e:
        logger.error(f"Failed to fetch event context: {e}")
        context = {"total_events": 0, "type_breakdown": {}, "camera_breakdown": {}, "recent_events": []}
        system_prompt = (
            "You are an AI security assistant for Vision Pro NVR. "
            "The event database is temporarily unavailable. "
            "Answer based on your general knowledge."
        )

    messages = [
        {"role": "system", "content": system_prompt},
    ]

    user_id = str(user.get("_id", ""))

    # Include recent chat history for conversational continuity
    try:
        history_cursor = chat_history_collection().find(
            {"user_id": user_id}
        ).sort("timestamp", -1).limit(10)
        history_msgs = await history_cursor.to_list(length=10)
        history_msgs.reverse()  # oldest first
        for h in history_msgs:
            messages.append({"role": h["role"], "content": h["content"]})
    except Exception as e:
        logger.debug(f"Could not load chat history: {e}")

    messages.append({"role": "user", "content": user_msg})

    async def event_generator():
        # Send context metadata first
        ctx_data = {
            'total_events': context.get('total_events', 0),
            'time_range': context.get('time_range', ''),
            'type_breakdown': context.get('type_breakdown', {}),
        }
        yield f"data: {json.dumps({'type': 'context', 'text': '', 'context': ctx_data})}\n\n"

        acc_content = ""
        acc_thinking = ""
        async for chunk in llm_service.chat_stream(messages):
            if chunk["type"] == "thinking":
                acc_thinking += chunk["text"]
            elif chunk["type"] == "content":
                acc_content += chunk["text"]
            yield f"data: {json.dumps(chunk)}\n\n"

        # Save to chat history after streaming completes
        try:
            now = datetime.now(timezone.utc)
            await chat_history_collection().insert_many([
                {
                    "user_id": user_id,
                    "role": "user",
                    "content": user_msg,
                    "timestamp": now,
                },
                {
                    "user_id": user_id,
                    "role": "assistant",
                    "content": acc_content,
                    "thinking": acc_thinking if acc_thinking else None,
                    "context": ctx_data,
                    "timestamp": now,
                },
            ])
        except Exception as e:
            logger.warning(f"Failed to save chat history: {e}")

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/history")
async def get_chat_history(
    page: int = 1,
    page_size: int = 50,
    user: dict = Depends(get_current_user),
):
    """Get AI assistant chat history for the current user."""
    user_id = str(user.get("_id", ""))
    skip = (page - 1) * page_size

    total = await chat_history_collection().count_documents({"user_id": user_id})

    cursor = chat_history_collection().find(
        {"user_id": user_id}
    ).sort("timestamp", 1).skip(skip).limit(page_size)

    docs = await cursor.to_list(length=page_size)

    messages = []
    for doc in docs:
        msg = {
            "role": doc.get("role", "user"),
            "content": doc.get("content", ""),
            "timestamp": doc.get("timestamp", "").isoformat() if doc.get("timestamp") else "",
        }
        if doc.get("thinking"):
            msg["thinking"] = doc["thinking"]
        if doc.get("context"):
            msg["context"] = doc["context"]
        messages.append(msg)

    return {"messages": messages, "total": total, "page": page, "page_size": page_size}


@router.delete("/history")
async def clear_chat_history(
    user: dict = Depends(get_current_user),
):
    """Clear all chat history for the current user."""
    user_id = str(user.get("_id", ""))
    result = await chat_history_collection().delete_many({"user_id": user_id})
    return {"message": "Chat history cleared", "deleted": result.deleted_count}