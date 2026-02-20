FROM nvcr.io/nvidia/deepstream:7.1-triton-multiarch

LABEL maintainer="Vision Pro NVR"
LABEL description="DeepStream GPU pipeline – RTSP decode + TensorRT YOLO inference"

# Install Python runtime deps
RUN pip3 install --no-cache-dir \
    pyzmq==25.1.2 \
    numpy \
    Pillow \
    ultralytics \
    pymongo \
    motor

# Make model cache dir
RUN mkdir -p /models/yolo /models/faces

WORKDIR /app

# Copy DeepStream pipeline package
COPY app/ /app/app/

COPY docker/deepstream/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
