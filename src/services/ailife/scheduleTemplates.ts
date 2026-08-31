/**
 * ============================================================
 * AI 一日 · 日程模板与时间工具
 *  - 工作日/周末智能本地模板（无 AI 也能生成有个性的日程）：
 *    · 种子随机：同一角色同一天计划稳定，不同天自然变化
 *    · 作息解析：从 routine 文本识别夜猫子/早起/上班时间
 *    · 职业映射：学生→上课自习 / 自由职业→创作 / 咖啡师→班次…
 *    · 情绪偏置：主导情绪影响休闲选择与心情着色
 *    · 爱好注入：likes 生成专属爱好时段；口头禅偶尔入描述
 *    · 世界包池：休闲/社交活动名优先取自世界设定
 *  - 统一的本地时区日期键工具
 * ============================================================
 */
import type { AiLifeActivity, WorldConfigRecord } from '../../lib/tauriBridge';
import type { Character } from '../../types';
import { sanitizeActivityAgainstWorld } from './worldConfig';

/** 小时制日程模板槽位（category 对齐设计文档枚举） */
export interface ScheduleTemplateSlot {
  name: string;
  category: string;
  startHour: number;
  startMin: number;
  endHour: number;
  endMin: number;
  scene: string;
  mood: string;
  description: string;
}

export const WEEKDAY_TEMPLATE: ScheduleTemplateSlot[] = [
  { name: '睡觉', category: 'sleep', startHour: 0, startMin: 0, endHour: 7, endMin: 0, scene: '卧室', mood: '安宁', description: '沉睡中，一夜无梦。' },
  { name: '起床洗漱', category: 'personal_care', startHour: 7, startMin: 0, endHour: 7, endMin: 30, scene: '卫生间', mood: '清醒', description: '闹钟响起，洗漱整理，迎接新的一天。' },
  { name: '做早餐', category: 'meal', startHour: 7, startMin: 30, endHour: 8, endMin: 0, scene: '厨房', mood: '平静', description: '准备一份简单的早餐。' },
  { name: '吃早餐', category: 'meal', startHour: 8, startMin: 0, endHour: 8, endMin: 30, scene: '餐厅', mood: '满足', description: '慢慢享用早餐，顺便浏览一下新闻。' },
  { name: '上午工作', category: 'work', startHour: 8, startMin: 30, endHour: 12, endMin: 0, scene: '工作区', mood: '专注', description: '处理邮件、参加会议、推进项目。' },
  { name: '午餐与午休', category: 'rest', startHour: 12, startMin: 0, endHour: 13, endMin: 30, scene: '餐厅/客厅', mood: '放松', description: '午餐后小憩片刻。' },
  { name: '下午工作', category: 'work', startHour: 13, startMin: 30, endHour: 18, endMin: 0, scene: '工作区', mood: '投入', description: '继续下午的工作，处理各种事务。' },
  { name: '运动锻炼', category: 'leisure', startHour: 18, startMin: 0, endHour: 19, endMin: 0, scene: '健身房/户外', mood: '活力', description: '跑步或力量训练，保持身体活力。' },
  { name: '晚餐时间', category: 'meal', startHour: 19, startMin: 0, endHour: 20, endMin: 0, scene: '餐厅', mood: '满足', description: '做一顿可口的晚餐，慢慢享用。' },
  { name: '休闲时光', category: 'leisure', startHour: 20, startMin: 0, endHour: 22, endMin: 0, scene: '客厅', mood: '愉快', description: '看书、追剧或和朋友聊天。' },
  { name: '洗漱准备休息', category: 'personal_care', startHour: 22, startMin: 0, endHour: 23, endMin: 0, scene: '卫生间/卧室', mood: '放松', description: '洗个热水澡，回顾今天的点滴。' },
  { name: '睡觉', category: 'sleep', startHour: 23, startMin: 0, endHour: 24, endMin: 0, scene: '卧室', mood: '安宁', description: '放下手机，让一天的疲惫在睡眠中消散。' },
];

