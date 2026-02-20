"""
Camera Pydantic models.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class DetectionConfig(BaseModel):
    """Per-camera detection configuration."""
    motion_detection: bool = True
    object_detection: bool = True
    face_detection: bool = False
    confidence_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    detection_classes: list[str] = Field(
        default=["person", "vehicle", "animal"]
    )


class RecordingConfig(BaseModel):
    """Per-camera recording buffer configuration."""
    pre_event_buffer_seconds: int = Field(default=5, ge=0, le=60)
    post_event_buffer_seconds: int = Field(default=10, ge=0, le=120)


class Resolution(BaseModel):
    width: int = 1920
    height: int = 1080


class CameraCreate(BaseModel):
    """Schema for creating a new camera."""
    name: str = Field(..., min_length=1, max_length=100)
    rtsp_url: str = Field(..., min_length=1)
    location: str = Field(default="", max_length=200)
    enabled: bool = True
    detection_config: DetectionConfig = DetectionConfig()
    recording_config: RecordingConfig = RecordingConfig()
    resolution: Resolution = Resolution()
    fps: int = Field(default=25, ge=1, le=60)


class CameraUpdate(BaseModel):
    """Schema for updating a camera."""
    name: Optional[str] = None
    rtsp_url: Optional[str] = None
    location: Optional[str] = None
    enabled: Optional[bool] = None
    detection_config: Optional[DetectionConfig] = None
    recording_config: Optional[RecordingConfig] = None
    resolution: Optional[Resolution] = None
    fps: Optional[int] = None


class CameraResponse(BaseModel):
    """Schema for camera API responses."""
    id: str
    name: str
    rtsp_url: str
    location: str
    enabled: bool
    detection_config: DetectionConfig
    recording_config: RecordingConfig
    resolution: Resolution
    fps: int
    status: str = "offline"
    created_at: datetime
    updated_at: datetime
