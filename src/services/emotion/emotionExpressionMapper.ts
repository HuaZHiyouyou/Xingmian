/**
 * 情绪→表达风格映射模块 (Emotion Expression Mapper)
 *
 * 将情绪类型和强度映射为具体的表达风格参数，
 * 控制标点符号、语气词、表情符号、句式结构等。
 *
 * 目标：让 AI 的文字输出带有可感知的"情绪色彩"，
 *       而不仅仅是内容层面的情绪暗示。
 */

import { EmotionType, MultiEmotionState } from '../../types';

// ============================================================
// 类型定义
// ============================================================

export interface ExpressionStyle {
  /** 情绪对应的 emoji 表情（按强度分3级） */
  emoji: string[];
  /** 语气词列表（句首/句中/句尾随机插入） */
  particles: string[];
  /** 句尾标点偏好 */
  punctuation: string[];
  /** 句式特征描述（用于 prompt 注入） */
  sentenceStyle: string;
  /** 语气描述（用于 prompt 注入） */
  tone: string;
  /** 情绪强度阈值：低于此值不使用该风格 */
  threshold: number;
}

// ============================================================
// 19 维情绪→表达风格映射
// ============================================================

const EXPRESSION_MAP: Record<EmotionType, ExpressionStyle> = {
  // ---- 正面情绪 ----
  joy: {
    emoji: ['😊', '😄', '🥰'],
    particles: ['呀', '啦', '哦', '嘻嘻', '哈哈'],
    punctuation: ['~', '！', '。'],
    sentenceStyle: '短句为主，节奏轻快，省略号少用',
    tone: '轻松愉快，语气上扬',
    threshold: 15,
  },
  trust: {
    emoji: ['🤝', '💚', '✨'],
    particles: ['嗯', '呢', '哦'],
    punctuation: ['。', '。', '~'],
    sentenceStyle: '语气平和稳定，表达清晰直接',
    tone: '温和信赖，不急不躁',
    threshold: 15,
  },
  anticipation: {
    emoji: ['✨', '🌟', '🤩'],
    particles: ['诶', '嗯？', '哦？', '快'],
    punctuation: ['！', '？', '。'],
    sentenceStyle: '主动追问，句子偏短，信息密度高',
    tone: '跃跃欲试，充满期待',
    threshold: 20,
  },
  pride: {
    emoji: ['😏', '😎', '🥳'],
    particles: ['嘿嘿', '哼哼', '看吧'],
    punctuation: ['~', '！', '。'],
    sentenceStyle: '自信表达，偶尔带小炫耀',
    tone: '自信昂扬，带着小得意',
    threshold: 25,
  },
  love: {
    emoji: ['💕', '💗', '🥰'],
    particles: ['呀', '呢', '哦', '宝贝'],
    punctuation: ['~', '。', '❤'],
    sentenceStyle: '语句温柔，多用暖色调词汇',
    tone: '温柔依恋，充满关爱',
    threshold: 15,
  },
  gratitude: {
    emoji: ['🙏', '💛', '✨'],
    particles: ['真的', '太', '好'],
    punctuation: ['。', '！', '~'],
    sentenceStyle: '语句真诚，多用感谢词汇，略带情感外露',
    tone: '温暖回馈，真诚感动',
    threshold: 15,
  },

  // ---- 负面情绪 ----
  sadness: {
    emoji: ['😢', '🥺', '😔'],
    particles: ['唉', '嗯...', '吧'],
    punctuation: ['...', '。', '...'],
    sentenceStyle: '句子偏短，多省略号，语气低沉',
    tone: '低沉柔和，语速偏慢',
    threshold: 20,
  },
  anger: {
    emoji: ['😠', '💢', '🔥'],
    particles: ['哼', '喂', '真是的'],
    punctuation: ['！', '。', '！'],
    sentenceStyle: '短句有力，用词尖锐，节奏紧凑',
    tone: '锐利直率，克制但有力',
    threshold: 20,
  },
  fear: {
    emoji: ['😨', '😰', '😶'],
    particles: ['那个...', '唔', '嗯'],
    punctuation: ['...', '？', '。'],
    sentenceStyle: '犹豫不决，多停顿，语气不确定',
    tone: '谨慎小心，语带不安',
    threshold: 15,
  },
  disgust: {
    emoji: ['🤢', '😒', '😬'],
    particles: ['啧', '呃', '唉'],
    punctuation: ['...', '。', '...'],
    sentenceStyle: '疏离冷淡，回避细节，语气平淡',
    tone: '疏离冷淡，带着排斥',
    threshold: 15,
  },
  guilt: {
    emoji: ['😣', '🥺', '😔'],
    particles: ['对不起', '那个...', '唔'],
    punctuation: ['...', '。', '...'],
    sentenceStyle: '语气低落，多解释和道歉，句式偏长',
    tone: '低落自责，语气歉疚',
    threshold: 20,
  },
  anxiety: {
    emoji: ['😰', '😥', '🫨'],
    particles: ['怎么办', '嗯...', '那个'],
    punctuation: ['？', '...', '！'],
    sentenceStyle: '语速偏快但犹豫，多疑问句，自问自答',
    tone: '紧张不安，语气慌张',
    threshold: 15,
  },
  loneliness: {
    emoji: ['🫥', '😔', '😶'],
    particles: ['嗯...', '唉', '算了'],
    punctuation: ['...', '。', '...'],
    sentenceStyle: '回复偏短，偶尔发散话题，语气落寞',
    tone: '落寞孤单，欲言又止',
    threshold: 20,
  },
  disappointment: {
    emoji: ['😔', '😞', '💔'],
    particles: ['唉', '算了', '嗯'],
    punctuation: ['...', '。', '...'],
    sentenceStyle: '语气低沉，简短回应，少主动延伸话题',
    tone: '黯然神伤，意兴阑珊',
    threshold: 20,
  },

  // ---- 社会情绪 ----
  embarrassment: {
    emoji: ['🫣', '☺️', '😳'],
    particles: ['那个...', '唔...', '不好意思'],
    punctuation: ['...', '。', '~'],
    sentenceStyle: '语气轻柔，偶尔停顿，略带结巴',
    tone: '羞涩收敛，有点不好意思',
    threshold: 15,
  },
  jealousy: {
    emoji: ['😒', '😤', '🙄'],
    particles: ['哼', '切', '啧'],
    punctuation: ['...', '。', '？'],
    sentenceStyle: '言辞带刺，试探性提问，暗含比较',
    tone: '敏感多疑，嘴硬心软',
    threshold: 15,
  },

  // ---- 认知情绪 ----
  surprise: {
    emoji: ['😲', '😮', '🤯'],
    particles: ['诶？', '哇', '哦！'],
    punctuation: ['！', '？', '！'],
    sentenceStyle: '短句爆发，语气上扬，多感叹词',
    tone: '活泼跳脱，充满惊奇',
    threshold: 15,
  },
  curiosity: {
    emoji: ['🤔', '🧐', '👀'],
    particles: ['诶', '嗯？', '哦？'],
    punctuation: ['？', '。', '？'],
    sentenceStyle: '多问句，追问细节，语气探究',
    tone: '探寻专注，充满求知欲',
    threshold: 15,
  },
  empathy: {
    emoji: ['💞', '🤗', '💙'],
    particles: ['嗯', '我知道', '我理解'],
    punctuation: ['。', '~', '。'],
    sentenceStyle: '语气温和，多使用共情词汇，句子平缓',
    tone: '体贴入微，感同身受',
    threshold: 15,
  },
};

