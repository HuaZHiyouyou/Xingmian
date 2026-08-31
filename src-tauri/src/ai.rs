use regex::Regex;
use reqwest::Client;
use serde_json::Value;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// MCP 工具结果注入 messages 的最大字符数（防止超长工具输出撑爆上下文）
const TOOL_RESULT_MAX_CHARS: usize = 8000;

// ==================== 共享 HTTP 客户端 ====================

/// 全局共享的 reqwest Client，复用连接池，避免每次调用都创建新客户端
/// 导致 "Worker local total request limit reached" 错误
fn shared_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(180))
            .pool_max_idle_per_host(10)
            .pool_idle_timeout(Duration::from_secs(90))
            .connect_timeout(Duration::from_secs(30))
            .build()
            .expect("创建 HTTP 客户端失败")
    })
}

// ==================== 非流式调用 ====================

/// LLM 调用结果，保留原始响应 JSON 与提取后的内容，便于上层解析失败时兜底和调试
#[derive(Debug, Clone)]
pub struct LlmResponse {
    /// 从模型响应中提取的可见正文（可能为空）
    pub content: String,
    /// 原始 HTTP 响应体（完整 JSON），用于调试和二次解析
    pub raw_response: String,
    /// 模型 reasoning / thinking 内容（如果 provider 暴露）
    pub reasoning_content: Option<String>,
    /// usage 字段
    pub usage: Option<Value>,
}

/// 非流式 LLM 调用（内部完整版）：返回原始响应 + 提取内容 + reasoning
pub async fn call_ai_full(
    base_url: String,
    api_key: String,
    body: String,
) -> Result<LlmResponse, String> {
    let client = shared_client().clone();

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    // 防空校验：Key 为空/仅空白时直接报错，避免向上游发送无效请求（导致 auth_unavailable）
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API Key 为空：请检查设置中的平台配置，确保已填写有效的 API Key".to_string());
    }

    let max_retries = 3;
    let mut last_error = String::new();
    // 兜底正则：从原始 JSON 文本提取 content 字段值
    let content_regex = Regex::new(r#""content"\s*:\s*"((?:[^"\\]|\\.)*)""#).expect("static regex");

    for attempt in 0..=max_retries {
        let response = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", api_key))
            .body(body.clone())
            .send()
            .await
            .map_err(|e| format!("请求失败: {}", e))?;

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| format!("读取响应失败: {}", e))?;

        if status.is_success() {
            // 成功后解析并返回
            let data: Value = match serde_json::from_str(&text) {
                Ok(v) => v,
                Err(_) => {
                    // 200 但非 JSON：可能是上游强制返回 SSE 流（data: {...} 行）或异常空体/HTML。
                    // 先尝试按 SSE 兜底解析拼接 delta 内容，救回来；救不回则报明确错误
                    if let Some(rescued) = parse_sse_fallback(&text) {
                        eprintln!("[call_ai] 上游返回 SSE 而非 JSON，已兜底解析出 {} 字符", rescued.chars().count());
                        return Ok(LlmResponse {
                            content: rescued,
                            raw_response: text,
                            reasoning_content: None,
                            usage: None,
                        });
                    }
                    let preview: String = text.chars().take(120).collect();
                    return Err(format!(
                        "上游返回了非 JSON 响应（可能是地址错误或网关异常），响应开头: {}",
                        if preview.trim().is_empty() { "<空响应体>" } else { preview.trim() }
                    ));
                }
            };

            let usage_val = data.get("usage").cloned();

            // 检测模型是否只返回了思考/推理内容而没有可见正文
            let completion_tokens = usage_val.as_ref()
                .and_then(|u| u["completion_tokens"].as_u64())
                .unwrap_or(0);
            let text_tokens = usage_val.as_ref()
                .and_then(|u| u["completion_tokens_details"]["text_tokens"].as_u64());
            let reasoning_tokens = usage_val.as_ref()
                .and_then(|u| u["completion_tokens_details"]["reasoning_tokens"].as_u64());
            let content_empty = data["choices"].as_array()
                .and_then(|choices| choices.first())
                .and_then(|choice| choice["message"]["content"].as_str())
                .map(|s| s.trim().is_empty())
                .unwrap_or(true);
            let reasoning_only = content_empty
                && completion_tokens > 0
                && text_tokens.map(|t| t == 0).unwrap_or(false)
                && reasoning_tokens.map(|t| t > 0).unwrap_or(false);

            // 按优先级从多个字段提取回复内容
            let content = extract_content_from_response(&data).or_else(|| {
                // 兜底：用正则从原始 JSON 文本提取 content 字段值
                // 处理响应被截断或 content 为非标格式的情况
                let caps = content_regex.captures(&text)?;
                let val = caps.get(1)?.as_str().trim();
                if val.is_empty() { None } else { Some(val.to_string()) }
            });

            let reasoning_fallback = data["choices"].as_array()
                .and_then(|choices| choices.first())
                .and_then(|choice| choice["message"]["reasoning_content"].as_str()
                    .or_else(|| choice["message"]["reasoning"].as_str()))
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            // 模型返回空内容但消耗了 token（常见于 thinking/reasoning 模式）：
            // 不再重试浪费 token，把原始响应完整交给 chat.rs 去解析/兜底。
            if reasoning_only || (content_empty && completion_tokens > 0) {
                eprintln!(
                    "[call_ai] 模型返回空内容（completion_tokens={}，reasoning_tokens={}），不重试，交给 chat.rs 兜底",
                    completion_tokens,
                    reasoning_tokens.unwrap_or(0)
                );
            }

            // 尽量返回可见正文；没有正文则返回 reasoning 内容；都没有则返回空字符串
            let final_content = content.filter(|s| !s.trim().is_empty())
                .or_else(|| reasoning_fallback.clone())
                .unwrap_or_default();

            return Ok(LlmResponse {
                content: final_content,
                raw_response: text,
                reasoning_content: reasoning_fallback,
                usage: usage_val,
            });
        }

        // 构建错误信息
        let error_msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v["error"]["message"]
                    .as_str()
                    .or_else(|| v["message"].as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));

        // 429 = rate limit / 503 = service unavailable，指数退避后重试
        let retryable = status.as_u16() == 429
            || status.as_u16() == 503
            || error_msg.contains("ResourceExhausted")
            || error_msg.contains("request limit");
        if retryable && attempt < max_retries {
            let wait_ms = 2000 * (2u64.pow(attempt as u32)); // 2s, 4s, 8s
            use tokio::time::sleep;
            sleep(Duration::from_millis(wait_ms)).await;
            last_error = error_msg;
            continue;
        }

        // 其他错误直接返回
        return Err(error_msg);
    }

    Err(format!("重试 {} 次后仍失败: {}", max_retries, last_error))
}

