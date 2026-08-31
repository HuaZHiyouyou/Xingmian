import { useState, useRef, useEffect } from 'react';
import {
  Image as ImageIcon,
  Sparkles,
  Type as TypeIcon,
  Film,
  Upload,
  Sun,
  Moon,
  Layout,
  Palette,
  User,
  Music,
  X,
  FileVideo,
  ImagePlus,
  Pin,
  PinOff,
  Trash2,
  Droplets,
  Snowflake,
  Layers,
  Square,
  Waves,
  Zap,
  Orbit,
  Sunrise,
  Star,
  CloudFog,
  Frame,
  Flame,
  Gem,
  PaintBucket,
} from 'lucide-react';
import { useUIStore, WALLPAPER_PRESETS, FONT_PRESETS, PARTICLE_TYPES, MESSAGE_ANIMATIONS, THEME_PRESETS, PARTICLE_PRESETS, MATERIALS, type WallpaperType, type MessageAnimation, type ObjectFit, type CardDecoration, type ThemeLayerConfig, type MaterialType, saveWallpaperToDb, type ThemeMode, type BubbleStyle, type AvatarStyle } from '../../store/uiStore';
import { isRunningInTauri, getFileFromDb } from '../../lib/tauriBridge';

function useResolvedUrl(source: string): string {
  const [resolved, setResolved] = useState(source.startsWith('db:') ? '' : source);
  useEffect(() => {
    if (!source || !source.startsWith('db:')) { setResolved(source); return undefined; }
    if (!isRunningInTauri()) { setResolved(''); return undefined; }
    const id = source.slice(3);
    let active = true;
    getFileFromDb(id).then((file) => {
      if (!active || !file) return;
      setResolved(`data:${file.mimeType};base64,${file.data}`);
    }).catch(() => { if (active) setResolved(''); });
    return () => { active = false; };
  }, [source]);
  return resolved;
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const { label, value, min, max, step, onChange, format } = props;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-20 text-xs text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ui-slider flex-1 h-1.5 rounded-full appearance-none cursor-pointer bg-gray-200 dark:bg-gray-700 accent-slate-700"
        style={{ '--range-pct': `${pct}%` } as React.CSSProperties}
      />
      <span className="w-12 text-xs text-right text-gray-600 dark:text-gray-300 tabular-nums">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const { label, checked, onChange } = props;
  return (
    <label className="flex items-center justify-between py-1.5 cursor-pointer">
      <span className="text-sm text-gray-700 dark:text-gray-200">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-slate-700' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-gray-500">{icon}</span>
      <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</h2>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, displayValue, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; displayValue?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
        <span className="text-xs text-slate-700 dark:text-slate-500 font-medium">{displayValue ?? value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step || 1} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-slate-700"
      />
    </div>
  );
}

