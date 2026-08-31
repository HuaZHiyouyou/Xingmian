import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontSize = 'small' | 'medium' | 'large';
export type BubbleStyle = 'rounded' | 'sharp' | 'minimal' | 'wechat' | 'pill' | 'glass' | 'bubble' | 'gradient';
export type AvatarStyle = 'circle' | 'square' | 'squircle';

export type WallpaperType = 'none' | 'preset' | 'image' | 'video' | 'url';
export type ObjectFit = 'cover' | 'contain' | 'fill';
export type ParticleType = 'none' | 'snow' | 'stars' | 'hearts' | 'bubbles' | 'petals' | 'sparkles' | 'firefly' | 'confetti' | 'rain' | 'cherry' | 'butterfly' | 'firework';
export type MessageAnimation = 'fadeUp' | 'fadeIn' | 'slideLeft' | 'scaleIn' | 'none';

/** 卡片装饰风格 */
export type CardDecoration = 'none' | 'solid' | 'outline' | 'glass' | 'glow' | 'frosted' | 'aurora' | 'neon' | 'flow' | 'sunset';

/** 主题层级配置 — 5层独立控制 */
export interface ThemeLayerConfig {
  sidebar: number;
  header: number;
  content: number;
  card: number;
  modal: number;
}

/** 主题配置 */
export interface ThemeConfig {
  /** 预设标识（用于区分选中状态） */
  presetId: string;
  /** 卡片装饰风格 */
  cardDecoration: CardDecoration;
  /** 各层级透明度 0~1 */
  layerOpacity: ThemeLayerConfig;
  /** 各层级模糊 0~40 */
  layerBlur: ThemeLayerConfig;
  /** 卡片圆角 0~24 */
  cardBorderRadius: number;
  /** 卡片边框宽度 0~2 */
  cardBorderWidth: number;
  /** 发光主色 */
  decorationColor: string;
  /** 发光强度 0~1 */
  glowIntensity: number;
  /** 🆕 装饰动画速度倍率 0.2~3（极光流速/霓虹呼吸/流光巡游） */
  animationSpeed: number;
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  config: ThemeConfig;
}

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'default', name: '默认', description: '不应用任何主题效果', icon: 'palette',
    config: {
      presetId: 'default',
      cardDecoration: 'none',
      layerOpacity: { sidebar: 0, header: 0, content: 0, card: 0, modal: 0 },
      layerBlur: { sidebar: 0, header: 0, content: 0, card: 0, modal: 0 },
      cardBorderRadius: 12, cardBorderWidth: 0,
      decorationColor: '#334155', glowIntensity: 0,
      animationSpeed: 1,
    },
  },
  {
    id: 'solid', name: '纯色不透明', description: '纯色不透明卡片', icon: 'square',
    config: {
      presetId: 'solid',
      cardDecoration: 'none',
      layerOpacity: { sidebar: 1, header: 1, content: 1, card: 1, modal: 1 },
      layerBlur: { sidebar: 0, header: 0, content: 0, card: 0, modal: 0 },
      cardBorderRadius: 12, cardBorderWidth: 0,
      decorationColor: '#334155', glowIntensity: 0,
      animationSpeed: 1,
    },
  },
  {
    id: 'clean-solid', name: '简约不透明', description: '纯色卡片+描边阴影', icon: 'paintbucket',
    config: {
      presetId: 'clean-solid',
      cardDecoration: 'solid',
      layerOpacity: { sidebar: 1, header: 1, content: 1, card: 1, modal: 1 },
      layerBlur: { sidebar: 0, header: 0, content: 0, card: 0, modal: 0 },
      cardBorderRadius: 16, cardBorderWidth: 1,
      decorationColor: '#64748b', glowIntensity: 0,
      animationSpeed: 1,
    },
  },
  {
    id: 'glass', name: '毛玻璃', description: '半透明模糊效果', icon: 'droplets',
    config: {
      presetId: 'glass',
      cardDecoration: 'glass',
      layerOpacity: { sidebar: 0.6, header: 0.7, content: 0.75, card: 0.85, modal: 0.9 },
      layerBlur: { sidebar: 20, header: 16, content: 12, card: 16, modal: 24 },
      cardBorderRadius: 16, cardBorderWidth: 1,
      decorationColor: '#334155', glowIntensity: 0,
      animationSpeed: 1,
    },
  },
  {
    id: 'frosted', name: '冰霜', description: '强模糊效果', icon: 'snowflake',
    config: {
      presetId: 'frosted',
      cardDecoration: 'frosted',
      layerOpacity: { sidebar: 0.5, header: 0.6, content: 0.65, card: 0.75, modal: 0.85 },
      layerBlur: { sidebar: 30, header: 24, content: 20, card: 24, modal: 32 },
      cardBorderRadius: 16, cardBorderWidth: 1,
      decorationColor: '#38bdf8', glowIntensity: 0,
      animationSpeed: 1,
    },
  },
  {
    id: 'glow', name: '柔光', description: '卡片边框柔光', icon: 'sparkles',
    config: {
      presetId: 'glow',
      cardDecoration: 'glow',
      layerOpacity: { sidebar: 0.88, header: 0.92, content: 0.95, card: 0.95, modal: 0.96 },
      layerBlur: { sidebar: 8, header: 6, content: 4, card: 8, modal: 12 },
      cardBorderRadius: 16, cardBorderWidth: 1,
      decorationColor: '#94a3b8', glowIntensity: 0.6,
      animationSpeed: 1,
    },
  },
  {
    id: 'aurora', name: '极光', description: '多彩流光描边', icon: 'waves',
    config: {
      presetId: 'aurora',
      cardDecoration: 'aurora',
      layerOpacity: { sidebar: 0.55, header: 0.65, content: 0.7, card: 0.8, modal: 0.88 },
      layerBlur: { sidebar: 22, header: 18, content: 14, card: 18, modal: 26 },
      cardBorderRadius: 16, cardBorderWidth: 1,
      decorationColor: '#22d3ee', glowIntensity: 0.35,
      animationSpeed: 1,
    },
  },
  {
    id: 'neon-night', name: '霓虹夜', description: '霓虹呼吸光效', icon: 'zap',
    config: {
      presetId: 'neon-night',
      cardDecoration: 'neon',
      layerOpacity: { sidebar: 0.7, header: 0.78, content: 0.82, card: 0.85, modal: 0.9 },
      layerBlur: { sidebar: 14, header: 10, content: 8, card: 10, modal: 16 },
      cardBorderRadius: 14, cardBorderWidth: 1,
      decorationColor: '#22d3ee', glowIntensity: 0.6,
      animationSpeed: 1.2,
    },
  },
  {
    id: 'flowline', name: '流光', description: '细边框流光巡游', icon: 'orbit',
    config: {
      presetId: 'flowline',
      cardDecoration: 'flow',
      layerOpacity: { sidebar: 0.82, header: 0.88, content: 0.92, card: 0.94, modal: 0.95 },
      layerBlur: { sidebar: 8, header: 6, content: 4, card: 6, modal: 10 },
      cardBorderRadius: 16, cardBorderWidth: 1,
      decorationColor: '#2563eb', glowIntensity: 0,
      animationSpeed: 1.4,
    },
  },
  {
    id: 'sunset-glow', name: '暖阳', description: '落日暖光晕染', icon: 'sunrise',
    config: {
      presetId: 'sunset-glow',
      cardDecoration: 'sunset',
      layerOpacity: { sidebar: 0.85, header: 0.9, content: 0.93, card: 0.95, modal: 0.96 },
      layerBlur: { sidebar: 8, header: 6, content: 4, card: 8, modal: 12 },
      cardBorderRadius: 18, cardBorderWidth: 1,
      decorationColor: '#fb923c', glowIntensity: 0.55,
      animationSpeed: 1,
    },
  },
  {
    id: 'starlight', name: '星屑', description: '星尘流光细边', icon: 'star',
    config: {
      presetId: 'starlight',
      cardDecoration: 'flow',
      layerOpacity: { sidebar: 0.6, header: 0.7, content: 0.75, card: 0.85, modal: 0.9 },
      layerBlur: { sidebar: 20, header: 16, content: 12, card: 16, modal: 22 },
      cardBorderRadius: 16, cardBorderWidth: 1,
      decorationColor: '#7dd3fc', glowIntensity: 0,
      animationSpeed: 1.6,
    },
  },
  {
    id: 'mist', name: '薄雾', description: '浓雾弥漫朦胧', icon: 'cloudfog',    config: {
      presetId: 'mist',
      cardDecoration: 'frosted',
      layerOpacity: { sidebar: 0.4, header: 0.5, content: 0.55, card: 0.65, modal: 0.8 },
      layerBlur: { sidebar: 34, header: 28, content: 24, card: 28, modal: 36 },
      cardBorderRadius: 20, cardBorderWidth: 1,
      decorationColor: '#cbd5e1', glowIntensity: 0,
      animationSpeed: 1,
    },
  },
  {
    id: 'ember', name: '焰纹', description: '余烬红霓呼吸', icon: 'flame',
    config: {
      presetId: 'ember',
      cardDecoration: 'neon',
      layerOpacity: { sidebar: 0.72, header: 0.8, content: 0.84, card: 0.88, modal: 0.92 },
      layerBlur: { sidebar: 12, header: 10, content: 8, card: 10, modal: 14 },
      cardBorderRadius: 14, cardBorderWidth: 1,
      decorationColor: '#fb7185', glowIntensity: 0.7,
      animationSpeed: 0.8,
    },
  },
  {
    id: 'jade', name: '翡翠', description: '翠色流光溢彩', icon: 'gem',
    config: {
      presetId: 'jade',
      cardDecoration: 'aurora',
      layerOpacity: { sidebar: 0.6, header: 0.68, content: 0.74, card: 0.82, modal: 0.9 },
      layerBlur: { sidebar: 20, header: 16, content: 12, card: 16, modal: 24 },
      cardBorderRadius: 16, cardBorderWidth: 1,
      decorationColor: '#34d399', glowIntensity: 0.3,
      animationSpeed: 0.8,
    },
  },
];

