/**
 * ============================================================
 * Skills 页面
 * auto / keyword / manual 三种触发
 * ============================================================
 */
import { useState, useMemo } from 'react';
import {
  Wand2, Plus, Trash2, Play, Pause, Keyboard, Sparkles, Zap, Clock,
} from 'lucide-react';
import {
  ModulePageShell, ModuleSection, ToolbarButton, ModuleEmptyState,
  FilterPill, ConfirmModal,
} from './ModulePageShell';
import { useSkillsStore, ChatSkill, SkillTriggerType, createExampleSkill } from '../../store/skillsStore';

/* ─────────────────── constants ─────────────────── */

const TRIGGER_LABELS: Record<SkillTriggerType, { label: string; color: string; desc: string }> = {
  auto: { label: '自动注入', color: 'from-slate-500 to-slate-700', desc: '自动注入 prompt' },
  keyword: { label: '关键词触发', color: 'from-cyan-400 to-blue-500', desc: '对话命中关键词' },
  manual: { label: '手动/定时', color: 'from-amber-400 to-orange-500', desc: '手动或定时调用' },
};

const TRIGGER_FILTERS: { key: 'all' | SkillTriggerType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'auto', label: '自动' },
  { key: 'keyword', label: '关键词' },
  { key: 'manual', label: '手动' },
];

/* ─────────────────── SkillCard ─────────────────── */

