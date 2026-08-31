/**
 * ============================================================
 * 音乐播放器 · 装扮系统（纯前端，无 API）
 *  - MusicDressBackground : 流光/渐变等背景层（浓度/模糊可微调）
 *  - MusicAudioBars       : 音频条可视化（bars/wave/dots 三种样式，
 *                           有机模拟驱动——不挂 WebAudio，避免跨域静音问题）
 *  - MusicDesktopLyrics   : 桌面台词（可拖拽悬浮层，字号/透明度可调）
 *  - DressUpPanel         : 装扮设置面板（预设 + 微调滑杆）
 * ============================================================
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles } from 'lucide-react';
import { audioEngine } from './audioEngine';
import { useDebugLog } from '../../store/debugLogStore';

function useDebugLogSafeMusic(message: string): void {
  try { useDebugLog.getState().add('system', message); } catch { /* ignore */ }
}
import {
  useMusicStore, MUSIC_DRESS_PRESETS, loadDressUp,
  type MusicDressTheme, type AudioBarStyle,
} from '../../store/musicStore';

/* ---------------- 背景层 ---------------- */

export function MusicDressBackground() {
  const dress = useMusicStore((s) => s.dressUp);
  const preset = MUSIC_DRESS_PRESETS.find((p) => p.id === dress.theme);
  if (!preset || preset.id === 'none') return null;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div
        className={preset.animated ? 'music-dress-aurora absolute inset-[-40%]' : 'absolute inset-0'}
        style={{
          background: preset.css,
          backgroundSize: preset.animated ? '400% 400%' : undefined,
          opacity: dress.intensity,
          filter: dress.blur > 0 ? `blur(${dress.blur}px)` : undefined,
        }}
      />
      {/* 顶部柔光，保证前景文字可读 */}
      <div className="absolute inset-0 bg-white/55 dark:bg-gray-950/55" />
    </div>
  );
}

/* ---------------- 音频条（真实频谱 FFT + 静默回退模拟） ---------------- */

