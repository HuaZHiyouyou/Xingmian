
import { create } from 'zustand';
import {
  isRunningInTauri,
  dbGetDebugLogsPage,
  dbGetDebugLogsCount,
  dbBatchInsertDebugLogs,
  dbClearDebugLogs,
  dbDeleteDebugLogsByIds,
  dbDeleteDebugLogsByCharacter,
  dbDeleteDebugLogsByConversation,
  PaginatedDebugLogs,
} from '../lib/tauriBridge';
import { BatchWriter } from '../lib/batchWriter';
import { getTodayStr } from '../components/common/DateTimeline';

export type DebugLogType = 'system' | 'reply' | 'intercept' | 'injection' | 'emotion' | 'affinity' | 'memory' | 'learning' | 'error' | 'dedup' | 'pipeline' | 'proactive' | 'ailife' | 'bot' | 'agent';

export interface DebugLog {
  id: string;
  type: DebugLogType;
  message: string;
  timestamp: Date;
  characterId?: string;
  conversationId?: string;
  duration?: number;
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

  add: (type: DebugLogType, message: string, opts?: { characterId?: string; conversationId?: string; duration?: number }) => void;
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

// ✅ 修复卡顿：批量合并 in-memory state 更新
// AI 单次回复期间 add() 可能被调用 10+ 次（pipeline/raw/thought/consult/report/parse_warnings/reply 完成 等），
// 每次同步 set() 都会触发所有订阅者重新渲染。将多个 add() 合并为一次 set()，
// 用 microtask 推迟到下一个任务执行批量写入，避免大量连续 set 造成的卡顿。
let pendingLogs: DebugLog[] = [];
let flushScheduled = false;
function scheduleFlush(set: (fn: (state: DebugLogState) => Partial<DebugLogState>) => void) {
  if (flushScheduled) return;
  flushScheduled = true;
  // 用 Promise microtask 而非 setTimeout，确保同步代码块内连续 add() 全部合并
  Promise.resolve().then(() => {
    flushScheduled = false;
    if (pendingLogs.length === 0) return;
    const batch = pendingLogs;
    pendingLogs = [];
    set((state) => ({ logs: [...batch, ...state.logs] }));
  });
}

const LOG_DATE_KEY = 'session-log-date';
const LOG_SHOWALL_KEY = 'session-log-showall';

function loadSessionStr(key: string, fallback: string): string {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function loadSessionBool(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v !== null ? v === 'true' : fallback; } catch { return fallback; }
}
function saveSession(key: string, value: string | boolean) {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

export const useDebugLog = create<DebugLogState>((set, get) => ({
  logs: [],
  totalCount: 0,
  isLoaded: false,
  hasMore: true,
  nextCursor: null,
  filters: {},
  selectedDate: loadSessionStr(LOG_DATE_KEY, getTodayStr()),
  showAllDates: loadSessionBool(LOG_SHOWALL_KEY, false),

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

        // 🆕 性能：首屏只拉 200 条（面板有日期过滤 + 分页），此前固定拉 2000 条拖慢启动
        const result: PaginatedDebugLogs = await dbGetDebugLogsPage(
          newFilters.characterId,
          newFilters.logType,
          newFilters.conversationId,
          undefined,
          showAllDates ? 200 : 200,
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
          duration: r.duration || 0,
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
        duration: r.duration || 0,
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
      duration: opts?.duration,
    };

    // ✅ 批量合并：同一 microtask 内多次 add() 合并为单次 set()，减少重渲染次数
    pendingLogs.push(log);
    scheduleFlush(set as (fn: (state: DebugLogState) => Partial<DebugLogState>) => void);

    const writer = getWriter(async (items) => {
      if (!isRunningInTauri()) return;
      const serializable = items.map(l => ({
        id: l.id,
        type: l.type,
        message: l.message,
        timestamp: l.timestamp instanceof Date ? l.timestamp.toISOString() : String(l.timestamp),
        characterId: l.characterId || '',
        conversationId: l.conversationId || '',
        duration: l.duration || 0,
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
    // 🆕 同步落库：此前只删内存，重载后"已删除"的日志会从数据库复活
    dbDeleteDebugLogsByIds(ids).catch(() => {});
    get().refreshTotalCount();
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

  setSelectedDate: (dateStr: string) => {
    saveSession(LOG_DATE_KEY, dateStr);
    set({ selectedDate: dateStr });
  },
  setShowAllDates: (show: boolean) => {
    saveSession(LOG_SHOWALL_KEY, show);
    set({ showAllDates: show });
  },
}));

