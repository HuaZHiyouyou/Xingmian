/**
 * ============================================================
 * AI 一日生活引擎（阶段 1：基础引擎）
 * 设计要点：
 *  - 幂等 tick：每次以"当前时间 vs 活动 start/end"推进状态，
 *    系统休眠恢复后自然补齐，不做增量计数假设
 *  - 持久化走 SQLite（ai_activities / ai_diaries / ai_life_config）
 *  - 日程生成由 LLM 驱动（scheduleGenerator），固定模板仅作降级兜底；
 *    模板与时间工具统一在 scheduleTemplates 维护
 *  - "同一天"判断一律使用本地时区日期键（修复正偏移时区凌晨错配）
 *  - 离线快进分级：<1 天补齐当日；1-7 天逐天补齐；>7 天仅补今天
 * ============================================================
 */
import { useAiLifeStore, isAiLifePlanGenerating } from '../../store/aiLifeStore';
import { useDebugLog } from '../../store/debugLogStore';
import { useCharacterStore } from '../../store/characterStore';
import {
  dbGetAiActivities,
  dbBatchSaveAiActivities,
  dbGetAiLifeConfig,
  dbSaveAiLifeConfig,
  dbSaveAiDiary,
  dbGetAiLifeEvents,
  dbMarkAiLifeEventsInjected,
  AiLifeActivity,
  AiLifeEvent,
} from '../../lib/tauriBridge';
import {
  shouldUseLLMForProcess,
  shouldUseLLMForSummary,
  isGenerationEnabled,
  generateActivityProcess,
  generateActivitySummary,
  generateDiaryContent,
} from './contentGenerator';
import {
  maybeProactiveOnActivityStart,
  wakeUpCatchUp,
} from './chatIntegration';
import { useProactiveReplyStore } from '../../store/proactiveReplyStore';
import {
  applyActivityEffect,
  applyHourlyDecay,
  checkAndApplyThresholds,
} from './attributeSystem';
import { checkRandomEvent, checkSpontaneousChange, auditRandomEventKeys } from './randomEvents';
import { getWorldById } from './worldConfig';
import { buildDaySchedule, dateStr, localDateKey, dayRange } from './scheduleTemplates';
import { useModuleRegistry } from '../modules/registry';
// 🆕 D2: 日记回灌记忆；D4: 创意工坊提案
import { useMemoryStore } from '../../store/memoryStore';
import { generateContentProposals } from './contentWorkshop';

/** 小时级任务（衰减/随机事件/主动变卦）的上次执行标记 */
let lastHourlyRun = 0;

/** 🆕 B7: 追加活动过程节点（过程留痕，供活动卡片时间轴展开） */
function pushActivityStep(
  act: { id: string; steps?: Array<{ time: string; phase: string; note: string }> },
  phase: 'start' | 'mid' | 'end' | 'interrupted',
  note: string,
): void {
  if (!act.steps) act.steps = [];
  act.steps.push({ time: new Date().toISOString(), phase, note });
}

// ---------------- 引擎核心 ----------------

let ticking = false;

/** 上次 tick 的本地日期键：跨天首帧先补清晨日程，避免"0 点-当前"的历史缺失 */
let lastTickDayKey = '';

/** 🆕 引擎启动单飞守卫：同一角色同一时刻只跑一次启动同步。
 *  App 启动时有两处调用入口（boot init + 角色切换 effect），
 *  并发执行会让"今日无日程→模板补齐"双写两套相同日程（每项活动出现两遍）。 */
const startingCharacters = new Set<string>();

/** 应用启动或角色切换时调用：加载配置、离线快进、生成今日日程 */
export async function ensureLifeEngineStarted(characterId: string | undefined): Promise<void> {
  if (!characterId) return;
  if (startingCharacters.has(characterId)) return; // 已在同步中 → 跳过重复启动
  startingCharacters.add(characterId);
  try {
    // 角色切换时清空上一角色的状态残留
    useAiLifeStore.getState().setCurrentActivity(null);
    const config = await dbGetAiLifeConfig(characterId);
    useAiLifeStore.getState().setConfig(config);
    if (!config.enabled) return;

    await syncToCurrentTime(characterId, config.lastActiveTime);
  } catch (e) {
    console.error('[lifeEngine] ensureStarted failed:', e);
  } finally {
    startingCharacters.delete(characterId);
  }
}