export function MusicAudioBars({ isPlaying, className = '' }: { isPlaying: boolean; className?: string }) {
  const style = useMusicStore((s) => s.dressUp.audioBarStyle);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;

  useEffect(() => {
    if (style === 'off') return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // 🆕 真实频谱：WebAudio AnalyserNode（音源经 music-proxy 注入 CORS，可安全分析）
    const analyser = audioEngine.ensureAnalyser();
    const freqData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    let silentFrames = 0;
    // 🆕 回退判定：无分析器 / AudioContext 挂起 / 播放中持续全零 → 模拟动画
    let useSimulation = !analyser;

    let t = 0;
    const draw = () => {
      t += 0.016;
      ctx.clearRect(0, 0, W, H);
      const playing = playingRef.current;
      const energy = playing ? 1 : 0.12;

      // 播放中若 AudioContext 仍挂起则尝试恢复
      if (playing) audioEngine.resumeContext();

      let spectrum: number[] | null = null;
      if (analyser && freqData && !useSimulation) {
        analyser.getByteFrequencyData(freqData);
        const sum = freqData.reduce((s, v) => s + v, 0);
        if (playing && sum === 0) {
          silentFrames++;
          // 约 1.5 秒仍无数据 → 判定不可用，切换模拟
          if (silentFrames > 90) {
            useSimulation = true;
            useDebugLogSafeMusic('[音频条] 频谱数据为空，切换为模拟动画');
          }
        } else {
          silentFrames = 0;
        }
        if (!useSimulation) {
          const buckets = 36;
          const usable = Math.floor(freqData.length * 0.7);
          spectrum = Array.from({ length: buckets }, (_, i) => {
            const start = Math.floor((i / buckets) * usable);
            const end = Math.floor(((i + 1) / buckets) * usable);
            let sum2 = 0;
            for (let j = start; j < end; j++) sum2 += freqData[j];
            return sum2 / Math.max(1, end - start) / 255;
          });
        }
      }

      if (style === 'bars') {
        // 🆕 律动条：底部升起 + 渐变 + 柔光（干净无杂元素，频谱/模拟双驱动）
        const n = 36;
        const bw = W / n;
        const w = bw * 0.58;
        for (let i = 0; i < n; i++) {
          let v: number;
          if (spectrum) {
            const prev = spectrum[Math.max(0, i - 1)];
            const next = spectrum[Math.min(spectrum.length - 1, i + 1)];
            v = (spectrum[i] * 2 + prev + next) / 4;
          } else {
            // 模拟：多正弦叠加，保证持续起伏
            v = 0.22 +
              Math.abs(Math.sin(t * 2.2 + i * 0.5) * 0.4 + Math.sin(t * 3.6 + i * 1.1) * 0.3 + Math.sin(t * 1.2 + i * 0.23) * 0.3) * 0.6;
            v *= energy;
          }
          v = Math.max(0.04, Math.min(1, v));
          const h = v * (H - 6);
          const x = i * bw + (bw - w) / 2;

          const grad = ctx.createLinearGradient(0, H - h, 0, H);
          grad.addColorStop(0, 'rgba(165,180,252,1)');
          grad.addColorStop(0.45, 'rgba(99,102,241,0.85)');
          grad.addColorStop(1, 'rgba(56,189,248,0.5)');
          ctx.save();
          ctx.shadowColor = 'rgba(99,102,241,0.5)';
          ctx.shadowBlur = 7;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, H - h, w, h, w / 2);
          ctx.fill();
          ctx.restore();
        }
      } else if (style === 'wave') {
        ctx.lineWidth = 2;
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0, 'rgba(99,102,241,0.85)');
        grad.addColorStop(1, 'rgba(56,189,248,0.6)');
        ctx.strokeStyle = grad;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 2) {
          const u = x / W;
          let y: number;
          if (spectrum) {
            // 频谱驱动的波形：低频段映射到左侧振幅
            const idx = Math.floor(u * spectrum.length);
            y = H / 2 - spectrum[idx] * H * 0.42 * (0.6 + 0.4 * Math.sin(u * 6 + t * 2));
          } else {
            y = H / 2 +
              (Math.sin(u * 9 + t * 2.4) * 0.45 + Math.sin(u * 17 - t * 1.7) * 0.3 + Math.sin(u * 4 + t * 1.1) * 0.25) * H * 0.38 * energy;
          }
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        // dots
        const n = 22;
        for (let i = 0; i < n; i++) {
          let v: number;
          if (spectrum) {
            v = Math.max(0.06, spectrum[Math.floor((i / n) * spectrum.length)]);
          } else {
            v = (Math.sin(t * 2.6 + i * 0.8) * 0.5 + Math.sin(t * 1.4 + i * 0.3) * 0.5) * 0.5 + 0.5;
          }
          const r = Math.max(1.2, Math.min(1, v) * 5 * (playing ? 1 : 0.25));
          ctx.fillStyle = `rgba(99,102,241,${0.25 + v * 0.6})`;
          ctx.beginPath();
          ctx.arc((i + 0.5) * (W / n), H / 2 + Math.sin(t * 2 + i) * 2, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [style]);

  if (style === 'off') return null;
  return <canvas ref={canvasRef} className={`w-full h-8 ${className}`} />;
}

/* ---------------- 桌面台词（可拖拽悬浮歌词） ---------------- */

const DL_POS_KEY = 'music_dlp';

export function MusicDesktopLyrics({ line }: { line: string }) {
  const dress = useMusicStore((s) => s.dressUp);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const raw = localStorage.getItem(DL_POS_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { x: 0, y: -140 };
  });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
    setPos((p) => {
      try { localStorage.setItem(DL_POS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
      return p;
    });
  }, []);

  if (!dress.desktopLyrics || !line) return null;

  return (
    <div
      className="fixed left-1/2 z-[120] cursor-grab active:cursor-grabbing select-none"
      style={{
        transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
        top: '88%',
        opacity: dress.dlOpacity,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="桌面台词（可拖拽移动）"
    >
      <p
        className="font-semibold whitespace-nowrap"
        style={{
          fontSize: dress.dlFontSize,
          color: '#fff',
          textShadow: '0 0 8px rgba(99,102,241,0.9), 0 1px 3px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.9)',
        }}
      >
        {line}
      </p>
    </div>
  );
}

/* ---------------- 🆕 桌面歌词独立窗口 ---------------- */

/** 打开（或聚焦）桌面歌词窗口：透明、置顶、无边框、不占任务栏 */
export async function openDesktopLyricsWindow(): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const existing = await WebviewWindow.getByLabel('music-desktop-lyrics');
  if (existing) {
    await existing.setFocus();
    return;
  }
  const w = Math.min(900, window.screen.width - 40);
  new WebviewWindow('music-desktop-lyrics', {
    url: '/desktop-lyrics',
    title: '桌面歌词',
    width: w,
    height: 120,
    x: Math.max(0, Math.floor((window.screen.width - w) / 2)),
    y: Math.max(0, window.screen.height - 220),
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    shadow: false,
  });
}

/** 🆕 移动桌面歌词窗口到预设位置 */
export async function moveDesktopLyricsTo(pos: 'left-bottom' | 'center-bottom' | 'right-bottom' | 'left-top' | 'center-top' | 'right-top'): Promise<void> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const target = (await WebviewWindow.getByLabel('music-desktop-lyrics')) || getCurrentWindow();
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const mon = await currentMonitor();
    const sw = mon?.size.width ?? window.screen.width;
    const sh = mon?.size.height ?? window.screen.height;
    const size = await target.outerSize();
    const w = size.width;
    const h = size.height;
    const margin = 24;
    const x = pos.startsWith('left') ? margin : pos.startsWith('right') ? Math.floor(sw - w - margin) : Math.floor((sw - w) / 2);
    const y = pos.endsWith('bottom') ? Math.floor(sh - h - 60) : margin + 40;
    await target.setPosition(new (await import('@tauri-apps/api/dpi')).PhysicalPosition(x, y));
  } catch { /* ignore */ }
}

/** 🆕 关闭桌面歌词窗口（幂等） */
export async function closeDesktopLyricsWindow(): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const win = await WebviewWindow.getByLabel('music-desktop-lyrics');
  await win?.close();
}

