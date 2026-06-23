
import { create } from 'zustand';
import { useLearningConfigStore } from './learningConfigStore';

export interface LearnedStyle {
  vocabulary: string[];
  phrases: string[];
  lastUpdated: Date;
}

interface LearningState {
  profiles: Record<string, LearnedStyle>;
  isLoaded: boolean;
  updateProfile: (characterId: string, updates: Partial<LearnedStyle>) => void;
  addVocabulary: (characterId: string, words: string[]) => void;
  addPhrases: (characterId: string, phrases: string[]) => void;
  getProfile: (characterId: string) => LearnedStyle;
  loadFromStorage: () => void;
  saveToStorage: () => void;
  clearCharacter: (characterId: string) => void;
}

const STORAGE_KEY = 'learning-profiles';

function createDefaultProfile(): LearnedStyle {
  return {
    vocabulary: [],
    phrases: [],
    lastUpdated: new Date(),
  };
}

export const useLearningStore = create<LearningState>((set, get) => ({
  profiles: {},
  isLoaded: false,

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        const profiles: Record<string, LearnedStyle> = {};
        for (const [k, v] of Object.entries(data)) {
          const p = v as any;
          profiles[k] = {
            vocabulary: p.vocabulary || [],
            phrases: p.phrases || [],
            lastUpdated: new Date(p.lastUpdated),
          };
        }
        set({ profiles, isLoaded: true });
        return;
      }
    } catch { /* ignore */ }
    set({ isLoaded: true });
  },

  saveToStorage: () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(get().profiles));
  },

  getProfile: (characterId) => {
    return get().profiles[characterId] || createDefaultProfile();
  },

  updateProfile: (characterId, updates) => {
    set((state) => {
      const existing = state.profiles[characterId] || createDefaultProfile();
      return {
        profiles: {
          ...state.profiles,
          [characterId]: {
            ...existing,
            ...updates,
            lastUpdated: new Date(),
          },
        },
      };
    });
    get().saveToStorage();
  },

  addVocabulary: (characterId, words) => {
    const current = get().getProfile(characterId);
    const maxVocab = useLearningConfigStore.getState().config.maxVocabulary;
    const existing = new Set(current.vocabulary);
    let added = false;
    for (const w of words) {
      if (w.length >= 2 && !existing.has(w)) {
        existing.add(w);
        added = true;
      }
    }
    if (added) {
      const allWords = Array.from(existing);
      get().updateProfile(characterId, {
        vocabulary: allWords.length > maxVocab ? allWords.slice(-maxVocab) : allWords,
      });
    }
  },

  addPhrases: (characterId, phrases) => {
    const current = get().getProfile(characterId);
    const maxPhr = useLearningConfigStore.getState().config.maxPhrases;
    const existing = new Set(current.phrases);
    let added = false;
    for (const p of phrases) {
      if (p.length >= 2 && !existing.has(p)) {
        existing.add(p);
        added = true;
      }
    }
    if (added) {
      const allPhrases = Array.from(existing);
      get().updateProfile(characterId, {
        phrases: allPhrases.length > maxPhr ? allPhrases.slice(-maxPhr) : allPhrases,
      });
    }
  },

  clearCharacter: (characterId) => {
    set((state) => {
      const profiles = { ...state.profiles };
      delete profiles[characterId];
      return { profiles };
    });
    get().saveToStorage();
  },
}));

export function getLearningPrompt(characterId: string): string {
  const profile = useLearningStore.getState().getProfile(characterId);
  if (profile.vocabulary.length === 0 && profile.phrases.length === 0) return '';

  const parts: string[] = [];

  if (profile.vocabulary.length > 0) {
    parts.push(`用户常用的词汇：${profile.vocabulary.slice(0, 15).join('、')}`);
  }

  if (profile.phrases.length > 0) {
    parts.push(`用户常用的表达：${profile.phrases.slice(0, 10).map(p => `"${p}"`).join('、')}`);
  }

  if (parts.length === 0) return '';

  return `\n\n## 你学到的用户风格\n${parts.join('\n')}\n试着在合适的时机自然地使用这些词汇和表达方式，让对话更有默契。`;
}

