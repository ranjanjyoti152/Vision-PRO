"""
Camera Stream Manager – RTSP reading, JPEG encoding, WebSocket broadcast.

Each camera gets a DEDICATED BACKGROUND THREAD that:
  1. Opens the RTSP URL via OpenCV (GStreamer HW decode preferred)
  2. Reads frames continuously at native speed
  3. JPEG-encodes the latest frame
  4. Pushes encoded bytes to an asyncio queue for WebSocket broadcast
  5. Auto-reconnects on failure

The asyncio event loop only handles the lightweight queue→WebSocket broadcast,
keeping it free for HTTP/WS request handling.
"""
import asyncio
import logging
import threading
import time
import os
from dataclasses import dataclass
from typing import Dict, Optional

# Force OpenCV FFmpeg backend to use TCP for RTSP and enable error resilience.
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|err_detect;ignore_err|fflags;discardcorrupt"
)
os.environ["OPENCV_LOG_LEVEL"] = "SILENT"

import cv2
cv2.setLogLevel(0)  # 0 = SILENT

# Redirect native stderr (fd 2) to /dev/null to silence FFmpeg's internal h264
# decoder warnings. Python logging still works via the saved fd.
try:
    import sys as _sys
    _saved_stderr_fd = os.dup(2)
    _devnull_fd = os.open(os.devnull, os.O_WRONLY)
    os.dup2(_devnull_fd, 2)
    os.close(_devnull_fd)
    _sys.stderr = os.fdopen(_saved_stderr_fd, "w", closefd=False)
except Exception:
    pass

import numpy as np

from app.config import settings
from app.core.websocket import ws_manager

logger = logging.getLogger(__name__)