export const WEEKEND_TEMPLATE: ScheduleTemplateSlot[] = [
  { name: '睡觉', category: 'sleep', startHour: 0, startMin: 0, endHour: 9, endMin: 0, scene: '卧室', mood: '安宁', description: '周末的懒觉，睡到自然醒。' },
  { name: '悠闲早午餐', category: 'meal', startHour: 9, startMin: 0, endHour: 10, endMin: 30, scene: '厨房/餐厅', mood: '惬意', description: '不紧不慢地做一顿丰盛的早午餐。' },
  { name: '自由阅读', category: 'leisure', startHour: 10, startMin: 30, endHour: 12, endMin: 0, scene: '书房', mood: '专注', description: '翻阅喜欢的书，享受安静的上午。' },
  { name: '午休', category: 'rest', startHour: 12, startMin: 0, endHour: 14, endMin: 0, scene: '客厅', mood: '轻松', description: '午餐后在沙发上小憩。' },
  { name: '外出逛街', category: 'social', startHour: 14, startMin: 0, endHour: 17, endMin: 0, scene: '商场/公园', mood: '愉悦', description: '出门走走，逛逛街或者去公园转转。' },
  { name: '晚餐时间', category: 'meal', startHour: 17, startMin: 30, endHour: 19, endMin: 0, scene: '餐厅', mood: '满足', description: '尝试做一道新菜作为晚餐。' },
  { name: '观影/游戏', category: 'leisure', startHour: 19, startMin: 0, endHour: 22, endMin: 0, scene: '客厅', mood: '愉快', description: '看一部电影或玩一会儿游戏。' },
  { name: '洗漱准备休息', category: 'personal_care', startHour: 22, startMin: 0, endHour: 23, endMin: 0, scene: '卫生间/卧室', mood: '放松', description: '洗澡换睡衣，为明天充电。' },
  { name: '睡觉', category: 'sleep', startHour: 23, startMin: 0, endHour: 24, endMin: 0, scene: '卧室', mood: '安宁', description: '结束充实的一天。' },
];

// ---------------- 时间工具（全部以本地时区为准） ----------------

export function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** 本地日期键：yyyy-MM-dd（Date 或 ISO 字符串均可） */
export function localDateKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function dateStr(d: Date): string {
  return localDateKey(d);
}

/** 某日活动的 UTC 时间范围 [本地零点Z, 次日本地零点Z) —— 与库内 start_time(UTC) 一致，供按天范围查询 */
export function dayRange(date: string): [string, string] {
  const from = new Date(`${date}T00:00:00`);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  return [from.toISOString(), to.toISOString()];
}

/** 指定日本地时分 → UTC ISO（小时允许溢出进位，24:00 → 次日 00:00） */
export function isoAt(day: Date, hour: number, min: number): string {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, min, 0);
  return d.toISOString();
}

