/**
 * ============================================================
 * AI 一日 · 随机事件与变卦（阶段 4）
 *  - 随机事件池：按事件频率档位触发，影响情绪与属性
 *  - AI 主动变卦：情绪+性格决定概率，替换未来第一个计划
 *  - 用户打断：邀请类关键词 + 好感度接受率 → interrupted
 * ============================================================
 */
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useCharacterStore } from '../../store/characterStore';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { useProactiveReplyStore } from '../../store/proactiveReplyStore';
import { useDebugLog } from '../../store/debugLogStore';
import { AiLifeActivity, dbBatchSaveAiActivities } from '../../lib/tauriBridge';
import { loadAttributes, persistAttributes } from './attributeSystem';
import {
  generateEmotionShiftPlan, FALLBACK_SHIFTS,
  shouldUseLLMForProcess, runAilifeLlm,
} from './contentGenerator';
import { getCallSetting } from './llmCalls';
import { localDateKey } from './scheduleTemplates';
import { recordLifeEvent } from './lifeEvents';
// 🆕 D1: 探索提权与加权抽签；C2: 消费审计
import { boostFactor, recordPick, weightedPick } from './pickStats';

// ---------------- 随机事件池（🆕 C4: schema 升级 + 扩容 9 → 80+） ----------------

/** 时段带（when.timeband 过滤用） */
function currentTimeband(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'noon';
  if (h >= 14 && h < 18) return 'afternoon';
  if (h >= 18 && h < 23) return 'evening';
  return 'night';
}

