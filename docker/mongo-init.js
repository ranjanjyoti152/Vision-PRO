// MongoDB initialization script
// Creates the visionpro database, collections, and indexes

db = db.getSiblingDB('visionpro');

// Create collections with schema validation
db.createCollection('cameras');
db.createCollection('events');
db.createCollection('faces');
db.createCollection('recordings');
db.createCollection('settings');
db.createCollection('ai_models');
db.createCollection('users');
db.createCollection('chat_history');
db.createCollection('heatmap_data');

// Indexes for cameras
db.cameras.createIndex({ "name": 1 }, { unique: true });
db.cameras.createIndex({ "status": 1 });
db.cameras.createIndex({ "enabled": 1 });

// Indexes for events
db.events.createIndex({ "camera_id": 1, "timestamp": -1 });
db.events.createIndex({ "event_type": 1, "timestamp": -1 });
db.events.createIndex({ "face_id": 1 });
db.events.createIndex({ "timestamp": -1 });
db.events.createIndex({ "qdrant_id": 1 });

// Indexes for faces
db.faces.createIndex({ "name": 1 });
db.faces.createIndex({ "is_known": 1 });
db.faces.createIndex({ "last_seen": -1 });

// Indexes for recordings
db.recordings.createIndex({ "camera_id": 1, "start_time": -1 });
db.recordings.createIndex({ "start_time": -1, "end_time": -1 });
db.recordings.createIndex({ "trigger_event_id": 1 });

// Indexes for settings
db.settings.createIndex({ "category": 1, "key": 1 }, { unique: true });

// Indexes for ai_models
db.ai_models.createIndex({ "name": 1, "version": 1 }, { unique: true });
db.ai_models.createIndex({ "type": 1 });
db.ai_models.createIndex({ "is_default": 1 });

// Indexes for users
db.users.createIndex({ "username": 1 }, { unique: true });
db.users.createIndex({ "email": 1 }, { unique: true });

// Indexes for chat_history
db.chat_history.createIndex({ "user_id": 1, "created_at": -1 });

// Indexes for heatmap_data
db.heatmap_data.createIndex({ "camera_id": 1, "timestamp": -1 });

// Insert default settings
db.settings.insertMany([
    {
        category: "storage",
        key: "recording_path",
        value: "./recordings",
        updated_at: new Date()
    },
    {
        category: "storage",
        key: "retention_days",
        value: 30,
        updated_at: new Date()
    },
    {
        category: "storage",
        key: "auto_delete",
        value: true,
        updated_at: new Date()
    },
    {
        category: "general",
        key: "detection_confidence_threshold",
        value: 0.5,
        updated_at: new Date()
    },
    {
        category: "general",
        key: "pre_event_buffer_seconds",
        value: 5,
        updated_at: new Date()
    },
    {
        category: "general",
        key: "post_event_buffer_seconds",
        value: 10,
        updated_at: new Date()
    }
]);

print("✅ VisionPro database initialized successfully!");
print("📦 Collections created: cameras, events, faces, recordings, settings, ai_models, users, chat_history, heatmap_data");
print("🔑 First user to sign up will automatically become admin");
