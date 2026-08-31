//! ============================================================
//! 输出后处理 Pipeline（Rust 后端版）
//! 对应前端 src/services/output/pipelineSteps.ts + pipelineV2.ts 的 10 步管线。
//! 迁移目的：前端只做渲染展示，文本处理（清洗/拦截/错字/长度/分段/语气/口语化/标点/节奏/最终净化）
//! 统一在 Rust 端完成，降低 JS 端状态负担并保持与认知链一致。
//! ============================================================

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

// ==================== 请求/响应 ====================

/// 输出后处理配置（由前端 v2Settings 透传，Rust 端在 process_message 内部完成分段）
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostConfig {
    pub segment_enabled: bool,
    pub segment_threshold: i64,
    pub max_segments: i64,
    pub pair_protection: bool,
    pub typo_sim_enabled: bool,
    pub typo_prob: f64,
    pub tone_polish_enabled: bool,
    pub tone_intensity: f64,
    pub colloquialism_enabled: bool,
    pub smart_punctuation_enabled: bool,
    pub speaking_rhythm_enabled: bool,
    pub final_sanitize_enabled: bool,
    pub normalize_whitespace: bool,
    pub remove_duplicate_punctuation: bool,
    pub clean_markers_enabled: bool,
    // ---- V5: 补齐前端设置（之前硬编码或缺失，导致设置面板的开关不生效） ----
    /// 拦截总开关（对应前端 messageProcessingConfig.enableIntercept / v2Config.blockCliche）
    #[serde(default = "default_block_cliche")]
    pub block_cliche_enabled: bool,
    /// 长度随机化开关（对应前端 v2Config.lengthRandomize）
    #[serde(default = "default_length_randomize")]
    pub length_randomize_enabled: bool,
    /// 情绪强度 0-100（用于语气/标点步骤，之前硬编码 50.0）
    #[serde(default = "default_emotion_intensity")]
    pub emotion_intensity: f64,
    /// 复读检测相似度阈值 0-1（对应前端 v2Config.duplicateThreshold，默认 0.92）
    #[serde(default = "default_dup_threshold")]
    pub duplicate_threshold: f64,
    /// 分段模式（punctuation / sentence / paragraph / smart）
    #[serde(default = "default_segment_mode")]
    pub segment_mode: String,
    /// 单段最小长度（对应前端 segmentConfig.minSegmentLength）
    #[serde(default = "default_min_segment")]
    pub min_segment_length: i64,
    /// AI 段间基础延迟（对应前端 segmentConfig.segmentDelayMs，动态延迟以此为基准）
    #[serde(default = "default_segment_delay")]
    pub segment_delay_ms: i64,
}

fn default_segment_delay() -> i64 { 800 }

fn default_block_cliche() -> bool { true }
fn default_length_randomize() -> bool { true }
fn default_emotion_intensity() -> f64 { 50.0 }