/** 季节（when.season 过滤用）：3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬 */
function currentSeason(): string {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

export interface RandomEventDef {
  name: string;
  /** 🆕 C4: 扩展 social（社交向）/ milestone（里程碑）两类 */
  category: 'positive' | 'neutral' | 'negative' | 'social' | 'milestone';
  mood?: Record<string, number>;
  attrEffect?: Partial<Record<'health' | 'stamina' | 'cleanliness' | 'spirit', number>>;
  /** 🆕 C4: 触发条件（全部满足才进入抽签池；缺省 = 任何时段可用） */
  when?: {
    timeband?: string[];        // morning/noon/afternoon/evening/night
    season?: string[];          // spring/summer/autumn/winter
    activityCategory?: string[];// 仅当前活动类别匹配时触发
  };
  /** 🆕 花钱事件（奶茶 15 元）——即时扣款写流水 */
  cost?: number;
  /** 🆕 消耗/产出物品名（打碎盘子 consumes:['盘子']） */
  consumes?: string[];
  produces?: string[];
  /** 🆕 触发后经 B2 闸门可能主动告诉用户（"我看到一只超亲人的猫！"） */
  mayTriggerProactive?: boolean;
  /** 🆕 转记忆条目权重（D2 日记回灌用）；milestone 类设普通 3~5 倍 */
  memorySalience?: number;
}

const RANDOM_EVENTS: RandomEventDef[] = [
  // —— positive 小确幸 15 ——
  { name: '遇到一只很亲人的猫', category: 'positive', mood: { joy: 5 }, mayTriggerProactive: true, memorySalience: 2 },
  { name: '收到一个期待已久的快递', category: 'positive', mood: { joy: 3, surprise: 3 } },
  { name: '窗外的晚霞特别好看', category: 'positive', mood: { joy: 2 }, when: { timeband: ['evening'] }, mayTriggerProactive: true },
  { name: '旧衣口袋翻出了十块钱', category: 'positive', mood: { joy: 3, surprise: 2 } },
  { name: '楼下桂花开了，风里都是甜的', category: 'positive', mood: { joy: 3 }, when: { season: ['autumn'] } },
  { name: '常去的店多送了小份甜品', category: 'positive', mood: { joy: 3, surprise: 2 } },
  { name: '耳机随机播放到了最爱的那首', category: 'positive', mood: { joy: 2 } },
  { name: '今天的云形状特别好看', category: 'positive', mood: { joy: 2 }, mayTriggerProactive: true },
  { name: '养的绿植冒了新芽', category: 'positive', mood: { joy: 3 }, memorySalience: 2 },
  { name: '午睡醒后阳光正好', category: 'positive', mood: { joy: 2 }, when: { timeband: ['afternoon'] } },
  { name: '洗完澡整个人神清气爽', category: 'positive', mood: { joy: 2 }, attrEffect: { cleanliness: 3 } },
  { name: '追的剧更新了两集', category: 'positive', mood: { joy: 3, anticipation: 2 }, when: { timeband: ['evening', 'night'] } },
  { name: '奶茶第二杯半价', category: 'positive', mood: { joy: 3 }, cost: 8 },
  { name: '路边的狗子冲我摇尾巴', category: 'positive', mood: { joy: 3 }, mayTriggerProactive: true },
  { name: '随手拍的照片意外很好看', category: 'positive', mood: { joy: 2, surprise: 1 } },

  // —— neutral 日常涟漪 10 ——
  { name: '突然下雨了', category: 'neutral', mood: { surprise: 2 } },
  { name: '看到一条新闻想起了往事', category: 'neutral', mood: {} },
  { name: '电梯里遇到了邻居', category: 'neutral', mood: {} },
  { name: '排队的队特别长', category: 'neutral', mood: { anticipation: -2 } },
  { name: '手机推送了一条老歌回忆', category: 'neutral', mood: {} },
  { name: '今天的天气不冷不热', category: 'neutral', mood: { joy: 1 } },
  { name: '快递比预计的晚了一天', category: 'neutral', mood: { anticipation: -1 } },
  { name: '楼道灯闪了一下', category: 'neutral', mood: { fear: 1 }, when: { timeband: ['night'] } },
  { name: '午休时间不知不觉刷久了手机', category: 'neutral', mood: {}, attrEffect: { spirit: -2 } },
  { name: '冰箱发出了一点嗡嗡声', category: 'neutral', mood: {} },

  // —— negative 小倒霉 12 ——
  { name: '切菜的时候不小心切到手', category: 'negative', mood: { sadness: 4 }, attrEffect: { health: -5 }, consumes: ['创可贴'] },
  { name: '突然肚子有点疼', category: 'negative', mood: { sadness: 3 }, attrEffect: { health: -4 }, consumes: ['肠胃药'] },
  { name: '手机没电了', category: 'negative', mood: { anger: 3 } },
  { name: '路上堵了很久的车', category: 'negative', mood: { anger: 5 }, attrEffect: { spirit: -3 }, when: { timeband: ['morning', 'evening'] } },
  { name: '走路被鸽子屎砸中', category: 'negative', mood: { anger: 4, sadness: 2 }, attrEffect: { cleanliness: -8 } },
  { name: '洗碗的时候打碎了一个盘子', category: 'negative', mood: { sadness: 3 }, consumes: ['盘子'] },
  { name: '网购的东西和图片差距太大', category: 'negative', mood: { sadness: 3, anger: 2 } },
  { name: '出门忘带钥匙折返了一趟', category: 'negative', mood: { anger: 3 }, attrEffect: { stamina: -3 } },
  { name: '牛奶过期了才发现', category: 'negative', mood: { sadness: 2 }, consumes: ['牛奶'] },
  { name: '被楼上装修的声音吵到头疼', category: 'negative', mood: { anger: 4 }, attrEffect: { spirit: -4 }, when: { timeband: ['morning', 'afternoon'] } },
  { name: '袜子破了个洞', category: 'negative', mood: { sadness: 1 } },
  { name: '下台阶踩空差点摔跤', category: 'negative', mood: { fear: 4, surprise: 2 }, attrEffect: { health: -2 } },

  // —— 🆕 social 社交向 12 ——
  { name: '老朋友突然发来消息问候', category: 'social', mood: { joy: 4, surprise: 2 }, mayTriggerProactive: true, memorySalience: 3 },
  { name: '同事分享了零食', category: 'social', mood: { joy: 2 }, when: { activityCategory: ['work'] } },
  { name: '妈妈打来电话叮嘱多穿点', category: 'social', mood: { joy: 3 }, memorySalience: 2 },
  { name: '店员夸今天的穿搭好看', category: 'social', mood: { joy: 3 } },
  { name: '网友在动态下留言互动', category: 'social', mood: { joy: 2 }, when: { timeband: ['evening', 'night'] } },
  { name: '收到群发的节日祝福', category: 'social', mood: { joy: 2 }, when: { season: ['winter', 'spring'] } },
  { name: '邻居顺手帮忙收了快递', category: 'social', mood: { joy: 2, surprise: 1 } },
  { name: '和很久没聊的同学叙了叙旧', category: 'social', mood: { joy: 3 }, memorySalience: 2 },
  { name: '被拉进一个兴趣交流群', category: 'social', mood: { surprise: 2, anticipation: 2 } },
  { name: '朋友推荐了一部很好看的片子', category: 'social', mood: { joy: 2, anticipation: 2 } },
  { name: '给家人寄了点特产', category: 'social', mood: { joy: 3 }, cost: 60, memorySalience: 2 },
  { name: '外卖小哥说了句"祝您用餐愉快"', category: 'social', mood: { joy: 1 } },

  // —— 🆕 milestone 里程碑 8 ——
  { name: '存款跨过了一个整数关口', category: 'milestone', mood: { joy: 5 }, memorySalience: 5, mayTriggerProactive: true },
  { name: '坚持早起满一个月了', category: 'milestone', mood: { joy: 4 }, memorySalience: 4 },
  { name: '画完了酝酿很久的那幅画', category: 'milestone', mood: { joy: 5, anticipation: -2 }, memorySalience: 5, mayTriggerProactive: true },
  { name: '读完书架上最后一本没看的书', category: 'milestone', mood: { joy: 4 }, memorySalience: 4 },
  { name: '体重终于回到目标线', category: 'milestone', mood: { joy: 4 }, memorySalience: 4 },
  { name: '解锁了一道新菜的做法', category: 'milestone', mood: { joy: 3 }, memorySalience: 3 },
  { name: '连续运动打卡第 30 天', category: 'milestone', mood: { joy: 4 }, memorySalience: 4 },
  { name: '房间里每个角落都收拾得干干净净', category: 'milestone', mood: { joy: 3 }, attrEffect: { cleanliness: 6 }, memorySalience: 3 },

  // —— 消费物品联动 10 ——
  { name: '化妆品见底了该补货', category: 'neutral', mood: {}, when: { season: ['spring', 'summer', 'autumn', 'winter'] } },
  { name: '看中一件超出预算的外套', category: 'neutral', mood: { sadness: 2, anticipation: 2 }, memorySalience: 2 },
  { name: '购物车里的东西降价了', category: 'positive', mood: { joy: 3, surprise: 2 } },
  { name: '忍不住点了份夜宵', category: 'neutral', mood: { joy: 2, sadness: 1 }, cost: 20, when: { timeband: ['night'] } },
  { name: '顺便帮同事带了杯咖啡', category: 'social', mood: { joy: 2 }, cost: 15, when: { activityCategory: ['work'] } },
  { name: '囤货的洗衣液正好用完', category: 'neutral', mood: {} },
  { name: '给房间添了个小摆件', category: 'positive', mood: { joy: 3 }, cost: 35 },
  { name: '公交卡余额不足充值了一下', category: 'neutral', mood: {}, cost: 50 },
  { name: '换成无线充电器后桌面清爽多了', category: 'positive', mood: { joy: 2 } },
  { name: '订阅的会员到期没有续', category: 'neutral', mood: { sadness: 1 } },

  // —— 健康天气 8 ——
  { name: '换季降温感觉要感冒', category: 'negative', mood: { sadness: 2 }, attrEffect: { health: -4 }, consumes: ['感冒药'], when: { season: ['spring', 'autumn', 'winter'] } },
  { name: '久坐之后腰有点酸', category: 'negative', mood: {}, attrEffect: { health: -3, stamina: -2 }, when: { activityCategory: ['work', 'leisure'] } },
  { name: '今天紫外线特别强', category: 'neutral', mood: {}, when: { season: ['summer'] } },
  { name: '下了第一场雪', category: 'positive', mood: { joy: 4, surprise: 3 }, when: { season: ['winter'] }, mayTriggerProactive: true, memorySalience: 3 },
  { name: '空气里都是柳絮', category: 'neutral', mood: { anger: 1 }, when: { season: ['spring'] } },
  { name: '台风天窝在家里最安心', category: 'neutral', mood: { joy: 1 }, when: { season: ['summer', 'autumn'] } },
  { name: '秋高气爽适合出门走走', category: 'positive', mood: { joy: 2 }, when: { season: ['autumn'] } },
  { name: '闷热得一点胃口都没有', category: 'negative', mood: { sadness: 2 }, attrEffect: { stamina: -2 }, when: { season: ['summer'] } },
];

/** 🆕 D4: 用户/AI 提案批准入池的自定义事件（localStorage 持久化，schema 与内置一致） */
const CUSTOM_EVENTS_KEY = 'aiLifeCustomRandomEvents:v1';

export function getCustomRandomEvents(): RandomEventDef[] {
  try {
    const raw = localStorage.getItem(CUSTOM_EVENTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as RandomEventDef[];
      return Array.isArray(arr) ? arr : [];
    }
  } catch { /* 静默 */ }
  return [];
}

export function addCustomRandomEvent(def: RandomEventDef): void {
  const list = getCustomRandomEvents();
  if (list.some((e) => e.name === def.name)) return;
  list.push(def);
  try { localStorage.setItem(CUSTOM_EVENTS_KEY, JSON.stringify(list.slice(-100))); } catch { /* 静默 */ }
}

/** C4: 条件过滤 + 加权抽签（milestone 稀有：低权重出场、高权重入记忆）+ D1 探索提权 + D4 自定义池 */
function pickEvent(currentActivityCategory?: string): RandomEventDef {
  const tb = currentTimeband();
  const season = currentSeason();
  const pool = [...getCustomRandomEvents(), ...RANDOM_EVENTS].filter((e) => {
    const w = e.when;
    if (!w) return true;
    if (w.timeband && !w.timeband.includes(tb)) return false;
    if (w.season && !w.season.includes(season)) return false;
    if (w.activityCategory && (!currentActivityCategory || !w.activityCategory.includes(currentActivityCategory))) return false;
    return true;
  });
  const usable = pool.length > 0 ? pool : RANDOM_EVENTS;
  // 权重基线：milestone 0.35（稀有）、social 1.2、其余 1.0；D1: 从未抽中 1.6× / 超3天未中 ×2 累进封顶8 / 近12h 刚中 0.5×
  const weights = usable.map((e) => {
    let w = e.category === 'milestone' ? 0.35 : e.category === 'social' ? 1.2 : 1.0;
    w *= boostFactor(`evt:${e.name}`);
    return w;
  });
  const picked = weightedPick(usable, weights);
  if (picked) recordPick(`evt:${picked.name}`);
  return picked;
}

/** D1 审计用：自定义 + 内置随机事件名全集 */
export function auditRandomEventKeys(): string[] {
  return [...getCustomRandomEvents().map((e) => e.name), ...RANDOM_EVENTS.map((e) => e.name)];
}

/**
 * 随机事件触发概率（常驻化）：忽略 frequency 档位，固定为基础概率，
 * 确保随机事件在模拟中始终活跃、持续触发，不再因频率设置偏低而长期不出现。
 */
function eventChance(_frequency: string): number {
  return 0.25;
}

const MOOD_KEYS = new Set(['joy', 'sadness', 'anger', 'fear', 'surprise', 'anticipation']);

/**
 * AI 现编随机事件（生成设置中开启「AI 随机事件」时启用）：
 * 返回 null 表示失败/关闭 → 回退本地事件池。
 */
async function generateAiEvent(characterId: string): Promise<RandomEventDef | null> {
  try {
    const store = useAiLifeStore.getState();
    if (!getCallSetting(store.config, 'randomEvent').enabled) return null;
    const char = useCharacterStore.getState().characters.find((c) => c.id === characterId);
    const curAct = store.currentActivity;
    const prompt = `你是「${char?.name || '角色'}」（人设：${char?.personality || ''}）。
你正在「${curAct?.name || '空闲'}」。请为你的生活现编一个刚刚发生的小事件。
输出 JSON（只输出 JSON 本身）：
{"name":"事件名（12字内）","category":"positive/neutral/negative 之一","moodKey":"joy/sadness/anger/fear/surprise/anticipation 之一","moodDelta":"-8到8的整数"}

要求：事件必须符合人设、当前活动与日常生活，具体而微小，不要夸张。`;
    const out = await runAilifeLlm('randomEvent', characterId, prompt, 160);
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { name?: string; category?: string; moodKey?: string; moodDelta?: number | string };
    const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 16) : '';
    if (!name) return null;
    const category = ['positive', 'neutral', 'negative'].includes(String(parsed.category))
      ? (parsed.category as RandomEventDef['category']) : 'neutral';
    const moodKey = MOOD_KEYS.has(String(parsed.moodKey)) ? String(parsed.moodKey) : '';
    let moodDelta = typeof parsed.moodDelta === 'number' ? parsed.moodDelta : parseInt(String(parsed.moodDelta ?? 0), 10);
    if (!Number.isFinite(moodDelta)) moodDelta = 0;
    moodDelta = Math.max(-8, Math.min(8, moodDelta));
    return {
      name,
      category,
      mood: moodKey && moodDelta !== 0 ? { [moodKey]: moodDelta } : {},
      attrEffect: category === 'negative' ? { spirit: -3 } : undefined,
    };
  } catch {
    return null;
  }
}

