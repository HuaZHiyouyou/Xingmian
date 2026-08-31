/**
 * ============================================================
 * C2: 正交标签体系与加权抽签（量变引起质变的调度基础）
 *  - 休闲消遣候选池带 ≤6 维正交标签（sociality/cost/mood/energy）
 *  - pickWeightedLeisure: 适用域过滤 → 状态加权 → 抽签
 *    · 心情低落 → healing 提权
 *    · 能量/体力低 → low energy 提权
 *    · 余额紧张 → free/low cost 提权
 *  - 已购耐用品解锁的活动（C3 unlocks）自动进入高权重池——买吉他→解锁"练吉他"
 *  - LLM 降级为渲染器：纯模板照跑，本地可玩性不依赖 API
 * ============================================================
 */
import { boostFactor, recordPick, seededWeightedPick } from './pickStats';

export type SocialityTag = 'solo' | 'casual' | 'close';
export type CostTag = 'free' | 'low' | 'mid' | 'high';
export type MoodTag = 'healing' | 'calm' | 'excited' | 'melancholy' | 'tense';
export type EnergyTag = 'low' | 'mid' | 'high';

export interface TaggedActivity {
  name: string;
  category: 'leisure' | 'social';
  scene: string;
  sociality: SocialityTag;
  cost: CostTag;
  mood: MoodTag;
  energy: EnergyTag;
}

/** 内置休闲/社交活动池（正交标签） */
export const LEISURE_POOL: TaggedActivity[] = [
  // —— healing 治愈向 ——
  { name: '听着雨声小睡', category: 'leisure', scene: '客厅', sociality: 'solo', cost: 'free', mood: 'healing', energy: 'low' },
  { name: '泡一杯热茶看云', category: 'leisure', scene: '阳台', sociality: 'solo', cost: 'free', mood: 'healing', energy: 'low' },
  { name: '给绿植浇水修叶', category: 'leisure', scene: '阳台', sociality: 'solo', cost: 'free', mood: 'healing', energy: 'low' },
  { name: '出门散步晒太阳', category: 'leisure', scene: '公园', sociality: 'solo', cost: 'free', mood: 'healing', energy: 'mid' },
  { name: '泡个热水澡放松', category: 'leisure', scene: '浴室', sociality: 'solo', cost: 'low', mood: 'healing', energy: 'low' },
  { name: '撸猫时刻', category: 'leisure', scene: '家', sociality: 'solo', cost: 'free', mood: 'healing', energy: 'low' },
  // —— calm 安静向 ——
  { name: '读书', category: 'leisure', scene: '书房', sociality: 'solo', cost: 'free', mood: 'calm', energy: 'low' },
  { name: '写日记', category: 'leisure', scene: '书桌', sociality: 'solo', cost: 'free', mood: 'calm', energy: 'low' },
  { name: '听歌', category: 'leisure', scene: '房间', sociality: 'solo', cost: 'free', mood: 'calm', energy: 'low' },
  { name: '练习书法', category: 'leisure', scene: '书房', sociality: 'solo', cost: 'low', mood: 'calm', energy: 'mid' },
  { name: '拼图', category: 'leisure', scene: '客厅', sociality: 'solo', cost: 'free', mood: 'calm', energy: 'mid' },
  { name: '整理房间', category: 'leisure', scene: '家', sociality: 'solo', cost: 'free', mood: 'calm', energy: 'mid' },
  // —— excited 兴奋向 ——
  { name: '打游戏', category: 'leisure', scene: '电脑前', sociality: 'casual', cost: 'free', mood: 'excited', energy: 'mid' },
  { name: '看电影', category: 'leisure', scene: '影院', sociality: 'casual', cost: 'mid', mood: 'excited', energy: 'mid' },
  { name: '逛街购物', category: 'social', scene: '商场', sociality: 'casual', cost: 'high', mood: 'excited', energy: 'mid' },
  { name: '运动锻炼', category: 'leisure', scene: '健身房', sociality: 'solo', cost: 'low', mood: 'excited', energy: 'high' },
  { name: '去KTV唱歌', category: 'social', scene: 'KTV', sociality: 'close', cost: 'mid', mood: 'excited', energy: 'high' },
  { name: '游乐园一日', category: 'social', scene: '游乐园', sociality: 'close', cost: 'high', mood: 'excited', energy: 'high' },
  // —— melancholy 感性向 ——
  { name: '翻老相册', category: 'leisure', scene: '房间', sociality: 'solo', cost: 'free', mood: 'melancholy', energy: 'low' },
  { name: '写点东西发呆', category: 'leisure', scene: '窗边', sociality: 'solo', cost: 'free', mood: 'melancholy', energy: 'low' },
  { name: '雨天听慢歌', category: 'leisure', scene: '房间', sociality: 'solo', cost: 'free', mood: 'melancholy', energy: 'low' },
  { name: '深夜看星星', category: 'leisure', scene: '天台', sociality: 'solo', cost: 'free', mood: 'melancholy', energy: 'low' },
  // —— tense 缓压向 ——
  { name: '打枕头发泄一下', category: 'leisure', scene: '卧室', sociality: 'solo', cost: 'free', mood: 'tense', energy: 'mid' },
  { name: '洗把脸冷静冷静', category: 'leisure', scene: '卫生间', sociality: 'solo', cost: 'free', mood: 'tense', energy: 'low' },
  { name: '大扫除转移注意力', category: 'leisure', scene: '家', sociality: 'solo', cost: 'free', mood: 'tense', energy: 'high' },
  // —— 社交向 ——
  { name: '和朋友视频聊天', category: 'social', scene: '房间', sociality: 'close', cost: 'free', mood: 'excited', energy: 'mid' },
  { name: '约闺蜜下午茶', category: 'social', scene: '咖啡店', sociality: 'close', cost: 'mid', mood: 'healing', energy: 'mid' },
  { name: '参加同好聚会', category: 'social', scene: '活动室', sociality: 'casual', cost: 'low', mood: 'excited', energy: 'mid' },
  { name: '陪家人吃饭', category: 'social', scene: '餐厅', sociality: 'close', cost: 'mid', mood: 'healing', energy: 'low' },
];

