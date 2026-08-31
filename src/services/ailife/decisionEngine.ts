/**
 * ============================================================
 * 念头-决策系统（B3）
 * 引擎掷骰，LLM 写作文：
 *   四路自监控（属性/库存/财务/聊天反向干预）→ 生成"念头"
 *   → 决策（severity≥2 走轻量 LLM，10s 超时回退纯算法）
 *   → 采纳（插入即时活动）/ 拖延（强度+0.15 重掷）/ 拒绝（thought 注入事件流）
 * 保底地板：health < 20 强制采纳；聊天反向干预强制 ≥0.85。
 * ============================================================
 */
import { useAiLifeStore } from '../../store/aiLifeStore';
import { useDebugLog } from '../../store/debugLogStore';
import { getPersonalityFactor } from '../dataOverrideBridge';
import { loadAttributes, getCachedAttributes } from './attributeSystem';
import { dbGetAiInventory, dbGetAiEconomy, type AiLifeActivity, type AiLifeAttributes } from '../../lib/tauriBridge';
import { recordLifeEvent } from './lifeEvents';
import { runAilifeLlm } from './contentGenerator';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { checkDurableWear } from './baselineCatalog';

export type ThoughtKind = 'need' | 'inventory' | 'finance' | 'chat_influence';
export type ThoughtAction = 'eat' | 'drink' | 'rest' | 'sleep' | 'shop' | 'wash' | 'relax' | 'none';

export interface LifeThought {
  id: string;
  characterId: string;
  kind: ThoughtKind;
  severity: 1 | 2 | 3;
  description: string;
  action: ThoughtAction;
  /** 需求强度 0~1（拖延一次 +0.15） */
  intensity: number;
  postponeCount: number;
  createdAt: number;
}

/** 挂起中的念头（拖延后重掷） */
const pendingThoughts = new Map<string, LifeThought>();

/** 每日 LLM 决策预算（默认 30 次，超限直接算法） */
let decisionBudget = { date: '', used: 0 };
const DAILY_LLM_DECISION_MAX = 30;

function budgetAvailable(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (decisionBudget.date !== today) {
    decisionBudget = { date: today, used: 0 };
  }
  return decisionBudget.used < DAILY_LLM_DECISION_MAX;
}

/** 🆕 清空该角色的挂起念头与全局决策预算（AI 一日"全部删除"时调用），
 * 避免删完记录后残留的拖延念头继续干预、产生幽灵活动。 */
export function clearDecisionState(characterId: string): void {
  for (const key of Array.from(pendingThoughts.keys())) {
    if (key.startsWith(`${characterId}:`)) pendingThoughts.delete(key);
  }
  decisionBudget = { date: '', used: 0 };
}

// ---------------- 四路扫描 → 念头 ----------------

/** 聊天反向干预关键词（起步规则，后续可升级轻量 LLM 分类） */
const CHAT_INFLUENCE_KEYWORDS: Array<{ re: RegExp; action: ThoughtAction; label: string }> = [
  { re: /吃饭|吃点|去吃|干饭|进食/, action: 'eat', label: '用户催去吃饭' },
  { re: /喝水|喝点水|补补水/, action: 'drink', label: '用户提醒喝水' },
  { re: /早点睡|去睡觉|该睡了|别熬夜/, action: 'sleep', label: '用户催早点睡' },
  { re: /休息一下|歇会儿|别太累/, action: 'rest', label: '用户劝休息' },
  { re: /洗个澡|去洗澡|洗漱|洗洗/, action: 'wash', label: '用户催去洗漱' },
  { re: /放松一下|出去走走|散散心|休息休息/, action: 'relax', label: '用户劝放松' },
];

