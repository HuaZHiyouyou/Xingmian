/**
 * ============================================================
 * B2: 意图—闸门—管线 · 统一主动消息闸门
 *
 * 三条主动路径（AI-Life 活动触发 / 定时回复 / 链式主动）不再各自为政，
 * 出站前一律经过本闸门（单点实现）：
 *   1. 睡眠态拦截（复用 isSleepBlocked）
 *   2. 每日预算：仅【链式主动关心】限 8 条/天；其他主动来源（定时/回访/AI-Life）
 *      不限次数，可任意主动发言
 *   3. 被无视退避（主动消息后用户 2 小时未回应 = 被无视：
 *      连续 2 次 → 链式预算衰减 50%；连续 3 次 → 链式当日静默）
 *   4. 窗口焦点判断（决定走聊天流还是 D5 通知——当前先上报状态，D5 接线后消费）
 *
 * 状态持久化在 localStorage（跨重载有效）。
 * 用户一回应（chatStore.sendMessage 钩子 notifyUserMessage）立即解除退避。
 * ============================================================
 */
import { useDebugLog } from '../../store/debugLogStore';
import { useModelRoleStore } from '../../store/modelRoleStore';
import { isSleepBlocked } from '../ailife/chatIntegration';

// ---------------- 类型 ----------------

/** 主动意图来源与优先级：定时任务(1) > 情绪/回访(2) > 活动分享(3) > 随机闲聊(4) */
export type IntentSource = 'task' | 'scheduled' | 'callback' | 'ai-life' | 'chain';

export interface ProactiveIntent {
  source: IntentSource;
  priority: 1 | 2 | 3 | 4;
  reason: string;
  characterId: string;
  /** 交给生成管线的指令载荷 */
  payload: string;
}

export interface GateVerdict {
  allowed: boolean;
  reason: string;
  /** 窗口是否失焦（D5 通知接线的判断依据） */
  windowFocused: boolean;
}

interface GateState {
  day: string;
  used: number;
  /** 🆕 增强1: 定时主动当日已发条数（被无视退避按此衰减定时预算） */
  scheduledUsed: number;
  /** 被无视连续次数 */
  ignoreStreak: number;
  /** 待裁决的主动消息：发出后等用户回应 */
  pendingVerdict: { sentAt: number } | null;
  /** 🆕 P2-4: 用户最近一次发言时间戳（活跃跳过判定用） */
  lastUserActiveAt: number;
}

// ---------------- 常量 ----------------

const STORAGE_KEY = 'proactiveGate:v1';
/** 链式主动关心每日预算的兜底默认值（可在功能模块页配置） */
export const CHAIN_DAILY_BUDGET = 8;
/** 主动消息后等待用户回应的窗口；超时记一次"被无视" */
const IGNORE_WINDOW_MS = 2 * 60 * 60 * 1000;
/** 连续被无视 N 次后链式主动当日静默 */
const SILENT_STREAK = 3;

// ---------------- P2-4 打扰控制参数（设置页 → 主动回复 → 打扰控制 可配） ----------------

const DEFAULT_QUIET_ENABLED = true;
const DEFAULT_QUIET_START_MIN = 23 * 60;   // 23:00
const DEFAULT_QUIET_END_MIN = 7 * 60 + 30; // 07:30
const DEFAULT_ACTIVE_SKIP_MIN = 5;

interface ThrottleParams {
  quietEnabled: boolean;
  quietStartMin: number;
  quietEndMin: number;
  /** 用户活跃跳过窗口（毫秒），0 = 关闭 */
  activeSkipMs: number;
  quietStartLabel: string;
  quietEndLabel: string;
}

/** "HH:MM" → 当日分钟数；非法格式回退 fallback */
function hhmmToMinutes(s: string | undefined, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return fallback;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v < 1440 ? v : fallback;
}

/** 读取打扰控制参数（proactiveReplyConfig）；store 未就绪/字段非法时回退内置默认 */
function throttleParams(): ThrottleParams {
  try {
    const c = useModelRoleStore.getState().proactiveReplyConfig;
    return {
      quietEnabled: c?.quietHoursEnabled ?? DEFAULT_QUIET_ENABLED,
      quietStartMin: hhmmToMinutes(c?.quietStart, DEFAULT_QUIET_START_MIN),
      quietEndMin: hhmmToMinutes(c?.quietEnd, DEFAULT_QUIET_END_MIN),
      activeSkipMs: Math.max(0, Number(c?.activeSkipMinutes ?? DEFAULT_ACTIVE_SKIP_MIN) || 0) * 60 * 1000,
      quietStartLabel: String(c?.quietStart ?? '23:00'),
      quietEndLabel: String(c?.quietEnd ?? '07:30'),
    };
  } catch {
    return {
      quietEnabled: DEFAULT_QUIET_ENABLED,
      quietStartMin: DEFAULT_QUIET_START_MIN,
      quietEndMin: DEFAULT_QUIET_END_MIN,
      activeSkipMs: DEFAULT_ACTIVE_SKIP_MIN * 60 * 1000,
      quietStartLabel: '23:00',
      quietEndLabel: '07:30',
    };
  }
}

