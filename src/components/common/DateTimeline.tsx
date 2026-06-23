
import { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayStr(): string {
  return toLocalDateStr(new Date());
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const todayStr = getTodayStr();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toLocalDateStr(yesterday);

  if (dateStr === todayStr) return '今天';
  if (dateStr === yesterdayStr) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function generateRecentDays(count: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(toLocalDateStr(d));
  }
  return days;
}

interface DateTimelineProps {
  selectedDate: string;
  onDateChange: (dateStr: string) => void;
  recentDays?: number;
  showAll?: boolean;
  showAllMode?: boolean;
  onToggleAll?: () => void;
}

export function DateTimeline({
  selectedDate,
  onDateChange,
  recentDays = 14,
  showAll = true,
  showAllMode = false,
  onToggleAll,
}: DateTimelineProps) {
  const days = useMemo(() => generateRecentDays(recentDays), [recentDays]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll, days]);

  const scrollSelectedIntoView = useCallback(() => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    if (showAllMode) {
      container.scrollTo({ left: 0 });
      return;
    }
    const selectedBtn = container.querySelector(`[data-date="${selectedDate}"]`) as HTMLElement | null;
    if (!selectedBtn) return;
    selectedBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedDate, showAllMode]);

  useEffect(() => {
    scrollSelectedIntoView();
  }, [selectedDate, showAllMode, scrollSelectedIntoView]);

  const scrollBy = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 120, behavior: 'smooth' });
  };

  const goOlder = () => {
    if (showAllMode) {
      if (onToggleAll) onToggleAll();
      onDateChange(getTodayStr());
      return;
    }
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    onDateChange(toLocalDateStr(d));
  };

  const goNewer = () => {
    if (showAllMode) {
      if (onToggleAll) onToggleAll();
      onDateChange(getTodayStr());
      return;
    }
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    const todayStr = getTodayStr();
    const nextStr = toLocalDateStr(d);
    if (nextStr <= todayStr) {
      onDateChange(nextStr);
    }
  };

  const isToday = selectedDate === getTodayStr();
  const isLastDay = selectedDate === days[days.length - 1];

  return (
    <div className="flex items-center gap-1.5 py-1">
      <button
        onClick={() => { goNewer(); }}
        disabled={isToday && !showAllMode}
        className={`p-1.5 rounded-lg transition-colors shrink-0 ${
          isToday && !showAllMode
            ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
        }`}
        title="更晚"
      >
        <ChevronLeft size={14} />
      </button>

      <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-auto date-timeline-scroll">
        <div className="flex gap-1 w-max py-1 px-1">
          {showAll && (
            <button
              data-all-btn
              onClick={onToggleAll}
              className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition-all shrink-0 flex items-center gap-1 ${
                showAllMode
                  ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700 shadow-sm font-medium'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Calendar size={10} />
              全部
            </button>
          )}
          {days.map((day) => (
            <button
              key={day}
              data-date={day}
              onClick={() => { onDateChange(day); if (showAllMode && onToggleAll) onToggleAll(); }}
              className={`px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap transition-all shrink-0 ${
                !showAllMode && selectedDate === day
                  ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700 shadow-sm font-medium'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {formatDateLabel(day)}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => { goOlder(); }}
        disabled={isLastDay && !showAllMode}
        className={`p-1.5 rounded-lg transition-colors shrink-0 ${
          isLastDay && !showAllMode
            ? 'text-gray-300 dark:text-gray-700 cursor-not-allowed'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
        }`}
        title="更早"
      >
        <ChevronRight size={14} />
      </button>

      {!isToday && !showAllMode && (
        <button
          onClick={() => onDateChange(getTodayStr())}
          className="px-2 py-1 rounded-lg text-[10px] text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors shrink-0"
        >
          回到今天
        </button>
      )}

      <style>{`
        .date-timeline-scroll::-webkit-scrollbar { display: none; }
        .date-timeline-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}

export { toLocalDateStr, getTodayStr };
