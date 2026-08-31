/**
 * ============================================================
 * MCP（Model Context Protocol）客户端模块
 *   - 支持 stdio（本地进程，newline-delimited JSON-RPC）与
 *     streamable HTTP（POST JSON-RPC，兼容 SSE 响应）双传输
 *   - McpManager 管理连接生命周期，启动时自动连接已启用服务器
 *   - 工具以 `mcp__{server}__{tool}` 命名注入 LLM（OpenAI function calling）
 *   - 配置持久化到 mcp_servers 表（JSON config 列）
 *
 * ============================================================
 */
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::Mutex;

/// 与大多数 MCP 服务器兼容的协议版本（2025-03-26 引入 streamable HTTP，
/// 旧版 stdio 服务器对该字段只做兼容协商，不会拒绝）
const PROTOCOL_VERSION: &str = "2025-03-26";
/// 单次 JSON-RPC 请求超时
const REQUEST_TIMEOUT_SECS: u64 = 60;
/// LLM 工具循环最大轮数
pub const MAX_TOOL_ROUNDS: usize = 5;

// ==================== 配置 ====================

/// 单个 MCP 服务器的完整配置（DB config 列的 JSON 结构）
#[derive(Debug, Clone)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub transport: String, // "stdio" | "http"
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub url: String,
    pub headers: HashMap<String, String>,
}

impl McpServerConfig {
    pub fn from_value(v: &Value) -> Self {
        let parse_map = |s: &Value| -> HashMap<String, String> {
            s.as_object()
                .map(|m| {
                    m.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default()
        };
        Self {
            id: v["id"].as_str().unwrap_or("").to_string(),
            name: v["name"].as_str().unwrap_or("").to_string(),
            transport: v["transport"].as_str().unwrap_or("stdio").to_string(),
            command: v["command"].as_str().unwrap_or("").to_string(),
            args: v["args"]
                .as_array()
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            env: parse_map(&v["env"]),
            url: v["url"].as_str().unwrap_or("").to_string(),
            headers: parse_map(&v["headers"]),
        }
    }
}

// ==================== 连接实现 ====================

/// stdio 传输连接
struct StdioConn {
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>>,
    next_id: Arc<AtomicU64>,
    child: Arc<Mutex<Child>>,
}

impl StdioConn {
    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let msg = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        {
            let mut stdin = self.stdin.lock().await;
            let mut line = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
            line.push('\n');
            stdin.write_all(line.as_bytes()).await.map_err(|e| format!("MCP stdin 写入失败: {}", e))?;
            stdin.flush().await.map_err(|e| format!("MCP stdin 刷新失败: {}", e))?;
        }

        let resp = tokio::time::timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS), rx)
            .await
            .map_err(|_| "MCP 请求超时（stdio）".to_string())?
            .map_err(|_| "MCP 连接已关闭（stdio）".to_string())?;

        extract_result(resp)
    }
}

/// 读取 stdout 行任务：按 id 分发响应到等待者
async fn spawn_stdio_reader(
    stdout: tokio::process::ChildStdout,
    pending: Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Value>>>>,
) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        // 只关心带 id 的响应；server→client 的请求/notification 忽略
        let Some(id) = v.get("id").and_then(|i| i.as_u64()) else { continue };
        if let Some(tx) = pending.lock().await.remove(&id) {
            let _ = tx.send(v);
        }
    }
    // 进程退出（EOF 或读错误）：唤醒所有等待者报错
    let mut map = pending.lock().await;
    for (_, tx) in map.drain() {
        let _ = tx.send(json!({"error": {"code": -32000, "message": "MCP 进程已退出"}}));
    }
}

/// streamable HTTP 传输连接
struct HttpConn {
    url: String,
    headers: Vec<(String, String)>,
    session_id: Mutex<Option<String>>,
    client: reqwest::Client,
    next_id: AtomicU64,
}