/**
 * 桌面歌词窗口内容（独立 Webview，label = music-desktop-lyrics）：
 *  - 监听主窗口 music-dl-line 事件同步歌词
 *  - 拖拽移动（startDragging）、可关闭
 *  - 装扮配置直接读 localStorage（跨窗口不同上下文）
 */
export function MusicDesktopLyricsWindow() {
  const [line, setLine] = useState('♪ 桌面歌词已开启');
  const [cfg, setCfg] = useState(() => {
    try { return { ...loadDressUp() }; } catch { return { dlFontSize: 28, dlOpacity: 0.9, dlColor: '#ffffff', dlLocked: false, dlEffect: 'glow' as const }; }
  });
  const locked = cfg.dlLocked ?? false;

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) =>
      listen<string>('music-dl-line', (e) => setLine(e.payload || '')).then((f) => { unlisten = f; }),
    ).catch(() => {});
    // 配置变更同步：字号/透明度/颜色/**点击穿透锁定**
    const applyLock = async () => {
      try {
        const raw = localStorage.getItem('music_dressup');
        if (raw) setCfg(JSON.parse(raw));
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setIgnoreCursorEvents(!!(raw ? JSON.parse(raw).dlLocked : false));
      } catch { /* ignore */ }
    };
    void applyLock();
    const timer = setInterval(applyLock, 800);
    return () => { unlisten?.(); clearInterval(timer); };
  }, []);

  // 🆕 文字效果样式（霓虹辉光 / 流光渐变 / 描边 / 纯色）
  const effectStyle = (): React.CSSProperties => {
    const color = cfg.dlColor || '#ffffff';
    switch (cfg.dlEffect) {
      case 'aurora':
        return {
          backgroundImage: 'linear-gradient(90deg,#38bdf8,#a78bfa,#f472b6,#34d399,#38bdf8)',
          backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          animation: 'musicDressFlow 5s linear infinite',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.75))',
        };
      case 'outline':
        return {
          color: 'transparent',
          WebkitTextStroke: `1.4px ${color}`,
          filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.75))',
        };
      case 'plain':
        return { color, textShadow: '0 2px 4px rgba(0,0,0,0.8)' };
      default: // glow
        return {
          color,
          textShadow: `0 0 16px ${color}cc, 0 0 5px ${color}, 0 2px 4px rgba(0,0,0,0.7)`,
        };
    }
  };

  return (
    <div
      className="w-full h-full flex items-center justify-center select-none cursor-grab active:cursor-grabbing"
      onPointerDown={() => {
        if (locked) return; // 穿透锁定时不响应拖拽
        import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().startDragging()).catch(() => {});
      }}
    >
      <style>{`@keyframes musicDlAurora { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }`}</style>
      <p
        className="font-semibold whitespace-nowrap overflow-hidden text-ellipsis"
        style={{
          fontSize: cfg.dlFontSize ?? 28,
          opacity: cfg.dlOpacity ?? 0.9,
          maxWidth: '94%',
          ...(line ? effectStyle() : { color: 'rgba(255,255,255,0.55)', textShadow: '0 1px 3px rgba(0,0,0,0.6)' }),
        }}
      >
        {line || '♪ 桌面歌词已开启（当前歌曲暂无歌词）'}
      </p>
    </div>
  );
}

