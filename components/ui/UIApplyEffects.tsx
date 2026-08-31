import { useEffect } from 'react';
import { useUIStore, FONT_PRESETS, type ThemeConfig, type MaterialType } from '../../store/uiStore';
import { WallpaperLayer } from './WallpaperLayer';
import { ParticleLayer } from './ParticleLayer';

const FONT_SIZE_MAP: Record<string, string> = {
  small: '13px',
  medium: '14px',
  large: '16px',
};

function applyTheme(theme: string) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else if (theme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', prefersDark);
  }
}

function applyFontFamily(family: string) {
  const preset = FONT_PRESETS.find((p) => p.id === family) || FONT_PRESETS[0];
  document.documentElement.style.fontFamily = preset.stack;
}

const FONT_OVERRIDE_STYLE_ID = 'ui-font-override';

function applyFontOverrides(hasCustomFont: boolean) {
  let el = document.getElementById(FONT_OVERRIDE_STYLE_ID) as HTMLStyleElement | null;
  if (hasCustomFont) {
    if (!el) {
      el = document.createElement('style');
      el.id = FONT_OVERRIDE_STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = `
      aside, header, nav, [data-no-font-override] {
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif !important;
      }
    `;
  } else if (el) {
    el.remove();
  }
}

const WALLPAPER_BG_STYLE_ID = 'wallpaper-bg-override';

// Throttle applyWallpaperBackground to one call per animation frame.
// Re-writing the entire <style> sheet causes a full document CSS re-parse,
// which is janky when dragging a slider. Coalescing with rAF means we
// only re-apply once per frame even if the source state changes faster.
let pendingApply: number | null = null;
let lastApplyArgs: [boolean, boolean, { sidebar: number; header: number; content: number; card: number }, { sidebar: number; header: number; content: number; card: number }] | null = null;
function scheduleApplyWallpaperBackground(
  hasWallpaper: boolean,
  pinned: boolean,
  lo: { sidebar: number; header: number; content: number; card: number },
  lb: { sidebar: number; header: number; content: number; card: number },
) {
  lastApplyArgs = [hasWallpaper, pinned, lo, lb];
  if (pendingApply !== null) return;
  pendingApply = requestAnimationFrame(() => {
    pendingApply = null;
    if (lastApplyArgs) {
      const [h, p, l1, l2] = lastApplyArgs;
      applyWallpaperBackground(h, p, l1, l2);
    }
  });
}

function rgba(r: number, g: number, b: number, a: number) {
  return `rgba(${r},${g},${b},${a})`;
}

function bf(v: number) {
  if (v > 0) return `backdrop-filter:blur(${v}px)!important;-webkit-backdrop-filter:blur(${v}px)!important;`;
  // 模糊为 0 时不要强制 none，避免禁用其他元素（如 backdrop-blur-xl）的内联样式
  return 'backdrop-filter:blur(0px)!important;-webkit-backdrop-filter:blur(0px)!important;';
}

function sel(selector: string): string {
  return `[data-wallpaper-pinned] ${selector}`;
}
function selDk(selector: string): string {
  return `[data-wallpaper-pinned].dark ${selector},.dark[data-wallpaper-pinned] ${selector}`;
}

function applyWallpaperBackground(hasWallpaper: boolean, pinned: boolean, lo: { sidebar: number; header: number; content: number; card: number }, lb: { sidebar: number; header: number; content: number; card: number }) {
  document.documentElement.toggleAttribute('data-wallpaper', hasWallpaper);
  document.documentElement.toggleAttribute('data-wallpaper-pinned', pinned);
  let el = document.getElementById(WALLPAPER_BG_STYLE_ID) as HTMLStyleElement | null;
  if (hasWallpaper) {
    if (!el) {
      el = document.createElement('style');
      el.id = WALLPAPER_BG_STYLE_ID;
      document.head.appendChild(el);
    }
    const B = '!important';
    const sidebarBg = (v: string) => `background-color:${v}${B};${bf(lb.sidebar)}border-color:transparent${B};--tw-bg-opacity:0${B}`;
    if (pinned) {
      // layerOpacity slider value = "layer opacity" (1 = fully opaque,
      // 0 = fully transparent). The overlay color we paint on top of
      // the wallpaper is white with alpha = (1 - layerOpacity), so a
      // slider value of 0.95 means a 95% opaque white card.
      //
      // The content slider ONLY controls backdrop-filter blur on the
      // page root. It does NOT paint a background-color on the root,
      // because doing so would make the root's semi-transparent white
      // "leak" through every child element (including <section>), which
      // is what users see as "content slider affects cards". To control
      // how visible the wallpaper is in the empty space between cards,
      // use the wallpaper opacity slider instead.
      const sL = rgba(255,255,255,1-lo.sidebar), sD = rgba(17,24,39,1-lo.sidebar);
      const dL = rgba(255,255,255,1-lo.card),     dD = rgba(17,24,39,1-lo.card);
      const hL = rgba(255,255,255,1-lo.header),   hD = rgba(3,7,18,1-lo.header);
      const rootBlur = lb.content > 0
        ? `backdrop-filter:blur(${lb.content}px)!important;-webkit-backdrop-filter:blur(${lb.content}px)!important;`
        : '';
      el.textContent = `
/* 1) 最外层容器透明 */
${sel('.flex.h-screen')}{background:transparent!important;border-color:transparent!important}
/* 2) 侧边栏 */
${sel('aside')}{${sidebarBg(sL)}}
${selDk('aside')}{${sidebarBg(sD)}}
/* 3) main 根元素透明（让壁纸透进来） */
${sel('main')}{background:transparent!important;background-color:transparent!important}
/* 4) main>div:first-child：content 滑块只控制模糊，不画任何颜色 */
${sel('main>div:first-child')}{background:transparent!important;background-color:transparent!important;${rootBlur}}
${selDk('main>div:first-child')}{background:transparent!important;background-color:transparent!important;${rootBlur}}
/* 5) sticky header 栏位用 header 级（带 backdrop-blur 的） */
${sel('main [class*="backdrop-blur"]:not(aside *)')}{background-color:${hL}${B};${bf(lb.header)}--tw-bg-opacity:0${B}}
${selDk('main [class*="backdrop-blur"]:not(aside *)')}{background-color:${hD}${B};${bf(lb.header)}--tw-bg-opacity:0${B}}
/* 6) section 卡片用 card 级（独立控制颜色和模糊） */
${sel('section')}{background-color:${dL}${B};${bf(lb.card)}--tw-bg-opacity:0${B}}
${selDk('section')}{background-color:${dD}${B};${bf(lb.card)}--tw-bg-opacity:0${B}}
/* 7) 侧边栏内部 */
${sel('aside [class*="bg-white"]')}{background-color:${dL}${B};${bf(lb.card)}--tw-bg-opacity:0${B}}
${selDk('aside [class*="bg-gray-900"]')}{background-color:${dD}${B};${bf(lb.card)}--tw-bg-opacity:0${B}}
/* 8) 边框透明 */
${sel('.border-r')}{border-color:transparent!important}
${sel('.border-b')}{border-color:rgba(0,0,0,0.06)!important}
${selDk('.border-b')}{border-color:rgba(255,255,255,0.06)!important}`;
    } else {
      el.textContent = `[data-wallpaper] .flex.h-screen{background:transparent!important}`;
    }
  } else if (el) {
    el.remove();
  }
}

// ========== Theme layer injection ==========
const THEME_STYLE_ID = 'ui-theme-layers';

function rgbaStr(r: number, g: number, b: number, a: number): string {
  return `rgba(${r},${g},${b},${a})`;
}

let themePending: number | null = null;
let lastThemeCfg: ThemeConfig | null = null;

function scheduleApplyTheme(cfg: ThemeConfig) {
  lastThemeCfg = cfg;
  if (themePending !== null) return;
  themePending = requestAnimationFrame(() => {
    themePending = null;
    if (lastThemeCfg) applyThemeLayers(lastThemeCfg);
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

/** 🆕 颜色明暗调整（pct: -100 暗黑 ~ +100 亮白），用于极光渐变跟随装饰色 */
function shadeHex(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(pct >= 0 ? v + (255 - v) * (pct / 100) : v * (1 + pct / 100))));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ===== 🆕 材质层（卡片 + 页面背景表面纹理，支持浓度/缩放微调） =====

const MATERIAL_STYLE_ID = 'theme-material-style';

interface MaterialTexture {
  /** background-image 各层（已按缩放倍率生成） */
  layers: string;
  /** 与 layers 一一对应的 background-size */
  size: string;
}

/** 生成材质纹理（k = 缩放倍率） */
function materialTexture(material: MaterialType, k: number): MaterialTexture | null {
  switch (material) {
    case 'paper':
      return {
        layers: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix values='0 0 0 0 0.4 0 0 0 0 0.4 0 0 0 0 0.45 0 0 0 0.35 0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E")`,
        size: `${120 * k}px ${120 * k}px`,
      };
    case 'fabric':
      return {
        layers: `repeating-linear-gradient(0deg,rgba(30,41,59,0.05) 0 ${1 * k}px,transparent ${1 * k}px ${3 * k}px),repeating-linear-gradient(90deg,rgba(30,41,59,0.05) 0 ${1 * k}px,transparent ${1 * k}px ${3 * k}px)`,
        size: `auto`,
      };
    case 'metal':
      return {
        layers: `linear-gradient(115deg,rgba(255,255,255,0.55) 0%,rgba(120,130,145,0.22) 25%,rgba(255,255,255,0.4) 50%,rgba(90,100,115,0.26) 75%,rgba(255,255,255,0.45) 100%),repeating-linear-gradient(90deg,rgba(71,85,105,0.04) 0 ${1 * k}px,transparent ${1 * k}px ${3 * k}px)`,
        size: `100% 100%,auto`,
      };
    case 'marble':
      return {
        layers: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='m'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012 0.02' numOctaves='4' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 0.45 0 0 0 0 0.5 0 0 0 0 0.58 0 0 0 0.5 0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23m)'/%3E%3C/svg%3E")`,
        size: `${300 * k}px ${300 * k}px`,
      };
    case 'carbon':
      return {
        layers: `repeating-linear-gradient(45deg,rgba(15,23,42,0.07) 0 ${2 * k}px,transparent ${2 * k}px ${5 * k}px),repeating-linear-gradient(-45deg,rgba(15,23,42,0.07) 0 ${2 * k}px,transparent ${2 * k}px ${5 * k}px)`,
        size: `auto`,
      };
    case 'kraft':
      return {
        layers: `linear-gradient(rgba(180,120,60,0.10),rgba(180,120,60,0.10)),url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='k'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='2' seed='3'/%3E%3CfeColorMatrix values='0 0 0 0 0.55 0 0 0 0 0.4 0 0 0 0 0.22 0 0 0 0.4 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23k)'/%3E%3C/svg%3E")`,
        size: `100% 100%,${140 * k}px ${140 * k}px`,
      };
    default:
      return null;
  }
}

/**
 * 应用材质层（仅作用于卡片 section 表面）：
 *  - intensity 控制纹理浓度（通过灰色罩层洗淡纹理，soft-light 下中性灰=无效果）
 *  - scale 控制纹理颗粒大小
 */
function applyMaterialLayer(material: MaterialType, intensity: number, scale: number) {
  const B = '!important';
  let el = document.getElementById(MATERIAL_STYLE_ID) as HTMLStyleElement | null;
  if (material === 'none') {
    if (el) el.remove();
    document.documentElement.removeAttribute('data-material');
    return;
  }
  document.documentElement.setAttribute('data-material', material);
  if (!el) {
    el = document.createElement('style');
    el.id = MATERIAL_STYLE_ID;
    document.head.appendChild(el);
  }
  const k = scale > 0 ? scale : 1;
  const tex = materialTexture(material, k);
  if (!tex) { el.remove(); return; }
  // 浓度罩层：intensity=1 → 罩层全透明（纹理最浓）；intensity→0 → 罩层趋近不透明中性灰（soft-light 下无效果）
  const veilA = Math.max(0, Math.min(1, 1 - intensity)) * 0.95;
  const image = `linear-gradient(rgba(128,128,128,${veilA.toFixed(3)}),rgba(128,128,128,${veilA.toFixed(3)})),${tex.layers}`;
  const size = `100% 100%,${tex.size}`;
  el.textContent = `
/* ===== 🆕 Material Layer: ${material}（浓度 ${(intensity * 100).toFixed(0)}% · 缩放 ${k.toFixed(1)}x）— 仅卡片 ===== */
[data-material] section{background-image:${image}${B};background-blend-mode:normal,soft-light${B};background-size:${size}${B}}
`;
}

function applyThemeLayers(cfg: ThemeConfig) {
  const { layerOpacity: lo, layerBlur: lb, cardDecoration, cardBorderRadius, cardBorderWidth, decorationColor, glowIntensity, animationSpeed } = cfg;
  const B = '!important';
  // 动画速度倍率（0.2~3，异常回退 1）：数值越大动画越快（周期越短）
  const animSpd = animationSpeed && animationSpeed > 0 ? animationSpeed : 1;

  // 默认预设（所有透明度为 0）→ 不应用任何主题效果，保持原生样式
  const allZero = Object.values(lo).every(v => v === 0) && Object.values(lb).every(v => v === 0);
  if (allZero) {
    const el = document.getElementById(THEME_STYLE_ID);
    if (el) el.remove();
    return;
  }

  // Always set data-theme-enabled — theme is always active now (no toggle)
  document.documentElement.setAttribute('data-theme-enabled', 'true');

  let el = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = THEME_STYLE_ID;
    document.head.appendChild(el);
  }

  // Light / dark helpers
  const sL = (op: number) => rgbaStr(255, 255, 255, 1 - op);
  const sD = (op: number) => rgbaStr(17, 24, 39, 1 - op);
  const mL = (op: number) => rgbaStr(255, 255, 255, 1 - op);
  const mD = (op: number) => rgbaStr(3, 7, 18, 1 - op);
  const [dr, dg, db] = hexToRgb(decorationColor);

  function blur(v: number) {
    if (v > 0) return `backdrop-filter:blur(${v}px)!important;-webkit-backdrop-filter:blur(${v}px)!important;`;
    return 'backdrop-filter:blur(0px)!important;-webkit-backdrop-filter:blur(0px)!important;';
  }

  // Base selectors
  const tsel = (s: string) => `[data-theme-enabled] ${s}`;
  const tselDk = (s: string) => `[data-theme-enabled].dark ${s},.dark[data-theme-enabled] ${s}`;

  // Decoration-specific card styles
  let cardExtra = '';
  // 🆕 明暗模式各自独立的卡片背景（极光/流光需要重写 background，按模式给 padding-box 底色）
  let cardExtraLight = '';
  let cardExtraDark = '';
  if (cardDecoration === 'glass') {
    cardExtra = `${blur(lb.card)}border:1px solid rgba(255,255,255,0.18)${B};border-radius:${cardBorderRadius}px${B}`;
  } else if (cardDecoration === 'frosted') {
    cardExtra = `${blur(lb.card)}border:1px solid rgba(255,255,255,0.22)${B};border-radius:${cardBorderRadius}px${B}`;
  } else if (cardDecoration === 'solid') {
    // 🆕 纯色不透明：卡片完全不透明、无模糊，明暗模式各自纯色底
    cardExtra = `border-radius:${cardBorderRadius}px${B};backdrop-filter:none${B};`;
    cardExtraLight = `background-color:rgba(255,255,255,1)${B}`;
    cardExtraDark = `background-color:rgba(17,24,39,1)${B}`;
  } else if (cardDecoration === 'outline') {
    // 🆕 描边：细边框 + 轻投影，半透明底
    cardExtra = `border:1px solid rgba(${dr},${dg},${db},0.35)${B};border-radius:${cardBorderRadius}px${B};box-shadow:0 2px 10px rgba(0,0,0,0.06)${B}`;
  } else if (cardDecoration === 'glow') {
    const glowR = Math.round(glowIntensity * 20);
    cardExtra = `box-shadow:0 0 ${glowR}px rgba(${dr},${dg},${db},${glowIntensity})${B};border-radius:${cardBorderRadius}px${B};border:1px solid rgba(${dr},${dg},${db},${Math.min(glowIntensity * 0.5, 0.3)})${B}`;
  } else if (cardDecoration === 'aurora') {
    // 🆕 极光：多彩渐变边框流动——颜色跟随「装饰颜色」设置（修复取色器无效）
    const dur = (16 / animSpd).toFixed(1);
    const c0 = decorationColor;
    const c1 = shadeHex(c0, 45);
    const c2 = shadeHex(c0, -25);
    const c3 = shadeHex(c0, 70);
    cardExtra = `border:1px solid transparent${B};border-radius:${cardBorderRadius}px${B};`;
    cardExtraLight = `background:linear-gradient(rgba(255,255,255,1),rgba(255,255,255,1)) padding-box,linear-gradient(115deg,${c0},${c1},${c2},${c3},${c0}) border-box${B};background-size:100% 100%,300% 300%${B};animation:themeAuroraFlow ${dur}s linear infinite${B}`;
    cardExtraDark = `background:linear-gradient(rgba(17,24,39,1),rgba(17,24,39,1)) padding-box,linear-gradient(115deg,${c0},${c1},${c2},${c3},${c0}) border-box${B};background-size:100% 100%,300% 300%${B};animation:themeAuroraFlow ${dur}s linear infinite${B}`;
  } else if (cardDecoration === 'neon') {
    // 🆕 霓虹：呼吸式霓虹光晕（装饰色驱动，强度在 keyframes 中编译）
    const dur = (2.8 / animSpd).toFixed(1);
    cardExtra = `border:1px solid rgba(${dr},${dg},${db},0.55)${B};border-radius:${cardBorderRadius}px${B};animation:themeNeonPulse ${dur}s ease-in-out infinite${B}`;
  } else if (cardDecoration === 'flow') {
    // 🆕 流光：细边框单色流光巡游（装饰色驱动）
    const dur = (7 / animSpd).toFixed(1);
    cardExtra = `border:1px solid transparent${B};border-radius:${cardBorderRadius}px${B};`;
    cardExtraLight = `background:linear-gradient(rgba(255,255,255,1),rgba(255,255,255,1)) padding-box,linear-gradient(115deg,rgba(${dr},${dg},${db},0.85),rgba(${dr},${dg},${db},0.12),rgba(${dr},${dg},${db},0.85)) border-box${B};background-size:100% 100%,250% 100%${B};animation:themeFlowShift ${dur}s linear infinite${B}`;
    cardExtraDark = `background:linear-gradient(rgba(17,24,39,1),rgba(17,24,39,1)) padding-box,linear-gradient(115deg,rgba(${dr},${dg},${db},0.85),rgba(${dr},${dg},${db},0.12),rgba(${dr},${dg},${db},0.85)) border-box${B};background-size:100% 100%,250% 100%${B};animation:themeFlowShift ${dur}s linear infinite${B}`;
  } else if (cardDecoration === 'sunset') {
    // 🆕 暖阳：落日暖光晕染（装饰色主光 + 粉调辅光）
    const g = Math.max(glowIntensity, 0.3);
    cardExtra = `border:1px solid rgba(${dr},${dg},${db},0.28)${B};border-radius:${cardBorderRadius}px${B};box-shadow:0 4px ${Math.round(20 * g)}px rgba(${dr},${dg},${db},${0.3 * g}),0 2px ${Math.round(12 * g)}px rgba(244,114,182,${0.18 * g})${B}`;
  } else {
    cardExtra = `border-radius:${cardBorderRadius}px${B}`;
    if (cardBorderWidth > 0) {
      cardExtra += `;border:${cardBorderWidth}px solid rgba(128,128,128,0.15)${B}`;
    }
  }

  // 🆕 霓虹呼吸需要 keyframes（发光参数编译进关键帧）
  let themeKeyframes = '';
  if (cardDecoration === 'neon') {
    const g = Math.max(glowIntensity, 0.3);
    themeKeyframes = `
@keyframes themeNeonPulse{
  0%,100%{box-shadow:0 0 ${Math.round(8 * g)}px rgba(${dr},${dg},${db},${(0.35 * g).toFixed(2)}),inset 0 0 ${Math.round(6 * g)}px rgba(${dr},${dg},${db},${(0.10 * g).toFixed(2)})}
  50%{box-shadow:0 0 ${Math.round(24 * g)}px rgba(${dr},${dg},${db},${(0.6 * g).toFixed(2)}),inset 0 0 ${Math.round(14 * g)}px rgba(${dr},${dg},${db},${(0.22 * g).toFixed(2)})}
}`;
  } else if (cardDecoration === 'aurora') {
    themeKeyframes = `
@keyframes themeAuroraFlow{0%{background-position:0 0,0% 50%}100%{background-position:0 0,300% 50%}}`;
  } else if (cardDecoration === 'flow') {
    themeKeyframes = `
@keyframes themeFlowShift{0%{background-position:0 0,0% 0}100%{background-position:0 0,250% 0}}`;
  }

  // Modal / drawer styles
  let modalExtra = '';
  if (cardDecoration === 'glass' || cardDecoration === 'frosted') {
    modalExtra = `${blur(lb.modal)}`;
  }

  el.textContent = `
/* ===== Theme Layer System ===== */
/* Sidebar */
${tsel('aside')}{background-color:${sL(lo.sidebar)}${B};${blur(lb.sidebar)}--tw-bg-opacity:0${B}}
${tselDk('aside')}{background-color:${sD(lo.sidebar)}${B};${blur(lb.sidebar)}--tw-bg-opacity:0${B}}

/* Header (sticky bar with backdrop-blur) */
${tsel('main [class*="backdrop-blur"]:not(aside *)')}{background-color:${sL(lo.header)}${B};${blur(lb.header)}--tw-bg-opacity:0${B}}
${tselDk('main [class*="backdrop-blur"]:not(aside *)')}{background-color:${sD(lo.header)}${B};${blur(lb.header)}--tw-bg-opacity:0${B}}

/* Content root (page background) */
${tsel('main>div:first-child')}{background-color:${sL(lo.content)}${B};${blur(lb.content)}--tw-bg-opacity:0${B}}
${tselDk('main>div:first-child')}{background-color:${sD(lo.content)}${B};${blur(lb.content)}--tw-bg-opacity:0${B}}

/* Cards / sections — 卡片背景独立，不随主题层变化，仅保留装饰（模糊/边框/圆角/动效） */
${tsel('section')}{${cardExtra}${cardExtraLight ? `;${cardExtraLight}` : ''}}
${tselDk('section')}{${cardExtra}${cardExtraDark ? `;${cardExtraDark}` : ''}}

/* Player bar (MiniPlayer & music page bottom bar) — 独立背景，仅保留模糊 */
${tsel('.theme-player')}{${blur(lb.card)}}
${tselDk('.theme-player')}{${blur(lb.card)}}

/* Filter buttons inside sections */
${tsel('section button')}{border-radius:${cardBorderRadius}px${B}}
${tselDk('section button')}{border-radius:${cardBorderRadius}px${B}}

/* Modals / drawers / dialogs */
${tsel('[role="dialog"]')}{background-color:${mL(lo.modal)}${B};${modalExtra};border-radius:${cardBorderRadius}px${B}}
${tselDk('[role="dialog"]')}{background-color:${mD(lo.modal)}${B};${modalExtra};border-radius:${cardBorderRadius}px${B}}
${tsel('.fixed.inset-0:not([role="dialog"])')}{backdrop-filter:${lb.modal > 0 ? `blur(${Math.min(lb.modal * 0.3, 8)}px)` : 'none'}${B};-webkit-backdrop-filter:${lb.modal > 0 ? `blur(${Math.min(lb.modal * 0.3, 8)}px)` : 'none'}${B}}
${tsel('.fixed.inset-0>div')}{border-radius:${cardBorderRadius}px${B}}

/* Border cleanup */
${tsel('.border-r')}{border-color:rgba(128,128,128,0.08)!important}
${tsel('.border-b')}{border-color:rgba(128,128,128,0.08)!important}
${tselDk('.border-r')}{border-color:rgba(255,255,255,0.06)!important}
${tselDk('.border-b')}{border-color:rgba(255,255,255,0.06)!important}

/* Global transition for smooth theme changes */
${tsel('aside, section, main, [role="dialog"], .fixed.inset-0')}{transition:background-color 0.3s ease,backdrop-filter 0.3s ease,box-shadow 0.3s ease,border-radius 0.2s ease,border 0.2s ease}
${themeKeyframes}
`;
}

export function UIApplyEffects() {
  const theme = useUIStore((s) => s.theme);
  const fontSize = useUIStore((s) => s.fontSize);
  const fontFamily = useUIStore((s) => s.font.family);
  const accentColor = useUIStore((s) => s.accentColor);
  const bubbleStyle = useUIStore((s) => s.bubbleStyle);
  const avatarStyle = useUIStore((s) => s.avatarStyle);
  const wallpaperType = useUIStore((s) => s.wallpaper.type);
  const wallpaperPinned = useUIStore((s) => s.wallpaper.pinned);
  // Read individual layer values directly. This is critical: selecting
  // the nested object (e.g. s.wallpaper.layerOpacity) creates a new
  // reference every time wallpaper is spread, which would make the
  // useEffect below run on every state change. Selecting scalars lets
  // zustand's default Object.is compare them and skip the effect.
  const layerOpacitySidebar = useUIStore((s) => s.wallpaper.layerOpacity.sidebar);
  const layerOpacityHeader = useUIStore((s) => s.wallpaper.layerOpacity.header);
  const layerOpacityContent = useUIStore((s) => s.wallpaper.layerOpacity.content);
  const layerOpacityCard = useUIStore((s) => s.wallpaper.layerOpacity.card);
  const layerBlurSidebar = useUIStore((s) => s.wallpaper.layerBlur.sidebar);
  const layerBlurHeader = useUIStore((s) => s.wallpaper.layerBlur.header);
  const layerBlurContent = useUIStore((s) => s.wallpaper.layerBlur.content);
  const layerBlurCard = useUIStore((s) => s.wallpaper.layerBlur.card);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    applyFontFamily(fontFamily);
    applyFontOverrides(fontFamily !== 'system');
  }, [fontFamily]);
  useEffect(() => {
    document.documentElement.style.fontSize = FONT_SIZE_MAP[fontSize] || '14px';
  }, [fontSize]);
  useEffect(() => {
    if (accentColor) {
      document.documentElement.setAttribute('data-accent-color', accentColor);
      // ✅ 注入 CSS 变量：全局主色消费点（气泡/发送按钮等）通过 var(--accent-color) 实时换色
      document.documentElement.style.setProperty('--accent-color', accentColor);
    }
  }, [accentColor]);
  useEffect(() => {
    if (bubbleStyle) document.documentElement.setAttribute('data-bubble-style', bubbleStyle);
  }, [bubbleStyle]);
  useEffect(() => {
    if (avatarStyle) document.documentElement.setAttribute('data-avatar-style', avatarStyle);
  }, [avatarStyle]);

  // Theme layer system
  const uiTheme = useUIStore((s) => s.uiTheme);
  useEffect(() => {
    scheduleApplyTheme(uiTheme);
    return () => {
      if (themePending !== null) {
        cancelAnimationFrame(themePending);
        themePending = null;
      }
    };
  }, [
    uiTheme.cardDecoration, uiTheme.cardBorderRadius,
    uiTheme.cardBorderWidth, uiTheme.decorationColor, uiTheme.glowIntensity,
    uiTheme.animationSpeed,
    uiTheme.layerOpacity.sidebar, uiTheme.layerOpacity.header, uiTheme.layerOpacity.content, uiTheme.layerOpacity.card, uiTheme.layerOpacity.modal,
    uiTheme.layerBlur.sidebar, uiTheme.layerBlur.header, uiTheme.layerBlur.content, uiTheme.layerBlur.card, uiTheme.layerBlur.modal,
  ]);

  // 🆕 Material layer system（卡片 + 页面背景材质，支持浓度/缩放微调）
  const material = useUIStore((s) => s.material);
  const materialIntensity = useUIStore((s) => s.materialIntensity);
  const materialScale = useUIStore((s) => s.materialScale);
  useEffect(() => {
    applyMaterialLayer(material, materialIntensity, materialScale);
  }, [material, materialIntensity, materialScale]);

  useEffect(() => {
    scheduleApplyWallpaperBackground(wallpaperType !== 'none', wallpaperPinned,
      { sidebar: layerOpacitySidebar, header: layerOpacityHeader, content: layerOpacityContent, card: layerOpacityCard },
      { sidebar: layerBlurSidebar, header: layerBlurHeader, content: layerBlurContent, card: layerBlurCard });
    return () => {
      // When dependencies change (e.g. user drags a slider), React runs
      // the cleanup function BEFORE the new effect. We must NOT remove the
      // <style> element here – that would cause a flash of white before
      // the next rAF re-applies it. We only cancel the pending rAF (if any)
      // because a new one will be scheduled by the incoming effect.
      if (pendingApply !== null) {
        cancelAnimationFrame(pendingApply);
        pendingApply = null;
      }
    };
  }, [wallpaperType, wallpaperPinned,
     layerOpacitySidebar, layerOpacityHeader, layerOpacityContent, layerOpacityCard,
     layerBlurSidebar, layerBlurHeader, layerBlurContent, layerBlurCard]);

  return (
    <>
      <WallpaperLayer />
      <ParticleLayer />
    </>
  );
}
