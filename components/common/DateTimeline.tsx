
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

interface DateTimelineProps {
  selectedDate: string;
  onDateChange: (dateStr: string) => void;
  recentDays?: number;
  showAll?: boolean;
  showAllMode?: boolean;
  onToggleAll?: () => void;
  /**
   * 数据中实际存在的日期集合(按从新到旧排序:今天 → 昨天 → ... → 最早)。
   * 提供此参数时,时间轴会显示全部日期(以可滚动的方式),
   * 初始定位到 selectedDate,滚到右侧时自动扩展更早的日期。
   * 不提供时,使用 recentDays 模式(只显示最近 N 天)。
   */
  availableDates?: string[];
}

export function DateTimeline({
  selectedDate,
  onDateChange,
  recentDays = 14,
  showAll = true,
  showAllMode = false,
  onToggleAll,
  availableDates,
}: DateTimelineProps) {
  // 模式 1: 有 availableDates 时,显示全部日期(从今天在左,过去日期向右)
  // 模式 2: 没有 availableDates 时,使用 recentDays 显示最近 N 天

  // 始终维护一个 days 数组:从今天(最左/最新)到最远端(最右/最旧)
  // 我们记录 newDaysCount = 当前向过去延伸了多少天
  const [extraDays, setExtraDays] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // 合并数据源:如果有 availableDates(从新到旧),用 union;否则用 recentDays
  const days = useMemo(() => {
    if (availableDates && availableDates.length > 0) {
      // availableDates 已经是 从新到旧 排序
      // 我们需要确认它包含今天到 extraDays 之前的全部日期
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // 找到数据中最旧的日期
      const oldestInData = availableDates[availableDates.length - 1];
      const oldestDate = new Date(oldestInData + 'T00:00:00');

      // 生成从今天向过去延伸的日期,直到覆盖 availableDates 中最旧的一天
      const result: string[] = [];
      const dataOldestTime = oldestDate.getTime();
      // 先放 availableDates 中有的日期(从新到旧)
      for (const d of availableDates) {
        if (!result.includes(d)) result.push(d);
      }
      // 然后补充空缺的日期(从今天向前,直到 dataOldest)
      // 注意:我们按从新到旧生成
      let i = 0;
      while (true) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const ds = toLocalDateStr(d);
        if (!result.includes(ds)) result.push(ds);
        if (d.getTime() <= dataOldestTime) break;
        i++;
        if (i > 365 * 5) break; // 防止无限循环
      }

      // 现在 result 是从新到旧
      return result;
    }
    // 默认模式:从今天向过去 recentDays 天
    const result: string[] = [];
    const today = new Date();
    for (let i = 0; i < recentDays + extraDays; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      result.push(toLocalDateStr(d));
    }
    return result;
  }, [availableDates, recentDays, extraDays]);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    return undefined;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [checkScroll, days]);

  const scrollSelectedIntoView = useCallback(() => {
    if (!scrollRef.current) return undefined;
    const container = scrollRef.current;
    if (showAllMode) {
      // "全部" 模式:滚到最左(显示今天)
      container.scrollTo({ left: 0 });
      return undefined;
    }
    const selectedBtn = container.querySelector(`[data-date="${selectedDate}"]`) as HTMLElement | null;
    if (!selectedBtn) return undefined;
    selectedBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    return undefined;
  }, [selectedDate, showAllMode]);

  useEffect(() => {
    scrollSelectedIntoView();
  }, [selectedDate, showAllMode, days, scrollSelectedIntoView]);

  // 滚动监听:当用户已经看到 days 中的最后一个(最右/最旧)时,
  // 自动扩展更早的日期(类似无限滚动)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    // 如果有 availableDates,数据是固定的,不需要无限滚动
    if (availableDates && availableDates.length > 0) return undefined;

    const handleScroll = () => {
      checkScroll();
      if (loadingRef.current) return;
      // days 数组:从新到旧,索引 0 是今天(最左),最后一个是最旧(最右)
      // 当滚到最右时(scrollLeft + clientWidth ≈ scrollWidth)
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) {
        loadingRef.current = true;
        setExtraDays(prev => prev + 30);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            loadingRef.current = false;
          });
        });
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [checkScroll, availableDates]);

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
  // days[days.length - 1] 是最旧的日期
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
              className={`px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition-all shrink-0 flex items-center gap-1 border ${
                showAllMode
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400 font-medium'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
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
              className={`px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition-all shrink-0 border ${
                !showAllMode && selectedDate === day
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400 font-medium'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
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
          className="px-2 py-1 rounded-lg text-[10px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/20 transition-colors shrink-0"
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
