/**
 * ============================================================
 * AI 一日 · 属性系统（阶段 3）
 * 六维属性：健康/体力/饱腹/清洁/精神/压力
 *  - 时间衰减（每小时，睡觉时改为恢复）
 *  - 活动影响（活动结束时按类别增减）
 *  - 阈值触发（低体力→疲惫、高压力→情绪波动等，写 debug 日志并联动情绪）
 *  - 属性历史（内存环形缓冲，供面板迷你趋势线）
 *  - 食品消耗（用餐结束自动扣减库存并记录）与每日穿搭（从衣柜挑选）
 * 持久化：ai_attribute_snapshots 表（最新一条即当前值）
 * ============================================================
 */
import { dbGetAiAttributes, dbSaveAiAttributes, AiLifeAttributes } from '../../lib/tauriBridge';
import { useDebugLog } from '../../store/debugLogStore';
import { useCharacterMindStore } from '../../store/characterMindStore';

export type AttributeKey = 'health' | 'stamina' | 'satiety' | 'thirst' | 'cleanliness' | 'spirit' | 'stress';

export const DEFAULT_ATTRIBUTES: Omit<AiLifeAttributes, 'characterId' | 'timestamp'> = {
  health: 100, stamina: 100, satiety: 85, thirst: 80, cleanliness: 90, spirit: 90, stress: 10,
};

// ---------------- 属性历史（内存，供趋势线与最近变化原因） ----------------

const ATTR_HISTORY_LIMIT = 24;
const attrHistory: Record<string, AttrHistoryPoint[]> = {};

export type AttrHistoryPoint = AiLifeAttributes & { reason: string };

function recordHistory(attrs: AiLifeAttributes, reason: string): void {
  let list = attrHistory[attrs.characterId];
  if (!list) { list = []; attrHistory[attrs.characterId] = list; }
  list.push({ ...attrs, reason });
  if (list.length > ATTR_HISTORY_LIMIT) list.splice(0, list.length - ATTR_HISTORY_LIMIT);
}

/** 面板读取趋势数据（无记录时返回空数组） */
export function getAttrHistory(characterId: string): AttrHistoryPoint[] {
  return attrHistory[characterId] || [];
}

/** 🆕 B5.3: 同步读取缓存的当前属性（引擎运行期间 recordHistory 已播种；无记录返回 null） */
export function getCachedAttributes(characterId: string): AiLifeAttributes | null {
  const list = attrHistory[characterId];
  if (list && list.length > 0) return list[list.length - 1];
  return null;
}

