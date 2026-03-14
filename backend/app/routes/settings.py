"""
Settings routes – Storage, Notifications, LLM configuration.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends

from app.database import settings_collection
from app.core.security import get_current_user, require_admin, encrypt_credential, decrypt_credential
from app.models.settings import (
    SettingsCategory,
    StorageSettings,
    NotificationSettings,
    LLMSettings,
    TestNotificationRequest,
)

router = APIRouter(prefix="/api/settings", tags=["Settings"])


async def _get_settings_dict(category: str) -> dict:
    """Get all settings for a category as a dict."""
    cursor = settings_collection().find({"category": category})
    docs = await cursor.to_list(length=100)
    return {doc["key"]: doc["value"] for doc in docs}


async def _save_settings_dict(category: str, data: dict) -> None:
    """Save settings dict, encrypting sensitive fields."""
    sensitive_keys = {
        "bot_token", "api_key", "smtp_password", "api_url",
    }
    now = datetime.now(timezone.utc)

    for key, value in data.items():
        # Encrypt sensitive credential values before storing
        store_value = value
        if isinstance(value, str) and any(sk in key for sk in sensitive_keys) and value:
            store_value = encrypt_credential(value)

        await settings_collection().update_one(
            {"category": category, "key": key},
            {"$set": {"value": store_value, "updated_at": now}},
            upsert=True,
        )


@router.get("/storage", response_model=StorageSettings)
async def get_storage_settings(user: dict = Depends(get_current_user)):
    """Get storage configuration."""
    data = await _get_settings_dict("storage")
    return StorageSettings(**data) if data else StorageSettings()


@router.put("/storage", response_model=StorageSettings)
async def update_storage_settings(
    settings: StorageSettings,
    admin: dict = Depends(require_admin),
):
    """Update storage configuration (admin only)."""
    await _save_settings_dict("storage", settings.model_dump())
    return settings


@router.get("/notifications")
async def get_notification_settings(user: dict = Depends(get_current_user)):
    """Get notification configuration."""
    data = await _get_settings_dict("notifications")
    return data if data else NotificationSettings().model_dump()


@router.put("/notifications")
async def update_notification_settings(
    settings_data: NotificationSettings,
    admin: dict = Depends(require_admin),
):
    """Update notification configuration (admin only)."""
    # Flatten nested config for storage
    flat = {}
    for provider_name in ["telegram", "whatsapp", "email"]:
        provider_config = getattr(settings_data, provider_name)
        for field_name, field_value in provider_config.model_dump().items():
            flat[f"{provider_name}_{field_name}"] = field_value

    await _save_settings_dict("notifications", flat)
    return {"message": "Notification settings updated"}


@router.post("/notifications/test")
async def test_notification(
    request: TestNotificationRequest,
    admin: dict = Depends(require_admin),
):
    """Send a test notification via the specified provider."""
    from datetime import datetime, timezone
    from app.services.notification_service import notification_service

    settings = await notification_service._get_notification_settings()
    provider = request.provider.value

    test_event = {
        "event_type": "person",
        "camera_name": "Test Camera",
        "confidence": 0.95,
        "timestamp": datetime.now(timezone.utc),
        "detected_objects": [{"class": "person", "confidence": 0.95}],
        "ai_summary": "This is a test notification from Vision Pro NVR. If you received this, notifications are working correctly!",
        "bounding_box": {"x": 100, "y": 200, "w": 50, "h": 100},
    }

    try:
        if provider == "telegram":
            if not settings.get("telegram_bot_token") or not settings.get("telegram_chat_id"):
                raise HTTPException(status_code=400, detail="Telegram bot token and chat ID are required")
            await notification_service.send_telegram(
                settings["telegram_bot_token"], settings["telegram_chat_id"],
                "🧪 Vision Pro Test: Telegram notifications are working!"
            )
        elif provider == "email":
            if not settings.get("email_smtp_host"):
                raise HTTPException(status_code=400, detail="SMTP host is not configured")
            await notification_service.send_email(settings, "Vision Pro Test Email", event_data=test_event)
        elif provider == "whatsapp":
            await notification_service.send_whatsapp(settings, "🧪 Vision Pro Test: WhatsApp notifications are working!")
        else:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

        return {"message": f"Test notification sent via {provider}", "status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send test notification: {str(e)}")


@router.get("/llm")
async def get_llm_settings(user: dict = Depends(get_current_user)):
    """Get LLM/VLM provider configuration."""
    data = await _get_settings_dict("llm")
    return data if data else LLMSettings().model_dump()


@router.put("/llm")
async def update_llm_settings(
    settings_data: LLMSettings,
    admin: dict = Depends(require_admin),
):
    """Update LLM/VLM configuration (admin only)."""
    flat = {"active_provider": settings_data.active_provider}
    for provider_name in ["ollama", "openai", "gemini", "openrouter"]:
        provider_config = getattr(settings_data, provider_name)
        for field_name, field_value in provider_config.model_dump().items():
            flat[f"{provider_name}_{field_name}"] = field_value

    await _save_settings_dict("llm", flat)
    return {"message": "LLM settings updated"}


@router.get("/llm/models/{provider}")
async def fetch_provider_models(
    provider: str,
    base_url: str = "",
    api_key: str = "",
    user: dict = Depends(get_current_user),
):
    """Fetch available models from an LLM provider API."""
    import httpx

    models: list[str] = []
    timeout = httpx.Timeout(10.0)

    try:
        if provider == "ollama":
            url = (base_url or "http://localhost:11434").rstrip("/")
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(f"{url}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                models = [m["name"] for m in data.get("models", [])]

        elif provider == "openai":
            url = (base_url or "https://api.openai.com/v1").rstrip("/")
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(f"{url}/models", headers=headers)
                resp.raise_for_status()
                data = resp.json()
                all_models = [m["id"] for m in data.get("data", [])]
                # Filter to chat models
                chat_prefixes = ("gpt-", "o1", "o3", "o4")
                models = sorted([m for m in all_models if any(m.startswith(p) for p in chat_prefixes)])
                if not models:
                    models = sorted(all_models)

        elif provider == "gemini":
            if not api_key:
                raise HTTPException(400, "API key required for Gemini")
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
                models = sorted([
                    m["name"].replace("models/", "")
                    for m in data.get("models", [])
                    if "generateContent" in str(m.get("supportedGenerationMethods", []))
                ])

        elif provider == "openrouter":
            async with httpx.AsyncClient(timeout=timeout) as client:
                headers = {}
                if api_key:
                    headers["Authorization"] = f"Bearer {api_key}"
                resp = await client.get("https://openrouter.ai/api/v1/models", headers=headers)
                resp.raise_for_status()
                data = resp.json()
                models = sorted([m["id"] for m in data.get("data", [])])

        else:
            raise HTTPException(400, f"Unknown provider: {provider}")

    except httpx.HTTPError as e:
        raise HTTPException(502, f"Failed to fetch models from {provider}: {str(e)}")

    return {"provider": provider, "models": models}