export interface WallpaperMusic {
  enabled: boolean;
  source: string;
  volume: number;
}

export interface SavedWallpaper {
  id: string;
  type: 'image' | 'video';
  source: string;
  name: string;
  pinned: boolean;
}

export interface WallpaperConfig {
  type: WallpaperType;
  source: string;
  imageSource: string;
  videoSource: string;
  presetId: string;
  opacity: number;
  scale: number;
  positionX: number;
  positionY: number;
  blur: number;
  brightness: number;
  music: WallpaperMusic;
  videoVolume: number;
  videoMuted: boolean;
  pinned: boolean;
  objectFit: ObjectFit;
  savedWallpapers: SavedWallpaper[];
  layerOpacity: {
    sidebar: number;
    header: number;
    content: number;
    card: number;
  };
  layerBlur: {
    sidebar: number;
    header: number;
    content: number;
    card: number;
  };
}

export interface ParticleConfig {
  enabled: boolean;
  type: ParticleType;
  count: number;
  size: number;
  glow: number;
  speed: number;
  opacity: number;
  color: string;
  /** 🆕 发光模式：无 / 光晕（径向辉光）/ 脉动（呼吸发光） */
  glowMode: 'none' | 'halo' | 'pulse';
  /** 🆕 流光拖尾长度 0~30（0 为关闭，越大拖尾越长） */
  trail: number;
}