/** 主导情绪类型 → 加权映射（报告 C2：心情低→healing 提权等三档系数） */
const EMOTION_MOOD_BOOST: Record<string, Partial<Record<MoodTag, number>>> = {
  sadness: { healing: 2.0, melancholy: 1.4, calm: 1.3 },
  loneliness: { healing: 2.0, calm: 1.3 },
  anger: { tense: 1.5, excited: 1.6 },
  fear: { healing: 1.5, calm: 1.4 },
  joy: { excited: 1.8, calm: 1.1 },
  love: { excited: 1.5, healing: 1.3 },
  anticipation: { excited: 1.4, calm: 1.2 },
};

/** 余额水平（0~100 归一化比例，由调用方算好传入）→ cost 加权系数表 */
function costBoost(balanceTightness: number): Partial<Record<CostTag, number>> {
  if (balanceTightness >= 0.9) return { free: 2.2, low: 1.6, mid: 0.7, high: 0.25 };
  if (balanceTightness >= 0.6) return { free: 1.5, low: 1.3, mid: 0.9, high: 0.5 };
  if (balanceTightness >= 0.3) return { free: 1.15, low: 1.1 };
  return {};
}

export interface LeisurePickContext {
  characterId: string;
  /** 主导情绪类型（sadness/joy...），空 = 平静 */
  emotionType?: string;
  /** 余额 / 月支出的紧绷度 0(宽裕)~1(拮据) */
  balanceTightness: number;
  /** 体 attrs.stamina (0~100)：低于 35 视为低能量 */
  stamina?: number;
  /** 🆕 C3 联动：已购耐用品 unlocks 的活动名列表（必含在池内并加权 ×2.2） */
  unlockedHobbies?: string[];
}

/**
 * 构建加权后的休闲候选池：
 * 条件（无硬过滤——标签全是软权重）+ 状态系数 + D1 探索提权 + 解锁活动提权。
 */
export function buildWeightedLeisurePool(ctx: LeisurePickContext): Array<{ item: TaggedActivity; weight: number }> {
  const emotionBoost = EMOTION_MOOD_BOOST[ctx.emotionType || ''] || {};
  const cBoost = costBoost(ctx.balanceTightness);
  const lowEnergy = (ctx.stamina ?? 60) < 35;

  const entries: Array<{ item: TaggedActivity; weight: number }> = [];
  const seen = new Set<string>();

  // 解锁的耐用品活动优先入池（报告 C3 验收项：耐用品购买后对应活动出现在抽签池）
  for (const h of ctx.unlockedHobbies || []) {
    if (!h || seen.has(h)) continue;
    seen.add(h);
    const base = LEISURE_POOL.find((p) => p.name.includes(h) || h.includes(p.name));
    const item: TaggedActivity = base ? { ...base, name: h } : { name: h, category: 'leisure', scene: '家', sociality: 'solo', cost: 'free', mood: 'calm', energy: 'mid' };
    entries.push({ item, weight: 2.2 });
  }

  for (const p of LEISURE_POOL) {
    seen.add(p.name);
    let w = 1.0;
    w *= emotionBoost[p.mood] ?? 1.0;
    w *= cBoost[p.cost] ?? 1.0;
    if (lowEnergy && p.energy === 'low') w *= 1.5;
    if (lowEnergy && p.energy === 'high') w *= 0.6;
    w *= boostFactor(`act:${p.name}`);
    entries.push({ item: p, weight: w });
  }
  return entries;
}

/** 抽签选定后记账（D1）：keyPrefix 一般为 'act' */
export function pickFromPool<T extends { name: string }>(
  pool: Array<{ item: T; weight: number }>,
): T | null {
  const picked = seededWeightedPick(Math.random, pool.map((e) => e.item), pool.map((e) => e.weight));
  if (picked) recordPick(`act:${picked.name}`);
  return picked;
}
