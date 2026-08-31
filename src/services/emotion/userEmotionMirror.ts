/**
 * 用户情绪镜像模块 (User Emotion Mirror)
 *
 * 核心功能：
 * 1. 从用户消息中提取情绪信号
 * 2. 建立用户情绪画像（近期情绪轨迹）
 * 3. 生成"共情映射"——AI 应该展现的 empathetic response
 *
 * 设计原则：
 * - 镜像 ≠ 相同：AI 不会"变成"用户的情绪，而是展现理解和共情
 * - 渐进式共情：情绪强度越高，共情程度越深
 * - 冷静锚点：即使用户情绪极端，AI 也保持适当的情绪边界
 */

import { EmotionType } from '../../types';

// ============================================================
// 类型定义
// ============================================================

export interface UserEmotionSnapshot {
  /** 检测到的情绪类型 */
  emotion: EmotionType;
  /** 情绪强度 (0-100) */
  intensity: number;
  /** 情绪来源的关键词/信号 */
  signals: string[];
  /** 时间戳 */
  timestamp: number;
}

export interface MirrorRecommendation {
  /** AI 应该展现的共情类型 */
  empathyType: EmpathyType;
  /** 共情强度 (0-1) */
  empathyIntensity: number;
  /** 推荐的回应策略 */
  responseStrategy: ResponseStrategy;
  /** 是否需要情绪调节引导 */
  needsRegulation: boolean;
  /** 推荐的回应开头（可选） */
  suggestedOpening: string;
}

export type EmpathyType =
  | 'reflective'   // 反射式共情：镜像用户情绪
  | 'validating'   // 确认式共情：肯定用户感受
  | 'supportive'   // 支持式共情：表达支持和陪伴
  | 'grounding'    // 稳定式共情：帮助用户平静
  | 'celebratory'; // 庆祝式共情：和用户一起开心

export type ResponseStrategy =
  | 'mirror_intensity'   // 镜像强度：跟随用户情绪强度
  | 'soften'            // 柔化：降低情绪强度
  | 'amplify'           // 放大：增强正面情绪
  | 'redirect'          // 重定向：引导到积极方向
  | 'hold_space';       // 保持空间：允许情绪存在

// ============================================================
// 情绪→共情映射规则
// ============================================================

const EMPATHY_RULES: Record<string, {
  empathyType: EmpathyType;
  strategy: ResponseStrategy;
  maxEmpathy: number;
  regulationThreshold: number; // 超过此强度需要引导
}> = {
  // 正面情绪
  joy:              { empathyType: 'celebratory',    strategy: 'amplify',       maxEmpathy: 0.9,  regulationThreshold: 95 },
  love:             { empathyType: 'celebratory',    strategy: 'amplify',       maxEmpathy: 0.85, regulationThreshold: 90 },
  gratitude:        { empathyType: 'validating',     strategy: 'mirror_intensity', maxEmpathy: 0.8, regulationThreshold: 85 },
  trust:            { empathyType: 'validating',     strategy: 'mirror_intensity', maxEmpathy: 0.75, regulationThreshold: 80 },
  anticipation:     { empathyType: 'celebratory',    strategy: 'amplify',       maxEmpathy: 0.8,  regulationThreshold: 85 },
  pride:            { empathyType: 'celebratory',    strategy: 'amplify',       maxEmpathy: 0.8,  regulationThreshold: 80 },

  // 轻度负面
  embarrassment:    { empathyType: 'validating',     strategy: 'soften',        maxEmpathy: 0.7,  regulationThreshold: 70 },
  surprise:         { empathyType: 'reflective',     strategy: 'mirror_intensity', maxEmpathy: 0.7, regulationThreshold: 80 },
  curiosity:        { empathyType: 'supportive',     strategy: 'amplify',       maxEmpathy: 0.8,  regulationThreshold: 85 },
  empathy:          { empathyType: 'validating',     strategy: 'mirror_intensity', maxEmpathy: 0.75, regulationThreshold: 80 },

  // 中度负面
  sadness:          { empathyType: 'supportive',     strategy: 'soften',        maxEmpathy: 0.8,  regulationThreshold: 75 },
  fear:             { empathyType: 'grounding',      strategy: 'soften',        maxEmpathy: 0.75, regulationThreshold: 70 },
  guilt:            { empathyType: 'validating',     strategy: 'soften',        maxEmpathy: 0.7,  regulationThreshold: 65 },
  anxiety:          { empathyType: 'grounding',      strategy: 'soften',        maxEmpathy: 0.75, regulationThreshold: 65 },
  disappointment:   { empathyType: 'supportive',     strategy: 'soften',        maxEmpathy: 0.75, regulationThreshold: 70 },

  // 重度负面
  anger:            { empathyType: 'validating',     strategy: 'hold_space',    maxEmpathy: 0.7,  regulationThreshold: 75 },
  disgust:          { empathyType: 'reflective',     strategy: 'hold_space',    maxEmpathy: 0.6,  regulationThreshold: 70 },
  jealousy:         { empathyType: 'validating',     strategy: 'hold_space',    maxEmpathy: 0.65, regulationThreshold: 70 },
  loneliness:       { empathyType: 'supportive',     strategy: 'hold_space',    maxEmpathy: 0.85, regulationThreshold: 75 },
};

