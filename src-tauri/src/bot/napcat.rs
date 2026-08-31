
use crate::bot::types::{BotIntegrationConfig, OneBotEvent, OneBotResponse};
use futures_util::{SinkExt, StreamExt};
use log::{info, warn, error};
use serde_json;
use std::sync::Arc;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, connect_async};

/// 当前毫秒时间戳（A5 消息去重窗口用）
fn chrono_now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Clone)]
pub struct NapCatClient {
    config: BotIntegrationConfig,
    integration_id: String,
    event_tx: Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>,
    connected: Arc<Mutex<bool>>,
    shutdown_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
}

/// 连接上下文：正向/反向模式共用的事件处理与发送通道
/// 🆕 修复"同一消息连续重复 N 条"：去重表跨连接共享（此前为每连接独立，
///    NapCat 重连后旧连接未断时多个连接同时收事件 → 同一消息 emit 多次）；
///    新连接建立时通过 kill 通道主动断开旧连接（同一 integration 连接互斥）。
#[derive(Clone)]
struct ConnCtx {
    app_handle: tauri::AppHandle,
    integration_id: String,
    connected: Arc<Mutex<bool>>,
    event_tx: Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>,
    /// 跨连接共享的 messageId 去重表（message_id → 时间戳）
    seen_message_ids: Arc<Mutex<std::collections::HashMap<i64, i64>>>,
    /// 当前活跃连接的 kill 开关：新连接建立时向旧连接发送 () 使其退出
    conn_kill_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
}

impl ConnCtx {
    /// 处理一条已建立的 WebSocket 连接（收事件 + 发动作），返回时连接已断开。
    /// 按值接收（Clone）以保证内部 spawn 的任务满足 'static。
    async fn run_connection<S>(self, ws_stream: tokio_tungstenite::WebSocketStream<S>)
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        info!("[NapCat] WebSocket handshake completed ({})", self.integration_id);
        // 🆕 连接互斥：踢掉旧连接，注册本连接的 kill 开关
        let (kill_tx, mut kill_rx) = mpsc::channel::<()>(1);
        {
            let mut old_kill = self.conn_kill_tx.lock().await;
            if let Some(old_tx) = old_kill.take() {
                info!("[NapCat] New connection arriving, closing previous connection ({})", self.integration_id);
                let _ = old_tx.send(()).await;
            }
            *old_kill = Some(kill_tx);
        }
        *self.connected.lock().await = true;
        let _ = self.app_handle.emit("bot-status", serde_json::json!({
            "integrationId": self.integration_id,
            "status": "connected",
            "message": "NapCat 已连接",
        }).to_string());

        let (write, mut read) = ws_stream.split();
        let write = Arc::new(Mutex::new(write));
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        *self.event_tx.lock().await = Some(tx);