/** 离线快进（幂等）：根据 lastActiveTime 补齐缺失日程 */
async function syncToCurrentTime(characterId: string, lastActiveTime: string): Promise<void> {
  const now = new Date();
  // 🆕 阶段6：读取世界设定包用于日程生成
  const cfg = useAiLifeStore.getState().config;
  const world = await getWorldById((cfg?.extra as { worldId?: string } | undefined)?.worldId);

  // 1. 今日无日程则生成（本地日期键匹配，避免 UTC 偏移错配）
  const todayKey = dateStr(now);
  const [todayFrom, todayTo] = dayRange(todayKey);
  let todayActivities = await dbGetAiActivities(characterId, todayFrom, todayTo);
  if (todayActivities.length === 0) {
    // 🆕 防重复生成：面板的计划生成（generatePlan）正在进行时跳过模板补齐，
    //    否则两边并发各写一套相同日程（模板种子随机同角色同日期时间完全一致）
    const planBusy = useAiLifeStore.getState().isGenerating || isAiLifePlanGenerating(characterId, todayKey);
    if (!planBusy) {
      // 不超前原则：只保留已开始的时段；未来的空白由空闲续写按需生成
      const nowIso = now.toISOString();
      todayActivities = buildDaySchedule(characterId, now, world).filter((a) => a.startTime <= nowIso);
      await dbBatchSaveAiActivities(todayActivities);
      useDebugLog.getState().add('ailife', `[AI-Life] 已生成今日日程（${todayActivities.length} 项）`, { characterId });
    }
  }

  // 2. 离线快进分级
  if (lastActiveTime) {
    const last = new Date(lastActiveTime).getTime();
    if (!Number.isNaN(last)) {
      const diffDays = Math.floor((now.getTime() - last) / 86400000);
      if (diffDays > 7) {
        // >7 天：只保留今天（历史留白），清理 8 天前到今天之间可能残留的 planned
        useDebugLog.getState().add('ailife', `[AI-Life] 离线 ${diffDays} 天，跳过历史直接同步今天`, { characterId });
      } else if (diffDays >= 1) {
        // 1-7 天：逐天用模板补齐并全部标记 completed（离线场景零 LLM，成本可控）
        for (let i = diffDays; i >= 1; i--) {
          const day = new Date(now.getTime() - i * 86400000);
          const ds = dateStr(day);
          const [dFrom, dTo] = dayRange(ds);
          const existing = await dbGetAiActivities(characterId, dFrom, dTo);
          const hasDay = existing.length > 0;
          if (!hasDay) {
            const acts = buildDaySchedule(characterId, day, world).map((a) => ({
              ...a,
              status: 'completed' as const,
              processDescription: a.processDescription || `（离线期间）${a.name}`,
            }));
            await dbBatchSaveAiActivities(acts);
          }
        }
        useDebugLog.getState().add('ailife', `[AI-Life] 离线快进 ${diffDays} 天完成`, { characterId });
        // 补写离线期间缺失的日记
        await backfillMissingDiaries(characterId);
      }
    }
  }

  // 3. 刷新状态并更新 lastActiveTime
  await refreshDayState(characterId);
  const newConfig = { ...(await dbGetAiLifeConfig(characterId)), lastActiveTime: now.toISOString() };
  await dbSaveAiLifeConfig(newConfig);
  useAiLifeStore.getState().setConfig(newConfig);
}

/**
 * 分钟级心跳（由 ailife-tick 驱动）：
 * 推进 planned→ongoing→completed 转换并刷新当前活动。
 * 幂等：重复调用/休眠恢复均安全。
 */
