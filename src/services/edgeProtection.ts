/**
 * ============================================================
 * V2 边缘防护模块
 * 参考: docs/upgrade-plans/05-todo-and-gaps.md P2部分
 * 功能：情绪疲劳保护、回复边界检查、Pipeline 失败追踪
 * ============================================================
 */

// ---------- 回复边界检查 ----------

export interface ReplyBoundaryCheckResult {
  valid: boolean;
  issue?: string;
  action?: 'pass' | 'trim' | 'pad' | 'retry';
  processedText?: string;
}

export function checkReplyBoundary(
  text: string,
  userInput?: string,
  options: {
    minLength?: number;
    maxLength?: number;
    maxDuplicateRatio?: number;
  } = {}
): ReplyBoundaryCheckResult {
  const { minLength = 2, maxDuplicateRatio = 0.85 } = options;

  if (text.length < minLength) {
    return {
      valid: false,
      issue: `回复过短 (${text.length}字，最少${minLength}字)`,
      action: 'pad',
      processedText: text + '...',
    };
  }

  if (userInput && userInput.length > 0) {
    const overlap = calculateOverlap(text, userInput);
    if (overlap > maxDuplicateRatio) {
      return {
        valid: false,
        issue: `复读率过高 (${Math.round(overlap * 100)}%)`,
        action: 'retry',
      };
    }
  }

  return { valid: true, action: 'pass' };
}

function calculateOverlap(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}

// ---------- Pipeline 失败追踪与降级 ----------

export interface PipelineDegradationState {
  v2Failures: number;
  v2Disabled: boolean;
  lastFailureAt: number;
}

export interface TrackFailureResult {
  newState: PipelineDegradationState;
  shouldDegrade: boolean;
}

const MAX_FAILURES_BEFORE_DEGRADE = 3;
const DEGRADE_COOLDOWN_MS = 5 * 60 * 1000;

export function trackPipelineFailure(state: PipelineDegradationState): TrackFailureResult {
  const now = Date.now();
  let { v2Failures, v2Disabled, lastFailureAt } = state;

  if (now - lastFailureAt > DEGRADE_COOLDOWN_MS) {
    v2Failures = 0;
    v2Disabled = false;
  }

  v2Failures += 1;
  lastFailureAt = now;

  if (v2Failures >= MAX_FAILURES_BEFORE_DEGRADE) {
    v2Disabled = true;
  }

  const newState = { v2Failures, v2Disabled, lastFailureAt };

  return {
    newState,
    shouldDegrade: v2Disabled,
  };
}

// ---------- 情绪疲劳保护 ----------

export interface EmotionFatigueState {
  highIntensityStreak: number;
  fatigueLevel: number;
  lastHighIntensityAt: number;
}

export interface EmotionFatigueResult {
  dampenedIntensity: number;
  fatigueState: EmotionFatigueState;
}

const HIGH_INTENSITY_THRESHOLD = 70;
const FATIGUE_RECOVERY_TIME = 10 * 60 * 1000;
const MAX_FATIGUE = 80;

export function checkEmotionFatigue(
  state: EmotionFatigueState,
  currentIntensity: number
): EmotionFatigueResult {
  const now = Date.now();
  let { highIntensityStreak, fatigueLevel, lastHighIntensityAt } = state;

  const timeSinceLastHigh = now - lastHighIntensityAt;
  if (timeSinceLastHigh > FATIGUE_RECOVERY_TIME) {
    const recovery = Math.min(fatigueLevel, (timeSinceLastHigh / FATIGUE_RECOVERY_TIME) * 30);
    fatigueLevel = Math.max(0, fatigueLevel - recovery);
    highIntensityStreak = Math.max(0, highIntensityStreak - 1);
  }

  let dampenedIntensity = currentIntensity;

  if (currentIntensity >= HIGH_INTENSITY_THRESHOLD) {
    highIntensityStreak += 1;
    lastHighIntensityAt = now;

    if (highIntensityStreak >= 3) {
      fatigueLevel = Math.min(MAX_FATIGUE, fatigueLevel + 15);
    }

    if (fatigueLevel > 0) {
      const dampenFactor = 1 - (fatigueLevel / 200);
      dampenedIntensity = Math.round(currentIntensity * dampenFactor);
    }
  } else if (currentIntensity < 40) {
    fatigueLevel = Math.max(0, fatigueLevel - 5);
  }

  return {
    dampenedIntensity,
    fatigueState: { highIntensityStreak, fatigueLevel, lastHighIntensityAt },
  };
}

// 兼容旧导出名
export type {
  EmotionFatigueState as PipelineFailureTracker,
  EmotionFatigueState as FailureTrackerState,
};
