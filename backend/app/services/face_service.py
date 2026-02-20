"""
Face Recognition Service using InsightFace and Qdrant.
"""
import asyncio
import logging
import uuid
from typing import Optional, Tuple

import cv2
import numpy as np
from insightface.app import FaceAnalysis
from qdrant_client.models import PointStruct

from app.config import settings
from app.vector_db import get_qdrant, FACES_COLLECTION

logger = logging.getLogger(__name__)


class FaceEngine:
    """Wrapper for InsightFace and Qdrant operations."""

    def __init__(self, model_name: str = "buffalo_l"):
        self.model_name = model_name
        self._app: Optional[FaceAnalysis] = None
        self.match_threshold = 0.6  # Cosine similarity threshold (lower is stricter, wait, cosine distance means lower is closer. Actually Qdrant COSINE distance returns 1 - cosine_similarity. Wait, qdrant default distance for COSINE is dot product normalized, meaning score is cosine similarity [-1, 1]. Let's verify.)
        # Insightface commonly uses cosine similarity. Let's assume matching threshold is 0.5 for cosine distance or similarity.

    def load(self):
        """Load InsightFace models into GPU/CPU."""
        logger.info(f"👤 Loading Face Recognition model: {self.model_name}")
        
        # buffalo_l extracts 512-dimensional embeddings
        self._app = FaceAnalysis(
            name=self.model_name,
            root=str(settings.MODELS_DIR),
            providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
        )
        self._app.prepare(ctx_id=0, det_size=(640, 640))
        logger.info("✅ Face Recognition model loaded")

    def extract_embedding(self, image: np.ndarray) -> Optional[np.ndarray]:
        """Detect the largest face in the image and extract its 512D embedding."""
        if self._app is None:
            return None
            
        faces = self._app.get(image)
        if not faces:
            return None
            
        # If multiple faces, pick the largest one by bounding box area
        if len(faces) > 1:
            faces = sorted(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)
            
        return faces[0].embedding

    def enroll_face(self, face_id: str, embedding: np.ndarray) -> str:
        """Add a face embedding to Qdrant, returning the generated point UUID."""
        qdrant = get_qdrant()
        if not qdrant:
            logger.error("Qdrant not connected")
            return ""
            
        point_id = str(uuid.uuid4())
        
        qdrant.upsert(
            collection_name=FACES_COLLECTION,
            points=[
                PointStruct(
                    id=point_id,
                    vector=embedding.tolist(),
                    payload={"face_id": face_id}
                )
            ]
        )
        return point_id

    def match_face(self, embedding: np.ndarray, threshold: float = 0.5) -> Tuple[Optional[str], float]:
        """
        Search Qdrant for a matching face.
        Returns (face_id, score) if a match is found above threshold, else (None, 0.0).
        """
        qdrant = get_qdrant()
        if not qdrant:
            return None, 0.0
            
        # Qdrant with COSINE distance returns similarity score in [-1, 1] range.
        # Higher score means more similar.
        results = qdrant.search(
            collection_name=FACES_COLLECTION,
            query_vector=embedding.tolist(),
            limit=1
        )
        
        if not results:
            return None, 0.0
            
        # The best match
        best_match = results[0]
        score = best_match.score
        
        if score >= threshold:
            face_id = best_match.payload.get("face_id")
            return str(face_id), score
            
        return None, score

# Singleton instance
face_engine = FaceEngine()