/** 🆕 卡片材质类型 */
export type MaterialType = 'none' | 'paper' | 'fabric' | 'metal' | 'marble' | 'carbon' | 'kraft';

export interface MaterialPreset {
  id: MaterialType;
  name: string;
  description: string;
  /** 材质预览底色 */
  previewColor: string;
  /** 材质预览纹理（background-image 值） */
  preview: string;
}

/** 🆕 内置材质库：应用于卡片表面的纹理 */
export const MATERIALS: MaterialPreset[] = [
  { id: 'none', name: '无材质', description: '保持原生表面', previewColor: '#f1f5f9', preview: 'none' },
  {
    id: 'paper', name: '纸张', description: '细腻纸面颗粒', previewColor: '#f8fafc',
    preview: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0.4 0 0 0 0 0.4 0 0 0 0 0.45 0 0 0 0.35 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")`,
  },
  {
    id: 'fabric', name: '布纹', description: '十字织物质感', previewColor: '#eef2f7',
    preview: `repeating-linear-gradient(0deg,rgba(30,41,59,0.10) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgba(30,41,59,0.10) 0 1px,transparent 1px 3px)`,
  },
  {
    id: 'metal', name: '金属', description: '拉丝金属光泽', previewColor: '#e8edf3',
    preview: `linear-gradient(135deg,rgba(255,255,255,0.9) 0%,rgba(148,163,184,0.45) 25%,rgba(255,255,255,0.7) 50%,rgba(100,116,139,0.4) 75%,rgba(255,255,255,0.8) 100%),repeating-linear-gradient(90deg,rgba(71,85,105,0.07) 0 1px,transparent 1px 3px)`,
  },
  {
    id: 'marble', name: '大理石', description: '云纹石面', previewColor: '#f1f5f9',
    preview: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='m'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012 0.02' numOctaves='4' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0.45 0 0 0 0 0.5 0 0 0 0 0.58 0 0 0 0.5 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23m)'/%3E%3C/svg%3E")`,
  },
  {
    id: 'carbon', name: '碳纤维', description: '斜纹编织科技感', previewColor: '#e2e8f0',
    preview: `repeating-linear-gradient(45deg,rgba(15,23,42,0.14) 0 2px,transparent 2px 5px),repeating-linear-gradient(-45deg,rgba(15,23,42,0.14) 0 2px,transparent 2px 5px)`,
  },
  {
    id: 'kraft', name: '牛皮纸', description: '暖调复古纸感', previewColor: '#f5e7d3',
    preview: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='k'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 0.55 0 0 0 0 0.4 0 0 0 0 0.22 0 0 0 0.4 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23k)'/%3E%3C/svg%3E")`,
  },
];