/// 内部通用非流式调用（Rust 后台任务用，无 MCP 注入）
pub async fn call_ai_plain(base_url: String, api_key: String, body: String) -> Result<String, String> {
    call_ai_full(base_url, api_key, body).await.map(|r| r.content)
}

/// 非流式 LLM 调用（前端命令）：仅返回提取后的 content
/// 内置 rate limit 重试：429 时指数退避等待，最多重试 3 次
/// 🆕 MCP：有已连接的 MCP 工具时自动注入并执行工具循环
#[tauri::command]
pub async fn call_ai(
    app: AppHandle,
    base_url: String,
    api_key: String,
    body: String,
) -> Result<String, String> {
    if let Some(manager) = app.try_state::<crate::mcp::McpManager>() {
        if manager.get_llm_tools().await.is_some() {
            let body_v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            // 调用方未显式传 tools 时才自动注入
            if !body_v.is_null() && body_v.get("tools").is_none() {
                return call_ai_with_tools(base_url, api_key, body_v, &manager)
                    .await
                    .map(|r| r.content);
            }
        }
    }
    call_ai_full(base_url, api_key, body).await.map(|r| r.content)
}

// ==================== MCP 工具调用循环 ====================

/// 带工具循环的 LLM 调用：
/// 注入 MCP 工具（OpenAI function calling 格式）→ 模型请求 tool_calls 时
/// 通过 McpManager 执行 → 结果以 role:"tool" 追加 → 循环直至产出正文
/// 或达到轮数上限（最终去掉 tools 强制文本回复）。
pub async fn call_ai_with_tools(
    base_url: String,
    api_key: String,
    mut body: Value,
    manager: &crate::mcp::McpManager,
) -> Result<LlmResponse, String> {
    let tools = manager.get_llm_tools().await;
    let has_tools = tools.is_some();
    if let Some(t) = &tools {
        body["tools"] = t.clone();
        body["tool_choice"] = serde_json::json!("auto");
    }
    let mut messages = body["messages"].as_array().cloned().unwrap_or_default();
    let mut attempt = 0;

    loop {
        let body_str = serde_json::to_string(&body).map_err(|e| format!("序列化请求体失败: {}", e))?;
        let resp = match call_ai_full(base_url.clone(), api_key.clone(), body_str).await {
            Ok(r) => r,
            Err(e) => {
                // 上游不支持 tools 参数时兜底：去掉工具重试一次
                if has_tools && attempt == 0
                    && (e.contains("tool") || e.contains("Tool") || e.contains("function") || e.contains("未知参数"))
                {
                    eprintln!("[MCP循环] 上游疑似不支持 tools，去掉工具重试: {}", e);
                    if let Some(obj) = body.as_object_mut() {
                        obj.remove("tools");
                        obj.remove("tool_choice");
                    }
                    attempt += 1;
                    continue;
                }
                return Err(e);
            }
        };

        let data: Value = serde_json::from_str(&resp.raw_response).unwrap_or(Value::Null);
        let tcs = data["choices"][0]["message"]["tool_calls"]
            .as_array()
            .cloned()
            .filter(|t| !t.is_empty());
        let Some(tcs) = tcs else { return Ok(resp) };

        // 追加 assistant（原样含 tool_calls）+ 工具结果
        messages.push(data["choices"][0]["message"].clone());
        for tc in &tcs {
            let fn_name = tc["function"]["name"].as_str().unwrap_or("").to_string();
            let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}").to_string();
            let call_id = tc["id"].as_str().unwrap_or("").to_string();
            eprintln!("[MCP循环] round {}/{} 执行工具 {}", attempt + 1, crate::mcp::MAX_TOOL_ROUNDS, fn_name);
            let result = manager
                .execute_llm_tool(&fn_name, &args_str)
                .await
                .unwrap_or_else(|e| format!("工具执行失败: {}", e));
            messages.push(serde_json::json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": result.chars().take(TOOL_RESULT_MAX_CHARS).collect::<String>(),
            }));
        }
        body["messages"] = Value::Array(messages.clone());

        if attempt >= crate::mcp::MAX_TOOL_ROUNDS {
            // 达到轮数上限：去掉 tools 强制产出最终文本回复
            if let Some(obj) = body.as_object_mut() {
                obj.remove("tools");
                obj.remove("tool_choice");
            }
            let body_str = serde_json::to_string(&body).map_err(|e| e.to_string())?;
            return call_ai_full(base_url, api_key, body_str).await;
        }
        attempt += 1;
    }
}

