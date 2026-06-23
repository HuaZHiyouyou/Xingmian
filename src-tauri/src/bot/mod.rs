
pub mod napcat;
pub mod types;
pub mod wechat;

use crate::bot::napcat::NapCatClient;
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
}

impl BotManager {
    pub fn new() -> Self {
        Self {
            napcat_clients: Arc::new(Mutex::new(HashMap::new())),
            wechat_clients: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn start_napcat(
        &self,
        integration_id: &str,
        config: BotIntegrationConfig,
        app_handle: AppHandle,
    ) {
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
}
