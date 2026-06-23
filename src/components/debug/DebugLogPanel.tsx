
import { useState, useMemo, useEffect, useRef } from 'react';
import { ArrowLeft, Terminal, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDebugLog, DebugLogType } from '../../store/debugLogStore';
import { useCharacterStore } from '../../store/characterStore';
import { useChatStore } from '../../store/chatStore';
import { DateTimeline } from '../common/DateTimeline';

const typeColors: Record<DebugLogType, string> = {
  system: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20',
  reply: 'text-green-500 bg-green-50 dark:bg-green-900/20',
  intercept: 'text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20',
  injection: 'text-red-500 bg-red-50 dark:bg-red-900/20',
  emotion: 'text-pink-500 bg-pink-50 dark:bg-pink-900/20',
  affinity: 'text-rose-500 bg-rose-50 dark:bg-rose-900/20',
  memory: 'text-purple-500 bg-purple-50 dark:bg-purple-900/20',
  learning: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20',
  error: 'text-red-600 bg-red-50 dark:bg-red-900/20',
};

const typeBadge: Record<DebugLogType, string> = {
  system: '系统',
  reply: '回复',
  intercept: '拦截',
  injection: '注入',
  emotion: '情绪',
  affinity: '好感度',
  memory: '记忆',
  learning: '学习',
  error: '错误',
};

