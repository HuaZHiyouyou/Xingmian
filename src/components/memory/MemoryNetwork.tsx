import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useMemoryStore } from '../../store/memoryStore';
import { useTheme } from '../../hooks/useTheme';
import { type MemoryEntry, type MemoryCategory, MEMORY_CATEGORY_LABELS, MEMORY_CATEGORY_COLORS } from '../../types';
import { Search, ChevronLeft, ZoomIn, ZoomOut, RefreshCw, X, BookOpen, Brain, Lightbulb, BarChart3, History, MessageCircle, Reply, Star, NotebookPen } from 'lucide-react';

interface GraphNode {
  id: string;
  label: string;
  type: 'user' | 'ai' | 'memory';
  color: string;
  timeLabel?: string;
  meta?: Record<string, unknown>;
  val: number;
}
interface GraphLink { source: string; target: string; type: string; }
interface GraphData { nodes: GraphNode[]; links: GraphLink[]; }
interface Point3D { x: number; y: number; z: number; }
interface Viewport { x: number; y: number; zoom: number; }

const TIME_RANGES = [
  { label: '今天', value: 'today', f: (d: Date) => d.toDateString() === new Date().toDateString() },
  { label: '本周', value: 'week', f: (d: Date) => d >= new Date(Date.now() - 7 * 864e5) },
  { label: '本月', value: 'month', f: (d: Date) => d >= new Date(Date.now() - 30 * 864e5) },
  { label: '全部', value: 'all', f: () => true },
];

function hash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0) / 4294967295;
}

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

