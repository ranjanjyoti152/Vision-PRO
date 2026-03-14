"""
LLM Service for generating event summaries and handling assistant chats.
Supports multiple providers: Ollama, OpenAI, Gemini, OpenRouter.
"""
import asyncio
import logging
import base64
import httpx
from typing import Dict, Any, List, Optional
from app.database import settings_collection
from app.core.security import decrypt_credential
from app.models.event import EventType, DetectedObject

logger = logging.getLogger(__name__)

# Max pending summaries in queue — oldest are dropped when full
_QUEUE_MAX = 20

# System prompt for event summaries
_SUMMARY_SYSTEM = (
    "You are an expert security surveillance AI analyst for a video management system. "
    "Generate a SPECIFIC, UNIQUE, single-sentence event summary that a security operator can act on. "
    "Rules:\n"
    "- ALWAYS mention the camera name/location and approximate time of day (morning/afternoon/evening/night).\n"
    "- Describe the SPECIFIC activity: direction of movement, posture, interactions between objects.\n"
    "- Mention distinguishing details: clothing colors, vehicle type/color, bag, package, etc.\n"
    "- READ any visible text, brand names, logos, or signage on objects, clothing, bags, boxes, or vehicles "
    "(e.g. 'Ekart delivery package', 'Amazon box', 'Swiggy bag', 'Zomato rider', license plate text).\n"
    "- Identify the PURPOSE when possible: delivery person, courier, visitor, passerby, parked vehicle, stray animal.\n"
    "- For multiple objects, describe how they relate spatially (near gate, beside vehicle, crossing road).\n"
    "- NEVER use generic phrases like 'a person was detected' or 'activity was observed'.\n"
    "- Output ONLY the summary sentence — no quotes, preamble, or extra text."
)