// 共情开场白模板
const EMPATHY_OPENINGS: Record<EmpathyType, string[]> = {
  reflective: [
    '我能感受到你',
    '听起来你',
    '我能体会到',
  ],
  validating: [
    '你有这样的感受是完全可以理解的',
    '你的心情我明白',
    '你这么想是很正常的',
  ],
  supportive: [
    '我一直在这里',
    '你不是一个人',
    '有什么我能帮到你的吗',
  ],
  grounding: [
    '深呼吸，我陪你',
    '没关系，我们一起面对',
    '先别着急',
  ],
  celebratory: [
    '太好了！',
    '真为你开心',
    '这太棒了',
  ],
};

// ============================================================
// 核心算法
// ============================================================

/**
 * 从用户消息中检测即时情绪
 * 基于关键词规则（轻量级，不依赖 LLM）
 */
export function detectUserEmotion(message: string): UserEmotionSnapshot | null {
  const signals: Array<{ emotion: EmotionType; score: number; signal: string }> = [];

  // 简化的关键词匹配（与 emotionAnalyzer 的关键词库共用概念，但更精简）
  const patterns: Array<{ regex: RegExp; emotion: EmotionType; score: number }> = [
    // 正面
    { regex: /开心|高兴|快乐|太好了|好棒|嘿嘿|哈哈|嘻嘻/, emotion: 'joy', score: 70 },
    { regex: /谢谢|感谢|感恩|辛苦了|有你真好/, emotion: 'gratitude', score: 65 },
    { regex: /喜欢你|爱你|想你|抱抱|亲亲/, emotion: 'love', score: 75 },
    { regex: /期待|想快点|迫不及待|好希望/, emotion: 'anticipation', score: 60 },
    { regex: /信你|相信你|可靠/, emotion: 'trust', score: 55 },
    { regex: /做到了|成功|赢了|第一/, emotion: 'pride', score: 60 },

    // 中度负面
    { regex: /难过|伤心|心痛|想哭|好累/, emotion: 'sadness', score: 65 },
    { regex: /害怕|恐惧|担心|不安/, emotion: 'fear', score: 55 },
    { regex: /焦虑|慌|紧张|压力大|怎么办/, emotion: 'anxiety', score: 60 },
    { regex: /失望|失落|白期待|不如意/, emotion: 'disappointment', score: 60 },
    { regex: /内疚|对不起|抱歉|是我的错/, emotion: 'guilt', score: 55 },
    { regex: /尴尬|不好意思|丢脸|社死/, emotion: 'embarrassment', score: 50 },

    // 重度负面
    { regex: /生气|愤怒|讨厌|烦死|气死/, emotion: 'anger', score: 70 },
    { regex: /恶心|反感|受够了|受不了/, emotion: 'disgust', score: 60 },
    { regex: /嫉妒|羡慕恨|凭什么|为什么他/, emotion: 'jealousy', score: 55 },
    { regex: /孤独|寂寞|没人理|好无聊|一个人/, emotion: 'loneliness', score: 60 },
  ];

  for (const p of patterns) {
    if (p.regex.test(message)) {
      signals.push({ emotion: p.emotion, score: p.score, signal: p.regex.source });
    }
  }

  if (signals.length === 0) return null;

  // 取最强信号
  signals.sort((a, b) => b.score - a.score);
  const top = signals[0];

  return {
    emotion: top.emotion,
    intensity: top.score,
    signals: signals.slice(0, 3).map(s => s.signal),
    timestamp: Date.now(),
  };
}

