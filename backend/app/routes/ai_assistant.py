"""
AI Assistant routes – Chat with semantic search.
"""
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from app.core.security import get_current_user

router = APIRouter(prefix="/api/assistant", tags=["AI Assistant"])


@router.post("/chat")
async def chat(
    message: dict,
    user: dict = Depends(get_current_user),
):
    """Send a message to the AI assistant."""
    # TODO: Implement in Phase 5 – LLM + Qdrant semantic search
    return {
        "response": "AI Assistant is being configured. This feature will be available once an LLM provider is set up in Settings.",
        "query": message.get("message", ""),
        "events": [],
        "status": "pending_configuration",
    }


@router.get("/history")
async def get_chat_history(
    page: int = 1,
    page_size: int = 20,
    user: dict = Depends(get_current_user),
):
    """Get AI assistant chat history."""
    # TODO: Implement with chat_history collection
    return {"messages": [], "total": 0}