export async function lifeTick(characterId: string | undefined): Promise<void> {
  if (!characterId || ticking) return;
  const config = useAiLifeStore.getState().config;
  // 配置未加载 / 角色不匹配 / 引擎未启用时跳过
  if (!config || config.characterId !== characterId || !config.enabled) return;
  ticking = true;
  try {
    // 🆕 修复：跨天首帧先同步一次，生成今天 0 点起到当前的已完成日程
    //    （应用持续运行跨过午夜时，仅靠空闲续写不会回填清晨历史）
    const tickDayKey = localDateKey(new Date());
    if (lastTickDayKey !== tickDayKey) {
      lastTickDayKey = tickDayKey;
      await syncToCurrentTime(characterId, useAiLifeStore.getState().config?.lastActiveTime);
    }

    await refreshDayState(characterId);

    // 🆕 阶段3/4：小时级任务——属性衰减、随机事件、主动变卦、本地经济自主运转
    const nowMs = Date.now();
    if (nowMs - lastHourlyRun >= 3600000) {
      lastHourlyRun = nowMs;
      const isSleeping = useAiLifeStore.getState().currentActivity?.category === 'sleep';
      applyHourlyDecay(characterId, !!isSleeping)
        .then((attrs) => checkAndApplyThresholds(characterId, attrs))
        .catch(() => {});
      checkRandomEvent(characterId).catch(() => {});
      checkSpontaneousChange(characterId).catch(() => {});
      // 🆕 本地经济：发薪/日用品消耗/自主补货/小额开销（纯本地规则，无 API）
      import('./localEconomy').then(({ runLocalEconomyTick }) => runLocalEconomyTick(characterId)).catch(() => {});
      // 🆕 B3: 念头-决策系统——四路扫描 → LLM/算法决策 → 采纳/拖延/拒绝
      import('./decisionEngine').then(({ runNeedDecisionTick }) => runNeedDecisionTick(characterId)).catch(() => {});
    }
    // 🆕 空闲续写：没有进行中的活动时让 AI 决定此刻做什么（10 分钟节流）
    await maybeGenerateNextActivity(characterId);
  } catch (e) {
    console.error('[lifeEngine] tick failed:', e);
  } finally {
    ticking = false;
  }
}

const stateCache: Record<string, { date: string; activities: AiLifeActivity[] }> = {};

/** 空闲续写节流时长（10 分钟） */
const IDLE_THROTTLE_MS = 10 * 60 * 1000;

/** 空闲续写的上次触发时间戳（仅作同帧快速判断；权威值持久化在 ai_life_config.extra.lastIdleGenAt，跨重载/热更新仍生效） */
const lastIdleGenAt: Record<string, number> = {};

/** 🆕 空闲续写实例内互斥：生成 await 窗口内不允许第二个调用进入（跨实例由 DB 唯一索引兜底） */
const idleGenerating = new Set<string>();

/** 读取角色的空闲续写节流时间戳：优先取持久化值，兼容模块级内存旧值 */
function readIdleThrottle(): number {
  const cfg = useAiLifeStore.getState().config;
  const persisted = cfg?.extra?.lastIdleGenAt;
  const p = typeof persisted === 'number' && Number.isFinite(persisted) ? persisted : 0;
  const mem = lastIdleGenAt[cfg?.characterId || ''];
  return Math.max(p, mem || 0);
}

/** 写入空闲续写节流时间戳：同步更新内存 + 异步持久化（防止热更新/刷新导致节流失效） */
function writeIdleThrottle(ts: number): void {
  const cfg = useAiLifeStore.getState().config;
  if (!cfg) return;
  lastIdleGenAt[cfg.characterId] = ts;
  const extra = cfg.extra || (cfg.extra = {});
  extra.lastIdleGenAt = ts;
  void dbSaveAiLifeConfig(cfg).catch(() => {});
}

/**
 * 外部抑制空闲续写（如用户主动删除当天内容后），
 * durationMs 内不再自动生成新活动（跨重载有效）。
 */
export function suppressIdleGeneration(characterId: string, durationMs: number): void {
  const until = Date.now() + Math.max(0, durationMs - IDLE_THROTTLE_MS);
  const cfg = useAiLifeStore.getState().config;
  if (cfg?.characterId === characterId) {
    lastIdleGenAt[characterId] = until;
    const extra = cfg.extra || (cfg.extra = {});
    extra.lastIdleGenAt = until;
    void dbSaveAiLifeConfig(cfg).catch(() => {});
  }
}

