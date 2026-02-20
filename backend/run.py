"""
Vision Pro Dezine – Uvicorn Server Launcher
Usage: python run.py [--port PORT] [--host HOST]
"""
import argparse
import uvicorn
from app.config import settings

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Vision Pro Dezine NVR Server")
    parser.add_argument("--port", type=int, default=settings.BACKEND_PORT, help="Port to run on")
    parser.add_argument("--host", type=str, default=settings.BACKEND_HOST, help="Host to bind to")
    args = parser.parse_args()

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=True,
        log_level="info",
        ws_ping_interval=30,
        ws_ping_timeout=30,
    )
