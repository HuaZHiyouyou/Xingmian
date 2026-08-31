/**
 * ModulePageShell
 * 通用模块页面外壳 —— 功能模块 / Skills / 插件 / 日志 等子页面统一复用。
 *
 * 提供：返回按钮 · 标题 · 统计卡片 · 筛选行 · 批量操作 · 折叠 Section · 空态 · 操作按钮。
 */
import { useState, type ElementType, type ReactNode } from 'react';
import { ArrowLeft, Trash2, X, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/* ────────────────────── Confirm Modal ────────────────────── */

export function ConfirmModal({
  open, onClose, onConfirm,
  title, description, icon: Icon,
  confirmLabel = '确认', cancelLabel = '取消',
  variant = 'danger',
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  icon?: ElementType;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
}) {
  if (!open) return null;

  const variantStyles = {
    danger: {
      iconBg: 'bg-red-100 dark:bg-red-900/30',
      iconColor: 'text-red-500',
      confirmBg: 'bg-red-500 hover:bg-red-600 shadow-red-500/20',
    },
    warning: {
      iconBg: 'bg-amber-100 dark:bg-amber-900/30',
      iconColor: 'text-amber-500',
      confirmBg: 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20',
    },
    primary: {
      iconBg: 'bg-slate-200 dark:bg-slate-800/30',
      iconColor: 'text-slate-700 dark:text-slate-300',
      confirmBg: 'bg-slate-700 hover:bg-slate-700 shadow-slate-700/20',
    },
  };

  const vs = variantStyles[variant];
  const DisplayIcon = Icon || AlertTriangle;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
        >
          <X size={14} />
        </button>
        <div className="flex flex-col items-center text-center">
          <div className={`w-12 h-12 rounded-2xl ${vs.iconBg} flex items-center justify-center mb-3`}>
            <DisplayIcon size={22} className={vs.iconColor} />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{title}</h3>
          {description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">{description}</p>
          )}
        </div>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all active:scale-[0.97]"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className={`flex-1 px-4 py-2 rounded-xl text-xs font-medium text-white ${vs.confirmBg} shadow-lg transition-all active:scale-[0.97]`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────── Shell ────────────────────── */

interface ModulePageShellProps {
  title: string;
  subtitle?: string;
  icon: ElementType;
  iconBgClass?: string;
  headerAction?: ReactNode;
  stats?: { label: string; value: number | string; color: string; delay: string }[];
  filters?: ReactNode;
  selectable?: boolean;
  selectedCount?: number;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  onDeleteSelected?: () => void;
  selectMode?: boolean;
  setSelectMode?: (v: boolean) => void;
  selectedIds?: Set<string>;
  children: ReactNode;
}

export function ModulePageShell({
  title, subtitle, icon: Icon,
  headerAction,
  stats, filters, selectable, children,
}: ModulePageShellProps) {
  const navigate = useNavigate();
  const [selectMode, setSelectMode] = useState(false);

  const exitSelect = () => {
    setSelectMode(false);
  };

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 animate-[fadeUp_0.3s_ease-out]">

        {/* ─── Header ─── */}
        <div className="flex items-center gap-3 mb-6 animate-[fadeUp_0.3s_ease-out_0.05s_both]">
          <button
            onClick={() => navigate('/chat')}
            className="p-2 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500 transition-all duration-200 active:scale-90"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center transition-transform duration-200 hover:scale-105">
              <Icon size={20} className="text-gray-600 dark:text-gray-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
              {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {headerAction}
          {selectable && (
            selectMode ? (
              <div className="flex items-center gap-2 animate-[fadeIn_0.15s_ease-out]">
                <button onClick={exitSelect} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">取消</button>
              </div>
            ) : (
              <button
                onClick={() => setSelectMode(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-gray-500
                  hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-red-500 transition-all duration-200 active:scale-95"
              >
                <Trash2 size={12} />
                选择删除
              </button>
            )
          )}
        </div>

        {/* ─── Stats ─── */}
        {stats && stats.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            {stats.map((s) => (
              <div
                key={s.label}
                className="bg-white dark:bg-gray-900 rounded-2xl p-3 border border-gray-100 dark:border-gray-800
                  animate-[scaleIn_0.25s_ease-out_both] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                style={{ animationDelay: s.delay } as React.CSSProperties}
              >
                <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ─── Filters ─── */}
        {filters && (
          <div className="mb-4 animate-[fadeUp_0.3s_ease-out_0.12s_both]">
            {filters}
          </div>
        )}

        {/* ─── Batch bar ─── */}
        {selectMode && (
          <div className="flex items-center gap-2 mb-4 p-2.5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 animate-[slideDown_0.2s_ease-out]">
            <span className="text-xs text-gray-500">批量操作</span>
          </div>
        )}

        {/* ─── Content ─── */}
        <div className="space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Sub-components ──────────────────────────── */

/** 可折叠 Section — 无分割线 + 平滑展开动画 */
export function ModuleSection({
  title, icon: Icon, color = 'text-gray-500', count,
  headerRight, defaultOpen = true, animateDelay = '0s', children,
}: {
  title: string;
  icon: ElementType;
  color?: string;
  count?: number;
  headerRight?: ReactNode;
  defaultOpen?: boolean;
  animateDelay?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden
        animate-[fadeUp_0.3s_ease-out_both] hover:shadow-sm transition-all duration-200"
      style={{ animationDelay: animateDelay } as React.CSSProperties}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 p-4 text-left hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-all duration-150 active:scale-[0.98]"
      >
        <Icon size={16} className={color} />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1">{title}</span>
        {count !== undefined && (
          <span className="text-xs text-gray-400 tabular-nums">{count}</span>
        )}
        <div className={`transition-transform duration-300 ease-out ${open ? 'rotate-180' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" className="text-gray-400">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        {headerRight}
      </button>
      {/* 平滑展开动画 — 使用 grid 高度过渡 */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden transition-opacity duration-300 ease-out" style={{ opacity: open ? 1 : 0 }}>
          <div className="px-4 pb-4 pt-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 操作按钮 — 简约纯色 */
export function ToolbarButton({
  icon: Icon, label, onClick, variant = 'default', disabled, className = '',
}: {
  icon: ElementType; label: string; onClick: (e: React.MouseEvent) => void;
  variant?: 'default' | 'danger' | 'success' | 'warning' | 'primary';
  disabled?: boolean; className?: string;
}) {
  const colors = {
    default: 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
    primary: 'text-slate-700 dark:text-slate-300 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/20',
    success: 'text-slate-700 dark:text-slate-300 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/20',
    danger: 'text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20',
    warning: 'text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20',
  };

  return (
    <button
      onClick={(e) => onClick(e)}
      disabled={disabled}
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all duration-200
        disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 ${colors[variant]} ${className}`}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

/** 筛选标签 — 圆角 pill 按钮组（浅色窄边紫色框样式） */
export function FilterPill({
  active, onClick, children,
}: {
  active: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 active:scale-95 border
        ${active
          ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-300'
        }`}
    >
      {children}
    </button>
  );
}

/** 空态占位 */
export function ModuleEmptyState({ icon: Icon, label }: { icon: ElementType; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-gray-400 animate-[fadeUp_0.3s_ease-out]">
      <Icon size={32} className="mb-2 opacity-40" />
      <p className="text-xs">{label}</p>
    </div>
  );
}
