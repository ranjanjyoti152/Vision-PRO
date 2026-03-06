"""
DeepStream GStreamer Pipeline — runs INSIDE the DeepStream Docker container.

Creates one pipeline per camera:
  rtspsrc → rtph264depay → h264parse → nvv4l2decoder (GPU)
           → nvvideoconvert → capsfilter
           → tee ─┬─ nvinfer (TensorRT YOLO) → nvtracker → probe → ZMQ detections
                  └─ nvvideoconvert → jpegenc → appsink  → ZMQ frames

Detection metadata is extracted via GStreamer pad probes using pyds.
JPEG frames are captured via appsink for WebSocket broadcast.
"""
import os
import sys
import logging
import threading
import time
import io
import ctypes
from typing import Dict, Optional

import gi
gi.require_version("Gst", "1.0")
gi.require_version("GstApp", "1.0")
from gi.repository import Gst, GstApp, GLib

import pyds
import numpy as np
from PIL import Image
import msgpack

from app.deepstream.bridge import DeepStreamBridge, COCO_CLASSES, EVENT_CLASS_MAP
from app.deepstream.trt_convert import convert_if_needed
from urllib.parse import urlparse, quote, urlunparse

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s")
logger = logging.getLogger("deepstream.pipeline")

# Config
ZMQ_ENDPOINT   = os.environ.get("DS_ZMQ_ENDPOINT",  "tcp://*:5570")
MONGO_URI      = os.environ.get("MONGO_URI", "mongodb://visionpro:visionpro_secret@mongodb:27917/visionpro?authSource=admin")
ENGINE_PATH    = os.environ.get("TRT_ENGINE_PATH",  "/models/yolo/yolov8n.engine")
CONF_THRESHOLD = float(os.environ.get("CONF_THRESHOLD", "0.45"))
JPEG_QUALITY   = int(os.environ.get("JPEG_QUALITY", "80"))
TARGET_FPS     = int(os.environ.get("TARGET_FPS", "30"))

# Globals
bridge: Optional[DeepStreamBridge] = None
MODEL_CLASSES: list = []  # populated at startup from .pt model
NUM_CLASSES: int = 80
_latest_jpeg: Dict[str, bytes] = {}  # camera_id → most recent JPEG for snapshots


def detect_model_classes() -> list:
    """Auto-detect class names from the .pt model file."""
    pt_path = os.environ.get("YOLO_PT_PATH", "/models/yolo/yolov8n.pt")
    try:
        from ultralytics import YOLO
        model = YOLO(pt_path)
        names = model.names  # {0: 'class1', 1: 'class2', ...}
        class_list = [names[i] for i in sorted(names.keys())]
        logger.info(f"🏷️  Detected {len(class_list)} classes from {pt_path}: {class_list}")
        return class_list
    except Exception as e:
        logger.warning(f"Could not detect classes from {pt_path}: {e}")
        return list(COCO_CLASSES)


# ─── nvinfer config ────────────────────────────────────────────────────────

NVINFER_CONFIG_TMPL = """
[property]
gpu-id=0
net-scale-factor=0.0039215697906911373
model-engine-file={engine_path}
{onnx_file_line}labelfile-path=/tmp/labels.txt
batch-size=1
network-type=100
num-detected-classes={num_classes}
interval=0
gie-unique-id=1
output-tensor-meta=1

[class-attrs-all]
pre-cluster-threshold={threshold}
roi-top-offset=0
roi-bottom-offset=0
detected-min-w=0
detected-min-h=0
"""


def write_nvinfer_config(engine_path: str, threshold: float, num_classes: int) -> str:
    """Write nvinfer config file. On Jetson, includes onnx-file for auto-rebuild."""
    config_path = "/tmp/nvinfer_yolo.txt"

    # Check if an ONNX model exists alongside the engine
    onnx_path = os.environ.get("ONNX_MODEL_PATH", "")
    if not onnx_path:
        candidate = engine_path.replace(".engine", ".onnx").replace("/yolo/", "/onnx/")
        if os.path.exists(candidate):
            onnx_path = candidate

    onnx_file_line = ""
    if onnx_path and os.path.exists(onnx_path):
        onnx_file_line = f"onnx-file={onnx_path}\n"

    with open(config_path, "w") as f:
        f.write(NVINFER_CONFIG_TMPL.format(
            engine_path=engine_path,
            threshold=threshold,
            onnx_file_line=onnx_file_line,
            num_classes=num_classes,
        ))
    with open("/tmp/labels.txt", "w") as f:
        f.write("\n".join(MODEL_CLASSES))
    return config_path