/** 聊天反向干预入口（chatStore 检测到生活意图时调用） */
export function recordChatInfluence(characterId: string, text: string): void {
  if (!text) return;
  for (const kw of CHAT_INFLUENCE_KEYWORDS) {
    if (kw.re.test(text)) {
      const thought: LifeThought = {
        id: `ci_${Date.now().toString(36)}`,
        characterId,
        kind: 'chat_influence',
        severity: 3,
        description: `${kw.label}（"${text.slice(0, 30)}"）`,
        action: kw.action,
        intensity: 1.0,
        postponeCount: 0,
        createdAt: Date.now(),
      };
      pendingThoughts.set(`${characterId}:${thought.action}`, thought);
      recordLifeEvent({
        characterId,
        type: 'plan_change',
        description: `[聊天干预] ${thought.description}`,
        meta: { thought: thought.action, source: 'chat_influence' },
      }).catch(() => {});
      void decideAndAct(thought);
      return;
    }
  }
}

/** 四路扫描：返回本 tick 的念头列表（已含挂起重掷的） */
async function collectThoughts(characterId: string): Promise<LifeThought[]> {
  const thoughts: LifeThought[] = [];
  const attrs = getCachedAttributes(characterId) || await loadAttributes(characterId);

  // 1. 属性路（触发线 25：精力/饱腹/口渴降到 25 就该处理；危险线见 isCriticalPhysiological）
  // 🆕 强度按"触发线→危险线"窗口计算：分母用触发线到临界线的距离（饱腹/口渴 10、精力 5），
  // 触发点（如口渴 21）强度即 0.4 而非 0.16，避免"提前触发却强度过低→算法必拒"。
  if (attrs.satiety < 25) {
    thoughts.push(mkThought(characterId, 'need', attrs.satiety < 15 ? 3 : 2, `饱腹 ${Math.round(attrs.satiety)}，很饿`, 'eat', (25 - attrs.satiety) / 10));
  }
  if ((attrs.thirst ?? 80) < 25) {
    thoughts.push(mkThought(characterId, 'need', (attrs.thirst ?? 80) < 15 ? 3 : 2, `口渴 ${Math.round(attrs.thirst ?? 80)}`, 'drink', (25 - (attrs.thirst ?? 80)) / 10));
  }
  if (attrs.stamina < 25) {
    thoughts.push(mkThought(characterId, 'need', attrs.stamina < 10 ? 3 : 2, `精力 ${Math.round(attrs.stamina)}，撑不住了`, 'rest', (25 - attrs.stamina) / 5));
  }
  // 🆕 修复"清洁/精神降到 0 也没恢复"：补齐两条缺失的生理扫描——
  // 清洁 < 25 → 洗漱；精神 < 25 → 放松（危险线 15，见 isCriticalPhysiological）
  if ((attrs.cleanliness ?? 90) < 25) {
    thoughts.push(mkThought(characterId, 'need', (attrs.cleanliness ?? 90) < 15 ? 3 : 2, `清洁 ${Math.round(attrs.cleanliness ?? 90)}，身上不干净了`, 'wash', (25 - (attrs.cleanliness ?? 90)) / 10));
  }
  if ((attrs.spirit ?? 90) < 25) {
    thoughts.push(mkThought(characterId, 'need', (attrs.spirit ?? 90) < 15 ? 3 : 2, `精神 ${Math.round(attrs.spirit ?? 90)}，提不起劲`, 'relax', (25 - (attrs.spirit ?? 90)) / 10));
  }

  // 2. 库存路：主食/饮品不足 + 耐用品损坏/将坏（🆕 B2.2）
  try {
    const inventory = await dbGetAiInventory(characterId);
    const foodCount = inventory.filter((i) => i.category === 'food').reduce((s, i) => s + i.quantity, 0);
    if (foodCount <= 1) {
      thoughts.push(mkThought(characterId, 'inventory', 2, `家里食材只剩 ${foodCount} 份，该买菜了`, 'shop', 0.6));
    }
    checkDurableWear(characterId, inventory).catch(() => {});
  } catch { /* ignore */ }

  // 3. 财务路：余额 < 未来 7 天预估开销（日均 ×7，日均按 60 估）
  try {
    const economy = await dbGetAiEconomy(characterId);
    if (economy && economy.balance < 60 * 7) {
      thoughts.push(mkThought(characterId, 'finance', 2, `余额 ${Math.round(economy.balance)}，快不够一周开销了，进入省钱模式`, 'none', 0.5));
    }
  } catch { /* ignore */ }

  // 4. 挂起的拖延念头重掷（强度已增长）
  for (const [key, t] of Array.from(pendingThoughts)) {
    if (t.characterId !== characterId) continue;
    if (!thoughts.some((x) => x.action === t.action && x.kind === t.kind)) {
      thoughts.push(t);
    }
    pendingThoughts.delete(key);
  }

  return thoughts;
}