class LLMService:
    def __init__(self):
        self.timeout = httpx.Timeout(60.0, connect=10.0)
        self._queue: asyncio.Queue | None = None
        self._worker_task: asyncio.Task | None = None

    def _ensure_queue(self):
        """Lazily create queue + worker on the running event loop."""
        if self._queue is None:
            self._queue = asyncio.Queue(maxsize=_QUEUE_MAX)
            self._worker_task = asyncio.create_task(self._queue_worker())
            logger.info("📝 LLM summary queue started (max=%d)", _QUEUE_MAX)

    async def _queue_worker(self):
        """Process summary jobs one at a time, sequentially."""
        while True:
            job = await self._queue.get()
            try:
                event_oid = job["event_oid"]
                event_type = job["event_type"]
                confidence = job["confidence"]
                objects = job["objects"]
                face_name = job.get("face_name")

                ai_summary = await self.generate_event_summary(
                    event_type, confidence, objects, face_name,
                    snapshot_path=job.get("snapshot_path"),
                    camera_name=job.get("camera_name"),
                    camera_location=job.get("camera_location"),
                    timestamp=job.get("timestamp"),
                )
                if ai_summary and ai_summary not in ("Event detected.", ""):
                    from app.database import events_collection
                    await events_collection().update_one(
                        {"_id": event_oid}, {"$set": {"ai_summary": ai_summary}}
                    )
                    logger.info(f"✅ AI summary saved for event {event_oid}: {ai_summary[:80]}")

                    # Embed the event into Qdrant with the AI-generated summary
                    await self._embed_event(event_oid, ai_summary, job)
                else:
                    logger.warning(f"⚠️ LLM returned empty/fallback summary for event {event_oid}")
                    ai_summary = None
                    # Still embed with whatever we have
                    await self._embed_event(event_oid, None, job)

                # Dispatch email/telegram/whatsapp notifications with the real AI summary
                notify_data = job.get("notify_data")
                if notify_data:
                    try:
                        from app.services.notification_service import notification_service
                        notify_data["ai_summary"] = ai_summary or f"{event_type.value if hasattr(event_type, 'value') else event_type} detected"
                        snapshot_path = notify_data.pop("snapshot_path", None)
                        await notification_service.dispatch(
                            notify_data["ai_summary"], snapshot_path, event_data=notify_data
                        )
                    except Exception as ne:
                        logger.warning(f"📧 Notification dispatch failed for event {event_oid}: {ne}")
            except Exception as e:
                logger.warning(f"❌ Summary queue job failed for event {job.get('event_oid', '?')}: {e}")
            finally:
                self._queue.task_done()

    async def _embed_event(self, event_oid, ai_summary: str | None, job: dict):
        """Embed a completed event into Qdrant for semantic search."""
        try:
            from app.database import events_collection, cameras_collection
            from app.vector_db import build_event_text, upsert_event_embedding

            event_doc = await events_collection().find_one({"_id": event_oid})
            if not event_doc:
                return

            # Resolve camera name
            camera_name = ""
            cam_id = event_doc.get("camera_id", "")
            if cam_id:
                from bson import ObjectId
                cam_doc = await cameras_collection().find_one({"_id": ObjectId(cam_id)}) if ObjectId.is_valid(cam_id) else None
                if cam_doc:
                    camera_name = cam_doc.get("name", cam_id)

            text = build_event_text(event_doc, camera_name)

            # Metadata stored alongside the vector
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

            # Use a hex string of the ObjectId as the Qdrant point ID
            point_id = str(event_oid)
            ok = await upsert_event_embedding(point_id, text, metadata)
            if ok:
                logger.info(f"📌 Event {event_oid} embedded in Qdrant")
        except Exception as e:
            logger.warning(f"⚠️ Failed to embed event {event_oid}: {e}")

    def enqueue_summary(self, event_oid, event_type, confidence, objects, face_name=None, snapshot_path=None, notify_data=None, camera_name=None, camera_location=None, timestamp=None):
        """Add a summary job to the queue. Drops silently if queue is full."""
        self._ensure_queue()
        try:
            self._queue.put_nowait({
                "event_oid": event_oid,
                "event_type": event_type,
                "confidence": confidence,
                "objects": objects,
                "face_name": face_name,
                "snapshot_path": snapshot_path,
                "notify_data": notify_data,
                "camera_name": camera_name,
                "camera_location": camera_location,
                "timestamp": timestamp,
            })
            logger.info(f"📝 Queued summary for {event_type} event (pending: {self._queue.qsize()})")
        except asyncio.QueueFull:
            logger.warning("📝 Summary queue full — dropping oldest request")

    async def _get_llm_settings(self) -> Dict[str, Any]:
        """Fetch all LLM settings from the database and decrypt keys."""
        cursor = settings_collection().find({"key": {"$regex": "^(active_provider|ollama_|openai_|gemini_|openrouter_)"}})
        docs = await cursor.to_list(length=100)
        settings = {}
        for doc in docs:
            key = doc["key"]
            value = doc["value"]
            if isinstance(value, str) and value.startswith("gAAAAA") and "key" in key:
                try:
                    value = decrypt_credential(value)
                except Exception:
                    pass
            settings[key] = value
        return settings

    async def generate_event_summary(self, event_type: EventType, confidence: float, objects: List[Dict], face_name: Optional[str] = None, snapshot_path: Optional[str] = None, camera_name: Optional[str] = None, camera_location: Optional[str] = None, timestamp=None) -> str:
        """Generate a concise 1-sentence summary of an event, with optional image analysis."""

        # Build rich object descriptions
        obj_details = []
        for obj in objects:
            cls = obj.get('class', 'unknown')
            conf = obj.get('confidence', 0)
            bbox = obj.get('bbox', {})
            w = bbox.get('w', 0) if isinstance(bbox, dict) else 0
            h = bbox.get('h', 0) if isinstance(bbox, dict) else 0
            size_hint = "large" if w * h > 150000 else "medium" if w * h > 40000 else "small"
            obj_details.append(f"{cls} ({conf:.0%}, {size_hint} in frame)")
        objects_str = ", ".join(obj_details) if obj_details else "no specific objects"

        # Derive time-of-day from timestamp
        time_label = ""
        if timestamp:
            try:
                hour = timestamp.hour if hasattr(timestamp, 'hour') else 12
                if hour < 6:
                    time_label = "early morning"
                elif hour < 12:
                    time_label = "morning"
                elif hour < 17:
                    time_label = "afternoon"
                elif hour < 21:
                    time_label = "evening"
                else:
                    time_label = "night"
            except Exception:
                pass

        # Build location context line
        location_ctx = ""
        if camera_name:
            location_ctx = f"Camera: {camera_name}"
            if camera_location:
                location_ctx += f" (location: {camera_location})"
            if time_label:
                location_ctx += f", time of day: {time_label}"
        elif time_label:
            location_ctx = f"Time of day: {time_label}"

        # Object count summary
        from collections import Counter
        class_counts = Counter(obj.get('class', 'unknown') for obj in objects)
        count_str = ", ".join(f"{count} {cls}" for cls, count in class_counts.items())

        # Load snapshot image if available
        image_b64 = None
        if snapshot_path:
            try:
                import os
                if os.path.exists(snapshot_path):
                    with open(snapshot_path, "rb") as f:
                        image_b64 = base64.b64encode(f.read()).decode("utf-8")
            except Exception as e:
                logger.warning(f"Failed to load snapshot for summary: {e}")

        if image_b64:
            prompt = (
                f"Analyze this security camera snapshot and describe the scene in one specific, actionable sentence.\n"
                f"Detection context:\n"
            )
            if location_ctx:
                prompt += f"• {location_ctx}\n"
            prompt += (
                f"• Event trigger: {event_type.value} ({confidence:.0%} confidence)\n"
                f"• Objects detected: {objects_str}\n"
                f"• Object count: {count_str}\n"
            )
            if face_name:
                prompt += f"• Identified person: {face_name}\n"
            prompt += (
                "\nIMPORTANT INSTRUCTIONS for image analysis:\n"
                "1. READ any visible text, brand names, logos, or labels on bags, boxes, packages, vehicles, clothing, "
                "or signage (e.g. 'Ekart', 'Amazon', 'Flipkart', 'Swiggy', 'Zomato', 'Delhivery', shop names, license plates).\n"
                "2. If a delivery bag/box is visible, identify the service (e.g. 'carrying an Ekart delivery package').\n"
                "3. Describe clothing colors & style (e.g. 'man in dark shirt and jeans').\n"
                "4. Note vehicle make/color/type if visible (e.g. 'black sedan', 'white Activa scooter').\n"
                "5. Describe what the person is DOING and their direction of movement.\n"
                "6. Mention the camera name and time of day at the START of your sentence.\n"
                "Output ONLY the summary sentence."
            )
        else:
            prompt = (
                f"Generate a specific security event summary in one sentence:\n"
            )
            if location_ctx:
                prompt += f"• {location_ctx}\n"
            prompt += (
                f"• Event trigger: {event_type.value} ({confidence:.0%} confidence)\n"
                f"• Objects detected: {objects_str}\n"
                f"• Object count: {count_str}\n"
            )
            if face_name:
                prompt += f"• Identified person: {face_name}\n"
            prompt += (
                "\nMention the camera name/location, time of day, and describe the specific activity "
                "including any identifiable details (delivery service, vehicle type, clothing). "
                "Output ONLY the summary sentence."
            )

        return await self._generate_text(prompt, fallback="Event detected.", image_b64=image_b64)

    async def chat(self, messages: List[Dict[str, str]]) -> str:
        """Handle a chat conversation with the AI Assistant."""
        if not messages:
            return "How can I help you?"

        try:
            settings = await self._get_llm_settings()
            provider = settings.get("active_provider")

            if not provider:
                return "AI Assistant is not configured. Please set up an LLM provider in Settings."

            return await self._call_provider(provider, settings, messages)
        except Exception as e:
            logger.error(f"Chat error: {e}")
            return f"Error communicating with AI: {str(e)}"

    async def chat_stream(self, messages: List[Dict[str, str]]):
        """Stream chat response as async generator yielding SSE-formatted chunks.
        Yields dicts: {"type": "thinking"|"content"|"done"|"error", "text": "..."}
        """
        if not messages:
            yield {"type": "content", "text": "How can I help you?"}
            yield {"type": "done", "text": ""}
            return

        try:
            settings = await self._get_llm_settings()
            provider = settings.get("active_provider")

            if not provider:
                yield {"type": "content", "text": "AI Assistant is not configured. Please set up an LLM provider in Settings."}
                yield {"type": "done", "text": ""}
                return

            if provider == "ollama":
                async for chunk in self._stream_ollama(settings, messages):
                    yield chunk
            else:
                # Non-streaming fallback for other providers
                result = await self._call_provider(provider, settings, messages)
                yield {"type": "content", "text": result}
                yield {"type": "done", "text": ""}
        except Exception as e:
            logger.error(f"Chat stream error: {e}")
            yield {"type": "error", "text": f"Error communicating with AI: {str(e)}"}
            yield {"type": "done", "text": ""}

    async def _generate_text(self, prompt: str, fallback: str, image_b64: Optional[str] = None) -> str:
        """Internal helper to call the active LLM with a single prompt, optionally with an image."""
        provider = "unknown"
        try:
            settings = await self._get_llm_settings()
            provider = settings.get("active_provider")

            if not provider:
                logger.warning("⚠️ No LLM provider configured — using fallback summary")
                return fallback

            # Use separate vision model for image-based summaries (Ollama)
            if image_b64 and provider == "ollama":
                vision_model = settings.get("ollama_vision_model", "")
                if vision_model:
                    logger.info(f"🤖 Calling ollama/{vision_model} (vision) for event summary")
                    messages = self._build_vision_messages(provider, prompt, image_b64)
                    result = await self._call_ollama_vision(settings, messages, vision_model)
                    return result.strip() if result else fallback

            model_key = f"{provider}_default_model"
            model = settings.get(model_key, "unknown")
            logger.info(f"🤖 Calling {provider}/{model} for event summary (vision={'yes' if image_b64 else 'no'})")

            # Build messages with optional image
            if image_b64:
                messages = self._build_vision_messages(provider, prompt, image_b64)
            else:
                messages = [
                    {"role": "system", "content": _SUMMARY_SYSTEM},
                    {"role": "user", "content": prompt},
                ]
            result = await self._call_provider(provider, settings, messages)
            return result.strip() if result else fallback

        except httpx.TimeoutException:
            logger.warning(f"⏱️ LLM request timed out ({provider})")
            return fallback
        except httpx.HTTPStatusError as e:
            logger.error(f"❌ LLM HTTP error ({provider}): {e.response.status_code} - {e.response.text[:200]}")
            return fallback
        except Exception as e:
            err_msg = str(e) or type(e).__name__
            logger.error(f"❌ Failed to generate LLM summary ({provider}): {err_msg}")
            return fallback

    async def _call_provider(self, provider: str, settings: Dict[str, Any], messages: list) -> str:
        """Route the request to the specific provider's API."""
        if provider == "ollama":
            return await self._call_ollama(settings, messages)
        elif provider == "openai":
            return await self._call_openai(settings, messages)
        elif provider == "gemini":
            return await self._call_gemini(settings, messages)
        elif provider == "openrouter":
            return await self._call_openrouter(settings, messages)
        else:
            raise ValueError(f"Unknown LLM provider: {provider}")

    def _build_vision_messages(self, provider: str, prompt: str, image_b64: str) -> list:
        """Build provider-appropriate messages containing text + image."""
        if provider == "gemini":
            # Gemini uses a special format handled in _call_gemini
            return [
                {"role": "system", "content": _SUMMARY_SYSTEM},
                {"role": "user", "content": prompt, "_image_b64": image_b64},
            ]
        elif provider == "ollama":
            # Ollama uses 'images' array with raw base64 strings
            return [
                {"role": "system", "content": _SUMMARY_SYSTEM},
                {"role": "user", "content": prompt, "images": [image_b64]},
            ]
        else:
            # OpenAI / OpenRouter use content array format
            return [
                {"role": "system", "content": _SUMMARY_SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                        {"type": "text", "text": prompt},
                    ],
                },
            ]

    async def _call_ollama(self, settings: Dict[str, Any], messages: List[Dict[str, str]]) -> str:
        base_url = settings.get("ollama_base_url", "http://localhost:11434").rstrip("/")
        model = settings.get("ollama_default_model", "llama3")
        ollama_timeout = httpx.Timeout(120.0, connect=10.0)

        async with httpx.AsyncClient(timeout=ollama_timeout) as client:
            resp = await client.post(
                f"{base_url}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "think": False,
                    "keep_alive": -1,
                }
            )
            resp.raise_for_status()
            data = resp.json()
            msg = data.get("message", {})
            content = msg.get("content", "")
            if not content:
                content = msg.get("thinking", "")
            return content

    async def _stream_ollama(self, settings: Dict[str, Any], messages: list):
        """Stream Ollama chat response, yielding thinking and content chunks."""
        import json as _json
        base_url = settings.get("ollama_base_url", "http://localhost:11434").rstrip("/")
        model = settings.get("ollama_default_model", "llama3")
        ollama_timeout = httpx.Timeout(120.0, connect=10.0)

        async with httpx.AsyncClient(timeout=ollama_timeout) as client:
            async with client.stream(
                "POST",
                f"{base_url}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True,
                    "keep_alive": -1,
                },
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = _json.loads(line)
                    except _json.JSONDecodeError:
                        continue
                    msg = chunk.get("message", {})
                    thinking = msg.get("thinking", "")
                    content = msg.get("content", "")
                    if thinking:
                        yield {"type": "thinking", "text": thinking}
                    if content:
                        yield {"type": "content", "text": content}
                    if chunk.get("done", False):
                        yield {"type": "done", "text": ""}
                        return

    async def _call_ollama_vision(self, settings: Dict[str, Any], messages: list, vision_model: str) -> str:
        """Call Ollama with a dedicated vision model for image analysis."""
        base_url = settings.get("ollama_base_url", "http://localhost:11434").rstrip("/")
        vision_timeout = httpx.Timeout(120.0, connect=10.0)

        async with httpx.AsyncClient(timeout=vision_timeout) as client:
            resp = await client.post(
                f"{base_url}/api/chat",
                json={
                    "model": vision_model,
                    "messages": messages,
                    "stream": False,
                    "keep_alive": -1,
                }
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("message", {}).get("content", "")

    async def _call_openai(self, settings: Dict[str, Any], messages: List[Dict[str, str]]) -> str:
        base_url = settings.get("openai_base_url", "https://api.openai.com/v1").rstrip("/")
        api_key = settings.get("openai_api_key", "")
        model = settings.get("openai_default_model", "gpt-4o")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": messages,
                }
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

    async def _call_gemini(self, settings: Dict[str, Any], messages: list) -> str:
        api_key = settings.get("gemini_api_key", "")
        model = settings.get("gemini_default_model", "gemini-2.0-flash")

        # Convert standard messages to Gemini format
        # Gemini doesn't support "system" role — prepend it to the first user message
        contents = []
        system_text = ""
        for msg in messages:
            if msg["role"] == "system":
                system_text = msg["content"] + "\n\n"
                continue
            role = "user" if msg["role"] == "user" else "model"
            text = (system_text + msg.get("content", "")) if system_text and role == "user" else msg.get("content", "")
            if isinstance(text, list):
                # Multi-part content (vision) — skip, handled below
                text = ""

            parts = []
            # Add image part if present
            image_b64 = msg.get("_image_b64")
            if image_b64:
                parts.append({"inline_data": {"mime_type": "image/jpeg", "data": image_b64}})
            if system_text and role == "user":
                parts.append({"text": system_text + (msg.get("content", "") if isinstance(msg.get("content"), str) else "")})
                system_text = ""
            elif text:
                parts.append({"text": text})

            if parts:
                contents.append({"role": role, "parts": parts})

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                url,
                json={"contents": contents}
            )
            resp.raise_for_status()
            data = resp.json()
            try:
                return data["candidates"][0]["content"]["parts"][0]["text"]
            except (KeyError, IndexError):
                logger.warning(f"Gemini returned unexpected response: {str(data)[:200]}")
                return ""

    async def _call_openrouter(self, settings: Dict[str, Any], messages: List[Dict[str, str]]) -> str:
        api_key = settings.get("openrouter_api_key", "")
        model = settings.get("openrouter_default_model", "")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "http://localhost:5173",
            "X-Title": "Vision Pro NVR",
            "Content-Type": "application/json"
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": messages,
                }
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]


llm_service = LLMService()

