
use crate::bot::types::{BotIntegrationConfig, OneBotEvent, OneBotResponse};
use futures_util::{SinkExt, StreamExt};
use log::{info, warn, error};
use serde_json;
use std::sync::Arc;
use tauri::Emitter;
use tokio::net::TcpListener;
use tokio::sync::{mpsc, oneshot};
use tokio::sync::Mutex;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

#[derive(Clone)]
pub struct NapCatClient {
    config: BotIntegrationConfig,
    integration_id: String,
    event_tx: Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>,
    connected: Arc<Mutex<bool>>,
    shutdown_tx: Arc<Mutex<Option<mpsc::Sender<()>>>>,
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

    pub async fn start(&self, app_handle: tauri::AppHandle) -> Result<(), String> {
        let ws_url = self.config.ws_url.clone();
        let _token = self.config.token.clone();
        let integration_id = self.integration_id.clone();
        let connected = self.connected.clone();
        let event_tx = self.event_tx.clone();

        let app_handle_for_events = app_handle.clone();
        let integration_id_for_events = integration_id.clone();

        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        *self.shutdown_tx.lock().await = Some(shutdown_tx);

        let (ready_tx, ready_rx) = oneshot::channel::<()>();

        tokio::spawn(async move {
            let addr = Self::parse_listen_addr(&ws_url);
            info!("[NapCat] Starting WebSocket server on {}...", addr);

            let listener = match TcpListener::bind(&addr).await {
                Ok(l) => l,
                Err(e) => {
                    let code = e.raw_os_error().unwrap_or(0);
                    let msg = if code == 10013 || code == 10048 {
                        format!("端口 {} 被其他程序占用 (可能是 NapCat 正向WebSocket服务)。请在 NapCat 设置中关闭正向WebSocket、开启反向WebSocket客户端并指向本应用", addr)
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

                                let app_handle_clone = app_handle.clone();
                                let integration_id_clone = integration_id.clone();
                                let connected_clone = connected.clone();
                                let event_tx_clone = event_tx.clone();

                                tokio::spawn(async move {
                                    match accept_async(stream).await {
                                        Ok(ws_stream) => {
                                            info!("[NapCat] WebSocket handshake completed with {}", peer);
                                            *connected_clone.lock().await = true;
                                            let _ = app_handle_clone.emit("bot-status", serde_json::json!({
                                                "integrationId": integration_id_clone,
                                                "status": "connected",
                                                "message": format!("NapCat 已连接 ({})", peer),
                                            }).to_string());

                                            let (write, read) = ws_stream.split();
                                            let write = Arc::new(Mutex::new(write));
                                            let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                                            *event_tx_clone.lock().await = Some(tx);

                                            let connected_for_read = connected_clone.clone();
                                            let write_for_read = write.clone();

                                            let read_task = tokio::spawn(async move {
                                                let mut read = read;
                                                while let Some(msg) = read.next().await {
                                                    match msg {
                                                        Ok(Message::Text(text)) => {
                                                            info!("[NapCat] Received: {}", &text.as_str()[..text.len().min(200)]);
                                                            match serde_json::from_str::<OneBotEvent>(&text) {
                                                                Ok(event) => {
                                                                    if event.post_type == "message" {
                                                                        let user_id = event.user_id.unwrap_or(0);
                                                                        let group_id = event.group_id;
                                                                        let message = event.extract_text();
                                                                        let attachments = event.extract_attachments();
                                                                        let sender_name = event.sender.as_ref()
                                                                            .and_then(|s| s.card.as_ref().or(s.nickname.as_ref()))
                                                                            .cloned()
                                                                            .unwrap_or_else(|| "Unknown".to_string());

                                                                        info!("[NapCat] Message from {} ({}): {} (attachments: {})", sender_name, user_id, &message[..message.len().min(50)], attachments.len());

                                                                        let external_event = serde_json::json!({
                                                                            "integrationType": "napcat",
                                                                            "integrationId": integration_id_clone,
                                                                            "userId": user_id,
                                                                            "groupId": group_id,
                                                                            "senderName": sender_name,
                                                                            "message": message,
                                                                            "rawMessage": event.raw_message,
                                                                            "messageId": event.message_id,
                                                                            "time": event.time,
                                                                            "attachments": attachments,
                                                                        });

                                                                        let event_str = serde_json::to_string(&external_event).unwrap_or_default();
                                                                        let _ = app_handle_clone.emit("bot-message-received", &event_str);
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
                                                            warn!("[NapCat] WebSocket closed by client");
                                                            break;
                                                        }
                                                        Err(e) => {
                                                            error!("[NapCat] WebSocket error: {}", e);
                                                            break;
                                                        }
                                                        _ => {}
                                                    }
                                                }
                                                *connected_for_read.lock().await = false;
                                                let _ = app_handle_clone.emit("bot-status", serde_json::json!({
                                                    "integrationId": integration_id_clone,
                                                    "status": "disconnected",
                                                    "message": "NapCat 已断开，等待重连...",
                                                }).to_string());
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
                                        }
                                        Err(e) => {
                                            error!("[NapCat] WebSocket handshake failed: {}", e);
                                        }
                                    }
                                });
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

            let _ = app_handle_for_events.emit("bot-status", serde_json::json!({
                "integrationId": integration_id_for_events,
                "status": "stopped",
                "message": "WebSocket 服务器已停止",
            }).to_string());
        });

        let _ = ready_rx.await;
        Ok(())
    }

    fn parse_listen_addr(url: &str) -> String {
        // Extract host:port from ws://host:port/path
        let without_proto = url
            .strip_prefix("ws://")
            .or_else(|| url.strip_prefix("wss://"))
            .unwrap_or(url);
        let addr = without_proto
            .split('/')
            .next()
            .unwrap_or("127.0.0.1:3001");
        addr.to_string()
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
