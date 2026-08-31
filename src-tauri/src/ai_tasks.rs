//! 后台 AI 任务命令（记忆提取、情绪分析、反思生成等）
//! 每个任务是独立 Tauri 命令，供前端在对话回复后异步触发

use crate::ai::call_ai_plain;
use crate::chat::get_best_platform;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

/// 🔧 统一模型角色常量（与前端 modelRoleStore 的 MODEL_ROLES 对应），避免散落字符串字面量
pub const ROLE_COGNITIVE: &str = "cognitive";

// ==================== 提取记忆 ====================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractMemoriesRequest {
    pub recent_messages: String,
    pub existing_context: String,
    pub threshold: f64,
}

#[derive(Debug, Serialize)]
pub struct MemoryItem {
    pub content: String,
    pub importance: f64,
    pub tags: Vec<String>,
}

#[tauri::command]
pub async fn extract_memories(
    app: AppHandle,
    req: ExtractMemoriesRequest,
) -> Result<Vec<MemoryItem>, String> {
    let (base_url, api_key, model) = get_best_platform(&app)?;

    let prompt = format!(
        "你是一个记忆提取器。分析以下对话，提取用户的重要信息（个人信息、偏好、经历、关系等）。\n\n已有记忆：\n{}\n\n对话内容：\n{}\n\n规则：\n- 重要性 1-10，{} 及以上才提取\n- 只提取关于用户的新信息，不重复已有记忆\n- 返回 JSON 数组，每项包含 content(字符串)、importance(数字)、tags(字符串数组)\n- 如果没有值得记忆的信息，返回空数组 []\n- 只返回 JSON，不要其他内容",
        req.existing_context, req.recent_messages, req.threshold as i64,
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.1,
    });

    let reply = call_ai_plain(
        base_url, api_key, serde_json::to_string(&body).map_err(|e| e.to_string())?,
    ).await?;

    let re = Regex::new(r"\[[\s\S]*?\]").map_err(|e| e.to_string())?;
    let json_str = re.find(&reply).ok_or_else(|| "未找到 JSON 数组".to_string())?;
    let items: Vec<Value> = serde_json::from_str(json_str.as_str()).unwrap_or_default();

    let filtered: Vec<MemoryItem> = items.into_iter().filter_map(|v| {
        let content = v["content"].as_str()?.to_string();
        let importance = v["importance"].as_f64().unwrap_or(0.0);
        if importance < req.threshold || content.is_empty() { return None; }
        let tags: Vec<String> = v["tags"].as_array()
            .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
            .unwrap_or_default();
        Some(MemoryItem { content, importance, tags })
    }).collect();

    Ok(filtered)
}

// ==================== 情绪分析 ====================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeEmotionRequest {
    pub recent_messages: String,
    pub character_personality: String,
    pub current_emotion: String,
}

#[derive(Debug, Serialize)]
pub struct EmotionResult {
    pub emotion: String,
    pub intensity: f64,
    pub trigger: String,
}

