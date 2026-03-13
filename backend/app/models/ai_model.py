"""
AI Model Pydantic models.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from enum import Enum


class ModelType(str, Enum):
    YOLO = "yolo"
    FACE = "face"
    MERGED = "merged"


class AIModelResponse(BaseModel):
    """Schema for AI model API responses."""
    id: str
    name: str
    type: ModelType
    version: str
    file_path: str
    file_size_bytes: int = 0
    is_default: bool = False
    is_custom: bool = False
    metadata: dict = {}
    created_at: datetime


class ModelDownloadRequest(BaseModel):
    """Schema for requesting a YOLO model download."""
    model_config = {"protected_namespaces": ()}

    model_name: str = Field(
        ...,
        description="YOLO model name, e.g. yolov8n, yolov10s, yolo11m"
    )


class MergeModelsRequest(BaseModel):
    """Schema for requesting a merge of multiple YOLO models."""
    name: str = Field(..., min_length=1, max_length=100)
    model_ids: list[str] = Field(..., min_length=2, description="List of model IDs to merge")
    selected_classes: dict[str, list[str]] = Field(
        default_factory=dict, 
        description="Map of model ID to list of active class names. If empty, all classes are active."
    )


class ModelUploadMeta(BaseModel):
    """Metadata for custom model upload."""
    name: str = Field(..., min_length=1, max_length=100)
    type: ModelType = ModelType.YOLO
    version: str = "custom"
    metadata: dict = {}


# Available YOLO models for download
AVAILABLE_YOLO_MODELS = {
    "YOLOv5": ["yolov5n", "yolov5s", "yolov5m", "yolov5l", "yolov5x"],
    "YOLOv8": ["yolov8n", "yolov8s", "yolov8m", "yolov8l", "yolov8x"],
    "YOLOv9": ["yolov9t", "yolov9s", "yolov9m", "yolov9c", "yolov9e"],
    "YOLOv10": ["yolov10n", "yolov10s", "yolov10m", "yolov10b", "yolov10l", "yolov10x"],
    "YOLOv11": ["yolo11n", "yolo11s", "yolo11m", "yolo11l", "yolo11x"],
}
