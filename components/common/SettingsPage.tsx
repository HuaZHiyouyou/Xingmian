import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Download, Search, MessageSquare, FileText, FileJson, Clock, Trash2, Upload, FileCode, AlertTriangle, FileDown, X, Check, Heart, Brain, Terminal, RotateCcw, ChevronDown, Zap, BookOpen } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../store/chatStore';
import { useCharacterStore } from '../../store/characterStore';
import { useConfigStore } from '../../store/configStore';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useMemoryStore } from '../../store/memoryStore';
import { useDebugLog, DebugLogType } from '../../store/debugLogStore';
import { useRecycleBinStore } from '../../store/recycleBinStore';
import { useModelRoleStore, MODEL_ROLE_LABELS, MODEL_ROLE_DESCRIPTIONS, type ModelRole, type ProactiveReplyConfig } from '../../store/modelRoleStore';
import { useProactiveReplyStore } from '../../store/proactiveReplyStore';
import { getTopicLedgerConfig, configureTopicLedger, clearTopicLedger } from '../../services/topicLedger';
import { useMemoryAnalysisStore, DETAIL_LEVEL_OPTIONS } from '../../store/memoryAnalysisStore';
import { useLearningConfigStore } from '../../store/learningConfigStore';
import { useLearningStore } from '../../store/learningStore';
import { exportConversations, exportSingleConversation, importConversations, exportAffinityData, importAffinityData, exportMemoryEntries, importMemoryEntries, exportLearningData, importLearningData } from '../../utils/exportUtils';
import { dbGetDebugLogsCount, dbClearDebugLogs } from '../../lib/tauriBridge';
import { exportConfigToYaml, importConfigFromYaml, downloadYaml } from '../../utils/yamlConfig';
import { Conversation } from '../../types';

type ThemeMode = 'light' | 'dark' | 'system';
type FontSize = 'small' | 'medium' | 'large';
type BubbleStyle = 'rounded' | 'sharp' | 'minimal' | 'wechat' | 'pill' | 'glass' | 'bubble' | 'gradient';
type AvatarStyle = 'circle' | 'square' | 'squircle';
type ExportFormat = 'txt' | 'json' | 'md';

type ConfirmDeleteType = 'soft' | 'permanent' | null;
type ConfirmDeleteTarget = 'conversation' | 'emotion' | 'affinity' | 'memoryEntry' | 'log' | 'allMemory' | 'allLog' | null;

interface UIConfig {
  theme: ThemeMode;
  fontSize: FontSize;
  bubbleStyle: BubbleStyle;
  accentColor: string;
  avatarStyle: AvatarStyle;
  inputDebounce: boolean;
  inputDebounceMs: number;
  segmentedReplies: boolean;
  segmentDelayMs: number;
  streamResponse: boolean;
}

const defaultConfig: UIConfig = {
  theme: 'system',
  fontSize: 'medium',
  bubbleStyle: 'rounded',
  accentColor: '#2563eb',
  avatarStyle: 'circle',
  inputDebounce: false,
  inputDebounceMs: 1500,
  segmentedReplies: false,
  segmentDelayMs: 800,
  streamResponse: false,
};

function loadUIConfig(): UIConfig {
  try {
    const stored = localStorage.getItem('ui-config');
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaultConfig, ...parsed };
    }
  } catch { /* ignore */ }
  return defaultConfig;
}

function applyTheme(theme: ThemeMode) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else if (theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
}

function applyFontSize(size: FontSize) {
  const sizes: Record<FontSize, string> = { small: '13px', medium: '14px', large: '16px' };
  document.documentElement.style.fontSize = sizes[size];
}

function applyBubbleStyle(style: BubbleStyle) {
  document.documentElement.setAttribute('data-bubble-style', style);
}

function applyAccentColor(color: string) {
  document.documentElement.setAttribute('data-accent-color', color);
  document.documentElement.style.setProperty('--accent-color', color);
}

function applyAvatarStyle(style: AvatarStyle) {
  document.documentElement.setAttribute('data-avatar-style', style);
}

