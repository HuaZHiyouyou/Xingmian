import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ArrowLeft, Search, Brain, Lightbulb, BarChart3, RefreshCw, BookOpen, Trash2, Tag, Clock, X, MessageCircle, AlertTriangle, History, Reply, NotebookPen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMemoryStore } from '../../store/memoryStore';
import { useCharacterStore } from '../../store/characterStore';
import { useChatStore } from '../../store/chatStore';
import { MemoryEntry, MemoryCategory, MEMORY_CATEGORY_LABELS, MEMORY_CATEGORY_COLORS } from '../../types';
import { DateTimeline } from '../common/DateTimeline';

const PAGE_SIZE = 30;

const CATEGORY_ICONS: Record<MemoryCategory, React.ReactNode> = {
  summary: <BookOpen size={14} />,
  thinking: <Brain size={14} />,
  analysis: <BarChart3 size={14} />,
  reflection: <RefreshCw size={14} />,
  fact: <Lightbulb size={14} />,
  user_message: <MessageCircle size={14} />,
  recall: <History size={14} />,
  reply_content: <Reply size={14} />,
  diary: <NotebookPen size={14} />,
};

const ALL_CATEGORIES: (MemoryCategory | 'all')[] = ['all', 'user_message', 'recall', 'reply_content', 'summary', 'thinking', 'analysis', 'reflection', 'fact', 'diary'];

const FILTER_BTN_BASE = 'relative px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all duration-200 border';

