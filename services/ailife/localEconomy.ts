/**
 * ============================================================
 * AI 一日 · 本地自主运转经济引擎（无 API，纯规则）
 *
 * 由 lifeEngine 小时级任务驱动（runLocalEconomyTick）：
 *  1. 发薪日     —— 每月 1 号自动发工资（monthlyIncome）
 *  2. 日用品消耗 —— 每天按种子随机消耗 0~2 件日用品（真实感）
 *  3. 自主补货   —— 冰箱空了买菜 / 日用品用完补货 / 药箱缺药备药 /
 *                   每月给自己添件新衣服（余额充足才执行，精打细算）
 *  4. 随机小额开销 —— 奶茶/零食等即时消耗型小确幸（每天 0~2 次）
 *
 * 所有购买走 localShop.purchaseItem（扣款+入库+流水+角色语气备注）。
 * 幂等：以 config.extra.economyState.lastRunDate 做当日门闸。
 * ============================================================
 */
import {
  dbGetAiInventory, dbGetAiEconomy, dbGetAiTransactions,
  type AiInventoryItem,
} from '../../lib/tauriBridge';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { useDebugLog } from '../../store/debugLogStore';
import { SHOP_CATALOG, purchaseItem, findShopItemByName } from './localShop';
import { loadAttributes } from './attributeSystem';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

/** 简易种子随机（角色+日期稳定） */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface EconomyDayState {
  lastRunDate?: string;
  smallBuyDone?: number;
  dailyDrainDone?: boolean;
  clothingThisMonth?: string;
}

function readDayState(): EconomyDayState {
  const extra = useAiLifeStore.getState().config?.extra as Record<string, unknown> | undefined;
  const s = extra?.economyState;
  return (s && typeof s === 'object') ? s as EconomyDayState : {};
}

async function writeDayState(patch: EconomyDayState): Promise<void> {
  const store = useAiLifeStore.getState();
  const cfg = store.config;
  if (!cfg) return;
  await store.updateConfig({
    extra: {
      ...(cfg.extra || {}),
      economyState: { ...readDayState(), ...patch },
    },
  });
}

async function totalFoodCount(inventory: AiInventoryItem[]): Promise<number> {
  return inventory.filter((i) => i.category === 'food').reduce((s, i) => s + i.quantity, 0);
}

/** 安全购买（余额不足/失败静默，返回是否成功） */
async function tryBuy(characterId: string, itemName: string, qty = 1, reserve = 300): Promise<boolean> {
  const entry = findShopItemByName(itemName);
  if (!entry) return false;
  const economy = await dbGetAiEconomy(characterId);
  const cost = entry.price * qty;
  if (!economy || economy.balance < cost + reserve) return false; // 保留应急金
  const r = await purchaseItem(characterId, entry, qty);
  return r.ok;
}

/**
 * 经济自主运转 tick（由 lifeEngine 小时级任务调用）。
 * 当日门闸保证幂等；补货类规则每次 tick 都检查（库存是实时真相）。
 */
