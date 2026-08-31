/**
 * ============================================================
 * 数据覆盖桥（DataOverride Bridge）
 * 把功能模块的 DataOverrideConfig 真正接入算法管道：
 *  - 好感度增长倍率 / 单次增量上限 / 直接锁定
 *  - 情绪衰减倍率覆盖 / 12 维情绪锁定 / 跃迁敏感度
 *  - 记忆重要度权重 / 衰减速率
 *  - 定时任务产生的临时 prompt 注入队列（custom_prompt / run_skill）
 * 所有接入点统一从这里取"生效值"，未启用覆盖时透传默认行为。
 * ============================================================
 */
import { useFeatureModuleStore } from '../store/featureModuleStore';
import type { MultiEmotionState } from '../types';
import { useConfigStore } from '../store/configStore';

/** 覆盖总开关是否开启 */
export function isDataOverrideEnabled(): boolean {
  return useFeatureModuleStore.getState().dataOverride.enabled;
}

/** 🆕 B4 性格决策参数：总开关关闭时透传默认值 0.5（沿用现有桥函数模式） */
export function getPersonalityFactor(): { selfDiscipline: number; frugality: number; actionDrive: number } {
  const ov = useFeatureModuleStore.getState().dataOverride;
  const p = ov.personality;
  if (!ov.enabled || !p) {
    return { selfDiscipline: 0.5, frugality: 0.5, actionDrive: 0.5 };
  }
  const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0.5));
  return {
    selfDiscipline: clamp01(p.selfDiscipline),
    frugality: clamp01(p.frugality),
    actionDrive: clamp01(p.actionDrive),
  };
}

/**
 * 好感度增量覆盖：应用增长倍率与单次上限。
 * 在 characterMindStore.updateAffinity 入口调用。
 */
export function applyAffinityDelta(delta: number): number {
  const ov = useFeatureModuleStore.getState().dataOverride;
  if (!ov.enabled) return delta;
  let out = delta * (ov.affinityGrowthRate || 1);
  if (ov.affinitySingleMax > 0) {
    if (out > ov.affinitySingleMax) out = ov.affinitySingleMax;
    if (out < -ov.affinitySingleMax) out = -ov.affinitySingleMax;
  }
  return out;
}

/**
 * 好感度直接锁定值：返回 null 表示未锁定。
 * affinityLevelLocked 区分"用户设为 0 锁定"与"从未设定"。
 */
export function getAffinityLockValue(): number | null {
  const ov = useFeatureModuleStore.getState().dataOverride;
  if (!ov.enabled || !ov.affinityLevelLocked) return null;
  return Math.max(-100, Math.min(100, ov.affinityLevel));
}

/**
 * 生效的情绪自然衰减倍率：覆盖关闭时回落到 v2Config 默认值。
 * 替代原先直接读 v2Config.decayMultiplier 的位置。
 */
export function getEffectiveEmotionDecayMultiplier(fallback?: number): number {
  const ov = useFeatureModuleStore.getState().dataOverride;
  if (!ov.enabled) return fallback ?? useConfigStore.getState().v2Config.decayMultiplier;
  return ov.emotionDecayMultiplier;
}

/**
 * 情绪跃迁敏感度缩放系数：50 = 1.0x，越敏感情绪变化幅度越大。
 * 用于缩放情绪更新时的强度增量。
 */
export function getEmotionSensitivityFactor(): number {
  const ov = useFeatureModuleStore.getState().dataOverride;
  if (!ov.enabled) return 1;
  const s = ov.emotionSensitivity;
  if (!s || s <= 0) return 0; // 0 = 情绪冻结
  return s / 50;
}

/**
 * 12 维情绪直接锁定：启用后用设定值覆盖 AI 实时情绪的对应维度。
 * 在 setMultiEmotion 入口调用，空设定 = 不锁定该维度。
 */
export function applyEmotionValueOverrides(state: MultiEmotionState): MultiEmotionState {
  const ov = useFeatureModuleStore.getState().dataOverride;
  if (!ov.enabled) return state;
  const keys = Object.keys(ov.emotionValues || {});
  if (keys.length === 0) return state;
  const values = { ...state.values };
  for (const k of keys) {
    const v = ov.emotionValues[k as keyof typeof ov.emotionValues];
    if (typeof v === 'number') values[k as keyof typeof values] = v;
  }
  return { ...state, values };
}

/** 记忆检索/遗忘的重要度权重（默认 1.0） */
export function getMemoryImportanceWeight(): number {
  const ov = useFeatureModuleStore.getState().dataOverride;
  if (!ov.enabled) return 1;
  return ov.memoryImportanceWeight > 0 ? ov.memoryImportanceWeight : 1;
}

/** 记忆遗忘曲线衰减速率（默认 1.0，>1 忘得更快） */
export function getMemoryDecayRate(): number {
  const ov = useFeatureModuleStore.getState().dataOverride;
  if (!ov.enabled) return 1;
  return ov.memoryDecayRate > 0 ? ov.memoryDecayRate : 1;
}

// ---------------- 定时任务 prompt 注入队列 ----------------
// custom_prompt / run_skill 任务触发时把 prompt 放入队列，
// 下一次 sendMessage 组装 systemPrompt 时消费。不持久化（重启丢失可接受）。

let pendingPromptQueue: string[] = [];

/** 定时任务投递一条待注入 prompt */
export function pushPendingPrompt(prompt: string, label?: string): void {
  const text = prompt?.trim();
  if (!text) return;
  pendingPromptQueue.push(label ? `【${label}】\n${text}` : text);
}

/** 取走全部待注入 prompt（消费即清空） */
export function takePendingPrompts(): string[] {
  if (pendingPromptQueue.length === 0) return [];
  const out = pendingPromptQueue;
  pendingPromptQueue = [];
  return out;
}