impl HttpConn {
    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let v = self.post_jsonrpc(&body).await?;
        extract_result(v)
    }

    async fn notify(&self, method: &str) -> Result<(), String> {
        let body = json!({"jsonrpc": "2.0", "method": method});
        self.post_jsonrpc(&body).await.map(|_| ())
    }

    async fn post_jsonrpc(&self, body: &Value) -> Result<Value, String> {
        let mut req = self
            .client
            .post(&self.url)
            .json(body)
            .header("Accept", "application/json, text/event-stream")
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS));
        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some(sid) = self.session_id.lock().await.as_ref() {
            req = req.header("MCP-Session-Id", sid);
        }
        let resp = req.send().await.map_err(|e| format!("MCP HTTP 请求失败: {}", e))?;

        // 记录会话 id（streamable HTTP 规范）
        if let Some(sid) = resp.headers().get("mcp-session-id").and_then(|s| s.to_str().ok()) {
            *self.session_id.lock().await = Some(sid.to_string());
        }

        let status = resp.status();
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|c| c.to_str().ok())
            .unwrap_or("")
            .to_string();
        let text = resp.text().await.map_err(|e| format!("MCP HTTP 响应读取失败: {}", e))?;

        if !status.is_success() {
            // 404：会话过期，清掉后由上层重试
            if status.as_u16() == 404 {
                *self.session_id.lock().await = None;
            }
            return Err(format!("MCP HTTP {}：{}", status.as_u16(), text.chars().take(200).collect::<String>()));
        }

        // 202 Accepted：通知类请求无响应体
        if status.as_u16() == 202 || text.trim().is_empty() {
            return Ok(Value::Null);
        }

        // 上游可能以 SSE 流返回单个 JSON-RPC 响应
        if content_type.contains("text/event-stream") {
            return parse_sse_response(&text);
        }
        serde_json::from_str::<Value>(&text).map_err(|e| format!("MCP HTTP 响应解析失败: {}", e))
    }
}

/// 从 SSE 文本中提取最后一条 JSON-RPC 响应（含 result 或 error）
fn parse_sse_response(text: &str) -> Result<Value, String> {
    let mut last: Option<Value> = None;
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("data:") {
            continue;
        }
        let data = line[5..].trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(data) {
            if v.get("result").is_some() || v.get("error").is_some() {
                last = Some(v);
            }
        }
    }
    last.ok_or_else(|| "MCP SSE 响应中没有 JSON-RPC 结果".to_string())
}

/// 统一处理 JSON-RPC 响应：error → Err；result → Ok
fn extract_result(resp: Value) -> Result<Value, String> {
    if let Some(err) = resp.get("error") {
        let msg = err["message"].as_str().unwrap_or("未知 MCP 错误");
        return Err(format!("MCP 错误: {}", msg));
    }
    Ok(resp.get("result").cloned().unwrap_or(Value::Null))
}

// ==================== 连接抽象 ====================

enum McpConnection {
    Stdio(StdioConn),
    Http(Box<HttpConn>),
}

impl McpConnection {
    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        match self {
            McpConnection::Stdio(c) => c.request(method, params).await,
            McpConnection::Http(c) => c.request(method, params).await,
        }
    }

    async fn notify(&self, method: &str) -> Result<(), String> {
        match self {
            McpConnection::Stdio(c) => {
                // stdio 通知：直接写一行无 id 消息
                let msg = json!({"jsonrpc": "2.0", "method": method});
                let mut stdin = c.stdin.lock().await;
                let mut line = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
                line.push('\n');
                stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
                stdin.flush().await.map_err(|e| e.to_string())?;
                Ok(())
            }
            McpConnection::Http(c) => c.notify(method).await,
        }
    }

    async fn shutdown(&self) {
        if let McpConnection::Stdio(c) = self {
            // 尝试礼貌关闭再强杀
            let _ = c.request("shutdown", Value::Null).await;
            let mut child = c.child.lock().await;
            let _ = child.kill().await;
        }
    }
}

// ==================== 管理器 ====================

