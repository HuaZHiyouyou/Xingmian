/**
 * ============================================================
 * 情绪状态管理器 V2
 * 参考: docs/upgrade-plans/01-emotion-system-upgrade.md
 * 支持: 主动代谢、情绪惯性、三维渲染、衰减规则
 * ============================================================
 */

import { EmotionType, MultiEmotionState } from '../../types';
import { getDominantEmotion } from '../../utils/emotionAnalyzer';
import { EmotionMetabolism } from './thoughtChainParser';

// ---------- 情绪代谢规则 ----------

export interface DecayRule {
  /** 情绪类型 */
  emotion: EmotionType;
  /** 自然衰减速率（每分钟衰减值，0~1） */
  decayRate: number;
  /** 最小保留值（不会衰减到此值以下） */
  floor: number;
  /** 半衰期（分钟） */
  halfLifeMinutes: number;
}

/**
 * 各情绪的衰减规则
 * - 即时情绪（如 surprise）衰减快
 * - 稳定情绪（如 trust）衰减慢
 */
const DEFAULT_DECAY_RULES: Record<EmotionType, DecayRule> = {
  joy: { emotion: 'joy', decayRate: 0.015, floor: 3, halfLifeMinutes: 45 },
  trust: { emotion: 'trust', decayRate: 0.005, floor: 10, halfLifeMinutes: 120 },
  fear: { emotion: 'fear', decayRate: 0.018, floor: 1, halfLifeMinutes: 30 },
  surprise: { emotion: 'surprise', decayRate: 0.03, floor: 0, halfLifeMinutes: 20 },
  sadness: { emotion: 'sadness', decayRate: 0.012, floor: 2, halfLifeMinutes: 60 },
  disgust: { emotion: 'disgust', decayRate: 0.015, floor: 1, halfLifeMinutes: 45 },
  anger: { emotion: 'anger', decayRate: 0.02, floor: 1, halfLifeMinutes: 30 },
  anticipation: { emotion: 'anticipation', decayRate: 0.01, floor: 5, halfLifeMinutes: 90 },
  pride: { emotion: 'pride', decayRate: 0.015, floor: 3, halfLifeMinutes: 45 },
  guilt: { emotion: 'guilt', decayRate: 0.012, floor: 2, halfLifeMinutes: 60 },
  embarrassment: { emotion: 'embarrassment', decayRate: 0.025, floor: 0, halfLifeMinutes: 30 },
  jealousy: { emotion: 'jealousy', decayRate: 0.015, floor: 1, halfLifeMinutes: 50 },
  curiosity: { emotion: 'curiosity', decayRate: 0.012, floor: 1, halfLifeMinutes: 45 },
  love: { emotion: 'love', decayRate: 0.009, floor: 4, halfLifeMinutes: 75 },
  gratitude: { emotion: 'gratitude', decayRate: 0.008, floor: 3, halfLifeMinutes: 90 },
  empathy: { emotion: 'empathy', decayRate: 0.012, floor: 2, halfLifeMinutes: 60 },
  anxiety: { emotion: 'anxiety', decayRate: 0.016, floor: 1, halfLifeMinutes: 50 },
  loneliness: { emotion: 'loneliness', decayRate: 0.010, floor: 2, halfLifeMinutes: 90 },
  disappointment: { emotion: 'disappointment', decayRate: 0.014, floor: 2, halfLifeMinutes: 60 },
};

// ---------- 情绪更新参数 ----------

export interface EmotionUpdateParams {
  /** 触发情绪 */
  newEmotion: EmotionType;
  /** 触发强度 */
  intensity: number;
  /** 触发文本（用于代谢推理） */
  triggerText?: string;
  /** 当前思维链输出的代谢建议 */
  metabolisms?: EmotionMetabolism[];
  /** 是否启用主动代谢 */
  enableMetabolism?: boolean;
  /** 衰减倍率 */
  decayMultiplier?: number;
}

// ---------- 情绪极性分类 ----------

const POSITIVE_EMOTIONS: EmotionType[] = [
  'joy', 'trust', 'anticipation', 'pride', 'gratitude', 'love',
];

const NEGATIVE_EMOTIONS: EmotionType[] = [
  'sadness', 'anger', 'fear', 'disgust', 'guilt', 'embarrassment',
  'jealousy', 'anxiety', 'loneliness', 'disappointment',
];

function getEmotionPolarity(emotion: EmotionType): 'positive' | 'negative' | 'neutral' {
  if (POSITIVE_EMOTIONS.includes(emotion)) return 'positive';
  if (NEGATIVE_EMOTIONS.includes(emotion)) return 'negative';
  return 'neutral';
}