/** 🆕 内置粒子装饰组合（一键应用整套粒子氛围） */
export const PARTICLE_PRESETS: { id: string; name: string; config: Partial<ParticleConfig> }[] = [
  { id: 'starry', name: '星空夜', config: { type: 'stars', color: '#dbeafe', count: 70, size: 3, glow: 12, speed: 0.5, opacity: 0.8, glowMode: 'pulse', trail: 0 } },
  { id: 'sakura', name: '樱花雨', config: { type: 'petals', color: '#f9a8d4', count: 40, size: 6, glow: 4, speed: 0.8, opacity: 0.85, glowMode: 'none', trail: 0 } },
  { id: 'firefly-forest', name: '萤火之森', config: { type: 'firefly', color: '#fde047', count: 30, size: 4, glow: 16, speed: 1, opacity: 0.9, glowMode: 'halo', trail: 0 } },
  { id: 'meteor', name: '流星雨', config: { type: 'sparkles', color: '#7dd3fc', count: 50, size: 4, glow: 14, speed: 1.6, opacity: 0.9, glowMode: 'pulse', trail: 14 } },
  { id: 'ocean-bubble', name: '海洋气泡', config: { type: 'bubbles', color: '#67e8f9', count: 35, size: 7, glow: 8, speed: 0.7, opacity: 0.8, glowMode: 'none', trail: 0 } },
  { id: 'aurora-dust', name: '极光尘埃', config: { type: 'stars', color: '#a5b4fc', count: 60, size: 2.5, glow: 10, speed: 0.4, opacity: 0.75, glowMode: 'halo', trail: 10 } },
];

export interface FontConfig {
  family: string;
  size: FontSize;
}

export interface SlideConfig {
  messageAnimation: MessageAnimation;
  pageTransition: boolean;
  reduceMotion: boolean;
}

export interface UIConfig {
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
  wallpaper: WallpaperConfig;
  particles: ParticleConfig;
  /** 🆕 卡片材质（纸张/布纹/金属等表面纹理） */
  material: MaterialType;
  /** 🆕 材质浓度 0~1（纹理叠加强度） */
  materialIntensity: number;
  /** 🆕 材质纹理缩放 0.5~3（纹理颗粒大小倍率） */
  materialScale: number;
  font: FontConfig;
  slide: SlideConfig;
  uiTheme: ThemeConfig;
}

