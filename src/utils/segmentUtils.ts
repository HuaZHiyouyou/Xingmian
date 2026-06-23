
const STRONG_SEPARATORS = /[。！？…\.!?]+/;
const WEAK_SEPARATORS = /[，,、；;：:\n]+/;
const SPACE_SEPARATORS = /\s{2,}|\s+(?=[，,、；;：:。！？])/;
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
  /【(内心活动|内心独白|想法|思考过程)】[\s\S]*?(?=\n{2}|$)/g,
  /\[(内心活动|内心独白|想法)\][\s\S]*?(?=\n{2}|$)/gi,
];

const AI_CLICHES = [
  '作为一个AI', '作为AI',
  '首先', '其次', '最后',
  '综上所述', '总而言之', '也就是说',
  '希望能够', '希望可以', '希望能',
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

export function containsAICliche(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  return AI_CLICHES.some(c => normalized.includes(c));
}

export function removeDuplicatePunctuation(text: string): string {
  return text
    .replace(/([。！？!?.])\1{3,}/g, '$1$1$1')
    .replace(/([，,、；;：:])\1+/g, '$1')
    .replace(/([。！？!?.])\1+/g, '$1$1')
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
  const rawSegments = text
    .split(STRONG_SEPARATORS)
    .flatMap(s => s.split(WEAK_SEPARATORS))
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (rawSegments.length <= 1) {
    return fallbackSplit(text);
  }

  const merged: string[] = [];
  let buffer = '';

  for (const seg of rawSegments) {
    if (buffer.length === 0) {
      buffer = seg;
    } else if (buffer.length + seg.length <= Math.max(15, minLen)) {
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

/** 按句子分段（以句号、问号、感叹号、省略号等句末标点切分） */
function splitBySentence(text: string, minLen: number): string[] {
  // 句末标点：。！？….!? 以及换行
  const SENTENCE_END = /[。！？…\.!?]+/;
  const rawSentences = text
    .split(SENTENCE_END)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (rawSentences.length <= 1) {
    return fallbackSplit(text);
  }

  const merged: string[] = [];
  let buffer = '';

  for (const seg of rawSentences) {
    if (buffer.length === 0) {
      buffer = seg;
    } else if (buffer.length + seg.length <= Math.max(15, minLen)) {
      buffer += '。' + seg;
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
  const sentences = text.split(/[。！？…\.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length > 1) {
    // 长句优先独立，短句合并
    const merged: string[] = [];
    let buffer = '';
    for (const seg of sentences) {
      if (buffer.length === 0) {
        buffer = seg;
      } else if (buffer.length + seg.length <= Math.max(20, minLen) || seg.length < 10) {
        buffer += '。' + seg;
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

function splitBySpaces(text: string): string[] {
  const parts = text.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length > 0);
  if (parts.length > 1) return parts;

  const spaceParts = text.split(/\s+/).map(s => s.trim()).filter(s => s.length > 0);
  if (spaceParts.length >= 2 && spaceParts.some(p => p.length >= 3)) return spaceParts;

  return [text];
}

export function splitUserInput(text: string): string[] {
  const lines = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
  if (lines.length > 1) return lines;
  return [text];
}
