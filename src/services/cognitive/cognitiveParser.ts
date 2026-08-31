/**
 * 认知输出解析器
 *
 * 解析 LLM 的 <thought> / <reply> / <consult> / <report> 标签，
 * 提取各阶段的输出值。
 *
 * 健壮性设计：
 * - 标签缺失时使用兜底逻辑
 * - 正则解析失败时返回空值（不崩溃）
 * - 情绪变化值解析容错
 */

import type { CognitiveContext } from './cognitiveContext';
import type { StageComposition } from './thinkStages';

/** 认知调用解析结果 */
export interface CognitiveOutput {
  /** 回复正文 */
  reply: string;
  /** 完整的思维链文本（原始） */
  thoughtRaw: string;
  /** 感知结果 */
  perception: string;
  /** 评估结果 */
  assessment: string;
  /** 代谢建议：{ sadness: -10, joy: +5 } */
  metabolism: Record<string, number>;
  /** 决策 */
  decision: string;
  /** 更新后的情绪值：{ sadness: 20, joy: 45 } */
  emotionUpdate: Record<string, number>;
  /** 好感度变化量 */
  affinityDelta: number;
  /** 学习利用 */
  learning: string;
  /** 是否成功解析到有效内容 */
  hasValidContent: boolean;
}

/** 情绪咨询解析结果 */
export interface ConsultOutput {
  /** 5 步内省文本 */
  consultRaw: string;
  /** 感知 */
  perception: string;
  /** 评估 */
  assessment: string;
  /** 代谢 */
  metabolism: string;
  /** 决策 */
  decision: string;
  /** 更新建议 */
  update: string;
  /** AI 建议的情绪新值 */
  emotionUpdate: Record<string, number>;
  /** 情绪报告（调试用） */
  report: Record<string, { value: number; reason: string }>;
  /** 是否成功解析 */
  hasValidContent: boolean;
}

/** 空输出（兜底） */
export const EMPTY_COGNITIVE_OUTPUT: CognitiveOutput = {
  reply: '',
  thoughtRaw: '',
  perception: '',
  assessment: '',
  metabolism: {},
  decision: '',
  emotionUpdate: {},
  affinityDelta: 0,
  learning: '',
  hasValidContent: false,
};

/** 空咨询结果（兜底） */
export const EMPTY_CONSULT_OUTPUT: ConsultOutput = {
  consultRaw: '',
  perception: '',
  assessment: '',
  metabolism: '',
  decision: '',
  update: '',
  emotionUpdate: {},
  report: {},
  hasValidContent: false,
};

/**
 * 解析认知主回复的 LLM 输出
 * 提取 <thought> 和 <reply>，并从 thought 中解析各步骤
 */
export function parseCognitiveOutput(raw: string): CognitiveOutput {
  if (!raw || raw.trim().length === 0) {
    return { ...EMPTY_COGNITIVE_OUTPUT, reply: '' };
  }

  // 提取 thought 和 reply
  const thoughtMatch = raw.match(/<thought>([\s\S]*?)<\/thought>/i);
  const replyMatch = raw.match(/<reply>([\s\S]*?)<\/reply>/i);

  const reply = replyMatch?.[1]
    ? replyMatch[1].trim()
    : extractReplyFromCognitiveChain(raw);
  const thoughtRaw = (thoughtMatch?.[1] || '').trim();

  if (!thoughtRaw && !reply) {
    // 完全没匹配到任何标签 — 用全文作为 reply
    return { ...EMPTY_COGNITIVE_OUTPUT, reply: raw.trim(), thoughtRaw: '', hasValidContent: true };
  }

  // 从 thought 中解析各步骤
  const perception = extractStep(thoughtRaw, '感知');
  const assessment = extractStep(thoughtRaw, '评估');

  // 代谢：先取文本，再解析数值
  const metabolismText = extractStep(thoughtRaw, '代谢');
  const metabolism = parseEmotionDeltas(metabolismText);

  const decision = extractStep(thoughtRaw, '决策');

  // 更新：解析情绪新值和好感度变化
  const updateText = extractStep(thoughtRaw, '更新');
  const { emotions: emotionUpdate, affinityDelta } = parseUpdate(updateText);

  // 学习利用
  const learning = extractStep(thoughtRaw, '学习利用');

  const hasValidContent = reply.length > 0 || thoughtRaw.length > 0;

  return {
    reply,
    thoughtRaw,
    perception,
    assessment,
    metabolism,
    decision,
    emotionUpdate,
    affinityDelta,
    learning,
    hasValidContent,
  };
}

/**
 * 解析情绪咨询的 LLM 输出
 * 提取 <consult> 和 <report>
 */
