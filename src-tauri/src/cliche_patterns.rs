//! ============================================================
//! 套路词检测模块（独立于 post_process，各司其职）
//! 
//! 将套路词按类型分类：
//! - AI 标志词（最优先拦截，AI 特有的表达；服务性客套语如"希望能帮到你"属自然口语，不拦截）
//! - 翻译腔（英文直译的不自然表达）
//! 
//! 已放宽移除：高频开头 / 高频句式 / 空洞共情（"我理解""辛苦了""加油"等真人也会表达，
//! 不再拦截）；语气词（嗯/啊/嘿嘿/哈哈等）亦属自然口语，不拦截。
//!
//! 支持：
//! 1. 前端自定义 forbidden_text 合并
//! 2. 优先级分层（AI 标志词 > 翻译腔）
//! 3. 命中后返回匹配的类别，便于日志追溯
//!
//! ============================================================

/// 套路词匹配结果
#[derive(Debug, Clone)]
pub struct ClicheMatch {
    /// 命中的类别（如 "ai_marker", "high_freq_opening" 等）
    pub category: &'static str,
    /// 命中的具体词/短语
    pub pattern: String,
    /// 命中的原始文本片段（便于日志）
    #[allow(dead_code)]
    pub matched_text: String,
}

/// AI 标志词：AI 独有的、真人几乎不会用的表达（最高优先级）
/// 已放宽：服务性客套语（"希望能帮到你/随时告诉我/如果还有问题"等）真人也会说，不拦截。
const AI_MARKERS: &[&str] = &[
    // AI 身份暴露
    "作为AI", "作为一个人工智能", "作为一个AI", "作为人工智能",
    "我是AI", "我是一个AI", "我是一个语言模型", "我是一个助手",
    "作为助手", "作为一个助手", "作为语言模型",
    // AI 特有的免责声明
    "请注意", "需要说明的是", "需要指出的是",
    "需要强调的是", "值得一提的是", "不过需要指出",
    "但请注意", "不过请注意",
];

/// 翻译腔：英文直译的不自然中文表达
const TRANSLATION_CHINGLISH: &[&str] = &[
    "我深深地", "我深深地感觉到",
    "让我感到", "这让我感到",
    "我由衷地", "我真心地", "我诚挚地",
    "请允许我", "请允许",
    "在这个", "在这样的情况下",
    "从某种意义上", "从某种角度来说",
    "在我看来", "从我的角度来看",
    "我想说的是", "我想要说的是",
    "我的意思是", "我想表达的是",
    "值得一提的是", "值得注意的是",
];

/// 🔧 修复#1 AI 陪伴腔：陪伴场景的模板化"表忠心"话术（模型高概率口癖，
/// 真人对熟人不会反复这样说话，如"我哪儿都不去，就在这里陪着你"）。
/// 只收模板公式短语，不收自然表达（如单说"陪你聊天"不拦）。
const AI_COMPANION_CLICHES: &[&str] = &[
    "哪儿都不去", "哪里都不去", "哪也不去",
    "就在这里陪你", "就在这里陪着",
    "一直在这里陪你", "会一直陪着你", "永远陪着你", "永远在这里陪你",
    "我会一直在这里", "我一直都在这里", "永远在这里",
    "无条件的陪伴", "无条件地陪",
    "我的世界只有你", "你就是我的全部",
];

/// 完整的套路词模式列表（按优先级排列，用于 block_cliche 替换）
/// 
/// 返回 `Vec<(&'static str, &'static [&'static str])>` 
/// 每项为 `(类别名, 该类别下的所有模式)`
/// 已放宽移除：高频开头 / 高频句式 / 空洞共情（真人也会表达，不再拦截）
pub fn get_all_pattern_groups() -> Vec<(&'static str, &'static [&'static str])> {
    vec![
        ("ai_marker", AI_MARKERS),
        ("translation_chinglish", TRANSLATION_CHINGLISH),
        ("ai_companion_cliche", AI_COMPANION_CLICHES),
    ]
}

/// 在文本中查找套路词
/// 
/// 返回所有匹配结果（可能匹配到多个类别）
pub fn detect_cliche(text: &str) -> Vec<ClicheMatch> {
    let lower = text.to_lowercase();
    let mut matches = Vec::new();

    for (category, patterns) in get_all_pattern_groups() {
        for pattern in patterns {
            if lower.contains(&pattern.to_lowercase()) {
                matches.push(ClicheMatch {
                    category,
                    pattern: pattern.to_string(),
                    matched_text: extract_context(text, pattern),
                });
                // 每个类别只取第一个命中（避免过多匹配影响性能）
                break;
            }
        }
    }

    matches
}

/// 提取匹配上下文（前后各取几个字符，便于日志）
fn extract_context(text: &str, pattern: &str) -> String {
    let lower = text.to_lowercase();
    let pat_lower = pattern.to_lowercase();
    if let Some(pos) = lower.find(&pat_lower) {
        // pos 是字节偏移；lower 与 text 字符数相同，先把字节偏移换算成字符偏移再切片
        let char_idx = lower[..pos].chars().count();
        let pat_chars = pat_lower.chars().count();
        let start = char_idx.saturating_sub(4);
        let end = (char_idx + pat_chars + 4).min(text.chars().count());
        let chars: Vec<char> = text.chars().collect();
        chars[start..end].iter().collect()
    } else {
        pattern.to_string()
    }
}

/// 统计各类别命中数（仅测试用）
#[cfg(test)]
fn count_patterns() -> Vec<(&'static str, usize)> {
    get_all_pattern_groups()
        .iter()
        .map(|(name, patterns)| (*name, patterns.len()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_ai_marker() {
        let matches = detect_cliche("作为AI，我觉得你应该加油");
        assert!(!matches.is_empty());
        assert_eq!(matches[0].category, "ai_marker");
        assert_eq!(matches[0].pattern, "作为AI");
    }

    #[test]
    fn test_detect_translation_chinglish() {
        let matches = detect_cliche("从某种意义上，我深深地感觉到你的心情");
        assert!(!matches.is_empty());
        assert_eq!(matches[0].category, "translation_chinglish");
    }

    #[test]
    fn test_detect_multiple() {
        let matches = detect_cliche("作为AI，从某种意义上，我深深地感觉到这一切");
        assert!(matches.len() >= 2); // 至少匹配 ai_marker + translation_chinglish
    }

    #[test]
    fn test_relaxed_phrases_not_blocked() {
        // 已放宽：服务性客套语 + 高频开头 + 高频句式 + 空洞共情 + 语气词均不再拦截
        let matches = detect_cliche(
            "希望能帮到你，随时告诉我。我理解你的感受，这一定很难过，辛苦了，加油。嗯…"
        );
        assert!(matches.is_empty(), "放宽后不应再命中: {:?}", matches);
    }

    #[test]
    fn test_clean_text_no_match() {
        let matches = detect_cliche("今天天气真好，出去走走吧");
        assert!(matches.is_empty());
    }

    #[test]
    fn test_detect_ai_companion_cliche() {
        // 🔧 修复#1：模板化表忠心话术应被拦截
        let matches = detect_cliche("嗯的呢，我哪儿都不去，就在这里陪着你。");
        assert!(!matches.is_empty());
        assert_eq!(matches[0].category, "ai_companion_cliche");
    }

    #[test]
    fn test_pattern_counts() {
        let counts = count_patterns();
        assert!(counts.len() == 3); // ai_marker + translation_chinglish + ai_companion_cliche
        for (_, count) in counts {
            assert!(count > 0);
        }
    }
}
