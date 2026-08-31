/**
 * ============================================================
 * AI 一日 · 内容生成器（阶段 2）
 * 活动过程 / 活动总结 / 日记 的 LLM 生成，带成本分档与降级：
 *  - off:        不生成任何内容
 *  - minimal:    全模板文案（零 LLM 调用）
 *  - simplified: 总结用 LLM，过程用模板
 *  - full:       过程 + 总结均用 LLM
 * LLM 走 background 角色模型（便宜档），失败静默降级为模板。
 * 所有调用经串行队列，避免活动开始/结束同分钟并发轰炸。
 * ============================================================
 */
import { callAI, isReplyPipelineReady, isRoleModelReady, stripThinkBlocks, looksLikeThinkingOnly } from '../aiService';
import type { Character } from '../../types';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useCharacterStore } from '../../store/characterStore';
import { useChatStore } from '../../store/chatStore';
import { useDebugLog } from '../../store/debugLogStore';
import type { AiLifeActivity, AiLifeConfig } from '../../lib/tauriBridge';
import { getCallSetting, tokensFor, detailHint, type LlmCallId } from './llmCalls';
// 🆕 B5.3: 生活生成统一上下文（昵称+记忆+情绪+属性注入）
import { buildLifeGenContext, buildNamingRule, type LifeGenContext } from './genContext';

// ---------------- 成本分档守卫（接入 LLM 总控） ----------------

export function shouldUseLLMForProcess(config: AiLifeConfig | null): boolean {
  return getCallSetting(config, 'process').enabled;
}

export function shouldUseLLMForSummary(config: AiLifeConfig | null): boolean {
  return getCallSetting(config, 'summary').enabled;
}

export function isGenerationEnabled(config: AiLifeConfig | null): boolean {
  return !!config && (
    getCallSetting(config, 'diary').enabled ||
    getCallSetting(config, 'summary').enabled ||
    getCallSetting(config, 'process').enabled
  );
}

// ---------------- 模板文案（minimal 档 & 降级兜底） ----------------

const TEMPLATE_PROCESS: Record<string, string> = {
  sleep: '躺在床上，渐渐入睡。房间里很安静。',
  personal_care: '洗漱整理，让自己清爽起来。',
  meal: '准备了一些吃的，慢慢享用。',
  travel: '在路上，看着窗外发呆。',
  work: '处理了一些工作上的事情，忙忙碌碌。',
  leisure: '做点自己喜欢的事，放松一下。',
  social: '和人聊了会儿天，时间过得很快。',
  rest: '休息了片刻，恢复了些精神。',
};

function getTemplateProcess(activity: AiLifeActivity): string {
  return TEMPLATE_PROCESS[activity.category] || `进行着${activity.name}。`;
}

function getTemplateSummary(activity: AiLifeActivity): string {
  switch (activity.category) {
    case 'sleep': return '睡得还不错。';
    case 'meal': return '吃得挺满足的。';
    case 'work': return '工作处理得差不多，有点累。';
    case 'leisure': return '玩得很开心，心情不错。';
    case 'personal_care': return '清爽多了。';
    default: return `${activity.name}完成了。`;
  }
}

// ---------------- LLM 调用（串行队列 + 清洗 + 总控） ----------------

let chain: Promise<unknown> = Promise.resolve();