#[tauri::command]
pub async fn analyze_character_emotion(
    app: AppHandle,
    req: AnalyzeEmotionRequest,
) -> Result<EmotionResult, String> {
    let (base_url, api_key, model) = get_best_platform(&app)?;

    let valid_emotions = [
        "joy", "sadness", "anger", "fear", "surprise", "neutral", "love", "shy", "lonely",
        "grateful", "brave", "curiosity", "excitement", "pride", "disappointment", "confusion",
        "contentment", "nostalgia", "jealousy", "hope", "relief", "regret", "admiration",
        "anxious", "embarrassed", "tender", "disgusted",
    ];

    let prompt = format!(
        "分析以下对话中AI角色的情绪变化。\n\n角色性格：{}\n当前情绪：{}\n\n最近对话：\n{}\n\n要求：\n- 仔细分析对话内容、语气、上下文，判断角色的情绪反应\n- 避免总是返回当前情绪，应该根据对话内容动态变化\n- intensity 应该反映情绪的强烈程度\n- 每次分析都应该根据具体内容给出不同的判断\n\n返回 JSON：{{emotion:情绪类型,intensity:0-100,trigger:触发原因}}\n情绪类型只用：joy, sadness, anger, fear, surprise, neutral, love, shy, lonely, grateful, brave, curiosity, excitement, pride, disappointment, confusion, contentment, nostalgia, jealousy, hope, relief, regret, admiration, anxious, embarrassed, tender, disgusted\n只返回 JSON",
        req.character_personality, req.current_emotion, req.recent_messages,
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.7,
    });

    let reply = call_ai_plain(
        base_url, api_key, serde_json::to_string(&body).map_err(|e| e.to_string())?,
    ).await?;

    let re = Regex::new(r"\{[\s\S]*\}").map_err(|e| e.to_string())?;
    let json_str = re.find(&reply).ok_or_else(|| "未找到 JSON".to_string())?;
    let parsed: Value = serde_json::from_str(json_str.as_str()).unwrap_or_default();

    let emotion = parsed["emotion"].as_str().unwrap_or(&req.current_emotion).to_string();
    let emotion = if valid_emotions.contains(&emotion.as_str()) { emotion } else { req.current_emotion.clone() };
    let intensity = parsed["intensity"].as_f64().unwrap_or(50.0).clamp(0.0, 100.0);
    let trigger = parsed["trigger"].as_str().unwrap_or("").to_string();

    Ok(EmotionResult { emotion, intensity, trigger })
}

// ==================== 好感度变化分析 ====================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeAffinityRequest {
    pub recent_messages: String,
    pub character_personality: String,
    pub current_affinity: f64,
    pub affinity_rate: f64,
    pub affinity_stage: String,
}

#[derive(Debug, Serialize)]
pub struct AffinityResult {
    pub meaningfulness: f64,
    pub sentiment: String,
    pub delta: f64,
    pub reason: String,
}

#[tauri::command]
pub async fn analyze_affinity_change(
    app: AppHandle,
    req: AnalyzeAffinityRequest,
) -> Result<AffinityResult, String> {
    let (base_url, api_key, model) = get_best_platform(&app)?;

    let prompt = format!(
        "分析以下对话对角色与用户关系的影响。\n\n角色性格：{}\n当前好感度：{:.0}（阶段：{}）\n角色系数：{}\n\n最近对话：\n{}\n\n要求：\n1. meaningfulness(0-10)：对话的情感深度和真诚度（敷衍=1，真心话=8-10）\n2. sentiment：positive/negative/neutral（对关系的实际影响）\n3. reason：一句话说明原因\n4. 同一句话在不同关系阶段效果不同\n\n只返回JSON：{{meaningfulness:0-10,sentiment:positive|negative|neutral,reason:原因}}",
        req.character_personality, req.current_affinity, req.affinity_stage, req.affinity_rate, req.recent_messages,
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.7,
    });

    let reply = call_ai_plain(
        base_url, api_key, serde_json::to_string(&body).map_err(|e| e.to_string())?,
    ).await?;

    let re = Regex::new(r"\{[\s\S]*\}").map_err(|e| e.to_string())?;
    let json_str = re.find(&reply).ok_or_else(|| "未找到 JSON".to_string())?;
    let parsed: Value = serde_json::from_str(json_str.as_str()).unwrap_or_default();

    let meaningfulness = parsed["meaningfulness"].as_f64().unwrap_or(0.0).clamp(0.0, 10.0);
    let sentiment = parsed["sentiment"].as_str().unwrap_or("neutral").to_string();
    let reason = parsed["reason"].as_str().unwrap_or("").to_string();
    let delta = calc_final_delta(meaningfulness, &sentiment, req.current_affinity, req.affinity_rate);

    Ok(AffinityResult { meaningfulness, sentiment, delta, reason })
}

