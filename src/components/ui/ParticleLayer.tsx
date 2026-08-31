import { useEffect, useRef } from 'react';
import { useUIStore, ParticleConfig, ParticleType } from '../../store/uiStore';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  phase: number;
  life: number;
  maxLife: number;
  hue: number;
}

function createParticle(cfg: ParticleConfig, w: number, h: number, type?: ParticleType): Particle {
  const t = type || cfg.type;
  const baseSize = cfg.size;
  const p: Particle = {
    x: Math.random() * w,
    y: t === 'firework' ? h + 20 : Math.random() * h * 1.2 - h * 0.1,
    vx: 0,
    vy: 0,
    size: baseSize * (0.5 + Math.random() * 1.0),
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.08,
    phase: Math.random() * Math.PI * 2,
    life: 0,
    maxLife: 300 + Math.random() * 400,
    hue: Math.random() * 360,
  };

  switch (t) {
    case 'snow':
      p.vx = (Math.random() - 0.5) * 0.5;
      p.vy = 0.3 + Math.random() * 0.8;
      break;
    case 'stars':
      p.vx = (Math.random() - 0.5) * 0.1;
      p.vy = (Math.random() - 0.5) * 0.1;
      p.maxLife = 200 + Math.random() * 300;
      break;
    case 'hearts':
      p.vx = (Math.random() - 0.5) * 0.6;
      p.vy = -(0.3 + Math.random() * 0.6);
      break;
    case 'bubbles':
      p.vx = (Math.random() - 0.5) * 0.3;
      p.vy = -(0.2 + Math.random() * 0.5);
      break;
    case 'petals':
      // 🆕 花瓣：自然下落为主 + 轻微摆动（修复左右乱飘）
      p.vx = (Math.random() - 0.5) * 0.25;
      p.vy = 0.55 + Math.random() * 0.6;
      p.vr = (Math.random() - 0.5) * 0.05;
      break;
    case 'sparkles':
      p.vx = (Math.random() - 0.5) * 0.4;
      p.vy = (Math.random() - 0.5) * 0.4;
      p.maxLife = 80 + Math.random() * 160;
      break;
    case 'firefly':
      p.vx = (Math.random() - 0.5) * 1.5;
      p.vy = (Math.random() - 0.5) * 1.5;
      p.maxLife = 400 + Math.random() * 600;
      break;
    case 'confetti':
      p.vx = (Math.random() - 0.5) * 2;
      p.vy = 0.5 + Math.random() * 1.5;
      p.vr = (Math.random() - 0.5) * 0.15;
      p.hue = Math.random() * 360;
      break;
    case 'rain':
      p.vx = -0.5 + Math.random() * 0.3;
      p.vy = 8 + Math.random() * 6;
      p.size = baseSize * 0.3;
      p.maxLife = 80 + Math.random() * 40;
      break;
    case 'cherry':
      p.vx = (Math.random() - 0.5) * 0.6;
      p.vy = 0.2 + Math.random() * 0.4;
      p.vr = (Math.random() - 0.5) * 0.04;
      break;
    case 'butterfly':
      p.x = Math.random() * w;
      p.y = Math.random() * h * 0.7;
      p.vx = (Math.random() - 0.5) * 1.2;
      p.vy = (Math.random() - 0.5) * 0.8;
      p.maxLife = 500 + Math.random() * 500;
      p.hue = 200 + Math.random() * 160;
      break;
    case 'firework':
      p.x = w * 0.2 + Math.random() * w * 0.6;
      p.y = h;
      p.vy = -(6 + Math.random() * 4);
      p.vx = (Math.random() - 0.5) * 1;
      p.maxLife = 60 + Math.random() * 40;
      p.hue = Math.random() * 360;
      break;
  }
  return p;
}

