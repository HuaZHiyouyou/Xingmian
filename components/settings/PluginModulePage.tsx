/**
 * ============================================================
 * 插件模块页面
 * ============================================================
 */
import { useState, useMemo, useEffect } from 'react';
import {
  Puzzle, Play, Pause, Trash2, RefreshCcw, Settings,
  ChevronDown, Package, Zap, AlertTriangle, CheckCircle2, RotateCcw, Plus,
} from 'lucide-react';
import {
  ModulePageShell, ModuleSection, ToolbarButton, ModuleEmptyState,
  FilterPill, ConfirmModal,
} from './ModulePageShell';
import {
  usePluginStore, ChatPlugin, PluginMode, PluginStatus, createExamplePlugin,
} from '../../store/pluginStore';

/* ─────────── 常量 ─────────── */

const MODE_LABELS: Record<PluginMode, { label: string; color: string }> = {
  standalone: { label: '单独', color: 'from-slate-700 to-indigo-500' },
  parallel: { label: '并行', color: 'from-cyan-500 to-blue-500' },
  cooperative: { label: '合作', color: 'from-slate-700 to-slate-700' },
};

const STATUS_ICONS: Record<PluginStatus, typeof CheckCircle2> = {
  running: CheckCircle2,
  error: AlertTriangle,
  idle: RotateCcw,
  disabled: RotateCcw,
};

const FILTERS: { key: 'all' | PluginMode; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'standalone', label: '单独' },
  { key: 'parallel', label: '并行' },
  { key: 'cooperative', label: '合作' },
];

/* ─────────── PluginCard ─────────── */

