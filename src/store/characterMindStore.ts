
import { create } from 'zustand';
import { Memory, Reflection, EmotionType, AffinityState, AffinityEvent, AffinityStage, MultiEmotionState, defaultMultiEmotionState } from '../types';
import {
  isRunningInTauri,
  dbGetMemories,
  dbSaveMemories,
  dbGetReflections,
  dbSaveReflections,
  dbGetCharacterEmotions,
  dbSaveCharacterEmotions,
  dbGetCharacterAffinities,
  dbSaveCharacterAffinities,
} from '../lib/tauriBridge';
import { getAffinityStage, calcDecay } from '../services/aiService';
import { getDominantEmotion } from '../utils/emotionAnalyzer';
import { getEmotionStateManager } from '../services/emotion/emotionStateManager';
import { CoreMemory, EpisodicMemory, calculateMemoryClarity } from '../services/memory/memorySystemV2';
import { useConfigStore } from './configStore';
import { applyAffinityDelta, getAffinityLockValue, applyEmotionValueOverrides, getMemoryDecayRate } from '../services/dataOverrideBridge';

const EMOTION_STORAGE_KEY = 'ai-character-emotions';
const AFFINITY_STORAGE_KEY = 'ai-character-affinities';
const MULTI_EMOTION_STORAGE_KEY = 'ai-character-emotions-v2';
const CORE_MEMORY_STORAGE_KEY = 'ai-core-memories-v2';
const EPISODIC_MEMORY_STORAGE_KEY = 'ai-episodic-memories-v2';
const DAILY_EMOTION_SNAPSHOT_KEY = 'ai-character-emotions-daily-snapshot';