// ---------- 状态管理器 ----------

export class EmotionStateManager {
  private decayRules: Record<EmotionType, DecayRule>;

  constructor(customRules?: Partial<Record<EmotionType, Partial<DecayRule>>>) {
    this.decayRules = { ...DEFAULT_DECAY_RULES };
    if (customRules) {
      for (const [emotion, rule] of Object.entries(customRules)) {
        if (this.decayRules[emotion as EmotionType]) {
          this.decayRules[emotion as EmotionType] = {
            ...this.decayRules[emotion as EmotionType],
            ...rule,
          };
        }
      }
    }
  }

  /**
   * update - 更新情绪状态（含惯性混合、主动代谢、时间衰减、趋势检测）
   */
  update(state: MultiEmotionState, params: EmotionUpdateParams): MultiEmotionState {
    const now = Date.now();
    const elapsed = (now - state.lastUpdated) / 60000; // 转换为分钟
    const decayMult = params.decayMultiplier ?? 1;

    // 1. 时间衰减
    const decayed = this.applyDecay(state.values, elapsed, decayMult);

    // 2. 情绪趋势检测 + 智能混合
    const mixed = this.smartBlend(decayed, params.newEmotion, params.intensity, state.history || []);

    // 3. 主动代谢（来自思维链输出）- 仅当启用时
    const metabolized = params.enableMetabolism !== false
      ? this.applyMetabolisms(mixed, params.metabolisms || [])
      : mixed;

    // 4. 裁剪到 0~100 范围
    const clamped = this.clamp(metabolized);

    // 5. 更新历史（保留最近 20 个快照）
    const history = state.history || [];
    history.push({ ts: now, snapshot: { ...clamped } });
    if (history.length > 20) history.shift();

    return {
      values: clamped,
      lastUpdated: now,
      interactions: state.interactions + 1,
      history,
    };
  }

  /**
   * applyDecay - 时间衰减：所有情绪随着时间向 floor 方向衰减
   */
  private applyDecay(
    values: Partial<Record<EmotionType, number>>,
    elapsedMinutes: number,
    multiplier: number = 1
  ): Partial<Record<EmotionType, number>> {
    const result: Partial<Record<EmotionType, number>> = {};

    for (const [emotion, value] of Object.entries(values)) {
      const rule = this.decayRules[emotion as EmotionType];
      if (!rule || !value) {
        if (value) result[emotion as EmotionType] = value;
        continue;
      }

      // 使用指数衰减公式: value * e^(-λ*t)
      // 其中 λ = ln(2) / halfLifeMinutes
      // multiplier 调整衰减速度：>1 衰减更快，<1 衰减更慢
      const lambda = Math.log(2) / rule.halfLifeMinutes * multiplier;
      let newValue = value * Math.exp(-lambda * elapsedMinutes);

      // 确保不低于 floor
      newValue = Math.max(rule.floor, newValue);

      // 四舍五入到 1 位小数
      result[emotion as EmotionType] = Math.round(newValue * 10) / 10;
    }

    return result;
  }

