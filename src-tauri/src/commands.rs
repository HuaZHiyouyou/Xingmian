
use crate::bot::types::BotIntegrationConfig;
use crate::db::{DbState, DbConversation, DbEmotionRecord, DbMessage, DbModel, DbPlatform};
use rusqlite::params;
use serde_json::Value;
use tauri::AppHandle;
use tauri::Manager;

// ========== Debug Logs ==========

#[tauri::command]
pub fn get_debug_logs(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, type, message, timestamp, character_id, conversation_id FROM debug_logs ORDER BY timestamp DESC LIMIT 500")
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
            "INSERT OR REPLACE INTO debug_logs (id, type, message, timestamp, character_id, conversation_id) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                l["id"].as_str().unwrap_or(""),
                l["type"].as_str().unwrap_or("system"),
                l["message"].as_str().unwrap_or(""),
                l["timestamp"].as_str().unwrap_or(""),
                l["characterId"].as_str().unwrap_or(""),
                l["conversationId"].as_str().unwrap_or(""),
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
            "INSERT INTO debug_logs (id, type, message, timestamp, character_id, conversation_id) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                l["id"].as_str().unwrap_or(""),
                l["type"].as_str().unwrap_or("system"),
                l["message"].as_str().unwrap_or(""),
                l["timestamp"].as_str().unwrap_or(""),
                l["characterId"].as_str().unwrap_or(""),
                l["conversationId"].as_str().unwrap_or(""),
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

    for p in &mut platforms {
        let mut stmt = db
            .prepare("SELECT id, platform_id, name, type, enabled, pinned, enabled_types FROM models WHERE platform_id = ?1 ORDER BY id")
            .map_err(|e| e.to_string())?;
        let model_rows = stmt
            .query_map(params![p.id], |row| {
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
        p.models = model_rows.filter_map(|r| r.ok()).collect();
    }

    Ok(platforms)
}

#[tauri::command]
pub fn save_platforms(app: AppHandle, platforms: Vec<Value>) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute("DELETE FROM models", []).map_err(|e| e.to_string())?;
    db.execute("DELETE FROM platforms", []).map_err(|e| e.to_string())?;

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

    for c in &mut conversations {
        let mut stmt = db
            .prepare("SELECT id, conversation_id, content, sender, timestamp, emotion, emotion_intensity, attachments FROM messages WHERE conversation_id = ?1 ORDER BY timestamp")
            .map_err(|e| e.to_string())?;
        let msg_rows = stmt
            .query_map(params![c.id], |row| {
                Ok(DbMessage {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    content: row.get(2)?,
                    sender: row.get(3)?,
                    timestamp: row.get(4)?,
                    emotion: row.get(5)?,
                    emotion_intensity: row.get(6)?,
                    attachments: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        c.messages = msg_rows.filter_map(|r| r.ok()).collect();
    }

    Ok(conversations)
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

                db.execute(
                    "INSERT INTO messages (id, conversation_id, content, sender, timestamp, emotion, emotion_intensity, attachments) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![msg_id, id, content, sender, timestamp, emotion, emotion_intensity, attachments],
                ).map_err(|e| e.to_string())?;
            }
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
        .prepare("SELECT id, emotion, intensity, timestamp, context, character_id FROM emotion_records ORDER BY timestamp DESC LIMIT 100")
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
            "SELECT id, character_id, conversation_id, content, importance, tags, created_at, last_recalled_at, recall_count FROM memories WHERE character_id = ?1 ORDER BY importance DESC, created_at DESC LIMIT 100",
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
            "SELECT id, character_id, trigger_text, insight, emotion_before, emotion_after, created_at FROM reflections WHERE character_id = ?1 ORDER BY created_at DESC LIMIT 50",
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

// ========== Model Roles ==========

#[tauri::command]
pub fn get_model_roles(app: AppHandle) -> Result<Option<Value>, String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare("SELECT id, config_json FROM model_roles LIMIT 1")
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query_map([], |row| {
        Ok(row.get::<_, String>(1)?)
    }).map_err(|e| e.to_string())?;

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
    let page_size = limit.unwrap_or(300);

    let mut sql = String::from(
        "SELECT id, type, message, timestamp, character_id, conversation_id FROM debug_logs WHERE 1=1"
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
pub fn save_file_to_db(
    app: AppHandle,
    id: String,
    filename: String,
    mime_type: String,
    data: String,
    size: i64,
    character_id: Option<String>,
    conversation_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            size INTEGER NOT NULL DEFAULT 0,
            data TEXT NOT NULL,
            character_id TEXT,
            conversation_id TEXT,
            created_at TEXT NOT NULL
        )",
        [],
    ).map_err(|e| e.to_string())?;

    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let now = chrono::Utc::now().to_rfc3339();

    // Dedup: check if a file with same filename + size already exists
    let existing_count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM files WHERE filename = ?1 AND size = ?2",
            rusqlite::params![filename, size],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let existing = existing_count > 0;

    if existing {
        // Update existing record instead of creating duplicate
        db.execute(
            "UPDATE files SET data = ?1, mime_type = ?2, character_id = ?3, conversation_id = ?4, created_at = ?5 WHERE filename = ?6 AND size = ?7",
            rusqlite::params![decoded, mime_type, character_id, conversation_id, now, filename, size],
        ).map_err(|e| e.to_string())?;
        return Ok(());
    }

    db.execute(
        "INSERT OR REPLACE INTO files (id, filename, mime_type, size, data, character_id, conversation_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            id,
            filename,
            mime_type,
            size,
            decoded,
            character_id,
            conversation_id,
            now,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
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
    for r in rows {
        if let Ok(r) = r {
            let mt = r["mimeType"].as_str().unwrap_or("unknown").to_string();
            let key = mt.split('/').next().unwrap_or("unknown").to_string();
            let entry = by_type.entry(key).or_insert(serde_json::json!({"count": 0, "size": 0}));
            if let Some(obj) = entry.as_object_mut() {
                obj["count"] = serde_json::json!(obj["count"].as_i64().unwrap_or(0) + r["count"].as_i64().unwrap_or(0));
                obj["size"] = serde_json::json!(obj["size"].as_i64().unwrap_or(0) + r["size"].as_i64().unwrap_or(0));
            }
        }
    }

    Ok(serde_json::json!({
        "total": total,
        "totalSize": total_size,
        "byType": by_type,
    }))
}

// ========== Bot Integrations ==========

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
            "SELECT id, integration_id, external_user_id, external_user_name, character_id, conversation_id, created_at, updated_at FROM bot_conversations WHERE integration_id = ?1".into(),
            vec![Box::new(iid)],
        ),
        None => (
            "SELECT id, integration_id, external_user_id, external_user_name, character_id, conversation_id, created_at, updated_at FROM bot_conversations".into(),
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
        }))
    }).map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn save_bot_conversation(app: AppHandle, conversation: Value) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    let id = conversation["id"].as_str().unwrap_or("");
    let integration_id = conversation["integrationId"].as_str().unwrap_or("");
    let external_user_id = conversation["externalUserId"].as_str().unwrap_or("");
    let external_user_name = conversation["externalUserName"].as_str().unwrap_or("");
    let character_id = conversation["characterId"].as_str().unwrap_or("");
    let conversation_id = conversation["conversationId"].as_str().unwrap_or("");
    let now = chrono::Utc::now().to_rfc3339();

    db.execute(
        "INSERT OR REPLACE INTO bot_conversations (id, integration_id, external_user_id, external_user_name, character_id, conversation_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE((SELECT created_at FROM bot_conversations WHERE id = ?1), ?7), ?7)",
        rusqlite::params![id, integration_id, external_user_id, external_user_name, character_id, conversation_id, now],
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
                _ => "unknown".to_string(),
            }
        };

        integration["status"] = Value::String(status);
        integration
    }).collect();

    Ok(statuses)
}