// ==================== 响应内容提取 ====================

/// SSE 兜底解析：从 `data: {...}` 流式文本中拼接所有 delta content。
/// 用于上游在非流式请求下仍返回 event-stream 的情况，救回正文避免整次调用作废。
fn parse_sse_fallback(text: &str) -> Option<String> {
    if !text.contains("data:") {
        return None;
    }
    let mut full = String::new();
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with("data:") {
            continue;
        }
        let data = line[5..].trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        if let Ok(json) = serde_json::from_str::<Value>(data) {
            if let Some(choices) = json["choices"].as_array() {
                for choice in choices {
                    if let Some(token) = choice["delta"]["content"].as_str() {
                        full.push_str(token);
                    }
                    if let Some(token) = choice["message"]["content"].as_str() {
                        full.push_str(token);
                    }
                }
            }
        }
    }
    let full = full.trim().to_string();
    if full.is_empty() { None } else { Some(full) }
}

/// 从 LLM 响应 JSON 中按优先级提取回复内容
/// 兼容主流 LLM 供应商的响应格式：
/// - OpenAI / Azure OpenAI / 通义千问 / Moonshot / DeepSeek / Groq / Together / Ollama
/// - Google Gemini (via OpenAI 兼容层 + 原生格式)
/// - Anthropic Claude (via OpenAI 兼容层 + 原生格式)
/// - 百度文心 / 讯飞星火 / 智谱 GLM 等国产模型
fn extract_content_from_response(data: &Value) -> Option<String> {
    // ── 1. OpenAI 兼容格式（大多数供应商） ──
    if let Some(choices) = data["choices"].as_array() {
        for choice in choices {
            let msg = &choice["message"];

            // 1a. 标准 content（string）— 最高优先级
            if let Some(c) = msg["content"].as_str() {
                if !c.trim().is_empty() {
                    return Some(c.to_string());
                }
            }

            // 1b. content 为 parts 数组（Qwen / DashScope 某些模式）
            if let Some(parts) = msg["content"].as_array() {
                let text: String = parts.iter()
                    .filter_map(|p| {
                        if let Some(s) = p.as_str() {
                            Some(s)
                        } else {
                            p["text"].as_str()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("");
                if !text.trim().is_empty() {
                    return Some(text);
                }
            }

            // 1c. content 为 object（Gemini OpenAI 兼容层 / 非标格式）
            if msg["content"].is_object() {
                if let Some(parts) = msg["content"]["parts"].as_array() {
                    let text: String = parts.iter()
                        .filter_map(|p| p["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("");
                    if !text.trim().is_empty() {
                        return Some(text);
                    }
                }
                if let Some(text) = msg["content"]["text"].as_str() {
                    if !text.trim().is_empty() {
                        return Some(text.to_string());
                    }
                }
            }

            // 1d. content 为空时，检查 reasoning_content / reasoning
            //     注意：reasoning 是"思考过程"，不是实际回复
            //     只有当 content 完全缺失（非空字符串）时才考虑 reasoning
            //     如果 content 存在但为空字符串，说明模型没有生成回复 → 返回 None
            if msg["content"].as_str().map(|s| s.trim().is_empty()).unwrap_or(true) {
                if let Some(r) = msg["reasoning_content"].as_str().or_else(|| msg["reasoning"].as_str()) {
                    if !r.trim().is_empty() {
                        return Some(r.trim().to_string());
                    }
                }
            }

            // 1e. tool_calls 中的函数参数
            if let Some(tool_calls) = msg["tool_calls"].as_array() {
                for tc in tool_calls {
                    if let Some(args) = tc["function"]["arguments"].as_str() {
                        if !args.trim().is_empty() {
                            if let Ok(parsed) = serde_json::from_str::<Value>(args) {
                                if let Some(c) = parsed["content"].as_str() {
                                    if !c.trim().is_empty() {
                                        return Some(c.to_string());
                                    }
                                }
                            }
                            return Some(args.to_string());
                        }
                    }
                }
            }
        }
    }

    // ── 2. Google Gemini 原生格式（candidates 结构） ──
    if let Some(candidates) = data["candidates"].as_array() {
        for candidate in candidates {
            // candidates[0].content.parts[].text
            if let Some(parts) = candidate["content"]["parts"].as_array() {
                let text: String = parts.iter()
                    .filter_map(|p| p["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("");
                if !text.trim().is_empty() {
                    return Some(text);
                }
            }
            // candidates[0].content.parts[].thought（Gemini 思考模式）
            if let Some(parts) = candidate["content"]["parts"].as_array() {
                let text: String = parts.iter()
                    .filter_map(|p| {
                        if p["thought"].as_bool() == Some(true) {
                            p["text"].as_str()
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("");
                if !text.trim().is_empty() {
                    return Some(text);
                }
            }
        }
    }

    // ── 3. Anthropic Claude 原生格式 ──
    if let Some(content_arr) = data["content"].as_array() {
        let text: String = content_arr.iter()
            .filter_map(|item| {
                if item["type"].as_str() == Some("text") {
                    item["text"].as_str()
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join("");
        if !text.trim().is_empty() {
            return Some(text);
        }
    }

    // ── 4. 百度文心 / 讯飞星火 / 智谱等国产模型 ──
    let fallback_fields = [
        "result", "reply", "output",
    ];
    for field in &fallback_fields {
        if let Some(c) = data[field].as_str() {
            if !c.trim().is_empty() {
                return Some(c.to_string());
            }
        }
        if let Some(c) = data["data"][field].as_str() {
            if !c.trim().is_empty() {
                return Some(c.to_string());
            }
        }
    }

    if let Some(c) = data["data"]["content"].as_str() {
        if !c.trim().is_empty() {
            return Some(c.to_string());
        }
    }

    if let Some(c) = data["output"]["text"].as_str() {
        if !c.trim().is_empty() {
            return Some(c.to_string());
        }
    }

    // ── 5. 顶层 content（极少部分 API） ──
    if let Some(c) = data["content"].as_str() {
        if !c.trim().is_empty() {
            return Some(c.to_string());
        }
    }

    // ── 6. 最后兜底：任何 choice 的 message 拼接 ──
    if let Some(choices) = data["choices"].as_array() {
        let combined: String = choices.iter()
            .filter_map(|c| c["message"]["content"].as_str())
            .filter(|s| !s.trim().is_empty())
            .collect::<Vec<_>>()
            .join("");
        if !combined.trim().is_empty() {
            return Some(combined);
        }
    }

    None
}

// ==================== 流式调用 ====================

/// 流式 LLM 调用，通过 Tauri 事件推送 token（替换前端 doStreamFetch）
#[tauri::command]
pub async fn call_ai_stream(
    app: AppHandle,
    request_id: String,
    base_url: String,
    api_key: String,
    body: String,
) -> Result<(), String> {
    let client = shared_client().clone();

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let mut response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .body(body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "无法读取响应".to_string());
        let error_msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v["error"]["message"]
                    .as_str()
                    .or_else(|| v["message"].as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        let _ = app.emit(&format!("stream-error-{}", request_id), &error_msg);
        return Err(error_msg);
    }

    let mut full_text = String::new();
    let mut buffer = String::new();

    loop {
        let chunk = response.chunk().await.map_err(|e| {
            let err = format!("读取流失败: {}", e);
            let _ = app.emit(&format!("stream-error-{}", request_id), &err);
            err
        })?;

        let chunk = match chunk {
            Some(c) => c,
            None => break,
        };

        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }

            let data = &line[6..];

            if data == "[DONE]" {
                break;
            }

            if let Ok(json) = serde_json::from_str::<Value>(data) {
                if let Some(choices) = json["choices"].as_array() {
                    for choice in choices {
                        let delta = &choice["delta"];

                        // 标准 content token
                        if let Some(token) = delta["content"].as_str() {
                            if !token.is_empty() {
                                full_text.push_str(token);
                                let _ = app.emit(
                                    &format!("stream-token-{}", request_id),
                                    StreamTokenPayload { token: token.to_string() },
                                );
                            }
                        }

                        // content 为数组（Qwen / DashScope）
                        if let Some(parts) = delta["content"].as_array() {
                            for part in parts {
                                if let Some(token) = part["text"].as_str() {
                                    if !token.is_empty() {
                                        full_text.push_str(token);
                                        let _ = app.emit(
                                            &format!("stream-token-{}", request_id),
                                            StreamTokenPayload { token: token.to_string() },
                                        );
                                    }
                                }
                            }
                        }

                        // reasoning_content（DeepSeek-R1 / Gemini 思考 / QwQ）
                        if let Some(reasoning) = delta["reasoning_content"].as_str() {
                            if !reasoning.is_empty() {
                                full_text.push_str(reasoning);
                                let _ = app.emit(
                                    &format!("stream-token-{}", request_id),
                                    StreamTokenPayload { token: reasoning.to_string() },
                                );
                            }
                        }

                        // reasoning（OpenAI o1 系列）
                        if let Some(reasoning) = delta["reasoning"].as_str() {
                            if !reasoning.is_empty() {
                                full_text.push_str(reasoning);
                                let _ = app.emit(
                                    &format!("stream-token-{}", request_id),
                                    StreamTokenPayload { token: reasoning.to_string() },
                                );
                            }
                        }
                    }
                }

                // Gemini 原生流式格式：candidates[].content.parts[].text
                if let Some(candidates) = json["candidates"].as_array() {
                    for candidate in candidates {
                        if let Some(parts) = candidate["content"]["parts"].as_array() {
                            for part in parts {
                                if let Some(token) = part["text"].as_str() {
                                    if !token.is_empty() {
                                        full_text.push_str(token);
                                        let _ = app.emit(
                                            &format!("stream-token-{}", request_id),
                                            StreamTokenPayload { token: token.to_string() },
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit(
        &format!("stream-complete-{}", request_id),
        StreamCompletePayload {
            full_text: full_text.clone(),
        },
    );

    Ok(())
}

// ==================== 事件载荷 ====================

#[derive(Clone, serde::Serialize)]
struct StreamTokenPayload {
    token: String,
}

#[derive(Clone, serde::Serialize)]
struct StreamCompletePayload {
    full_text: String,
}