# ─── YOLO tensor parsing ─────────────────────────────────────────────────────

def _nms_boxes(boxes, scores, iou_threshold=0.45):
    """Simple NMS. boxes: Nx4 [x1,y1,x2,y2], scores: N."""
    if len(boxes) == 0:
        return []
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)
        if order.size == 1:
            break
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        inds = np.where(iou <= iou_threshold)[0]
        order = order[inds + 1]
    return keep


def parse_yolo_tensor(tensor_data: np.ndarray, conf_threshold: float, img_w: int, img_h: int):
    """
    Parse raw YOLO output tensor [1, (4+num_classes), num_anchors] → list of detections.

    Ultralytics YOLOv8/v11 output format:
        Each anchor: [cx, cy, w, h, class0_conf, class1_conf, ...]
        Coordinates are in model input space (640x640 typically).
    """
    # Squeeze batch dim: (4+C, 8400)
    if tensor_data.ndim == 3:
        tensor_data = tensor_data[0]
    n_vals, n_anchors = tensor_data.shape  # e.g. (19, 8400)
    n_classes = n_vals - 4

    # Transpose to (8400, 19) for easier processing
    preds = tensor_data.T  # (8400, 19)

    # Extract bbox (cx, cy, w, h) and class confidences
    cx, cy, w, h = preds[:, 0], preds[:, 1], preds[:, 2], preds[:, 3]
    class_confs = preds[:, 4:]  # (8400, num_classes)

    # Get best class per anchor
    class_ids = np.argmax(class_confs, axis=1)
    max_confs = class_confs[np.arange(n_anchors), class_ids]

    # Filter by confidence
    mask = max_confs > conf_threshold
    if not mask.any():
        return []

    cx, cy, w, h = cx[mask], cy[mask], w[mask], h[mask]
    class_ids = class_ids[mask]
    max_confs = max_confs[mask]

    # Convert to x1, y1, x2, y2 and scale to image dimensions
    scale_x = img_w / 640.0
    scale_y = img_h / 640.0
    x1 = (cx - w / 2) * scale_x
    y1 = (cy - h / 2) * scale_y
    x2 = (cx + w / 2) * scale_x
    y2 = (cy + h / 2) * scale_y

    boxes = np.stack([x1, y1, x2, y2], axis=1)

    # NMS per class
    final_dets = []
    for cls_id in np.unique(class_ids):
        cls_mask = class_ids == cls_id
        cls_boxes = boxes[cls_mask]
        cls_scores = max_confs[cls_mask]
        keep = _nms_boxes(cls_boxes, cls_scores, iou_threshold=0.45)
        for k in keep:
            bx = cls_boxes[k]
            final_dets.append({
                "class_id": int(cls_id),
                "class_name": MODEL_CLASSES[int(cls_id)] if int(cls_id) < len(MODEL_CLASSES) else f"class_{cls_id}",
                "event_type": EVENT_CLASS_MAP.get(
                    MODEL_CLASSES[int(cls_id)] if int(cls_id) < len(MODEL_CLASSES) else "", "custom"
                ),
                "confidence": round(float(cls_scores[k]), 4),
                "bbox": [
                    round(float(max(0, bx[0])), 1),
                    round(float(max(0, bx[1])), 1),
                    round(float(bx[2] - bx[0]), 1),
                    round(float(bx[3] - bx[1]), 1),
                ],
                "track_id": None,
            })
    return final_dets


# ─── Pad probe — extract raw output tensors ──────────────────────────────────