export const WALLPAPER_PRESETS: { id: string; name: string; css: string }[] = [
  { id: 'aurora', name: '极光', css: 'linear-gradient(120deg, #0f2027, #203a43, #2c5364)' },
  { id: 'sunset', name: '日落', css: 'linear-gradient(120deg, #ff9a9e, #fad0c4, #fbc2eb)' },
  { id: 'ocean', name: '深海', css: 'linear-gradient(120deg, #2193b0, #6dd5ed)' },
  { id: 'nebula', name: '星云', css: 'radial-gradient(circle at 20% 30%, #5b247a, #1bcedf), radial-gradient(circle at 80% 70%, #1bcedf, #5b247a)' },
  { id: 'forest', name: '森林', css: 'linear-gradient(120deg, #134e5e, #71b280)' },
  { id: 'candy', name: '糖果', css: 'linear-gradient(120deg, #a18cd1, #fbc2eb)' },
  { id: 'midnight', name: '午夜', css: 'linear-gradient(120deg, #232526, #414345)' },
  { id: 'peach', name: '蜜桃', css: 'linear-gradient(120deg, #ee9ca7, #ffdde1)' },
];

export const FONT_PRESETS: { id: string; name: string; stack: string }[] = [
  { id: 'system', name: '系统默认', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { id: 'sans', name: '黑体/无衬线', stack: '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif' },
  { id: 'serif', name: '宋体/衬线', stack: 'Georgia, "Songti SC", "SimSun", "Noto Serif SC", serif' },
  { id: 'kai', name: '楷体', stack: '"Kaiti SC", "KaiTi", "STKaiti", serif' },
  { id: 'mono', name: '等宽', stack: '"SFMono-Regular", Consolas, "Courier New", monospace' },
  { id: 'rounded', name: '圆体', stack: '"Yuanti SC", "YouYuan", "Hiragino Maru Gothic Pro", sans-serif' },
];

export const PARTICLE_TYPES: { id: ParticleType; name: string }[] = [
  { id: 'none', name: '关闭' },
  { id: 'snow', name: '雪花' },
  { id: 'stars', name: '星辰' },
  { id: 'hearts', name: '爱心' },
  { id: 'bubbles', name: '气泡' },
  { id: 'petals', name: '花瓣' },
  { id: 'sparkles', name: '闪光' },
  { id: 'firefly', name: '萤火虫' },
  { id: 'confetti', name: '彩纸' },
  { id: 'rain', name: '雨滴' },
  { id: 'cherry', name: '樱花' },
  { id: 'butterfly', name: '蝴蝶' },
  { id: 'firework', name: '烟花' },
];

export const MESSAGE_ANIMATIONS: { id: MessageAnimation; name: string }[] = [
  { id: 'fadeUp', name: '上浮淡入' },
  { id: 'fadeIn', name: '淡入' },
  { id: 'slideLeft', name: '左侧滑入' },
  { id: 'scaleIn', name: '缩放淡入' },
  { id: 'none', name: '无' },
];

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
  wallpaper: {
    type: 'none',
    source: '',
    imageSource: '',
    videoSource: '',
    presetId: 'aurora',
    opacity: 1,
    scale: 1,
    positionX: 0,
    positionY: 0,
    blur: 0,
    brightness: 1,
    music: { enabled: false, source: '', volume: 0.5 },
    videoVolume: 0.5,
    videoMuted: false,
    pinned: false,
    objectFit: 'cover',
    savedWallpapers: [],
    layerOpacity: { sidebar: 0.45, header: 0.85, content: 0.88, card: 0.95 },
    layerBlur: { sidebar: 20, header: 16, content: 16, card: 16 },
  },
  particles: {
    enabled: false,
    type: 'snow',
    count: 40,
    size: 4,
    glow: 8,
    speed: 1,
    opacity: 0.8,
    color: '#ffffff',
    glowMode: 'none',
    trail: 0,
  },
  material: 'none',
  materialIntensity: 0.85,
  materialScale: 1,
  font: {
    family: 'system',
    size: 'medium',
  },
  slide: {
    messageAnimation: 'fadeUp',
    pageTransition: true,
    reduceMotion: false,
  },
  uiTheme: THEME_PRESETS[0].config,
};

