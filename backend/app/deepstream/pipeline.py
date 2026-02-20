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


# ─── nvinfer config ────────────────────────────────────────────────────────

NVINFER_CONFIG_TMPL = """
[property]
gpu-id=0
net-scale-factor=0.0039215697906911373
model-engine-file={engine_path}
labelfile-path=/tmp/labels.txt
batch-size=1
network-type=0
num-detected-classes=80
interval=0
gie-unique-id=1
output-bbox-layer-name=output0
force-implicit-batch-dim=1

[class-attrs-all]
threshold={threshold}
roi-top-offset=0
roi-bottom-offset=0
detected-min-w=0
detected-min-h=0
"""

LABELS_TXT = "\n".join(COCO_CLASSES)


def write_nvinfer_config(engine_path: str, threshold: float) -> str:
    config_path = "/tmp/nvinfer_yolo.txt"
    with open(config_path, "w") as f:
        f.write(NVINFER_CONFIG_TMPL.format(engine_path=engine_path, threshold=threshold))
    with open("/tmp/labels.txt", "w") as f:
        f.write(LABELS_TXT)
    return config_path


# ─── Pad probe — extract bounding boxes ─────────────────────────────────────

def osd_sink_pad_buffer_probe(pad, info, camera_id):
    """Extract NvDsObjectMeta detections and publish to FastAPI via ZMQ."""
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

        detections = []
        l_obj = frame_meta.obj_meta_list
        while l_obj:
            try:
                obj_meta = pyds.NvDsObjectMeta.cast(l_obj.data)
            except StopIteration:
                break

            class_id = obj_meta.class_id
            class_name = COCO_CLASSES[class_id] if class_id < len(COCO_CLASSES) else f"class_{class_id}"
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

            try:
                l_obj = l_obj.next
            except StopIteration:
                break

        if detections and bridge:
            bridge.publish_detections(camera_id, detections)

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

    # Tee — split decoded stream to inference and JPEG encode
    tee      = make("tee",            f"tee_{safe_id}")

    # Branch 1 — inference
    queue1   = make("queue",          f"q_inf_{safe_id}")
    infer    = make("nvinfer",        f"nvinfer_{safe_id}")
    tracker  = make("nvtracker",      f"tracker_{safe_id}")
    tiler    = make("nvvideoconvert", f"conv_inf_{safe_id}")
    fakesink = make("fakesink",       f"fsink_{safe_id}")

    # Branch 2 — JPEG for WebSocket
    queue2   = make("queue",          f"q_jpeg_{safe_id}")
    conv2    = make("nvvideoconvert", f"conv_jpeg_{safe_id}")
    caps2    = make("capsfilter",     f"caps2_{safe_id}")
    caps2.set_property("caps", Gst.Caps.from_string("video/x-raw,format=RGB"))
    appsink  = make("appsink",        f"appsink_{safe_id}")

    # Config
    src.set_property("location", rtsp_url)
    src.set_property("protocols", 4)   # TCP=4
    src.set_property("latency", 200)
    src.set_property("drop-on-latency", True)
    src.set_property("buffer-mode", 0)

    infer.set_property("config-file-path", nvinfer_config)
    infer.set_property("unique-id", 1)

    tracker.set_property("ll-lib-file", "/opt/nvidia/deepstream/deepstream/lib/libnvds_nvmultiobjecttracker.so")
    tracker.set_property("enable-batch-process", True)

    fakesink.set_property("sync", False)
    fakesink.set_property("async", False)

    appsink.set_property("emit-signals", True)
    appsink.set_property("sync", False)
    appsink.set_property("max-buffers", 2)
    appsink.set_property("drop", True)
    appsink.connect("new-sample", on_new_sample, camera_id)

    # Add all to pipeline
    for el in [src, depay, parse, decoder, conv1, caps1, tee,
               queue1, infer, tracker, tiler, fakesink,
               queue2, conv2, caps2, appsink]:
        pipeline.add(el)

    # Handle dynamic rtspsrc → depay pad
    def on_pad_added(element, pad):
        sink = depay.get_static_pad("sink")
        if not sink.is_linked():
            pad.link(sink)

    src.connect("pad-added", on_pad_added)

    # Link main chain
    depay.link(parse)
    parse.link(decoder)
    decoder.link(conv1)
    conv1.link(caps1)
    caps1.link(tee)

    # Tee → branch 1 (inference)
    tee_src1 = tee.get_request_pad("src_%u")
    queue1_sink = queue1.get_static_pad("sink")
    tee_src1.link(queue1_sink)
    queue1.link(infer)
    infer.link(tracker)
    tracker.link(tiler)
    tiler.link(fakesink)

    # Tee → branch 2 (JPEG)
    tee_src2 = tee.get_request_pad("src_%u")
    queue2_sink = queue2.get_static_pad("sink")
    tee_src2.link(queue2_sink)
    queue2.link(conv2)
    conv2.link(caps2)
    caps2.link(appsink)

    # Add pad probe on tracker sink for detection metadata
    tracker_sink = tracker.get_static_pad("sink")
    tracker_sink.add_probe(Gst.PadProbeType.BUFFER, osd_sink_pad_buffer_probe, camera_id)

    return pipeline


# ─── Camera database loader ──────────────────────────────────────────────────

def load_cameras_from_mongo() -> list:
    """Load enabled cameras from MongoDB at startup."""
    from pymongo import MongoClient
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    db = client["visionpro"]
    cameras = list(db["cameras"].find({"enabled": True}, {"_id": 1, "rtsp_url": 1, "name": 1}))
    client.close()
    return [{"id": str(c["_id"]), "rtsp_url": c["rtsp_url"], "name": c["name"]} for c in cameras]


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    global bridge

    Gst.init(None)

    # Convert model first
    logger.info("🔧 Checking TensorRT engine ...")
    convert_if_needed()

    # Write nvinfer config
    nvinfer_config = write_nvinfer_config(ENGINE_PATH, CONF_THRESHOLD)

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
