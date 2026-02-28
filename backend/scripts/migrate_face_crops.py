"""
One-time migration: generate face crop thumbnails for existing faces.

Finds faces without thumbnails, looks for a related event snapshot,
extracts a face crop from the snapshot, and updates the face document.

Usage:
    cd /home/proxpc/Vision-Pro/backend
    python -m scripts.migrate_face_crops
"""
import asyncio
import os
import sys
import cv2
import numpy as np
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.config import settings

FACE_CROPS_DIR = os.path.join(os.path.dirname(settings.SNAPSHOT_PATH), "face_crops")
os.makedirs(FACE_CROPS_DIR, exist_ok=True)


async def migrate():
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB]
    faces_col = db["faces"]
    events_col = db["events"]

    # Find all faces without thumbnails
    cursor = faces_col.find({"$or": [{"thumbnail": None}, {"thumbnail": {"$exists": False}}]})
    faces = await cursor.to_list(length=1000)
    print(f"Found {len(faces)} faces without thumbnails")

    saved = 0
    for face in faces:
        face_id = str(face["_id"])

        # Check if we already have a crop file
        crop_path = os.path.join(FACE_CROPS_DIR, f"{face_id}.jpg")
        if os.path.exists(crop_path):
            # File exists but DB not updated
            await faces_col.update_one(
                {"_id": face["_id"]},
                {"$set": {"thumbnail": f"/face_crops/{face_id}.jpg"}}
            )
            saved += 1
            continue

        # Try to find an event with this face_id that has a snapshot
        event = await events_col.find_one({
            "face_id": face_id,
            "snapshot_path": {"$exists": True, "$ne": None}
        })

        if not event:
            # Try any event with face_known/face_unknown type near the face's first_seen time
            event = await events_col.find_one({
                "event_type": {"$in": ["face_known", "face_unknown"]},
                "snapshot_path": {"$exists": True, "$ne": None}
            }, sort=[("created_at", -1)])

        if not event or not event.get("snapshot_path"):
            continue

        # Load snapshot
        snap_path = event["snapshot_path"]
        # Resolve relative paths
        if not os.path.isabs(snap_path):
            snap_path = os.path.join(os.path.dirname(settings.SNAPSHOT_PATH), snap_path.lstrip("/"))
        
        if not os.path.exists(snap_path):
            # Try with snapshots dir
            snap_path = os.path.join(settings.SNAPSHOT_PATH, os.path.basename(event["snapshot_path"]))

        if not os.path.exists(snap_path):
            continue

        frame = cv2.imread(snap_path)
        if frame is None:
            continue

        # Try to find bounding box from event
        bbox = None
        if event.get("bbox"):
            bbox = event["bbox"]
        elif event.get("detected_objects"):
            for obj in event["detected_objects"]:
                if obj.get("class") == "person" and obj.get("bbox"):
                    bbox = obj["bbox"]
                    break

        if bbox:
            x, y, w, h = bbox.get("x", 0), bbox.get("y", 0), bbox.get("w", 0), bbox.get("h", 0)
            # Crop with padding
            pad_w, pad_h = int(w * 0.2), int(h * 0.2)
            y1 = max(0, y - pad_h)
            y2 = min(frame.shape[0], y + h + pad_h)
            x1 = max(0, x - pad_w)
            x2 = min(frame.shape[1], x + w + pad_w)
            crop = frame[y1:y2, x1:x2]
        else:
            # Use center crop of snapshot
            h, w = frame.shape[:2]
            size = min(h, w)
            cy, cx = h // 2, w // 2
            crop = frame[cy - size // 2:cy + size // 2, cx - size // 2:cx + size // 2]

        if crop.size == 0:
            continue

        # Resize to 200px thumbnail
        ch, cw = crop.shape[:2]
        scale = 200 / max(ch, cw)
        resized = cv2.resize(crop, (int(cw * scale), int(ch * scale)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(crop_path, resized, [cv2.IMWRITE_JPEG_QUALITY, 85])

        await faces_col.update_one(
            {"_id": face["_id"]},
            {"$set": {"thumbnail": f"/face_crops/{face_id}.jpg"}}
        )
        saved += 1

    print(f"Generated {saved}/{len(faces)} face crop thumbnails")
    client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