// ========== In-memory cache for resolved db: URLs ==========
export const resolvedDbCache = new Map<string, string>();

function loadUIConfigSync(): UIConfig {
  try {
    const stored = localStorage.getItem('ui-config');
    if (stored) {
      const parsed = JSON.parse(stored);
      const wp = parsed.wallpaper || {};
      const defaultTheme = defaultConfig.uiTheme;
      const savedTheme = parsed.uiTheme || {};
      return {
        ...defaultConfig,
        ...parsed,
        wallpaper: {
          ...defaultConfig.wallpaper,
          ...wp,
          layerOpacity: { ...defaultConfig.wallpaper.layerOpacity, ...(wp.layerOpacity || {}) },
          layerBlur: { ...defaultConfig.wallpaper.layerBlur, ...(wp.layerBlur || {}) },
        },
        particles: { ...defaultConfig.particles, ...(parsed.particles || {}) },
        font: { ...defaultConfig.font, ...(parsed.font || {}) },
        slide: { ...defaultConfig.slide, ...(parsed.slide || {}) },
        uiTheme: {
          ...defaultTheme,
          ...savedTheme,
          layerOpacity: { ...defaultTheme.layerOpacity, ...(savedTheme.layerOpacity || {}) },
          layerBlur: { ...defaultTheme.layerBlur, ...(savedTheme.layerBlur || {}) },
        },
      };
    }
  } catch { /* ignore */ }
  return defaultConfig;
}