/* ---------------- 装扮设置面板 ---------------- */

const BAR_STYLE_LABELS: Record<AudioBarStyle, string> = {
  bars: '律动条',
  wave: '声波',
  dots: '粒子点',
  off: '关闭',
};

export function DressUpPanel({ onClose }: { onClose: () => void }) {
  const dress = useMusicStore((s) => s.dressUp);
  const update = useMusicStore((s) => s.updateDressUp);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 16 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 shadow-2xl"
        >
          <div className="flex items-center gap-2 px-5 pt-4 pb-3 sticky top-0 bg-white dark:bg-gray-900 z-10">
            <Sparkles size={16} className="text-indigo-500" />
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">播放器装扮</h3>
            <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-5 space-y-5">
            {/* 背景主题 */}
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">背景装饰</p>
              <div className="grid grid-cols-3 gap-2">
                {MUSIC_DRESS_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => update({ theme: p.id as MusicDressTheme })}
                    className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl transition-all border ${
                      dress.theme === p.id
                        ? 'border-indigo-400 dark:border-indigo-600 ring-1 ring-indigo-300 dark:ring-indigo-700'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <span
                      className="w-full h-10 rounded-lg border border-black/5"
                      style={{ background: p.preview }}
                    />
                    <span className={`text-[10px] ${dress.theme === p.id ? 'text-indigo-500 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                      {p.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* 背景微调 */}
            {dress.theme !== 'none' && (
              <div className="space-y-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">背景微调</p>
                <div>
                  <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                    <span>浓度</span><span>{Math.round(dress.intensity * 100)}%</span>
                  </div>
                  <input type="range" min={0.1} max={1} step={0.05} value={dress.intensity}
                    onChange={(e) => update({ intensity: Number(e.target.value) })}
                    className="w-full accent-indigo-500" />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                    <span>模糊</span><span>{dress.blur}px</span>
                  </div>
                  <input type="range" min={0} max={30} step={1} value={dress.blur}
                    onChange={(e) => update({ blur: Number(e.target.value) })}
                    className="w-full accent-indigo-500" />
                </div>
              </div>
            )}

            {/* 音频条样式 */}
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">音频条</p>
              <div className="grid grid-cols-4 gap-1.5">
                {(Object.keys(BAR_STYLE_LABELS) as AudioBarStyle[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => update({ audioBarStyle: s })}
                    className={`text-[11px] py-1.5 rounded-full transition-colors ${
                      dress.audioBarStyle === s
                        ? 'bg-indigo-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    {BAR_STYLE_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            {/* 桌面台词 */}
            <div className="space-y-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">桌面台词（悬浮歌词）</span>
                <button
                  onClick={async () => {
                    const next = !dress.desktopLyrics;
                    update({ desktopLyrics: next });
                    // 🆕 开关即总控：开启自动开窗，关闭自动关窗
                    if (next) {
                      await openDesktopLyricsWindow();
                    } else {
                      await closeDesktopLyricsWindow();
                    }
                  }}
                  className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${dress.desktopLyrics ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${dress.desktopLyrics ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              {dress.desktopLyrics && (
                <>
                  {/* 🆕 台词颜色 */}
                  <div className="flex items-center gap-3 py-1">
                    <span className="w-16 text-[11px] text-gray-500 dark:text-gray-400 shrink-0">台词颜色</span>
                    <input
                      type="color"
                      value={dress.dlColor || '#ffffff'}
                      onChange={(e) => update({ dlColor: e.target.value })}
                      className="w-10 h-7 rounded bg-transparent border border-gray-200 dark:border-gray-700"
                    />
                    <span className="text-[10px] text-gray-400">{dress.dlColor || '#ffffff'}</span>
                  </div>
                  {/* 🆕 文字效果 */}
                  <div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">文字效果</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {([
                        ['glow', '霓虹'], ['aurora', '流光'], ['outline', '描边'], ['plain', '纯色'],
                      ] as const).map(([eff, label]) => (
                        <button
                          key={eff}
                          onClick={() => update({ dlEffect: eff })}
                          className={`text-[11px] py-1.5 rounded-full transition-colors ${
                            (dress.dlEffect ?? 'glow') === eff
                              ? 'bg-indigo-500 text-white'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 🆕 预设位置 */}
                  <div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">预设位置</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([
                        ['左下', 'left-bottom'], ['中下', 'center-bottom'], ['右下', 'right-bottom'],
                        ['左上', 'left-top'], ['中上', 'center-top'], ['右上', 'right-top'],
                      ] as const).map(([label, pos]) => (
                        <button
                          key={pos}
                          onClick={() => moveDesktopLyricsTo(pos)}
                          className="text-[11px] py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-300 hover:text-indigo-500 transition-colors"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 🆕 点击穿透锁定 */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">点击穿透（不挡下方软件）</span>
                    <button
                      onClick={() => update({ dlLocked: !dress.dlLocked })}
                      className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${dress.dlLocked ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                      title={dress.dlLocked ? '已锁定：歌词窗整体穿透，关闭此开关解锁' : '未锁定'}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${dress.dlLocked ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                  {dress.dlLocked && (
                    <p className="text-[10px] text-amber-500">已锁定：鼠标将穿透歌词窗，关闭此开关才能拖动/操作歌词窗</p>
                  )}
                  {/* 🆕 关闭歌词窗口（按钮从歌词窗移入面板，避免遮挡观感） */}
                  <button
                    onClick={async () => {
                      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
                      const win = await WebviewWindow.getByLabel('music-desktop-lyrics');
                      await win?.close();
                    }}
                    className="w-full py-1.5 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:border-red-300 hover:text-red-500 transition-colors"
                  >
                    关闭桌面歌词窗口
                  </button>
                  <div>
                    <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                      <span>字号</span><span>{dress.dlFontSize}px</span>
                    </div>
                    <input type="range" min={18} max={44} step={1} value={dress.dlFontSize}
                      onChange={(e) => update({ dlFontSize: Number(e.target.value) })}
                      className="w-full accent-indigo-500" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-gray-500 mb-1">
                      <span>不透明度</span><span>{Math.round(dress.dlOpacity * 100)}%</span>
                    </div>
                    <input type="range" min={0.2} max={1} step={0.05} value={dress.dlOpacity}
                      onChange={(e) => update({ dlOpacity: Number(e.target.value) })}
                      className="w-full accent-indigo-500" />
                  </div>
                </>
              )}
          </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
