
const STRONG_SEPARATORS = /[。！？….!?]+/;
const WEAK_SEPARATORS = /[，,、；;：:\n]+/;
const TRAILING_PUNCT = /[，,、；;：:。！？…]+$/;

const PAIRED_SYMBOLS: Array<{ open: string; close: string }> = [
  { open: '"', close: '"' },
  { open: '"', close: '"' },
  { open: '(', close: ')' },
  { open: '（', close: '）' },
  { open: '[', close: ']' },
  { open: '【', close: '】' },
  { open: '{', close: '}' },
  { open: '《', close: '》' },
  { open: '「', close: '」' },
  { open: '『', close: '』' },
  { open: '<', close: '>' },
];

const THINKING_MARKERS = [
  /<thinking>[\s\S]*?<\/thinking>/gi,
  /<\/?thinking>/gi,
  /<thought>[\s\S]*?<\/thought>/gi,
  /<\/?thought>/gi,
  /<feeling>[\s\S]*?<\/feeling>/gi,
  /<\/?feeling>/gi,
  /<\/?reply[^>]*>/gi,
  /【(内心活动|内心独白|想法|思考过程)】[\s\S]*?(?=\n{2}|$)/g,
  /\[(内心活动|内心独白|想法)\][\s\S]*?(?=\n{2}|$)/gi,
];
export interface SegmentConfig {
  enabled: boolean;
  threshold: number;
  maxSegments: number;
  mode: 'punctuation' | 'sentence' | 'paragraph' | 'smart';
  minSegmentLength?: number;
  protectPairedSymbols?: boolean;
}

export interface MessageProcessingConfig {
  cleanThinkingMarkers?: boolean;
  blockAICliche?: boolean;
  removeDuplicatePunctuation?: boolean;
  normalizeWhitespace?: boolean;
}

export function protectPairedSymbols(segments: string[]): string[] {
  if (segments.length <= 1) return segments;

  const result: string[] = [];
  let pendingOpen: string | null = null;

  for (let i = 0; i < segments.length; i++) {
    let current = segments[i];

    if (pendingOpen !== null) {
      current = pendingOpen + current;
      pendingOpen = null;
    }

    let openCount = 0;
    let closeCount = 0;

    for (const pair of PAIRED_SYMBOLS) {
      for (const ch of current) {
        if (ch === pair.open) openCount++;
        if (ch === pair.close) closeCount++;
      }
    }

    if (openCount > closeCount) {
      pendingOpen = current;
    } else if (closeCount > openCount && result.length > 0) {
      result[result.length - 1] = result[result.length - 1] + current;
    } else {
      result.push(current);
    }
  }

  if (pendingOpen !== null) {
    result.push(pendingOpen);
  }

  return result.filter(s => s.length > 0);
}

export function cleanThinkingMarkers(text: string): string {
  let result = text;
  for (const marker of THINKING_MARKERS) {
    result = result.replace(marker, '');
  }
  return result.trim();
}

export function removeDuplicatePunctuation(text: string): string {
  return text
    // 🔧 修复"两个句号"：重复句末标点一律收敛为 1 个（旧逻辑刻意保留 2-3 个）
    .replace(/([。！？!?.])\1+/g, '$1')
    .replace(/([，,、；;：:])\1+/g, '$1')
    .replace(/\s{2,}/g, ' ');
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([，,、；;：:。！？])/g, '$1')
    .replace(/([，,、；;：:。！？])\s+/g, '$1')
    .trim();
}

export function processMessageText(text: string, config: MessageProcessingConfig): string {
  let result = text;
  if (config.cleanThinkingMarkers) {
    result = cleanThinkingMarkers(result);
  }
  if (config.normalizeWhitespace) {
    result = normalizeWhitespace(result);
  }
  if (config.removeDuplicatePunctuation) {
    result = removeDuplicatePunctuation(result);
  }
  return result;
}

export function splitIntoSegments(text: string, config?: SegmentConfig): string[] {
  if (!text || text.trim().length === 0) return [text];

  const maxSegments = config?.maxSegments ?? 10;
  const minLen = config?.minSegmentLength ?? 8;
  const mode = config?.mode ?? 'punctuation';

  const normalized = text.replace(/\s+([，,、；;：:。！？])/g, '$1').replace(/([，,、；;：:。！？])\s+/g, '$1');

  let result: string[];

  switch (mode) {
    case 'paragraph':
      result = splitByParagraph(normalized, minLen);
      break;
    case 'sentence':
      result = splitBySentence(normalized, minLen);
      break;
    case 'smart':
      result = splitSmart(normalized, minLen);
      break;
    case 'punctuation':
    default:
      result = splitByPunctuation(normalized, minLen);
      break;
  }

  if (config?.protectPairedSymbols !== false) {
    result = protectPairedSymbols(result);
  }
  return result.slice(0, maxSegments);
}

/** 按标点符号分段（原逻辑） */
function splitByPunctuation(text: string, minLen: number): string[] {
  // 对短文本（<60字符），仅按强标点切分，避免逗号过度碎片化
  const useWeakSplit = text.length >= 60;
  const rawSegments = useWeakSplit
    ? text.split(STRONG_SEPARATORS).flatMap(s => s.split(WEAK_SEPARATORS)).map(s => s.trim()).filter(s => s.length > 0)
    : text.split(STRONG_SEPARATORS).map(s => s.trim()).filter(s => s.length > 0);

  if (rawSegments.length <= 1) {
    return fallbackSplit(text);
  }

  const merged: string[] = [];
  let buffer = '';

  for (const seg of rawSegments) {
    if (buffer.length === 0) {
      buffer = seg;
    } else if (buffer.length + seg.length <= Math.max(25, minLen)) {
      if (TRAILING_PUNCT.test(buffer)) {
        buffer += seg;
      } else {
        buffer += '，' + seg;
      }
    } else {
      merged.push(buffer);
      buffer = seg;
    }
  }

  if (buffer.length > 0) merged.push(buffer);
  return merged.length > 0 ? merged : [text];
}