/** ISO 时间戳的分钟数（自当日零点起算，本地时区），支持 24:00 进位语义 */
export function minutesOf(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function getTemplateFor(date: Date): ScheduleTemplateSlot[] {
  const day = date.getDay();
  return (day === 0 || day === 6) ? WEEKEND_TEMPLATE : WEEKDAY_TEMPLATE;
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------- 🆕 智能本地方案（无 AI 也能生成有个性的日程） ----------------

/** 字符串哈希（种子源） */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 种子随机数（确定性，同种子同序列） */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 本地方案上下文：传入越多人设信息，日程越有个性 */
export interface LocalPlanContext {
  character?: Character;
  profile?: { job?: string; routine?: string };
  emotionType?: string;
  emotionIntensity?: number;
  /** 🆕 C2/D1: 预构建的加权消遣池（含已购耐用品解锁项与状态系数），由 scheduleGenerator 异步组装 */
  weightedLeisureNames?: Array<{ name: string; weight: number }>;
}

/** 🆕 C2: 从加权池种子抽签（同日稳定）；未提供池时返回 null 走旧逻辑 */
function pickWeightedLeisure(ctx: LocalPlanContext | undefined, rng: () => number): string | null {
  const pool = ctx?.weightedLeisureNames;
  if (!pool || pool.length === 0) return null;
  const total = pool.reduce((s, e) => s + (e.weight > 0 ? e.weight : 0.0001), 0);
  let r = rng() * total;
  for (const e of pool) {
    r -= e.weight > 0 ? e.weight : 0.0001;
    if (r <= 0) return e.name;
  }
  return pool[pool.length - 1].name;
}

/** 从 routine/personality 文本解析作息偏好 */
function parseRoutine(text: string, rng: () => number): { wake: number; nightOwl: boolean } {
  const nightOwl = /夜猫|晚睡|熬夜|凌晨睡/.test(text);
  const earlyBird = /早起|早睡|清晨/.test(text);
  let wake = nightOwl ? 8.5 + rng() * 1.0 : earlyBird ? 6.4 + rng() * 0.4 : 7.0 + rng() * 0.7;
  const m = text.match(/(\d{1,2})\s*[点时:：]\s*(?:半)?\s*(?:起床|起|醒)/);
  if (m) wake = Math.max(5, Math.min(11, parseInt(m[1], 10) + (rng() * 0.5 - 0.2)));
  return { wake, nightOwl };
}

/** 职业 → 工作时段名称/场景 */
function workSlotFor(job: string, rng: () => number): { name: string; scene: string } {
  const j = job || '';
  if (/学生|大学|高中|初中|读/.test(j)) return { name: rng() > 0.5 ? '上课' : '自习', scene: '教室/图书馆' };
  if (/画|设计|插画|写作|创作|漫画|自由/.test(j)) return { name: '自由创作', scene: '工作室/家' };
  if (/咖啡|店员|服务/.test(j)) return { name: '咖啡店班次', scene: '咖啡店' };
  if (/程序|开发|工程|程序媛?|程序員/.test(j)) return { name: '写代码', scene: '工作区' };
  if (/医生|护士/.test(j)) return { name: '坐诊/查房', scene: '医院' };
  if (/老师|教师/.test(j)) return { name: '备课与授课', scene: '学校' };
  if (/主播|UP主|博主|视频/.test(j)) return { name: '剪辑与直播', scene: '家' };
  if (/音乐|歌手|琴/.test(j)) return { name: '练琴与编曲', scene: '工作室' };
  return { name: rng() > 0.5 ? '处理工作' : '专注工作', scene: '工作区' };
}

/** 爱好 → 休闲活动名 */
function hobbyFrom(likes: string[], rng: () => number): string | null {
  const table: Array<[RegExp, string[]]> = [
    [/猫|猫咪/, ['陪猫玩', '撸猫时刻']],
    [/狗/, ['遛狗']],
    [/咖啡/, ['手冲咖啡']],
    [/音乐|歌|琴/, ['听歌', '弹琴']],
    [/游戏|电竞/, ['打游戏']],
    [/画|绘|漫/, ['画画']],
    [/书|阅读|小说/, ['读书']],
    [/运动|健身|跑/, ['运动锻炼']],
    [/电影|影|剧/, ['看电影']],
    [/料理|烹饪|烘培|甜点/, ['研究新菜谱']],
    [/花|植物|园/, ['打理植物']],
    [/拍照|摄影/, ['出门拍照']],
  ];
  const hits: string[] = [];
  for (const like of likes) {
    for (const [re, names] of table) {
      if (re.test(like)) hits.push(...names);
    }
  }
  if (hits.length === 0) return null;
  return hits[Math.floor(rng() * hits.length)];
}

/** 世界包活动池取名（优先），否则用默认池 */
function pickLeisure(world: WorldConfigRecord | null | undefined, rng: () => number): string | null {
  const pools = world?.config.activities;
  const pool = [...(pools?.leisure || []), ...(pools?.daily || [])];
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)];
}

function rnd<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** 世界地点类别关键词：把「睡觉/工作/休闲…」这类日程语义映射到世界包里语义贴合的地点 */
const CATEGORY_LOCATION_RE: Record<string, RegExp> = {
  sleep: /旅店|客栈|旅馆|宿|住所|寝|巢|舍|馆|宫|屋|房|营地|窝/,
  personal_care: /浴|温泉|洗漱|房|宫|馆/,
  meal: /餐厅|食堂|酒馆|茶馆|料亭|咖啡|酒吧|食|店|坊|馆/,
  work: /总部|协会|公会|教令院|工坊|学院|大学|所|府|局|图|机|研究|办公|公会/,
  leisure: /公园|广场|城|镇|街|港|湖|山|滩|温泉|竞技场|大门|馆|社/,
  social: /城|镇|酒馆|会|节|店|馆|广场|竞技场|庙|祭/,
  rest: /城|镇|馆|宫殿|谷|家|居|店/,
  travel: /港|门|疆|城|镇|洞|路|渡口|关/,
  special: /秘境|遗迹|洞|关|军|界|边境|陷阱|副本/,
};

/**
 * 世界包场景映射：为某类活动从世界地点池挑选语义贴合的地点。
 * 只在模板场景不被世界包认可（sanitize 会回退）时调用，替代"一律回退第 0 个地点"
 * 的坍缩问题，让场景真正贴合所选世界观。
 */
export function worldSceneFor(
  world: WorldConfigRecord | null | undefined,
  category: string,
  rng: () => number,
): string {
  const locs = world?.config.locations || [];
  if (locs.length === 0) return '家';
  const re = CATEGORY_LOCATION_RE[category] || /城|镇|馆|店/;
  const matched = locs.filter((l) => re.test(l));
  if (matched.length > 0) return rnd(rng, matched);
  // 稳定回退：按类别哈希分散到不同地点，避免所有场景都坍缩到同一处
  return locs[hashStr(`${category}|loc`) % locs.length];
}

