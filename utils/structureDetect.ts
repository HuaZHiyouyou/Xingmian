/**
 * 结构化内容检测（A1 智能合并模式）
 *
 * 判定"长内容 + 结构化"的回复（小短文、带标题/列表/序号/明显分节），
 * 命中任一特征即视为结构化。日常短对话（无结构特征）返回 false，
 * 以便合并模式只对真正的长文生效，日常聊天照常分段拟真发送。
 */
export function isStructuredContent(text: string): boolean {
  if (!text) return false;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  // 1. markdown 标题（#~###### 开头行 ≥1）
  const headingCount = lines.filter((l) => /^#{1,6}\s+\S/.test(l)).length;
  if (headingCount >= 1) return true;

  // 2. 列表项（- / * / • / 1. 2. 序号开头行 ≥3，或占比 ≥30%）
  const listRe = /^(?:[-*•]\s+\S|\d+[.、)]\s*\S)/;
  const listCount = lines.filter((l) => listRe.test(l)).length;
  if (listCount >= 3 || (lines.length >= 3 && listCount / lines.length >= 0.3)) return true;

  // 3. 明显分节（空行分隔的段落 ≥4 且平均段长 ≥40）
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 4) {
    const avgLen = paragraphs.reduce((s, p) => s + p.length, 0) / paragraphs.length;
    if (avgLen >= 40) return true;
  }

  // 4. 标题式短行（<20 字、无句末标点的独立行 ≥3）
  const titleishRe = /[。！？.!?,，~～…〕)）]$/;
  const titleishCount = lines.filter((l) => l.length < 20 && !titleishRe.test(l)).length;
  if (titleishCount >= 3 && lines.length >= 4) return true;

  return false;
}
