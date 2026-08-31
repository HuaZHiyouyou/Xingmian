
import { create } from 'zustand';
import { MemoryEntry, MemoryCategory } from '../types';
import {
  isRunningInTauri,
  dbGetMemoryEntriesPage,
  dbSearchMemoryEntries,
  dbSaveMemoryEntries,
  dbDeleteMemoryEntry,
  dbGetMemoryEntriesAvailableDates,
  PaginatedMemoryEntries,
} from '../lib/tauriBridge';
import { useRecycleBinStore } from './recycleBinStore';
import { useDebugLog } from './debugLogStore';
import { getTodayStr, toLocalDateStr } from '../components/common/DateTimeline';
import {
  indexMemoryEntries,
  vectorSearch,
  removeVectorEntry,
  getVectorStats,
  type VectorSearchResult,
} from '../services/memory/vectorSearch';

const STORAGE_KEY = 'ai-memory-entries';

/**
 * 🆕 本地优先存储策略：
 *  - 每次变更立即写 localStorage（自动本地保存，极快、不阻塞）
 *  - DB 写入改为 2.5s 防抖的后台静默同步（仅写脏角色批次），
 *    取代旧的"空闲 5 分钟同步 + 退出前提醒"机制
 */
const _dirtyKeys = new Set<string>();
let _dbSyncTimer: ReturnType<typeof setTimeout> | null = null;
const DB_SYNC_DEBOUNCE_MS = 2500;

function scheduleDbSync() {
  if (!isRunningInTauri()) return;
  if (_dbSyncTimer) clearTimeout(_dbSyncTimer);
  _dbSyncTimer = setTimeout(() => {
    _dbSyncTimer = null;
    const keys = Array.from(_dirtyKeys);
    _dirtyKeys.clear();
    if (keys.length === 0) return;
    const all = useMemoryStore.getState().entries;
    const batch = keys.flatMap((k) => all[k] || []);
    if (batch.length === 0) return;
    useDebugLog.getState().add('system', `[memoryStore] 后台同步 ${batch.length} 条记忆 → DB`);
    saveToDbWithRetry(batch);
  }, DB_SYNC_DEBOUNCE_MS);
}

function loadFromStorage(): Record<string, MemoryEntry[]> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      for (const key of Object.keys(parsed)) {
        parsed[key] = (parsed[key] as Array<Record<string, unknown>>).map((e) => ({
          ...e,
          tags: Array.isArray(e.tags) ? e.tags : (typeof e.tags === 'string' ? (() => { try { return JSON.parse(e.tags || '[]'); } catch { return []; } })() : []),
          createdAt: new Date(e.createdAt as string | number | Date),
        }));
      }
      return parsed;
    }
  } catch { /* ignore */ }
  return {};
}

/** 按 id 合并（本地缓存优先），避免与 DB 分页数据重复 */
function mergeById(base: MemoryEntry[], incoming: MemoryEntry[]): MemoryEntry[] {
  if (base.length === 0) return incoming;
  const map = new Map(base.map((e) => [e.id, e]));
  for (const e of incoming) map.set(e.id, e);
  return Array.from(map.values());
}

/**
 * 仅写入 localStorage（自动本地保存），并标记脏键 → 触发防抖后台 DB 同步
 */
function saveToStorage(entries: Record<string, MemoryEntry[]>, dirtyKeys?: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    for (const k of dirtyKeys || []) _dirtyKeys.add(k);
    scheduleDbSync();
  } catch { /* ignore */
    for (const k of dirtyKeys || []) _dirtyKeys.add(k);
    scheduleDbSync();
  }
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

const DB_WRITE_RETRIES = 3;
const DB_WRITE_RETRY_DELAY_MS = 500;

async function saveToDbWithRetry(entries: MemoryEntry[], attempt = 0): Promise<void> {
  try {
    await dbSaveMemoryEntries(entries);
  } catch (e) {
    if (attempt < DB_WRITE_RETRIES - 1) {
      await new Promise(r => setTimeout(r, DB_WRITE_RETRY_DELAY_MS * (attempt + 1)));
      return saveToDbWithRetry(entries, attempt + 1);
    }
    const ids = entries.map(e => e.id).join(',');
    const cats = entries.map(e => e.category).join(',');
    useDebugLog.getState().add('system', `[memoryStore] DB写入最终失败(${entries.length}条): categories=${cats}, ids=${ids}, error=${String(e)}`);
    console.error('[memoryStore] dbSaveMemoryEntries failed after retries:', e);
  }
}