pub struct McpManager {
    conns: Mutex<HashMap<String, McpConnection>>,
    /// 连接时缓存的工具列表（server_id → OpenAI function 格式工具数组）
    tools_cache: Mutex<HashMap<String, Vec<Value>>>,
    /// LLM 工具名 → (server_id, 真实工具名)
    name_map: Mutex<HashMap<String, (String, String)>>,
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            conns: Mutex::new(HashMap::new()),
            tools_cache: Mutex::new(HashMap::new()),
            name_map: Mutex::new(HashMap::new()),
        }
    }

    /// 建立 MCP 连接并完成 initialize 握手，返回工具列表（OpenAI function 格式）
    pub async fn connect(&self, cfg: &McpServerConfig) -> Result<Vec<Value>, String> {
        // 旧连接先断开
        self.disconnect(&cfg.id).await;

        let conn = match cfg.transport.as_str() {
            "http" => {
                let url = cfg.url.trim().to_string();
                if url.is_empty() {
                    return Err("HTTP 传输必须填写 URL".to_string());
                }
                let conn = McpConnection::Http(Box::new(HttpConn {
                    url,
                    headers: cfg.headers.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
                    session_id: Mutex::new(None),
                    client: reqwest::Client::new(),
                    next_id: AtomicU64::new(1),
                }));
                conn.request(
                    "initialize",
                    json!({
                        "protocolVersion": PROTOCOL_VERSION,
                        "capabilities": {},
                        "clientInfo": {"name": "ChatApp", "version": "0.1.0"}
                    }),
                )
                .await?;
                conn
            }
            _ => {
                let (conn, child_stdout) = spawn_stdio_process(cfg).await?;
                // ⚠️ 必须先启动 reader 再 initialize，否则响应无人分发导致握手死锁
                spawn_stdio_reader(child_stdout, conn.pending.clone()).await;
                conn.request(
                    "initialize",
                    json!({
                        "protocolVersion": PROTOCOL_VERSION,
                        "capabilities": {},
                        "clientInfo": {"name": "ChatApp", "version": "0.1.0"}
                    }),
                )
                .await?;
                McpConnection::Stdio(conn)
            }
        };

        conn.notify("notifications/initialized").await?;

        // 拉取工具列表，注入 llmName 后缓存，并重建名称映射
        let tools = self.fetch_tools(&conn).await?;
        let server_key = if cfg.name.is_empty() { &cfg.id } else { &cfg.name };
        let prefix = format!("mcp__{}__", sanitize_name(server_key));
        {
            let mut annotated: Vec<Value> = Vec::with_capacity(tools.len());
            let mut map = self.name_map.lock().await;
            map.retain(|_, (sid, _)| sid != &cfg.id);
            for mut t in tools.into_iter() {
                if let Some(name) = t["name"].as_str().map(String::from) {
                    let llm_name = format!("{}{}", prefix, sanitize_name(&name));
                    map.insert(llm_name.clone(), (cfg.id.clone(), name));
                    t["llmName"] = Value::String(llm_name);
                }
                annotated.push(t);
            }
            drop(map);
            let mut cache = self.tools_cache.lock().await;
            cache.insert(cfg.id.clone(), annotated);
        }

        self.conns.lock().await.insert(cfg.id.clone(), conn);
        Ok(self.cached_tools(&cfg.id).await)
    }

    pub async fn disconnect(&self, id: &str) {
        if let Some(conn) = self.conns.lock().await.remove(id) {
            conn.shutdown().await;
        }
        self.tools_cache.lock().await.remove(id);
        let mut map = self.name_map.lock().await;
        map.retain(|_, (sid, _)| sid != id);
    }

    pub async fn is_connected(&self, id: &str) -> bool {
        self.conns.lock().await.contains_key(id)
    }

    /// 已连接 server 的缓存工具列表
    pub async fn cached_tools(&self, id: &str) -> Vec<Value> {
        self.tools_cache.lock().await.get(id).cloned().unwrap_or_default()
    }

    async fn fetch_tools(&self, conn: &McpConnection) -> Result<Vec<Value>, String> {
        let result = conn.request("tools/list", json!({})).await?;
        Ok(result["tools"].as_array().cloned().unwrap_or_default())
    }

    /// tools/call
    pub async fn call_tool(&self, server_id: &str, tool_name: &str, arguments: Value) -> Result<String, String> {
        let conns = self.conns.lock().await;
        let conn = conns.get(server_id).ok_or_else(|| "MCP 服务器未连接".to_string())?;
        let result = conn
            .request("tools/call", json!({"name": tool_name, "arguments": arguments}))
            .await?;
        drop(conns);

        // result.content: [{type:"text", text:"..."}]；isError 标记业务失败
        let mut text = String::new();
        if let Some(items) = result["content"].as_array() {
            for item in items {
                match item["type"].as_str() {
                    Some("text") => {
                        if let Some(t) = item["text"].as_str() {
                            if !text.is_empty() {
                                text.push('\n');
                            }
                            text.push_str(t);
                        }
                    }
                    Some("image") => text.push_str("[图片]"),
                    Some("resource") => text.push_str("[资源]"),
                    _ => {}
                }
            }
        }
        if text.is_empty() {
            text = serde_json::to_string(&result).unwrap_or_default();
        }
        if result["isError"].as_bool().unwrap_or(false) {
            return Err(format!("工具返回错误: {}", text.chars().take(500).collect::<String>()));
        }
        Ok(text)
    }

    /// LLM 工具循环用：按注入名执行工具，返回给模型的结果文本
    pub async fn execute_llm_tool(&self, llm_name: &str, arguments_json: &str) -> Result<String, String> {
        let (server_id, tool_name) = {
            let map = self.name_map.lock().await;
            map.get(llm_name).cloned().ok_or_else(|| format!("未知 MCP 工具: {}", llm_name))?
        };
        let args: Value = serde_json::from_str(arguments_json).unwrap_or(json!({}));
        self.call_tool(&server_id, &tool_name, args).await
    }

    /// 聚合所有已连接服务器的工具为 OpenAI function calling 数组
    /// （只在有工具时返回 Some，避免空 tools 字段触发上游兼容问题）
    pub async fn get_llm_tools(&self) -> Option<Value> {
        let cache = self.tools_cache.lock().await;
        let mut tools: Vec<Value> = Vec::new();
        for list in cache.values() {
            for t in list {
                let llm_name = t["llmName"].as_str().unwrap_or("");
                if llm_name.is_empty() {
                    continue;
                }
                tools.push(json!({
                    "type": "function",
                    "function": {
                        "name": llm_name,
                        "description": t["description"].as_str().unwrap_or(""),
                        "parameters": t["inputSchema"].clone(),
                    }
                }));
            }
        }
        if tools.is_empty() { None } else { Some(Value::Array(tools)) }
    }
}

