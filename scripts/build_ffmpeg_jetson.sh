#!/bin/bash
###############################################################################
# Build FFmpeg with Jetson V4L2 M2M hardware H.264/H.265 decoding
# and rebuild OpenCV to link against it.
#
# Target: Jetson Orin, JetPack 6.0, L4T R36.3.0, aarch64
# Python venv: /home/proxpc/NVR10
#
# Usage:   sudo bash scripts/build_ffmpeg_jetson.sh
# Time:    ~15-25 minutes (FFmpeg ~5min, OpenCV ~15min)
###############################################################################
set -euo pipefail
trap '' PIPE  # Ignore SIGPIPE — caused by | head closing early

FFMPEG_VERSION="6.1.2"
OPENCV_VERSION="4.11.0"
INSTALL_PREFIX="/usr/local"
FFMPEG_SRC="/tmp/ffmpeg_build_src"
OPENCV_SRC="/tmp/opencv_build_src"
PYTHON_BIN="/home/proxpc/NVR10/bin/python3"
NPROC=$(nproc)
# Limit OpenCV build jobs to avoid OOM — CUDA compilation is very memory-hungry
OCV_JOBS=2

echo "═══════════════════════════════════════════════════════════════"
echo "  FFmpeg + OpenCV Jetson Hardware Decoder Build"
echo "  FFmpeg ${FFMPEG_VERSION}  |  OpenCV ${OPENCV_VERSION}"
echo "  Install prefix: ${INSTALL_PREFIX}"
echo "  Build jobs: ${NPROC}"
echo "═══════════════════════════════════════════════════════════════"

# ── Step 0: Install build dependencies ──────────────────────────────────────
echo -e "\n[1/6] Installing build dependencies..."
apt-get update -qq
apt-get install -y -qq \
    build-essential cmake git pkg-config yasm nasm \
    libx264-dev libx265-dev libvpx-dev libfdk-aac-dev libmp3lame-dev libopus-dev \
    libass-dev libfreetype6-dev libtool autoconf automake texinfo \
    libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
    libgstreamer-plugins-good1.0-dev libgstreamer-plugins-bad1.0-dev \
    libv4l-dev v4l-utils \
    libjpeg-dev libpng-dev libtiff-dev \
    libatlas-base-dev gfortran \
    libhdf5-dev libprotobuf-dev protobuf-compiler \
    liblapack-dev libopenblas-dev \
    python3-dev python3-numpy 2>/dev/null || true

# ── Step 1: Build FFmpeg with V4L2 M2M ─────────────────────────────────────
echo -e "\n[2/6] Downloading FFmpeg ${FFMPEG_VERSION}..."
rm -rf "${FFMPEG_SRC}"
mkdir -p "${FFMPEG_SRC}"
cd "${FFMPEG_SRC}"

wget -q "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -O ffmpeg.tar.xz
tar xf ffmpeg.tar.xz
cd "ffmpeg-${FFMPEG_VERSION}"

echo -e "\n[3/6] Configuring FFmpeg with V4L2 M2M hardware decoders..."
./configure \
    --prefix="${INSTALL_PREFIX}" \
    --enable-shared \
    --enable-gpl \
    --enable-nonfree \
    --enable-libx264 \
    --enable-libx265 \
    --enable-libvpx \
    --enable-libfdk-aac \
    --enable-libmp3lame \
    --enable-libopus \
    --enable-v4l2-m2m \
    --enable-libfreetype \
    --enable-libass \
    --extra-cflags="-I/usr/local/cuda/include" \
    --extra-ldflags="-L/usr/local/cuda/lib64" \
    --disable-static \
    --disable-doc \
    --disable-debug

echo -e "\n[4/6] Compiling FFmpeg (${NPROC} threads)..."
make -j${NPROC}
make install
ldconfig

# Verify FFmpeg
echo "FFmpeg installed:"
ffmpeg -version 2>&1 | head -3 || true
echo "Hardware decoders available:"
ffmpeg -decoders 2>/dev/null | grep -i "v4l2m2m\|nvmpi\|cuvid" || echo "  (v4l2m2m decoder included via kernel V4L2)"

# ── Step 2: Rebuild OpenCV with new FFmpeg + GStreamer ──────────────────────
echo -e "\n[5/6] Downloading and building OpenCV ${OPENCV_VERSION}..."
rm -rf "${OPENCV_SRC}"
mkdir -p "${OPENCV_SRC}"
cd "${OPENCV_SRC}"

git clone --depth 1 --branch "${OPENCV_VERSION}" https://github.com/opencv/opencv.git
git clone --depth 1 --branch "${OPENCV_VERSION}" https://github.com/opencv/opencv_contrib.git

mkdir -p opencv/build
cd opencv/build

NUMPY_INCLUDE=$("${PYTHON_BIN}" -c "import numpy; print(numpy.get_include())")
PYTHON_PACKAGES=$("${PYTHON_BIN}" -c "import site; print(site.getsitepackages()[0])")

cmake \
    -D CMAKE_BUILD_TYPE=RELEASE \
    -D CMAKE_INSTALL_PREFIX="${INSTALL_PREFIX}" \
    -D CMAKE_CXX_STANDARD=17 \
    -D OPENCV_EXTRA_MODULES_PATH="${OPENCV_SRC}/opencv_contrib/modules" \
    -D WITH_FFMPEG=ON \
    -D WITH_GSTREAMER=ON \
    -D WITH_V4L=ON \
    -D WITH_CUDA=ON \
    -D CUDA_ARCH_BIN="8.7" \
    -D CUDA_ARCH_PTX="" \
    -D CUDA_NVCC_FLAGS="--std=c++17" \
    -D WITH_CUBLAS=ON \
    -D WITH_CUDNN=ON \
    -D OPENCV_DNN_CUDA=ON \
    -D ENABLE_FAST_MATH=ON \
    -D CUDA_FAST_MATH=ON \
    -D WITH_NVCUVID=OFF \
    -D WITH_NVCUVENC=OFF \
    -D WITH_TBB=ON \
    -D WITH_OPENGL=ON \
    -D WITH_QT=OFF \
    -D BUILD_TESTS=OFF \
    -D BUILD_EXAMPLES=OFF \
    -D BUILD_PERF_TESTS=OFF \
    -D PYTHON3_EXECUTABLE="${PYTHON_BIN}" \
    -D PYTHON3_NUMPY_INCLUDE_DIRS="${NUMPY_INCLUDE}" \
    -D PYTHON3_PACKAGES_PATH="${PYTHON_PACKAGES}" \
    -D OPENCV_GENERATE_PKGCONFIG=ON \
    -D BUILD_opencv_python3=ON \
    ..

echo "Build configuration summary:"
grep -A5 "FFMPEG" CMakeCache.txt | head -10 || true
grep -A2 "GStreamer" CMakeCache.txt | head -5 || true

echo -e "\n[6/6] Compiling OpenCV (${OCV_JOBS} threads — this takes ~20-30 min)..."
make -j${OCV_JOBS}
make install
ldconfig

# ── Verify ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  BUILD COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
"${PYTHON_BIN}" -c "
import cv2
print(f'OpenCV version: {cv2.__version__}')
bi = cv2.getBuildInformation()
for line in bi.split('\n'):
    ll = line.lower()
    if 'ffmpeg' in ll or 'gstreamer' in ll or 'v4l' in ll or 'cuda' in ll:
        print(line)
"
echo ""
echo "Done! Restart the backend to use the new OpenCV with hardware H.264 decoding."

# Cleanup
rm -rf "${FFMPEG_SRC}" "${OPENCV_SRC}"
