/**
 * ============================================================
 * AI 一日 · AI 日程生成器
 * 由 LLM 根据角色人设 / 世界设定包 / 当前情绪 / 星期与当前时间，
 * 生成个性化的当日生活计划；替换原先的固定模板生成。
 *
 * 防超现实时间：所有 LLM 输出时间都经过 sanitizePlanItems 严格消毒——
 *   - 仅接受 24 小时制 HH:MM，且必须在目标日期范围内；
 *   - 活动按时序排列、禁止重叠、时长限制在 [10 分钟, 5 小时]；
 *   - "今天"模式下丢弃已过去时段，首个活动从当前时间起；
 *   - 场景按世界设定包校验；条数上限 14。
 * 任一步骤失败自动回退固定模板，保证永不产出非法时间线。
 * ============================================================
 */
import { callAI, isReplyPipelineReady, isRoleModelReady, stripThinkBlocks, looksLikeThinkingOnly } from '../aiService';
// 🆕 修复"没配置该板块仍调用 API"：日程生成开关统一走 llmCalls.schedule
import { getCallSetting } from './llmCalls';
import type { Character } from '../../types';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useDebugLog } from '../../store/debugLogStore';
import { clipText } from './builtinWorlds';
import { useAiLifeStore } from '../../store/aiLifeStore';
import type { AiLifeActivity, WorldConfigRecord } from '../../lib/tauriBridge';
import {
  buildDaySchedule, getTemplateFor, isoAt, genId, localDateKey,
} from './scheduleTemplates';
import { sanitizeActivityAgainstWorld } from './worldConfig';
import { recordLifeEvent } from './lifeEvents';
// 🆕 C2/D1: 加权消遣池（标签体系 + 状态系数 + 已购耐用品解锁 + 探索提权）
import { buildWeightedLeisurePool } from './activityTags';
import { dbGetAiInventory, dbGetAiEconomy } from '../../lib/tauriBridge';
import { loadAttributes } from './attributeSystem';
// 🆕 B5.3: 生活生成统一上下文（昵称+记忆注入）
import { buildLifeGenContext, buildNamingRule, type LifeGenContext } from './genContext';
// 🆕 B6.1: 日历层
import { readWorkCalendar, describeDayKind } from './calendar';

/** C2: 异步构建当日加权消遣池——失败静默返回空数组（走旧选择逻辑） */
async function buildLeisurePoolFor(characterId: string, emotionType: string): Promise<Array<{ name: string; weight: number }>> {
  try {
    const [inv, eco, attrs] = await Promise.all([
      dbGetAiInventory(characterId).catch(() => []),
      dbGetAiEconomy(characterId).catch(() => null),
      loadAttributes(characterId).catch(() => ({ stamina: 60 })),
    ]);
    const unlocked = inv
      .filter((i) => i.quantity > 0)
      .flatMap((i) => (Array.isArray((i.extra as Record<string, unknown>)?.unlocks) ? ((i.extra as Record<string, unknown>).unlocks as string[]) : []));
    const balance = eco?.balance ?? 0;
    const monthlyExpense = Math.max(1, eco?.monthlyExpense ?? 1);
    return buildWeightedLeisurePool({
      characterId,
      emotionType,
      balanceTightness: Math.max(0, Math.min(1, 1 - balance / (monthlyExpense * 3))),
      stamina: attrs.stamina,
      unlockedHobbies: unlocked,
    }).map((e) => ({ name: e.item.name, weight: e.weight }));
  } catch {
    return [];
  }
}

const VALID_CATEGORIES = new Set([
  'sleep', 'personal_care', 'meal', 'travel', 'work',
  'leisure', 'social', 'rest', 'special',
]);

const MIN_DURATION_MIN = 10;
const MAX_DURATION_MIN = 300;
const MAX_ITEMS = 14;

