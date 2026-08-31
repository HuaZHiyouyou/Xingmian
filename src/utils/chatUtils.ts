export function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * 🆕 Bug1 修复：剥离混入主回复的日记/留言式落款署名（如"-你的星眠⭐"）。
 * 与 Rust 端 post_process::strip_signature 对齐（前端兜底路径用）。
 * 只剥结尾的纯署名行/署名尾巴，不影响正文。
 */
export function stripReplySignature(text: string, characterName?: string): string {
  const name = (characterName || '').trim();
  if (!name || name.length > 8) return text;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decor = '[⭐✨💫🌟♥♡☆🌸❤️💕*~～！!。.]*';
  const lead = '(?:永远爱你的|永远是你的|爱你的|属于你的|来自|你的|您的)?';
  const dash = '[-—–~～—]{0,3}';
  // 独立署名行
  const lineRe = new RegExp(`^[ \\t]*${dash}[ \\t]*${lead}[ \\t]*${esc}[ \\t]*${decor}[ \\t]*$`, 'gm');
  // 行尾内联署名尾巴
  const tailRe = new RegExp(`[ \\t]*[-—–~～—]{1,3}[ \\t]*${lead}[ \\t]*${esc}[ \\t]*${decor}[ \\t]*$`);
  let out = text.replace(/\s+$/, '');
  for (let i = 0; i < 3; i++) {
    const before = out;
    out = out.replace(lineRe, '').replace(/\s+$/, '');
    out = out.replace(tailRe, '').replace(/\s+$/, '');
    if (out === before) break;
  }
  return out;
}

export { analyzeEmotion } from './emotionAnalyzer';