def osd_sink_pad_buffer_probe(pad, info, camera_id):
    """Extract raw YOLO tensor from nvinfer output-tensor-meta and parse detections."""
    gst_buffer = info.get_buffer()
    if not gst_buffer:
        return Gst.PadProbeReturn.OK

    batch_meta = pyds.gst_buffer_get_nvds_batch_meta(hash(gst_buffer))
    if not batch_meta:
        return Gst.PadProbeReturn.OK

    l_frame = batch_meta.frame_meta_list
    while l_frame:
        try:
            frame_meta = pyds.NvDsFrameMeta.cast(l_frame.data)
        except StopIteration:
            break

        # Get image dimensions from streammux
        img_w = frame_meta.source_frame_width or 1920
        img_h = frame_meta.source_frame_height or 1080

        detections = []

        # Try to read raw tensor output from nvinfer (output-tensor-meta=1)
        l_user = frame_meta.frame_user_meta_list
        while l_user:
            try:
                user_meta = pyds.NvDsUserMeta.cast(l_user.data)
                if user_meta.base_meta.meta_type == pyds.NvDsMetaType.NVDSINFER_TENSOR_OUTPUT_META:
                    tensor_meta = pyds.NvDsInferTensorMeta.cast(user_meta.user_meta_data)
                    # Get first output layer
                    layer = pyds.get_nvds_LayerInfo(tensor_meta, 0)
                    ptr = ctypes.cast(pyds.get_ptr(layer.buffer), ctypes.POINTER(ctypes.c_float))
                    # Build numpy array from layer dims
                    dims = [layer.dims.d[i] for i in range(layer.dims.numDims)]
                    total = 1
                    for d in dims:
                        total *= d
                    arr = np.ctypeslib.as_array(ptr, shape=(total,)).reshape(dims).copy()
                    detections = parse_yolo_tensor(arr, CONF_THRESHOLD, img_w, img_h)
            except Exception as e:
                logger.debug(f"Tensor parse error: {e}")

            try:
                l_user = l_user.next
            except StopIteration:
                break

        # Fallback: also check NvDsObjectMeta (works if parser is available)
        if not detections:
            l_obj = frame_meta.obj_meta_list
            while l_obj:
                try:
                    obj_meta = pyds.NvDsObjectMeta.cast(l_obj.data)
                    class_id = obj_meta.class_id
                    class_name = MODEL_CLASSES[class_id] if class_id < len(MODEL_CLASSES) else f"class_{class_id}"
                    conf = obj_meta.confidence
                    rect = obj_meta.rect_params
                    detections.append({
                        "class_id":   class_id,
                        "class_name": class_name,
                        "event_type": EVENT_CLASS_MAP.get(class_name, "custom"),
                        "confidence": round(float(conf), 4),
                        "bbox":       [
                            round(float(rect.left), 1),
                            round(float(rect.top), 1),
                            round(float(rect.width), 1),
                            round(float(rect.height), 1),
                        ],
                        "track_id":  obj_meta.object_id if obj_meta.object_id != 0xFFFFFFFFFFFFFFFF else None,
                    })
                except StopIteration:
                    break
                try:
                    l_obj = l_obj.next
                except StopIteration:
                    break

        if detections and bridge:
            jpeg = _latest_jpeg.get(camera_id)
            bridge.publish_detections(camera_id, detections, jpeg=jpeg,
                                     frame_width=img_w, frame_height=img_h)

        try:
            l_frame = l_frame.next
        except StopIteration:
            break

    return Gst.PadProbeReturn.OK


# ─── appsink callback — JPEG frames ─────────────────────────────────────────

def on_new_sample(appsink, camera_id: str):
    """Capture frame from appsink, encode to JPEG, send to FastAPI."""
    sample = appsink.emit("pull-sample")
    if not sample:
        return Gst.FlowReturn.ERROR

    buf = sample.get_buffer()
    caps = sample.get_caps()
    struct = caps.get_structure(0)
    width  = struct.get_value("width")
    height = struct.get_value("height")

    success, map_info = buf.map(Gst.MapFlags.READ)
    if not success:
        return Gst.FlowReturn.ERROR

    try:
        arr = np.frombuffer(map_info.data, dtype=np.uint8).reshape((height, width, 3))
        img = Image.fromarray(arr, "RGB")
        buf_io = io.BytesIO()
        img.save(buf_io, format="JPEG", quality=JPEG_QUALITY)
        jpeg = buf_io.getvalue()
        _latest_jpeg[camera_id] = jpeg  # cache for detection snapshots
        if bridge:
            bridge.publish_frame(camera_id, jpeg)
    except Exception as e:
        logger.warning(f"Frame encode error: {e}")
    finally:
        buf.unmap(map_info)

    return Gst.FlowReturn.OK


# ─── Build pipeline ──────────────────────────────────────────────────────────

