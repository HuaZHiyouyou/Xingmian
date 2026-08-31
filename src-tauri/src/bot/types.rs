
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneBotEvent {
    pub post_type: String,
    #[serde(default)]
    pub message_type: Option<String>,
    #[serde(default)]
    pub sub_type: Option<String>,
    /// 🆕 A5: 机器人自身账号（NapCat 开启"上报自身消息"时用于过滤自循环）
    #[serde(default)]
    pub self_id: Option<i64>,
    #[serde(default)]
    pub message_id: Option<i64>,
    #[serde(default)]
    pub user_id: Option<i64>,
    #[serde(default)]
    pub group_id: Option<i64>,
    #[serde(default)]
    pub message: Option<Value>,
    #[serde(default)]
    pub raw_message: Option<String>,
    #[serde(default)]
    pub sender: Option<OneBotSender>,
    #[serde(default)]
    pub time: Option<i64>,
}

impl OneBotEvent {
    pub fn strip_cq_codes(text: &str) -> String {
        let mut result = String::with_capacity(text.len());
        let mut remaining = text;
        while let Some(start) = remaining.find("[CQ:") {
            result.push_str(&remaining[..start]);
            if let Some(end) = remaining[start..].find(']') {
                remaining = &remaining[start + end + 1..];
            } else {
                result.push_str(&remaining[start..]);
                remaining = "";
                break;
            }
        }
        result.push_str(remaining);
        result.trim().to_string()
    }

    pub fn extract_image_urls(text: &str) -> Vec<String> {
        let mut urls = Vec::new();
        let mut pos = 0;
        while let Some(start) = text[pos..].find("[CQ:image") {
            let abs_start = pos + start;
            if let Some(end) = text[abs_start..].find(']') {
                let segment = &text[abs_start..=abs_start + end];
                if let Some(url_start) = segment.find("url=") {
                    let url_val = &segment[url_start + 4..];
                    if let Some(url_end) = url_val.find(',') {
                        urls.push(url_val[..url_end].to_string());
                    } else {
                        let cleaned = url_val.trim_end_matches(']');
                        urls.push(cleaned.to_string());
                    }
                }
                pos = abs_start + end + 1;
            } else {
                break;
            }
        }
        urls
    }

    pub fn extract_text(&self) -> String {
        if let Some(ref raw) = self.raw_message {
            if !raw.is_empty() {
                return Self::strip_cq_codes(raw);
            }
        }
        if let Some(ref msg) = self.message {
            match msg {
                Value::String(s) => return Self::strip_cq_codes(s),
                Value::Array(arr) => {
                    let parts: Vec<String> = arr.iter().filter_map(|seg| {
                        let seg_type = seg.get("type").and_then(|t| t.as_str());
                        match seg_type {
                            Some("text") => {
                                seg.get("data")
                                    .and_then(|d| d.get("text"))
                                    .and_then(|t| t.as_str())
                                    .map(Self::strip_cq_codes)
                            }
                            Some("image") => {
                                if let Some(url) = seg.get("data").and_then(|d| d.get("url")).and_then(|u| u.as_str()) {
                                    if !url.is_empty() {
                                        return None;
                                    }
                                }
                                Some("[图片]".to_string())
                            }
                            Some("face") => Some("[表情]".to_string()),
                            Some("at") => {
                                let qq = seg.get("data").and_then(|d| d.get("qq")).and_then(|q| q.as_str()).unwrap_or("");
                                Some(format!("@{}", qq))
                            }
                            Some("reply") => None,
                            _ => None,
                        }
                    }).collect();
                    return parts.join("");
                }
                _ => {}
            }
        }
        String::new()
    }

