/**
 * ============================================================
 * 功能模块 Store
 * 1. 数据修改：自定义情绪/好感度/增速/单次增长速率/记忆等可调参数
 * 2. 定时任务：自主设定（UI）/ 对话告诉 AI 设定
 * ============================================================
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { EmotionType } from '../types';

// ==================== 数据修改 ====================

/** 情感系统覆盖配置：覆盖后端默认的情感代谢 / 好感度阶段收益算法 */
export interface DataOverrideConfig {
  enabled: boolean;
  /** 好感度增长倍率（覆盖默认 1.0；>1 更快，<1 更慢） */
  affinityGrowthRate: number;
  /** 好感度单次最大增量上限（覆盖默认阶段收益） */
  affinitySingleMax: number;
  /** 情绪自然衰减倍率（覆盖默认 decayMultiplier；0 = 不衰减） */
  emotionDecayMultiplier: number;
  /** 情绪跃迁阈值（覆盖默认值，越敏感变化越快） */
  emotionSensitivity: number;
  /** 12 维情绪直接设定值（0~100；启用后覆盖 AI 实时情绪） */
  emotionValues: Partial<Record<EmotionType, number>>;
  /** 好感度直接设定值（-100~100） */
  affinityLevel: number;
  /** 好感度是否锁定为 affinityLevel（区分"设为 0 锁定"与"从未设定"） */
  affinityLevelLocked: boolean;
  /** 记忆重要度权重（覆盖记忆检索/遗忘的默认权重） */
  memoryImportanceWeight: number;
  /** 记忆衰减速率 */
  memoryDecayRate: number;
  /** 🆕 B4 性格决策参数：自律/节俭/行动力（0-1，生活念头决策的算法系数） */
  personality: {
    selfDiscipline: number;
    frugality: number;
    actionDrive: number;
  };
}

/** 🆕 B4 性格决策参数默认值 */
export const DEFAULT_PERSONALITY = { selfDiscipline: 0.5, frugality: 0.5, actionDrive: 0.5 };

const defaultDataOverride: DataOverrideConfig = {
  enabled: false,
  affinityGrowthRate: 1.0,
  affinitySingleMax: 0,
  emotionDecayMultiplier: 1.0,
  emotionSensitivity: 50,
  emotionValues: {},
  affinityLevel: 0,
  affinityLevelLocked: false,
  memoryImportanceWeight: 1.0,
  memoryDecayRate: 1.0,
  personality: { ...DEFAULT_PERSONALITY },
};

// ==================== Bot 接入行为（A1/A4） ====================

/** Bot 接入行为配置：智能合并模式 + 群聊唤醒 + 指令 */
export interface BotBehaviorConfig {
  /** 合并模式总开关（默认 true） */
  mergeEnable: boolean;
  /** 长度阈值（默认 150 字符） */
  mergeThreshold: number;
  /** 合并需结构化特征（默认 true：仅长结构化内容合并，日常短对话照常分段） */
  mergeRequireStructure: boolean;
  /** 发送防抖窗口毫秒（默认 3000） */
  sendDebounceMs: number;
  /** Bot 指令开关（默认 true） */
  commandEnabled: boolean;
  /** 🆕 #2 AI 工具调用开关（默认 true）：允许 AI 在回复中输出 [[music:...]] 标签触发点歌——
   *  页内用播放器播放，外部平台（QQ/微信）发送音乐分享卡片 */
  aiToolEnabled: boolean;
  /** 群聊唤醒模式：mention_prefix=@机器人或前缀才回复；all=所有消息回复 */
  wakeupMode: 'mention_prefix' | 'all';
  /** 唤醒前缀（默认 '/'，与指令前缀统一） */
  wakeupPrefix: string;
}

const defaultBotBehavior: BotBehaviorConfig = {
  mergeEnable: true,
  mergeThreshold: 150,
  mergeRequireStructure: true,
  sendDebounceMs: 3000,
  commandEnabled: true,
  aiToolEnabled: true,
  wakeupMode: 'mention_prefix',
  wakeupPrefix: '/',
};