  /**
   * smartBlend - 智能情绪混合：感知→判断→转变的三阶段逻辑
   * 
   * 逻辑：
   * 1. 感知用户情绪极性（正面/负面）
   * 2. 判断当前主导情绪极性
   * 3. 根据趋势决定混合强度：
   *    - 同向（都是正面/都是负面）：正常混合，甚至加强
   *    - 反向转折（负面→正面）：
   *      - 首次出现正面：假好转，只轻微增加正面，负面保持
   *      - 连续出现正面（2次以上）：真转变，正常混合
   *    - 反向转折（正面→负面）：快速响应（更容易被带坏心情）
   */
  private smartBlend(
    existing: Partial<Record<EmotionType, number>>,
    newEmotion: EmotionType,
    intensity: number,
    history: { ts: number; snapshot: Partial<Record<EmotionType, number>> }[]
  ): Partial<Record<EmotionType, number>> {
    const result = { ...existing };

    const newPolarity = getEmotionPolarity(newEmotion);
    const { type: dominantType, intensity: dominantIntensity } = this.getDominantFromValues(existing);
    const currentPolarity = getEmotionPolarity(dominantType);

    const targetValue = Math.min(100, intensity * 1.5);
    const currentValue = result[newEmotion] || 0;

    let blendWeight = 0.4; // 默认混合权重

    // 情况 1: 中性状态 → 正常混合
    if (currentPolarity === 'neutral' || dominantIntensity < 15) {
      blendWeight = 0.5;
    }
    // 情况 2: 同向情绪（都是正面或都是负面）→ 加强混合
    else if (newPolarity !== 'neutral' && newPolarity === currentPolarity) {
      blendWeight = 0.5; // 同向加强
      // 如果强度在增加，额外加强
      if (intensity > dominantIntensity * 0.6) {
        blendWeight = 0.55;
      }
    }
    // 情况 3: 负面 → 正面转折（用户从悲伤变开心）
    else if (currentPolarity === 'negative' && newPolarity === 'positive') {
      // 检测历史中正面情绪出现的次数（最近 5 次）
      const recentHistory = history.slice(-5);
      let positiveStreak = 0;
      
      // 从最近的往前数，连续出现正面情绪的次数
      for (let i = recentHistory.length - 1; i >= 0; i--) {
        const snap = recentHistory[i].snapshot;
        const snapDominant = this.getDominantFromValues(snap);
        if (getEmotionPolarity(snapDominant.type) === 'positive' && snapDominant.intensity > 10) {
          positiveStreak++;
        } else {
          break;
        }
      }

      if (positiveStreak === 0) {
        // 第一次出现正面：假好转，只轻微增加正面，负面保持
        blendWeight = 0.15;
      } else if (positiveStreak === 1) {
        // 第二次出现：开始有点相信了
        blendWeight = 0.25;
      } else if (positiveStreak >= 2) {
        // 连续 3 次以上：真的转变了
        blendWeight = 0.4;
      }
    }
    // 情况 4: 正面 → 负面转折（用户从开心变难过）
    else if (currentPolarity === 'positive' && newPolarity === 'negative') {
      // 更容易被带坏心情，响应更快
      blendWeight = 0.45;
    }

    const blended = currentValue * (1 - blendWeight) + targetValue * blendWeight;
    result[newEmotion] = Math.round(blended * 10) / 10;

    return result;
  }

  /**
   * getDominantFromValues - 从情绪值中获取主导情绪
   */
  private getDominantFromValues(values: Partial<Record<EmotionType, number>>): { type: EmotionType; intensity: number } {
    let maxEmotion: EmotionType | null = null;
    let maxVal = 0;
    
    for (const [emotion, val] of Object.entries(values)) {
      if (val && val > maxVal) {
        maxVal = val;
        maxEmotion = emotion as EmotionType;
      }
    }
    
    if (!maxEmotion || maxVal <= 0) {
      return { type: 'joy', intensity: 0 };
    }
    
    return { type: maxEmotion, intensity: Math.round(maxVal) };
  }

  /**
   * applyMetabolisms - 应用主动代谢：来自思维链的情绪调整
   * 如 sadness:-10 → 把 sadness 减少 10
   */
  private applyMetabolisms(
    values: Partial<Record<EmotionType, number>>,
    metabolisms: EmotionMetabolism[]
  ): Partial<Record<EmotionType, number>> {
    if (metabolisms.length === 0) return values;

    const result = { ...values };

    for (const m of metabolisms) {
      const emotion = m.emotion as EmotionType;
      if (!DEFAULT_DECAY_RULES[emotion]) continue;

      const current = result[emotion] || 0;
      const updated = Math.max(0, current + m.delta);
      result[emotion] = Math.round(updated * 10) / 10;
    }

    return result;
  }

  /**
   * clamp - 确保所有值在 0~100
   */
  private clamp(values: Partial<Record<EmotionType, number>>): Partial<Record<EmotionType, number>> {
    const result: Partial<Record<EmotionType, number>> = {};
    for (const [emotion, val] of Object.entries(values)) {
      result[emotion as EmotionType] = Math.max(0, Math.min(100, val));
    }
    return result;
  }

