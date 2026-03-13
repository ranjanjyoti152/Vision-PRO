"""
AI Assistant routes – Chat with RAG (event context injection).
"""
import json
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from app.core.security import get_current_user
from app.services.llm_service import llm_service
from app.database import events_collection, cameras_collection, chat_history_collection
from app.config import settings
import re
import logging

logger = logging.getLogger(__name__)

# API_BASE_URL is derived from the incoming request at runtime

router = APIRouter(prefix="/api/assistant", tags=["AI Assistant"])


async def _fetch_event_context(user_msg: str, base_url: str) -> dict:
    """Fetch relevant events from MongoDB based on the user's question."""
    now = datetime.now(timezone.utc)
    msg_lower = user_msg.lower()

    # Determine time range from the query
    if any(w in msg_lower for w in ["today", "today's", "this morning", "this afternoon"]):
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = now
        time_label = "today"
    elif any(w in msg_lower for w in ["last hour", "past hour", "recent"]):
        start = now - timedelta(hours=1)
        end = now
        time_label = "last hour"
    elif any(w in msg_lower for w in ["last 24 hours", "past 24"]):
        start = now - timedelta(hours=24)
        end = now
        time_label = "last 24 hours"
    elif any(w in msg_lower for w in ["yesterday"]):
        start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start.replace(hour=23, minute=59, second=59)
        time_label = "yesterday"
    elif any(w in msg_lower for w in ["this week", "past week", "last 7 days"]):
        start = now - timedelta(days=7)
        end = now
        time_label = "this week"
    elif any(w in msg_lower for w in ["this month", "past month"]):
        start = now - timedelta(days=30)
        end = now
        time_label = "this month"
    else:
        # Default: last 24 hours
        start = now - timedelta(hours=24)
        end = now
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
            hour_key = ts.strftime("%H:00")
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
            "time": evt.get("timestamp", "").strftime("%Y-%m-%d %H:%M:%S") if evt.get("timestamp") else "",
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

    return {
        "time_range": time_label,
        "total_events": total_count,
        "fetched_events": len(events),
        "type_breakdown": type_counts,
        "camera_breakdown": camera_stats,
        "hourly_distribution": dict(sorted(hourly_counts.items())),
        "recent_events": recent_events,
    }


def _build_system_prompt(context: dict) -> str:
    """Build a system prompt with event context data."""
    lines = [
        "You are a friendly, conversational AI security assistant named 'Vision AI' for Vision Pro NVR.",
        "Personality: You're like a helpful colleague who monitors the cameras. Be warm, casual, and natural.",
        "- Use conversational language, not corporate/robotic tone",
        "- Use emojis sparingly but naturally (🚗 👤 🐱 📷 ✅ ⚠️)",
        "- Be concise — short paragraphs, not walls of text",
        "- When asked 'how are you', reply naturally like a person would",
        "- Greet casually, use phrases like 'Looks like...', 'Here's what I found...', 'Quick update...'",
        "- For simple questions, give short direct answers. Only add detail when asked",
        "- Use markdown **bold** for key numbers and findings",
        "",
        "CRITICAL INSTRUCTIONS FOR DATA ACCURACY:",
        "1. NEVER invent or guess names (like 'John Doe', 'Jane Smith') unless they are explicitly in the 'summary' field.",
        "2. NEVER invent events, times, or cameras that are not in the 'Data' section below.",
        "3. If a user asks about something not in the data, explicitly state that you don't have that information in the recent database events.",
        "4. Stick STRICTLY to the facts provided in the context.",
        "",
        "You CAN display event snapshots! When asked, use: ![description](snapshot_url)",
        "Snapshot/video URLs are in the event data below.",
        "",
        f"## Data ({context['time_range']}): {context['total_events']} events",
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
        {"role": "user", "content": user_msg},
    ]

    user_id = str(user.get("_id", ""))

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