# Max pixels to stream (width). Frames wider than this are resized before JPEG.
# Keeps JPEG encode fast and WebSocket payloads small.
_STREAM_MAX_WIDTH = 640


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
    """Manages a single RTSP camera stream with a dedicated reader thread."""

    def __init__(self, camera_id: str, rtsp_url: str, target_fps: int = None):
        if target_fps is None:
            target_fps = settings.STREAM_MAX_FPS
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.target_fps = target_fps

        self._running = False
        self._cap: Optional[cv2.VideoCapture] = None
        self._latest_frame: Optional[bytes] = None   # JPEG bytes
        self._latest_raw: Optional[np.ndarray] = None

        # Dedicated reader thread
        self._thread: Optional[threading.Thread] = None
        # Asyncio task for broadcast
        self._broadcast_task: Optional[asyncio.Task] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        # Health tracking
        self.health = StreamHealth(camera_id=camera_id)
        self._start_time: float = 0.0

        # JPEG encode params (pre-allocated for speed)
        self._jpeg_quality = min(settings.STREAM_JPEG_QUALITY, 70)
        self._encode_params = [cv2.IMWRITE_JPEG_QUALITY, self._jpeg_quality]

    # ---- public ----------------------------------------------------------

    def start(self) -> None:
        """Start the dedicated reader thread and broadcast task."""
        if self._running:
            return
        self._running = True
        self._start_time = time.time()
        self._loop = asyncio.get_event_loop()

        # Start dedicated reader thread (not from thread pool!)
        self._thread = threading.Thread(
            target=self._reader_thread,
            name=f"cam-{self.camera_id[:8]}",
            daemon=True
        )
        self._thread.start()
        logger.info(f"▶  Stream started: {self.camera_id}")

    async def stop(self) -> None:
        """Stop the reader thread and release capture."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        self._release_capture()
        self.health.connected = False
        logger.info(f"⏹  Stream stopped: {self.camera_id}")

    def get_snapshot(self) -> Optional[bytes]:
        """Return latest JPEG frame bytes, or None."""
        return self._latest_frame

    def get_raw_frame(self) -> Optional[np.ndarray]:
        """Return latest raw BGR frame (for AI pipelines)."""
        return self._latest_raw

    # ---- reader thread (runs in dedicated OS thread) ---------------------

    def _reader_thread(self) -> None:
        """Dedicated thread: connect → read → encode → push to event loop."""
        backoff = 2.0

        while self._running:
            try:
                # Connect
                cap = self._open_capture()
                if cap is None:
                    self.health.error_count += 1
                    self.health.last_error = "Failed to open RTSP URL"
                    logger.warning(f"⚠  Cannot open: {self.camera_id} – retrying in {backoff}s")
                    self._sleep(backoff)
                    backoff = min(backoff * 2, 30.0)
                    self.health.reconnect_count += 1
                    continue

                self._cap = cap
                backoff = 2.0
                self.health.connected = True
                self.health.last_error = ""
                logger.info(f"🟢 Connected: {self.camera_id}")

                # Read loop
                self._read_loop_sync()

            except Exception as e:
                self.health.connected = False
                self.health.error_count += 1
                self.health.last_error = str(e)
                logger.error(f"❌ Stream error {self.camera_id}: {e}")
                self._sleep(backoff)
                backoff = min(backoff * 2, 30.0)
                self.health.reconnect_count += 1

        self._release_capture()

    def _sleep(self, seconds: float) -> None:
        """Sleep that can be interrupted by stop()."""
        end = time.time() + seconds
        while self._running and time.time() < end:
            time.sleep(0.1)

    def _open_capture(self) -> Optional[cv2.VideoCapture]:
        """Try GStreamer (HW) first, then FFmpeg fallback."""
        self._release_capture()

        # Attempt 1: GStreamer with decodebin (auto-selects nvv4l2decoder on Jetson)
        gst_pipeline = (
            f'rtspsrc location="{self.rtsp_url}" latency=0 '
            f'protocols=tcp drop-on-latency=true ! '
            f'decodebin ! videoconvert ! '
            f'video/x-raw,format=BGR ! '
            f'appsink drop=1 max-buffers=1 sync=false'
        )
        try:
            cap = cv2.VideoCapture(gst_pipeline, cv2.CAP_GSTREAMER)
            if cap.isOpened():
                logger.info(f"🎬 {self.camera_id}: GStreamer HW decoder (realtime)")
                return cap
            cap.release()
        except Exception:
            pass

        # Attempt 2: FFmpeg
        cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if cap.isOpened():
            logger.info(f"📹 {self.camera_id}: FFmpeg decoder")
            return cap
        cap.release()

        # Attempt 3: FFmpeg with TCP in URL
        rtsp_tcp = self.rtsp_url + ('&tcp' if '?' in self.rtsp_url else '?tcp')
        cap = cv2.VideoCapture(rtsp_tcp, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if cap.isOpened():
            logger.info(f"📹 {self.camera_id}: FFmpeg decoder (TCP)")
            return cap
        cap.release()
        return None

    def _read_loop_sync(self) -> None:
        """Synchronous read loop running in the dedicated thread."""
        frame_interval = 1.0 / self.target_fps
        fps_counter = 0
        fps_start = time.time()

        while self._running and self._cap and self._cap.isOpened():
            loop_start = time.time()

            ret, frame = self._cap.read()
            if not ret or frame is None:
                logger.warning(f"⚠  Frame read failed: {self.camera_id} – reconnecting")
                self.health.connected = False
                break

            # Store raw frame (full resolution for AI)
            self._latest_raw = frame

            # Resize for streaming if too wide (saves JPEG encode time + bandwidth)
            h, w = frame.shape[:2]
            if w > _STREAM_MAX_WIDTH:
                scale = _STREAM_MAX_WIDTH / w
                frame = cv2.resize(frame, (0, 0), fx=scale, fy=scale,
                                   interpolation=cv2.INTER_NEAREST)

            # JPEG encode
            ok, buf = cv2.imencode(".jpg", frame, self._encode_params)
            if ok:
                jpeg = buf.tobytes()
                self._latest_frame = jpeg
                self.health.frame_count += 1
                self.health.last_frame_time = time.time()
                self.health.uptime_seconds = time.time() - self._start_time

                # Push to event loop for WebSocket broadcast (non-blocking)
                if self._loop and not self._loop.is_closed():
                    channel = f"camera:{self.camera_id}"
                    try:
                        self._loop.call_soon_threadsafe(
                            asyncio.ensure_future,
                            ws_manager.broadcast_bytes(channel, jpeg)
                        )
                    except RuntimeError:
                        pass  # Loop closed during shutdown

            # FPS tracking
            fps_counter += 1
            elapsed = time.time() - fps_start
            if elapsed >= 1.0:
                self.health.fps_actual = fps_counter / elapsed
                fps_counter = 0
                fps_start = time.time()

            # Throttle to target FPS
            dt = time.time() - loop_start
            sleep_time = frame_interval - dt
            if sleep_time > 0:
                time.sleep(sleep_time)

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
        self, camera_id: str, rtsp_url: str, fps: int = None
    ) -> CameraStream:
        if fps is None:
            fps = settings.STREAM_MAX_FPS
        """Start streaming a camera. If already streaming, return existing."""
        if camera_id in self._streams:
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
        self, camera_id: str, rtsp_url: str, fps: int = None
    ) -> CameraStream:
        if fps is None:
            fps = settings.STREAM_MAX_FPS
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
            fps = min(cam.get("fps", settings.STREAM_MAX_FPS), settings.STREAM_MAX_FPS)
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
