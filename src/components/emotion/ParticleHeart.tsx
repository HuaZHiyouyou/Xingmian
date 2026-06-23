import { useEffect, useRef } from 'react';

interface ParticleHeartProps {
  progress: number;
  size?: number;
}

function pointOnHeart(t: number) {
  return {
    x: 16 * Math.pow(Math.sin(t), 3),
    y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
  };
}

// 心形法线方向（垂直于切线）
function normalOnHeart(t: number) {
  // dx/dt, dy/dt 的垂直方向
  const dx = 48 * Math.pow(Math.sin(t), 2) * Math.cos(t);
  const dy = -(13 * Math.sin(t) - 10 * Math.sin(2 * t) - 6 * Math.sin(3 * t) - 4 * Math.sin(4 * t));
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

// 阶段配置表
const stageConfig = [
  { min: 0,  max: 20, heartColor: '#fce4ec', lightColor: '#fef1f6', deepColor: '#fbcfe8', particleColor: '#f9a8d4', particleLight: '#fbcfe8', glowLayers: 2, shadowBlur: 15, pulseAmp: 0.05, glowRadius: 0.35 },
  { min: 20, max: 40, heartColor: '#fbcfe8', lightColor: '#fde8f0', deepColor: '#f9a8d4', particleColor: '#f472b6', particleLight: '#f9a8d4', glowLayers: 3, shadowBlur: 20, pulseAmp: 0.08, glowRadius: 0.40 },
  { min: 40, max: 60, heartColor: '#f9a8d4', lightColor: '#fbcfe8', deepColor: '#f472b6', particleColor: '#ec4899', particleLight: '#f472b6', glowLayers: 3, shadowBlur: 28, pulseAmp: 0.12, glowRadius: 0.48 },
  { min: 60, max: 80, heartColor: '#f472b6', lightColor: '#f9a8d4', deepColor: '#ec4899', particleColor: '#db2777', particleLight: '#ec4899', glowLayers: 4, shadowBlur: 35, pulseAmp: 0.15, glowRadius: 0.55 },
  { min: 80, max: 101, heartColor: '#ec4899', lightColor: '#f472b6', deepColor: '#db2777', particleColor: '#be185d', particleLight: '#db2777', glowLayers: 5, shadowBlur: 45, pulseAmp: 0.20, glowRadius: 0.65 },
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

export function ParticleHeart({ progress, size = 220 }: ParticleHeartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const p = Math.max(0, Math.min(100, progress));
    const stage = getStage(p);
    const { heartColor, lightColor, deepColor, particleColor, particleLight } = stage;
    const heartScale = size * 0.022;
    const cx = size / 2;
    const cy = size / 2;

    // 种子随机
    const rand = seededRandom(42);
    const orbits: OrbitP[] = [];
    for (let i = 0; i < 16; i++) {
      orbits.push({
        angle: (i / 16) * Math.PI * 2,
        radius: size * (0.18 + rand() * 0.1),
        speed: (0.3 + rand() * 0.4) * (i % 2 === 0 ? 1 : -1),
        size: 1.2 + rand() * 1.8,
        alpha: 0.3 + rand() * 0.45,
        phase: rand() * Math.PI * 2,
      });
    }

    // 心跳 & 蹦散
    const burstParticles: BurstP[] = [];
    let lastBeatTime = -1;
    const beatInterval = 60 / 72; // 72bpm

    let animId: number;
    let start: number | null = null;

    function drawHeartPath(s: number) {
      ctx.beginPath();
      for (let i = 0; i <= 150; i++) {
        const t = -Math.PI + (i / 150) * 2 * Math.PI;
        const pt = pointOnHeart(t);
        const x = cx + pt.x * s;
        const y = cy + pt.y * s;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    function render(ts: number) {
      if (start === null) start = ts;
      const time = (ts - start) / 1000;

      // ── 心跳脉搏（60+） ──
      let heartBeatScale = 1;
      let pulseRingRadius = 0;
      let pulseRingAlpha = 0;
      if (p >= 60) {
        const beatPhase = (time % beatInterval) / beatInterval;
        let beatVal = 0;
        // 双搏: 第一搏(0-0.15) + 第二搏(0.25-0.45)
        if (beatPhase < 0.15) {
          beatVal = Math.sin((beatPhase / 0.15) * Math.PI);
        } else if (beatPhase >= 0.25 && beatPhase < 0.45) {
          beatVal = Math.sin(((beatPhase - 0.25) / 0.2) * Math.PI) * 0.6;
        }
        heartBeatScale = 1 + beatVal * stage.pulseAmp;

        // 径向脉冲环
        if (beatPhase < 0.5) {
          const ringT = beatPhase / 0.5;
          pulseRingRadius = 20 + ringT * 25;
          pulseRingAlpha = (0.15 + (p - 60) / 40 * 0.15) * (1 - ringT);
        }

        // 触发蹦散粒子
        if (beatPhase < 0.02 && time - lastBeatTime > beatInterval * 0.5) {
          lastBeatTime = time;
          const burstCount = 8 + Math.floor(rand() * 5);
          for (let i = 0; i < burstCount; i++) {
            const t = -Math.PI + rand() * 2 * Math.PI;
            const pt = pointOnHeart(t);
            const n = normalOnHeart(t);
            const speed = 1.2 + rand() * 2;
            burstParticles.push({
              x: cx + pt.x * heartScale,
              y: cy + pt.y * heartScale,
              vx: n.nx * speed * (rand() > 0.5 ? 1 : -1),
              vy: n.ny * speed - 0.5,
              size: 1 + rand() * 1.5,
              alpha: 0.6 + rand() * 0.4,
              born: time,
              life: 0.8 + rand() * 0.4,
            });
          }
        }
      }

      const breath = 1 + Math.sin(time * 3.8) * stage.pulseAmp;
      const glowPulse = 0.7 + Math.sin(time * 2.5) * 0.3;

      ctx.clearRect(0, 0, size, size);

      const heartTopY = cy - 13 * heartScale * breath;
      const heartBottomY = cy + 13 * heartScale * breath;
      const heartHeight = heartBottomY - heartTopY;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(breath * heartBeatScale, breath * heartBeatScale);
      ctx.translate(-cx, -cy);

      // ── 外部辉光（阶段层数） ──
      const glowAlpha = p <= 0 ? 0.55 : 0.5;
      for (let g = stage.glowLayers - 1; g >= 0; g--) {
        const r = size * (stage.glowRadius + g * 0.1);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, heartColor + '55');
        grad.addColorStop(0.5, heartColor + '20');
        grad.addColorStop(1, heartColor + '00');
        ctx.globalAlpha = glowAlpha - g * 0.08;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── 爱心裁剪区域 ──
      drawHeartPath(heartScale);
      ctx.save();
      ctx.clip();

      // 内部底色
      ctx.fillStyle = 'rgba(253, 242, 248, 0.5)';
      ctx.fillRect(0, 0, size, size);

      // 液柱（溢出 3px 防止心跳缩放时空缺）
      const fillRatio = p / 100;
      const overflow = 64;
      const waterTopY = heartBottomY - heartHeight * fillRatio;

      if (fillRatio > 0.005) {
        // 液柱渐变
        const grad = ctx.createLinearGradient(0, waterTopY, 0, heartBottomY + overflow);
        grad.addColorStop(0, lightColor + 'cc');
        grad.addColorStop(0.35, heartColor + 'dd');
        grad.addColorStop(0.7, heartColor);
        grad.addColorStop(1, deepColor);
        ctx.fillStyle = grad;
        ctx.fillRect(0, waterTopY, size, heartBottomY + overflow - waterTopY);

        // 第一层波（慢速大幅）
        const waveAmp = 2.5 * Math.min(1, fillRatio);
        ctx.beginPath();
        ctx.moveTo(0, waterTopY);
        for (let x = 0; x <= size; x += 2) {
          const y = waterTopY
            + Math.sin((x / size) * Math.PI * 3.5 + time * 1.2) * waveAmp
            + Math.sin((x / size) * Math.PI * 6 + time * 1.8) * waveAmp * 0.35;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(size, heartBottomY + overflow);
        ctx.lineTo(0, heartBottomY + overflow);
        ctx.closePath();
        ctx.fillStyle = lightColor + '99';
        ctx.fill();

        // 第二层波（中速，相位偏移）
        ctx.beginPath();
        ctx.moveTo(0, waterTopY + 3);
        for (let x = 0; x <= size; x += 2) {
          const y = waterTopY + 3
            + Math.sin((x / size) * Math.PI * 5 + time * 2.0 + 1.2) * waveAmp * 0.5
            + Math.cos((x / size) * Math.PI * 8 + time * 2.8 + 0.5) * waveAmp * 0.2;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(size, heartBottomY + overflow);
        ctx.lineTo(0, heartBottomY + overflow);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fill();

        // 第三层波（快速小幅，顶部高光）
        ctx.beginPath();
        ctx.moveTo(0, waterTopY + 1);
        for (let x = 0; x <= size; x += 2) {
          const y = waterTopY + 1
            + Math.sin((x / size) * Math.PI * 9 + time * 3.5 + 2.8) * waveAmp * 0.25;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(size, heartBottomY + overflow);
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
        ctx.fillRect(0, waterTopY, size, heartBottomY + overflow - waterTopY);
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      // ── 心跳径向脉冲环（60+） ──
      if (pulseRingRadius > 0 && pulseRingAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = pulseRingAlpha;
        const ringGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRingRadius);
        ringGrad.addColorStop(0, heartColor + '00');
        ringGrad.addColorStop(0.7, heartColor + '30');
        ringGrad.addColorStop(1, heartColor + '00');
        ctx.fillStyle = ringGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, pulseRingRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ── 爱心描边（渐变 + 辉光） ──
      drawHeartPath(heartScale);
      ctx.save();
      ctx.shadowColor = heartColor;
      ctx.shadowBlur = stage.shadowBlur * glowPulse;
      const strokeGrad = ctx.createLinearGradient(cx, heartTopY, cx, heartBottomY);
      strokeGrad.addColorStop(0, lightColor);
      strokeGrad.addColorStop(0.5, heartColor);
      strokeGrad.addColorStop(1, deepColor);
      ctx.strokeStyle = strokeGrad;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.75;
      ctx.stroke();
      ctx.restore();

      // 第二层辉光描边
      ctx.save();
      ctx.shadowColor = heartColor;
      ctx.shadowBlur = stage.shadowBlur * 1.3 * glowPulse;
      drawHeartPath(heartScale);
      ctx.strokeStyle = heartColor + '55';
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.3;
      ctx.stroke();
      ctx.restore();

      // ── 气泡 ──
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

      ctx.restore(); // 结束呼吸

      // ── 心跳蹦散粒子（60+） ──
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
        bp.vy += 0.3 / 60; // 重力
        bp.vx *= 0.99;
        const fade = 1 - t;

        // 柔光
        ctx.globalAlpha = bp.alpha * fade * 0.5;
        const bpg = ctx.createRadialGradient(bp.x, bp.y, 0, bp.x, bp.y, bp.size * 3);
        bpg.addColorStop(0, particleLight + '60');
        bpg.addColorStop(1, particleColor + '00');
        ctx.fillStyle = bpg;
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, bp.size * 3, 0, Math.PI * 2);
        ctx.fill();

        // 实心
        ctx.globalAlpha = bp.alpha * fade;
        ctx.fillStyle = particleColor;
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, bp.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── 外部轨道粒子 ──
      for (const o of orbits) {
        const a = o.angle + time * o.speed;
        const yWave = Math.sin(time * 1.6 + o.phase) * size * 0.035;
        const ox = cx + Math.cos(a) * o.radius;
        const oy = cy + Math.sin(a) * o.radius * 0.55 + yWave;
        const flicker = 0.6 + Math.sin(time * 3 + o.phase) * 0.4;

        const pg = ctx.createRadialGradient(ox, oy, 0, ox, oy, o.size * 3.5);
        pg.addColorStop(0, particleColor + '40');
        pg.addColorStop(1, particleColor + '00');
        ctx.globalAlpha = o.alpha * flicker * 0.6;
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(ox, oy, o.size * 3.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = o.alpha * flicker;
        ctx.fillStyle = particleLight;
        ctx.beginPath();
        ctx.arc(ox, oy, o.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── 周围散点 ──
      const dots = [
        { x: -0.22, y: -0.18, s: 1.4 }, { x: 0.24, y: -0.15, s: 1.8 },
        { x: -0.18, y: 0.18, s: 1.2 }, { x: 0.2, y: 0.16, s: 1.6 },
        { x: -0.1, y: -0.25, s: 1.0 }, { x: 0.1, y: 0.25, s: 1.3 },
        { x: -0.26, y: 0.03, s: 1.1 }, { x: 0.27, y: -0.02, s: 1.5 },
        { x: -0.03, y: 0.28, s: 0.9 }, { x: 0.02, y: -0.28, s: 1.2 },
      ];
      for (const d of dots) {
        const dx = cx + d.x * size;
        const dy = cy + d.y * size + Math.sin(time * 1.1 + d.x * 6) * 3;
        const tw = 0.55 + Math.sin(time * 2.2 + d.x * 7 + d.y * 5) * 0.45;
        ctx.globalAlpha = 0.3 * tw;
        ctx.fillStyle = particleColor;
        ctx.beginPath();
        ctx.arc(dx, dy, d.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [progress, size]);

  const p = Math.max(0, Math.min(100, progress));

  return (
    <div className="relative max-w-full max-h-full" style={{ aspectRatio: '1 / 1', width: size, height: size }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} className="block" />
      <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
        <span
          className="text-3xl font-black"
          style={{
            color: '#ec4899',
            textShadow: '0 0 10px rgba(236,72,153,0.45), 0 0 3px rgba(255,255,255,0.9)',
          }}
        >
          {Math.round(Math.max(0, Math.min(100, progress)) * 100) / 100}
        </span>
        <span
          className="text-[10px] mt-0.5"
          style={{ color: '#d4a0b4', textShadow: '0 0 5px rgba(255,255,255,0.8)' }}
        >
          好感度
        </span>
      </div>
    </div>
  );
}