        let write_for_read = write.clone();
        // 克隆后供 read_task 使用，避免 move 后任务结束再访问 self 报错
        let app_handle = self.app_handle.clone();
        let integration_id = self.integration_id.clone();
        let seen_message_ids = self.seen_message_ids.clone();
        let read_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    msg = read.next() => {
                        let Some(msg) = msg else { break };
                        match msg {
                    Ok(Message::Text(text)) => {
                        info!("[NapCat] Received: {}", &text.as_str()[..text.len().min(200)]);
                        match serde_json::from_str::<OneBotEvent>(&text) {
                            Ok(event) => {
                                if event.post_type == "message" {
                                    // 🆕 A5 根治自循环：NapCat 开启"上报自身消息"时，
                                    // 自发消息 sub_type=message_sent 或 user_id==self_id → 直接丢弃
                                    if event.sub_type.as_deref() == Some("message_sent")
                                        || (event.self_id.is_some() && event.user_id == event.self_id) {
                                        info!("[NapCat] Dropped self-sent message (sub_type={:?})", event.sub_type);
                                        continue;
                                    }
                                    // 🆕 A5: messageId 去重（双保险，与前端 processedMessageIds 并行）
                                    // 🔧 去重表为跨连接共享（Arc<Mutex>），根治多连接重复 emit
                                    if let Some(mid) = event.message_id {
                                        let now_ms = chrono_now_ms();
                                        let mut seen = seen_message_ids.lock().await;
                                        // 滑动窗口清理：超过 10 分钟的条目移除
                                        seen.retain(|_, ts| now_ms - *ts < 600_000);
                                        if seen.contains_key(&mid) {
                                            info!("[NapCat] Duplicate messageId {}, dropped", mid);
                                            continue;
                                        }
                                        seen.insert(mid, now_ms);
                                    }
                                    let user_id = event.user_id.unwrap_or(0);
                                    let group_id = event.group_id;
                                    let message = event.extract_text();
                                    let attachments = event.extract_attachments();
                                    let sender_name = event.sender.as_ref()
                                        .and_then(|s| s.card.as_ref().or(s.nickname.as_ref()))
                                        .cloned()
                                        .unwrap_or_else(|| "Unknown".to_string());

                                    info!("[NapCat] Message from {} ({}): {} (attachments: {})", sender_name, user_id, &message[..message.len().min(50)], attachments.len());

                                    // 🆕 群@检测：raw_message 含 CQ:at 或 message 数组含 at 段
                                    //    （array 格式消息时 raw_message 可能为空，前端仅靠它判断会漏掉 @）
                                    let has_at = event.raw_message.as_deref().map(|r| r.contains("[CQ:at,")).unwrap_or(false)
                                        || event.message.as_ref().map(|m| match m {
                                            serde_json::Value::Array(arr) => arr.iter().any(|seg| {
                                                seg.get("type").and_then(|t| t.as_str()) == Some("at")
                                            }),
                                            serde_json::Value::String(s) => s.contains("[CQ:at,"),
                                            _ => false,
                                        }).unwrap_or(false);

                                    let external_event = serde_json::json!({
                                        "integrationType": "napcat",
                                        "integrationId": integration_id.clone(),
                                        "userId": user_id,
                                        "groupId": group_id,
                                        "senderName": sender_name,
                                        "message": message,
                                        "rawMessage": event.raw_message,
                                        "messageId": event.message_id,
                                        "time": event.time,
                                        "attachments": attachments,
                                        "hasAt": has_at,
                                    });

                                    let event_str = serde_json::to_string(&external_event).unwrap_or_default();
                                    let _ = app_handle.emit("bot-message-received", &event_str);
                                } else {
                                    info!("[NapCat] Non-message event: {}", event.post_type);
                                }
                            }
                            Err(e) => {
                                warn!("[NapCat] Failed to parse event: {} (first 200 chars: {})", e, &text.as_str()[..text.len().min(200)]);
                            }
                        }
                    }
                    Ok(Message::Ping(data)) => {
                        let mut w = write_for_read.lock().await;
                        let _ = w.send(Message::Pong(data)).await;
                    }
                    Ok(Message::Close(_)) => {
                        warn!("[NapCat] WebSocket closed by peer");
                        break;
                    }
                    Err(e) => {
                        error!("[NapCat] WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                        }
                    }
                    // 🆕 连接互斥：被新连接踢掉时立即退出，不再双收事件
                    _ = kill_rx.recv() => {
                        info!("[NapCat] Connection replaced by a newer one, closing ({})", integration_id);
                        break;
                    }
                }
            }
        });

        let write_task = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                let mut w = write.lock().await;
                if w.send(Message::Text(msg)).await.is_err() {
                    break;
                }
            }
        });

        tokio::select! {
            _ = read_task => {},
            _ = write_task => {},
        }

        *self.connected.lock().await = false;
        // 连接断开时清空发送通道，避免向死连接发消息
        *self.event_tx.lock().await = None;
        let _ = self.app_handle.emit("bot-status", serde_json::json!({
            "integrationId": self.integration_id,
            "status": "disconnected",
            "message": "NapCat 已断开，等待重连...",
        }).to_string());
    }
}

impl NapCatClient {
    pub fn new(config: BotIntegrationConfig, integration_id: String) -> Self {
        Self {
            config,
            integration_id,
            event_tx: Arc::new(Mutex::new(None)),
            connected: Arc::new(Mutex::new(false)),
            shutdown_tx: Arc::new(Mutex::new(None)),
        }
    }

    pub async fn is_connected(&self) -> bool {
        *self.connected.lock().await
    }

