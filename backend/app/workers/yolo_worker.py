"""
GPU-Accelerated YOLO Object Detection Worker.

This worker runs in the background, pulls frames from the StreamManager,
runs YOLOv8 object detection, and generates events (with debouncing)
when objects of interest are detected.
"""
import asyncio
import logging
import time
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, Optional
from collections import deque
from bson import ObjectId
from dataclasses import dataclass, field

import cv2
import numpy as np

# Suppress ultralytics welcome prints
os.environ["YOLO_VERBOSE"] = "False"
from ultralytics import YOLO

from app.config import settings
from app.services.stream_manager import stream_manager
from app.models.event import EventType, EventCreate, BoundingBox, DetectedObject
from app.services.llm_service import llm_service
from app.services.notification_service import notification_service

logger = logging.getLogger(__name__)


class YOLOEngine:
    """Wrapper for the Ultralytics YOLO model."""

    def __init__(self, model_name: str = "yolov8n.pt"):
        self.model_name = model_name
        self.model = None

    def load(self):
        """Load the model into GPU (CUDA)."""
        logger.info(f"🧠 Loading YOLO model: {self.model_name}")
        model_path = str(settings.YOLO_MODELS_DIR / self.model_name)
        
        # If the file doesn't exist locally, Ultralytics will download it to current dir
        # We explicitly use the name if it's default so it downloads via PyTorch Hub
        if not os.path.exists(model_path) and self.model_name == "yolov8n.pt":
            self.model = YOLO("yolov8n.pt")
        else:
            self.model = YOLO(model_path)
        
        # Force model onto GPU if CUDA is available
        import torch
        if torch.cuda.is_available():
            self.model.to("cuda:0")
            logger.info(f"✅ YOLO model loaded onto GPU (cuda:0)")
        else:
            logger.warning("⚠️ CUDA not available — YOLO running on CPU")

    def predict(self, frame: np.ndarray) -> list:
        """Run inference on a single BGR frame. Returns list of Results."""
        if self.model is None:
            return []
        # Run inference on GPU if available
        import torch
        device = 0 if torch.cuda.is_available() else "cpu"
        return self.model.predict(frame, verbose=False, device=device)


@dataclass
class CooldownTracker:
    """Tracks last event time per camera per class to prevent log spam."""
    last_event_time: Dict[str, float] = field(default_factory=dict)
    
    def can_trigger(self, class_name: str, cooldown_secs: int) -> bool:
        now = time.time()
        last = self.last_event_time.get(class_name, 0.0)
        if (now - last) >= cooldown_secs:
            self.last_event_time[class_name] = now
            return True
        return False


