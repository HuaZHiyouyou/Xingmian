
import { create } from 'zustand';
import {
  isRunningInTauri,
  dbGetDebugLogsPage,
  dbGetDebugLogsCount,
  dbBatchInsertDebugLogs,
  dbClearDebugLogs,
  dbDeleteDebugLogsByCharacter,
  dbDeleteDebugLogsByConversation,
  PaginatedDebugLogs,
} from '../lib/tauriBridge';
import { BatchWriter } from '../lib/batchWriter';
import { getTodayStr } from '../components/common/DateTimeline';

export type DebugLogType = 'system' | 'reply' | 'intercept' | 'injection' | 'emotion' | 'affinity' | 'memory' | 'learning' | 'error';

export interface DebugLog {
  id: string;
  type: DebugLogType;
  message: string;
  timestamp: Date;
  characterId?: string;
  conversationId?: string;
}

interface DebugLogFilters {
  characterId?: string;
  logType?: DebugLogType;
  conversationId?: string;
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

interface DebugLogState {
  logs: DebugLog[];
  totalCount: number;
  isLoaded: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  filters: DebugLogFilters;
  selectedDate: string;
  showAllDates: boolean;

  loadFirstPage: (filters?: DebugLogFilters) => Promise<void>;
  loadMore: () => Promise<void>;
  refreshTotalCount: () => Promise<void>;

  add: (type: DebugLogType, message: string, opts?: { characterId?: string; conversationId?: string }) => void;
  flushPending: () => Promise<void>;
  remove: (ids: string[]) => void;
  clear: () => void;
  clearByCharacter: (characterId: string) => void;
  clearByConversation: (conversationId: string) => void;
  getByCharacter: (characterId: string) => DebugLog[];
  getByConversation: (conversationId: string) => DebugLog[];
  setSelectedDate: (dateStr: string) => void;
  setShowAllDates: (show: boolean) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

let logWriter: BatchWriter<DebugLog> | null = null;

function getWriter(flushFn: (items: DebugLog[]) => Promise<void>): BatchWriter<DebugLog> {
  if (!logWriter) {
    logWriter = new BatchWriter(flushFn, { batchSize: 20, debounceMs: 2000 });
  }
  return logWriter;
}

export const useDebugLog = create<DebugLogState>((set, get) => ({
  logs: [],
  totalCount: 0,
  isLoaded: false,
  hasMore: true,
  nextCursor: null,
  filters: {},
  selectedDate: getTodayStr(),
  showAllDates: false,

  loadFirstPage: async (filters?: DebugLogFilters) => {
    const newFilters = filters || get().filters;
    const { selectedDate, showAllDates } = get();
    set({ logs: [], nextCursor: null, hasMore: true, filters: newFilters, isLoaded: false });

    if (isRunningInTauri()) {
      try {
        let dateFrom: string | undefined;
        let dateTo: string | undefined;
        if (!showAllDates) {
          const range = dateToDateRange(selectedDate);
          dateFrom = range.dateFrom;
          dateTo = range.dateTo;
        }

        const result: PaginatedDebugLogs = await dbGetDebugLogsPage(
          newFilters.characterId,
          newFilters.logType,
          newFilters.conversationId,
          undefined,
          showAllDates ? 300 : 500,
          dateFrom,
          dateTo,
        );
        const logs: DebugLog[] = result.logs.map(r => ({
          id: r.id,
          type: r.type as DebugLogType,
          message: r.message,
          timestamp: new Date(r.timestamp),
          characterId: r.characterId || undefined,
          conversationId: r.conversationId || undefined,
        }));
        set({ logs, hasMore: result.hasMore, nextCursor: result.nextCursor, isLoaded: true });

        // fetch total count in background
        get().refreshTotalCount();
      } catch {
        set({ isLoaded: true });
      }
    } else {
      set({ isLoaded: true });
    }
  },

  loadMore: async () => {
    const { nextCursor, filters, logs, hasMore, showAllDates } = get();
    if (!hasMore || !nextCursor || !isRunningInTauri()) return;

    try {
      const result: PaginatedDebugLogs = await dbGetDebugLogsPage(
        filters.characterId,
        filters.logType,
        filters.conversationId,
        nextCursor,
        showAllDates ? 300 : 500,
      );
      const newLogs: DebugLog[] = result.logs.map(r => ({
        id: r.id,
        type: r.type as DebugLogType,
        message: r.message,
        timestamp: new Date(r.timestamp),
        characterId: r.characterId || undefined,
        conversationId: r.conversationId || undefined,
      }));
      set({
        logs: [...logs, ...newLogs],
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    } catch {
      // ignore
    }
  },

  refreshTotalCount: async () => {
    if (!isRunningInTauri()) return;
    const { filters, selectedDate, showAllDates } = get();
    try {
      let dateFrom: string | undefined;
      let dateTo: string | undefined;
      if (!showAllDates) {
        const range = dateToDateRange(selectedDate);
        dateFrom = range.dateFrom;
        dateTo = range.dateTo;
      }
      const count = await dbGetDebugLogsCount(
        filters.characterId,
        filters.logType,
        filters.conversationId,
        dateFrom,
        dateTo,
      );
      set({ totalCount: count });
    } catch {
      // ignore
    }
  },

  add: (type, message, opts) => {
    const log: DebugLog = {
      id: generateId(),
      type,
      message,
      timestamp: new Date(),
      characterId: opts?.characterId,
      conversationId: opts?.conversationId,
    };
    set((state) => ({
      logs: [log, ...state.logs].slice(0, 500),
    }));

    const writer = getWriter(async (items) => {
      if (!isRunningInTauri()) return;
      const serializable = items.map(l => ({
        id: l.id,
        type: l.type,
        message: l.message,
        timestamp: l.timestamp instanceof Date ? l.timestamp.toISOString() : String(l.timestamp),
        characterId: l.characterId || '',
        conversationId: l.conversationId || '',
      }));
      await dbBatchInsertDebugLogs(serializable);
    });
    writer.add(log);
  },

  flushPending: async () => {
    if (logWriter) await logWriter.flush();
  },

  remove: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      logs: state.logs.filter(l => !idSet.has(l.id)),
    }));
  },

  clear: () => {
    set({ logs: [], totalCount: 0, hasMore: true, nextCursor: null });
    dbClearDebugLogs().catch(() => {});
  },

  clearByCharacter: (characterId) => {
    set((state) => ({
      logs: state.logs.filter(l => l.characterId !== characterId),
    }));
    dbDeleteDebugLogsByCharacter(characterId).catch(() => {});
    get().refreshTotalCount();
  },

  clearByConversation: (conversationId) => {
    set((state) => ({
      logs: state.logs.filter(l => l.conversationId !== conversationId),
    }));
    dbDeleteDebugLogsByConversation(conversationId).catch(() => {});
    get().refreshTotalCount();
  },

  getByCharacter: (characterId) => {
    return get().logs.filter(l => l.characterId === characterId);
  },

  getByConversation: (conversationId) => {
    return get().logs.filter(l => l.conversationId === conversationId);
  },

  setSelectedDate: (dateStr: string) => set({ selectedDate: dateStr }),
  setShowAllDates: (show: boolean) => set({ showAllDates: show }),
}));

