"""
Vision Pro Dezine – NVR System
FastAPI Backend Application Configuration
"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # --- App ---
    APP_NAME: str = "Vision Pro Dezine"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # --- Backend Server ---
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000

    # --- MongoDB ---
    MONGO_HOST: str = "localhost"
    MONGO_PORT: int = 27917
    MONGO_USER: str = "visionpro"
    MONGO_PASS: str = "visionpro_secret"
    MONGO_DB: str = "visionpro"

    @property
    def MONGO_URI(self) -> str:
        return (
            f"mongodb://{self.MONGO_USER}:{self.MONGO_PASS}"
            f"@{self.MONGO_HOST}:{self.MONGO_PORT}/{self.MONGO_DB}"
            f"?authSource=admin"
        )

    # --- Qdrant ---
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6933
    QDRANT_GRPC_PORT: int = 6934

    # --- JWT Auth ---
    SECRET_KEY: str = "change-this-to-a-random-secret-key"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = 24

    # --- Storage Paths ---
    RECORDING_PATH: str = "./recordings"
    MODELS_PATH: str = "./models"
    SNAPSHOT_PATH: str = "./snapshots"
    STREAM_JPEG_QUALITY: int = 80
    STREAM_MAX_FPS: int = 30

    # --- AI Detection ---
    YOLO_INFERENCE_INTERVAL: float = 1.0
    EVENT_COOLDOWN_SECONDS: int = 15

    # --- DeepStream (GPU-native pipeline) ---
    DEEPSTREAM_ENABLED: bool = False          # Set True when DeepStream container is running
    DEEPSTREAM_HOST: str = "deepstream"       # Docker service name / hostname
    DEEPSTREAM_ZMQ_PORT: int = 5570          # ZMQ PUSH port from DeepStream container
    TRT_ENGINE_PATH: str = "./models/yolo/yolov8n.engine"
    DS_CONF_THRESHOLD: float = 0.45

    @property
    def RECORDING_DIR(self) -> Path:
        path = Path(self.RECORDING_PATH)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def MODELS_DIR(self) -> Path:
        path = Path(self.MODELS_PATH)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def YOLO_MODELS_DIR(self) -> Path:
        path = self.MODELS_DIR / "yolo"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def SNAPSHOT_DIR(self) -> Path:
        path = Path(self.SNAPSHOT_PATH)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def FACE_MODELS_DIR(self) -> Path:
        path = self.MODELS_DIR / "faces"
        path.mkdir(parents=True, exist_ok=True)
        return path

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


# Singleton settings instance
settings = Settings()
