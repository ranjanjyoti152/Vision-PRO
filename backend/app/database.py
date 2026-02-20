"""
MongoDB connection manager using Motor (async driver).
"""
import logging
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from app.config import settings

logger = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None
_database: AsyncIOMotorDatabase | None = None


async def connect_db() -> None:
    """Initialize MongoDB connection."""
    global _client, _database
    try:
        _client = AsyncIOMotorClient(
            settings.MONGO_URI,
            maxPoolSize=50,
            minPoolSize=5,
            serverSelectionTimeoutMS=5000,
        )
        _database = _client[settings.MONGO_DB]
        # Verify connection
        await _client.admin.command("ping")
        logger.info(
            f"✅ Connected to MongoDB at {settings.MONGO_HOST}:{settings.MONGO_PORT}"
        )
    except Exception as e:
        logger.error(f"❌ Failed to connect to MongoDB: {e}")
        raise


async def disconnect_db() -> None:
    """Close MongoDB connection."""
    global _client, _database
    if _client:
        _client.close()
        _client = None
        _database = None
        logger.info("🔌 Disconnected from MongoDB")


def get_database() -> AsyncIOMotorDatabase:
    """Get the database instance."""
    if _database is None:
        raise RuntimeError("Database not initialized. Call connect_db() first.")
    return _database


# Collection shortcuts
def get_collection(name: str):
    """Get a MongoDB collection by name."""
    return get_database()[name]


# Named collection accessors
def cameras_collection():
    return get_collection("cameras")


def events_collection():
    return get_collection("events")


def faces_collection():
    return get_collection("faces")


def recordings_collection():
    return get_collection("recordings")


def settings_collection():
    return get_collection("settings")


def ai_models_collection():
    return get_collection("ai_models")


def users_collection():
    return get_collection("users")


def chat_history_collection():
    return get_collection("chat_history")


def heatmap_data_collection():
    return get_collection("heatmap_data")