/**
 * 空闲续写（替代原"重新生成"按钮与全天重排）：
 * 当前没有进行中的活动且引擎开启时，让 AI 决定"此刻在做什么"，
 * 生成单个从现在开始的活动。遵守不超前原则，10 分钟节流。
 */
async function maybeGenerateNextActivity(characterId: string): Promise<void> {
  const store = useAiLifeStore.getState();
  if (!store.config?.enabled) return;
  if (store.currentActivity) return; // 有进行中的活动 → 无需续写
  if (idleGenerating.has(characterId)) return; // 🆕 实例内互斥：生成窗口内不重入

  const now = Date.now();
  const last = readIdleThrottle();
  if (now - last < IDLE_THROTTLE_MS) return;

  // 🆕 修复重叠生成：以【数据库】为准判断覆盖，而非内存 store。
  //    此前内存判定在 HMR 新模块实例（store 为空）或旧实例（缓存过期）下
  //    会误判"无覆盖"，每个实例各写一份 → 同一分钟出现多条重复活动。
  const todayKey = dateStr(new Date());
  const nowIso = new Date().toISOString();
  const soonIso = new Date(now + 45 * 60 * 1000).toISOString();
  const [covFrom, covTo] = dayRange(todayKey);
  const dbActs = await dbGetAiActivities(characterId, covFrom, covTo);
  const hasCoverage = dbActs.some(
    (a) => a.status !== 'cancelled' && a.startTime <= soonIso && a.endTime > nowIso,
  );
  if (hasCoverage) {
    writeIdleThrottle(now);
    return;
  }

  writeIdleThrottle(now);
  idleGenerating.add(characterId);

  try {
    const char = useCharacterStore.getState().characters.find((c) => c.id === characterId);
    if (!char) return;

    const world = await getWorldById((store.config.extra as { worldId?: string } | undefined)?.worldId);
    const profile = (store.config.extra as { profile?: { job?: string; routine?: string } } | undefined)?.profile;
    const { generateNextActivity } = await import('./scheduleGenerator');
    const act = await generateNextActivity(char, world, profile);
    if (!act) return;

    // 🆕 写前复查：生成 await 窗口内其他实例/入口可能已写入覆盖活动 → 丢弃本次结果
    const [reFrom, reTo] = dayRange(todayKey);
    const latest = await dbGetAiActivities(characterId, reFrom, reTo);
    const nowCovered = latest.some(
      (a) => a.status !== 'cancelled' && a.startTime <= soonIso && a.endTime > nowIso,
    );
    if (nowCovered) {
      useDebugLog.getState().add('ailife', '[AI-Life] 空闲续写放弃：等待期间已有覆盖活动', { characterId });
      return;
    }

    // 以 DB 最新数据 + 本次活动为准刷新视图（内存可能过期）
    const acts = [...latest, act];
    await dbBatchSaveAiActivities([act]);
    useAiLifeStore.getState().setDayActivities(todayKey, acts);
    stateCache[characterId] = { date: dateStr(new Date()), activities: acts };
    useAiLifeStore.getState().setCurrentActivity(act);
    useDebugLog.getState().add('ailife', `[AI-Life] 空闲续写 → ${act.name}（${act.mood}）`, { characterId });
  } finally {
    idleGenerating.delete(characterId);
  }
}

