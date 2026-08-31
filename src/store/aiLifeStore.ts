/**
 * ============================================================
 * AI 一日生活 Store（AI 生成版）
 *  - 活动数据存 SQLite（ai_activities），经 lifeEngine 引擎驱动
 *  - 日程生成 / 情绪转变 / 日记 全部由 AI 生成：
 *    · generatePlan    → LLM 个性化日程（模板仅兜底），保留已完成历史
 *    · shiftEmotionByAI → AI 回顾今天经历自主决定情绪转变与新安排
 *    · writeDiary      → AI 撰写当日日记
 *  - currentActivity 供聊天顶部状态条实时订阅
 * ============================================================
 */
import { create } from 'zustand';
import { format } from 'date-fns';
import {
  dbGetAiActivities,
  dbBatchSaveAiActivities,
  dbDeleteAiActivitiesByDate,
  dbGetAiLifeConfig,
  dbSaveAiLifeConfig,
  dbGetAiDiaries,
  AiLifeActivity,
  AiLifeConfig,
  AiLifeDiaryRecord,
} from '../lib/tauriBridge';
import { generateAIPlanSchedule } from '../services/ailife/scheduleGenerator';
import { generateEmotionShiftPlan, FALLBACK_SHIFTS, shouldUseLLMForProcess } from '../services/ailife/contentGenerator';
import { isReplyPipelineReady, isRoleModelReady } from '../services/aiService';
import { getWorldById } from '../services/ailife/worldConfig';
import { localDateKey } from '../services/ailife/scheduleTemplates';
import { useCharacterStore } from './characterStore';

/** 某日活动的时间范围（库内 start_time 为 UTC ISO）：按本地日零点换算成 UTC 边界 [当日00:00Z, 次日00:00Z) */
function dayRange(date: string): [string, string] {
  const from = new Date(`${date}T00:00:00`);            // 本地零点
  const to = new Date(from.getTime() + 24 * 3600 * 1000); // 次日本地零点
  return [from.toISOString(), to.toISOString()];        // 转成与库内一致的 UTC ISO 再比较
}

export interface AiComment {
  id: string;
  content: string;
  timestamp: string;
  type: 'user' | 'ai';
}

export interface AiActivitySlot {
  id: string;
  activityName: string;
  startTime: string;
  endTime: string;
  location: string;
  mood: string;
  description: string;
  comments: AiComment[];
  isChanged: boolean;
  originalActivityName?: string;
  originalDescription?: string;
  changeReason?: string;
}

export interface AiDiary {
  date: string;
  activities: AiActivitySlot[];
  createdAt: string;
  updatedAt: string;
}

/** AiLifeActivity → 面板槽位视图 */
function toSlot(a: AiLifeActivity): AiActivitySlot {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };
  return {
    id: a.id,
    activityName: a.name,
    startTime: fmt(a.startTime),
    endTime: fmt(a.endTime),
    location: a.location || a.sceneId,
    mood: a.mood,
    description: a.processDescription || a.summary || '',
    comments: (a.comments || []).filter((c) => c.type === 'user' || c.type === 'ai') as AiComment[],
    isChanged: a.isChanged,
    originalActivityName: a.changedFrom || undefined,
    originalDescription: undefined,
    changeReason: a.changedReason || undefined,
  };
}

interface AiLifeState {
  /** 日期 → 当日活动（真数据，ISO 时间戳） */
  dayActivities: Record<string, AiLifeActivity[]>;
  diaries: Record<string, AiDiary>;
  /** 日期 → 日记正文记录（LLM 生成，存 ai_diaries 表） */
  diaryRecords: Record<string, AiLifeDiaryRecord>;
  currentDate: string;
  isLoading: boolean;
  isGenerating: boolean;
  isShifting: boolean;
  isWritingDiary: boolean;

  currentDiary: AiDiary | null;
  /** 当前进行中的活动（聊天顶部状态条） */
  currentActivity: AiLifeActivity | null;
  /** 生活引擎配置（当前角色） */
  config: AiLifeConfig | null;

  setCurrentDate: (date: string) => void;
  loadDate: (characterId: string, date: string) => Promise<void>;
  /** AI 生成/重生成某日生活计划：今天只重排未来时段，保留已发生历史 */
  generatePlan: (date: string, characterIdArg?: string) => Promise<void>;
  /** AI 自主情绪转变：回顾今天经历决定新心情并调整后续计划 */
  shiftEmotionByAI: () => Promise<boolean>;
  /** 请 AI 为指定日期写日记 */
  writeDiary: (date: string, characterIdArg?: string) => Promise<void>;
  /** 三选一删除：activities=仅一日活动 / diary=仅日记 / all=全部 */
  deleteDay: (date: string, scope: 'activities' | 'diary' | 'all') => void;
  addComment: (slotId: string, comment: AiComment) => void;
  deleteComment: (slotId: string, commentId: string) => void;