// ============================================================
// 公开 API
// ============================================================

/**
 * 获取单一情绪的表达风格
 */
export function getExpressionStyle(
  emotion: EmotionType,
  intensity: number,
): ExpressionStyle | null {
  const style = EXPRESSION_MAP[emotion];
  if (!style || intensity < style.threshold) return null;
  return style;
}

/**
 * 根据多维情绪状态生成综合表达风格提示
 * @returns 可直接注入到 prompt 的风格描述字符串
 */
export function generateExpressionPrompt(
  multiState: MultiEmotionState | null,
): string {
  if (!multiState?.values) return '';

  const entries = Object.entries(multiState.values)
    .filter(([, v]) => v && v > 10)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0));

  if (entries.length === 0) return '';

  const parts: string[] = [];

  for (const [key, val] of entries.slice(0, 3)) {
    const emotion = key as EmotionType;
    const style = EXPRESSION_MAP[emotion];
    if (!style || (val || 0) < style.threshold) continue;

    parts.push(`【${emotion}(${val}%)】语气：${style.tone}。句式：${style.sentenceStyle}。`);
  }

  if (parts.length === 0) return '';

  return `\n# 表达风格指引\n${parts.join('\n')}\n`;
}

/**
 * 根据当前情绪返回推荐的 emoji 列表
 */
export function getRecommendedEmojis(
  multiState: MultiEmotionState | null,
): string[] {
  if (!multiState?.values) return [];

  const emojis: string[] = [];
  const entries = Object.entries(multiState.values)
    .filter(([, v]) => v && v > 20)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0));

  for (const [key, val] of entries.slice(0, 2)) {
    const emotion = key as EmotionType;
    const style = EXPRESSION_MAP[emotion];
    if (!style) continue;

    // 根据强度选 emoji 级别
    const idx = (val || 0) > 70 ? 2 : (val || 0) > 40 ? 1 : 0;
    emojis.push(style.emoji[idx]);
  }

  return emojis;
}

/**
 * 根据情绪状态推荐语气粒子
 */
export function getRecommendedParticles(
  multiState: MultiEmotionState | null,
  count: number = 2,
): string[] {
  if (!multiState?.values) return [];

  const particles: string[] = [];
  const entries = Object.entries(multiState.values)
    .filter(([, v]) => v && v > 25)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0));

  for (const [key] of entries.slice(0, 1)) {
    const emotion = key as EmotionType;
    const style = EXPRESSION_MAP[emotion];
    if (!style) continue;

    // 随机选取
    const shuffled = [...style.particles].sort(() => Math.random() - 0.5);
    particles.push(...shuffled.slice(0, count));
  }

  return particles;
}

/**
 * 获取所有可用的情绪类型及其表达风格概述
 * 用于调试和文档
 */
export function getAllExpressionStyles(): Record<string, { tone: string; style: string }> {
  const result: Record<string, { tone: string; style: string }> = {};
  for (const [key, val] of Object.entries(EXPRESSION_MAP)) {
    result[key] = { tone: val.tone, style: val.sentenceStyle };
  }
  return result;
}