interface RawPlanItem {
  start?: string;
  end?: string;
  name?: string;
  category?: string;
  scene?: string;
  mood?: string;
  description?: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** "HH:MM" → 当日分钟数；非法返回 null。拒绝 "25:30" 等超现实时间 */
function parseHM(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  // 终点允许 24:00 表示午夜；起点不允许超过 23:59
  if (min > 59) return null;
  if (h > 23 && !(h === 24 && min === 0)) return null;
  return h * 60 + min;
}

function emotionLabel(characterId: string): string {
  try {
    const dom = useCharacterMindStore.getState().getDominantEmotion(characterId);
    const labelMap: Record<string, string> = {
      joy: '开心', sadness: '低落', anger: '烦躁', fear: '不安',
      surprise: '惊讶', anticipation: '期待',
    };
    return dom ? (labelMap[dom.type] || dom.type) : '平静';
  } catch {
    return '平静';
  }
}

export interface AIPlanOptions {
  /** 今天模式：只生成当前时刻之后的时段 */
  fromNow?: boolean;
  /** 生活档案（角色管理/AI 初始创建生成），让日程贴合职业与作息 */
  profile?: { job?: string; routine?: string };
  /** 显式指定是否调用 LLM：false 时直接用本地模板（未配置提供商/模型时由调用方判定） */
  useLLM?: boolean;
}

/**
 * LLM 生成指定日期的日程；失败或全部非法时回退固定模板。
 * 返回值保证时序合法、无重叠、时间均在目标日期内。
 */
export async function generateAIPlanSchedule(
  character: Character,
  date: Date,
  world: WorldConfigRecord | null,
  opts?: AIPlanOptions,
): Promise<AiLifeActivity[]> {
  const nowIso0 = new Date().toISOString();
  // 🆕 本地方案上下文：人设/作息/职业 + 当前主导情绪（无 AI 也能生成有个性的日程）
  let domEmotionType = '';
  let domEmotionIntensity = 0;
  try {
    const dom = useCharacterMindStore.getState().getDominantEmotion(character.id);
    if (dom) { domEmotionType = dom.type; domEmotionIntensity = dom.intensity; }
  } catch { /* ignore */ }
  const localCtx: import('./scheduleTemplates').LocalPlanContext = { character, profile: opts?.profile, emotionType: domEmotionType, emotionIntensity: domEmotionIntensity };
  // 🆕 C2/D1: 加权消遣池（耐用品解锁 + 情绪/余额/体力系数 + 探索提权）
  localCtx.weightedLeisureNames = await buildLeisurePoolFor(character.id, domEmotionType);
  // 今天模式：模板兜底同样裁掉超前时段（开始时间晚于当前的活动无效）
  const templateFallback = (opts?.fromNow && localDateKey(new Date()) === localDateKey(date))
    ? buildDaySchedule(character.id, date, world, localCtx).filter((a) => a.startTime <= nowIso0)
    : buildDaySchedule(character.id, date, world, localCtx);
  // 🆕 本地模式：未配置提供商/模型时跳过 LLM，直接用本地模板（秒出，无等待）
  if (opts?.useLLM === false) {
    useDebugLog.getState().add('ailife', '[AI-Life] 未配置模型提供商，使用本地模板直接生成日程', { characterId: character.id });
    return templateFallback;
  }
  // 🆕 修复"没配置该板块仍调用 API"：日程生成开关（生成设置 → 日程生成）必须生效——
  //    此前仅靠全局模型就绪判断，用户在 AI 一日设置里关掉"日程生成"也照样调 LLM。
  if (!getCallSetting(useAiLifeStore.getState().config, 'schedule').enabled) {
    useDebugLog.getState().add('ailife', '[AI-Life] 日程生成开关已关闭，使用本地模板直接生成日程', { characterId: character.id });
    return templateFallback;
  }
  try {
    const now = new Date();
    const isToday = localDateKey(now) === localDateKey(date);

    // 今天模式下的起始时间（当前时刻向上取整到 5 分钟）
    let planStartMin = 0;
    if (isToday && opts?.fromNow) {
      const d = new Date(now.getTime());
      d.setSeconds(0, 0);
      d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
      planStartMin = d.getHours() * 60 + d.getMinutes();
    }

    const locations = world?.config.locations?.length ? world.config.locations : ['家', '公司', '户外'];
    const pools = world?.config.activities;
    const poolText = pools
      ? [
          pools.daily?.length ? `日常：${pools.daily.join('、')}` : '',
          pools.work?.length ? `工作/事务：${pools.work.join('、')}` : '',
          pools.leisure?.length ? `休闲：${pools.leisure.join('、')}` : '',
          pools.social?.length ? `社交：${pools.social.join('、')}` : '',
          pools.special?.length ? `特殊：${pools.special.join('、')}` : '',
        ].filter(Boolean).join('\n')
      : '';

    // v2 世界包风味注入（背景/术语/势力/禁忌），严格控制 token 预算
    const cfg = world?.config;
    const flavorLines: string[] = [];
    if (cfg?.lore) {
      flavorLines.push(`世界背景：${clipText(cfg.lore, 140)}`);
    } else if (cfg?.era) {
      flavorLines.push(`时代背景：${clipText(cfg.era, 60)}`);
    }
    if (cfg?.terminology) {
      const termEntries = Object.entries(cfg.terminology).slice(0, 6)
        .map(([k, v]) => `${k}=${clipText(String(v), 24)}`).join('；');
      if (termEntries) flavorLines.push(`专有名词：${termEntries}`);
    }
    if (cfg?.factions?.length) {
      flavorLines.push(`主要势力：${cfg.factions.slice(0, 6).map((f) => f.name).join('、')}`);
    }
    if (cfg?.taboos?.length) {
      flavorLines.push(`该世界不存在的事物（禁止安排相关活动）：${cfg.taboos.slice(0, 6).join('、')}`);
    }
    if (cfg?.timeNotes) flavorLines.push(`时间体系：${clipText(cfg.timeNotes, 50)}`);
    const flavorText = flavorLines.length ? `\n${flavorLines.join('\n')}\n` : '';

    // 🆕 B5.3: 统一生成上下文（昵称+记忆）
    const genCtx: LifeGenContext = buildLifeGenContext(character);

    // 🆕 B6.1: 日历层——工作日/周末/节假日/请假 精确描述
    const workCalendar = readWorkCalendar(useAiLifeStore.getState().config?.extra as Record<string, unknown> | undefined);
    const dayKindText = describeDayKind(date, workCalendar);

    const timeRule = opts?.fromNow && isToday
      ? `现在是 ${pad2(now.getHours())}:${pad2(now.getMinutes())}。只安排今天 00:00 到现在这段时间里「已经做过」和「正在做」的活动；正在进行的活动结束时间最多延伸到当前时刻后 90 分钟。绝对不要安排任何开始时间晚于现在的活动（超前计划是无效输出）。`
      : `请安排 ${localDateKey(date)}（${dayKindText}）全天 00:00-24:00 的活动。${/节假日|周末|请假/.test(dayKindText) ? '今天不上班：安排睡懒觉/出游/购物/宅家等休闲活动。' : ''}`;

    const prompt = `你是「${character.name}」。
人设：${character.personality || ''}
${character.catchphrases?.length ? `口头禅：${character.catchphrases.join('、')}（不必都用）` : ''}
${opts?.profile?.job ? `职业/身份：${opts.profile.job}` : ''}
${opts?.profile?.routine ? `作息习惯：${opts.profile.routine}` : ''}
${genCtx.userPrompt ? `聊天对象信息：\n${genCtx.userPrompt}` : ''}
${genCtx.memoryPrompt ? `近期记忆（可自然融入活动安排）：\n${genCtx.memoryPrompt}` : ''}
当前心情：${emotionLabel(character.id)}
所在世界：「${world?.name || '现代日常'}」，可用地点：${locations.join('、')}
${flavorText}${poolText ? `这个世界里合理的活动参考（可微调，但必须符合世界设定）：\n${poolText}\n` : ''}
${timeRule}
请以你的性格安排这一天的生活计划。${buildNamingRule(genCtx)}

要求：
1. 输出 JSON 数组，每项形如 {"start":"HH:MM","end":"HH:MM","name":"活动名","category":"类别","scene":"地点","mood":"两字情绪","description":"一句话描述"}
2. category 只能是：sleep/personal_care/meal/travel/work/leisure/social/rest/special
3. 时间用 24 小时制；活动按时间先后排列、互不重叠；单场活动 10 分钟到 5 小时之间
4. 活动要符合人设与「${world?.name || '现代日常'}」世界观，不要出现世界里不存在的地点或事物
5. 最多 14 项

只输出 JSON 数组本身，不要任何解释、标记或代码块符号。`;

    // 🆕 maxTokens 提到 2200：14 项中文 JSON 约 1000+ token，1400 常被截断成半截数组
    const outRaw = await callAI([{ role: 'user', content: prompt }], undefined, 2200, 0.85, 'ailife');
    let out = stripThinkBlocks(outRaw); // 🆕 Bug2 修复：剥离思考块后再解析 JSON
    let items = extractJsonArray(out);

    // 🆕 容错：完整 JSON 解析失败（输出被截断、数组未闭合）时，从半截文本恢复完整条目，
    // 不再整体丢弃降级模板——修复"提取不全→[事件:fallback]"（用户可见问题）
    if (items.length === 0) {
      const partial = extractPartialItems(out);
      if (partial.length > 0) {
        useDebugLog.getState().add('ailife', `[AI-Life] 输出被截断/未闭合，从半截 JSON 恢复 ${partial.length} 项`, { characterId: character.id });
        items = partial;
      }
    }

    // 🆕 修复：输出是思考泄漏/JSON 提取失败时，带格式硬指令重试一次（此前直接降级模板）
    if (items.length === 0 || looksLikeThinkingOnly(out)) {
      useDebugLog.getState().add('ailife', `[AI-Life] 日程输出异常（${items.length} 项/疑似思考），追加格式指令重试`, { characterId: character.id });
      try {
        const retryRaw = await callAI(
          [{ role: 'user', content: `${prompt}\n\n[格式硬要求] 上一次你没有输出有效的 JSON 数组。现在只输出 JSON 数组本身，第一个字符必须是 "["，不要思考过程、不要解释。` }],
          undefined,
          2200,
          0.7,
          'ailife',
        );
        const retryOut = stripThinkBlocks(retryRaw);
        let retryItems = extractJsonArray(retryOut);
        // 重试同样可能截断：再走一次半截恢复
        if (retryItems.length === 0) {
          const partial = extractPartialItems(retryOut);
          if (partial.length > 0) retryItems = partial;
        }
        if (retryItems.length > 0) { out = retryOut; items = retryItems; }
      } catch { /* 重试失败沿用第一次 */ }
    }

    const trimPastMode = !!opts?.fromNow && isToday;
    let sanitized = sanitizePlanItems(items, character.id, date, world, planStartMin, trimPastMode);

    // 🆕 修复"生成了但被降级"：今天模式的"只保留已发生时段"可能把 AI 的计划全部丢弃
    //（模型没严格遵守不超前原则时）。此时降级为"保留 AI 的未来计划"（引擎会正常推进），
    // 而不是整个丢弃走本地模板——用户要看到 AI 的日程真正被采纳。
    if (sanitized.length === 0 && trimPastMode && items.length > 0) {
      sanitized = sanitizePlanItems(items, character.id, date, world, planStartMin, false);
      if (sanitized.length > 0) {
        useDebugLog.getState().add('ailife', `[AI-Life] 今天模式全被"不超前"过滤丢弃，已改采 AI 的未来计划（${sanitized.length} 项）`, { characterId: character.id });
      }
    }

    if (sanitized.length === 0) {
      useDebugLog.getState().add('ailife', `[AI-Life] AI日程生成结果为空/非法，使用模板兜底（原始输出前 160 字: ${out.slice(0, 160)}）`, { characterId: character.id });
      // 🆕 B4: 兜底事件记账（无声的兜底才可怕）
      recordLifeEvent({ characterId: character.id, type: 'fallback', description: 'AI 日程生成结果为空/非法，降级为本地模板日程' }).catch(() => {});
      return templateFallback;
    }

    useDebugLog.getState().add('ailife', `[AI-Life] AI 已生成 ${sanitized.length} 项个性化日程`, { characterId: character.id });
    return sanitized;
  } catch (e) {
    useDebugLog.getState().add('ailife', `[AI-Life] AI日程生成失败，模板兜底: ${e instanceof Error ? e.message : String(e)}`, { characterId: character.id });
    // 🆕 B4: 兜底事件记账
    recordLifeEvent({ characterId: character.id, type: 'fallback', description: `AI 日程生成失败，降级为本地模板日程（${e instanceof Error ? e.message : String(e)}）` }).catch(() => {});
    return templateFallback;
  }
}

/** 从模型输出中稳健提取 JSON 数组（容忍 ```json 包裹 / 前后杂文本） */
function extractJsonArray(raw: string): RawPlanItem[] {
  const text = raw.trim();
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(text.slice(firstBracket, lastBracket + 1));
  }
  candidates.push(text);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (Array.isArray(parsed)) return parsed as RawPlanItem[];
    } catch { /* 尝试下一个候选 */ }
  }
  return [];
}