    pub fn extract_attachments(&self) -> Vec<serde_json::Value> {
        let mut attachments = Vec::new();
        let raw = self.raw_message.as_deref().unwrap_or("");
        let urls = Self::extract_image_urls(raw);
        for url in urls {
            attachments.push(serde_json::json!({
                "type": "image",
                "url": url,
            }));
        }
        if let Some(Value::Array(arr)) = &self.message {
            for seg in arr {
                let seg_type = seg.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match seg_type {
                    "image" => {
                        if let Some(url) = seg.get("data").and_then(|d| d.get("url")).and_then(|u| u.as_str()) {
                            if !url.is_empty() && !attachments.iter().any(|a| a.get("url").and_then(|u| u.as_str()) == Some(url)) {
                                attachments.push(serde_json::json!({
                                    "type": "image",
                                    "url": url,
                                }));
                            }
                        }
                    }
                    // 🆕 支持文件段：让 AI 至少能感知文件名/类型（前端会转成文本占位注入）
                    "file" => {
                        let name = seg.get("data").and_then(|d| d.get("name")).and_then(|n| n.as_str())
                            .or_else(|| seg.get("data").and_then(|d| d.get("file")).and_then(|f| f.as_str()))
                            .unwrap_or("");
                        let url = seg.get("data").and_then(|d| d.get("url")).and_then(|u| u.as_str()).unwrap_or("");
                        attachments.push(serde_json::json!({
                            "type": "file",
                            "name": name,
                            "url": url,
                        }));
                    }
                    _ => {}
                }
            }
        }
        attachments
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneBotSender {
    #[serde(default)]
    pub user_id: Option<i64>,
    #[serde(default)]
    pub nickname: Option<String>,
    #[serde(default)]
    pub card: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OneBotResponse {
    pub status: Option<String>,
    pub retcode: Option<i64>,
    pub data: Option<serde_json::Value>,
    pub message: Option<String>,
    pub wording: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotIntegrationConfig {
    #[serde(default = "default_ws_url")]
    pub ws_url: String,
    /// 🆕 连接模式：server=反向WS（本应用监听，NapCat 连入，默认）；client=正向WS（主动连 NapCat 的 WS 服务）
    #[serde(default)]
    pub ws_mode: Option<String>,
    #[serde(default = "default_http_url")]
    pub http_url: String,
    #[serde(default)]
    pub token: String,
    #[serde(default = "default_true")]
    pub auto_reply: bool,
    #[serde(default)]
    pub character_id: String,
    // ---- 🆕 QQ 开放平台（qq_official）----
    /// 开放平台 AppID
    #[serde(default)]
    pub app_id: String,
    /// 开放平台 AppSecret
    #[serde(default)]
    pub client_secret: String,
    // ---- 🆕 微信 ClawBot / iLink 扫码接入（clawbot）----
    /// （旧 HTTP 回调架构遗留）机器人框架 HTTP API 地址
    #[serde(default)]
    pub api_url: String,
    /// （旧 HTTP 回调架构遗留）本机回调监听端口
    #[serde(default = "default_callback_port")]
    pub callback_port: u16,
    // ---- 🆕 iLink 扫码登录会话（扫码成功后自动回填并持久化）----
    /// iLink Bot Token（扫码确认后下发，含 Bearer 前缀内容）
    #[serde(default)]
    pub bot_token: String,
    /// iLink Bot ID（格式 xxx@im.bot）
    #[serde(default)]
    pub ilink_bot_id: String,
    /// iLink API 基础地址（登录成功响应中的 baseurl）
    #[serde(default)]
    pub base_url: String,
    /// getupdates 同步游标（重启恢复用，避免重复收消息）
    #[serde(default)]
    pub get_updates_buf: String,
}

fn default_ws_url() -> String {
    "ws://127.0.0.1:3001".to_string()
}

fn default_http_url() -> String {
    "http://127.0.0.1:3000".to_string()
}

fn default_callback_port() -> u16 {
    8765
}

fn default_true() -> bool {
    true
}

impl Default for BotIntegrationConfig {
    fn default() -> Self {
        Self {
            ws_url: default_ws_url(),
            ws_mode: None,
            http_url: default_http_url(),
            token: String::new(),
            auto_reply: true,
            character_id: String::new(),
            app_id: String::new(),
            client_secret: String::new(),
            api_url: String::new(),
            callback_port: default_callback_port(),
            bot_token: String::new(),
            ilink_bot_id: String::new(),
            base_url: String::new(),
            get_updates_buf: String::new(),
        }
    }
}