// ==================== 重试策略（A7） ====================

/** 重试策略配置 */
export interface RetryPolicyConfig {
  /** 拦截重试次数，默认 1 */
  interceptRetryMax: number;
  /** 重试模式：rewrite=修改式（复用上下文+改写指令）；regenerate=全量重生成 */
  retryMode: 'rewrite' | 'regenerate';
  /** 重试升温 +0.1/次，默认 true */
  enableTemperatureRamp: boolean;
  /** 自适应温度上限（默认 0.95） */
  adaptiveTempMax: number;
}

const defaultRetryPolicy: RetryPolicyConfig = {
  interceptRetryMax: 1,
  retryMode: 'rewrite',
  enableTemperatureRamp: true,
  adaptiveTempMax: 0.95,
};

// ==================== 定时任务 ====================

export type ScheduledTaskType = 'custom_prompt' | 'send_message' | 'run_skill' | 'run_plugin' | 'memory_cleanup' | 'emotion_boost';

export interface ScheduledTask {
  id: string;
  /** 任务名称 */
  name: string;
  type: ScheduledTaskType;
  /** cron 表达式（简化版：分钟 小时 天） */
  schedule: string;
  /** 具体内容：自定义 prompt 注入 / 要发送的消息 / skill 名 / plugin id */
  payload: string;
  enabled: boolean;
  lastRun?: number;
  /** 来源：ui=自主设定，chat=对话告诉 AI 设定 */
  source: 'ui' | 'chat';
  createdAt: number;
}

// ==================== Store ====================

interface FeatureModuleState {
  dataOverride: DataOverrideConfig;
  botBehavior: BotBehaviorConfig;
  retryPolicy: RetryPolicyConfig;
  tasks: ScheduledTask[];

  // 数据修改
  setDataOverride: (patch: Partial<DataOverrideConfig>) => void;
  resetDataOverride: () => void;
  setEmotionValue: (emotion: EmotionType, value: number) => void;

  // Bot 接入行为
  setBotBehavior: (patch: Partial<BotBehaviorConfig>) => void;
  resetBotBehavior: () => void;

  // 重试策略
  setRetryPolicy: (patch: Partial<RetryPolicyConfig>) => void;
  resetRetryPolicy: () => void;

  // 定时任务
  addTask: (task: Omit<ScheduledTask, 'id' | 'createdAt' | 'lastRun'>) => void;
  updateTask: (id: string, patch: Partial<ScheduledTask>) => void;
  removeTask: (id: string) => void;
  toggleTask: (id: string) => void;