/** 按句子分段（以句号、问号、感叹号、省略号等句末标点切分）
 * 🔧 修复：切分时保留原句末标点（旧实现 split 丢标点、合并时固定补"。"，导致"？"变"。"）；
 *    短句（<10字）不再强制并入上一句——"刚醒吗？"应独立成段 */
function splitBySentence(text: string, minLen: number): string[] {
  // 带标点切分：句子末尾保留原句末标点
  const matches = text.match(/[^。！？….!?]*[。！？….!?]+|[^。！？….!?]+$/g) || [];
  const rawSentences = matches.map(s => s.trim()).filter(s => s.length > 0);

  if (rawSentences.length <= 1) {
    return fallbackSplit(text);
  }

  const merged: string[] = [];
  let buffer = '';

  for (const seg of rawSentences) {
    if (buffer.length === 0) {
      buffer = seg;
    } else if (seg.length >= 10 && buffer.length + seg.length <= Math.max(15, minLen)) {
      // 仅较长的后续句才允许并入（保留原标点直接拼接）
      buffer += seg;
    } else {
      merged.push(buffer);
      buffer = seg;
    }
  }

  if (buffer.length > 0) merged.push(buffer);
  return merged.length > 0 ? merged : [text];
}

/** 按段落分段（以换行符切分） */
function splitByParagraph(text: string, minLen: number): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .flatMap(p => p.split('\n'))
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (paragraphs.length <= 1) {
    return fallbackSplit(text);
  }

  // 短段落合并到前一段
  const merged: string[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if (buffer.length === 0) {
      buffer = para;
    } else if (buffer.length + para.length <= Math.max(15, minLen)) {
      buffer += '\n' + para;
    } else {
      merged.push(buffer);
      buffer = para;
    }
  }

  if (buffer.length > 0) merged.push(buffer);
  return merged.length > 0 ? merged : [text];
}

/** 智能分段：综合判断，按语义段落 + 内容长度 + 标点混合策略 */
function splitSmart(text: string, minLen: number): string[] {
  // 1. 先尝试按段落切分
  const paragraphs = text.split(/\n\s*\n/).map(s => s.trim()).filter(s => s.length > 0);

  if (paragraphs.length > 1) {
    // 段落间有明显空行分隔，按段落
    const merged: string[] = [];
    let buffer = '';
    for (const para of paragraphs) {
      if (buffer.length === 0) {
        buffer = para;
      } else if (buffer.length + para.length <= Math.max(20, minLen)) {
        buffer += '\n' + para;
      } else {
        merged.push(buffer);
        buffer = para;
      }
    }
    if (buffer.length > 0) merged.push(buffer);
    return merged;
  }

  // 2. 按换行切分
  const lines = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  if (lines.length > 1) {
    const merged: string[] = [];
    let buffer = '';
    for (const line of lines) {
      if (buffer.length === 0) {
        buffer = line;
      } else if (buffer.length + line.length <= Math.max(20, minLen)) {
        buffer += '\n' + line;
      } else {
        merged.push(buffer);
        buffer = line;
      }
    }
    if (buffer.length > 0) merged.push(buffer);
    return merged;
  }

  // 3. 无换行，按句末标点
  // 🔧 修复：带标点切分保留原句末标点（旧实现固定补"。"）；删除 `seg.length < 10 强制合并`——
  //    短句（如"刚醒吗？"）应独立成段，不再被吞进上一句
  const sentenceMatches = text.match(/[^。！？….!?]*[。！？….!?]+|[^。！？….!?]+$/g) || [];
  const sentences = sentenceMatches.map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length > 1) {
    // 长句优先独立，短句也不再强制合并（保持拟人节奏）
    const merged: string[] = [];
    let buffer = '';
    for (const seg of sentences) {
      if (buffer.length === 0) {
        buffer = seg;
      } else if (seg.length >= 10 && buffer.length + seg.length <= Math.max(20, minLen)) {
        buffer += seg; // 直接拼接，保留原句末标点
      } else {
        merged.push(buffer);
        buffer = seg;
      }
    }
    if (buffer.length > 0) merged.push(buffer);
    return merged;
  }

  // 4. 最终降级到按标点
  return splitByPunctuation(text, minLen);
}

/** 兜底：当文本不能被有效切分时，按长度硬切 */
function fallbackSplit(text: string): string[] {
  if (text.length > 30) {
    const result: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= 25) {
        result.push(remaining.trim());
        break;
      }
      let cutAt = -1;
      for (const sep of [' ', '，', ',', '、', '。', '！', '？', '；', '：']) {
        const idx = remaining.lastIndexOf(sep, 25);
        if (idx > 8) { cutAt = idx + sep.length; break; }
      }
      if (cutAt === -1) cutAt = 20;
      result.push(remaining.slice(0, cutAt).trim());
      remaining = remaining.slice(cutAt);
    }
    return result.filter(s => s.length > 0);
  }
  return [text];
}



export function splitUserInput(text: string): string[] {
  const lines = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  if (lines.length > 1) return lines;
  return [text];
}
