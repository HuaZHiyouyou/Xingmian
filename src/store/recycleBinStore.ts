import { create } from 'zustand';
import { MemoryEntry } from '../types';
import {
  isRunningInTauri,
  dbGetDeletedMemoryEntries,
  dbSaveDeletedMemoryEntries,
  dbClearDeletedMemoryEntries,
} from '../lib/tauriBridge';

const STORAGE_KEY = 'ai-deleted-memory-entries';

export interface DeletedMemoryEntry extends MemoryEntry {
  deletedAt: Date;
}

function loadFromStorage(): DeletedMemoryEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return (parsed as Array<Record<string, unknown> & { createdAt: string | number | Date; deletedAt: string | number | Date }>).map((e) => ({
        ...e,
        createdAt: new Date(e.createdAt),
        deletedAt: new Date(e.deletedAt),
      })) as DeletedMemoryEntry[];
    }
  } catch { /* ignore */ }
  return [];
}

function saveToStorage(entries: DeletedMemoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore */ }
}

function persistToDb(entries: DeletedMemoryEntry[]) {
  if (isRunningInTauri()) {
    dbSaveDeletedMemoryEntries(entries).catch(() => {});
  }
}

interface RecycleBinState {
  entries: DeletedMemoryEntry[];
  isLoaded: boolean;

  loadFromDb: () => Promise<void>;
  addEntry: (entry: MemoryEntry) => void;
  restoreEntry: (id: string) => MemoryEntry | null;
  permanentlyDelete: (id: string) => void;
  clearAll: () => void;
  getEntries: () => DeletedMemoryEntry[];
}

export const useRecycleBinStore = create<RecycleBinState>((set, get) => ({
  entries: loadFromStorage(),
  isLoaded: false,

  loadFromDb: async () => {
    try {
      if (isRunningInTauri()) {
        const dbEntries = await dbGetDeletedMemoryEntries();
        const deleted: DeletedMemoryEntry[] = dbEntries.map(e => {
          const rawDeletedAt = (e as unknown as { deletedAt?: string | number | Date }).deletedAt;
          return {
            ...e,
            deletedAt: rawDeletedAt ? new Date(rawDeletedAt) : new Date(),
          };
        });
        set({ entries: deleted, isLoaded: true });
        saveToStorage(deleted);
      } else {
        set({ isLoaded: true });
      }
    } catch {
      set({ isLoaded: true });
    }
  },

  addEntry: (entry: MemoryEntry) => {
    const deletedEntry: DeletedMemoryEntry = {
      ...entry,
      deletedAt: new Date(),
    };
    set((state) => {
      const updated = [deletedEntry, ...state.entries].slice(0, 200);
      saveToStorage(updated);
      persistToDb(updated);
      return { entries: updated };
    });
  },

  restoreEntry: (id: string) => {
    const state = get();
    const entry = state.entries.find(e => e.id === id);
    if (!entry) return null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deletedAt, ...restored } = entry;
    set((s) => {
      const updated = s.entries.filter(e => e.id !== id);
      saveToStorage(updated);
      persistToDb(updated);
      return { entries: updated };
    });
    return restored;
  },

  permanentlyDelete: (id: string) => {
    set((state) => {
      const updated = state.entries.filter(e => e.id !== id);
      saveToStorage(updated);
      persistToDb(updated);
      return { entries: updated };
    });
  },

  clearAll: () => {
    set({ entries: [] });
    saveToStorage([]);
    dbClearDeletedMemoryEntries().catch(() => {});
  },

  getEntries: () => get().entries,
}));