interface UIState extends UIConfig {
  /** 侧边栏折叠状态（供 MiniPlayer 等组件共享） */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  updateConfig: (patch: Partial<UIConfig>) => void;
  updateWallpaper: (patch: Partial<WallpaperConfig>) => void;
  updateParticles: (patch: Partial<ParticleConfig>) => void;
  updateFont: (patch: Partial<FontConfig>) => void;
  updateSlide: (patch: Partial<SlideConfig>) => void;
  updateWallpaperMusic: (patch: Partial<WallpaperMusic>) => void;
  updateSavedWallpapers: (patch: SavedWallpaper[]) => void;
  updateTheme: (patch: Partial<ThemeConfig>) => void;
  resetUI: () => void;
  _loadedFromDb: boolean;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function getPersistableState(state: UIState): UIConfig {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { updateConfig, updateWallpaper, updateParticles, updateFont, updateSlide, updateWallpaperMusic, updateSavedWallpapers, updateTheme, resetUI, _loadedFromDb, ...rest } = state;
  return rest;
}

export const useUIStore = create<UIState>((set) => ({
  ...defaultConfig,
  ...loadUIConfigSync(),
  sidebarCollapsed: false,
  _loadedFromDb: false,

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  updateConfig: (patch) => set(patch),
  updateWallpaper: (patch) => set((s) => ({ wallpaper: { ...s.wallpaper, ...patch } })),
  updateParticles: (patch) => set((s) => ({ particles: { ...s.particles, ...patch } })),
  updateFont: (patch) => set((s) => ({ font: { ...s.font, ...patch } })),
  updateSlide: (patch) => set((s) => ({ slide: { ...s.slide, ...patch } })),
  updateWallpaperMusic: (patch) => set((s) => ({ wallpaper: { ...s.wallpaper, music: { ...s.wallpaper.music, ...patch } } })),
  updateSavedWallpapers: (patch) => set((s) => ({ wallpaper: { ...s.wallpaper, savedWallpapers: patch } })),
  updateTheme: (patch) => set((s) => ({ uiTheme: { ...s.uiTheme, ...patch } })),
  resetUI: () => set(defaultConfig),
}));

// ========== SQLite persistence (async, loads on startup) ==========

async function loadUIConfigFromDb(): Promise<void> {
  try {
    const { dbGetUiConfig } = await import('../lib/tauriBridge');
    const config = await dbGetUiConfig();
    if (config) {
      const cfg = config as Record<string, unknown>;
      const wp = (cfg.wallpaper as Record<string, unknown> | undefined) || {};
      const defaultTheme = defaultConfig.uiTheme;
      const savedTheme = (cfg.uiTheme as Record<string, unknown> | undefined) || {};
      const merged: Partial<UIConfig> = {
        ...cfg,
        wallpaper: {
          ...defaultConfig.wallpaper,
          ...wp,
          layerOpacity: { ...defaultConfig.wallpaper.layerOpacity, ...((wp.layerOpacity as Record<string, number> | undefined) || {}) },
          layerBlur: { ...defaultConfig.wallpaper.layerBlur, ...((wp.layerBlur as Record<string, number> | undefined) || {}) },
        },
        particles: { ...defaultConfig.particles, ...((cfg.particles as Record<string, unknown> | undefined) || {}) },
        font: { ...defaultConfig.font, ...((cfg.font as Record<string, unknown> | undefined) || {}) },
        slide: { ...defaultConfig.slide, ...((cfg.slide as Record<string, unknown> | undefined) || {}) },
        uiTheme: {
          ...defaultTheme,
          ...savedTheme,
          layerOpacity: { ...defaultTheme.layerOpacity, ...((savedTheme.layerOpacity as Record<string, number> | undefined) || {}) },
          layerBlur: { ...defaultTheme.layerBlur, ...((savedTheme.layerBlur as Record<string, number> | undefined) || {}) },
        },
      };
      delete (merged as Record<string, unknown>)._loadedFromDb;
      useUIStore.setState({ ...merged, _loadedFromDb: true });
    } else {
      useUIStore.setState({ _loadedFromDb: true });
    }
  } catch (e) {
    console.error('[uiStore] loadUIConfigFromDb failed:', e);
    useUIStore.setState({ _loadedFromDb: true });
  }
}

function saveUIConfigToDb(state: UIState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const rest = getPersistableState(state);
    // Save full config to SQLite (source of truth)
    import('../lib/tauriBridge').then(({ dbSaveUiConfig }) => {
      dbSaveUiConfig(rest as unknown as Record<string, unknown>);
    });
    // localStorage only stores metadata (no large data URLs) to avoid QuotaExceededError
    try {
      const lite = { ...rest } as Record<string, unknown>;
      if (lite.wallpaper && typeof lite.wallpaper === 'object') {
        const wp = lite.wallpaper as Record<string, unknown>;
        const music = (wp.music as Record<string, unknown> | undefined) || {};
        lite.wallpaper = {
          ...wp,
          imageSource: (wp.imageSource as string | undefined)?.startsWith('db:') ? wp.imageSource : '',
          videoSource: (wp.videoSource as string | undefined)?.startsWith('db:') ? wp.videoSource : '',
          source: (wp.source as string | undefined)?.startsWith('db:') ? wp.source : '',
          music: { ...music, source: (music.source as string | undefined)?.startsWith('db:') ? music.source : '' },
          savedWallpapers: ((wp.savedWallpapers as Array<Record<string, unknown>>) || []).map((sw) => ({
            id: sw.id, type: sw.type, name: sw.name, pinned: sw.pinned,
            source: (sw.source as string | undefined)?.startsWith('db:') ? sw.source : '',
          })),
        };
      }
      localStorage.setItem('ui-config', JSON.stringify(lite));
    } catch { /* quota exceeded, ignore */ }
  }, 500);
}

// Subscribe to all state changes -> save to SQLite
useUIStore.subscribe((state) => {
  if (state._loadedFromDb) {
    saveUIConfigToDb(state);
  }
});

export function getUIConfig(): UIConfig {
  return getPersistableState(useUIStore.getState());
}

// ========== Wallpaper SQLite Persistence ==========

