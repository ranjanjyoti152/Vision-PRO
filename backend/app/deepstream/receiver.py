"""
ZMQ Receiver — FastAPI side (PULL subscriber).

Runs as an asyncio background task inside the FastAPI process.
Receives msgpack messages from the DeepStream container and:
  - "frame"     → broadcast JPEG to ws_manager (feeds Dashboard live feeds)
  - "detection" → route through existing event creation pipeline (events, faces, notifications)

This replaces the OpenCV capture + PyTorch YOLO path when DEEPSTREAM_ENABLED=True.
"""
import asyncio
import logging
import time
from typing import Optional

import zmq
import zmq.asyncio
import msgpack

from app.config import settings
from app.core.websocket import ws_manager

logger = logging.getLogger(__name__)


class DeepStreamReceiver:
    """Async ZMQ PULL socket consumer — bridge between DeepStream and FastAPI."""

    def __init__(self):
        self._ctx:  Optional[zmq.asyncio.Context] = None
        self._sock: Optional[zmq.asyncio.Socket]  = None
        self._task: Optional[asyncio.Task]         = None
        self._running = False

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._ctx  = zmq.asyncio.Context()
        self._sock = self._ctx.socket(zmq.PULL)
        self._sock.setsockopt(zmq.RCVHWM, 120)
        self._sock.setsockopt(zmq.LINGER, 0)
        endpoint = f"tcp://{settings.DEEPSTREAM_HOST}:{settings.DEEPSTREAM_ZMQ_PORT}"
        self._sock.connect(endpoint)
        logger.info(f"🔗 DeepStream receiver connected to {endpoint}")
        self._task = asyncio.create_task(self._recv_loop(), name="deepstream_receiver")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._sock:
            self._sock.close()
        if self._ctx:
            self._ctx.term()
        logger.info("🛑 DeepStream receiver stopped")

    async def _recv_loop(self) -> None:
        """Main receive loop — dispatches incoming messages."""
        logger.info("📡 DeepStream receiver loop started")
        while self._running:
            try:
                raw = await asyncio.wait_for(self._sock.recv(), timeout=2.0)
                msg = msgpack.unpackb(raw, raw=False)
                msg_type  = msg.get("type")
                camera_id = msg.get("camera_id", "")

                if msg_type == "frame":
                    jpeg = msg.get("jpeg")
                    if jpeg:
                        channel = f"camera:{camera_id}"
                        await ws_manager.broadcast_bytes(channel, jpeg)

                elif msg_type == "detection":
                    detections = msg.get("detections", [])
                    jpeg       = msg.get("jpeg")
                    timestamp  = msg.get("timestamp", time.time())
                    if detections:
                        asyncio.create_task(
                            self._handle_detections(camera_id, detections, jpeg, timestamp)
                        )

            except asyncio.TimeoutError:
                continue  # No message — keep looping
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"DeepStream receiver error: {e}")
                await asyncio.sleep(0.5)

    async def _handle_detections(
        self,
        camera_id: str,
        detections: list,
        jpeg: Optional[bytes],
        timestamp: float,
    ) -> None:
        """Route detections through the existing event pipeline."""
        try:
            from app.workers.yolo_worker import detection_worker
            await detection_worker.handle_deepstream_event(
                camera_id=camera_id,
                detections=detections,
                jpeg=jpeg,
                timestamp=timestamp,
            )
        except Exception as e:
            logger.warning(f"Detection handling error (cam={camera_id}): {e}")


# Singleton
deepstream_receiver = DeepStreamReceiver()