  // 调度
  checkTasks: (now?: Date) => void;
  /** 任务触发事件（外部订阅） */
  _emitTask: (id: string) => void;
  /** 订阅任务触发，返回取消订阅函数 */
  subscribeTaskTrigger: (handler: (id: string) => void) => () => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

/** 🔧 拆分 cron 为四个字段："分 时 天 月"（缺失补 "*"，兼容旧三段格式） */
function splitSchedule(schedule: string): [string, string, string, string] {
  const parts = schedule.trim().split(/\s+/);
  return [parts[0] ?? '*', parts[1] ?? '*', parts[2] ?? '*', parts[3] ?? '*'];
}

/** 🔧 单字段匹配：星号或空=任意；星号斜杠N 形式为步进（能被 N 整除）；数字=精确 */
function fieldMatch(spec: string, value: number): boolean {
  if (spec === '*' || spec === '') return true;
  const step = spec.match(/^\*\/(\d+)$/);
  if (step) {
    const n = Number(step[1]);
    return n > 0 && value % n === 0;
  }
  const v = Number(spec);
  return Number.isFinite(v) && v === value;
}

/** 🔧 cron → 人话描述（任务列表展示用） */
export function describeSchedule(schedule: string): string {
  try {
    const [m, h, d, mo] = splitSchedule(schedule);
    const mm = /^\d+$/.test(m) ? String(Number(m)).padStart(2, '0') : null;
    const hh = /^\d+$/.test(h) ? String(Number(h)).padStart(2, '0') : null;
    if (m.startsWith('*/')) return `每 ${m.slice(2)} 分钟`;
    if (h === '*' && d === '*' && mo === '*' && mm !== null) return `每小时第 ${Number(m)} 分`;
    if (hh !== null && mm !== null && d === '*') return `每天 ${hh}:${mm}`;
    if (hh !== null && mm !== null && /^\d+$/.test(d) && mo === '*') return `每月 ${Number(d)} 日 ${hh}:${mm}`;
    if (hh !== null && mm !== null && /^\d+$/.test(d) && /^\d+$/.test(mo)) return `每年 ${Number(mo)} 月 ${Number(d)} 日 ${hh}:${mm}`;
    if (h === '*' && d === '*' && m === '*') return '每分钟';
    return schedule;
  } catch {
    return schedule;
  }
}

export const useFeatureModuleStore = create<FeatureModuleState>()(
  persist(
    (set, get) => ({
      dataOverride: { ...defaultDataOverride },
      botBehavior: { ...defaultBotBehavior },
      retryPolicy: { ...defaultRetryPolicy },
      tasks: [],

      setDataOverride: (patch) => set((s) => ({ dataOverride: { ...s.dataOverride, ...patch } })),
      resetDataOverride: () => set({ dataOverride: { ...defaultDataOverride } }),

      setBotBehavior: (patch) => set((s) => ({ botBehavior: { ...s.botBehavior, ...patch } })),
      resetBotBehavior: () => set({ botBehavior: { ...defaultBotBehavior } }),

      setRetryPolicy: (patch) => set((s) => ({ retryPolicy: { ...s.retryPolicy, ...patch } })),
      resetRetryPolicy: () => set({ retryPolicy: { ...defaultRetryPolicy } }),
      setEmotionValue: (emotion, value) => set((s) => ({
        dataOverride: {
          ...s.dataOverride,
          emotionValues: {
            ...s.dataOverride.emotionValues,
            [emotion]: Math.max(0, Math.min(100, Math.round(value))),
          },
        },
      })),

      addTask: (task) => set((s) => ({
        tasks: [...s.tasks, {
          ...task,
          id: generateId(),
          createdAt: Date.now(),
          lastRun: undefined,
        } as ScheduledTask],
      })),
      updateTask: (id, patch) => set((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      })),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      toggleTask: (id) => set((s) => ({
        tasks: s.tasks.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
      })),

      /** 每分钟调度检查（配合外部 setInterval） */
      checkTasks: (now = new Date()) => {
        const minute = now.getMinutes();
        const hour = now.getHours();
        const day = now.getDate();
        const month = now.getMonth() + 1;
        get().tasks.forEach((task) => {
          if (!task.enabled) return;
          const [ms, hs, ds, mos] = splitSchedule(task.schedule);
          const match = fieldMatch(ms, minute) && fieldMatch(hs, hour) && fieldMatch(ds, day) && fieldMatch(mos, month);
          if (!match) return;
          // 防止同一分钟内重复执行
          if (task.lastRun && now.getTime() - task.lastRun < 60000) return;
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, lastRun: now.getTime() } : t)),
          }));
          // 触发任务执行（由外部监听执行，这里只标记 lastRun）
          get()._emitTask(task.id);
        });
      },
      _emitTask: (id) => {
        // 由运行时订阅（App.tsx 注册），通过 CustomEvent 广播
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('feature-task-trigger', { detail: { id } }));
        }
      },
      subscribeTaskTrigger: (handler) => {
        const listener = (e: Event) => {
          const detail = (e as CustomEvent).detail as { id: string };
          if (detail?.id) handler(detail.id);
        };
        window.addEventListener('feature-task-trigger', listener);
        return () => window.removeEventListener('feature-task-trigger', listener);
      },
    }),
    {
      name: 'feature-module',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