    pub async fn stop(&self) {
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(()).await;
            info!("[NapCat] Shutdown signal sent for {}", self.integration_id);
        }
    }

    /// 是否已在运行（防止重复启动导致端口占用/双循环）
    pub async fn is_running(&self) -> bool {
        self.shutdown_tx.lock().await.is_some()
    }

    pub async fn start(&self, app_handle: tauri::AppHandle) -> Result<(), String> {
        // 🆕 修复"连接不上"主因之一：重复启动。已有实例在跑则先停掉旧的（否则旧监听占住端口，新实例 bind 失败）
        if self.is_running().await {
            info!("[NapCat] Integration {} already running, restarting...", self.integration_id);
            self.stop().await;
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }

        let config = self.config.clone();
        let integration_id = self.integration_id.clone();
        let connected = self.connected.clone();
        let event_tx = self.event_tx.clone();

        let app_handle_for_events = app_handle.clone();
        let integration_id_for_events = integration_id.clone();

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        *self.shutdown_tx.lock().await = Some(shutdown_tx);

        let (ready_tx, ready_rx) = oneshot::channel::<()>();

        tokio::spawn(async move {
            let ctx = ConnCtx {
                app_handle: app_handle_for_events.clone(),
                integration_id: integration_id.clone(),
                connected,
                event_tx,
                seen_message_ids: Arc::new(Mutex::new(std::collections::HashMap::new())),
                conn_kill_tx: Arc::new(Mutex::new(None)),
            };

            if config.ws_mode.as_deref() == Some("client") {
                // ============ 正向 WebSocket 客户端模式 ============
                // 主动连接 NapCat 的正向 WS 服务，断线自动重连（5s 间隔）
                info!("[NapCat] Client mode: connecting to {} ...", config.ws_url);
                let _ = app_handle_for_events.emit("bot-status", serde_json::json!({
                    "integrationId": integration_id_for_events,
                    "status": "listening",
                    "message": format!("正向WS客户端模式，正在连接 {}", config.ws_url),
                }).to_string());
                let _ = ready_tx.send(());

                loop {
                    tokio::select! {
                        _ = shutdown_rx.recv() => {
                            info!("[NapCat] Client shutting down for integration {}", integration_id);
                            break;
                        }
                        connect_result = Self::connect_with_token(&config.ws_url, &config.token) => {
                            match connect_result {
                                Ok(ws_stream) => {
                                    info!("[NapCat] Connected to forward WS {}", config.ws_url);
                                    ctx.clone().run_connection(ws_stream).await;
                                }
                                Err(e) => {
                                    warn!("[NapCat] Connect to {} failed: {}（5s 后重试）", config.ws_url, e);
                                    let _ = app_handle_for_events.emit("bot-status", serde_json::json!({
                                        "integrationId": integration_id_for_events,
                                        "status": "error",
                                        "message": format!("连接 {} 失败: {}（自动重试中）", config.ws_url, e),
                                    }).to_string());
                                    tokio::select! {
                                        _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {},
                                        _ = shutdown_rx.recv() => {
                                            info!("[NapCat] Client shutting down for integration {}", integration_id);
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                // ============ 反向 WebSocket 服务器模式（默认） ============
                // 本应用监听端口，NapCat 以反向 WS 客户端连入
                // 🔧 地址无效直接报错退出本轮，不再静默回退（外层循环负责延时重连）
                let addr = match Self::parse_listen_addr(&config.ws_url) {
                    Ok(a) => a,
                    Err(e) => {
                        error!("[NapCat] {}", e);
                        let _ = app_handle_for_events.emit("bot-status", serde_json::json!({
                            "integrationId": integration_id_for_events,
                            "status": "error",
                            "message": e,
                        }).to_string());
                        let _ = ready_tx.send(());
                        return;
                    }
                };
                info!("[NapCat] Starting WebSocket server on {}...", addr);

                let listener = match TcpListener::bind(&addr).await {
                    Ok(l) => l,
                    Err(e) => {
                        let code = e.raw_os_error().unwrap_or(0);
                        let msg = if code == 10013 || code == 10048 {
                            format!("端口 {} 被其他程序占用 (可能是 NapCat 正向WebSocket服务)。请关闭 NapCat 的正向WebSocket、改用反向WebSocket 并指向本应用；或将接入模式切换为「正向WS客户端」", addr)
                        } else {
                            format!("端口 {} 绑定失败: {}", addr, e)
                        };
                        error!("[NapCat] {}", msg);
                        let _ = app_handle_for_events.emit("bot-status", serde_json::json!({
                            "integrationId": integration_id_for_events,
                            "status": "error",
                            "message": msg,
                        }).to_string());
                        let _ = ready_tx.send(());
                        return;
                    }
                };

                let _ = ready_tx.send(());

                let _ = app_handle_for_events.emit("bot-status", serde_json::json!({
                    "integrationId": integration_id_for_events,
                    "status": "listening",
                    "message": format!("WebSocket 服务器已启动，监听 {}", addr),
                }).to_string());
                info!("[NapCat] WebSocket server listening on {}", addr);

                loop {
                    tokio::select! {
                        accept_result = listener.accept() => {
                            match accept_result {
                                Ok((stream, peer)) => {
                                    info!("[NapCat] Connection from {}", peer);
                                    match accept_async(stream).await {
                                        Ok(ws_stream) => {
                                            let ctx = ctx.clone();
                                            tokio::spawn(async move {
                                                ctx.run_connection(ws_stream).await;
                                            });
                                        }
                                        Err(e) => {
                                            error!("[NapCat] WebSocket handshake failed: {}", e);
                                        }
                                    }
                                }
                                Err(e) => {
                                    error!("[NapCat] Accept error: {}", e);
                                }
                            }
                        }
                        _ = shutdown_rx.recv() => {
                            info!("[NapCat] Server shutting down for integration {}", integration_id);
                            break;
                        }
                    }
                }
            }

            let _ = app_handle_for_events.emit("bot-status", serde_json::json!({
                "integrationId": integration_id_for_events,
                "status": "stopped",
                "message": "WebSocket 已停止",
            }).to_string());
        });

        let _ = ready_rx.await;
        Ok(())
    }

    /// 正向连接：token 非空时以 ?access_token= 查询参数附加（NapCat 标准认证方式）
    async fn connect_with_token(url: &str, token: &str) -> Result<tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, String> {
        let effective_url = if token.trim().is_empty() {
            url.to_string()
        } else {
            let sep = if url.contains('?') { '&' } else { '?' };
            format!("{}{}access_token={}", url, sep, token.trim())
        };
        let request = effective_url
            .into_client_request()
            .map_err(|e| format!("无效的 WebSocket URL: {}", e))?;
        let (stream, _) = connect_async(request)
            .await
            .map_err(|e| format!("{}", e))?;
        Ok(stream)
    }

    /// 从 ws://host:port/path 提取监听地址。
    /// 🔧 修复硬编码：地址无效时返回错误，而不是静默回退 127.0.0.1:3001
    /// （否则用户配错地址会以为连上了，排查困难）。
    fn parse_listen_addr(url: &str) -> Result<String, String> {
        let without_proto = url
            .strip_prefix("ws://")
            .or_else(|| url.strip_prefix("wss://"))
            .unwrap_or(url);
        let addr = without_proto.split('/').next().unwrap_or("");
        if addr.is_empty() || !addr.contains(':') {
            return Err(format!("无效的 NapCat 监听地址：\"{}\"（需要 ws://host:port 格式）", url));
        }
        Ok(addr.to_string())
    }

    pub async fn send_private_message(&self, user_id: i64, message: &str) -> Result<OneBotResponse, String> {
        let tx = self.event_tx.lock().await;
        if let Some(tx) = tx.as_ref() {
            let action = serde_json::json!({
                "action": "send_private_msg",
                "params": {
                    "user_id": user_id,
                    "message": message
                }
            });
            tx.send(action.to_string()).map_err(|e| e.to_string())?;
            Ok(OneBotResponse {
                status: Some("ok".to_string()),
                retcode: Some(0),
                data: None,
                message: None,
                wording: None,
            })
        } else {
            Err("Not connected".to_string())
        }
    }

    pub async fn send_group_message(&self, group_id: i64, message: &str) -> Result<OneBotResponse, String> {
        let tx = self.event_tx.lock().await;
        if let Some(tx) = tx.as_ref() {
            let action = serde_json::json!({
                "action": "send_group_msg",
                "params": {
                    "group_id": group_id,
                    "message": message
                }
            });
            tx.send(action.to_string()).map_err(|e| e.to_string())?;
            Ok(OneBotResponse {
                status: Some("ok".to_string()),
                retcode: Some(0),
                data: None,
                message: None,
                wording: None,
            })
        } else {
            Err("Not connected".to_string())
        }
    }
}