/// 清洗工具/服务器名为 LLM function name 合法字符（a-zA-Z0-9_-）
fn sanitize_name(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    cleaned.trim_matches('_').to_string()
}

/// spawn stdio 进程并返回连接骨架（未 initialize）与 stdout 句柄
async fn spawn_stdio_process(cfg: &McpServerConfig) -> Result<(StdioConn, tokio::process::ChildStdout), String> {
    use tokio::process::Command;
    use std::process::Stdio as StdioPiped;

    if cfg.command.trim().is_empty() {
        return Err("stdio 传输必须填写启动命令".to_string());
    }

    let mut cmd = Command::new(cfg.command.trim());
    cmd.args(&cfg.args)
        .envs(&cfg.env)
        .stdin(StdioPiped::piped())
        .stdout(StdioPiped::piped())
        .stderr(StdioPiped::null());
    #[cfg(windows)]
    {
        // 隐藏控制台窗口，避免每次连接闪出 cmd
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("MCP 进程启动失败 ({}): {}", cfg.command, e))?;
    let stdin = child.stdin.take().ok_or("无法获取 MCP 进程 stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取 MCP 进程 stdout")?;

    let conn = StdioConn {
        stdin: Arc::new(Mutex::new(stdin)),
        pending: Arc::new(Mutex::new(HashMap::new())),
        next_id: Arc::new(AtomicU64::new(1)),
        child: Arc::new(Mutex::new(child)),
    };
    Ok((conn, stdout))
}

// ==================== Tauri 命令 ====================

/// 读取某行 mcp_servers 配置为 Value（含 config JSON 展开）
fn row_to_server(id: String, name: String, transport: String, enabled: bool, config: String) -> Value {
    let cfg: Value = serde_json::from_str(&config).unwrap_or(json!({}));
    json!({
        "id": id,
        "name": name,
        "transport": transport,
        "enabled": enabled,
        "command": cfg["command"].as_str().unwrap_or(""),
        "args": cfg["args"].as_array().cloned().unwrap_or_default(),
        "env": cfg["env"].as_object().cloned().unwrap_or_default(),
        "url": cfg["url"].as_str().unwrap_or(""),
        "headers": cfg["headers"].as_object().cloned().unwrap_or_default(),
        "description": cfg["description"].as_str().unwrap_or(""),
    })
}

fn parse_server_value(v: &Value) -> (String, String, String, bool, String) {
    let config = json!({
        "command": v["command"].as_str().unwrap_or(""),
        "args": v["args"].as_array().cloned().unwrap_or_default(),
        "env": v["env"].as_object().cloned().unwrap_or_default(),
        "url": v["url"].as_str().unwrap_or(""),
        "headers": v["headers"].as_object().cloned().unwrap_or_default(),
        "description": v["description"].as_str().unwrap_or(""),
    });
    (
        v["id"].as_str().unwrap_or("").to_string(),
        v["name"].as_str().unwrap_or("").to_string(),
        v["transport"].as_str().unwrap_or("stdio").to_string(),
        v["enabled"].as_bool().unwrap_or(false),
        serde_json::to_string(&config).unwrap_or_else(|_| "{}".to_string()),
    )
}

