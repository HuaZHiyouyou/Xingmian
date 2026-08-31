/**
 * 反语/隐语识别模块 (Sarcasm & Irony Detector)
 *
 * 识别用户的反话、阴阳怪气、假性轻松等隐语表达，
 * 帮助 AI 穿透表面语义，理解真实情绪。
 *
 * 设计原则：
 * - 规则层快速预判 + LLM 深度确认
 * - 输出真实情绪类型 + 置信度 + 识别依据
 * - 轻量级，不影响主流程性能
 */

// ============================================================
// 类型定义
// ============================================================

export interface SarcasmDetectionResult {
  /** 是否检测到反语/隐语 */
  detected: boolean;
  /** 反语类型 */
  type: SarcasmType | null;
  /** 置信度 (0-1) */
  confidence: number;
  /** 表面语义的极性 */
  surfacePolarity: 'positive' | 'negative' | 'neutral';
  /** 推测的真实情绪 */
  trueEmotion: string;
  /** 识别依据 */
  evidence: string[];
}

export type SarcasmType =
  | 'irony'          // 反话/反语：正面词语+否定语境
  | 'passive_aggressive' // 阴阳怪气：过度礼貌+夸张赞美
  | 'understatement' // 沉默暗示：短回复+无信息增量
  | 'fake_positive'  // 假性轻松：正面声明+过度修饰
  | 'self_deprecating' // 自嘲式幽默：负面自我评价伪装在幽默中
  | 'repeated_deniial' // 重复强调："真的没事"等
  | 'topic_avoidance'  // 转移话题：突然改变话题
  | 'conditional';     // 条件式表达：频繁"如果你愿意"等

// ============================================================
// 规则库
// ============================================================

/** 正面词语列表 */
const POSITIVE_WORDS = [
  '太好了', '真棒', '厉害', '优秀', '不错', '好', '完美', '精彩',
  '真好', '真厉害', '可以啊', '行啊', '真行', '真是', '哦', '嗯',
  'great', 'awesome', 'amazing', 'wonderful', 'perfect', 'nice', 'good',
];

/** 否定/讽刺后缀 */
const IRONY_MARKERS = [
  '呵呵', '哈', '吧', '呢', '哦', '嘛', '呗',
  '...(...)', '。。。', '…', '(微笑)', '(微笑表情)',
];

/** 自我贬低词语 */
const SELF_DEPRECATING_WORDS = [
  '废物', '没用', '不行', '差劲', '垃圾', '废物', '白痴', '蠢',
  '反正我', '我不配', '我这种人', '我知道我不',
  'useless', 'worthless', 'stupid', 'idiot',
];

/** 过度道歉/强调词 */
const OVER_APOLOGY_WORDS = [
  '真的对不起', '非常抱歉', '万分抱歉', '真的很对不起',
  '真的是我的错', '都怪我', '是我的问题',
  'really sorry', 'terribly sorry',
];

/** 冷淡礼貌词 */
const COLD_POLITE_WORDS = [
  '谢谢', '不用了', '没事', '没关系', '随便', '都行', '无所谓',
  '好的', '嗯', '哦', '知道了',
];

/** 条件式表达 */
const CONDITIONAL_PATTERNS = [
  '如果你愿意', '如果你想', '如果你觉得', '如果可以的话',
  '随便你', '看你', '看你方便', '你决定就好',
  'if you want', 'if you like', 'up to you',
];

/** 转移话题标记 */
const TOPIC_SHIFT_MARKERS = [
  '算了', '不说了', '不说这个了', '换个话题', '对了',
  '话说', '说起来', '诶你',
];

// ============================================================
// 检测引擎
// ============================================================

/**
 * 检测用户消息中的反语/隐语
 * @param message 用户原始消息
 * @param context 近期对话上下文（可选，用于检测沉默暗示）
 * @param messageHistory 近期消息列表（用于检测重复模式）
 */
