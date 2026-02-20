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
    # TODO: Implement actual notification sending in Phase 6
    return {
        "message": f"Test notification sent via {request.provider.value}",
        "status": "pending_implementation",
    }


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