function wpRandomId(): string {
  return `wp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function dataUrlMime(dataUrl: string): string {
  const m = dataUrl.match(/^data:([^;,]+)/);
  return m ? m[1] : 'application/octet-stream';
}

export async function saveWallpaperToDb(source: string, type: 'image' | 'video' | 'audio'): Promise<string | null> {
  try {
    const { saveFileToDb } = await import('../lib/tauriBridge');
    const id = wpRandomId();
    const bytes = dataUrlToUint8Array(source);
    const mime = dataUrlMime(source);
    const ext = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png';
    const actualId = await saveFileToDb(id, `${id}.${ext}`, mime, bytes);
    return actualId ? `db:${actualId}` : null;
  } catch (e) {
    console.error('[uiStore] saveWallpaperToDb failed:', e);
    return null;
  }
}

export async function loadWallpaperFromDb(dbRef: string): Promise<string | null> {
  // Check cache first
  const cached = resolvedDbCache.get(dbRef);
  if (cached) return cached;

  try {
    const id = dbRef.replace(/^db:/, '');
    const { getFileFromDb } = await import('../lib/tauriBridge');
    const file = await getFileFromDb(id);
    if (!file) return null;
    const dataUrl = `data:${file.mimeType};base64,${file.data}`;
    resolvedDbCache.set(dbRef, dataUrl);
    return dataUrl;
  } catch (e) {
    console.error('[uiStore] loadWallpaperFromDb failed:', e);
    return null;
  }
}

async function migrateOneSource(src: string, type: 'image' | 'video' | 'audio'): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('db:')) return src;
  if (src.startsWith('data:')) {
    return await saveWallpaperToDb(src, type);
  }
  return null;
}

export async function migrateWallpapersToDb(): Promise<void> {
  const state = useUIStore.getState();
  const wp = state.wallpaper;
  let changed = false;
  const patch: Partial<WallpaperConfig> = {};

  const imgRef = await migrateOneSource(wp.imageSource, 'image');
  if (imgRef && imgRef !== wp.imageSource) {
    patch.imageSource = imgRef;
    if (wp.type === 'image') patch.source = imgRef;
    changed = true;
  }

  const vidRef = await migrateOneSource(wp.videoSource, 'video');
  if (vidRef && vidRef !== wp.videoSource) {
    patch.videoSource = vidRef;
    if (wp.type === 'video') patch.source = vidRef;
    changed = true;
  }

  const musRef = await migrateOneSource(wp.music.source, 'audio');
  if (musRef && musRef !== wp.music.source) {
    patch.music = { ...wp.music, source: musRef };
    changed = true;
  }

  if (changed) {
    useUIStore.getState().updateWallpaper(patch);
  }
}

async function loadOneSource(dbRef: string): Promise<string> {
  if (dbRef && dbRef.startsWith('db:')) {
    const dataUrl = await loadWallpaperFromDb(dbRef);
    if (dataUrl) return dataUrl;
  }
  return dbRef;
}

export async function loadWallpaperFromConfig(): Promise<{ imageSource: string; videoSource: string }> {
  const wp = useUIStore.getState().wallpaper;

  // Only load active wallpaper sources (not ALL saved wallpapers)
  const imageSource = await loadOneSource(wp.imageSource);
  const videoSource = await loadOneSource(wp.videoSource);
  const musicSource = await loadOneSource(wp.music.source);

  // Update source field to match the active type
  let source = wp.source;
  if (wp.type === 'image' && imageSource && imageSource !== wp.imageSource) source = imageSource;
  if (wp.type === 'video' && videoSource && videoSource !== wp.videoSource) source = videoSource;

  // Don't load ALL saved wallpapers on startup - only resolve db: refs lazily
  // saved wallpapers thumbnails are resolved individually by useResolvedUrl hook

  useUIStore.getState().updateWallpaper({
    source,
    imageSource,
    videoSource,
    music: { ...wp.music, source: musicSource },
  });

  return { imageSource, videoSource };
}

export async function initUIConfig(): Promise<void> {
  // 1. Load from SQLite (async, overrides localStorage sync load)
  await loadUIConfigFromDb();
  // 2. Migrate any remaining data: URLs to DB
  await migrateWallpapersToDb();
  // 3. Resolve db: refs for active wallpaper only
  await loadWallpaperFromConfig();
}
