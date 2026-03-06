#!/bin/bash
# ============================================================================
# Vision Pro NVR – Docker + NVIDIA Runtime Installer for Jetson
# ============================================================================
# Platform:  NVIDIA Jetson (JetPack 6.0 / L4T R36.x / Ubuntu 22.04 ARM64)
# Installs:  Docker CE 27.5.1, Compose 5.1.0, NVIDIA Container Toolkit
#
# Usage:
#   chmod +x install_docker_jetson.sh
#   sudo ./install_docker_jetson.sh
#
# NOTE: Docker 29.x is NOT compatible with Jetson's tegra kernel (missing
#       iptable_raw module). This script pins Docker to 27.5.x.
# ============================================================================
set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✅]${NC} $1"; }
warn()  { echo -e "${YELLOW}[⚠️]${NC} $1"; }
info()  { echo -e "${CYAN}[ℹ️]${NC} $1"; }
error() { echo -e "${RED}[❌]${NC} $1"; exit 1; }

# ── Preflight checks ────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    error "Please run as root:  sudo ./install_docker_jetson.sh"
fi

ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ]; then
    error "This script is for Jetson (aarch64). Detected: $ARCH"
fi

if [ ! -f /etc/nv_tegra_release ]; then
    warn "No /etc/nv_tegra_release found — this may not be a Jetson device."
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

echo ""
echo "============================================"
echo "  Vision Pro – Jetson Docker Installer"
echo "============================================"
echo "  Platform: $(uname -m)"
echo "  Kernel:   $(uname -r)"
echo "  OS:       $(lsb_release -ds 2>/dev/null || cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2)"
echo "  Tegra:    $(head -1 /etc/nv_tegra_release 2>/dev/null || echo 'N/A')"
echo "============================================"
echo ""

# Docker version to install (27.5.x — compatible with Jetson tegra kernel)
DOCKER_VERSION="5:27.5.1-1~ubuntu.22.04~jammy"

# ── Step 1: Install prerequisites ────────────────────────────────────────────
info "Step 1/7: Installing prerequisites..."
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg lsb-release > /dev/null 2>&1
log "Prerequisites installed"

# ── Step 2: Add Docker GPG key ──────────────────────────────────────────────
info "Step 2/7: Adding Docker GPG key..."
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    log "Docker GPG key added"
else
    log "Docker GPG key already exists"
fi

# ── Step 3: Add Docker repository ───────────────────────────────────────────
info "Step 3/7: Adding Docker apt repository..."
DOCKER_REPO="deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
echo "$DOCKER_REPO" > /etc/apt/sources.list.d/docker.list
apt-get update -qq
log "Docker repository added"

# ── Step 4: Install Docker CE 27.5.x ────────────────────────────────────────
info "Step 4/7: Installing Docker CE 27.5.1 (Jetson-compatible)..."
if docker --version 2>/dev/null | grep -q "27.5"; then
    log "Docker 27.5.x already installed"
else
    apt-get install -y --allow-downgrades \
        docker-ce="$DOCKER_VERSION" \
        docker-ce-cli="$DOCKER_VERSION" \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin
    log "Docker CE 27.5.1 installed"
fi

# Pin Docker version to prevent auto-upgrade to 29.x (incompatible with tegra kernel)
apt-mark hold docker-ce docker-ce-cli > /dev/null 2>&1
log "Docker version pinned (prevents auto-upgrade to 29.x)"

# ── Step 5: Install NVIDIA Container Toolkit ─────────────────────────────────
info "Step 5/7: Checking NVIDIA Container Toolkit..."
if dpkg -l | grep -q nvidia-container-toolkit; then
    log "NVIDIA Container Toolkit already installed ($(dpkg -l nvidia-container-toolkit | awk '/nvidia-container-toolkit/{print $3}'))"
else
    info "Installing NVIDIA Container Toolkit..."
    # Add NVIDIA repo if not present
    if [ ! -f /etc/apt/sources.list.d/nvidia-container-toolkit.list ]; then
        curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
            gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
        curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
            sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
            tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
        apt-get update -qq
    fi
    apt-get install -y nvidia-container-toolkit
    log "NVIDIA Container Toolkit installed"
fi

# ── Step 6: Configure NVIDIA as default runtime ─────────────────────────────
info "Step 6/7: Configuring NVIDIA as default Docker runtime..."
nvidia-ctk runtime configure --runtime=docker > /dev/null 2>&1

# Set nvidia as the default runtime in daemon.json
python3 -c "
import json, os
daemon_file = '/etc/docker/daemon.json'
cfg = {}
if os.path.exists(daemon_file):
    with open(daemon_file) as f:
        cfg = json.load(f)
cfg['default-runtime'] = 'nvidia'
with open(daemon_file, 'w') as f:
    json.dump(cfg, f, indent=4)
"

# Switch to iptables-legacy (better compatibility with tegra kernel)
update-alternatives --set iptables /usr/sbin/iptables-legacy 2>/dev/null || true
update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy 2>/dev/null || true

systemctl restart docker
log "NVIDIA set as default Docker runtime"

# ── Step 7: Add current user to docker group ─────────────────────────────────
info "Step 7/7: Adding user to docker group..."
REAL_USER="${SUDO_USER:-$USER}"
if id -nG "$REAL_USER" | grep -qw docker; then
    log "User '$REAL_USER' already in docker group"
else
    usermod -aG docker "$REAL_USER"
    log "User '$REAL_USER' added to docker group"
    warn "Log out and back in (or run 'newgrp docker') for group changes to take effect"
fi

# ── Verification ─────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Verification"
echo "============================================"

DOCKER_VER=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "ERROR")
COMPOSE_VER=$(docker compose version --short 2>/dev/null || echo "ERROR")
RUNTIME=$(python3 -c "import json; print(json.load(open('/etc/docker/daemon.json')).get('default-runtime','runc'))" 2>/dev/null || echo "ERROR")

echo "  Docker CE:     $DOCKER_VER"
echo "  Compose:       $COMPOSE_VER"
echo "  Default Runtime: $RUNTIME"
echo "  NVIDIA Toolkit:  $(dpkg -l nvidia-container-toolkit 2>/dev/null | awk '/nvidia-container-toolkit/{print $3}' || echo 'N/A')"
echo ""

# Quick container test
if docker run --rm ubuntu:22.04 echo "OK" > /dev/null 2>&1; then
    log "Container test: PASSED ✅"
else
    warn "Container test: FAILED (try rebooting)"
fi

echo ""
echo "============================================"
echo "  ✅ Docker installation complete!"
echo ""
echo "  To start Vision Pro on Jetson:"
echo "    cd docker"
echo "    docker compose -f docker-compose.jetson.yml up -d"
echo "============================================"
echo ""