/** 每小时 tick 调用：概率触发随机事件并应用影响 */
export async function checkRandomEvent(characterId: string): Promise<void> {
  const store = useAiLifeStore.getState();
  const config = store.config;
  if (!config?.enabled) return;
  const chance = eventChance(config.eventFrequency);
  if (chance <= 0 || Math.random() >= chance) return;

  // 优先 AI 现编（生成设置可关），失败回退本地事件池（C4: 条件过滤 + 加权抽签）
  const curCat = store.currentActivity?.category;
  const event = (await generateAiEvent(characterId)) || pickEvent(curCat);
  useDebugLog.getState().add('ailife', `[AI-Life] 随机事件: ${event.name}（${event.category}）`, { characterId });
  // 🆕 B4: 事件流记账（memorySalience 供 D2 日记回灌时加权）
  recordLifeEvent({
    characterId,
    type: event.category === 'milestone' ? 'milestone' : 'random_event',
    description: `${event.name}（${event.category}）`,
    meta: { mood: event.mood, attrEffect: event.attrEffect, memorySalience: event.memorySalience ?? 1 },
  }).catch(() => {});

  // 🆕 C4: 花钱事件 → 直接写流水（不动余额明细以外的状态，简单可信）
  if (event.cost && event.cost > 0) {
    try {
      const { dbGetAiEconomy, dbSaveAiEconomy, dbAddAiTransaction } = await import('../../lib/tauriBridge');
      const eco = await dbGetAiEconomy(characterId);
      if (eco && eco.balance >= event.cost) {
        const nowIso = new Date().toISOString();
        await dbSaveAiEconomy({ ...eco, balance: Math.round((eco.balance - event.cost) * 100) / 100, monthlyExpense: eco.monthlyExpense + event.cost, updatedAt: nowIso });
        await dbAddAiTransaction({
          id: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          characterId,
          type: 'expense',
          amount: event.cost,
          description: `${event.name}｜AI：计划外的开销，小钱买心情。`,
          timestamp: nowIso,
        });
      }
    } catch { /* 静默 */ }
  }

  // 🆕 C4: 消耗物品（打碎盘子/用掉创可贴）→ 库存数量 -1（无此物品时跳过）
  if (event.consumes && event.consumes.length > 0) {
    try {
      const { dbGetAiInventory, dbSaveAiInventoryItems } = await import('../../lib/tauriBridge');
      const inv = await dbGetAiInventory(characterId);
      const touched: Awaited<ReturnType<typeof dbGetAiInventory>> = [];
      for (const nm of event.consumes) {
        const item = inv.find((i) => i.name.includes(nm) && i.quantity > 0);
        if (item) {
          item.quantity -= 1;
          touched.push(item);
        }
      }
      if (touched.length > 0) await dbSaveAiInventoryItems(touched);
    } catch { /* 静默 */ }
  }

  // 🆕 C4: 高显著事件可能主动分享给用户——经 B2 统一闸门
  if (event.mayTriggerProactive && Math.random() < 0.6) {
    try {
      const { checkGate, recordSent } = await import('../proactive/intentGate');
      const gate = checkGate({ source: 'ai-life', priority: 3, reason: `分享事件: ${event.name}`, characterId, payload: '' });
      if (gate.allowed) {
        const payload = `你刚刚遇到一件事：「${event.name}」。如果这件事值得分享，就给用户发一条短消息说说它（50字以内，口语自然）。`;
        const sent = await useProactiveReplyStore.getState().sendTaskMessage(characterId, payload);
        if (sent) recordSent({ source: 'ai-life', priority: 3, reason: `分享事件: ${event.name}`, characterId, payload: '' });
      } else {
        useDebugLog.getState().add('proactive', `[闸门] 事件分享被拦截: ${gate.reason}`, { characterId });
      }
    } catch { /* 静默 */ }
  }

  // 情绪影响
  if (event.mood && Object.keys(event.mood).length > 0) {
    try {
      const mind = useCharacterMindStore.getState();
      const cur = mind.getMultiEmotion(characterId);
      const values = { ...cur.values };
      for (const [k, delta] of Object.entries(event.mood)) {
        const key = k as keyof typeof values;
        if (typeof values[key] === 'number') {
          values[key] = Math.max(0, Math.min(100, (values[key] as number) + delta));
        }
      }
      mind.setMultiEmotion(characterId, { ...cur, values });
    } catch { /* 忽略 */ }
  }

  // 属性影响
  if (event.attrEffect) {
    try {
      const attrs = await loadAttributes(characterId);
      for (const [k, v] of Object.entries(event.attrEffect)) {
        attrs[k as 'health' | 'stamina' | 'cleanliness' | 'spirit'] += v as number;
      }
      await persistAttributes(characterId, attrs, `随机事件：${event.name}`);
    } catch { /* 忽略 */ }
  }
}

