"""
LLM Service for generating event summaries and handling assistant chats.
Supports multiple providers: Ollama, OpenAI, Gemini, OpenRouter.
"""
import logging
import httpx
from typing import Dict, Any, List, Optional
from app.database import settings_collection
from app.core.security import decrypt_credential
from app.models.event import EventType, DetectedObject

logger = logging.getLogger(__name__)


class LLMService:
    def __init__(self):
        self.timeout = httpx.Timeout(15.0)

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
        
        # Build a prompt describing the event
        objects_str = ", ".join([f"{obj.get('class', 'unknown')} ({obj.get('confidence', 0):.2f})" for obj in objects])
        if not objects_str:
            objects_str = "no specific objects"
            
        prompt = (
            f"You are a security AI. Write a concise, single-sentence summary of the following security event.\n"
            f"Event Type: {event_type.value}\n"
            f"Confidence: {confidence:.2f}\n"
            f"Objects Detected: {objects_str}\n"
        )
        if face_name:
            prompt += f"Known Face Identified: {face_name}\n"
            
        prompt += "\nOutput ONLY the summary sentence, without quotes or extra text."

        return await self._generate_text(prompt, fallback="Event detected.")

    async def chat(self, messages: List[Dict[str, str]]) -> str:
        """Handle a chat conversation with the AI Assistant."""
        # Assume messages is a list of {"role": "user/assistant", "content": "..."}
        if not messages:
            return "How can I help you?"
            
        # Extract the last user message to use as a prompt for simpler LLMs if needed,
        # but modern APIs support full message history.
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
        try:
            settings = await self._get_llm_settings()
            provider = settings.get("active_provider")
            
            if not provider:
                logger.debug("No active LLM provider configured, using fallback summary.")
                return fallback
                
            messages = [{"role": "user", "content": prompt}]
            result = await self._call_provider(provider, settings, messages)
            return result.strip() if result else fallback
            
        except Exception as e:
            logger.error(f"Failed to generate LLM text: {e}")
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
        # Gemini uses a different API format (Google AI Studio)
        api_key = settings.get("gemini_api_key", "")
        model = settings.get("gemini_default_model", "gemini-2.0-flash")
        
        # Convert standard messages to Gemini format
        contents = []
        for msg in messages:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg["content"]}]})
            
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
                return ""

    async def _call_openrouter(self, settings: Dict[str, Any], messages: List[Dict[str, str]]) -> str:
        api_key = settings.get("openrouter_api_key", "")
        model = settings.get("openrouter_default_model", "")
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": "http://localhost:5173", # standard requirement for openrouter
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
