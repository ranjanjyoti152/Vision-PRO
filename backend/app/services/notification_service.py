"""
Notification Service for dispatching alerts to Telegram, WhatsApp, and Email.
"""
import logging
import httpx
import asyncio
from typing import Dict, Any, Optional
from email.message import EmailMessage
import aiosmtplib

from app.database import settings_collection
from app.core.security import decrypt_credential

logger = logging.getLogger(__name__)


class NotificationService:
    def __init__(self):
        self.timeout = httpx.Timeout(10.0)

    async def _get_notification_settings(self) -> Dict[str, Any]:
        """Fetch all notification settings from the database and decrypt keys."""
        cursor = settings_collection().find({"key": {"$regex": "^(telegram_|whatsapp_|email_)"}})
        docs = await cursor.to_list(length=100)
        settings = {}
        for doc in docs:
            key = doc["key"]
            value = doc["value"]
            if isinstance(value, str) and value.startswith("gAAAAA") and any(sk in key for sk in ("bot_token", "api_key", "smtp_password", "api_url")):
                try:
                    value = decrypt_credential(value)
                except Exception:
                    pass
            settings[key] = value
        return settings

    async def dispatch(self, message: str, image_path: Optional[str] = None):
        """Send the alert to all enabled channels concurrently."""
        settings = await self._get_notification_settings()
        tasks = []
        
        if settings.get("telegram_enabled") and settings.get("telegram_bot_token") and settings.get("telegram_chat_id"):
            tasks.append(self.send_telegram(
                settings["telegram_bot_token"],
                settings["telegram_chat_id"],
                message,
                image_path
            ))
            
        if settings.get("email_enabled") and settings.get("email_smtp_host"):
            tasks.append(self.send_email(settings, message, image_path))
            
        if settings.get("whatsapp_enabled") and settings.get("whatsapp_api_url"):
            tasks.append(self.send_whatsapp(settings, message, image_path))
            
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def send_telegram(self, bot_token: str, chat_id: str, message: str, image_path: Optional[str] = None):
        url = f"https://api.telegram.org/bot{bot_token}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                if image_path:
                    logger.info(f"Sending Telegram photo to {chat_id}")
                    with open(image_path, "rb") as f:
                        files = {"photo": f}
                        data = {"chat_id": chat_id, "caption": message}
                        resp = await client.post(f"{url}/sendPhoto", data=data, files=files)
                else:
                    logger.info(f"Sending Telegram message to {chat_id}")
                    data = {"chat_id": chat_id, "text": message}
                    resp = await client.post(f"{url}/sendMessage", json=data)
                    
                resp.raise_for_status()
                logger.info("✅ Telegram notification sent")
        except Exception as e:
            logger.error(f"Failed to send Telegram notification: {e}")

    async def send_email(self, settings: Dict[str, Any], body: str, image_path: Optional[str] = None):
        try:
            msg = EmailMessage()
            msg["Subject"] = "🚨 Vision Pro Security Alert"
            msg["From"] = settings.get("email_from_address", "alerts@visionpro")
            
            # email_to_addresses might be a list or comma-separated string
            to_addrs = settings.get("email_to_addresses", [])
            if isinstance(to_addrs, list):
                to_addrs = ", ".join(to_addrs)
            msg["To"] = to_addrs
            
            msg.set_content(body)
            
            if image_path:
                import imghdr
                with open(image_path, "rb") as f:
                    img_data = f.read()
                img_type = imghdr.what(None, img_data) or "jpeg"
                msg.add_attachment(img_data, maintype="image", subtype=img_type, filename="snapshot.jpg")
                
            port = int(settings.get("email_smtp_port", 587))
            user = settings.get("email_smtp_user", "")
            password = settings.get("email_smtp_password", "")
            host = settings.get("email_smtp_host", "")
            
            # Basic SMTP send
            await aiosmtplib.send(
                msg,
                hostname=host,
                port=port,
                username=user,
                password=password,
                start_tls=port == 587,
                use_tls=port == 465
            )
            logger.info("✅ Email notification sent")
        except Exception as e:
            logger.error(f"Failed to send Email: {e}")

    async def send_whatsapp(self, settings: Dict[str, Any], message: str, image_path: Optional[str] = None):
        """Stub for WhatsApp API (e.g., UltraMsg, Twilio, Meta Cloud API)."""
        # WhatsApp APIs vary wildly. This is a generic POST skeleton.
        api_url = settings.get("whatsapp_api_url", "")
        api_key = settings.get("whatsapp_api_key", "")
        phone = settings.get("whatsapp_phone_number", "")
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                data = {
                    "to": phone,
                    "body": message
                }
                # Add auth header depending on provider
                headers = {"Authorization": f"Bearer {api_key}"}
                
                # Assume JSON API for now
                resp = await client.post(api_url, json=data, headers=headers)
                resp.raise_for_status()
                logger.info("✅ WhatsApp notification sent")
        except Exception as e:
            logger.error(f"Failed to send WhatsApp notification: {e}")


# Singleton
notification_service = NotificationService()