function loadEmotionStatesFromStorage(): Record<string, { emotion: EmotionType; intensity: number }> {
  try {
    const stored = localStorage.getItem(EMOTION_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveEmotionStatesToStorage(states: Record<string, { emotion: EmotionType; intensity: number }>) {
  try {
    localStorage.setItem(EMOTION_STORAGE_KEY, JSON.stringify(states));
  } catch { /* ignore */ }
}

function loadMultiEmotionStatesFromStorage(): Record<string, MultiEmotionState> {
  try {
    const stored = localStorage.getItem(MULTI_EMOTION_STORAGE_KEY);
    if (!stored) {
      // v1 → v2 迁移：兼容旧格式
      const old = localStorage.getItem(EMOTION_STORAGE_KEY);
      if (old) {
        const parsed = JSON.parse(old) as Record<string, { emotion: EmotionType; intensity: number }>;
        const v2: Record<string, MultiEmotionState> = {};
        for (const [charId, e] of Object.entries(parsed)) {
          v2[charId] = {
            ...defaultMultiEmotionState,
            values: { [e.emotion]: e.intensity },
            lastUpdated: Date.now(),
          };
        }
        return v2;
      }
      return {};
    }
    return JSON.parse(stored);
  } catch {
    return {};
  }
}

function saveMultiEmotionStatesToStorage(states: Record<string, MultiEmotionState>) {
  try {
    localStorage.setItem(MULTI_EMOTION_STORAGE_KEY, JSON.stringify(states));
  } catch { /* ignore */ }
}

function persistMultiEmotions(states: Record<string, MultiEmotionState>) {
  saveMultiEmotionStatesToStorage(states);
  // Note: No Tauri DB persistence for multi-emotion yet (using localStorage only)
}

// ---- Bug1: 情绪按日期分离 ----
interface DailyEmotionSnapshot {
  date: string; // "YYYY-MM-DD"
  values: Partial<Record<EmotionType, number>>;
  emotion: EmotionType;
  intensity: number;
}

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadDailySnapshots(): Record<string, DailyEmotionSnapshot> {
  try {
    const stored = localStorage.getItem(DAILY_EMOTION_SNAPSHOT_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveDailySnapshots(snapshots: Record<string, DailyEmotionSnapshot>) {
  try {
    localStorage.setItem(DAILY_EMOTION_SNAPSHOT_KEY, JSON.stringify(snapshots));
  } catch { /* ignore */ }
}

/** 获取角色的显示情绪：当天有对话则用实时情绪，否则用上次对话冻结的情绪 */
function getDisplayEmotion(
  characterId: string,
  multiEmotions: Record<string, MultiEmotionState>,
  dailySnapshots: Record<string, DailyEmotionSnapshot>,
): MultiEmotionState {
  const today = getTodayStr();
  const snapshot = dailySnapshots[characterId];
  const live = multiEmotions[characterId];

  // 当天有活跃对话（lastUpdated 是今天），使用实时情绪
  if (live && live.lastUpdated) {
    const liveDate = new Date(live.lastUpdated);
    const liveStr = `${liveDate.getFullYear()}-${String(liveDate.getMonth() + 1).padStart(2, '0')}-${String(liveDate.getDate()).padStart(2, '0')}`;
    if (liveStr === today) {
      return live;
    }
  }

  // 非当天或无活跃对话：使用冻结的每日情绪快照
  if (snapshot && snapshot.date) {
    return {
      ...defaultMultiEmotionState,
      values: snapshot.values,
      lastUpdated: Date.now(),
      interactions: live?.interactions || 0,
    };
  }

  // 无快照则返回 live（可能为空）
  return live || { ...defaultMultiEmotionState };
}

// ---------- V2 双层记忆加载/保存 ----------

function loadCoreMemoriesFromStorage(): Record<string, CoreMemory[]> {
  try {
    const stored = localStorage.getItem(CORE_MEMORY_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, CoreMemory[]>;
    for (const key of Object.keys(parsed)) {
      for (const mem of parsed[key]) {
        mem.createdAt = new Date(mem.createdAt);
        mem.updatedAt = new Date(mem.updatedAt);
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveCoreMemoriesToStorage(states: Record<string, CoreMemory[]>) {
  try {
    localStorage.setItem(CORE_MEMORY_STORAGE_KEY, JSON.stringify(states));
  } catch { /* ignore */ }
}

function loadEpisodicMemoriesFromStorage(): Record<string, EpisodicMemory[]> {
  try {
    const stored = localStorage.getItem(EPISODIC_MEMORY_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, EpisodicMemory[]>;
    for (const key of Object.keys(parsed)) {
      for (const mem of parsed[key]) {
        mem.occurredAt = new Date(mem.occurredAt);
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveEpisodicMemoriesToStorage(states: Record<string, EpisodicMemory[]>) {
  try {
    localStorage.setItem(EPISODIC_MEMORY_STORAGE_KEY, JSON.stringify(states));
  } catch { /* ignore */ }
}

let persistCoreMemTimer: ReturnType<typeof setTimeout> | null = null;
let persistEpisodicTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersistCoreMemories(states: Record<string, CoreMemory[]>) {
  if (persistCoreMemTimer) clearTimeout(persistCoreMemTimer);
  persistCoreMemTimer = setTimeout(() => saveCoreMemoriesToStorage(states), 300);
}

function debouncedPersistEpisodicMemories(states: Record<string, EpisodicMemory[]>) {
  if (persistEpisodicTimer) clearTimeout(persistEpisodicTimer);
  persistEpisodicTimer = setTimeout(() => saveEpisodicMemoriesToStorage(states), 300);
}

function loadAffinityStatesFromStorage(): Record<string, AffinityState> {
  try {
    const stored = localStorage.getItem(AFFINITY_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, AffinityState>;
    for (const key of Object.keys(parsed)) {
      parsed[key].lastInteraction = new Date(parsed[key].lastInteraction);
      for (const evt of parsed[key].history) {
        evt.timestamp = new Date(evt.timestamp);
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveAffinityStatesToStorage(states: Record<string, AffinityState>) {
  try {
    localStorage.setItem(AFFINITY_STORAGE_KEY, JSON.stringify(states));
  } catch { /* ignore */ }
}

function persistEmotions(states: Record<string, { emotion: EmotionType; intensity: number }>) {
  saveEmotionStatesToStorage(states);
  if (isRunningInTauri()) {
    dbSaveCharacterEmotions(states).catch(() => {});
  }
}

function persistAffinities(states: Record<string, AffinityState>) {
  saveAffinityStatesToStorage(states);
  if (isRunningInTauri()) {
    const serialized: Record<string, { level: number; stage: string; history: string; lastInteraction: string }> = {};
    for (const [charId, s] of Object.entries(states)) {
      serialized[charId] = {
        level: s.level,
        stage: s.stage,
        history: JSON.stringify(s.history),
        lastInteraction: s.lastInteraction instanceof Date ? s.lastInteraction.toISOString() : String(s.lastInteraction),
      };
    }
    dbSaveCharacterAffinities(serialized).catch(() => {});
  }
}

function defaultAffinityState(): AffinityState {
  return {
    level: 0,
    stage: 'stranger',
    history: [],
    lastInteraction: new Date(),
  };
}

let persistEmotionTimer: ReturnType<typeof setTimeout> | null = null;
let persistAffinityTimer: ReturnType<typeof setTimeout> | null = null;
let persistMultiEmotionTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedPersistEmotions(states: Record<string, { emotion: EmotionType; intensity: number }>) {
  if (persistEmotionTimer) clearTimeout(persistEmotionTimer);
  persistEmotionTimer = setTimeout(() => persistEmotions(states), 300);
}

function debouncedPersistAffinities(states: Record<string, AffinityState>) {
  if (persistAffinityTimer) clearTimeout(persistAffinityTimer);
  persistAffinityTimer = setTimeout(() => persistAffinities(states), 300);
}

function debouncedPersistMultiEmotions(states: Record<string, MultiEmotionState>) {
  if (persistMultiEmotionTimer) clearTimeout(persistMultiEmotionTimer);
  persistMultiEmotionTimer = setTimeout(() => persistMultiEmotions(states), 300);
}

interface CharacterMindState {
  memories: Record<string, Memory[]>;
  reflections: Record<string, Reflection[]>;
  emotionStates: Record<string, { emotion: EmotionType; intensity: number }>;
  affinityStates: Record<string, AffinityState>;
  multiEmotions: Record<string, MultiEmotionState>;
  coreMemories: Record<string, CoreMemory[]>;
  episodicMemories: Record<string, EpisodicMemory[]>;
  isLoaded: boolean;

  loadMind: (characterId: string) => Promise<void>;
  loadAllFromDb: () => Promise<void>;
  loadAllMindsFromDb: (characterIds: string[]) => Promise<void>;
  addMemories: (characterId: string, newMemories: Memory[]) => Promise<void>;
  addReflection: (characterId: string, reflection: Reflection) => Promise<void>;
  updateEmotion: (characterId: string, emotion: EmotionType, intensity: number) => void;
  getEmotion: (characterId: string) => { emotion: EmotionType; intensity: number };
  updateMultiEmotion: (characterId: string, emotion: EmotionType, intensity: number) => void;
  setMultiEmotion: (characterId: string, state: MultiEmotionState) => void;
  getMultiEmotion: (characterId: string) => MultiEmotionState;
  getDominantEmotion: (characterId: string) => { type: EmotionType; intensity: number };
  getMemories: (characterId: string) => Memory[];
  getReflections: (characterId: string) => Reflection[];
  getAffinity: (characterId: string) => AffinityState;
  updateAffinity: (characterId: string, delta: number, reason: string, emotion?: EmotionType) => void;
  addCoreMemory: (characterId: string, memory: Omit<CoreMemory, 'id' | 'createdAt' | 'updatedAt'>) => void;
  addEpisodicMemory: (characterId: string, memory: Omit<EpisodicMemory, 'id' | 'occurredAt'>) => void;
  getCoreMemories: (characterId: string) => CoreMemory[];
  getEpisodicMemories: (characterId: string) => EpisodicMemory[];
  recallMemories: (characterId: string, query: string, emotion?: EmotionType, limit?: number) => {
    core: CoreMemory[];
    episodic: EpisodicMemory[];
  };
  clearCoreMemories: (characterId: string) => void;
  clearEpisodicMemories: (characterId: string) => void;
  initCharacterMind: (characterId: string) => void;
}

export const useCharacterMindStore = create<CharacterMindState>((set, get) => ({
  memories: {},
  reflections: {},
  emotionStates: loadEmotionStatesFromStorage(),
  affinityStates: loadAffinityStatesFromStorage(),
  multiEmotions: loadMultiEmotionStatesFromStorage(),
  coreMemories: loadCoreMemoriesFromStorage(),
  episodicMemories: loadEpisodicMemoriesFromStorage(),
  isLoaded: false,

  loadAllFromDb: async () => {
    try {
      if (isRunningInTauri()) {
        const [emotions, affinities] = await Promise.all([
          dbGetCharacterEmotions(),
          dbGetCharacterAffinities(),
        ]);
        const emotionStates = { ...get().emotionStates };
        for (const [charId, s] of Object.entries(emotions)) {
          emotionStates[charId] = { emotion: s.emotion as EmotionType, intensity: s.intensity };
        }
        const affinityStates = { ...get().affinityStates };
        for (const [charId, s] of Object.entries(affinities)) {
          const history: AffinityEvent[] = JSON.parse(s.history || '[]').map((e: Record<string, unknown>) => ({
              ...e,
              timestamp: new Date(e.timestamp as string | number | Date),
            }));
          affinityStates[charId] = {
            level: s.level,
            stage: s.stage as AffinityStage,
            history,
            lastInteraction: new Date(s.lastInteraction),
          };
        }
        set({ emotionStates, affinityStates, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  /**
   * 加载所有角色的记忆和反思数据(应用启动时调用)
   * 解决AI没有记忆的问题:启动时把所有角色的记忆全部加载到内存
   */
  loadAllMindsFromDb: async (characterIds: string[]) => {
    if (!isRunningInTauri()) return;
    const memoriesMap: Record<string, Memory[]> = { ...get().memories };
    const reflectionsMap: Record<string, Reflection[]> = { ...get().reflections };
    try {
      await Promise.all(characterIds.map(async (charId) => {
        try {
          const [memories, reflections] = await Promise.all([
            dbGetMemories(charId),
            dbGetReflections(charId),
          ]);
          memoriesMap[charId] = memories;
          reflectionsMap[charId] = reflections;
        } catch {
          // 单个角色失败不影响其他角色
        }
      }));
      set({
        memories: memoriesMap,
        reflections: reflectionsMap,
      });
    } catch {
      // ignore
    }
  },

  loadMind: async (characterId: string) => {
    try {
      if (isRunningInTauri()) {
        const [memories, reflections] = await Promise.all([
          dbGetMemories(characterId),
          dbGetReflections(characterId),
        ]);
        set((state) => ({
          memories: { ...state.memories, [characterId]: memories },
          reflections: { ...state.reflections, [characterId]: reflections },
        }));
      }
    } catch (e) {
      console.error('Failed to load character mind:', e);
    }
  },

  addMemories: async (characterId: string, newMemories: Memory[]) => {
    if (newMemories.length === 0) return;
    const current = get().memories[characterId] || [];
    // 不再截断,保留所有记忆(数据库查询已经按 importance DESC 排序)
    const updated = [...newMemories, ...current];
    set((state) => ({
      memories: { ...state.memories, [characterId]: updated },
    }));
    if (isRunningInTauri()) {
      await dbSaveMemories(updated);
    }
  },

  addReflection: async (characterId: string, reflection: Reflection) => {
    const current = get().reflections[characterId] || [];
    const updated = [reflection, ...current].slice(0, 20);
    set((state) => ({
      reflections: { ...state.reflections, [characterId]: updated },
    }));
    if (isRunningInTauri()) {
      await dbSaveReflections(updated);
    }
  },

  updateEmotion: (characterId: string, emotion: EmotionType, intensity: number) => {
    set((state) => {
      const updated = { ...state.emotionStates, [characterId]: { emotion, intensity } };
      debouncedPersistEmotions(updated);
      return { emotionStates: updated };
    });
  },

  getEmotion: (characterId: string) => {
    return get().emotionStates[characterId] || { emotion: 'anticipation' as EmotionType, intensity: 30 };
  },

  updateMultiEmotion: (characterId: string, emotion: EmotionType, intensity: number) => {
    set((state) => {
      const old = state.multiEmotions[characterId] || { ...defaultMultiEmotionState };
      const updated = getEmotionStateManager().update(old, {
        newEmotion: emotion,
        intensity,
        triggerText: '',
        metabolisms: [],
      });
      const newMultiEmotions = { ...state.multiEmotions, [characterId]: updated };
      debouncedPersistMultiEmotions(newMultiEmotions);

      // Bug1: 更新每日情绪快照
      const snapshots = loadDailySnapshots();
      snapshots[characterId] = {
        date: getTodayStr(),
        values: updated.values,
        emotion,
        intensity,
      };
      saveDailySnapshots(snapshots);

      return { multiEmotions: newMultiEmotions };
    });
  },

  setMultiEmotion: (characterId: string, state: MultiEmotionState) => {
    set((prevState) => {
      // 🆕 功能模块数据覆盖：12 维情绪直接锁定（空设定不干预）
      const effectiveState = applyEmotionValueOverrides(state);
      const newMultiEmotions = { ...prevState.multiEmotions, [characterId]: effectiveState };
      debouncedPersistMultiEmotions(newMultiEmotions);

      // Bug1: 更新每日情绪快照
      const dominant = getDominantEmotion(effectiveState);
      const snapshots = loadDailySnapshots();
      snapshots[characterId] = {
        date: getTodayStr(),
        values: effectiveState.values,
        emotion: dominant.type,
        intensity: dominant.intensity,
      };
      saveDailySnapshots(snapshots);

      return { multiEmotions: newMultiEmotions };
    });
  },

  getMultiEmotion: (characterId: string) => {
    const snapshots = loadDailySnapshots();
    return getDisplayEmotion(characterId, get().multiEmotions, snapshots);
  },

  getDominantEmotion: (characterId: string) => {
    const snapshots = loadDailySnapshots();
    const state = getDisplayEmotion(characterId, get().multiEmotions, snapshots);
    return getDominantEmotion(state);
  },

  getMemories: (characterId: string) => {
    return get().memories[characterId] || [];
  },

  getReflections: (characterId: string) => {
    return get().reflections[characterId] || [];
  },

  getAffinity: (characterId: string) => {
    const state = get().affinityStates[characterId] || defaultAffinityState();
    const lastInteraction = state.lastInteraction instanceof Date ? state.lastInteraction : new Date(state.lastInteraction);
    const decay = calcDecay(lastInteraction, state.level, 0.5);
    if (decay !== 0) {
      const newLevel = Math.round(Math.max(-100, Math.min(100, state.level + decay)) * 100) / 100;
      return { ...state, level: newLevel, stage: getAffinityStage(newLevel) };
    }
    return { ...state, level: Math.round(state.level * 100) / 100 };
  },

  updateAffinity: (characterId: string, delta: number, reason: string, emotion?: EmotionType) => {
    set((state) => {
      // 🆕 功能模块数据覆盖：增长倍率 + 单次增量上限
      let effectiveDelta = applyAffinityDelta(delta);
      const current = state.affinityStates[characterId] || defaultAffinityState();
      // 好感度直接锁定：启用锁定时无论 delta 多少都回到设定值
      const lockValue = getAffinityLockValue();
      const newLevel = lockValue !== null
        ? lockValue
        : Math.round(Math.max(-100, Math.min(100, current.level + effectiveDelta)) * 100) / 100;
      effectiveDelta = newLevel - current.level; // 历史记录反映实际生效的增量
      const event: AffinityEvent = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        characterId,
        delta: effectiveDelta,
        reason,
        timestamp: new Date(),
        emotion,
      };
      const updatedState: AffinityState = {
        level: newLevel,
        stage: getAffinityStage(newLevel),
        history: [event, ...current.history].slice(0, 50),
        lastInteraction: new Date(),
      };
      const updated = { ...state.affinityStates, [characterId]: updatedState };
      debouncedPersistAffinities(updated);
      return { affinityStates: updated };
    });
  },

  // ---------- V2 双层记忆方法 ----------

  addCoreMemory: (characterId: string, memory: Omit<CoreMemory, 'id' | 'createdAt' | 'updatedAt'>) => {
    set((state) => {
      const newMem: CoreMemory = {
        ...memory,
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const current = state.coreMemories[characterId] || [];
      const updated = { ...state.coreMemories, [characterId]: [newMem, ...current] };
      debouncedPersistCoreMemories(updated);
      return { coreMemories: updated };
    });
  },

  addEpisodicMemory: (characterId: string, memory: Omit<EpisodicMemory, 'id' | 'occurredAt'>) => {
    set((state) => {
      const newMem: EpisodicMemory = {
        ...memory,
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
        occurredAt: new Date(),
      };
      const current = state.episodicMemories[characterId] || [];
      const updated = { ...state.episodicMemories, [characterId]: [newMem, ...current].slice(0, 500) };
      debouncedPersistEpisodicMemories(updated);
      return { episodicMemories: updated };
    });
  },

  getCoreMemories: (characterId: string) => {
    return get().coreMemories[characterId] || [];
  },

  getEpisodicMemories: (characterId: string) => {
    return get().episodicMemories[characterId] || [];
  },

  recallMemories: (characterId: string, query: string, emotion?: EmotionType, limit: number = 10) => {
    const coreMems = get().coreMemories[characterId] || [];
    const episodicMems = get().episodicMemories[characterId] || [];
    const now = Date.now();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
    const forgettingEnabled = useConfigStore.getState().v2Config.forgettingCurve !== false;
    // 🆕 功能模块数据覆盖：记忆衰减速率
    const memoryDecayRate = getMemoryDecayRate();

    const scoredCore = coreMems.map(mem => {
      let score = 0;
      const daysSinceCreation = (now - mem.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const clarity = calculateMemoryClarity({
        importance: mem.importance,
        daysSinceCreation,
        daysSinceLastRecall: daysSinceCreation,
        recallCount: 1,
        emotionIntensity: 50,
        enabled: forgettingEnabled,
        decayRate: memoryDecayRate,
      });
      score += clarity * 2;
      const contentLower = mem.content.toLowerCase();
      const keywordMatch = mem.keywords.filter(k => queryLower.includes(k.toLowerCase())).length;
      score += keywordMatch * 3;
      const wordMatch = queryWords.filter(w => contentLower.includes(w)).length;
      score += wordMatch * 1.5;
      if (emotion && mem.emotionTags.includes(emotion)) {
        score += 2;
      }
      return { mem, score };
    });

    const scoredEpisodic = episodicMems.map(mem => {
      let score = 0;
      const daysSinceCreation = (now - mem.occurredAt.getTime()) / (1000 * 60 * 60 * 24);
      const clarity = calculateMemoryClarity({
        importance: mem.importance,
        daysSinceCreation,
        daysSinceLastRecall: daysSinceCreation,
        recallCount: 1,
        emotionIntensity: mem.emotionAtTime.intensity,
        enabled: forgettingEnabled,
        decayRate: memoryDecayRate,
      });
      score += clarity * 1.5;
      const contentLower = mem.content.toLowerCase();
      const keywordMatch = mem.keywords.filter(k => queryLower.includes(k.toLowerCase())).length;
      score += keywordMatch * 2.5;
      const wordMatch = queryWords.filter(w => contentLower.includes(w)).length;
      score += wordMatch;
      if (emotion && mem.emotionAtTime.type === emotion) {
        score += 3;
      }
      return { mem, score };
    });

    scoredCore.sort((a, b) => b.score - a.score);
    scoredEpisodic.sort((a, b) => b.score - a.score);

    return {
      core: scoredCore.slice(0, limit).map(s => s.mem),
      episodic: scoredEpisodic.slice(0, limit).map(s => s.mem),
    };
  },

  clearCoreMemories: (characterId: string) => {
    set((state) => {
      const updated = { ...state.coreMemories };
      delete updated[characterId];
      debouncedPersistCoreMemories(updated);
      return { coreMemories: updated };
    });
  },

  clearEpisodicMemories: (characterId: string) => {
    set((state) => {
      const updated = { ...state.episodicMemories };
      delete updated[characterId];
      debouncedPersistEpisodicMemories(updated);
      return { episodicMemories: updated };
    });
  },

  initCharacterMind: (characterId: string) => {
    set((state) => {
      if (state.emotionStates[characterId]) return state;
      return {
        emotionStates: { ...state.emotionStates, [characterId]: { emotion: 'anticipation' as EmotionType, intensity: 30 } },
        affinityStates: { ...state.affinityStates, [characterId]: defaultAffinityState() },
        multiEmotions: { ...state.multiEmotions, [characterId]: { values: {}, lastUpdated: Date.now(), interactions: 0, history: [] } },
      };
    });
  },
}));

