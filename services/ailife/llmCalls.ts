/**
 * ============================================================
 * AI 一日 · LLM 调用总控
 * 每个 LLM 调用点可独立开关 + 三档详细度；
 * 存储于 ai_life_config.extra.llmCalls（JSON），无需后端改动。
 *
 * 兼容旧 contentLevel 单开关：
 * 未做单独设置时，按 contentLevel 推导各项默认值。
 * ============================================================
 */
import type { AiLifeConfig } from '../../lib/tauriBridge';

export type LlmCallId =
  | 'schedule'      // 日程生成（个性化一日计划）
  | 'process'       // 活动过程描述
  | 'summary'       // 活动总结
  | 'diary'         // 日记撰写
  | 'emotionShift'  // 情绪转变决策（主动变卦）
  | 'proactive'     // 活动开始主动消息 / 睡醒带过
  | 'randomEvent'   // 随机事件 AI 化
  | 'ledgerReply'   // 记账（开销/财产）AI 回复
  | 'dailyBits';    // 每日三件小事（主动消息富素材预生成）

export type LlmDetail = 'concise' | 'standard' | 'detailed';

export interface LlmCallSetting {
  enabled: boolean;
  detail: LlmDetail;
}

export type LlmCallsMap = Partial<Record<LlmCallId, LlmCallSetting>>;

export const LLM_CALL_META: Record<LlmCallId, { label: string; desc: string }> = {
  schedule: { label: '日程生成', desc: '根据人设与世界包生成一天的生活计划' },
  process: { label: '活动过程', desc: '活动开始时写一段第一人称过程描述' },
  summary: { label: '活动总结', desc: '活动结束时一句话总结与感受' },
  diary: { label: '日记撰写', desc: '一天结束时回顾全天写日记' },
  emotionShift: { label: '情绪转变', desc: 'AI 回顾经历自主决定心情变化并调整计划' },
  proactive: { label: '主动消息', desc: '活动开始时概率性给用户发消息' },
  randomEvent: { label: 'AI 随机事件', desc: '开启后随机事件由 AI 按人设现编（默认本地事件池）' },
  ledgerReply: { label: '记账回复', desc: '记一笔开销或财产后 AI 的感想回复' },
  dailyBits: { label: '每日小事', desc: '每日预生成三件"今天身上的小事"，供主动消息空闲时取材（每天最多 1 次调用）' },
};

/** 按旧 contentLevel 推导默认设置 */
function deriveFromLevel(level: string | undefined): Record<LlmCallId, LlmCallSetting> {
  const std: LlmCallSetting = { enabled: true, detail: 'standard' };
  const off: LlmCallSetting = { enabled: false, detail: 'standard' };
  const allOn: Record<LlmCallId, LlmCallSetting> = {
    schedule: std, process: std, summary: std, diary: std,
    emotionShift: std, proactive: std, randomEvent: off, ledgerReply: std, dailyBits: std,
  };
  switch (level) {
    case 'off':
      return { schedule: off, process: off, summary: off, diary: off, emotionShift: off, proactive: off, randomEvent: off, ledgerReply: off, dailyBits: off };
    case 'minimal':
      return { ...allOn, process: off, summary: off, diary: off, emotionShift: off, proactive: off, dailyBits: off };
    case 'simplified':
      return { ...allOn, process: off };
    case 'full':
    default:
      return allOn;
  }
}

/** 读取某调用项的最终生效设置 */
export function getCallSetting(config: AiLifeConfig | null | undefined, id: LlmCallId): LlmCallSetting {
  const derived = deriveFromLevel(config?.contentLevel);
  const overrides = (config?.extra as { llmCalls?: LlmCallsMap } | undefined)?.llmCalls;
  const o = overrides?.[id];
  return {
    enabled: o?.enabled ?? derived[id].enabled,
    detail: o?.detail ?? derived[id].detail,
  };
}

/** 一键预设：返回写入 extra.llmCalls 的完整映射 */
export function presetCalls(level: string): LlmCallsMap {
  return deriveFromLevel(level);
}

/** 详细度 → token 上限系数 */
export function tokensFor(detail: LlmDetail, baseTokens: number): number {
  if (detail === 'concise') return Math.round(baseTokens * 0.6);
  if (detail === 'detailed') return Math.round(baseTokens * 1.7);
  return baseTokens;
}

/** 详细度 → 提示词约束片段（拼进 prompt） */
export function detailHint(detail: LlmDetail): string {
  switch (detail) {
    case 'concise': return '本次请写简短一些（一两句话以内）。';
    case 'detailed': return '本次可以写得更细致丰富，但不要啰嗦重复。';
    default: return '';
  }
}

/** 读取生活档案（职业/作息），extra.profile 缺失或类型不符时返回空对象 */
export function readLifeProfile(config: AiLifeConfig | null | undefined): { job?: string; routine?: string } {
  const p = (config?.extra as { profile?: unknown } | undefined)?.profile;
  return (p && typeof p === 'object' ? p : {}) as { job?: string; routine?: string };
}