/**
 * 根据用户情绪生成共情推荐
 */
export function generateMirrorRecommendation(
  userEmotion: UserEmotionSnapshot,
  _aiCurrentMood?: EmotionType,
): MirrorRecommendation {
  const rule = EMPATHY_RULES[userEmotion.emotion] || EMPATHY_RULES.joy;

  // 计算共情强度：跟随用户强度，但不超过上限
  const rawIntensity = userEmotion.intensity / 100;
  const empathyIntensity = Math.min(rawIntensity * 0.8, rule.maxEmpathy);

  // 判断是否需要情绪调节引导
  const needsRegulation = userEmotion.intensity >= rule.regulationThreshold;

  // 选择共情开场白
  const openings = EMPATHY_OPENINGS[rule.empathyType];
  const suggestedOpening = openings[Math.floor(Math.random() * openings.length)];

  return {
    empathyType: rule.empathyType,
    empathyIntensity,
    responseStrategy: rule.strategy,
    needsRegulation,
    suggestedOpening,
  };
}

/**
 * 生成共情注入 prompt 片段
 * 用于注入到 AI 的 system prompt 中
 */
export function generateEmpathyInjection(
  recommendation: MirrorRecommendation,
  userEmotion: UserEmotionSnapshot,
): string {
  const parts: string[] = [];

  parts.push(`\n# 共情指引（基于用户情绪检测）`);
  parts.push(`用户当前感受：${userEmotion.emotion}（强度 ${userEmotion.intensity}%）`);
  parts.push(`共情类型：${recommendation.empathyType}`);
  parts.push(`回应策略：${recommendation.responseStrategy}`);

  if (recommendation.needsRegulation) {
    parts.push(`⚠️ 用户情绪较强烈，需要适当引导但不要否定用户感受。`);
  }

  const strategyTips: Record<ResponseStrategy, string> = {
    mirror_intensity: '跟随用户情绪的强度来回应，让用户感到被理解。',
    soften: '温柔地回应，帮助用户舒缓情绪，但不要说"别难过"这种否定词。',
    amplify: '和用户一起放大正面情绪，让用户感到被共享喜悦。',
    redirect: '在承认用户感受的基础上，自然地引导到积极方向。',
    hold_space: '允许用户的情绪存在，不要急于解决问题，先陪伴。',
  };

  parts.push(`具体建议：${strategyTips[recommendation.responseStrategy]}`);

  return parts.join('\n');
}

/**
 * 构建近期用户情绪轨迹
 * @param snapshots 近期的用户情绪快照
 * @returns 情绪轨迹描述（可注入 prompt）
 */
export function buildEmotionTrajectory(
  snapshots: UserEmotionSnapshot[],
): string {
  if (snapshots.length === 0) return '';

  const recent = snapshots.slice(-5);
  const timeline = recent.map(s => {
    const timeAgo = Math.round((Date.now() - s.timestamp) / 60000);
    return `${s.emotion}(${s.intensity}%)-${timeAgo}分钟前`;
  });

  return `\n用户近期情绪轨迹：${timeline.join(' → ')}`;
}