type SearchMode = 'keyword' | 'vector';

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
  availableDates: string[];

  /** 向量搜索模式 */
  searchMode: SearchMode;
  /** 上一次向量搜索结果（含相似度） */
  vectorSearchResults: VectorSearchResult[];
  /** 向量索引统计 */
  vectorStats: { totalEntries: number; perCharacter: Record<string, number> };

  loadFirstPage: (characterId?: string) => Promise<void>;
  loadMore: (characterId?: string) => Promise<void>;
  loadAvailableDates: (characterId?: string) => Promise<void>;
  addEntry: (entry: MemoryEntry) => Promise<void>;
  addEntries: (characterId: string, newEntries: MemoryEntry[]) => Promise<void>;
  updateEntryImportance: (id: string, importance: number) => void;
  softDeleteEntry: (id: string) => void;
  permanentDeleteEntry: (id: string) => void;
  deleteEntry: (id: string) => void;
  searchEntries: (characterId: string, query: string) => Promise<MemoryEntry[]>;
  vectorSearchEntries: (characterId: string, query: string) => Promise<VectorSearchResult[]>;
  getEntries: (characterId: string) => MemoryEntry[];
  getFilteredEntries: (characterId: string) => MemoryEntry[];
  setSearchQuery: (query: string) => void;
  setFilterCategory: (category: MemoryCategory | 'all') => void;
  setSearchMode: (mode: SearchMode) => void;
  setSelectedDate: (dateStr: string) => void;
  setShowAllDates: (show: boolean) => void;
  /** 索引所有条目的向量 */
  buildVectorIndex: (characterId?: string) => Promise<void>;
  /** 🆕 首屏后再解析 localStorage 记忆缓存（避免启动时阻塞主线程） */
  hydrateLocal: () => void;
}

const FILTER_CAT_KEY = 'session-memory-filter-cat';
const FILTER_DATE_KEY = 'session-memory-filter-date';
const FILTER_SHOWALL_KEY = 'session-memory-filter-showall';

