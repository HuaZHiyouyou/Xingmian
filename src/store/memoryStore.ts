
import { create } from 'zustand';
import { MemoryEntry, MemoryCategory } from '../types';
import {
  isRunningInTauri,
  dbGetMemoryEntriesPage,
  dbSearchMemoryEntries,
  dbSaveMemoryEntries,
  dbDeleteMemoryEntry,
  PaginatedMemoryEntries,
} from '../lib/tauriBridge';
import { useRecycleBinStore } from './recycleBinStore';
import { getTodayStr } from '../components/common/DateTimeline';

const STORAGE_KEY = 'ai-memory-entries';

function loadFromStorage(): Record<string, MemoryEntry[]> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      for (const key of Object.keys(parsed)) {
        parsed[key] = parsed[key].map((e: any) => ({
          ...e,
          tags: Array.isArray(e.tags) ? e.tags : (typeof e.tags === 'string' ? (() => { try { return JSON.parse(e.tags || '[]'); } catch { return []; } })() : []),
          createdAt: new Date(e.createdAt),
        }));
      }
      return parsed;
    }
  } catch { /* ignore */ }
  return {};
}

function saveToStorage(entries: Record<string, MemoryEntry[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore */ }
}

function dateToDateRange(dateStr: string): { dateFrom: string; dateTo: string } {
  const d = new Date(dateStr + 'T00:00:00');
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  return {
    dateFrom: d.toISOString(),
    dateTo: next.toISOString(),
  };
}

interface MemoryState {
  entries: Record<string, MemoryEntry[]>;
  searchQuery: string;
  filterCategory: MemoryCategory | 'all';
  isLoaded: boolean;
  hasMore: Record<string, boolean>;
  cursors: Record<string, string | null>;
  loadingMore: boolean;
  selectedDate: string;
  showAllDates: boolean;

  loadFirstPage: (characterId?: string) => Promise<void>;
  loadMore: (characterId?: string) => Promise<void>;
  addEntry: (entry: MemoryEntry) => Promise<void>;
  addEntries: (characterId: string, newEntries: MemoryEntry[]) => Promise<void>;
  updateEntryImportance: (id: string, importance: number) => void;
  softDeleteEntry: (id: string) => void;
  permanentDeleteEntry: (id: string) => void;
  deleteEntry: (id: string) => void;
  searchEntries: (characterId: string, query: string) => Promise<MemoryEntry[]>;
  getEntries: (characterId: string) => MemoryEntry[];
  getFilteredEntries: (characterId: string) => MemoryEntry[];
  setSearchQuery: (query: string) => void;
  setFilterCategory: (category: MemoryCategory | 'all') => void;
  setSelectedDate: (dateStr: string) => void;
  setShowAllDates: (show: boolean) => void;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  entries: loadFromStorage(),
  searchQuery: '',
  filterCategory: 'all',
  isLoaded: false,
  hasMore: {},
  cursors: {},
  loadingMore: false,
  selectedDate: getTodayStr(),
  showAllDates: false,

  loadFirstPage: async (characterId?: string) => {
    const { selectedDate, showAllDates, filterCategory } = get();
    const stateKey = characterId || '__all__';
    const cat = filterCategory === 'all' ? undefined : filterCategory;

    set((state) => ({
      entries: showAllDates
        ? (characterId ? { ...state.entries, [characterId]: [] } : { ...state.entries, [stateKey]: [] })
        : { ...state.entries, [stateKey]: [] },
      hasMore: { ...state.hasMore, [stateKey]: true },
      cursors: { ...state.cursors, [stateKey]: null },
      isLoaded: false,
    }));

    try {
      if (isRunningInTauri()) {
        let dateFrom: string | undefined;
        let dateTo: string | undefined;
        if (!showAllDates) {
          const range = dateToDateRange(selectedDate);
          dateFrom = range.dateFrom;
          dateTo = range.dateTo;
        }

        const result: PaginatedMemoryEntries = await dbGetMemoryEntriesPage(
          characterId,
          cat,
          undefined,
          showAllDates ? 10000 : 500,
          dateFrom,
          dateTo,
        );
        set((state) => {
          const updated = { ...state.entries, [stateKey]: result.entries };
          saveToStorage(updated);
          return {
            entries: updated,
            hasMore: { ...state.hasMore, [stateKey]: result.hasMore },
            cursors: { ...state.cursors, [stateKey]: result.nextCursor },
            isLoaded: true,
          };
        });
      } else {
        set({ isLoaded: true });
      }
    } catch (e) {
      console.error('Failed to load memory entries:', e);
      set({ isLoaded: true });
    }
  },

