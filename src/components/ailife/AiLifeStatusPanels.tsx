/**
 * ============================================================
 * AI 一日 · 状态面板（详细版）
 *  - 属性卡：墨水条 + 具体数值 + 迷你趋势线 + 最近变化原因/时间
 *  - 今日时间分配图：按类别统计时长占比
 *  - 世界设定包选择器
 * 卡片统一 <section> + dark: 变体 → 主题层装饰自动适配。
 * ============================================================
 */
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Download, Upload, Globe, TrendingUp, PieChart } from 'lucide-react';
import {
  dbGetAiAttributes,
  AiLifeAttributes,
  dbGetWorldConfigs, dbDeleteWorldConfig, WorldConfigRecord,
} from '../../lib/tauriBridge';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { exportWorldConfig, importWorldConfig, ensureBuiltinWorlds, BUILTIN_MODERN_WORLD_ID } from '../../services/ailife/worldConfig';
import { getAttrHistory, seedAttrHistory, type AttrHistoryPoint } from '../../services/ailife/attributeSystem';
import { Skeleton } from '../common/Skeleton';

const HAND_FONT = "'LXGW WenKai', 'Kaiti SC', 'KaiTi', cursive";
const INK = '#2c3e50';

function hm(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

// ---------------- 属性卡（数值 + 墨水条 + 趋势线 + 最近变化） ----------------

const ATTR_LABELS: { key: keyof Omit<AiLifeAttributes, 'characterId' | 'timestamp'>; label: string; reverse?: boolean }[] = [
  { key: 'health', label: '健康' },
  { key: 'stamina', label: '体力' },
  { key: 'satiety', label: '饱腹' },
  { key: 'thirst', label: '饮水' },
  { key: 'cleanliness', label: '清洁' },
  { key: 'spirit', label: '精神' },
  { key: 'stress', label: '压力', reverse: true },
];

/** 迷你趋势折线（纯 SVG，无图表库依赖） */
function Sparkline({ values, reverse }: { values: number[]; reverse?: boolean }) {
  if (values.length < 2) {
    return (
      <svg width={64} height={18} className="shrink-0" />
    );
  }
  const w = 64;
  const h = 18;
  const norm = reverse ? values.map((v) => 100 - v) : values;
  const min = Math.min(...norm);
  const max = Math.max(...norm);
  const span = Math.max(max - min, 10);
  const pts = norm.map((v, i) => {
    const x = (i / (norm.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const rising = norm[norm.length - 1] >= norm[0];
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={pts.join(' ')} fill="none" strokeWidth="1.5"
        stroke={rising ? '#10b981' : '#f43f5e'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InkBar({ label, value, reverse, trend }: {
  label: string; value: number; reverse?: boolean; trend?: number[];
}) {
  const display = Math.max(0, Math.min(100, reverse ? 100 - value : value));
  const status = display > 70 ? '良好' : display > 40 ? '尚可' : display > 20 ? '不太好' : '糟糕';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-8 shrink-0" style={{ fontFamily: HAND_FONT }}>{label}</span>
      <div className="flex-1 h-2.5 bg-[#e8e0cf] dark:bg-gray-700 rounded-sm overflow-hidden">
        <div className="h-full rounded-sm transition-all duration-700"
          style={{ width: `${display}%`, backgroundColor: reverse ? '#8b0000' : INK, opacity: 0.72 }} />
      </div>
      <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400 w-7 text-right">{Math.round(value)}</span>
      <Sparkline values={trend || []} reverse={reverse} />
      <span className="text-[10px] text-gray-500 dark:text-gray-400 w-9 text-right">{status}</span>
    </div>
  );
}

export function AiLifeAttributesPanel({ characterId }: { characterId?: string }) {
  const [attrs, setAttrs] = useState<AiLifeAttributes | null>(null);
  const [history, setHistory] = useState<AttrHistoryPoint[]>([]);
  const [attrsLoading, setAttrsLoading] = useState(true);

  useEffect(() => {
    if (!characterId) return undefined;
    seedAttrHistory(characterId).catch(() => {});
    dbGetAiAttributes(characterId).then((a) => { setAttrs(a || null); setAttrsLoading(false); }).catch(() => setAttrsLoading(false));
    // 属性由引擎异步更新：轮询刷新，趋势线随内存历史增长
    const t = setInterval(() => {
      dbGetAiAttributes(characterId).then((a) => setAttrs(a || null)).catch(() => {});
      setHistory([...getAttrHistory(characterId)]);
    }, 8000);
    setHistory([...getAttrHistory(characterId)]);
    return () => clearInterval(t);
  }, [characterId]);

  if (!characterId) return null;
  if (attrsLoading) {
    // 🆕 加载骨架：避免数据瞬间弹出
    return (
      <section className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700">
        <div className="flex items-center gap-2 mb-3">
          <Skeleton className="w-14 h-3.5" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between">
                <Skeleton className="w-10 h-3" />
                <Skeleton className="w-8 h-3" />
              </div>
              <Skeleton className="w-full h-2 rounded-full" />
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (!attrs) {
    return (
      <section className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400" style={{ fontFamily: HAND_FONT }}>
          暂无状态记录——开启生活引擎后，随着活动推进这里会出现状态变化。
        </p>
      </section>
    );
  }

  const lastChange = history[history.length - 1];

  return (
    <section className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700 shadow-sm"
      style={{ backgroundImage: 'repeating-linear-gradient(transparent, transparent 27px, rgba(148,163,184,0.12) 27px, rgba(148,163,184,0.12) 28px)' }}>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-bold text-[#2c3e50] dark:text-gray-100" style={{ fontFamily: HAND_FONT }}>状态</h3>
        <TrendingUp size={12} className="text-gray-400" />
        {lastChange && (
          <span className="ml-auto text-[10px] text-gray-400 truncate max-w-[60%]" title={lastChange.reason}>
            {lastChange.reason} · {hm(lastChange.timestamp)}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {ATTR_LABELS.map(({ key, label, reverse }) => (
          <InkBar key={key} label={label} value={attrs[key]} reverse={reverse}
            trend={history.map((h) => h[key])} />
        ))}
      </div>
    </section>
  );
}

// ---------------- 今日时间分配图 ----------------

const CATEGORY_TIME_META: Record<string, { label: string; color: string }> = {
  sleep: { label: '睡眠', color: '#6366f1' },
  personal_care: { label: '洗漱', color: '#06b6d4' },
  meal: { label: '用餐', color: '#f59e0b' },
  travel: { label: '出行', color: '#64748b' },
  work: { label: '工作', color: '#3b82f6' },
  leisure: { label: '休闲', color: '#10b981' },
  social: { label: '社交', color: '#ec4899' },
  rest: { label: '休息', color: '#64748b' },
  special: { label: '其他', color: '#94a3b8' },
};

export function TimeAllocationPanel({ characterId, date }: { characterId?: string; date: string }) {
  const acts = useAiLifeStore((s) => s.dayActivities[date]);
  if (!characterId) return null;

  const totals: Record<string, number> = {};
  let grand = 0;
  for (const a of acts || []) {
    if (a.status === 'cancelled') continue;
    const mins = Math.max(0, (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 60000);
    if (mins <= 0) continue;
    totals[a.category] = (totals[a.category] || 0) + mins;
    grand += mins;
  }
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  return (
    <section className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <PieChart size={13} className="text-slate-700 dark:text-slate-500" />
        <h3 className="text-sm font-bold text-[#2c3e50] dark:text-gray-100" style={{ fontFamily: HAND_FONT }}>今日时间分配</h3>
        <span className="ml-auto text-[10px] text-gray-400 tabular-nums">共 {(grand / 60).toFixed(1)} 小时</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">这一天还没有活动安排。</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(([cat, mins]) => {
            const meta = CATEGORY_TIME_META[cat] || CATEGORY_TIME_META.special;
            const pct = grand > 0 ? (mins / grand) * 100 : 0;
            return (
              <div key={cat} className="flex items-center gap-2">
                <span className="text-[10px] w-7 shrink-0 text-gray-500 dark:text-gray-400">{meta.label}</span>
                <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct}%`, backgroundColor: meta.color, opacity: 0.75 }} />
                </div>
                <span className="text-[10px] tabular-nums text-gray-400 w-12 text-right">{(mins / 60).toFixed(1)}h</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------- 世界设定包 ----------------

/** 世界设定包选择器 + 导入导出（阶段 6） */
export function WorldConfigSection() {
  const [worlds, setWorlds] = useState<WorldConfigRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const config = useAiLifeStore((s) => s.config);
  const updateConfig = useAiLifeStore((s) => s.updateConfig);
  const selectedId = (config?.extra as { worldId?: string } | undefined)?.worldId || BUILTIN_MODERN_WORLD_ID;

  const refresh = useCallback(() => {
    setLoading(true);
    ensureBuiltinWorlds()
      .then(() => dbGetWorldConfigs())
      .then((ws) => { setWorlds(ws); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const selectedWorld = worlds.find((w) => w.id === selectedId);

  const onSelect = async (id: string) => {
    await updateConfig({ extra: { ...(config?.extra || {}), worldId: id } });
  };

  const onDelete = async (id: string) => {
    if (!window.confirm('确定删除该世界设定包？')) return;
    await dbDeleteWorldConfig(id);
    if (selectedId === id) await onSelect(BUILTIN_MODERN_WORLD_ID);
    refresh();
  };

  return (
    <section className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Globe size={14} className="text-slate-700 dark:text-slate-500" />
        <h3 className="text-sm font-bold text-[#2c3e50] dark:text-gray-100" style={{ fontFamily: HAND_FONT }}>世界设定包</h3>
        <div className="ml-auto flex items-center gap-1">
          <button title="导入" onClick={async () => { await importWorldConfig(); refresh(); }}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"><Upload size={13} /></button>
          <button title="导出当前选中" onClick={async () => {
            const w = worlds.find((x) => x.id === selectedId);
            if (w) await exportWorldConfig(w);
          }} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"><Download size={13} /></button>
          <button title="刷新" onClick={refresh} className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"><RefreshCw size={12} /></button>
        </div>
      </div>
      {loading ? (
        <div className="space-y-1.5">
          <div className="h-9 rounded-lg bg-black/5 dark:bg-white/5 animate-pulse" />
          <div className="h-9 rounded-lg bg-black/5 dark:bg-white/5 animate-pulse" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {worlds.map((w) => {
            const locCount = w.config?.locations?.length ?? 0;
            const actPools = w.config?.activities;
            const actCount = (actPools?.daily?.length ?? 0) + (actPools?.work?.length ?? 0) + (actPools?.leisure?.length ?? 0) + (actPools?.social?.length ?? 0) + (actPools?.special?.length ?? 0);
            return (
              <div key={w.id} className={`flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                w.id === selectedId ? 'border-slate-500 bg-slate-100/60 dark:bg-slate-800/20' : 'border-gray-200 dark:border-gray-600 bg-white/60 dark:bg-gray-900/40 hover:bg-white dark:hover:bg-gray-900'
              }`} onClick={() => onSelect(w.id)}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{w.name}</span>
                    {w.id === selectedId && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-600 text-white">使用中</span>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400">
                    {w.isBuiltin ? '内置' : '自定义'} · {locCount} 个地点 · {actCount} 项活动
                  </span>
                </div>
                {!w.isBuiltin && (
                  <button onClick={(e) => { e.stopPropagation(); onDelete(w.id); }}
                    className="text-[10px] text-red-400 hover:text-red-600 shrink-0">删除</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!loading && selectedWorld && (
        <p className="mt-2 text-[10px] text-gray-400 leading-relaxed">
          当前「{selectedWorld.name}」：日程生成会按包内 {selectedWorld.config?.locations?.length ?? 0} 个地点自动校验场景。
        </p>
      )}
    </section>
  );
}