function DataManageCard({
  icon,
  title,
  count,
  countLabel,
  description,
  isExpanded,
  onToggle,
  items,
  selectedIds,
  onToggleItem,
  onSelectAll,
  onSoftDelete,
  onPermanentDelete,
  accentColor,
  supportsSoftDelete = true,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  countLabel: string;
  description: string;
  isExpanded: boolean;
  onToggle: () => void;
  items: { id: string; label: string; sublabel: string }[];
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectAll: () => void;
  onSoftDelete: () => void;
  onPermanentDelete: () => void;
  accentColor: string;
  supportsSoftDelete?: boolean;
  /** 🆕 展开区底部的自定义内容（如"清空全部"按钮），items 为空时也渲染 */
  footer?: React.ReactNode;
}) {
  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const someSelected = selectedIds.size > 0;

  const colorClasses: Record<string, { bg: string; leftBorder: string; itemBg: string }> = {
    orange: { bg: 'bg-orange-50 dark:bg-orange-900/20', leftBorder: 'border-l-orange-400 dark:border-l-orange-500', itemBg: 'bg-orange-50 dark:bg-orange-900/20' },
    blue: { bg: 'bg-blue-50 dark:bg-blue-900/20', leftBorder: 'border-l-blue-400 dark:border-l-blue-500', itemBg: 'bg-blue-50 dark:bg-blue-900/20' },
    purple: { bg: 'bg-slate-100 dark:bg-slate-800/20', leftBorder: 'border-l-slate-500 dark:border-l-slate-700', itemBg: 'bg-slate-100 dark:bg-slate-800/20' },
    indigo: { bg: 'bg-indigo-50 dark:bg-indigo-900/20', leftBorder: 'border-l-indigo-400 dark:border-l-indigo-500', itemBg: 'bg-indigo-50 dark:bg-indigo-900/20' },
    gray: { bg: 'bg-gray-50 dark:bg-gray-800/50', leftBorder: 'border-l-gray-400 dark:border-l-gray-500', itemBg: 'bg-gray-50 dark:bg-gray-800/50' },
  };
  const colors = colorClasses[accentColor] || colorClasses.gray;

  return (
    <div className={`rounded-xl border transition-all duration-300 ease-in-out ${
      isExpanded
        ? `border-gray-200/60 dark:border-gray-700/60 ${colors.leftBorder} bg-gray-50/30 dark:bg-gray-800/20`
        : 'border-transparent hover:border-gray-100 dark:hover:border-gray-800 hover:bg-gray-50/20 dark:hover:bg-gray-800/10'
    }`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-200"
      >
        <div className="shrink-0 transition-transform duration-300 ease-in-out">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{title}</p>
            <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-full transition-colors duration-200">
              {count} {countLabel}
            </span>
          </div>
          <p className={`text-[11px] text-gray-400 truncate mt-0.5 transition-all duration-300 ease-in-out ${
            isExpanded ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-5 opacity-100'
          }`}>{description}</p>
        </div>
        <ChevronDown
          size={14}
          className={`shrink-0 text-gray-400 transition-transform duration-300 ease-in-out ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Expandable Content with grid animation */}
      <div className={`grid transition-all duration-300 ease-in-out ${
        isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}>
        <div className="overflow-hidden">
          <div className="px-3 pb-3">
            {items.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">
                {footer ? '数据量大，请使用下方批量操作' : '暂无数据'}
              </p>
            ) : (
              <>
                {/* Select All */}
                <div className="flex items-center px-1 mb-1.5">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={onSelectAll}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-slate-700 focus:ring-slate-700 transition-transform duration-150 group-hover:scale-110"
                    />
                    <span className="text-[11px] text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors duration-150">
                      全选 ({selectedIds.size}/{items.length})
                    </span>
                  </label>
                </div>

                {/* List */}
                <div className="max-h-40 overflow-y-auto rounded-lg bg-white/50 dark:bg-gray-900/30 p-1" style={{ scrollbarWidth: 'thin' }}>
                  <div className="space-y-0.5">
                    {items.map((item, index) => (
                      <label
                        key={item.id}
                        className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-all duration-200 ease-in-out transform ${
                          selectedIds.has(item.id)
                            ? `${colors.itemBg} ring-2 ring-offset-1 ring-${accentColor}-400 dark:ring-${accentColor}-500 ring-offset-white dark:ring-offset-gray-900 scale-[1.01]`
                            : 'hover:bg-gray-100 dark:hover:bg-gray-800 hover:scale-[1.005] active:scale-[0.99]'
                        }`}
                        style={{ animation: `listItemIn 0.2s ease-out ${index * 0.03}s both` }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          onChange={() => onToggleItem(item.id)}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-slate-700 focus:ring-slate-700 shrink-0 transition-transform duration-150 hover:scale-110"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                            {item.label}
                          </p>
                          <p className="text-[10px] text-gray-400 truncate">{item.sublabel}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                {someSelected && (
                  <div className="flex gap-2 mt-2" style={{ animation: 'fadeIn 0.2s ease-out' }}>
                    {supportsSoftDelete && (
                      <button
                        onClick={onSoftDelete}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs
                          bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400
                          hover:bg-gray-200 dark:hover:bg-gray-700 transition-all duration-200 active:scale-95 hover:shadow-sm"
                      >
                        <RotateCcw size={12} />
                        移入回收站 ({selectedIds.size})
                      </button>
                    )}
                    <button
                      onClick={onPermanentDelete}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs
                        text-white bg-red-500 hover:bg-red-600 transition-all duration-200 active:scale-95 hover:shadow-md hover:shadow-red-500/20"
                    >
                      <Trash2 size={12} />
                      彻底删除 ({selectedIds.size})
                    </button>
                  </div>
                )}
              </>
            )}
            {footer && <div className="mt-1">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 🆕 角色列表精简为 2 + 2：
 *  - cognitive: 实时认知（情绪+好感度+回想+回复合并）
 *  - background: 后台异步（记忆/学习/反思）
 *  - vision / video: 保持独立（多模态特性）
 */
const ALL_MODEL_ROLES: ModelRole[] = [
  'cognitive', 'background', 'ailife', 'vision', 'video',
];

/** 极简折叠区块 — 复用 FeatureModulePage 的 ModuleSection 视觉风格 */
/** 折叠区块容器（设置页/功能模块页共用） */
export function CollapsibleSection({
  icon: Icon, title, desc, color = 'text-gray-500', defaultOpen = false, embedded = false, open: openProp, onOpenChange, children,
}: {
  icon: LucideIcon;
  title: string;
  desc?: string;
  color?: string; // e.g. 'text-slate-700 dark:text-slate-300'
  defaultOpen?: boolean;
  /** 🔧 嵌入模式：去掉独立卡片壳，作为内嵌面板融入宿主卡片（如功能模块注册表卡片） */
  embedded?: boolean;
  /** 受控展开：传入后由宿主控制开合（如学习分析开关打开时自动展开） */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = openProp ?? innerOpen;
  const setOpen = (o: boolean) => { setInnerOpen(o); onOpenChange?.(o); };
  return (
    <div
      className={
        embedded
          ? 'rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/20 overflow-hidden'
          : 'bg-white dark:bg-gray-900 rounded-2xl shadow-sm'
      }
    >
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 group hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-all duration-150 active:scale-[0.98] ${
          embedded ? 'p-3' : 'p-4'
        }`}
      >
        <Icon size={16} className={color} />
        <div className="flex-1 min-w-0 text-left">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</span>
          {desc && <p className="text-[10px] text-gray-400 truncate">{desc}</p>}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden transition-opacity duration-300 ease-out" style={{ opacity: open ? 1 : 0 }}>
          <div className={`space-y-4 ${embedded ? 'px-3 pb-3' : 'px-4 pb-4'}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}

/** 🔧 已迁移至功能模块页（FeatureModulePage）渲染；此处仅保留组件定义供其复用 */
export function MemoryAnalysisConfigSection() {
  const config = useMemoryAnalysisStore((s) => s.config);
  const updateConfig = useMemoryAnalysisStore((s) => s.updateConfig);
  const updateDetailLevel = useMemoryAnalysisStore((s) => s.updateDetailLevel);

  return (
    <CollapsibleSection icon={Brain} title="记忆分析设置" color="text-gray-500" defaultOpen={false}>
      {/* Auto Analysis */}
      <div className="space-y-2">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm text-gray-700 dark:text-gray-300">自动分析</span>
            <p className="text-[10px] text-gray-400">开启后每 N 轮在后台运行记忆任务（提取/反思/总结），会产生 API 调用</p>
          </div>
          <div className="relative">
            <input
              type="checkbox"
              checked={config.autoAnalysisEnabled}
              onChange={(e) => updateConfig({ autoAnalysisEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
            <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
          </div>
        </label>
        {config.autoAnalysisEnabled && (
          <div className="flex items-center justify-between pl-1">
            <span className="text-xs text-gray-500">触发间隔</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateConfig({ analysisRoundTrigger: Math.max(1, config.analysisRoundTrigger - 1) })}
                className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >-</button>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-8 text-center">{config.analysisRoundTrigger} 轮</span>
              <button
                onClick={() => updateConfig({ analysisRoundTrigger: Math.min(20, config.analysisRoundTrigger + 1) })}
                className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >+</button>
            </div>
          </div>
        )}
      </div>

      {/* Scheduled Analysis */}
      <div className="space-y-2">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <span className="text-sm text-gray-700 dark:text-gray-300">定时分析</span>
            <p className="text-[10px] text-gray-400">按固定时间间隔触发记忆分析</p>
          </div>
          <div className="relative">
            <input
              type="checkbox"
              checked={config.scheduledAnalysisEnabled}
              onChange={(e) => updateConfig({ scheduledAnalysisEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
            <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
          </div>
        </label>
        {config.scheduledAnalysisEnabled && (
          <div className="flex items-center justify-between pl-1">
            <span className="text-xs text-gray-500">间隔时间</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateConfig({ scheduledAnalysisIntervalMinutes: Math.max(10, config.scheduledAnalysisIntervalMinutes - 10) })}
                className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >-</button>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-12 text-center">{config.scheduledAnalysisIntervalMinutes} 分钟</span>
              <button
                onClick={() => updateConfig({ scheduledAnalysisIntervalMinutes: Math.min(240, config.scheduledAnalysisIntervalMinutes + 10) })}
                className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >+</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Levels */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500 uppercase tracking-wide">分析详细度</p>
        {(['thinking', 'analysis', 'reflection', 'summary'] as const).map(type => (
          <div key={type} className="flex items-center justify-between">
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {{ thinking: 'AI思考', analysis: '用户分析', reflection: '内心反思', summary: '对话总结' }[type]}
            </span>
            <div className="flex gap-1">
              {DETAIL_LEVEL_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateDetailLevel(type, opt.value)}
                  className={`px-2 py-1 rounded text-[10px] transition-colors ${
                    config.detailLevels[type] === opt.value
                      ? 'bg-slate-200 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500'
                      : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  title={opt.desc}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Max entries */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">每角色最大记忆数</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateConfig({ maxEntriesPerCharacter: Math.max(50, config.maxEntriesPerCharacter - 50) })}
            className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >-</button>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-8 text-center">{config.maxEntriesPerCharacter}</span>
          <button
            onClick={() => updateConfig({ maxEntriesPerCharacter: Math.min(500, config.maxEntriesPerCharacter + 50) })}
            className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >+</button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

/** 🔧 已迁移至功能模块页渲染 */
export function LearningConfigSection() {
  const config = useLearningConfigStore((s) => s.config);
  const updateConfig = useLearningConfigStore((s) => s.updateConfig);
  // 🔧 开关联动展开：启用时自动展开子配置，关闭时自动收起
  const [open, setOpen] = useState(config.enabled);

  return (
    <CollapsibleSection icon={BookOpen} title="学习分析" desc="学习用户的表达风格并融入AI回复" color="text-slate-700 dark:text-slate-300" open={open} onOpenChange={setOpen}>
      {/* Enable Toggle */}
      <label className="flex items-center justify-between cursor-pointer">
        <div>
          <span className="text-sm text-gray-700 dark:text-gray-300">启用学习分析</span>
          <p className="text-[10px] text-gray-400">自动学习用户的拟人化表达风格（口头禅、语气词、撒娇句式等）</p>
        </div>
        <div className="relative">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => { updateConfig({ enabled: e.target.checked }); setOpen(e.target.checked); }}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
        </div>
      </label>

        {/* 🔧 开关切换动画：与其他参数区块的 grid-rows 展开一致 */}
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-out"
          style={{ gridTemplateRows: config.enabled ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden transition-opacity duration-300 ease-out" style={{ opacity: config.enabled ? 1 : 0 }}>
            <div className="space-y-4 pt-1">
            {/* Round Trigger */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">对话触发</span>
                <span className="text-[10px] text-gray-400">— 每隔多少轮对话触发一次</span>
              </div>
              <div className="flex items-center justify-between pl-1">
                <span className="text-xs text-gray-600 dark:text-gray-400">触发间隔</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateConfig({ roundTrigger: Math.max(1, config.roundTrigger - 1) })}
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >-</button>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-12 text-center">{config.roundTrigger} 轮</span>
                  <button
                    onClick={() => updateConfig({ roundTrigger: Math.min(20, config.roundTrigger + 1) })}
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >+</button>
                </div>
              </div>
            </div>

            {/* Scheduled Analysis */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">定时分析</span>
                <span className="text-[10px] text-gray-400">— 按固定时间间隔触发</span>
              </div>

              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-gray-700 dark:text-gray-300">启用定时分析</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={config.scheduledEnabled}
                    onChange={(e) => updateConfig({ scheduledEnabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
                </div>
              </label>

              {config.scheduledEnabled && (
                <>
                  <div className="flex items-center justify-between pl-1">
                    <span className="text-xs text-gray-600 dark:text-gray-400">间隔时间</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateConfig({ scheduledIntervalMinutes: Math.max(10, config.scheduledIntervalMinutes - 10) })}
                        className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >-</button>
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-16 text-center">{config.scheduledIntervalMinutes} 分钟</span>
                      <button
                        onClick={() => updateConfig({ scheduledIntervalMinutes: Math.min(240, config.scheduledIntervalMinutes + 10) })}
                        className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >+</button>
                    </div>
                  </div>

                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-300">设置开始时间</span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={config.startTimeEnabled}
                        onChange={(e) => updateConfig({ startTimeEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
                      <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
                    </div>
                  </label>

                  {config.startTimeEnabled && (
                    <div className="flex items-center justify-between pl-1">
                      <span className="text-xs text-gray-600 dark:text-gray-400">开始时间</span>
                      {(() => {
                        const parts = (config.scheduledStartTime || '08:00').split(':');
                        const hour = parts[0] || '08';
                        const minute = parts[1] || '00';
                        return (
                          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                            <input
                              type="number"
                              min={0}
                              max={23}
                              value={hour}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '' || (parseInt(v) >= 0 && parseInt(v) <= 23)) {
                                  updateConfig({ scheduledStartTime: `${v.padStart(2, '0')}:${minute}` });
                                }
                              }}
                              placeholder="时"
                              className="w-8 text-center text-sm text-gray-700 dark:text-gray-300 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder-gray-400"
                            />
                            <span className="text-gray-400 font-medium">:</span>
                            <input
                              type="number"
                              min={0}
                              max={59}
                              value={minute}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '' || (parseInt(v) >= 0 && parseInt(v) <= 59)) {
                                  updateConfig({ scheduledStartTime: `${hour.padStart(2, '0')}:${v.padStart(2, '0')}` });
                                }
                              }}
                              placeholder="分"
                              className="w-8 text-center text-sm text-gray-700 dark:text-gray-300 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder-gray-400"
                            />
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Storage Limits */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">存储上限</span>
                <span className="text-[10px] text-gray-400">— 限制学习记录数量</span>
              </div>
              
              <div className="flex items-center justify-between pl-1">
                <span className="text-xs text-gray-600 dark:text-gray-400">最大词汇数</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateConfig({ maxVocabulary: Math.max(50, config.maxVocabulary - 50) })}
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >-</button>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-10 text-center">{config.maxVocabulary}</span>
                  <button
                    onClick={() => updateConfig({ maxVocabulary: Math.min(500, config.maxVocabulary + 50) })}
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >+</button>
                </div>
              </div>
              
              <div className="flex items-center justify-between pl-1">
                <span className="text-xs text-gray-600 dark:text-gray-400">最大表达数</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateConfig({ maxPhrases: Math.max(20, config.maxPhrases - 10) })}
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >-</button>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-10 text-center">{config.maxPhrases}</span>
                  <button
                    onClick={() => updateConfig({ maxPhrases: Math.min(300, config.maxPhrases + 10) })}
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >+</button>
                </div>
              </div>

              <div className="flex items-center justify-between pl-1">
                <div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">最大发言条数</span>
                  <p className="text-[10px] text-gray-400">上传给AI学习的用户消息数</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateConfig({ maxMessages: Math.max(10, config.maxMessages - 10) })}
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >-</button>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-10 text-center">{config.maxMessages}</span>
                  <button
                    onClick={() => updateConfig({ maxMessages: Math.min(200, config.maxMessages + 10) })}
                    className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >+</button>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
    </CollapsibleSection>
  );
}

/** 🔧 已迁移至功能模块页渲染 */
export function ModelRoleConfigSection() {
  const platforms = useConfigStore((s) => s.platforms);
  const assignments = useModelRoleStore((s) => s.assignments);
  const maxRetries = useModelRoleStore((s) => s.maxRetriesPerModel);
  const setAssignment = useModelRoleStore((s) => s.setAssignment);
  const setMaxRetries = useModelRoleStore((s) => s.setMaxRetries);
  const [expandedRole, setExpandedRole] = useState<ModelRole | null>(null);

  const enabledModels = platforms
    .filter(p => p.enabled && p.apiKey)
    .flatMap((p, pi) =>
      p.models.filter(m => m.enabled).map(m => ({
        platformIndex: pi,
        platformBaseUrl: p.baseUrl,
        platformName: p.displayName,
        modelName: m.name,
      }))
    );

  const toggleModelForRole = (role: ModelRole, platformIndex: number, platformBaseUrl: string, modelName: string) => {
    const current = assignments[role] || [];
    const exists = current.some(m => m.platformIndex === platformIndex && m.modelName === modelName);
    if (exists) {
      setAssignment(role, current.filter(m => !(m.platformIndex === platformIndex && m.modelName === modelName)));
    } else {
      setAssignment(role, [...current, { platformIndex, platformBaseUrl, modelName }]);
    }
  };

  const moveModel = (role: ModelRole, from: number, to: number) => {
    const models = [...(assignments[role] || [])];
    if (from < 0 || from >= models.length || to < 0 || to >= models.length) return;
    const [moved] = models.splice(from, 1);
    models.splice(to, 0, moved);
    setAssignment(role, models);
  };

  return (
    <CollapsibleSection icon={Zap} title="模型角色配置" desc="为不同任务分配专用模型，支持多级回退" color="text-gray-500" defaultOpen={false}>
      {/* Max retries */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-500">单模型最大重试次数</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMaxRetries(maxRetries - 1)}
            className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >-</button>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-4 text-center">{maxRetries}</span>
          <button
            onClick={() => setMaxRetries(maxRetries + 1)}
            className="w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 text-xs hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >+</button>
        </div>
      </div>

      {enabledModels.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">请先在"模型配置"中启用至少一个模型</p>
      ) : (
        <div className="space-y-1.5">
          {ALL_MODEL_ROLES.map(role => {
            const isExpanded = expandedRole === role;
            const roleModels = assignments[role] || [];
            return (
              <div key={role} className={`rounded-lg border transition-all duration-200 ${
                isExpanded
                  ? 'border-slate-300 dark:border-slate-900 bg-slate-100/30 dark:bg-slate-800/10'
                  : 'border-transparent hover:border-gray-100 dark:hover:border-gray-800'
              }`}>
                <button
                  onClick={() => setExpandedRole(isExpanded ? null : role)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                        {MODEL_ROLE_LABELS[role]}
                      </span>
                      {roleModels.length > 0 && (
                        <span className="text-[10px] text-slate-700 dark:text-slate-300 bg-slate-200 dark:bg-slate-800/30 px-1.5 py-0.5 rounded-full">
                          {roleModels.length} 个模型
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 truncate">{MODEL_ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                  <ChevronDown size={12} className={`shrink-0 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2">
                    {/* Assigned models (reorderable) */}
                    {roleModels.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">回退顺序（点击箭头调整）</p>
                        {roleModels.map((m, idx) => {
                          const platform = m.platformBaseUrl
                            ? platforms.find(p => p.baseUrl === m.platformBaseUrl)
                            : platforms[m.platformIndex];
                          return (
                            <div key={`${m.platformIndex}-${m.modelName}`} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white dark:bg-gray-800 text-xs">
                              <span className="text-gray-400 w-4 text-center">{idx + 1}</span>
                              <span className="flex-1 truncate text-gray-700 dark:text-gray-300">
                                {m.modelName}
                                <span className="text-gray-400 ml-1">({platform?.displayName})</span>
                              </span>
                              <div className="flex gap-0.5">
                                <button
                                  onClick={() => moveModel(role, idx, idx - 1)}
                                  disabled={idx === 0}
                                  className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                                >↑</button>
                                <button
                                  onClick={() => moveModel(role, idx, idx + 1)}
                                  disabled={idx === roleModels.length - 1}
                                  className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                                >↓</button>
                                <button
                                  onClick={() => toggleModelForRole(role, m.platformIndex, m.platformBaseUrl, m.modelName)}
                                  className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                                >×</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Available models */}
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">可用模型（点击添加）</p>
                    <div className="max-h-32 overflow-y-auto rounded bg-white/50 dark:bg-gray-900/30 p-1" style={{ scrollbarWidth: 'thin' }}>
                      <div className="space-y-0.5">
                        {enabledModels.map((m) => {
                          const isAssigned = roleModels.some(r => r.platformIndex === m.platformIndex && r.modelName === m.modelName);
                          return (
                            <button
                              key={`${m.platformIndex}-${m.modelName}`}
                              onClick={() => toggleModelForRole(role, m.platformIndex, m.platformBaseUrl, m.modelName)}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors ${
                                isAssigned
                                  ? 'bg-slate-200 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500'
                                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                              }`}
                            >
                              {isAssigned && <Check size={10} />}
                              <span className="truncate">{m.modelName}</span>
                              <span className="text-gray-400 ml-auto text-[10px]">{m.platformName}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}

/** 🔧 已迁移至功能模块页渲染 */
export function ProactiveReplySection() {
  const config = useModelRoleStore((s) => s.proactiveReplyConfig);
  const setConfigRaw = useModelRoleStore((s) => s.setProactiveReplyConfig);
  const markConfigChanged = useProactiveReplyStore((s) => s.markConfigChanged);
  const selectedCharId = useCharacterStore((s) => s.selectedCharacterId);
  const characters = useCharacterStore((s) => s.characters);
  const conversations = useChatStore((s) => s.conversations);
  const selectedChar = characters.find(c => c.id === selectedCharId);
  const charConversations = conversations.filter(c => c.characterId === selectedCharId);
  const [newHour, setNewHour] = useState('');
  const [newMinute, setNewMinute] = useState('');
  // 🆕 增强2: 话题账本时间窗（configureTopicLedger 即时持久化，本地状态仅驱动 UI 显示）
  const [ledgerCfg, setLedgerCfg] = useState(() => getTopicLedgerConfig());

  const setConfig = (patch: Partial<ProactiveReplyConfig>) => {
    markConfigChanged();
    // ✅ 修复 Bug：当用户切换 proactiveEnabled 或 scheduledEnabled 时自动同步 enabled 总开关
    // 否则 triggerProactiveAfterReply 中 `!config.enabled` 检查会直接短路拒绝
    // （groupProactiveEnabled 是推送渠道开关，不作为触发源，不影响 enabled）
    const merged = { ...config, ...patch };
    const autoEnable = merged.proactiveEnabled || merged.scheduledEnabled;
    setConfigRaw({ ...patch, enabled: autoEnable });
  };

  const addTime = () => {
    const h = newHour.padStart(2, '0');
    const m = newMinute.padStart(2, '0');
    const time = `${h}:${m}`;
    if (!config.scheduledTimes.includes(time)) {
      setConfig({ scheduledTimes: [...config.scheduledTimes, time].sort() });
    }
    setNewHour('');
    setNewMinute('');
  };

  const removeTime = (t: string) => {
    setConfig({ scheduledTimes: config.scheduledTimes.filter(x => x !== t) });
  };

  return (
    <CollapsibleSection icon={MessageSquare} title="主动回复" desc="AI 主动发起对话" color="text-slate-700 dark:text-slate-300" defaultOpen={false} embedded>
      {/* Character status */}
      {!selectedChar ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
            <AlertTriangle size={14} className="text-amber-500 shrink-0" />
            <span className="text-xs text-amber-600 dark:text-amber-400">请先在角色管理页面选择一个角色</span>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-100 dark:bg-slate-800/20 border border-slate-300 dark:border-slate-900/50">
            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0" style={(() => {
              const s = document.documentElement.getAttribute('data-avatar-style') || 'circle';
              return s === 'squircle' ? { borderRadius: '22%' } : s === 'square' ? { borderRadius: '12px' } : { borderRadius: '9999px' };
            })()}>
              {selectedChar.avatar ? (
                <img src={selectedChar.avatar} alt={selectedChar.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">{selectedChar.name[0]}</span>
                </div>
              )}
            </div>
            <span className="text-xs text-slate-700 dark:text-slate-500">{selectedChar.name}</span>
          </div>
        )}

        {/* ===== 主动回复 ===== */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">主动回复</span>
            <span className="text-[10px] text-gray-400">— AI 回复后主动延续话题</span>
          </div>

          {/* 私聊主动回复 */}
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-sm text-gray-700 dark:text-gray-300">私聊主动回复</span>
              <p className="text-[10px] text-gray-400">AI 回复后在私聊中主动延续话题</p>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                checked={config.proactiveEnabled}
                onChange={(e) => setConfig({ proactiveEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
            </div>
          </label>

          {/* 群聊主动回复 */}
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-sm text-gray-700 dark:text-gray-300">群聊主动回复</span>
              <p className="text-[10px] text-gray-400">主动消息同时推送到外部群聊（无需@，受群白/黑名单门控）</p>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                checked={config.groupProactiveEnabled !== false}
                onChange={(e) => setConfig({ groupProactiveEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
            </div>
          </label>

          {(config.proactiveEnabled || config.groupProactiveEnabled) && (
            <div className="space-y-3 pl-1">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600 dark:text-gray-400">触发概率</span>
                  <span className="text-xs text-slate-700 dark:text-slate-500 font-medium">{config.proactiveChance}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={config.proactiveChance}
                  onChange={(e) => setConfig({ proactiveChance: Number(e.target.value) })}
                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-slate-700"
                />
                <p className="text-[10px] text-gray-400">每次 AI 回复后，以该概率主动发起下一轮对话</p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-600 dark:text-gray-400">延迟时间</span>
                  <span className="text-xs text-slate-700 dark:text-slate-500 font-medium">{config.proactiveDelayMs / 1000}秒</span>
                </div>
                <input
                  type="range"
                  min={1000}
                  max={30000}
                  step={1000}
                  value={config.proactiveDelayMs}
                  onChange={(e) => setConfig({ proactiveDelayMs: Number(e.target.value) })}
                  className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-slate-700"
                />
                <p className="text-[10px] text-gray-400">AI 回复后等待多久再发起主动对话</p>
              </div>
            </div>
          )}
        </div>

        {/* ===== 定时回复 ===== */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">定时回复</span>
            <span className="text-[10px] text-gray-400">— 在指定时间主动发消息</span>
          </div>

          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-700 dark:text-gray-300">启用定时回复</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={config.scheduledEnabled}
                onChange={(e) => setConfig({ scheduledEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
            </div>
          </label>

          {config.scheduledEnabled && (
            <div className="space-y-3 pl-1">
              {/* Start Time */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600 dark:text-gray-400">开始时间</span>
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={newHour}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' || (parseInt(v) >= 0 && parseInt(v) <= 23)) setNewHour(v);
                    }}
                    onBlur={() => { if (newHour || newMinute) addTime(); }}
                    placeholder="时"
                    className="w-8 text-center text-sm text-gray-700 dark:text-gray-300 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder-gray-400"
                  />
                  <span className="text-gray-400 font-medium">:</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={newMinute}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' || (parseInt(v) >= 0 && parseInt(v) <= 59)) setNewMinute(v);
                    }}
                    onBlur={() => { if (newHour || newMinute) addTime(); }}
                    placeholder="分"
                    className="w-8 text-center text-sm text-gray-700 dark:text-gray-300 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder-gray-400"
                  />
                </div>
              </div>

              {/* Conversation selector */}
              {charConversations.length > 1 && (
                <div className="space-y-1.5">
                  <span className="text-xs text-gray-500 dark:text-gray-400 px-1">目标对话</span>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                      <input
                        type="radio"
                        name="proactive-conv"
                        checked={!config.conversationId}
                        onChange={() => setConfig({ conversationId: '' })}
                        className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300 focus:ring-slate-700"
                      />
                      <span className="text-xs text-gray-700 dark:text-gray-300">自动选择最新对话</span>
                    </label>
                    {charConversations.map(conv => (
                      <label key={conv.id} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                        <input
                          type="radio"
                          name="proactive-conv"
                          checked={config.conversationId === conv.id}
                          onChange={() => setConfig({ conversationId: conv.id })}
                          className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300 focus:ring-slate-700"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-700 dark:text-gray-300 truncate block">{conv.title}</span>
                        </div>
                        <span className="text-[10px] text-gray-400">{conv.messages.length} 条</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Scheduled Times */}
              {config.scheduledTimes.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs text-gray-600 dark:text-gray-400">已添加的时间</span>
                  <div className="flex flex-wrap gap-1.5">
                    {config.scheduledTimes.map(t => (
                      <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/20 border border-slate-300 dark:border-slate-900/50 text-xs text-slate-700 dark:text-slate-500">
                        <Clock size={10} />
                        {t}
                        <button onClick={() => removeTime(t)} className="ml-0.5 hover:text-red-500 transition-colors"><X size={10} /></button>
                      </span>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400">到达指定时间时触发，每个时间每天仅触发一次</p>
                </div>
              )}

              {/* Daily Limit */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-gray-600 dark:text-gray-400">每日上限</span>
                  <p className="text-[10px] text-gray-400">每天最多主动回复次数</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={config.scheduledMaxPerDay}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // Allow empty or any number
                      if (raw === '') { setConfig({ scheduledMaxPerDay: 0 }); return; }
                      const v = parseInt(raw, 10);
                      if (!isNaN(v) && v >= 0) setConfig({ scheduledMaxPerDay: v });
                    }}
                    className="w-20 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-center font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-700 tabular-nums"
                  />
                  <span className="text-[10px] text-gray-400">次/天（0=无限制）</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 🆕 P2-4 打扰控制：安静时段 + 用户活跃跳过（对所有主动路径生效，定时任务来源除外） */}
        <div className="space-y-3 pt-1">
          <span className="text-xs text-gray-600 dark:text-gray-400 block">打扰控制</span>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-xs text-gray-700 dark:text-gray-300">安静时段</span>
              <p className="text-[10px] text-gray-400">此时间段内所有主动消息静默（定时任务内容除外）</p>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                checked={config.quietHoursEnabled}
                onChange={(e) => setConfig({ quietHoursEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
            </div>
          </label>

          {config.quietHoursEnabled && (
            <div className="flex items-center justify-between pl-1">
              <span className="text-xs text-gray-500">静默窗口</span>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={config.quietStart}
                  onChange={(e) => setConfig({ quietStart: e.target.value })}
                  className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-700"
                />
                <span className="text-xs text-gray-400">至</span>
                <input
                  type="time"
                  value={config.quietEnd}
                  onChange={(e) => setConfig({ quietEnd: e.target.value })}
                  className="px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-700"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-gray-700 dark:text-gray-300">活跃跳过</span>
              <p className="text-[10px] text-gray-400">用户最近发言后 N 分钟内，定时/链式主动暂不打扰</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={config.activeSkipMinutes}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') { setConfig({ activeSkipMinutes: 0 }); return; }
                  const v = parseInt(raw, 10);
                  if (!isNaN(v) && v >= 0) setConfig({ activeSkipMinutes: v });
                }}
                className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-center font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-700 tabular-nums"
              />
              <span className="text-[10px] text-gray-400">分钟（0=关闭）</span>
            </div>
          </div>
        </div>

        {/* 🆕 增强2: 话题防重复（账本时间窗 + 遗忘保留期） */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-gray-600 dark:text-gray-400 block">话题防重复</span>
              <p className="text-[10px] text-gray-400">主动消息不再反复追问刚聊过的话题（话题账本时间窗）</p>
            </div>
            <button
              onClick={() => clearTopicLedger(selectedCharId || undefined)}
              className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-[10px] text-gray-500 hover:text-red-500 hover:border-red-300 transition-colors"
            >
              清空当前角色账本
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">禁提窗口</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={ledgerCfg.freshMinutes}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0) setLedgerCfg(configureTopicLedger({ freshMinutes: v })); }}
                className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-center font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-700 tabular-nums"
              />
              <span className="text-[10px] text-gray-400">分钟内聊过严禁再提（默认 60）</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">冷却窗口</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={ledgerCfg.cooldownMinutes}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 0) setLedgerCfg(configureTopicLedger({ cooldownMinutes: v })); }}
                className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-center font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-700 tabular-nums"
              />
              <span className="text-[10px] text-gray-400">分钟内聊过不再主动问（默认 1440，即 1 天）</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">账本保留</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={ledgerCfg.retentionDays}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setLedgerCfg(configureTopicLedger({ retentionDays: v })); }}
                className="w-16 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-center font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-700 tabular-nums"
              />
              <span className="text-[10px] text-gray-400">天后过期淘汰（遗忘曲线，默认 7）</span>
            </div>
          </div>
        </div>

        {/* Custom Prompt */}
        <div>
          <span className="text-xs text-gray-600 dark:text-gray-400 block mb-1.5">自定义提示词</span>
          <textarea
            value={config.customPrompt}
            rows={2}
            onChange={(e) => setConfig({ customPrompt: e.target.value })}
            placeholder="可选：额外的主动回复上下文..."
            className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300 resize-none focus:outline-none focus:ring-1 focus:ring-slate-700"
          />
        </div>
    </CollapsibleSection>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const [config] = useState<UIConfig>(loadUIConfig);
  const conversations = useChatStore((state) => state.conversations);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const clearAllData = useChatStore((state) => state.clearAllData);
  const characters = useCharacterStore((s) => s.characters);
  const platforms = useConfigStore((state) => state.platforms);

  // Data management state
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [selectedConvIds, setSelectedConvIds] = useState<Set<string>>(new Set());
  const [selectedEmotionIds, setSelectedEmotionIds] = useState<Set<string>>(new Set());
  const [selectedAffinityIds, setSelectedAffinityIds] = useState<Set<string>>(new Set());
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Set<string>>(new Set());

  // Confirm delete modal state
  const [confirmDeleteType, setConfirmDeleteType] = useState<ConfirmDeleteType>(null);
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<ConfirmDeleteTarget>(null);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<Set<string>>(new Set());
  const [confirmDeleteStep, setConfirmDeleteStep] = useState<0 | 1>(0);
  const [confirmDeleteChecked, setConfirmDeleteChecked] = useState(false);

  const getCharacterName = (id: string) => characters.find(c => c.id === id)?.name || '';

  // YAML import/export state
  const yamlFileRef = useRef<HTMLInputElement>(null);
  const [yamlImportStatus, setYamlImportStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Chat search & export state
  const [chatQuery, setChatQuery] = useState('');
  const [chatSearchResults, setChatSearchResults] = useState<Conversation[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedConvs, setSelectedConvs] = useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt');

  // Debug log state
  const logs = useDebugLog((s) => s.logs);
  // 🆕 日志真实总数来自数据库（内存 logs 只是分页加载的子集，之前显示 200 造成误导）
  const [dbLogTotal, setDbLogTotal] = useState(0);
  const refreshDbLogTotal = () => {
    dbGetDebugLogsCount().then((n) => setDbLogTotal(n)).catch(() => {});
  };
  useEffect(() => {
    refreshDbLogTotal();
  }, []);

  // Recycle bin state
  const deletedEntries = useRecycleBinStore((s) => s.entries);
  const restoreEntry = useRecycleBinStore((s) => s.restoreEntry);
  const permanentlyDelete = useRecycleBinStore((s) => s.permanentlyDelete);
  const clearRecycleBin = useRecycleBinStore((s) => s.clearAll);
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null);
  const [permDeleteBinConfirm, setPermDeleteBinConfirm] = useState<string | null>(null);
  const [permDeleteBinChecked, setPermDeleteBinChecked] = useState(false);
  const [permDeleteBinStep, setPermDeleteBinStep] = useState<0 | 1>(0);

  // Clear all data modal state
  const [clearAllConfirm, setClearAllConfirm] = useState(false);
  const [clearAllChecked, setClearAllChecked] = useState(false);
  const [clearAllStep, setClearAllStep] = useState<0 | 1>(0);

  // Empty recycle bin modal state
  const [emptyBinConfirm, setEmptyBinConfirm] = useState(false);
  const [emptyBinChecked, setEmptyBinChecked] = useState(false);
  const [emptyBinStep, setEmptyBinStep] = useState<0 | 1>(0);

  const handleRestoreEntry = (id: string) => {
    const restored = restoreEntry(id);
    if (restored) {
      useMemoryStore.getState().addEntry(restored);
    }
    setRestoreConfirm(null);
  };

  const handlePermDeleteFromBin = () => {
    if (permDeleteBinStep === 0) {
      setPermDeleteBinStep(1);
      return;
    }
    if (!permDeleteBinChecked || !permDeleteBinConfirm) return;
    permanentlyDelete(permDeleteBinConfirm);
    setPermDeleteBinConfirm(null);
    setPermDeleteBinChecked(false);
    setPermDeleteBinStep(0);
  };

  const closePermDeleteBinModal = () => {
    setPermDeleteBinConfirm(null);
    setPermDeleteBinChecked(false);
    setPermDeleteBinStep(0);
  };

  // YAML import handler
  const handleYamlImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const imported = importConfigFromYaml(content);
        useConfigStore.setState({ platforms: imported });
        setYamlImportStatus('success');
        setTimeout(() => setYamlImportStatus('idle'), 3000);
      } catch {
        setYamlImportStatus('error');
        setTimeout(() => setYamlImportStatus('idle'), 3000);
      }
    };
    reader.readAsText(file);
    if (yamlFileRef.current) yamlFileRef.current.value = '';
  };

  // YAML export handler
  const handleYamlExport = () => {
    const yamlContent = exportConfigToYaml(platforms);
    downloadYaml(yamlContent, 'config.yaml');
  };

  // Clear all data handler - use custom modal instead of window.confirm
  const handleClearAllData = () => {
    setClearAllConfirm(true);
    setClearAllChecked(false);
    setClearAllStep(0);
  };

  const handleConfirmClearAll = () => {
    if (clearAllStep === 0) {
      setClearAllStep(1);
      return;
    }
    if (!clearAllChecked) return;
    clearAllData();
    setClearAllConfirm(false);
    setClearAllChecked(false);
    setClearAllStep(0);
  };

  const closeClearAllModal = () => {
    setClearAllConfirm(false);
    setClearAllChecked(false);
    setClearAllStep(0);
  };

  // Empty recycle bin handler
  const handleEmptyBin = () => {
    setEmptyBinConfirm(true);
    setEmptyBinChecked(false);
    setEmptyBinStep(0);
  };

  const handleConfirmEmptyBin = () => {
    if (emptyBinStep === 0) {
      setEmptyBinStep(1);
      return;
    }
    if (!emptyBinChecked) return;
    clearRecycleBin();
    setEmptyBinConfirm(false);
    setEmptyBinChecked(false);
    setEmptyBinStep(0);
  };

  const closeEmptyBinModal = () => {
    setEmptyBinConfirm(false);
    setEmptyBinChecked(false);
    setEmptyBinStep(0);
  };

  // ========== Data Management Handlers ==========

  // Open confirm delete modal
  const openConfirmDelete = (type: ConfirmDeleteType, target: ConfirmDeleteTarget, ids: Set<string>) => {
    setConfirmDeleteType(type);
    setConfirmDeleteTarget(target);
    setConfirmDeleteIds(ids);
    setConfirmDeleteStep(0);
    setConfirmDeleteChecked(false);
  };

  // Close confirm delete modal
  const closeConfirmDelete = () => {
    setConfirmDeleteType(null);
    setConfirmDeleteTarget(null);
    setConfirmDeleteIds(new Set());
    setConfirmDeleteStep(0);
    setConfirmDeleteChecked(false);
  };

  // Execute confirm delete
  const executeConfirmDelete = async () => {
    if (confirmDeleteStep === 0) {
      setConfirmDeleteStep(1);
      return;
    }
    if (!confirmDeleteChecked) return;

    if (confirmDeleteTarget === 'conversation') {
      for (const id of confirmDeleteIds) {
        deleteConversation(id);
      }
      setSelectedConvIds(prev => {
        const next = new Set(prev);
        for (const id of confirmDeleteIds) next.delete(id);
        return next;
      });
    } else if (confirmDeleteTarget === 'emotion') {
      const mindStore = useCharacterMindStore.getState();
      for (const charId of confirmDeleteIds) {
        mindStore.updateEmotion(charId, 'anticipation', 0);
      }
      setSelectedEmotionIds(new Set());
    } else if (confirmDeleteTarget === 'affinity') {
      const mindStore = useCharacterMindStore.getState();
      const affinityStates = { ...mindStore.affinityStates };
      for (const charId of confirmDeleteIds) {
        delete affinityStates[charId];
      }
      useCharacterMindStore.setState({ affinityStates });
      localStorage.setItem('ai-character-affinities', JSON.stringify(affinityStates));
      setSelectedAffinityIds(new Set());
    } else if (confirmDeleteTarget === 'memoryEntry') {
      const memStore = useMemoryStore.getState();
      if (confirmDeleteType === 'soft') {
        for (const id of confirmDeleteIds) {
          memStore.softDeleteEntry(id);
        }
      } else {
        for (const id of confirmDeleteIds) {
          memStore.permanentDeleteEntry(id);
        }
      }
      setSelectedMemoryIds(new Set());
    } else if (confirmDeleteTarget === 'log') {
      const debugLog = useDebugLog.getState();
      debugLog.remove(Array.from(confirmDeleteIds));
    } else if (confirmDeleteTarget === 'allLog') {
      // 🆕 清空全部日志：数据库 + 内存 + 计数刷新（此前清空只删内存 200 条，数据库里依然上万）
      await dbClearDebugLogs();
      useDebugLog.setState({ logs: [], totalCount: 0, hasMore: true, nextCursor: null });
      setDbLogTotal(0);
    }

    closeConfirmDelete();
  };

  // Get items for each data type
  const getConversationItems = () => conversations.map(c => ({
    id: c.id,
    label: c.title,
    sublabel: `${c.messages.length} 条消息 · ${new Date(c.updatedAt).toLocaleDateString('zh-CN')}`,
  }));

  const getEmotionItems = () => Object.entries(useCharacterMindStore.getState().emotionStates).map(([charId, state]) => ({
    id: charId,
    label: getCharacterName(charId),
    sublabel: `情绪: ${state.emotion} · 强度: ${state.intensity}`,
  }));

  const getAffinityItems = () => Object.entries(useCharacterMindStore.getState().affinityStates).map(([charId, state]) => ({
    id: charId,
    label: getCharacterName(charId),
    sublabel: `好感度: ${typeof state.level === 'number' ? state.level.toFixed(2) : state.level} · 阶段: ${state.stage || '未知'}`,
  }));

  const getMemoryEntryItems = () => {
    const allEntries = Object.values(useMemoryStore.getState().entries).flat();
    return allEntries.map(e => ({
      id: e.id,
      label: e.title,
      sublabel: e.content,
    }));
  };

  // Select all handlers
  const toggleSelectAllConversations = () => {
    const items = getConversationItems();
    if (selectedConvIds.size === items.length) {
      setSelectedConvIds(new Set());
    } else {
      setSelectedConvIds(new Set(items.map(i => i.id)));
    }
  };

  const toggleSelectAllEmotions = () => {
    const items = getEmotionItems();
    if (selectedEmotionIds.size === items.length) {
      setSelectedEmotionIds(new Set());
    } else {
      setSelectedEmotionIds(new Set(items.map(i => i.id)));
    }
  };

  const toggleSelectAllAffinity = () => {
    const items = getAffinityItems();
    if (selectedAffinityIds.size === items.length) {
      setSelectedAffinityIds(new Set());
    } else {
      setSelectedAffinityIds(new Set(items.map(i => i.id)));
    }
  };

  const toggleSelectAllMemoryEntries = () => {
    const items = getMemoryEntryItems();
    if (selectedMemoryIds.size === items.length) {
      setSelectedMemoryIds(new Set());
    } else {
      setSelectedMemoryIds(new Set(items.map(i => i.id)));
    }
  };

  // Import conversations handler
  const handleImportConversations = async () => {
    try {
      const imported = await importConversations();
      if (imported.length > 0) {
        const current = useChatStore.getState().conversations;
        const newConvs = [...imported, ...current];
        useChatStore.setState({ conversations: newConvs });
        alert(`成功导入 ${imported.length} 个对话`);
      }
    } catch {
      alert('导入失败，请检查文件格式');
    }
  };

  // Affinity export/import handlers
  const handleExportAffinity = () => {
    const mindStore = useCharacterMindStore.getState();
    exportAffinityData(mindStore.affinityStates, getCharacterName);
  };

  const handleImportAffinity = async () => {
    try {
      const imported = await importAffinityData();
      if (Object.keys(imported).length > 0) {
        const mindStore = useCharacterMindStore.getState();
        const merged = { ...mindStore.affinityStates, ...imported };
        useCharacterMindStore.setState({ affinityStates: merged });
        localStorage.setItem('ai-character-affinities', JSON.stringify(merged));
        alert(`成功导入 ${Object.keys(imported).length} 个角色的好感度数据`);
      }
    } catch {
      alert('导入失败，请检查文件格式');
    }
  };

  // Memory entries export/import handlers
  const handleExportMemoryEntries = () => {
    const memStore = useMemoryStore.getState();
    exportMemoryEntries(memStore.entries, getCharacterName);
  };

  const handleImportMemoryEntries = async () => {
    try {
      const imported = await importMemoryEntries();
      if (Object.keys(imported).length > 0) {
        const memStore = useMemoryStore.getState();
        const merged = { ...memStore.entries, ...imported };
        useMemoryStore.setState({ entries: merged });
        localStorage.setItem('ai-memory-entries', JSON.stringify(merged));
        alert(`成功导入 ${Object.keys(imported).length} 个角色的记忆条目`);
      }
    } catch {
      alert('导入失败，请检查文件格式');
    }
  };

  // Debug log handlers
  const handleExportLogs = () => {
    if (logs.length === 0) {
      alert('没有日志可导出');
      return;
    }
    const data = logs.map(l => ({
      type: l.type,
      message: l.message,
      time: new Date(l.timestamp).toISOString(),
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xingmian-logs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportLogs = async () => {
    try {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json';
      fileInput.onchange = (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const imported = JSON.parse(event.target?.result as string);
            if (!Array.isArray(imported)) throw new Error();
            let count = 0;
            imported.forEach((item: { type: string; message: string; time: string }) => {
              if (item.type && item.message && item.time) {
                useDebugLog.getState().add(item.type as DebugLogType, item.message);
                count++;
              }
            });
            alert(`成功导入 ${count} 条日志`);
          } catch {
            alert('导入失败，请检查文件格式');
          }
        };
        reader.readAsText(file);
      };
      fileInput.click();
    } catch {
      alert('导入失败');
    }
  };

  useEffect(() => {
    applyTheme(config.theme);
    applyFontSize(config.fontSize);
    applyBubbleStyle(config.bubbleStyle);
    applyAccentColor(config.accentColor);
    applyAvatarStyle(config.avatarStyle);
  }, [config]);

  // Search conversations
  const searchConversations = () => {
    if (!chatQuery.trim()) {
      setChatSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    setIsSearching(true);
    const results = conversations.filter((conv) =>
      conv.title.toLowerCase().includes(chatQuery.toLowerCase()) ||
      conv.messages.some((m) => m.content.toLowerCase().includes(chatQuery.toLowerCase()))
    );
    setChatSearchResults(results);
    setShowSearchResults(true);
    setIsSearching(false);
  };

  // Toggle conversation selection for export
  const toggleSelect = (id: string) => {
    setSelectedConvs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const allIds = new Set<string>(conversations.map((c) => c.id));
    setSelectedConvs(allIds);
  };

  const deselectAll = () => {
    setSelectedConvs(new Set());
  };

  const exportSelected = () => {
    const selected = conversations.filter((c) => selectedConvs.has(c.id));
    if (selected.length === 0) return;
    exportConversations(selected, exportFormat, getCharacterName);
  };

  const exportSingle = (convId: string) => {
    const conv = conversations.find((c) => c.id === convId);
    if (conv) {
      exportSingleConversation(conv, exportFormat, getCharacterName(conv.characterId));
    }
  };

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('/chat')}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">设置</h1>
        </div>

        <div className="space-y-4">
          {/* 🔧 记忆分析/学习分析/模型角色/主动回复/V2系统设置 已迁移至「功能模块」页 */}
          {/* 🔧 功能模块注册表卡片也已迁移至「功能模块」页 */}

          {/* API Config - YAML Import/Export */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <FileCode size={16} className="text-gray-500" />
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">配置导入导出</h2>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-400">使用 YAML 文件管理 API 配置，方便备份和迁移</p>
              <div className="flex gap-2">
                <input
                  ref={yamlFileRef}
                  type="file"
                  accept=".yaml,.yml"
                  onChange={handleYamlImport}
                  className="hidden"
                />
                <button
                  onClick={handleYamlExport}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                    bg-slate-700 text-white text-sm hover:bg-slate-800 transition-colors"
                >
                  <Download size={14} />
                  导出 YAML
                </button>
                <button
                  onClick={() => yamlFileRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                    border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm
                    hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <Upload size={14} />
                  导入 YAML
                </button>
              </div>
              {yamlImportStatus === 'success' && (
                <p className="text-xs text-green-600 text-center">配置导入成功！</p>
              )}
              {yamlImportStatus === 'error' && (
                <p className="text-xs text-red-500 text-center">配置文件格式错误，请检查</p>
              )}
            </div>
          </section>

          {/* Learning Data Import/Export */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-gray-500" />
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">学习记录导入导出</h2>
            </div>
            <p className="text-xs text-gray-400 mb-3">备份或迁移角色的学习数据（常用词汇和表达）</p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const profiles = useLearningStore.getState().profiles;
                  const charStore = useCharacterStore.getState();
                  await exportLearningData(profiles, (id) => charStore.characters.find(c => c.id === id)?.name || id);
                }}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                  bg-slate-700 text-white text-sm hover:bg-slate-800 transition-colors"
              >
                <Download size={14} />
                导出学习记录
              </button>
              <button
                onClick={async () => {
                  const imported = await importLearningData();
                  if (Object.keys(imported).length > 0) {
                    const store = useLearningStore.getState();
                    for (const [charId, profile] of Object.entries(imported)) {
                      store.updateProfile(charId, profile);
                    }
                    alert(`已导入 ${Object.keys(imported).length} 个角色的学习数据`);
                  }
                }}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                  border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm
                  hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <Upload size={14} />
                导入学习记录
              </button>
            </div>
          </section>

          {/* Chat Search */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Search size={16} className="text-gray-500" />
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">聊天记录查询</h2>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatQuery}
                  onChange={(e) => setChatQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchConversations()}
                  placeholder="输入关键词搜索聊天记录..."
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 
                    bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm
                    focus:outline-none focus:ring-2 focus:ring-slate-700"
                />
                <button
                  onClick={searchConversations}
                  disabled={isSearching}
                  className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm
                    hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  {isSearching ? '搜索中...' : '搜索'}
                </button>
              </div>

              {showSearchResults && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {chatSearchResults.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">未找到匹配的记录</p>
                  ) : (
                    <>
                      <p className="text-xs text-gray-400">找到 {chatSearchResults.length} 条记录</p>
                      {chatSearchResults.map((conv) => {
                        const matchingMsg = conv.messages.find((m) =>
                          m.content.toLowerCase().includes(chatQuery.toLowerCase())
                        );
                        return (
                          <div
                            key={conv.id}
                            className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
                            onClick={() => navigate('/chat')}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <MessageSquare size={12} className="text-gray-400" />
                              <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                {conv.title}
                              </span>
                              <span className="text-xs text-gray-400 ml-auto flex items-center gap-1">
                                <Clock size={10} />
                                {new Date(conv.updatedAt).toLocaleDateString('zh-CN')}
                              </span>
                            </div>
                            {matchingMsg && (
                              <p className="text-xs text-gray-500 line-clamp-2 ml-5">
                                {matchingMsg.content}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Chat Export */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Download size={16} className="text-gray-500" />
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">聊天记录导入导出</h2>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={handleImportConversations}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                    border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm
                    hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <Upload size={14} />
                  导入聊天记录
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">导出格式:</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setExportFormat('txt')}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all border ${
                      exportFormat === 'txt'
                        ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <FileText size={12} />
                    TXT
                  </button>
                  <button
                    onClick={() => setExportFormat('md')}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all border ${
                      exportFormat === 'md'
                        ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <FileDown size={12} />
                    MD
                  </button>
                  <button
                    onClick={() => setExportFormat('json')}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all border ${
                      exportFormat === 'json'
                        ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <FileJson size={12} />
                    JSON
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (conversations.length > 0) exportConversations(conversations, exportFormat, getCharacterName);
                  }}
                  disabled={conversations.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                    bg-slate-700 text-white text-sm hover:bg-slate-800 transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download size={14} />
                  导出全部 ({conversations.length}条)
                </button>
              </div>

              {conversations.length > 0 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">逐条导出</span>
                    <div className="flex gap-2">
                      <button onClick={selectAll} className="text-xs text-slate-700 dark:text-slate-500 hover:underline">全选</button>
                      <button onClick={deselectAll} className="text-xs text-gray-400 hover:underline">取消</button>
                      {selectedConvs.size > 0 && (
                        <button onClick={exportSelected} className="text-xs text-slate-700 dark:text-slate-500 hover:underline">
                          导出选中 ({selectedConvs.size})
                        </button>
                      )}
                    </div>
                  </div>
                  {conversations.map((conv) => (
                    <div key={conv.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <input
                        type="checkbox"
                        checked={selectedConvs.has(conv.id)}
                        onChange={() => toggleSelect(conv.id)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-slate-700 focus:ring-slate-700"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{conv.title}</p>
                        <p className="text-xs text-gray-400">{conv.messages.length} 条消息</p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => exportSingle(conv.id)}
                          className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-slate-700 transition-colors"
                          title="导出"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          onClick={() => deleteConversation(conv.id)}
                          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-colors"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Affinity Data Import/Export */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Heart size={16} className="text-gray-500" />
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">好感度数据</h2>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-400">导出或导入角色好感度数据，用于备份或迁移</p>
              <div className="flex gap-2">
                <button
                  onClick={handleExportAffinity}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                    bg-slate-700 text-white text-sm hover:bg-slate-800 transition-colors"
                >
                  <Download size={14} />
                  导出好感度
                </button>
                <button
                  onClick={handleImportAffinity}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                    border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm
                    hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <Upload size={14} />
                  导入好感度
                </button>
              </div>
            </div>
          </section>

          {/* Memory Entries Import/Export */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Brain size={16} className="text-gray-500" />
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">记忆条目数据</h2>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-400">导出或导入角色记忆条目（总结、思考、分析等）</p>
              <div className="flex gap-2">
                <button
                  onClick={handleExportMemoryEntries}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                    bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition-colors"
                >
                  <Download size={14} />
                  导出记忆条目
                </button>
                <button
                  onClick={handleImportMemoryEntries}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg 
                    border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm
                    hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <Upload size={14} />
                  导入记忆条目
                </button>
              </div>
            </div>
          </section>

          {/* Log Data */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Terminal size={16} className="text-gray-500" />
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">日志数据</h2>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-400">导出或导入运行日志，用于备份或排查问题</p>
              <div className="flex gap-2">
                <button
                  onClick={handleExportLogs}
                  disabled={logs.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg
                    bg-slate-700 text-white text-sm hover:bg-slate-800 transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download size={14} />
                  导出日志
                </button>
                <button
                  onClick={handleImportLogs}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg
                    border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm
                    hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <Upload size={14} />
                  导入日志
                </button>
              </div>
            </div>
          </section>

          {/* Recycle Bin */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <RotateCcw size={16} className="text-gray-500" />
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">回收站</h2>
              {deletedEntries.length > 0 && (
                <span className="ml-auto text-xs text-gray-400">{deletedEntries.length} 条已删除记忆</span>
              )}
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-400">已删除的记忆条目，可在此恢复或彻底删除</p>
              {deletedEntries.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">回收站为空</p>
              ) : (
                <>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {deletedEntries.map((entry, index) => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 transition-colors"
                        style={{ animation: `listItemIn 0.15s ease-out ${index * 0.02}s both` }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                            {entry.title}
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {entry.content}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            删除于 {new Date(entry.deletedAt).toLocaleDateString('zh-CN')}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() => setRestoreConfirm(entry.id)}
                            className="p-1.5 rounded hover:bg-green-50 dark:hover:bg-green-900/20 text-gray-400 hover:text-green-600 transition-colors"
                            title="恢复"
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            onClick={() => { setPermDeleteBinConfirm(entry.id); setPermDeleteBinChecked(false); setPermDeleteBinStep(0); }}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                            title="彻底删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleEmptyBin}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-red-500
                        hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 size={12} />
                      清空回收站
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 🔧 B1: 功能模块注册表卡片已迁移至「功能模块」页 */}

          {/* Data Management */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Trash2 size={16} className="text-gray-500" />
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">数据管理</h2>
            </div>
            <p className="text-xs text-gray-400 mb-4">点击展开查看各类数据详情，勾选后可移入回收站或彻底删除</p>

            <div className="space-y-2">
              {/* Conversations */}
              <DataManageCard
                icon={<MessageSquare size={14} className="text-orange-500" />}
                title="聊天记录"
                count={conversations.length}
                countLabel="个对话"
                description="所有对话的消息记录"
                isExpanded={expandedSection === 'conversations'}
                onToggle={() => setExpandedSection(expandedSection === 'conversations' ? null : 'conversations')}
                items={getConversationItems()}
                selectedIds={selectedConvIds}
                onToggleItem={(id) => setSelectedConvIds(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; })}
                onSelectAll={toggleSelectAllConversations}
                onSoftDelete={() => openConfirmDelete('soft', 'conversation', selectedConvIds)}
                onPermanentDelete={() => openConfirmDelete('permanent', 'conversation', selectedConvIds)}
                accentColor="orange"
                supportsSoftDelete={false}
              />

              {/* Emotions */}
              <DataManageCard
                icon={<Heart size={14} className="text-blue-500" />}
                title="情绪记录"
                count={Object.keys(useCharacterMindStore.getState().emotionStates).length}
                countLabel="个角色"
                description="角色情绪分析历史"
                isExpanded={expandedSection === 'emotions'}
                onToggle={() => setExpandedSection(expandedSection === 'emotions' ? null : 'emotions')}
                items={getEmotionItems()}
                selectedIds={selectedEmotionIds}
                onToggleItem={(id) => setSelectedEmotionIds(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; })}
                onSelectAll={toggleSelectAllEmotions}
                onSoftDelete={() => openConfirmDelete('soft', 'emotion', selectedEmotionIds)}
                onPermanentDelete={() => openConfirmDelete('permanent', 'emotion', selectedEmotionIds)}
                accentColor="blue"
                supportsSoftDelete={false}
              />

              {/* Affinity */}
              <DataManageCard
                icon={<Brain size={14} className="text-slate-700 dark:text-slate-300" />}
                title="好感度"
                count={Object.keys(useCharacterMindStore.getState().affinityStates).length}
                countLabel="个角色"
                description="角色好感度数据"
                isExpanded={expandedSection === 'affinity'}
                onToggle={() => setExpandedSection(expandedSection === 'affinity' ? null : 'affinity')}
                items={getAffinityItems()}
                selectedIds={selectedAffinityIds}
                onToggleItem={(id) => setSelectedAffinityIds(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; })}
                onSelectAll={toggleSelectAllAffinity}
                onSoftDelete={() => openConfirmDelete('soft', 'affinity', selectedAffinityIds)}
                onPermanentDelete={() => openConfirmDelete('permanent', 'affinity', selectedAffinityIds)}
                accentColor="purple"
                supportsSoftDelete={false}
              />

              {/* Memory Entries */}
              <DataManageCard
                icon={<FileText size={14} className="text-indigo-500" />}
                title="记忆条目"
                count={Object.values(useMemoryStore.getState().entries).reduce((sum, arr) => sum + arr.length, 0)}
                countLabel="条记忆"
                description="总结、思考、分析、用户消息等"
                isExpanded={expandedSection === 'memoryEntries'}
                onToggle={() => setExpandedSection(expandedSection === 'memoryEntries' ? null : 'memoryEntries')}
                items={getMemoryEntryItems()}
                selectedIds={selectedMemoryIds}
                onToggleItem={(id) => setSelectedMemoryIds(prev => { const n = new Set(prev); if (n.has(id)) { n.delete(id); } else { n.add(id); } return n; })}
                onSelectAll={toggleSelectAllMemoryEntries}
                onSoftDelete={() => openConfirmDelete('soft', 'memoryEntry', selectedMemoryIds)}
                onPermanentDelete={() => openConfirmDelete('permanent', 'memoryEntry', selectedMemoryIds)}
                accentColor="indigo"
                supportsSoftDelete={true}
              />

              {/* Debug Logs —— 🆕 计数来自数据库全量；日志是海量数据不做逐条勾选，提供清空全部 */}
              <DataManageCard
                icon={<Terminal size={14} className="text-gray-500" />}
                title="运行日志"
                count={dbLogTotal}
                countLabel="条日志"
                description="系统运行与调试日志（数据库全量）"
                isExpanded={expandedSection === 'logs'}
                onToggle={() => setExpandedSection(expandedSection === 'logs' ? null : 'logs')}
                items={[]}
                selectedIds={new Set()}
                onToggleItem={() => {}}
                onSelectAll={() => {}}
                onSoftDelete={() => {}}
                onPermanentDelete={() => openConfirmDelete('permanent', 'allLog', new Set(['__all__']))}
                accentColor="gray"
                supportsSoftDelete={false}
                footer={
                  <div className="flex items-center justify-between gap-2 px-1 pt-2">
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      逐条/按筛选删除请前往「运行日志」页；7 天前的旧日志会在启动时自动清理
                    </p>
                    <button
                      onClick={() => openConfirmDelete('permanent', 'allLog', new Set(['__all__']))}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs
                        text-white bg-red-500 hover:bg-red-600 transition-all duration-200 active:scale-95"
                    >
                      <Trash2 size={12} />
                      清空全部日志
                    </button>
                  </div>
                }
              />

              {/* Danger Zone */}
              <div className="mt-3">
                <button
                  onClick={handleClearAllData}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg 
                    text-red-500 text-sm text-left
                    hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200 active:scale-[0.98]"
                >
                  <AlertTriangle size={14} />
                  <div>
                    <p className="font-medium">清除所有数据</p>
                    <p className="text-xs text-red-400">以上全部清除，不可恢复</p>
                  </div>
                </button>
              </div>
            </div>
          </section>

          {/* About */}
          <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm text-center">
            <h2 className="font-medium text-gray-900 dark:text-gray-100">xingmian</h2>
            <p className="text-sm text-gray-500 mt-1">版本 1.0.0</p>
            <p className="text-xs text-gray-400 mt-2">情感AI聊天软件</p>
          </section>
        </div>
      </div>

      {/* Confirm Delete Modal */}
      {confirmDeleteType && confirmDeleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={closeConfirmDelete} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-full ${
                confirmDeleteType === 'soft'
                  ? 'bg-amber-100 dark:bg-amber-900/30'
                  : 'bg-red-100 dark:bg-red-900/30'
              }`}>
                {confirmDeleteType === 'soft' ? (
                  <RotateCcw size={20} className="text-amber-600 dark:text-amber-400" />
                ) : (
                  <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {confirmDeleteStep === 0
                    ? (confirmDeleteType === 'soft' ? '移入回收站？' : '确认彻底删除？')
                    : '最后确认'
                  }
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {confirmDeleteStep === 0
                    ? (confirmDeleteTarget === 'allLog'
                        ? `将清空数据库中全部 ${dbLogTotal} 条运行日志，此操作不可撤销`
                        : `将删除 ${confirmDeleteIds.size} 项${confirmDeleteType === 'soft' ? '，可从回收站恢复' : '，此操作不可撤销'}`)
                    : '请勾选确认后操作'
                  }
                </p>
              </div>
            </div>

            {confirmDeleteStep === 1 && (
              <label className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmDeleteChecked}
                  onChange={(e) => setConfirmDeleteChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-xs text-red-700 dark:text-red-300">
                  我已知道后果，这{confirmDeleteIds.size} 项数据将{confirmDeleteType === 'soft' ? '移入回收站' : '无法恢复'}
                </span>
              </label>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={closeConfirmDelete}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={executeConfirmDelete}
                disabled={confirmDeleteStep === 1 && !confirmDeleteChecked}
                className={`px-4 py-2 rounded-lg text-sm text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 ${
                  confirmDeleteType === 'soft'
                    ? 'bg-amber-500 hover:bg-amber-600'
                    : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {confirmDeleteStep === 0 ? '下一步' : (confirmDeleteType === 'soft' ? '移入回收站' : '彻底删除')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Animation Keyframes */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes overlayFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalSlideIn {
          from { 
            opacity: 0; 
            transform: scale(0.95) translateY(10px); 
          }
          to { 
            opacity: 1; 
            transform: scale(1) translateY(0); 
          }
        }
        @keyframes listItemFadeIn {
          from { 
            opacity: 0; 
            transform: translateX(-8px); 
          }
          to { 
            opacity: 1; 
            transform: translateX(0); 
          }
        }
        @keyframes listItemIn {
          from { opacity: 0; transform: translateY(6px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {/* Restore Confirmation Modal */}
      {restoreConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setRestoreConfirm(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30">
                <RotateCcw size={20} className="text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">恢复记忆</h3>
                <p className="text-xs text-gray-500 mt-0.5">确定要恢复这条记忆吗？</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRestoreConfirm(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleRestoreEntry(restoreConfirm)}
                className="px-4 py-2 rounded-lg text-sm text-white bg-green-600 hover:bg-green-700 transition-colors active:scale-95"
              >
                恢复
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete from Bin Modal */}
      {permDeleteBinConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={closePermDeleteBinModal} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {permDeleteBinStep === 0 ? '确认彻底删除？' : '最后确认'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {permDeleteBinStep === 0 ? '此操作不可撤销' : '请勾选确认后删除'}
                </p>
              </div>
            </div>
            {permDeleteBinStep === 1 && (
              <label className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={permDeleteBinChecked}
                  onChange={(e) => setPermDeleteBinChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-xs text-red-700 dark:text-red-300">
                  我已知道后果，这条记忆将无法恢复
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={closePermDeleteBinModal}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handlePermDeleteFromBin}
                disabled={permDeleteBinStep === 1 && !permDeleteBinChecked}
                className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {permDeleteBinStep === 0 ? '下一步' : '彻底删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty Recycle Bin Modal */}
      {emptyBinConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={closeEmptyBinModal} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <Trash2 size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {emptyBinStep === 0 ? '清空回收站？' : '最后确认'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {emptyBinStep === 0 ? `${deletedEntries.length} 条记忆将被永久删除` : '请勾选确认后清空'}
                </p>
              </div>
            </div>
            {emptyBinStep === 1 && (
              <label className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={emptyBinChecked}
                  onChange={(e) => setEmptyBinChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-xs text-red-700 dark:text-red-300">
                  我已知道后果，所有已删除记忆将无法恢复
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={closeEmptyBinModal}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmEmptyBin}
                disabled={emptyBinStep === 1 && !emptyBinChecked}
                className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {emptyBinStep === 0 ? '下一步' : '清空'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Data Modal */}
      {clearAllConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={closeClearAllModal} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {clearAllStep === 0 ? '清除所有数据？' : '最后确认'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {clearAllStep === 0 ? '此操作将删除所有数据且不可恢复' : '请勾选确认后删除'}
                </p>
              </div>
            </div>
            {clearAllStep === 1 && (
              <label className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearAllChecked}
                  onChange={(e) => setClearAllChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-xs text-red-700 dark:text-red-300">
                  我已知道后果，所有数据将无法恢复
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={closeClearAllModal}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmClearAll}
                disabled={clearAllStep === 1 && !clearAllChecked}
                className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                {clearAllStep === 0 ? '下一步' : '全部删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
