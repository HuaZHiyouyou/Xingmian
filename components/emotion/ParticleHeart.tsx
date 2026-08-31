import { useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { tickHeartRate, getHeartBpm } from '../../services/emotion/heartRateEngine';

interface ParticleHeartProps {
  progress: number;
  size?: number;
  /** 🆕 当前主导情绪（驱动心率与波形动态） */
  emotionType?: string;
  /** 🆕 当前情绪强度 0~100 */
  emotionIntensity?: number;
}

function pointOnHeart(t: number) {
  return {
    x: 16 * Math.pow(Math.sin(t), 3),
    y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
  };
}

function normalOnHeart(t: number) {
  const dx = 48 * Math.pow(Math.sin(t), 2) * Math.cos(t);
  const dy = -(13 * Math.sin(t) - 10 * Math.sin(2 * t) - 6 * Math.sin(3 * t) - 4 * Math.sin(4 * t));
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

/** hex → rgba 字符串（带透明度） */
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 🆕 心电图波形（一个心动周期的 PQRST）
 * u ∈ [0,1)；返回值正=向上凸起幅度
 */
function ecgWave(u: number): number {
  const uu = u - Math.floor(u);
  const bump = (c: number, w: number, h: number) =>
    Math.exp(-((uu - c) ** 2) / (2 * w * w)) * h;
  return bump(0.16, 0.028, 0.14)   // P 波
       + bump(0.305, 0.008, 0.16)  // Q 波
       + bump(0.335, 0.010, 1.0)   // R 波（主峰）
       + bump(0.365, 0.009, 0.26)  // S 波
       + bump(0.54, 0.045, 0.20);  // T 波
}

// 阶段配置表 - 色调从柔粉到玫粉，避免刺眼的红色
// shadowBlur 仅做轮廓柔光，大范围扩散交由外部椭圆辉光（更平滑无边界感）
const stageConfig = [
  { min: 0,  max: 20, heartColor: '#fce7f3', lightColor: '#fdf2f8', deepColor: '#fbcfe8', particleColor: '#f9a8d4', particleLight: '#fbcfe8', shadowBlur: 14, pulseAmp: 0.05 },
  { min: 20, max: 40, heartColor: '#fbcfe8', lightColor: '#fce7f3', deepColor: '#f9a8d4', particleColor: '#f472b6', particleLight: '#f9a8d4', shadowBlur: 18, pulseAmp: 0.08 },
  { min: 40, max: 60, heartColor: '#f9a8d4', lightColor: '#fbcfe8', deepColor: '#f472b6', particleColor: '#ec4899', particleLight: '#f472b6', shadowBlur: 22, pulseAmp: 0.12 },
  { min: 60, max: 80, heartColor: '#f472b6', lightColor: '#f9a8d4', deepColor: '#ec4899', particleColor: '#db2777', particleLight: '#ec4899', shadowBlur: 26, pulseAmp: 0.16 },
  { min: 80, max: 101, heartColor: '#ec4899', lightColor: '#f472b6', deepColor: '#e879d4', particleColor: '#d946ef', particleLight: '#e879d4', shadowBlur: 30, pulseAmp: 0.22 },
];

function getStage(p: number) {
  for (const s of stageConfig) {
    if (p >= s.min && p < s.max) return s;
  }
  return stageConfig[stageConfig.length - 1];
}

type OrbitP = {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  alpha: number;
  phase: number;
};

type RadiantP = {
  angle: number;
  startRadius: number;
  maxRadius: number;
  size: number;
  born: number;
  life: number;
  baseAlpha: number;
};

type BurstP = {
  x: number; y: number;
  vx: number; vy: number;
  size: number; alpha: number;
  born: number; life: number;
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// 边距 buffer - 让粒子有溢出空间，避免被画布边界裁剪
const BUFFER = 60;

export function ParticleHeart({ progress, size = 220, emotionType, emotionIntensity }: ParticleHeartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawSize = size + BUFFER * 2;
  // 🆕 心率显示（低频轮询引擎，避免每帧重渲染）
  const [bpmDisplay, setBpmDisplay] = useState(() => Math.round(getHeartBpm()));
  useEffect(() => {
    const t = setInterval(() => setBpmDisplay(Math.round(getHeartBpm())), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const dpr = window.devicePixelRatio || 1;
    // 扩大 drawing buffer：给粒子溢出留 buffer 空间，避免边界白色遮挡
    canvas.width = drawSize * dpr;
    canvas.height = drawSize * dpr;
    canvas.style.width = `${drawSize}px`;
    canvas.style.height = `${drawSize}px`;
    ctx.scale(dpr, dpr);
    // 🆕 圆滑渲染：圆角连接 + 圆帽，消除描边折角
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const p = Math.max(0, Math.min(100, progress));
    const stage = getStage(p);
    const { heartColor, lightColor, deepColor, particleColor, particleLight } = stage;
    const heartScale = size * 0.022;
    // 中心点偏移到扩大的画布中心
    const cx = drawSize / 2;
    const cy = drawSize / 2;
    // 边缘衰减阈值 - 粒子距中心越远，alpha 越小（衰减终点=画布边缘，彻底无截断感）
    const edgeFadeStart = drawSize * 0.34;
    const edgeFadeEnd = drawSize * 0.50;

    const rand = seededRandom(42);

    // 1. Orbit 粒子（外部轨道环绕）
    const orbits: OrbitP[] = [];
    for (let i = 0; i < 16; i++) {
      orbits.push({
        angle: (i / 16) * Math.PI * 2 + rand() * 0.3,
        radius: drawSize * (0.17 + rand() * 0.06),
        speed: (0.25 + rand() * 0.4) * (i % 2 === 0 ? 1 : -1),
        size: 1.2 + rand() * 1.6,
        alpha: 0.35 + rand() * 0.4,
        phase: rand() * Math.PI * 2,
      });
    }

    // 2. Radiant 粒子（向外扩散 + 真正的时间衰减 + 重生循环）
    const radiants: RadiantP[] = [];
    for (let i = 0; i < 24; i++) {
      radiants.push({
        angle: (i / 24) * Math.PI * 2 + rand() * 0.4,
        startRadius: size * 0.03,
        maxRadius: size * (0.28 + rand() * 0.20),
        size: 0.8 + rand() * 1.4,
        // 错开出生时间，使画面启动时就有粒子
        born: -rand() * 5,
        life: 1.5 + rand() * 1.5,
        baseAlpha: 0.4 + rand() * 0.4,
      });
    }

    // 3. Burst 粒子（心跳蹦散）
    const burstParticles: BurstP[] = [];
    let lastBeatTime = -1;
    // 🆕 心率引擎驱动：心跳间隔动态化（平静 ~72 BPM，情绪/对话可推高，自然回归平静）
    let beatInterval = 60 / 72;
    let beatPhase = 0;
    let lastFrameTime: number | null = null;

    let animId: number;
    let start: number | null = null;

    function drawHeartPath(s: number) {
      ctx.beginPath();
      // 🆕 280 段采样：曲线更顺滑，杜绝高分屏下的细微折角
      for (let i = 0; i <= 280; i++) {
        const t = -Math.PI + (i / 280) * 2 * Math.PI;
        const pt = pointOnHeart(t);
        const x = cx + pt.x * s;
        const y = cy + pt.y * s;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    // 计算基于距中心距离的边缘衰减系数 (1 -> 0)
    function edgeFadeAt(px: number, py: number): number {
      const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (d <= edgeFadeStart) return 1;
      if (d >= edgeFadeEnd) return 0;
      return 1 - (d - edgeFadeStart) / (edgeFadeEnd - edgeFadeStart);
    }

    function render(ts: number) {
      if (start === null) start = ts;
      const time = (ts - start) / 1000;
      const dt = lastFrameTime === null ? 0.016 : Math.min(0.1, ts - lastFrameTime) / 1000;
      lastFrameTime = ts;

      // 🆕 心率引擎推进：情绪 + 好感 + 对话刺激 → 实时 BPM
      const rate = tickHeartRate(dt, {
        emotionType,
        emotionIntensity,
        affinity: p,
        dt,
      });
      beatInterval = 60 / rate.bpm;
      const beatSpeed = rate.relative; // 波形扫描/幅度随心率

      // 心跳脉搏（好感 60+ 常驻；高情绪强度+高心率时也会心动）
      let heartBeatScale = 1;
      let pulseRingRadius = 0;
      let pulseRingAlpha = 0;
      const beating = p >= 60 || rate.bpm >= 86;
      if (beating) {
        beatPhase = (beatPhase + dt / beatInterval) % 1;
        const beatPhase2 = beatPhase;
        let beatVal = 0;
        if (beatPhase2 < 0.15) {
          beatVal = Math.sin((beatPhase2 / 0.15) * Math.PI);
        } else if (beatPhase2 >= 0.25 && beatPhase2 < 0.45) {
          beatVal = Math.sin(((beatPhase2 - 0.25) / 0.2) * Math.PI) * 0.6;
        }
        // 心率越快、情绪越强，搏动越明显
        const ampBoost = Math.min(1.35, 0.8 + (rate.bpm - 72) / 60 + (emotionIntensity ?? 0) / 400);
        heartBeatScale = 1 + beatVal * stage.pulseAmp * ampBoost;

        if (beatPhase2 < 0.5) {
          const ringT = beatPhase2 / 0.5;
          pulseRingRadius = 24 + ringT * 36;
          pulseRingAlpha = (0.18 + (p - 60) / 40 * 0.18) * (1 - ringT);
        }

        if (beatPhase2 < 0.02 && time - lastBeatTime > beatInterval * 0.5) {
          lastBeatTime = time;
          const burstCount = 10 + Math.floor(rand() * 6);
          for (let i = 0; i < burstCount; i++) {
            const t = -Math.PI + rand() * 2 * Math.PI;
            const pt = pointOnHeart(t);
            const n = normalOnHeart(t);
            const speed = 1.4 + rand() * 2.2;
            burstParticles.push({
              x: cx + pt.x * heartScale,
              y: cy + pt.y * heartScale,
              vx: n.nx * speed * (rand() > 0.5 ? 1 : -1),
              vy: n.ny * speed - 0.5,
              size: 1.1 + rand() * 1.8,
              alpha: 0.65 + rand() * 0.35,
              born: time,
              life: 0.9 + rand() * 0.5,
            });
          }
        }
      }

      const breath = 1 + Math.sin(time * 3.8) * stage.pulseAmp;
      const glowPulse = 0.7 + Math.sin(time * 2.5) * 0.3;

      ctx.clearRect(0, 0, drawSize, drawSize);

      // ── 🆕 心形光晕（呼吸变换外，独立缓慢明暗）——范围收紧版 ──
      {
        const haloLayers = 6;
        for (let i = haloLayers; i >= 1; i--) {
          const t = i / haloLayers; // 1=最外层
          const s = heartScale * (1 + t * 0.36);
          const a = 0.012 + 0.05 * (1 - t) * (0.45 + 0.55 * glowPulse);
          ctx.save();
          ctx.shadowColor = hexA(heartColor, Math.min(0.5, a * 4));
          ctx.shadowBlur = 22;
          drawHeartPath(s);
          ctx.fillStyle = hexA(heartColor, a);
          ctx.fill();
          ctx.restore();
        }
      }

      const heartTopY = cy - 13 * heartScale * breath;
      const heartBottomY = cy + 13 * heartScale * breath;
      const heartHeight = heartBottomY - heartTopY;

      // 呼吸缩放变换
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(breath * heartBeatScale, breath * heartBeatScale);
      ctx.translate(-cx, -cy);

      // ── 轮廓柔光：单层轻描，紧贴主轮廓 ──
      ctx.save();
      ctx.shadowColor = hexA(heartColor, 0.5);
      ctx.shadowBlur = stage.shadowBlur * 0.55 * glowPulse;
      drawHeartPath(heartScale);
      ctx.strokeStyle = hexA(heartColor, 0.20);
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.restore();

      // ── 爱心裁剪区域（液柱） ──
      drawHeartPath(heartScale);
      ctx.save();
      ctx.clip();

      // 内部底色
      ctx.fillStyle = 'rgba(253, 242, 248, 0.6)';
      ctx.fillRect(0, 0, drawSize, drawSize);

      const fillRatio = p / 100;
      const overflow = 64;
      const waterTopY = heartBottomY - heartHeight * fillRatio;

      if (fillRatio > 0.005) {
        // 液柱渐变
        const grad = ctx.createLinearGradient(0, waterTopY, 0, heartBottomY + overflow);
        grad.addColorStop(0, lightColor + 'dd');
        grad.addColorStop(0.3, heartColor + 'dd');
        grad.addColorStop(0.65, heartColor + 'f0');
        grad.addColorStop(1, deepColor + 'cc');
        ctx.fillStyle = grad;
        ctx.fillRect(0, waterTopY, drawSize, heartBottomY + overflow - waterTopY);

        const waveAmp = 2.5 * Math.min(1, fillRatio);

        // 第一层波
        ctx.beginPath();
        ctx.moveTo(0, waterTopY);
        for (let x = 0; x <= drawSize; x += 2) {
          const y = waterTopY
            + Math.sin((x / drawSize) * Math.PI * 3.5 + time * 1.2) * waveAmp
            + Math.sin((x / drawSize) * Math.PI * 6 + time * 1.8) * waveAmp * 0.35;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(drawSize, heartBottomY + overflow);
        ctx.lineTo(0, heartBottomY + overflow);
        ctx.closePath();
        ctx.fillStyle = lightColor + '99';
        ctx.fill();

        // 第二层波
        ctx.beginPath();
        ctx.moveTo(0, waterTopY + 3);
        for (let x = 0; x <= drawSize; x += 2) {
          const y = waterTopY + 3
            + Math.sin((x / drawSize) * Math.PI * 5 + time * 2.0 + 1.2) * waveAmp * 0.5
            + Math.cos((x / drawSize) * Math.PI * 8 + time * 2.8 + 0.5) * waveAmp * 0.2;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(drawSize, heartBottomY + overflow);
        ctx.lineTo(0, heartBottomY + overflow);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fill();

        // 第三层波
        ctx.beginPath();
        ctx.moveTo(0, waterTopY + 1);
        for (let x = 0; x <= drawSize; x += 2) {
          const y = waterTopY + 1
            + Math.sin((x / drawSize) * Math.PI * 9 + time * 3.5 + 2.8) * waveAmp * 0.25;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(drawSize, heartBottomY + overflow);
        ctx.lineTo(0, heartBottomY + overflow);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();

        // 高光
        const hl = ctx.createRadialGradient(
          cx - 22, heartBottomY - heartHeight * fillRatio * 0.4, 2,
          cx - 22, heartBottomY - heartHeight * fillRatio * 0.4, 38
        );
        hl.addColorStop(0, 'rgba(255,255,255,0.5)');
        hl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = hl;
        ctx.fillRect(0, waterTopY, drawSize, heartBottomY + overflow - waterTopY);
        ctx.globalAlpha = 1;
      }

      // 🆕 顶部玻璃高光：心形上瓣的弧面反光，增加通透质感
      const gloss = ctx.createLinearGradient(0, heartTopY - 14, 0, cy + 8);
      gloss.addColorStop(0, 'rgba(255,255,255,0.40)');
      gloss.addColorStop(0.55, 'rgba(255,255,255,0.10)');
      gloss.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gloss;
      ctx.fillRect(0, heartTopY - 14, drawSize, cy + 8 - heartTopY + 14);

      ctx.restore();

      // 心跳径向脉冲环
      if (pulseRingRadius > 0 && pulseRingAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = pulseRingAlpha;
        const ringGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRingRadius);
        ringGrad.addColorStop(0, heartColor + '00');
        ringGrad.addColorStop(0.7, heartColor + '38');
        ringGrad.addColorStop(1, heartColor + '00');
        ctx.fillStyle = ringGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, pulseRingRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 🆕 爱心描边：外层渐变主线（细腻）+ 内圈白玉高光，去掉厚重的第三层阴影
      drawHeartPath(heartScale);
      ctx.save();
      const strokeGrad = ctx.createLinearGradient(cx, heartTopY, cx, heartBottomY);
      strokeGrad.addColorStop(0, lightColor);
      strokeGrad.addColorStop(0.5, heartColor);
      strokeGrad.addColorStop(1, deepColor);
      ctx.strokeStyle = strokeGrad;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      drawHeartPath(heartScale * 0.975);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.7;
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.restore();

      // 气泡
      if (fillRatio > 0.08) {
        const count = Math.floor(fillRatio * 6);
        for (let i = 0; i < count; i++) {
          const phase = (time * 0.4 + i * 0.6) % 1;
          const bx = cx + Math.sin(i * 2.4 + time * 0.7) * size * 0.09;
          const by = waterTopY - phase * (waterTopY - heartTopY) - 3;
          if (by < heartTopY - 4) continue;
          const r = 1 + (i % 3) * 0.7;
          ctx.globalAlpha = (1 - phase) * 0.6;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      ctx.restore(); // 结束呼吸变换

      // ── 🆕 心电图扫描线：横穿心形中心——速度/幅度随心率与情绪强度变化 ──
      {
        const baseline = cy + size * 0.01;
        // 心率快 → 波幅更高更急；情绪强度高 → 波形更醒目
        const amp = size * 0.075 * (0.85 + 0.35 * (beatSpeed - 1)) * (1 + (emotionIntensity ?? 0) / 500);
        const beatW = size * 0.46 / beatSpeed; // 心率快 → 波更密
        const waveAlpha = 0.16 + (emotionIntensity ?? 0) / 100 * 0.10 + Math.max(0, beatSpeed - 1) * 0.10;
        const pts: Array<[number, number]> = [];
        for (let x = 0; x <= drawSize; x += 3) {
          pts.push([x, baseline - ecgWave(x / beatW) * amp]);
        }

        // 1) 淡淡的完整波形
        ctx.strokeStyle = hexA(heartColor, waveAlpha);
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();

        // 2) 游走的高亮窗口（模拟监护仪扫描，速度随心率）
        const sx = ((time * size * 0.35 * beatSpeed) % (drawSize + 140)) - 70;
        ctx.save();
        ctx.beginPath();
        ctx.rect(sx - 55, 0, 110, drawSize);
        ctx.clip();
        ctx.strokeStyle = hexA(deepColor, Math.min(0.75, 0.45 + (beatSpeed - 1) * 0.5));
        ctx.lineWidth = 1.5;
        ctx.shadowColor = hexA(heartColor, 0.8);
        ctx.shadowBlur = 7;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
        ctx.restore();

        // 3) 扫描亮点
        const dy2 = baseline - ecgWave(sx / beatW) * amp;
        const dotG = ctx.createRadialGradient(sx, dy2, 0, sx, dy2, 7);
        dotG.addColorStop(0, 'rgba(255,255,255,0.95)');
        dotG.addColorStop(0.35, hexA(particleColor, 0.55));
        dotG.addColorStop(1, hexA(particleColor, 0));
        ctx.fillStyle = dotG;
        ctx.beginPath();
        ctx.arc(sx, dy2, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Burst 粒子（边缘 alpha 衰减） ──
      for (let i = burstParticles.length - 1; i >= 0; i--) {
        const bp = burstParticles[i];
        const age = time - bp.born;
        if (age > bp.life) {
          burstParticles.splice(i, 1);
          continue;
        }
        const t = age / bp.life;
        bp.x += bp.vx;
        bp.y += bp.vy;
        bp.vy += 0.3 / 60;
        bp.vx *= 0.99;
        const fade = 1 - t;

        const ef = edgeFadeAt(bp.x, bp.y);
        const finalAlpha = bp.alpha * fade * ef;
        if (finalAlpha < 0.01) continue;

        ctx.globalAlpha = finalAlpha * 0.55;
        const bpg = ctx.createRadialGradient(bp.x, bp.y, 0, bp.x, bp.y, bp.size * 3.5);
        bpg.addColorStop(0, particleLight + '70');
        bpg.addColorStop(1, particleColor + '00');
        ctx.fillStyle = bpg;
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, bp.size * 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = finalAlpha;
        ctx.fillStyle = particleColor;
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, bp.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── Orbit 粒子（边缘 alpha 衰减） ──
      for (const o of orbits) {
        const a = o.angle + time * o.speed;
        const yWave = Math.sin(time * 1.6 + o.phase) * size * 0.035;
        const ox = cx + Math.cos(a) * o.radius;
        const oy = cy + Math.sin(a) * o.radius * 0.55 + yWave;
        const flicker = 0.55 + Math.sin(time * 3 + o.phase) * 0.45;

        const ef = edgeFadeAt(ox, oy);
        const finalAlpha = o.alpha * flicker * ef;
        if (finalAlpha < 0.02) continue;

        const pg = ctx.createRadialGradient(ox, oy, 0, ox, oy, o.size * 4);
        pg.addColorStop(0, particleColor + '50');
        pg.addColorStop(0.5, particleColor + '20');
        pg.addColorStop(1, particleColor + '00');
        ctx.globalAlpha = finalAlpha * 0.65;
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(ox, oy, o.size * 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = finalAlpha;
        ctx.fillStyle = particleLight;
        ctx.beginPath();
        ctx.arc(ox, oy, o.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── Radiant 粒子（向外扩散 + 真正的时间衰减 + 周期性重生） ──
      for (const r of radiants) {
        const age = time - r.born;
        const t = age / r.life;
        if (t >= 1) {
          // 生命周期结束，重新随机化属性并重生
          r.born = time;
          r.angle = rand() * Math.PI * 2;
          r.startRadius = size * (0.02 + rand() * 0.04);
          r.maxRadius = size * (0.25 + rand() * 0.25);
          r.life = 1.5 + rand() * 1.5;
          continue;
        }
        if (t < 0) continue;

        // 半径从 startRadius 平滑扩展到 maxRadius
        const easedT = t * t * (3 - 2 * t);
        const radius = r.startRadius + (r.maxRadius - r.startRadius) * easedT;
        const a = r.angle + age * 0.06;
        const px = cx + Math.cos(a) * radius;
        const py = cy + Math.sin(a) * radius * 0.7; // 椭圆扩散

        // 真正的时间衰减：升起(0-0.2) → 顶峰(0.2-0.6) → 下降(0.6-1.0)
        let lifeAlpha;
        if (t < 0.2) {
          lifeAlpha = (t / 0.2) * r.baseAlpha;
        } else if (t < 0.6) {
          lifeAlpha = r.baseAlpha;
        } else {
          lifeAlpha = r.baseAlpha * (1 - (t - 0.6) / 0.4);
        }

        // 边缘衰减叠加
        const ef = edgeFadeAt(px, py);
        const finalAlpha = lifeAlpha * ef;
        if (finalAlpha < 0.02) continue;

        // 光晕
        ctx.globalAlpha = finalAlpha * 0.5;
        const rg = ctx.createRadialGradient(px, py, 0, px, py, r.size * 4);
        rg.addColorStop(0, particleColor + '50');
        rg.addColorStop(1, particleColor + '00');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(px, py, r.size * 4, 0, Math.PI * 2);
        ctx.fill();

        // 实心
        ctx.globalAlpha = finalAlpha;
        ctx.fillStyle = particleLight;
        ctx.beginPath();
        ctx.arc(px, py, r.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 周围散点（边缘衰减）
      const dots = [
        { x: -0.22, y: -0.18, s: 1.4 }, { x: 0.24, y: -0.15, s: 1.8 },
        { x: -0.18, y: 0.18, s: 1.2 }, { x: 0.2, y: 0.16, s: 1.6 },
        { x: -0.1, y: -0.25, s: 1.0 }, { x: 0.1, y: 0.25, s: 1.3 },
        { x: -0.26, y: 0.03, s: 1.1 }, { x: 0.27, y: -0.02, s: 1.5 },
        { x: -0.03, y: 0.28, s: 0.9 }, { x: 0.02, y: -0.28, s: 1.2 },
      ];
      for (const d of dots) {
        const dx_ = cx + d.x * size;
        const dy_ = cy + d.y * size + Math.sin(time * 1.1 + d.x * 6) * 3;
        const tw = 0.55 + Math.sin(time * 2.2 + d.x * 7 + d.y * 5) * 0.45;
        const ef = edgeFadeAt(dx_, dy_);
        ctx.globalAlpha = 0.3 * tw * ef;
        ctx.fillStyle = particleColor;
        ctx.beginPath();
        ctx.arc(dx_, dy_, d.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [progress, size, drawSize]);

  // 🆕 数值排版：整数大号极细 + 小数小号，渐变填充 + 圆润字体更精致
  const clamped = Math.max(0, Math.min(100, progress));
  const numStr = clamped.toFixed(2);
  const [intPart, decPart] = numStr.split('.');
  const numGradient = 'linear-gradient(180deg,#f9a8d4 0%,#ec4899 52%,#be185d 100%)';
  const roundedFont = '"Yuanti SC", "YouYuan", "Varela Round", "Comfortaa", "Quicksand", "PingFang SC", "Microsoft YaHei", sans-serif';
  const beatIntervalDisplay = 60 / Math.max(52, bpmDisplay || 72);
  const numStyle: React.CSSProperties = {
    backgroundImage: numGradient,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
    fontVariantNumeric: 'tabular-nums',
    fontFamily: roundedFont,
    filter: 'drop-shadow(0 1px 5px rgba(236,72,153,0.28))',
  };

  return (
    <div className="relative flex flex-col items-center">
      <style>{`@keyframes particle-heart-beat { 0%,100%{transform:scale(1)} 12%{transform:scale(1.3)} 24%{transform:scale(1)} 36%{transform:scale(1.18)} 48%{transform:scale(1)} }`}</style>
      <div
        className="relative"
        style={{ width: `${drawSize}px`, height: `${drawSize}px` }}
      >
        <canvas
          ref={canvasRef}
          className="block"
          style={{ width: `${drawSize}px`, height: `${drawSize}px` }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
          <span className="flex items-baseline leading-none">
            <span className="text-[36px] font-extralight tracking-tight" style={numStyle}>
              {intPart}
            </span>
            <span className="text-[15px] font-light" style={{ ...numStyle, marginLeft: 1 }}>
              .{decPart}
            </span>
          </span>
          <span
            className="text-[10px] mt-1 font-medium"
            style={{
              color: '#c98aaa',
              letterSpacing: '0.35em',
              marginLeft: '0.35em',
              fontFamily: roundedFont,
              textShadow: '0 0 6px rgba(255,255,255,0.9)',
            }}
          >
            好感度
          </span>
        </div>
      </div>

      {/* 🆕 心率显示：实时 BPM，随情绪与对话起伏，自然回归平静 */}
      <div
        className="-mt-4 flex items-center gap-1.5 px-3 py-1 rounded-full z-10"
        style={{
          background: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(6px)',
          border: '1px solid rgba(244,114,182,0.22)',
          boxShadow: '0 2px 10px rgba(236,72,153,0.10)',
        }}
      >
        <Heart size={11} className="text-pink-500" fill="currentColor" style={{ animation: `particle-heart-beat ${beatIntervalDisplay}s ease-in-out infinite` }} />
        <span
          className="text-[13px] font-semibold tabular-nums"
          style={{ fontFamily: roundedFont, color: '#db2777' }}
        >
          {bpmDisplay}
        </span>
        <span className="text-[9px] text-gray-400 tracking-wider">BPM · 心率</span>
      </div>
    </div>
  );
}