/** 面板挂载时播种当前值（让趋势线至少有一个点） */
export async function seedAttrHistory(characterId: string): Promise<void> {
  if ((attrHistory[characterId] || []).length > 0) return;
  const cur = await loadAttributes(characterId);
  recordHistory(cur, '当前状态');
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** 读取当前属性（无记录时返回默认值） */
export async function loadAttributes(characterId: string): Promise<AiLifeAttributes> {
  const existing = await dbGetAiAttributes(characterId);
  if (existing) return existing;
  return {
    characterId,
    ...DEFAULT_ATTRIBUTES,
    timestamp: new Date().toISOString(),
  };
}

/** 保存快照 */
async function persist(next: AiLifeAttributes, reason: string): Promise<AiLifeAttributes> {
  recordHistory(next, reason);
  await dbSaveAiAttributes({
    ...next,
    id: `attr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    reason,
  });
  return next;
}

/** 外部模块（随机事件等）直接写入修正后的属性值 */
export async function persistAttributes(characterId: string, attrs: AiLifeAttributes, reason: string): Promise<AiLifeAttributes> {
  return persist(clampAll({ ...attrs, characterId, timestamp: new Date().toISOString() }), reason);
}

/**
 * 🆕 重置属性到默认值并清空内存历史（AI 一日"全部删除"当天时调用）：
 * 让角色回归初始状态，避免删除记录后属性仍残留为 0（饿/累）导致面板与日程矛盾。
 */
export async function resetAttributes(characterId: string): Promise<AiLifeAttributes> {
  const fresh: AiLifeAttributes = {
    characterId,
    ...DEFAULT_ATTRIBUTES,
    timestamp: new Date().toISOString(),
  };
  attrHistory[characterId] = [];
  recordHistory(fresh, '已重置');
  await dbSaveAiAttributes({
    ...fresh,
    id: `attr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    reason: '重置为默认',
  });
  return fresh;
}

const clampAll = (a: AiLifeAttributes): AiLifeAttributes => ({
  ...a,
  health: clamp(a.health),
  stamina: clamp(a.stamina),
  satiety: clamp(a.satiety),
  thirst: clamp(a.thirst ?? 80),
  cleanliness: clamp(a.cleanliness),
  spirit: clamp(a.spirit),
  stress: clamp(a.stress),
});

/** 每小时自然衰减；睡眠时段改为恢复 */
export async function applyHourlyDecay(characterId: string, isSleeping: boolean): Promise<AiLifeAttributes> {
  const cur = await loadAttributes(characterId);
  let next: AiLifeAttributes;
  if (isSleeping) {
    next = {
      ...cur,
      health: cur.health + 1,
      stamina: cur.stamina + 12,
      spirit: cur.spirit + 8,
      stress: cur.stress - 5,
      satiety: cur.satiety - 2, // 睡觉也略消耗
      thirst: (cur.thirst ?? 80) - 2, // 🆕 B2.1: 睡眠轻度失水
      timestamp: new Date().toISOString(),
    };
  } else {
    next = {
      ...cur,
      satiety: cur.satiety - 5,
      thirst: (cur.thirst ?? 80) - 4, // 🆕 B2.1: 醒时口渴衰减
      stamina: cur.stamina - 3,
      cleanliness: cur.cleanliness - 2,
      spirit: cur.spirit - 1,
      stress: cur.stress + 1,
      timestamp: new Date().toISOString(),
    };
  }
  return persist(clampAll(next), isSleeping ? '睡眠恢复' : '时间流逝');
}

/** 活动结束时的属性增减 */
const ACTIVITY_EFFECT: Record<string, Partial<Record<AttributeKey, number>>> = {
  sleep: { health: 4, stamina: 40, spirit: 25 },
  meal: { satiety: 35, thirst: 10, stress: -3 }, // 🆕 B2.1: 用餐顺带缓解口渴
  work: { stamina: -12, spirit: -8, stress: 10, thirst: -5 },
  leisure: { stress: -10, spirit: 6, stamina: 3, thirst: -3 },
  personal_care: { cleanliness: 35, spirit: 5 },
  travel: { stamina: -6, stress: 4, thirst: -6 },
  social: { spirit: 6, stress: -5, stamina: -3 },
  rest: { stamina: 12, stress: -6, spirit: 4 },
};

export async function applyActivityEffect(characterId: string, category: string, activityName: string): Promise<AiLifeAttributes> {
  const effect = ACTIVITY_EFFECT[category];
  const cur = await loadAttributes(characterId);
  if (!effect) return cur;
  const next = { ...cur, timestamp: new Date().toISOString() };
  for (const [k, v] of Object.entries(effect)) {
    next[k as AttributeKey] = cur[k as AttributeKey] + (v as number);
  }
  return persist(clampAll(next), `完成「${activityName}」`);
}

// ---------------- 阈值触发 ----------------

export interface ThresholdTrigger {
  key: string;
  label: string;
  /** 联动情绪维度偏移 */
  emotionEffect?: { emotion: string; delta: number };
}

export function checkThresholds(attrs: AiLifeAttributes): ThresholdTrigger[] {
  const triggers: ThresholdTrigger[] = [];
  if (attrs.health < 30) triggers.push({ key: 'low_health', label: '身体不太舒服', emotionEffect: { emotion: 'sadness', delta: 6 } });
  if (attrs.satiety < 20) triggers.push({ key: 'hungry', label: '有点饿了' });
  // 🆕 B2.1: 口渴阈值
  if ((attrs.thirst ?? 80) < 20) triggers.push({ key: 'thirsty', label: '有点渴了', emotionEffect: { emotion: 'anticipation', delta: 4 } });
  if (attrs.stamina < 20) triggers.push({ key: 'exhausted', label: '非常疲惫', emotionEffect: { emotion: 'sadness', delta: 5 } });
  // 🆕 精神低值标签（此前完全没有精神 <X 的感知，精神掉到 0 也无任何提示）
  if ((attrs.spirit ?? 90) < 20) triggers.push({ key: 'low_spirit', label: '提不起劲，该放松了', emotionEffect: { emotion: 'sadness', delta: 4 } });
  if (attrs.stress > 80) triggers.push({ key: 'high_stress', label: '压力很大', emotionEffect: { emotion: 'anger', delta: 6 } });
  if (attrs.cleanliness < 20) triggers.push({ key: 'dirty', label: '需要洗漱了' });
  return triggers;
}

/** tick 中调用：检查阈值并联动情绪（同一批越限的阈值合并为一条日志，避免刷屏） */
const lastTriggersByChar: Record<string, Set<string>> = {};

export async function checkAndApplyThresholds(characterId: string, attrs: AiLifeAttributes): Promise<void> {
  const triggers = checkThresholds(attrs);
  let seen = lastTriggersByChar[characterId];
  if (!seen) { seen = new Set(); lastTriggersByChar[characterId] = seen; }

  // 只取本次新越限的阈值，并合并为一条日志
  const fired = triggers.filter((t) => !seen.has(t.key));
  for (const t of fired) seen.add(t.key);

  if (fired.length === 1) {
    useDebugLog.getState().add('system', `[AI-Life] 属性阈值触发: ${fired[0].label}`, { characterId });
  } else if (fired.length > 1) {
    const labels = fired.map((t) => t.label).join('、');
    useDebugLog.getState().add('system', `[AI-Life] 属性阈值触发（${fired.length}项）: ${labels}`, { characterId });
  }

  for (const t of fired) {
    if (t.emotionEffect) {
      try {
        const mind = useCharacterMindStore.getState();
        const cur = mind.getMultiEmotion(characterId);
        const ek = t.emotionEffect.emotion as keyof typeof cur.values;
        const values = { ...cur.values };
        if (typeof values[ek] === 'number') {
          values[ek] = Math.max(0, Math.min(100, (values[ek] as number) + t.emotionEffect.delta));
          mind.setMultiEmotion(characterId, { ...cur, values });
        }
      } catch { /* 情绪联动失败不阻塞 */ }
    }
  }
  // 解除的阈值清除记忆，允许下次再次触发
  for (const k of Array.from(seen)) {
    if (!triggers.some((t) => t.key === k)) seen.delete(k);
  }
}

// ---------------- 食品消耗与每日穿搭（生活可玩性） ----------------

interface ItemHistoryEntry {
  date: string;
  qty: number;
  reason: string;
}

function appendItemHistory(item: { extra: Record<string, unknown> }, entry: ItemHistoryEntry): void {
  const list = Array.isArray(item.extra.history) ? [...(item.extra.history as ItemHistoryEntry[])] : [];
  list.push(entry);
  item.extra = { ...item.extra, history: list.slice(-12) };
}

export interface MealConsumeResult {
  consumedNames: string[];
  lowFood: boolean;
}

/**
 * 用餐活动结束时调用：从冰箱扣减食材并记录消耗。
 * 食材总量 <=2 时返回 lowFood=true（由引擎提示"该买菜了"）。
 */
export async function consumeFoodForMeal(characterId: string): Promise<MealConsumeResult> {
  const { dbGetAiInventory, dbSaveAiInventoryItems } = await import('../../lib/tauriBridge');
  const foods = (await dbGetAiInventory(characterId)).filter((i) => i.category === 'food' && i.quantity > 0);
  const consumedNames: string[] = [];
  let toConsume = 2;

  const touched: Awaited<ReturnType<typeof dbGetAiInventory>> = [];
  for (const food of foods) {
    if (toConsume <= 0) break;
    const take = Math.min(food.quantity, toConsume);
    if (take <= 0) continue;
    food.quantity -= take;
    toConsume -= take;
    consumedNames.push(food.name);
    appendItemHistory(food, { date: localKey(), qty: take, reason: '用餐消耗' });
    touched.push(food);
  }
  if (touched.length > 0) await dbSaveAiInventoryItems(touched);

  const remaining = (await dbGetAiInventory(characterId))
    .filter((i) => i.category === 'food')
    .reduce((sum, i) => sum + i.quantity, 0);
  return { consumedNames, lowFood: remaining <= 2 };
}

function localKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

export interface DailyOutfit {
  date: string;
  ids: string[];
  names: string[];
}

/**
 * 每日穿搭：一天开始时从衣柜挑选一套（最多 3 件），
 * 存于 ai_life_config.extra.todayOutfit；同日幂等。
 */
export async function pickDailyOutfit(characterId: string, force = false): Promise<DailyOutfit | null> {
  try {
    const { dbGetAiLifeConfig, dbSaveAiLifeConfig, dbGetAiInventory } = await import('../../lib/tauriBridge');
    const today = localKey();
    const cfg = await dbGetAiLifeConfig(characterId);
    const existing = (cfg.extra as { todayOutfit?: DailyOutfit } | undefined)?.todayOutfit;
    if (!force && existing && existing.date === today) return existing;

    const clothes = (await dbGetAiInventory(characterId)).filter((i) => i.category === 'clothing' && i.quantity > 0);
    if (clothes.length === 0) return null;

    const chosen = clothes.slice(0, 3);
    for (const c of chosen) appendItemHistory(c, { date: today, qty: 0, reason: '换上这套穿搭' });
    const { dbSaveAiInventoryItems: saveClothes } = await import('../../lib/tauriBridge');
    await saveClothes(chosen);

    const outfit: DailyOutfit = { date: today, ids: chosen.map((c) => c.id), names: chosen.map((c) => c.name) };
    await dbSaveAiLifeConfig({ ...cfg, extra: { ...cfg.extra, todayOutfit: outfit }, updatedAt: new Date().toISOString() });
    useDebugLog.getState().add('ailife', `[AI-Life] 今日穿搭：${outfit.names.join('、')}`, { characterId });
    return outfit;
  } catch {
    return null;
  }
}
