"""
Camera Stream Manager – RTSP reading, JPEG encoding, WebSocket broadcast.

Each camera gets a dedicated CameraStream task that:
  1. Opens the RTSP URL via OpenCV
  2. Reads frames in a thread pool (non-blocking)
  3. JPEG-encodes and broadcasts to WebSocket subscribers
  4. Auto-reconnects with exponential back-off on failure
"""
import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, Optional

import cv2
import numpy as np

from app.config import settings
from app.core.websocket import ws_manager

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
#  CameraStream – one per camera
# ---------------------------------------------------------------------------

@dataclass
class StreamHealth:
    """Health/status snapshot for a single camera stream."""
    camera_id: str = ""
    connected: bool = False
    fps_actual: float = 0.0
    frame_count: int = 0
    error_count: int = 0
    reconnect_count: int = 0
    last_frame_time: float = 0.0
    last_error: str = ""
    uptime_seconds: float = 0.0

    def to_dict(self) -> dict:
        return {
            "camera_id": self.camera_id,
            "connected": self.connected,
            "fps_actual": round(self.fps_actual, 1),
            "frame_count": self.frame_count,
            "error_count": self.error_count,
            "reconnect_count": self.reconnect_count,
            "last_error": self.last_error,
            "uptime_seconds": round(self.uptime_seconds, 1),
        }