  /**
   * applyCognitiveUpdate - 认知管道更新
   *
   * 核心逻辑：将 Rust 返回的绝对值视为目标值，通过加权混合更新情绪状态
   * - 目标值混合：当前值 × (1 - weight) + 目标值 × weight
   * - 混合权重根据当前值与目标值的差距动态调整
   * - 未提及维度：轻微衰减（8%），保留情绪惯性
   */
  applyCognitiveUpdate(
    state: MultiEmotionState,
    emotionUpdate: Record<string, number>,
    options: { skipDecay?: boolean } = {},
  ): MultiEmotionState {
    const now = Date.now();

    // 1. 基础时间衰减（Rust 管道已经做过衰减和 blend 时可选跳过，避免双重衰减）
    const baseValues = options.skipDecay
      ? { ...state.values }
      : this.applyDecay(state.values, (now - state.lastUpdated) / 60000, 1);

    // 2. 目标值混合：将 Rust 返回值视为目标，加权融合
    const result = { ...baseValues };
    const updatedEmotions = new Set<string>();

    for (const [emotion, targetVal] of Object.entries(emotionUpdate)) {
      if (targetVal == null) continue;
      if (!DEFAULT_DECAY_RULES[emotion as EmotionType]) continue;
      updatedEmotions.add(emotion);

      const current = result[emotion as EmotionType] || 0;
      const gap = Math.abs(targetVal - current);

      // 动态混合权重：差距越大，越倾向于目标值
      // 差距 < 3: weight=0.4（缓慢接近）
      // 差距 3~8: weight=0.6（中等速度）
      // 差距 > 8: weight=0.75（快速响应）
      let weight = gap < 3 ? 0.4 : gap < 8 ? 0.6 : 0.75;

      // 如果目标值比当前值低（情绪回落），混合更积极（更容易下降）
      if (targetVal < current) {
        weight = Math.min(weight + 0.15, 0.85);
      }

      const blended = current * (1 - weight) + targetVal * weight;
      const delta = blended - current;
      const clampedDelta = Math.max(-5, Math.min(5, delta));
      result[emotion as EmotionType] = Math.max(0, Math.min(100, Math.round(current + clampedDelta)));
    }

    // 3. 未在本次更新中提及的维度：轻微衰减 8%（保留情绪惯性，防止快速趋零）
    for (const [emotion, val] of Object.entries(result)) {
      if (val == null || val <= 0) continue;
      if (!DEFAULT_DECAY_RULES[emotion as EmotionType]) continue;
      if (updatedEmotions.has(emotion)) continue;
      const rule = this.decayRules[emotion as EmotionType];
      const floor = rule?.floor ?? 0;
      result[emotion as EmotionType] = Math.max(floor, Math.round(val * 0.92));
    }

    // 4. 裁剪到 0~100
    const clamped = this.clamp(result as Partial<Record<EmotionType, number>>);

    // 5. 更新历史
    const history = state.history || [];
    history.push({ ts: now, snapshot: { ...clamped } });
    if (history.length > 20) history.shift();

    return {
      values: clamped as Partial<Record<EmotionType, number>>,
      lastUpdated: now,
      interactions: state.interactions + 1,
      history,
    };
  }

  /**
   * applyRustCognitiveUpdate - 直接应用 Rust 认知管道返回的最终情绪值
   *
   * Rust 后端已完成：时间衰减、增量硬裁剪(±5)。
   * 前端这里只做直接写入与 0~100 裁剪，避免二次混合导致变化幅度被压缩。
   * V2: activeMetabolism 控制是否对未更新维度做 8% 惯性衰减，与 Rust 侧保持一致。
   */
  applyRustCognitiveUpdate(
    state: MultiEmotionState,
    emotionUpdate: Record<string, number>,
    activeMetabolism: boolean = true,
  ): MultiEmotionState {
    const now = Date.now();
    const result: Partial<Record<EmotionType, number>> = { ...state.values };
    const updatedEmotions = new Set<string>();

    // 直接写入 Rust 计算后的最终值
    for (const [emotion, val] of Object.entries(emotionUpdate)) {
      if (val == null) continue;
      if (!DEFAULT_DECAY_RULES[emotion as EmotionType]) continue;
      updatedEmotions.add(emotion);
      result[emotion as EmotionType] = Math.max(0, Math.min(100, Math.round(val)));
    }

    // V2: 未在本次更新中提及的维度：仅在 activeMetabolism 开启时做 8% 惯性衰减
    if (activeMetabolism) {
      for (const [emotion, val] of Object.entries(result)) {
        if (val == null || val <= 0) continue;
        if (!DEFAULT_DECAY_RULES[emotion as EmotionType]) continue;
        if (updatedEmotions.has(emotion)) continue;
        const rule = this.decayRules[emotion as EmotionType];
        const floor = rule?.floor ?? 0;
        result[emotion as EmotionType] = Math.max(floor, Math.round(val * 0.92));
      }
    }

    const clamped = this.clamp(result);

    const history = state.history || [];
    history.push({ ts: now, snapshot: { ...clamped } });
    if (history.length > 20) history.shift();

    return {
      values: clamped as Partial<Record<EmotionType, number>>,
      lastUpdated: now,
      interactions: state.interactions + 1,
      history,
    };
  }

  /**
   * getDominant - 获取主导情绪（委托给 emotionAnalyzer.getDominantEmotion）
   */
  getDominant(state: MultiEmotionState): { type: EmotionType; intensity: number } {
    return getDominantEmotion(state);
  }
}

// ---------- 单例 ----------

let defaultInstance: EmotionStateManager | null = null;

export function getEmotionStateManager(): EmotionStateManager {
  if (!defaultInstance) {
    defaultInstance = new EmotionStateManager();
  }
  return defaultInstance;
}
