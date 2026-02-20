"""
Recording Pydantic models.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class RecordingResponse(BaseModel):
    """Schema for recording API responses."""
    id: str
    camera_id: str
    camera_name: Optional[str] = None
    file_path: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    file_size_bytes: int
    trigger_event_id: Optional[str] = None
    created_at: datetime


class RecordingExportRequest(BaseModel):
    """Schema for exporting a recording segment."""
    camera_id: str
    start_time: datetime
    end_time: datetime
    format: str = Field(default="mp4", pattern="^(mp4|avi|mkv)$")


class CalendarDay(BaseModel):
    """Represents a day with recordings available."""
    date: str  # YYYY-MM-DD
    recording_count: int
    total_duration_seconds: float