  loadMore: async (characterId?: string) => {
    const { cursors, hasMore, loadingMore, filterCategory, showAllDates } = get();
    const stateKey = characterId || '__all__';
    if (loadingMore || !hasMore[stateKey] || !cursors[stateKey] || !isRunningInTauri()) return;

    set({ loadingMore: true });
    try {
      const cat = filterCategory === 'all' ? undefined : filterCategory;
      const result: PaginatedMemoryEntries = await dbGetMemoryEntriesPage(
        characterId,
        cat,
        cursors[stateKey]!,
        showAllDates ? 10000 : 500,
      );
      set((state) => {
        const existing = state.entries[stateKey] || [];
        const updated = { ...state.entries, [stateKey]: [...existing, ...result.entries] };
        saveToStorage(updated);
        return {
          entries: updated,
          hasMore: { ...state.hasMore, [stateKey]: result.hasMore },
          cursors: { ...state.cursors, [stateKey]: result.nextCursor },
          loadingMore: false,
        };
      });
    } catch {
      set({ loadingMore: false });
    }
  },

  addEntry: async (entry: MemoryEntry) => {
    const { characterId } = entry;
    set((state) => {
      const current = state.entries[characterId] || [];
      const updated = [entry, ...current].slice(0, 200);
      const newEntries = { ...state.entries, [characterId]: updated };
      saveToStorage(newEntries);
      return { entries: newEntries };
    });
    if (isRunningInTauri()) {
      dbSaveMemoryEntries([entry]).catch(() => {});
    }
  },

  addEntries: async (characterId: string, newEntries: MemoryEntry[]) => {
    if (newEntries.length === 0) return;
    set((state) => {
      const current = state.entries[characterId] || [];
      const updated = [...newEntries, ...current].slice(0, 200);
      const allEntries = { ...state.entries, [characterId]: updated };
      saveToStorage(allEntries);
      return { entries: allEntries };
    });
    if (isRunningInTauri()) {
      dbSaveMemoryEntries(newEntries).catch(() => {});
    }
  },

  updateEntryImportance: (id: string, importance: number) => {
    set((state) => {
      const newEntries: Record<string, MemoryEntry[]> = {};
      for (const [charId, entries] of Object.entries(state.entries)) {
        newEntries[charId] = entries.map(e => e.id === id ? { ...e, importance } : e);
      }
      saveToStorage(newEntries);
      return { entries: newEntries };
    });
  },

  softDeleteEntry: (id: string) => {
    let deletedEntry: MemoryEntry | null = null;
    set((state) => {
      const newEntries: Record<string, MemoryEntry[]> = {};
      for (const [charId, entries] of Object.entries(state.entries)) {
        const found = entries.find(e => e.id === id);
        if (found) deletedEntry = found;
        newEntries[charId] = entries.filter(e => e.id !== id);
      }
      saveToStorage(newEntries);
      if (deletedEntry) {
        useRecycleBinStore.getState().addEntry(deletedEntry);
      }
      return { entries: newEntries };
    });
    dbDeleteMemoryEntry(id).catch(() => {});
  },

  permanentDeleteEntry: (id: string) => {
    set((state) => {
      const newEntries: Record<string, MemoryEntry[]> = {};
      for (const [charId, entries] of Object.entries(state.entries)) {
        newEntries[charId] = entries.filter(e => e.id !== id);
      }
      saveToStorage(newEntries);
      return { entries: newEntries };
    });
    dbDeleteMemoryEntry(id).catch(() => {});
  },

  deleteEntry: (id: string) => {
    get().softDeleteEntry(id);
  },

  searchEntries: async (characterId: string, query: string) => {
    if (isRunningInTauri()) {
      return await dbSearchMemoryEntries(characterId, query);
    }
    const all = get().entries[characterId] || [];
    const q = query.toLowerCase();
    return all.filter(
      (e) =>
        (e.title?.toLowerCase().includes(q)) ||
        e.content.toLowerCase().includes(q) ||
        (e.tags?.some((t) => t.toLowerCase().includes(q)))
    );
  },

  getEntries: (characterId: string) => {
    return get().entries[characterId] || [];
  },

  getFilteredEntries: (characterId: string) => {
    const state = get();
    const all = state.entries[characterId] || [];
    const { searchQuery, filterCategory } = state;

    let result = all;
    if (filterCategory !== 'all') {
      result = result.filter((e) => e.category === filterCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          (e.title?.toLowerCase().includes(q)) ||
          e.content.toLowerCase().includes(q) ||
          (e.tags?.some((t) => t.toLowerCase().includes(q)))
      );
    }
    return result;
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setFilterCategory: (category: MemoryCategory | 'all') => set({ filterCategory: category }),
  setSelectedDate: (dateStr: string) => set({ selectedDate: dateStr }),
  setShowAllDates: (show: boolean) => set({ showAllDates: show }),
}));

