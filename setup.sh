#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Vision Pro – Quick Setup Script
# Run this after cloning the repo to create required directories,
# install dependencies, and set proper permissions.
# ─────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "🚀 Vision Pro Setup — $SCRIPT_DIR"

# ── 1. Create runtime directories ───────────────────────────────
echo "📁 Creating runtime directories..."
DIRS=(
    "backend/recordings"
    "backend/snapshots"
    "backend/models"
    "backend/models/yolo"
    "backend/models/faces"
    "backend/models/face_references"
    "backend/face_crops"
)

for dir in "${DIRS[@]}"; do
    mkdir -p "$SCRIPT_DIR/$dir"
    echo "   ✅ $dir"
done

# ── 2. Set permissions (readable/writable by current user) ──────
echo "🔐 Setting permissions..."
for dir in "${DIRS[@]}"; do
    chmod -R 755 "$SCRIPT_DIR/$dir"
done
chmod -R u+rw "$SCRIPT_DIR/backend"
echo "   ✅ Permissions set"

# ── 3. Backend Python dependencies ─────────────────────────────
if [ -f "$SCRIPT_DIR/backend/requirements.txt" ]; then
    echo "🐍 Installing Python dependencies..."
    cd "$SCRIPT_DIR/backend"
    if [ -n "$VIRTUAL_ENV" ]; then
        pip install -r requirements.txt --quiet
    else
        echo "   ⚠  No virtual environment active. Run:"
        echo "      python -m venv venv && source venv/bin/activate"
        echo "      pip install -r requirements.txt"
    fi
fi

# ── 4. Frontend dependencies ──────────────────────────────────
if [ -f "$SCRIPT_DIR/frontend/package.json" ]; then
    echo "📦 Installing frontend dependencies..."
    cd "$SCRIPT_DIR/frontend"
    npm install --silent 2>/dev/null || echo "   ⚠  npm install failed — run manually"
fi

# ── 5. Create .env if not exists ───────────────────────────────
if [ ! -f "$SCRIPT_DIR/backend/.env" ]; then
    echo "📝 Creating default .env file..."
    cat > "$SCRIPT_DIR/backend/.env" << 'EOF'
# Vision Pro Configuration
# Copy this file and adjust values for your environment.

# MongoDB
MONGO_HOST=localhost
MONGO_PORT=27917
MONGO_USER=visionpro
MONGO_PASS=visionpro_secret
MONGO_DB=visionpro

# Qdrant Vector DB
QDRANT_HOST=localhost
QDRANT_PORT=6933

# JWT Auth
SECRET_KEY=change-this-to-a-random-secret-key

# Server
BACKEND_PORT=8090
DEBUG=false
EOF
    echo "   ✅ backend/.env created — edit with your credentials"
fi

echo ""
echo "✅ Setup complete! To start:"
echo "   Backend: cd backend && python run.py --port 8090"
echo "   Frontend: cd frontend && npm run dev"
