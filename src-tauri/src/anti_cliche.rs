use serde_json::Value;

// ==================== 回复风格随机化 ====================

/// 回复风格枚举
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ReplyStyle {
    /// 短回复 (40%): 只保留核心信息，1-2句话
    Short,
    /// 中回复 (35%): 正常长度，不截断也不扩展
    Normal,
    /// 长回复 (20%): 允许详细展开，不截断
    Long,
    /// 全量 (5%): 保持原始输出，不做任何修改
    Full,
}

/// 基于种子选择回复风格（prompt 提示与后处理截断共用同一 seed）
/// 🆕 P1-2: 原实现基于 turn_count 哈希——同一轮数永远同样风格，且与 should_inject
/// 共用同一哈希（风格选择与不完美注入完全相关）。改为种子化：
/// seed 由调用方每次生成（rand），prompt 风格提示与后处理截断共用同一 seed 保持一致。
pub fn select_reply_style_seeded(seed: u64) -> ReplyStyle {
    let roll = ((seed >> 11) % 100000) as f64 / 100000.0;

    if roll < 0.40 {
        ReplyStyle::Short
    } else if roll < 0.75 { // 0.40 + 0.35
        ReplyStyle::Normal
    } else if roll < 0.95 { // 0.75 + 0.20
        ReplyStyle::Long
    } else {
        ReplyStyle::Full
    }
}

/// 根据回复风格生成对应的 prompt 指令片段
/// 插入到 system prompt 中，引导模型控制回复长度
pub fn build_reply_style_hint(style: ReplyStyle) -> &'static str {
    match style {
        ReplyStyle::Short => {
            "【回复风格：简短】\n\
             这次回复请简洁一些，控制在 1-2 句话内，只说最核心的内容。\n\
             不要展开解释，不要添加多余的修饰或感想。"
        }
        ReplyStyle::Normal => {
            "" // 正常风格不需要额外指令
        }
        ReplyStyle::Long => {
            "【回复风格：展开】\n\
             这次回复可以详细一些，适当展开你的想法和感受。\n\
             可以加入具体的细节、回忆、联想，让回复更丰满。\n\
             但仍然保持自然，不要刻意凑字数。"
        }
        ReplyStyle::Full => {
            "" // 全量风格保持原始输出
        }
    }
}

/// 动态 temperature 计算：根据情绪强度和对话轮数调整 temperature
/// 高情绪 → 高 temperature（更自由、更有情感色彩）
/// 低情绪/重复对话 → 低 temperature（更稳定、减少胡言乱语）
/// 返回值范围: 0.3 ~ 1.0（部分提供商限制 temperature ∈ [0,1]，上限不能超过 1.0）
pub fn get_anti_cliche_temperature(
    base_temperature: f64,
    emotion_values: &Value,
    dialogue_turn_count: u32,
) -> f64 {
    // 1. 基于情绪强度调整
    // 计算所有情绪维度的平均值
    let dims = ["joy", "trust", "fear", "surprise", "sadness",
                "disgust", "anger", "anticipation", "pride", "guilt",
                "shy", "jealousy", "curiosity", "love"];
    let emotion_labels_cn = ["喜悦", "信任", "恐惧", "惊讶", "悲伤",
                             "厌恶", "愤怒", "期待", "得意", "内疚",
                             "害羞", "嫉妒", "好奇", "爱慕"];
    
    let mut total_emotion = 0.0;
    let mut emotion_count = 0;
    for (dim, _label) in dims.iter().zip(emotion_labels_cn.iter()) {
        if let Some(val) = emotion_values.get(*dim).and_then(|v| v.as_f64()) {
            total_emotion += val;
            emotion_count += 1;
        }
    }
    let avg_emotion = if emotion_count > 0 {
        total_emotion / emotion_count as f64
    } else {
        5.0 // 默认中等情绪
    };

    // 情绪越高 → temperature 越高（高情绪下更自由表达）
    // avg_emotion 范围 0~10，映射到 0.0 ~ 0.3 的 temperature 增量
    let emotion_boost = (avg_emotion / 10.0) * 0.3;

    // 2. 基于对话轮数调整（防止套路化）
    // 前 5 轮稳定，5 轮后每轮微微升高 temperature，鼓励多样性
    let turn_boost = if dialogue_turn_count > 5 {
        ((dialogue_turn_count - 5) as f64 * 0.02).min(0.2)
    } else {
        0.0
    };

    // 3. 最终 temperature = 基准 + 情绪增量 + 轮次增量，夹到 [0.3, 1.0]
    let final_temperature = base_temperature + emotion_boost + turn_boost;
    final_temperature.clamp(0.3, 1.0)
}

// 🔧 2026-08 输出卫生层重构：inject_imperfections（改口/省略号/走神/自我打断/
// 多余的话的机械注入）已删除——它在 LLM 已生成的自然文本上做字符级手术，
// 注入内容与语境无关，是"莫名其妙"感的主要来源。拟人化的犹豫/走神改由
// prompt 层指令让模型在生成时自然完成（见 chat.rs 认知链）。