/** 情绪 → 休闲偏好与心情着色 */
function emotionTint(emotionType?: string, intensity?: number): { leisureBias: string[]; moods: string[]; active: boolean } {
  if (!emotionType || (intensity ?? 0) < 30) return { leisureBias: [], moods: [], active: false };
  switch (emotionType) {
    case 'sadness': case 'loneliness': return { leisureBias: ['听歌', '散步', '写日记', '发呆'], moods: ['安静', '低落'], active: false };
    case 'anger': case 'disgust': return { leisureBias: ['运动锻炼', '打游戏'], moods: ['烦躁'], active: true };
    case 'joy': case 'love': return { leisureBias: ['出门逛街', '找朋友玩', '拍照'], moods: ['愉快', '甜甜的'], active: true };
    case 'anticipation': case 'curiosity': return { leisureBias: ['研究新菜谱', '读书', '出门拍照'], moods: ['期待'], active: true };
    case 'anxiety': case 'fear': return { leisureBias: ['听歌', '发呆'], moods: ['不安'], active: false };
    default: return { leisureBias: [], moods: [], active: false };
  }
}

/**
 * 🆕 智能本地方案：不调用任何 API，基于人设/作息/职业/爱好/情绪/世界包
 * 生成有个性的全天日程。同角色同日期结果稳定（种子随机），不同日期自然变化。
 */