const TYPE_LABELS: Record<string, { label: string; dot: string; bg: string }> = {
  user: { label: '用户消息', dot: 'bg-slate-700', bg: 'bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400' },
  ai: { label: 'AI 回复', dot: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' },
  memory: { label: '记忆节点', dot: 'bg-slate-700', bg: 'bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400' },
};

function buildGraph(allEntries: MemoryEntry[], timeRange: string, query: string): GraphData {
  const range = TIME_RANGES.find(t => t.value === timeRange);
  const filtered = allEntries.filter(m => range?.f(new Date(m.createdAt)));
  const searched = query.trim()
    ? filtered.filter(m => m.title?.toLowerCase().includes(query.toLowerCase()) || m.content.toLowerCase().includes(query.toLowerCase()))
    : filtered;
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeColors: Record<string, string> = {
    user_message: '#10b981', reply_content: '#3b82f6', summary: '#f59e0b', thinking: '#64748b',
    analysis: '#06b6d4', reflection: '#ec4899', recall: '#f97316', fact: '#14b8a6',
  };
  const conversations = new Map<string, MemoryEntry[]>();
  searched.forEach(entry => {
    const key = entry.conversationId || 'default';
    conversations.set(key, [...(conversations.get(key) || []), entry]);
  });
  const sorted = Array.from(conversations.entries()).sort((a, b) =>
    Math.min(...a[1].map(e => new Date(e.createdAt).getTime())) - Math.min(...b[1].map(e => new Date(e.createdAt).getTime()))
  );
  let previousAi: string | null = null;
  sorted.forEach(([conversationId, entries]) => {
    const ordered = [...entries].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const users = ordered.filter(e => e.category === 'user_message');
    const ais = ordered.filter(e => e.category === 'reply_content');
    const others = ordered.filter(e => e.category !== 'user_message' && e.category !== 'reply_content');
    const count = Math.max(users.length, ais.length, 1);
    for (let index = 0; index < count; index += 1) {
      const reference = ordered[Math.min(index, ordered.length - 1)];
      if (!reference) continue;
      const date = new Date(reference.createdAt);
      const timeLabel = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      if (users[index]) {
        const entry = users[index];
        const id = `u_${conversationId}_${index}`;
        nodes.push({ id, label: (entry.title || entry.content).slice(0, 34), type: 'user', color: '#10b981', timeLabel, meta: { ...entry }, val: 4 });
      }
      if (ais[index]) {
        const entry = ais[index];
        const id = `a_${conversationId}_${index}`;
        nodes.push({ id, label: (entry.title || entry.content).slice(0, 34), type: 'ai', color: '#3b82f6', timeLabel, meta: { ...entry }, val: 5 });
        if (users[index]) links.push({ source: `u_${conversationId}_${index}`, target: id, type: 'reply' });
        if (previousAi) links.push({ source: previousAi, target: `u_${conversationId}_${index}`, type: 'temporal' });
        previousAi = id;
      }
      if (others[index]) {
        const entry = others[index];
        const id = `m_${conversationId}_${index}`;
        nodes.push({ id, label: (entry.title || entry.content).slice(0, 34), type: 'memory', color: nodeColors[entry.category] || '#64748b', timeLabel, meta: { ...entry }, val: 3 });
        if (previousAi) links.push({ source: previousAi, target: id, type: 'memory_ref' });
      }
    }
  });
  return { nodes, links };
}

function createLayout(nodes: GraphNode[]): Map<string, Point3D> {
  const layout = new Map<string, Point3D>();
  nodes.forEach((node, index) => {
    const t = hash(node.id);
    const angle = index * 2.399963 + t * 1.8;
    const radius = 170 + Math.sqrt(index + 1) * 95 + t * 80;
    const band = (index % 7) - 3;
    layout.set(node.id, {
      x: Math.cos(angle) * radius + (hash(`${node.id}x`) - 0.5) * 180,
      y: Math.sin(angle) * radius * 0.72 + band * 54,
      z: (hash(`${node.id}z`) - 0.5) * 360 + Math.sin(index * 0.7) * 90,
    });
  });
  return layout;
}

const MemoryNetwork: React.FC = () => {
  const navigate = useNavigate();
  const { entries, isLoaded, loadFirstPage, loadAvailableDates } = useMemoryStore();
  const { isDark } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef({ active: false, x: 0, y: 0 });
  const animationRef = useRef<number | null>(null);
  const [sel, setSel] = useState<GraphNode | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tr, setTr] = useState('all');
  // 仅用 setter 强制重渲染（实际值走 viewportRef）
  const [, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) { void loadFirstPage(); void loadAvailableDates(); }
  }, [isLoaded, loadAvailableDates, loadFirstPage]);

  const allEntries = useMemo(() => Object.values(entries).flat(), [entries]);
  const graphData = useMemo(() => buildGraph(allEntries, tr, q), [allEntries, q, tr]);
  const layout = useMemo(() => createLayout(graphData.nodes), [graphData.nodes]);
  const count = useMemo(() => {
    const range = TIME_RANGES.find(item => item.value === tr);
    return allEntries.filter(entry => range?.f(new Date(entry.createdAt))).length;
  }, [allEntries, tr]);

  const colors = useMemo(() => ({
    background: isDark ? '#080d18' : '#f5f7fb',
    surface: isDark ? 'bg-white/[0.04]' : 'bg-black/[0.02]',
    border: isDark ? 'border-white/[0.06]' : 'border-black/[0.06]',
    text: isDark ? 'text-gray-100' : 'text-gray-800',
    muted: isDark ? 'text-gray-500' : 'text-gray-400',
    button: isDark ? 'bg-white/[0.06] hover:bg-white/[0.1]' : 'bg-black/[0.04] hover:bg-black/[0.07]',
    input: isDark ? 'bg-white/[0.04] border-white/[0.08] text-gray-200 placeholder-gray-500' : 'bg-black/[0.03] border-black/[0.06] text-gray-800 placeholder-gray-400',
  }), [isDark]);

  const project = useCallback((point: Point3D, width: number, height: number, current: Viewport) => {
    const depth = Math.max(0.55, Math.min(1.35, 1 + point.z / 900));
    return { x: width / 2 + current.x + point.x * current.zoom * depth, y: height / 2 + current.y + point.y * current.zoom * depth, depth };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    // 背景透明，由父元素 bg-white dark:bg-gray-900 提供主题适配背景
    const current = viewportRef.current;

    // 极简网格 — 使用圆点替代线条
    context.save();
    const grid = Math.max(32, 52 * current.zoom);
    const offsetX = ((current.x + rect.width / 2) % grid + grid) % grid;
    const offsetY = ((current.y + rect.height / 2) % grid + grid) % grid;
    context.globalAlpha = isDark ? 0.1 : 0.15;
    context.fillStyle = isDark ? '#ffffff' : '#9ca3af';
    for (let x = offsetX; x < rect.width; x += grid) {
      for (let y = offsetY; y < rect.height; y += grid) {
        context.beginPath();
        context.arc(x, y, 0.8, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.restore();

    const points = new Map<string, { x: number; y: number; depth: number }>();
    graphData.nodes.forEach(node => { const point = layout.get(node.id); if (point) points.set(node.id, project(point, rect.width, rect.height, current)); });
    // 连线 — 极细半透明
    const linkColor = (type: string) => type === 'reply' ? (isDark ? 'rgba(148,163,184,0.5)' : 'rgba(100,116,139,0.35)') : type === 'memory_ref' ? (isDark ? 'rgba(251,146,60,0.25)' : 'rgba(249,115,22,0.2)') : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)');
    graphData.links.forEach(link => {
      const source = points.get(link.source); const target = points.get(link.target);
      if (!source || !target) return;
      const active = !highlightId || (link.source === highlightId || link.target === highlightId);
      context.globalAlpha = active ? 1 : 0.2;
      context.strokeStyle = linkColor(link.type);
      context.lineWidth = link.type === 'reply' ? 1.2 : 0.6;
      context.beginPath(); context.moveTo(source.x, source.y); context.lineTo(target.x, target.y); context.stroke();
    });

    // 节点 — 柔和光晕 + 极简样式
    context.globalAlpha = 1;
    [...graphData.nodes].sort((a, b) => (points.get(a.id)?.depth || 1) - (points.get(b.id)?.depth || 1)).forEach(node => {
      const point = points.get(node.id); if (!point) return;
      const radius = (node.val + 3) * point.depth * Math.max(0.7, current.zoom * 0.9);
      const active = !highlightId || highlightId === node.id || graphData.links.some(link => (link.source === highlightId && link.target === node.id) || (link.target === highlightId && link.source === node.id));
      context.globalAlpha = active ? 1 : 0.12;

      // 柔和光晕
      const glow = (node.id === hoveredId || node.id === highlightId) ? 16 : 4;
      if (glow > 4) {
        context.shadowColor = node.color;
        context.shadowBlur = glow;
      }

      // 节点本体 — 半透明填充
      context.globalAlpha = active ? 0.85 : 0.1;
      context.fillStyle = node.color;
      context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill();
      context.shadowBlur = 0;

      // 节点边框 — 更精致的描边
      context.globalAlpha = active ? 0.5 : 0.06;
      context.strokeStyle = node.color;
      context.lineWidth = 0.8;
      context.beginPath(); context.arc(point.x, point.y, radius + 2, 0, Math.PI * 2); context.stroke();

      // 标签
      context.globalAlpha = active ? 1 : 0.1;
      if (current.zoom > 0.55 || node.id === hoveredId || node.id === highlightId) {
        context.fillStyle = isDark ? 'rgba(226,232,240,0.8)' : 'rgba(51,65,85,0.8)';
        context.font = `${Math.max(9, Math.round(10 * point.depth))}px ui-sans-serif, system-ui`;
        context.textAlign = 'center';
        context.fillText(node.label.length > 20 ? `${node.label.slice(0, 20)}…` : node.label, point.x, point.y + radius + 14);
      }
    });
  }, [graphData, hoveredId, highlightId, isDark, layout, project]);

  useEffect(() => {
    const render = () => { draw(); animationRef.current = requestAnimationFrame(render); };
    animationRef.current = requestAnimationFrame(render);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [draw]);

  const hitNode = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const rect = canvas.getBoundingClientRect(); const current = viewportRef.current;
    for (let i = graphData.nodes.length - 1; i >= 0; i -= 1) {
      const node = graphData.nodes[i]; const point = layout.get(node.id); if (!point) continue;
      const projected = project(point, rect.width, rect.height, current);
      const radius = (node.val + 5) * projected.depth * Math.max(0.72, current.zoom * 0.92);
      if (Math.hypot(clientX - rect.left - projected.x, clientY - rect.top - projected.y) <= radius + 6) return node;
    }
    return null;
  }, [graphData.nodes, layout, project]);

  const changeZoom = useCallback((factor: number) => {
    const next = Math.max(0.35, Math.min(2.6, viewportRef.current.zoom * factor));
    const updated = { ...viewportRef.current, zoom: next }; viewportRef.current = updated; setViewport(updated);
  }, []);
  const resetView = useCallback(() => { const updated = { x: 0, y: 0, zoom: 1 }; viewportRef.current = updated; setViewport(updated); setHighlightId(null); setSel(null); }, []);

  // 使用非 passive 的 wheel 事件监听器，以允许 preventDefault 阻止页面滚动
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      changeZoom(event.deltaY > 0 ? 0.9 : 1.1);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => { canvas.removeEventListener('wheel', handleWheel); };
  }, [changeZoom]);

  return (
    <div className="h-full flex flex-col relative overflow-hidden select-none bg-white dark:bg-gray-900">
      {/* 顶部毛玻璃导航 */}
      <div className="flex-shrink-0 relative z-20">
        <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => navigate(-1)} className={`w-9 h-9 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${colors.button}`}><ChevronLeft className={`w-5 h-5 ${colors.muted}`} /></button>
            <div className="min-w-0"><h1 className={`text-[15px] font-semibold tracking-tight ${colors.text}`}>记忆网络</h1><p className={`text-[11px] ${colors.muted}`}>{count} 条记忆 · 空间节点图</p></div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => changeZoom(1.2)} className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${colors.button}`}><ZoomIn className={`w-3.5 h-3.5 ${colors.muted}`} /></motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => changeZoom(0.82)} className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${colors.button}`}><ZoomOut className={`w-3.5 h-3.5 ${colors.muted}`} /></motion.button>
            <motion.button whileTap={{ scale: 0.9 }} onClick={resetView} className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${colors.button}`}><RefreshCw className={`w-3.5 h-3.5 ${colors.muted}`} /></motion.button>
          </div>
        </div>
        {/* 搜索栏 + 筛选 */}
        <div className="px-4 pb-3 flex flex-col gap-2">
          <div className={`relative flex items-center ${colors.surface} backdrop-blur-sm rounded-2xl border ${colors.border} transition-colors`}>
            <Search className={`absolute left-3 w-4 h-4 ${colors.muted}`} />
            <input type="text" placeholder="搜索记忆..." value={q} onChange={event => setQ(event.target.value)} className={`w-full pl-9 pr-3 py-2 bg-transparent text-[13px] focus:outline-none placeholder:${isDark ? 'text-gray-600' : 'text-gray-300'} ${colors.text}`} />
            {q && <button onClick={() => setQ('')} className={`absolute right-2.5 p-0.5 rounded-full hover:bg-white/10 ${colors.muted}`}><X className="w-3.5 h-3.5" /></button>}
          </div>
          <div className="flex items-center gap-1.5">
            {TIME_RANGES.map(range => (
              <motion.button key={range.value} whileTap={{ scale: 0.95 }} onClick={() => setTr(range.value)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-medium transition-all ${
                  tr === range.value
                    ? isDark ? 'bg-white/10 text-white' : 'bg-gray-800/80 text-white'
                    : isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'
                }`}>
                {range.label}
              </motion.button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-[10px] opacity-40">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />用户
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />AI
              <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />记忆
            </div>
          </div>
        </div>
      </div>
      {/* Canvas 画布区域 */}
      <div className="flex-1 relative overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing" onPointerDown={event => { dragRef.current = { active: true, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (dragRef.current.active) { const dx = event.clientX - dragRef.current.x; const dy = event.clientY - dragRef.current.y; dragRef.current = { active: true, x: event.clientX, y: event.clientY }; const updated = { ...viewportRef.current, x: viewportRef.current.x + dx, y: viewportRef.current.y + dy }; viewportRef.current = updated; setViewport(updated); } else { setHoveredId(hitNode(event.clientX, event.clientY)?.id || null); } }} onPointerUp={event => { dragRef.current.active = false; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerLeave={() => { dragRef.current.active = false; setHoveredId(null); }} onClick={event => { const node = hitNode(event.clientX, event.clientY); if (node) { setSel(node); setHighlightId(node.id); } }} />
        {/* 空状态 */}
        {graphData.nodes.length === 0 && <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${colors.muted}`}><div className="text-center"><div className={`w-16 h-16 rounded-3xl border border-dashed mx-auto mb-4 flex items-center justify-center ${colors.border}`}><Brain className={`w-6 h-6 ${colors.muted}`} /></div><p className="text-sm font-medium">暂无匹配记忆</p><p className="text-xs mt-1 opacity-60">开始聊天后，这里会形成你的记忆网络</p></div></div>}
        {/* 底部极简提示 */}
        <div className={`absolute bottom-3 left-0 right-0 flex items-center justify-center gap-3 text-[10px] ${colors.muted} opacity-40 pointer-events-none`}>
          <span>拖拽平移</span>
          <span className="w-0.5 h-0.5 rounded-full bg-current" />
          <span>滚轮缩放</span>
          <span className="w-0.5 h-0.5 rounded-full bg-current" />
          <span>点击查看</span>
        </div>
      </div>
      <AnimatePresence>
        {sel && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 340 }}
            className="absolute bottom-0 left-0 right-0 z-[60] rounded-t-3xl border-t border-gray-200 dark:border-white/[0.06] shadow-[0_-12px_48px_rgba(0,0,0,0.1)] dark:shadow-[0_-12px_48px_rgba(0,0,0,0.5)] bg-white/95 dark:bg-gray-900/92 backdrop-blur-2xl"
            style={{ maxHeight: 'min(50vh, 400px)' }}
          >
            {/* 拖拽把手 */}
            <div className="flex justify-center pt-3 pb-1 cursor-grab">
              <div className="w-10 h-[3px] rounded-full bg-gray-300 dark:bg-white/15" />
            </div>

            {/* 内容区域 */}
            <div className="px-5 pb-5 overflow-y-auto" style={{ maxHeight: 'calc(min(50vh, 400px) - 20px)' }}>
              {/* 头部：类型/分类标签 + 关闭 */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-lg" style={{ backgroundColor: sel.color + '15', color: sel.color }}>
                    {TYPE_LABELS[sel.type]?.label || '节点'}
                  </span>
                  {sel.meta?.category && (
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-lg ${MEMORY_CATEGORY_COLORS[(sel.meta.category as MemoryCategory)] || ''}`}>
                      {CATEGORY_ICONS[(sel.meta.category as MemoryCategory)]}
                      {MEMORY_CATEGORY_LABELS[(sel.meta.category as MemoryCategory)]}
                    </span>
                  )}
                  {sel.timeLabel && (
                    <span className={`text-[10px] ${colors.muted}`}>{sel.timeLabel}</span>
                  )}
                </div>
                <button
                  onClick={() => { setSel(null); setHighlightId(null); }}
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-colors ${colors.button}`}
                >
                  <X className={`w-3.5 h-3.5 ${colors.muted}`} />
                </button>
              </div>

              {/* 标题 */}
              {sel.meta?.title && String(sel.meta.title) !== String(sel.meta?.content || '').slice(0, 34) && (
                <h4 className={`text-[14px] font-semibold mb-2 leading-snug ${colors.text}`}>
                  {String(sel.meta.title)}
                </h4>
              )}

              {/* 触发消息 — 极简引用样式 */}
              {sel.meta?.triggerMessage && (
                <div className={`mb-3 pl-3 border-l-2 ${
                  isDark ? 'border-slate-700/30' : 'border-slate-500/40'
                }`}>
                  <p className={`text-[11px] leading-relaxed italic ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    "{String(sel.meta.triggerMessage)}"
                  </p>
                </div>
              )}

              {/* 主内容 */}
              <p className={`text-[13px] leading-[1.8] whitespace-pre-wrap break-words ${colors.text} opacity-80`}>
                {String(sel.meta?.content || sel.meta?.fullSummary || sel.label)}
              </p>

              {/* 底部元信息 */}
              {((sel.meta?.tags as string[])?.length || (sel.meta?.importance != null) || (sel.meta?.characterId)) && (
                <div className={`mt-4 pt-3 border-t ${colors.border}`}>
                  {/* 标签 */}
                  {(sel.meta?.tags as string[])?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {(sel.meta?.tags as string[])?.map(tag => (
                        <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-lg ${colors.surface} ${colors.muted}`}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* 重要度 + characterId */}
                  <div className={`flex items-center gap-3 text-[10px] ${colors.muted}`}>
                    {sel.meta?.importance != null && (
                      <span className="flex items-center gap-1">
                        <Star size={9} className={isDark ? 'text-amber-400/70' : 'text-amber-500/70'} />
                        重要度 {String(sel.meta.importance)}/10
                      </span>
                    )}
                    {sel.meta?.characterId && (
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500/60" />
                        {String(sel.meta.characterId).slice(0, 8)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MemoryNetwork;
