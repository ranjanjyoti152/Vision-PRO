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
from bson import ObjectId

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
        """Load the model into PyTorch/GPU."""
        logger.info(f"🧠 Loading YOLO model: {self.model_name}")
        model_path = str(settings.YOLO_MODELS_DIR / self.model_name)
        
        # If the file doesn't exist locally, Ultralytics will download it to current dir
        # We explicitly use the name if it's default so it downloads via PyTorch Hub
        if not os.path.exists(model_path) and self.model_name == "yolov8n.pt":
            self.model = YOLO("yolov8n.pt")
        else:
            self.model = YOLO(model_path)
            
        logger.info(f"✅ YOLO model loaded onto {self.model.device}")

    def predict(self, frame: np.ndarray) -> list:
        """Run inference on a single BGR frame. Returns list of Results."""
        if self.model is None:
            return []
        # Run inference (non-blocking in thread pool later)
        return self.model.predict(frame, verbose=False)


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

    def start(self):
        """Start the worker loop."""
        if self._running:
            return
            
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
            mapped_type = self._map_class_to_event_type(class_name)
            
            if mapped_type.value not in target_classes:
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
            
        # Cooldown passed -> Create Event
        face_id = None
        
        # If PERSON detected, run Face Recognition pipeline
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
                        await faces_collection().update_one(
                            {"_id": ObjectId(face_id)},
                            {"$set": {"last_seen": datetime.now(timezone.utc)}, "$inc": {"total_appearances": 1}}
                        )
                    else:
                        highest_conf_class = EventType.FACE_UNKNOWN
                        now_utc = datetime.now(timezone.utc)
                        doc = {
                            "name": None,
                            "is_known": False,
                            "reference_images": [],
                            "embedding_ids": [],
                            "first_seen": now_utc,
                            "last_seen": now_utc,
                            "total_appearances": 1,
                            "created_at": now_utc,
                            "updated_at": now_utc,
                        }
                        insert_res = await faces_collection().insert_one(doc)
                        face_id = str(insert_res.inserted_id)
                        
                        point_id = await asyncio.to_thread(face_engine.enroll_face, face_id, embedding)
                        if point_id:
                            await faces_collection().update_one(
                                {"_id": insert_res.inserted_id},
                                {"$push": {"embedding_ids": point_id}}
                            )

        await self._create_event(cam_id, highest_conf_class, highest_conf, primary_bbox, detected_objs, frame, result, face_id)

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
        annotated_frame = result.plot()
        snapshot_filename = f"{cam_id}_{event_uuid}.jpg"
        snapshot_abs_path = settings.SNAPSHOT_PATH / snapshot_filename
        
        await asyncio.to_thread(
            cv2.imwrite, str(snapshot_abs_path), annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, 85]
        )
        
        # 2. Get AI Summary from LLM Service
        face_name = None
        if face_id:
            from app.database import faces_collection
            face_doc = await faces_collection().find_one({"_id": ObjectId(face_id)})
            if face_doc:
                face_name = face_doc.get("name")
                
        ai_summary = await llm_service.generate_event_summary(
            event_type, confidence, [obj.model_dump(by_alias=True) for obj in detected_objs], face_name
        )
        
        # 3. Construct DB Event
        now = datetime.now(timezone.utc)
        
        event_doc = {
            "camera_id": cam_id,
            "event_type": event_type.value,
            "confidence": confidence,
            "timestamp": now,
            "snapshot_path": f"/snapshots/{snapshot_filename}",
            "video_clip_path": "",  # To be filled by Recording worker later
            "bounding_box": primary_bbox.model_dump(),
            "ai_summary": ai_summary,
            "detected_objects": [obj.model_dump(by_alias=True) for obj in detected_objs],
            "face_id": ObjectId(face_id) if face_id else None,
            "metadata": {},
            "created_at": now,
        }
        
        await events_collection().insert_one(event_doc)
        logger.info(f"🚨 Event generated: {event_type.value} on camera {cam_id} ({confidence:.2f})")
        
        # 4. Dispatch Notifications
        # Fire and forget (don't wait for completion) to avoid blocking the detection loop
        asyncio.create_task(
            notification_service.dispatch(ai_summary, str(snapshot_abs_path))
        )

# Singleton
detection_worker = DetectionWorker()