async function refreshDayState(characterId: string): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();
  const store = useAiLifeStore.getState();

  // 读取当天活动（优先内存缓存）；本地日期键匹配
  const cached = stateCache[characterId];
  let activities: AiLifeActivity[];
  if (cached && cached.date === dateStr(now)) {
    activities = cached.activities;
  } else {
    // 🆕 性能：按本地日范围在服务端过滤，不再全表拉取再前端过滤
    const todayKey = localDateKey(now);
    const [fromIso, toIso] = dayRange(dateStr(now));
    activities = await dbGetAiActivities(characterId, fromIso, toIso);
    stateCache[characterId] = { date: dateStr(now), activities };

    // 同步到面板可见的日期数据
    store.setDayActivities(todayKey, activities);
  }

  if (activities.length === 0) {
    store.setCurrentActivity(null);
    return;
  }

  const config = useAiLifeStore.getState().config;

  // 幂等状态转换
  let dirty = false;
  for (const act of activities) {
    if (act.status === 'cancelled') continue;
    if (act.status === 'planned' && act.startTime <= nowIso && act.endTime > nowIso) {
      act.status = 'ongoing';
      act.updatedAt = nowIso;
      dirty = true;
      useDebugLog.getState().add('ailife', `[AI-Life] 开始: ${act.name}`, { characterId });
      // 🆕 B7: 过程留痕——start 节点
      pushActivityStep(act, 'start', `开始了「${act.name}」（${act.location || act.sceneId}）`);
      // 🆕 C1/B1: 活动开始 → 模块注册表广播（每日穿搭等结算）
      useModuleRegistry.getState().dispatchActivityStart(characterId, { id: act.id, name: act.name, category: act.category });
      // 🆕 D3: 入睡即进入固化窗口（补日记/提案/审计，零对外消息）
      if (act.category === 'sleep') {
        runSleepConsolidation(characterId, dateStr(new Date())).catch(() => {});
      }
      // 🆕 阶段5：活动开始时按事件频率概率性主动发消息
      maybeProactiveOnActivityStart(
        characterId,
        act,
        (cid, payload) => useProactiveReplyStore.getState().sendTaskMessage(cid, payload),
      ).catch(() => {});
      // 🆕 阶段2：full 档在活动开始时异步生成过程描述（不阻塞状态推进）
      if (shouldUseLLMForProcess(config)) {
        const char = useCharacterStore.getState().characters.find((c) => c.id === characterId);
        if (char) {
          generateActivityProcess(char, act)
            .then((desc) => {
              act.processDescription = desc;
              act.updatedAt = new Date().toISOString();
              return dbBatchSaveAiActivities([act]);
            })
            .then(() => {
              const todayKey = localDateKey(new Date());
              useAiLifeStore.getState().setDayActivities(todayKey, [...activities]);
            })
            .catch(() => {});
        }
      }
    } else if (act.status === 'ongoing' && act.endTime <= nowIso) {
      act.status = 'completed';
      act.updatedAt = nowIso;
      dirty = true;
      useDebugLog.getState().add('ailife', `[AI-Life] 结束: ${act.name}`, { characterId });
      // 🆕 B7: 过程留痕——end 节点
      pushActivityStep(act, 'end', `结束了「${act.name}」`);
      // 🆕 阶段3：活动结束时应用属性增减并检查阈值
      applyActivityEffect(characterId, act.category, act.name)
        .then((attrs) => checkAndApplyThresholds(characterId, attrs))
        .catch(() => {});
      // 🆕 C1/B1: 活动结束 → 模块注册表广播（用餐消耗食材、出勤日结薪等经济结算）
      useModuleRegistry.getState().dispatchActivityEnd(characterId, { id: act.id, name: act.name, category: act.category });
      // 🆕 阶段5：睡醒后轻描淡写带过睡眠期间的积压消息
      if (act.category === 'sleep') {
        wakeUpCatchUp(
          characterId,
          (cid, payload) => useProactiveReplyStore.getState().sendTaskMessage(cid, payload),
        ).catch(() => {});
      }
      // 🆕 阶段2：full/simplified 档生成总结
      if (shouldUseLLMForSummary(config)) {
        const char = useCharacterStore.getState().characters.find((c) => c.id === characterId);
        if (char) {
          generateActivitySummary(char, act)
            .then((summary) => {
              act.summary = summary;
              act.updatedAt = new Date().toISOString();
              return dbBatchSaveAiActivities([act]);
            })
            .then(() => {
              const todayKey = localDateKey(new Date());
              useAiLifeStore.getState().setDayActivities(todayKey, [...activities]);
            })
            .catch(() => {});
        }
      }
      // 🆕 阶段2：当天最后一个活动结束 → 生成日记
      const remainingOngoing = activities.some(
        (a) => a.id !== act.id && a.status === 'ongoing' && a.category !== 'sleep',
      );
      if (!remainingOngoing) {
        maybeGenerateDiary(characterId, activities, dateStr(now)).catch(() => {});
      }
    }
  }
  if (dirty) {
    await dbBatchSaveAiActivities([...activities]);
    const todayKey = now.toISOString().slice(0, 10);
    store.setDayActivities(todayKey, [...activities]);
  }

  // 当前活动 → 聊天顶部状态条
  const current = activities.find((a) => a.status === 'ongoing') || null;
  store.setCurrentActivity(current);
}

