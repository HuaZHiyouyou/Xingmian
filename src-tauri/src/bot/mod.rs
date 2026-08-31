
pub mod clawbot;
pub mod napcat;
pub mod qq_official;
pub mod types;
pub mod wechat;

use crate::bot::clawbot::ClawbotClient;
use crate::bot::napcat::NapCatClient;
use crate::bot::qq_official::QqOfficialClient;
use crate::bot::types::BotIntegrationConfig;
use crate::bot::wechat::WeChatClient;
use log::info;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

pub struct BotManager {
    napcat_clients: Arc<Mutex<HashMap<String, NapCatClient>>>,
    wechat_clients: Arc<Mutex<HashMap<String, WeChatClient>>>,
    /// 🆕 QQ 开放平台官方机器人
    qq_official_clients: Arc<Mutex<HashMap<String, QqOfficialClient>>>,
    /// 🆕 微信 ClawBot（HTTP 回调）
    clawbot_clients: Arc<Mutex<HashMap<String, ClawbotClient>>>,
}

impl BotManager {
    pub fn new() -> Self {
        Self {
            napcat_clients: Arc::new(Mutex::new(HashMap::new())),
            wechat_clients: Arc::new(Mutex::new(HashMap::new())),
            qq_official_clients: Arc::new(Mutex::new(HashMap::new())),
            clawbot_clients: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_napcat(
        &self,
        integration_id: &str,
        config: BotIntegrationConfig,
        app_handle: AppHandle,
    ) {
        // 🆕 修复"连接不上"：重复启动时旧实例仍占用监听端口，导致新实例 bind 失败。
        //    先停掉旧实例并短暂等待端口释放。
        if let Some(old) = self.napcat_clients.lock().await.remove(integration_id) {
            info!("[BotManager] NapCat {} already exists, stopping old instance first", integration_id);
            old.stop().await;
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }

        let client = NapCatClient::new(config, integration_id.to_string());
        let client_clone = client.clone();

        self.napcat_clients
            .lock()
            .await
            .insert(integration_id.to_string(), client);

        let _ = client_clone.start(app_handle).await;
        info!("[BotManager] NapCat {} started", integration_id);
    }

    pub async fn stop_napcat(&self, integration_id: &str) {
        if let Some(client) = self.napcat_clients.lock().await.get(integration_id) {
            client.stop().await;
        }
        self.napcat_clients
            .lock()
            .await
            .remove(integration_id);
        info!("[BotManager] NapCat {} stopped", integration_id);
    }

    pub async fn is_napcat_running(&self, integration_id: &str) -> bool {
        self.napcat_clients.lock().await.contains_key(integration_id)
    }

    pub async fn is_napcat_connected(&self, integration_id: &str) -> bool {
        if let Some(client) = self.napcat_clients.lock().await.get(integration_id) {
            client.is_connected().await
        } else {
            false
        }
    }

    pub async fn send_napcat_private_message(
        &self,
        integration_id: &str,
        user_id: i64,
        message: &str,
    ) -> Result<(), String> {
        if let Some(client) = self.napcat_clients.lock().await.get(integration_id) {
            client.send_private_message(user_id, message).await?;
            Ok(())
        } else {
            Err("NapCat client not found".to_string())
        }
    }

    pub async fn send_napcat_group_message(
        &self,
        integration_id: &str,
        group_id: i64,
        message: &str,
    ) -> Result<(), String> {
        if let Some(client) = self.napcat_clients.lock().await.get(integration_id) {
            client.send_group_message(group_id, message).await?;
            Ok(())
        } else {
            Err("NapCat client not found".to_string())
        }
    }

    pub async fn start_wechat(
        &self,
        integration_id: &str,
        config: BotIntegrationConfig,
        app_handle: AppHandle,
    ) {
        let client = WeChatClient::new(config, integration_id.to_string());
        let client_clone = client.clone();

        self.wechat_clients
            .lock()
            .await
            .insert(integration_id.to_string(), client);

        client_clone.start(app_handle).await;
        info!("[BotManager] WeChat {} started", integration_id);
    }

    pub async fn stop_wechat(&self, integration_id: &str) {
        self.wechat_clients
            .lock()
            .await
            .remove(integration_id);
        info!("[BotManager] WeChat {} stopped", integration_id);
    }

    pub async fn send_wechat_message(
        &self,
        integration_id: &str,
        user_id: &str,
        message: &str,
    ) -> Result<(), String> {
        if let Some(client) = self.wechat_clients.lock().await.get(integration_id) {
            client.send_message(user_id, message).await?;
            Ok(())
        } else {
            Err("WeChat client not found".to_string())
        }
    }

    // ---------------- 🆕 QQ 开放平台官方机器人 ----------------

    pub async fn start_qq_official(
        &self,
        integration_id: &str,
        config: BotIntegrationConfig,
        app_handle: AppHandle,
    ) {
        let client = QqOfficialClient::new(config, integration_id.to_string());
        let client_clone = client.clone();

        self.qq_official_clients
            .lock()
            .await
            .insert(integration_id.to_string(), client);

        client_clone.start(app_handle).await;
        info!("[BotManager] QQ Official {} started", integration_id);
    }

    pub async fn stop_qq_official(&self, integration_id: &str) {
        if let Some(client) = self.qq_official_clients.lock().await.get(integration_id) {
            client.stop().await;
        }
        self.qq_official_clients
            .lock()
            .await
            .remove(integration_id);
        info!("[BotManager] QQ Official {} stopped", integration_id);
    }

    pub async fn is_qq_official_running(&self, integration_id: &str) -> bool {
        if let Some(client) = self.qq_official_clients.lock().await.get(integration_id) {
            client.is_running().await
        } else {
            false
        }
    }

    pub async fn is_qq_official_connected(&self, integration_id: &str) -> bool {
        if let Some(client) = self.qq_official_clients.lock().await.get(integration_id) {
            client.is_connected().await
        } else {
            false
        }
    }

    pub async fn send_qq_official_message(
        &self,
        integration_id: &str,
        openid: &str,
        group_openid: Option<&str>,
        message: &str,
    ) -> Result<(), String> {
        if let Some(client) = self.qq_official_clients.lock().await.get(integration_id) {
            client.send_message(openid, group_openid, message).await?;
            Ok(())
        } else {
            Err("QQ Official client not found（接入未启动）".to_string())
        }
    }

    // ---------------- 🆕 微信 ClawBot ----------------

    pub async fn start_clawbot(
        &self,
        integration_id: &str,
        config: BotIntegrationConfig,
        app_handle: AppHandle,
    ) {
        let client = ClawbotClient::new(config, integration_id.to_string());
        let client_clone = client.clone();

        self.clawbot_clients
            .lock()
            .await
            .insert(integration_id.to_string(), client);

        client_clone.start(app_handle).await;
        info!("[BotManager] ClawBot {} started", integration_id);
    }

    pub async fn stop_clawbot(&self, integration_id: &str) {
        if let Some(client) = self.clawbot_clients.lock().await.get(integration_id) {
            client.stop().await;
        }
        self.clawbot_clients
            .lock()
            .await
            .remove(integration_id);
        info!("[BotManager] ClawBot {} stopped", integration_id);
    }

    pub async fn is_clawbot_running(&self, integration_id: &str) -> bool {
        if let Some(client) = self.clawbot_clients.lock().await.get(integration_id) {
            client.is_running().await
        } else {
            false
        }
    }

    pub async fn send_clawbot_message(
        &self,
        integration_id: &str,
        user_id: &str,
        group_id: Option<&str>,
        message: &str,
    ) -> Result<(), String> {
        if let Some(client) = self.clawbot_clients.lock().await.get(integration_id) {
            client.send_message(user_id, group_id, message).await?;
            Ok(())
        } else {
            Err("ClawBot client not found（接入未启动）".to_string())
        }
    }
}
