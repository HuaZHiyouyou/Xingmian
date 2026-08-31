/**
 * ============================================================
 * AI 一日生活面板（AI 自主驱动版）
 *  - 无手动操作按钮：进入面板/开启引擎后 AI 自动安排这一天；
 *    情绪转变与计划调整由 AI 在心跳中自主触发（lifeEngine → randomEvents）
 *  - 日记卡片：AI 撰写的当日日记，可直接请 AI 补写
 *  - 日历：真实月视图网格（固定像素宽度，修复被压缩成一竖列的问题）
 *  - 背景/卡片与全局主题系统一致：
 *    页面底色 bg-gray-50/dark:gray-950，卡片用 <section>，
 *    主题层的圆角/玻璃/发光装饰可自动作用
 * ============================================================
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, Trash2, Sparkles, Calendar,
  ChevronLeft, ChevronRight, Loader2,
  Clock, MapPin, Trash, ChevronDown, Settings2, Info,
  BookOpen, PenLine, IdCard,
} from 'lucide-react';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { useCharacterStore } from '../../store/characterStore';
import { AiLifeAttributesPanel, WorldConfigSection, TimeAllocationPanel } from './AiLifeStatusPanels';
import { AiLifeLivingPanel } from './AiLifeLivingPanel';
import { CharacterProfileCardModal } from '../character/CharacterProfileCard';
import {
  SetupGuideBanner, AiInfoModal, LlmSettingsModal, DeleteScopeModal, InitialCreateModal, type DeleteScope,
} from './AiLifeModals';
import { dbGetAiActivitiesAvailableDates } from '../../lib/tauriBridge';
import { localDateKey } from '../../services/ailife/scheduleTemplates';

const HAND_FONT = "'LXGW WenKai', 'Kaiti SC', 'KaiTi', cursive";

function getTimePeriodColor(hour: number) {
  if (hour >= 5 && hour < 8) return { bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-400' };
  if (hour >= 8 && hour < 12) return { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-400' };
  if (hour >= 12 && hour < 14) return { bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-400' };
  if (hour >= 14 && hour < 18) return { bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-400' };
  if (hour >= 18 && hour < 21) return { bg: 'bg-slate-100 dark:bg-slate-800/20', border: 'border-slate-300 dark:border-slate-900', text: 'text-slate-800 dark:text-slate-400', dot: 'bg-slate-500' };
  if (hour >= 21 || hour < 1) return { bg: 'bg-indigo-50 dark:bg-indigo-900/20', border: 'border-indigo-200 dark:border-indigo-800', text: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-400' };
  return { bg: 'bg-slate-50 dark:bg-slate-900/20', border: 'border-slate-200 dark:border-slate-800', text: 'text-slate-700 dark:text-slate-300', dot: 'bg-slate-400' };
}

/** 真实月视图日历弹层（固定像素宽度，杜绝 shrink-to-fit 压成一竖列） */
function MonthCalendar({ selectedDate, onSelect, markedDates }: {
  selectedDate: string;
  onSelect: (ds: string) => void;
  markedDates: Set<string>;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-based

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const todayKey = localDateKey(new Date());

  const shiftMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
      className="absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-xl p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
      style={{ width: 296 }}
    >
      {/* 月份导航 */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        </button>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 tabular-nums">
          {viewYear} 年 {viewMonth + 1} 月
        </span>
        <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </button>
      </div>
      {/* 星期表头 */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
          <div key={d} className="text-center text-[10px] text-gray-400 py-1">{d}</div>
        ))}
      </div>
      {/* 日期网格：w-full 自适应单元格，永不塌缩 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />;
          const ds = `${viewYear}-${(viewMonth + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          const isSelected = ds === selectedDate;
          const isToday = ds === todayKey;
          const hasRecord = markedDates.has(ds);
          return (
            <button
              key={ds}
              onClick={() => onSelect(ds)}
              className={`relative w-full aspect-square rounded-lg text-xs font-medium flex items-center justify-center transition-colors ${
                isSelected
                  ? 'bg-slate-700 text-white'
                  : isToday
                    ? 'bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-400'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {day}
              {hasRecord && !isSelected && (
                <span className="absolute bottom-1 w-1 h-1 rounded-full bg-slate-500" />
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

export default function AiLifePanel() {
  const {
    currentDiary, currentDate, isLoading, isGenerating, isShifting, isWritingDiary,
    generatePlan, writeDiary, deleteDay, addComment, deleteComment,
    config, updateConfig, loadDate, refreshFromDb,
  } = useAiLifeStore();
  const diaryRecord = useAiLifeStore((s) => s.diaryRecords[s.currentDate]);
  const selectedCharacterId = useCharacterStore((s) => s.selectedCharacterId);
  const configCharId = useAiLifeStore((s) => s.config?.characterId);
  // 🆕 修复：全局未选角色时回退到生活引擎绑定的角色——否则"状态与生活"整页空白
  const characterId = selectedCharacterId || configCharId || null;
  const character = useCharacterStore((s) => s.characters.find((c) => c.id === (characterId || '')) || null);

  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [showCalendar, setShowCalendar] = useState(false);
  // 🆕 右侧面板 Tab
  const [activeTab, setActiveTab] = useState<'timeline' | 'life'>('timeline');
  const [markedDates, setMarkedDates] = useState<Set<string>>(new Set());
  const calendarRef = useRef<HTMLDivElement>(null);
  /** 自动生成守卫：同一 角色+日期 只自动尝试一次（删除后重置可再次触发） */
  const autoTriedRef = useRef<string>('');
  // 🆕 模态框
  const [showLlmSettings, setShowLlmSettings] = useState(false);
  const [showAiInfo, setShowAiInfo] = useState(false);
  const [showDeleteScope, setShowDeleteScope] = useState(false);
  const [showInitCreate, setShowInitCreate] = useState(false);
  const [showProfileCard, setShowProfileCard] = useState(false);
  /** 首次数据装载中：避免挂载首帧闪现空状态 */
  const [booting, setBooting] = useState(true);
  /** 🆕 已完成装载的「角色:日期」键：自动生成必须等当前视图数据真正就绪后再判断 */
  const [loadedKey, setLoadedKey] = useState('');

  // 🆕 挂载/切换角色：加载配置 + 有记录的日期（日历标记）；日期数据由下方 effect 统一装载
  useEffect(() => {
    if (!characterId) { setBooting(false); setLoadedKey(''); return; }
    setBooting(true);
    setLoadedKey('');
    refreshFromDb(characterId);
    // 🆕 性能：只用去重日期列表标注日历，不再全量拉活动
    dbGetAiActivitiesAvailableDates(characterId).then((keys) => {
      setMarkedDates(new Set(keys));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId]);

  // 🆕 切换日期/角色：加载该日数据，完成后记录 loadedKey（自动生成的门闸）
  useEffect(() => {
    if (!characterId) return undefined;
    let active = true;
    loadDate(characterId, selectedDate).then(() => {
      if (active) setLoadedKey(`${characterId}:${selectedDate}`);
    }).finally(() => {
      if (active) setBooting(false);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, characterId]);

  useEffect(() => {
    useAiLifeStore.setState({ currentDate: selectedDate, currentDiary: useAiLifeStore.getState().diaries[selectedDate] || null });
  }, [selectedDate]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) setShowCalendar(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const slots = currentDiary?.activities || [];

  /** AI 生成今日计划（保留已发生历史）；同时刷新日历标记 */
  const handleGeneratePlan = useCallback(async () => {
    autoTriedRef.current = `${characterId || ''}:${selectedDate}`;
    await generatePlan(selectedDate, characterId || undefined);
    if (characterId) {
      dbGetAiActivitiesAvailableDates(characterId).then((keys) => {
        setMarkedDates(new Set(keys));
      }).catch(() => {});
    }
  }, [generatePlan, selectedDate, characterId]);

  // 🆕 自动初始化：今天没有安排且引擎开启时，AI 自动生成（无需任何手动按钮）
  // 修复：必须等当前「角色+日期」数据真正装载完成（loadedKey 匹配），并用 store
  // 实时数据判断是否已有安排——否则切换页面回来时会误触发重排（闪现"AI 正在安排今天"）。
  useEffect(() => {
    if (booting) return;                       // 首次装载未完成前不触发
    if (!characterId || isLoading) return;
    if (loadedKey !== `${characterId}:${selectedDate}`) return;  // 当前视图数据未就绪
    const store = useAiLifeStore.getState();
    const todayKey = localDateKey(new Date());
    if (selectedDate !== todayKey) return;                    // 只自动排"今天"
    if (!store.config?.enabled) return;                       // 引擎未开启 → 展示引导空状态
    if (store.isGenerating) return;                           // 已在生成中，不重复触发
    // 用 store 实时数据判断（而非渲染快照）：已有安排绝不自动重排
    const existing = (store.dayActivities[selectedDate] || []).filter((a) => a.status !== 'cancelled');
    if (existing.length > 0) return;
    const key = `${characterId}:${selectedDate}`;
    if (autoTriedRef.current === key) return;                 // 防重复触发
    autoTriedRef.current = key;
    handleGeneratePlan();
  }, [characterId, selectedDate, isLoading, booting, loadedKey, handleGeneratePlan]);

  /** 删除这一天（三选一模态框确认后执行）。
   * 写入自动生成守卫：用户主动删除后，面板不应自动重排覆盖其操作。 */
  const handleDeleteScope = useCallback((scope: DeleteScope) => {
    autoTriedRef.current = `${characterId || ''}:${selectedDate}`;
    deleteDay(selectedDate, scope);
  }, [deleteDay, selectedDate, characterId]);

  /** 请 AI 写这一天的日记 */
  const handleWriteDiary = useCallback(() => {
    writeDiary(selectedDate, characterId || undefined);
  }, [writeDiary, selectedDate, characterId]);

  const handleAddComment = useCallback((slotId: string) => {
    if (!commentInput.trim()) return;
    addComment(slotId, {
      id: `c_${Date.now()}`,
      content: commentInput,
      timestamp: new Date().toISOString(),
      type: 'user',
    });
    setCommentInput('');
    setCommentTarget(null);
  }, [commentInput, addComment]);

  const navigateDate = (offset: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + offset);
    setSelectedDate(`${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`);
  };

  const todayKey = useMemo(() => localDateKey(new Date()), []);
  const hasAnyContent = slots.length > 0 || !!diaryRecord?.content;

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* 顶部 */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => navigateDate(-1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </motion.button>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">AI的一日生活</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums flex items-center justify-center gap-1.5">
              {selectedDate}{selectedDate === todayKey ? ' · 今天' : ''}
              {isGenerating && (
                <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-500">
                  <Loader2 size={10} className="animate-spin" />AI 正在安排今天…
                </span>
              )}
              {!isGenerating && isShifting && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <Sparkles size={10} className="animate-pulse" />AI 心情正在变化…
                </span>
              )}
            </p>
          </div>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => navigateDate(1)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </motion.button>
        </div>
        <div className="flex items-center gap-3">
          {/* 🆕 角色名片：快速了解 AI 的基本信息 */}
          {character && (
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setShowProfileCard(true)}
              title="查看角色名片（名片 / 简历 / 证书）"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:border-slate-500 transition-colors shadow-sm">
              <IdCard size={13} className="text-slate-700 dark:text-slate-300" />
              角色名片
            </motion.button>
          )}
          {/* LLM 生成总控入口 */}
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setShowLlmSettings(true)}
            title="生成设置：每个 AI 调用可独立开关与调节详细度"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:border-slate-500 transition-colors shadow-sm">
            <Settings2 size={13} className="text-slate-700 dark:text-slate-300" />
            生成设置
          </motion.button>
          {/* 生活引擎开关：开启后按日程自动活动并在聊天顶部显示状态 */}
          {config && (
            <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm">
              <span className="text-xs text-gray-600 dark:text-gray-300">生活引擎</span>
              <input
                type="checkbox"
                checked={!!config.enabled}
                onChange={(e) => updateConfig({ enabled: e.target.checked })}
                className="w-4 h-4 accent-slate-700"
              />
            </label>
          )}
          <div className="relative" ref={calendarRef}>
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setShowCalendar(!showCalendar)} className={`p-2.5 rounded-xl transition-colors ${showCalendar ? 'bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
              <Calendar className="w-4 h-4" />
            </motion.button>
            <AnimatePresence>
              {showCalendar && (
                <MonthCalendar
                  selectedDate={selectedDate}
                  markedDates={markedDates}
                  onSelect={(ds) => { setSelectedDate(ds); setShowCalendar(false); }}
                />
              )}
            </AnimatePresence>
          </div>
          {/* 删除这一天：三选一（仅活动 / 仅日记 / 全部） */}
          {hasAnyContent && (
            <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setShowDeleteScope(true)} title="删除这一天的记录"
              className="p-2.5 rounded-xl text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash className="w-4 h-4" />
            </motion.button>
          )}
        </div>
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* 🆕 初始设定引导：常驻两 Tab 顶部，完成即消失 */}
        <SetupGuideBanner
          characterReady={!!characterId}
          onGoLifeTab={() => setActiveTab('life')}
          onGenerate={() => handleGeneratePlan()}
          onOpenInit={() => setShowInitCreate(true)}
        />

        {/* Tab 切换：时间线 / 状态与生活 */}
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => setActiveTab('timeline')}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${activeTab === 'timeline' ? 'bg-slate-700 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700'}`}>
            时间线
          </button>
          <button onClick={() => setActiveTab('life')}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${activeTab === 'life' ? 'bg-slate-700 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700'}`}>
            状态与生活
          </button>
        </div>

        {activeTab === 'life' ? (
          <div className="grid lg:grid-cols-2 gap-4 items-start max-w-5xl mx-auto">
            <div className="space-y-4">
              <AiLifeAttributesPanel characterId={characterId || undefined} />
              <TimeAllocationPanel characterId={characterId || undefined} date={selectedDate} />
              <WorldConfigSection />
            </div>
            <AiLifeLivingPanel characterId={characterId || undefined} />
          </div>
        ) : (isLoading || booting) ? (
          <div className="flex flex-col items-center justify-center h-full">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}><Loader2 className="w-10 h-10 text-slate-700 dark:text-slate-300" /></motion.div>
            <p className="text-gray-500 dark:text-gray-400 mt-4">加载中...</p>
          </div>
        ) : !hasAnyContent ? (
          /* 初始面板：说明 AI 自主安排的运作方式；引擎开启时会自动开始生成 */
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center h-full text-center">
            {isGenerating ? (
              /* 生成中的专属加载动画 */
              <>
                <div className="relative mb-6">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}>
                    <Loader2 className="w-14 h-14 text-slate-500" />
                  </motion.div>
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center"
                    animate={{ scale: [1, 1.25, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Sparkles className="w-6 h-6 text-slate-700 dark:text-slate-300" />
                  </motion.div>
                </div>
                <motion.h2 key={0} className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2"
                  animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.8, repeat: Infinity }}>
                  AI 正在构思今天的生活…
                </motion.h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 max-w-md leading-relaxed">
                  正在结合角色人设、职业作息与世界设定安排这一天
                </p>
              </>
            ) : (
              <>
                <Sparkles className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-6" />
                <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">AI 的一天还未开始</h2>
                {config?.enabled ? (
                  <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md leading-relaxed">
                    生活引擎已开启，AI 会自动为角色安排今天的生活——
                    包括日程、过程中的心情变化与临时的计划调整，都会由 AI 自主决定。
                  </p>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md leading-relaxed">
                    开启右上角的「生活引擎」后，AI 会自动为角色安排一天的生活：
                    日程生成、情绪转变、计划调整全部交由 AI 处理。
                  </p>
                )}
                <div className="flex items-center gap-4">
                  <button onClick={() => setShowInitCreate(true)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-500 hover:underline">
                    <Sparkles size={12} />AI 初始创建
                  </button>
                  <button onClick={handleGeneratePlan}
                    className="text-xs text-slate-700 dark:text-slate-500 hover:underline">
                    立即让 AI 安排这一天
                  </button>
                  <button onClick={() => setShowAiInfo(true)}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-slate-500 hover:underline">
                    <Info size={12} />查看 AI 的设定
                  </button>
                </div>
              </>
            )}
          </motion.div>
        ) : (
          <div className="relative max-w-3xl mx-auto space-y-4">
            {/* 🆕 日记卡片：AI 撰写，缺失时可请求补写 */}
            <section className="rounded-2xl bg-amber-50/70 dark:bg-amber-900/10 border border-amber-200/60 dark:border-amber-800/40 p-4 shadow-sm"
              style={{ backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, rgba(148,163,184,0.08) 27px, rgba(148,163,184,0.08) 28px)' }}>
              <div className="flex items-center gap-2 mb-2">
                <BookOpen size={14} className="text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-bold text-amber-700 dark:text-amber-300" style={{ fontFamily: HAND_FONT }}>
                  {diaryRecord?.title || 'AI 的日记'}
                </span>
                {diaryRecord?.mood && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">{diaryRecord.mood}</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {diaryRecord && <span className="text-[10px] text-gray-400 tabular-nums">{diaryRecord.date}</span>}
                  {!diaryRecord && (
                    <button onClick={handleWriteDiary} disabled={isWritingDiary}
                      className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors disabled:opacity-50">
                      {isWritingDiary
                        ? <><Loader2 size={11} className="animate-spin" />AI 书写中...</>
                        : <><PenLine size={11} />请 AI 写日记</>}
                    </button>
                  )}
                </div>
              </div>
              {diaryRecord?.content ? (
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-loose whitespace-pre-wrap" style={{ fontFamily: HAND_FONT }}>
                  {diaryRecord.content}
                </p>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                  {isWritingDiary ? 'AI 正在回顾这一天，写下日记…' : '这一天还没有日记。一天结束时 AI 会自动撰写；也可以点击右上角让 AI 现在就写。'}
                </p>
              )}
            </section>

            {/* 时间线轴 */}
            <section className="relative rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 shadow-sm overflow-hidden"
              style={{ backgroundImage: 'repeating-linear-gradient(transparent, transparent 31px, rgba(148,163,184,0.07) 31px, rgba(148,163,184,0.07) 32px)' }}>
              <div className="space-y-3">
                {slots.length === 0 && (
                  <p className="pl-10 text-sm text-gray-400 dark:text-gray-500 py-6 text-center">这一天还没有活动安排</p>
                )}
                {slots.map((slot, index) => {
                  const hour = parseInt(slot.startTime.split(':')[0]);
                  const pc = getTimePeriodColor(hour);
                  const expanded = expandedSlot === slot.id;
                  return (
                    <motion.div key={slot.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index * 0.05, 0.5) }} className="relative pl-10">
                      <div className={`absolute left-2.5 top-4 w-3 h-3 rounded-full ${pc.dot} border-2 border-white dark:border-gray-900 z-10`} />
                      <motion.div whileHover={{ scale: 1.005, y: -1 }} onClick={() => setExpandedSlot(expanded ? null : slot.id)}
                        className={`rounded-2xl p-4 cursor-pointer transition-shadow ${slot.isChanged ? 'bg-gray-50 dark:bg-gray-800/60 border border-dashed border-gray-300 dark:border-gray-600' : `${pc.bg} border ${pc.border}`} hover:shadow-md`}>
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-mono text-gray-500 dark:text-gray-400 tabular-nums">{slot.startTime} - {slot.endTime}</span>
                              {slot.isChanged && <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">计划变更</span>}
                            </div>
                            {slot.isChanged && slot.originalActivityName ? (
                              <div className="flex flex-col">
                                <span className="text-sm font-medium text-gray-400 dark:text-gray-500 line-through">{slot.originalActivityName}</span>
                                <span className={`text-sm font-semibold ${pc.text}`}>{slot.activityName}</span>
                              </div>
                            ) : (
                              <h3 className={`text-sm font-semibold ${pc.text}`}>{slot.activityName}</h3>
                            )}
                            <div className="flex items-center gap-3 mt-1.5">
                              {slot.mood && <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"><Clock size={11} />{slot.mood}</span>}
                              {slot.location && <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1"><MapPin size={11} />{slot.location}</span>}
                            </div>
                          </div>
                          <motion.div animate={{ rotate: expanded ? 180 : 0 }} className="text-gray-400"><ChevronDown size={16} /></motion.div>
                        </div>

                        <AnimatePresence>
                          {expanded && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                              <div className="mt-3 pt-3">
                                {slot.description && (
                                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{slot.description}</p>
                                )}
                                {slot.isChanged && slot.changeReason && (
                                  <div className="mt-2 p-2 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                                    <p className="text-xs text-yellow-700 dark:text-yellow-300">变更原因：{slot.changeReason}</p>
                                  </div>
                                )}
                                <div className="mt-3 space-y-2">
                                  {slot.comments.map(c => (
                                    <div key={c.id} className="flex items-start gap-2 group">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium ${c.type === 'ai' ? 'bg-slate-200 dark:bg-slate-800/30 text-slate-700' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600'}`}>
                                        {c.type === 'ai' ? 'AI' : 'U'}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm text-gray-700 dark:text-gray-300">{c.content}</p>
                                        <p className="text-xs text-gray-400 mt-0.5">{formatTimeShort(c.timestamp)}</p>
                                      </div>
                                      <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={(e) => { e.stopPropagation(); deleteComment(slot.id, c.id); }}
                                        className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500">
                                        <Trash2 size={12} />
                                      </motion.button>
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                  <input type="text" value={commentTarget === slot.id ? commentInput : ''} onChange={e => { setCommentTarget(slot.id); setCommentInput(e.target.value); }}
                                    onKeyDown={e => { if (e.key === 'Enter' && commentTarget === slot.id) handleAddComment(slot.id); }}
                                    onClick={e => e.stopPropagation()} placeholder="写个评论..."
                                    className="flex-1 text-sm px-3 py-1.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-700/30" />
                                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={e => { e.stopPropagation(); if (commentTarget === slot.id) handleAddComment(slot.id); }}
                                    className="p-1.5 rounded-full bg-slate-700 text-white hover:bg-slate-700 transition-colors disabled:opacity-50" disabled={!commentInput.trim() || commentTarget !== slot.id}>
                                    <Send size={14} />
                                  </motion.button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>

      {/* 模态框：生成总控 / AI 设定 / 删除三选一 / 初始创建 / 角色名片 */}
      <AnimatePresence>
        {showLlmSettings && <LlmSettingsModal onClose={() => setShowLlmSettings(false)} />}
        {showAiInfo && <AiInfoModal onClose={() => setShowAiInfo(false)} />}
        {showDeleteScope && (
          <DeleteScopeModal date={selectedDate} onConfirm={handleDeleteScope} onClose={() => setShowDeleteScope(false)} />
        )}
        {showInitCreate && characterId && (
          <InitialCreateModal
            characterId={characterId}
            onClose={() => setShowInitCreate(false)}
            onDone={() => handleGeneratePlan()}
          />
        )}
        {showProfileCard && character && (
          <CharacterProfileCardModal character={character} onClose={() => setShowProfileCard(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function formatTimeShort(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