// ---------------- 日记生成（阶段 2） ----------------

/** 已生成日记的日期缓存（防重复生成） */
const diaryGenerated: Record<string, Set<string>> = {};

/**
 * 为指定日期生成并保存日记。
 * 幂等：同一天只生成一次；force=true 时跳过内存守卫（用于面板主动请求，
 * DB 守卫仍生效——已有日记则不重复生成）。
 * 触发点：当天最后一个非睡眠活动结束 / 离线快进补写 / 面板请求。
 */
export async function maybeGenerateDiary(
  characterId: string,
  activities: AiLifeActivity[],
  dayKey: string,
  opts?: { force?: boolean },
): Promise<boolean> {
  const config = useAiLifeStore.getState().config;
  if (!isGenerationEnabled(config) && !opts?.force) return false;

  // 内存守卫（force 可绕过）+ DB 守卫（重启后）
  let seen = diaryGenerated[characterId];
  if (!seen) { seen = new Set(); diaryGenerated[characterId] = seen; }
  if (seen.has(dayKey) && !opts?.force) return false;
  const existingDiaries = await dbGetAiDiariesSafe(characterId);
  if (existingDiaries.some((d) => d.date === dayKey)) {
    seen.add(dayKey);
    return false;
  }

  const char = useCharacterStore.getState().characters.find((c) => c.id === characterId);
  if (!char) return false;

  useDebugLog.getState().add('ailife', `[AI-Life] 开始生成 ${dayKey} 日记`, { characterId });
  const result = await generateDiaryContent(char, activities, dayKey);

  await dbSaveAiDiary({
    id: `diary_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    characterId,
    date: dayKey,
    title: result.title || `${dayKey} 的日记`,
    content: result.content,
    mood: result.mood,
    activities: activities.filter((a) => a.status !== 'cancelled').map((a) => ({ name: a.name, startTime: a.startTime, endTime: a.endTime })),
    thoughts: [],
    comments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  seen.add(dayKey);
  useDebugLog.getState().add('ailife', `[AI-Life] ${dayKey} 日记已保存`, { characterId });

  // 🆕 D2: 日记回灌记忆——一周后问"你上周干嘛了"能靠检索真实作答。
  //    取当日事件流（带 memorySalience 权重），摘要转写为记忆条目进向量检索池，
  //    并标记 consumed（injectedIntoChat=true）供 D1 消费审计。
  await feedDiaryToMemory(characterId, dayKey, result.title, result.content);
  return true;
}

/** 🆕 D2: 日记+当日事件流 → 记忆条目 */
async function feedDiaryToMemory(
  characterId: string,
  dayKey: string,
  diaryTitle: string,
  diaryContent: string,
): Promise<void> {
  try {
    const [fromIso, toIso] = dayRange(dayKey);
    const events: AiLifeEvent[] = await dbGetAiLifeEvents(characterId, fromIso, toIso).catch(() => [] as AiLifeEvent[]);
    const maxSalience = events.reduce((m, e) => Math.max(m, Number(e.meta?.memorySalience ?? 1)), 1);
    const highlights = events.filter((e) => e.type === 'milestone' || Number(e.meta?.memorySalience ?? 0) >= 3);
    const highlightText = highlights.length > 0 ? `这一天难忘的事：${highlights.map((e) => e.description).join('；')}。` : '';
    const entry = {
      id: `mem_diary_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      characterId,
      conversationId: 'ailife-diary',
      category: 'diary' as const,
      title: `${dayKey} 的经历：${diaryTitle}`,
      content: `${highlightText}${(diaryContent || '').slice(0, 500)}`.trim(),
      tags: ['日记', 'AI生活'],
      importance: Math.max(3, Math.min(9, 3 + maxSalience)),
      createdAt: new Date(),
    };
    await useMemoryStore.getState().addEntries(characterId, [entry]);
    // D1 记账：这些事件已被消费（进了记忆池）
    if (events.length > 0) {
      await dbMarkAiLifeEventsInjected(events.map((e) => e.id)).catch(() => {});
    }
    useDebugLog.getState().add('ailife', `[AI-Life][D2] 日记已回灌为记忆条目（${events.length} 条当日事件供回忆）`, { characterId });
  } catch { /* 静默：附属闭环不阻塞主流程 */ }
}