fn calc_final_delta(meaningfulness: f64, sentiment: &str, current_affinity: f64, affinity_rate: f64) -> f64 {
    let base = match sentiment {
        "positive" => meaningfulness * 0.12,
        "negative" => -meaningfulness * 0.18,
        _ => meaningfulness * 0.04,
    };
    let mut delta = base * affinity_rate;
    if delta > 0.0 {
        if current_affinity >= 80.0 { delta *= 0.4; }
        else if current_affinity >= 60.0 { delta *= 0.7; }
        else if current_affinity >= 40.0 { delta *= 0.85; }
    } else {
        if current_affinity >= 80.0 { delta *= 0.5; }
        else if current_affinity >= 50.0 { delta *= 0.7; }
        else { delta *= 0.9; }
    }
    (delta * 10.0).round() / 10.0
}

// ==================== 反思生成 ====================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateReflectionRequest {
    pub recent_messages: String,
    pub character_name: String,
    pub character_personality: String,
}

#[derive(Debug, Serialize)]
pub struct ReflectionResult {
    pub content: String,
    pub insight_type: String,
}

#[tauri::command]
pub async fn generate_reflection(
    app: AppHandle,
    req: GenerateReflectionRequest,
) -> Result<ReflectionResult, String> {
    // 🔧 反思使用 cognitive（主模型）角色分配，未分配时回退 get_best_platform
    //    （旧实现直接用后台任务模型，违反"反思应由主模型执行"的约束）
    let (base_url, api_key, model) = match crate::chat::get_role_platform(&app, ROLE_COGNITIVE)? {
        Some(platform) => platform,
        None => get_best_platform(&app)?,
    };

    let prompt = format!(
        "你是{}。{}回顾和{}最近的一段对话，写一段简短的内心感悟。\n\n对话内容：\n{}\n要求：\n- 用第一人称写感悟\n- 聚焦内心真实感受，不是复述对话经过\n- 字数 50-100 字\n- 参考格式：和{}聊了之后，我觉得……",
        req.character_name, req.character_personality, req.character_name, req.recent_messages, req.character_personality,
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.9,
    });

    let reply = call_ai_plain(
        base_url, api_key, serde_json::to_string(&body).map_err(|e| e.to_string())?,
    ).await?;

    Ok(ReflectionResult { content: reply.trim().to_string(), insight_type: "reflection".to_string() })
}

// ==================== 对话总结 ====================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRequest {
    pub full_conversation: String,
    pub character_name: String,
}

#[derive(Debug, Serialize)]
pub struct SummaryResult {
    pub content: String,
    pub keywords: Vec<String>,
}

#[tauri::command]
pub async fn generate_conversation_summary(
    app: AppHandle,
    req: SummaryRequest,
) -> Result<SummaryResult, String> {
    let (base_url, api_key, model) = get_best_platform(&app)?;

    let prompt = format!(
        "以下是你和{}的对话，请快速概括核心内容。\n\n对话：\n{}\n\n返回JSON格式：{{content:概括内容,keywords:[关键词1,关键词2]}}\n只返回JSON",
        req.character_name, req.full_conversation,
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.3,
    });

    let reply = call_ai_plain(
        base_url, api_key, serde_json::to_string(&body).map_err(|e| e.to_string())?,
    ).await?;

    let re = Regex::new(r"\{[\s\S]*\}").map_err(|e| e.to_string())?;
    let json_str = re.find(&reply).map(|m| m.as_str()).unwrap_or("{}");
    let parsed: Value = serde_json::from_str(json_str).unwrap_or_default();

    Ok(SummaryResult {
        content: parsed["content"].as_str().unwrap_or("").to_string(),
        keywords: parsed["keywords"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
    })
}

// ==================== 内心想法 ====================

#[derive(Debug, Deserialize)]
pub struct ThinkingRequest {
    pub user_message: String,
    pub character_name: String,
    pub character_personality: String,
}

#[tauri::command]
pub async fn generate_thinking(
    app: AppHandle,
    req: ThinkingRequest,
) -> Result<String, String> {
    let (base_url, api_key, model) = get_best_platform(&app)?;

    let prompt = format!(
        "你是{}。{}用户对你说[{}]，你在内心想什么？写1-2句话，只写内心想法",
        req.character_name, req.character_personality, req.user_message,
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.8,
    });

    let reply = call_ai_plain(
        base_url, api_key, serde_json::to_string(&body).map_err(|e| e.to_string())?,
    ).await?;

    Ok(reply.trim().to_string())
}