function formatTime(d: Date) {
  return d.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(d: Date) {
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

const ALL_TYPES: (DebugLogType | 'all')[] = ['all', 'system', 'reply', 'intercept', 'injection', 'emotion', 'affinity', 'memory', 'learning', 'error'];

const PAGE_SIZE = 30;

export function DebugLogPanel() {
  const logs = useDebugLog((s) => s.logs);
  const removeLogs = useDebugLog((s) => s.remove);
  const loadFirstPage = useDebugLog((s) => s.loadFirstPage);
  const characters = useCharacterStore((s) => s.characters);
  const conversations = useChatStore((s) => s.conversations);
  const navigate = useNavigate();

  const selectedDate = useDebugLog((s) => s.selectedDate);
  const setSelectedDate = useDebugLog((s) => s.setSelectedDate);
  const showAllDates = useDebugLog((s) => s.showAllDates);
  const setShowAllDates = useDebugLog((s) => s.setShowAllDates);

  const [filterType, setFilterType] = useState<DebugLogType | 'all'>('all');
  const [filterChar, setFilterChar] = useState<string>('all');
  const [filterConv, setFilterConv] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [viewLog, setViewLog] = useState<{ type: string; message: string; time: Date; charName?: string; convTitle?: string } | null>(null);
  const [renderCount, setRenderCount] = useState(PAGE_SIZE);
  const [listKey, setListKey] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadFirstPage({
      characterId: filterChar === 'all' ? undefined : filterChar,
      logType: filterType === 'all' ? undefined : filterType,
      conversationId: filterConv === 'all' ? undefined : filterConv,
    });
    setRenderCount(PAGE_SIZE);
    setListKey(k => k + 1);
  }, [selectedDate, showAllDates, filterType, filterChar, filterConv, loadFirstPage]);

  const filteredLogs = useMemo(() => {
    return logs.filter(l => {
      if (filterType !== 'all' && l.type !== filterType) return false;
      if (filterChar !== 'all' && l.characterId !== filterChar) return false;
      if (filterConv !== 'all' && l.conversationId !== filterConv) return false;
      return true;
    });
  }, [logs, filterType, filterChar, filterConv]);

  const visibleLogs = useMemo(() => filteredLogs.slice(0, renderCount), [filteredLogs, renderCount]);
  const hasMore = renderCount < filteredLogs.length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setRenderCount((prev) => prev + PAGE_SIZE);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  const charNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of characters) map.set(c.id, c.name);
    return map;
  }, [characters]);

  const convTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of conversations) map.set(c.id, c.title);
    return map;
  }, [conversations]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(filteredLogs.map(l => l.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`确定删除选中的 ${selectedIds.size} 条日志？`)) {
      removeLogs(Array.from(selectedIds));
      setSelectedIds(new Set());
      setSelectMode(false);
    }
  };

  const totalCount = useDebugLog((s) => s.totalCount);
  const hasFilter = filterType !== 'all' || filterChar !== 'all' || filterConv !== 'all';
  const interceptCount = useMemo(() => logs.filter(l => l.type === 'intercept').length, [logs]);
  const injectionCount = useMemo(() => logs.filter(l => l.type === 'injection').length, [logs]);

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 animate-[fadeUp_0.3s_ease-out]">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6 animate-[fadeUp_0.3s_ease-out_0.05s_both]">
          <button
            onClick={() => navigate('/chat')}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500 transition-colors active:scale-95"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2.5 flex-1">
            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <Terminal size={16} className="text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">运行日志</h1>
              <p className="text-xs text-gray-500">查看 AI 对话运行状态</p>
            </div>
          </div>
          {selectMode ? (
            <div className="flex items-center gap-2 animate-[fadeIn_0.15s_ease-out]">
              <span className="text-xs text-gray-500">已选 {selectedIds.size}</span>
              <button onClick={selectAll} className="text-xs text-violet-600 hover:underline">全选</button>
              <button onClick={deselectAll} className="text-xs text-gray-500 hover:underline">取消</button>
              <button
                onClick={deleteSelected}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-white bg-red-500 hover:bg-red-600 transition-all disabled:opacity-40 active:scale-95"
              >
                <Trash2 size={12} />
                删除
              </button>
              <button
                onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
                className="text-xs text-gray-500 hover:underline"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSelectMode(true)}
              disabled={logs.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-500
                hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-red-500 transition-all
                disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              <Trash2 size={12} />
              选择删除
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: '总日志', value: totalCount, color: 'text-gray-900 dark:text-gray-100', delay: '0.1s' },
            { label: '拦截触发', value: interceptCount, color: 'text-yellow-500', delay: '0.15s' },
            { label: '注入检测', value: injectionCount, color: 'text-red-500', delay: '0.2s' },
          ].map((s) => (
            <div
              key={s.label}
              className="bg-white dark:bg-gray-900 rounded-xl p-3 border border-gray-200 dark:border-gray-800
                animate-[scaleIn_0.25s_ease-out_both] hover:shadow-md transition-shadow"
              style={{ animationDelay: s.delay } as React.CSSProperties}
            >
              <p className="text-xs text-gray-500 mb-1">{s.label}</p>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Type Filter */}
        <div className="flex gap-1.5 mb-3 flex-wrap animate-[fadeUp_0.3s_ease-out_0.15s_both]">
          {ALL_TYPES.map((t, i) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all active:scale-95 ${
                filterType === t
                  ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {t === 'all' ? '全部类型' : typeBadge[t]}
            </button>
          ))}
        </div>

        {/* Date Timeline */}
        <div className="mb-3 animate-[fadeUp_0.3s_ease-out_0.18s_both]">
          <DateTimeline
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            showAll={true}
            showAllMode={showAllDates}
            onToggleAll={() => setShowAllDates(!showAllDates)}
          />
        </div>

        {/* Character & Conversation Filter */}
        <div className="flex items-center gap-2 mb-5 flex-wrap animate-[fadeUp_0.3s_ease-out_0.2s_both]">
          <span className="text-[11px] text-gray-400 mr-0.5">角色:</span>
          <button
            onClick={() => setFilterChar('all')}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-all active:scale-95 ${
              filterChar === 'all'
                ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700 shadow-sm'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            全部
          </button>
          {characters.map(c => (
            <button
              key={c.id}
              onClick={() => setFilterChar(c.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] transition-all active:scale-95 ${
                filterChar === c.id
                  ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {c.name}
            </button>
          ))}

          <span className="text-[11px] text-gray-400 ml-2 mr-0.5">对话:</span>
          <button
            onClick={() => setFilterConv('all')}
            className={`px-2.5 py-1 rounded-md text-[11px] transition-all active:scale-95 ${
              filterConv === 'all'
                ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700 shadow-sm'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            全部
          </button>
          {conversations.map(c => (
            <button
              key={c.id}
              onClick={() => setFilterConv(c.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] whitespace-nowrap transition-all active:scale-95 ${
                filterConv === c.id
                  ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {c.title}
            </button>
          ))}
        </div>

        {/* Filter info */}
        {hasFilter && (
          <div className="flex items-center gap-2 mb-4 text-xs text-gray-400 animate-[fadeIn_0.15s_ease-out]">
            <span>筛选结果：{filteredLogs.length} 条</span>
            <button
              onClick={() => { setFilterType('all'); setFilterChar('all'); setFilterConv('all'); }}
              className="text-violet-600 hover:underline"
            >
              清除筛选
            </button>
          </div>
        )}

        {/* Log List */}
        <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm animate-[fadeUp_0.3s_ease-out_0.25s_both]">
          <div className="flex items-center gap-2 mb-3">
            <Terminal size={16} className="text-gray-500" />
            <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">日志记录</h2>
          </div>
          <div className="flex items-center gap-4 mb-3 text-xs text-gray-400">
            <span>共 {filteredLogs.length} 条{hasMore && `，已显示 ${renderCount} 条`}</span>
          </div>
          <div className="space-y-2">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-12 animate-[fadeIn_0.3s_ease-out]">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center animate-[bounceIn_0.4s_ease-out]">
                  <Terminal size={20} className="text-gray-400" />
                </div>
                <p className="text-sm text-gray-500">{logs.length === 0 ? '暂无日志' : '筛选无结果'}</p>
                <p className="text-xs text-gray-400 mt-1">{logs.length === 0 ? '发送消息后会自动记录运行状态' : '试试调整筛选条件'}</p>
              </div>
            ) : (
              <div key={listKey}>
                {visibleLogs.map((log, i) => {
                  const charName = log.characterId ? charNameMap.get(log.characterId) || null : null;
                  const convTitle = log.conversationId ? convTitleMap.get(log.conversationId) || null : null;

                  return (
                    <div
                      key={log.id}
                      onClick={() => {
                        if (selectMode) { toggleSelect(log.id); return; }
                        setViewLog({
                          type: log.type,
                          message: log.message,
                          time: log.timestamp,
                          charName: charName || undefined,
                          convTitle: convTitle || undefined,
                        });
                      }}
                      className={`flex items-start gap-3 p-3 rounded-xl transition-all cursor-pointer ${
                        selectMode
                          ? selectedIds.has(log.id)
                            ? 'bg-violet-50 dark:bg-violet-900/20 ring-1 ring-violet-200 dark:ring-violet-800 scale-[1.01]'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 active:scale-[0.99]'
                      }`}
                      style={{ animation: `listItemIn 0.2s ease-out ${Math.min(i * 0.03, 0.5)}s both` }}
                    >
                      {selectMode && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(log.id)}
                          onChange={() => toggleSelect(log.id)}
                          className="mt-1 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                        />
                      )}
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium mt-0.5 shrink-0 ${typeColors[log.type]}`}>
                        {typeBadge[log.type]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 dark:text-gray-300 break-all leading-relaxed">
                          {log.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[11px] text-gray-400">
                            {formatDate(log.timestamp)} {formatTime(log.timestamp)}
                          </span>
                          {charName && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                              {charName}
                            </span>
                          )}
                          {convTitle && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
                              {convTitle}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="py-4 text-center text-xs text-gray-400">
              加载更多...
            </div>
          )}
          {!hasMore && filteredLogs.length > PAGE_SIZE && (
            <div className="py-4 text-center text-xs text-gray-400">
              已加载全部 {filteredLogs.length} 条日志
            </div>
          )}
        </section>
      </div>

      {/* Detail Modal */}
      {viewLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setViewLog(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${typeColors[viewLog.type as DebugLogType]}`}>
                  {typeBadge[viewLog.type as DebugLogType]}
                </span>
                <span className="text-xs text-gray-400">
                  {formatDate(viewLog.time)} {formatTime(viewLog.time)}
                </span>
                {viewLog.charName && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
                    {viewLog.charName}
                  </span>
                )}
                {viewLog.convTitle && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
                    {viewLog.convTitle}
                  </span>
                )}
              </div>
              <button
                onClick={() => setViewLog(null)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X size={16} className="text-gray-500" />
              </button>
            </div>
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed break-all">
                {viewLog.message}
              </p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes bounceIn {
          0% { opacity: 0; transform: scale(0.5); }
          60% { transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes listItemIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

