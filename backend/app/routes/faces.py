"""
Face management routes.
"""
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from bson import ObjectId
import aiofiles
import os

from app.database import faces_collection
from app.core.security import get_current_user, require_admin
from app.models.face import FaceCreate, FaceUpdate, FaceResponse
from app.config import settings

router = APIRouter(prefix="/api/faces", tags=["Faces"])

FACES_UPLOAD_DIR = os.path.join(settings.MODELS_PATH, "face_references")


def _face_doc_to_response(face: dict) -> FaceResponse:
    return FaceResponse(
        id=str(face["_id"]),
        name=face.get("name"),
        is_known=face.get("is_known", False),
        reference_images=face.get("reference_images", []),
        embedding_ids=face.get("embedding_ids", []),
        first_seen=face.get("first_seen"),
        last_seen=face.get("last_seen"),
        total_appearances=face.get("total_appearances", 0),
        created_at=face["created_at"],
        updated_at=face.get("updated_at", face["created_at"]),
    )


@router.get("", response_model=list[FaceResponse])
async def list_faces(user: dict = Depends(get_current_user)):
    """List all known faces."""
    cursor = faces_collection().find({"is_known": True}).sort("name", 1)
    faces = await cursor.to_list(length=500)
    return [_face_doc_to_response(f) for f in faces]


@router.get("/unknown", response_model=list[FaceResponse])
async def list_unknown_faces(user: dict = Depends(get_current_user)):
    """List all unknown faces for labeling."""
    cursor = faces_collection().find({"is_known": False}).sort("last_seen", -1)
    faces = await cursor.to_list(length=500)
    return [_face_doc_to_response(f) for f in faces]


@router.post("", response_model=FaceResponse, status_code=201)
async def create_face(
    face_data: FaceCreate,
    admin: dict = Depends(require_admin),
):
    """Create a face profile."""
    now = datetime.now(timezone.utc)
    doc = {
        "name": face_data.name,
        "is_known": face_data.name is not None,
        "reference_images": [],
        "embedding_ids": [],
        "first_seen": now,
        "last_seen": now,
        "total_appearances": 0,
        "created_at": now,
        "updated_at": now,
    }
    result = await faces_collection().insert_one(doc)
    doc["_id"] = result.inserted_id
    return _face_doc_to_response(doc)


@router.put("/{face_id}", response_model=FaceResponse)
async def update_face(
    face_id: str,
    update: FaceUpdate,
    admin: dict = Depends(require_admin),
):
    """Update face profile (assign name to unknown face)."""
    result = await faces_collection().find_one_and_update(
        {"_id": ObjectId(face_id)},
        {
            "$set": {
                "name": update.name,
                "is_known": True,
                "updated_at": datetime.now(timezone.utc),
            }
        },
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Face not found")
    return _face_doc_to_response(result)


@router.post("/{face_id}/reference")
async def upload_reference_image(
    face_id: str,
    file: UploadFile = File(...),
    admin: dict = Depends(require_admin),
):
    """Upload a reference image for a face profile."""
    face = await faces_collection().find_one({"_id": ObjectId(face_id)})
    if not face:
        raise HTTPException(status_code=404, detail="Face not found")

    os.makedirs(FACES_UPLOAD_DIR, exist_ok=True)
    filename = f"{face_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{file.filename}"
    filepath = os.path.join(FACES_UPLOAD_DIR, filename)

    async with aiofiles.open(filepath, "wb") as f:
        content = await file.read()
        await f.write(content)

    await faces_collection().update_one(
        {"_id": ObjectId(face_id)},
        {
            "$push": {"reference_images": filepath},
            "$set": {"updated_at": datetime.now(timezone.utc)},
        },
    )

    return {"message": "Reference image uploaded", "path": filepath}


@router.delete("/{face_id}")
async def delete_face(face_id: str, admin: dict = Depends(require_admin)):
    """Delete a face profile."""
    result = await faces_collection().delete_one({"_id": ObjectId(face_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Face not found")
    return {"message": "Face profile deleted"}
