
//! 微信 ClawBot 接入客户端（iLink 官方协议 · 扫码授权）
//!
//! 对齐腾讯 `@tencent-weixin/openclaw-weixin` 的公开 HTTP 行为：
//! - 登录：GET {base}/ilink/bot/get_bot_qrcode?bot_type=3 取二维码，
//!   轮询 GET /ilink/bot/get_qrcode_status 直到 confirmed（支持 IDC 重定向 / 过期刷新）
//! - 收信：POST /ilink/bot/getupdates 长轮询（35s），回传 get_updates_buf 游标
//! - 发信：POST /ilink/bot/sendmessage（Bearer Token + X-WECHAT-UIN 防重放头）
//! - 会话持久化：bot_token / baseurl / 游标写回 bot_integrations.config，重启直接复用；
//!   errcode=-14（会话超时）时自动回到扫码流程

use crate::bot::types::BotIntegrationConfig;
use base64::Engine;
use log::{error, info, warn};
use rand::Rng;
use reqwest::Client;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

/// 官方默认接入域名
const DEFAULT_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
/// 对齐的客户端协议版本（base_info.channel_version）
const CHANNEL_VERSION: &str = "2.4.6";
/// iLink-App-ClientVersion：0x00MMNNPP 编码（2.4.6 -> 132106）
const CLIENT_VERSION_U32: u32 = (2 << 16) | (4 << 8) | 6;

#[derive(Clone)]
pub struct ClawbotClient {
    integration_id: String,
    running: Arc<Mutex<bool>>,
    /// 登录态（扫码成功后更新）
    session: Arc<Mutex<IlirkSession>>,
    /// 每个会话最近一次的 context_token（回复时回传）
    context_tokens: Arc<Mutex<HashMap<String, String>>>,
    /// 已分发的 message_id 去重（防止流式多次推送重复处理）
    dispatched: Arc<Mutex<Vec<String>>>,
    /// 上次持久化到 DB 的游标（避免重复写库）
    last_persisted_buf: Arc<Mutex<String>>,
    http: Client,
}

#[derive(Default, Clone)]
struct IlirkSession {
    bot_token: String,
    bot_id: String,
    base_url: String,
    updates_buf: String,
}

impl IlirkSession {
    fn is_valid(&self) -> bool {
        !self.bot_token.is_empty() && !self.base_url.is_empty()
    }
}

fn pick_str(data: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(v) = data.get(*key) {
            let s = match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => continue,
            };
            if !s.is_empty() {
                return s;
            }
        }
    }
    String::new()
}

impl ClawbotClient {
    pub fn new(config: BotIntegrationConfig, integration_id: String) -> Self {
        let session = IlirkSession {
            bot_token: config.bot_token.clone(),
            bot_id: config.ilink_bot_id.clone(),
            base_url: if config.base_url.is_empty() {
                DEFAULT_BASE_URL.to_string()
            } else {
                config.base_url.clone()
            },
            updates_buf: config.get_updates_buf.clone(),
        };
        let http = Client::builder()
            .timeout(Duration::from_secs(45))
            .build()
            .unwrap_or_default();
        Self {
            integration_id,
            running: Arc::new(Mutex::new(false)),
            session: Arc::new(Mutex::new(session)),
            context_tokens: Arc::new(Mutex::new(HashMap::new())),
            dispatched: Arc::new(Mutex::new(Vec::new())),
            last_persisted_buf: Arc::new(Mutex::new(String::new())),
            http,
        }
    }

    pub async fn is_running(&self) -> bool {
        *self.running.lock().await
    }

    pub async fn stop(&self) {
        *self.running.lock().await = false;
        info!("[ClawBot] Stop signal sent for {}", self.integration_id);
    }

    pub async fn start(&self, app_handle: AppHandle) {
        if *self.running.lock().await {
            warn!("[ClawBot] {} already running", self.integration_id);
            return;
        }
        *self.running.lock().await = true;

        let client = self.clone();
        tokio::spawn(async move {
            client.run(&app_handle).await;
            let _ = app_handle.emit("bot-status", json!({
                "integrationId": client.integration_id,
                "status": "stopped",
                "message": "ClawBot 已停止",
            }).to_string());
            info!("[ClawBot] Client stopped {}", client.integration_id);
        });
    }

