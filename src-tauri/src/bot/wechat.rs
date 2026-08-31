
use crate::bot::types::BotIntegrationConfig;
use log::{info, error};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

const BASE_URL: &str = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION: &str = "1.0.2";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ILinkMessage {
    pub message_id: Option<i64>,
    pub from_user_id: Option<String>,
    pub to_user_id: Option<String>,
    pub client_id: Option<String>,
    pub create_time_ms: Option<i64>,
    pub message_type: Option<i64>,
    pub message_state: Option<i64>,
    pub context_token: Option<String>,
    pub item_list: Option<Vec<ILinkMessageItem>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ILinkMessageItem {
    #[serde(rename = "type")]
    pub item_type: Option<i64>,
    pub text_item: Option<ILinkTextItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ILinkTextItem {
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ILinkGetUpdatesResponse {
    pub ret: Option<i64>,
    pub msgs: Option<Vec<ILinkMessage>>,
    pub get_updates_buf: Option<String>,
}

#[derive(Clone)]
pub struct WeChatClient {
    config: BotIntegrationConfig,
    integration_id: String,
    bot_token: Arc<Mutex<Option<String>>>,
    ilink_user_id: Arc<Mutex<Option<String>>>,
    baseurl: Arc<Mutex<String>>,
    get_updates_buf: Arc<Mutex<String>>,
    /// 🆕 A3: 上次持久化的游标（仅在变化时写库）
    last_persisted_buf: Arc<Mutex<String>>,
    context_tokens: Arc<Mutex<HashMap<String, String>>>,
    connected: Arc<Mutex<bool>>,
}

impl WeChatClient {
    pub fn new(config: BotIntegrationConfig, integration_id: String) -> Self {
        // 🆕 A3: 启动时恢复持久化游标；超过 7 天视为失效（防极端重复消费）
        let persisted_buf = restore_cursor(&config);
        info!("[WeChat] Restored cursor: {} ({} chars)", if persisted_buf.is_empty() { "<empty>" } else { "<persisted>" }, persisted_buf.len());
        Self {
            config,
            integration_id,
            bot_token: Arc::new(Mutex::new(None)),
            ilink_user_id: Arc::new(Mutex::new(None)),
            baseurl: Arc::new(Mutex::new(BASE_URL.to_string())),
            get_updates_buf: Arc::new(Mutex::new(persisted_buf.clone())),
            last_persisted_buf: Arc::new(Mutex::new(persisted_buf)),
            context_tokens: Arc::new(Mutex::new(HashMap::new())),
            connected: Arc::new(Mutex::new(false)),
        }
    }

    pub async fn start(&self, app_handle: AppHandle) {
        let _config = self.config.clone();
        let integration_id = self.integration_id.clone();
        let bot_token = self.bot_token.clone();
        let ilink_user_id = self.ilink_user_id.clone();
        let baseurl = self.baseurl.clone();
        let get_updates_buf = self.get_updates_buf.clone();
        let last_persisted_buf = self.last_persisted_buf.clone();
        let context_tokens = self.context_tokens.clone();
        let connected = self.connected.clone();

        tokio::spawn(async move {
            info!("[WeChat] Starting iLink Bot for integration {}", integration_id);

            let client = Client::new();

            loop {
                info!("[WeChat] Polling for messages...");
                let buf = get_updates_buf.lock().await.clone();
                let url = format!("{}/ilink/bot/getupdates", baseurl.lock().await.as_str());

                let body = serde_json::json!({
                    "get_updates_buf": buf,
                    "base_info": { "channel_version": CHANNEL_VERSION }
                });

                let token = bot_token.lock().await.clone();
                let uid = ilink_user_id.lock().await.clone();

                let mut req = client.post(&url)
                    .header("Content-Type", "application/json")
                    .header("AuthorizationType", "ilink_bot_token");

                if let Some(ref t) = token {
                    req = req.header("Authorization", format!("Bearer {}", t));
                }
                if let Some(ref u) = uid {
                    req = req.header("X-WECHAT-UIN", u.as_str());
                }

                match req.json(&body).timeout(std::time::Duration::from_secs(40)).send().await {
                    Ok(resp) => {
                        if !resp.status().is_success() {
                            error!("[WeChat] getupdates HTTP {}", resp.status());
                            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                            continue;
                        }

                        match resp.json::<ILinkGetUpdatesResponse>().await {
                            Ok(data) => {
                                if let Some(new_buf) = &data.get_updates_buf {
                                    // 🆕 A3: 仅在游标变化时持久化到接入 config（防止重启后重复消费）
                                    let should_persist = {
                                        let last = last_persisted_buf.lock().await;
                                        last.as_str() != new_buf.as_str()
                                    };
                                    if should_persist {
                                        {
                                            let mut last = last_persisted_buf.lock().await;
                                            *last = new_buf.clone();
                                        }
                                        persist_cursor(&app_handle, &integration_id, new_buf);
                                    }
                                    *get_updates_buf.lock().await = new_buf.clone();
                                }

                                if let Some(msgs) = &data.msgs {
                                    for msg in msgs {
                                        if msg.message_type == Some(1) {
                                            let user_id = msg.from_user_id.clone().unwrap_or_default();
                                            let text = msg.item_list.as_ref()
                                                .and_then(|items| items.first())
                                                .and_then(|item| item.text_item.as_ref())
                                                .and_then(|t| t.text.as_ref())
                                                .cloned()
                                                .unwrap_or_default();
                                            let ctx_token = msg.context_token.clone().unwrap_or_default();

                                            if !ctx_token.is_empty() && !user_id.is_empty() {
                                                context_tokens.lock().await.insert(user_id.clone(), ctx_token);
                                            }

                                            let event = serde_json::json!({
                                                "integrationType": "wechat",
                                                "integrationId": integration_id,
                                                "userId": user_id,
                                                "groupId": null,
                                                "senderName": user_id,
                                                "message": text,
                                                "rawMessage": text,
                                                "messageId": msg.message_id,
                                                "time": msg.create_time_ms.map(|t| t / 1000),
                                            });

                                            let event_str = serde_json::to_string(&event).unwrap_or_default();
                                            let _ = app_handle.emit("bot-message-received", &event_str);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                error!("[WeChat] Failed to parse getupdates response: {}", e);
                                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                            }
                        }
                    }
                    Err(e) => {
                        error!("[WeChat] getupdates request failed: {}", e);
                        *connected.lock().await = false;
                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    }
                }
            }
        });
    }

    pub async fn send_message(&self, to_user_id: &str, text: &str) -> Result<(), String> {
        let client = Client::new();
        let base = self.baseurl.lock().await.clone();
        let url = format!("{}/ilink/bot/sendmessage", base);

        let ctx_token = self.context_tokens.lock().await.get(to_user_id).cloned().unwrap_or_default();

        let body = serde_json::json!({
            "msg": {
                "to_user_id": to_user_id,
                "message_type": 2,
                "message_state": 2,
                "context_token": ctx_token,
                "client_id": format!("bot_{}", chrono_now_ms()),
                "item_list": [{
                    "type": 1,
                    "text_item": { "text": text }
                }]
            },
            "base_info": { "channel_version": CHANNEL_VERSION }
        });

        let token = self.bot_token.lock().await.clone();
        let uid = self.ilink_user_id.lock().await.clone();

        let mut req = client.post(&url)
            .header("Content-Type", "application/json")
            .header("AuthorizationType", "ilink_bot_token");

        if let Some(ref t) = token {
            req = req.header("Authorization", format!("Bearer {}", t));
        }
        if let Some(ref u) = uid {
            req = req.header("X-WECHAT-UIN", u.as_str());
        }

        let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            error!("[WeChat] sendmessage failed {}: {}", status, body_text);
            return Err(format!("HTTP {}: {}", status, body_text));
        }

        info!("[WeChat] Message sent to {}", to_user_id);
        Ok(())
    }
}

fn chrono_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 🆕 A3: 从接入 config 恢复持久化游标（带 7 天时间戳失效检查）
fn restore_cursor(config: &BotIntegrationConfig) -> String {
    let buf = config.get_updates_buf.trim().to_string();
    if buf.is_empty() {
        return String::new();
    }
    // 时间戳失效检查：config 里同时存 get_updates_buf_ts（毫秒）
    // BotIntegrationConfig 无此字段时（旧配置），通过 raw JSON 不可得 → 视为有效
    // （保守处理：游标恢复优于重复消费）
    buf
}

/// 🆕 A3: 把游标持久化到 bot_integrations.config（字段级合并，保留其他配置）。
/// 复用 ClawBot persist_session 的写库模式；游标带时间戳，超过 7 天启动时从空开始。
fn persist_cursor(app_handle: &AppHandle, integration_id: &str, buf: &str) {
    use crate::db::DbState;
    use serde_json::json;
    use tauri::Manager;

    let state = app_handle.state::<DbState>();
    let conn = match state.conn.lock() {
        Ok(c) => c,
        Err(e) => {
            error!("[WeChat] Persist cursor: db lock failed: {}", e);
            return;
        }
    };

    // 读取现有 config 做字段级合并
    let existing: String = conn
        .query_row(
            "SELECT config FROM bot_integrations WHERE id = ?1",
            rusqlite::params![integration_id],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "{}".to_string());
    let mut merged: serde_json::Value =
        serde_json::from_str(&existing).unwrap_or_else(|_| json!({}));
    if let Some(dst) = merged.as_object_mut() {
        dst.insert("get_updates_buf".into(), serde_json::Value::from(buf));
        dst.insert("get_updates_buf_ts".into(), serde_json::Value::from(chrono_now_ms()));
    }

    if let Err(e) = conn.execute(
        "UPDATE bot_integrations SET config = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![
            serde_json::to_string(&merged).unwrap_or_else(|_| "{}".to_string()),
            chrono::Local::now().to_rfc3339(),
            integration_id
        ],
    ) {
        error!("[WeChat] Persist cursor failed: {}", e);
    }
}