class DetectionWorker:
    """Background worker that continuously processes camera frames."""

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self.engine = YOLOEngine()
        
        # camera_id -> CooldownTracker
        self.cooldowns: Dict[str, CooldownTracker] = {}
        
        # Frame ring buffer for video clips: camera_id -> deque of (timestamp, frame)
        self._frame_buffers: Dict[str, deque] = {}
        self._buffer_max_seconds = 5  # Keep last 5 seconds of frames

        # ROI zone cache: camera_id -> list of zone dicts
        self._roi_cache: Dict[str, list] = {}
        self._roi_cache_time: float = 0
        self._roi_cache_ttl: float = 30  # Refresh every 30 seconds
        self._roi_cooldowns: Dict[str, float] = {}  # zone_id -> last trigger time

    def start(self):
        """Start the worker loop."""
        if self._running:
            return

        # Load the active model from active_model.json (if it exists),
        # otherwise fall back to the default yolov8n.pt
        try:
            import json
            active_path = os.path.join(settings.MODELS_PATH, "active_model.json")
            if os.path.exists(active_path):
                with open(active_path) as f:
                    info = json.load(f)
                pt_path = info.get("pt_path", "")
                if pt_path and os.path.exists(pt_path):
                    self.engine = YOLOEngine(model_name=os.path.basename(pt_path))
                    logger.info(f"📋 Using active model from config: {pt_path}")
        except Exception as e:
            logger.warning(f"Could not read active_model.json, using default: {e}")

        # Load model synchronously first so we don't block the loop later
        self.engine.load()
        from app.services.face_service import face_engine
        face_engine.load()

            
        self._running = True
        self._task = asyncio.create_task(self._run_loop(), name="yolo-worker")
        logger.info("▶ YOLO Detection Worker started")

    async def stop(self):
        """Stop the worker loop cleanly."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("⏹ YOLO Detection Worker stopped")

    async def reload_model(self, model_path: str):
        """Hot-swap the YOLO model without restarting the worker."""
        logger.info(f"🔄 Reloading YOLO model: {model_path}")
        try:
            new_engine = YOLOEngine(model_name=os.path.basename(model_path))
            new_engine.load()
            self.engine = new_engine
            logger.info(f"✅ YOLO model reloaded: {model_path}")
        except Exception as e:
            logger.error(f"❌ Failed to reload YOLO model: {e}")
            raise


    async def _run_loop(self):
        """Main detection polling loop."""
        interval = settings.YOLO_INFERENCE_INTERVAL
        
        while self._running:
            try:
                start_time = time.time()
                await self._process_active_cameras()
                
                # Throttle loop to interval
                elapsed = time.time() - start_time
                sleep_time = interval - elapsed
                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)
                else:
                    await asyncio.sleep(0.01)  # Yield to event loop
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"❌ YOLO worker error: {e}")
                await asyncio.sleep(5)

    async def _process_active_cameras(self):
        """Fetch raw frames from active streams and run inference."""
        from app.database import cameras_collection
        
        # Get all cameras where object_detection is enabled
        cursor = cameras_collection().find({"enabled": True, "detection_config.object_detection": True})
        cameras = await cursor.to_list(length=100)
        
        for cam in cameras:
            cam_id = str(cam["_id"])
            
            # Check if StreamManager is actually connected & has a frame
            status = stream_manager.get_stream_status(cam_id)
            if not status or not status.get("connected"):
                continue
                
            frame = stream_manager.get_raw_frame(cam_id)
            if frame is None:
                continue

            # Buffer frame for video clip generation
            if cam_id not in self._frame_buffers:
                self._frame_buffers[cam_id] = deque(maxlen=150)  # ~5s at 30fps
            self._frame_buffers[cam_id].append((time.time(), frame.copy()))

            # Run inference in a thread pool to avoid blocking the asyncio loop
            results = await asyncio.to_thread(self.engine.predict, frame)
            if not results:
                continue
                
            await self._process_results(cam, frame, results[0])

    async def _process_results(self, cam: dict, frame: np.ndarray, result) -> None:
        """Parse YOLO results, filter by config, draw boxes, and save events."""
        cam_id = str(cam["_id"])
        config = cam.get("detection_config", {})
        target_classes = config.get("detection_classes", ["person", "vehicle", "animal"])
        threshold = config.get("confidence_threshold", 0.5)
        
        if cam_id not in self.cooldowns:
            self.cooldowns[cam_id] = CooldownTracker()
            
        tracker = self.cooldowns[cam_id]
        detected_objs: list[DetectedObject] = []
        highest_conf_class = None
        highest_conf = 0.0
        primary_bbox = None
        
        # Parse boxes
        if not result.boxes:
            return
            
        boxes = result.boxes.xyxy.cpu().numpy()
        confs = result.boxes.conf.cpu().numpy()
        class_ids = result.boxes.cls.cpu().numpy()
        names = result.names
        
        for box, conf, cls_id in zip(boxes, confs, class_ids):
            class_name = names[int(cls_id)]
            
            # Filter logic: map YOLO classes to our target classes
            # (e.g., car/truck/bus -> vehicle, dog/cat/bird -> animal)
            # Also accept raw class names for custom-trained models
            mapped_type = self._map_class_to_event_type(class_name)
            
            if mapped_type.value not in target_classes and class_name not in target_classes:
                continue

            if float(conf) < threshold:
                continue
                
            x1, y1, x2, y2 = map(int, box)
            bbox = BoundingBox(x=x1, y=y1, w=int(x2-x1), h=int(y2-y1))
            
            detected_objs.append(
                DetectedObject(
                    **{"class": class_name, "confidence": float(conf), "bbox": bbox.model_dump()}
                )
            )
            
            if conf > highest_conf:
                highest_conf = float(conf)
                highest_conf_class = mapped_type
                primary_bbox = bbox
                
        if not detected_objs:
            return

        # ── Broadcast detections for live bounding-box overlay ─────
        try:
            from app.core.websocket import ws_manager
            det_payload = {
                "camera_id": cam_id,
                "timestamp": time.time(),
                "frame_w": frame.shape[1],
                "frame_h": frame.shape[0],
                "detections": [
                    {
                        "class": obj.class_name,
                        "confidence": round(obj.confidence, 2),
                        "bbox": obj.bbox.model_dump() if hasattr(obj.bbox, 'model_dump') else obj.bbox,
                    }
                    for obj in detected_objs
                ],
            }
            await ws_manager.broadcast_to_channel(
                f"detections:{cam_id}", det_payload
            )
        except Exception:
            pass  # Non-critical: don't break detection pipeline

        # ── Face Recognition (runs for ALL person detections) ──────
        face_id = None

        if highest_conf_class == EventType.PERSON and primary_bbox:
            pad_w = int(primary_bbox.w * 0.2)
            pad_h = int(primary_bbox.h * 0.2)
            y1 = max(0, primary_bbox.y - pad_h)
            y2 = min(frame.shape[0], primary_bbox.y + primary_bbox.h + pad_h)
            x1 = max(0, primary_bbox.x - pad_w)
            x2 = min(frame.shape[1], primary_bbox.x + primary_bbox.w + pad_w)

            crop = frame[y1:y2, x1:x2]

            if crop.size > 0:
                from app.services.face_service import face_engine
                from app.database import faces_collection

                embedding = await asyncio.to_thread(face_engine.extract_embedding, crop)
                if embedding is not None:
                    matched_id, score = await asyncio.to_thread(face_engine.match_face, embedding, threshold=0.5)

                    if matched_id:
                        face_id = matched_id
                        highest_conf_class = EventType.FACE_KNOWN
                        update_fields: dict = {"last_seen": datetime.now(timezone.utc)}
                        # Save face crop thumbnail if face doesn't have one yet
                        face_doc = await faces_collection().find_one({"_id": ObjectId(face_id)})
                        if face_doc and not face_doc.get("thumbnail"):
                            crop_path = self._save_face_crop(crop, face_id)
                            if crop_path:
                                update_fields["thumbnail"] = crop_path
                        await faces_collection().update_one(
                            {"_id": ObjectId(face_id)},
                            {"$set": update_fields, "$inc": {"total_appearances": 1}}
                        )
                    else:
                        highest_conf_class = EventType.FACE_UNKNOWN
                        now_utc = datetime.now(timezone.utc)
                        doc = {
                            "name": None,
                            "is_known": False,
                            "reference_images": [],
                            "embedding_ids": [],
                            "thumbnail": None,
                            "first_seen": now_utc,
                            "last_seen": now_utc,
                            "total_appearances": 1,
                            "created_at": now_utc,
                            "updated_at": now_utc,
                        }
                        insert_res = await faces_collection().insert_one(doc)
                        face_id = str(insert_res.inserted_id)

                        # Save face crop thumbnail
                        crop_path = self._save_face_crop(crop, face_id)
                        if crop_path:
                            await faces_collection().update_one(
                                {"_id": insert_res.inserted_id},
                                {"$set": {"thumbnail": crop_path}}
                            )

                        point_id = await asyncio.to_thread(face_engine.enroll_face, face_id, embedding)
                        if point_id:
                            await faces_collection().update_one(
                                {"_id": insert_res.inserted_id},
                                {"$push": {"embedding_ids": point_id}}
                            )

        # ── ROI Zone Check (only gates event creation) ─────────────
        roi_triggered = await self._check_roi_zones(cam_id, detected_objs, frame)
        if not roi_triggered:
            return

        if primary_bbox is None or highest_conf_class is None:
            logger.warning(f"⚠️ ROI triggered on {cam_id} but primary_bbox or event_type is None — skipping event")
            return

        try:
            await self._create_event(cam_id, highest_conf_class, highest_conf, primary_bbox, detected_objs, frame, result, face_id)
        except Exception as e:
            logger.error(f"❌ Failed to create event for camera {cam_id}: {e}", exc_info=True)


    def _save_face_crop(self, crop: np.ndarray, face_id: str) -> Optional[str]:
        """Save a face crop image to disk and return its web-accessible path."""
        try:
            face_crops_dir = os.path.join(os.path.dirname(settings.SNAPSHOT_PATH), "face_crops")
            os.makedirs(face_crops_dir, exist_ok=True)
            filename = f"{face_id}.jpg"
            filepath = os.path.join(face_crops_dir, filename)
            # Resize to a consistent thumbnail size
            h, w = crop.shape[:2]
            target_size = 200
            if h > 0 and w > 0:
                scale = target_size / max(h, w)
                new_w, new_h = int(w * scale), int(h * scale)
                resized = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_AREA)
                cv2.imwrite(filepath, resized, [cv2.IMWRITE_JPEG_QUALITY, 85])
                return f"/face_crops/{filename}"
        except Exception as e:
            logger.error(f"Failed to save face crop for {face_id}: {e}")

        return None

    async def _load_roi_zones(self, cam_id: str) -> list:
        """Load ROI zones for a camera, with caching."""
        import time as _time
        now = _time.time()
        if now - self._roi_cache_time > self._roi_cache_ttl:
            # Refresh full cache
            from app.database import roi_zones_collection
            cursor = roi_zones_collection().find({"enabled": True})
            all_zones = await cursor.to_list(length=500)
            self._roi_cache.clear()
            for z in all_zones:
                cid = z.get("camera_id", "")
                if cid not in self._roi_cache:
                    self._roi_cache[cid] = []
                self._roi_cache[cid].append(z)
            self._roi_cache_time = now
        return self._roi_cache.get(cam_id, [])

    async def _check_roi_zones(self, cam_id: str, detected_objs: list, frame: np.ndarray) -> bool:
        """Check if any detected objects fall inside active ROI zones.
        Returns True if at least one object triggered a zone, False otherwise.
        """
        import time as _time
        zones = await self._load_roi_zones(cam_id)
        if not zones:
            return False

        h, w = frame.shape[:2]
        now = _time.time()

        for zone in zones:
            zone_id = str(zone["_id"])
            trigger_classes = zone.get("trigger_classes", [])
            zone_points = zone.get("points", [])
            if len(zone_points) < 3:
                continue

            # Convert normalised points to pixel polygon
            polygon = np.array(
                [[int(p[0] * w), int(p[1] * h)] for p in zone_points],
                dtype=np.int32,
            )

            # Per-zone cooldown (30s)
            last_trigger = self._roi_cooldowns.get(zone_id, 0)
            if now - last_trigger < 30:
                continue

            for obj in detected_objs:
                # Get raw class name from DetectedObject
                obj_class = obj.class_name

                # Check if the object's class matches the zone's trigger classes
                raw_trigger = trigger_classes  # e.g. ["person", "car"]
                mapped = self._map_class_to_event_type(obj_class)
                if obj_class not in raw_trigger and mapped.value not in raw_trigger:
                    continue

                # Get object center from bbox
                bbox = obj.bbox
                if isinstance(bbox, dict):
                    cx = bbox.get("x", 0) + bbox.get("w", 0) // 2
                    cy = bbox.get("y", 0) + bbox.get("h", 0) // 2
                else:
                    cx = bbox.x + bbox.w // 2
                    cy = bbox.y + bbox.h // 2


                # Point-in-polygon test
                result = cv2.pointPolygonTest(polygon, (float(cx), float(cy)), False)
                if result >= 0:
                    # Object is inside the zone!
                    self._roi_cooldowns[zone_id] = now
                    zone_name = zone.get("name", "ROI Zone")
                    logger.info(f"🎯 ROI triggered: '{zone_name}' — {obj_class} detected in zone on camera {cam_id}")

                    # Send notification if enabled
                    if zone.get("notify"):
                        try:
                            await notification_service.send(
                                title=f"🎯 ROI Alert: {zone_name}",
                                message=f"{obj_class} detected in '{zone_name}' zone",
                                priority="high",
                            )
                        except Exception as e:
                            logger.warning(f"ROI notification failed: {e}")
                    return True  # At least one object triggered a zone

        return False  # No object triggered any zone

    def _map_class_to_event_type(self, yolo_class: str) -> EventType:
        """Map raw COCO class names to generic internal event types."""
        vehicles = {"car", "motorcycle", "bus", "train", "truck"}
        animals = {"bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe"}
        
        if yolo_class == "person":
            return EventType.PERSON
        elif yolo_class in vehicles:
            return EventType.VEHICLE
        elif yolo_class in animals:
            return EventType.ANIMAL
        else:
            return EventType.CUSTOM

    async def _create_event(
        self, cam_id: str, event_type: EventType, confidence: float, 
        primary_bbox: BoundingBox, detected_objs: list[DetectedObject], 
        raw_frame: np.ndarray, result, face_id: Optional[str] = None
    ):
        """Save snapshot, generate the database event."""
        from app.database import events_collection
        
        event_uuid = str(uuid.uuid4())
        
        # 1. Plot boxes on frame and save snapshot
        try:
            annotated_frame = result.plot()
        except Exception as e:
            logger.warning(f"result.plot() failed ({e}), using raw frame")
            annotated_frame = raw_frame

        snapshot_filename = f"{cam_id}_{event_uuid}.jpg"
        snapshot_abs_path = settings.SNAPSHOT_DIR / snapshot_filename
        
        await asyncio.to_thread(
            cv2.imwrite, str(snapshot_abs_path), annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 85]
        )
        
        # 2. Construct DB Event (insert immediately with default summary)
        face_name = None
        if face_id:
            from app.database import faces_collection
            face_doc = await faces_collection().find_one({"_id": ObjectId(face_id)})
            if face_doc:
                face_name = face_doc.get("name")

        now = datetime.now(timezone.utc)
        default_summary = f"{event_type.value} detected" + (f" ({face_name})" if face_name else "")
        
        event_doc = {
            "camera_id": cam_id,
            "event_type": event_type.value,
            "confidence": confidence,
            "timestamp": now,
            "snapshot_path": f"/snapshots/{snapshot_filename}",
            "video_clip_path": "",
            "bounding_box": primary_bbox.model_dump(),
            "ai_summary": default_summary,
            "detected_objects": [obj.model_dump(by_alias=True) for obj in detected_objs],
            "face_id": ObjectId(face_id) if face_id else None,
            "metadata": {},
            "created_at": now,
        }
        
        result_insert = await events_collection().insert_one(event_doc)
        event_oid = result_insert.inserted_id
        logger.info(f"🚨 Event generated: {event_type.value} on camera {cam_id} ({confidence:.2f})")
        
        # 3. Save video clip from ring buffer (non-blocking)
        asyncio.create_task(
            self._save_video_clip(cam_id, event_uuid, event_oid, raw_frame)
        )
        
        # 4. Enqueue AI summary for sequential processing
        llm_service.enqueue_summary(
            event_oid=event_oid,
            event_type=event_type,
            confidence=confidence,
            objects=[obj.model_dump(by_alias=True) for obj in detected_objs],
            face_name=face_name,
        )
        
        # 5. Dispatch Notifications (fire and forget)
        asyncio.create_task(
            notification_service.dispatch(default_summary, str(snapshot_abs_path))
        )


    async def handle_deepstream_event(
        self,
        camera_id: str,
        detections: list,
        jpeg: Optional[bytes],
        timestamp: float,
    ) -> None:
        """
        Entry point called by the DeepStream ZMQ receiver.
        Mirrors _process_results() but works from pre-parsed detection dicts
        produced by the GStreamer pad probe (no OpenCV / PyTorch needed here).
        """
        if not detections:
            return

        tracker = self.cooldown_trackers.get(camera_id)
        if not tracker:
            tracker = CooldownTracker()
            self.cooldown_trackers[camera_id] = tracker

        # Pick the highest-confidence detection as the primary event trigger
        primary = max(detections, key=lambda d: d.get("confidence", 0))
        event_type_str = primary.get("event_type", "custom")

        try:
            event_type = EventType(event_type_str)
        except ValueError:
            event_type = EventType.CUSTOM

        conf = float(primary.get("confidence", 0.0))
        if conf < 0.45:
            return

        if not tracker.can_trigger(event_type.value, settings.EVENT_COOLDOWN_SECONDS):
            return

        # Build BoundingBox and DetectedObjects from DS detection dicts
        bbox_raw = primary.get("bbox", [0, 0, 100, 100])
        primary_bbox = BoundingBox(
            x=int(bbox_raw[0]), y=int(bbox_raw[1]),
            width=int(bbox_raw[2]), height=int(bbox_raw[3]),
        )

        detected_objs = [
            DetectedObject(
                class_name=d.get("class_name", "unknown"),
                confidence=float(d.get("confidence", 0.0)),
                bounding_box=BoundingBox(
                    x=int(d["bbox"][0]), y=int(d["bbox"][1]),
                    width=int(d["bbox"][2]), height=int(d["bbox"][3]),
                )
            )
            for d in detections
        ]

        await self._create_event_from_jpeg(
            cam_id=camera_id,
            event_type=event_type,
            confidence=conf,
            primary_bbox=primary_bbox,
            detected_objs=detected_objs,
            jpeg=jpeg,
        )

    async def _save_video_clip(
        self, cam_id: str, event_uuid: str, event_oid, current_frame: np.ndarray
    ) -> None:
        """Write buffered frames + post-event frames to a browser-compatible WebM clip."""
        try:
            from app.database import events_collection

            clip_filename = f"{cam_id}_{event_uuid}.mp4"
            clip_path = settings.RECORDING_DIR / clip_filename

            # Grab buffered pre-event frames
            buffer = self._frame_buffers.get(cam_id)
            if not buffer or len(buffer) < 2:
                return

            # Record the actual start time from the buffer
            start_time = datetime.fromtimestamp(buffer[0][0], tz=timezone.utc)
            frames = [f.copy() for _, f in buffer]

            # Estimate FPS from buffer timestamps
            timestamps = [t for t, _ in buffer]
            time_span = timestamps[-1] - timestamps[0]
            est_fps = max(5.0, len(timestamps) / max(time_span, 0.1))
            fps = min(est_fps, 30.0)  # Cap at 30fps

            # Capture 3 more seconds of post-event frames
            post_frames = int(fps * 3)
            interval = 1.0 / fps
            for _ in range(post_frames):
                await asyncio.sleep(interval)
                frame = stream_manager.get_raw_frame(cam_id)
                if frame is not None:
                    frames.append(frame.copy())

            end_time = datetime.now(timezone.utc)
            actual_duration = len(frames) / fps

            # Write video — try H.264 first (browser-native), fall back to mp4v + ffmpeg
            result_info = [clip_filename, clip_path]  # mutable container for inner fn

            def write_clip():
                import subprocess
                import shutil

                h, w = frames[0].shape[:2]
                out_filename = result_info[0]
                out_path = result_info[1]

                # Try H.264 codec first (browser-compatible natively)
                for codec in ['avc1', 'H264', 'mp4v']:
                    fourcc = cv2.VideoWriter_fourcc(*codec)
                    writer = cv2.VideoWriter(str(out_path), fourcc, fps, (w, h))
                    if writer.isOpened():
                        break
                    writer.release()
                else:
                    # Last resort: XVID in AVI
                    out_filename = f"{cam_id}_{event_uuid}.avi"
                    out_path = settings.RECORDING_DIR / out_filename
                    fourcc = cv2.VideoWriter_fourcc(*'XVID')
                    writer = cv2.VideoWriter(str(out_path), fourcc, fps, (w, h))
                    result_info[0] = out_filename
                    result_info[1] = out_path

                for f in frames:
                    if f.shape[:2] == (h, w):
                        writer.write(f)
                writer.release()

                # If we used mp4v (not browser-compatible), re-encode with ffmpeg to H.264
                if codec == 'mp4v' and shutil.which('ffmpeg'):
                    h264_filename = out_filename.replace('.mp4', '_h264.mp4')
                    h264_path = settings.RECORDING_DIR / h264_filename
                    try:
                        subprocess.run([
                            'ffmpeg', '-y', '-i', str(out_path),
                            '-c:v', 'libx264', '-preset', 'ultrafast',
                            '-crf', '28', '-movflags', '+faststart',
                            str(h264_path),
                        ], capture_output=True, timeout=60)
                        if h264_path.exists() and h264_path.stat().st_size > 0:
                            os.remove(str(out_path))
                            os.rename(str(h264_path), str(out_path))
                            logger.info("🎬 Re-encoded clip to H.264 for browser playback")
                    except Exception as e:
                        logger.warning(f"ffmpeg re-encode failed (clip still playable via download): {e}")


            await asyncio.to_thread(write_clip)

            # Read back possibly-updated filename/path from inner fn
            clip_filename = result_info[0]
            clip_path = result_info[1]

            # Update event document with clip path
            clip_url = f"/recordings/{clip_filename}"
            await events_collection().update_one(
                {"_id": event_oid},
                {"$set": {"video_clip_path": clip_url}}
            )

            # Also insert a recording document so it shows in recordings list
            from app.database import recordings_collection
            rec_doc = {
                "camera_id": cam_id,
                "file_path": str(clip_path),
                "start_time": start_time,
                "end_time": end_time,
                "duration_seconds": actual_duration,
                "file_size_bytes": clip_path.stat().st_size if clip_path.exists() else 0,
                "trigger_event_id": event_oid,
                "created_at": datetime.now(timezone.utc),
            }
            await recordings_collection().insert_one(rec_doc)

            logger.info(f"🎬 Video clip saved: {clip_filename} ({len(frames)} frames, {actual_duration:.1f}s)")

        except Exception as e:
            logger.error(f"❌ Failed to save video clip: {e}")

    async def _create_event_from_jpeg(
        self,
        cam_id: str,
        event_type: EventType,
        confidence: float,
        primary_bbox: BoundingBox,
        detected_objs: list,
        jpeg: Optional[bytes],
    ) -> None:
        """Create a DB event from a raw JPEG snapshot (DeepStream path)."""
        from app.database import events_collection
        import uuid

        event_uuid = str(uuid.uuid4())
        snapshot_filename = f"{cam_id}_{event_uuid}.jpg"
        snapshot_abs_path = settings.SNAPSHOT_DIR / snapshot_filename

        if jpeg:
            await asyncio.to_thread(snapshot_abs_path.write_bytes, jpeg)

        default_summary = f"{event_type.value} detected"
        now = datetime.now(timezone.utc)
        event_doc = {
            "camera_id":       cam_id,
            "event_type":      event_type.value,
            "confidence":      confidence,
            "timestamp":       now,
            "snapshot_path":   f"/snapshots/{snapshot_filename}" if jpeg else "",
            "video_clip_path": "",
            "bounding_box":    primary_bbox.model_dump(),
            "ai_summary":      default_summary,
            "detected_objects": [obj.model_dump(by_alias=True) for obj in detected_objs],
            "face_id":         None,
            "metadata":        {"source": "deepstream"},
            "created_at":      now,
        }

        result_insert = await events_collection().insert_one(event_doc)
        event_oid = result_insert.inserted_id
        logger.info(f"🚨 [DeepStream] Event: {event_type.value} on cam {cam_id} ({confidence:.2f})")

        # Enqueue AI summary for sequential processing
        llm_service.enqueue_summary(
            event_oid=event_oid,
            event_type=event_type,
            confidence=confidence,
            objects=[obj.model_dump(by_alias=True) for obj in detected_objs],
        )

        if jpeg:
            asyncio.create_task(
                notification_service.dispatch(default_summary, str(snapshot_abs_path))
            )


# Singleton
detection_worker = DetectionWorker()
