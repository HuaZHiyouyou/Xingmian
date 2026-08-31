/**
 * ============================================================
 * 心率引擎（Heart Rate Engine）
 *
 * 设计：
 *  - 平静基线 ~72 BPM（好感度越高基线略低——亲密后更从容）
 *  - 情绪驱动：不同情绪类型有权重，强度越高、好感越深 → 目标心率越高
 *  - 对话刺激：用户发消息 / AI 回复时注入瞬时刺激（stimulus），
 *    以约 7 秒半衰期自然衰减
 *  - 回归平静：当前心率向目标值指数回归（τ≈8s），叠加呼吸性窦性
 *    心律不齐（RSA）与慢波噪声，让数值有生命感而非死数
 * ============================================================
 */

export interface HeartRateInput {
  emotionType?: string;
  emotionIntensity?: number;
  /** 好感度 0~100 */
  affinity: number;
  /** 帧间隔秒 */
  dt: number;
}

export interface HeartRateFrame {
  /** 平滑后的实时心率 */
  bpm: number;
  /** 相对平静心率的比例（72 = 1.0），用于驱动波形速度/幅度 */
  relative: number;
}

/** 情绪类型 → 目标心率权重（BPM @ 满强度） */
const EMOTION_BPM_WEIGHT: Record<string, number> = {
  love: 15, fear: 15, anxiety: 13, embarrassment: 12,
  anticipation: 11, surprise: 12, anger: 10, joy: 9,
  curiosity: 6, gratitude: 6, empathy: 4, pride: 5, guilt: 5, trust: 3,
  sadness: -4, loneliness: -3, disappointment: -5, disgust: -2,
};

interface EngineState {
  bpm: number;
  stimulus: number;
  noiseSeed: number;
}

const state: EngineState = {
  bpm: 72,
  stimulus: 0,
  noiseSeed: Math.random() * 100,
};

/** 注入一次心率刺激（对话事件等）。amount 为 BPM 增量，上限 40 */
export function stimulateHeart(amount: number): void {
  state.stimulus = Math.min(40, state.stimulus + Math.max(0, amount));
}

/** 读取当前心率（供 UI 低频轮询显示） */
export function getHeartBpm(): number {
  return state.bpm;
}

/** 重置到平静（角色切换等场景） */
export function resetHeartRate(): void {
  state.bpm = 72;
  state.stimulus = 0;
}

/**
 * 每帧推进心率模型，返回当前心率。
 * 平静回归：current → target 的指数逼近（差值越大回归越快，封顶防突变）。
 */
export function tickHeartRate(dt: number, input: HeartRateInput): HeartRateFrame {
  const d = Math.max(0, Math.min(0.5, dt || 0.016));

  // 刺激自然衰减（半衰期 ~7s）
  state.stimulus *= Math.pow(0.5, d / 7);
  if (state.stimulus < 0.05) state.stimulus = 0;

  const affinity = Math.max(0, Math.min(100, input.affinity || 0));
  const intensity = Math.max(0, Math.min(100, input.emotionIntensity ?? 0));

  // 平静基线：好感越高越从容
  const base = 72 - (affinity / 100) * 4;
  // 情绪分量：类型权重 × 强度 × 好感放大（越亲密越容易心动）
  const w = EMOTION_BPM_WEIGHT[input.emotionType || ''] ?? 4;
  const affinityAmp = 0.7 + (affinity / 100) * 0.8;
  const emotionComp = w * (intensity / 100) * affinityAmp;

  const target = base + emotionComp + state.stimulus;

  // 指数回归平静（k 随差值自适应，τ ≈ 8~10s）
  const gap = target - state.bpm;
  const k = 0.10 + Math.min(0.12, Math.abs(gap) * 0.004);
  state.bpm += gap * Math.min(1, k * d);

  // 生理噪声：呼吸性窦性心律不齐（~0.25Hz）+ 极慢波，±1.5 BPM 内
  const t = performance.now() / 1000;
  const noise =
    Math.sin(t * 1.6 + state.noiseSeed) * 0.55 +
    Math.sin(t * 0.42 + state.noiseSeed * 2.7) * 0.5 +
    Math.sin(t * 0.11 + state.noiseSeed * 1.3) * 0.45;

  const bpm = Math.max(52, Math.min(150, state.bpm + noise));
  return { bpm, relative: bpm / 72 };
}