function cleanLlmOutput(out: string): string {
  return stripThinkBlocks(out)
    .trim()
    .replace(/^["'""''「」]+|["'""''「」]+$/g, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim();
}

function enqueueLLM(prompt: string, maxTokens: number): Promise<string> {
  const task = async () => {
    let out = await callAI(
      [{ role: 'user', content: prompt }],
      undefined,
      maxTokens,
      0.8,
      'ailife',
    );
    // 🆕 Bug2 修复：剥离 <think> 思考块
    out = cleanLlmOutput(out);

    // 🆕 Bug2 修复：检测"只有思考没有正文"（如"回忆过程…我应该以星眠的设定写…"），
    // 追加格式硬指令重试一次；重试仍异常则用重试结果（可能仍不完美，但优于思考文本）
    if (looksLikeThinkingOnly(out)) {
      useDebugLog.getState().add('ailife', '[AI-Life] 检测到输出为思考过程而非正文，追加格式指令重试', {});
      try {
        const retry = await callAI(
          [{ role: 'user', content: `${prompt}\n\n[格式硬要求] 上一次你只输出了思考过程。现在直接输出最终正文本身——不要任何思考、分析、计划、"我应该"式的自我讨论，第一个字就是正文内容。` }],
          undefined,
          maxTokens,
          0.7,
          'ailife',
        );
        const cleaned = cleanLlmOutput(retry);
        if (cleaned && !looksLikeThinkingOnly(cleaned)) {
          return cleaned;
        }
        if (cleaned) out = cleaned;
      } catch { /* 重试失败沿用第一次结果 */ }
    }
    return out;
  };
  const run = chain.then(task, task);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * AI 一日通用 LLM 调用入口（供本文件与其他服务共用）：
 * 自动应用「生成设置」中对应调用项的开关与详细度。
 */
export async function runAilifeLlm(
  callId: LlmCallId,
  characterId: string,
  prompt: string,
  baseTokens: number,
): Promise<string> {
  void characterId; // 当前按全局配置生效；保留参数便于未来按角色细分
  // 🆕 本地模式门禁：未配置提供商/Key/模型时直接抛出（调用方均有本地兜底），
  //    杜绝无谓的网络请求与等待
  // 🆕 修复"没配置该板块模型角色仍调用"：AI 一日必须给 ailife 角色分配模型，
  //    未分配时全部 LLM 调用降级（由调用方走模板/本地逻辑）
  if (!isReplyPipelineReady().ready || !isRoleModelReady('ailife')) {
    throw new Error('本地模式：AI 一日未配置 ailife 模型角色，跳过 LLM 调用');
  }
  const cs = getCallSetting(useAiLifeStore.getState().config, callId);
  if (!cs.enabled) throw new Error('该调用项已在生成设置中关闭');
  const hint = detailHint(cs.detail);
  return enqueueLLM(hint ? `${prompt}\n${hint}` : prompt, tokensFor(cs.detail, baseTokens));
}

function fmtHM(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function dominantEmotionLabel(characterId?: string): string {
  if (!characterId) return '平静';
  try {
    const dom = useCharacterMindStore.getState().getDominantEmotion(characterId);
    return dom?.type || '平静';
  } catch {
    return '平静';
  }
}

// ---------------- 活动过程生成 ----------------

export async function generateActivityProcess(
  character: Character,
  activity: AiLifeActivity,
): Promise<string> {
  const tpl = getTemplateProcess(activity);
  try {
    const mood = activity.mood || dominantEmotionLabel(character.id);
    // 🆕 B5.3: 注入昵称 + 记忆（"最近聊过的话题"从此有据可依）
    const ctx: LifeGenContext = buildLifeGenContext(character);
    const prompt = `你是「${character.name}」。现在是 ${fmtHM(activity.startTime)}，你正在「${activity.name}」（地点：${activity.location || '未指定'}）。
你的人设：${character.personality || ''}
当前心情：${mood}
${ctx.attrLine}
${character.catchphrases?.length ? `你的口头禅：${character.catchphrases.join('、')}` : ''}
${ctx.memoryPrompt}

请用第一人称写一段活动过程描述，要求：
1. 体现活动细节
2. 符合你的性格（内向的人内心独白多，外向的更活泼）
3. 偶尔可以提到${ctx.nickname ? `「${ctx.nickname}」` : '聊天对象'}或最近聊过的话题
4. 自然真实，不要像流水账
${buildNamingRule(ctx)}
直接输出描述本身，不要任何解释、标记或引号。`;

    const out = await runAilifeLlm('process', character.id, prompt, 220);
    if (out) return out;
    return tpl;
  } catch (e) {
    useDebugLog.getState().add('ailife', `[AI-Life] 过程生成失败/关闭，使用模板: ${e instanceof Error ? e.message : String(e)}`, { characterId: character.id });
    return tpl;
  }
}

// ---------------- 活动总结生成 ----------------

export async function generateActivitySummary(
  character: Character,
  activity: AiLifeActivity,
): Promise<string> {
  const tpl = getTemplateSummary(activity);
  try {
    const processText = activity.processDescription || tpl;
    // 🆕 B5.3: 注入昵称 + 情绪
    const ctx: LifeGenContext = buildLifeGenContext(character);
    const prompt = `你是「${character.name}」。你刚完成「${activity.name}」。
你的人设：${character.personality || ''}
${ctx.moodLine}
活动过程：${processText}

请用一句话总结这次活动，并说明你的感受。

直接输出总结本身，不要任何解释、标记或引号。`;

    const out = await runAilifeLlm('summary', character.id, prompt, 130);
    if (out) return out;
    return tpl;
  } catch (e) {
    useDebugLog.getState().add('ailife', `[AI-Life] 总结生成失败/关闭，使用模板: ${e instanceof Error ? e.message : String(e)}`, { characterId: character.id });
    return tpl;
  }
}

// ---------------- 日记生成 ----------------

export interface DiaryGenerateResult {
  title: string;
  content: string;
  mood: string;
}

/** 从聊天记录提取今日用户互动摘要 */
function collectTodayInteractions(characterId: string, dateStr_: string): string[] {
  try {
    const convs = useChatStore.getState().conversations.filter((c) => c.characterId === characterId);
    const lines: string[] = [];
    for (const conv of convs) {
      for (const msg of conv.messages || []) {
        const ts = msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp);
        if (ts.toISOString().slice(0, 10) !== dateStr_) continue;
        const text = typeof msg.content === 'string' ? msg.content : '(图片)';
        if (!text.trim()) continue;
        lines.push(`${msg.sender === 'user' ? '用户说' : '我说'}：${text.slice(0, 40)}`);
        if (lines.length >= 16) break;
      }
      if (lines.length >= 16) break;
    }
    return lines;
  } catch {
    return [];
  }
}

export async function generateDiaryContent(
  character: Character,
  activities: AiLifeActivity[],
  dateStr_: string,
): Promise<DiaryGenerateResult> {
  const fallbackMood = activities[activities.length - 1]?.mood || '平静';
  const interactions = collectTodayInteractions(character.id, dateStr_);

  const activitiesText = activities
    .filter((a) => a.status !== 'cancelled')
    .map((a) => `- ${a.name}（${fmtHM(a.startTime)}-${fmtHM(a.endTime)}）：${a.summary || a.processDescription || ''}`)
    .join('\n');

  const interactionsText = interactions.length > 0
    ? interactions.map((l) => `- ${l}`).join('\n')
    : '- 今天没有和用户聊天';

  // 🆕 B5.3: 全量注入（userPrompt + memoryPrompt + moodLine + attrLine）
  const ctx: LifeGenContext = buildLifeGenContext(character);

  // 🆕 B5.1: 生活事件注入（普通事件 3~5 条，severity 3 常驻）
  let lifeEventsLine = '';
  try {
    const { dbGetAiLifeEvents } = await import('../../lib/tauriBridge');
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 86400_000).toISOString();
    const events = await dbGetAiLifeEvents(character.id, from, to, 50);
    const severe = events.filter((e) => e.type === 'fallback' || e.meta?.severity === 3);
    const normal = events
      .filter((e) => !severe.includes(e))
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 5);
    const picked = [...severe.slice(-2), ...normal];
    if (picked.length > 0) {
      lifeEventsLine = `\n今天的生活动态：\n${picked.map((e) => `- ${e.description}`).join('\n')}`;
    }
  } catch { /* ignore */ }

  try {
    const prompt = `你是「${character.name}」。今天是 ${dateStr_}，现在是写日记的时间。
你的人设：${character.personality || ''}
${ctx.userPrompt ? `你正在和谁聊天/对方是谁：\n${ctx.userPrompt}` : ''}
${ctx.moodLine}
${ctx.attrLine}
${ctx.memoryPrompt ? `与你相关的近期记忆：\n${ctx.memoryPrompt}` : ''}
你今天做了这些事：
${activitiesText}

你和聊天对象的互动：
${interactionsText}
${lifeEventsLine}

请写一篇日记，要求：
1. 第一人称，口语化，像真的在写日记
2. 100-200 字
3. 重点写感受，不要流水账（疲倦/饥饿等身体状态会影响语气）
4. 如果今天聊过天，要提到对方
5. 体现你的性格和当前心情
${buildNamingRule(ctx)}
第一行输出日记标题（不超过10个字），之后空一行输出日记正文。不要任何解释或标记。`;

    const out = await runAilifeLlm('diary', character.id, prompt, 520);
    if (out) {
      const firstLineEnd = out.indexOf('\n');
      const title = firstLineEnd > 0 ? out.slice(0, firstLineEnd).trim().slice(0, 20) : '';
      const content = firstLineEnd > 0 ? out.slice(firstLineEnd).trim() : out;
      return { title, content, mood: fallbackMood };
    }
    return { title: '', content: templateDiary(activitiesText), mood: fallbackMood };
  } catch (e) {
    useDebugLog.getState().add('ailife', `[AI-Life] 日记生成失败，使用模板: ${e instanceof Error ? e.message : String(e)}`, { characterId: character.id });
    return { title: '', content: templateDiary(activitiesText), mood: fallbackMood };
  }
}

// ---------------- 情绪转变决策（AI 自主生成，替代手动选择） ----------------

export interface EmotionShiftPlan {
  mood: string;
  reason: string;
  activityName: string;
  category: string;
  description: string;
}

const SHIFT_CATEGORY_WHITELIST = new Set(['leisure', 'social', 'rest', 'special', 'personal_care', 'meal']);

/** 手动/主动变卦共用的兜底池 */
export const FALLBACK_SHIFTS: Record<string, Omit<EmotionShiftPlan, 'reason'>> = {
  happy: { mood: '开心', activityName: '出门散步', category: 'leisure', description: '心情不错，临时决定出去走走。' },
  sad: { mood: '低落', activityName: '听音乐平复心情', category: 'rest', description: '有点低落，戴上耳机听听歌。' },
  excited: { mood: '兴奋', activityName: '做点感兴趣的事', category: 'leisure', description: '突然很有兴致，想做点别的。' },
};

/**
 * 让 AI 回顾今天的经历与聊天、当前情绪，自主决定一次心情转变：
 * 转变成什么情绪、为什么、以及接下来想做什么（替换未来计划）。
 * 输出严格 JSON；失败时由调用方回退到 FALLBACK_SHIFTS。
 */
export async function generateEmotionShiftPlan(
  character: Character,
  characterId: string,
): Promise<EmotionShiftPlan> {
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;

  // 今日已完成活动的感受
  let activitiesText = '- 今天还没什么经历';
  try {
    const { dbGetAiActivities } = await import('../../lib/tauriBridge');
    const all = await dbGetAiActivities(characterId);
    const done = all
      .filter((a) => localDayKey(a.startTime) === todayKey && (a.status === 'completed' || a.status === 'ongoing'))
      .slice(-5);
    if (done.length > 0) {
      activitiesText = done.map((a) => `- ${a.name}：${a.summary || a.processDescription || '（无记录）'}`).join('\n');
    }
  } catch { /* 忽略 */ }

  const interactions = collectTodayInteractions(characterId, todayKey).slice(-6);
  const interactionsText = interactions.length > 0 ? interactions.join('\n') : '- 今天还没有和用户聊天';

  let emotionText = '平静';
  try {
    const mind = useCharacterMindStore.getState();
    const multi = mind.getMultiEmotion(characterId);
    const top = Object.entries(multi.values || {})
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    emotionText = top || emotionLabelSafe(characterId);
  } catch {
    emotionText = emotionLabelSafe(characterId);
  }

  // 🆕 B5.3: 注入 userPrompt + memoryPrompt
  const ctx: LifeGenContext = buildLifeGenContext(character);

  const prompt = `你是「${character.name}」。
人设：${character.personality || ''}
${ctx.userPrompt ? `聊天对象信息：\n${ctx.userPrompt}` : ''}
当前情绪值：${emotionText}
${ctx.memoryPrompt ? `近期记忆：\n${ctx.memoryPrompt}` : ''}

你今天的经历：
${activitiesText}

你和聊天对象的互动：
${interactionsText}

请回顾以上内容，判断你现在的心情是否应该发生一次自然的转变，并决定接下来想做什么。
输出 JSON（只输出 JSON 本身，不要任何解释或代码块符号）：
{"mood":"两字新情绪","reason":"转变原因（20字内，第一人称，具体到今天的事）","activityName":"接下来想做的事（10字内）","category":"leisure/social/rest/special/personal_care/meal 之一","description":"这个活动你会怎么做（30字内，第一人称）"}

要求：
- reason 必须基于今天真实发生的事或聊过的内容，不要凭空编造
- activityName 必须符合你的人设与日常生活${buildNamingRule(ctx)}`;
  const out = await runAilifeLlm('emotionShift', characterId, prompt, 320);
  const jsonMatch = out.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 未返回有效 JSON');
  const parsed = JSON.parse(jsonMatch[0]) as Partial<EmotionShiftPlan>;
  const mood = typeof parsed.mood === 'string' && parsed.mood.trim() ? parsed.mood.trim().slice(0, 6) : '';
  const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim().slice(0, 40) : '';
  const activityName = typeof parsed.activityName === 'string' && parsed.activityName.trim() ? parsed.activityName.trim().slice(0, 16) : '';
  const description = typeof parsed.description === 'string' && parsed.description.trim() ? parsed.description.trim().slice(0, 60) : '';
  const category = SHIFT_CATEGORY_WHITELIST.has(String(parsed.category)) ? String(parsed.category) : 'leisure';
  if (!mood || !reason || !activityName) throw new Error('AI 返回字段缺失');
  return { mood, reason, activityName, category, description: description || `${mood}，想做点别的事。` };
}

function localDayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function emotionLabelSafe(characterId: string): string {
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

function templateDiary(activitiesText: string): string {
  return `今天过得平平淡淡。\n\n做了这些事：\n${activitiesText}\n\n希望明天也能好好度过。`;
}

// ---------------- AI 初始创建（生活档案一键设定） ----------------

export interface LifeProfileInit {
  job: string;
  routine: string;
  balance: number;
  items: { name: string; category: string; quantity: number }[];
  /** 🆕 B4: 性格决策参数（LLM 从人设推导，用户可调） */
  personality: { selfDiscipline: number; frugality: number; actionDrive: number };
}

const INIT_CATEGORY_WHITELIST = new Set(['food', 'clothing', 'medicine', 'tool']);

/**
 * AI 初始创建：根据角色人设生成生活档案（职业/作息）、初始钱包、初始物资与性格决策参数。
 * 未配置服务商或失败时返回合理的默认档案（零成本兜底）。
 */
export async function generateInitialProfile(character: Character): Promise<LifeProfileInit> {
  // 🆕 B5.3: 注入 userPrompt（昵称等）
  const ctx: LifeGenContext = buildLifeGenContext(character);
  const fallback: LifeProfileInit = {
    job: '自由职业者',
    routine: '作息规律，白天处理工作，晚上放松休息。',
    balance: 3000,
    items: [
      { name: '鸡蛋', category: 'food', quantity: 3 },
      { name: '面包', category: 'food', quantity: 2 },
      { name: '常备药', category: 'medicine', quantity: 1 },
      { name: '居家服', category: 'clothing', quantity: 2 },
    ],
    personality: { selfDiscipline: 0.5, frugality: 0.5, actionDrive: 0.5 },
  };
  try {
    const prompt = `你是「${character.name}」。
人设：${character.personality || ''}
背景：${character.background || ''}
喜好：${character.likes?.join('、') || '无'}；讨厌：${character.dislikes?.join('、') || '无'}
${ctx.userPrompt ? `聊天对象信息：\n${ctx.userPrompt}` : ''}

请为你的日常生活做一份初始设定，输出 JSON（只输出 JSON 本身）：
{"job":"职业/身份（10字内）","routine":"作息习惯说明（40字内，第三人称）","balance":"初始存款（1000-20000 的整数）","items":[{"name":"物品名","category":"food/clothing/medicine/tool 之一","quantity":"1-5 的整数"}],"personality":{"selfDiscipline":"自律度 0-1 小数（懒散→0.3，严格→0.8）","frugality":"节俭度 0-1 小数","actionDrive":"行动力 0-1 小数"}}

要求：
- items 为家里最初有的东西：食品若干、1-2 件衣物、常用药品等，共 4-8 件
- 一切必须贴合人设与背景
- personality 三参数从人设推导（如"懒散"→selfDiscipline 0.3）`;
    const out = await runAilifeLlm('schedule', character.id, prompt, 400);
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const parsed = JSON.parse(m[0]) as Partial<LifeProfileInit> & { balance?: number | string; items?: unknown; personality?: Partial<LifeProfileInit['personality']> };
    let balance = typeof parsed.balance === 'number' ? parsed.balance : parseInt(String(parsed.balance ?? 3000), 10);
    if (!Number.isFinite(balance)) balance = 3000;
    balance = Math.max(500, Math.min(50000, balance));
    const items = Array.isArray(parsed.items)
      ? (parsed.items as { name?: string; category?: string; quantity?: number | string }[])
        .map((it) => ({
          name: typeof it.name === 'string' ? it.name.trim().slice(0, 16) : '',
          category: INIT_CATEGORY_WHITELIST.has(String(it.category)) ? String(it.category) : 'tool',
          quantity: Math.max(1, Math.min(9, Number(it.quantity) || 1)),
        }))
        .filter((it) => it.name)
        .slice(0, 8)
      : [];
    const clamp01 = (v: unknown) => Math.max(0, Math.min(1, Number(v) || 0.5));
    const personality = {
      selfDiscipline: clamp01(parsed.personality?.selfDiscipline),
      frugality: clamp01(parsed.personality?.frugality),
      actionDrive: clamp01(parsed.personality?.actionDrive),
    };
    return {
      job: typeof parsed.job === 'string' && parsed.job.trim() ? parsed.job.trim().slice(0, 14) : fallback.job,
      routine: typeof parsed.routine === 'string' && parsed.routine.trim() ? parsed.routine.trim().slice(0, 60) : fallback.routine,
      balance,
      items: items.length >= 3 ? items : fallback.items,
      personality,
    };
  } catch {
    return fallback;
  }
}

// ---------------- 每日三件小事（主动消息富素材，🆕 可选增强） ----------------
//
// Soul DailyAgent 思路的落地：每日预生成三件"今天发生在你身上的小事"，
// 供主动消息在空闲/无话可说时取材（日程之外的随机分享感）。
// - 缓存于 localStorage（按角色+日期），每日至多生成一次；
// - 走 runAilifeLlm 总控（生成设置中"每日小事"开关 + ailife 角色模型 + 串行队列）；
// - 失败静默（下次触发重试）；缓存仅保留最近 3 天防膨胀。

const DAILY_BITS_KEY = 'aiLifeDailyBits:v1';
type DailyBitsStore = Record<string, Record<string, string[]>>;
let dailyBitsInflight = false;

function loadDailyBits(): DailyBitsStore {
  try { return JSON.parse(localStorage.getItem(DAILY_BITS_KEY) || '{}') as DailyBitsStore; } catch { return {}; }
}

function saveDailyBits(s: DailyBitsStore): void {
  try { localStorage.setItem(DAILY_BITS_KEY, JSON.stringify(s)); } catch { /* 静默 */ }
}

/** 读取已缓存的今日三件小事（无缓存返回空数组，不触发生成） */
export function getCachedDailyBits(characterId: string, dateKey: string): string[] {
  return loadDailyBits()[characterId]?.[dateKey] || [];
}

/** 每日至多一次：异步预生成今日三件小事（fire-and-forget，主动路径顺手触发，供本轮/后续取材） */
export function ensureDailyBits(characterId: string, dateKey: string): void {
  if (dailyBitsInflight) return;
  if (getCachedDailyBits(characterId, dateKey).length > 0) return;
  const config = useAiLifeStore.getState().config;
  if (!config?.enabled || config.characterId !== characterId) return;
  // 本地模式门禁：未配置 ailife 角色模型时不发起（与 runAilifeLlm 同一守卫，提前短路避免日志噪音）
  if (!isReplyPipelineReady().ready || !isRoleModelReady('ailife')) return;

  dailyBitsInflight = true;
  void (async () => {
    try {
      const char = useCharacterStore.getState().characters.find(c => c.id === characterId);
      if (!char) return;
      const acts = (useAiLifeStore.getState().dayActivities[dateKey] || [])
        .slice(0, 10)
        .map(a => a.name)
        .join('、');
      const prompt = [
        `你是"${char.name}"（人设：${(char.personality || '自然真实').slice(0, 80)}）。`,
        `根据你今天的日程${acts ? `（${acts}）` : ''}，写下今天发生在你身上的三件小事。`,
        '要求：第一人称；每条15~30字；具体、有生活气、符合人设；三件事互不重复；不要问句。',
        '只返回 JSON：{"bits":["事件一","事件二","事件三"]}',
      ].join('\n');
      const reply = await runAilifeLlm('dailyBits', characterId, prompt, 300);
      const m = reply.match(/\{[\s\S]*\}/);
      const parsed = m ? (JSON.parse(m[0]) as { bits?: unknown }) : null;
      const bits = Array.isArray(parsed?.bits)
        ? (parsed.bits as unknown[]).filter((b): b is string => typeof b === 'string' && b.trim().length > 0).slice(0, 3).map(b => b.trim())
        : [];
      if (bits.length === 0) throw new Error('解析结果为空');
      const s = loadDailyBits();
      s[characterId] = { ...(s[characterId] || {}), [dateKey]: bits };
      for (const cid of Object.keys(s)) {
        const days = s[cid];
        const keep = Object.keys(days).sort().slice(-3);
        s[cid] = Object.fromEntries(keep.map(k => [k, days[k]]));
      }
      saveDailyBits(s);
      useDebugLog.getState().add('proactive', `[AI一日] 今日三件小事已生成: ${bits.join(' / ').slice(0, 80)}`, { characterId });
    } catch (e) {
      useDebugLog.getState().add('proactive', `[AI一日] 今日三件小事生成失败（下次触发重试）: ${e instanceof Error ? e.message : String(e)}`, { characterId });
    } finally {
      dailyBitsInflight = false;
    }
  })();
}