function tickParticle(p: Particle, cfg: ParticleConfig, w: number, h: number, dt: number) {
  p.life += dt;
  const t = cfg.type;

  switch (t) {
    case 'snow':
      p.x += p.vx + Math.sin(p.phase * 0.5 + p.life * 0.01) * 0.3 * cfg.speed;
      p.y += p.vy * cfg.speed;
      p.rot += p.vr * 0.3;
      break;
    case 'stars': {
      const twinkle = Math.sin(p.life * 0.08 + p.phase) * 0.3 + 0.7;
      p.size = cfg.size * twinkle;
      p.x += p.vx;
      p.y += p.vy;
      break;
    }
    case 'hearts':
      p.x += p.vx + Math.sin(p.phase + p.life * 0.03) * 0.5;
      p.y += p.vy * cfg.speed;
      p.rot = Math.sin(p.life * 0.02) * 0.3;
      break;
    case 'bubbles':
      p.x += p.vx + Math.sin(p.phase + p.life * 0.025) * 0.4;
      p.y += p.vy * cfg.speed;
      break;
    case 'petals':
      // 🆕 下落为主 + 轻柔摆动（摆幅减半，不再左右乱飘）
      p.x += p.vx + Math.sin(p.phase + p.life * 0.02) * 0.35 * cfg.speed;
      p.y += p.vy * cfg.speed;
      p.rot += p.vr;
      break;
    case 'sparkles': {
      const flash = Math.sin(p.life * 0.2 + p.phase);
      p.size = cfg.size * Math.max(0.1, flash);
      p.x += p.vx;
      p.y += p.vy;
      break;
    }
    case 'firefly': {
      const wander = Math.sin(p.life * 0.02 + p.phase) * 0.15;
      const drift = Math.cos(p.life * 0.015 + p.phase * 1.3) * 0.1;
      p.vx += wander * cfg.speed;
      p.vy += drift * cfg.speed;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.x += p.vx;
      p.y += p.vy;
      const glow = Math.sin(p.life * 0.06 + p.phase) * 0.4 + 0.6;
      p.size = cfg.size * glow;
      break;
    }
    case 'confetti':
      p.x += p.vx + Math.sin(p.phase + p.life * 0.03) * 0.6;
      p.y += p.vy * cfg.speed;
      p.rot += p.vr * cfg.speed;
      p.vy += 0.01;
      break;
    case 'rain':
      p.x += p.vx * cfg.speed;
      p.y += p.vy * cfg.speed;
      break;
    case 'cherry':
      p.x += p.vx + Math.sin(p.phase + p.life * 0.018) * 1.0;
      p.y += p.vy * cfg.speed;
      p.rot += p.vr;
      break;
    case 'butterfly': {
      const wing = Math.sin(p.life * 0.15 + p.phase) * 0.4;
      p.vx += Math.sin(p.life * 0.012 + p.phase) * 0.08;
      p.vy += Math.cos(p.life * 0.01 + p.phase * 0.7) * 0.06;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.x += p.vx * cfg.speed;
      p.y += (p.vy + wing * 0.3) * cfg.speed;
      p.rot = wing * 0.5;
      break;
    }
    case 'firework':
      // 🆕 爆炸火星：重力弧线 + 空气阻力
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.055;
      p.vx *= 0.985;
      p.vy *= 0.985;
      break;
    default:
      p.x += p.vx;
      p.y += p.vy;
  }

  if (t === 'firefly' || t === 'butterfly') {
    if (p.x < -20) p.x = w + 20;
    if (p.x > w + 20) p.x = -20;
    if (p.y < -20) p.y = h + 20;
    if (p.y > h + 20) p.y = -20;
  } else if (t !== 'firework') {
    if (p.y > h + p.size * 2) {
      p.y = -p.size * 2;
      p.x = Math.random() * w;
    }
    if (p.x > w + p.size * 2) p.x = -p.size * 2;
    if (p.x < -p.size * 2) p.x = w + p.size * 2;
  }
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, cfg: ParticleConfig) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.globalAlpha = cfg.opacity;

  // 🆕 发光模式：脉动 → shadowBlur 随生命呼吸；否则用固定 glow
  if (cfg.glowMode === 'pulse') {
    const breath = 0.55 + 0.45 * Math.sin(p.life * 0.09 + p.phase);
    ctx.shadowBlur = cfg.glow * breath;
  } else {
    ctx.shadowBlur = cfg.glow;
  }
  ctx.shadowColor = cfg.color;
  ctx.fillStyle = cfg.color;
  ctx.strokeStyle = cfg.color;

  const t = cfg.type;

  // 🆕 光晕模式：加法混合（lighter）+ 多级衰减渐变——发光通透不浑浊
  if (cfg.glowMode === 'halo' && t !== 'firefly' && t !== 'firework') {
    const haloR = p.size * 3 + cfg.glow;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, haloR);
    halo.addColorStop(0, cfg.color + '55');
    halo.addColorStop(0.35, cfg.color + '2e');
    halo.addColorStop(0.7, cfg.color + '10');
    halo.addColorStop(1, cfg.color + '00');
    ctx.fillStyle = halo;
    ctx.globalAlpha = cfg.opacity * 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = cfg.opacity;
    ctx.fillStyle = cfg.color;
  }

  switch (t) {
    case 'hearts': {
      const s = p.size;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.3);
      ctx.bezierCurveTo(s * 0.5, -s * 0.3, s, s * 0.2, 0, s);
      ctx.bezierCurveTo(-s, s * 0.2, -s * 0.5, -s * 0.3, 0, s * 0.3);
      ctx.fill();
      break;
    }
    case 'stars': {
      const s = p.size;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
        const a2 = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a2) * s * 0.45, Math.sin(a2) * s * 0.45);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bubbles': {
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.globalAlpha = cfg.opacity * 0.25;
      ctx.fill();
      ctx.globalAlpha = cfg.opacity * 0.8;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-p.size * 0.3, -p.size * 0.3, p.size * 0.15, 0, Math.PI * 2);
      ctx.globalAlpha = cfg.opacity;
      ctx.fill();
      break;
    }
    case 'sparkles': {
      const s = p.size;
      ctx.lineWidth = Math.max(0.5, s * 0.2);
      ctx.beginPath();
      ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
      ctx.moveTo(0, -s); ctx.lineTo(0, s);
      ctx.moveTo(-s * 0.6, -s * 0.6); ctx.lineTo(s * 0.6, s * 0.6);
      ctx.moveTo(s * 0.6, -s * 0.6); ctx.lineTo(-s * 0.6, s * 0.6);
      ctx.stroke();
      break;
    }
    case 'petals': {
      const s = p.size;
      ctx.beginPath();
      ctx.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(s * 0.2, 0, s * 0.5, s * 0.2, 0.3, 0, Math.PI * 2);
      ctx.globalAlpha = cfg.opacity * 0.6;
      ctx.fill();
      break;
    }
    case 'firefly': {
      const s = p.size;
      // 🆕 加法混合：萤光更亮更通透
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 3);
      glow.addColorStop(0, cfg.color);
      glow.addColorStop(0.35, cfg.color + '70');
      glow.addColorStop(0.7, cfg.color + '22');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.globalAlpha = cfg.opacity * 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, s * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = cfg.opacity;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'confetti': {
      const s = p.size;
      ctx.fillStyle = `hsl(${p.hue}, 80%, 60%)`;
      ctx.fillRect(-s * 0.5, -s * 0.25, s, s * 0.5);
      break;
    }
    case 'rain': {
      const s = p.size;
      ctx.globalAlpha = cfg.opacity * 0.6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-s * 0.15, s * 1.5);
      ctx.lineTo(0, s * 1.8);
      ctx.lineTo(s * 0.15, s * 1.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cherry': {
      const s = p.size;
      ctx.fillStyle = '#ffb7c5';
      ctx.beginPath();
      ctx.ellipse(0, 0, s, s * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff69b4';
      ctx.beginPath();
      ctx.ellipse(s * 0.15, s * 0.05, s * 0.4, s * 0.25, 0.2, 0, Math.PI * 2);
      ctx.globalAlpha = cfg.opacity * 0.7;
      ctx.fill();
      break;
    }
    case 'butterfly': {
      const s = p.size;
      const wingAngle = Math.sin(p.life * 0.15 + p.phase) * 0.5;
      ctx.fillStyle = `hsl(${p.hue}, 70%, 60%)`;
      ctx.beginPath();
      ctx.ellipse(-s * 0.4, 0, s * 0.5, s * 0.35, -wingAngle, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(s * 0.4, 0, s * 0.5, s * 0.35, wingAngle, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsl(${p.hue + 20}, 60%, 40%)`;
      ctx.beginPath();
      ctx.ellipse(-s * 0.3, s * 0.2, s * 0.3, s * 0.2, -wingAngle, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(s * 0.3, s * 0.2, s * 0.3, s * 0.2, wingAngle, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.fillRect(-s * 0.03, -s * 0.3, s * 0.06, s * 0.6);
      break;
    }
    case 'firework': {
      // 🆕 爆炸火星：径向飞散 + 重力弧线 + 闪烁衰减
      const s = p.size;
      const lifeRatio = Math.max(0, 1 - p.life / p.maxLife);
      const flicker = 0.7 + Math.sin(p.life * 0.8 + p.phase) * 0.3;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = cfg.opacity * lifeRatio * flicker;
      const sparkGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2.4);
      sparkGlow.addColorStop(0, '#ffffff');
      sparkGlow.addColorStop(0.3, cfg.color);
      sparkGlow.addColorStop(0.65, cfg.color + '70');
      sparkGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = sparkGlow;
      ctx.beginPath();
      ctx.arc(0, 0, s * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = cfg.opacity * lifeRatio;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(0, 0, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function ParticleLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const cfgRef = useRef<ParticleConfig | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const particles = useUIStore((s) => s.particles);

  useEffect(() => {
    cfgRef.current = particles;
    if (!particles.enabled || particles.type === 'none') {
      particlesRef.current = [];
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, c.width, c.height);
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return undefined;
    }

    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const target = Math.min(particles.count, 300);
    // 🆕 烟花：粒子池为"爆炸火星"（由火箭爆炸动态生成），初始为空
    particlesRef.current = cfgRef.current?.type === 'firework' || particles.type === 'firework'
      ? []
      : Array.from({ length: target }, () => createParticle(particles, canvas.width, canvas.height));

    // 🆕 烟花系统：火箭升空 → 高空爆炸 → 径向火星
    interface Rocket { x: number; y: number; vx: number; vy: number; hue: number }
    let rockets: Rocket[] = [];
    let nextRocketIn = 0.5;
    const spawnBurst = (x: number, y: number, hue: number) => {
      const n = 28 + Math.floor(Math.random() * 12);
      const arr = particlesRef.current;
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2 + Math.random() * 0.25;
        const speed = 1.1 + Math.random() * 2.6;
        arr.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: particles.size * (0.35 + Math.random() * 0.45),
          rot: 0,
          vr: 0,
          phase: Math.random() * Math.PI * 2,
          life: 0,
          maxLife: 55 + Math.random() * 45,
          hue: hue + Math.random() * 40 - 20,
        });
      }
    };

    lastTimeRef.current = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - lastTimeRef.current) / 16.67, 3);
      lastTimeRef.current = now;
      const cfg = cfgRef.current!;
      const w = canvas.width;
      const h = canvas.height;

      // 🆕 流光拖尾：不清屏，而是按拖尾长度逐帧衰减旧画面（destination-out 淡出）
      if (cfg.trail > 0) {
        const fade = Math.max(0.04, 1 / (1 + cfg.trail * 0.35));
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0,0,0,${fade})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      } else {
        ctx.clearRect(0, 0, w, h);
      }

      // 🆕 烟花火箭：发射 → 上升（尾迹）→ 速度耗尽时爆炸
      if (cfg.type === 'firework') {
        nextRocketIn -= dt / 60;
        if (nextRocketIn <= 0 && rockets.length < 3) {
          rockets.push({
            x: w * (0.2 + Math.random() * 0.6),
            y: h + 10,
            vx: (Math.random() - 0.5) * 0.9,
            vy: -(5.4 + Math.random() * 2.2),
            hue: Math.random() * 360,
          });
          nextRocketIn = 0.9 + Math.random() * 1.1;
        }
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = rockets.length - 1; i >= 0; i--) {
          const r = rockets[i];
          r.x += r.vx * dt;
          r.y += r.vy * dt;
          r.vy += 0.085 * dt;
          // 火箭头 + 尾迹
          ctx.fillStyle = `hsla(${r.hue}, 95%, 75%, 0.95)`;
          ctx.beginPath();
          ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `hsla(${r.hue}, 90%, 60%, 0.3)`;
          ctx.beginPath();
          ctx.arc(r.x - r.vx * 2.5, r.y - r.vy * 2.5, 3.6, 0, Math.PI * 2);
          ctx.fill();
          if (r.vy >= -1.1 || r.y < h * 0.18) {
            spawnBurst(r.x, r.y, r.hue);
            rockets.splice(i, 1);
          }
        }
        ctx.restore();
      }

      const arr = particlesRef.current;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        tickParticle(p, cfg, w, h, dt);

        if (cfg.type === 'sparkles' || cfg.type === 'stars') {
          if (p.life > p.maxLife) {
            Object.assign(p, createParticle(cfg, w, h));
          }
        } else if (cfg.type === 'firework') {
          // 🆕 火星寿命结束即移除（由火箭爆炸补充）
          if (p.life > p.maxLife) {
            arr.splice(i, 1);
            continue;
          }
        }

        drawParticle(ctx, p, cfg);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [particles]);

  if (!particles.enabled || particles.type === 'none') return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ opacity: particles.opacity }}
    />
  );
}