/**
 * 🆕 容错提取：LLM 输出被截断（JSON 数组未闭合 / 后半丢失）时，从半截文本中
 * 逐个匹配并单独解析 {...} 对象片段，尽力恢复已生成的完整条目。
 * 只接受通过形态校验（含 name/start/end）的条目，非法片段静默跳过。
 */
function extractPartialItems(raw: string): RawPlanItem[] {
  const text = raw
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
  if (!text) return [];
  const items: RawPlanItem[] = [];
  // 计划项字段均为扁平字符串，不含嵌套大括号，逐段匹配即可
  const objRe = /\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text)) !== null) {
    const frag = m[0].trim();
    if (!frag) continue;
    try {
      const parsed = JSON.parse(frag) as RawPlanItem;
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()
        && typeof parsed.start === 'string' && typeof parsed.end === 'string') {
        items.push(parsed);
      }
    } catch { /* 跳过无法单独解析的片段 */ }
  }
  return items;
}

/**
 * 时间线消毒核心：
 * 时序化 → 裁剪过去 → 时长钳制 → 重叠消除 → 世界包场景校验。
 */
function sanitizePlanItems(
  items: RawPlanItem[],
  characterId: string,
  date: Date,
  world: WorldConfigRecord | null,
  planStartMin: number,
  trimPast: boolean,
): AiLifeActivity[] {
  const nowIso = new Date().toISOString();
  const toIso = (min: number) => isoAt(date, Math.floor(min / 60), min % 60);

  type Span = { s: number; e: number; raw: RawPlanItem };
  const spans: Span[] = [];

  for (const item of items.slice(0, MAX_ITEMS * 2)) {
    if (!item || typeof item !== 'object') continue;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 20) : '';
    if (!name) continue;
    const s = parseHM(item.start);
    let e = parseHM(item.end);
    if (s === null || e === null) continue;
    if (e <= s) e = s + MIN_DURATION_MIN; // 结束早于开始 → 视为跨零点或笔误，给最小时长
    if (s < 0 || s > 24 * 60) continue;
    e = Math.min(e, 24 * 60);
    spans.push({ s, e, raw: item });
  }

  // 排序 + 消除重叠（后者顺延）+ 时长钳制
  spans.sort((a, b) => a.s - b.s);
  const cleaned: Span[] = [];
  for (const sp of spans) {
    let s = sp.s;
    let e = sp.e;
    const prev = cleaned[cleaned.length - 1];
    if (prev && s < prev.e) s = prev.e;       // 与前一项重叠 → 顺延
    if (s >= 24 * 60) break;                  // 顺延出当天 → 丢弃剩余
    if (e - s < MIN_DURATION_MIN) e = s + MIN_DURATION_MIN;
    if (e - s > MAX_DURATION_MIN) e = s + MAX_DURATION_MIN;
    if (e > 24 * 60) e = 24 * 60;
    if (e - s < MIN_DURATION_MIN) continue;   // 压缩到午夜仍不足 → 丢弃
    cleaned.push({ s, e, raw: sp.raw });
  }

  // 今天模式：只保留"已发生/正在进行"的活动——
  // 开始时间必须早于当前时刻（结束可以延伸到未来，如 9:00 时保留 8:25-9:30）。
  // 完全超前于现实的时段（如 9:30-10:00）视为无效，直接丢弃。
  const result: AiLifeActivity[] = [];
  for (const sp of cleaned) {
    if (trimPast && sp.s >= planStartMin) continue;      // 超前生成 → 无效
    let e = sp.e;
    if (trimPast && e > planStartMin + 90) e = planStartMin + 90; // 进行中活动最多延伸 90 分钟
    if (trimPast && e <= sp.s) continue;

    const raw = sp.raw;
    const category = VALID_CATEGORIES.has(String(raw.category)) ? String(raw.category) : 'leisure';
    const sceneRaw = typeof raw.scene === 'string' && raw.scene.trim() ? raw.scene.trim().slice(0, 20) : '家';
    const scene = sanitizeActivityAgainstWorld(sceneRaw, world);
    const startTime = toIso(sp.s);
    const endTime = toIso(e);
    let status: AiLifeActivity['status'] = 'planned';
    if (endTime <= nowIso) status = 'completed';
    else if (startTime <= nowIso) status = 'ongoing';

    result.push({
      id: genId('act'),
      characterId,
      name: String(raw.name).trim().slice(0, 20),
      category,
      startTime,
      endTime,
      sceneId: scene,
      status,
      processDescription: '',
      summary: '',
      mood: typeof raw.mood === 'string' && raw.mood.trim() ? raw.mood.trim().slice(0, 6) : '平静',
      location: scene,
      weather: '',
      isChanged: false,
      changedFrom: '',
      changedReason: '',
      replacedBy: '',
      comments: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    if (result.length >= MAX_ITEMS) break;
  }
  return result;
}

// ---------------- 空闲续写：生成"接下来正在做"的一个活动 ----------------

const NEXT_CATEGORY_WHITELIST = VALID_CATEGORIES;

/**
 * 空闲时调用：让 AI 决定"角色此刻在做什么"，生成单个活动（现在开始）。
 * 遵守不超前原则：start=当前时刻，时长 30-120 分钟。
 * LLM 失败/关闭时回退：取当前时段的模板槽位，再退到通用休闲。
 */
export async function generateNextActivity(
  character: Character,
  world: WorldConfigRecord | null,
  profile?: { job?: string; routine?: string },
): Promise<AiLifeActivity | null> {
  const now = new Date();
  const nowIso = now.toISOString();
  const hmNow = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  const fallbackFromTemplate = (): AiLifeActivity => {
    const template = getTemplateFor(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const slot = template.find((s) => (s.startHour * 60 + s.startMin) <= nowMin && nowMin < (s.endHour * 60 + s.endMin))
      || template.find((s) => (s.startHour * 60 + s.startMin) > nowMin)
      || { name: '自由时光', category: 'leisure', scene: '客厅', mood: '放松', description: '随意打发时间。' };
    const scene = sanitizeActivityAgainstWorld(String(slot.scene), world);
    // 🆕 B4: 兜底事件记账（空闲续写走模板）
    recordLifeEvent({ characterId: character.id, type: 'fallback', description: `空闲续写降级为模板活动「${slot.name}」` }).catch(() => {});
    const end = new Date(now.getTime() + 60 * 60000);
    return {
      id: genId('act'),
      characterId: character.id,
      name: String(slot.name),
      category: String(slot.category),
      startTime: nowIso,
      endTime: end.toISOString(),
      sceneId: scene,
      status: 'ongoing',
      processDescription: '',
      summary: '',
      mood: String(slot.mood),
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
  };

  try {
    // 🆕 本地模式门禁：未配置模型 / 未给 ailife 角色分配模型时直接走模板，不发无效请求
    if (!isReplyPipelineReady().ready || !isRoleModelReady('ailife')) return fallbackFromTemplate();
    // 🆕 日程生成开关（空闲续写同样受控）：关闭时不再调 LLM 续写，改走模板
    if (!getCallSetting(useAiLifeStore.getState().config, 'schedule').enabled) {
      useDebugLog.getState().add('ailife', '[AI-Life] 日程生成开关已关闭，空闲续写改用本地模板', { characterId: character.id });
      return fallbackFromTemplate();
    }
    const locations = world?.config.locations?.length ? world.config.locations : ['家', '公司', '户外'];
    // 🆕 B5.3: 注入昵称 + 记忆
    const genCtx: LifeGenContext = buildLifeGenContext(character);
    const prompt = `你是「${character.name}」（人设：${character.personality || ''}）。
${profile?.job ? `职业/身份：${profile.job}。` : ''}${profile?.routine ? `作息：${profile.routine}。` : ''}
${genCtx.memoryPrompt ? `近期记忆（可自然影响你的选择）：\n${genCtx.memoryPrompt}` : ''}
现在是 ${hmNow}。你刚结束上一件事，接下来你决定：
请输出 JSON（只输出 JSON 本身）：
{"name":"接下来做的事（10字内）","category":"sleep/personal_care/meal/travel/work/leisure/social/rest/special 之一","scene":"地点（必须是：${locations.join('、')} 之一）","mood":"两字情绪","durationMin":"30到120的整数"}

要求：符合人设、职业作息、当前时间段（深夜该睡觉）与世界观；只输出 JSON。`;
    const outRaw = await callAI([{ role: 'user', content: prompt }], undefined, 200, 0.9, 'ailife');
    const out = stripThinkBlocks(outRaw); // 🆕 Bug2 修复
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return fallbackFromTemplate();
    const parsed = JSON.parse(m[0]) as { name?: string; category?: string; scene?: string; mood?: string; durationMin?: number | string };
    const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 16) : '';
    if (!name) return fallbackFromTemplate();
    const category = NEXT_CATEGORY_WHITELIST.has(String(parsed.category)) ? String(parsed.category) : 'leisure';
    let durationMin = typeof parsed.durationMin === 'number' ? parsed.durationMin : parseInt(String(parsed.durationMin ?? 60), 10);
    if (!Number.isFinite(durationMin)) durationMin = 60;
    durationMin = Math.max(30, Math.min(120, durationMin));
    const sceneRaw = typeof parsed.scene === 'string' && parsed.scene.trim() ? parsed.scene.trim() : '家';
    const scene = sanitizeActivityAgainstWorld(sceneRaw.slice(0, 20), world);
    const end = new Date(now.getTime() + durationMin * 60000);
    return {
      id: genId('act'),
      characterId: character.id,
      name,
      category,
      startTime: nowIso,
      endTime: end.toISOString(),
      sceneId: scene,
      status: 'ongoing',
      processDescription: '',
      summary: '',
      mood: typeof parsed.mood === 'string' && parsed.mood.trim() ? parsed.mood.trim().slice(0, 6) : '平静',
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
  } catch {
    return fallbackFromTemplate();
  }
}