export function detectSarcasm(
  message: string,
  context?: string[],
  _messageHistory?: string[],
): SarcasmDetectionResult {
  const results: Array<{ type: SarcasmType; confidence: number; evidence: string[] }> = [];

  // 1. 反话/反语检测
  const ironyResult = detectIrony(message);
  if (ironyResult.confidence > 0) results.push(ironyResult);

  // 2. 自嘲式幽默检测
  const selfDepResult = detectSelfDeprecation(message);
  if (selfDepResult.confidence > 0) results.push(selfDepResult);

  // 3. 重复强调检测
  const repeatResult = detectRepeatedDenial(message);
  if (repeatResult.confidence > 0) results.push(repeatResult);

  // 4. 条件式表达检测
  const condResult = detectConditional(message);
  if (condResult.confidence > 0) results.push(condResult);

  // 5. 转移话题检测
  const shiftResult = detectTopicShift(message, context);
  if (shiftResult.confidence > 0) results.push(shiftResult);

  // 6. 假性轻松检测
  const fakeResult = detectFakePositivity(message);
  if (fakeResult.confidence > 0) results.push(fakeResult);

  // 7. 冷淡暗示检测（结合短回复特征）
  const coldResult = detectColdUnderstatement(message);
  if (coldResult.confidence > 0) results.push(coldResult);

  // 取置信度最高的结果
  if (results.length === 0) {
    return { detected: false, type: null, confidence: 0, surfacePolarity: 'neutral', trueEmotion: '', evidence: [] };
  }

  results.sort((a, b) => b.confidence - a.confidence);
  const best = results[0];

  return {
    detected: true,
    type: best.type,
    confidence: best.confidence,
    surfacePolarity: getSurfacePolarity(message),
    trueEmotion: mapSarcasmTypeToEmotion(best.type),
    evidence: best.evidence,
  };
}

// ============================================================
// 子检测器
// ============================================================

function detectIrony(message: string): { type: SarcasmType; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  let confidence = 0;

  const hasPositiveWord = POSITIVE_WORDS.some(w => message.includes(w));
  const hasIronyMarker = IRONY_MARKERS.some(m => message.includes(m));
  const hasNegativeContext = message.includes('才') || message.includes('又')
    || message.includes('又不是') || message.includes('才不是')
    || message.includes('哪里') || message.includes('哪有');

  if (hasPositiveWord && hasIronyMarker) {
    confidence += 0.5;
    evidence.push('正面词语 + 讽刺后缀');
  }
  if (hasPositiveWord && hasNegativeContext) {
    confidence += 0.4;
    evidence.push('正面词语 + 否定句式');
  }
  if (hasIronyMarker && message.endsWith('...')) {
    confidence += 0.2;
    evidence.push('省略号结尾');
  }
  // 重复标点 = 高强度情绪
  if (/!{2,}|！{2,}|.{3,}/.test(message)) {
    confidence += 0.15;
    evidence.push('重复标点/省略号');
  }

  confidence = Math.min(confidence, 0.95);
  return { type: 'irony', confidence, evidence };
}

function detectSelfDeprecation(message: string): { type: SarcasmType; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  let confidence = 0;

  const hasSelfDepWord = SELF_DEPRECATING_WORDS.some(w => message.includes(w));

  if (hasSelfDepWord) {
    confidence += 0.4;
    evidence.push('自我贬低用语');
  }
  // 幽默标记（哈哈、笑、233等）包裹负面评价 = 自嘲
  const hasHumorMarker = /哈哈|笑死|233|lol|haha|😂|🤣|💀/.test(message);
  if (hasSelfDepWord && hasHumorMarker) {
    confidence += 0.35;
    evidence.push('幽默标记 + 负面自我评价');
  }
  // "反正"开头 = 习得性无助
  if (message.startsWith('反正') || message.startsWith('本来')) {
    confidence += 0.2;
    evidence.push('反正/本来 开头');
  }

  confidence = Math.min(confidence, 0.9);
  return { type: 'self_deprecating', confidence, evidence };
}

function detectRepeatedDenial(message: string): { type: SarcasmType; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  let confidence = 0;

  // "真的没事" / "真的很好"
  if (/真的(没事|很好|没关系|可以|没关系|OK)/.test(message)) {
    confidence += 0.5;
    evidence.push('否定词 + 强调词重复');
  }
  // "我很好" + "不用担心"
  if (message.includes('不用担心') || message.includes('不要担心')) {
    confidence += 0.3;
    evidence.push('安抚性否定');
  }
  // 简短回复 + 否定
  if (message.length < 10 && /没|不|无/.test(message)) {
    confidence += 0.2;
    evidence.push('简短否定回复');
  }

  confidence = Math.min(confidence, 0.85);
  return { type: 'repeated_deniial', confidence, evidence };
}

function detectConditional(message: string): { type: SarcasmType; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  let confidence = 0;

  const hasConditional = CONDITIONAL_PATTERNS.some(p => message.includes(p));
  if (hasConditional) {
    confidence += 0.6;
    evidence.push('条件式表达');
  }

  confidence = Math.min(confidence, 0.7);
  return { type: 'conditional', confidence, evidence };
}