class CameraStream:
    """Manages a single RTSP camera stream in a background task."""

    def __init__(self, camera_id: str, rtsp_url: str, target_fps: int = 15):
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.target_fps = target_fps

        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._cap: Optional[cv2.VideoCapture] = None
        self._latest_frame: Optional[bytes] = None  # JPEG bytes
        self._latest_raw: Optional[np.ndarray] = None

        # Health tracking
        self.health = StreamHealth(camera_id=camera_id)
        self._start_time: float = 0.0

    # ---- public ----------------------------------------------------------

    def start(self) -> None:
        """Create the background asyncio task."""
        if self._running:
            return
        self._running = True
        self._start_time = time.time()
        self._task = asyncio.create_task(self._run_loop(), name=f"stream-{self.camera_id}")
        logger.info(f"▶  Stream started: {self.camera_id}")

    async def stop(self) -> None:
        """Cancel the background task and release the capture."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._release_capture()
        self.health.connected = False
        logger.info(f"⏹  Stream stopped: {self.camera_id}")

    def get_snapshot(self) -> Optional[bytes]:
        """Return latest JPEG frame bytes, or None."""
        return self._latest_frame

    def get_raw_frame(self) -> Optional[np.ndarray]:
        """Return latest raw BGR frame (for AI pipelines later)."""
        return self._latest_raw

    # ---- internal --------------------------------------------------------

    async def _run_loop(self) -> None:
        """Main loop: connect → read → encode → broadcast, with reconnect."""
        backoff = 2.0

        while self._running:
            try:
                # Connect
                connected = await self._connect()
                if not connected:
                    self.health.error_count += 1
                    self.health.last_error = "Failed to open RTSP URL"
                    logger.warning(f"⚠  Cannot open: {self.camera_id} – retrying in {backoff}s")
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 30.0)
                    self.health.reconnect_count += 1
                    continue

                # Successfully connected – reset backoff
                backoff = 2.0
                self.health.connected = True
                self.health.last_error = ""
                logger.info(f"🟢 Connected: {self.camera_id}")

                # Read loop
                await self._read_loop()

            except asyncio.CancelledError:
                break
            except Exception as e:
                self.health.connected = False
                self.health.error_count += 1
                self.health.last_error = str(e)
                logger.error(f"❌ Stream error {self.camera_id}: {e}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)
                self.health.reconnect_count += 1

        self._release_capture()

    async def _connect(self) -> bool:
        """Open the RTSP connection in a thread (blocking call)."""
        self._release_capture()

        def _open():
            cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if cap.isOpened():
                return cap
            cap.release()
            return None

        self._cap = await asyncio.to_thread(_open)
        return self._cap is not None

    async def _read_loop(self) -> None:
        """Read frames at target FPS, encode, and broadcast."""
        frame_interval = 1.0 / self.target_fps
        fps_counter = 0
        fps_start = time.time()

        while self._running and self._cap and self._cap.isOpened():
            loop_start = time.time()

            # Read frame in thread pool (blocking I/O)
            ret, frame = await asyncio.to_thread(self._cap.read)

            if not ret or frame is None:
                logger.warning(f"⚠  Frame read failed: {self.camera_id} – reconnecting")
                self.health.connected = False
                break  # will trigger reconnect in _run_loop

            # Store raw frame
            self._latest_raw = frame

            # JPEG encode in thread pool
            jpeg = await asyncio.to_thread(self._encode_jpeg, frame)
            if jpeg is not None:
                self._latest_frame = jpeg
                self.health.frame_count += 1
                self.health.last_frame_time = time.time()
                self.health.uptime_seconds = time.time() - self._start_time

                # Broadcast to WebSocket subscribers
                channel = f"camera:{self.camera_id}"
                await ws_manager.broadcast_bytes(channel, jpeg)

            # FPS calculation
            fps_counter += 1
            elapsed = time.time() - fps_start
            if elapsed >= 1.0:
                self.health.fps_actual = fps_counter / elapsed
                fps_counter = 0
                fps_start = time.time()

            # Throttle to target FPS
            processing_time = time.time() - loop_start
            sleep_time = frame_interval - processing_time
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

    def _encode_jpeg(self, frame: np.ndarray) -> Optional[bytes]:
        """Encode a BGR frame to JPEG bytes."""
        quality = settings.STREAM_JPEG_QUALITY
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ok:
            return buf.tobytes()
        return None

    def _release_capture(self) -> None:
        """Release the OpenCV VideoCapture."""
        if self._cap:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None


# ---------------------------------------------------------------------------
#  StreamManager – singleton that owns all CameraStreams
# ---------------------------------------------------------------------------

class StreamManager:
    """Manages the lifecycle of all camera streams."""

    def __init__(self):
        self._streams: Dict[str, CameraStream] = {}

    def start_stream(
        self, camera_id: str, rtsp_url: str, fps: int = 15
    ) -> CameraStream:
        """Start streaming a camera. If already streaming, restart."""
        if camera_id in self._streams:
            # Already running – return existing
            return self._streams[camera_id]

        stream = CameraStream(camera_id, rtsp_url, target_fps=fps)
        stream.start()
        self._streams[camera_id] = stream
        return stream

    async def stop_stream(self, camera_id: str) -> None:
        """Stop a specific camera stream."""
        stream = self._streams.pop(camera_id, None)
        if stream:
            await stream.stop()

    async def restart_stream(
        self, camera_id: str, rtsp_url: str, fps: int = 15
    ) -> CameraStream:
        """Stop and re-start a camera stream."""
        await self.stop_stream(camera_id)
        return self.start_stream(camera_id, rtsp_url, fps)

    def get_snapshot(self, camera_id: str) -> Optional[bytes]:
        """Get the latest JPEG snapshot for a camera."""
        stream = self._streams.get(camera_id)
        return stream.get_snapshot() if stream else None

    def get_raw_frame(self, camera_id: str) -> Optional[np.ndarray]:
        """Get the latest raw BGR frame (for AI pipelines)."""
        stream = self._streams.get(camera_id)
        return stream.get_raw_frame() if stream else None

    def get_stream_status(self, camera_id: str) -> Optional[dict]:
        """Get health status for a single stream."""
        stream = self._streams.get(camera_id)
        return stream.health.to_dict() if stream else None

    def get_all_statuses(self) -> list[dict]:
        """Get health status for all active streams."""
        return [s.health.to_dict() for s in self._streams.values()]

    def is_streaming(self, camera_id: str) -> bool:
        """Check if a camera is currently streaming."""
        return camera_id in self._streams

    async def start_all(self) -> int:
        """Start streams for all enabled cameras from the database."""
        from app.database import cameras_collection

        cursor = cameras_collection().find({"enabled": True})
        cameras = await cursor.to_list(length=500)
        count = 0
        for cam in cameras:
            cam_id = str(cam["_id"])
            fps = min(cam.get("fps", 25), settings.STREAM_MAX_FPS)
            self.start_stream(cam_id, cam["rtsp_url"], fps)
            count += 1

        logger.info(f"📹 Started {count} camera stream(s)")
        return count

    async def stop_all(self) -> None:
        """Gracefully stop all camera streams."""
        camera_ids = list(self._streams.keys())
        for cam_id in camera_ids:
            await self.stop_stream(cam_id)
        logger.info("📹 All camera streams stopped")


# Singleton
stream_manager = StreamManager()
