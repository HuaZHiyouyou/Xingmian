/**
 * ============================================================
 * 情绪基线（B5.2）
 * 每日生活事件加权情绪净值 → 线性映射为好感度增量系数（0.5~1.2）：
 *   低落日 ×0.5 ~ 开心日 ×1.2（默认 1.0）。
 * 出口：① 好感度计算链（Rust 乘入）；② 生活生成上下文（moodLine 注释）。
 * 缓存 1 小时，避免每次消息都扫事件表。
 * ============================================================
 */
import { dbGetAiLifeEvents } from '../../lib/tauriBridge';

/** 事件类型 → 情绪净值权重（正=开心，负=低落） */
const EVENT_MOOD_WEIGHT: Record<string, number> = {
  milestone: 3,
  purchase: 1,
  income: 2,
  meal: 0.5,
  drink: 0.2,
  random_event: 0.5,
  plan_change: 0,
  consume: -0.5,
  fallback: -1.5,
};

const cache = new Map<string, { factor: number; ts: number }>();
const CACHE_TTL = 3600_000;

/** 计算情绪基线系数（0.5 ~ 1.2，默认 1.0） */
export async function getEmotionBaselineFactor(characterId: string): Promise<number> {
  if (!characterId) return 1.0;
  const cached = cache.get(characterId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.factor;

  try {
    // 近 24h 的生活事件
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 86400_000).toISOString();
    const events = await dbGetAiLifeEvents(characterId, from, to, 100);

    let net = 0;
    for (const e of events) {
      net += EVENT_MOOD_WEIGHT[e.type] ?? 0;
    }
    // 归一化：net ±10 → -1..1，再线性映射 0.5~1.2
    const normalized = Math.max(-1, Math.min(1, net / 10));
    // 映射：-1 → 0.5，0 → 0.85，+1 → 1.2（偏低区更敏感，模拟"情绪低落日更难升温"）
    const factor = normalized >= 0
      ? 0.85 + normalized * 0.35
      : 0.85 + normalized * 0.35;

    const clamped = Math.max(0.5, Math.min(1.2, Math.round(factor * 100) / 100));
    cache.set(characterId, { factor: clamped, ts: Date.now() });
    return clamped;
  } catch {
    return 1.0;
  }
}

/** 人话描述（日志用） */
export function describeBaselineFactor(f: number): string {
  if (f >= 1.1) return '开心日';
  if (f >= 0.95) return '平常日';
  if (f >= 0.75) return '有点低落';
  return '低落日';
}
