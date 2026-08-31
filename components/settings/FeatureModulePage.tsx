/**
 * ============================================================
 * 功能模块页面
 * 数据修改（情绪/好感度/记忆权重等可调参数）
 * 定时任务（自主设定）· 模块注册表 · 系统配置（自设置页迁移）
 * Agent 能力工具管理
 * ============================================================
 */
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Cpu, Clock, Trash2, RotateCcw, Palette,
  Heart, Brain, Plus, Zap,
  Shield, Timer, Send, Puzzle, Sparkles, TrendingUp,
  FileText, UserCheck, RefreshCw, MessageSquare, Bot,
  ChevronDown, HelpCircle, Terminal, Settings, Map, CalendarClock,
  BookOpen, Music,
} from 'lucide-react';
import { PromptHotReloadPanel } from './PromptHotReloadPanel';
import { AiLifeDataEditorSection } from './AiLifeDataEditor';
import {
  ModulePageShell, ModuleSection, ModuleEmptyState, ConfirmModal,
} from './ModulePageShell';
import { useFeatureModuleStore, ScheduledTask, ScheduledTaskType, describeSchedule } from '../../store/featureModuleStore';
import { useAgentStore } from '../../store/agentStore';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { useIntegrationStore } from '../../store/integrationStore';
import { useModuleRegistry } from '../../services/modules/registry';
import { initializeAgentTools } from '../../agent/toolRegistry';
import type { EmotionType } from '../../types';
// 🔧 自设置页迁移至此的配置区块（组件定义保留在 SettingsPage.tsx）
import { MemoryAnalysisConfigSection, LearningConfigSection, ModelRoleConfigSection, ProactiveReplySection, CollapsibleSection } from '../common/SettingsPage';
import V2SettingsPanel from './V2SettingsPanel';
import { FeatureModulesCard } from './FeatureModulesCard';

/* ─────────── 常量 ─────────── */

const TASK_TYPE_OPTIONS: { value: ScheduledTaskType; label: string; icon: any; color: string }[] = [
  { value: 'custom_prompt', label: '自定义提示', icon: Sparkles, color: 'text-slate-700 dark:text-slate-300' },
  { value: 'send_message', label: '发送消息', icon: Send, color: 'text-blue-500' },
  { value: 'run_skill', label: '执行技能', icon: Zap, color: 'text-amber-500' },
  { value: 'run_plugin', label: '执行插件', icon: Puzzle, color: 'text-slate-700 dark:text-slate-300' },
  { value: 'memory_cleanup', label: '清理记忆', icon: Brain, color: 'text-cyan-500' },
  { value: 'emotion_boost', label: '情绪增益', icon: Heart, color: 'text-slate-700 dark:text-slate-300' },
];

/** 🔧 任务类型 → payload 输入提示 */
const PAYLOAD_HINTS: Record<ScheduledTaskType, string> = {
  custom_prompt: '提示内容，如：提醒她喝水、活动一下…',
  send_message: '要主动发送的消息内容…',
  run_skill: '技能 ID 及参数（留空则由 AI 自定）',
  run_plugin: '插件 ID 及参数（留空则由 AI 自定）',
  memory_cleanup: '无需填写',
  emotion_boost: '维度和幅度，如 joy+10、calm-5',
};

/** 🔧 调度模式（重构后不再手写 cron） */
type SchedMode = 'daily' | 'hourly' | 'interval' | 'monthly' | 'date' | 'custom';

const SCHED_MODES: Record<SchedMode, { label: string }> = {
  daily: { label: '每天' },
  hourly: { label: '每小时' },
  interval: { label: '每N分钟' },
  monthly: { label: '每月' },
  date: { label: '指定日期' },
  custom: { label: '高级 cron' },
};

/** 由调度模式与输入值生成简化 cron："分 时 天 [月]" */
function buildCron(
  mode: SchedMode,
  v: { time?: string; minute?: string; intervalMin?: string; day?: string; date?: string; custom?: string },
): string {
  const pad = (n: number) => String(Math.max(0, Math.min(59, n))).replace(/^(\d)$/, '0$1');
  switch (mode) {
    case 'daily': {
      const [h, m] = (v.time || '09:00').split(':');
      return `${pad(Number(m))} ${pad(Number(h))} *`;
    }
    case 'hourly':
      return `${pad(Number(v.minute ?? 0))} * *`;
    case 'interval': {
      const n = Math.max(2, Number(v.intervalMin) || 15);
      return `*/${n} * *`;
    }
    case 'monthly': {
      const [h, m] = (v.time || '09:00').split(':');
      const day = Math.max(1, Math.min(28, Number(v.day) || 1));
      return `${pad(Number(m))} ${pad(Number(h))} ${day}`;
    }
    case 'date': {
      // 指定日期（每年该日触发）："分 时 天 月"
      const date = v.date && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? new Date(`${v.date}T00:00:00`) : new Date();
      const [h, m] = (v.time || '09:00').split(':');
      return `${pad(Number(m))} ${pad(Number(h))} ${date.getDate()} ${date.getMonth() + 1}`;
    }
    case 'custom':
    default:
      return v.custom?.trim() || '* * *';
  }
}

const EMOTION_DIMENSIONS: { key: EmotionType; label: string; color: string }[] = [
  { key: 'joy', label: '快乐', color: 'text-amber-500' },
  { key: 'trust', label: '信任', color: 'text-slate-700 dark:text-slate-300' },
  { key: 'fear', label: '恐惧', color: 'text-gray-500' },
  { key: 'surprise', label: '惊讶', color: 'text-blue-500' },
  { key: 'sadness', label: '悲伤', color: 'text-indigo-500' },
  { key: 'disgust', label: '厌恶', color: 'text-red-500' },
  { key: 'anger', label: '愤怒', color: 'text-orange-500' },
  { key: 'anticipation', label: '期待', color: 'text-slate-700 dark:text-slate-300' },
  { key: 'curiosity', label: '兴趣', color: 'text-cyan-500' },
  { key: 'empathy', label: '宁静', color: 'text-slate-700 dark:text-slate-300' },
  { key: 'gratitude', label: '钦佩', color: 'text-slate-700 dark:text-slate-300' },
  { key: 'pride', label: '惊叹', color: 'text-pink-500' },
];

/* ─────────── 工具函数 ─────────── */

/* 🔧 schedule 由 buildCron 生成；原 parseScheduleInput 已废弃删除 */