    /// 主循环：有会话直接长轮询；无会话 / 会话失效则走扫码登录
    async fn run(&self, app_handle: &AppHandle) {
        loop {
            if !*self.running.lock().await {
                return;
            }

            // 无有效会话 -> 扫码登录
            if !self.session.lock().await.is_valid() {
                match self.qr_login(app_handle).await {
                    Ok(true) => {
                        // 登录成功，持久化后进入长轮询
                        self.persist_session(app_handle).await;
                        let _ = app_handle.emit("bot-status", json!({
                            "integrationId": self.integration_id,
                            "status": "connected",
                            "message": "微信扫码登录成功，开始接收消息",
                        }).to_string());
                    }
                    Ok(false) => {
                        // 用户主动停止
                        return;
                    }
                    Err(e) => {
                        error!("[ClawBot] QR login failed: {}", e);
                        let _ = app_handle.emit("bot-status", json!({
                            "integrationId": self.integration_id,
                            "status": "error",
                            "message": format!("扫码登录失败: {}，60 秒后重试", e),
                        }).to_string());
                        // 等待 60s 重试，期间响应停止信号
                        for _ in 0..60 {
                            if !*self.running.lock().await {
                                return;
                            }
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
                        continue;
                    }
                }
            }

            // 长轮询收消息
            match self.long_poll_loop(app_handle).await {
                LongPollOutcome::Stopped => return,
                // 会话失效（-14 / 401）：清空会话回到扫码
                LongPollOutcome::SessionExpired => {
                    warn!("[ClawBot] Session expired, re-login required");
                    let mut s = self.session.lock().await;
                    s.bot_token.clear();
                    s.updates_buf.clear();
                    let _ = app_handle.emit("bot-status", json!({
                        "integrationId": self.integration_id,
                        "status": "reconnecting",
                        "message": "微信会话已失效，请重新扫码",
                    }).to_string());
                }
                LongPollOutcome::Fatal(e) => {
                    error!("[ClawBot] Long poll fatal: {}", e);
                    let _ = app_handle.emit("bot-status", json!({
                        "integrationId": self.integration_id,
                        "status": "error",
                        "message": format!("连接异常: {}，30 秒后重试", e),
                    }).to_string());
                    for _ in 0..30 {
                        if !*self.running.lock().await {
                            return;
                        }
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }
                }
            }
        }
    }

    // ================= 扫码登录 =================

    /// 二维码扫码登录。返回 Ok(true)=登录成功，Ok(false)=用户停止
    async fn qr_login(&self, app_handle: &AppHandle) -> Result<bool, String> {
        let mut refresh_count = 0;
        loop {
            if !*self.running.lock().await {
                return Ok(false);
            }

            // 步骤 1：取二维码
            let (qrcode, qr_img) = self.fetch_qrcode().await?;
            let _ = app_handle.emit("clawbot-qrcode", json!({
                "integrationId": self.integration_id,
                "qrcodeImg": qr_img,
            }).to_string());
            let _ = app_handle.emit("bot-status", json!({
                "integrationId": self.integration_id,
                "status": "waiting_scan",
                "message": "二维码已生成，请用手机微信扫码",
            }).to_string());
            info!("[ClawBot] QR code fetched for {}", self.integration_id);

            // 步骤 2：轮询扫码状态（二维码约 5 分钟有效）
            let mut poll_host = DEFAULT_BASE_URL.to_string();
            loop {
                if !*self.running.lock().await {
                    return Ok(false);
                }
                tokio::time::sleep(Duration::from_secs(2)).await;
                let status = self.poll_qrcode_status(&poll_host, &qrcode).await?;
                match status.as_str() {
                    "wait" => {
                        let _ = app_handle.emit("clawbot-login-status", json!({
                            "integrationId": self.integration_id,
                            "status": "wait",
                        }).to_string());
                    }
                    "scaned" => {
                        let _ = app_handle.emit("clawbot-login-status", json!({
                            "integrationId": self.integration_id,
                            "status": "scaned",
                        }).to_string());
                        let _ = app_handle.emit("bot-status", json!({
                            "integrationId": self.integration_id,
                            "status": "scanned",
                            "message": "已扫码，请在手机上确认登录",
                        }).to_string());
                    }
                    "scaned_but_redirect" => {
                        // IDC 重定向：切换轮询 host 继续
                        if let Ok(v) = self
                            .http
                            .get(format!("{}/ilink/bot/get_qrcode_status", poll_host))
                            .query(&[("qrcode", qrcode.as_str())])
                            .header("iLink-App-Id", "bot")
                            .header("iLink-App-ClientVersion", CLIENT_VERSION_U32.to_string())
                            .timeout(Duration::from_secs(35))
                            .send()
                            .await
                        {
                            if let Ok(j) = v.json::<Value>().await {
                                if let Some(host) = j.get("redirect_host").and_then(|h| h.as_str()) {
                                    poll_host = format!("https://{}", host.trim_start_matches("https://"));
                                    info!("[ClawBot] IDC redirect to {}", poll_host);
                                }
                            }
                        }
                    }
                    "expired" => {
                        refresh_count += 1;
                        if refresh_count > 3 {
                            return Err("二维码多次过期，登录取消".into());
                        }
                        warn!("[ClawBot] QR expired, refreshing ({}/3)", refresh_count);
                        let _ = app_handle.emit("clawbot-login-status", json!({
                            "integrationId": self.integration_id,
                            "status": "expired",
                        }).to_string());
                        break; // 重新取码
                    }
                    "confirmed" => {
                        // 登录成功：取会话凭证
                        let confirmed = self.fetch_confirmed(&poll_host, &qrcode).await?;
                        let mut s = self.session.lock().await;
                        s.bot_token = confirmed.bot_token;
                        s.bot_id = confirmed.bot_id;
                        s.base_url = confirmed.base_url;
                        s.updates_buf.clear();
                        info!("[ClawBot] Login confirmed, bot_id={}", s.bot_id);
                        let _ = app_handle.emit("clawbot-login-status", json!({
                            "integrationId": self.integration_id,
                            "status": "confirmed",
                            "botId": s.bot_id,
                        }).to_string());
                        return Ok(true);
                    }
                    other => {
                        warn!("[ClawBot] Unknown qrcode status: {}", other);
                    }
                }
            }
        }
    }

    async fn fetch_qrcode(&self) -> Result<(String, String), String> {
        let resp = self
            .http
            .get(format!("{}/ilink/bot/get_bot_qrcode", DEFAULT_BASE_URL))
            .query(&[("bot_type", "3")])
            .header("iLink-App-Id", "bot")
            .header("iLink-App-ClientVersion", CLIENT_VERSION_U32.to_string())
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("获取二维码失败: {}", e))?;

        let status = resp.status();
        let body: Value = resp.json().await.map_err(|e| format!("二维码响应解析失败: {}", e))?;
        if !status.is_success() {
            return Err(format!("获取二维码失败 HTTP {}", status.as_u16()));
        }
        let qrcode = body
            .get("qrcode")
            .and_then(|v| v.as_str())
            .ok_or("二维码响应缺少 qrcode 字段")?
            .to_string();
        let img = body
            .get("qrcode_img_content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if qrcode.is_empty() || img.is_empty() {
            return Err("二维码响应内容为空".into());
        }
        // 官方 qrcode_img_content 返回的是授权短链（HTML 页面，非图片），
        // <img> 无法直接显示 -> 本地把链接渲染成二维码 SVG，再编码为 data URL
        let img = if img.starts_with("data:image") {
            img.chars().filter(|c| !c.is_whitespace()).collect::<String>()
        } else {
            let svg = render_qr_svg(&img)?;
            format!(
                "data:image/svg+xml;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(svg.as_bytes())
            )
        };
        Ok((qrcode, img))
    }