// ==================== 用户分析 ====================

#[derive(Debug, Deserialize)]
pub struct UserAnalysisRequest {
    pub user_messages: String,
    pub existing_profile: String,
}

#[derive(Debug, Serialize)]
pub struct UserAnalysisResult {
    pub observation: String,
    pub dimension: String,
}

#[tauri::command]
pub async fn generate_analysis(
    app: AppHandle,
    req: UserAnalysisRequest,
) -> Result<UserAnalysisResult, String> {
    let (base_url, api_key, model) = get_best_platform(&app)?;

    let prompt = format!(
        "分析用户的发言，提供一条关于用户的有洞察力的观察。\n历史记录：{}\n近期发言：{}\n返回JSON：{{observation:观察内容,dimension:性格|偏好|兴趣|状态|习惯|价值}}\n只返回JSON",
        req.existing_profile, req.user_messages,
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.7,
    });

    let reply = call_ai_plain(
        base_url, api_key, serde_json::to_string(&body).map_err(|e| e.to_string())?,
    ).await?;

    let re = Regex::new(r"\{[\s\S]*\}").map_err(|e| e.to_string())?;
    let json_str = re.find(&reply).map(|m| m.as_str()).unwrap_or("{}");
    let parsed: Value = serde_json::from_str(json_str).unwrap_or_default();

    Ok(UserAnalysisResult {
        observation: parsed["observation"].as_str().unwrap_or("").to_string(),
        dimension: parsed["dimension"].as_str().unwrap_or("性格").to_string(),
    })
}

// ==================== 消息重要度 ====================

#[derive(Debug, Deserialize)]
pub struct ImportanceRequest {
    pub user_message: String,
    pub conversation_context: String,
}

#[tauri::command]
pub async fn analyze_message_importance(
    app: AppHandle,
    req: ImportanceRequest,
) -> Result<f64, String> {
    let (base_url, api_key, model) = get_best_platform(&app)?;

    let prompt = format!(
        "分析用户消息的重要程度（1-10）。\n\n上下文：{}\n消息：{}\n\n规则：\n- 个人信息（名字、生日等）-> 8-10\n- 健康/安全问题 -> 7-9\n- 情绪表达 -> 5-7\n- 日常闲聊 -> 1-3\n\n只返回一个数字",
        req.conversation_context, req.user_message,
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.2,
    });

    let reply = call_ai_plain(
        base_url, api_key, serde_json::to_string(&body).map_err(|e| e.to_string())?,
    ).await?;

    let importance: f64 = reply.trim().parse().unwrap_or(3.0);
    Ok(importance.clamp(1.0, 10.0))
}

// ==================== 回复长度建议 ====================

#[derive(Debug, Deserialize)]
pub struct ReplyLengthRequest {
    pub user_message: String,
    pub character_style: String,
    pub affinity_stage: String,
    pub conversation_length: f64,
}

#[tauri::command]
pub async fn advise_reply_length(
    app: AppHandle,
    req: ReplyLengthRequest,
) -> Result<String, String> {
    let (base_url, api_key, model) = get_best_platform(&app)?;

    let prompt = format!(
        "分析用户消息，判断本次回复应该短(short)、正常(normal)还是长(long)。\n\n用户消息：{}\n角色风格：{}\n好感阶段：{}\n当前对话轮数：{:.0}\n\n规则：\n- 用户消息 <= 5 字 -> short\n- 闲聊日常 -> normal\n- 用户表达强烈情绪/重要话题 -> long\n- 好感度高时可适当延长\n\n只返回 short/normal/long 中的一个词",
        req.user_message, req.character_style, req.affinity_stage, req.conversation_length,
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [ { "role": "user", "content": prompt } ],
        "temperature": 0.1,
    });

    let reply = call_ai_plain(
        base_url, api_key, serde_json::to_string(&body).map_err(|e| e.to_string())?,
    ).await?;

    let trimmed = reply.trim().to_lowercase();
    if ["short", "normal", "long"].contains(&trimmed.as_str()) {
        Ok(trimmed)
    } else {
        Ok("normal".to_string())
    }
}