// ---------------- AI 主动变卦 ----------------

function spontaneousChangeChance(): number {
  let chance = 0.04;
  try {
    const char = useCharacterStore.getState().characters.find(
      (c) => c.id === useCharacterStore.getState().selectedCharacterId,
    );
    if (char?.personality && /外向|活泼|开朗|热情/.test(char.personality)) chance *= 1.8;
    if (char?.personality && /沉稳|安静|内向|稳重/.test(char.personality)) chance *= 0.6;
  } catch { /* ignore */ }
  return Math.min(chance, 0.12);
}

/**
 * tick 中调用：AI 主动变卦——替换未来第一个 planned 活动。
 * full 档由 LLM 回顾今天经历/聊天自主决定情绪转变与新安排；
 * 其余档位按主导情绪从兜底池选取（零成本）。
 */
export async function checkSpontaneousChange(characterId: string): Promise<void> {
  const store = useAiLifeStore.getState();
  if (!store.config?.enabled) return;
  if (Math.random() >= spontaneousChangeChance()) return;

  const nowIso = new Date().toISOString();
  const todayKey = localDateKey(nowIso);
  const acts = [...(store.dayActivities[todayKey] || [])];
  const idx = acts.findIndex((a) => a.status === 'planned' && a.category !== 'sleep');
  if (idx === -1) return;

  const target = acts[idx];

  // 面板头部可显示「AI 心情正在变化…」
  useAiLifeStore.setState({ isShifting: true });
  try {
    let mood: string;
    let reason: string;
    let name: string;
    let category: string;
    let desc: string;

    const char = useCharacterStore.getState().characters.find((c) => c.id === characterId);
    if (char && shouldUseLLMForProcess(store.config)) {
      try {
        const plan = await generateEmotionShiftPlan(char, characterId);
        ({ mood, reason, activityName: name, category, description: desc } = plan);
      } catch {
        // LLM 失败 → 情绪兜底池
        const domType = safeDominant(characterId);
        const alt = FALLBACK_SHIFTS[poolKeyOf(domType)];
        mood = alt.mood; reason = '突然想换个心情'; name = alt.activityName; category = alt.category; desc = alt.description;
      }
    } else {
      const domType = safeDominant(characterId);
      const alt = FALLBACK_SHIFTS[poolKeyOf(domType)];
      mood = alt.mood; reason = '突然想换个心情'; name = alt.activityName; category = alt.category; desc = alt.description;
    }

    target.isChanged = true;
    target.changedFrom = target.changedFrom || target.name;
    target.changedReason = reason;
    target.name = name;
    target.category = category;
    target.mood = mood;
    target.processDescription = desc;
    target.updatedAt = nowIso;

    await dbBatchSaveAiActivities([target]);
    store.setDayActivities(todayKey, acts);
    useDebugLog.getState().add('ailife', `[AI-Life] AI 主动变卦 → ${name}（${reason}）`, { characterId });
    // 🆕 B4: 事件流记账（变卦）
    recordLifeEvent({ characterId, type: 'plan_change', description: `本来计划「${target.changedFrom}」，${reason}，改成了「${name}」`, activityId: target.id, meta: { mood, reason } }).catch(() => {});
  } finally {
    useAiLifeStore.setState({ isShifting: false });
  }
}