#[tauri::command]
pub fn mcp_get_servers(app: AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<crate::db::DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, name, transport, enabled, config FROM mcp_servers ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(row_to_server(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn mcp_save_server(app: AppHandle, server: Value) -> Result<(), String> {
    let (id, name, transport, enabled, config) = parse_server_value(&server);
    if id.is_empty() {
        return Err("MCP 服务器 id 不能为空".to_string());
    }
    let state = app.state::<crate::db::DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    db.execute(
        "INSERT OR REPLACE INTO mcp_servers (id, name, transport, enabled, config, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, COALESCE((SELECT created_at FROM mcp_servers WHERE id = ?1), ?6), ?6)",
        rusqlite::params![id, name, transport, enabled, config, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_delete_server(app: AppHandle, id: String) -> Result<(), String> {
    let manager = app.state::<McpManager>();
    manager.disconnect(&id).await;
    let state = app.state::<crate::db::DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM mcp_servers WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 从 DB 读单个服务器配置
async fn load_server_cfg(app: &AppHandle, id: &str) -> Result<McpServerConfig, String> {
    let state = app.state::<crate::db::DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let row = db
        .query_row(
            "SELECT id, name, transport, enabled, config FROM mcp_servers WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(row_to_server(
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|_| format!("MCP 服务器不存在: {}", id))?;
    drop(db);
    Ok(McpServerConfig::from_value(&row))
}

#[tauri::command]
pub async fn mcp_connect(app: AppHandle, id: String) -> Result<Value, String> {
    let cfg = load_server_cfg(&app, &id).await?;
    let manager = app.state::<McpManager>();
    let tools = manager.connect(&cfg).await?;
    Ok(json!({"ok": true, "tools": tools}))
}

#[tauri::command]
pub async fn mcp_disconnect(app: AppHandle, id: String) -> Result<(), String> {
    app.state::<McpManager>().disconnect(&id).await;
    Ok(())
}

/// 列出工具：未连接时自动连接（设置页刷新工具 / LLM 注入共用）
#[tauri::command]
pub async fn mcp_list_tools(app: AppHandle, id: String) -> Result<Vec<Value>, String> {
    let manager = app.state::<McpManager>();
    if !manager.is_connected(&id).await {
        let cfg = load_server_cfg(&app, &id).await?;
        manager.connect(&cfg).await?;
    }
    Ok(manager.cached_tools(&id).await)
}

#[tauri::command]
pub async fn mcp_call_tool(
    app: AppHandle,
    id: String,
    name: String,
    arguments_json: Option<String>,
) -> Result<String, String> {
    let manager = app.state::<McpManager>();
    if !manager.is_connected(&id).await {
        let cfg = load_server_cfg(&app, &id).await?;
        manager.connect(&cfg).await?;
    }
    let args: Value = arguments_json
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| serde_json::from_str(s).unwrap_or(json!({})))
        .unwrap_or(json!({}));
    manager.call_tool(&id, &name, args).await
}

#[tauri::command]
pub async fn mcp_status(app: AppHandle) -> Result<Vec<Value>, String> {
    let manager = app.state::<McpManager>();
    let conns = manager.conns.lock().await;
    let cache = manager.tools_cache.lock().await;
    Ok(conns
        .keys()
        .map(|id| {
            json!({
                "id": id,
                "connected": true,
                "toolCount": cache.get(id).map(|t| t.len()).unwrap_or(0),
            })
        })
        .collect())
}

/// 启动时自动连接所有 enabled 的服务器（lib.rs setup 中 spawn 调用）
pub async fn auto_connect_all(app: &AppHandle) {
    let servers = match mcp_get_servers_inner(app) {
        Ok(v) => v,
        Err(_) => return,
    };
    let manager = app.state::<McpManager>();
    for s in servers {
        if s["enabled"].as_bool() != Some(true) {
            continue;
        }
        let cfg = McpServerConfig::from_value(&s);
        match manager.connect(&cfg).await {
            Ok(tools) => {
                log::info!("[MCP] 自动连接成功: {} ({} 个工具)", cfg.name, tools.len());
            }
            Err(e) => {
                log::warn!("[MCP] 自动连接失败: {}: {}", cfg.name, e);
            }
        }
    }
}

/// 内部版读取（不走 tauri::command 宏）
fn mcp_get_servers_inner(app: &AppHandle) -> Result<Vec<Value>, String> {
    let state = app.state::<crate::db::DbState>();
    let db = state.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id, name, transport, enabled, config FROM mcp_servers ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(row_to_server(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}
