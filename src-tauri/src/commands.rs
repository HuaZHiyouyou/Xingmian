
use crate::bot::types::BotIntegrationConfig;
use crate::crypto::{encrypt_api_key, decrypt_api_key};
use crate::db::{DbState, DbConversation, DbEmotionRecord, DbMessage, DbModel, DbPlatform};
use rusqlite::params;
use serde_json::{Value, json};
use std::collections::HashMap;
use tauri::AppHandle;
use tauri::Manager;

// ========== Debug Logs ==========

#[tauri::command]
pub fn get_debug_logs(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, type, message, timestamp, character_id, conversation_id, duration FROM debug_logs ORDER BY timestamp DESC LIMIT 5000")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "type": row.get::<_, String>(1)?,
                "message": row.get::<_, String>(2)?,
                "timestamp": row.get::<_, String>(3)?,
                "characterId": row.get::<_, String>(4).unwrap_or_default(),
                "conversationId": row.get::<_, String>(5).unwrap_or_default(),
                "duration": row.get::<_, i64>(6).unwrap_or(0),
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_debug_logs(app: AppHandle, logs: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;

    for l in &logs {
        tx.execute(
            "INSERT OR REPLACE INTO debug_logs (id, type, message, timestamp, character_id, conversation_id, duration) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                l["id"].as_str().unwrap_or(""),
                l["type"].as_str().unwrap_or("system"),
                l["message"].as_str().unwrap_or(""),
                l["timestamp"].as_str().unwrap_or(""),
                l["characterId"].as_str().unwrap_or(""),
                l["conversationId"].as_str().unwrap_or(""),
                l["duration"].as_i64().unwrap_or(0),
            ],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn batch_insert_debug_logs(app: AppHandle, logs: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;

    for l in &logs {
        tx.execute(
            "INSERT INTO debug_logs (id, type, message, timestamp, character_id, conversation_id, duration) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                l["id"].as_str().unwrap_or(""),
                l["type"].as_str().unwrap_or("system"),
                l["message"].as_str().unwrap_or(""),
                l["timestamp"].as_str().unwrap_or(""),
                l["characterId"].as_str().unwrap_or(""),
                l["conversationId"].as_str().unwrap_or(""),
                l["duration"].as_i64().unwrap_or(0),
            ],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_debug_logs_by_character(app: AppHandle, character_id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM debug_logs WHERE character_id = ?1", params![character_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_debug_logs_by_conversation(app: AppHandle, conversation_id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM debug_logs WHERE conversation_id = ?1", params![conversation_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_debug_logs(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM debug_logs", []).map_err(|e| e.to_string())?;
    Ok(())
}

/// 🆕 按 ID 批量删除日志：设置页/日志页的单条与多选删除走这里，确保落库（此前只删内存，重载即复活）
#[tauri::command]
pub fn delete_debug_logs_by_ids(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    for chunk in ids.chunks(500) {
        let placeholders = chunk.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect::<Vec<_>>().join(",");
        let sql = format!("DELETE FROM debug_logs WHERE id IN ({})", placeholders);
        let params_iter: Vec<&dyn rusqlite::ToSql> = chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        db.execute(&sql, params_iter.as_slice()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ========== Character Emotions ==========

#[tauri::command]
pub fn get_character_emotions(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT character_id, emotion, intensity FROM character_emotions")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "characterId": row.get::<_, String>(0)?,
                "emotion": row.get::<_, String>(1)?,
                "intensity": row.get::<_, f64>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_character_emotions(app: AppHandle, emotions: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM character_emotions", []).map_err(|e| e.to_string())?;

    for e in &emotions {
        db.execute(
            "INSERT INTO character_emotions (character_id, emotion, intensity) VALUES (?1,?2,?3)",
            params![
                e["characterId"].as_str().unwrap_or(""),
                e["emotion"].as_str().unwrap_or("neutral"),
                e["intensity"].as_f64().unwrap_or(30.0),
            ],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ========== Character Affinities ==========

#[tauri::command]
pub fn get_character_affinities(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT character_id, level, stage, history, last_interaction FROM character_affinities")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "characterId": row.get::<_, String>(0)?,
                "level": row.get::<_, f64>(1)?,
                "stage": row.get::<_, String>(2)?,
                "history": row.get::<_, String>(3)?,
                "lastInteraction": row.get::<_, String>(4)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_character_affinities(app: AppHandle, affinities: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM character_affinities", []).map_err(|e| e.to_string())?;

    for a in &affinities {
        db.execute(
            "INSERT INTO character_affinities (character_id, level, stage, history, last_interaction) VALUES (?1,?2,?3,?4,?5)",
            params![
                a["characterId"].as_str().unwrap_or(""),
                a["level"].as_f64().unwrap_or(0.0),
                a["stage"].as_str().unwrap_or("stranger"),
                a["history"].as_str().unwrap_or("[]"),
                a["lastInteraction"].as_str().unwrap_or(""),
            ],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ========== Deleted Memory Entries (Recycle Bin) ==========

#[tauri::command]
pub fn get_deleted_memory_entries(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT id, character_id, conversation_id, category, title, content, tags, importance, created_at, trigger_message, deleted_at FROM deleted_memory_entries ORDER BY deleted_at DESC LIMIT 200",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "characterId": row.get::<_, String>(1)?,
                "conversationId": row.get::<_, String>(2)?,
                "category": row.get::<_, String>(3)?,
                "title": row.get::<_, String>(4)?,
                "content": row.get::<_, String>(5)?,
                "tags": row.get::<_, String>(6)?,
                "importance": row.get::<_, i64>(7)?,
                "createdAt": row.get::<_, String>(8)?,
                "triggerMessage": row.get::<_, String>(9).unwrap_or_default(),
                "deletedAt": row.get::<_, String>(10)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_deleted_memory_entries(app: AppHandle, entries: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM deleted_memory_entries", []).map_err(|e| e.to_string())?;

    for e in &entries {
        db.execute(
            "INSERT INTO deleted_memory_entries (id, character_id, conversation_id, category, title, content, tags, importance, created_at, trigger_message, deleted_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                e["id"].as_str().unwrap_or(""),
                e["characterId"].as_str().unwrap_or(""),
                e["conversationId"].as_str().unwrap_or(""),
                e["category"].as_str().unwrap_or("summary"),
                e["title"].as_str().unwrap_or(""),
                e["content"].as_str().unwrap_or(""),
                e["tags"].as_str().unwrap_or("[]"),
                e["importance"].as_i64().unwrap_or(5),
                e["createdAt"].as_str().unwrap_or(""),
                e["triggerMessage"].as_str().unwrap_or(""),
                e["deletedAt"].as_str().unwrap_or(""),
            ],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn clear_deleted_memory_entries(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM deleted_memory_entries", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_platforms(app: AppHandle) -> Result<Vec<DbPlatform>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, display_name, base_url, api_key, enabled, is_default FROM platforms ORDER BY id")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DbPlatform {
                id: row.get(0)?,
                display_name: row.get(1)?,
                base_url: row.get(2)?,
                api_key: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
                is_default: row.get::<_, i64>(5)? != 0,
                models: vec![],
            })
        })
        .map_err(|e| e.to_string())?;

    let mut platforms: Vec<DbPlatform> = rows.filter_map(|r| r.ok()).collect();

    // 解密 api_key（与前端透明，兼容旧明文数据）
    let decrypt_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    for p in &mut platforms {
        p.api_key = decrypt_api_key(&p.api_key, &decrypt_dir);
    }

    // 批量查询所有 models，按 platform_id 分组，避免 N+1 查询
    let mut stmt = db
        .prepare("SELECT id, platform_id, name, type, enabled, pinned, enabled_types FROM models ORDER BY platform_id, id")
        .map_err(|e| e.to_string())?;
    let model_rows = stmt
        .query_map([], |row| {
            let enabled_types_str: String = row.get(6)?;
            let enabled_types: Vec<String> =
                serde_json::from_str(&enabled_types_str).unwrap_or_default();
            Ok(DbModel {
                id: row.get(0)?,
                platform_id: row.get(1)?,
                name: row.get(2)?,
                model_type: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
                pinned: row.get::<_, i64>(5)? != 0,
                enabled_types,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut models_by_platform: HashMap<i64, Vec<DbModel>> = HashMap::new();
    for m in model_rows.filter_map(|r| r.ok()) {
        models_by_platform.entry(m.platform_id).or_default().push(m);
    }
    for p in &mut platforms {
        p.models = models_by_platform.remove(&p.id).unwrap_or_default();
    }

    Ok(platforms)
}

#[tauri::command]
pub fn save_platforms(app: AppHandle, platforms: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let encrypt_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM models", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM platforms", []).map_err(|e| e.to_string())?;

    for p in &platforms {
        let display_name = p["displayName"].as_str().unwrap_or("");
        let base_url = p["baseUrl"].as_str().unwrap_or("");
        let api_key_raw = p["apiKey"].as_str().unwrap_or("");
        let api_key = encrypt_api_key(api_key_raw, &encrypt_dir);
        let enabled = if p["enabled"].as_bool().unwrap_or(false) { 1 } else { 0 };
        let is_default = if p["isDefault"].as_bool().unwrap_or(false) { 1 } else { 0 };

        db.execute(
            "INSERT INTO platforms (display_name, base_url, api_key, enabled, is_default) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![display_name, base_url, api_key, enabled, is_default],
        ).map_err(|e| e.to_string())?;

        let platform_id = db.last_insert_rowid();

        if let Some(models) = p["models"].as_array() {
            for m in models {
                let name = m["name"].as_str().unwrap_or("");
                let model_type = m["type"].as_str().unwrap_or("chat");
                let m_enabled = if m["enabled"].as_bool().unwrap_or(false) { 1 } else { 0 };
                let pinned = if m["pinned"].as_bool().unwrap_or(false) { 1 } else { 0 };
                let enabled_types = serde_json::to_string(
                    &m["enabledTypes"].as_array().cloned().unwrap_or_default(),
                )
                .unwrap_or_else(|_| "[]".to_string());

                db.execute(
                    "INSERT INTO models (platform_id, name, type, enabled, pinned, enabled_types) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![platform_id, name, model_type, m_enabled, pinned, enabled_types],
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_conversations(app: AppHandle) -> Result<Vec<DbConversation>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, title, character_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DbConversation {
                id: row.get(0)?,
                title: row.get(1)?,
                character_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                messages: vec![],
            })
        })
        .map_err(|e| e.to_string())?;

    let mut conversations: Vec<DbConversation> = rows.filter_map(|r| r.ok()).collect();

    // 批量查询所有消息，按 conversation_id 分组，避免 N+1 查询
    let mut stmt = db
        .prepare("SELECT id, conversation_id, content, sender, timestamp, emotion, emotion_intensity, attachments, recalled, recalled_at FROM messages ORDER BY conversation_id, timestamp")
        .map_err(|e| e.to_string())?;
    let msg_rows = stmt
        .query_map([], |row| {
            Ok(DbMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                content: row.get(2)?,
                sender: row.get(3)?,
                timestamp: row.get(4)?,
                emotion: row.get(5)?,
                emotion_intensity: row.get(6)?,
                attachments: row.get(7)?,
                recalled: row.get::<_, i32>(8)? != 0,
                recalled_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut messages_by_conv: HashMap<String, Vec<DbMessage>> = HashMap::new();
    for m in msg_rows.filter_map(|r| r.ok()) {
        messages_by_conv.entry(m.conversation_id.clone()).or_default().push(m);
    }
    for c in &mut conversations {
        c.messages = messages_by_conv.remove(&c.id).unwrap_or_default();
    }

    Ok(conversations)
}

/// 服务端分页获取会话列表（不含消息），按 updated_at DESC 排序，游标分页，每页 20 条
#[tauri::command]
pub fn get_conversations_page(
    app: AppHandle,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let page_size = limit.unwrap_or(20).min(100) as i64;

    // 游标分页：cursor 为上一页最后一条的 (updated_at, id)，用于稳定排序。
    // 注意：两种分支的占位符编号必须与实际绑定的参数个数一致——此前共用 `LIMIT ?3`，
    // 首页（无游标）只绑定 1 个参数，rusqlite 报参数数量错误，首页查询必然失败。
    let cursor_str = cursor.as_deref();
    let (sql, has_cursor): (&str, bool) = match cursor_str {
        Some(c) if c.splitn(2, '|').count() == 2 => {
            (
                "SELECT id, title, character_id, created_at, updated_at FROM conversations
                 WHERE (updated_at < ?1 OR (updated_at = ?1 AND id < ?2))
                 ORDER BY updated_at DESC, id DESC LIMIT ?3",
                true,
            )
        }
        _ => {
            (
                "SELECT id, title, character_id, created_at, updated_at FROM conversations
                 ORDER BY updated_at DESC, id DESC LIMIT ?1",
                false,
            )
        }
    };

    // 🆕 多取一条用于判断 has_more（原实现 LIMIT page_size 后判 len > page_size，永远为 false，
    //    导致侧边栏会话列表最多只显示 20 条、"加载更多"永不出现）
    let mut stmt = db.prepare(sql).map_err(|e| e.to_string())?;
    let mut rows = if has_cursor {
        let parts: Vec<&str> = cursor_str.unwrap_or("").splitn(2, '|').collect();
        stmt.query(params![parts[0], parts[1], page_size + 1])
            .map_err(|e| e.to_string())?
    } else {
        stmt.query(params![page_size + 1]).map_err(|e| e.to_string())?
    };

    let mut conversations: Vec<DbConversation> = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        conversations.push(DbConversation {
            id: row.get(0).map_err(|e| e.to_string())?,
            title: row.get(1).map_err(|e| e.to_string())?,
            character_id: row.get(2).map_err(|e| e.to_string())?,
            created_at: row.get(3).map_err(|e| e.to_string())?,
            updated_at: row.get(4).map_err(|e| e.to_string())?,
            messages: vec![],
        });
    }

    let has_more = conversations.len() as i64 > page_size;
    if has_more {
        conversations.truncate(page_size as usize);
    }

    let next_cursor = conversations
        .last()
        .map(|c| format!("{}|{}", c.updated_at, c.id));

    Ok(serde_json::json!({
        "conversations": conversations,
        "nextCursor": if has_more { next_cursor } else { None },
        "hasMore": has_more,
    }))
}

/// 按需加载单个会话的全部消息（按 timestamp 排序）
#[tauri::command]
pub fn get_conversation_messages(
    app: AppHandle,
    conversation_id: String,
) -> Result<Vec<DbMessage>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, conversation_id, content, sender, timestamp, emotion, emotion_intensity, attachments, recalled, recalled_at FROM messages WHERE conversation_id = ?1 ORDER BY timestamp")
        .map_err(|e| e.to_string())?;
    let msg_rows = stmt
        .query_map(params![conversation_id], |row| {
            Ok(DbMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                content: row.get(2)?,
                sender: row.get(3)?,
                timestamp: row.get(4)?,
                emotion: row.get(5)?,
                emotion_intensity: row.get(6)?,
                attachments: row.get(7)?,
                recalled: row.get::<_, i32>(8)? != 0,
                recalled_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(msg_rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_conversations(app: AppHandle, conversations: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM messages", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM conversations", []).map_err(|e| e.to_string())?;

    for c in &conversations {
        let id = c["id"].as_str().unwrap_or("");
        let title = c["title"].as_str().unwrap_or("");
        let character_id = c["characterId"].as_str().unwrap_or("");
        let created_at = c["createdAt"].as_str().unwrap_or("");
        let updated_at = c["updatedAt"].as_str().unwrap_or("");

        db.execute(
            "INSERT INTO conversations (id, title, character_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, title, character_id, created_at, updated_at],
        ).map_err(|e| e.to_string())?;

        if let Some(messages) = c["messages"].as_array() {
            for m in messages {
                let msg_id = m["id"].as_str().unwrap_or("");
                let content = m["content"].as_str().unwrap_or("");
                let sender = m["sender"].as_str().unwrap_or("user");
                let timestamp = m["timestamp"].as_str().unwrap_or("");
                let emotion = m["emotion"].as_str().map(|s| s.to_string());
                let emotion_intensity = m["emotionIntensity"].as_f64();
                let attachments = m.get("attachments").and_then(|v| {
                    if v.is_null() || !v.is_array() || v.as_array().map_or(true, |a| a.is_empty()) {
                        None
                    } else {
                        Some(v.to_string())
                    }
                });
                let recalled = m["recalled"].as_bool().unwrap_or(false);
                let recalled_at = m["recalledAt"].as_str().map(|s| s.to_string());

                db.execute(
                    "INSERT INTO messages (id, conversation_id, content, sender, timestamp, emotion, emotion_intensity, attachments, recalled, recalled_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![msg_id, id, content, sender, timestamp, emotion, emotion_intensity, attachments, recalled as i32, recalled_at],
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn save_conversation(app: AppHandle, conversation: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let id = conversation["id"].as_str().unwrap_or("");
    let title = conversation["title"].as_str().unwrap_or("");
    let character_id = conversation["characterId"].as_str().unwrap_or("");
    let created_at = conversation["createdAt"].as_str().unwrap_or("");
    let updated_at = conversation["updatedAt"].as_str().unwrap_or("");

    db.execute(
        "INSERT INTO conversations (id, title, character_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, character_id=excluded.character_id, created_at=excluded.created_at, updated_at=excluded.updated_at",
        params![id, title, character_id, created_at, updated_at],
    ).map_err(|e| e.to_string())?;

    db.execute("DELETE FROM messages WHERE conversation_id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    if let Some(messages) = conversation["messages"].as_array() {
        for m in messages {
            let msg_id = m["id"].as_str().unwrap_or("");
            let content = m["content"].as_str().unwrap_or("");
            let sender = m["sender"].as_str().unwrap_or("user");
            let timestamp = m["timestamp"].as_str().unwrap_or("");
            let emotion = m["emotion"].as_str().map(|s| s.to_string());
            let emotion_intensity = m["emotionIntensity"].as_f64();
            let attachments = m.get("attachments").and_then(|v| {
                if v.is_null() || !v.is_array() || v.as_array().map_or(true, |a| a.is_empty()) {
                    None
                } else {
                    Some(v.to_string())
                }
            });
            let recalled = m["recalled"].as_bool().unwrap_or(false);
            let recalled_at = m["recalledAt"].as_str().map(|s| s.to_string());

            db.execute(
                "INSERT INTO messages (id, conversation_id, content, sender, timestamp, emotion, emotion_intensity, attachments, recalled, recalled_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![msg_id, id, content, sender, timestamp, emotion, emotion_intensity, attachments, recalled as i32, recalled_at],
            ).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn delete_conversation(app: AppHandle, conversation_id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM messages WHERE conversation_id = ?1", params![conversation_id])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM conversations WHERE id = ?1", params![conversation_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 🆕 清理僵尸会话（重复判定口径）：只删除「没有任何用户消息、且同一角色下存在
///    完全相同消息内容副本」的会话——每个重复组保留最近更新的一个，其余删除。
///    不按时间删除：没有副本的空会话（用户新建还没说话）永远保留；
///    有任何用户消息的会话永远不动。
///    返回删除的会话数量。
#[tauri::command]
pub fn cleanup_zombie_conversations(app: AppHandle) -> Result<i64, String> {
    use std::collections::HashMap;
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    // 1) 每个会话的消息内容签名（sender:content 按行拼接，忽略时间戳）+ 是否有用户消息
    let mut sig_map: HashMap<String, String> = HashMap::new();
    let mut has_user: HashMap<String, bool> = HashMap::new();
    {
        let mut stmt = db.prepare(
            "SELECT conversation_id, sender, content FROM messages ORDER BY conversation_id, rowid",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        }).map_err(|e| e.to_string())?;
        for row in rows.filter_map(|r| r.ok()) {
            let (cid, sender, content) = row;
            let entry = sig_map.entry(cid.clone()).or_default();
            entry.push_str(&sender);
            entry.push(':');
            entry.push_str(content.replace('\n', " ").as_str());
            entry.push('\n');
            if sender == "user" {
                has_user.insert(cid, true);
            }
        }
    }

    // 2) 收集会话 (id, character_id, updated_at)，按 (character_id, 签名) 分组，
    //    组内成员 ≥2 且全部无用户消息 → 保留最近更新的一个，其余标记为僵尸
    struct ConvRow { id: String, character_id: String, updated_at: String }
    let convs: Vec<ConvRow> = {
        let mut stmt = db.prepare("SELECT id, character_id, updated_at FROM conversations").map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((
            r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?,
        ))).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok())
            .map(|(id, character_id, updated_at)| ConvRow { id, character_id, updated_at })
            .collect()
    };

    let mut groups: HashMap<(String, String), Vec<&ConvRow>> = HashMap::new();
    for c in &convs {
        if has_user.contains_key(&c.id) { continue; } // 有用户消息的会话永不清理
        let sig = sig_map.get(&c.id).cloned().unwrap_or_default();
        groups.entry((c.character_id.clone(), sig)).or_default().push(c);
    }

    let zombie_ids: Vec<String> = groups.values()
        .filter_map(|members| {
            if members.len() < 2 { return None; }
            // 保留 updated_at 最新的一个
            let keep = members.iter().max_by_key(|c| &c.updated_at).map(|c| &c.id);
            Some(members.iter().filter(|c| Some(&c.id) != keep).map(|c| c.id.clone()).collect::<Vec<_>>())
        })
        .flatten()
        .collect();

    let count = zombie_ids.len() as i64;
    if count == 0 {
        return Ok(0);
    }

    for id in &zombie_ids {
        db.execute("DELETE FROM messages WHERE conversation_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        db.execute("DELETE FROM conversations WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
    }
    log::info!("[Cleanup] Removed {} duplicate unused conversations (kept newest of each group)", count);
    Ok(count)
}

/// 🆕 清理过期运行日志：删除早于保留天数（默认 7 天）的 debug_logs，防止无限累积。
///    返回删除的条数。
#[tauri::command]
pub fn prune_debug_logs(app: AppHandle, keep_days: Option<i64>) -> Result<i64, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let days = keep_days.unwrap_or(7).clamp(1, 365);
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days))
        .to_rfc3339();

    let deleted = db
        .execute("DELETE FROM debug_logs WHERE timestamp < ?1", params![cutoff])
        .map_err(|e| e.to_string())?;
    if deleted > 0 {
        log::info!("[Cleanup] Pruned {} debug logs older than {} days", deleted, days);
    }
    Ok(deleted as i64)
}

#[tauri::command]
pub fn clear_all_data(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM messages", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM conversations", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM emotion_records", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM memories", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM reflections", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM debug_logs", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM character_emotions", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM character_affinities", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM deleted_memory_entries", []).map_err(|e| e.to_string())?;
    // 🆕 修复"全部删除清不掉记忆模块"：V2 双层记忆存于 memory_entries 表，
    //    此前仅清了旧版 memories/reflections，导致清除后 V2 记忆仍全部保留。
    db.execute("DELETE FROM memory_entries", []).map_err(|e| e.to_string())?;
    // 🆕 AI 一日全部业务数据一并清除（活动/日记/配置/属性/库存/经济/交易/事件/提案）
    db.execute("DELETE FROM ai_activities", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_diaries", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_life_config", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_attribute_snapshots", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_inventory_items", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_economy", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_transactions", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_life_events", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_content_proposals", []).map_err(|e| e.to_string())?;
    // 🆕 多模态附件一并清除（含 files 与 files_blob 双份存储）
    db.execute("DELETE FROM files", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM files_blob", []).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn clear_conversations(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM messages", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM conversations", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_emotion_records(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM emotion_records", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_memories(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM memories", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_reflections(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM reflections", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_memory_entries(app: AppHandle, character_id: String) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT id, character_id, conversation_id, category, title, content, tags, importance, created_at, trigger_message FROM memory_entries WHERE character_id = ?1 ORDER BY importance DESC, created_at DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![character_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "characterId": row.get::<_, String>(1)?,
                "conversationId": row.get::<_, String>(2)?,
                "category": row.get::<_, String>(3)?,
                "title": row.get::<_, String>(4)?,
                "content": row.get::<_, String>(5)?,
                "tags": row.get::<_, String>(6)?,
                "importance": row.get::<_, i64>(7)?,
                "createdAt": row.get::<_, String>(8)?,
                "triggerMessage": row.get::<_, String>(9).unwrap_or_default(),
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn search_memory_entries(app: AppHandle, character_id: String, query: String) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let search_pattern = format!("%{}%", query);
    let mut stmt = db
        .prepare(
            "SELECT id, character_id, conversation_id, category, title, content, tags, importance, created_at, trigger_message FROM memory_entries WHERE character_id = ?1 AND (title LIKE ?2 OR content LIKE ?2 OR tags LIKE ?2 OR trigger_message LIKE ?2) ORDER BY importance DESC, created_at DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![character_id, search_pattern], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "characterId": row.get::<_, String>(1)?,
                "conversationId": row.get::<_, String>(2)?,
                "category": row.get::<_, String>(3)?,
                "title": row.get::<_, String>(4)?,
                "content": row.get::<_, String>(5)?,
                "tags": row.get::<_, String>(6)?,
                "importance": row.get::<_, i64>(7)?,
                "createdAt": row.get::<_, String>(8)?,
                "triggerMessage": row.get::<_, String>(9).unwrap_or_default(),
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_memory_entries(app: AppHandle, entries: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;

    for e in &entries {
        let created_at = e["createdAt"].as_str().unwrap_or("");
        let trigger_message = e["triggerMessage"].as_str().unwrap_or("");
        tx.execute(
            "INSERT OR REPLACE INTO memory_entries (id, character_id, conversation_id, category, title, content, tags, importance, created_at, trigger_message) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                e["id"].as_str().unwrap_or(""),
                e["characterId"].as_str().unwrap_or(""),
                e["conversationId"].as_str().unwrap_or(""),
                e["category"].as_str().unwrap_or("summary"),
                e["title"].as_str().unwrap_or(""),
                e["content"].as_str().unwrap_or(""),
                e["tags"].as_str().unwrap_or("[]"),
                e["importance"].as_i64().unwrap_or(5),
                created_at,
                trigger_message,
            ],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_memory_entry(app: AppHandle, entry_id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM memory_entries WHERE id = ?1", params![entry_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_memory_entries(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM memory_entries", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_emotion_records(app: AppHandle) -> Result<Vec<DbEmotionRecord>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, emotion, intensity, timestamp, context, character_id FROM emotion_records ORDER BY timestamp DESC LIMIT 5000")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DbEmotionRecord {
                id: row.get(0)?,
                emotion: row.get(1)?,
                intensity: row.get(2)?,
                timestamp: row.get(3)?,
                context: row.get(4)?,
                character_id: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_emotion_records(app: AppHandle, records: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;

    for r in &records {
        let id = r["id"].as_str().unwrap_or("");
        let emotion = r["emotion"].as_str().unwrap_or("neutral");
        let intensity = r["intensity"].as_f64().unwrap_or(0.0);
        let timestamp = r["timestamp"].as_str().unwrap_or("");
        let context = r["context"].as_str().unwrap_or("");
        let character_id = r["character_id"].as_str().map(|s| s.to_string());

        tx.execute(
            "INSERT OR REPLACE INTO emotion_records (id, emotion, intensity, timestamp, context, character_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, emotion, intensity, timestamp, context, character_id],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn migrate_from_local_storage(
    app: AppHandle,
    config_json: String,
    conversations_json: String,
    emotion_records_json: String,
) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let platforms: Vec<Value> =
        serde_json::from_str(&config_json).unwrap_or_default();
    if !platforms.is_empty() {
        for p in &platforms {
            let display_name = p["displayName"].as_str().unwrap_or("");
            let base_url = p["baseUrl"].as_str().unwrap_or("");
            let api_key = p["apiKey"].as_str().unwrap_or("");
            let enabled = if p["enabled"].as_bool().unwrap_or(false) { 1 } else { 0 };
            let is_default = if p["isDefault"].as_bool().unwrap_or(false) { 1 } else { 0 };

            db.execute(
                "INSERT INTO platforms (display_name, base_url, api_key, enabled, is_default) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![display_name, base_url, api_key, enabled, is_default],
            ).map_err(|e| e.to_string())?;

            let platform_id = db.last_insert_rowid();

            if let Some(models) = p["models"].as_array() {
                for m in models {
                    let name = m["name"].as_str().unwrap_or("");
                    let model_type = m["type"].as_str().unwrap_or("chat");
                    let m_enabled = if m["enabled"].as_bool().unwrap_or(false) { 1 } else { 0 };
                    let pinned = if m["pinned"].as_bool().unwrap_or(false) { 1 } else { 0 };
                    let enabled_types = serde_json::to_string(
                        &m["enabledTypes"].as_array().cloned().unwrap_or_default(),
                    )
                    .unwrap_or_else(|_| "[]".to_string());

                    db.execute(
                        "INSERT INTO models (platform_id, name, type, enabled, pinned, enabled_types) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        params![platform_id, name, model_type, m_enabled, pinned, enabled_types],
                    ).map_err(|e| e.to_string())?;
                }
            }
        }
    }

    let conversations: Vec<Value> =
        serde_json::from_str(&conversations_json).unwrap_or_default();
    for c in &conversations {
        let id = c["id"].as_str().unwrap_or("");
        let title = c["title"].as_str().unwrap_or("");
        let character_id = c["characterId"].as_str().unwrap_or("");
        let created_at = c["createdAt"].as_str().unwrap_or("");
        let updated_at = c["updatedAt"].as_str().unwrap_or("");

        db.execute(
            "INSERT OR IGNORE INTO conversations (id, title, character_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, title, character_id, created_at, updated_at],
        ).map_err(|e| e.to_string())?;

        if let Some(messages) = c["messages"].as_array() {
            for m in messages {
                let msg_id = m["id"].as_str().unwrap_or("");
                let content = m["content"].as_str().unwrap_or("");
                let sender = m["sender"].as_str().unwrap_or("user");
                let timestamp = m["timestamp"].as_str().unwrap_or("");
                let emotion = m["emotion"].as_str().map(|s| s.to_string());
                let emotion_intensity = m["emotionIntensity"].as_f64();
                let attachments = m.get("attachments").and_then(|v| {
                    if v.is_null() || !v.is_array() || v.as_array().map_or(true, |a| a.is_empty()) {
                        None
                    } else {
                        Some(v.to_string())
                    }
                });

                db.execute(
                    "INSERT OR IGNORE INTO messages (id, conversation_id, content, sender, timestamp, emotion, emotion_intensity, attachments) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![msg_id, id, content, sender, timestamp, emotion, emotion_intensity, attachments],
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    let emotion_records: Vec<Value> =
        serde_json::from_str(&emotion_records_json).unwrap_or_default();
    for r in &emotion_records {
        let id = r["id"].as_str().unwrap_or("");
        let emotion = r["emotion"].as_str().unwrap_or("neutral");
        let intensity = r["intensity"].as_f64().unwrap_or(0.0);
        let timestamp = r["timestamp"].as_str().unwrap_or("");
        let context = r["context"].as_str().unwrap_or("");

        db.execute(
            "INSERT OR IGNORE INTO emotion_records (id, emotion, intensity, timestamp, context) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, emotion, intensity, timestamp, context],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_characters(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT id, name, avatar, personality, description, tags, greeting_message, background, likes, dislikes, habits, catchphrases, emotion_triggers, emotion_expressions, thinking_style, relationship_stages, response_style, identity_anchors, forbidden_behaviors, output_format, memory_importance_threshold, reflection_enabled, time_awareness_enabled, timezone FROM characters ORDER BY rowid",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "avatar": row.get::<_, String>(2)?,
                "personality": row.get::<_, String>(3)?,
                "description": row.get::<_, String>(4)?,
                "tags": row.get::<_, String>(5)?,
                "greeting_message": row.get::<_, String>(6)?,
                "background": row.get::<_, String>(7)?,
                "likes": row.get::<_, String>(8)?,
                "dislikes": row.get::<_, String>(9)?,
                "habits": row.get::<_, String>(10)?,
                "catchphrases": row.get::<_, String>(11)?,
                "emotion_triggers": row.get::<_, String>(12)?,
                "emotion_expressions": row.get::<_, String>(13)?,
                "thinking_style": row.get::<_, String>(14)?,
                "relationship_stages": row.get::<_, String>(15)?,
                "response_style": row.get::<_, String>(16)?,
                "identity_anchors": row.get::<_, String>(17)?,
                "forbidden_behaviors": row.get::<_, String>(18)?,
                "output_format": row.get::<_, String>(19)?,
                "memory_importance_threshold": row.get::<_, i64>(20)?,
                "reflection_enabled": row.get::<_, i64>(21)? != 0,
                "time_awareness_enabled": row.get::<_, i64>(22)? != 0,
                "timezone": row.get::<_, String>(23)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_characters(app: AppHandle, characters: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM characters", [])
        .map_err(|e| e.to_string())?;

    for c in &characters {
        db.execute(
            "INSERT INTO characters (id, name, avatar, personality, description, tags, greeting_message, background, likes, dislikes, habits, catchphrases, emotion_triggers, emotion_expressions, thinking_style, relationship_stages, response_style, identity_anchors, forbidden_behaviors, output_format, memory_importance_threshold, reflection_enabled, time_awareness_enabled, timezone) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)",
            params![
                c["id"].as_str().unwrap_or(""),
                c["name"].as_str().unwrap_or(""),
                c["avatar"].as_str().unwrap_or(""),
                c["personality"].as_str().unwrap_or(""),
                c["description"].as_str().unwrap_or(""),
                c["tags"].as_str().unwrap_or("[]"),
                c["greetingMessage"].as_str().unwrap_or(""),
                c["background"].as_str().unwrap_or(""),
                c["likes"].as_str().unwrap_or("[]"),
                c["dislikes"].as_str().unwrap_or("[]"),
                c["habits"].as_str().unwrap_or("[]"),
                c["catchphrases"].as_str().unwrap_or("[]"),
                c["emotionTriggers"].as_str().unwrap_or(""),
                c["emotionExpressions"].as_str().unwrap_or(""),
                c["thinkingStyle"].as_str().unwrap_or(""),
                c["relationshipStages"].as_str().unwrap_or(""),
                c["responseStyle"].as_str().unwrap_or(""),
                c["identityAnchors"].as_str().unwrap_or(""),
                c["forbiddenBehaviors"].as_str().unwrap_or(""),
                c["outputFormat"].as_str().unwrap_or(""),
                c["memoryImportanceThreshold"].as_i64().unwrap_or(5),
                if c["reflectionEnabled"].as_bool().unwrap_or(true) { 1 } else { 0 },
                if c["timeAwarenessEnabled"].as_bool().unwrap_or(true) { 1 } else { 0 },
                c["timezone"].as_str().unwrap_or(""),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn delete_character(app: AppHandle, character_id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM memories WHERE character_id = ?1", params![character_id])
        .map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM reflections WHERE character_id = ?1",
        params![character_id],
    )
    .map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM characters WHERE id = ?1",
        params![character_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_memories(app: AppHandle, character_id: String) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT id, character_id, conversation_id, content, importance, tags, created_at, last_recalled_at, recall_count FROM memories WHERE character_id = ?1 ORDER BY importance DESC, created_at DESC LIMIT 5000",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![character_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "character_id": row.get::<_, String>(1)?,
                "conversation_id": row.get::<_, String>(2)?,
                "content": row.get::<_, String>(3)?,
                "importance": row.get::<_, i64>(4)?,
                "tags": row.get::<_, String>(5)?,
                "created_at": row.get::<_, String>(6)?,
                "last_recalled_at": row.get::<_, Option<String>>(7)?,
                "recall_count": row.get::<_, i64>(8)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_memories(app: AppHandle, memories: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;

    for m in &memories {
        let created_at = m["createdAt"].as_str().unwrap_or("");
        let last_recalled_at = m["lastRecalledAt"].as_str();
        tx.execute(
            "INSERT OR REPLACE INTO memories (id, character_id, conversation_id, content, importance, tags, created_at, last_recalled_at, recall_count) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                m["id"].as_str().unwrap_or(""),
                m["characterId"].as_str().unwrap_or(""),
                m["conversationId"].as_str().unwrap_or(""),
                m["content"].as_str().unwrap_or(""),
                m["importance"].as_i64().unwrap_or(5),
                m["tags"].as_str().unwrap_or("[]"),
                created_at,
                last_recalled_at,
                m["recallCount"].as_i64().unwrap_or(0),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_reflections(app: AppHandle, character_id: String) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT id, character_id, trigger_text, insight, emotion_before, emotion_after, created_at FROM reflections WHERE character_id = ?1 ORDER BY created_at DESC LIMIT 500",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![character_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "character_id": row.get::<_, String>(1)?,
                "trigger": row.get::<_, String>(2)?,
                "insight": row.get::<_, String>(3)?,
                "emotion_before": row.get::<_, String>(4)?,
                "emotion_after": row.get::<_, String>(5)?,
                "created_at": row.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_reflections(app: AppHandle, reflections: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;

    for r in &reflections {
        tx.execute(
            "INSERT OR REPLACE INTO reflections (id, character_id, trigger_text, insight, emotion_before, emotion_after, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![
                r["id"].as_str().unwrap_or(""),
                r["characterId"].as_str().unwrap_or(""),
                r["trigger"].as_str().unwrap_or(""),
                r["insight"].as_str().unwrap_or(""),
                r["emotionBefore"].as_str().unwrap_or("neutral"),
                r["emotionAfter"].as_str().unwrap_or("neutral"),
                r["createdAt"].as_str().unwrap_or(""),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

// ========== UI Config ==========

#[tauri::command]
pub fn get_ui_config(app: AppHandle) -> Result<Option<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT config_json FROM ui_config WHERE id = 'default'")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query_map([], |row| {
        row.get::<_, String>(0)
    }).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next() {
        let json_str = row.map_err(|e| e.to_string())?;
        let config: Value = serde_json::from_str(&json_str).unwrap_or(Value::Object(serde_json::Map::new()));
        Ok(Some(config))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn save_ui_config(app: AppHandle, config: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let json_str = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    db.execute(
        "INSERT OR REPLACE INTO ui_config (id, config_json) VALUES ('default', ?1)",
        params![json_str],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// ========== Model Roles ==========

#[tauri::command]
pub fn get_model_roles(app: AppHandle) -> Result<Option<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, config_json FROM model_roles LIMIT 1")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;

    if let Some(row) = rows.next() {
        let json_str = row.map_err(|e| e.to_string())?;
        let config: Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
        Ok(Some(config))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn save_model_roles(app: AppHandle, config: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM model_roles", []).map_err(|e| e.to_string())?;

    let json_str = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO model_roles (id, config_json) VALUES (?1, ?2)",
        params!["default", json_str],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// ========== File Picker ==========

#[tauri::command]
pub async fn pick_files(accept: Vec<String>) -> Result<Vec<Value>, String> {
    let mut dialog = rfd::FileDialog::new()
        .set_title("选择文件");

    let mut filters: Vec<(&str, Vec<&str>)> = Vec::new();
    for pattern in &accept {
        match pattern.as_str() {
            "image/*" => filters.push(("Images", vec!["png", "jpg", "jpeg", "gif", "webp", "bmp"])),
            "video/*" => filters.push(("Videos", vec!["mp4", "webm", "ogg", "mov"])),
            "application/pdf" => filters.push(("PDF", vec!["pdf"])),
            "text/*" => filters.push(("Text", vec!["txt", "md", "json", "csv"])),
            _ => {}
        }
    }
    for (name, exts) in &filters {
        dialog = dialog.add_filter(*name, exts);
    }

    let result = dialog.pick_files();

    let mut files = Vec::new();
    if let Some(paths) = result {
        for path in paths {
            let path_str = path.to_string_lossy().to_string();
            let metadata = std::fs::metadata(&path_str).ok();
            let size = metadata.map(|m| m.len()).unwrap_or(0);
            let name = path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let ext = path.extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let mime = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "bmp" => "image/bmp",
                "mp4" => "video/mp4",
                "webm" => "video/webm",
                "ogg" => "video/ogg",
                "mov" => "video/quicktime",
                "pdf" => "application/pdf",
                _ => "application/octet-stream",
            };
            files.push(serde_json::json!({
                "name": name,
                "path": path_str,
                "size": size,
                "mimeType": mime,
            }));
        }
    }
    Ok(files)
}

// ========== Cursor-based Pagination ==========

#[tauri::command]
pub fn get_memory_entries_page(
    app: AppHandle,
    character_id: Option<String>,
    category: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<Value, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let page_size = limit.unwrap_or(30);

    let mut sql = String::from(
        "SELECT id, character_id, conversation_id, category, title, content, tags, importance, created_at, trigger_message FROM memory_entries WHERE 1=1"
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref cid) = character_id {
        sql.push_str(" AND character_id = ?");
        param_values.push(Box::new(cid.clone()));
    }
    if let Some(ref cat) = category {
        sql.push_str(" AND category = ?");
        param_values.push(Box::new(cat.clone()));
    }
    if let Some(ref df) = date_from {
        sql.push_str(" AND created_at >= ?");
        param_values.push(Box::new(df.clone()));
    }
    if let Some(ref dt) = date_to {
        sql.push_str(" AND created_at < ?");
        param_values.push(Box::new(dt.clone()));
    }
    if let Some(ref cur) = cursor {
        sql.push_str(" AND created_at < (SELECT created_at FROM memory_entries WHERE id = ?)");
        param_values.push(Box::new(cur.clone()));
    }

    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    param_values.push(Box::new((page_size + 1) as i64));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "characterId": row.get::<_, String>(1)?,
            "conversationId": row.get::<_, String>(2)?,
            "category": row.get::<_, String>(3)?,
            "title": row.get::<_, String>(4)?,
            "content": row.get::<_, String>(5)?,
            "tags": row.get::<_, String>(6)?,
            "importance": row.get::<_, i64>(7)?,
            "createdAt": row.get::<_, String>(8)?,
            "triggerMessage": row.get::<_, String>(9).unwrap_or_default(),
        }))
    }).map_err(|e| e.to_string())?;

    let all_rows: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    let has_more = all_rows.len() > page_size;
    let entries: Vec<Value> = if has_more { all_rows[..page_size].to_vec() } else { all_rows };
    let next_cursor = if has_more { entries.last().and_then(|e| e["id"].as_str()).map(|s| s.to_string()) } else { None };

    Ok(serde_json::json!({
        "entries": entries,
        "nextCursor": next_cursor,
        "hasMore": has_more,
    }))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn get_debug_logs_page(
    app: AppHandle,
    character_id: Option<String>,
    log_type: Option<String>,
    conversation_id: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<Value, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let page_size = limit.unwrap_or(2000);

    let mut sql = String::from(
        "SELECT id, type, message, timestamp, character_id, conversation_id, duration FROM debug_logs WHERE 1=1"
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref cid) = character_id {
        sql.push_str(" AND character_id = ?");
        param_values.push(Box::new(cid.clone()));
    }
    if let Some(ref lt) = log_type {
        sql.push_str(" AND type = ?");
        param_values.push(Box::new(lt.clone()));
    }
    if let Some(ref conv_id) = conversation_id {
        sql.push_str(" AND conversation_id = ?");
        param_values.push(Box::new(conv_id.clone()));
    }
    if let Some(ref df) = date_from {
        sql.push_str(" AND timestamp >= ?");
        param_values.push(Box::new(df.clone()));
    }
    if let Some(ref dt) = date_to {
        sql.push_str(" AND timestamp < ?");
        param_values.push(Box::new(dt.clone()));
    }
    if let Some(ref cur) = cursor {
        sql.push_str(" AND timestamp < (SELECT timestamp FROM debug_logs WHERE id = ?)");
        param_values.push(Box::new(cur.clone()));
    }

    sql.push_str(" ORDER BY timestamp DESC LIMIT ?");
    param_values.push(Box::new((page_size + 1) as i64));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "type": row.get::<_, String>(1)?,
            "message": row.get::<_, String>(2)?,
            "timestamp": row.get::<_, String>(3)?,
            "characterId": row.get::<_, String>(4).unwrap_or_default(),
            "conversationId": row.get::<_, String>(5).unwrap_or_default(),
            "duration": row.get::<_, i64>(6).unwrap_or(0),
        }))
    }).map_err(|e| e.to_string())?;

    let all_rows: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    let has_more = all_rows.len() > page_size;
    let logs: Vec<Value> = if has_more { all_rows[..page_size].to_vec() } else { all_rows };
    let next_cursor = if has_more { logs.last().and_then(|e| e["id"].as_str()).map(|s| s.to_string()) } else { None };

    Ok(serde_json::json!({
        "logs": logs,
        "nextCursor": next_cursor,
        "hasMore": has_more,
    }))
}

#[tauri::command]
pub fn get_memory_entries_available_dates(
    app: AppHandle,
    character_id: Option<String>,
    category: Option<String>,
) -> Result<Vec<String>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT DISTINCT substr(created_at, 1, 10) AS d FROM memory_entries WHERE 1=1"
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref cid) = character_id {
        sql.push_str(" AND character_id = ?");
        param_values.push(Box::new(cid.clone()));
    }
    if let Some(ref cat) = category {
        sql.push_str(" AND category = ?");
        param_values.push(Box::new(cat.clone()));
    }

    sql.push_str(" ORDER BY d DESC");

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_ref.as_slice(), |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn get_debug_logs_available_dates(
    app: AppHandle,
    character_id: Option<String>,
    log_type: Option<String>,
    conversation_id: Option<String>,
) -> Result<Vec<String>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT DISTINCT substr(timestamp, 1, 10) AS d FROM debug_logs WHERE 1=1"
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref cid) = character_id {
        sql.push_str(" AND character_id = ?");
        param_values.push(Box::new(cid.clone()));
    }
    if let Some(ref lt) = log_type {
        sql.push_str(" AND type = ?");
        param_values.push(Box::new(lt.clone()));
    }
    if let Some(ref conv_id) = conversation_id {
        sql.push_str(" AND conversation_id = ?");
        param_values.push(Box::new(conv_id.clone()));
    }

    sql.push_str(" ORDER BY d DESC");

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_ref.as_slice(), |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn get_emotion_records_available_dates(
    app: AppHandle,
    character_id: Option<String>,
) -> Result<Vec<String>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    // emotion_records 表可能没有 character_id 列(从 schema 看到),安全起见不传参
    let mut stmt = db
        .prepare("SELECT DISTINCT substr(timestamp, 1, 10) AS d FROM emotion_records ORDER BY d DESC")
        .map_err(|e| e.to_string())?;
    let _ = character_id; // 暂未按角色过滤
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn get_debug_logs_count(
    app: AppHandle,
    character_id: Option<String>,
    log_type: Option<String>,
    conversation_id: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<i64, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let mut sql = String::from("SELECT COUNT(*) FROM debug_logs WHERE 1=1");
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref cid) = character_id {
        sql.push_str(" AND character_id = ?");
        param_values.push(Box::new(cid.clone()));
    }
    if let Some(ref lt) = log_type {
        sql.push_str(" AND type = ?");
        param_values.push(Box::new(lt.clone()));
    }
    if let Some(ref conv_id) = conversation_id {
        sql.push_str(" AND conversation_id = ?");
        param_values.push(Box::new(conv_id.clone()));
    }
    if let Some(ref df) = date_from {
        sql.push_str(" AND timestamp >= ?");
        param_values.push(Box::new(df.clone()));
    }
    if let Some(ref dt) = date_to {
        sql.push_str(" AND timestamp < ?");
        param_values.push(Box::new(dt.clone()));
    }

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let count: i64 = db
        .prepare(&sql)
        .map_err(|e| e.to_string())?
        .query_row(params_ref.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(count)
}

#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    use std::fs;
    let data = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

// ========== File DB CRUD ==========

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn save_file_to_db(
    app: AppHandle,
    id: String,
    filename: String,
    mime_type: String,
    data: String,
    size: i64,
    character_id: Option<String>,
    conversation_id: Option<String>,
) -> Result<String, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute(
        "CREATE TABLE IF NOT EXISTS files (
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
    ).map_err(|e| e.to_string())?;

    // Migration: add character_id if missing (old schema)
    let _ = db.execute("ALTER TABLE files ADD COLUMN character_id TEXT DEFAULT ''", []);
    let _ = db.execute("ALTER TABLE files ADD COLUMN conversation_id TEXT DEFAULT ''", []);

    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    // 按内容 SHA256 去重：相同内容只保留最早一份
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&decoded);
    let content_hash = format!("{:x}", hasher.finalize());

    if let Ok(existing_id) = db.query_row(
        "SELECT id FROM files WHERE content_hash = ?1 LIMIT 1",
        rusqlite::params![&content_hash],
        |r| r.get::<_, String>(0),
    ) {
        return Ok(existing_id);
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Insert by id (PK). If a row with the same id already exists, treat
    // the call as idempotent: refresh the row but return the same id.
    let char_id = character_id.unwrap_or_default();
    let conv_id = conversation_id.unwrap_or_default();

    db.execute(
        "INSERT INTO files (id, filename, mime_type, size, data, character_id, conversation_id, created_at, content_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           filename = excluded.filename,
           mime_type = excluded.mime_type,
           size = excluded.size,
           data = excluded.data,
           character_id = excluded.character_id,
           conversation_id = excluded.conversation_id,
           created_at = excluded.created_at,
           content_hash = excluded.content_hash",
        rusqlite::params![
            id,
            filename,
            mime_type,
            size,
            decoded,
            char_id,
            conv_id,
            now,
            content_hash,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub fn get_file_from_db(app: AppHandle, id: String) -> Result<Option<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, filename, mime_type, size, data, character_id, conversation_id, created_at FROM files WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![id], |row| {
        let data_blob: Vec<u8> = row.get(4)?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data_blob);
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "filename": row.get::<_, String>(1)?,
            "mime_type": row.get::<_, String>(2)?,
            "size": row.get::<_, i64>(3)?,
            "data": b64,
            "character_id": row.get::<_, Option<String>>(5)?,
            "conversation_id": row.get::<_, Option<String>>(6)?,
            "created_at": row.get::<_, String>(7)?,
        }))
    });

    match result {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_file_data_only(app: AppHandle, id: String) -> Result<Option<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT data FROM files WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![id], |row| {
        let data_blob: Vec<u8> = row.get(0)?;
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data_blob);
        Ok(serde_json::json!({ "data": b64 }))
    });

    match result {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_files_page(
    app: AppHandle,
    character_id: Option<String>,
    conversation_id: Option<String>,
    mime_type_filter: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
) -> Result<Value, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let page_size = limit.unwrap_or(30);

    let mut sql = String::from(
        "SELECT id, filename, mime_type, size, character_id, conversation_id, created_at FROM files WHERE 1=1"
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref cid) = character_id {
        sql.push_str(" AND character_id = ?");
        param_values.push(Box::new(cid.clone()));
    }
    if let Some(ref conv_id) = conversation_id {
        sql.push_str(" AND conversation_id = ?");
        param_values.push(Box::new(conv_id.clone()));
    }
    if let Some(ref mtf) = mime_type_filter {
        sql.push_str(" AND mime_type LIKE ?");
        param_values.push(Box::new(format!("{}%", mtf)));
    }
    if let Some(ref cur) = cursor {
        sql.push_str(" AND created_at < (SELECT created_at FROM files WHERE id = ?)");
        param_values.push(Box::new(cur.clone()));
    }

    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    param_values.push(Box::new((page_size + 1) as i64));

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "filename": row.get::<_, String>(1)?,
            "mime_type": row.get::<_, String>(2)?,
            "size": row.get::<_, i64>(3)?,
            "character_id": row.get::<_, Option<String>>(4)?,
            "conversation_id": row.get::<_, Option<String>>(5)?,
            "created_at": row.get::<_, String>(6)?,
        }))
    }).map_err(|e| e.to_string())?;

    let all_rows: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    let has_more = all_rows.len() > page_size;
    let files: Vec<Value> = if has_more { all_rows[..page_size].to_vec() } else { all_rows };
    let next_cursor = if has_more { files.last().and_then(|e| e["id"].as_str()).map(|s| s.to_string()) } else { None };

    Ok(serde_json::json!({
        "files": files,
        "nextCursor": next_cursor,
        "hasMore": has_more,
    }))
}

#[tauri::command]
pub fn delete_file_from_db(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM files WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_file_stats(app: AppHandle) -> Result<Value, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let total: i64 = db
        .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let total_size: i64 = db
        .query_row("SELECT COALESCE(SUM(size), 0) FROM files", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT mime_type, COUNT(*), COALESCE(SUM(size), 0) FROM files GROUP BY mime_type")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "mimeType": row.get::<_, String>(0)?,
                "count": row.get::<_, i64>(1)?,
                "size": row.get::<_, i64>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut by_type = serde_json::Map::new();
    for r in rows.flatten() {
        let mt = r["mimeType"].as_str().unwrap_or("unknown").to_string();
        let key = mt.split('/').next().unwrap_or("unknown").to_string();
        let entry = by_type.entry(key).or_insert(serde_json::json!({"count": 0, "size": 0}));
        if let Some(obj) = entry.as_object_mut() {
            obj["count"] = serde_json::json!(obj["count"].as_i64().unwrap_or(0) + r["count"].as_i64().unwrap_or(0));
            obj["size"] = serde_json::json!(obj["size"].as_i64().unwrap_or(0) + r["size"].as_i64().unwrap_or(0));
        }
    }

    Ok(serde_json::json!({
        "total": total,
        "totalSize": total_size,
        "byType": by_type,
    }))
}

// ========== Bot Integrations ==========

/// 🆕 通用二维码生成：把任意文本渲染为 SVG data URL（QClaw / QQ Bot 扫码绑定入口用）
#[tauri::command]
pub fn generate_qrcode(text: String) -> Result<String, String> {
    let svg = crate::bot::clawbot::render_qr_svg(&text)?;
    let b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        svg.as_bytes(),
    );
    Ok(format!("data:image/svg+xml;base64,{}", b64))
}

#[tauri::command]
pub fn get_bot_integrations(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, type, enabled, config, created_at, updated_at FROM bot_integrations")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "type": row.get::<_, String>(1)?,
            "enabled": row.get::<_, bool>(2)?,
            "config": row.get::<_, String>(3)?,
            "createdAt": row.get::<_, String>(4)?,
            "updatedAt": row.get::<_, String>(5)?,
        }))
    }).map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_bot_integration(app: AppHandle, integration: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let id = integration["id"].as_str().unwrap_or("");
    let integration_type = integration["type"].as_str().unwrap_or("");
    let enabled = integration["enabled"].as_bool().unwrap_or(false);
    let config = integration["config"].as_str().unwrap_or("{}");
    let now = chrono::Utc::now().to_rfc3339();

    db.execute(
        "INSERT OR REPLACE INTO bot_integrations (id, type, enabled, config, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, COALESCE((SELECT created_at FROM bot_integrations WHERE id = ?1), ?5), ?5)",
        rusqlite::params![id, integration_type, enabled, config, now],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_bot_integration(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM bot_integrations WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_bot_conversations(app: AppHandle, integration_id: Option<String>) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match integration_id {
        Some(iid) => (
            "SELECT id, integration_id, external_user_id, external_user_name, character_id, conversation_id, created_at, updated_at, external_group_id FROM bot_conversations WHERE integration_id = ?1".into(),
            vec![Box::new(iid)],
        ),
        None => (
            "SELECT id, integration_id, external_user_id, external_user_name, character_id, conversation_id, created_at, updated_at, external_group_id FROM bot_conversations".into(),
            vec![],
        ),
    };

    let params_ref: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "integrationId": row.get::<_, String>(1)?,
            "externalUserId": row.get::<_, String>(2)?,
            "externalUserName": row.get::<_, String>(3)?,
            "characterId": row.get::<_, String>(4)?,
            "conversationId": row.get::<_, String>(5)?,
            "createdAt": row.get::<_, String>(6)?,
            "updatedAt": row.get::<_, String>(7)?,
            "externalGroupId": row.get::<_, Option<String>>(8)?,
        }))
    }).map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // 兼容新旧两种调用形态（conversation 对象 / 平铺参数），参数无法再减
/// 🆕 兼容两种调用形态：conversation 对象（新）或平铺参数（旧，此前前端传平铺参数导致保存静默失败）
pub fn save_bot_conversation(
    app: AppHandle,
    conversation: Option<Value>,
    id: Option<String>,
    integration_id: Option<String>,
    external_user_id: Option<String>,
    external_user_name: Option<String>,
    character_id: Option<String>,
    conversation_id: Option<String>,
    external_group_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let obj = conversation.unwrap_or(serde_json::json!({}));
    let field = |key: &str, flat: Option<String>| -> String {
        obj.get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or(flat)
            .unwrap_or_default()
    };

    let id = field("id", id);
    let integration_id = field("integrationId", integration_id);
    let external_user_id = field("externalUserId", external_user_id);
    let external_user_name = field("externalUserName", external_user_name);
    let character_id = field("characterId", character_id);
    let conversation_id = field("conversationId", conversation_id);
    let external_group_id = obj
        .get("externalGroupId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(external_group_id)
        .filter(|s| !s.is_empty());
    let now = chrono::Utc::now().to_rfc3339();

    db.execute(
        "INSERT OR REPLACE INTO bot_conversations (id, integration_id, external_user_id, external_user_name, character_id, conversation_id, created_at, updated_at, external_group_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE((SELECT created_at FROM bot_conversations WHERE id = ?1), ?7), ?7, ?8)",
        rusqlite::params![id, integration_id, external_user_id, external_user_name, character_id, conversation_id, now, external_group_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_bot_conversation(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM bot_conversations WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn start_bot_integration(app: AppHandle, integration_id: String) -> Result<String, String> {
    let state = app.state::<crate::BotManagerState>();

    let (integration_type, config) = {
        let db_state = app.state::<DbState>();
        let db = db_state.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = db.prepare("SELECT type, config FROM bot_integrations WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params![integration_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?
    };

    let config: BotIntegrationConfig = serde_json::from_str(&config)
        .map_err(|e| format!("Invalid config: {}", e))?;

    match integration_type.as_str() {
        "napcat" => {
            state.manager.start_napcat(&integration_id, config, app.clone()).await;
        }
        "wechat" => {
            state.manager.start_wechat(&integration_id, config, app.clone()).await;
        }
        // 🆕 QQ 开放平台官方机器人（含 QClaw / QQ Bot 龙虾生态：同一协议）
        "qq_official" | "qclaw" | "qqbot" => {
            state.manager.start_qq_official(&integration_id, config, app.clone()).await;
        }
        // 🆕 微信 ClawBot（HTTP 回调）
        "clawbot" => {
            state.manager.start_clawbot(&integration_id, config, app.clone()).await;
        }
        _ => return Err(format!("Unknown integration type: {}", integration_type)),
    }

    Ok("started".into())
}

#[tauri::command]
pub async fn stop_bot_integration(app: AppHandle, integration_id: String) -> Result<String, String> {
    let state = app.state::<crate::BotManagerState>();

    let integration_type = {
        let db_state = app.state::<DbState>();
        let db = db_state.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = db.prepare("SELECT type FROM bot_integrations WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params![integration_id], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| e.to_string())?
    };

    match integration_type.as_str() {
        "napcat" => state.manager.stop_napcat(&integration_id).await,
        "wechat" => state.manager.stop_wechat(&integration_id).await,
        // 🆕 新增类型停止分支
        "qq_official" | "qclaw" | "qqbot" => state.manager.stop_qq_official(&integration_id).await,
        "clawbot" => state.manager.stop_clawbot(&integration_id).await,
        _ => {}
    }

    Ok("stopped".into())
}

#[tauri::command]
pub async fn send_bot_message(app: AppHandle, integration_id: String, user_id: String, message: String) -> Result<String, String> {
    let state = app.state::<crate::BotManagerState>();
    let uid: i64 = user_id.parse().map_err(|_| format!("Invalid user_id: {}", user_id))?;
    state.manager.send_napcat_private_message(&integration_id, uid, &message).await?;
    Ok("sent".into())
}

#[tauri::command]
pub async fn send_bot_group_message(app: AppHandle, integration_id: String, group_id: String, message: String) -> Result<String, String> {
    let state = app.state::<crate::BotManagerState>();
    let gid: i64 = group_id.parse().map_err(|_| format!("Invalid group_id: {}", group_id))?;
    state.manager.send_napcat_group_message(&integration_id, gid, &message).await?;
    Ok("sent".into())
}

#[tauri::command]
pub async fn send_wechat_message(app: AppHandle, integration_id: String, user_id: String, message: String) -> Result<String, String> {
    let state = app.state::<crate::BotManagerState>();
    state.manager.send_wechat_message(&integration_id, &user_id, &message).await?;
    Ok("sent".into())
}

/// 🆕 统一回复命令：按接入类型分发（qq_official / clawbot 等新类型走这里）
/// user_id 为外部平台 openid；group_id 非空时优先发到群/房间。
#[tauri::command]
pub async fn send_bot_reply(
    app: AppHandle,
    integration_id: String,
    integration_type: String,
    user_id: String,
    group_id: Option<String>,
    message: String,
) -> Result<String, String> {
    let state = app.state::<crate::BotManagerState>();
    match integration_type.as_str() {
        "qq_official" | "qclaw" | "qqbot" => {
            let gid = group_id.filter(|g| !g.is_empty());
            state.manager.send_qq_official_message(&integration_id, &user_id, gid.as_deref(), &message).await?;
        }
        "clawbot" => {
            let gid = group_id.filter(|g| !g.is_empty());
            state.manager.send_clawbot_message(&integration_id, &user_id, gid.as_deref(), &message).await?;
        }
        "napcat" => {
            // 群消息优先发群，否则私聊
            if let Some(g) = group_id.filter(|g| !g.is_empty()) {
                let gid: i64 = g.parse().map_err(|_| format!("Invalid group_id: {}", g))?;
                state.manager.send_napcat_group_message(&integration_id, gid, &message).await?;
            } else {
                let uid: i64 = user_id.parse().map_err(|_| format!("Invalid user_id: {}", user_id))?;
                state.manager.send_napcat_private_message(&integration_id, uid, &message).await?;
            }
        }
        "wechat" => {
            state.manager.send_wechat_message(&integration_id, &user_id, &message).await?;
        }
        other => return Err(format!("Unknown integration type: {}", other)),
    }
    Ok("sent".into())
}

#[tauri::command]
pub async fn test_bot_connection(app: AppHandle, integration_id: String) -> Result<String, String> {
    let state = app.state::<crate::BotManagerState>();

    let integration_type = {
        let db_state = app.state::<DbState>();
        let db = db_state.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = db.prepare("SELECT type FROM bot_integrations WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        stmt.query_row(rusqlite::params![integration_id], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| e.to_string())?
    };

    match integration_type.as_str() {
        "napcat" => {
            if state.manager.is_napcat_connected(&integration_id).await {
                Ok("connected".into())
            } else if state.manager.is_napcat_running(&integration_id).await {
                Ok("running".into())
            } else {
                Ok("disconnected".into())
            }
        }
        "wechat" => {
            Ok("checking".into())
        }
        // 🆕 新增类型连接状态
        "qq_official" | "qclaw" | "qqbot" => {
            if state.manager.is_qq_official_connected(&integration_id).await {
                Ok("connected".into())
            } else if state.manager.is_qq_official_running(&integration_id).await {
                Ok("running".into())
            } else {
                Ok("disconnected".into())
            }
        }
        "clawbot" => {
            if state.manager.is_clawbot_running(&integration_id).await {
                Ok("listening".into())
            } else {
                Ok("disconnected".into())
            }
        }
        _ => Err(format!("Unknown integration type: {}", integration_type)),
    }
}

#[tauri::command]
pub fn get_bot_statuses(app: AppHandle) -> Result<Vec<Value>, String> {
    let _state = app.state::<crate::BotManagerState>();
    let db_state = app.state::<DbState>();
    let db = db_state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db.prepare("SELECT id, type, enabled FROM bot_integrations")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "integrationId": row.get::<_, String>(0)?,
            "type": row.get::<_, String>(1)?,
            "enabled": row.get::<_, bool>(2)?,
        }))
    }).map_err(|e| e.to_string())?;

    let integrations: Vec<Value> = rows.filter_map(|r| r.ok()).collect();

    let statuses = integrations.into_iter().map(|mut integration| {
        let _iid = integration["integrationId"].as_str().unwrap_or("");
        let itype = integration["type"].as_str().unwrap_or("");
        let enabled = integration["enabled"].as_bool().unwrap_or(false);

        let status = if !enabled {
            "disabled".to_string()
        } else {
            match itype {
                "napcat" => "running".to_string(),
                "wechat" => "running".to_string(),
                // 🆕 新增类型状态展示
                "qq_official" | "clawbot" | "qclaw" | "qqbot" => "running".to_string(),
                _ => "unknown".to_string(),
            }
        };

        integration["status"] = Value::String(status);
        integration
    }).collect();

    Ok(statuses)
}

#[tauri::command]
pub async fn download_and_save_file(app: AppHandle, url: String, filename: Option<String>, character_id: Option<String>, conversation_id: Option<String>) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let mime_type = response.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let data = response.bytes().await.map_err(|e| e.to_string())?;
    let filename = filename.unwrap_or_else(|| url.split('/').next_back().unwrap_or("file").to_string());
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let id = format!("file-{}-{:x}", t.as_millis(), t.as_nanos() & 0xffff);
    let now = chrono::Utc::now().to_rfc3339();

    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute(
        "CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/octet-stream', size INTEGER NOT NULL DEFAULT 0, data BLOB NOT NULL, character_id TEXT DEFAULT '', conversation_id TEXT DEFAULT '', created_at TEXT NOT NULL, content_hash TEXT)",
        [],
    ).map_err(|e| e.to_string())?;
    let _ = db.execute("ALTER TABLE files ADD COLUMN content_hash TEXT", []);

    // 按内容 SHA256 去重：相同内容只保留最早一份
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data.as_ref());
    let content_hash = format!("{:x}", hasher.finalize());

    if let Ok(existing_id) = db.query_row(
        "SELECT id FROM files WHERE content_hash = ?1 LIMIT 1",
        rusqlite::params![&content_hash],
        |r| r.get::<_, String>(0),
    ) {
        return Ok(existing_id);
    }

    db.execute(
        "INSERT INTO files (id, filename, mime_type, size, data, character_id, conversation_id, created_at, content_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![id, filename, mime_type, data.len() as i64, data.as_ref(), character_id.unwrap_or_default(), conversation_id.unwrap_or_default(), now, content_hash],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

// ========== MBTI Tests ==========

#[tauri::command]
pub fn get_mbti_tests(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, type_code, dimensions, completed_at FROM mbti_tests ORDER BY completed_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "type": row.get::<_, String>(1)?,
                "dimensions": row.get::<_, String>(2)?,
                "completedAt": row.get::<_, String>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_mbti_test(app: AppHandle, id: String, type_code: String, dimensions: String, completed_at: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute(
        "INSERT OR REPLACE INTO mbti_tests (id, type_code, dimensions, completed_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, type_code, dimensions, completed_at],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_mbti_test(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM mbti_tests WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ========== User Profile ==========

#[tauri::command]
pub fn get_user_profile(app: AppHandle) -> Result<Value, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let result = db.query_row(
        "SELECT avatar, nickname, age, gender, personality, background, interests, habits, notes, mbti, birthday FROM user_profile WHERE id = 'default'",
        [],
        |row| {
            Ok(serde_json::json!({
                "avatar": row.get::<_, String>(0)?,
                "nickname": row.get::<_, String>(1)?,
                "age": row.get::<_, String>(2)?,
                "gender": row.get::<_, String>(3)?,
                "personality": row.get::<_, String>(4)?,
                "background": row.get::<_, String>(5)?,
                "interests": row.get::<_, String>(6)?,
                "habits": row.get::<_, String>(7)?,
                "notes": row.get::<_, String>(8)?,
                "mbti": row.get::<_, String>(9)?,
                "birthday": row.get::<_, String>(10)?,
            }))
        },
    );

    match result {
        Ok(val) => Ok(val),
        Err(_) => Ok(serde_json::json!({
            "avatar": "",
            "nickname": "",
            "age": "",
            "gender": "",
            "personality": "",
            "background": "",
            "interests": "",
            "habits": "",
            "notes": "",
            "mbti": "",
            "birthday": "",
        })),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn save_user_profile(
    app: AppHandle,
    avatar: String,
    nickname: String,
    age: String,
    gender: String,
    personality: String,
    background: String,
    interests: String,
    habits: String,
    notes: String,
    mbti: String,
    birthday: String,
) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute(
        "INSERT OR REPLACE INTO user_profile (id, avatar, nickname, age, gender, personality, background, interests, habits, notes, mbti, birthday) VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![avatar, nickname, age, gender, personality, background, interests, habits, notes, mbti, birthday],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_app_data_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

// ========== Backups ==========

#[tauri::command]
pub fn get_backups(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, label, created_at, size_bytes FROM backups ORDER BY created_at DESC LIMIT 100")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "label": row.get::<_, String>(1)?,
                "createdAt": row.get::<_, String>(2)?,
                "sizeBytes": row.get::<_, i64>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn create_backup(
    app: AppHandle,
    id: String,
    label: String,
    data_json: String,
) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let size = data_json.len() as i64;
    db.execute(
        "INSERT INTO backups (id, label, created_at, data_json, size_bytes) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, label, now, data_json, size],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_backup_data(app: AppHandle, backup_id: String) -> Result<Option<String>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let result = db.query_row(
        "SELECT data_json FROM backups WHERE id = ?1",
        rusqlite::params![backup_id],
        |row| row.get::<_, String>(0),
    );
    match result {
        Ok(json) => Ok(Some(json)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_backup(app: AppHandle, backup_id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM backups WHERE id = ?1",
        rusqlite::params![backup_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn prune_old_backups(app: AppHandle, keep_count: i64) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY created_at DESC LIMIT ?1)",
        rusqlite::params![keep_count],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_backup_count(app: AppHandle) -> Result<i64, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM backups", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(count)
}

// ========== AI Life / Diaries ==========

#[tauri::command]
pub fn get_ai_diaries(app: AppHandle, character_id: String, date_from: Option<String>, date_to: Option<String>) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = "SELECT id, character_id, date, title, content, mood, activities, thoughts, comments, created_at, updated_at
                   FROM ai_diaries WHERE character_id = ?1".to_string();
    if date_from.is_some() {
        sql.push_str(" AND date >= ?2");
    }
    if date_to.is_some() {
        sql.push_str(" AND date <= ?3");
    }
    sql.push_str(" ORDER BY date DESC");

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let from_param = date_from.clone().unwrap_or_default();
    let to_param = date_to.clone().unwrap_or_default();

    let map_row = |row: &rusqlite::Row<'_>| {
        let activities_str: String = row.get(6)?;
        let thoughts_str: String = row.get(7)?;
        let comments_str: String = row.get(8)?;
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "characterId": row.get::<_, String>(1)?,
            "date": row.get::<_, String>(2)?,
            "title": row.get::<_, String>(3)?,
            "content": row.get::<_, String>(4)?,
            "mood": row.get::<_, String>(5)?,
            "activities": serde_json::from_str::<Value>(&activities_str).unwrap_or(serde_json::json!([])),
            "thoughts": serde_json::from_str::<Value>(&thoughts_str).unwrap_or(serde_json::json!([])),
            "comments": serde_json::from_str::<Value>(&comments_str).unwrap_or(serde_json::json!([])),
            "createdAt": row.get::<_, String>(9)?,
            "updatedAt": row.get::<_, String>(10)?,
        }))
    };

    let mapped = if date_from.is_some() && date_to.is_some() {
        stmt.query_map(params![character_id, from_param, to_param], map_row)
    } else if date_from.is_some() {
        stmt.query_map(params![character_id, from_param], map_row)
    } else {
        stmt.query_map(params![character_id], map_row)
    }
    .map_err(|e| e.to_string())?;

    Ok(mapped.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_ai_diary(app: AppHandle, diary: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let id = diary["id"].as_str().unwrap_or("");
    let character_id = diary["characterId"].as_str().unwrap_or("");
    let date = diary["date"].as_str().unwrap_or("");
    let title = diary["title"].as_str().unwrap_or("");
    let content = diary["content"].as_str().unwrap_or("");
    let mood = diary["mood"].as_str().unwrap_or("");
    let activities = diary["activities"].to_string();
    let thoughts = diary["thoughts"].to_string();
    let comments = diary["comments"].to_string();
    let created_at = diary["createdAt"].as_str().unwrap_or("");
    let updated_at = diary["updatedAt"].as_str().unwrap_or("");

    db.execute(
        "INSERT OR REPLACE INTO ai_diaries (id, character_id, date, title, content, mood, activities, thoughts, comments, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![id, character_id, date, title, content, mood, activities, thoughts, comments, created_at, updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_ai_diary(app: AppHandle, diary: Value) -> Result<(), String> {
    save_ai_diary(app, diary)
}

#[tauri::command]
pub fn delete_ai_diary(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_diaries WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ========== AI Life / Activities & Config（AI 一日生活） ==========

fn row_to_ai_activity(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    let comments_str: String = row.get(17)?;
    let steps_str: String = row.get(20)?;
    Ok(serde_json::json!({
        "id": row.get::<_, String>(0)?,
        "characterId": row.get::<_, String>(1)?,
        "name": row.get::<_, String>(2)?,
        "category": row.get::<_, String>(3)?,
        "startTime": row.get::<_, String>(4)?,
        "endTime": row.get::<_, String>(5)?,
        "sceneId": row.get::<_, String>(6)?,
        "status": row.get::<_, String>(7)?,
        "processDescription": row.get::<_, String>(8)?,
        "summary": row.get::<_, String>(9)?,
        "mood": row.get::<_, String>(10)?,
        "location": row.get::<_, String>(11)?,
        "weather": row.get::<_, String>(12)?,
        "isChanged": row.get::<_, i64>(13)? != 0,
        "changedFrom": row.get::<_, String>(14)?,
        "changedReason": row.get::<_, String>(15)?,
        "replacedBy": row.get::<_, String>(16)?,
        "comments": serde_json::from_str::<Value>(&comments_str).unwrap_or(serde_json::json!([])),
        "createdAt": row.get::<_, String>(18)?,
        "updatedAt": row.get::<_, String>(19)?,
        "steps": serde_json::from_str::<Value>(&steps_str).unwrap_or(serde_json::json!([])),
    }))
}

const AI_ACTIVITY_COLS: &str = "id, character_id, name, category, start_time, end_time, scene_id, status, process_description, summary, mood, location, weather, is_changed, changed_from, changed_reason, replaced_by, comments, created_at, updated_at, steps";

#[tauri::command]
pub fn get_ai_activities(app: AppHandle, character_id: String, date_from: Option<String>, date_to: Option<String>) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = format!(
        "SELECT {} FROM ai_activities WHERE character_id = ?1", AI_ACTIVITY_COLS
    );
    if date_from.is_some() {
        sql.push_str(" AND start_time >= ?2");
    }
    if date_to.is_some() {
        sql.push_str(" AND start_time < ?3");
    }
    sql.push_str(" ORDER BY start_time ASC");

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let from_param = date_from.clone().unwrap_or_default();
    let to_param = date_to.clone().unwrap_or_default();
    // 🆕 修复：SQL 占位符按条件生成，绑定参数必须同步条件化，
    //    否则无日期过滤时 rusqlite 报 "Wrong number of parameters"
    let mapped = if date_from.is_some() && date_to.is_some() {
        stmt.query_map(params![character_id, from_param, to_param], row_to_ai_activity)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
    } else if date_from.is_some() {
        stmt.query_map(params![character_id, from_param], row_to_ai_activity)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
    } else {
        stmt.query_map(params![character_id], row_to_ai_activity)
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
    };
    Ok(mapped)
}

#[tauri::command]
pub fn batch_save_ai_activities(app: AppHandle, activities: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        // 🆕 幂等写入（防重复的两层保障）：
        //    1) id 已存在 → UPDATE（状态推进/总结回填等正常更新语义）
        //    2) id 不存在 → INSERT OR IGNORE，命中 v31 partial UNIQUE 索引
        //       (character_id, name, start_time WHERE status != 'cancelled') 的同名同时段
        //       插入被静默忽略 —— 多引擎实例/HMR 并发写入在结构上不可能再产生重复行
        let mut update_stmt = tx.prepare(
            "UPDATE OR IGNORE ai_activities SET character_id=?2, name=?3, category=?4, start_time=?5, end_time=?6, scene_id=?7, status=?8, process_description=?9, summary=?10, mood=?11, location=?12, weather=?13, is_changed=?14, changed_from=?15, changed_reason=?16, replaced_by=?17, comments=?18, created_at=?19, updated_at=?20, steps=?21
             WHERE id=?1",
        ).map_err(|e| e.to_string())?;
        let mut insert_stmt = tx.prepare(
            "INSERT OR IGNORE INTO ai_activities (id, character_id, name, category, start_time, end_time, scene_id, status, process_description, summary, mood, location, weather, is_changed, changed_from, changed_reason, replaced_by, comments, created_at, updated_at, steps)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
        ).map_err(|e| e.to_string())?;
        for a in &activities {
            let args = params![
                a["id"].as_str().unwrap_or(""),
                a["characterId"].as_str().unwrap_or(""),
                a["name"].as_str().unwrap_or(""),
                a["category"].as_str().unwrap_or("leisure"),
                a["startTime"].as_str().unwrap_or(""),
                a["endTime"].as_str().unwrap_or(""),
                a["sceneId"].as_str().unwrap_or(""),
                a["status"].as_str().unwrap_or("planned"),
                a["processDescription"].as_str().unwrap_or(""),
                a["summary"].as_str().unwrap_or(""),
                a["mood"].as_str().unwrap_or(""),
                a["location"].as_str().unwrap_or(""),
                a["weather"].as_str().unwrap_or(""),
                a["isChanged"].as_bool().unwrap_or(false) as i64,
                a["changedFrom"].as_str().unwrap_or(""),
                a["changedReason"].as_str().unwrap_or(""),
                a["replacedBy"].as_str().unwrap_or(""),
                a["comments"].to_string(),
                a["createdAt"].as_str().unwrap_or(""),
                a["updatedAt"].as_str().unwrap_or(""),
                // 🆕 B7: steps 缺省空数组（兼容旧前端数据）
                if a.get("steps").is_some() { a["steps"].to_string() } else { "[]".to_string() },
            ];
            let changed = update_stmt.execute(args).map_err(|e| e.to_string())?;
            if changed == 0 {
                insert_stmt.execute(args).map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_ai_activities_by_date(app: AppHandle, character_id: String, date_from: String, date_to: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM ai_activities WHERE character_id = ?1 AND start_time >= ?2 AND start_time < ?3",
        params![character_id, date_from, date_to],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// 当前正在进行的活动（start <= now < end 且状态非 cancelled）
#[tauri::command]
pub fn get_current_ai_activity(app: AppHandle, character_id: String, now: String) -> Result<Option<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(&format!(
            "SELECT {} FROM ai_activities
             WHERE character_id = ?1 AND start_time <= ?2 AND end_time > ?3 AND status NOT IN ('cancelled')
             ORDER BY start_time DESC LIMIT 1",
            AI_ACTIVITY_COLS
        ))
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map(params![character_id, now, now], row_to_ai_activity)
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(Ok(v)) => Ok(Some(v)),
        _ => Ok(None),
    }
}

#[tauri::command]
pub fn update_ai_activity_status(app: AppHandle, id: String, status: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE ai_activities SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, status, chrono::Utc::now().to_rfc3339()],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ========== 🆕 B4: 活动事件流 ai_life_events ==========

fn row_to_ai_life_event(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "characterId": row.get::<_, String>(1)?,
        "ts": row.get::<_, String>(2)?,
        "type": row.get::<_, String>(3)?,
        "description": row.get::<_, String>(4)?,
        "activityId": row.get::<_, String>(5)?,
        "itemId": row.get::<_, String>(6)?,
        "meta": serde_json::from_str::<Value>(&row.get::<_, String>(7)?).unwrap_or(Value::Null),
        "injectedIntoChat": row.get::<_, i64>(8)? != 0,
    }))
}

/// 批量保存生活事件（INSERT OR REPLACE，按 id 幂等）
#[tauri::command]
pub fn batch_save_ai_life_events(app: AppHandle, events: Vec<Value>) -> Result<(), String> {
    if events.is_empty() { return Ok(()); }
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO ai_life_events (id, character_id, ts, type, description, activity_id, item_id, meta_json, injected_into_chat)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        ).map_err(|e| e.to_string())?;
        for e in &events {
            stmt.execute(params![
                e["id"].as_str().unwrap_or(""),
                e["characterId"].as_str().unwrap_or(""),
                e["ts"].as_str().unwrap_or(""),
                e["type"].as_str().unwrap_or("random_event"),
                e["description"].as_str().unwrap_or(""),
                e["activityId"].as_str().unwrap_or(""),
                e["itemId"].as_str().unwrap_or(""),
                e["meta"].to_string(),
                e["injectedIntoChat"].as_bool().unwrap_or(false) as i64,
            ]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 查询生活事件流（按角色 + 可选时间窗，ts 升序）
#[tauri::command]
pub fn get_ai_life_events(app: AppHandle, character_id: String, ts_from: Option<String>, ts_to: Option<String>, limit: Option<i64>) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT id, character_id, ts, type, description, activity_id, item_id, meta_json, injected_into_chat FROM ai_life_events WHERE character_id = ?1",
    );
    if ts_from.is_some() {
        sql.push_str(" AND ts >= ?2");
    }
    if ts_to.is_some() {
        sql.push_str(" AND ts < ?3");
    }
    let lim = limit.unwrap_or(500).clamp(1, 5000);
    sql.push_str(&format!(" ORDER BY ts ASC LIMIT {}", lim));

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let from_param = ts_from.clone().unwrap_or_default();
    let to_param = ts_to.clone().unwrap_or_default();
    let mapped = if ts_from.is_some() && ts_to.is_some() {
        stmt.query_map(params![character_id, from_param, to_param], row_to_ai_life_event)
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect::<Vec<_>>()
    } else if ts_from.is_some() {
        stmt.query_map(params![character_id, from_param], row_to_ai_life_event)
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect::<Vec<_>>()
    } else {
        stmt.query_map(params![character_id], row_to_ai_life_event)
            .map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect::<Vec<_>>()
    };
    Ok(mapped)
}

/// 🆕 D1 审计地基：标记事件已被注入 prompt（consumed 记账）
#[tauri::command]
pub fn mark_ai_life_events_injected(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() { return Ok(()); }
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("UPDATE ai_life_events SET injected_into_chat = 1 WHERE id IN ({})", placeholders);
    let params: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    db.execute(&sql, rusqlite::params_from_iter(params)).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------- 🆕 D4 创意工坊：AI 内容提案 ----------------

/// 批量保存提案（INSERT OR REPLACE，按 id 幂等）
#[tauri::command]
pub fn save_ai_content_proposals(app: AppHandle, proposals: Vec<Value>) -> Result<(), String> {
    if proposals.is_empty() { return Ok(()); }
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO ai_content_proposals (id, character_id, kind, title, payload_json, reason, status, created_at, decided_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        ).map_err(|e| e.to_string())?;
        for p in &proposals {
            stmt.execute(params![
                p["id"].as_str().unwrap_or(""),
                p["characterId"].as_str().unwrap_or(""),
                p["kind"].as_str().unwrap_or("random_event"),
                p["title"].as_str().unwrap_or(""),
                p["payload"].to_string(),
                p["reason"].as_str().unwrap_or(""),
                p["status"].as_str().unwrap_or("pending"),
                p["createdAt"].as_str().unwrap_or(""),
                p["decidedAt"].as_str().unwrap_or(""),
            ]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_ai_content_proposal(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?,
        "characterId": row.get::<_, String>(1)?,
        "kind": row.get::<_, String>(2)?,
        "title": row.get::<_, String>(3)?,
        "payload": serde_json::from_str::<Value>(&row.get::<_, String>(4)?).unwrap_or(Value::Null),
        "reason": row.get::<_, String>(5)?,
        "status": row.get::<_, String>(6)?,
        "createdAt": row.get::<_, String>(7)?,
        "decidedAt": row.get::<_, String>(8)?,
    }))
}

/// 查询提案（按角色 + 可选状态过滤，created_at 倒序）
#[tauri::command]
pub fn get_ai_content_proposals(app: AppHandle, character_id: Option<String>, status: Option<String>, limit: Option<i64>) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from("SELECT id, character_id, kind, title, payload_json, reason, status, created_at, decided_at FROM ai_content_proposals");
    let mut conditions: Vec<String> = Vec::new();
    if character_id.as_deref().map(|c| !c.is_empty()).unwrap_or(false) {
        conditions.push(format!("character_id = '{}'", character_id.clone().unwrap().replace('\'', "''")));
    }
    if status.as_deref().map(|s| !s.is_empty()).unwrap_or(false) {
        conditions.push(format!("status = '{}'", status.clone().unwrap().replace('\'', "''")));
    }
    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }
    let lim = limit.unwrap_or(100).clamp(1, 1000);
    sql.push_str(&format!(" ORDER BY created_at DESC LIMIT {}", lim));

    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_ai_content_proposal)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();
    Ok(rows)
}

/// 审核提案：status ∈ approved / rejected / retired；入池动作由前端完成后调用落账
#[tauri::command]
pub fn decide_ai_content_proposal(app: AppHandle, id: String, status: String) -> Result<(), String> {
    let allowed = ["approved", "rejected", "retired"];
    if !allowed.contains(&status.as_str()) {
        return Err(format!("非法状态: {}（允许 approved/rejected/retired）", status));
    }
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let decided_at = chrono::Utc::now().to_rfc3339();
    db.execute(
        "UPDATE ai_content_proposals SET status = ?1, decided_at = ?2 WHERE id = ?3",
        params![status, decided_at, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 日期轴：可用日期列表（复刻 debug_logs 的 available_dates 模式）
#[tauri::command]
pub fn get_ai_activities_available_dates(app: AppHandle, character_id: Option<String>) -> Result<Vec<String>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = if character_id.as_deref().map(|c| !c.is_empty()).unwrap_or(false) {
        db.prepare("SELECT DISTINCT substr(start_time, 1, 10) AS d FROM ai_activities WHERE character_id = ?1 ORDER BY d DESC")
            .map_err(|e| e.to_string())?
    } else {
        db.prepare("SELECT DISTINCT substr(start_time, 1, 10) AS d FROM ai_activities ORDER BY d DESC")
            .map_err(|e| e.to_string())?
    };
    let map = |row: &rusqlite::Row| -> rusqlite::Result<String> { row.get(0) };
    let rows: Vec<String> = if character_id.as_deref().map(|c| !c.is_empty()).unwrap_or(false) {
        stmt.query_map(params![character_id.clone().unwrap()], map).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect()
    } else {
        stmt.query_map([], map).map_err(|e| e.to_string())?.filter_map(|r| r.ok()).collect()
    };
    Ok(rows)
}

#[tauri::command]
pub fn get_ai_life_config(app: AppHandle, character_id: String) -> Result<Value, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let cid = character_id.clone();
    let result = db.query_row(
        "SELECT enabled, content_level, event_frequency, schedule_mode, custom_schedule_json, last_active_time, extra_json, updated_at FROM ai_life_config WHERE character_id = ?1",
        params![character_id],
        |row| {
            let extra_str: String = row.get(6)?;
            Ok(serde_json::json!({
                "characterId": cid,
                "enabled": row.get::<_, i64>(0)? != 0,
                "contentLevel": row.get::<_, String>(1)?,
                "eventFrequency": row.get::<_, String>(2)?,
                "scheduleMode": row.get::<_, String>(3)?,
                "customSchedule": serde_json::from_str::<Value>(&row.get::<_, String>(4)?).unwrap_or(serde_json::json!([])),
                "lastActiveTime": row.get::<_, String>(5)?,
                "extra": serde_json::from_str::<Value>(&extra_str).unwrap_or(serde_json::json!({})),
                "updatedAt": row.get::<_, String>(7)?,
            }))
        },
    );
    match result {
        Ok(v) => Ok(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(serde_json::json!({
            "characterId": character_id,
            "enabled": false,
            "contentLevel": "full",
            "eventFrequency": "medium",
            "scheduleMode": "auto",
            "customSchedule": [],
            "lastActiveTime": "",
            "extra": {},
            "updatedAt": "",
        })),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_ai_life_config(app: AppHandle, config: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    db.execute(
        "INSERT OR REPLACE INTO ai_life_config (character_id, enabled, content_level, event_frequency, schedule_mode, custom_schedule_json, last_active_time, extra_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            config["characterId"].as_str().unwrap_or(""),
            config["enabled"].as_bool().unwrap_or(false) as i64,
            config["contentLevel"].as_str().unwrap_or("full"),
            config["eventFrequency"].as_str().unwrap_or("medium"),
            config["scheduleMode"].as_str().unwrap_or("auto"),
            config["customSchedule"].to_string(),
            config["lastActiveTime"].as_str().unwrap_or(""),
            config["extra"].to_string(),
            now,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ========== AI Life / Attributes（属性系统） ==========

#[tauri::command]
pub fn get_ai_attributes(app: AppHandle, character_id: String) -> Result<Option<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let result = db.query_row(
        "SELECT health, stamina, satiety, cleanliness, spirit, stress, timestamp, COALESCE(thirst, 80) FROM ai_attribute_snapshots WHERE character_id = ?1 ORDER BY timestamp DESC LIMIT 1",
        params![character_id],
        |row| Ok(serde_json::json!({
            "characterId": character_id,
            "health": row.get::<_, i64>(0)?,
            "stamina": row.get::<_, i64>(1)?,
            "satiety": row.get::<_, i64>(2)?,
            "cleanliness": row.get::<_, i64>(3)?,
            "spirit": row.get::<_, i64>(4)?,
            "stress": row.get::<_, i64>(5)?,
            "timestamp": row.get::<_, String>(6)?,
            "thirst": row.get::<_, i64>(7)?,
        })),
    );
    match result {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_ai_attributes(app: AppHandle, snapshot: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO ai_attribute_snapshots (id, character_id, timestamp, health, stamina, satiety, cleanliness, spirit, stress, reason, thirst)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            snapshot["id"].as_str().unwrap_or(""),
            snapshot["characterId"].as_str().unwrap_or(""),
            snapshot["timestamp"].as_str().unwrap_or(""),
            snapshot["health"].as_i64().unwrap_or(100),
            snapshot["stamina"].as_i64().unwrap_or(100),
            snapshot["satiety"].as_i64().unwrap_or(100),
            snapshot["cleanliness"].as_i64().unwrap_or(100),
            snapshot["spirit"].as_i64().unwrap_or(100),
            snapshot["stress"].as_i64().unwrap_or(0),
            snapshot["reason"].as_str().unwrap_or(""),
            snapshot["thirst"].as_i64().unwrap_or(80),
        ],
    ).map_err(|e| e.to_string())?;
    // 只保留每个角色最近 200 条快照
    let _ = db.execute(
        "DELETE FROM ai_attribute_snapshots WHERE character_id = ?1 AND id NOT IN (
            SELECT id FROM ai_attribute_snapshots WHERE character_id = ?1 ORDER BY timestamp DESC LIMIT 200)",
        params![snapshot["characterId"].as_str().unwrap_or("")],
    );
    Ok(())
}

// ========== AI Life / Inventory & Economy（物资与经济） ==========

#[tauri::command]
pub fn get_ai_inventory(app: AppHandle, character_id: String) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id, category, name, quantity, quality, extra_json, updated_at FROM ai_inventory_items WHERE character_id = ?1 ORDER BY category, name",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![character_id], |row| {
        let extra: String = row.get(5)?;
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "characterId": character_id,
            "category": row.get::<_, String>(1)?,
            "name": row.get::<_, String>(2)?,
            "quantity": row.get::<_, i64>(3)?,
            "quality": row.get::<_, String>(4)?,
            "extra": serde_json::from_str::<Value>(&extra).unwrap_or(serde_json::json!({})),
            "updatedAt": row.get::<_, String>(6)?,
        }))
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_ai_inventory_items(app: AppHandle, items: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO ai_inventory_items (id, character_id, category, name, quantity, quality, extra_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        ).map_err(|e| e.to_string())?;
        for it in &items {
            stmt.execute(params![
                it["id"].as_str().unwrap_or(""),
                it["characterId"].as_str().unwrap_or(""),
                it["category"].as_str().unwrap_or("food"),
                it["name"].as_str().unwrap_or(""),
                it["quantity"].as_i64().unwrap_or(1),
                it["quality"].as_str().unwrap_or("good"),
                it["extra"].to_string(),
                it["updatedAt"].as_str().unwrap_or(""),
            ]).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_ai_inventory_item(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM ai_inventory_items WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_ai_economy(app: AppHandle, character_id: String) -> Result<Value, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let result = db.query_row(
        "SELECT balance, monthly_income, monthly_expense, last_payday, updated_at FROM ai_economy WHERE character_id = ?1",
        params![character_id],
        |row| Ok(serde_json::json!({
            "characterId": character_id,
            "balance": row.get::<_, f64>(0)?,
            "monthlyIncome": row.get::<_, f64>(1)?,
            "monthlyExpense": row.get::<_, f64>(2)?,
            "lastPayday": row.get::<_, String>(3)?,
            "updatedAt": row.get::<_, String>(4)?,
        })),
    );
    match result {
        Ok(v) => Ok(v),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(serde_json::json!({
            "characterId": character_id, "balance": 3000.0, "monthlyIncome": 0.0,
            "monthlyExpense": 0.0, "lastPayday": "", "updatedAt": "",
        })),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_ai_economy(app: AppHandle, economy: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT OR REPLACE INTO ai_economy (character_id, balance, monthly_income, monthly_expense, last_payday, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            economy["characterId"].as_str().unwrap_or(""),
            economy["balance"].as_f64().unwrap_or(0.0),
            economy["monthlyIncome"].as_f64().unwrap_or(0.0),
            economy["monthlyExpense"].as_f64().unwrap_or(0.0),
            economy["lastPayday"].as_str().unwrap_or(""),
            economy["updatedAt"].as_str().unwrap_or(""),
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_ai_transaction(app: AppHandle, tx: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT INTO ai_transactions (id, character_id, type, amount, description, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            tx["id"].as_str().unwrap_or(""),
            tx["characterId"].as_str().unwrap_or(""),
            tx["type"].as_str().unwrap_or("expense"),
            tx["amount"].as_f64().unwrap_or(0.0),
            tx["description"].as_str().unwrap_or(""),
            tx["timestamp"].as_str().unwrap_or(""),
        ],
    ).map_err(|e| e.to_string())?;
    // 保留最近 500 条
    let _ = db.execute(
        "DELETE FROM ai_transactions WHERE character_id = ?1 AND id NOT IN (
            SELECT id FROM ai_transactions WHERE character_id = ?1 ORDER BY timestamp DESC LIMIT 500)",
        params![tx["characterId"].as_str().unwrap_or("")],
    );
    Ok(())
}

#[tauri::command]
pub fn get_ai_transactions(app: AppHandle, character_id: String, limit: Option<i64>) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(30).max(1);
    let mut stmt = db.prepare(
        "SELECT id, type, amount, description, timestamp FROM ai_transactions WHERE character_id = ?1 ORDER BY timestamp DESC LIMIT ?2",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![character_id, lim], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "characterId": character_id,
            "type": row.get::<_, String>(1)?,
            "amount": row.get::<_, f64>(2)?,
            "description": row.get::<_, String>(3)?,
            "timestamp": row.get::<_, String>(4)?,
        }))
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

// ========== AI Life / World Configs（世界设定包） ==========

#[tauri::command]
pub fn get_world_configs(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare(
        "SELECT id, name, world_type, config_json, is_builtin, updated_at FROM world_configs ORDER BY is_builtin DESC, name",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        let cfg: String = row.get(3)?;
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "name": row.get::<_, String>(1)?,
            "worldType": row.get::<_, String>(2)?,
            "config": serde_json::from_str::<Value>(&cfg).unwrap_or(serde_json::json!({})),
            "isBuiltin": row.get::<_, i64>(4)? != 0,
            "updatedAt": row.get::<_, String>(5)?,
        }))
    }).map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_world_config(app: AppHandle, config: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute(
        "INSERT OR REPLACE INTO world_configs (id, name, world_type, config_json, is_builtin, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            config["id"].as_str().unwrap_or(""),
            config["name"].as_str().unwrap_or(""),
            config["worldType"].as_str().unwrap_or("modern_real"),
            config["config"].to_string(),
            config["isBuiltin"].as_bool().unwrap_or(false) as i64,
            config["updatedAt"].as_str().unwrap_or(""),
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_world_config(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    // 按 id 删除（不区分内置/非内置）：已退役的内置包（如 world_builtin_lads）因不再播种，
    // 删除后永久消失；仍存在的内置包会在下次启动 ensureBuiltinWorlds 时按 id 幂等重新播种，无害。
    db.execute("DELETE FROM world_configs WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}
