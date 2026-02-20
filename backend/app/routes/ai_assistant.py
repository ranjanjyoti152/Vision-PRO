"""
AI Assistant routes – Chat with semantic search.
"""
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from app.core.security import get_current_user
from app.services.llm_service import llm_service

router = APIRouter(prefix="/api/assistant", tags=["AI Assistant"])


@router.post("/chat")
async def chat(
    message: dict,
    user: dict = Depends(get_current_user),
):
    """Send a message to the AI assistant."""
    user_msg = message.get("message", "")
    if not user_msg:
        return {"response": "Please provide a message."}
        
    messages = [{"role": "user", "content": user_msg}]
    
    # We could fetch recent events here via `events_collection` and prepend them 
    # as system context, but for Phase 5 MVP we'll just connect the LLM.
    
    response_text = await llm_service.chat(messages)
    
    return {
        "response": response_text,
        "query": user_msg,
        "events": [],
        "status": "success",
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
