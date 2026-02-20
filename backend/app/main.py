"""
Vision Pro Dezine – FastAPI Application Entry Point
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os

from app.config import settings
from app.database import connect_db, disconnect_db
from app.vector_db import connect_qdrant, disconnect_qdrant

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info(f"🚀 Starting {settings.APP_NAME} v{settings.APP_VERSION}")

    # Connect databases
    await connect_db()
    await connect_qdrant()

    # Ensure storage directories exist
    os.makedirs(settings.RECORDING_PATH, exist_ok=True)
    os.makedirs(settings.MODELS_PATH, exist_ok=True)
    os.makedirs(settings.SNAPSHOT_PATH, exist_ok=True)

    # Start camera streams
    from app.services.stream_manager import stream_manager
    count = await stream_manager.start_all()

    logger.info(f"✅ All services initialized ({count} camera streams)")
    yield

    # Shutdown
    logger.info("🛑 Shutting down...")
    await stream_manager.stop_all()
    await disconnect_db()
    await disconnect_qdrant()
    logger.info("👋 Goodbye!")


# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    description="GPU-accelerated AI-powered Network Video Recorder",
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Register API Routes ---
from app.routes.auth import router as auth_router
from app.routes.cameras import router as cameras_router
from app.routes.events import router as events_router
from app.routes.faces import router as faces_router
from app.routes.playback import router as playback_router
from app.routes.settings import router as settings_router
from app.routes.system import router as system_router
from app.routes.ai_models import router as ai_models_router
from app.routes.ai_assistant import router as ai_assistant_router
from app.routes.analytics import router as analytics_router
from app.routes.heatmaps import router as heatmaps_router

app.include_router(auth_router)
app.include_router(cameras_router)
app.include_router(events_router)
app.include_router(faces_router)
app.include_router(playback_router)
app.include_router(settings_router)
app.include_router(system_router)
app.include_router(ai_models_router)
app.include_router(ai_assistant_router)
app.include_router(analytics_router)
app.include_router(heatmaps_router)

# Static files for snapshots/recordings
if os.path.exists(settings.RECORDING_PATH):
    app.mount(
        "/recordings",
        StaticFiles(directory=settings.RECORDING_PATH),
        name="recordings",
    )


# Health check
@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }


@app.get("/")
async def root():
    return {
        "message": f"Welcome to {settings.APP_NAME}",
        "version": settings.APP_VERSION,
        "docs": "/docs",
    }
