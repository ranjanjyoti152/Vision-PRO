"""
Notification Service for dispatching alerts to Telegram, WhatsApp, and Email.
"""
import logging
import httpx
import asyncio
from typing import Dict, Any, Optional
from email.message import EmailMessage
from email.utils import make_msgid
import aiosmtplib

from app.database import settings_collection
from app.core.security import decrypt_credential
from app.services.email_templates import render_event_email

logger = logging.getLogger(__name__)


class NotificationService:
    def __init__(self):
        self.timeout = httpx.Timeout(10.0)

    async def send(self, title: str = "", message: str = "", priority: str = "normal", image_path: str = None, event_data: dict = None):
        """Convenience alias — build a text line and forward to dispatch."""
        text = f"{title}\n{message}" if title else message
        await self.dispatch(text, image_path=image_path, event_data=event_data)

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

    async def dispatch(self, message: str, image_path: Optional[str] = None, event_data: Optional[Dict[str, Any]] = None):
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
            tasks.append(self.send_email(settings, message, image_path, event_data))
            
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

    async def send_email(self, settings: Dict[str, Any], body: str, image_path: Optional[str] = None, event_data: Optional[Dict[str, Any]] = None):
        try:
            msg = EmailMessage()

            # Build subject from event data if available
            if event_data:
                et = event_data.get("event_type", "Event")
                cam = event_data.get("camera_name", "")
                subject = f"\U0001F6A8 Vision Pro: {et} detected"
                if cam:
                    subject += f" on {cam}"
            else:
                subject = "\U0001F6A8 Vision Pro Security Alert"

            msg["Subject"] = subject
            msg["From"] = settings.get("email_from_address", "alerts@visionpro")
            
            to_addrs = settings.get("email_to_addresses", [])
            if isinstance(to_addrs, list):
                to_addrs = ", ".join(to_addrs)
            msg["To"] = to_addrs
            
            # Plain text fallback
            msg.set_content(body)

            # Render HTML email with event data
            snapshot_cid = None
            if event_data:
                if image_path:
                    snapshot_cid = make_msgid(domain="visionpro.local")[1:-1]
                html = render_event_email(event_data, snapshot_cid=snapshot_cid)
            else:
                # Fallback: wrap plain text in minimal HTML
                html = f"<html><body style='background:#0F172A;color:#E5E7EB;padding:20px;font-family:sans-serif;'><p>{body}</p></body></html>"

            msg.add_alternative(html, subtype="html")

            # Attach snapshot inline (referenced by cid in the HTML)
            if image_path and snapshot_cid:
                import mimetypes
                mime_type = mimetypes.guess_type(image_path)[0] or "image/jpeg"
                maintype, subtype = mime_type.split("/", 1)
                with open(image_path, "rb") as f:
                    img_data = f.read()
                # Attach to the HTML alternative part
                html_part = msg.get_payload()[-1]  # the multipart/alternative's HTML part
                html_part.add_related(
                    img_data, maintype=maintype, subtype=subtype,
                    cid=snapshot_cid, filename="snapshot.jpg"
                )
                
            port = int(settings.get("email_smtp_port", 587))
            user = settings.get("email_smtp_user", "")
            password = settings.get("email_smtp_password", "")
            host = settings.get("email_smtp_host", "").strip()
            
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
