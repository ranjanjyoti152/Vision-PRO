"""
WebSocket connection manager for live streaming.
"""
import asyncio
import logging
from typing import Dict, Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections for live camera feeds and system updates."""

    def __init__(self):
        # channel -> set of connected websockets
        self._connections: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, channel: str) -> None:
        """Accept and register a WebSocket connection to a channel."""
        await websocket.accept()
        async with self._lock:
            if channel not in self._connections:
                self._connections[channel] = set()
            self._connections[channel].add(websocket)
        logger.debug(f"WebSocket connected to channel: {channel}")

    async def disconnect(self, websocket: WebSocket, channel: str) -> None:
        """Remove a WebSocket connection from a channel."""
        async with self._lock:
            if channel in self._connections:
                self._connections[channel].discard(websocket)
                if not self._connections[channel]:
                    del self._connections[channel]
        logger.debug(f"WebSocket disconnected from channel: {channel}")

    async def broadcast_to_channel(self, channel: str, data: dict) -> None:
        """Send JSON data to all connections on a channel."""
        async with self._lock:
            connections = self._connections.get(channel, set()).copy()

        dead = []
        for ws in connections:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)

        # Clean up dead connections
        if dead:
            async with self._lock:
                for ws in dead:
                    if channel in self._connections:
                        self._connections[channel].discard(ws)

    async def broadcast_bytes(self, channel: str, data: bytes) -> None:
        """Send binary data (e.g., JPEG frames) to all connections on a channel."""
        async with self._lock:
            connections = self._connections.get(channel, set()).copy()

        dead = []
        for ws in connections:
            try:
                await ws.send_bytes(data)
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    if channel in self._connections:
                        self._connections[channel].discard(ws)

    def get_channel_count(self, channel: str) -> int:
        """Get number of connections on a channel."""
        return len(self._connections.get(channel, set()))

    def get_all_channels(self) -> list[str]:
        """Get all active channels."""
        return list(self._connections.keys())


# Singleton instance
ws_manager = ConnectionManager()
