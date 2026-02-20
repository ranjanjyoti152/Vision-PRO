"""
Face Pydantic models.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class FaceCreate(BaseModel):
    """Schema for creating a face profile."""
    name: Optional[str] = Field(default=None, max_length=100)


class FaceUpdate(BaseModel):
    """Schema for updating a face profile (e.g., assigning name to unknown)."""
    name: str = Field(..., min_length=1, max_length=100)


class FaceResponse(BaseModel):
    """Schema for face API responses."""
    id: str
    name: Optional[str] = None
    is_known: bool
    reference_images: list[str] = []
    embedding_ids: list[str] = []
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    total_appearances: int = 0
    created_at: datetime
    updated_at: datetime