export function parseConsultOutput(raw: string): ConsultOutput {
  if (!raw || raw.trim().length === 0) {
    return { ...EMPTY_CONSULT_OUTPUT };
  }

  const consultMatch = raw.match(/<consult>([\s\S]*?)<\/consult>/i);
  const reportMatch = raw.match(/<report>([\s\S]*?)<\/report>/i);

  const consultRaw = (consultMatch?.[1] || '').trim();
  const reportRaw = (reportMatch?.[1] || '').trim();

  if (!consultRaw && !reportRaw) {
    return { ...EMPTY_CONSULT_OUTPUT, hasValidContent: false };
  }

  // 解析 5 步
  const perception = extractStep(consultRaw, '感知');
  const assessment = extractStep(consultRaw, '评估');
  const metabolism = extractStep(consultRaw, '代谢');
  const decision = extractStep(consultRaw, '决策');
  const updateText = extractStep(consultRaw, '更新');

  // 从更新文本中解析情绪数值
  const { emotions: emotionUpdate } = parseUpdate(updateText);

  // 解析 report（例如 [喜悦:93] 信任:86 ...）
  const report = parseEmotionReport(reportRaw);

  return {
    consultRaw,
    perception,
    assessment,
    metabolism,
    decision,
    update: updateText,
    emotionUpdate,
    report,
    hasValidContent: true,
  };
}

/**
 * 按上下文填充当前的阶段产出
 * 用于将解析结果写回 CognitiveContext
 */
export function applyOutputToContext(
  context: CognitiveContext,
  output: CognitiveOutput | ConsultOutput,
  composition: StageComposition,
): CognitiveContext {
  const updated = { ...context, completedStages: [...context.completedStages] };

  if ('reply' in output && output.hasValidContent) {
    // CognitiveOutput
    const cog = output as CognitiveOutput;
    updated.perception = cog.perception;
    updated.assessment = cog.assessment;
    updated.metabolism = cog.metabolism;
    updated.decision = cog.decision;
    updated.emotionUpdate = cog.emotionUpdate;
    updated.affinityDelta = cog.affinityDelta;
    updated.learning = cog.learning;
    updated.reply = cog.reply;
  } else {
    // ConsultOutput
    const consult = output as ConsultOutput;
    updated.perception = consult.perception;
    updated.assessment = consult.assessment;
    updated.decision = consult.decision;
    updated.emotionUpdate = consult.emotionUpdate;
    // consult 的 metabolism 是文本，存成元数据
    updated.metadata = { ...updated.metadata, consultMetabolism: consult.metabolism };
  }

  // 标记已完成的阶段
  for (const stage of composition.stages) {
    if (!updated.completedStages.includes(stage)) {
      updated.completedStages.push(stage);
    }
  }

  return updated;
}

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 从 thought/consult 文本中提取指定步骤的内容
 */