def build_pipeline(camera_id: str, rtsp_url: str, nvinfer_config: str) -> Gst.Pipeline:
    """Build a GStreamer DeepStream pipeline for one camera."""
    pipeline = Gst.Pipeline()

    def make(factory, name):
        el = Gst.ElementFactory.make(factory, name)
        if not el:
            raise RuntimeError(f"Failed to create GStreamer element: {factory}")
        return el

    safe_id = camera_id.replace("-", "_")

    # Source
    src      = make("rtspsrc",        f"src_{safe_id}")
    depay    = make("rtph264depay",   f"depay_{safe_id}")
    parse    = make("h264parse",      f"parse_{safe_id}")
    decoder  = make("nvv4l2decoder",  f"nvdec_{safe_id}")
    conv1    = make("nvvideoconvert", f"conv1_{safe_id}")
    caps1    = make("capsfilter",     f"caps1_{safe_id}")
    caps1.set_property("caps", Gst.Caps.from_string("video/x-raw(memory:NVMM),format=NV12"))

    # nvstreammux — REQUIRED by nvinfer to generate NvDsBatchMeta
    streammux = make("nvstreammux",   f"mux_{safe_id}")
    streammux.set_property("batch-size", 1)
    streammux.set_property("width", 1920)
    streammux.set_property("height", 1080)
    streammux.set_property("batched-push-timeout", 40000)  # 40ms = 25fps max
    streammux.set_property("live-source", True)

    # Tee — split decoded stream to inference and JPEG encode
    tee      = make("tee",            f"tee_{safe_id}")

    # Branch 1 — inference (no tracker with network-type=100)
    queue1   = make("queue",          f"q_inf_{safe_id}")
    infer    = make("nvinfer",        f"nvinfer_{safe_id}")
    fakesink = make("fakesink",       f"fsink_{safe_id}")

    # Branch 2 — JPEG for WebSocket
    queue2   = make("queue",          f"q_jpeg_{safe_id}")
    conv2    = make("nvvideoconvert", f"conv_jpeg_{safe_id}")
    caps2    = make("capsfilter",     f"caps2_{safe_id}")
    caps2.set_property("caps", Gst.Caps.from_string("video/x-raw,format=RGB"))
    appsink  = make("appsink",        f"appsink_{safe_id}")

    # Set compute-hw=1 (GPU) on all nvvideoconvert elements
    # Default uses VIC which doesn't support RGB/BGR on Jetson
    for conv in [conv1, conv2]:
        conv.set_property("compute-hw", 1)

    # Config
    src.set_property("location", rtsp_url)
    src.set_property("protocols", 4)   # TCP=4
    src.set_property("latency", 200)
    src.set_property("drop-on-latency", True)
    src.set_property("buffer-mode", 0)

    infer.set_property("config-file-path", nvinfer_config)
    infer.set_property("unique-id", 1)

    fakesink.set_property("sync", False)
    fakesink.set_property("async", False)

    appsink.set_property("emit-signals", True)
    appsink.set_property("sync", False)
    appsink.set_property("max-buffers", 2)
    appsink.set_property("drop", True)
    appsink.connect("new-sample", on_new_sample, camera_id)

    # Add all to pipeline
    for el in [src, depay, parse, decoder, conv1, caps1, tee,
               queue1, streammux, infer, fakesink,
               queue2, conv2, caps2, appsink]:
        pipeline.add(el)

    # Handle dynamic rtspsrc → depay pad
    def on_pad_added(element, pad):
        sink = depay.get_static_pad("sink")
        if not sink.is_linked():
            pad.link(sink)

    src.connect("pad-added", on_pad_added)

    # Link main chain: src → depay → parse → decoder → conv1 → caps1 → tee
    depay.link(parse)
    parse.link(decoder)
    decoder.link(conv1)
    conv1.link(caps1)
    caps1.link(tee)

    # Tee → branch 1 (inference via streammux)
    tee_src1 = tee.get_request_pad("src_%u")
    queue1_sink = queue1.get_static_pad("sink")
    tee_src1.link(queue1_sink)

    # queue1 → streammux (pad request) → nvinfer → tracker → conv_inf → fakesink
    mux_sinkpad = streammux.request_pad_simple("sink_0")
    if not mux_sinkpad:
        mux_sinkpad = streammux.get_request_pad("sink_0")
    queue1_src = queue1.get_static_pad("src")
    queue1_src.link(mux_sinkpad)

    streammux.link(infer)
    infer.link(fakesink)

    # Tee → branch 2 (JPEG)
    tee_src2 = tee.get_request_pad("src_%u")
    queue2_sink = queue2.get_static_pad("sink")
    tee_src2.link(queue2_sink)
    queue2.link(conv2)
    conv2.link(caps2)
    caps2.link(appsink)

    # Add pad probe on nvinfer src pad for raw tensor detection metadata
    infer_src = infer.get_static_pad("src")
    infer_src.add_probe(Gst.PadProbeType.BUFFER, osd_sink_pad_buffer_probe, camera_id)

    return pipeline