function PluginCard({ plugin, status, staggerDelay, onDeleteRequest }: {
  plugin: ChatPlugin; status: PluginStatus; staggerDelay?: string;
  onDeleteRequest?: (p: ChatPlugin) => void;
}) {
  const { togglePlugin } = usePluginStore();
  const [expanded, setExpanded] = useState(false);
  const mode = MODE_LABELS[plugin.mode];
  const StatusIcon = STATUS_ICONS[status] || RotateCcw;

  const statusColor = {
    running: 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/20',
    error: 'text-red-500 bg-red-50 dark:bg-red-900/20',
    idle: 'text-gray-400 bg-gray-100 dark:bg-gray-800',
    disabled: 'text-gray-400 bg-gray-100 dark:bg-gray-800',
  }[status];

  const hooks = useMemo(() => {
    const hc = plugin.hookConfig;
    const list: string[] = [];
    if (hc?.beforePrompt) list.push('beforePrompt');
    if (hc?.beforeSend) list.push('beforeSend');
    if (hc?.afterReply) list.push('afterReply');
    if (hc?.onTick) list.push('onTick');
    return list;
  }, [plugin.hookConfig]);

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-2xl border p-4 transition-all duration-200
        animate-[scaleIn_0.25s_ease-out_both] hover:shadow-md hover:-translate-y-0.5
        ${expanded
          ? 'border-slate-300 dark:border-slate-900 shadow-lg'
          : 'border-gray-100 dark:border-gray-800 hover:border-slate-300 dark:hover:border-slate-900'}
      `}
      style={staggerDelay ? { animationDelay: staggerDelay } as React.CSSProperties : undefined}
    >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${mode.color} flex items-center justify-center shadow-sm transition-transform duration-200 hover:scale-110`}>
            <Puzzle className="w-5 h-5 text-white" />
          </div>
          <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-900 ${statusColor} flex items-center justify-center`}>
            <StatusIcon className="w-2 h-2" />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-medium ${plugin.enabled ? 'text-gray-800 dark:text-gray-100' : 'text-gray-400'}`}>
              {plugin.name}
            </span>
            <span className={`rounded-full bg-gradient-to-r ${mode.color} text-white text-[9px] px-1.5 py-0.5`}>
              {mode.label}
            </span>
            {plugin.replaceDefault && (
              <span className="rounded-full bg-slate-700/10 text-slate-700 dark:text-slate-300 text-[9px] px-1.5 py-0.5 border border-slate-700/20">
                替代默认
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{plugin.description}</p>
          {plugin.priority !== undefined && (
            <p className="text-[9px] text-gray-400 mt-0.5">优先级 {plugin.priority}</p>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <ToolbarButton
            onClick={() => togglePlugin(plugin.id)}
            variant={plugin.enabled ? 'success' : 'default'}
            icon={plugin.enabled ? Pause : Play}
            label={plugin.enabled ? '停' : '启'}
          />
          <ToolbarButton variant="danger" onClick={() => onDeleteRequest?.(plugin)} icon={Trash2} label="删除" />
        </div>
      </div>

      {/* 展开区域 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1 mt-2.5 text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-150"
      >
        <Settings size={10} />
        <span>配置详情</span>
        <ChevronDown size={10} className={`ml-auto transition-transform duration-300 ease-out ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* 平滑展开动画 — grid 高度过渡 */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mt-3 pt-3 space-y-2.5 text-[11px]">
            {/* 钩子配置 */}
            {hooks.length > 0 ? (
              <div className="space-y-2">
                <span className="text-gray-400">钩子配置</span>
                <div className="space-y-1.5">
                  {hooks.map((h) => (
                    <div key={h} className="flex items-start gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 font-mono text-[9px] shrink-0">
                        {h}
                      </span>
                      <span className="text-gray-600 dark:text-gray-300 font-mono text-[10px] leading-relaxed break-all">
                        {plugin.hookConfig?.[h as 'beforePrompt']}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-[10px]">无钩子配置</p>
            )}
            {/* 运行统计 */}
            <div className="flex items-center gap-3 text-gray-400">
              <span>v{plugin.version}</span>
              <span>运行 {plugin.stats?.runs ?? 0} 次</span>
              {plugin.stats && plugin.stats.errorCount > 0 && (
                <span className="text-red-400">错误 {plugin.stats.errorCount} 次</span>
              )}
              {plugin.stats?.lastRun && (
                <span>上次 {new Date(plugin.stats.lastRun).toLocaleTimeString()}</span>
              )}
            </div>
            {/* 创建时间 */}
            <div className="text-gray-400 text-[10px]">
              创建于 {new Date(plugin.createdAt).toLocaleString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────── Main ─────────── */

export default function PluginModulePage() {
  const { plugins, statuses, addPlugin, removePlugin, exampleInitialized } = usePluginStore();
  const [filter, setFilter] = useState<'all' | PluginMode>('all');
  const [deleteTarget, setDeleteTarget] = useState<ChatPlugin | null>(null);

  // Bug2修复: 仅在首次进入且无插件时添加示例，删除后刷新不再自动恢复
  useEffect(() => {
    if (!exampleInitialized && plugins.length === 0) {
      addPlugin(createExamplePlugin());
      // 标记已初始化（需通过 store 的 updatePlugin 或直接 set 修改）
      usePluginStore.setState({ exampleInitialized: true });
    }
  }, [exampleInitialized, plugins.length, addPlugin]);

  const filtered = useMemo(
    () => plugins.filter((p) => filter === 'all' ? true : p.mode === filter),
    [plugins, filter],
  );

  const running = plugins.filter((p) => statuses[p.id] === 'running').length;
  const errored = plugins.filter((p) => statuses[p.id] === 'error').length;

  return (
    <ModulePageShell
      title="插件"
      subtitle="扩展能力和集成"
      icon={Package}
      stats={[
        { label: '总数', value: plugins.length, color: 'text-slate-700', delay: '0.1s' },
        { label: '运行中', value: running, color: 'text-slate-700 dark:text-slate-300', delay: '0.15s' },
        { label: '异常', value: errored, color: errored > 0 ? 'text-red-500' : 'text-gray-400', delay: '0.2s' },
      ]}
      headerAction={
        <button
          onClick={() => addPlugin(createExamplePlugin())}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/20 transition-all duration-200 active:scale-95"
        >
          <Plus size={12} />
          添加示例
        </button>
      }
      filters={
        <div className="flex items-center gap-1 flex-wrap">
          {FILTERS.map((f) => (
            <FilterPill key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </FilterPill>
          ))}
        </div>
      }
    >
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <ModuleEmptyState icon={Package} label={filter === 'all' ? '暂无插件' : `暂无${MODE_LABELS[filter]?.label || ''}插件`} />
        ) : (
          filtered.map((p, i) => (
            <PluginCard
              key={p.id}
              plugin={p}
              status={statuses[p.id] || (p.enabled ? 'idle' : 'disabled')}
              staggerDelay={`${i * 0.05}s`}
              onDeleteRequest={(pl) => setDeleteTarget(pl)}
            />
          ))
        )}
      </div>

      {/* 框架说明 */}
      <ModuleSection icon={Zap} title="插件框架说明" defaultOpen={false} animateDelay="0.3s">
        <div className="grid grid-cols-3 gap-4 text-[11px]">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 font-medium">
              <Zap size={12} className="text-slate-700 dark:text-slate-300" />
              单独模式
            </div>
            <ul className="space-y-1 text-gray-500 dark:text-gray-400">
              <li className="flex items-start gap-1"><span className="text-slate-500 mt-0.5">·</span>独立执行钩子</li>
              <li className="flex items-start gap-1"><span className="text-slate-500 mt-0.5">·</span>不共享上下文</li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 font-medium">
              <Settings size={12} className="text-cyan-500" />
              并行模式
            </div>
            <ul className="space-y-1 text-gray-500 dark:text-gray-400">
              <li className="flex items-start gap-1"><span className="text-cyan-400 mt-0.5">·</span>并行执行钩子</li>
              <li className="flex items-start gap-1"><span className="text-cyan-400 mt-0.5">·</span>结果聚合合并</li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 font-medium">
              <RefreshCcw size={12} className="text-slate-700 dark:text-slate-300" />
              合作模式
            </div>
            <ul className="space-y-1 text-gray-500 dark:text-gray-400">
              <li className="flex items-start gap-1"><span className="text-slate-500 mt-0.5">·</span>按优先级串行接力</li>
              <li className="flex items-start gap-1"><span className="text-slate-500 mt-0.5">·</span>共享修改后的上下文</li>
            </ul>
          </div>
        </div>
      </ModuleSection>

      {/* 运行日志 */}
      <ModuleSection icon={RefreshCcw} title="运行日志" defaultOpen={false} animateDelay="0.4s">
        <div className="max-h-32 overflow-y-auto text-[10px] font-mono text-gray-500 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 space-y-1">
          {plugins.filter((p) => statuses[p.id] === 'error').map((p) => (
            <div key={p.id} className="text-red-400">[{p.name}] 执行失败</div>
          ))}
          {plugins.filter((p) => statuses[p.id] === 'running').map((p) => (
            <div key={p.id} className="text-slate-700 dark:text-slate-300">[{p.name}] 执行成功</div>
          ))}
          {errored === 0 && running === 0 && (
            <div className="text-gray-400 text-center py-2">暂无日志</div>
          )}
        </div>
      </ModuleSection>

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { removePlugin(deleteTarget.id); setDeleteTarget(null); } }}
        title="卸载此插件？"
        description={`确定要卸载「${deleteTarget?.name || ''}」？卸载后需重新添加。`}
        icon={Trash2}
        confirmLabel="卸载"
      />
    </ModulePageShell>
  );
}
