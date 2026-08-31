use base64::Engine;
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
    pub recalled: bool,
    pub recalled_at: Option<String>,
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

/// files 表 v12 迁移时的临时行结构
#[derive(Debug)]
struct FileMigrationRow {
    id: String,
    filename: String,
    mime_type: String,
    size: i64,
    data: Vec<u8>,
    character_id: Option<String>,
    conversation_id: Option<String>,
    created_at: String,
    content_hash: Option<String>,
}

/// 版本化数据库迁移
fn run_migrations(conn: &Connection) -> SqlResult<()> {
    let current: u32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    let migrations: &[(u32, &str)] = &[
        (1, "ALTER TABLE memory_entries ADD COLUMN trigger_message TEXT NOT NULL DEFAULT ''"),
        (2, "ALTER TABLE messages ADD COLUMN attachments TEXT"),
        (3, "ALTER TABLE messages ADD COLUMN recalled INTEGER NOT NULL DEFAULT 0"),
        (4, "ALTER TABLE messages ADD COLUMN recalled_at TEXT"),
        (5, "ALTER TABLE emotion_records ADD COLUMN character_id TEXT"),
        (6, "CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, character_id TEXT DEFAULT '', conversation_id TEXT DEFAULT '', created_at TEXT NOT NULL)"),
        (7, "CREATE INDEX IF NOT EXISTS idx_emotion_records_char_time ON emotion_records(character_id, timestamp DESC)"),
        (8, "ALTER TABLE files ADD COLUMN content_hash TEXT"),
        (9, "CREATE INDEX IF NOT EXISTS idx_files_content_hash ON files(content_hash) WHERE content_hash IS NOT NULL"),
        (10, "ALTER TABLE user_profile ADD COLUMN mbti TEXT NOT NULL DEFAULT ''"),
        (11, "ALTER TABLE user_profile ADD COLUMN birthday TEXT NOT NULL DEFAULT ''"),
        (13, "ALTER TABLE debug_logs ADD COLUMN duration INTEGER NOT NULL DEFAULT 0"),
        (14, "CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_at DESC)"),
        (15, "CREATE INDEX IF NOT EXISTS idx_files_char_created ON files(character_id, created_at DESC)"),
        (16, "CREATE INDEX IF NOT EXISTS idx_files_conv_created ON files(conversation_id, created_at DESC)"),
        (17, "CREATE INDEX IF NOT EXISTS idx_files_mime_created ON files(mime_type, created_at DESC)"),
        // AI 一日生活：活动表（ISO 时间戳文本，与 debug_logs 同构，支持字符串区间比较）
        (18, "CREATE TABLE IF NOT EXISTS ai_activities (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'leisure', start_time TEXT NOT NULL, end_time TEXT NOT NULL, scene_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'planned', process_description TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', mood TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', weather TEXT NOT NULL DEFAULT '', is_changed INTEGER NOT NULL DEFAULT 0, changed_from TEXT NOT NULL DEFAULT '', changed_reason TEXT NOT NULL DEFAULT '', replaced_by TEXT NOT NULL DEFAULT '', comments TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
        (19, "CREATE INDEX IF NOT EXISTS idx_ai_activities_char_start ON ai_activities(character_id, start_time DESC)"),
        // AI 一日生活：每角色配置（开关 / 内容生成档位 / 事件频率 / 上次活跃时间）
        (20, "CREATE TABLE IF NOT EXISTS ai_life_config (character_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, content_level TEXT NOT NULL DEFAULT 'full', event_frequency TEXT NOT NULL DEFAULT 'medium', schedule_mode TEXT NOT NULL DEFAULT 'auto', custom_schedule_json TEXT NOT NULL DEFAULT '[]', last_active_time TEXT NOT NULL DEFAULT '', extra_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)"),
        (21, "CREATE INDEX IF NOT EXISTS idx_ai_activities_status ON ai_activities(character_id, status, start_time ASC)"),
        // AI 一日生活：属性快照（每次变化一条，最新即最近一条）
        (22, "CREATE TABLE IF NOT EXISTS ai_attribute_snapshots (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, timestamp TEXT NOT NULL, health INTEGER NOT NULL DEFAULT 100, stamina INTEGER NOT NULL DEFAULT 100, satiety INTEGER NOT NULL DEFAULT 100, cleanliness INTEGER NOT NULL DEFAULT 100, spirit INTEGER NOT NULL DEFAULT 100, stress INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '')"),
        (23, "CREATE INDEX IF NOT EXISTS idx_ai_attr_char_time ON ai_attribute_snapshots(character_id, timestamp DESC)"),
        // 生活物资 + 经济
        (24, "CREATE TABLE IF NOT EXISTS ai_inventory_items (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'food', name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, quality TEXT NOT NULL DEFAULT 'good', extra_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)"),
        (25, "CREATE INDEX IF NOT EXISTS idx_ai_inv_char ON ai_inventory_items(character_id, category)"),
        (26, "CREATE TABLE IF NOT EXISTS ai_economy (character_id TEXT PRIMARY KEY, balance REAL NOT NULL DEFAULT 3000, monthly_income REAL NOT NULL DEFAULT 0, monthly_expense REAL NOT NULL DEFAULT 0, last_payday TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)"),
        (27, "CREATE TABLE IF NOT EXISTS ai_transactions (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'expense', amount REAL NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', timestamp TEXT NOT NULL)"),
        (28, "CREATE INDEX IF NOT EXISTS idx_ai_tx_char_time ON ai_transactions(character_id, timestamp DESC)"),
        // 世界设定包
        (29, "CREATE TABLE IF NOT EXISTS world_configs (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', world_type TEXT NOT NULL DEFAULT 'modern_real', config_json TEXT NOT NULL DEFAULT '{}', is_builtin INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)"),
        // 🆕 v30：清理存量重复活动（多引擎实例并发写入产生的同名同时段副本，保留最早一条）。
        //    必须先于 v31 的唯一索引执行，否则索引创建会因存量重复失败。
        (30, "DELETE FROM ai_activities WHERE rowid IN (SELECT a.rowid FROM ai_activities a WHERE a.status != 'cancelled' AND EXISTS (SELECT 1 FROM ai_activities b WHERE b.character_id = a.character_id AND b.name = a.name AND b.start_time = a.start_time AND b.status != 'cancelled' AND b.rowid < a.rowid))"),
        // 🆕 v31：未取消活动的唯一约束（结构性防重：无论多少写入方并发，同名同时段只能存在一行）。
        //    partial index —— cancelled 行不参与，重新生成同日程不受影响。
        (31, "CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_activities_char_name_start ON ai_activities(character_id, name, start_time) WHERE status != 'cancelled'"),
        // 🆕 B4：活动事件流表——细粒度生活事件（meal/drink/consume/purchase/random_event/plan_change/milestone/fallback），
        //    injected_into_chat 供 D1 消费审计。
        (32, "CREATE TABLE IF NOT EXISTS ai_life_events (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', activity_id TEXT NOT NULL DEFAULT '', item_id TEXT NOT NULL DEFAULT '', meta_json TEXT NOT NULL DEFAULT '{}', injected_into_chat INTEGER NOT NULL DEFAULT 0)"),
        (33, "CREATE INDEX IF NOT EXISTS idx_ai_life_events_char_ts ON ai_life_events(character_id, ts DESC)"),
        // 🆕 D4 创意工坊：AI 内容提案（睡眠固化时从当天真实经历提炼，用户审核后入池）
        (34, "CREATE TABLE IF NOT EXISTS ai_content_proposals (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'random_event', title TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT NOT NULL DEFAULT '')"),
        (35, "CREATE INDEX IF NOT EXISTS idx_ai_content_proposals_char ON ai_content_proposals(character_id, created_at DESC)"),
        // 🆕 B2.1：七维属性——新增口渴维度（旧行由 DEFAULT 80 回填）
        (36, "ALTER TABLE ai_attribute_snapshots ADD COLUMN thirst INTEGER NOT NULL DEFAULT 80"),
        // 🆕 B7：活动结构化过程 steps（JSON 数组：[{time,phase,note}]）
        (37, "ALTER TABLE ai_activities ADD COLUMN steps TEXT NOT NULL DEFAULT '[]'"),
        // 🆕 主动回复外发：bot 会话映射记录群ID（区分私聊/群聊，供主动回复路由）
        (38, "ALTER TABLE bot_conversations ADD COLUMN external_group_id TEXT"),
        // 🆕 MCP 服务器配置（stdio/http 传输，command/args/env/url/headers 存 config JSON 列）
        (39, "CREATE TABLE IF NOT EXISTS mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', transport TEXT NOT NULL DEFAULT 'stdio', enabled INTEGER NOT NULL DEFAULT 0, config TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    ];

    let tx = conn.unchecked_transaction()?;
    for (version, sql) in migrations {
        if *version > current {
            if let Err(ref e) = tx.execute(sql, []) {
                let err_msg = e.to_string().to_lowercase();
                // Skip duplicate-column errors: column already exists in CREATE TABLE (new DBs)
                // while still adding it for old DBs created before the column was in CREATE TABLE.
                if err_msg.contains("duplicate column name") || err_msg.contains("duplicate column")
                {
                    continue;
                }
                return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
                    std::io::Error::other(format!("Migration v{}: {}", version, e)),
                )));
            }
        }
    }

    // Migration v12: 统一 files.data 列为 BLOB，并将历史 base64 TEXT 数据转换为二进制
    if current < 12 {
        tx.execute(
            "CREATE TABLE IF NOT EXISTS files_blob (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                size INTEGER NOT NULL DEFAULT 0,
                data BLOB NOT NULL,
                character_id TEXT DEFAULT '',
                conversation_id TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                content_hash TEXT
            )",
            [],
        )?;

        let mut stmt = tx.prepare("SELECT id, filename, mime_type, size, data, character_id, conversation_id, created_at, content_hash FROM files")?;
        let rows: Vec<FileMigrationRow> = stmt
            .query_map([], |r| {
                Ok(FileMigrationRow {
                    id: r.get::<_, String>(0)?,
                    filename: r.get::<_, String>(1)?,
                    mime_type: r.get::<_, String>(2)?,
                    size: r.get::<_, i64>(3)?,
                    data: r.get::<_, Vec<u8>>(4)?,
                    character_id: r.get::<_, Option<String>>(5)?,
                    conversation_id: r.get::<_, Option<String>>(6)?,
                    created_at: r.get::<_, String>(7)?,
                    content_hash: r.get::<_, Option<String>>(8)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        for row in rows {
            // 旧数据可能以 base64 文本形式存储；若数据是合法 UTF-8 且能 base64 解码，则转换为二进制
            let final_data = if let Ok(text) = std::str::from_utf8(&row.data) {
                if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(text) {
                    decoded
                } else {
                    row.data
                }
            } else {
                row.data
            };
            let hash = row
                .content_hash
                .unwrap_or_else(|| sha256_bytes(&final_data));
            tx.execute(
                "INSERT INTO files_blob (id, filename, mime_type, size, data, character_id, conversation_id, created_at, content_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![row.id, row.filename, row.mime_type, row.size, final_data, row.character_id.unwrap_or_default(), row.conversation_id.unwrap_or_default(), row.created_at, hash],
            )?;
        }

        tx.execute("DROP TABLE IF EXISTS files", [])?;
        tx.execute("ALTER TABLE files_blob RENAME TO files", [])?;
    }

    // 内容去重：回填 content_hash 并按哈希去重（保留每组 MIN(id)）
    let files_table_exists: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='files'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if files_table_exists > 0 {
        // 1) 回填：对所有 content_hash 为空的行计算 SHA256(data)
        let mut stmt = tx.prepare("SELECT id, data FROM files WHERE content_hash IS NULL")?;
        let pending: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for (id, data) in &pending {
            let hash = sha256_of_data(data);
            let _ = tx.execute(
                "UPDATE files SET content_hash = ?1 WHERE id = ?2",
                params![hash, id],
            );
        }
        // 2) 按 content_hash 去重：同哈希只保留 MIN(id) 一行
        let _ = tx.execute(
            "DELETE FROM files WHERE id NOT IN (SELECT MIN(id) FROM files WHERE content_hash IS NOT NULL GROUP BY content_hash) AND content_hash IS NOT NULL",
            [],
        );
    }
    // 版本号 17：migrations 数组到 11 + v12 独立运行 + v13~v17 索引/字段迁移
    tx.execute("PRAGMA user_version = 17", [])?;
    tx.commit()?;
    Ok(())
}

/// 计算文件数据的 SHA256 哈希：先尝试 base64 解码（标准编码），失败则直接对字符串做哈希作为兜底
pub fn sha256_of_data(data: &str) -> String {
    let bytes: Vec<u8> = match base64::engine::general_purpose::STANDARD.decode(data) {
        Ok(decoded) => decoded,
        Err(_) => data.as_bytes().to_vec(),
    };
    sha256_bytes(&bytes)
}

/// 计算二进制数据的 SHA256 哈希
pub fn sha256_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

pub fn init_db(app: &AppHandle) -> SqlResult<()> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| {
        rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e.to_string())))
    })?;

    if let Err(e) = std::fs::create_dir_all(&app_data_dir) {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::other(e.to_string()),
        )));
    }

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
            recalled INTEGER NOT NULL DEFAULT 0,
            recalled_at TEXT,
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
            recall_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS reflections (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            trigger_text TEXT NOT NULL DEFAULT '',
            insight TEXT NOT NULL DEFAULT '',
            emotion_before TEXT NOT NULL DEFAULT 'neutral',
            emotion_after TEXT NOT NULL DEFAULT 'neutral',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memory_entries (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL DEFAULT '',
            conversation_id TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'summary',
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            importance INTEGER NOT NULL DEFAULT 5,
            created_at TEXT NOT NULL,
            trigger_message TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS debug_logs (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL DEFAULT 'system',
            message TEXT NOT NULL DEFAULT '',
            timestamp TEXT NOT NULL,
            character_id TEXT NOT NULL DEFAULT '',
            conversation_id TEXT NOT NULL DEFAULT '',
            duration INTEGER NOT NULL DEFAULT 0
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
            external_group_id TEXT,
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

        CREATE TABLE IF NOT EXISTS ui_config (
            id TEXT PRIMARY KEY DEFAULT 'default',
            config_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE TABLE IF NOT EXISTS ai_diaries (
            id TEXT PRIMARY KEY,
            character_id TEXT NOT NULL,
            date TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            mood TEXT NOT NULL DEFAULT '',
            activities TEXT NOT NULL DEFAULT '[]',
            thoughts TEXT NOT NULL DEFAULT '[]',
            comments TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_ai_diaries_char_date
            ON ai_diaries(character_id, date DESC);

        PRAGMA foreign_keys = OFF;

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

        CREATE INDEX IF NOT EXISTS idx_conversations_updated
            ON conversations(updated_at DESC);

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

    // Versioned migration system (PRAGMA user_version)
    run_migrations(&conn)?;

    // T1: 迁移旧的明文 API Key 为加密格式（v7+，幂等，失败不影响业务）
    match crate::crypto::migrate_plaintext_keys(&conn, &app_data_dir) {
        Ok(0) => {}
        Ok(n) => {
            log::info!("迁移了 {} 个旧明文 API Key", n);
        }
        Err(e) => {
            log::warn!("API Key 迁移失败（不影响业务）: {}", e);
        }
    }

    app.manage(DbState {
        conn: Mutex::new(conn),
    });

    Ok(())
}
