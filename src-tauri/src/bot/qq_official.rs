
//! QQ 开放平台官方机器人（qq.qbot.com / q.qq.com）接入客户端
//!
//! 协议流程：
//! 1. POST https://bots.qq.com/app/getAppAccessToken 获取 access_token（有效期约 7200s）
//! 2. GET  https://api.sgroup.qq.com/gateway 获取 WSS 网关地址
//! 3. 连接网关：op=10 Hello（含心跳间隔）→ op=2 Identify（QQBot token + intents）
//!    → 定时 op=1 Heartbeat（d=最新 s）→ op=11 ACK
//! 4. op=0 Dispatch 事件：GROUP_AT_MESSAGE_CREATE（群@）、C2C_MESSAGE_CREATE（单聊）、
//!    DIRECT_MESSAGE_CREATE（私信）
//! 5. 发消息：POST /v2/groups/{group_openid}/messages 或 /v2/users/{openid}/messages，
//!    优先携带收到的 msg_id 做被动回复（5 分钟内有效），msg_seq 递增防重

use crate::bot::types::BotIntegrationConfig;
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

const API_BASE: &str = "https://api.sgroup.qq.com";
const TOKEN_URL: &str = "https://bots.qq.com/app/getAppAccessToken";
/// intents: 群与单聊事件 (1<<25) | 私信事件 (1<<12)
const INTENTS: i64 = (1 << 25) | (1 << 12);
/// 被动回复 msg_id 有效期（毫秒），官方 5 分钟
const MSG_ID_TTL_MS: i64 = 5 * 60 * 1000;
/// access_token 提前刷新窗口（毫秒）
const TOKEN_REFRESH_EARLY_MS: i64 = 5 * 60 * 1000;
/// 读循环空闲超时：期间检查停止信号
const READ_IDLE_TIMEOUT: Duration = Duration::from_secs(15);
/// 断线重连间隔
const RECONNECT_DELAY: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct QqOfficialClient {
    config: BotIntegrationConfig,
    integration_id: String,
    /// (access_token, 过期时间戳 ms)
    access_token: Arc<Mutex<Option<(String, i64)>>>,
    /// 网关下发的最新心跳序号
    last_seq: Arc<Mutex<i64>>,
    running: Arc<Mutex<bool>>,
    connected: Arc<Mutex<bool>>,
    /// openid -> (msg_id, 接收时间 ms)：被动回复凭证
    msg_ids: Arc<Mutex<HashMap<String, (String, i64)>>>,
    /// 发送序号，同一条 msg_id 下递增防重
    msg_seq: Arc<Mutex<i64>>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

impl QqOfficialClient {
    pub fn new(config: BotIntegrationConfig, integration_id: String) -> Self {
        Self {
            config,
            integration_id,
            access_token: Arc::new(Mutex::new(None)),
            last_seq: Arc::new(Mutex::new(-1)),
            running: Arc::new(Mutex::new(false)),
            connected: Arc::new(Mutex::new(false)),
            msg_ids: Arc::new(Mutex::new(HashMap::new())),
            msg_seq: Arc::new(Mutex::new(1)),
        }
    }

    pub async fn is_connected(&self) -> bool {
        *self.connected.lock().await
    }

    pub async fn is_running(&self) -> bool {
        *self.running.lock().await
    }

    pub async fn stop(&self) {
        *self.running.lock().await = false;
        *self.connected.lock().await = false;
        info!("[QQ Official] Stop signal sent for {}", self.integration_id);
    }

    /// 启动：后台任务循环连接网关，断线自动重连
    pub async fn start(&self, app_handle: AppHandle) {
        if *self.running.lock().await {
            warn!("[QQ Official] {} already running", self.integration_id);
            return;
        }
        *self.running.lock().await = true;

        let client = self.clone();
        tokio::spawn(async move {
            info!("[QQ Official] Starting for integration {}", client.integration_id);
            let _ = client.emit_status(&app_handle, "listening", "正在连接 QQ 开放平台...").await;

            while *client.running.lock().await {
                match client.run_session(&app_handle).await {
                    Ok(_) => info!("[QQ Official] Session ended"),
                    Err(e) => {
                        error!("[QQ Official] Session error: {}", e);
                        *client.connected.lock().await = false;
                        let _ = client.emit_status(&app_handle, "reconnecting", &format!("连接异常: {}，{}秒后重连", e, RECONNECT_DELAY.as_secs())).await;
                    }
                }
                if !*client.running.lock().await {
                    break;
                }
                tokio::time::sleep(RECONNECT_DELAY).await;
            }

            let _ = client.emit_status(&app_handle, "stopped", "QQ 开放平台接入已停止").await;
            info!("[QQ Official] Stopped {}", client.integration_id);
        });
    }

    async fn emit_status(&self, app_handle: &AppHandle, status: &str, message: &str) -> Result<(), String> {
        let payload = json!({
            "integrationId": self.integration_id,
            "status": status,
            "message": message,
        })
        .to_string();
        app_handle
            .emit("bot-status", &payload)
            .map_err(|e| e.to_string())
    }

    /// 获取/刷新 access_token（过期前提前刷新）
    async fn ensure_token(&self, http: &Client) -> Result<String, String> {
        {
            let guard = self.access_token.lock().await;
            if let Some((token, expire_at)) = guard.as_ref() {
                if now_ms() < expire_at - TOKEN_REFRESH_EARLY_MS {
                    return Ok(token.clone());
                }
            }
        }

        let app_id = self.config.app_id.trim().to_string();
        let secret = self.config.client_secret.trim().to_string();
        if app_id.is_empty() || secret.is_empty() {
            return Err("未配置 AppID / AppSecret，请在接入管理中填写".to_string());
        }

        let resp = http
            .post(TOKEN_URL)
            .header("Content-Type", "application/json")
            .json(&json!({ "appId": app_id, "clientSecret": secret }))
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("获取 access_token 失败: {}", e))?;

        let status = resp.status();
        let body: Value = resp.json().await.map_err(|e| format!("解析 token 响应失败: {}", e))?;
        if !status.is_success() {
            let msg = body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("未知错误");
            return Err(format!("获取 access_token 失败 (HTTP {}): {}", status.as_u16(), msg));
        }

        let token = body
            .get("access_token")
            .and_then(|t| t.as_str())
            .ok_or("token 响应缺少 access_token")?
            .to_string();
        let expires_in: i64 = body
            .get("expires_in")
            .and_then(|e| e.as_str().and_then(|s| s.parse().ok()).or_else(|| e.as_i64()))
            .unwrap_or(7200);

        let expire_at = now_ms() + expires_in * 1000;
        info!("[QQ Official] access_token refreshed, expires in {}s", expires_in);
        *self.access_token.lock().await = Some((token.clone(), expire_at));
        Ok(token)
    }

    /// 单次网关会话：连接 → 鉴权 → 收发事件，返回即断线
    async fn run_session(&self, app_handle: &AppHandle) -> Result<(), String> {
        let http = Client::new();

        // 1. 网关地址
        let token = self.ensure_token(&http).await?;
        let gw_resp = http
            .get(format!("{}/gateway", API_BASE))
            .header("Authorization", format!("QQBot {}", token))
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("获取网关失败: {}", e))?;
        if !gw_resp.status().is_success() {
            return Err(format!("获取网关失败: HTTP {}", gw_resp.status().as_u16()));
        }
        let gw: Value = gw_resp.json().await.map_err(|e| format!("解析网关响应失败: {}", e))?;
        let gateway_url = gw
            .get("url")
            .and_then(|u| u.as_str())
            .ok_or("网关响应缺少 url")?
            .to_string();

        // 2. 连接 WSS 网关
        info!("[QQ Official] Connecting gateway: {}", gateway_url);
        let (ws, _) = connect_async(&gateway_url)
            .await
            .map_err(|e| format!("连接网关失败: {}", e))?;
        let (sink, mut stream) = ws.split();
        let sink = Arc::new(Mutex::new(sink));
        *self.connected.lock().await = true;
        let _ = self.emit_status(app_handle, "connected", "已连接 QQ 开放平台网关").await;

        // 3. Hello (op=10) → Identify (op=2)
        let hello = self
            .recv_json(&mut stream)
            .await
            .ok_or_else(|| "网关未发送 Hello".to_string())?;
        if hello.get("op").and_then(|o| o.as_i64()) != Some(10) {
            return Err(format!("网关首帧非 Hello: {}", hello));
        }
        let heartbeat_ms = hello
            .pointer("/d/heartbeat_interval")
            .and_then(|v| v.as_u64())
            .unwrap_or(30000) as u64;
        *self.last_seq.lock().await = hello.get("s").and_then(|s| s.as_i64()).unwrap_or(-1);

        let identify = json!({
            "op": 2,
            "d": {
                "token": format!("QQBot {}", self.access_token.lock().await.clone().map(|(t, _)| t).unwrap_or_default()),
                "intents": INTENTS,
                "shard": [0, 1],
            }
        });
        {
            let mut guard = sink.lock().await;
            guard
                .send(WsMessage::Text(identify.to_string()))
                .await
                .map_err(|e| format!("发送 Identify 失败: {}", e))?;
        }
        info!("[QQ Official] Identified, heartbeat every {}ms", heartbeat_ms);

        // 4. 心跳任务（op=1, d=最新 s）
        let heartbeat_last_seq = self.last_seq.clone();
        let heartbeat_running = self.running.clone();
        let heartbeat_sink = sink.clone();
        let heartbeat_task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(heartbeat_ms));
            interval.tick().await; // 第一次立即跳过（Identify 后官方要求立即发一次心跳）
            loop {
                interval.tick().await;
                if !*heartbeat_running.lock().await {
                    break;
                }
                let seq = *heartbeat_last_seq.lock().await;
                let frame = json!({ "op": 1, "d": if seq < 0 { Value::Null } else { Value::from(seq) } }).to_string();
                let mut guard = heartbeat_sink.lock().await;
                if tokio::time::timeout(Duration::from_secs(10), guard.send(WsMessage::Text(frame)))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });

        // 5. 读循环
        let result = self.read_loop(&mut stream, app_handle).await;

        heartbeat_task.abort();
        *self.connected.lock().await = false;
        {
            let mut guard = sink.lock().await;
            let _ = guard.close().await;
        }
        result
    }

    async fn recv_json<S>(&self, stream: &mut S) -> Option<Value>
    where
        S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>> + Unpin,
    {
        loop {
            match tokio::time::timeout(READ_IDLE_TIMEOUT, stream.next()).await {
                Ok(Some(Ok(WsMessage::Text(text)))) => match serde_json::from_str(&text) {
                    Ok(v) => return Some(v),
                    Err(e) => warn!("[QQ Official] Bad JSON frame: {}", e),
                },
                Ok(Some(Ok(WsMessage::Ping(_) | WsMessage::Pong(_) | WsMessage::Binary(_)))) => continue,
                Ok(Some(Ok(_))) => continue,
                Ok(Some(Err(e))) => {
                    error!("[QQ Official] WS read error: {}", e);
                    return None;
                }
                Ok(None) => return None,
                Err(_) => return None, // 空闲超时
            }
        }
    }

    async fn read_loop<S>(&self, stream: &mut S, app_handle: &AppHandle) -> Result<(), String>
    where
        S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>> + Unpin,
    {
        loop {
            if !*self.running.lock().await {
                return Ok(());
            }
            let frame = self.recv_json(stream).await.ok_or("网关连接断开")?;
            let op = frame.get("op").and_then(|o| o.as_i64()).unwrap_or(-1);
            if let Some(s) = frame.get("s").and_then(|s| s.as_i64()) {
                *self.last_seq.lock().await = s;
            }

            match op {
                0 => {
                    let event_type = frame.get("t").and_then(|t| t.as_str()).unwrap_or("");
                    if let Some(data) = frame.get("d").cloned() {
                        self.handle_dispatch(event_type, data, app_handle).await;
                    }
                }
                7 => return Err("网关要求重连 (op=7)".to_string()),
                9 => return Err("会话无效 (op=9)，将重新 Identify".to_string()),
                11 => {} // 心跳 ACK
                10 => {} // 重连后的新 Hello（理论上不会走到，run_session 每次新会话）
                _ => {}
            }
        }
    }

    /// 解析事件并转发到统一消息管线（emit bot-message-received）
    async fn handle_dispatch(&self, event_type: &str, data: Value, app_handle: &AppHandle) {
        let (user_id, group_id, content, msg_id, sender_name) = match event_type {
            // 群@消息
            "GROUP_AT_MESSAGE_CREATE" => (
                data.pointer("/author/member_openid")
                    .or_else(|| data.pointer("/author/id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                data.get("group_openid").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                data.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                String::new(),
            ),
            // 单聊消息
            "C2C_MESSAGE_CREATE" => (
                data.get("user_openid")
                    .or_else(|| data.pointer("/author/id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                String::new(),
                data.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                String::new(),
            ),
            // 好友私信（频道）
            "DIRECT_MESSAGE_CREATE" | "AT_MESSAGE_CREATE" => (
                data.pointer("/author/id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                data.get("channel_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                data.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                data.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                data.pointer("/author/username").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            ),
            _ => return,
        };

        if user_id.is_empty() {
            return;
        }
        let text = content.trim().to_string();
        if text.is_empty() {
            return;
        }

        // 缓存被动回复凭证（同 openid 只留最新）
        if !msg_id.is_empty() {
            self.msg_ids
                .lock()
                .await
                .insert(user_id.clone(), (msg_id.clone(), now_ms()));
        }

        let display_name = if sender_name.is_empty() { user_id.clone() } else { sender_name };
        let event = json!({
            "integrationType": "qq_official",
            "integrationId": self.integration_id,
            "userId": user_id,
            "groupId": if group_id.is_empty() { Value::Null } else { Value::from(group_id) },
            "senderName": display_name,
            "message": text,
            "rawMessage": text,
            "messageId": msg_id,
            "time": now_ms() / 1000,
        });
        let event_str = event.to_string();
        info!("[QQ Official] Message from {} ({}): {}", display_name, event_type, &text[..text.len().min(50)]);
        let _ = app_handle.emit("bot-message-received", &event_str);
    }

    /// 发送文本消息：群（group_openid）或单聊（openid），优先被动回复
    pub async fn send_message(&self, openid: &str, group_openid: Option<&str>, text: &str) -> Result<(), String> {
        if openid.is_empty() {
            return Err("openid 为空".to_string());
        }
        let http = Client::new();
        let token = self.ensure_token(&http).await?;

        let url = match group_openid {
            Some(g) if !g.is_empty() => format!("{}/v2/groups/{}/messages", API_BASE, g),
            _ => format!("{}/v2/users/{}/messages", API_BASE, openid),
        };

        // 被动回复凭证：5 分钟内有效
        let mut msg_id = String::new();
        {
            let guard = self.msg_ids.lock().await;
            if let Some((mid, ts)) = guard.get(openid) {
                if now_ms() - ts < MSG_ID_TTL_MS {
                    msg_id = mid.clone();
                }
            }
        }

        let seq = {
            let mut s = self.msg_seq.lock().await;
            *s += 1;
            *s
        };

        let mut body = json!({
            "content": text,
            "msg_type": 0,
            "msg_seq": seq,
        });
        if !msg_id.is_empty() {
            body["msg_id"] = Value::from(msg_id);
        }

        let resp = http
            .post(&url)
            .header("Authorization", format!("QQBot {}", token))
            .header("Content-Type", "application/json")
            .json(&body)
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("发送失败: {}", e))?;

        let status = resp.status();
        let resp_text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            error!("[QQ Official] Send failed HTTP {}: {}", status.as_u16(), &resp_text[..resp_text.len().min(300)]);
            return Err(format!("发送失败 HTTP {}: {}", status.as_u16(), resp_text));
        }
        info!("[QQ Official] Message sent to {}", openid);
        Ok(())
    }
}