function loadSessionFilter<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) {
      const parsed = JSON.parse(v);
      if (key === FILTER_SHOWALL_KEY && parsed === false) {
        localStorage.setItem(key, JSON.stringify(true));
        return true as T;
      }
      return parsed;
    }
    return fallback;
  } catch { return fallback; }
}
function saveSessionFilter(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  // 🆕 启动性能优化：不再在模块加载时同步解析整个记忆库（大 JSON.parse 会阻塞首帧），
  // 首屏渲染完成后由 App 调用 hydrateLocal() 异步补载。
  entries: {},
  searchQuery: '',
  filterCategory: loadSessionFilter<MemoryCategory | 'all'>(FILTER_CAT_KEY, 'all'),
  isLoaded: false,
  hasMore: {},
  cursors: {},
  loadingMore: false,
  selectedDate: loadSessionFilter<string>(FILTER_DATE_KEY, getTodayStr()),
  showAllDates: loadSessionFilter<boolean>(FILTER_SHOWALL_KEY, true),
  availableDates: [],
  searchMode: 'keyword' as SearchMode,
  vectorSearchResults: [],
  vectorStats: { totalEntries: 0, perCharacter: {} },

  loadFirstPage: async (characterId?: string) => {
    const { selectedDate, showAllDates, filterCategory } = get();
    const stateKey = characterId || '__all__';
    const cat = filterCategory === 'all' ? undefined : filterCategory;

    set((state) => ({
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
          const isFullLoad = showAllDates && !cat;
          if (isFullLoad) {
            saveToStorage(updated); // 仅刷新本地缓存（数据来自 DB，无需回写）
          }
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
        const isFullLoad = showAllDates && !cat;
        if (isFullLoad) {
          saveToStorage(updated); // 仅刷新本地缓存
        }
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

  loadAvailableDates: async (characterId?: string) => {
    try {
      if (isRunningInTauri()) {
        const dates = await dbGetMemoryEntriesAvailableDates(characterId);
        set({ availableDates: dates.sort((a, b) => b.localeCompare(a)) });
      } else {
        const { entries } = get();
        const dateSet = new Set<string>();
        const target = characterId ? (entries[characterId] || []) : Object.values(entries).flat();
        for (const entry of target) {
          dateSet.add(toLocalDateStr(new Date(entry.createdAt)));
        }
        set({ availableDates: Array.from(dateSet).sort((a, b) => b.localeCompare(a)) });
      }
    } catch { /* availableDates stays as [] */ }
  },

  addEntry: async (entry: MemoryEntry) => {
    const { characterId } = entry;
    set((state) => {
      const current = state.entries[characterId] || [];
      const updated = [entry, ...current].slice(0, 500);
      const newEntries = { ...state.entries, [characterId]: updated };
      saveToStorage(newEntries, [characterId]);
      return { entries: newEntries };
    });
    // 🆕 不再立即写入 DB，仅标记待同步（关闭前批量 flush）
  },

  addEntries: async (characterId: string, newEntries: MemoryEntry[]) => {
    if (newEntries.length === 0) return;
    set((state) => {
      const current = state.entries[characterId] || [];
      const updated = [...newEntries, ...current].slice(0, 500);
      const allEntries = { ...state.entries, [characterId]: updated };
      saveToStorage(allEntries, [characterId]);
      return { entries: allEntries };
    });
    // 🆕 本地已保存；DB 由防抖后台静默同步
  },

  updateEntryImportance: (id: string, importance: number) => {
    let updatedEntry: MemoryEntry | null = null;
    set((state) => {
      const newEntries: Record<string, MemoryEntry[]> = {};
      for (const [charId, entries] of Object.entries(state.entries)) {
        newEntries[charId] = entries.map(e => {
          if (e.id === id) {
            updatedEntry = { ...e, importance };
            return updatedEntry;
          }
          return e;
        });
      }
      saveToStorage(newEntries, updatedEntry ? [updatedEntry.characterId] : undefined);
      return { entries: newEntries };
    });
    // 🆕 本地已保存；DB 由防抖后台静默同步
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
      saveToStorage(newEntries, deletedEntry ? [deletedEntry.characterId] : undefined);
      if (deletedEntry) {
        useRecycleBinStore.getState().addEntry(deletedEntry);
      }
      return { entries: newEntries };
    });
    dbDeleteMemoryEntry(id).catch(() => {});
    removeVectorEntry(id);
  },

  permanentDeleteEntry: (id: string) => {
    set((state) => {
      const newEntries: Record<string, MemoryEntry[]> = {};
      for (const [charId, entries] of Object.entries(state.entries)) {
        newEntries[charId] = entries.filter(e => e.id !== id);
      }
      saveToStorage(newEntries); // DB 已直接删除，仅刷新本地缓存
      return { entries: newEntries };
    });
    dbDeleteMemoryEntry(id).catch(() => {});
    removeVectorEntry(id);
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
  setFilterCategory: (category: MemoryCategory | 'all') => {
    saveSessionFilter(FILTER_CAT_KEY, category);
    set({ filterCategory: category });
  },
  setSelectedDate: (dateStr: string) => {
    saveSessionFilter(FILTER_DATE_KEY, dateStr);
    set({ selectedDate: dateStr });
  },
  setShowAllDates: (show: boolean) => {
    saveSessionFilter(FILTER_SHOWALL_KEY, show);
    set({ showAllDates: show });
  },

  /**
   * 🆕 首屏后异步补载本地记忆缓存（localStorage）。
   * 与 DB 分页数据按 id 合并（本地缓存优先），不阻塞启动。
   */
  hydrateLocal: () => {
    const parsed = loadFromStorage();
    set((state) => {
      const merged: Record<string, MemoryEntry[]> = { ...state.entries };
      for (const k of Object.keys(parsed)) {
        merged[k] = mergeById(merged[k] || [], parsed[k]);
      }
      return { entries: merged };
    });
  },

  setSearchMode: (mode: SearchMode) => {
    set({ searchMode: mode, vectorSearchResults: [] });
  },

  vectorSearchEntries: async (characterId: string, query: string) => {
    if (!query.trim()) {
      set({ vectorSearchResults: [] });
      return [];
    }
    const { entries } = get();
    const allEntries = entries[characterId] || [];
    const results = await vectorSearch(query, characterId, 20, allEntries);
    set({ vectorSearchResults: results });
    return results;
  },

  buildVectorIndex: async (characterId?: string) => {
    const { entries } = get();
    const charIds = characterId
      ? [characterId]
      : Object.keys(entries);

    for (const cid of charIds) {
      await indexMemoryEntries(cid, entries[cid] || []);
    }

    set({ vectorStats: getVectorStats() });
  },
}));
