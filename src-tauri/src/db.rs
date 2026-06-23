
use rusqlite::{Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

pub struct DbState {
    pub conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbPlatform {
    pub id: i64,
    pub display_name: String,
    pub base_url: String,
    pub api_key: String,
    pub enabled: bool,
    pub is_default: bool,
    pub models: Vec<DbModel>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbModel {
    pub id: i64,
    pub platform_id: i64,
    pub name: String,
    #[serde(rename = "type")]
    pub model_type: String,
    pub enabled: bool,
    pub pinned: bool,
    pub enabled_types: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbConversation {
    pub id: String,
    pub title: String,
    pub character_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<DbMessage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbMessage {
    pub id: String,
    pub conversation_id: String,
    pub content: String,
    pub sender: String,
    pub timestamp: String,
    pub emotion: Option<String>,
    pub emotion_intensity: Option<f64>,
    pub attachments: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbEmotionRecord {
    pub id: String,
    pub emotion: String,
    pub intensity: f64,
    pub timestamp: String,
    pub context: String,
    pub character_id: Option<String>,
}

pub fn init_db(app: &AppHandle) -> SqlResult<()> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");

    std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");

    let db_path = app_data_dir.join("chat.db");
    let conn = Connection::open(db_path)?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS platforms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            display_name TEXT NOT NULL DEFAULT '',
            base_url TEXT NOT NULL DEFAULT '',
            api_key TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 0,
            is_default INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform_id INTEGER NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            type TEXT NOT NULL DEFAULT 'chat',
            enabled INTEGER NOT NULL DEFAULT 0,
            pinned INTEGER NOT NULL DEFAULT 0,
            enabled_types TEXT NOT NULL DEFAULT '[]',
            FOREIGN KEY (platform_id) REFERENCES platforms(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            character_id TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            sender TEXT NOT NULL DEFAULT 'user',
            timestamp TEXT NOT NULL,
            emotion TEXT,
            emotion_intensity REAL,
            attachments TEXT,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS emotion_records (
            id TEXT PRIMARY KEY,
            emotion TEXT NOT NULL,
            intensity REAL NOT NULL,
            timestamp TEXT NOT NULL,
            context TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            avatar TEXT NOT NULL DEFAULT '',
            personality TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            greeting_message TEXT NOT NULL DEFAULT '',
            background TEXT NOT NULL DEFAULT '',
            likes TEXT NOT NULL DEFAULT '[]',
            dislikes TEXT NOT NULL DEFAULT '[]',
            habits TEXT NOT NULL DEFAULT '[]',
            catchphrases TEXT NOT NULL DEFAULT '[]',
            emotion_triggers TEXT NOT NULL DEFAULT '',
            emotion_expressions TEXT NOT NULL DEFAULT '',
            thinking_style TEXT NOT NULL DEFAULT '',
            relationship_stages TEXT NOT NULL DEFAULT '',
            response_style TEXT NOT NULL DEFAULT '',
            identity_anchors TEXT NOT NULL DEFAULT '',
            forbidden_behaviors TEXT NOT NULL DEFAULT '',
            output_format TEXT NOT NULL DEFAULT '',
            memory_importance_threshold INTEGER NOT NULL DEFAULT 5,
            reflection_enabled INTEGER NOT NULL DEFAULT 1,
            time_awareness_enabled INTEGER NOT NULL DEFAULT 1,
            timezone TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '',
            importance INTEGER NOT NULL DEFAULT 5,
            tags TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            last_recalled_at TEXT,
            recall_count INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reflections (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            trigger_text TEXT NOT NULL DEFAULT '',
            insight TEXT NOT NULL DEFAULT '',
            emotion_before TEXT NOT NULL DEFAULT 'neutral',
            emotion_after TEXT NOT NULL DEFAULT 'neutral',
            created_at TEXT NOT NULL,
            FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS memory_entries (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'summary',
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            importance INTEGER NOT NULL DEFAULT 5,
            created_at TEXT NOT NULL,
            trigger_message TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS debug_logs (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL DEFAULT 'system',
            message TEXT NOT NULL DEFAULT '',
            timestamp TEXT NOT NULL,
            character_id TEXT NOT NULL DEFAULT '',
            conversation_id TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS character_emotions (
            character_id TEXT PRIMARY KEY,
            emotion TEXT NOT NULL DEFAULT 'neutral',
            intensity REAL NOT NULL DEFAULT 30
        );

        CREATE TABLE IF NOT EXISTS character_affinities (
            character_id TEXT PRIMARY KEY,
            level REAL NOT NULL DEFAULT 0,
            stage TEXT NOT NULL DEFAULT 'stranger',
            history TEXT NOT NULL DEFAULT '[]',
            last_interaction TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS deleted_memory_entries (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT 'summary',
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            importance INTEGER NOT NULL DEFAULT 5,
            created_at TEXT NOT NULL,
            trigger_message TEXT NOT NULL DEFAULT '',
            deleted_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_roles (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS bot_integrations (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            config TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS bot_conversations (
            id TEXT PRIMARY KEY,
            integration_id TEXT NOT NULL,
            external_user_id TEXT NOT NULL,
            external_user_name TEXT NOT NULL,
            character_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (integration_id) REFERENCES bot_integrations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS mbti_tests (
            id TEXT PRIMARY KEY,
            type_code TEXT NOT NULL,
            dimensions TEXT NOT NULL DEFAULT '{}',
            completed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_profile (
            id TEXT PRIMARY KEY DEFAULT 'default',
            avatar TEXT NOT NULL DEFAULT '',
            nickname TEXT NOT NULL DEFAULT '',
            age TEXT NOT NULL DEFAULT '',
            gender TEXT NOT NULL DEFAULT '',
            personality TEXT NOT NULL DEFAULT '',
            background TEXT NOT NULL DEFAULT '',
            interests TEXT NOT NULL DEFAULT '',
            habits TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS backups (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            data_json TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0
        );

        PRAGMA foreign_keys = ON;

        -- Performance indexes
        CREATE INDEX IF NOT EXISTS idx_memory_entries_char_cat
            ON memory_entries(character_id, category, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memory_entries_importance
            ON memory_entries(character_id, importance DESC, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memory_entries_created
            ON memory_entries(character_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_debug_logs_char_time
            ON debug_logs(character_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_debug_logs_type_time
            ON debug_logs(type, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_debug_logs_conv_time
            ON debug_logs(conversation_id, timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_messages_conv_time
            ON messages(conversation_id, timestamp ASC);

        CREATE INDEX IF NOT EXISTS idx_emotion_records_time
            ON emotion_records(timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_memories_char_imp
            ON memories(character_id, importance DESC, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_reflections_char_time
            ON reflections(character_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_deleted_memory_entries_time
            ON deleted_memory_entries(deleted_at DESC);
        CREATE INDEX IF NOT EXISTS idx_deleted_memory_entries_char
            ON deleted_memory_entries(character_id, deleted_at DESC);

        CREATE INDEX IF NOT EXISTS idx_bot_conv_integration
            ON bot_conversations(integration_id, external_user_id);
        CREATE INDEX IF NOT EXISTS idx_bot_conv_character
            ON bot_conversations(character_id);

        CREATE INDEX IF NOT EXISTS idx_mbti_tests_time
            ON mbti_tests(completed_at DESC);
        ",
    )?;

    // Migration: add trigger_message column to existing DBs
    let _ = conn.execute("ALTER TABLE memory_entries ADD COLUMN trigger_message TEXT NOT NULL DEFAULT ''", []);

    // Migration: add attachments column to messages table
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN attachments TEXT", []);

    // Migration: add character_id column to emotion_records table
    let _ = conn.execute("ALTER TABLE emotion_records ADD COLUMN character_id TEXT", []);

    // Dedup: remove duplicate file records (same filename + size, keep only the newest by id)
    let _ = conn.execute(
        "DELETE FROM files WHERE id NOT IN (SELECT MIN(id) FROM files GROUP BY filename, size)",
        [],
    );

    app.manage(DbState {
        conn: Mutex::new(conn),
    });

    Ok(())
}

