
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
import { updateMultiEmotionState, getDominantEmotion } from '../utils/emotionAnalyzer';

const EMOTION_STORAGE_KEY = 'ai-character-emotions';
const AFFINITY_STORAGE_KEY = 'ai-character-affinities';
const MULTI_EMOTION_STORAGE_KEY = 'ai-character-emotions-v2';

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
  isLoaded: boolean;

  loadMind: (characterId: string) => Promise<void>;
  loadAllFromDb: () => Promise<void>;
  addMemories: (characterId: string, newMemories: Memory[]) => Promise<void>;
  addReflection: (characterId: string, reflection: Reflection) => Promise<void>;
  updateEmotion: (characterId: string, emotion: EmotionType, intensity: number) => void;
  getEmotion: (characterId: string) => { emotion: EmotionType; intensity: number };
  updateMultiEmotion: (characterId: string, emotion: EmotionType, intensity: number) => void;
  getMultiEmotion: (characterId: string) => MultiEmotionState;
  getDominantEmotion: (characterId: string) => { type: EmotionType; intensity: number };
  getMemories: (characterId: string) => Memory[];
  getReflections: (characterId: string) => Reflection[];
  getAffinity: (characterId: string) => AffinityState;
  updateAffinity: (characterId: string, delta: number, reason: string, emotion?: EmotionType) => void;
}

export const useCharacterMindStore = create<CharacterMindState>((set, get) => ({
  memories: {},
  reflections: {},
  emotionStates: loadEmotionStatesFromStorage(),
  affinityStates: loadAffinityStatesFromStorage(),
  multiEmotions: loadMultiEmotionStatesFromStorage(),
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
          const history: AffinityEvent[] = JSON.parse(s.history || '[]').map((e: any) => ({
            ...e,
            timestamp: new Date(e.timestamp),
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
    const updated = [...newMemories, ...current].slice(0, 50);
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
    return get().emotionStates[characterId] || { emotion: 'neutral' as EmotionType, intensity: 30 };
  },

  updateMultiEmotion: (characterId: string, emotion: EmotionType, intensity: number) => {
    set((state) => {
      const old = state.multiEmotions[characterId] || { ...defaultMultiEmotionState };
      const updated = updateMultiEmotionState(old, emotion, intensity);
      const newMultiEmotions = { ...state.multiEmotions, [characterId]: updated };
      debouncedPersistMultiEmotions(newMultiEmotions);
      return { multiEmotions: newMultiEmotions };
    });
  },

  getMultiEmotion: (characterId: string) => {
    return get().multiEmotions[characterId] || { ...defaultMultiEmotionState };
  },

  getDominantEmotion: (characterId: string) => {
    const state = get().multiEmotions[characterId] || { ...defaultMultiEmotionState };
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
      const current = state.affinityStates[characterId] || defaultAffinityState();
      const newLevel = Math.round(Math.max(-100, Math.min(100, current.level + delta)) * 100) / 100;
      const event: AffinityEvent = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        characterId,
        delta,
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
}));