function detectTopicShift(
  message: string,
  context?: string[],
): { type: SarcasmType; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  let confidence = 0;

  const hasShiftMarker = TOPIC_SHIFT_MARKERS.some(m => message.includes(m));
  if (hasShiftMarker) {
    confidence += 0.3;
    evidence.push('转移话题标记词');
  }

  // 如果上下文有明显话题，而消息突然转向 → 高概率回避
  if (context && context.length > 2 && hasShiftMarker) {
    confidence += 0.3;
    evidence.push('前文有话题 + 话题跳转');
  }

  // "算了" 是最典型的回避
  if (message.startsWith('算了') || message === '算了') {
    confidence += 0.3;
    evidence.push('算了 开头/全部');
  }

  confidence = Math.min(confidence, 0.85);
  return { type: 'topic_avoidance', confidence, evidence };
}

function detectFakePositivity(message: string): { type: SarcasmType; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  let confidence = 0;

  // "哈哈没事" / "我很好"
  const hasFakePhrase = /哈哈没事|我很好|不用担心|没事的|没关系/.test(message);
  if (hasFakePhrase) {
    confidence += 0.4;
    evidence.push('正面声明 + 安抚修饰');
  }
  // 多个感叹号 = 可能在掩饰
  if (/!{2,}|！{2,}/.test(message)) {
    confidence += 0.15;
    evidence.push('过度感叹号');
  }
  // 同时包含"哈哈"和否定 = 可能假装轻松
  if (/哈哈.*没事|哈哈.*好的|哈哈.*没关系/.test(message)) {
    confidence += 0.3;
    evidence.push('笑声 + 否定组合');
  }

  confidence = Math.min(confidence, 0.75);
  return { type: 'fake_positive', confidence, evidence };
}

function detectColdUnderstatement(message: string): { type: SarcasmType; confidence: number; evidence: string[] } {
  const evidence: string[] = [];
  let confidence = 0;

  const isShort = message.length <= 5;
  const hasSingleCold = COLD_POLITE_WORDS.some(w => message === w);

  // 极短回复（1-2字）
  if (isShort && message.length > 0) {
    confidence += 0.35;
    evidence.push('极短回复');
  }
  // 单个礼貌词
  if (hasSingleCold) {
    confidence += 0.3;
    evidence.push('单个礼貌词回复');
  }
  // "哦" 或 "嗯" 单独
  if (/^哦[。.！!]*$|^嗯[。.！!]*$|^哈[。.！!]*$/.test(message)) {
    confidence += 0.3;
    evidence.push('单字语气词回复');
  }

  confidence = Math.min(confidence, 0.7);
  return { type: 'understatement', confidence, evidence };
}

// ============================================================
// 辅助函数
// ============================================================

function getSurfacePolarity(message: string): 'positive' | 'negative' | 'neutral' {
  const posCount = POSITIVE_WORDS.filter(w => message.includes(w)).length;
  const negCount = SELF_DEPRECATING_WORDS.filter(w => message.includes(w)).length
    + OVER_APOLOGY_WORDS.filter(w => message.includes(w)).length;

  if (posCount > negCount) return 'positive';
  if (negCount > posCount) return 'negative';
  return 'neutral';
}

function mapSarcasmTypeToEmotion(type: SarcasmType): string {
  const map: Record<SarcasmType, string> = {
    irony: 'anger',
    passive_aggressive: 'disgust',
    understatement: 'loneliness',
    fake_positive: 'anxiety',
    self_deprecating: 'sadness',
    repeated_deniial: 'disappointment',
    topic_avoidance: 'anxiety',
    conditional: 'loneliness',
  };
  return map[type];
}

// ============================================================
// 混淆信号检测（表面正面 + 实际负面 的矛盾分析）
// ============================================================

/**
 * 检测文本中的语义矛盾信号
 * 用于在 LLM 之前做快速预判
 */
export function detectSemanticContradiction(message: string): {
  hasContradiction: boolean;
  contradictionType: string | null;
  realSentiment: 'positive' | 'negative';
} {
  // 模式1：正面词 + 否定词组合
  const hasPositive = POSITIVE_WORDS.some(w => message.includes(w));
  const hasNegation = /不|没|别|才|又|哪|哪有|才不是/.test(message);

  if (hasPositive && hasNegation) {
    return {
      hasContradiction: true,
      contradictionType: '正面词+否定句式',
      realSentiment: 'negative',
    };
  }

  // 模式2：过度礼貌 + 简短
  if (message.length < 8 && /谢谢|感谢|麻烦/.test(message)) {
    return {
      hasContradiction: true,
      contradictionType: '过度礼貌+简短',
      realSentiment: 'negative',
    };
  }

  return { hasContradiction: false, contradictionType: null, realSentiment: 'positive' };
}