function mkThought(
  characterId: string, kind: ThoughtKind, severity: 1 | 2 | 3,
  description: string, action: ThoughtAction, intensity: number,
): LifeThought {
  return {
    id: `th_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    characterId, kind, severity, description, action,
    intensity: Math.max(0.2, Math.min(1, intensity)),
    postponeCount: 0,
    createdAt: Date.now(),
  };
}

// ---------------- 决策层 ----------------

/**
 * 🆕 生理临界：属性值低于危险线的生理需求，无条件采纳（不掷骰、不浪费 LLM）。
 * 精力 < 20（对应 checkThresholds "非常疲惫"线）、饱腹/口渴 < 15。
 * 修复"精力 14 / 饱腹 14 仍被 refuse"——intensity 兜底（≥0.9）只覆盖接近 0 的场景，
 * 危险线内的中度偏低值必须也得到强制采纳。
 */
function isCriticalPhysiological(t: LifeThought, attrs: AiLifeAttributes): boolean {
  if (t.kind !== 'need') return false;
  if (t.action === 'eat' && attrs.satiety < 15) return true;
  if (t.action === 'drink' && (attrs.thirst ?? 80) < 15) return true;
  if (t.action === 'rest' && attrs.stamina < 20) return true;
  if (t.action === 'wash' && (attrs.cleanliness ?? 90) < 15) return true;
  if (t.action === 'relax' && (attrs.spirit ?? 90) < 15) return true;
  return false;
}

export interface ThoughtDecision {
  decision: 'adopt' | 'delay' | 'refuse';
  durationMin?: number;
  thought: string;
  source: 'llm' | 'algorithm' | 'forced';
}

/** LLM 决策（severity≥2 且预算内），10s 超时回退算法 */
async function decideWithLLM(t: LifeThought, contextLine: string): Promise<ThoughtDecision | null> {
  if (t.severity < 2 || !budgetAvailable()) return null;
  try {
    decisionBudget.used++;
    const p = getPersonalityFactor();
    const mind = useCharacterMindStore.getState();
    const multi = mind.getMultiEmotion(t.characterId);
    const top = Object.entries(multi.values || {}).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 2)
      .map(([k, v]) => `${k}:${Math.round(v as number)}`).join(' ');
    const prompt = `你是生活模拟中的角色内心决策器。角色当前处境：
${contextLine}
需求状态：${t.description}（强度 ${t.intensity.toFixed(2)}，已被拖延 ${t.postponeCount} 次）
性格参数：自律度 ${p.selfDiscipline} / 节俭度 ${p.frugality} / 行动力 ${p.actionDrive}
情绪：${top || '平静'}

判断这个需求现在该怎么处理。输出 JSON（只输出 JSON）：
{"decision":"adopt/delay/refuse","durationMin":拖延分钟数(仅delay时,15/30/60 之一),"thought":"第一人称内心想法(10~50字)"}`;
    const out = await withTimeout(runAilifeLlm('emotionShift', t.characterId, prompt, 160), 10000);
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { decision?: string; durationMin?: number; thought?: string };
    const decision = ['adopt', 'delay', 'refuse'].includes(String(parsed.decision)) ? parsed.decision as ThoughtDecision['decision'] : null;
    if (!decision) return null;
    const thoughtText = typeof parsed.thought === 'string' ? parsed.thought.trim().slice(0, 60) : '';
    const durationMin = [15, 30, 60].includes(Number(parsed.durationMin)) ? Number(parsed.durationMin) : 30;
    return { decision, durationMin, thought: thoughtText || t.description, source: 'llm' };
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('decision timeout')), ms)),
  ]);
}

/** 纯算法兜底：执行分 = 强度 × 自律修正 × 情绪系数 × 随机
 * 🆕 修复：原公式 discipline=0.5 时得分上限 0.6，永远够不到 0.65 采纳线——
 * 饿到 0 也会被"拖延/拒绝"。生理需求本就不该被性格参数压死：
 * 自律只影响"中度需求"的处理倾向，临界需求（强度≥0.9）无条件采纳。 */
function decideWithAlgorithm(t: LifeThought, contextLine: string): ThoughtDecision {
  // 生理底线：快归零的需求（饿到 0 / 渴到 0 / 精力耗尽）直接采纳，不掷骰
  if (t.kind !== 'finance' && t.intensity >= 0.9) {
    return { decision: 'adopt', durationMin: 30, thought: `撑不住了，必须马上处理：${t.description}`, source: 'algorithm' };
  }

  const p = getPersonalityFactor();
  // 自律只做温和修正（0.8~1.2 区间），不做硬性乘法压制
  const disciplineMod = 0.8 + p.selfDiscipline * 0.4;
  const emotionCoef = 0.85 + Math.random() * 0.3;
  const contextCoef = contextLine.includes('正在「睡眠') ? 0.5 : 1.0;
  const score = t.intensity * disciplineMod * emotionCoef * contextCoef * (0.85 + Math.random() * 0.3)
    * (1 + t.postponeCount * 0.15); // 越拖越难拒绝

  // 🆕 生理需求（need）：已触发即值得重视，永不"一票否决"拒绝——
  // 修复"口渴 21 每次都被 refuse"：强度高于采纳线直接处理，否则一律拖延
  //（拖延会让强度 +0.15 重掷，终会处理），杜绝"顾不上，xxx先放放"这类高频拒绝。
  if (t.kind === 'need') {
    const durationMin = [15, 30, 60][Math.floor(Math.random() * 3)];
    if (score >= 0.5) {
      return { decision: 'adopt', durationMin, thought: `先处理掉：${t.description}`, source: 'algorithm' };
    }
    return { decision: 'delay', durationMin, thought: `${t.description}……等 ${durationMin} 分钟再说`, source: 'algorithm' };
  }

  const adoptLine = 0.65;
  const decision = score >= adoptLine ? 'adopt' : score >= 0.35 ? 'delay' : 'refuse';
  const durationMin = [15, 30, 60][Math.floor(Math.random() * 3)];
  const thought = decision === 'adopt'
    ? `先处理掉：${t.description}`
    : decision === 'delay'
      ? `${t.description}……等 ${durationMin} 分钟再说`
      : `顾不上，${t.description}先放放`;
  return { decision, durationMin, thought, source: 'algorithm' };
}

/** 决策 + 行动主入口 */
async function decideAndAct(t: LifeThought): Promise<void> {
  try {
    const current = useAiLifeStore.getState().currentActivity;
    const contextLine = current
      ? `正在进行「${current.name}」（${current.category}）`
      : '当前空闲';

    const attrs = getCachedAttributes(t.characterId) || await loadAttributes(t.characterId);

    // 🆕 生理临界最优先：危险线以下（饱腹/口渴<15、精力<20）无条件采纳，跳过 LLM——
    // 修复"饿得半死 / 累到极限还被 refuse"（用户反馈的决策缺陷）
    if (isCriticalPhysiological(t, attrs) && t.action !== 'none') {
      useDebugLog.getState().add('ailife', `[念头决策] ${t.description} → adopt（forced·生理临界）"必须处理：${t.description}"`, { characterId: t.characterId });
      await adoptThought(t);
      return;
    }

    let decision = await decideWithLLM(t, contextLine);
    if (!decision) decision = decideWithAlgorithm(t, contextLine);

    // 🆕 B6.3: 经济设定过滤——购物念头先过余额硬规则，不足则降级保底食物
    if (t.action === 'shop') {
      try {
        const economy = await dbGetAiEconomy(t.characterId);
        if (economy && economy.balance < 50) {
          t.description = `余额不足（${Math.round(economy.balance)}），购物降级为保底食物（馒头/泡面）`;
          t.action = 'eat';
          useDebugLog.getState().add('ailife', `[经济过滤] 余额不足，购物降级为保底餐`, { characterId: t.characterId });
        }
      } catch { /* ignore */ }
    }

    // 保底地板 / 聊天干预 / 临界强度：强制采纳——临界需求连 LLM 也不许拒绝
    const forced = (t.kind === 'chat_influence' || attrs.health < 20 || (t.kind !== 'finance' && t.intensity >= 0.9)) && t.action !== 'none';
    if (forced) {
      decision = { decision: 'adopt', durationMin: 30, thought: `必须处理：${t.description}`, source: 'forced' };
    }

    useDebugLog.getState().add('ailife', `[念头决策] ${t.description} → ${decision.decision}（${decision.source}）"${decision.thought}"`, { characterId: t.characterId });

    if (decision.decision === 'adopt') {
      await adoptThought(t);
    } else if (decision.decision === 'delay') {
      t.postponeCount += 1;
      t.intensity = Math.min(1, t.intensity + 0.15);
      pendingThoughts.set(`${t.characterId}:${t.action}`, t);
      recordLifeEvent({
        characterId: t.characterId, type: 'plan_change',
        description: `拖延：${t.description}（${decision.durationMin} 分钟后重掷）`,
        meta: { decision, thoughtAction: t.action },
      }).catch(() => {});
    } else {
      recordLifeEvent({
        characterId: t.characterId, type: 'plan_change',
        description: `拒绝：${t.description} —— "${decision.thought}"`,
        meta: { decision, thoughtAction: t.action },
      }).catch(() => {});
    }
  } catch (e) {
    useDebugLog.getState().add('ailife', `[念头决策] 失败: ${e instanceof Error ? e.message : String(e)}`, { characterId: t.characterId });
  }
}

/** 采纳：打断当前活动，插入即时行动活动 */
async function adoptThought(t: LifeThought): Promise<void> {
  const store = useAiLifeStore.getState();
  const now = new Date();
  const nowIso = now.toISOString();
  const end = new Date(now.getTime() + 30 * 60000).toISOString();

  const templates: Record<string, { name: string; category: string; scene: string; mood: string; description: string }> = {
    eat: { name: '赶紧吃点东西', category: 'meal', scene: '厨房', mood: '满足', description: '饿得不行，先做点吃的。' },
    drink: { name: '倒杯水喝', category: 'rest', scene: '客厅', mood: '舒缓', description: '口渴，接杯水慢慢喝。' },
    rest: { name: '躺下歇会儿', category: 'rest', scene: '卧室', mood: '放松', description: '太累了，先休息一下。' },
    sleep: { name: '早点上床睡觉', category: 'sleep', scene: '卧室', mood: '困倦', description: '被提醒该睡了，洗漱上床。' },
    shop: { name: '出门买菜', category: 'travel', scene: '超市', mood: '平静', description: '家里没吃的了，去补点货。' },
    wash: { name: '去洗个澡', category: 'personal_care', scene: '卫生间', mood: '清爽', description: '身上不干净了，去洗洗打理一下。' },
    relax: { name: '放松一下', category: 'leisure', scene: '客厅', mood: '愉悦', description: '提不起劲，做点喜欢的事换换心情。' },
    none: { name: '整理一下', category: 'rest', scene: '家', mood: '平静', description: '收拾一下心情。' },
  };
  const tpl = templates[t.action] || templates.none;

  // 当前活动标记打断（🆕 B7: 过程留痕 interrupted 节点）
  if (store.currentActivity && store.currentActivity.status === 'ongoing') {
    const interruptedAct = { ...store.currentActivity };
    interruptedAct.status = 'interrupted';
    interruptedAct.updatedAt = nowIso;
    interruptedAct.steps = [
      ...(interruptedAct.steps || []),
      { time: nowIso, phase: 'interrupted' as const, note: `被「${tpl.name}」打断（${t.description}）` },
    ];
    const { dbBatchSaveAiActivities: saveBatch } = await import('../../lib/tauriBridge');
    await saveBatch([interruptedAct]);
  }

  const activity: AiLifeActivity = {
    id: `th_act_${Date.now().toString(36)}`,
    characterId: t.characterId,
    name: tpl.name,
    category: tpl.category,
    startTime: nowIso,
    endTime: end,
    sceneId: tpl.scene,
    status: 'ongoing',
    processDescription: '',
    summary: '',
    mood: tpl.mood,
    location: tpl.scene,
    weather: '',
    isChanged: true,
    changedFrom: store.currentActivity?.name || '',
    changedReason: decisionReason(t),
    replacedBy: '',
    comments: [],
    // 🆕 B7: 过程留痕 start 节点
    steps: [{ time: nowIso, phase: 'start', note: `${decisionReason(t)}：${t.description}` }],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const { dbBatchSaveAiActivities } = await import('../../lib/tauriBridge');
  await dbBatchSaveAiActivities([activity]);
  store.setCurrentActivity(activity);
  store.setDayActivities(store.currentDate, [
    ...((store.dayActivities[store.currentDate] || []).map((a) => a.id === store.currentActivity?.id ? { ...a, status: 'interrupted' } : a)),
    activity,
  ]);

  // 🆕 修复"提醒了没反应"：立即施加即时缓解——不等活动结束（1x 真实时间要等 30 分钟）
  // 面板马上有变化；活动结束后的正常结算视作"吃完整顿"的后续补充
  await applyInstantRelief(t).catch(() => {});

  // 🆕 修复"商店不买"：购物念头采纳时立即执行保底采购闭环（扣钱+流水+入库）
  if (t.action === 'shop') {
    await executeEssentialPurchase(t.characterId).catch(() => {});
  }

  recordLifeEvent({
    characterId: t.characterId, type: 'plan_change',
    description: `采纳念头 → 插入「${tpl.name}」（${t.description}）`,
    activityId: activity.id,
    meta: { thoughtAction: t.action },
  }).catch(() => {});
}

/** 即时缓解：采纳吃饭/喝水/休息念头时立即恢复部分属性（面板即时反馈） */
async function applyInstantRelief(t: LifeThought): Promise<void> {
  const { loadAttributes, persistAttributes } = await import('./attributeSystem');
  const cur = await loadAttributes(t.characterId);
  const next = { ...cur, timestamp: new Date().toISOString() };
  switch (t.action) {
    case 'eat':
      next.satiety = Math.min(100, cur.satiety + 25);
      next.thirst = Math.min(100, (cur.thirst ?? 80) + 5);
      break;
    case 'drink':
      next.thirst = Math.min(100, (cur.thirst ?? 80) + 30);
      break;
    case 'rest':
      next.stamina = Math.min(100, cur.stamina + 20);
      next.stress = Math.max(0, cur.stress - 8);
      break;
    case 'sleep':
      next.stamina = Math.min(100, cur.stamina + 10);
      break;
    case 'wash':
      next.cleanliness = Math.min(100, (cur.cleanliness ?? 90) + 30);
      next.spirit = Math.min(100, (cur.spirit ?? 90) + 3);
      break;
    case 'relax':
      next.spirit = Math.min(100, (cur.spirit ?? 90) + 25);
      next.stress = Math.max(0, cur.stress - 12);
      break;
    default:
      return; // shop/none 无即时属性效果
  }
  await persistAttributes(t.characterId, next, `采纳念头：${t.description.slice(0, 20)}`);
  useDebugLog.getState().add('ailife', `[念头] 即时缓解已生效（${t.action}）`, { characterId: t.characterId });
}

/**
 * 保底采购闭环：按缺口从商店目录买最便宜的食材/饮用水。
 * 扣余额 + 记流水 + 入库，一次至多买 2 件（省钱模式）。
 */
async function executeEssentialPurchase(characterId: string): Promise<void> {
  try {
    const [{ dbGetAiEconomy, dbSaveAiEconomy, dbAddAiTransaction, dbGetAiInventory, dbSaveAiInventoryItems }, { getAllShopItems }] = await Promise.all([
      import('../../lib/tauriBridge'),
      import('./localShop'),
    ]);
    const economy = await dbGetAiEconomy(characterId);
    if (!economy || economy.balance < 10) {
      useDebugLog.getState().add('ailife', '[采购] 余额不足 10，放弃采购', { characterId });
      return;
    }
    const inventory = await dbGetAiInventory(characterId);
    const foodCount = inventory.filter((i) => i.category === 'food').reduce((s, i) => s + i.quantity, 0);

    // 优先级：食材缺 → 买主食；水缺 → 买水
    const catalog = getAllShopItems().filter((s) => s.stock);
    const wanted: typeof catalog = [];
    if (foodCount <= 2) {
      const staple = catalog
        .filter((s) => /米|面|蛋|面包/.test(s.name))
        .sort((a, b) => a.price - b.price)[0];
      if (staple) wanted.push(staple);
    }
    const waterCount = inventory.filter((i) => i.name.includes('水')).reduce((s, i) => s + i.quantity, 0);
    if (waterCount === 0) {
      const water = catalog.filter((s) => s.name.includes('水')).sort((a, b) => a.price - b.price)[0];
      if (water) wanted.push(water);
    }
    if (wanted.length === 0) return;

    let balance = economy.balance;
    const newItems: import('../../lib/tauriBridge').AiInventoryItem[] = [];
    for (const item of wanted.slice(0, 2)) {
      if (balance < item.price) break;
      balance -= item.price;
      await dbAddAiTransaction({
        id: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        characterId,
        type: 'expense',
        amount: item.price,
        description: `补货｜${item.name}`,
        timestamp: new Date().toISOString(),
      });
      newItems.push({
        id: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        characterId,
        category: 'food',
        name: item.name,
        quantity: 1,
        quality: 'good',
        extra: { itemClass: 'consumable', shopItemId: item.id, note: '念头决策自主补货' },
        updatedAt: new Date().toISOString(),
      });
    }
    if (newItems.length > 0) {
      await dbSaveAiEconomy({ ...economy, balance, updatedAt: new Date().toISOString() });
      await dbSaveAiInventoryItems(newItems);
      useDebugLog.getState().add('ailife', `[采购] 已购买 ${newItems.map((i) => i.name).join('、')}，余额 ${Math.round(balance)}`, { characterId });
    }
  } catch (e) {
    useDebugLog.getState().add('ailife', `[采购] 失败: ${e instanceof Error ? e.message : String(e)}`, { characterId });
  }
}

function decisionReason(t: LifeThought): string {
  if (t.kind === 'chat_influence') return '用户提醒';
  if (t.kind === 'finance') return '余额不足';
  if (t.kind === 'inventory') return '物资短缺';
  return '身体需求';
}

/** 引擎小时级 tick 调用的入口 */
export async function runNeedDecisionTick(characterId: string): Promise<void> {
  try {
    const config = useAiLifeStore.getState().config;
    if (!config?.enabled) return;
    const thoughts = await collectThoughts(characterId);
    for (const t of thoughts) {
      // severity 1 直接采纳省成本；severity 3（临界生理需求）也不掷骰——保底地板
      if (t.severity === 1 || t.severity === 3) {
        await adoptThought(t);
      } else {
        await decideAndAct(t);
      }
    }
  } catch { /* 静默：决策失败不影响引擎 */ }
}
