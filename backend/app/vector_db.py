"""
Qdrant Vector Database connection manager + event embedding helpers.
"""
import logging
from typing import List, Optional, Dict, Any
import httpx
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue, Range
from app.config import settings

logger = logging.getLogger(__name__)

_client: QdrantClient | None = None

# Vector collection names
EVENTS_COLLECTION = "event_embeddings"
FACES_COLLECTION = "face_embeddings"

# Default embedding dimensions
EVENT_EMBEDDING_DIM = 768  # nomic-embed-text dimension
FACE_EMBEDDING_DIM = 512  # InsightFace ArcFace embedding size

# Embedding model
EMBEDDING_MODEL = "nomic-embed-text"


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


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------

async def _get_ollama_base_url() -> str:
    """Get Ollama base URL from DB settings (cached for the call)."""
    from app.database import settings_collection
    doc = await settings_collection().find_one({"key": "ollama_base_url"})
    if doc and doc.get("value"):
        return str(doc["value"]).rstrip("/")
    return "http://localhost:11434"


async def get_embedding(text: str) -> Optional[List[float]]:
    """Get a 768-dim embedding vector from Ollama nomic-embed-text."""
    try:
        base_url = await _get_ollama_base_url()
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            resp = await client.post(
                f"{base_url}/api/embed",
                json={"model": EMBEDDING_MODEL, "input": text},
            )
            resp.raise_for_status()
            data = resp.json()
            embeddings = data.get("embeddings", [])
            if embeddings and len(embeddings) > 0:
                return embeddings[0]
            return None
    except Exception as e:
        logger.warning(f"⚠️ Failed to get embedding: {e}")
        return None


def build_event_text(event_doc: dict, camera_name: str = "") -> str:
    """Build a rich text description of an event for embedding."""
    parts = []

    event_type = event_doc.get("event_type", "unknown")
    parts.append(f"{event_type} event")

    if camera_name:
        parts.append(f"on camera {camera_name}")

    ts = event_doc.get("timestamp")
    if ts:
        parts.append(f"at {ts.strftime('%Y-%m-%d %H:%M:%S')}")

    confidence = event_doc.get("confidence", 0)
    parts.append(f"confidence {confidence:.0%}")

    # Detected objects
    detected = event_doc.get("detected_objects", [])
    if detected:
        obj_names = [obj.get("class", obj.get("className", "unknown")) for obj in detected]
        parts.append(f"detected objects: {', '.join(obj_names)}")

    # AI summary (the rich part)
    summary = event_doc.get("ai_summary", "")
    if summary and summary != "Event detected.":
        parts.append(f"summary: {summary}")

    # Face info
    face_id = event_doc.get("face_id")
    if face_id:
        parts.append("face detected")

    return ". ".join(parts)


async def upsert_event_embedding(event_id: str, text: str, metadata: dict) -> bool:
    """Embed event text and upsert into Qdrant."""
    if _client is None:
        logger.debug("Qdrant not connected — skipping event embedding")
        return False

    vector = await get_embedding(text)
    if vector is None:
        return False

    try:
        # Qdrant needs UUID or int — derive a UUID from the MongoDB ObjectId hex
        import uuid
        point_uuid = str(uuid.uuid5(uuid.NAMESPACE_OID, event_id))

        _client.upsert(
            collection_name=EVENTS_COLLECTION,
            points=[
                PointStruct(
                    id=point_uuid,
                    vector=vector,
                    payload={**metadata, "mongo_id": event_id},
                )
            ],
        )
        logger.debug(f"📌 Embedded event {event_id} into Qdrant")
        return True
    except Exception as e:
        logger.warning(f"⚠️ Failed to upsert event embedding: {e}")
        return False


async def search_similar_events(
    query_text: str,
    limit: int = 10,
    event_type: Optional[str] = None,
    camera_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Semantic search for events similar to query_text."""
    if _client is None:
        return []

    query_vector = await get_embedding(query_text)
    if query_vector is None:
        return []

    # Build optional filters
    conditions = []
    if event_type:
        conditions.append(FieldCondition(key="event_type", match=MatchValue(value=event_type)))
    if camera_id:
        conditions.append(FieldCondition(key="camera_id", match=MatchValue(value=camera_id)))

    query_filter = Filter(must=conditions) if conditions else None

    try:
        results = _client.search(
            collection_name=EVENTS_COLLECTION,
            query_vector=query_vector,
            limit=limit,
            query_filter=query_filter,
            with_payload=True,
        )
        return [
            {
                "score": hit.score,
                "event_id": hit.id,
                **hit.payload,
            }
            for hit in results
        ]
    except Exception as e:
        logger.warning(f"⚠️ Qdrant search failed: {e}")
        return []
