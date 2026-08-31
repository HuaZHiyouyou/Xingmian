/**
 * ============================================================
 * D1: 内容抽取记账与探索提权（防死数据）
 *  - 每个可抽取内容（活动名 / 随机事件名）记录 lastPickedAt、pickCount
 *  - 提权：超过 N 天未中 ×2（按未中天数翻倍，封顶 8×）；刚被抽中短期 ×0.5（防连抽重复）
 *  - 审计：getAuditSummary 汇总命中率，供 DebugLog 观测"量变是否兑现"
 *  存储在 localStorage（附属统计，失败静默不影响主流程）
 * ============================================================
 */

const STORAGE_KEY = 'aiLifePickStats:v1';
/** 多少天未被抽中开始提权 */
const STALE_DAYS = 3;
/** 刚被抽中的冷却小时数内降权 */
const RECENT_HOURS = 12;
/** 提权上限倍数 */
const MAX_BOOST = 8;

interface PickStat {
  lastPickedAt: number;
  pickCount: number;
}

type StatMap = Record<string, PickStat>;

function load(): StatMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StatMap;
  } catch { /* 损坏即重置 */ }
  return {};
}

function save(map: StatMap): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* 静默 */ }
}

/** 抽中内容后调用：记账 */
export function recordPick(key: string): void {
  if (!key) return;
  const map = load();
  map[key] = { lastPickedAt: Date.now(), pickCount: (map[key]?.pickCount || 0) + 1 };
  save(map);
}

/**
 * 探索提权因子：超 STALE_DAYS 天未中 → 每天 ×2 累进（封顶 MAX_BOOST）；
 * 近 RECENT_HOURS 小时刚被抽中 → ×0.5 冷却降权；其余 1.0。
 */
export function boostFactor(key: string): number {
  if (!key) return 1;
  const stat = load()[key];
  if (!stat) return 1.6; // 从未被抽中过的新条目给探索加成
  const elapsedH = (Date.now() - stat.lastPickedAt) / 3600000;
  if (elapsedH < RECENT_HOURS) return 0.5;
  const staleDays = Math.floor(elapsedH / 24);
  if (staleDays < STALE_DAYS) return 1;
  return Math.min(Math.pow(2, staleDays - STALE_DAYS + 1), MAX_BOOST);
}

/**
 * 消费审计摘要：给定候选 key 全集，统计从未命中与近 7 天命中率。
 * 供 DebugLog 输出——「500 条里多少从未命中」是量变是否兑现的仪表盘。
 */
export interface AuditSummary {
  totalKeys: number;
  everPicked: number;
  /** 抽取频次 topN */
  topPicks: Array<{ key: string; count: number }>;
}

export function getAuditSummary(candidateKeys: string[]): AuditSummary {
  const map = load();
  const stats = candidateKeys.map((k) => ({ key: k, count: map[k]?.pickCount || 0 }));
  return {
    totalKeys: candidateKeys.length,
    everPicked: stats.filter((s) => s.count > 0).length,
    topPicks: [...stats].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

/** 通用加权抽签（D1 权重注入用）：weights 与 items 等长；退化保护返回末项 */
export function weightedPick<T>(items: T[], weights: number[]): T | null {
  if (items.length === 0) return null;
  const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0.0001));
  const total = safeWeights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= safeWeights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** 种子随机版加权抽签（日程构建用 rng，保证同日稳定） */
export function seededWeightedPick<T>(rng: () => number, items: T[], weights: number[]): T | null {
  if (items.length === 0) return null;
  const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0.0001));
  const total = safeWeights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= safeWeights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