function SkillCard({ skill, selectMode, selected, onSelectToggle, staggerDelay, onDeleteRequest }: {
  skill: ChatSkill; selectMode: boolean; selected: boolean;
  onSelectToggle?: () => void; staggerDelay?: string;
  onDeleteRequest?: (skill: ChatSkill) => void;
}) {
  const { toggleSkill, activeSkills, toggleActiveSkill } = useSkillsStore();
  const trigger = TRIGGER_LABELS[skill.trigger];
  const isActive = activeSkills.includes(skill.name);

  return (
    <div
      onClick={() => {
        if (selectMode) onSelectToggle?.();
      }}
      className={`bg-white dark:bg-gray-900 rounded-2xl border p-3.5 transition-all duration-200
        animate-[scaleIn_0.25s_ease-out_both] cursor-pointer hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]
        ${selected
          ? 'border-slate-500 dark:border-slate-700 ring-2 ring-slate-300 dark:ring-slate-800/40'
          : 'border-gray-100 dark:border-gray-800 hover:border-slate-300 dark:hover:border-slate-900'}
        ${isActive && skill.trigger === 'keyword' ? 'shadow-[0_0_0_2px_rgba(168,85,247,0.2)]' : ''}
      `}
      style={staggerDelay ? { animationDelay: staggerDelay } as React.CSSProperties : undefined}
    >
      <div className="flex items-start gap-2.5">
        {selectMode && (
          <div className={`shrink-0 w-4 h-4 rounded-md border-2 mt-1 inline-flex items-center justify-center transition-all duration-200 ${selected ? 'bg-slate-700 border-slate-700' : 'border-gray-300 dark:border-gray-600'}`}>
            {selected && (
              <svg viewBox="0 0 16 16" className="w-3 h-3 text-white animate-[checkPop_0.2s_ease-out]">
                <path fill="currentColor" d="M13.5 4.5L6 12L2.5 8.5L3.91 7.09L6 9.17L12.09 3.09L13.5 4.5Z" />
              </svg>
            )}
          </div>
        )}
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${trigger.color} flex items-center justify-center shadow-sm shrink-0 transition-transform duration-200 hover:scale-110`}>
          <Wand2 className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-medium ${skill.enabled ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400 line-through'}`}>
              {skill.name}
            </span>
            <span className={`rounded-full bg-gradient-to-r ${trigger.color} text-white text-[9px] px-1.5 py-0.5 flex items-center gap-0.5`}>
              {trigger.label}
            </span>
            {isActive && skill.trigger === 'keyword' && (
              <span className="rounded-full bg-slate-200 dark:bg-slate-800/30 text-slate-700 dark:text-slate-400 text-[9px] px-1.5 py-0.5 flex items-center gap-0.5 animate-[pulseGlow_1.5s_ease-in-out_infinite]">
                <Sparkles className="w-2.5 h-2.5" /> 已激活
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 line-clamp-1">{skill.description}</p>
          {skill.trigger === 'keyword' && skill.keywords.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {skill.keywords.slice(0, 5).map((k, i) => (
                <span key={i} className="rounded-full bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-300 text-[9px] px-1.5 py-0.5 font-mono">
                  {k}
                </span>
              ))}
              {skill.keywords.length > 5 && <span className="text-[9px] text-gray-400">+{skill.keywords.length - 5}</span>}
            </div>
          )}
          <p className="text-[9px] text-gray-400 dark:text-gray-500 mt-1">使用 {skill.stats?.uses || 0} 次</p>
        </div>
        {!selectMode && (
          <div className="flex items-center gap-0.5 shrink-0">
            {skill.trigger === 'keyword' && (
              <button onClick={(e) => { e.stopPropagation(); toggleActiveSkill(skill.name); }}
                title={isActive ? '取消激活' : '激活'}
                className={`p-1.5 rounded-lg transition-all duration-200 active:scale-90 ${
                  isActive ? 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/30' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}>
                <Sparkles className="w-3.5 h-3.5" />
              </button>
            )}
            <ToolbarButton onClick={() => toggleSkill(skill.id)} variant={skill.enabled ? 'success' : 'default'} icon={skill.enabled ? Pause : Play} label={skill.enabled ? '停' : '启'} />
            <ToolbarButton variant="danger" onClick={(e) => { e.stopPropagation(); onDeleteRequest?.(skill); }} icon={Trash2} label="删除" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── Main ─────────────────── */

export default function SkillsPage() {
  const { skills, addSkill, removeSkill } = useSkillsStore();
  const [filter, setFilter] = useState<'all' | SkillTriggerType>('all');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ChatSkill | null>(null);
  const [batchDeleteTarget, setBatchDeleteTarget] = useState(false);

  const filtered = useMemo(() => skills.filter((s) => filter === 'all' ? true : s.trigger === filter), [skills, filter]);

  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectAll = () => setSelectedIds(new Set(filtered.map((s) => s.id)));
  const deselectAll = () => setSelectedIds(new Set());
  const deleteSelected = () => {
    selectedIds.forEach((id) => removeSkill(id));
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  const filterBar = (
    <div className="flex items-center gap-1 flex-wrap">
      {TRIGGER_FILTERS.map((f) => (
        <FilterPill key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
          {f.label}
        </FilterPill>
      ))}
    </div>
  );

  return (
    <ModulePageShell
      title="Skills"
      subtitle="可复用的能力技能"
      icon={Wand2}
      stats={[
        { label: '总 Skills', value: skills.length, color: 'text-slate-700', delay: '0.1s' },
        { label: '已启用', value: skills.filter(s => s.enabled).length, color: 'text-slate-700 dark:text-slate-300', delay: '0.15s' },
        { label: '关键词触发', value: skills.filter(s => s.trigger === 'keyword').length, color: 'text-cyan-500', delay: '0.2s' },
      ]}
      filters={filterBar}
      selectable
    >
      {!selectMode && (
        <div className="flex gap-2 mb-3 animate-[fadeIn_0.2s_ease-out]">
          <button
            onClick={() => addSkill(createExampleSkill())}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/20 hover:bg-slate-200 dark:hover:bg-slate-800/30 transition-all duration-200 active:scale-95"
          >
            <Plus size={12} /> 创建示例 Skill
          </button>
          <button
            onClick={() => setSelectMode(true)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-red-500 transition-all duration-200 active:scale-95 disabled:opacity-40"
          >
            <Trash2 size={12} /> 选择删除
          </button>
        </div>
      )}

      {selectMode && (
        <div className="flex items-center gap-2 mb-3 p-2.5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 animate-[slideDown_0.2s_ease-out]">
          <button onClick={selectAll} className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-700 transition-colors">全选</button>
          <button onClick={deselectAll} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">取消全选</button>
          <span className="text-xs text-gray-400 ml-auto">{selectedIds.size} 项已选</span>
          <button
            onClick={() => { if (selectedIds.size > 0) setBatchDeleteTarget(true); }}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs text-white bg-red-500 hover:bg-red-600 disabled:opacity-40 transition-all duration-200 active:scale-95 shadow-sm"
          >
            <Trash2 size={10} /> 删除
          </button>
          <button onClick={() => { setSelectMode(false); deselectAll(); }}
            className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors ml-1">退出</button>
        </div>
      )}

      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <ModuleEmptyState icon={Wand2} label={filter === 'all' ? '暂无 Skills' : `暂无 ${TRIGGER_LABELS[filter]?.label || ''} Skill`} />
        ) : (
          filtered.map((s, i) => (
            <SkillCard key={s.id} skill={s} selectMode={selectMode} selected={selectedIds.has(s.id)}
              onSelectToggle={() => toggleSelect(s.id)} staggerDelay={`${i * 0.04}s`}
              onDeleteRequest={(sk) => setDeleteTarget(sk)} />
          ))
        )}
      </div>

      {/* 使用说明 */}
      <ModuleSection icon={Sparkles} title="使用说明" defaultOpen={false}>
        <div className="space-y-2.5 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
          <div className="flex items-start gap-2">
            <Zap className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300 mt-0.5 shrink-0" />
            <div>
              <strong className="text-gray-700 dark:text-gray-300">自动注入</strong>：每次对话都带入 prompt
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Keyboard className="w-3.5 h-3.5 text-cyan-500 mt-0.5 shrink-0" />
            <div>
              <strong className="text-gray-700 dark:text-gray-300">关键词触发</strong>：用户消息包含关键词时激活
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <strong className="text-gray-700 dark:text-gray-300">手动/定时</strong>：由功能模块的定时任务触发
            </div>
          </div>
        </div>
      </ModuleSection>

      {/* 单个删除确认 */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) { removeSkill(deleteTarget.id); setDeleteTarget(null); } }}
        title="删除此 Skill？"
        description={`确定要删除「${deleteTarget?.name || ''}」？此操作不可恢复。`}
        icon={Trash2}
        confirmLabel="删除"
      />

      {/* 批量删除确认 */}
      <ConfirmModal
        open={batchDeleteTarget}
        onClose={() => setBatchDeleteTarget(false)}
        onConfirm={deleteSelected}
        title={`删除 ${selectedIds.size} 个 Skill？`}
        description="批量删除所选 Skills，此操作不可恢复。"
        icon={Trash2}
        confirmLabel="全部删除"
      />
    </ModulePageShell>
  );
}
