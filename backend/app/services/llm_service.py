"""
LLM Service for generating event summaries and handling assistant chats.
Supports multiple providers: Ollama, OpenAI, Gemini, OpenRouter.
"""
import asyncio
import logging
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
    "You are an expert security surveillance AI analyst. "
    "You generate concise, professional, single-sentence event summaries "
    "for a video management system. Be specific and actionable. "
    "Never include quotes, preamble, or extra text — output ONLY the summary sentence."
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
                    event_type, confidence, objects, face_name
                )
                if ai_summary and ai_summary not in ("Event detected.", ""):
                    from app.database import events_collection
                    await events_collection().update_one(
                        {"_id": event_oid}, {"$set": {"ai_summary": ai_summary}}
                    )
                    logger.info(f"✅ AI summary saved for event {event_oid}: {ai_summary[:80]}")
                else:
                    logger.warning(f"⚠️ LLM returned empty/fallback summary for event {event_oid}")
            except Exception as e:
                logger.warning(f"❌ Summary queue job failed for event {job.get('event_oid', '?')}: {e}")
            finally:
                self._queue.task_done()

    def enqueue_summary(self, event_oid, event_type, confidence, objects, face_name=None):
        """Add a summary job to the queue. Drops silently if queue is full."""
        self._ensure_queue()
        try:
            self._queue.put_nowait({
                "event_oid": event_oid,
                "event_type": event_type,
                "confidence": confidence,
                "objects": objects,
                "face_name": face_name,
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

    async def generate_event_summary(self, event_type: EventType, confidence: float, objects: List[Dict], face_name: Optional[str] = None) -> str:
        """Generate a concise 1-sentence summary of an event."""

        # Build a descriptive context
        objects_str = ", ".join([
            f"{obj.get('class', 'unknown')} ({obj.get('confidence', 0):.0%})"
            for obj in objects
        ])
        if not objects_str:
            objects_str = "no specific objects"

        prompt = (
            f"Summarize this security camera event in one professional sentence:\n"
            f"• Event type: {event_type.value}\n"
            f"• Detection confidence: {confidence:.0%}\n"
            f"• Objects detected: {objects_str}\n"
        )
        if face_name:
            prompt += f"• Known individual identified: {face_name}\n"

        prompt += "\nProvide ONLY the summary sentence."

        return await self._generate_text(prompt, fallback="Event detected.")

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

    async def _generate_text(self, prompt: str, fallback: str) -> str:
        """Internal helper to call the active LLM with a single prompt."""
        provider = "unknown"
        try:
            settings = await self._get_llm_settings()
            provider = settings.get("active_provider")

            if not provider:
                logger.warning("⚠️ No LLM provider configured — using fallback summary")
                return fallback

            model_key = f"{provider}_default_model"
            model = settings.get(model_key, "unknown")
            logger.info(f"🤖 Calling {provider}/{model} for event summary")

            # Use system + user message for higher quality output
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

    async def _call_provider(self, provider: str, settings: Dict[str, Any], messages: List[Dict[str, str]]) -> str:
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

    async def _call_ollama(self, settings: Dict[str, Any], messages: List[Dict[str, str]]) -> str:
        base_url = settings.get("ollama_base_url", "http://localhost:11434").rstrip("/")
        model = settings.get("ollama_default_model", "llama3")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{base_url}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": False
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

    async def _call_gemini(self, settings: Dict[str, Any], messages: List[Dict[str, str]]) -> str:
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
            text = (system_text + msg["content"]) if system_text and role == "user" else msg["content"]
            contents.append({"role": role, "parts": [{"text": text}]})
            if system_text and role == "user":
                system_text = ""  # Only prepend once

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