# ─── Camera database loader ──────────────────────────────────────────────────

def sanitize_rtsp_url(url: str) -> str:
    """URL-encode special characters in RTSP userinfo (username:password).

    Handles passwords containing @, #, ?, etc. that would otherwise
    break the URL parsing.
    """
    parsed = urlparse(url)
    if parsed.username and parsed.password:
        # Re-encode the password (and username just in case)
        encoded_user = quote(parsed.username, safe="")
        encoded_pass = quote(parsed.password, safe="")
        # Rebuild netloc with encoded credentials
        host_port = parsed.hostname
        if parsed.port:
            host_port = f"{host_port}:{parsed.port}"
        new_netloc = f"{encoded_user}:{encoded_pass}@{host_port}"
        return urlunparse(parsed._replace(netloc=new_netloc))
    return url


def load_cameras_from_mongo() -> list:
    """Load enabled cameras from MongoDB at startup."""
    from pymongo import MongoClient
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = client["visionpro"]
    cameras = list(db["cameras"].find({"enabled": True}, {"_id": 1, "rtsp_url": 1, "name": 1}))
    client.close()
    return [{"id": str(c["_id"]), "rtsp_url": sanitize_rtsp_url(c["rtsp_url"]), "name": c["name"]} for c in cameras]



# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    global bridge

    Gst.init(None)

    # Convert model first
    logger.info("🔧 Checking TensorRT engine ...")
    convert_if_needed()

    # Detect model classes and write nvinfer config
    global MODEL_CLASSES, NUM_CLASSES
    MODEL_CLASSES = detect_model_classes()
    NUM_CLASSES = len(MODEL_CLASSES)
    nvinfer_config = write_nvinfer_config(ENGINE_PATH, CONF_THRESHOLD, NUM_CLASSES)

    # Connect ZMQ bridge
    bridge = DeepStreamBridge(ZMQ_ENDPOINT)

    # Load cameras
    logger.info("📋 Loading cameras from MongoDB ...")
    cameras = load_cameras_from_mongo()
    if not cameras:
        logger.warning("⚠  No enabled cameras found — waiting ...")
        # Keep process alive; cameras can be added later via restart
        time.sleep(60)
        return

    logger.info(f"📷 Starting pipelines for {len(cameras)} camera(s) ...")

    pipelines = []
    loop = GLib.MainLoop()

    for cam in cameras:
        logger.info(f"  → {cam['name']} ({cam['id']}): {cam['rtsp_url']}")
        try:
            p = build_pipeline(cam["id"], cam["rtsp_url"], nvinfer_config)
            ret = p.set_state(Gst.State.PLAYING)
            if ret == Gst.StateChangeReturn.FAILURE:
                logger.error(f"❌ Pipeline failed to start for camera {cam['id']}")
            else:
                logger.info(f"✅ Pipeline PLAYING: {cam['name']}")
                pipelines.append(p)
        except Exception as e:
            logger.error(f"❌ Failed to build pipeline for {cam['id']}: {e}")

    def on_message(bus, message, loop):
        t = message.type
        if t == Gst.MessageType.EOS:
            logger.info("EOS received")
            loop.quit()
        elif t == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            logger.error(f"Pipeline error: {err} — {debug}")

    for p in pipelines:
        bus = p.get_bus()
        bus.add_signal_watch()
        bus.connect("message", on_message, loop)

    logger.info("🎥 All pipelines running — Press Ctrl+C to stop")
    try:
        loop.run()
    except KeyboardInterrupt:
        pass
    finally:
        for p in pipelines:
            p.set_state(Gst.State.NULL)
        bridge.close()
        logger.info("🛑 DeepStream pipeline stopped")


if __name__ == "__main__":
    main()