/* ─────────── 滑块组件 ─────────── */

function SliderField({
  label, icon: Icon, iconColor, value, min = 0, max = 100, step = 1, onChange, displayFn,
}: {
  label: string; icon: any; iconColor: string;
  value: number; min?: number; max?: number; step?: number;
  onChange: (v: number) => void; displayFn?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className={iconColor} />
          <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
        </div>
        <span className="text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 px-2 py-0.5 rounded-lg">
          {displayFn ? displayFn(value) : value}
        </span>
      </div>
      <div className="relative h-6 flex items-center group">
        <div className="absolute w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full" />
        <div
          className="absolute h-1.5 bg-gradient-to-r from-slate-500 to-slate-700 rounded-full transition-all duration-150"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(+e.target.value)}
          className="relative w-full h-6 appearance-none bg-transparent cursor-pointer z-10
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2
            [&::-webkit-slider-thumb]:border-slate-500 [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150
            [&::-webkit-slider-thumb]:group-hover:scale-125"
        />
      </div>
    </div>
  );
}

/* ─────────── 定时任务项 ─────────── */

/** 🔧 圆角下拉选择器（与其他板块行式布局配套，替代原生 select） */
function MiniDropdown({ value, options, onChange }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({
        left: Math.max(8, Math.min(r.right - 132, window.innerWidth - 148)),
        top: Math.min(r.bottom + 4, window.innerHeight - 230),
      });
    }
    setOpen(!open);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={`w-32 h-[28px] pl-3 pr-7 rounded-full text-left text-[11px] bg-white dark:bg-gray-900 border transition-all truncate flex items-center
          ${open ? 'border-violet-400 ring-2 ring-violet-400/25' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}
      >
        <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{current?.label ?? value}</span>
        <ChevronDown size={10} className={`absolute right-2.5 text-gray-400 pointer-events-none transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* portal 到 body：规避 transform 祖先导致的 fixed 失效/裁剪 */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 py-1 min-w-[120px] max-h-52 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800
            bg-white dark:bg-gray-900 shadow-lg shadow-black/5"
            style={{ left: pos.left, top: pos.top }}>
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`block w-full text-left px-3 py-1.5 text-[11px] transition-colors whitespace-nowrap
                  ${opt.value === value
                    ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 font-medium'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

/** 🔧 美化日期弹层（移植自 AI 一日的 MonthCalendar：网格日历 + 月份导航）
 *  用 fixed 定位挂到视口坐标，避免被折叠面板的 overflow-hidden 裁剪 */
function MiniDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const init = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(init.getFullYear());
  const [viewMonth, setViewMonth] = useState(init.getMonth()); // 0-based

  const now = new Date();
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 276)),
        top: Math.min(r.bottom + 6, window.innerHeight - 320),
      });
    }
    setOpen(!open);
  };

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
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
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={`h-[28px] px-3 rounded-full text-[11px] tabular-nums bg-white dark:bg-gray-900 border transition-all
          ${open ? 'border-violet-400 ring-2 ring-violet-400/25 text-violet-600 dark:text-violet-300'
                 : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 text-gray-700 dark:text-gray-300'}`}
      >
        {/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayKey}
      </button>
      {/* portal 到 body：规避 transform 祖先导致的 fixed 失效/裁剪 */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 w-[264px] p-3 rounded-xl border border-gray-100 dark:border-gray-800
            bg-white dark:bg-gray-900 shadow-xl shadow-black/10 animate-[fadeUp_0.15s_ease-out]"
            style={{ left: pos.left, top: pos.top }}>
            {/* 月份导航 */}
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => shiftMonth(-1)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <ChevronDown size={13} className="rotate-90 text-gray-500" />
              </button>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-200 tabular-nums">{viewYear} 年 {viewMonth + 1} 月</span>
              <button type="button" onClick={() => shiftMonth(1)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <ChevronDown size={13} className="-rotate-90 text-gray-500" />
              </button>
            </div>
            {/* 星期表头 */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
                <div key={d} className="text-center text-[10px] text-gray-400 py-0.5">{d}</div>
              ))}
            </div>
            {/* 日期网格 */}
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                if (day === null) return <div key={`blank-${i}`} />;
                const ds = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`;
                const isSelected = ds === value;
                const isToday = ds === todayKey;
                return (
                  <button
                    key={ds}
                    type="button"
                    onClick={() => { onChange(ds); setOpen(false); }}
                    className={`aspect-square rounded-full text-[11px] font-medium flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-slate-700 text-white'
                        : isToday
                          ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

/** 🔧 美化时间选择器（时/分双列滚动，fixed 定位防裁剪） */
function MiniTimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const [h, m] = /^\d{2}:\d{2}$/.test(value) ? value.split(':') : ['09', '00'];

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 200)),
        top: Math.min(r.bottom + 6, window.innerHeight - 220),
      });
    }
    setOpen(!open);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={`h-[28px] px-3 rounded-full text-[11px] tabular-nums bg-white dark:bg-gray-900 border transition-all inline-flex items-center gap-1.5
          ${open ? 'border-violet-400 ring-2 ring-violet-400/25 text-violet-600 dark:text-violet-300'
                 : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 text-gray-700 dark:text-gray-300'}`}
      >
        <Clock size={10} className="text-gray-400" />
        {value}
      </button>
      {/* portal 到 body：规避 transform 祖先导致的 fixed 失效/裁剪 */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 flex rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden
            bg-white dark:bg-gray-900 shadow-xl shadow-black/10 animate-[fadeUp_0.15s_ease-out]"
            style={{ left: pos.left, top: pos.top }}>
            {/* 小时列 */}
            <div className="w-16 h-44 overflow-y-auto py-1 border-r border-gray-50 dark:border-gray-800
              [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((hh) => (
                <button
                  key={hh}
                  type="button"
                  onClick={() => onChange(`${hh}:${m}`)}
                  className={`block w-full text-center py-1 text-[11px] tabular-nums transition-colors ${
                    hh === h ? 'bg-slate-700 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {hh}
                </button>
              ))}
            </div>
            {/* 分钟列 */}
            <div className="w-16 h-44 overflow-y-auto py-1
              [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map((mm) => (
                <button
                  key={mm}
                  type="button"
                  onClick={() => onChange(`${h}:${mm}`)}
                  className={`block w-full text-center py-1 text-[11px] tabular-nums transition-colors ${
                    mm === m ? 'bg-slate-700 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {mm}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

function TaskItem({ task, onToggle, onDeleteRequest }: {
  task: ScheduledTask;
  onToggle: () => void;
  onDeleteRequest: (t: ScheduledTask) => void;
}) {
  const typeInfo = TASK_TYPE_OPTIONS.find((t) => t.value === task.type);
  const TypeIcon = typeInfo?.icon || Clock;
  return (
    <div className="flex items-center gap-3 p-2.5 bg-gray-50/50 dark:bg-gray-800/30 rounded-xl animate-[scaleIn_0.2s_ease-out] group">
      <TypeIcon size={12} className={typeInfo?.color || 'text-gray-400'} />
      <div className="flex-1 min-w-0">
        <span className="text-xs text-gray-700 dark:text-gray-300 truncate block">{task.name}</span>
        <span className="text-[10px] text-gray-400" title={task.schedule}>{describeSchedule(task.schedule)}</span>
      </div>
      <span className="text-[10px] text-gray-400 bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded-full border border-gray-100 dark:border-gray-700">
        {typeInfo?.label || task.type}
      </span>
      <button
        onClick={onToggle}
        className={`p-1 rounded-lg transition-all duration-200 active:scale-90 ${
          task.enabled
            ? 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/20'
            : 'text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
      >
        <Shield size={10} />
      </button>
      <button
        onClick={() => onDeleteRequest(task)}
        className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
          opacity-0 group-hover:opacity-100 transition-all duration-200 active:scale-90"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

/**
 * 🆕 AI 一日生活启停开关（注册表 ai-life 模块）
 * 放在「AI 一日数据」区块顶部；关闭后日志/事件/经济全部暂停。
 */
export function AiLifeEnableToggle() {
  const enabled = !!useAiLifeStore((s) => s.config?.enabled);
  const flip = () => {
    const st = useAiLifeStore.getState();
    if (st.config) void st.updateConfig({ enabled: !enabled });
    setTimeout(() => useModuleRegistry.getState().syncAll(), 0);
  };
  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-gray-50/50 dark:bg-gray-800/30 rounded-xl mb-3">
      <div className="min-w-0">
        <p className="text-xs text-gray-700 dark:text-gray-300">AI 一日生活</p>
        <p className="text-[10px] text-gray-400">总开关：日程引擎 / 属性衰减 / 随机事件 / 经济运转（活动日志见日志页「AI一日」筛选）</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={flip}
        className={`relative inline-flex w-10 h-5 shrink-0 rounded-full transition-colors duration-200 outline-none
          focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1
          ${enabled ? 'bg-violet-500' : 'bg-gray-200 dark:bg-gray-700'}`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-md
            transition-transform duration-200 ease-out
            ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}

/* ─────────── Agent 开关 ─────────── */

function AgentToggleSwitch() {
  const { config, toggleAgent } = useAgentStore();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggleAgent(); }}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
        config.enabled
          ? 'bg-slate-700 shadow-sm shadow-slate-700/25'
          : 'bg-gray-300 dark:bg-gray-600'
      }`}
      title={config.enabled ? '关闭 Agent' : '开启 Agent'}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          config.enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/* ─────────── Agent 能力面板 ─────────── */

import type { ToolCategory, AgentTool } from '../../types/agent';

/** 分类元数据：标签、颜色、图标 */
const CATEGORY_META: Record<ToolCategory, { label: string; color: string; icon: any }> = {
  settings:   { label: '设置控制', color: 'text-amber-500',   icon: Settings },
  ui:         { label: 'UI 控制',  color: 'text-slate-700 dark:text-slate-300',  icon: Palette },
  navigation: { label: '导航控制', color: 'text-blue-500',    icon: Map },
  plugin:     { label: '插件管理', color: 'text-slate-700 dark:text-slate-300', icon: Puzzle },
  skill:      { label: '技能管理', color: 'text-slate-700 dark:text-slate-300', icon: Zap },
  character:  { label: '角色管理', color: 'text-pink-500',    icon: UserCheck },
  chat:       { label: '对话控制', color: 'text-cyan-500',    icon: MessageSquare },
  memory:     { label: '记忆系统', color: 'text-rose-500',    icon: Brain },
  file:       { label: '文件操作', color: 'text-orange-500',  icon: FileText },
  emotion:    { label: '情感系统', color: 'text-rose-400',    icon: Heart },
  learning:   { label: '学习系统', color: 'text-emerald-500', icon: BookOpen },
  music:      { label: '音乐播放', color: 'text-indigo-400',  icon: Music },
  ai:         { label: 'AI 核心', color: 'text-violet-500',   icon: Cpu },
  system:     { label: '系统操作', color: 'text-gray-500',    icon: Terminal },
};

/** 从 ToolCategory 自动推导工具的展示图标与颜色 */
function getToolDisplayMeta(tool: AgentTool) {
  const catMeta = CATEGORY_META[tool.category] || { label: tool.category, color: 'text-gray-400', icon: Zap };
  // 给个别工具自定义图标
  const iconMap: Record<string, any> = {
    get_current_time: Clock,
    set_theme: Palette,
    get_theme: Palette,
    navigate_to_settings: Settings,
    navigate_to_chat: MessageSquare,
    navigate_to_feature_module: Puzzle,
    get_character_list: UserCheck,
    get_plugin_list: Puzzle,
    get_skill_list: Zap,
    get_chat_history_stats: TrendingUp,
    get_mbti_result: Brain,
    run_mbti_test: Brain,
    get_mbti_stats: TrendingUp,
    get_scheduled_tasks: Timer,
    get_chat_stats: TrendingUp,
    execute_shell_command: Terminal,
    restart_app: RefreshCw,
    exit_app: Shield,
  };
  return {
    icon: iconMap[tool.id] || catMeta.icon,
    color: catMeta.color,
    categoryLabel: catMeta.label,
  };
}

function AgentCapabilitySection() {
  const agentStore = useAgentStore();
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    initializeAgentTools();
  }, []);

  // 从 store 动态获取所有已注册工具
  const allTools = agentStore.getAllTools();

  // 按 category 分组
  const groupedTools = allTools.reduce<Record<string, AgentTool[]>>((acc, tool) => {
    const cat = tool.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(tool);
    return acc;
  }, {});

  // 搜索过滤
  const filteredGroups: Record<string, AgentTool[]> = searchQuery.trim()
    ? Object.fromEntries(
        Object.entries(groupedTools).map(([cat, tools]) => [
          cat,
          tools.filter(
            (t) =>
              t.name.includes(searchQuery) ||
              t.description.includes(searchQuery) ||
              t.id.includes(searchQuery)
          ),
        ] as [string, AgentTool[]]).filter(([, tools]) => tools.length > 0)
      )
    : groupedTools;

  return (
    <div className="space-y-3">
      {/* 工具概览 */}
      <div className="flex items-center gap-2 p-2.5 bg-gradient-to-r from-slate-100/60 to-slate-100/60 dark:from-slate-800/20 dark:to-slate-800/20 rounded-xl border border-slate-300/50 dark:border-slate-900/30">
        <Bot size={14} className="text-slate-700 dark:text-slate-300" />
        <span className="text-xs text-gray-700 dark:text-gray-300">
          已注册 <span className="font-bold text-slate-700 dark:text-slate-300">{allTools.length}</span> 个工具
          <span className="text-gray-400 ml-1">({Object.keys(groupedTools).length} 个分类)</span>
        </span>
        <span className="ml-auto text-[10px] text-gray-400">
          {agentStore.isExecuting ? '处理中...' : '就绪'}
        </span>
      </div>

      {/* 搜索框 */}
      <div className="relative">
        <input
          type="text"
          placeholder="搜索工具..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-3 py-1.5 text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 dark:focus:ring-slate-700"
        />
      </div>

      {/* 分类工具列表 */}
      {Object.entries(filteredGroups).map(([catKey, tools]) => {
        const meta = CATEGORY_META[catKey as ToolCategory] || { label: catKey, color: 'text-gray-400', icon: Zap };
        return (
          <div key={catKey} className="bg-gray-50/50 dark:bg-gray-800/30 rounded-xl border border-gray-100 dark:border-gray-800">
            <button
              onClick={() => setExpandedCategory(expandedCategory === catKey ? null : catKey)}
              className="flex items-center gap-2 w-full p-2.5 text-left hover:bg-gray-100/50 dark:hover:bg-gray-700/30 transition-colors rounded-xl"
            >
              <meta.icon size={12} className={meta.color} />
              <span className={`text-[10px] font-medium uppercase tracking-wide ${meta.color}`}>
                {meta.label}
              </span>
              <span className="text-[10px] text-gray-400 bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded-full border border-gray-100 dark:border-gray-700">
                {tools.length}
              </span>
              <ChevronDown
                size={10}
                className={`ml-auto text-gray-400 transition-transform duration-200 ${expandedCategory === catKey ? 'rotate-180' : ''}`}
              />
            </button>
            {expandedCategory === catKey && (
              <div className="px-2.5 pb-2.5 space-y-1 animate-[scaleIn_0.15s_ease-out] max-h-64 overflow-y-auto">
                {tools.map((tool) => {
                  const display = getToolDisplayMeta(tool);
                  return (
                    <div
                      key={tool.id}
                      className="flex items-center gap-2.5 p-2 bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800"
                    >
                      <display.icon size={12} className={display.color} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{tool.name}</div>
                        <div className="text-[10px] text-gray-400 truncate">{tool.description}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className={`text-[9px] px-1 py-0.5 rounded ${
                          tool.permissionLevel === 'high' ? 'bg-red-50 text-red-500 dark:bg-red-900/20' :
                          tool.permissionLevel === 'medium' ? 'bg-amber-50 text-amber-500 dark:bg-amber-900/20' :
                          'bg-green-50 text-green-500 dark:bg-green-900/20'
                        }`}>
                          {tool.permissionLevel === 'high' ? '高风险' : tool.permissionLevel === 'medium' ? '需确认' : '安全'}
                        </span>
                        <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-400 dark:bg-gray-800">
                          {tool.executionSite === 'frontend' ? '前端' : '后端'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {allTools.length === 0 && (
        <div className="text-center py-6 text-xs text-gray-400">
          工具加载中...
        </div>
      )}

      {/* 使用帮助 */}
      <div className="p-2.5 bg-gray-50/60 dark:bg-gray-800/30 rounded-xl border border-gray-100 dark:border-gray-800 space-y-2">
        <div className="flex items-center gap-1.5">
          <HelpCircle size={11} className="text-gray-400" />
          <span className="text-[10px] text-gray-400 uppercase tracking-wide">使用帮助</span>
        </div>
        <div className="space-y-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          <p>1. 在聊天中输入 <span className="font-mono text-slate-700 dark:text-slate-300">/➕命令</span> 直接调用，如 <span className="font-mono text-slate-700 dark:text-slate-300">/➕切换暗色</span></p>
          <p>2. 用自然语言与 AI 交流，如「帮我切换到深色模式」</p>
          <p>3. 输入 <span className="font-mono text-slate-700 dark:text-slate-300">/➕帮助</span> 查看所有可用命令</p>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Bot 接入行为（A1/A4） ─────────── */

/** 行式开关（与数据覆盖容器内样式一致） */
function BehaviorToggle({ label, desc, checked, onChange }: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between cursor-pointer select-none px-1" onClick={() => onChange(!checked)}>
      <div>
        <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
        {desc && <p className="text-[10px] text-gray-400 mt-0.5">{desc}</p>}
      </div>
      <button
        type="button"
        className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0
          ${checked ? 'bg-slate-700' : 'bg-gray-200 dark:bg-gray-700'}`}
        aria-checked={checked}
        role="switch"
      >
        <span
          className={`pointer-events-none absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-md
            transition-transform duration-200 ease-out ${checked ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );
}

function BotBehaviorSection() {
  const botBehavior = useFeatureModuleStore((s) => s.botBehavior);
  const setBotBehavior = useFeatureModuleStore((s) => s.setBotBehavior);
  const resetBotBehavior = useFeatureModuleStore((s) => s.resetBotBehavior);

  return (
    <div className="space-y-4">
      {/* 智能合并模式 */}
      <div className="space-y-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">智能合并模式</p>
        <BehaviorToggle
          label="合并模式总开关"
          desc="开启后 Bot 平台与应用内均可合并长回复"
          checked={botBehavior.mergeEnable}
          onChange={(v) => setBotBehavior({ mergeEnable: v })}
        />
        <SliderField
          label="合并长度阈值" icon={MessageSquare} iconColor="text-slate-700 dark:text-slate-300"
          value={botBehavior.mergeThreshold} min={50} max={500} step={10}
          onChange={(v) => setBotBehavior({ mergeThreshold: v })}
          displayFn={(v) => `${v} 字`}
        />
        <BehaviorToggle
          label="仅合并结构化内容"
          desc="带标题/列表/序号/分节的长内容才合并；日常短对话照常分段拟真发送"
          checked={botBehavior.mergeRequireStructure}
          onChange={(v) => setBotBehavior({ mergeRequireStructure: v })}
        />
        <SliderField
          label="发送防抖窗口" icon={Timer} iconColor="text-blue-500"
          value={botBehavior.sendDebounceMs} min={500} max={10000} step={500}
          onChange={(v) => setBotBehavior({ sendDebounceMs: v })}
          displayFn={(v) => `${(v / 1000).toFixed(1)}s`}
        />
      </div>

      {/* 群聊唤醒与指令 */}
      <div className="space-y-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">群聊唤醒与指令</p>
        <BehaviorToggle
          label="Bot 指令"
          desc="外部用户发送 /指令 时本地执行（/帮助 /当前会话 /新建对话）"
          checked={botBehavior.commandEnabled}
          onChange={(v) => setBotBehavior({ commandEnabled: v })}
        />
        {/* 🆕 #2 AI 工具调用 */}
        <BehaviorToggle
          label="AI 工具调用"
          desc="允许 AI 识别点歌意图并触发工具：页内用播放器播放，外部平台收到音乐分享卡片"
          checked={botBehavior.aiToolEnabled !== false}
          onChange={(v) => setBotBehavior({ aiToolEnabled: v })}
        />
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">群聊唤醒模式</span>
          <MiniDropdown
            value={botBehavior.wakeupMode}
            options={[
              { value: 'mention_prefix', label: '@ 或前缀触发' },
              { value: 'all', label: '所有消息回复' },
            ]}
            onChange={(v) => setBotBehavior({ wakeupMode: v as 'mention_prefix' | 'all' })}
          />
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">唤醒/指令前缀</span>
          <input
            value={botBehavior.wakeupPrefix}
            onChange={(e) => setBotBehavior({ wakeupPrefix: e.target.value.slice(0, 3) })}
            className="w-16 text-xs text-center font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
      </div>

      <button
        onClick={resetBotBehavior}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-red-500 transition-all"
      >
        <RotateCcw size={12} /> 恢复默认
      </button>

      {/* 每接入：群聊/私聊开关 + 黑白名单 */}
      <PerIntegrationAccess />
    </div>
  );
}

/** 每接入黑白名单编辑区（A4.2，复用 BotIntegrationConfig 现有字段） */
function PerIntegrationAccess() {
  const integrations = useIntegrationStore((s) => s.integrations);
  if (integrations.length === 0) {
    return (
      <p className="text-[10px] text-gray-400 px-1">暂无接入记录。接入管理页创建 NapCat/微信接入后，可在此配置黑白名单。</p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-600 dark:text-gray-400 px-1">每接入行为与黑白名单</p>
      {integrations.map((i) => (
        <BotAccessRow key={i.id} integrationId={i.id} type={i.type} />
      ))}
    </div>
  );
}

/* ─────────── 每接入黑白名单编辑（A4.2） ─────────── */

/** 单个接入的群聊/私聊开关与黑白名单编辑（读写 integration.config JSON） */
function BotAccessRow({ integrationId, type }: { integrationId: string; type: string }) {
  const integration = useIntegrationStore((s) => s.integrations.find((i) => i.id === integrationId));
  const updateIntegration = useIntegrationStore((s) => s.updateIntegration);
  const [open, setOpen] = useState(false);
  if (!integration) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: any = {};
  try { config = JSON.parse(integration.config || '{}'); } catch { /* ignore */ }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch = (p: Record<string, any>) => {
    updateIntegration(integrationId, { config: JSON.stringify({ ...config, ...p }) });
  };

  const textField = (label: string, key: string, enabledKey: string, enabledLabel: string) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-500 dark:text-gray-500">{label}</span>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={!!config[enabledKey]}
            onChange={(e) => patch({ [enabledKey]: e.target.checked })}
            className="w-3 h-3 accent-slate-700"
          />
          <span className="text-[10px] text-gray-400">{enabledLabel}</span>
        </label>
      </div>
      <input
        value={config[key] || ''}
        onChange={(e) => patch({ [key]: e.target.value })}
        placeholder="逗号分隔，如 123456,234567"
        className="w-full text-[10px] font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-slate-400"
      />
    </div>
  );

  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-600 dark:text-gray-400"
      >
        <span className="flex items-center gap-1.5">
          <Bot size={12} className="text-blue-500" />
          {type}（{integration.enabled ? '已启用' : '未启用'}）
        </span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <BehaviorToggle
              label="私聊回复"
              checked={config.private_chat_enabled !== false}
              onChange={(v) => patch({ private_chat_enabled: v })}
            />
            <BehaviorToggle
              label="群聊回复"
              checked={config.group_chat_enabled !== false}
              onChange={(v) => patch({ group_chat_enabled: v })}
            />
          </div>
          {textField('用户白名单', 'allowed_users', 'allowed_users_enabled', '启用')}
          {textField('用户黑名单', 'blocked_users', 'blocked_users_enabled', '启用')}
          {textField('群白名单', 'allowed_groups', 'allowed_groups_enabled', '启用')}
          {textField('群黑名单', 'blocked_groups', 'blocked_groups_enabled', '启用')}
        </div>
      )}
    </div>
  );
}

/* ─────────── 性格决策参数（B4） ─────────── */

function PersonalitySection() {
  const dataOverride = useFeatureModuleStore((s) => s.dataOverride);
  const setDataOverride = useFeatureModuleStore((s) => s.setDataOverride);
  const p = dataOverride.personality || { selfDiscipline: 0.5, frugality: 0.5, actionDrive: 0.5 };

  return (
    <div className="space-y-4">
      <p className="text-[10px] text-gray-400 px-1">生活念头决策（吃饭/购物/休息）的算法系数。数据覆盖总开关关闭时使用默认值 0.5。</p>
      <SliderField
        label="自律度" icon={Shield} iconColor="text-violet-500"
        value={p.selfDiscipline} min={0} max={1} step={0.05}
        onChange={(v) => setDataOverride({ personality: { ...p, selfDiscipline: v } })}
        displayFn={(v) => `${Math.round(v * 100)}%`}
      />
      <SliderField
        label="节俭度" icon={Zap} iconColor="text-amber-500"
        value={p.frugality} min={0} max={1} step={0.05}
        onChange={(v) => setDataOverride({ personality: { ...p, frugality: v } })}
        displayFn={(v) => `${Math.round(v * 100)}%`}
      />
      <SliderField
        label="行动力" icon={TrendingUp} iconColor="text-cyan-500"
        value={p.actionDrive} min={0} max={1} step={0.05}
        onChange={(v) => setDataOverride({ personality: { ...p, actionDrive: v } })}
        displayFn={(v) => `${Math.round(v * 100)}%`}
      />
    </div>
  );
}

/* ─────────── 重试策略（A7） ─────────── */

function RetryPolicySection() {
  const retryPolicy = useFeatureModuleStore((s) => s.retryPolicy);
  const setRetryPolicy = useFeatureModuleStore((s) => s.setRetryPolicy);
  const resetRetryPolicy = useFeatureModuleStore((s) => s.resetRetryPolicy);

  return (
    <div className="space-y-4">
      <SliderField
        label="拦截重试次数" icon={RefreshCw} iconColor="text-cyan-500"
        value={retryPolicy.interceptRetryMax} min={0} max={3} step={1}
        onChange={(v) => setRetryPolicy({ interceptRetryMax: v })}
        displayFn={(v) => (v === 0 ? '不重试' : `${v} 次`)}
      />
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-600 dark:text-gray-400">重试模式</span>
        <MiniDropdown
          value={retryPolicy.retryMode}
          options={[
            { value: 'rewrite', label: '修改式（推荐）' },
            { value: 'regenerate', label: '全量重生成' },
          ]}
          onChange={(v) => setRetryPolicy({ retryMode: v as 'rewrite' | 'regenerate' })}
        />
      </div>
      <BehaviorToggle
        label="重试升温"
        desc="每次重试温度 +0.1，降低重复概率"
        checked={retryPolicy.enableTemperatureRamp}
        onChange={(v) => setRetryPolicy({ enableTemperatureRamp: v })}
      />
      <SliderField
        label="自适应温度上限" icon={Shield} iconColor="text-amber-500"
        value={retryPolicy.adaptiveTempMax} min={0.5} max={1} step={0.01}
        onChange={(v) => setRetryPolicy({ adaptiveTempMax: v })}
        displayFn={(v) => v.toFixed(2)}
      />
      <button
        onClick={resetRetryPolicy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-red-500 transition-all"
      >
        <RotateCcw size={12} /> 恢复默认
      </button>
    </div>
  );
}

/* ─────────── Main ─────────── */

export default function FeatureModulePage() {
  const dataOverride = useFeatureModuleStore((s) => s.dataOverride);
  const tasks = useFeatureModuleStore((s) => s.tasks);
  const setDataOverride = useFeatureModuleStore((s) => s.setDataOverride);
  const resetDataOverride = useFeatureModuleStore((s) => s.resetDataOverride);
  const setEmotionValue = useFeatureModuleStore((s) => s.setEmotionValue);
  const addTask = useFeatureModuleStore((s) => s.addTask);
  const removeTask = useFeatureModuleStore((s) => s.removeTask);
  const toggleTask = useFeatureModuleStore((s) => s.toggleTask);

  const [taskName, setTaskName] = useState('');
  const [taskType, setTaskType] = useState<ScheduledTaskType>('custom_prompt');
  const [schedMode, setSchedMode] = useState<SchedMode>('daily');
  const [schedTime, setSchedTime] = useState('09:00');
  const [schedMinute, setSchedMinute] = useState('0');
  const [schedIntervalMin, setSchedIntervalMin] = useState('15');
  const [schedDay, setSchedDay] = useState('1');
  const [schedDate, setSchedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [schedCustom, setSchedCustom] = useState('* * *');
  const [taskPayload, setTaskPayload] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const addTaskHandler = () => {
    if (!taskName.trim()) return;
    const cron = buildCron(schedMode, { time: schedTime, minute: schedMinute, intervalMin: schedIntervalMin, day: schedDay, date: schedDate, custom: schedCustom });
    addTask({
      name: taskName.trim(),
      type: taskType,
      schedule: cron,
      payload: taskPayload.trim(),
      enabled: true,
      source: 'ui',
    });
    setTaskName('');
    setTaskPayload('');
  };

  return (
    <ModulePageShell
      title="功能模块"
      subtitle="数据覆盖 · 定时任务"
      icon={Cpu}
      stats={[
        { label: '权重倍率', value: dataOverride.memoryImportanceWeight, color: 'text-slate-700', delay: '0.1s' },
        { label: '情感灵敏度', value: dataOverride.emotionSensitivity, color: 'text-amber-500', delay: '0.15s' },
        { label: '好感度', value: dataOverride.affinityLevel, color: 'text-slate-700 dark:text-slate-300', delay: '0.2s' },
      ]}
      headerAction={
        <button
          onClick={() => setShowResetConfirm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-gray-500
            hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-red-500 transition-all duration-200 active:scale-95"
        >
          <RotateCcw size={12} />
          重置
        </button>
      }
    >
      {/* 🔧 调度中心（原「功能模块」卡片）：模块开关 + 闸门预算 + 定时任务 + 主动回复 同容器 */}
      <FeatureModulesCard
        extra={<ProactiveReplySection />}
        tasksPanel={
          <CollapsibleSection
            icon={Clock}
            title="定时任务"
            desc={tasks.length > 0 ? `自主设定 · 共 ${tasks.length} 个任务` : '自主设定的周期任务'}
            color="text-slate-700 dark:text-slate-300"
            defaultOpen={false}
            embedded
          >
            <div className="space-y-3">
              {/* 任务列表 */}
              <div className="space-y-1.5">
                {tasks.length === 0 ? (
                  <ModuleEmptyState icon={Clock} label="暂无定时任务" />
                ) : (
                  tasks.map((t) => (
                    <TaskItem
                      key={t.id}
                      task={t}
                      onToggle={() => toggleTask(t.id)}
                      onDeleteRequest={(task) => setDeleteTarget(task)}
                    />
                  ))
                )}
              </div>

              {/* 🔧 重构后的添加任务表单：类型 chips + 调度模式 + 动态时间编辑器 */}
              <div className="p-3 rounded-xl border border-gray-100 dark:border-gray-800 space-y-2.5 animate-[fadeUp_0.2s_ease-out]">
                {/* 任务名称 */}
                <input
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="任务名称…"
                  className="w-full px-3 py-2 rounded-full text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
                    focus:outline-none focus:ring-2 focus:ring-violet-400 dark:focus:ring-violet-800 transition-all"
                  onKeyDown={(e) => { if (e.key === 'Enter') addTaskHandler(); }}
                />

                {/* 任务类型（行式布局 + 圆角下拉，与其他板块一致） */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-600 dark:text-gray-400 shrink-0">任务类型</span>
                  <MiniDropdown
                    value={taskType}
                    options={TASK_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    onChange={(v) => setTaskType(v as ScheduledTaskType)}
                  />
                </div>

                {/* 执行频率 */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-600 dark:text-gray-400 shrink-0">执行频率</span>
                  <MiniDropdown
                    value={schedMode}
                    options={(Object.keys(SCHED_MODES) as SchedMode[]).map((m) => ({ value: m, label: SCHED_MODES[m].label }))}
                    onChange={(v) => setSchedMode(v as SchedMode)}
                  />
                </div>

                {/* 动态时间编辑器（按模式显示） */}
                <div className="flex items-center gap-2 flex-wrap">
                  {schedMode === 'daily' && (
                    <>
                      <span className="text-[10px] text-gray-500">每天</span>
                      <MiniTimePicker value={schedTime} onChange={setSchedTime} />
                    </>
                  )}
                  {schedMode === 'hourly' && (
                    <>
                      <span className="text-[10px] text-gray-500">每小时第</span>
                      <input
                        type="number" min={0} max={59}
                        value={schedMinute}
                        onChange={(e) => setSchedMinute(e.target.value)}
                        className="w-14 h-[28px] px-2 rounded-full text-[11px] text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
                          focus:outline-none focus:ring-2 focus:ring-violet-400 transition-all"
                      />
                      <span className="text-[10px] text-gray-500">分</span>
                    </>
                  )}
                  {schedMode === 'interval' && (
                    <>
                      <span className="text-[10px] text-gray-500">每</span>
                      <input
                        type="number" min={2} max={720}
                        value={schedIntervalMin}
                        onChange={(e) => setSchedIntervalMin(e.target.value)}
                        className="w-16 h-[28px] px-2 rounded-full text-[11px] text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
                          focus:outline-none focus:ring-2 focus:ring-violet-400 transition-all"
                      />
                      <span className="text-[10px] text-gray-500">分钟</span>
                    </>
                  )}
                  {schedMode === 'monthly' && (
                    <>
                      <span className="text-[10px] text-gray-500">每月</span>
                      <input
                        type="number" min={1} max={28}
                        value={schedDay}
                        onChange={(e) => setSchedDay(e.target.value)}
                        className="w-14 h-[28px] px-2 rounded-full text-[11px] text-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
                          focus:outline-none focus:ring-2 focus:ring-violet-400 transition-all"
                      />
                      <span className="text-[10px] text-gray-500">日</span>
                      <MiniTimePicker value={schedTime} onChange={setSchedTime} />
                    </>
                  )}
                  {schedMode === 'date' && (
                    <>
                      <MiniDatePicker value={schedDate} onChange={setSchedDate} />
                      <MiniTimePicker value={schedTime} onChange={setSchedTime} />
                    </>
                  )}
                  {schedMode === 'custom' && (
                    <input
                      value={schedCustom}
                      onChange={(e) => setSchedCustom(e.target.value)}
                      placeholder="分 时 天 · 如 30 9 * 或 */15 * *"
                      className="flex-1 min-w-0 h-[28px] px-3 rounded-full text-[11px] font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
                        focus:outline-none focus:ring-2 focus:ring-violet-400 transition-all"
                    />
                  )}
                </div>

                {/* 任务内容（按类型提示） */}
                <textarea
                  rows={2}
                  value={taskPayload}
                  onChange={(e) => setTaskPayload(e.target.value)}
                  placeholder={PAYLOAD_HINTS[taskType]}
                  disabled={taskType === 'memory_cleanup'}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 resize-none
                    focus:outline-none focus:ring-2 focus:ring-violet-400 dark:focus:ring-violet-800 transition-all disabled:opacity-50"
                />

                {/* 执行预览 */}
                <p className="text-[10px] text-gray-400 flex items-center gap-1">
                  <Clock size={9} />
                  将{describeSchedule(buildCron(schedMode, { time: schedTime, minute: schedMinute, intervalMin: schedIntervalMin, day: schedDay, date: schedDate, custom: schedCustom }))}
                  执行「{TASK_TYPE_OPTIONS.find((o) => o.value === taskType)?.label}」
                </p>

                <button
                  onClick={addTaskHandler}
                  disabled={!taskName.trim()}
                  className="w-full px-3 py-1.5 rounded-full text-xs text-white bg-slate-700 hover:bg-slate-600
                    disabled:opacity-40 transition-all duration-200 active:scale-[0.98] shadow-sm shadow-slate-700/25"
                >
                  <Plus size={12} className="inline mr-1" />
                  添加任务
                </button>
              </div>
            </div>
          </CollapsibleSection>
        }
      />

      {/* 🔧 自设置页迁移：模型角色 / V2 系统设置 */}
      <ModelRoleConfigSection />
      <V2SettingsPanel />

      {/* 🔧 数据与参数容器：启用数据覆盖 + 好感度/情感/记忆 参数同容器 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 space-y-3
        animate-[fadeUp_0.3s_ease-out_both]">
        {/* 启用数据覆盖（总开关） */}
        <div className="flex items-center justify-between px-1 py-0.5">
          <div className="flex items-center gap-2">
            <Zap size={14} className={dataOverride.enabled ? 'text-slate-700 dark:text-slate-300' : 'text-gray-400'} />
            <span className="text-xs text-gray-700 dark:text-gray-300">启用数据覆盖</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={dataOverride.enabled}
            onClick={() => setDataOverride({ enabled: !dataOverride.enabled })}
            className={`relative inline-flex w-10 h-5 rounded-full transition-colors duration-200 outline-none
              focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1
              ${dataOverride.enabled ? 'bg-slate-700' : 'bg-gray-200 dark:bg-gray-700'}`}
          >
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-md
                transition-transform duration-200 ease-out
                ${dataOverride.enabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>

        {/* 好感度参数 */}
        <CollapsibleSection embedded icon={Heart} title="好感度参数" color="text-slate-700 dark:text-slate-300" defaultOpen>
        <div className="space-y-4">
          <SliderField
            label="好感度等级" icon={Heart} iconColor="text-slate-700 dark:text-slate-300"
            value={dataOverride.affinityLevel} min={-100} max={100}
            onChange={(v) => setDataOverride({ affinityLevel: v })}
          />
          {/* 🆕 锁定开关：开启后好感度始终维持设定值（区分"设为 0"与"未设定"） */}
          <label className="flex items-center justify-between cursor-pointer select-none px-1">
            <span className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
              <Heart size={12} className="text-slate-700 dark:text-slate-300" />
              锁定好感度为上述值
            </span>
            <input
              type="checkbox"
              checked={!!dataOverride.affinityLevelLocked}
              onChange={(e) => setDataOverride({ affinityLevelLocked: e.target.checked })}
              className="w-4 h-4 accent-slate-700"
            />
          </label>
          <SliderField
            label="增长倍率" icon={Zap} iconColor="text-amber-500"
            value={dataOverride.affinityGrowthRate} min={0} max={5} step={0.1}
            onChange={(v) => setDataOverride({ affinityGrowthRate: v })}
            displayFn={(v) => `${v}x`}
          />
          <SliderField
            label="单次增量上限" icon={TrendingUp} iconColor="text-slate-700 dark:text-slate-300"
            value={dataOverride.affinitySingleMax} min={0} max={50}
            onChange={(v) => setDataOverride({ affinitySingleMax: v })}
          />
        </div>
        </CollapsibleSection>

        {/* 情感参数 */}
        <CollapsibleSection embedded icon={Palette} title="情感参数" color="text-amber-500">
        <div className="space-y-4">
          <SliderField
            label="衰减倍率" icon={Timer} iconColor="text-blue-500"
            value={dataOverride.emotionDecayMultiplier} min={0} max={3} step={0.1}
            onChange={(v) => setDataOverride({ emotionDecayMultiplier: v })}
            displayFn={(v) => `${v}x`}
          />
          <SliderField
            label="灵敏度" icon={Shield} iconColor="text-slate-700 dark:text-slate-300"
            value={dataOverride.emotionSensitivity} min={0} max={100}
            onChange={(v) => setDataOverride({ emotionSensitivity: v })}
          />
          <div className="space-y-2">
            <span className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
              <Palette size={12} className="text-amber-500" />
              情绪维度覆盖
            </span>
            <div className="grid grid-cols-3 gap-2">
              {EMOTION_DIMENSIONS.map((dim) => (
                <div key={dim.key} className="flex items-center justify-between p-2 bg-gray-50/50 dark:bg-gray-800/20 rounded-lg">
                  <span className={`text-[10px] ${dim.color}`}>{dim.label}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={dataOverride.emotionValues[dim.key] ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const val = e.target.value === '' ? undefined : +e.target.value;
                      if (val !== undefined) setEmotionValue(dim.key, val);
                    }}
                    className="w-12 text-[10px] text-center font-mono bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5
                      focus:outline-none focus:ring-1 focus:ring-slate-400 transition-all"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        </CollapsibleSection>

        {/* 记忆参数 */}
        <CollapsibleSection embedded icon={Brain} title="记忆参数" color="text-cyan-500">
        <div className="space-y-4">
          <SliderField
            label="重要度权重" icon={Brain} iconColor="text-cyan-500"
            value={dataOverride.memoryImportanceWeight} min={0} max={5} step={0.1}
            onChange={(v) => setDataOverride({ memoryImportanceWeight: v })}
            displayFn={(v) => `${v}x`}
          />
          <SliderField
            label="衰减速率" icon={Timer} iconColor="text-blue-500"
            value={dataOverride.memoryDecayRate} min={0} max={5} step={0.1}
            onChange={(v) => setDataOverride({ memoryDecayRate: v })}
            displayFn={(v) => `${v}x`}
          />
        </div>
        </CollapsibleSection>

        {/* 🆕 B4 性格决策参数 */}
        <CollapsibleSection embedded icon={UserCheck} title="性格决策参数" color="text-violet-500">
          <PersonalitySection />
        </CollapsibleSection>

        {/* 🆕 A7 重试策略 */}
        <CollapsibleSection embedded icon={RefreshCw} title="重试策略" color="text-blue-500">
          <RetryPolicySection />
        </CollapsibleSection>
      </div>

      {/* 🔧 自设置页迁移：记忆分析 / 学习分析 */}
      <MemoryAnalysisConfigSection />
      <LearningConfigSection />

      {/* 🆕 AI 一日数据编辑：属性数值 / 物资 / 钱包余额（含 AI 一日生活总开关） */}
      <ModuleSection icon={CalendarClock} title="AI 一日数据" color="text-slate-700 dark:text-slate-300" defaultOpen={false}>
        <AiLifeEnableToggle />
        <AiLifeDataEditorSection />
      </ModuleSection>

      {/* Agent 能力工具管理 */}
      <ModuleSection
        icon={Bot}
        title="Agent 能力"
        color="text-slate-700 dark:text-slate-300"
        defaultOpen={false}
        headerRight={
          <AgentToggleSwitch />
        }
      >
        <AgentCapabilitySection />
      </ModuleSection>

      {/* 🆕 A1/A4 Bot 接入行为：智能合并 + 群聊唤醒 + 指令 */}
      <ModuleSection icon={MessageSquare} title="Bot 接入行为" color="text-blue-500" defaultOpen={false}>
        <BotBehaviorSection />
      </ModuleSection>

      {/* Prompt 热更新 */}
      <ModuleSection icon={FileText} title="Prompt 热更新" color="text-amber-500" defaultOpen={false}>
        <PromptHotReloadPanel />
      </ModuleSection>

      {/* 删除任务确认 */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { removeTask(deleteTarget.id); setDeleteTarget(null); } }}
        title="删除此定时任务？"
        description={`将移除「${deleteTarget?.name || ''}」任务。`}
        icon={Clock}
        confirmLabel="删除"
      />

      {/* 重置确认 */}
      <ConfirmModal
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={resetDataOverride}
        title="重置所有数据？"
        description="将恢复默认设置，所有自定义参数将丢失。"
        icon={RotateCcw}
        confirmLabel="确认重置"
        variant="warning"
      />
    </ModulePageShell>
  );
}
