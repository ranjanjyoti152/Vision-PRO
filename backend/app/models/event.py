"""
Event Pydantic models.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


class EventType(str, Enum):
    PERSON = "person"
    VEHICLE = "vehicle"
    ANIMAL = "animal"
    FACE_KNOWN = "face_known"
    FACE_UNKNOWN = "face_unknown"
    MOTION = "motion"
    PACKAGE = "package"
    CUSTOM = "custom"


class BoundingBox(BaseModel):
    x: int
    y: int
    w: int
    h: int


class DetectedObject(BaseModel):
    class_name: str = Field(..., alias="class")
    confidence: float
    bbox: BoundingBox


class EventCreate(BaseModel):
    """Internal schema for creating events (used by detection pipeline)."""
    camera_id: str
    event_type: EventType
    confidence: float = Field(ge=0.0, le=1.0)
    snapshot_path: str = ""
    video_clip_path: str = ""
    bounding_box: Optional[BoundingBox] = None
    detected_objects: list[DetectedObject] = []
    face_id: Optional[str] = None
    metadata: dict = {}


class EventResponse(BaseModel):
    """Schema for event API responses."""
    id: str
    camera_id: str
    camera_name: Optional[str] = None
    event_type: EventType
    confidence: float
    timestamp: datetime
    snapshot_path: str
    video_clip_path: str
    bounding_box: Optional[BoundingBox] = None
    ai_summary: str = ""
    detected_objects: list[dict] = []
    face_id: Optional[str] = None
    face_name: Optional[str] = None
    metadata: dict = {}
    created_at: datetime


class EventFilter(BaseModel):
    """Query filters for events."""
    camera_id: Optional[str] = None
    event_type: Optional[EventType] = None
    face_id: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    min_confidence: float = 0.0
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
