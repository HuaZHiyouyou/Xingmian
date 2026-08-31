/**
 * ============================================================
 * 思维链解析器 V2
 * 参考: docs/upgrade-plans/01-emotion-system-upgrade.md
 * 解析 LLM 在 <thought> 标签中的情绪推理过程
 * 解析 LLM 在 <feeling> 标签中的情绪状态输出
 * ============================================================
 */

import { EmotionType, MultiEmotionState } from '../../types';

// ---------- 思维链输出结构 ----------

export interface ThoughtChainOutput {
  /** 原始思维链文本 */
  raw: string;
  /** 推理步骤 */
  steps: ThoughtStep[];
  /** 最终情绪状态 */
  finalEmotion: {
    type: EmotionType;
    intensity: number;
    reason: string;
  };
  /** 情绪变化建议（主动代谢：哪些情绪要减弱） */
  metabolisms: EmotionMetabolism[];
}

export interface ThoughtStep {
  order: number;
  label: string; // 如 '感知', '评估', '代谢', '决策'
  content: string;
}

export interface EmotionMetabolism {
  emotion: EmotionType;
  delta: number;  // 负值=减弱
  reason: string;
}

// ---------- Top3 情绪结构 ----------

export interface Top3Emotion {
  primary: { type: EmotionType; intensity: number };
  secondary: { type: EmotionType; intensity: number } | null;
  tertiary: { type: EmotionType; intensity: number } | null;
}

// ---------- 解析函数 ----------

/**
 * parseThoughtChain - 从 LLM 输出中解析 <thought> 标签内容
 * 
 * 解析格式:
 * <thought>
 * [感知] 用户说"我好累"，语气低沉，可能情绪低落
 * [评估] 这触发了我的关心和共鸣，我觉得可以安抚
 * [代谢] sadness -3, concern -2, 之前积累的焦虑可以释放
 * [决策] 用温柔的语气安慰，表达陪伴感
 * </thought>
 */