    async fn poll_qrcode_status(&self, host: &str, qrcode: &str) -> Result<String, String> {
        let resp = self
            .http
            .get(format!("{}/ilink/bot/get_qrcode_status", host))
            .query(&[("qrcode", qrcode)])
            .header("iLink-App-Id", "bot")
            .header("iLink-App-ClientVersion", CLIENT_VERSION_U32.to_string())
            .timeout(Duration::from_secs(35))
            .send()
            .await
            .map_err(|e| format!("轮询扫码状态失败: {}", e))?;
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("扫码状态响应解析失败: {}", e))?;
        Ok(body
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("wait")
            .to_string())
    }

    /// confirmed 后携带状态响应取会话凭证（get_qrcode_status 的 confirmed 响应带 token）
    async fn fetch_confirmed(&self, host: &str, qrcode: &str) -> Result<IlirkSession, String> {
        let resp = self
            .http
            .get(format!("{}/ilink/bot/get_qrcode_status", host))
            .query(&[("qrcode", qrcode)])
            .header("iLink-App-Id", "bot")
            .header("iLink-App-ClientVersion", CLIENT_VERSION_U32.to_string())
            .timeout(Duration::from_secs(35))
            .send()
            .await
            .map_err(|e| format!("获取登录凭证失败: {}", e))?;
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("登录凭证响应解析失败: {}", e))?;

        let token = body
            .get("bot_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim_start_matches("Bearer ")
            .to_string();
        if token.is_empty() {
            return Err("登录成功但未返回 bot_token".into());
        }
        Ok(IlirkSession {
            bot_token: token,
            bot_id: body
                .get("ilink_bot_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            base_url: body
                .get("baseurl")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(DEFAULT_BASE_URL)
                .to_string(),
            updates_buf: String::new(),
        })
    }

    // ================= 消息收发 =================

    /// getupdates 长轮询主循环
    async fn long_poll_loop(&self, app_handle: &AppHandle) -> LongPollOutcome {
        let mut fail_count = 0u32;
        loop {
            if !*self.running.lock().await {
                return LongPollOutcome::Stopped;
            }

            let (base, token, buf) = {
                let s = self.session.lock().await;
                (s.base_url.clone(), s.bot_token.clone(), s.updates_buf.clone())
            };

            let result = self
                .http
                .post(format!("{}/ilink/bot/getupdates", base))
                .header("Content-Type", "application/json")
                .header("iLink-App-Id", "bot")
                .header("iLink-App-ClientVersion", CLIENT_VERSION_U32.to_string())
                .header("AuthorizationType", "ilink_bot_token")
                .header("Authorization", format!("Bearer {}", token))
                .header("X-WECHAT-UIN", random_uin())
                .json(&json!({
                    "get_updates_buf": buf,
                    "base_info": { "channel_version": CHANNEL_VERSION },
                }))
                .timeout(Duration::from_secs(40))
                .send()
                .await;

            let resp = match result {
                Ok(r) => r,
                Err(e) => {
                    // 长轮询超时/网络抖动：退避重试
                    fail_count += 1;
                    if fail_count >= 5 {
                        return LongPollOutcome::Fatal(format!("长轮询连续失败: {}", e));
                    }
                    let wait = if fail_count >= 3 { 30 } else { 2 };
                    tokio::time::sleep(Duration::from_secs(wait)).await;
                    continue;
                }
            };

            if resp.status().as_u16() == 401 {
                return LongPollOutcome::SessionExpired;
            }
            let body: Value = match resp.json().await {
                Ok(v) => v,
                Err(e) => {
                    fail_count += 1;
                    if fail_count >= 5 {
                        return LongPollOutcome::Fatal(format!("长轮询响应解析失败: {}", e));
                    }
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }
            };

            fail_count = 0;

            // errcode=-14 会话超时 -> 重新扫码
            if body.get("errcode").and_then(|v| v.as_i64()) == Some(-14) {
                return LongPollOutcome::SessionExpired;
            }

            // 更新游标并按需持久化
            if let Some(new_buf) = body.get("get_updates_buf").and_then(|v| v.as_str()) {
                self.session.lock().await.updates_buf = new_buf.to_string();
            }
            self.persist_session_quiet(app_handle).await;

            let msgs = match body.get("msgs").and_then(|v| v.as_array()) {
                Some(a) => a.clone(),
                None => continue,
            };
            for msg in &msgs {
                self.dispatch_message(msg, app_handle).await;
            }
        }
    }

    /// 解析 WeixinMessage 并 emit 到统一管线（仅处理用户文本 / 语音转写）
    async fn dispatch_message(&self, msg: &Value, app_handle: &AppHandle) {
        let message_type = msg.get("message_type").and_then(|v| v.as_i64()).unwrap_or(0);
        if message_type != 1 {
            return; // 只处理用户消息（2 为机器人自己的）
        }
        let message_id = pick_str(msg, &["message_id", "seq"]);
        if !message_id.is_empty() {
            let mut seen = self.dispatched.lock().await;
            if seen.contains(&message_id) {
                return;
            }
            seen.push(message_id.clone());
            if seen.len() > 500 {
                seen.drain(0..250);
            }
        }

        // message_state: 0=NEW 1=GENERATING 2=FINISH，仅处理完成态
        let state = msg.get("message_state").and_then(|v| v.as_i64()).unwrap_or(2);
        if state == 1 {
            return;
        }

        let user_id = msg
            .get("from_user_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if user_id.is_empty() {
            return;
        }

        // 提取文本（item_list 中 type=1 的 text_item；语音用服务端转写 text）
        let mut text = String::new();
        if let Some(items) = msg.get("item_list").and_then(|v| v.as_array()) {
            for item in items {
                let item_type = item.get("type").and_then(|v| v.as_i64()).unwrap_or(0);
                match item_type {
                    1 => {
                        if let Some(t) = item
                            .get("text_item")
                            .and_then(|t| t.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            text.push_str(t);
                        }
                    }
                    3 => {
                        if let Some(t) = item
                            .get("voice_item")
                            .and_then(|t| t.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            if !t.is_empty() {
                                text.push_str(t);
                            } else {
                                text.push_str("[语音]");
                            }
                        }
                    }
                    2 => text.push_str("[图片]"),
                    4 => {
                        let name = item
                            .get("file_item")
                            .and_then(|t| t.get("file_name"))
                            .and_then(|t| t.as_str())
                            .unwrap_or("");
                        text.push_str(&format!("[文件:{}]", if name.is_empty() { "未命名" } else { name }));
                    }
                    5 => text.push_str("[视频]"),
                    _ => {}
                }
            }
        }
        if text.trim().is_empty() {
            return;
        }

        // 缓存 context_token 用于回复
        let context_token = msg
            .get("context_token")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !context_token.is_empty() {
            self.context_tokens
                .lock()
                .await
                .insert(user_id.clone(), context_token);
        }

        let group_id = msg
            .get("group_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let time_ms = msg
            .get("create_time_ms")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let event = json!({
            "integrationType": "clawbot",
            "integrationId": self.integration_id,
            "userId": user_id,
            "groupId": if group_id.is_empty() { Value::Null } else { Value::from(group_id) },
            "senderName": user_id,
            "message": text,
            "rawMessage": text,
            "messageId": if message_id.is_empty() { Value::Null } else { Value::from(message_id) },
            "time": if time_ms > 0 { time_ms / 1000 } else {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64
            },
        });
        let event_str = event.to_string();
        info!(
            "[ClawBot] Message from {}: {}",
            user_id,
            &text[..text.len().min(50)]
        );
        let _ = app_handle.emit("bot-message-received", &event_str);
    }

    /// sendmessage 发送文本
    pub async fn send_message(&self, user_id: &str, _group_id: Option<&str>, text: &str) -> Result<(), String> {
        let (base, token) = {
            let s = self.session.lock().await;
            (s.base_url.clone(), s.bot_token.clone())
        };
        if token.is_empty() {
            return Err("尚未扫码登录，无法发送消息".to_string());
        }
        let client_id = uuid::Uuid::new_v4().to_string();
        let context_token = self.context_tokens.lock().await.get(user_id).cloned();

        let mut msg_obj = json!({
            "to_user_id": user_id,
            "client_id": client_id,
            "message_type": 2,
            "message_state": 2,
            "item_list": [
                { "type": 1, "text_item": { "text": text } }
            ],
        });
        if let Some(ct) = context_token {
            msg_obj["context_token"] = Value::from(ct);
        }

        let resp = self
            .http
            .post(format!("{}/ilink/bot/sendmessage", base))
            .header("Content-Type", "application/json")
            .header("iLink-App-Id", "bot")
            .header("iLink-App-ClientVersion", CLIENT_VERSION_U32.to_string())
            .header("AuthorizationType", "ilink_bot_token")
            .header("Authorization", format!("Bearer {}", token))
            .header("X-WECHAT-UIN", random_uin())
            .json(&json!({
                "msg": msg_obj,
                "base_info": { "channel_version": CHANNEL_VERSION },
            }))
            .timeout(Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| format!("发送失败: {}", e))?;

        let status = resp.status();
        if status.as_u16() == 401 {
            return Err("会话已失效，请重新扫码登录".into());
        }
        if !status.is_success() {
            let resp_text = resp.text().await.unwrap_or_default();
            error!("[ClawBot] Send failed HTTP {}: {}", status.as_u16(), &resp_text[..resp_text.len().min(300)]);
            return Err(format!("发送失败 HTTP {}: {}", status.as_u16(), resp_text));
        }
        info!("[ClawBot] Message sent to {}", user_id);
        Ok(())
    }

    // ================= 会话持久化 =================

    /// 把当前会话写回 bot_integrations.config（重启复用，免重复扫码）
    async fn persist_session(&self, app_handle: &AppHandle) {
        if let Err(e) = self.persist_session_inner(app_handle).await {
            warn!("[ClawBot] Persist session failed: {}", e);
        }
    }

    /// 游标持久化：仅在游标变化时写库，避免每 35s 长轮询都写一次
    async fn persist_session_quiet(&self, app_handle: &AppHandle) {
        let last = self.last_persisted_buf.lock().await.clone();
        let cur = self.session.lock().await.updates_buf.clone();
        if last == cur {
            return;
        }
        *self.last_persisted_buf.lock().await = cur;
        if let Err(e) = self.persist_session_inner(app_handle).await {
            warn!("[ClawBot] Persist session failed: {}", e);
        }
    }

    async fn persist_session_inner(&self, app_handle: &AppHandle) -> Result<(), String> {
        use crate::db::DbState;
        let (token, bot_id, base_url, updates_buf) = {
            let s = self.session.lock().await;
            (s.bot_token.clone(), s.bot_id.clone(), s.base_url.clone(), s.updates_buf.clone())
        };

        let state = app_handle.state::<DbState>();
        let conn = state.conn.lock().map_err(|e| e.to_string())?;

        // 读取现有 config 做字段级合并，只更新会话字段，保留 auto_reply / character_id 等前端配置
        let existing: String = conn
            .query_row(
                "SELECT config FROM bot_integrations WHERE id = ?1",
                rusqlite::params![self.integration_id],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "{}".to_string());
        let mut merged: Value = serde_json::from_str(&existing).unwrap_or_else(|_| json!({}));
        if let Some(dst) = merged.as_object_mut() {
            dst.insert("bot_token".into(), Value::from(token));
            dst.insert("ilink_bot_id".into(), Value::from(bot_id));
            dst.insert("base_url".into(), Value::from(base_url));
            dst.insert("get_updates_buf".into(), Value::from(updates_buf));
        } else {
            merged = json!({});
        }

        conn.execute(
            "UPDATE bot_integrations SET config = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![
                serde_json::to_string(&merged).unwrap_or_else(|_| "{}".to_string()),
                chrono::Local::now().to_rfc3339(),
                self.integration_id
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

enum LongPollOutcome {
    Stopped,
    SessionExpired,
    Fatal(String),
}

/// X-WECHAT-UIN：随机 uint32 转十进制字符串后 base64
fn random_uin() -> String {
    let n: u32 = rand::thread_rng().gen();
    base64::engine::general_purpose::STANDARD.encode(n.to_string().as_bytes())
}

/// 把授权链接渲染成二维码 SVG 字符串（pub：generate_qrcode 命令复用）
pub fn render_qr_svg(content: &str) -> Result<String, String> {
    use qrcode::render::svg;
    use qrcode::EcLevel;
    let code = qrcode::QrCode::with_error_correction_level(content.as_bytes(), EcLevel::M)
        .map_err(|e| format!("二维码编码失败: {}", e))?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build())
}