export function buildDaySchedule(
  characterId: string,
  date: Date,
  world?: WorldConfigRecord | null,
  ctx?: LocalPlanContext,
): AiLifeActivity[] {
  const nowIso = new Date().toISOString();
  const rng = mulberry32(hashStr(`${characterId}|${localDateKey(date)}`));
  const ch = ctx?.character;
  const routineText = `${ctx?.profile?.routine || ''} ${ch?.personality || ''}`;
  const { wake } = parseRoutine(routineText, rng);
  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
  const tint = emotionTint(ctx?.emotionType, ctx?.emotionIntensity);
  const hobby = hobbyFrom(ch?.likes || [], rng);
  const jobPart = ctx?.profile?.job || '';

  type Draft = { name: string; category: string; from: number; to: number; scene: string; mood: string; desc: string };
  const drafts: Draft[] = [];
  const H = 60; // 小时→分钟

  const weekendWake = Math.min(11, wake + 1.2 + rng() * 0.8);
  const wakeH = isWeekend ? weekendWake : wake;

  const catchphrase = () => {
    const list = ch?.catchphrases || [];
    if (list.length > 0 && rng() < 0.16) return ` ${list[Math.floor(rng() * list.length)]}`;
    return '';
  };

  // —— 夜间睡眠（0:00 → 醒来）——
  drafts.push({
    name: '睡觉', category: 'sleep', from: 0, to: wakeH, scene: '卧室', mood: '安宁',
    desc: isWeekend ? '周末的懒觉，睡到自然醒。' : (rng() > 0.5 ? '沉睡中，一夜无梦。' : '睡得很沉，做了个小小的梦。'),
  });
  // —— 洗漱 ——
  drafts.push({
    name: '起床洗漱', category: 'personal_care', from: wakeH, to: wakeH + 0.5, scene: '卫生间', mood: '清醒',
    desc: rng() > 0.5 ? '洗漱整理，让自己清醒过来。' : '刷牙洗脸，对着镜子深呼吸一口。',
  });
  // —— 早餐 ——
  drafts.push({
    name: isWeekend ? '悠闲早午餐' : '吃早餐', category: 'meal', from: wakeH + 0.5, to: wakeH + 1.2, scene: '厨房/餐厅', mood: '满足',
    desc: isWeekend ? '不紧不慢地做一顿丰盛的早午餐。' : `简单吃了点早餐${catchphrase()}`,
  });

  if (!isWeekend) {
    const work = workSlotFor(jobPart, rng);
    const workStart = Math.max(wakeH + 1.2, 8 + rng() * 1);
    if (workStart > wakeH + 1.3) {
      drafts.push({ name: '晨间自由时光', category: 'leisure', from: wakeH + 1.2, to: workStart, scene: '客厅', mood: '惬意', desc: '工作前的一点自由时间，慢一点开始。' });
    }
    drafts.push({ name: `上午·${work.name}`, category: 'work', from: workStart, to: 12, scene: work.scene, mood: '专注', desc: `上午的${work.name}时间，按自己的节奏推进。` });
    drafts.push({ name: '午餐与午休', category: 'rest', from: 12, to: 13.5, scene: '餐厅/客厅', mood: '放松', desc: '午餐后眯了一会儿，恢复精力。' });
    drafts.push({ name: `下午·${work.name}`, category: 'work', from: 13.5, to: 18, scene: work.scene, mood: '投入', desc: `下午继续${work.name}，偶尔走神看了看窗外。` });
  } else {
    const amName = pickWeightedLeisure(ctx, rng) || hobby || pickLeisure(world, rng) || '自由阅读';
    drafts.push({ name: `上午·${amName}`, category: 'leisure', from: wakeH + 1.2, to: 12, scene: '书房/客厅', mood: tint.moods[0] || '惬意', desc: `上午做点喜欢的事：${amName}。${catchphrase()}` });
    drafts.push({ name: '午休', category: 'rest', from: 12, to: 14, scene: '客厅', mood: '轻松', desc: '午餐后在沙发上小憩。' });
    const outName = tint.leisureBias.length > 0 && rng() < 0.5 ? tint.leisureBias[Math.floor(rng() * tint.leisureBias.length)] : (pickLeisure(world, rng) || '外出走走');
    drafts.push({ name: `下午·${outName}`, category: 'social', from: 14, to: 17, scene: '商场/公园', mood: tint.moods[0] || '愉悦', desc: `下午出门${outName}，换换空气。` });
  }

  // —— 傍晚：运动或爱好 ——
  const eveName = pickWeightedLeisure(ctx, rng) || hobby || (tint.active && tint.leisureBias.length > 0 ? tint.leisureBias[Math.floor(rng() * tint.leisureBias.length)] : (pickLeisure(world, rng) || (rng() > 0.5 ? '运动锻炼' : '出门散步')));
  drafts.push({
    name: eveName, category: /运动|跑|健身/.test(eveName) ? 'leisure' : 'leisure',
    from: isWeekend ? 17 : 18, to: (isWeekend ? 17 : 18) + 1, scene: '健身房/户外', mood: tint.moods[0] || '活力',
    desc: `傍晚${eveName}，出点汗感觉不错。${catchphrase()}`,
  });
  // —— 晚餐 ——
  drafts.push({ name: '晚餐时间', category: 'meal', from: (isWeekend ? 17 : 18) + 1, to: (isWeekend ? 17 : 18) + 2, scene: '餐厅', mood: '满足', desc: rng() > 0.5 ? '做一顿可口的晚餐，慢慢享用。' : '晚饭简单吃点，回味今天的事。' });
  // —— 夜间休闲（情绪/爱好/世界池） ——
  const nightName = tint.leisureBias.length > 0 && rng() < 0.6 ? tint.leisureBias[Math.floor(rng() * tint.leisureBias.length)] : (pickWeightedLeisure(ctx, rng) || pickLeisure(world, rng) || '休闲时光');
  drafts.push({
    name: `夜间·${nightName}`, category: 'leisure', from: (isWeekend ? 17 : 18) + 2, to: 22, scene: '客厅', mood: tint.moods[0] || '愉快',
    desc: `晚上${nightName}，属于自己的一段时间。`,
  });
  // —— 洗漱 + 入睡 ——
  drafts.push({ name: '洗漱准备休息', category: 'personal_care', from: 22, to: 23, scene: '卫生间/卧室', mood: '放松', desc: '洗个热水澡，把今天整理进心里。' });
  drafts.push({ name: '睡觉', category: 'sleep', from: 23, to: 24, scene: '卧室', mood: '安宁', desc: '放下手机，让一天在睡眠里收尾。' });

  // —— 组装（保证时序合法、无重叠） ——
  let lastEnd = -1;
  return drafts.map((d) => {
    const from = Math.max(lastEnd, d.from * H);
    const to = Math.max(from + 15, d.to * H); // 每段至少 15 分钟
    lastEnd = to;
    const startTime = isoAt(date, Math.floor(from / H), Math.round(from % H));
    const endTime = isoAt(date, Math.floor(to / H), Math.round(to % H));
    let status: AiLifeActivity['status'] = 'planned';
    if (endTime <= nowIso) status = 'completed';
    else if (startTime <= nowIso) status = 'ongoing';
    // 场景贴合世界包：模板场景在世界包里 → 保留；否则按类别映射到世界包里语义贴合的地点
    const baseScene = d.scene;
    const sanitizedScene = sanitizeActivityAgainstWorld(baseScene, world || null);
    const scene = sanitizedScene === baseScene ? baseScene : worldSceneFor(world || null, d.category, rng);
    return {
      id: genId('act'),
      characterId,
      name: d.name,
      category: d.category,
      startTime,
      endTime,
      sceneId: scene,
      status,
      processDescription: '',
      summary: '',
      mood: d.mood,
      location: scene,
      weather: '',
      isChanged: false,
      changedFrom: '',
      changedReason: '',
      replacedBy: '',
      comments: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });
}