// ---------------- 状态存取 ----------------

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function load(): GateState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as GateState;
      if (s.day === todayKey()) {
        return { ...s, scheduledUsed: s.scheduledUsed || 0, lastUserActiveAt: s.lastUserActiveAt || 0 };
      }
    }
  } catch { /* 损坏即重置 */ }
  return { day: todayKey(), used: 0, scheduledUsed: 0, ignoreStreak: 0, pendingVerdict: null, lastUserActiveAt: 0 };
}

function save(s: GateState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* 静默 */ }
}

/** 链式主动每日预算：读取功能模块页配置（非法/未配置时回退默认值） */
export function chainDailyBudget(): number {
  try {
    const n = Math.floor(useModelRoleStore.getState().chainProactiveConfig?.dailyMaxCount ?? NaN);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch { /* store 未就绪时回退 */ }
  return CHAIN_DAILY_BUDGET;
}

/** 被无视退避后的有效链式预算：连续 ≥2 次减半，≥3 次 0（当日静默） */
export function effectiveBudget(streak: number): number {
  const base = chainDailyBudget();
  if (streak >= SILENT_STREAK) return 0;
  if (streak >= 2) return Math.floor(base / 2);
  return base;
}

/** 🆕 增强1: 定时主动基础配额（0 = 不限；读设置，非法回退 0） */
function scheduledDailyBase(): number {
  try {
    const n = Math.floor(useModelRoleStore.getState().proactiveReplyConfig?.scheduledMaxPerDay ?? NaN);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch { /* store 未就绪时回退 */ }
  return 0;
}

/** 🆕 增强1: 被无视退避后的有效定时预算（与链式同一退避曲线：≥2 次减半，≥3 次当日静默） */
export function effectiveScheduledBudget(streak: number): number {
  const base = scheduledDailyBase();
  if (base <= 0) return 0; // 0 = 不限额（退避只剩静默档）
  if (streak >= SILENT_STREAK) return 0;
  if (streak >= 2) return Math.floor(base / 2);
  return base;
}

// ---------------- 闸门裁决 ----------------

function isWindowFocused(): boolean {
  return typeof document === 'undefined' ? true : document.visibilityState === 'visible' && document.hasFocus();
}

/** 🆕 P2-4: 当前是否处于安静时段（窗口可在设置页配置；默认 23:00–07:30 本地时间） */
export function isQuietHours(): boolean {
  const p = throttleParams();
  if (!p.quietEnabled) return false;
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= p.quietStartMin || m < p.quietEndMin;
}

/** 睡眠门控：AI-Life 判定正在睡觉时拦截（引擎未启用时 isSleepBlocked 恒 false） */
function sleepBlocked(): boolean {
  try {
    return isSleepBlocked();
  } catch {
    return false;
  }
}

/**
 * 闸门裁决：询问"现在能否主动发言"。不产生副作用（不含裁决落账）。
 */
export function checkGate(intent: ProactiveIntent): GateVerdict {
  const focused = isWindowFocused();
  const s = load();

  if (sleepBlocked()) {
    return { allowed: false, reason: '睡眠时段拦截', windowFocused: focused };
  }

  // 🆕 P2-4 安静时段：窗口内一律静默（task 来源除外；窗口可在设置页配置）
  const tp = throttleParams();
  if (intent.source !== 'task' && tp.quietEnabled) {
    const m = new Date().getHours() * 60 + new Date().getMinutes();
    if (m >= tp.quietStartMin || m < tp.quietEndMin) {
      return { allowed: false, reason: `安静时段（${tp.quietStartLabel}–${tp.quietEndLabel}）静默`, windowFocused: focused };
    }
  }

  // 🆕 P2-4 用户活跃跳过：用户正在聊天时，自发类主动（定时/链式/AI-Life）暂不打扰；
  // callback（回复后主动）是对话的自然延续，不受此限。窗口分钟数可在设置页配置（0=关闭）
  if (
    tp.activeSkipMs > 0
    && (intent.source === 'scheduled' || intent.source === 'ai-life' || intent.source === 'chain')
    && s.lastUserActiveAt > 0
    && Date.now() - s.lastUserActiveAt < tp.activeSkipMs
  ) {
    return { allowed: false, reason: `用户最近活跃（${Math.round(tp.activeSkipMs / 60000)} 分钟窗口），暂不打扰`, windowFocused: focused };
  }

  // 被无视超时落账（惰性结算）：上个主动消息超窗未回应 → 记一次被无视
  if (s.pendingVerdict && Date.now() - s.pendingVerdict.sentAt > IGNORE_WINDOW_MS) {
    s.ignoreStreak += 1;
    s.pendingVerdict = null;
    save(s);
    useDebugLog.getState().add('proactive', `[闸门] 主动消息被无视（连续第 ${s.ignoreStreak} 次）${s.ignoreStreak >= SILENT_STREAK ? '→ 链式当日静默' : s.ignoreStreak >= 2 ? '→ 链式预算减半' : ''}`);
  }

  // 仅【链式主动关心】受每日预算约束；其他主动来源（定时/回访/AI-Life）不限次数
  if (intent.source === 'chain') {
    const budget = effectiveBudget(s.ignoreStreak);
    if (s.used >= budget) {
      const why = budget === 0 ? `连续被无视 ${s.ignoreStreak} 次，链式当日静默` : `已达链式主动预算（${s.used}/${budget}）`;
      return { allowed: false, reason: `${why}（来源: ${intent.source}/P${intent.priority}）`, windowFocused: focused };
    }
  }

  // 🆕 增强1: 定时主动计入被无视退避——配置了每日上限时，按退避曲线衰减预算
  if (intent.source === 'scheduled') {
    const base = scheduledDailyBase();
    if (base > 0) {
      const budget = effectiveScheduledBudget(s.ignoreStreak);
      if ((s.scheduledUsed || 0) >= budget) {
        const why = budget === 0
          ? `连续被无视 ${s.ignoreStreak} 次，定时主动当日静默`
          : `已达定时主动预算（${s.scheduledUsed}/${budget}${s.ignoreStreak >= 2 ? '，被无视退避减半' : ''}）`;
        return { allowed: false, reason: why, windowFocused: focused };
      }
    }
  }

  return { allowed: true, reason: intent.source === 'chain' ? `预算 ${s.used}/${effectiveBudget(s.ignoreStreak)}` : '不限次数', windowFocused: focused };
}

/**
 * 闸门放行 + 落账： intent 通过后由发送方在**实际发送成功后**调用。
 * task 来源（定时任务/睡醒带过等上下文必需消息）不计预算。
 * 🆕 D5: 窗口失焦时，非闲聊类主动消息（P1-P3）同步走系统通知。
 */
export function recordSent(intent: ProactiveIntent): void {
  if (intent.source === 'task') return;
  const s = load();
  const focused = isWindowFocused();
  // 仅【链式主动关心】计入每日预算；其他主动来源不限次数（仍记录"待回应"供被无视退避检测）
  if (intent.source === 'chain') {
    s.used += 1;
  }
  // 🆕 增强1: 定时主动在闸门内单独计数（退避衰减定时预算用）
  if (intent.source === 'scheduled') {
    s.scheduledUsed = (s.scheduledUsed || 0) + 1;
  }
  s.pendingVerdict = { sentAt: Date.now() };
  save(s);

  // D5: 失焦 → 系统通知（链式随机闲聊不打扰；聚焦时聊天流内可见无需通知）
  if (!focused && intent.source !== 'chain' && intent.characterId) {
    void (async () => {
      try {
        const { useCharacterStore } = await import('../../store/characterStore');
        const char = useCharacterStore.getState().characters.find((c) => c.id === intent.characterId);
        const name = char?.name || '她';
        const { sendProactiveNotification } = await import('./systemNotify');
        await sendProactiveNotification(`${name} · 新消息`, intent.reason || '有一条主动消息等你查看');
      } catch { /* 通知失败不影响主流程 */ }
    })();
  }
}

/** 用户回应钩子：chatStore.sendMessage 里调用——任何用户消息都视为"已回应"，解除退避。
 *  🆕 P2-4: 同时记录活跃时间戳，供"用户最近活跃则暂不打扰"判定。 */
export function notifyUserMessage(): void {
  const s = load();
  s.lastUserActiveAt = Date.now();
  if (s.pendingVerdict || s.ignoreStreak > 0) {
    s.pendingVerdict = null;
    s.ignoreStreak = 0;
    useDebugLog.getState().add('proactive', '[闸门] 用户已回应，退避解除，预算恢复');
  }
  save(s);
}

/** 当前闸门状态（设置页/调试展示用） */
export function getGateStatus(): {
  used: number;
  budget: number;
  ignoreStreak: number;
  windowFocused: boolean;
  quietHours: boolean;
  scheduledUsed: number;
  scheduledBudget: number;
} {
  const s = load();
  return {
    used: s.used,
    budget: effectiveBudget(s.ignoreStreak),
    ignoreStreak: s.ignoreStreak,
    windowFocused: isWindowFocused(),
    quietHours: isQuietHours(),
    scheduledUsed: s.scheduledUsed || 0,
    scheduledBudget: effectiveScheduledBudget(s.ignoreStreak),
  };
}
