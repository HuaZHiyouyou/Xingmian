import { create } from 'zustand';
import { Character } from '../types';
import { isRunningInTauri, dbGetCharacters, dbSaveCharacters, dbDeleteCharacter } from '../lib/tauriBridge';
import { useCharacterMindStore } from './characterMindStore';

const STORAGE_KEY = 'ai-characters';
const DELETED_STORAGE_KEY = 'ai-deleted-characters';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function loadFromLocalStorage(): Character[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveToLocalStorage(characters: Character[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(characters));
  } catch { /* ignore */ }
}

function loadDeletedFromStorage(): (Character & { deletedAt: Date })[] {
  try {
    const stored = localStorage.getItem(DELETED_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return (parsed as Array<Character & { deletedAt: string | number | Date }>).map((e) => ({ ...e, deletedAt: new Date(e.deletedAt) }));
    }
  } catch { /* ignore */ }
  return [];
}

function saveDeletedToStorage(entries: (Character & { deletedAt: Date })[]) {
  try {
    localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore */ }
}

interface CharacterState {
  characters: Character[];
  deletedCharacters: (Character & { deletedAt: Date })[];
  selectedCharacterId: string | null;
  isLoaded: boolean;

  selectCharacter: (id: string) => void;
  getSelectedCharacter: () => Character | undefined;
  getCharacterById: (id: string) => Character | undefined;
  loadCharacters: () => Promise<void>;
  createCharacter: (data: Partial<Character>) => Promise<Character>;
  updateCharacter: (id: string, data: Partial<Character>) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  softDeleteCharacter: (id: string) => void;
  restoreCharacter: (id: string) => void;
  permanentDeleteCharacter: (id: string) => Promise<void>;
}

const SELECTED_CHAR_KEY = 'session-selected-char';

function loadSelectedChar(): string | null {
  try { return localStorage.getItem(SELECTED_CHAR_KEY); } catch { return null; }
}
function saveSelectedChar(id: string | null) {
  try {
    if (id) localStorage.setItem(SELECTED_CHAR_KEY, id);
    else localStorage.removeItem(SELECTED_CHAR_KEY);
  } catch { /* ignore */ }
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  characters: [],
  deletedCharacters: loadDeletedFromStorage(),
  selectedCharacterId: loadSelectedChar(),
  isLoaded: false,

  selectCharacter: (id: string) => {
    saveSelectedChar(id || null);
    set({ selectedCharacterId: id });
  },

  getSelectedCharacter: () => {
    return get().characters.find(c => c.id === get().selectedCharacterId);
  },

  getCharacterById: (id: string) => {
    return get().characters.find(c => c.id === id);
  },

  loadCharacters: async () => {
    try {
      let characters: Character[];
      if (isRunningInTauri()) {
        characters = await dbGetCharacters();
      } else {
        characters = loadFromLocalStorage();
      }
      set({ characters, isLoaded: true });
    } catch (e) {
      console.error('Failed to load characters:', e);
      set({ isLoaded: true });
    }
  },

  createCharacter: async (data) => {
    const id = generateId();
    const character: Character = {
      id,
      name: data.name || '',
      avatar: data.avatar || '',
      personality: data.personality || '',
      description: data.description || '',
      tags: data.tags || [],
      greetingMessage: data.greetingMessage || '你好呀',
      background: data.background || '',
      likes: data.likes || [],
      dislikes: data.dislikes || [],
      habits: data.habits || [],
      catchphrases: data.catchphrases || [],
      emotionTriggers: data.emotionTriggers || '',
      emotionExpressions: data.emotionExpressions || '',
      thinkingStyle: data.thinkingStyle || '',
      relationshipStages: data.relationshipStages || '',
      responseStyle: data.responseStyle || '',
      identityAnchors: data.identityAnchors || '',
      forbiddenBehaviors: data.forbiddenBehaviors || '',
      outputFormat: data.outputFormat || '',
      memoryImportanceThreshold: data.memoryImportanceThreshold ?? 5,
      reflectionEnabled: data.reflectionEnabled ?? true,
      timeAwarenessEnabled: data.timeAwarenessEnabled ?? true,
      timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      affinityRate: data.affinityRate ?? 0.5,
      exampleDialogues: data.exampleDialogues || [],
    };

    const updated = [...get().characters, character];
    set({ characters: updated });

    // 初始化角色情绪状态
    const mindStore = useCharacterMindStore.getState();
    mindStore.initCharacterMind(id);

    if (isRunningInTauri()) {
      await dbSaveCharacters(updated);
    } else {
      saveToLocalStorage(updated);
    }

    return character;
  },

  updateCharacter: async (id, data) => {
    const updated = get().characters.map(c =>
      c.id === id ? { ...c, ...data } : c
    );
    set({ characters: updated });

    if (isRunningInTauri()) {
      await dbSaveCharacters(updated);
    } else {
      saveToLocalStorage(updated);
    }
  },

  softDeleteCharacter: (id) => {
    const character = get().characters.find(c => c.id === id);
    if (!character) return;

    const deletedEntry = { ...character, deletedAt: new Date() };
    const updatedDeleted = [deletedEntry, ...get().deletedCharacters].slice(0, 100);
    const updatedCharacters = get().characters.filter(c => c.id !== id);

    set({
      characters: updatedCharacters,
      deletedCharacters: updatedDeleted,
      selectedCharacterId: get().selectedCharacterId === id ? null : get().selectedCharacterId,
    });

    // 🆕 修复：Tauri 模式下同步写 DB，否则软删除的角色重启后会"复活"
    if (isRunningInTauri()) {
      dbSaveCharacters(updatedCharacters).catch(() => {});
    } else {
      saveToLocalStorage(updatedCharacters);
    }
    saveDeletedToStorage(updatedDeleted);
  },

  restoreCharacter: (id) => {
    const entry = get().deletedCharacters.find(c => c.id === id);
    if (!entry) return;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deletedAt, ...restored } = entry;
    const updatedCharacters = [...get().characters, restored];
    const updatedDeleted = get().deletedCharacters.filter(c => c.id !== id);

    set({
      characters: updatedCharacters,
      deletedCharacters: updatedDeleted,
    });

    // 🆕 同步写 DB（与软删除对应）
    if (isRunningInTauri()) {
      dbSaveCharacters(updatedCharacters).catch(() => {});
    } else {
      saveToLocalStorage(updatedCharacters);
    }
    saveDeletedToStorage(updatedDeleted);
  },

  permanentDeleteCharacter: async (id) => {
    const updatedDeleted = get().deletedCharacters.filter(c => c.id !== id);
    set({ deletedCharacters: updatedDeleted });
    saveDeletedToStorage(updatedDeleted);

    if (isRunningInTauri()) {
      await dbDeleteCharacter(id);
    }
  },

  deleteCharacter: async (id) => {
    const updated = get().characters.filter(c => c.id !== id);
    set({
      characters: updated,
      selectedCharacterId: get().selectedCharacterId === id ? null : get().selectedCharacterId,
    });

    if (isRunningInTauri()) {
      await dbDeleteCharacter(id);
    } else {
      saveToLocalStorage(updated);
    }
  },
}));