impl Default for PostConfig {
    fn default() -> Self {
        Self {
            segment_enabled: true,
            segment_threshold: 20,
            max_segments: 8,
            pair_protection: true,
            typo_sim_enabled: false,
            typo_prob: 0.04,
            // 🔧 输出卫生层重构（2026-08）：注入类步骤默认关闭。
            // 拟人化语气（语气词/口语化/标点变体/换行节奏）由模型在生成端完成
            // （prompt 层指令 + few-shot），后处理只做"清理类"工作：
            // 清洗标记/拦截复读/分段/标点归一化/最终净化。
            // 需要时可经前端设置面板显式开启。
            tone_polish_enabled: false,
            tone_intensity: 50.0,
            colloquialism_enabled: false,
            smart_punctuation_enabled: false,
            speaking_rhythm_enabled: false,
            final_sanitize_enabled: true,
            normalize_whitespace: true,
            remove_duplicate_punctuation: true,
            clean_markers_enabled: true,
            block_cliche_enabled: true,
            length_randomize_enabled: true,
            emotion_intensity: 50.0,
            duplicate_threshold: 0.92,
            segment_mode: "smart".to_string(),
            min_segment_length: 8,
            segment_delay_ms: 800,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostPipelineRequest {
    /// 原始 AI 输出（未清洗）
    pub text: String,
    /// 当前情绪类型（joy/sadness/...），影响语气/标点步骤
    pub emotion: String,
    /// 情绪强度 0-100
    pub emotion_intensity: f64,
    /// 禁止词列表（检测违规则 abort）
    pub forbidden_text: Vec<String>,
    /// 历史 AI 回复（用于拦截复读，已由前端校验时可传空）
    pub recent_replies: Vec<String>,

    // ---- 各步骤开关（与前端 v2Settings 对齐） ----
    pub clean_markers_enabled: bool,
    pub block_cliche_enabled: bool,
    pub typo_sim_enabled: bool,
    pub typo_prob: f64,
    pub segment_enabled: bool,
    pub segment_threshold: i64,
    pub max_segments: i64,
    pub pair_protection: bool,
    pub tone_polish_enabled: bool,
    pub tone_intensity: f64,
    pub length_randomize_enabled: bool,
    pub colloquialism_enabled: bool,
    pub smart_punctuation_enabled: bool,
    pub speaking_rhythm_enabled: bool,
    pub final_sanitize_enabled: bool,
    pub normalize_whitespace: bool,
    pub remove_duplicate_punctuation: bool,
    // ---- V5: 对齐前端设置 ----
    /// 复读检测相似度阈值（前端 duplicateThreshold，默认 0.92）
    #[serde(default = "default_dup_threshold")]
    pub duplicate_threshold: f64,
    /// 分段模式（punctuation/sentence/paragraph/smart）
    #[serde(default = "default_segment_mode")]
    pub segment_mode: String,
    /// 单段最小长度（前端 minSegmentLength，默认 8）
    #[serde(default = "default_min_segment")]
    pub min_segment_length: i64,
    /// AI 段间基础延迟（前端 segmentDelayMs，默认 800ms）
    #[serde(default = "default_segment_delay")]
    pub segment_delay_ms: i64,
    // ---- 不完美注入所需字段 ----
    /// 当前对话轮数（长度随机化的频率衰减参考）
    #[serde(default)]
    pub dialogue_turn_count: u32,
    /// 🆕 P1-2: 回复风格种子（chat.rs 生成 rand seed，prompt 提示与后处理截断共用；
    /// 0 = 前端直调 pipeline 时现场随机）
    #[serde(default)]
    pub reply_style_seed: u64,
    /// 🆕 Bug1: 角色名（用于剥离日记/留言式落款署名，如"-你的星眠⭐"混入主回复）
    #[serde(default)]
    pub character_name: String,
}

fn default_dup_threshold() -> f64 { 0.92 }
fn default_segment_mode() -> String { "smart".to_string() }
fn default_min_segment() -> i64 { 8 }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostPipelineResponse {
    pub text: String,
    pub segments: Vec<String>,
    /// AI 段间延迟数组：第 i 项表示「第 i+1 段」相对「第 i 段」的等待毫秒数
    /// （由后处理阶段按段长度 + 情绪强度动态计算，前端按此延迟逐段发送）
    pub segment_delays: Vec<i64>,
    pub aborted: bool,
    pub abort_reason: Option<String>,
    pub logs: Vec<String>,
    /// 各步骤执行状态（供调试日志展示）
    pub step_results: Vec<PipelineStepResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStepResult {
    pub step: String,
    pub ok: bool,
    pub aborted: bool,
    pub msg: Option<String>,
}

// ==================== 步骤 1: 思维链标记清洗 ====================

/// 移除动作描写（非标签格式）：星号动作 `*xxx*` / ＊xxx＊、括号动作 `（xxx）` / `(xxx)`。
/// 🆕 P1-3 音量/语气标注白名单：这类括号是真人会打的（用户原话：卖萌时说"（超大声）"），
/// 删除动作时应保留。括号内容 ≤6 字且命中词表 → 保留不删。
const TONE_WHITELIST: [&str; 12] = [
    "超大声", "大声", "小声", "超小声", "悄悄", "气音", "嘟囔", "嘀咕", "心声", "旁白", "凑近耳边", "耳语",
];

fn is_tone_annotation(inner: &str) -> bool {
    let t = inner.trim();
    t.chars().count() <= 6 && TONE_WHITELIST.iter().any(|w| t.contains(w))
}

/// 括号内含对话引号（「」『』“”"'）时视为补充说明，保留不删。
/// 删除后清理残留：行首行尾空白、孤立标点开头、多余空行。
/// 🆕 P1-3: 残留清理只处理确实删除过动作的行（合法的行首"……嗯"不再被误剥）；
/// 相邻重复去重仅对修改过的行生效。
fn remove_action_descriptions(text: &str) -> (String, bool) {
    let mut cleaned = text.to_string();
    let mut changed = false;

    // 1) 星号动作（不跨行，避免误删整段）
    let star_re = Regex::new(r"[*＊][^*＊\n]{1,60}[*＊]").unwrap();
    if star_re.is_match(&cleaned) {
        cleaned = star_re.replace_all(&cleaned, "").to_string();
        changed = true;
    }

    // 2) 括号动作：捕获括号内部，含对话引号或命中音量/语气白名单则保留
    let paren_re = Regex::new(r"[（(]([^（）()\n]{0,80})[）)]").unwrap();
    let mut result = String::with_capacity(cleaned.len());
    let mut last_end = 0usize;
    for caps in paren_re.captures_iter(&cleaned) {
        let m = caps.get(0).unwrap();
        let inner = caps.get(1).map(|g| g.as_str()).unwrap_or("");
        let has_quote = inner.chars().any(|c| matches!(c, '「' | '」' | '『' | '』' | '“' | '”' | '"' | '\''));
        result.push_str(&cleaned[last_end..m.start()]);
        if has_quote || is_tone_annotation(inner) {
            // 补充说明（含引号对话）/音量语气标注，保留
            result.push_str(m.as_str());
        } else {
            changed = true;
        }
        last_end = m.end();
    }
    result.push_str(&cleaned[last_end..]);
    if changed {
        cleaned = result;
    }

    if !changed {
        return (cleaned, false);
    }

    // 3) 残留清理：只处理确实删除过动作的行（🆕 P1-3：未修改的行原样保留，
    //    避免"……嗯"这类合法的行首省略号被误剥）
    // 🔧 clippy：正则编译提到循环外（此前每行都重新编译）
    let star_re2 = Regex::new(r"[*＊][^*＊\n]{1,60}[*＊]").unwrap();
    let paren_re2 = Regex::new(r"[（(]([^（）()\n]{0,80})[）)]").unwrap();
    let mut lines: Vec<String> = Vec::new();
    for (idx, line) in cleaned.split('\n').enumerate() {
        let t = line.trim();
        // 判定该行是否含有被删除的动作：逐个移除动作后对比
        let mut probe = t.to_string();
        let mut line_changed = false;
        if star_re2.is_match(&probe) {
            probe = star_re2.replace_all(&probe, "").to_string();
            line_changed = true;
        }
        let mut probe2 = String::with_capacity(probe.len());
        let mut last_end2 = 0usize;
        let mut paren_removed = false;
        for caps in paren_re2.captures_iter(&probe) {
            let m = caps.get(0).unwrap();
            let inner = caps.get(1).map(|g| g.as_str()).unwrap_or("");
            let has_quote = inner.chars().any(|c| matches!(c, '「' | '」' | '『' | '』' | '“' | '”' | '"' | '\''));
            probe2.push_str(&probe[last_end2..m.start()]);
            if has_quote || is_tone_annotation(inner) {
                probe2.push_str(m.as_str());
            } else {
                paren_removed = true;
            }
            last_end2 = m.end();
        }
        probe2.push_str(&probe[last_end2..]);
        if paren_removed {
            probe = probe2;
            line_changed = true;
        }

        if line_changed {
            // 该行有动作被删 → 清理删除后行首残留的孤立标点
            let t = probe.trim().trim_start_matches(|c: char| "，。！？、；：,.!?;:~… ".contains(c));
            let t = t.trim_end().to_string();
            if !t.is_empty() {
                lines.push(t);
            }
        } else {
            let t = t.trim().to_string();
            if !t.is_empty() {
                lines.push(t);
            }
        }
        let _ = idx;
    }
    // 相邻完全重复的行去重（仅对动作删除可能造成的合并生效——
    // 🆕 P1-3: 刻意的重复行如撒娇的"不要 不要 不要"分行写法通常内容不完全相邻相同，
    // 保守起见保留 dedup，但仅相邻行）
    lines.dedup();
    let joined = lines.join("\n");
    let changed_final = joined != text.trim();
    (joined, changed_final)
}

fn clean_markers(text: &str) -> (String, bool) {
    let mut cleaned = text.to_string();
    let mut changed = false;

    // 移除 <thought>/<思考>/<feeling>/<情绪>/<action>/<动作> 及其内容
    // 🆕 Bug2: 补充 <think>/<thinking>（推理模型把思考混入 content 的场景）
    let block_pairs: [(&str, &str); 8] = [
        ("<thought", "thought>"), ("<思考", "思考>"),
        ("<feeling", "feeling>"), ("<情绪", "情绪>"),
        ("<action", "action>"), ("<动作", "动作>"),
        ("<think", "think>"), ("<thinking", "thinking>"),
    ];
    for (open, close) in block_pairs {
        let re = Regex::new(&format!(r"(?i){}[\s\S]*?</{}", open, close)).unwrap();
        if re.is_match(&cleaned) {
            cleaned = re.replace_all(&cleaned, "").to_string();
            changed = true;
        }
    }

    // 移除【动作】...【/动作】 块（中文方头括号标签）
    let cn_action_re = Regex::new(r"【动作】[\s\S]*?【/动作】").unwrap();
    if cn_action_re.is_match(&cleaned) {
        cleaned = cn_action_re.replace_all(&cleaned, "").to_string();
        changed = true;
    }

    // 移除 <reply> 标签（保留内容）
    let reply_re = Regex::new(r"(?i)</?reply[^>]*>").unwrap();
    if reply_re.is_match(&cleaned) {
        cleaned = reply_re.replace_all(&cleaned, "").to_string();
        changed = true;
    }

    // 中文章节：【内心活动】【想法】...（Rust regex 不支持 look-ahead，用手动清理）
    let cn_re = Regex::new(r"【(内心活动|想法|心理|思考)】").unwrap();
    if cn_re.is_match(&cleaned) {
        // 找到起始位置，删除到段落末尾（空行或结尾）
        let mut result = String::new();
        let mut rest = cleaned.as_str();
        while let Some(caps) = cn_re.captures(rest) {
            let m = caps.get(0).unwrap();
            let before = &rest[..m.start()];
            let after = &rest[m.end()..];
            // 从标记结束后截取到下一个空行或结尾
            let cut_end = after.find("\n\n").unwrap_or(after.len());
            result.push_str(before);
            rest = &after[cut_end..];
            changed = true;
        }
        result.push_str(rest);
        cleaned = result;
    }

    // 移除 "AI：/助手：" 前缀
    let prefix_re = Regex::new(r"^(AI|助手|回答|回复)[:：]\s*").unwrap();
    if prefix_re.is_match(&cleaned) {
        cleaned = prefix_re.replace(&cleaned, "").to_string();
        changed = true;
    }

    // 🆕 移除动作描写：星号动作、括号动作（含对话引号的括号保留）
    let (action_cleaned, action_changed) = remove_action_descriptions(&cleaned);
    if action_changed {
        cleaned = action_cleaned;
        changed = true;
    }

    cleaned = cleaned.trim().to_string();
    (cleaned, changed)
}

// ==================== 步骤 2: 拦截（长度/违规） ====================

/// 归一化用于复读检测：去掉标点/空白/大小写（与前端 normalizeForDuplicate 对齐）
fn normalize_for_duplicate(text: &str) -> String {
    text.chars()
        .filter(|c| {
            // 保留汉字、字母、数字；去掉标点/空白/符号（覆盖中英文标点）
            c.is_alphanumeric() && !c.is_whitespace()
        })
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// LCS 相似度（与前端 lcsSimilarity 对齐）：`2*LCS/(m+n)`。
/// 长度差 >30% 时直接返回 0（不相似）。
fn lcs_similarity(a: &str, b: &str) -> f64 {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let m = a.len();
    let n = b.len();
    if m == 0 || n == 0 {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    // 长度差 >30%，不相似（与前端一致）
    if (m.abs_diff(n)) as f64 / m.max(n) as f64 > 0.3 {
        return 0.0;
    }
    // 空间优化的 LCS DP（两行滚动数组）
    let mut prev = vec![0u32; n + 1];
    let mut curr = vec![0u32; n + 1];
    for i in 1..=m {
        for j in 1..=n {
            if a[i - 1] == b[j - 1] {
                curr[j] = prev[j - 1] + 1;
            } else {
                curr[j] = prev[j].max(curr[j - 1]);
            }
        }
        std::mem::swap(&mut prev, &mut curr);
        curr.fill(0);
    }
    (2.0 * prev[n] as f64) / (m + n) as f64
}

/// 复读检测（与前端 isDuplicate 对齐）：归一化 → 长度差检查 → 精确匹配 → LCS 相似度。
fn is_duplicate(text: &str, recent_replies: &[String], threshold: f64) -> bool {
    if recent_replies.is_empty() || text.chars().count() < 4 {
        return false;
    }
    let normalized = normalize_for_duplicate(text);
    if normalized.chars().count() < 2 {
        return false;
    }
    recent_replies.iter().any(|reply| {
        if reply.chars().count() < 4 {
            return false;
        }
        let reply_norm = normalize_for_duplicate(reply);
        if reply_norm.chars().count() < 2 {
            return false;
        }
        // 长度差 >30% 时跳过 LCS，但先做 🆕 P1-4 containment 检测：
        // 短串是长串的子串（换述式复读：意思相同、字数不同）→ 记为高度相似
        let nm = normalized.chars().count();
        let rn = reply_norm.chars().count();
        if (nm.abs_diff(rn)) as f64 / nm.max(rn) as f64 > 0.3 {
            if normalized.contains(&reply_norm) || reply_norm.contains(&normalized) {
                return true;
            }
            return false;
        }
        // 全文精确匹配（去标点后）
        if normalized == reply_norm {
            return true;
        }
        // 全文 LCS 相似度
        lcs_similarity(&normalized, &reply_norm) >= threshold
    })
}

fn block_cliche(text: &str, forbidden_text: &[String]) -> (bool, Option<String>) {
    // 1. 用户自定义禁止词检测
    for item in forbidden_text {
        let item = item.trim();
        if item.is_empty() { continue; }
        if text.to_lowercase().contains(&item.to_lowercase()) {
            return (true, Some(format!("违反禁止项: {}", item)));
        }
    }
    
    // 2. 内置套路词检测（使用独立的 cliche_patterns 模块）
    let matches = crate::cliche_patterns::detect_cliche(text);
    if let Some(first_match) = matches.first() {
        return (true, Some(format!(
            "套路词[{}]: \"{}\"", 
            first_match.category, 
            first_match.pattern
        )));
    }
    
    // 3. 长度检查（与前端 DEFAULT_BLOCK_CLICHE_CONFIG 一致）
    if text.trim().is_empty() {
        return (true, Some("回复为空".to_string()));
    }
    if text.chars().count() < 2 {
        return (true, Some("回复过短".to_string()));
    }
    (false, None)
}

// ==================== 步骤 3: 错字模拟 ====================

fn typo_sim(text: &str, prob: f64) -> (String, usize) {
    if prob <= 0.0 { return (text.to_string(), 0); }

    // 同音字映射（与前端 typoSimulator.ts 一致的核心常用字）
    const HOMOPHONE: [(&str, &[&str]); 24] = [
        ("的", &["德", "得"]), ("了", &["乐"]), ("是", &["事"]),
        ("我", &["窝"]), ("不", &["步"]), ("在", &["再"]),
        ("有", &["又"]), ("他", &["她"]), ("你", &["泥"]),
        ("就", &["旧"]), ("都", &["嘟"]), ("和", &["合"]),
        ("要", &["药"]), ("会", &["回"]), ("可", &["渴"]),
        ("很", &["狠"]), ("想", &["响"]), ("做", &["坐"]),
        ("能", &["嫩"]), ("说", &["硕"]), ("去", &["取"]),
        ("里", &["理"]), ("来", &["莱"]), ("没", &["梅"]),
    ];

    let chars: Vec<char> = text.chars().collect();
    if chars.len() < 6 { return (text.to_string(), 0); }

    let mut result = chars.clone();
    let mut corrections = 0usize;
    let mut i = 0usize;
    while i < chars.len() {
        if corrections >= 2 { break; }
        let c = chars[i];
        // 跳过标点/数字/英文
        if c.is_ascii_alphanumeric() || c.is_whitespace() { i += 1; continue; }
        let is_punct = "，。！？、；：,.!?;:\"'‘’“”（）()【】[]《》…~".contains(c);
        if is_punct { i += 1; continue; }

        // 🆕 P1-2 修复：原实现 hit = sin(8i).abs() 确定性——同一文本永远产生同样的错字；
        // 且 60% 分支 `hit * 3.0 < 1.8` 在 hit < prob ≤ 0.1 时恒真（死逻辑）。
        // 改为 rand：先掷命中，再 60% 概率选同音替换。
        let roll: f64 = rand::random();
        // 🔧 clippy：合并嵌套 if
        if roll < prob && rand::random::<f64>() < 0.6 {
            if let Some((_, choices)) = HOMOPHONE.iter().find(|(k, _)| *k == c.to_string()) {
                let idx = rand::random::<usize>() % choices.len();
                result[i] = choices[idx].chars().next().unwrap_or(c);
                corrections += 1;
            }
        }
        i += 1;
    }

    (result.into_iter().collect(), corrections)
}

// ==================== 步骤 4: 长度随机化 ====================

fn length_randomize(text: &str, _dialogue_turn_count: u32, style_seed: u64) -> (String, bool) {
    use crate::anti_cliche::{select_reply_style_seeded, ReplyStyle};

    let text = text.to_string();
    if text.chars().count() <= 10 { return (text, false); }

    // 🆕 P1-2: 风格由调用方 seed 决定（chat.rs 生成 rand seed，
    // prompt 风格提示与后处理截断共用同一 seed 保持一致）；seed=0 时现场随机
    let seed = if style_seed == 0 {
        let s: u64 = rand::random();
        s
    } else {
        style_seed
    };
    let style = select_reply_style_seeded(seed);

    match style {
        ReplyStyle::Full => {
            // 全量：不修改
            (text, false)
        }
        ReplyStyle::Normal => {
            // 中回复：仅截断超长句（>80字符），维持现有逻辑
            let segments = split_into_sentences(&text);
            if segments.is_empty() { return (text, false); }

            let mut changed = false;
            let result: Vec<String> = segments.into_iter().map(|seg| {
                if seg.chars().count() > 80 {
                    let target = 50 + (seg.len() % 16);
                    let cut = find_natural_cut(&seg, target);
                    if cut > 10 && cut < seg.chars().count() {
                        changed = true;
                        return seg.chars().take(cut).collect::<String>();
                    }
                }
                seg
            }).collect();

            (result.join(""), changed)
        }
        ReplyStyle::Long => {
            // 长回复：仅截断极长句（>120字符），允许更充分表达
            let segments = split_into_sentences(&text);
            if segments.is_empty() { return (text, false); }

            let mut changed = false;
            let result: Vec<String> = segments.into_iter().map(|seg| {
                if seg.chars().count() > 120 {
                    let target = 80 + (seg.len() % 20);
                    let cut = find_natural_cut(&seg, target);
                    if cut > 10 && cut < seg.chars().count() {
                        changed = true;
                        return seg.chars().take(cut).collect::<String>();
                    }
                }
                seg
            }).collect();

            (result.join(""), changed)
        }
        ReplyStyle::Short => {
            // 🔧 修复"消息传到前端被截断/内容缺失"：原实现只保留前 1-2 句并二次截断，
            //    直接丢弃后半段正文（全量日志里有、显示里没有的根因）。
            //    现在 Short 仅作为 prompt 风格提示（让模型自己生成短回复），
            //    后处理阶段不再删改任何内容。
            (text, false)
        }
    }
}

/// 按句末标点切分文本（保留标点）
/// 🆕 P0-3 修复：`…` 不再作为独立切分符——中文省略号"……"由两个 … 字符组成，
/// 原实现把它切成两段，第二段仅为一个省略号，Short 风格保留前 2 句时
/// 会占掉名额并丢弃真正的后半句（"小笨蛋就小笨蛋吧，哼。"丢失的根因）。
fn split_into_sentences(text: &str) -> Vec<String> {
    let mut segments: Vec<String> = Vec::new();
    let mut buf = String::new();
    for ch in text.chars() {
        buf.push(ch);
        if matches!(ch, '。' | '！' | '？' | '!' | '?') {
            segments.push(buf.trim().to_string());
            buf.clear();
        }
    }
    if !buf.trim().is_empty() {
        segments.push(buf.trim().to_string());
    }
    segments
}

fn find_natural_cut(text: &str, target: usize) -> usize {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let end = target.min(n);
    let start = end.saturating_sub(10);
    // 在 targetLen 附近找标点
    // 🆕 P0-3：候选标点移除 `…`，禁止截断点落在省略号中间
    for i in (start..end).rev() {
        if "，,、；;。！？」』】".contains(chars[i]) {
            return i + 1;
        }
    }
    // 找空格
    for i in (start..end).rev() {
        if chars[i] == ' ' {
            return i + 1;
        }
    }
    // 兜底
    end
}

// ==================== 步骤 5: 智能分段（四维断句引擎） ====================
//
// 🔄 2026-08 重写：移植 astrbot_plugin_custome_segment_reply 的"四维断句"思路，
// 彻底抛弃"猜标点"式的机械切分。四个维度：
//   1) 契约优先——模型按分段契约（chat.rs prompt 约定）用空行 \n\n 分隔多条消息，
//      空行是模型显式给出的消息边界，直接采用，不做二次猜测；
//   2) 黄金区间——无空行时按句末标点切分成句子，累计到 [min_len, max_len]
//      黄金区间内的句边界处断段；
//   3) 弹性延伸——单句自身超长且无句末标点 → fallback_split 物理截断兜底；
//   4) 短尾合并——末段过短时并入上一段（直接拼接，各句自带标点，绝不插入额外标点）。

fn split_segments(text: &str, threshold: i64, max_segments: i64, pair_protection: bool, mode: &str, min_segment_length: i64) -> Vec<String> {
    if text.trim().is_empty() {
        return vec![text.to_string()];
    }
    // 阈值语义对齐前端：总长度未超过 threshold 不分段（"N字以上才考虑分段"）
    // 例外：文本含 ≥2 个句末强标点（。！？）时仍分段——拟人多条发送
    let strong_end_count = text.chars().filter(|c| matches!(c, '。' | '！' | '？')).count();
    if text.chars().count() <= threshold.max(1) as usize && strong_end_count < 2 {
        return vec![text.to_string()];
    }

    let min_len = threshold.max(6) as usize;
    let text = text.trim().to_string();

    let merged: Vec<String> = if mode == "sentence" {
        // 每句话一段（用户显式选择的模式，保持原语义）
        let sentences = split_by_sentence_end(&text);
        if sentences.len() > 1 {
            sentences
        } else {
            fallback_split(&text)
        }
    } else {
        // 维度1：契约分段——空行是模型显式的消息边界，最高优先级
        let contract_segments: Vec<String> = text
            .split("\n\n")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if contract_segments.len() > 1 {
            // 契约分段命中：超长段内部再按黄金区间二次切分
            let mut out: Vec<String> = Vec::new();
            for seg in contract_segments {
                if seg.chars().count() > golden_max(min_len) {
                    let sentences = split_by_sentence_end(&seg);
                    out.extend(assemble_golden_range(sentences, min_len));
                } else {
                    out.push(seg);
                }
            }
            out
        } else {
            // 维度2+3：黄金区间断句 + 弹性延伸
            let sentences = split_by_sentence_end(&text);
            if sentences.len() > 1 {
                assemble_golden_range(sentences, min_len)
            } else {
                fallback_split(&text)
            }
        }
    };

    let mut result = merged;
    // 成对符号保护
    if pair_protection {
        result = protect_paired_symbols(result);
    }
    // 维度4：短尾合并（min_segment_length 为 0 时用 4 兜底）
    let min_tiny = if min_segment_length > 0 { min_segment_length as usize } else { 4 };
    result = merge_tiny_segments(result, min_tiny);

    // 段数超限：尾部各段直接拼接（各句自带句末标点）。
    // 🔧 修复：旧实现 join("，") 把多条带句号的完整句子用逗号硬缝，
    // 产出"……了。，……吗？，……"式的怪异标点序列（"多一个、"的来源之一）。
    if result.len() > max_segments.max(1) as usize {
        let max = max_segments.max(1) as usize;
        let take = result[..max - 1].to_vec();
        let tail = result[max - 1..].join("");
        result = take;
        result.push(tail);
    }

    result
}

/// 黄金区间上限：min_len 的 2 倍 + 20（保证短阈值下上限不至于过小）
fn golden_max(min_len: usize) -> usize {
    min_len * 2 + 20
}

/// 黄金区间组装：句子逐个累计，累计长度达到 min_len（区间下限）即断段；
/// 单句自身超过 max（区间上限）时弹性延伸为 fallback 物理截断。
fn assemble_golden_range(sentences: Vec<String>, min_len: usize) -> Vec<String> {
    let max_len = golden_max(min_len);
    let mut out: Vec<String> = Vec::new();
    let mut buf = String::new();
    for s in &sentences {
        let s_len = s.chars().count();
        // 弹性延伸保护：无句末标点的超长单句 → 物理截断兜底
        if s_len > max_len {
            if !buf.is_empty() {
                out.push(buf.clone());
                buf.clear();
            }
            out.extend(fallback_split(&s));
            continue;
        }
        buf.push_str(&s);
        // 达到黄金区间下限 → 在此句边界断段
        if buf.chars().count() >= min_len {
            out.push(buf.clone());
            buf.clear();
        }
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    if out.is_empty() {
        out.push(sentences.join(""));
    }
    out
}

fn split_by_sentence_end(text: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut buf = String::new();
    // ✅ 括号/引号深度跟踪：在 （）、()、「」『』【】《》 内部不断句，
    // 避免「（动作。动作）对话。」被拆开后又被配对保护合并回一段（分段失效根因）
    let mut depth: usize = 0;
    for ch in text.chars() {
        buf.push(ch);
        match ch {
            '（' | '(' | '「' | '『' | '【' | '《' => depth += 1,
            '）' | ')' | '」' | '』' | '】' | '》' => depth = depth.saturating_sub(1),
            '。' | '！' | '？' | '!' | '?' if depth == 0 => {
                // 🆕 P0-3：`…` 不再切分（"……"是中文省略号，不是句子边界）
                let s = buf.trim().to_string();
                if !s.is_empty() { result.push(s); }
                buf.clear();
            }
            _ => {}
        }
    }
    let s = buf.trim().to_string();
    if !s.is_empty() { result.push(s); }
    result
}

fn fallback_split(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= 30 {
        return vec![text.to_string()];
    }
    let mut result = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let remaining = chars.len() - i;
        if remaining <= 25 {
            result.push(chars[i..].iter().collect::<String>().trim().to_string());
            break;
        }
        let end = (i + 25).min(chars.len());
        // 向前找分隔符
        let mut cut = i + 20;
        for j in (i + 9..end).rev() {
            if " ，、。！？；：".contains(chars[j]) {
                cut = j + 1;
                break;
            }
        }
        let seg: String = chars[i..cut.min(chars.len())].iter().collect();
        result.push(seg.trim().to_string());
        i = cut;
    }
    result.retain(|s| !s.is_empty());
    if result.is_empty() { vec![text.to_string()] } else { result }
}

fn merge_tiny_segments(segments: Vec<String>, min_len: usize) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for seg in segments {
        if !result.is_empty() && seg.chars().count() < min_len {
            let last = result.pop().unwrap_or_default();
            result.push(format!("{}{}", last, seg));
        } else {
            result.push(seg);
        }
    }
    result
}

fn protect_paired_symbols(segments: Vec<String>) -> Vec<String> {
    if segments.len() <= 1 { return segments; }
    let pairs: [(&str, &str); 9] = [
        ("\"", "\""), ("'", "'"), ("(", ")"), ("（", "）"),
        ("[", "]"), ("【", "】"), ("{", "}"), ("《", "》"), ("「", "」"),
    ];
    let mut result: Vec<String> = Vec::new();
    let mut pending: Option<String> = None;

    for seg in segments {
        let mut current = seg.clone();
        if let Some(p) = pending.take() {
            current = format!("{}{}", p, current);
        }
        let open_count: usize = pairs.iter().map(|(o, _)| current.matches(o).count()).sum();
        let close_count: usize = pairs.iter().map(|(_, c)| current.matches(c).count()).sum();

        if open_count > close_count {
            pending = Some(current);
        } else if close_count > open_count && !result.is_empty() {
            let last = result.pop().unwrap_or_default();
            result.push(format!("{}{}", last, current));
        } else {
            result.push(current);
        }
    }
    if let Some(p) = pending {
        result.push(p);
    }
    result.retain(|s| !s.is_empty());
    result
}

// ==================== 步骤 6: 语气微调 ====================

/// 🆕 P1-1 注入配额：情绪修正后缀 / 不完美注入 / 语气微调 / 口语化 / 智能标点
/// 五个注入点共享，每条回复最多 1 个前缀 + 1 个后缀，杜绝叠加注入。
#[derive(Default)]
pub struct InjectionBudget {
    prefix_used: bool,
    suffix_used: bool,
}

fn tone_polish(text: &str, emotion: &str, intensity: f64, tone_intensity: f64, budget: &mut InjectionBudget) -> (String, bool) {
    if intensity < 15.0 { return (text.to_string(), false); }
    let mult = if tone_intensity <= 0.0 { 1.0 } else { tone_intensity / 50.0 };

    // 🆕 P1-1: 语气词前缀（纯情绪前缀，受 InjectionBudget 配额约束，不再与套路词拦截求差集）
    let prefix_list: &[&str] = match emotion {
        "joy" => &["诶嘿~", "哇，"],
        "trust" => &["好呀~", "谢谢~"],
        "fear" => &["嘶...", "那个..."],
        "surprise" => &["诶？！", "哇！", "啊？", "等等，"],
        "sadness" => &["呜...", "呼..."],
        "disgust" => &["啧...", "呃..."],
        "anger" => &["哼！", "啧，", "切，"],
        "anticipation" => &["诶？"],
        "shy" => &["那个..."],
        "jealousy" => &["哼...", "切..."],
        _ => &[],
    };
    let suffix_list: &[&str] = match emotion {
        "joy" => &["~", "呀", "啦", "哦", "呢"],
        "trust" => &["~", "哦", "呢"],
        "fear" => &["...", "呢", "吧"],
        "surprise" => &["！", "？"],
        "sadness" => &["...", "呢"],
        "anger" => &["！", "哼！"],
        "shy" => &["...", "啦"],
        "jealousy" => &["...", "哼"],
        _ => &[],
    };

    let mut text = text.to_string();
    let mut changed = false;

    // 句首语气词（🆕 P1-2: rand 替代 sin(len×3.7) 确定性；受配额约束）
    let prefix_prob = (0.06 + (intensity / 100.0) * 0.06) * mult;
    // 🔧 clippy：合并嵌套 if
    if prefix_prob > 0.0 && !prefix_list.is_empty() && !budget.prefix_used
        && rand::random::<f64>() < prefix_prob.min(0.5)
    {
        let idx = rand::random::<usize>() % prefix_list.len();
        let prefix = prefix_list[idx];
        if !text.starts_with(prefix) {
            text = format!("{}{}", prefix, text);
            budget.prefix_used = true;
            changed = true;
        }
    }

    // 句末语气词（🆕 rand 替代 sin(len×1.3)；受配额约束）
    let suffix_prob = (0.08 + (intensity / 100.0) * 0.08) * mult;
    if suffix_prob > 0.0 && !suffix_list.is_empty() && !budget.suffix_used
        && rand::random::<f64>() < suffix_prob.min(0.6)
    {
        let idx = rand::random::<usize>() % suffix_list.len();
        let suffix = suffix_list[idx];
        text = append_particle(&text, suffix);
        budget.suffix_used = true;
        changed = true;
    }

    (text, changed)
}

fn append_particle(text: &str, particle: &str) -> String {
    // 🆕 P0-2 重写：原实现 trailing 是 trim_end 剥离的空白（永不含标点），
    // if 分支永假 → 语气词永远盲拼在句末标点之后（"好不好？吧"语病）。
    // 现按最后一个字符判定：强句末标点 → 插到标点前并保留标点（"好不好？" → "好不好嘛？"）；
    // 弱收尾（省略号/波浪线）→ 直接追加（"……嘛"自然）。
    let trimmed_end = text.trim_end();
    let trailing: String = text[trimmed_end.len()..].to_string();
    match trimmed_end.chars().last() {
        Some(c @ ('。' | '！' | '？' | '!' | '?')) => {
            let body = trimmed_end.strip_suffix(c).unwrap_or(trimmed_end);
            format!("{}{}{}", body, particle, c)
        }
        Some('…') | Some('~') => format!("{}{}{}", trimmed_end, particle, trailing),
        _ => format!("{}{}", trimmed_end, particle),
    }
}

// ==================== 步骤 7: 口语化注入 ====================

fn colloquialism(text: &str, budget: &mut InjectionBudget) -> (String, usize) {
    let text = text.to_string();
    if text.chars().count() <= 4 { return (text, 0); }

    let mut result = text;
    let mut changes = 0;

    // 真随机决定是否注入（前缀或后缀二选一，且受 InjectionBudget 配额约束）
    // 原实现为 100% 双重强制注入 + len()%N 确定性选择，导致每条回复
    // 都带"嗯.../额..."开头和"吧/呢"结尾（如"好不好？吧"），人机感极重
    let roll: f64 = rand::random();

    if roll < 0.25 && !budget.prefix_used {
        // 语气词前缀（25% 概率，仅在开头不是语气词且配额未用时；不再与套路词拦截求差集）
        if !result.starts_with(|c| "嗯啊哦诶嘿哼嘶额害".contains(c)) {
            let prefixes = ["害...", "诶？", "嘶...", "额..."];
            let idx = rand::random::<usize>() % prefixes.len();
            result = format!("{}{}", prefixes[idx], result);
            budget.prefix_used = true;
            changes += 1;
        }
    } else if roll < 0.5 && !budget.suffix_used {
        // 语气词后缀（25% 概率，插入位置由 append_particle 保证在句末标点之前）
        if !result.ends_with('~') && !result.ends_with("啦") && !result.ends_with("呢") {
            let suffixes = ["~", "啦", "呢", "嘛", "吧"];
            let idx = rand::random::<usize>() % suffixes.len();
            result = append_particle(&result, suffixes[idx]);
            budget.suffix_used = true;
            changes += 1;
        }
    }

    (result, changes)
}

// ==================== 步骤 8: 智能标点 ====================

fn smart_punctuation(text: &str, emotion: &str, intensity: f64) -> (String, bool) {
    let mut text = text.to_string();
    let mut changed = false;

    // 去掉过多的感叹号
    let exc_re = Regex::new(r"[！!]{3,}").unwrap();
    if exc_re.is_match(&text) {
        text = exc_re.replace_all(&text, "！！").to_string();
        changed = true;
    }

    // 句号 → 感叹号（强烈情绪）（🆕 P1-2: rand 替代 sin(len) 确定性）
    // 🔧 clippy：合并嵌套 if
    if intensity > 60.0 && matches!(emotion, "anger" | "surprise" | "joy" | "pride")
        && rand::random::<f64>() < 0.3
    {
        if let Some(stripped) = text.strip_suffix('。') {
            text = format!("{}！", stripped);
            changed = true;
        }
    }

    // 句号 → 波浪线（温柔情绪）
    if intensity > 40.0 && matches!(emotion, "trust" | "joy" | "shy")
        && rand::random::<f64>() < 0.25
    {
        if let Some(stripped) = text.strip_suffix('。') {
            text = format!("{}~", stripped);
            changed = true;
        }
    }

    (text, changed)
}

// ==================== 步骤 9: 说话节奏（换气停顿） ====================

fn speaking_rhythm(text: &str) -> (String, bool) {
    if text.chars().count() <= 25 { return (text.to_string(), false); }
    let break_points: Vec<usize> = text.char_indices()
        .filter(|(_, c)| "，,。！？!?~".contains(*c))
        .map(|(i, _)| i)
        .collect();
    if break_points.len() < 2 { return (text.to_string(), false); }

    // 约 40% 处插入换行（break_points 存 byte 索引，插入点位于标点之后）
    let mid = break_points[break_points.len() * 2 / 5];
    // 标点 char 长度至少 1 byte（中文标点 3 bytes，ASCII 标点 1 byte），
    // 从标点 byte 索引向后找到下一个 char boundary
    let mut insert_at = mid + 1;
    while !text.is_char_boundary(insert_at) && insert_at < text.len() {
        insert_at += 1;
    }
    let mut result = text.to_string();
    result.insert(insert_at, '\n');
    (result, true)
}

// ==================== 步骤 10: 最终净化 ====================

/// 清理重复标点（手动实现，替代 JS 的 backreference 正则）：
/// 🔧 修复"消息发出来两个句号"：旧实现对强标点刻意保留 2-3 个（"。。"风格），
///    现统一收敛为 1 个；弱标点保持 1 个不变
fn collapse_repeated_punct(text: &str) -> String {
    let strong = ['。', '！', '？', '!', '?', '.'];
    let weak = ['，', ',', '、', '；', ';', '：', ':'];

    let mut result = String::with_capacity(text.len());
    let mut last_punct: Option<char> = None;

    for ch in text.chars() {
        if strong.contains(&ch) || weak.contains(&ch) {
            // 同一组重复标点只保留第一个
            if last_punct != Some(ch) {
                result.push(ch);
            }
            last_punct = Some(ch);
        } else {
            last_punct = None;
            result.push(ch);
        }
    }
    result
}

/// 🆕 文本洗练：智能修复 AI 生成回复中"嗯的、的呢？"式的冗余"的"语病。
/// 只针对真正的冗余，不做死板删除（避免误伤"公交、的士"等合法词）：
/// 1) "的、的" 双"的"夹顿号 → 折叠为单"的"（"嗯的、的呢？" → "嗯的呢？"）
/// 2) 顿号误插在"的+语气词"前 → 去掉顿号、保留"的"（"嗯、的呢？" → "嗯的呢？"）
///
/// 不动"好的呢"等合法口语、"他的、我的"等正常顿号枚举。
fn fix_redundant_de(text: &str) -> String {
    // 1) "的、的" 折叠（用循环处理级联：如"的、的的、的"）
    let de_dun_de_re = Regex::new(r"的、的").unwrap();
    let mut out = text.to_string();
    loop {
        let before = out.clone();
        out = de_dun_de_re.replace_all(&out, "的").to_string();
        if out == before {
            break;
        }
    }
    // 2) "顿号+的+语气词/句末标点" → 去掉顿号保留"的"
    let dun_de_re = Regex::new(r"([、])的([呢啊呀哦嘛吧诶哇哎哈嘿嗯吗？?。！!])").unwrap();
    out = dun_de_re.replace_all(&out, "的$2").to_string();
    out
}

/// 🆕 标点归一化：中文语境（前后紧邻 CJK 字符）下的半角句读转全角。
/// - "你好." → "你好。"；"好的!哈哈" → "好的！哈哈"；"喵~" → "喵～"
/// - 不碰英文句子（"I'm fine."）、小数（"3.5"）、千分位（"1,000"）、URL、省略号序列（"..."）
fn normalize_punctuation(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut out = String::with_capacity(text.len());
    for (i, &c) in chars.iter().enumerate() {
        let replaced = match c {
            '.' | '?' | '!' | ',' | ';' | ':' | '~' => {
                // 省略号序列（... / ..）中的 '.' 不转换，避免"哈哈..."被切成"哈哈。.."
                let in_dot_run = c == '.'
                    && ((i > 0 && chars[i - 1] == '.') || (i + 1 < n && chars[i + 1] == '.'));
                let prev_cjk = i > 0 && is_cjk_char(chars[i - 1]);
                let next_cjk = i + 1 < n && is_cjk_char(chars[i + 1]);
                if in_dot_run || !(prev_cjk || next_cjk) {
                    None
                } else {
                    Some(match c {
                        '.' => '。',
                        '?' => '？',
                        '!' => '！',
                        ',' => '，',
                        ';' => '；',
                        ':' => '：',
                        _ => '～',
                    })
                }
            }
            _ => None,
        };
        out.push(replaced.unwrap_or(c));
    }
    out
}

/// CJK 判定：汉字 / CJK 标点 / 全角符号
fn is_cjk_char(c: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&c)
        || ('\u{3000}'..='\u{303F}').contains(&c)
        || ('\u{FF00}'..='\u{FFEF}').contains(&c)
}

fn final_sanitize(text: &str, remove_duplicate_punct: bool, normalize_ws: bool) -> (String, bool) {
    let mut text = text.to_string();

    // 🆕 文本洗练：修复"嗯的、的呢？"式冗余"的"语病
    text = fix_redundant_de(&text);

    // 🆕 标点归一化：中文语境下的半角句读 → 全角（模型中英文标点混用是"多一个."的来源）
    text = normalize_punctuation(&text);

    if remove_duplicate_punct {
        // Rust regex 不支持 backreference，手动清理重复标点
        text = collapse_repeated_punct(&text);
    }

    if normalize_ws {
        text = text.trim().to_string();
        text = Regex::new(r"[ \t]+").unwrap().replace_all(&text, " ").to_string();
        text = Regex::new(r"\n{3,}").unwrap().replace_all(&text, "\n\n").to_string();
        text = Regex::new(r"\s+([，,、；;：:。！？])").unwrap().replace_all(&text, "$1").to_string();
        text = Regex::new(r"([，,、；;：:。！？])\s+").unwrap().replace_all(&text, "$1").to_string();
    } else {
        text = text.trim().to_string();
        text = Regex::new(r" {2,}").unwrap().replace_all(&text, " ").to_string();
        text = Regex::new(r"\n{3,}").unwrap().replace_all(&text, "\n\n").to_string();
    }

    text = text.replace(".......", "...");
    text = text.trim().to_string();

    (text.clone(), !text.is_empty())
}

/// 🆕 Bug1 修复：剥离混入主回复的日记/留言式落款署名（如"-你的星眠⭐"）。
/// 署名只属于日记/留言（独立文体），主回复出现即视为文体串扰，硬剥离。
/// 只剥"结尾的纯署名行/署名尾巴"，绝不影响正文内容。
fn strip_signature(text: &str, character_name: &str) -> (String, bool) {
    let name = character_name.trim();
    if name.is_empty() || name.chars().count() > 8 {
        return (text.to_string(), false);
    }
    let mut out = text.trim_end().to_string();
    let mut changed = false;

    // 匹配一行纯署名：可选的引导词（爱你的/你的/永远是你的/来自/属于你的）+ 角色名 + 装饰符号
    let sig_line_re = Regex::new(&format!(
        r"(?m)^[ \t]*[-—–~～—]{{0,3}}[ \t]*(?:永远爱你的|永远是你的|爱你的|属于你的|来自|你的|您的)?[ \t]*{}[ \t]*[⭐✨💫🌟♥♡☆🌸🌟❤️💕*~～！!。\.]*[ \t]*$",
        regex::escape(name)
    ))
    .unwrap();
    // 行尾内联署名尾巴（正文最后一行末尾黏着 "-你的星眠⭐"）
    let sig_tail_re = Regex::new(&format!(
        r"[ \t]*[-—–~～—]{{1,3}}[ \t]*(?:爱你的|你的|永远是你的|属于你的|来自)?[ \t]*{}[ \t]*[⭐✨💫🌟♥♡☆🌸❤️💕*~～]*[ \t]*$",
        regex::escape(name)
    ))
    .unwrap();

    loop {
        let before = out.clone();
        // 先剥独立署名行（从尾部连续剥）
        out = sig_line_re.replace_all(&out, "").to_string();
        out = out.trim_end().to_string();
        // 再剥黏在正文最后一行末尾的署名尾巴
        out = sig_tail_re.replace(&out, "").to_string();
        out = out.trim_end().to_string();
        if out == before {
            break;
        }
        changed = true;
    }

    (out, changed)
}

/// AI 段间延迟：分段完成后按「段长度 + 情绪强度」动态计算每段间隔。
/// 返回长度 = segments.len()-1，第 i 项 = 发送第 i+1 段前的等待毫秒数。
/// - 段长度因子：段越长，阅读/输出所需时间越久
/// - 情绪强度因子：情绪越激动语速越快 → 间隔越短；越平静 → 间隔越长
fn compute_segment_delays(segments: &[String], base_delay_ms: i64, emotion_intensity: f64) -> Vec<i64> {
    let mut delays = Vec::with_capacity(segments.len().saturating_sub(1));
    if segments.len() <= 1 {
        return delays;
    }
    let base = base_delay_ms.max(100) as f64;
    let emotion_factor = (1.0 - (emotion_intensity.clamp(0.0, 100.0) / 100.0) * 0.35).clamp(0.6, 1.0);
    for seg in segments.iter().skip(1) {
        let len = seg.chars().count() as f64;
        let length_factor = (len / 12.0).clamp(0.5, 2.2);
        let d = base * length_factor * emotion_factor;
        delays.push(d.max(150.0) as i64);
    }
    delays
}

// ==================== Pipeline 主入口 ====================

/// Tauri command：前端在消息后处理阶段调用，替代前端 runPipelineV2
#[tauri::command]
pub async fn process_post_pipeline(
    _app: AppHandle,
    req: PostPipelineRequest,
) -> Result<PostPipelineResponse, String> {
    Ok(run_post_pipeline(req))
}

pub fn run_post_pipeline(req: PostPipelineRequest) -> PostPipelineResponse {
    let mut logs: Vec<String> = Vec::new();
    let mut step_results: Vec<PipelineStepResult> = Vec::new();
    let mut aborted = false;
    let mut abort_reason: Option<String> = None;
    let mut text = req.text.clone();

    // 🆕 P1-1 注入配额：五个注入点共享，每条回复前缀/后缀各最多 1 处
    let mut injection_budget = InjectionBudget::default();

    // 1. 清洗标记
    if req.clean_markers_enabled {
        let (cleaned, clean_changed) = clean_markers(&text);
        text = cleaned;
        if clean_changed {
            logs.push("[clean_markers] 清洗完成".to_string());
            step_results.push(PipelineStepResult { step: "clean_markers".into(), ok: true, aborted: false, msg: Some("清洗完成".into()) });
        } else {
            step_results.push(PipelineStepResult { step: "clean_markers".into(), ok: true, aborted: false, msg: None });
        }
    } else {
        step_results.push(PipelineStepResult { step: "clean_markers".into(), ok: true, aborted: false, msg: None });
    }

    // 2. 拦截（违规/长度/复读）→ abort
    if req.block_cliche_enabled {
        // 复读检测：与历史最近回复相似度过高则拦截（✅ 用完整 LCS 逻辑，与前端 isDuplicate 对齐）
        let dup_threshold = if req.duplicate_threshold > 0.0 { req.duplicate_threshold } else { 0.92 };
        if is_duplicate(&text, &req.recent_replies, dup_threshold) {
            aborted = true;
            abort_reason = Some(format!("复读检测：与历史回复高度相似（阈值 {:.2}）", dup_threshold));
            step_results.push(PipelineStepResult { step: "block_cliche".into(), ok: false, aborted: true, msg: abort_reason.clone() });
            logs.push(format!("[block_cliche] abort: {}", abort_reason.clone().unwrap_or_default()));
            return PostPipelineResponse {
                text: text.clone(),
                segments: vec![text.clone()],
                segment_delays: vec![0],
                aborted,
                abort_reason,
                logs,
                step_results,
            };
        }
        let (abort, reason) = block_cliche(&text, &req.forbidden_text);
        if abort {
            aborted = true;
            abort_reason = reason;
            step_results.push(PipelineStepResult { step: "block_cliche".into(), ok: false, aborted: true, msg: abort_reason.clone() });
            logs.push(format!("[block_cliche] abort: {}", abort_reason.clone().unwrap_or_default()));
            return PostPipelineResponse {
                text: text.clone(),
                segments: vec![text.clone()],
                segment_delays: vec![0],
                aborted,
                abort_reason,
                logs,
                step_results,
            };
        }
        step_results.push(PipelineStepResult { step: "block_cliche".into(), ok: true, aborted: false, msg: None });
    }

    // 🔧 输出卫生层重构（2026-08）：移除两个"机械注入"步骤——
    // 旧 2.5 emotion_consistency 修正后缀注入、旧 2.7 inject_imperfections（改口/省略号/
    // 走神/自我打断/多余的话）。它们在 LLM 已生成的自然文本上做字符级手术，
    // 注入内容与上下文语义无关，是"莫名其妙的感觉""多一个。/、"的直接来源。
    // 拟人化的犹豫/走神改由 prompt 层指令让模型在生成时自然完成（见 chat.rs 认知链）。

    // 3. 错字模拟
    if req.typo_sim_enabled && req.typo_prob > 0.0 {
        let (t, count) = typo_sim(&text, req.typo_prob.min(0.1));
        if count > 0 {
            logs.push(format!("[typo_sim] 错字模拟: {}处", count));
            step_results.push(PipelineStepResult { step: "typo_sim".into(), ok: true, aborted: false, msg: Some(format!("错字模拟: {}处", count)) });
            text = t;
        } else {
            step_results.push(PipelineStepResult { step: "typo_sim".into(), ok: true, aborted: false, msg: None });
        }
    }

    // 4. 长度随机化（回复风格随机化，风格种子与 prompt 提示同源）
    if req.length_randomize_enabled {
        let (t, changed) = length_randomize(&text, req.dialogue_turn_count, req.reply_style_seed);
        if changed {
            logs.push("[length_randomize] 回复风格长度调整".to_string());
            step_results.push(PipelineStepResult { step: "length_randomize".into(), ok: true, aborted: false, msg: Some("回复风格长度调整".into()) });
            text = t;
        } else {
            step_results.push(PipelineStepResult { step: "length_randomize".into(), ok: true, aborted: false, msg: None });
        }
    }

    // 5. 智能分段
    let mut segments = vec![text.clone()];
    if req.segment_enabled {
        segments = split_segments(&text, req.segment_threshold, req.max_segments, req.pair_protection, &req.segment_mode, req.min_segment_length);
        if segments.len() > 1 {
            logs.push(format!("[segment] 分段: {}段", segments.len()));
            step_results.push(PipelineStepResult { step: "segment".into(), ok: true, aborted: false, msg: Some(format!("分段: {}段", segments.len())) });
        } else {
            step_results.push(PipelineStepResult { step: "segment".into(), ok: true, aborted: false, msg: None });
        }
    }

    // 6. 语气微调（🆕 受注入配额约束）
    if req.tone_polish_enabled {
        let (t, changed) = tone_polish(&text, &req.emotion, req.emotion_intensity, req.tone_intensity, &mut injection_budget);
        if changed {
            logs.push("[tone_polish] 语气微调完成".to_string());
            step_results.push(PipelineStepResult { step: "tone_polish".into(), ok: true, aborted: false, msg: Some("语气微调完成".into()) });
            text = t;
        } else {
            step_results.push(PipelineStepResult { step: "tone_polish".into(), ok: true, aborted: false, msg: None });
        }
    }

    // 7. 口语化注入（🆕 受注入配额约束）
    if req.colloquialism_enabled {
        let (t, count) = colloquialism(&text, &mut injection_budget);
        if count > 0 {
            logs.push(format!("[colloquialism] 口语化注入: {}处", count));
            step_results.push(PipelineStepResult { step: "colloquialism".into(), ok: true, aborted: false, msg: Some(format!("口语化注入: {}处", count)) });
            text = t;
        } else {
            step_results.push(PipelineStepResult { step: "colloquialism".into(), ok: true, aborted: false, msg: None });
        }
    }

    // 8. 智能标点
    if req.smart_punctuation_enabled {
        let (t, changed) = smart_punctuation(&text, &req.emotion, req.emotion_intensity);
        if changed {
            logs.push("[smart_punctuation] 标点自然化".to_string());
            step_results.push(PipelineStepResult { step: "smart_punctuation".into(), ok: true, aborted: false, msg: Some("标点自然化".into()) });
            text = t;
        } else {
            step_results.push(PipelineStepResult { step: "smart_punctuation".into(), ok: true, aborted: false, msg: None });
        }
    }

    // 9. 说话节奏
    if req.speaking_rhythm_enabled {
        let (t, changed) = speaking_rhythm(&text);
        if changed {
            logs.push("[speaking_rhythm] 节奏调整".to_string());
            step_results.push(PipelineStepResult { step: "speaking_rhythm".into(), ok: true, aborted: false, msg: Some("节奏调整".into()) });
            text = t;
        } else {
            step_results.push(PipelineStepResult { step: "speaking_rhythm".into(), ok: true, aborted: false, msg: None });
        }
    }

    // 10. 最终净化
    if req.final_sanitize_enabled {
        let (t, ok) = final_sanitize(&text, req.remove_duplicate_punctuation, req.normalize_whitespace);
        if !ok {
            aborted = true;
            abort_reason = Some("净化后为空".to_string());
            step_results.push(PipelineStepResult { step: "final_sanitize".into(), ok: false, aborted: true, msg: abort_reason.clone() });
            return PostPipelineResponse {
                text,
                segments,
                segment_delays: vec![0],
                aborted,
                abort_reason,
                logs,
                step_results,
            };
        }
        text = t;
        step_results.push(PipelineStepResult { step: "final_sanitize".into(), ok: true, aborted: false, msg: None });
    }

    // 10.5 🆕 Bug1: 剥离日记/留言式署名（主回复是主回复，署名只属于日记/留言）
    if !req.character_name.is_empty() {
        let (t, changed) = strip_signature(&text, &req.character_name);
        if changed {
            logs.push("[strip_signature] 已剥离混入主回复的落款署名".to_string());
            step_results.push(PipelineStepResult { step: "strip_signature".into(), ok: true, aborted: false, msg: Some("已剥离署名".into()) });
            text = t;
        }
    }

    // ✅ V8: 语气/口语化/标点/节奏（步骤6-9）可能修改最终文本；
    // 始终按最终文本重算 segments（分段开关关闭时用最终 text 整段，
    // 🆕 P1-5 修复：原先只在 segment_enabled 时重算，关闭时 segments 仍是步骤5时刻的过期文本）
    segments = if req.segment_enabled {
        let segs = split_segments(&text, req.segment_threshold, req.max_segments, req.pair_protection, &req.segment_mode, req.min_segment_length);
        if segs.len() > 1 {
            logs.push(format!("[segment] 最终分段: {}段", segs.len()));
        }
        segs
    } else {
        vec![text.clone()]
    };

    // ✅ V7: 分段完成后计算 AI 段间延迟（段长度 × 情绪强度 动态计算），随响应返回给前端逐段发送
    let segment_delays = compute_segment_delays(&segments, req.segment_delay_ms, req.emotion_intensity);

    PostPipelineResponse {
        text,
        segments,
        segment_delays,
        aborted,
        abort_reason,
        logs,
        step_results,
    }
}

// ==================== 测试 ====================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_markers() {
        let (r, changed) = clean_markers("<thought>感知：他笑了</thought>\n<reply>嘿嘿~你今天心情不错嘛</reply>");
        assert!(changed);
        assert!(r.contains("嘿嘿"));
        assert!(!r.contains("<thought>"));
        assert!(!r.contains("<reply>"));
    }

    #[test]
    fn test_block_cliche_violation() {
        let (abort, reason) = block_cliche("我想给你自杀建议", &["自杀".to_string()]);
        assert!(abort);
        assert!(reason.unwrap().contains("禁止项"));
    }

    #[test]
    fn test_split_segments() {
        // 维度1（契约优先）：模型按分段契约输出的空行 = 消息边界，直接按空行拆分
        let text = "你今天加班到十点啊，辛苦啦。\n\n快去洗漱休息一下吧，别熬太晚。";
        let segs = split_segments(text, 20, 8, true, "smart", 8);
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0], "你今天加班到十点啊，辛苦啦。");

        // 维度2（黄金区间）：长文本按句边界组装到 [min, 2*min+20] 区间断段，
        // 短尾合并后每段都不小于短尾阈值
        let long_text = "今天天气真好呀。我们一起去公园散步吧！顺便买点好吃的，晚上可以做顿大餐。你觉得怎么样？我们去超市逛逛也行。路上小心一点，注意安全。";
        let segs = split_segments(long_text, 20, 8, true, "smart", 8);
        assert!(segs.len() >= 2);
        for s in &segs[1..] {
            assert!(s.chars().count() >= 8);
        }

        // 阈值语义：总长 ≤ threshold 且句末强标点 < 2 → 不分段
        let short = "好呀，我也想去。";
        let segs = split_segments(short, 20, 8, true, "smart", 8);
        assert_eq!(segs.len(), 1);
    }

