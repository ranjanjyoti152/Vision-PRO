"""
Heatmap routes.
"""
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from app.core.security import get_current_user

router = APIRouter(prefix="/api/heatmaps", tags=["Heatmaps"])


@router.get("/{camera_id}")
async def get_heatmap(
    camera_id: str,
    hours: int = Query(24, ge=1, le=168),
    user: dict = Depends(get_current_user),
):
    """Get activity heatmap data for a camera."""
    # TODO: Implement in Phase 6 with GPU-processed heatmap generation
    return {
        "camera_id": camera_id,
        "period_hours": hours,
        "heatmap_data": [],
        "status": "pending_implementation",
    }