function FilterBar({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: { key: string; label: React.ReactNode }[] }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {items.map((item) => {
        const active = value === item.key;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={`${FILTER_BTN_BASE} ${
              active
                ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function MemoryPanel() {
  const navigate = useNavigate();
  const characters = useCharacterStore((s) => s.characters);
  const conversations = useChatStore((s) => s.conversations);
  const allEntries = useMemoryStore((s) => s.entries);
  const searchQuery = useMemoryStore((s) => s.searchQuery);
  const filterCategory = useMemoryStore((s) => s.filterCategory);
  const setSearchQuery = useMemoryStore((s) => s.setSearchQuery);
  const setFilterCategory = useMemoryStore((s) => s.setFilterCategory);
  const softDeleteEntry = useMemoryStore((s) => s.softDeleteEntry);
  const permanentDeleteEntry = useMemoryStore((s) => s.permanentDeleteEntry);
  const loadFirstPage = useMemoryStore((s) => s.loadFirstPage);
  const selectedDate = useMemoryStore((s) => s.selectedDate);
  const setSelectedDate = useMemoryStore((s) => s.setSelectedDate);
  const showAllDates = useMemoryStore((s) => s.showAllDates);
  const setShowAllDates = useMemoryStore((s) => s.setShowAllDates);

  const [viewEntry, setViewEntry] = useState<MemoryEntry | null>(null);
  const [softDeleteTarget, setSoftDeleteTarget] = useState<string | null>(null);
  const [confirmPermDelete, setConfirmPermDelete] = useState<string | null>(null);
  const [permDeleteChecked, setPermDeleteChecked] = useState(false);
  const [permDeleteStep, setPermDeleteStep] = useState<0 | 1>(0);
  const [filterCharId, setFilterCharId] = useState<string>('all');
  const [renderCount, setRenderCount] = useState(PAGE_SIZE);
  const [listKey, setListKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  /** 已加载过的过滤组合缓存键：切回面板时避免重复查询造成的卡顿与闪烁 */
  const loadedKeyRef = useRef<string>('');

  useEffect(() => {
    const cacheKey = `${filterCharId}|${selectedDate}|${showAllDates}|${filterCategory}`;
    const stateKey = filterCharId === 'all' ? '__all__' : filterCharId;
    const cached = useMemoryStore.getState().entries[stateKey];
    setRenderCount(PAGE_SIZE);
    setListKey(k => k + 1);
    if (loadedKeyRef.current === cacheKey && cached && cached.length > 0) {
      return; // 同一过滤组合已加载过：直接用内存缓存，消除切换回来的闪动
    }
    loadedKeyRef.current = cacheKey;
    setLoading(true);
    Promise.resolve(loadFirstPage(filterCharId === 'all' ? undefined : filterCharId))
      .finally(() => setLoading(false));
  }, [selectedDate, showAllDates, filterCategory, filterCharId, loadFirstPage]);

  const charItems = useMemo(() => [
    { key: 'all', label: '全部' },
    ...characters.map(c => ({ key: c.id, label: c.name })),
  ], [characters]);

  const categoryItems = useMemo(() => ALL_CATEGORIES.map(cat => ({
    key: cat,
    label: cat === 'all' ? '全部' : <span className="flex items-center gap-1">{CATEGORY_ICONS[cat as MemoryCategory]}{MEMORY_CATEGORY_LABELS[cat as MemoryCategory]}</span>,
  })), []);

  const entries = useMemo(() => {
    let result: MemoryEntry[];
    if (filterCharId !== 'all') {
      result = allEntries[filterCharId] || [];
    } else {
      const flatEntries = Object.values(allEntries).flat();
      const seen = new Set<string>();
      result = flatEntries.filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
    }
    if (filterCategory !== 'all') {
      result = result.filter((e) => e.category === filterCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          (Array.isArray(e.tags) && e.tags.some((t) => t.toLowerCase().includes(q)))
      );
    }
    return result;
  }, [allEntries, filterCharId, filterCategory, searchQuery]);

  const visibleEntries = useMemo(() => entries.slice(0, renderCount), [entries, renderCount]);
  const hasMore = renderCount < entries.length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return undefined;

    const observer = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries[0].isIntersecting) {
          setRenderCount((prev) => prev + PAGE_SIZE);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore]);

  const getConversationTitle = useCallback((convId: string) => {
    const conv = conversations.find(c => c.id === convId);
    return conv?.title || '未知对话';
  }, [conversations]);

  const formatDate = (date: Date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    if (diffHour < 24) return `${diffHour}小时前`;
    if (diffDay < 7) return `${diffDay}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const handleSoftDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSoftDeleteTarget(id);
  };

  const confirmSoftDelete = () => {
    if (softDeleteTarget) {
      softDeleteEntry(softDeleteTarget);
      if (viewEntry?.id === softDeleteTarget) setViewEntry(null);
    }
    setSoftDeleteTarget(null);
  };

  const handlePermanentDeleteStart = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmPermDelete(id);
    setPermDeleteChecked(false);
    setPermDeleteStep(0);
  };

  const handlePermanentDeleteConfirm = () => {
    if (permDeleteStep === 0) {
      setPermDeleteStep(1);
      return;
    }
    if (!permDeleteChecked) return;
    if (confirmPermDelete) {
      permanentDeleteEntry(confirmPermDelete);
      if (viewEntry?.id === confirmPermDelete) setViewEntry(null);
    }
    setConfirmPermDelete(null);
    setPermDeleteChecked(false);
    setPermDeleteStep(0);
  };

  return (
    <div className="flex-1 min-h-0 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-8 animate-[fadeUp_0.3s_ease-out]">
        <div className="flex items-center gap-3 mb-3 animate-[fadeUp_0.3s_ease-out_0.05s_both]">
          <button onClick={() => navigate('/chat')} className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors active:scale-95 shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Brain size={20} className="text-slate-700 dark:text-slate-300" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">记忆模块</h1>
          </div>
        </div>

        {charItems.length > 1 && (
          <div className="mb-3 animate-[fadeUp_0.3s_ease-out_0.1s_both]">
            <FilterBar value={filterCharId} onChange={setFilterCharId} items={charItems} />
          </div>
        )}

        <div className="mb-5 animate-[fadeUp_0.3s_ease-out_0.15s_both]">
          <DateTimeline
            selectedDate={selectedDate}
            onDateChange={setSelectedDate}
            showAll={true}
            showAllMode={showAllDates}
            onToggleAll={() => setShowAllDates(!showAllDates)}
          />
        </div>

        <div className="mb-5 animate-[fadeUp_0.3s_ease-out_0.2s_both]">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索记忆..."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-slate-700 transition-shadow"
            />
          </div>
        </div>

        <div className="mb-4 animate-[fadeUp_0.3s_ease-out_0.25s_both]">
          <FilterBar value={filterCategory} onChange={setFilterCategory} items={categoryItems} />
        </div>

        <div className="flex items-center gap-4 mb-4 text-xs text-gray-400">
          {loading ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full border border-gray-300 dark:border-gray-600 border-t-slate-700 animate-spin" />
              正在加载记忆…
            </span>
          ) : (
            <span>共 {entries.length} 条记忆{hasMore && `，已显示 ${renderCount} 条`}</span>
          )}
          {searchQuery && <span>搜索: "{searchQuery}"</span>}
          {filterCategory !== 'all' && <span>分类: {MEMORY_CATEGORY_LABELS[filterCategory]}</span>}
        </div>

        {entries.length === 0 ? (
          loading ? (
            <div className="text-center py-16">
              <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-gray-200 dark:border-gray-700 border-t-slate-700 animate-spin" />
              <p className="text-gray-400 dark:text-gray-500 text-sm">正在加载记忆…</p>
            </div>
          ) : (
            <div className="text-center py-16 animate-[fadeIn_0.3s_ease-out]">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center animate-[bounceIn_0.4s_ease-out]">
                <Brain size={20} className="text-gray-400" />
              </div>
              <p className="text-gray-500 dark:text-gray-400">{searchQuery ? '未找到匹配的记忆' : '还没有记忆，开始聊天后会自动生成'}</p>
            </div>
          )
        ) : (
          <div className="relative">
            <div key={listKey} className={`space-y-2 transition-all duration-200 ${loading ? 'opacity-40 scale-[0.995] pointer-events-none select-none' : 'opacity-100'}`}>
              {visibleEntries.map((entry, index) => (
                <div
                  key={entry.id}
                  onClick={() => setViewEntry(entry)}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-sm transition-all cursor-pointer active:scale-[0.99] p-4"
                  style={{ animation: `listItemIn 0.25s ease-out ${Math.min(index * 0.03, 0.5)}s both` }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 p-1.5 rounded-lg ${MEMORY_CATEGORY_COLORS[entry.category]}`}>
                      {CATEGORY_ICONS[entry.category]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">{entry.title}</h3>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${MEMORY_CATEGORY_COLORS[entry.category]}`}>
                          {MEMORY_CATEGORY_LABELS[entry.category]}
                        </span>
                      </div>
                      {entry.triggerMessage && (
                        <div className="text-[11px] text-slate-700 dark:text-slate-300 dark:text-slate-500 mb-1 truncate italic">"{entry.triggerMessage}"</div>
                      )}
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{entry.content}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="flex items-center gap-1 text-[10px] text-gray-400"><Clock size={10} />{formatDate(entry.createdAt)}</span>
                        <span className="text-[10px] text-gray-400">重要度: {entry.importance}/10</span>
                        <span className="text-[10px] text-gray-400">{getConversationTitle(entry.conversationId)}</span>
                      </div>
                      {Array.isArray(entry.tags) && entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {entry.tags.map((tag, i) => (
                            <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] text-gray-500">
                              <Tag size={8} />{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button onClick={(e) => handleSoftDeleteClick(entry.id, e)}
                        className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 transition-colors"
                        title="删除（可恢复）">
                        <Trash2 size={12} />
                      </button>
                      <button onClick={(e) => handlePermanentDeleteStart(entry.id, e)}
                        className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                        title="彻底删除（不可恢复）">
                        <AlertTriangle size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className={`absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/60 dark:bg-gray-950/60 backdrop-blur-[2px] transition-opacity duration-200 ${loading ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-white dark:bg-gray-800 shadow-sm text-xs text-gray-500 dark:text-gray-400">
                <span className="w-4 h-4 rounded-full border-2 border-gray-200 dark:border-gray-700 border-t-slate-700 animate-spin" />
                正在加载…
              </div>
            </div>
          </div>
        )}

        {hasMore && (
          <div ref={sentinelRef} className="py-4 text-center text-xs text-gray-400">
            加载更多...
          </div>
        )}
        {!hasMore && entries.length > PAGE_SIZE && (
          <div className="py-4 text-center text-xs text-gray-400">
            已加载全部 {entries.length} 条记忆
          </div>
        )}
      </div>

      {viewEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setViewEntry(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`p-1.5 rounded-lg shrink-0 ${MEMORY_CATEGORY_COLORS[viewEntry.category]}`}>
                  {CATEGORY_ICONS[viewEntry.category]}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{viewEntry.title}</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${MEMORY_CATEGORY_COLORS[viewEntry.category]}`}>
                      {MEMORY_CATEGORY_LABELS[viewEntry.category]}
                    </span>
                    <span className="text-[10px] text-gray-400">重要度: {viewEntry.importance}/10</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setViewEntry(null)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0 ml-2">
                <X size={16} className="text-gray-500" />
              </button>
            </div>
            <div className="p-4 max-h-[55vh] overflow-y-auto">
              {viewEntry.triggerMessage && (
                <div className="mb-3 p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/20 border border-slate-300 dark:border-slate-900">
                  <span className="text-[10px] font-medium text-slate-700 dark:text-slate-300 dark:text-slate-500 uppercase tracking-wide">触发消息</span>
                  <p className="text-sm text-slate-800 dark:text-slate-400 mt-0.5">{viewEntry.triggerMessage}</p>
                </div>
              )}
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{viewEntry.content}</p>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3 text-[11px] text-gray-400">
                <span className="flex items-center gap-1"><Clock size={10} />{formatDate(viewEntry.createdAt)}</span>
                <span>{getConversationTitle(viewEntry.conversationId)}</span>
              </div>
              <div className="flex gap-1">
                <button onClick={(e) => handleSoftDeleteClick(viewEntry.id, e)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <Trash2 size={11} />删除
                </button>
                <button onClick={(e) => handlePermanentDeleteStart(viewEntry.id, e)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                  <AlertTriangle size={11} />彻底删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {softDeleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSoftDeleteTarget(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-gray-100 dark:bg-gray-800">
                <Trash2 size={20} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">删除记忆</h3>
                <p className="text-xs text-gray-500 mt-0.5">此记忆将移入回收站，可随时恢复</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSoftDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
              <button onClick={confirmSoftDelete}
                className="px-4 py-2 rounded-lg text-sm text-white bg-gray-600 hover:bg-gray-700 transition-colors active:scale-95">
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmPermDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setConfirmPermDelete(null); setPermDeleteChecked(false); setPermDeleteStep(0); }} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {permDeleteStep === 0 ? '确认彻底删除？' : '最后确认'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {permDeleteStep === 0 ? '此操作不可撤销' : '请勾选确认后删除'}
                </p>
              </div>
            </div>
            {permDeleteStep === 1 && (
              <label className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 mb-4 cursor-pointer">
                <input type="checkbox" checked={permDeleteChecked} onChange={(e) => setPermDeleteChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500" />
                <span className="text-xs text-red-700 dark:text-red-300">我已知道后果，这条记忆将无法恢复</span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setConfirmPermDelete(null); setPermDeleteChecked(false); setPermDeleteStep(0); }}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
              <button onClick={handlePermanentDeleteConfirm}
                disabled={permDeleteStep === 1 && !permDeleteChecked}
                className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95">
                {permDeleteStep === 0 ? '下一步' : '彻底删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
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