export function parseThoughtChain(aiOutput: string): ThoughtChainOutput | null {
  const thoughtMatch = aiOutput.match(/<thought[\s\S]*?>([\s\S]*?)<\/thought>/i);
  if (!thoughtMatch) return null;

  const raw = thoughtMatch[0];
  const content = thoughtMatch[1].trim();

  const steps: ThoughtStep[] = [];
  const finalEmotion: ThoughtChainOutput['finalEmotion'] = {
    type: 'joy',
    intensity: 50,
    reason: '',
  };
  const metabolisms: EmotionMetabolism[] = [];

  // 解析各步骤
  const stepMatches = content.match(/\[(\w+)\]\s*(.+?)(?=\[|\n\n|$)/gs);
  if (stepMatches) {
    let order = 0;
    for (const stepMatch of stepMatches) {
      const labelMatch = stepMatch.match(/\[(\w+)\]\s*(.+)/s);
      if (labelMatch) {
        const label = labelMatch[1].trim();
        const stepContent = labelMatch[2].trim();
        order++;
        steps.push({ order, label, content: stepContent });

        // 解析代谢行: sadness:-10, joy:+5
        if (label === '代谢' || label === 'metabolize') {
          const metabMatches = stepContent.matchAll(/(\w+)\s*[:：]\s*([+-]?\d+)/g);
          for (const m of metabMatches) {
            const rawEmotion = m[1].toLowerCase();
            const delta = parseInt(m[2], 10);
            const emotion = normalizeEmotionType(rawEmotion);
            if (emotion && delta !== 0) {
              metabolisms.push({ emotion, delta, reason: `代谢: ${rawEmotion} ${delta > 0 ? '+' : ''}${delta}` });
            }
          }
        }
      }
    }
  }

  return { raw, steps, finalEmotion, metabolisms };
}

/**
 * parseFeelingTag - 解析 <feeling> 标签中的情绪状态
 * 
 * 解析格式:
 * <feeling>
 * joy:60, sadness:15, trust:40, neutral:0
 * </feeling>
 */
export function parseFeelingTag(aiOutput: string): Partial<Record<EmotionType, number>> | null {
  const feelingMatch = aiOutput.match(/<feeling[\s\S]*?>([\s\S]*?)<\/feeling>/i);
  if (!feelingMatch) return null;

  const content = feelingMatch[1].trim();
  const result: Partial<Record<EmotionType, number>> = {};

  const pairs = content.split(/[,;，；、\s]+/);
  for (const pair of pairs) {
    const parts = pair.split(/[:：]\s*/);
    if (parts.length >= 2) {
      const rawEmotion = parts[0].trim().toLowerCase();
      const value = parseFloat(parts[1].trim());
      const dimension = normalizeEmotionDimension(rawEmotion);
      if (dimension && !isNaN(value)) {
        result[dimension] = Math.max(0, Math.min(100, value));
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * parseEmotionReport - 解析 <report> 标签中的情绪报告
 *
 * 解析格式:
 * <report>
 * [喜悦:4]
 * [悲伤:2]
 * </report>
 * 或
 * <report>joy:60,sadness:15</report>
 */
export function parseEmotionReport(aiOutput: string): Partial<Record<EmotionType, number>> | null {
  const reportMatch = aiOutput.match(/<report[\s\S]*?>([\s\S]*?)<\/report>/i);
  if (!reportMatch) return null;

  const content = reportMatch[1].trim();
  const result: Partial<Record<EmotionType, number>> = {};

  // 先尝试 [情绪:数值] 格式
  const bracketMatches = content.matchAll(/\[(\w+)\s*[:：]\s*([+-]?\d+(?:\.\d+)?)\]/g);
  let found = false;
  for (const m of bracketMatches) {
    const rawEmotion = m[1].trim().toLowerCase();
    const value = parseFloat(m[2]);
    const dimension = normalizeEmotionDimension(rawEmotion);
    if (dimension && !isNaN(value)) {
      result[dimension] = Math.max(0, Math.min(100, value));
      found = true;
    }
  }

  if (found) return Object.keys(result).length > 0 ? result : null;

  // 回退到 key:value 逗号分隔格式
  const pairs = content.split(/[,;，；、\s]+/);
  for (const pair of pairs) {
    const parts = pair.split(/[:：]\s*/);
    if (parts.length >= 2) {
      const rawEmotion = parts[0].trim().toLowerCase();
      const value = parseFloat(parts[1].trim());
      const dimension = normalizeEmotionDimension(rawEmotion);
      if (dimension && !isNaN(value)) {
        result[dimension] = Math.max(0, Math.min(100, value));
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * parseTop3Emotion - 从 MultiEmotionState 提取前三个主要情绪
 */
export function getTop3Emotion(state: MultiEmotionState): Top3Emotion {
  const entries = Object.entries(state.values)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  const primary = entries[0]
    ? { type: normalizeEmotionType(entries[0][0]) || 'joy', intensity: Math.min(100, entries[0][1]) }
    : { type: 'joy' as EmotionType, intensity: 50 };

  const secondary = entries[1]
    ? { type: normalizeEmotionType(entries[1][0]) || 'joy', intensity: Math.min(100, entries[1][1]) }
    : null;

  const tertiary = entries[2]
    ? { type: normalizeEmotionType(entries[2][0]) || 'joy', intensity: Math.min(100, entries[2][1]) }
    : null;

  return { primary, secondary, tertiary };
}

/**
 * buildTop3EmotionPrompt - 构建 Top3 情绪提示文案
 */
export function buildTop3EmotionPrompt(top3: Top3Emotion): string {
  const lines: string[] = [];
  lines.push(`当前主导情绪: ${getEmotionLabel(top3.primary.type)}(${Math.round(top3.primary.intensity)})`);
  if (top3.secondary) {
    lines.push(`次要情绪: ${getEmotionLabel(top3.secondary.type)}(${Math.round(top3.secondary.intensity)})`);
  }
  if (top3.tertiary) {
    lines.push(`底层情绪: ${getEmotionLabel(top3.tertiary.type)}(${Math.round(top3.tertiary.intensity)})`);
  }

  // 三维情绪表情指导
  const displayMap = getEmotionDisplayMap(top3);
  lines.push(`表情基调: ${displayMap}`);

  return lines.join('\n');
}

// ---------- 辅助函数 ----------

function normalizeEmotionType(raw: string): EmotionType | null {
  const map: Record<string, EmotionType> = {
    'joy': 'joy', 'happy': 'joy', '高兴': 'joy', '开心': 'joy', '快乐': 'joy',
    'trust': 'trust', '信任': 'trust', '信赖': 'trust',
    'fear': 'fear', 'afraid': 'fear', '恐惧': 'fear', '害怕': 'fear',
    'surprise': 'surprise', '惊': 'surprise', '惊讶': 'surprise',
    'sadness': 'sadness', 'sad': 'sadness', '悲伤': 'sadness', '难过': 'sadness', '伤心': 'sadness',
    'disgust': 'disgust', '厌恶': 'disgust', '反感': 'disgust',
    'anger': 'anger', 'angry': 'anger', '愤怒': 'anger', '生气': 'anger',
    'anticipation': 'anticipation', '期待': 'anticipation', '预期': 'anticipation',
    'pride': 'pride', '骄傲': 'pride', '自豪': 'pride',
    'guilt': 'guilt', '内疚': 'guilt', '愧疚': 'guilt',
    'embarrassment': 'embarrassment', 'shy': 'embarrassment', '害羞': 'embarrassment', '尴尬': 'embarrassment',
    'jealousy': 'jealousy', '嫉妒': 'jealousy',
    'curiosity': 'curiosity', '好奇': 'curiosity',
    'love': 'love', '爱慕': 'love', '喜爱': 'love',
    'gratitude': 'gratitude', '感恩': 'gratitude', '感激': 'gratitude',
    'empathy': 'empathy', '共情': 'empathy', '同理': 'empathy',
    'anxiety': 'anxiety', '焦虑': 'anxiety', '慌张': 'anxiety',
    'loneliness': 'loneliness', '孤独': 'loneliness', '寂寞': 'loneliness',
    'disappointment': 'disappointment', '失望': 'disappointment', '失落': 'disappointment',
  };
  return map[raw] || null;
}

function normalizeEmotionDimension(raw: string): EmotionType | null {
  return normalizeEmotionType(raw);
}

function getEmotionLabel(type: EmotionType): string {
  const map: Record<EmotionType, string> = {
    joy: '😊开心', trust: '🤝信任', fear: '😨恐惧', surprise: '😲惊讶',
    sadness: '😢悲伤', disgust: '🤢厌恶', anger: '😡愤怒', anticipation: '🔮期待',
    pride: '🦚骄傲', guilt: '😣内疚', embarrassment: '🫣尴尬', jealousy: '😒嫉妒',
    curiosity: '🤔好奇', love: '💕爱慕',
    gratitude: '🙏感恩', empathy: '💞共情', anxiety: '😰焦虑',
    loneliness: '🫥孤独', disappointment: '😔失望',
  };
  return map[type] || type;
}

function getEmotionDisplayMap(top3: Top3Emotion): string {
  // 主导情绪 → 表情基调
  const toneMap: Record<string, string> = {
    joy: '轻松愉快', trust: '温和信赖', fear: '谨慎小心', surprise: '活泼跳脱',
    sadness: '低沉柔和', disgust: '疏离冷淡', anger: '锐利直率', anticipation: '专注期待',
    pride: '自信昂扬', guilt: '低落自责', embarrassment: '羞涩收敛', jealousy: '敏感多疑',
    curiosity: '探寻专注', love: '温柔依恋',
    gratitude: '温暖回馈', empathy: '体贴入微', anxiety: '紧张不安',
    loneliness: '落寞孤单', disappointment: '黯然神伤',
  };

  const primaryTone = toneMap[top3.primary.type] || '自然随意';

  if (top3.secondary && top3.secondary.intensity > 20) {
    const secondaryTone = toneMap[top3.secondary.type];
    if (secondaryTone && secondaryTone !== primaryTone) {
      return `${primaryTone}中透着${secondaryTone}`;
    }
  }

  return `${primaryTone}`;
}