function FileDropZone(props: {
  accept: string[];
  label: string;
  icon?: React.ReactNode;
  source: string;
  onUpload: (source: string, type?: string) => void;
  onClear: () => void;
  preview?: 'image' | 'video' | 'audio';
}) {
  const { accept, label, icon, source, onUpload, onClear, preview } = props;
  const resolvedSource = useResolvedUrl(source);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const dominated = accept.some((a) => {
      if (a.endsWith('/*')) {
        const prefix = a.replace('/*', '');
        return file.type.startsWith(prefix + '/');
      }
      return file.type === a || file.name.toLowerCase().endsWith(a.replace('*', ''));
    });
    if (!dominated) {
      console.warn('[FileDropZone] rejected file type:', file.type);
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl) return;
      onUpload(dataUrl);
    } catch (e) {
      console.error('[FileDropZone] upload error:', e);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const isImage = preview === 'image';
  const isVideo = preview === 'video';
  const isAudio = preview === 'audio';

  if (source) {
    return (
      <div className="space-y-2 mb-3">
        <input
          ref={inputRef}
          type="file"
          accept={accept.join(',')}
          onChange={handleChange}
          className="hidden"
        />
        <div
          className="relative rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800 group"
        >
          {isImage && resolvedSource && (
            <img src={resolvedSource} alt="" className="w-full h-40 object-cover" />
          )}
          {isVideo && resolvedSource && (
            <video src={resolvedSource} className="w-full h-40 object-cover" controls muted />
          )}
          {isAudio && resolvedSource && (
            <div className="flex items-center gap-3 p-3">
              <Music size={24} className="text-slate-700 dark:text-slate-300 shrink-0" />
              <audio src={resolvedSource} controls className="flex-1 h-8" style={{ maxWidth: '100%' }} />
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        onChange={handleChange}
        className="hidden"
      />
      <div
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-all ${
          dragOver
            ? 'border-slate-500 bg-slate-100 dark:bg-slate-800/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-slate-500 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        {icon || <Upload size={20} className="text-gray-400" />}
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      </div>
    </div>
  );
}

function SavedThumb(props: {
  sw: { id: string; type: string; source: string; name: string; pinned: boolean };
  isActive: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const { sw, isActive, onSelect, onTogglePin, onDelete } = props;
  const resolved = useResolvedUrl(sw.source);
  return (
    <div
      onClick={onSelect}
      className={`relative rounded-lg overflow-hidden group cursor-pointer transition-all bg-gray-50 dark:bg-gray-800 ${
        isActive ? 'ring-2 ring-slate-500' : 'hover:ring-1 hover:ring-gray-300'
      }`}
    >
      {sw.type === 'image' ? (
        resolved ? <img src={resolved} alt="" className="w-full h-16 object-cover" /> : <div className="w-full h-16 bg-gray-200 dark:bg-gray-700 animate-pulse" />
      ) : (
        resolved ? <video src={resolved} className="w-full h-16 object-cover" muted /> : <div className="w-full h-16 bg-gray-200 dark:bg-gray-700 animate-pulse" />
      )}
      <div className="absolute inset-0 flex items-end justify-between p-1 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(); }}
          className={`p-1 rounded text-xs ${sw.pinned ? 'text-yellow-300' : 'text-white'}`}
          title={sw.pinned ? '取消固定' : '固定'}
        >
          {sw.pinned ? <Pin size={12} /> : <PinOff size={12} />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 rounded text-xs text-red-300 hover:text-red-100"
          title="删除"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {sw.pinned && (
        <span className="absolute top-0.5 right-0.5"><Pin size={10} className="text-yellow-300" /></span>
      )}
    </div>
  );
}

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Layout },
];

const FONT_SIZE_OPTIONS: { value: 'small' | 'medium' | 'large'; label: string; weight: string }[] = [
  { value: 'small', label: '小', weight: 'text-xs' },
  { value: 'medium', label: '中', weight: 'text-sm' },
  { value: 'large', label: '大', weight: 'text-lg' },
];

const BUBBLE_STYLE_OPTIONS: { value: BubbleStyle; label: string; desc: string }[] = [
  { value: 'rounded', label: '圆润', desc: '现代圆角' },
  { value: 'wechat', label: '微信', desc: '仿微信风格' },
  { value: 'pill', label: '胶囊', desc: '全圆角药丸' },
  { value: 'glass', label: '毛玻璃', desc: '半透明磨砂' },
  { value: 'bubble', label: '气泡', desc: '带尖角气泡' },
  { value: 'gradient', label: '渐变', desc: '渐变色气泡' },
  { value: 'sharp', label: '直角', desc: '棱角分明' },
  { value: 'minimal', label: '极简', desc: '无背景极简' },
];

const ACCENT_COLORS = [
  { value: '#2563eb', label: '湛蓝', bg: 'bg-blue-600' },
  { value: '#7c3aed', label: '紫罗兰', bg: 'bg-violet-600' },
  { value: '#059669', label: '翡翠', bg: 'bg-emerald-600' },
  { value: '#dc2626', label: '中国红', bg: 'bg-red-600' },
  { value: '#d97706', label: '琥珀', bg: 'bg-amber-600' },
  { value: '#0891b2', label: '青色', bg: 'bg-cyan-600' },
  { value: '#64748b', label: '岩灰', bg: 'bg-slate-500' },
  { value: '#ea580c', label: '橙色', bg: 'bg-orange-600' },
  { value: '#475569', label: '石墨', bg: 'bg-gray-600' },
  { value: '#000000', label: '纯黑', bg: 'bg-black' },
];

const AVATAR_STYLE_OPTIONS: { value: AvatarStyle; label: string }[] = [
  { value: 'circle', label: '圆形' },
  { value: 'squircle', label: '超椭圆' },
  { value: 'square', label: '方角' },
];

// ========== 主题面板常量 ==========
const DECORATION_ICONS: Record<string, React.ReactNode> = {
  none: <Layout size={18} />,
  solid: <Square size={18} />,
  outline: <Frame size={18} />,
  glass: <Droplets size={18} />,
  frosted: <Snowflake size={18} />,
  glow: <Sparkles size={18} />,
  aurora: <Waves size={18} />,
  neon: <Zap size={18} />,
  flow: <Orbit size={18} />,
  sunset: <Sunrise size={18} />,
};

const DECORATION_LABELS: Record<CardDecoration, string> = {
  none: '无装饰',
  solid: '纯色不透明',
  outline: '描边',
  glass: '毛玻璃',
  frosted: '冰霜',
  glow: '柔光',
  aurora: '极光',
  neon: '霓虹',
  flow: '流光',
  sunset: '暖阳',
};

/** 🆕 各装饰类型的专属调节栏配置（不同风格有自己独立的控制项） */
const DECORATION_CONTROLS: Record<CardDecoration, Array<{
  key: 'glowIntensity' | 'animationSpeed';
  label: string;
  min: number; max: number; step: number;
  display: (v: number) => string;
}>> = {
  none: [],
  solid: [],
  outline: [],
  glass: [],
  frosted: [],
  glow: [
    { key: 'glowIntensity', label: '发光强度', min: 0, max: 1, step: 0.05, display: (v) => `${Math.round(v * 100)}%` },
  ],
  aurora: [
    { key: 'animationSpeed', label: '极光流速', min: 0.2, max: 3, step: 0.1, display: (v) => `${v.toFixed(1)}x` },
  ],
  neon: [
    { key: 'glowIntensity', label: '霓虹强度', min: 0, max: 1, step: 0.05, display: (v) => `${Math.round(v * 100)}%` },
    { key: 'animationSpeed', label: '呼吸速度', min: 0.2, max: 3, step: 0.1, display: (v) => `${v.toFixed(1)}x` },
  ],
  flow: [
    { key: 'animationSpeed', label: '流光速度', min: 0.2, max: 3, step: 0.1, display: (v) => `${v.toFixed(1)}x` },
  ],
  sunset: [
    { key: 'glowIntensity', label: '光晕强度', min: 0, max: 1, step: 0.05, display: (v) => `${Math.round(v * 100)}%` },
  ],
};

const LAYER_LABELS: { key: keyof ThemeLayerConfig; label: string }[] = [
  { key: 'sidebar', label: '侧边栏' },
  { key: 'header', label: '顶部栏' },
  { key: 'content', label: '内容区' },
  { key: 'card', label: '卡片' },
  { key: 'modal', label: '弹窗/抽屉' },
];

const PRESET_THEME_ICONS: Record<string, React.ReactNode> = {
  palette: <Layout size={18} />,
  square: <Square size={18} />,
  droplets: <Droplets size={18} />,
  snowflake: <Snowflake size={18} />,
  sparkles: <Sparkles size={18} />,
  waves: <Waves size={18} />,
  zap: <Zap size={18} />,
  orbit: <Orbit size={18} />,
  sunrise: <Sunrise size={18} />,
  star: <Star size={18} />,
  cloudfog: <CloudFog size={18} />,
  flame: <Flame size={18} />,
  gem: <Gem size={18} />,
  paintbucket: <PaintBucket size={18} />,
};

// ========== 主题面板组件 ==========
function UIThemeSection() {
  const uiTheme = useUIStore((s) => s.uiTheme);
  const updateTheme = useUIStore((s) => s.updateTheme);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
      <SectionTitle icon={<Layers size={16} />} title="主题装饰" />

      {/* 预设方案 */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {THEME_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => updateTheme(preset.config)}
            className={`flex flex-col items-center gap-1 px-3 py-3 rounded-xl text-xs transition-all border ${
              uiTheme.presetId === preset.id
                ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <div className="text-slate-700 dark:text-slate-300">{PRESET_THEME_ICONS[preset.icon]}</div>
            <span className="font-medium">{preset.name}</span>
            <span className="text-[10px] opacity-60">{preset.description}</span>
          </button>
        ))}
      </div>

      {/* 卡片装饰风格 */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">卡片装饰</label>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(DECORATION_LABELS) as CardDecoration[]).map((key) => (
            <button
              key={key}
              onClick={() => updateTheme({ cardDecoration: key })}
              className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-xs transition-all border ${
                uiTheme.cardDecoration === key
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <div className="text-slate-700 dark:text-slate-300">{DECORATION_ICONS[key]}</div>
              <span>{DECORATION_LABELS[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 装饰颜色 */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-700 dark:text-gray-300">装饰颜色</span>
        <input
          type="color"
          value={uiTheme.decorationColor}
          onChange={(e) => updateTheme({ decorationColor: e.target.value })}
          className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer"
        />
      </div>

      {/* 🆕 当前装饰类型的专属调节栏（不同风格有自己独立的控制项） */}
      {(DECORATION_CONTROLS[uiTheme.cardDecoration] || []).map((ctl) => (
        <SliderRow
          key={ctl.key}
          label={ctl.label}
          value={(uiTheme[ctl.key] ?? 1) as number}
          min={ctl.min}
          max={ctl.max}
          step={ctl.step}
          displayValue={ctl.display((uiTheme[ctl.key] ?? 1) as number)}
          onChange={(v) => updateTheme({ [ctl.key]: v })}
        />
      ))}

      {/* 卡片圆角 */}
      <SliderRow label="卡片圆角" value={uiTheme.cardBorderRadius} min={0} max={24} step={1}
        displayValue={`${uiTheme.cardBorderRadius}px`}
        onChange={(v) => updateTheme({ cardBorderRadius: v })} />

      {/* 卡片边框宽度 */}
      <SliderRow label="边框宽度" value={uiTheme.cardBorderWidth} min={0} max={3} step={0.5}
        displayValue={`${uiTheme.cardBorderWidth}px`}
        onChange={(v) => updateTheme({ cardBorderWidth: v })} />

      {/* 详细调节展开/收起 */}
      <button
        onClick={() => setShowDetail(!showDetail)}
        className="w-full mt-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/20 rounded-xl transition-colors"
          >
            {showDetail ? '▲ 收起层级微调' : '▼ 展开层级微调（5层独立控制）'}
          </button>

          {showDetail && (
            <div className="mt-3 space-y-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
              {/* 透明度 5 层 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">透明度</label>
                {LAYER_LABELS.map(({ key, label }) => (
                  <SliderRow key={`op-${key}`} label={label} value={uiTheme.layerOpacity[key]} min={0} max={1} step={0.05}
                    displayValue={`${Math.round(uiTheme.layerOpacity[key] * 100)}%`}
                    onChange={(v) => updateTheme({ layerOpacity: { ...uiTheme.layerOpacity, [key]: v } })} />
                ))}
              </div>
              {/* 模糊 5 层 */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">模糊</label>
                {LAYER_LABELS.map(({ key, label }) => (
                  <SliderRow key={`blur-${key}`} label={label} value={uiTheme.layerBlur[key]} min={0} max={40} step={1}
                    displayValue={`${uiTheme.layerBlur[key]}px`}
                    onChange={(v) => updateTheme({ layerBlur: { ...uiTheme.layerBlur, [key]: v } })} />
                ))}
              </div>
            </div>
          )}
    </section>
  );
}

// ========== 主界面 ==========
export function UISettingsPanel() {
  const theme = useUIStore((s) => s.theme);
  const fontSize = useUIStore((s) => s.fontSize);
  const bubbleStyle = useUIStore((s) => s.bubbleStyle);
  const accentColor = useUIStore((s) => s.accentColor);
  const avatarStyle = useUIStore((s) => s.avatarStyle);
  const wallpaper = useUIStore((s) => s.wallpaper);
  const particles = useUIStore((s) => s.particles);
  const material = useUIStore((s) => s.material);
  const materialIntensity = useUIStore((s) => s.materialIntensity);
  const materialScale = useUIStore((s) => s.materialScale);
  const font = useUIStore((s) => s.font);
  const slide = useUIStore((s) => s.slide);

  const updateConfig = useUIStore((s) => s.updateConfig);
  const updateWallpaper = useUIStore((s) => s.updateWallpaper);
  const updateParticles = useUIStore((s) => s.updateParticles);
  const updateFont = useUIStore((s) => s.updateFont);
  const updateSlide = useUIStore((s) => s.updateSlide);
  const updateSavedWallpapers = useUIStore((s) => s.updateSavedWallpapers);
  const resetUI = useUIStore((s) => s.resetUI);

  const wallpaperTypes: { id: WallpaperType; label: string }[] = [
    { id: 'none', label: '关闭' },
    { id: 'preset', label: '预设' },
    { id: 'image', label: '图片' },
    { id: 'video', label: '视频' },
  ];

  return (
    <div className="space-y-4">
      {/* ─── Basic Theme ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<Palette size={16} />} title="外观主题" />
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateConfig({ theme: opt.value })}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all border ${
                theme === opt.value
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <opt.icon size={14} />
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* ─── Font Size ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<TypeIcon size={16} />} title="字体大小" />
        <div className="grid grid-cols-3 gap-2">
          {FONT_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateConfig({ fontSize: opt.value })}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-all border ${
                fontSize === opt.value
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <span className={opt.weight}>Aa</span>
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* ─── Bubble Style ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<Layout size={16} />} title="气泡样式" />
        <div className="grid grid-cols-4 gap-2">
          {BUBBLE_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateConfig({ bubbleStyle: opt.value })}
              className={`flex flex-col items-center gap-1 px-2 py-3 rounded-xl text-xs transition-all border ${
                bubbleStyle === opt.value
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">{opt.desc}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ─── Accent Color ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<Palette size={16} />} title="主题色" />
        <div className="flex flex-wrap gap-2">
          {ACCENT_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => updateConfig({ accentColor: c.value })}
              className={`w-9 h-9 rounded-full transition-all ${c.bg} ${
                accentColor === c.value
                  ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900 ring-gray-400 dark:ring-gray-500 scale-110'
                  : 'hover:scale-110'
              }`}
              title={c.label}
            />
          ))}
        </div>
      </section>

      {/* ─── Avatar Shape ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<User size={16} />} title="头像形状" />
        <div className="grid grid-cols-3 gap-2">
          {AVATAR_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateConfig({ avatarStyle: opt.value })}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm transition-all border ${
                avatarStyle === opt.value
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <div className={`w-5 h-5 bg-slate-500 ${
                opt.value === 'circle' ? 'rounded-full' : opt.value === 'squircle' ? '' : 'rounded'
              }`} style={opt.value === 'squircle' ? { borderRadius: '22%' } : undefined} />
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <div className="border-t border-gray-100 dark:border-gray-800" />

      {/* ─── UI Theme (5-layer control + card decorations) ─── */}
      <UIThemeSection />

      {/* ─── Wallpaper ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<ImageIcon size={16} />} title="壁纸" />
        <div className="p-2">
          <div className="grid grid-cols-4 gap-2 mb-3">
            {wallpaperTypes.map((t) => (
              <button
                key={t.id}
                onClick={() => updateWallpaper({ type: t.id })}
                className={`flex items-center justify-center px-2 py-1.5 rounded-full text-xs transition-all border ${
                  wallpaper.type === t.id
                    ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {wallpaper.type === 'preset' && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              {WALLPAPER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => updateWallpaper({ presetId: p.id })}
                  className={`h-12 rounded-lg text-xs text-white/90 overflow-hidden relative ${
                    wallpaper.presetId === p.id ? 'ring-2 ring-slate-500' : ''
                  }`}
                  style={{ backgroundImage: p.css, backgroundSize: 'cover' }}
                >
                  <span className="absolute inset-0 flex items-end justify-center pb-1 bg-black/20">{p.name}</span>
                </button>
              ))}
            </div>
          )}

          {wallpaper.type === 'image' && (
            <FileDropZone
              key="image-drop"
              accept={['image/*']}
              label="点击或拖拽图片到此处"
              icon={<ImagePlus size={20} className="text-gray-400" />}
              source={wallpaper.imageSource}
              preview="image"
              onUpload={async (src) => {
                const dbRef = await saveWallpaperToDb(src, 'image');
                const savedSrc = dbRef || src;
                const sw = wallpaper.savedWallpapers;
                const exists = sw.some((w) => w.source === savedSrc);
                if (!exists) {
                  updateSavedWallpapers([...sw, { id: randomId('wp'), type: 'image', source: savedSrc, name: `图片 ${sw.length + 1}`, pinned: false }]);
                }
                updateWallpaper({ imageSource: savedSrc, source: savedSrc, type: 'image' });
              }}
              onClear={() => updateWallpaper({ imageSource: '', source: '', type: 'none' })}
            />
          )}

          {wallpaper.type === 'video' && (
            <>
              <FileDropZone
                key="video-drop"
                accept={['video/*']}
                label="点击或拖拽视频到此处"
                icon={<FileVideo size={20} className="text-gray-400" />}
                source={wallpaper.videoSource}
                preview="video"
                onUpload={async (src) => {
                  const dbRef = await saveWallpaperToDb(src, 'video');
                  const savedSrc = dbRef || src;
                  const sw = wallpaper.savedWallpapers;
                  const exists = sw.some((w) => w.source === savedSrc);
                  if (!exists) {
                    updateSavedWallpapers([...sw, { id: randomId('wp'), type: 'video', source: savedSrc, name: `视频 ${sw.length + 1}`, pinned: false }]);
                  }
                  updateWallpaper({ videoSource: savedSrc, source: savedSrc, type: 'video' });
                }}
                onClear={() => updateWallpaper({ videoSource: '', source: '', type: 'none' })}
              />
              {wallpaper.videoSource && (
                <div className="space-y-1 mt-2">
                  <Toggle label="视频静音" checked={wallpaper.videoMuted} onChange={(v) => updateWallpaper({ videoMuted: v })} />
                  {!wallpaper.videoMuted && (
                    <Slider label="视频音量" value={wallpaper.videoVolume} min={0} max={1} step={0.01} onChange={(v) => updateWallpaper({ videoVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
                  )}
                </div>
              )}
            </>
          )}

          {wallpaper.type !== 'none' && (
            <>
              <Toggle label="固定壁纸（覆盖全部页面）" checked={wallpaper.pinned} onChange={(v) => updateWallpaper({ pinned: v })} />
              <div className="flex gap-2 mt-1 mb-2">
                {(['cover', 'contain', 'fill'] as ObjectFit[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => updateWallpaper({ objectFit: f })}
                    className={`flex-1 px-2 py-1 rounded-full text-xs transition-all border ${
                      wallpaper.objectFit === f
                        ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    {f === 'cover' ? '裁剪填充' : f === 'contain' ? '完整显示' : '拉伸'}
                  </button>
                ))}
              </div>
              <Slider label="缩放" value={wallpaper.scale} min={0.5} max={2} step={0.01} onChange={(v) => updateWallpaper({ scale: v })} format={(v) => `${v.toFixed(2)}x`} />
              <Slider label="水平" value={wallpaper.positionX} min={-50} max={50} step={1} onChange={(v) => updateWallpaper({ positionX: v })} format={(v) => `${v}%`} />
              <Slider label="垂直" value={wallpaper.positionY} min={-50} max={50} step={1} onChange={(v) => updateWallpaper({ positionY: v })} format={(v) => `${v}%`} />
              <Slider label="模糊" value={wallpaper.blur} min={0} max={20} step={0.5} onChange={(v) => updateWallpaper({ blur: v })} format={(v) => `${v}px`} />
              <Slider label="亮度" value={wallpaper.brightness} min={0.3} max={2} step={0.01} onChange={(v) => updateWallpaper({ brightness: v })} format={(v) => v.toFixed(2)} />
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-medium">图层透明度</p>
                <Slider label="侧边栏" value={wallpaper.layerOpacity.sidebar} min={0} max={1} step={0.01} onChange={(v) => updateWallpaper({ layerOpacity: { ...wallpaper.layerOpacity, sidebar: v } })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="顶栏" value={wallpaper.layerOpacity.header} min={0} max={1} step={0.01} onChange={(v) => updateWallpaper({ layerOpacity: { ...wallpaper.layerOpacity, header: v } })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="内容区" value={wallpaper.opacity} min={0} max={1} step={0.01} onChange={(v) => updateWallpaper({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
                <Slider label="卡片" value={wallpaper.layerOpacity.card} min={0} max={1} step={0.01} onChange={(v) => updateWallpaper({ layerOpacity: { ...wallpaper.layerOpacity, card: v } })} format={(v) => `${Math.round(v * 100)}%`} />
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 mt-2 font-medium">图层毛玻璃</p>
                <Slider label="侧边栏" value={wallpaper.layerBlur.sidebar} min={0} max={30} step={0.5} onChange={(v) => updateWallpaper({ layerBlur: { ...wallpaper.layerBlur, sidebar: v } })} format={(v) => `${v}px`} />
                <Slider label="顶栏" value={wallpaper.layerBlur.header} min={0} max={30} step={0.5} onChange={(v) => updateWallpaper({ layerBlur: { ...wallpaper.layerBlur, header: v } })} format={(v) => `${v}px`} />
                <Slider label="内容区" value={wallpaper.layerBlur.content} min={0} max={30} step={0.5} onChange={(v) => updateWallpaper({ layerBlur: { ...wallpaper.layerBlur, content: v } })} format={(v) => `${v}px`} />
                <Slider label="卡片" value={wallpaper.layerBlur.card} min={0} max={30} step={0.5} onChange={(v) => updateWallpaper({ layerBlur: { ...wallpaper.layerBlur, card: v } })} format={(v) => `${v}px`} />
              </div>
            </>
          )}

          {/* Saved Wallpapers Library */}
          {wallpaper.savedWallpapers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs text-gray-500 mb-2">已保存的壁纸（点击选择，固定后永久保留）</p>
              <div className="grid grid-cols-3 gap-2">
                {wallpaper.savedWallpapers.map((sw) => {
                  const isActive = wallpaper.type === sw.type && wallpaper.imageSource === sw.source || wallpaper.videoSource === sw.source;
                  return (
                    <SavedThumb
                      key={sw.id}
                      sw={sw}
                      isActive={isActive}
                      onSelect={() => {
                        if (sw.type === 'image') updateWallpaper({ imageSource: sw.source, source: sw.source, type: 'image' });
                        else updateWallpaper({ videoSource: sw.source, source: sw.source, type: 'video' });
                      }}
                      onTogglePin={() => {
                        const updated = wallpaper.savedWallpapers.map((w) => w.id === sw.id ? { ...w, pinned: !w.pinned } : w);
                        updateSavedWallpapers(updated);
                      }}
                      onDelete={() => {
                        const updated = wallpaper.savedWallpapers.filter((w) => w.id !== sw.id);
                        updateSavedWallpapers(updated);
                        if (isActive) updateWallpaper({ type: 'none', imageSource: '', videoSource: '', source: '' });
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Music - 已迁移到独立播放器模块 */}
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Music size={14} />
              <span>背景音乐已迁移至独立播放器模块</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Particles ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<Sparkles size={16} />} title="粒子特效" />
        <div className="p-2">
          <Toggle label="启用粒子" checked={particles.enabled} onChange={(v) => updateParticles({ enabled: v })} />
          {particles.enabled && (
            <>
              {/* 🆕 内置粒子装饰组合（一键应用整套氛围） */}
              <div className="mb-3">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">内置装饰组合</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {PARTICLE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => updateParticles({ ...p.config, enabled: true })}
                      className="px-2 py-1.5 rounded-full text-[11px] transition-all border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-300 hover:text-blue-500 dark:hover:border-blue-700"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 my-3">
                {PARTICLE_TYPES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => updateParticles({ type: t.id })}
                    className={`flex items-center justify-center px-2 py-1.5 rounded-full text-xs transition-all border ${
                      particles.type === t.id
                        ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <Slider label="数量" value={particles.count} min={5} max={300} step={1} onChange={(v) => updateParticles({ count: v })} />
              <Slider label="大小" value={particles.size} min={1} max={20} step={0.5} onChange={(v) => updateParticles({ size: v })} />
              <Slider label="发光" value={particles.glow} min={0} max={30} step={1} onChange={(v) => updateParticles({ glow: v })} />
              <Slider label="速度" value={particles.speed} min={0.1} max={5} step={0.1} onChange={(v) => updateParticles({ speed: v })} format={(v) => v.toFixed(1)} />
              <Slider label="不透明" value={particles.opacity} min={0.1} max={1} step={0.01} onChange={(v) => updateParticles({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
              {/* 🆕 流光拖尾 */}
              <Slider label="流光拖尾" value={particles.trail ?? 0} min={0} max={30} step={1} onChange={(v) => updateParticles({ trail: v })} />
              {/* 🆕 发光模式 */}
              <div className="flex items-center gap-2 py-1.5">
                <span className="w-20 text-xs text-gray-500 dark:text-gray-400 shrink-0">发光模式</span>
                <div className="flex gap-1.5">
                  {([['none', '无'], ['halo', '光晕'], ['pulse', '脉动']] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => updateParticles({ glowMode: mode })}
                      className={`px-2.5 py-1 rounded-full text-xs transition-all border ${
                        (particles.glowMode ?? 'none') === mode
                          ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3 py-1.5">
                <span className="w-20 text-xs text-gray-500 dark:text-gray-400">颜色</span>
                <input
                  type="color"
                  value={particles.color}
                  onChange={(e) => updateParticles({ color: e.target.value })}
                  className="w-10 h-8 rounded bg-transparent border border-gray-200 dark:border-gray-700"
                />
                <span className="text-xs text-gray-500">{particles.color}</span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ─── 🆑 材质板块 ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<Layers size={16} />} title="卡片材质" />
        <div className="p-2">
          <p className="text-[11px] text-gray-400 mb-2.5">为卡片表面叠加不同材质纹理，可与任意主题装饰叠加使用</p>
          <div className="grid grid-cols-4 gap-2">
            {MATERIALS.map((m) => {
              const active = (material ?? 'none') === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => updateConfig({ material: m.id as MaterialType })}
                  title={m.description}
                  className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl transition-all border ${
                    active
                      ? 'border-slate-400 dark:border-slate-600 ring-1 ring-slate-300 dark:ring-slate-600'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <span
                    className="w-full h-9 rounded-lg border border-gray-200/60 dark:border-gray-700/60"
                    style={{ backgroundColor: m.previewColor, backgroundImage: m.preview === 'none' ? undefined : m.preview }}
                  />
                  <span className={`text-[10px] ${active ? 'text-slate-700 dark:text-slate-300 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>{m.name}</span>
                </button>
              );
            })}
          </div>

          {/* 🆕 材质微调：浓度 / 纹理缩放（仅作用于卡片表面） */}
          {material !== 'none' && (
            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <Slider
                label="材质浓度"
                value={materialIntensity ?? 0.85}
                min={0.05} max={1} step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => updateConfig({ materialIntensity: v })}
              />
              <Slider
                label="纹理缩放"
                value={materialScale ?? 1}
                min={0.5} max={3} step={0.1}
                format={(v) => `${v.toFixed(1)}x`}
                onChange={(v) => updateConfig({ materialScale: v })}
              />
              <p className="text-[10px] text-gray-400 mt-1">仅作用于卡片表面：浓度越低纹理越淡，缩放控制纹理颗粒大小</p>
            </div>
          )}
        </div>
      </section>

      {/* ─── Font Family ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<TypeIcon size={16} />} title="字体" />
        <div className="p-2 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {FONT_PRESETS.map((f) => (
              <button
                key={f.id}
                onClick={() => updateFont({ family: f.id })}
                className={`px-3 py-2 rounded-full text-sm text-left transition-all border ${
                  font.family === f.id
                    ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Animation ─── */}
      <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
        <SectionTitle icon={<Film size={16} />} title="动画与过渡" />
        <div className="p-2">
          <p className="text-xs text-gray-500 mb-2">消息进入动画</p>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {MESSAGE_ANIMATIONS.map((a) => (
              <button
                key={a.id}
                onClick={() => updateSlide({ messageAnimation: a.id as MessageAnimation })}
                className={`flex items-center justify-center px-2 py-1.5 rounded-full text-xs transition-all border ${
                  slide.messageAnimation === a.id
                    ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {a.name}
              </button>
            ))}
          </div>
          <Toggle label="页面切换动画" checked={slide.pageTransition} onChange={(v) => updateSlide({ pageTransition: v })} />
          <Toggle label="减少动效（无障碍）" checked={slide.reduceMotion} onChange={(v) => updateSlide({ reduceMotion: v })} />
        </div>
      </section>

      <div className="flex justify-end pt-1">
        <button
          onClick={resetUI}
          className="px-4 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          恢复默认外观
        </button>
      </div>
    </div>
  );
}
