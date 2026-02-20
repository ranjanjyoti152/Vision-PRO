"""
Qdrant Vector Database connection manager.
"""
import logging
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams
from app.config import settings

logger = logging.getLogger(__name__)

_client: QdrantClient | None = None

# Vector collection names
EVENTS_COLLECTION = "event_embeddings"
FACES_COLLECTION = "face_embeddings"

# Default embedding dimensions
EVENT_EMBEDDING_DIM = 768  # CLIP / LLM embedding size
FACE_EMBEDDING_DIM = 512  # InsightFace ArcFace embedding size


async def connect_qdrant() -> None:
    """Initialize Qdrant connection and ensure collections exist."""
    global _client
    try:
        _client = QdrantClient(
            host=settings.QDRANT_HOST,
            port=settings.QDRANT_PORT,
            timeout=10,
        )
        # Verify connection
        _client.get_collections()
        logger.info(
            f"✅ Connected to Qdrant at {settings.QDRANT_HOST}:{settings.QDRANT_PORT}"
        )
        # Ensure collections exist
        await _ensure_collections()
    except Exception as e:
        logger.warning(f"⚠️ Qdrant connection failed (non-critical): {e}")
        _client = None


async def _ensure_collections() -> None:
    """Create vector collections if they don't exist."""
    if _client is None:
        return

    existing = [c.name for c in _client.get_collections().collections]

    if EVENTS_COLLECTION not in existing:
        _client.create_collection(
            collection_name=EVENTS_COLLECTION,
            vectors_config=VectorParams(
                size=EVENT_EMBEDDING_DIM,
                distance=Distance.COSINE,
            ),
        )
        logger.info(f"📦 Created Qdrant collection: {EVENTS_COLLECTION}")

    if FACES_COLLECTION not in existing:
        _client.create_collection(
            collection_name=FACES_COLLECTION,
            vectors_config=VectorParams(
                size=FACE_EMBEDDING_DIM,
                distance=Distance.COSINE,
            ),
        )
        logger.info(f"📦 Created Qdrant collection: {FACES_COLLECTION}")


def get_qdrant() -> QdrantClient | None:
    """Get the Qdrant client instance."""
    return _client


async def disconnect_qdrant() -> None:
    """Close Qdrant connection."""
    global _client
    if _client:
        _client.close()
        _client = None
        logger.info("🔌 Disconnected from Qdrant")
