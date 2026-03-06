<p align="center">
  <img src="https://img.shields.io/badge/Vision%20Pro-NVR-blue?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTE3IDEwLjVWN2MwLS41NS0uNDUtMS0xLTFINGMtLjU1IDAtMSAuNDUtMSAxdjEwYzAgLjU1LjQ1IDEgMSAxaDEyYy41NSAwIDEtLjQ1IDEtMXYtMy41bDQgNHYtMTFsLTQgNHoiLz48L3N2Zz4=" alt="Vision Pro NVR" />
</p>

<h1 align="center">Vision Pro – AI-Powered NVR System</h1>

<p align="center">
  <strong>GPU-accelerated Network Video Recorder with real-time AI detection, face recognition, and intelligent analytics</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.12+-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/typescript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/fastapi-0.115+-009688?style=flat-square&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/mongodb-7-47A248?style=flat-square&logo=mongodb&logoColor=white" />
  <img src="https://img.shields.io/badge/qdrant-vector%20db-DC382D?style=flat-square&logo=data:image/svg+xml;base64,&logoColor=white" />
  <img src="https://img.shields.io/badge/CUDA-GPU%20accelerated-76B900?style=flat-square&logo=nvidia&logoColor=white" />
  <img src="https://img.shields.io/badge/Jetson-Orin%20NX-76B900?style=flat-square&logo=nvidia&logoColor=white" />
  <img src="https://img.shields.io/badge/DeepStream-7.1-76B900?style=flat-square&logo=nvidia&logoColor=white" />
  <img src="https://img.shields.io/badge/JetPack-6.0-76B900?style=flat-square&logo=nvidia&logoColor=white" />
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Jetson Deployment](#-jetson-deployment-nvidia-orin-nx)
- [API Reference](#-api-reference)
- [Development Progress](#-development-progress)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)

---

## 🎯 Overview

**Vision Pro** is a self-hosted, GPU-accelerated Network Video Recorder designed for enterprise-grade security monitoring. It combines real-time object detection (YOLO v5–v11), face recognition (InsightFace/ArcFace), and AI-powered analytics into a modern, single-pane-of-glass interface.

### Key Features

| Feature | Description |
|---------|-------------|
| 🎥 **Multi-Camera RTSP** | Connect unlimited IP cameras via RTSP streams |
| 🧠 **AI Object Detection** | YOLO v5–v11 with GPU inference, customizable models |
| 👤 **Face Recognition** | Real-time identification using InsightFace + vector search |
| 📊 **Smart Analytics** | Detection trends, behavioral analysis, activity heatmaps |
| 🔔 **Multi-Channel Alerts** | Telegram, WhatsApp, Email notifications |
| 🤖 **AI Assistant** | Natural-language queries about security events |
| 🎬 **Smart Recording** | Detection-triggered recording with pre/post event buffers |
| 🔐 **Enterprise Security** | JWT auth, RBAC, encrypted credentials, audit logging |
| 🖥️ **System Monitoring** | Real-time CPU, RAM, Disk, GPU metrics via WebSocket |
| 🔍 **Vector Search** | Semantic event search powered by Qdrant |

---

## 🏗 Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     React + MUI Frontend                   │
│          (TypeScript, Vite, Material UI, Recharts)         │
└───────────────────────┬────────────────────────────────────┘
                        │ REST API + WebSocket
┌───────────────────────▼────────────────────────────────────┐
│                   FastAPI Backend (Python)                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐ │
│  │   Auth   │  │ Cameras  │  │  Events   │  │  Faces   │ │
│  │  (JWT)   │  │  (CRUD)  │  │(Detection)│  │ (RecogN) │ │
│  └──────────┘  └──────────┘  └───────────┘  └──────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐ │
│  │ Playback │  │ Settings │  │ AI Models │  │Analytics │ │
│  │(Records) │  │(Config)  │  │(YOLO Mgmt)│  │(Trends)  │ │
│  └──────────┘  └──────────┘  └───────────┘  └──────────┘ │
│  ┌──────────────────────────────────────────────────────┐ │
│  │            AI Pipeline (GPU-Accelerated)             │ │
│  │   YOLO Detection → Face Recognition → Embeddings    │ │
│  └──────────────────────────────────────────────────────┘ │
└──────┬───────────────────────────────┬────────────────────┘
       │                               │
┌──────▼──────┐                 ┌──────▼──────┐
│  MongoDB 7  │                 │   Qdrant    │
│ (Documents) │                 │  (Vectors)  │
│  9 collections               │ event_embed │
│  indexes + TTL               │ face_embed  │
└─────────────┘                 └─────────────┘
```

---

## 🛠 Tech Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| **FastAPI** | Async REST API framework |
| **Motor** | Async MongoDB driver |
| **Qdrant** | Vector similarity search |
| **Ultralytics** | YOLO object detection (v5–v11) |
| **InsightFace** | Face detection & recognition |
| **PyTorch + ONNX** | GPU-accelerated inference |
| **bcrypt** | Password hashing |
| **python-jose** | JWT token handling |
| **Fernet** | Credential encryption at rest |

### Frontend
| Technology | Purpose |
|-----------|---------|
| **React 19** | UI framework |
| **TypeScript** | Type-safe development |
| **Material UI** | Component library |
| **Vite** | Build tool & dev server |
| **Axios** | HTTP client with interceptors |
| **Recharts** | Data visualization |
| **React Router** | Client-side routing |

### Infrastructure
| Technology | Purpose |
|-----------|---------|
| **Docker Compose** | Container orchestration |
| **MongoDB 7** | Document database |
| **Qdrant** | Vector database (GPU-enabled) |
| **NVIDIA CUDA** | GPU acceleration |

---

## 📁 Project Structure

```
Vision-Pro/
├── backend/
│   ├── app/
│   │   ├── core/                   # Security, GPU, WebSocket utilities
│   │   │   ├── security.py         # JWT, bcrypt, RBAC, Fernet encryption
│   │   │   ├── gpu.py              # NVIDIA GPU detection & metrics
│   │   │   └── websocket.py        # Real-time connection manager
│   │   ├── models/                 # Pydantic schemas (7 model sets)
│   │   │   ├── camera.py           # Camera CRUD + detection config
│   │   │   ├── event.py            # Events with bounding boxes
│   │   │   ├── face.py             # Face profiles & recognition
│   │   │   ├── recording.py        # Recording metadata & export
│   │   │   ├── settings.py         # Storage, notifications, LLM
│   │   │   ├── user.py             # Auth, roles, JWT tokens
│   │   │   └── ai_model.py         # YOLO model management
│   │   ├── routes/                 # API endpoints (11 route groups)
│   │   │   ├── auth.py             # Login, signup, user CRUD
│   │   │   ├── cameras.py          # Camera management
│   │   │   ├── events.py           # Event listing & filtering
│   │   │   ├── faces.py            # Face recognition management
│   │   │   ├── playback.py         # Recording playback & export
│   │   │   ├── settings.py         # System configuration
│   │   │   ├── system.py           # Hardware monitoring
│   │   │   ├── ai_models.py        # Model download & management
│   │   │   ├── ai_assistant.py     # LLM chat (stub)
│   │   │   ├── analytics.py        # Detection analytics
│   │   │   └── heatmaps.py         # Activity heatmaps (stub)
│   │   ├── services/               # Business logic layer
│   │   ├── workers/                # Background task processors
│   │   ├── config.py               # Pydantic settings
│   │   ├── database.py             # MongoDB async connection
│   │   ├── vector_db.py            # Qdrant vector store
│   │   └── main.py                 # FastAPI app entry point
│   ├── requirements.txt
│   └── run.py                      # Uvicorn launcher
├── frontend/
│   └── src/
│       ├── components/Layout/      # Sidebar navigation + responsive drawer
│       ├── pages/                  # 11 page components
│       │   ├── Login.tsx            # Auth with login/signup tabs
│       │   ├── Dashboard.tsx        # Camera grid + stat cards
│       │   ├── Events.tsx           # Event cards with filtering
│       │   ├── Faces.tsx            # Face recognition grid
│       │   ├── Users.tsx            # User management table
│       │   ├── SystemMonitor.tsx    # Live hardware gauges
│       │   ├── AIModels.tsx         # Model download catalog
│       │   ├── AIAssistant.tsx      # Chat interface
│       │   ├── Analytics.tsx        # Detection trends
│       │   ├── Playback.tsx         # Recording viewer
│       │   ├── Heatmaps.tsx         # Activity heatmaps
│       │   └── Settings.tsx         # System configuration
│       ├── services/api.ts          # Axios + JWT interceptors
│       ├── theme.ts                 # MUI dark glassmorphism theme
│       ├── App.tsx                  # Router + auth guards
│       └── main.tsx                 # Entry point
├── docker/
│   ├── docker-compose.yml           # MongoDB + Qdrant + DeepStream (x86/desktop)
│   ├── docker-compose.jetson.yml    # Full Jetson stack (all 4 services)
│   ├── deepstream/                  # x86 DeepStream GPU pipeline
│   │   ├── Dockerfile               # DeepStream 7.1 image (x86)
│   │   ├── entrypoint.sh            # Auto TRT conversion + pipeline start
│   │   └── convert_model.sh         # Manual model conversion helper
│   ├── jetson/                      # NVIDIA Jetson deployment
│   │   ├── Dockerfile.jetson        # DeepStream + pyds (aarch64)
│   │   ├── Dockerfile.backend       # FastAPI backend (aarch64)
│   │   ├── entrypoint_jetson.sh     # PT→ONNX→TRT + pipeline launch
│   │   ├── convert_to_onnx.sh       # Manual ONNX/TRT helper
│   │   └── install_docker_jetson.sh # Docker CE + NVIDIA runtime installer
│   └── mongo-init.js                # DB initialization
├── .env.example                     # Environment template
└── .gitignore
```

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.12+**
- **Node.js 20+**
- **Docker & Docker Compose**
- **NVIDIA GPU** with CUDA 12.x drivers (required for GPU inference)

### 1. Clone & Configure

```bash
git clone https://github.com/ranjanjyoti152/Vision-PRO.git
cd Vision-PRO
cp .env.example .env
# Edit .env with your MongoDB/Qdrant ports if needed
```

### 2. Start Databases (Standard Mode)

```bash
cd docker && docker compose up -d
```

Starts only **MongoDB 7** and **Qdrant** (vector DB). The backend runs natively.

### 2b. Start with DeepStream GPU Pipeline (Optional)

> Requires NVIDIA DeepStream 7.1. First run downloads ~4.3 GB image and converts YOLO → TensorRT (~5 min one-time).

```bash
cd docker && docker compose --profile deepstream up -d
```

Then enable it in your `.env`:
```env
DEEPSTREAM_ENABLED=True
```

| Mode | Command | GPU Pipeline |
|------|---------|-------------|
| **Standard** | `docker compose up -d` | OpenCV + PyTorch YOLO |
| **DeepStream** | `docker compose --profile deepstream up -d` | nvv4l2decoder + TensorRT |

### 3. Start Backend

```bash
cd backend
pip install -r requirements.txt
python run.py --port 8090
```

### 4. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** — the first user to sign up becomes **admin** automatically.

---

## 🚀 Jetson Deployment (NVIDIA Orin NX)

Vision Pro includes full Docker support for **NVIDIA Jetson** devices running JetPack 6.0 (L4T R36.x). The Jetson deployment uses ONNX as the model interchange format with on-device TensorRT engine building for maximum inference performance.

### Architecture (Jetson)

```
┌───────────────────────────────────────────────────────────────┐
│              Docker Compose (Jetson Stack)                     │
│                                                               │
│  ┌─────────────────────┐    ┌─────────────────────────────┐  │
│  │  Backend Container  │    │  DeepStream Container       │  │
│  │  (python:3.11-slim) │    │  (DS 7.1 triton-multiarch)  │  │
│  │                     │    │                             │  │
│  │  FastAPI + Uvicorn  │    │  .pt → .onnx → .engine      │  │
│  │  Motor (MongoDB)    │◄──►│  nvinfer + TensorRT (FP16)  │  │
│  │  YOLO (CPU fallback)│ ZMQ│  nvtracker + pyds           │  │
│  │  Face Recognition   │    │  GStreamer RTSP pipeline     │  │
│  └─────────┬───────────┘    └─────────────────────────────┘  │
│            │                                                  │
│  ┌─────────▼───────────┐    ┌─────────────────────────────┐  │
│  │  MongoDB 7 (arm64)  │    │  Qdrant (arm64)             │  │
│  │  Document storage   │    │  Vector embeddings          │  │
│  └─────────────────────┘    └─────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

### Model Conversion Pipeline

```
 .pt (PyTorch)  ──►  .onnx (ONNX)  ──►  .engine (TensorRT FP16)
   Ultralytics       Portable format     Device-optimized
   export()          Cross-platform      Built on-device
```

> **Note:** TensorRT engines are device-specific. The `.engine` file must be built on the target Jetson hardware. First-run conversion takes 5–15 minutes.

### Prerequisites (Jetson)

- **NVIDIA Jetson Orin NX** (or other Orin/Xavier device)
- **JetPack 6.0** (L4T R36.x)
- **Docker CE 27.x** + NVIDIA Container Toolkit

### 1. Install Docker on Jetson

Use the provided installer script (handles Docker CE 27.5.1, Compose, and NVIDIA runtime):

```bash
chmod +x docker/jetson/install_docker_jetson.sh
sudo docker/jetson/install_docker_jetson.sh
```

This script:
- Installs Docker CE 27.5.1 (compatible with Jetson tegra kernel)
- Installs Docker Compose plugin
- Installs NVIDIA Container Toolkit
- Sets NVIDIA as the default Docker runtime
- Disables direct access filtering (required for tegra kernel)

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env — key Jetson settings:
#   JETSON_MODE=true
#   TRT_WORKSPACE_GB=2
#   DEEPSTREAM_ENABLED=true
```

### 3. Build & Run

```bash
cd docker
docker compose -f docker-compose.jetson.yml build
docker compose -f docker-compose.jetson.yml up
```

This starts **4 containers**:

| Container | Image | Purpose |
|-----------|-------|---------|
| `visionpro-deepstream-jetson` | DS 7.1 triton-multiarch | GPU inference pipeline |
| `visionpro-backend-jetson` | python:3.11-slim | FastAPI REST API |
| `visionpro-mongodb-jetson` | mongo:7.0 (arm64) | Document database |
| `visionpro-qdrant-jetson` | qdrant/qdrant (arm64) | Vector database |

### 4. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://<jetson-ip>:5173** — the first user to sign up becomes **admin**.

### Key Differences: Jetson vs Desktop

| Feature | Desktop (x86) | Jetson (aarch64) |
|---------|---------------|------------------|
| Base image | `nvcr.io/nvidia/deepstream:7.1-gc-triton-devel` | `nvcr.io/nvidia/deepstream:7.1-triton-multiarch` |
| Python | 3.12 | 3.10 (DeepStream) / 3.11 (Backend) |
| Model format | .pt → .engine (direct) | .pt → .onnx → .engine (two-stage) |
| TRT workspace | 4 GB | 2 GB (limited VRAM) |
| onnxruntime | GPU (`onnxruntime-gpu`) | CPU (`onnxruntime`) |
| Docker runtime | `nvidia` | `nvidia` (tegra) |
| pyds install | Pre-installed | Manual wheel (`cp310-cp310`) |

### Jetson-Specific Files

| File | Purpose |
|------|---------|
| `docker/jetson/Dockerfile.jetson` | DeepStream container with pyds, ONNX, TRT |
| `docker/jetson/Dockerfile.backend` | Backend container optimized for aarch64 |
| `docker/jetson/entrypoint_jetson.sh` | Model conversion + pipeline startup |
| `docker/jetson/convert_to_onnx.sh` | Manual ONNX/TRT conversion helper |
| `docker/jetson/install_docker_jetson.sh` | Docker CE + NVIDIA runtime installer |
| `docker/docker-compose.jetson.yml` | Full 4-service Jetson stack |
| `backend/requirements.jetson.txt` | Python deps (CPU onnxruntime) |
| `backend/app/deepstream/onnx_convert.py` | PT→ONNX→TRT conversion module |

---

## 📡 API Reference

| Group | Prefix | Endpoints | Auth |
|-------|--------|-----------|------|
| **Auth** | `/api/auth` | Login, signup, user CRUD | Public (login/signup) |
| **Cameras** | `/api/cameras` | List, create, update, delete | Admin (write) |
| **Events** | `/api/events` | List, filter, count, delete | User |
| **Faces** | `/api/faces` | List, create, upload reference | User |
| **Playback** | `/api/recordings` | List, stream, calendar, export | User |
| **Settings** | `/api/settings` | Storage, notifications, LLM | Admin |
| **System** | `/api/system` | Stats, info, WebSocket feed | User |
| **AI Models** | `/api/models` | List, download, upload, delete | Admin (write) |
| **AI Assistant** | `/api/assistant` | Chat, history | User |
| **Analytics** | `/api/analytics` | Overview, trends | User |
| **Heatmaps** | `/api/heatmaps` | Camera heatmap data | User |

Interactive docs available at **http://localhost:8090/docs** (Swagger UI).

---

## 📊 Development Progress

### Overall Completion

```
Phase 1 ████████████████████ 100%  Foundation
Phase 2 ████████████████████ 100%  Camera Pipeline
Phase 3 ████████████████████ 100%  AI Detection
Phase 4 ████████████████████ 100%  Face Recognition
Phase 5 ████████████████████ 100%  Notifications & LLM
Phase 6 ████████████████████ 100%  Analytics & Heatmaps
Phase 7 ░░░░░░░░░░░░░░░░░░░░   0%  Production Hardening
```

### Phase 1: Foundation ✅

| Component | Status | Details |
|-----------|--------|---------|
| Docker (MongoDB + Qdrant) | ✅ Done | GPU-enabled Qdrant, health checks |
| FastAPI Backend Structure | ✅ Done | 11 route groups, lifecycle management |
| Pydantic Models | ✅ Done | 7 model sets, full validation |
| JWT Authentication | ✅ Done | Login/signup, RBAC (admin/viewer) |
| MongoDB Async (Motor) | ✅ Done | Connection pooling, 9 collections |
| Qdrant Vector DB | ✅ Done | Auto-collection creation |
| GPU Detection | ✅ Done | pynvml + torch integration |
| WebSocket Manager | ✅ Done | Channel-based real-time feeds |
| Credential Encryption | ✅ Done | Fernet symmetric encryption |
| React + TypeScript + MUI | ✅ Done | 11 pages, glassmorphism theme |
| API Service Layer | ✅ Done | Axios + JWT interceptors |
| User Management | ✅ Done | CRUD, roles, first-user-is-admin |

### Phase 2: Camera Pipeline ✅

| Component | Status | Details |
|-----------|--------|---------|
| RTSP Stream Reader | ✅ Done | OpenCV VideoCapture with TCP transport |
| Live Stream WebSocket | ✅ Done | MJPEG streaming to frontend canvas |
| Camera Health Monitor | ✅ Done | Connectivity checks, auto-reconnect backoff |
| Stream Snapshot API | ✅ Done | On-demand frame capture |
| Multi-stream Manager | ✅ Done | Concurrent background threading |

### Phase 3: AI Detection Engine ✅

| Component | Status | Details |
|-----------|--------|---------|
| YOLO Inference Worker | ✅ Done | GPU-accelerated PyTorch threadpool worker |
| Detection Event Creation | ✅ Done | Bounding boxes, snapshot generation |
| Smart Recording Trigger | 🔲 Planned | Pre/post buffer recording (Deferred to Phase 7) |
| Detection Confidence Filter | ✅ Done | Configurable per-camera classification thresholds |
| Model Hot-swap | ✅ Done | Dynamic YOLO model selection architecture |

### Phase 4: Face Recognition ✅

| Component | Status | Details |
|-----------|--------|---------|
| InsightFace Pipeline | ✅ Done | GPU-enabled 512D ArcFace embedding extraction |
| Qdrant Vector Matching | ✅ Done | High-speed cosine similarity search in `face_embeddings` |
| Reference Image Processing | ✅ Done | Auto-enrollment via UI `POST /api/faces/{id}/reference` |
| Face Clustering | ✅ Done | Unknown faces automatically grouped and tracked |
| Recognition Events | ✅ Done | Yields `FACE_KNOWN` and `FACE_UNKNOWN` with DB bounding boxes |

### Phase 5: Notifications & LLM ✅

| Component | Status | Details |
|-----------|--------|---------|
| Telegram Bot Integration | ✅ Done | httpx multipart form sending image/text |
| WhatsApp API | ✅ Done | Generic POST interface ready for meta/twilio |
| Email (SMTP) | ✅ Done | Async email over TLS via aiosmtplib |
| LLM AI Assistant | ✅ Done | GPT/Gemini/Ollama/OpenRouter interfaces connected to UI |
| Event Summarization | ✅ Done | NLP event sentences generated via YOLO worker pipeline |

### Phase 6: Analytics & Heatmaps ✅

| Component | Status | Details |
|-----------|--------|---------|
| Hourly Detection Trends | ✅ Done | Line chart (hour-of-day aggregation via MongoDB pipeline) |
| Daily Detection Trends | ✅ Done | Stacked BarChart grouped by event type |
| Activity Heatmaps | ✅ Done | Canvas heatmap with blue-green-red thermal gradient |
| Per-Camera Rankings | ✅ Done | Bar chart with proportional fill showing busiest cameras |
| Event Distribution Pie | ✅ Done | Donut chart of detection percentages by type |

### Phase 7: Production Hardening 🔲

| Component | Status | Details |
|-----------|--------|---------|
| Production Docker Build | 🔲 Planned | Multi-stage Dockerfile |
| NGINX Reverse Proxy | 🔲 Planned | SSL, compression, static serving |
| Database Backups | 🔲 Planned | Automated mongodump schedules |
| Rate Limiting | 🔲 Planned | API throttling per user |
| Audit Logging | 🔲 Planned | User action tracking |
| Health Dashboard | 🔲 Planned | Service availability monitoring |

---

## 🗺 Roadmap

```mermaid
gantt
    title Vision Pro Development Roadmap
    dateFormat  YYYY-MM
    axisFormat  %b %Y

    section Foundation
    Phase 1 - Backend + Frontend     :done, p1, 2026-02, 2026-02

    section Core Features
    Phase 2 - Camera Pipeline        :active, p2, 2026-02, 2026-03
    Phase 3 - AI Detection           :p3, after p2, 30d
    Phase 4 - Face Recognition       :p4, after p3, 30d

    section Intelligence
    Phase 5 - Notifications & LLM    :p5, after p4, 21d
    Phase 6 - Analytics & Heatmaps   :p6, after p5, 21d

    section Production
    Phase 7 - Hardening & Deploy     :p7, after p6, 14d
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/camera-pipeline`)
3. Commit your changes (`git commit -m 'Add RTSP stream reader'`)
4. Push to the branch (`git push origin feature/camera-pipeline`)
5. Open a Pull Request

---

## 📄 License

This project is proprietary software. All rights reserved.

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/ranjanjyoti152">ranjanjyoti152</a></sub>
</p>