#[tauri::command]
pub async fn download_and_save_file(app: AppHandle, url: String, character_id: Option<String>, conversation_id: Option<String>) -> Result<Value, String> {
    use std::time::{SystemTime, UNIX_EPOCH};

    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let mime_type = response.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let data = response.bytes().await.map_err(|e| e.to_string())?;
    let filename = url.split('/').last().unwrap_or("file").to_string();
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let id = format!("file-{}-{:x}", t.as_millis(), t.as_nanos() & 0xffff);
    let now = format!("{}", t.as_secs());

    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute(
        "CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, filename TEXT, mime_type TEXT, size INTEGER, data BLOB, character_id TEXT, conversation_id TEXT, created_at TEXT)",
        [],
    ).map_err(|e| e.to_string())?;

    db.execute(
        "INSERT INTO files (id, filename, mime_type, size, data, character_id, conversation_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![id, filename, mime_type, data.len() as i64, data.as_ref(), character_id.unwrap_or_default(), conversation_id.unwrap_or_default(), now],
    ).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "fileId": id }))
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
        "SELECT avatar, nickname, age, gender, personality, background, interests, habits, notes FROM user_profile WHERE id = 'default'",
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
        })),
    }
}

#[tauri::command]
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
) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;

    db.execute(
        "INSERT OR REPLACE INTO user_profile (id, avatar, nickname, age, gender, personality, background, interests, habits, notes) VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![avatar, nickname, age, gender, personality, background, interests, habits, notes],
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