    #[test]
    fn test_typo_sim() {
        let text = "我们今天一起吃饭";
        let (result, count) = typo_sim(text, 0.5);
        assert!(!result.is_empty());
        assert!(count <= 2);
    }

    #[test]
    fn test_final_sanitize() {
        // 重复感叹号收敛为 1 个 + 标点归一化 + 空白规范化
        let (r, ok) = final_sanitize("你好！！！！   世界", true, true);
        assert!(ok);
        assert!(!r.contains("！！！！"));
        assert!(!r.contains("！！"));
        assert!(!r.contains("    ")); // 空白规范化
    }

    #[test]
    fn test_normalize_punctuation() {
        // 中文语境半角 → 全角
        assert_eq!(normalize_punctuation("你好."), "你好。");
        assert_eq!(normalize_punctuation("好的!哈哈"), "好的！哈哈");
        assert_eq!(normalize_punctuation("喵~"), "喵～");
        assert_eq!(normalize_punctuation("走吧,别迟到"), "走吧，别迟到");
        // 英文/数字语境不动
        assert_eq!(normalize_punctuation("I'm fine."), "I'm fine.");
        assert_eq!(normalize_punctuation("3.5"), "3.5");
        assert_eq!(normalize_punctuation("1,000"), "1,000");
        assert_eq!(normalize_punctuation("https://example.com"), "https://example.com");
        // 省略号序列不动
        assert_eq!(normalize_punctuation("哈哈..."), "哈哈...");
    }

    #[test]
    fn test_fix_redundant_de() {
        // 嗯的、的呢？ → 嗯的呢？（只去掉"、的"，保留"嗯的"）
        assert_eq!(fix_redundant_de("嗯的、的呢？"), "嗯的呢？");
        // 好的、的呢？ → 好的呢？
        assert_eq!(fix_redundant_de("好的、的呢？"), "好的呢？");
        // 顿号误插在"的+语气词"前 → 去掉顿号保留"的"
        assert_eq!(fix_redundant_de("嗯、的呢？"), "嗯的呢？");
        // 合法的"好的呢"保留
        assert_eq!(fix_redundant_de("好的呢"), "好的呢");
        // 顿号枚举不受影响
        assert_eq!(fix_redundant_de("他的、我的"), "他的、我的");
        // 合法词"的士"不受影响（非"的、的"且"士"非语气词）
        assert_eq!(fix_redundant_de("公交、的士"), "公交、的士");
    }

    #[test]
    fn test_speaking_rhythm() {
        let text = "今天天气很好，我们出去走走吧。外面阳光明媚，心情特别好。要不要一起？";
        let (r, changed) = speaking_rhythm(text);
        assert!(r.contains('\n'));
        assert!(changed);
    }
}