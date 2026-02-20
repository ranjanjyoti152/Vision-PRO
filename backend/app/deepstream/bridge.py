"""
ZMQ Bridge — DeepStream side (PUSH publisher).

Runs inside the DeepStream container. Receives decoded frames + NvDs detection
metadata from GStreamer pad probes and publishes them as msgpack messages over a
ZMQ PUSH socket to the FastAPI backend.

Message schema (msgpack):
{
    "type":        "detection" | "frame",
    "camera_id":   str,
    "timestamp":   float,          # Unix timestamp
    "jpeg":        bytes | None,   # JPEG-encoded frame (present in "frame" msgs)
    "detections": [                # present in "detection" msgs
        {
            "class_id":    int,
            "class_name":  str,
            "confidence":  float,
            "bbox":        [left, top, width, height],  # pixels, absolute
            "track_id":    int | None,
        }
    ]
}
"""
import logging
import time
from typing import Optional

import zmq
import msgpack

logger = logging.getLogger(__name__)

# COCO class names (YOLO defaults)
COCO_CLASSES = [
    "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
    "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
    "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
    "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball",
    "kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket",
    "bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple",
    "sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair",
    "couch","potted plant","bed","dining table","toilet","tv","laptop","mouse",
    "remote","keyboard","cell phone","microwave","oven","toaster","sink",
    "refrigerator","book","clock","vase","scissors","teddy bear","hair drier",
    "toothbrush",
]

# Map confident COCO class names → our EventType names
EVENT_CLASS_MAP = {
    "person":     "person",
    "car":        "vehicle",
    "truck":      "vehicle",
    "bus":        "vehicle",
    "motorcycle": "vehicle",
    "bicycle":    "vehicle",
    "cat":        "animal",
    "dog":        "animal",
    "horse":      "animal",
    "cow":        "animal",
}


class DeepStreamBridge:
    """ZMQ PUSH publisher — sends frames and detections to FastAPI."""

    def __init__(self, zmq_endpoint: str = "tcp://*:5570"):
        self._ctx = zmq.Context()
        self._sock = self._ctx.socket(zmq.PUSH)
        self._sock.setsockopt(zmq.SNDHWM, 60)       # drop oldest if slow consumer
        self._sock.setsockopt(zmq.LINGER, 0)
        self._sock.bind(zmq_endpoint)
        logger.info(f"🔗 DeepStream ZMQ bridge bound to {zmq_endpoint}")

    def publish_frame(self, camera_id: str, jpeg: bytes) -> None:
        """Send a JPEG frame to FastAPI for WebSocket broadcast."""
        msg = {
            "type":      "frame",
            "camera_id": camera_id,
            "timestamp": time.time(),
            "jpeg":      jpeg,
        }
        try:
            self._sock.send(msgpack.packb(msg, use_bin_type=True), zmq.NOBLOCK)
        except zmq.Again:
            pass  # Consumer is slow — drop frame rather than block pipeline

    def publish_detections(
        self,
        camera_id: str,
        detections: list,
        jpeg: Optional[bytes] = None,
    ) -> None:
        """Send detection metadata (+ optional snapshot jpeg) to FastAPI."""
        msg = {
            "type":       "detection",
            "camera_id":  camera_id,
            "timestamp":  time.time(),
            "detections": detections,
            "jpeg":       jpeg,
        }
        try:
            self._sock.send(msgpack.packb(msg, use_bin_type=True), zmq.NOBLOCK)
        except zmq.Again:
            pass

    def close(self) -> None:
        self._sock.close()
        self._ctx.term()
