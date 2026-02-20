"""
Settings Pydantic models.
"""
from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel, Field
from enum import Enum


class SettingsCategory(str, Enum):
    STORAGE = "storage"
    NOTIFICATIONS = "notifications"
    LLM = "llm"
    GENERAL = "general"


class NotificationProvider(str, Enum):
    TELEGRAM = "telegram"
    WHATSAPP = "whatsapp"
    EMAIL = "email"


class LLMProvider(str, Enum):
    OLLAMA = "ollama"
    OPENAI = "openai"
    GEMINI = "gemini"
    OPENROUTER = "openrouter"


# --- Storage Settings ---
class StorageSettings(BaseModel):
    recording_path: str = "./recordings"
    retention_days: int = Field(default=30, ge=1, le=365)
    auto_delete: bool = True


# --- Notification Settings ---
class TelegramConfig(BaseModel):
    enabled: bool = False
    bot_token: str = ""
    chat_id: str = ""


class WhatsAppConfig(BaseModel):
    enabled: bool = False
    api_url: str = ""
    api_key: str = ""
    phone_number: str = ""


class EmailConfig(BaseModel):
    enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    from_address: str = ""
    to_addresses: list[str] = []


class NotificationSettings(BaseModel):
    telegram: TelegramConfig = TelegramConfig()
    whatsapp: WhatsAppConfig = WhatsAppConfig()
    email: EmailConfig = EmailConfig()


# --- LLM Settings ---
class OllamaConfig(BaseModel):
    enabled: bool = False
    base_url: str = "http://localhost:11434"
    default_model: str = ""


class OpenAIConfig(BaseModel):
    enabled: bool = False
    api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    default_model: str = "gpt-4o"


class GeminiConfig(BaseModel):
    enabled: bool = False
    api_key: str = ""
    default_model: str = "gemini-2.0-flash"


class OpenRouterConfig(BaseModel):
    enabled: bool = False
    api_key: str = ""
    default_model: str = ""


class LLMSettings(BaseModel):
    active_provider: Optional[LLMProvider] = None
    ollama: OllamaConfig = OllamaConfig()
    openai: OpenAIConfig = OpenAIConfig()
    gemini: GeminiConfig = GeminiConfig()
    openrouter: OpenRouterConfig = OpenRouterConfig()


# --- Test notification ---
class TestNotificationRequest(BaseModel):
    provider: NotificationProvider