  setDayActivities: (date: string, activities: AiLifeActivity[]) => void;
  setCurrentActivity: (a: AiLifeActivity | null) => void;
  setConfig: (c: AiLifeConfig | null) => void;
  updateConfig: (patch: Partial<AiLifeConfig>) => Promise<void>;
  refreshFromDb: (characterId: string) => Promise<void>;
}

/** 找到今天未来第一个可变更的计划活动下标 */
function findNextPlannedIdx(acts: AiLifeActivity[]): number {
  const nowIso = new Date().toISOString();
  return acts.findIndex((a) => a.endTime > nowIso && a.status === 'planned' && a.category !== 'sleep');
}

/** 🆕 计划生成互斥锁：同一「角色:日期」同时只允许一次生成（防并发双写产生两套重复日程） */
const planGeneratingKeys = new Set<string>();

/** 供引擎等外部模块查询：某「角色:日期」的计划是否正在生成中 */
export function isAiLifePlanGenerating(characterId?: string, date?: string): boolean {
  if (!characterId || !date) return useAiLifeStore.getState().isGenerating;
  return planGeneratingKeys.has(`${characterId}:${date}`);
}

export const useAiLifeStore = create<AiLifeState>((set, get) => ({
  dayActivities: {},
  diaries: {},
  diaryRecords: {},
  currentDate: format(new Date(), 'yyyy-MM-dd'),
  isLoading: false,
  isGenerating: false,
  isShifting: false,
  isWritingDiary: false,
  currentDiary: null,
  currentActivity: null,
  config: null,

  setCurrentDate: (date: string) => {
    const diary = get().diaries[date] || null;
    set({ currentDate: date, currentDiary: diary });
  },

  /** 从 SQLite 加载某日活动并组装面板视图（cancelled 不显示） */
  loadDate: async (characterId: string, date: string) => {
    set({ isLoading: true });
    try {
      // 🆕 性能：按日期范围在服务端过滤，并行拉取，不再全量扫全表再前端过滤
      const [from, to] = dayRange(date);
      const [acts, records] = await Promise.all([
        dbGetAiActivities(characterId, from, to),
        dbGetAiDiaries(characterId, date, date),
      ]);
      const visible = acts.filter((a) => a.status !== 'cancelled');
      const slots = visible.map(toSlot);
      const diary: AiDiary = {
        date,
        activities: slots,
        createdAt: acts[0]?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // 该日 LLM 日记正文（records 已按日期过滤，通常 0~1 条）
      const diaryRecord = records.find((r) => r.date === date);
      set((s) => ({
        dayActivities: { ...s.dayActivities, [date]: acts },
        diaries: { ...s.diaries, [date]: diary },
        diaryRecords: diaryRecord ? { ...s.diaryRecords, [date]: diaryRecord } : s.diaryRecords,
        currentDiary: get().currentDate === date ? diary : get().currentDiary,
        isLoading: false,
      }));
    } catch (e) {
      console.error('[aiLifeStore] loadDate failed:', e);
      set({ isLoading: false });
    }
  },

  /**
   * AI 生成生活计划（重新生成同一入口）：
   * - 今天：已完成/进行中/被打断的历史原样保留，未来 planned 由 LLM 重排；
   *   被替换的旧 planned 标记 cancelled（DB 无按 id 删除命令，视作撤回）。
   * - 过去/未来日期：全天生成。
   */
  generatePlan: async (date: string, characterIdArg?: string) => {
    // 🆕 本地模式识别：未配置提供商/模型 / 未给 ailife 角色分配模型时不进入"AI 正在安排"状态，
    // 直接用本地模板秒出日程；后续配置好模型后，引擎会由 AI 更新调整后续时段。
    const llmReady = isReplyPipelineReady().ready && isRoleModelReady('ailife');
    const characterId = characterIdArg || get().config?.characterId;
    if (!characterId) {
      console.error('[aiLifeStore] generatePlan failed: 未选择角色');
      return;
    }
    // 🆕 防重复生成：同一「角色:日期」已有生成在跑（面板自动触发 + 手动按钮/引导横幅并发）
    const lockKey = `${characterId}:${date}`;
    if (planGeneratingKeys.has(lockKey)) {
      logAiLife(`计划生成进行中，跳过重复触发: ${lockKey}`);
      return;
    }
    planGeneratingKeys.add(lockKey);
    set({ isGenerating: llmReady });
    try {
      const char = useCharacterStore.getState().characters.find((c) => c.id === characterId);
      if (!char) throw new Error('未找到角色数据');

      const world = await getWorldById((get().config?.extra as { worldId?: string } | undefined)?.worldId);
      const dayDate = new Date(date + 'T00:00:00');
      const isToday = localDateKey(new Date()) === date;
      const profile = (get().config?.extra as { profile?: { job?: string; routine?: string } } | undefined)?.profile;

      // AI 生成（未配置模型时 useLLM=false 直接走本地模板；内部失败同样自动回退模板）
      const generated = await generateAIPlanSchedule(char, dayDate, world, { fromNow: isToday, profile, useLLM: llmReady });

      // 🆕 生成等待期间（LLM 可能耗时数秒～数十秒），引擎/其他入口可能已写入当日日程；
      // 以库内最新数据为准做合并，而非生成前的旧快照，避免同一份日程被双写两遍。
      const [from, to] = dayRange(date);
      const currentRows = await dbGetAiActivities(characterId, from, to);
      const keepHistory = isToday
        ? currentRows.filter((a) => a.status !== 'planned')
        : [];
      // 今天：撤回旧的 planned（被新计划替换）；非今天：全天重排 → 旧条目全部撤回
      const toCancel = isToday
        ? currentRows.filter((a) => a.status === 'planned')
        : currentRows.filter((a) => a.status !== 'cancelled');

      // 去掉与保留历史时间重叠的新条目（只保留从历史末尾之后开始的部分）
      const keptEnd = keepHistory.reduce<string>((max, a) => (a.endTime > max ? a.endTime : max), '');
      let fresh = keptEnd ? generated.filter((a) => a.startTime >= keptEnd) : generated;
      // 🆕 双保险：与保留历史同名同开始时间（模板种子随机对同角色同日期输出完全相同的时间）
      // 的重复条目直接丢弃，杜绝"每项活动出现两遍"
      const seenKey = new Set(keepHistory.map((a) => `${a.name}|${a.startTime}`));
      fresh = fresh.filter((a) => !seenKey.has(`${a.name}|${a.startTime}`));

      const cancelled = toCancel.map((a) => ({
        ...a,
        status: 'cancelled' as const,
        updatedAt: new Date().toISOString(),
      }));
      const finalActs = [...keepHistory, ...fresh];
      if (cancelled.length > 0) await dbBatchSaveAiActivities(cancelled);
      await dbBatchSaveAiActivities(finalActs);

      const slots = finalActs.filter((a) => a.status !== 'cancelled').map(toSlot);
      const now = new Date().toISOString();
      const diary: AiDiary = { date, activities: slots, createdAt: now, updatedAt: now };
      set((state) => ({
        dayActivities: { ...state.dayActivities, [date]: finalActs },
        diaries: { ...state.diaries, [date]: diary },
        currentDiary: state.currentDate === date ? diary : state.currentDiary,
        isGenerating: false,
      }));
      // 引擎立即校准一次当前活动（新计划可能已开始）
      import('../services/ailife/lifeEngine').then(({ lifeTick }) => lifeTick(characterId)).catch(() => {});
    } catch (e) {
      console.error('[aiLifeStore] generatePlan failed:', e);
      logAiLife(`计划生成失败: ${e instanceof Error ? e.message : String(e)}`);
      set({ isGenerating: false });
    } finally {
      planGeneratingKeys.delete(lockKey);
    }
  },

  /** AI 自主情绪转变（替代原手动"选情绪+填原因"）：返回是否成功变更 */
  shiftEmotionByAI: async () => {
    const { config, currentDate } = get();
    const characterId = config?.characterId;
    if (!characterId) return false;
    const dateKey = localDateKey(new Date());
    const acts = [...(get().dayActivities[dateKey] || [])];
    const idx = findNextPlannedIdx(acts);
    if (idx === -1) {
      logAiLife('情绪转变跳过：今天已没有可调整的计划');
      return false;
    }

    set({ isShifting: true });
    try {
      const char = useCharacterStore.getState().characters.find((c) => c.id === characterId);
      const target = acts[idx];
      let plan;
      if (char && shouldUseLLMForProcess(config)) {
        plan = await generateEmotionShiftPlan(char, characterId).catch(() => null);
      }
      if (!plan) {
        // 兜底池：按主导情绪选取
        let domType = 'joy';
        try {
          const { useCharacterMindStore } = await import('./characterMindStore');
          domType = useCharacterMindStore.getState().getDominantEmotion(characterId)?.type || 'joy';
        } catch { /* ignore */ }
        const key = ['sadness', 'anger', 'fear'].includes(domType) ? 'sad'
          : (['surprise', 'anticipation'].includes(domType) ? 'excited' : 'happy');
        const alt = FALLBACK_SHIFTS[key];
        plan = { ...alt, reason: '突然想换个心情' };
      }

      const nowIso = new Date().toISOString();
      const changedAct: AiLifeActivity = {
        ...target,
        name: plan.activityName,
        category: plan.category,
        mood: plan.mood,
        processDescription: plan.description,
        summary: `因为「${plan.reason}」改变了计划`,
        isChanged: true,
        changedFrom: target.changedFrom || target.name,
        changedReason: plan.reason,
        updatedAt: nowIso,
      };
      acts[idx] = changedAct;
      await dbBatchSaveAiActivities([changedAct]);

      // 刷新视图（当天视图 + 面板选中日视图）
      const slots = acts.filter((a) => a.status !== 'cancelled').map(toSlot);
      const updated: AiDiary = {
        date: dateKey,
        activities: slots,
        createdAt: get().diaries[dateKey]?.createdAt || nowIso,
        updatedAt: nowIso,
      };
      set((state) => ({
        dayActivities: { ...state.dayActivities, [dateKey]: acts },
        diaries: { ...state.diaries, [dateKey]: updated },
        currentDiary: state.currentDate === dateKey ? updated : state.currentDiary,
        isShifting: false,
      }));
      if (currentDate !== dateKey) get().loadDate(characterId, currentDate);
      return true;
    } catch (e) {
      console.error('[aiLifeStore] shiftEmotionByAI failed:', e);
      set({ isShifting: false });
      return false;
    }
  },

  /** 请 AI 写指定日期的日记（幂等：已有日记不会重复生成） */
  writeDiary: async (date: string, characterIdArg?: string) => {
    const characterId = characterIdArg || get().config?.characterId;
    if (!characterId) return;
    set({ isWritingDiary: true });
    try {
      const acts = get().dayActivities[date] || [];
      const list = acts.length > 0 ? acts : (await dbGetAiActivities(...dayRange(date)));
      if (list.length === 0) {
        set({ isWritingDiary: false });
        return;
      }
      const { maybeGenerateDiary } = await import('../services/ailife/lifeEngine');
      await maybeGenerateDiary(characterId, list, date, { force: true });
      // 回读日记记录
      const records = await dbGetAiDiaries(characterId, date, date);
      const record = records.find((r) => r.date === date);
      if (record) {
        set((s) => ({ diaryRecords: { ...s.diaryRecords, [date]: record } }));
      }
    } catch (e) {
      console.error('[aiLifeStore] writeDiary failed:', e);
    } finally {
      set({ isWritingDiary: false });
    }
  },

  deleteDay: (date: string, scope: 'activities' | 'diary' | 'all') => {
    const characterId = get().config?.characterId;
    const isToday = date === format(new Date(), 'yyyy-MM-dd');

    // 1) 删除活动：清活动数据并重建"空时间线"视图；日记卡片保留
    if (scope === 'activities' || scope === 'all') {
      set((state) => {
        const restActs = { ...state.dayActivities };
        delete restActs[date];
        if (scope === 'all') {
          const restDiaries = { ...state.diaries };
          delete restDiaries[date];
          return {
            dayActivities: restActs,
            diaries: restDiaries,
            currentDiary: state.currentDate === date ? null : state.currentDiary,
            currentActivity: isToday ? null : state.currentActivity,
          };
        }
        // 仅删活动：保留日记视图，时间线显示为空
        const kept = state.diaries[date];
        const emptyDiary: AiDiary = {
          date,
          activities: [],
          createdAt: kept?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return {
          dayActivities: restActs,
          diaries: { ...state.diaries, [date]: emptyDiary },
          currentDiary: state.currentDate === date ? emptyDiary : state.currentDiary,
          currentActivity: isToday ? null : state.currentActivity,
        };
      });
      if (characterId) {
        const dayStart = new Date(date + 'T00:00:00').toISOString();
        const dayEnd = new Date(date + 'T23:59:59').toISOString();
        dbDeleteAiActivitiesByDate(characterId, dayStart, dayEnd).catch(() => {});
      }
      // 🆕 修复"清除缺少属性和状态清空"：全部删除且是今天时，连同属性与运行状态
      // 一起重置——属性回归默认值、清空挂起念头/决策预算，角色"新的一天重新开始"，
      // 避免删除记录后属性仍残留为 0（饿/累）导致面板与日程矛盾。
      if (scope === 'all' && isToday && characterId) {
        import('../services/ailife/attributeSystem').then(({ resetAttributes }) => resetAttributes(characterId)).catch(() => {});
        import('../services/ailife/decisionEngine').then(({ clearDecisionState }) => clearDecisionState(characterId)).catch(() => {});
      }
      // 抑制引擎空闲续写，避免刚删完又被 AI 自动重建
      if (isToday) {
        import('../services/ailife/lifeEngine')
          .then(({ suppressIdleGeneration }) => suppressIdleGeneration(characterId || '', 30 * 60 * 1000))
          .catch(() => {});
      }
    }

    // 2) 删除日记：只删日记正文记录；时间线活动原样保留
    if (scope === 'diary' || scope === 'all') {
      const record = get().diaryRecords[date];
      set((state) => {
        const restRecords = { ...state.diaryRecords };
        delete restRecords[date];
        return { diaryRecords: restRecords };
      });
      if (record) {
        import('../lib/tauriBridge').then(({ dbDeleteAiDiaryRecord }) => dbDeleteAiDiaryRecord(record.id)).catch(() => {});
      }
    }
  },

  addComment: (slotId: string, comment: AiComment) => {
    const { currentDiary, dayActivities, currentDate } = get();
    if (!currentDiary) return;
    const acts = [...(dayActivities[currentDate] || [])];
    const idx = acts.findIndex((a) => a.id === slotId);
    if (idx === -1) return;
    const updatedAct: AiLifeActivity = {
      ...acts[idx],
      comments: [...(acts[idx].comments || []), comment],
      updatedAt: new Date().toISOString(),
    };
    acts[idx] = updatedAct;
    dbBatchSaveAiActivities([updatedAct]).catch(() => {});
    const updated: AiDiary = {
      ...currentDiary,
      activities: acts.filter((a) => a.status !== 'cancelled').map(toSlot),
      updatedAt: updatedAct.updatedAt,
    };
    set((state) => ({
      dayActivities: { ...state.dayActivities, [currentDate]: acts },
      diaries: { ...state.diaries, [currentDate]: updated },
      currentDiary: state.currentDate === currentDate ? updated : state.currentDiary,
    }));
  },

  deleteComment: (slotId: string, commentId: string) => {
    const { currentDiary, dayActivities, currentDate } = get();
    if (!currentDiary) return;
    const acts = [...(dayActivities[currentDate] || [])];
    const idx = acts.findIndex((a) => a.id === slotId);
    if (idx === -1) return;
    const updatedAct: AiLifeActivity = {
      ...acts[idx],
      comments: (acts[idx].comments || []).filter((c) => c.id !== commentId),
      updatedAt: new Date().toISOString(),
    };
    acts[idx] = updatedAct;
    dbBatchSaveAiActivities([updatedAct]).catch(() => {});
    const updated: AiDiary = {
      ...currentDiary,
      activities: acts.filter((a) => a.status !== 'cancelled').map(toSlot),
      updatedAt: updatedAct.updatedAt,
    };
    set((state) => ({
      dayActivities: { ...state.dayActivities, [currentDate]: acts },
      diaries: { ...state.diaries, [currentDate]: updated },
      currentDiary: state.currentDate === currentDate ? updated : state.currentDiary,
    }));
  },

  /**
   * 引擎写入当日活动的统一入口：
   * 同步重建面板视图（diaries/currentDiary），这样 AI 自主变卦 /
   * 情绪转变发生后，正在浏览的时间线会立即刷新，无需手动操作。
   */
  setDayActivities: (date, activities) => {
    set((s) => {
      const slots = activities.filter((a) => a.status !== 'cancelled').map(toSlot);
      const prev = s.diaries[date];
      const diary: AiDiary = {
        date,
        activities: slots,
        createdAt: prev?.createdAt || activities[0]?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return {
        dayActivities: { ...s.dayActivities, [date]: activities },
        diaries: { ...s.diaries, [date]: diary },
        currentDiary: s.currentDate === date ? diary : s.currentDiary,
      };
    });
  },
  setCurrentActivity: (a) => set({ currentActivity: a }),
  setConfig: (c) => set({ config: c }),

  updateConfig: async (patch) => {
    const cur = get().config;
    if (!cur) return;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    set({ config: next });
    await dbSaveAiLifeConfig(next).catch(() => {});
  },

  refreshFromDb: async (characterId) => {
    const cfg = await dbGetAiLifeConfig(characterId);
    set({ config: cfg });
  },
}));

function logAiLife(message: string): void {
  import('../store/debugLogStore')
    .then(({ useDebugLog }) => useDebugLog.getState().add('ailife', `[AI-Life] ${message}`))
    .catch(() => {});
}
