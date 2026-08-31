/**
 * ============================================================
 * C1: 经济闭环接线 · 活动结算器
 * 把此前零调用的死代码（consumeFoodForMeal / pickDailyOutfit）
 * 挂到活动语义上，替代随机层：
 *   - 活动开始（每天第一个非睡眠活动）→ pickDailyOutfit 每日穿搭
 *   - meal 类活动结束 → consumeFoodForMeal 扣冰箱食材（lowFood 记事件流）
 *   - work 类活动结束 → 出勤日结薪（月薪/22，当日幂等；"请假亏钱"因果）
 * 每次结算写一条 ai_life_events（B4）。
 * ============================================================
 */
import { dbGetAiEconomy, dbSaveAiEconomy, dbAddAiTransaction } from '../../lib/tauriBridge';
import { useDebugLog } from '../../store/debugLogStore';
import { consumeFoodForMeal, pickDailyOutfit } from './attributeSystem';
import { recordLifeEvent } from './lifeEvents';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

/** 活动开始结算：每天第一个非睡眠活动前触发每日穿搭（pickDailyOutfit 同日幂等） */
export async function settleActivityStart(characterId: string, category: string): Promise<void> {
  if (category === 'sleep') return;
  try {
    await pickDailyOutfit(characterId);
  } catch { /* 静默：穿搭失败不影响主流程 */ }
}

/** 活动结束结算：按类别走经济语义 */
export async function settleActivityEnd(characterId: string, activityId: string, category: string, activityName: string): Promise<void> {
  try {
    if (category === 'meal') {
      const r = await consumeFoodForMeal(characterId);
      if (r.consumedNames.length > 0) {
        useDebugLog.getState().add('ailife', `[AI-Life] 用餐消耗: ${r.consumedNames.join('、')}`, { characterId });
        await recordLifeEvent({
          characterId,
          type: 'consume',
          description: `吃掉了 ${r.consumedNames.join('、')}`,
          activityId,
          meta: { lowFood: r.lowFood },
        });
      }
      if (r.lowFood) {
        useDebugLog.getState().add('ailife', '[AI-Life] 冰箱快空了，该买菜了', { characterId });
        await recordLifeEvent({ characterId, type: 'fallback', description: '冰箱食材见底，等自主补货 ticks 买菜' });
      }
    }

    if (category === 'work') {
      await creditDailySalary(characterId, activityName, activityId);
    }
  } catch { /* 结算失败不阻塞状态推进 */ }
}

/**
 * 出勤日结薪：月薪拆成日结（/22），当日幂等（以 lastPayday 日期门闸）。
 * 取代原"每月 1 号整发"——请假一天就少一天钱，制造真实因果。
 */
export async function creditDailySalary(characterId: string, activityName: string, activityId?: string): Promise<number> {
  const economy = await dbGetAiEconomy(characterId);
  if (!economy || economy.monthlyIncome <= 0) return 0;

  const today = todayKey();
  const lastPayDay = economy.lastPayday ? todayKeyOf(economy.lastPayday) : '';
  if (lastPayDay === today) return 0; // 今日已结

  const daily = Math.max(1, Math.round(economy.monthlyIncome / 22));
  const nowIso = new Date().toISOString();
  await dbSaveAiEconomy({ ...economy, balance: economy.balance + daily, lastPayday: nowIso, updatedAt: nowIso });
  await dbAddAiTransaction({
    id: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    characterId,
    type: 'income',
    amount: daily,
    description: `出勤日结｜AI：上完「${activityName}」，今天挣到了 ${daily} 块。`,
    timestamp: nowIso,
  });
  useDebugLog.getState().add('ailife', `[AI-Life] 出勤日结 +¥${daily}（月薪 ¥${economy.monthlyIncome}/22）`, { characterId });
  await recordLifeEvent({
    characterId,
    type: 'income',
    description: `出勤日结薪 +¥${daily}`,
    activityId,
    meta: { monthlyIncome: economy.monthlyIncome },
  });
  return daily;
}

function todayKeyOf(isoOrDate: string): string {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}