export async function runLocalEconomyTick(characterId: string): Promise<void> {
  const store = useAiLifeStore.getState();
  if (!store.config?.enabled) return;

  const dayState = readDayState();
  const today = todayKey();
  const isNewDay = dayState.lastRunDate !== today;
  const rng = seededRandom(`${characterId}|${today}`);
  const now = new Date();

  // ---------- 1) 发薪（🆕 C1：已改为 work 活动结束的"出勤日结薪"，见 activitySettlement.creditDailySalary；
  //               此处不再每月 1 号整发，避免双重发薪） ----------

  // ---------- 2/3/4) 当日一次性任务 ----------
  if (isNewDay) {
    const inventory = await dbGetAiInventory(characterId);

    // 2) 日用品自然消耗：每天 0~2 件（有库存才扣）
    const dailyItems = inventory.filter((i) => i.category === 'tool' && i.quantity > 0);
    const drainCount = Math.floor(rng() * 3); // 0~2
    if (dailyItems.length > 0 && drainCount > 0) {
      const toDrain = Math.min(drainCount, dailyItems.length);
      const updated: AiInventoryItem[] = [];
      for (let i = 0; i < toDrain; i++) {
        const item = dailyItems[Math.floor(rng() * dailyItems.length)];
        const next = { ...item, quantity: item.quantity - 1, updatedAt: new Date().toISOString() };
        updated.push(next);
      }
      // 去重后落库（同一条目多次被选时以最小数量为准）
      const byId = new Map<string, AiInventoryItem>();
      for (const u of updated) {
        const prev = byId.get(u.id);
        byId.set(u.id, prev ? { ...u, quantity: Math.min(prev.quantity, u.quantity) } : u);
      }
      await Promise.all(Array.from(byId.values()).map(async (u) => {
        if (u.quantity <= 0) {
          const { dbDeleteAiInventoryItem } = await import('../../lib/tauriBridge');
          await dbDeleteAiInventoryItem(u.id);
        } else {
          const { dbSaveAiInventoryItems } = await import('../../lib/tauriBridge');
          await dbSaveAiInventoryItems([u]);
        }
      }));
      useDebugLog.getState().add('ailife', `[AI-Life] 日用品自然消耗 ${byId.size} 件`, { characterId });
    }

    // 4) 随机小额开销（奶茶/零食，即时消耗，不入库）
    const smallBuyCount = rng() < 0.45 ? (rng() < 0.3 ? 2 : 1) : 0;
    const funItems = SHOP_CATALOG.filter((e) => e.category === 'fun');
    let smallDone = 0;
    for (let i = 0; i < smallBuyCount; i++) {
      const entry = funItems[Math.floor(rng() * funItems.length)];
      const ok = await tryBuy(characterId, entry.name, 1, 500);
      if (ok) smallDone++;
    }
    await writeDayState({ lastRunDate: today, dailyDrainDone: true, smallBuyDone: smallDone, clothingThisMonth: dayState.clothingThisMonth });
  }

  // ---------- 3) 自主补货（每次 tick 检查，库存为实时真相） ----------
  const inventory = await dbGetAiInventory(characterId);
  const eco = await dbGetAiEconomy(characterId);
  if (!eco) return;
  const balance = eco.balance;
  const dayState2 = readDayState();

  // 3a) 冰箱见底 → 买菜（总量 <2 时买 2~4 样，覆盖果蔬蛋奶）
  const foodTotal = await totalFoodCount(inventory);
  if (foodTotal < 2 && balance > 120) {
    const foods = SHOP_CATALOG.filter((e) =>
      ['food', 'fruit', 'vegetable', 'drink'].includes(e.category),
    );
    const buyN = 2 + Math.floor(rng() * 3);
    let bought = 0;
    for (let i = 0; i < buyN; i++) {
      const entry = foods[Math.floor(rng() * foods.length)];
      if (await tryBuy(characterId, entry.name, 1, 300)) bought++;
    }
    if (bought > 0) useDebugLog.getState().add('ailife', `[AI-Life] 冰箱空了，自主买菜 ${bought} 样`, { characterId });
  }

  // 3b) 日用品用完 → 自动补同一款
  const emptyDaily = inventory.filter((i) => i.category === 'tool' && i.quantity === 0);
  for (const item of emptyDaily.slice(0, 2)) {
    await tryBuy(characterId, item.name, 1, 300);
  }

  // 3c) 药箱：身体不适（健康<40）且没药 → 备感冒药；每月顺手补一支
  const medCount = inventory.filter((i) => i.category === 'medicine').reduce((s, i) => s + i.quantity, 0);
  if (medCount === 0) {
    let health = 100;
    try { health = (await loadAttributes(characterId)).health; } catch { /* ignore */ }
    if (health < 40 || rng() < 0.15) {
      await tryBuy(characterId, '感冒药', 1, 200);
    }
  }

  // 3d) 每月添新衣（每月一次，余额 > 800 才考虑）
  const monthKey = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
  if (dayState2.clothingThisMonth !== monthKey && balance > 800 && rng() < 0.5) {
    const clothes = SHOP_CATALOG.filter((e) => e.category === 'clothing');
    const entry = clothes[Math.floor(rng() * clothes.length)];
    if (await tryBuy(characterId, entry.name, 1, 600)) {
      await writeDayState({ clothingThisMonth: monthKey });
      useDebugLog.getState().add('ailife', `[AI-Life] 给自己添了新衣服: ${entry.name}`, { characterId });
    }
  }

  // 兜底：确保流水表可读（触发一次轻量查询以保持面板数据新鲜由面板自行处理）
  void dbGetAiTransactions;
}