// ---------------- 🆕 D3: 睡眠固化窗口 ----------------

/** 已执行固化的「角色|日期」守卫 */
const consolidated = new Set<string>();

/**
 * 入睡后执行的固化任务（产品叙事："她睡觉时真的在消化这一天"）：
 * 1. 补写最近缺失的历史日记（含 D2 回灌）；2. D4 创意工坊提案；
 * 3. 输出 D1 消费审计快照。全程零对外消息。
 */
export async function runSleepConsolidation(characterId: string, dayKey: string): Promise<void> {
  const key = `${characterId}|${dayKey}`;
  if (consolidated.has(key)) return;
  consolidated.add(key);

  try {
    // 1) 历史日记补写（内部幂等 + DB 守卫）
    await backfillMissingDiaries(characterId);
  } catch { /* 静默 */ }

  try {
    // 2) D4 提案（限频内置：每周 ≤3 条；失败静默）
    await generateContentProposals(characterId);
  } catch { /* 静默 */ }

  try {
    // 3) D1 审计快照：「量变是否兑现」的仪表盘读数
    const { getAuditSummary } = await import('./pickStats');
    const { LEISURE_POOL } = await import('./activityTags');
    const keys = [
      ...LEISURE_POOL.map((p) => `act:${p.name}`),
      ...allEventKeys(characterId),
    ];
    const audit = getAuditSummary(keys);
    useDebugLog.getState().add(
      'ailife',
      `[AI-Life][D1审计] 池总量 ${audit.totalKeys}｜从未命中 ${audit.totalKeys - audit.everPicked}（${audit.everPicked === 0 ? '-' : Math.round(((audit.totalKeys - audit.everPicked) / audit.totalKeys) * 100)}%）｜TOP: ${audit.topPicks.map((t) => `${t.key.replace(/^(act|evt):/, '')}×${t.count}`).join('、')}`,
      { characterId },
    );
  } catch { /* 静默 */ }
}

/** 当日抽取候选全集（活动池 + 自定义/内置随机事件名）——D1 审计用 */
function allEventKeys(_characterId: string): string[] {
  return auditRandomEventKeys().map((n) => `evt:${n}`);
}

async function dbGetAiDiariesSafe(characterId: string) {
  try {
    const { dbGetAiDiaries } = await import('../../lib/tauriBridge');
    return await dbGetAiDiaries(characterId);
  } catch {
    return [];
  }
}

/** 补写缺失的历史日记（应用启动时调用；最多补 3 天，控制成本） */
async function backfillMissingDiaries(characterId: string): Promise<void> {
  const config = useAiLifeStore.getState().config;
  if (!config?.enabled || !isGenerationEnabled(config)) return;

  const now = new Date();
  for (let i = 1; i <= 3; i++) {
    const day = new Date(now.getTime() - i * 86400000);
    const dayKey = dateStr(day);
    const [bFrom, bTo] = dayRange(dayKey);
    const dayActs = await dbGetAiActivities(characterId, bFrom, bTo);
    if (dayActs.length === 0) continue; // 该日无活动记录则跳过
    await maybeGenerateDiary(characterId, dayActs, dayKey);
  }
}

/** 清除某角色的内存缓存（切换角色时调用） */
export function clearEngineCache(characterId?: string): void {
  if (characterId) delete stateCache[characterId];
  else for (const k of Object.keys(stateCache)) delete stateCache[k];
}
