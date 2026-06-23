// ============================================================
// 文本清洗工具：剥离 LLM 结构化标记
// 参考：emotionai 的历史净化正则
// ============================================================

/**
 * 清洗 system prompt / 历史记录中的思维链标记，
 * 确保不会因为"我之前想过 xxx"而让 LLM 污染人设。
 */
export function cleanForbiddenMarkers(text: string): string {
  let t = text;
  // 移除 <thought> / <thinking> / <feeling> / <mind> / <inner> 等标签
  t = t.replace(/<\/?(thought|thinking|feeling|mind|inner)[^>]*>[\s\S]*?<\/\1>/gi, '');
  t = t.replace(/<(thought|thinking|feeling)[^>]*>/gi, '');
  t = t.replace(/<\/(thought|thinking|feeling)>/gi, '');
  // 移除【内心活动】【想法】等中文章节
  t = t.replace(/【(内心活动|想法|心理|思考)】[\s\S]*?(?=\n{2}|$)/g, '');
  return t;
}

/**
 * 清洗历史消息：把 AI 以前输出的结构性标记去掉，
 * 避免历史消息里的 `<thought>` 被当作真实对话内容
 */
export function sanitizeHistoryText(text: string): string {
  return cleanForbiddenMarkers(text).trim();
}

/**
 * 清洗 LLM 输出中的结构性"提示语标记"，如
 * - <thought>...</thought>
 * - <feeling>...</feeling>
 * - 【内心活动】
 * - 开头带有 "AI：" 或 "助手："
 */
export function cleanLLMOutputMarkers(text: string): string {
  let cleaned = text;

  // 移除 <thought> / <thinking> / <feeling> 等标签及其内容
  cleaned = cleaned.replace(/<\/?(thought|thinking|feeling|inner|mind)[^>]*>[\s\S]*?<\/\1>/gi, '');
  cleaned = cleaned.replace(/<(thought|thinking|feeling)[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/(thought|thinking|feeling)>/gi, '');

  // 移除【内心活动】【想法】等中文章节
  cleaned = cleaned.replace(/【(内心活动|想法|心理|思考)】[\s\S]*?(?=\n{2}|$)/g, '');

  // 移除 "AI：" / "助手：" / "回答：" 前缀
  cleaned = cleaned.replace(/^(AI|助手|回答|回复)[:：]\s*/, '');

  // 去首尾空白（保留内部换行）
  cleaned = cleaned.trim();

  return cleaned;
}