function extractStep(text: string, label: string): string {
  if (!text) return '';

  // 支持 "感知：" 和 "感知：" 两种冒号
  const patterns = [
    new RegExp(`${label}[：:]\\s*([^\\n]+(?:\\n(?!\\s*(?:感知|评估|代谢|决策|更新|学习利用|回复)[：:])[^\\n]*)*)`, 'i'),
    // 行首匹配（缩进版）
    new RegExp(`(?:^|\\n)\\s*${label}[：:]\\s*([^\\n]+(?:\\n(?!\\s*(?:感知|评估|代谢|决策|更新|学习利用|回复)[：:])[^\\n]*)*)`, 'i'),
  ];

  for (const re of patterns) {
    const match = text.match(re);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

/**
 * 解析代谢建议文本
 * "sadness -10, joy +5" → { sadness: -10, joy: 5 }
 */
function parseEmotionDeltas(text: string): Record<string, number> {
  if (!text) return {};
  const result: Record<string, number> = {};

  // 匹配 "情绪名 ±数值" 模式
  const matches = text.matchAll(/([a-zA-Z\u4e00-\u9fff]+)\s*([+-]?\d+)/g);
  for (const m of matches) {
    const emotion = normalizeEmotionKey(m[1]);
    if (emotion) {
      const value = parseInt(m[2], 10);
      result[emotion] = (result[emotion] || 0) + value;
    }
  }

  return result;
}

/**
 * 解析更新文本
 * "sadness=20, joy=45, 好感度+3" → { emotions: {...}, affinityDelta: 3 }
 */
function parseUpdate(text: string): { emotions: Record<string, number>; affinityDelta: number } {
  if (!text) return { emotions: {}, affinityDelta: 0 };

  const emotions: Record<string, number> = {};
  let affinityDelta = 0;

  // 好感度变化（"好感度+3"、"好感度-1"）
  const affMatch = text.match(/好感度\s*([+-]?\d+)/);
  if (affMatch) {
    affinityDelta = parseInt(affMatch[1], 10);
  }

  // 情绪绝对值（"sadness=20"、"喜悦=45"）
  const emotionMatches = text.matchAll(/([a-zA-Z\u4e00-\u9fff]+)\s*=\s*(\d+)/g);
  for (const m of emotionMatches) {
    const emotion = normalizeEmotionKey(m[1]);
    if (emotion && !emotion.includes('好感')) {
      emotions[emotion] = parseInt(m[2], 10);
    }
  }

  return { emotions, affinityDelta };
}

/**
 * 解析情绪报告
 * "[喜悦:93] 看到你一直在找我" → { joy: { value: 93, reason: "看到你一直在找我" } }
 */
function parseEmotionReport(raw: string): Record<string, { value: number; reason: string }> {
  if (!raw) return {};

  const result: Record<string, { value: number; reason: string }> = {};
  const linePattern = /\[?([\u4e00-\u9fff]+)[：:](\d+)\]?\s*(.*)/g;

  let match;
  while ((match = linePattern.exec(raw)) !== null) {
    const label = match[1];
    const value = parseInt(match[2], 10);
    const reason = match[3]?.trim() || '';
    const key = normalizeEmotionKey(label);
    if (key) {
      result[key] = { value, reason };
    }
  }

  return result;
}

/**
 * 归一化情绪名称（中英文 → 标准 key）
 */
function normalizeEmotionKey(input: string): string | null {
  if (!input) return null;

  const map: Record<string, string> = {
    // → joy
    joy: 'joy', 喜悦: 'joy', 开心: 'joy', 高兴: 'joy', 愉快: 'joy',
    // → trust
    trust: 'trust', 信任: 'trust', 信赖: 'trust',
    // → fear
    fear: 'fear', 恐惧: 'fear', 害怕: 'fear',
    // → surprise
    surprise: 'surprise', 惊讶: 'surprise', 吃惊: 'surprise',
    // → sadness
    sadness: 'sadness', 悲伤: 'sadness', 难过: 'sadness', 伤心: 'sadness',
    // → disgust
    disgust: 'disgust', 厌恶: 'disgust', 讨厌: 'disgust',
    // → anger
    anger: 'anger', 愤怒: 'anger', 生气: 'anger',
    // → anticipation
    anticipation: 'anticipation', 期待: 'anticipation', hope: 'anticipation', 希望: 'anticipation',
    // → pride
    pride: 'pride', 得意: 'pride',
    // → guilt
    guilt: 'guilt', 内疚: 'guilt', 愧疚: 'guilt',
    // → embarrassment
    embarrassment: 'embarrassment', shy: 'embarrassment', 害羞: 'embarrassment', 尴尬: 'embarrassment',
    // → jealousy
    jealousy: 'jealousy', 嫉妒: 'jealousy',
    // → curiosity
    curiosity: 'curiosity', 好奇: 'curiosity', 困惑: 'curiosity', confusion: 'curiosity',
    // → love
    love: 'love', 爱慕: 'love',
    // → gratitude
    gratitude: 'gratitude', 感恩: 'gratitude', 感激: 'gratitude',
    // → empathy
    empathy: 'empathy', 共情: 'empathy', 理解: 'empathy',
    // → anxiety
    anxiety: 'anxiety', 焦虑: 'anxiety', 慌张: 'anxiety', anxious: 'anxiety',
    // → loneliness
    loneliness: 'loneliness', 孤独: 'loneliness', 寂寞: 'loneliness', lonely: 'loneliness', 孤单: 'loneliness',
    // → disappointment
    disappointment: 'disappointment', 失望: 'disappointment', 失落: 'disappointment',
  };

  const normalized = input.toLowerCase().trim();
  return map[normalized] || map[input.trim()] || null;
}

/**
 * 从认知链文本中提取回复正文
 * 当 LLM 没有使用 <thought>/<reply> 标签时，文本格式通常是：
 * "感知：...评估：...代谢：...决策：...(实际回复内容)"
 * 如果整段都是认知链（无实际回复），返回空字符串让前端用 recovery reply 兜底
 */
function extractReplyFromCognitiveChain(text: string): string {
  if (!text || text.trim().length === 0) return '';

  const cleaned = text.trim();

  // 如果不包含认知链关键词，直接返回原文
  if (!cleaned.includes('感知') || (!cleaned.includes('评估') && !cleaned.includes('代谢'))) {
    return cleaned;
  }

  // 方案1：找到"决策："之后的内容，提取实际回复
  const decisionPatterns = ['决策：', '决策:'];
  for (const pattern of decisionPatterns) {
    const pos = cleaned.indexOf(pattern);
    if (pos === -1) continue;

    const afterDecision = cleaned.slice(pos + pattern.length);

    const stopPatterns = ['更新：', '更新:', '学习利用：', '学习利用:'];
    let replyText = afterDecision;
    for (const stop of stopPatterns) {
      const stopPos = afterDecision.indexOf(stop);
      if (stopPos !== -1) {
        replyText = afterDecision.slice(0, stopPos);
        break;
      }
    }

    const lines = replyText.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0
        && !l.startsWith('更新')
        && !l.startsWith('学习利用')
      );

    if (lines.length > 0) {
      const result = lines.join('\n').trim();
      if (result.length >= 2) return result;
    }
  }

  // 方案2：整段都是认知链（无实际回复内容）
  const cognitiveLabels = ['感知', '评估', '代谢', '决策', '更新', '学习利用'];
  const firstLine = cleaned.split('\n')[0]?.trim() || '';
  const startsWithCognitive = cognitiveLabels.some(label =>
    firstLine.startsWith(label) || firstLine.startsWith(`${label}：`) || firstLine.startsWith(`${label}:`)
  );

  if (startsWithCognitive) {
    // 整段都是认知链，没有实际回复 → 返回空让前端兜底
    return '';
  }

  return cleaned;
}