function safeDominant(characterId: string): string {
  try {
    return useCharacterMindStore.getState().getDominantEmotion(characterId)?.type || 'joy';
  } catch { return 'joy'; }
}

function poolKeyOf(domType: string): 'sad' | 'excited' | 'happy' {
  return ['sadness', 'anger', 'fear'].includes(domType) ? 'sad'
    : (['surprise', 'anticipation'].includes(domType) ? 'excited' : 'happy');
}

// ---------------- 用户打断 ----------------

const INTERRUPT_KEYWORDS = ['陪我去', '出来玩', '一起吃', '来我家', '见一面', '陪我聊', '别忙了', '休息一下吧'];

/**
 * 用户发消息时调用：邀请类关键词 + 好感度决定接受率。
 * 接受则当前活动标记 interrupted，插入「和用户在一起」活动。
 * 返回是否发生了打断（供 prompt 提示）。
 */
export async function handleUserInterruptRequest(characterId: string, userMessage: string): Promise<boolean> {
  const store = useAiLifeStore.getState();
  if (!store.config?.enabled) return false;
  if (!INTERRUPT_KEYWORDS.some((k) => userMessage.includes(k))) return false;

  const nowIso = new Date().toISOString();
  const todayKey = localDateKey(nowIso);
  const acts = [...(store.dayActivities[todayKey] || [])];
  const curIdx = acts.findIndex((a) => a.status === 'ongoing' && a.category !== 'sleep' && a.category !== 'social');
  if (curIdx === -1) return false;

  let acceptChance = 0.4;
  try {
    const level = useCharacterMindStore.getState().getAffinity(characterId)?.level ?? 0;
    acceptChance = level < -20 ? 0.15 : level < 20 ? 0.35 : level < 50 ? 0.55 : level < 80 ? 0.75 : 0.9;
  } catch { /* ignore */ }

  if (Math.random() >= acceptChance) {
    useDebugLog.getState().add('system', '[AI-Life] 用户邀请被婉拒（继续当前活动）', { characterId });
    return false;
  }

  const target = acts[curIdx];
  const interrupted: AiLifeActivity = {
    ...target,
    status: 'interrupted',
    isChanged: true,
    changedReason: '答应了用户的邀请',
    updatedAt: nowIso,
  };
  const companionAct: AiLifeActivity = {
    id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    characterId,
    name: '和用户在一起',
    category: 'social',
    startTime: nowIso,
    endTime: interrupted.endTime,
    sceneId: interrupted.sceneId,
    status: 'ongoing',
    processDescription: '放下手头的事，和用户聊了起来。',
    summary: '',
    mood: '开心',
    location: interrupted.location,
    weather: '',
    isChanged: true,
    changedFrom: '',
    changedReason: '用户邀请',
    replacedBy: '',
    comments: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  acts[curIdx] = interrupted;
  acts.splice(curIdx + 1, 0, companionAct);
  await dbBatchSaveAiActivities([interrupted, companionAct]);
  store.setDayActivities(todayKey, acts);
  store.setCurrentActivity(companionAct);
  useDebugLog.getState().add('system', '[AI-Life] 用户打断了当前活动 → 和用户在一起', { characterId });
  // 🆕 B4: 事件流记账（用户打断）
  recordLifeEvent({ characterId, type: 'plan_change', description: `答应了用户的邀请，放下了「${interrupted.changedFrom || '手头的事'}」`, activityId: companionAct.id, meta: { reason: '用户邀请' } }).catch(() => {});
  return true;
}
