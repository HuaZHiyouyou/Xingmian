
import { create } from 'zustand';
import { isRunningInTauri, dbGetModelRoles, dbSaveModelRoles } from '../lib/tauriBridge';

export type ModelRole =
  | 'cognitive'      // 🆕 实时认知链路：情绪+好感度+回想+回复（合并 reply/recall_notes/emotion/affinity/reply_length）
  | 'background'     // 🆕 异步任务：记忆提取/学习/反思/分析（合并 memory_extract/memory_thinking/memory_analysis/memory_reflection/memory_summary/learning/user_message_importance/ai_assist）
  | 'ailife'         // 🆕 AI 一日：日程生成/活动生成/日记生成/内容提案
  | 'vision'         // 图像分析（保持独立，多模态特性）
  | 'video';         // 视频分析（保持独立，多模态特性）

/** 🔧 统一角色常量：业务代码引用这里，避免散落字符串字面量 */
export const MODEL_ROLES = {
  COGNITIVE: 'cognitive',
  BACKGROUND: 'background',
  AILIFE: 'ailife',
  VISION: 'vision',
  VIDEO: 'video',
} as const satisfies Record<string, ModelRole>;

/** 🆕 旧角色 → 新角色映射（用于平滑迁移） */
export const LEGACY_ROLE_MIGRATION: Record<string, ModelRole> = {
  // 实时链路 → cognitive
  reply: 'cognitive',
  recall_notes: 'cognitive',
  emotion: 'cognitive',
  affinity: 'cognitive',
  reply_length: 'cognitive',
  // 异步任务 → background
  memory_extract: 'background',
  memory_thinking: 'background',
  memory_analysis: 'background',
  memory_reflection: 'background',
  memory_summary: 'background',
  learning: 'background',
  user_message_importance: 'background',
  ai_assist: 'background',
  // 视觉/视频保持
  vision: 'vision',
  video: 'video',
};

export const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
  cognitive: '对话主模型',
  background: '后台任务',
  ailife: 'AI 一日',
  vision: '图像分析',
  video: '视频分析',
};

export const MODEL_ROLE_DESCRIPTIONS: Record<ModelRole, string> = {
  cognitive: '对话主模型：认知链（感知→评估→代谢→决策→更新→话题）与回复同帧完成，正常聊天与主动回复共用；推理耗尽/思维链缺正文时自动"只要正文"重试',
  background: '后台任务模型：记忆提取、状态反思、思考/分析/总结记忆（后三项默认关闭，需在 设置→记忆分析设置 开启）',
  ailife: 'AI 一日模型：日程生成、活动过程/总结、日记、情绪转变、主动消息、随机事件、记账回复、每日三件小事——各调用可在 AI 一日的生成设置中独立开关',
  vision: '分析图片内容（多模态，独立配置）',
  video: '分析视频内容（多模态，独立配置）',
};

export interface ModelRoleAssignment {
  role: ModelRole;
  models: Array<{
    platformIndex: number;
    platformBaseUrl: string;
    modelName: string;
  }>;
}

export type SegmentMode = 'punctuation' | 'sentence' | 'paragraph' | 'smart';

interface SegmentConfig {
  enabled: boolean;
  threshold: number;
  maxSegments: number;
  mode: SegmentMode;
  minSegmentLength: number;
  segmentDelayMs: number;
  replyDelayMs: number;
  replyDelayRandomEnabled: boolean;
  replyDelayRandomMs: number;
  userReplyDelayMs: number;
  userReplyDelayRandomEnabled: boolean;
  userReplyDelayRandomMs: number;
  /** 🆕 A1 真实等待模拟：开启后"用户点击输入框外的真实等待时长"调制（而非覆盖）用户延迟 */
  userWaitSimulateEnabled: boolean;
  /** 🆕 A1 真实等待钳制上限（毫秒），默认 5000 */
  userWaitClampMs: number;
  showTypingIndicator: boolean;
  protectPairedSymbols: boolean;
  /** 🆕 合并模式：AI 回复不分段，多条内容合并为一条消息（segments 保留在单条气泡内） */
  aiMergeMessages: boolean;
}

export interface MessageProcessingConfig {
  enabled: boolean;
  cleanThinkingMarkers: boolean;
  blockAICliche: boolean;
  removeDuplicatePunctuation: boolean;
  normalizeWhitespace: boolean;
  tonePolish: boolean;
  // Intercept system
  enableIntercept: boolean;
  duplicateThreshold: number;  // 0-1, default 0.85
  blockDuplicate: boolean;
  blockPersonaCollapse: boolean;
  blockForbiddenViolation: boolean;
}

export interface ProactiveReplyConfig {
  enabled: boolean;

  proactiveEnabled: boolean;
  proactiveDelayMs: number;
  proactiveChance: number;

  scheduledEnabled: boolean;
  scheduledTimes: string[];
  scheduledMaxPerDay: number;

  /** 🆕 群聊主动回复：主动消息同时推送到外部群聊会话（无需@，受群白/黑名单门控） */
  groupProactiveEnabled: boolean;

  /** 🆕 P2-4 打扰控制：安静时段（此时间段内所有主动消息静默，定时任务来源除外） */
  quietHoursEnabled: boolean;
  /** 安静时段开始（本地时间 "HH:MM"） */
  quietStart: string;
  /** 安静时段结束（本地时间 "HH:MM"） */
  quietEnd: string;
  /** 🆕 P2-4 用户活跃跳过窗口（分钟，0=关闭）：用户最近发言 N 分钟内，定时/链式/AI-Life 主动暂不打扰 */
  activeSkipMinutes: number;

  customPrompt: string;
  conversationId: string;
}

const defaultProactiveReplyConfig: ProactiveReplyConfig = {
  enabled: false,           // 已知 bug，默认关闭（v1.3.0）

  proactiveEnabled: false,
  proactiveDelayMs: 3000,
  proactiveChance: 30,

  scheduledEnabled: false,
  scheduledTimes: [],
  scheduledMaxPerDay: 5,

  groupProactiveEnabled: true,

  quietHoursEnabled: true,
  quietStart: '23:00',
  quietEnd: '07:30',
  activeSkipMinutes: 5,

  customPrompt: '',
  conversationId: '',
};

export interface ChainProactiveConfig {
  enabled: boolean;
  customPrompt: string;
  conversationId: string;
  /** 链式主动关心每日次数上限（0 = 当日不主动） */
  dailyMaxCount: number;
  dayMinMinutes: number;
  dayMaxMinutes: number;
  nightMinMinutes: number;
  nightMaxMinutes: number;
  nightStart: string;
  nightEnd: string;
  randomFactor: number;
  callbackEnabled: boolean;
  callbackDelayMinutes: number;
}

const defaultChainProactiveConfig: ChainProactiveConfig = {
  enabled: false,
  customPrompt: '',
  conversationId: '',
  dailyMaxCount: 8,
  dayMinMinutes: 30,
  dayMaxMinutes: 120,
  nightMinMinutes: 60,
  nightMaxMinutes: 180,
  nightStart: '23:00',
  nightEnd: '07:00',
  randomFactor: 30,
  callbackEnabled: false,
  callbackDelayMinutes: 30,
};

interface ModelRoleState {
  assignments: Record<ModelRole, ModelRoleAssignment['models']>;
  maxRetriesPerModel: number;
  segmentConfig: SegmentConfig;
  messageProcessingConfig: MessageProcessingConfig;
  proactiveReplyConfig: ProactiveReplyConfig;
  chainProactiveConfig: ChainProactiveConfig;
  isLoaded: boolean;
  setAssignment: (role: ModelRole, models: ModelRoleAssignment['models']) => void;
  addModelToRole: (role: ModelRole, platformIndex: number, platformBaseUrl: string, modelName: string) => void;
  removeModelFromRole: (role: ModelRole, platformIndex: number, platformBaseUrl: string, modelName: string) => void;
  moveModelInRole: (role: ModelRole, fromIndex: number, toIndex: number) => void;
  setMaxRetries: (max: number) => void;
  setSegmentConfig: (config: Partial<SegmentConfig>) => void;
  setMessageProcessingConfig: (config: Partial<MessageProcessingConfig>) => void;
  setProactiveReplyConfig: (config: Partial<ProactiveReplyConfig>) => void;
  setChainProactiveConfig: (config: Partial<ChainProactiveConfig>) => void;
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
}

const STORAGE_KEY = 'model-role-config';

const defaultAssignments: Record<ModelRole, ModelRoleAssignment['models']> = {
  cognitive: [],
  background: [],
  ailife: [],
  vision: [],
  video: [],
};

const defaultSegmentConfig: SegmentConfig = {
  enabled: true,            // ✅ 默认开启分段
  threshold: 20,            // ✅ 20 字以上就考虑分段
  maxSegments: 5,           // ✅ 最多 5 条（太多也假）
  mode: 'smart',            // ✅ 用智能模式
  minSegmentLength: 5,      // ✅ 更短的段也可以
  segmentDelayMs: 1200,     // ✅ 段间延迟 1.2 秒
  replyDelayMs: 1000,       // ✅ 基础回复延迟 1 秒
  replyDelayRandomEnabled: true,  // ✅ 开启随机延迟
  replyDelayRandomMs: 1500, // ✅ 随机 0-1.5 秒
  userReplyDelayMs: 0,
  userReplyDelayRandomEnabled: false,
  userReplyDelayRandomMs: 0,
  userWaitSimulateEnabled: false,
  userWaitClampMs: 5000,
  showTypingIndicator: true, // ✅ 显示打字中
  protectPairedSymbols: true,
  aiMergeMessages: false,    // 🆕 AI 合并消息（默认关：保持分段拟真节奏）
};

const defaultMessageProcessingConfig: MessageProcessingConfig = {
  enabled: true,             // ✅ 默认开启后处理
  cleanThinkingMarkers: true,
  blockAICliche: true,
  removeDuplicatePunctuation: true,
  normalizeWhitespace: true,
  tonePolish: true,           // ✅ 默认开启语气微调
  enableIntercept: true,
  duplicateThreshold: 0.92,
  blockDuplicate: true,
  blockPersonaCollapse: true,
  blockForbiddenViolation: true,
};

function _mergeSegmentConfig(saved: Partial<SegmentConfig> | undefined): SegmentConfig {
  return {
    ...defaultSegmentConfig,
    ...(saved || {}),
    mode: saved?.mode || defaultSegmentConfig.mode,
  };
}

function _mergeMessageProcessingConfig(saved: Partial<MessageProcessingConfig> | undefined): MessageProcessingConfig {
  return {
    ...defaultMessageProcessingConfig,
    ...(saved || {}),
  };
}

function _mergeProactiveReplyConfig(saved: Partial<ProactiveReplyConfig> | undefined): ProactiveReplyConfig {
  return {
    ...defaultProactiveReplyConfig,
    ...(saved || {}),
  };
}

function _mergeChainProactiveConfig(saved: Partial<ChainProactiveConfig> | undefined): ChainProactiveConfig {
  return {
    ...defaultChainProactiveConfig,
    ...(saved || {}),
  };
}

interface LegacyAssignmentModel {
  platformIndex?: number;
  platformBaseUrl?: string;
  modelName?: string;
}

function _migrateAssignments(assignments: Record<string, LegacyAssignmentModel[]>): Record<ModelRole, ModelRoleAssignment['models']> {
  // 🆕 兼容老配置：将旧 15 种角色映射到新 4 种角色
  const migrated: Record<string, LegacyAssignmentModel[]> = {};
  for (const role of Object.keys(defaultAssignments)) {
    migrated[role] = [];
  }

  for (const [oldRole, models] of Object.entries(assignments)) {
    if (!models || models.length === 0) continue;

    // 兼容已知角色（直接迁移）
    if (oldRole in defaultAssignments) {
      migrated[oldRole] = models.map((m) => ({
        platformIndex: m.platformIndex,
        platformBaseUrl: m.platformBaseUrl || '',
        modelName: m.modelName,
      }));
      continue;
    }

    // 旧角色迁移
    const newRole = LEGACY_ROLE_MIGRATION[oldRole];
    if (!newRole) continue;

    // 如果目标角色已配置，跳过（避免覆盖用户选择）
    if (migrated[newRole] && migrated[newRole].length > 0) continue;

    migrated[newRole] = models.map((m) => ({
      platformIndex: m.platformIndex,
      platformBaseUrl: m.platformBaseUrl || '',
      modelName: m.modelName,
    }));
  }

  return migrated as Record<ModelRole, ModelRoleAssignment['models']>;
}

export const useModelRoleStore = create<ModelRoleState>((set, get) => ({
  assignments: { ...defaultAssignments },
  maxRetriesPerModel: 3,
  segmentConfig: { ...defaultSegmentConfig },
  messageProcessingConfig: { ...defaultMessageProcessingConfig },
  proactiveReplyConfig: { ...defaultProactiveReplyConfig },
  chainProactiveConfig: { ...defaultChainProactiveConfig },
  isLoaded: false,

  loadFromStorage: async () => {
    try {
      if (isRunningInTauri()) {
        const data = await dbGetModelRoles();
        if (data) {
          set({
            assignments: _migrateAssignments(data.assignments || defaultAssignments),
            maxRetriesPerModel: data.maxRetriesPerModel ?? 3,
            segmentConfig: _mergeSegmentConfig(data.segmentConfig as Partial<SegmentConfig> | undefined),
            messageProcessingConfig: _mergeMessageProcessingConfig(data.messageProcessingConfig),
            proactiveReplyConfig: _mergeProactiveReplyConfig(data.proactiveReplyConfig),
            chainProactiveConfig: _mergeChainProactiveConfig(data.chainProactiveConfig),
            isLoaded: true,
          });
          return;
        }
      } else {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const data = JSON.parse(stored);
          set({
            assignments: _migrateAssignments(data.assignments || defaultAssignments),
            maxRetriesPerModel: data.maxRetriesPerModel ?? 3,
            segmentConfig: _mergeSegmentConfig(data.segmentConfig as Partial<SegmentConfig> | undefined),
            messageProcessingConfig: _mergeMessageProcessingConfig(data.messageProcessingConfig),
            proactiveReplyConfig: _mergeProactiveReplyConfig(data.proactiveReplyConfig),
            chainProactiveConfig: _mergeChainProactiveConfig(data.chainProactiveConfig),
            isLoaded: true,
          });
          return;
        }
      }
      set({ isLoaded: true });
    } catch (e) {
      console.error('Failed to load model role config:', e);
      set({ isLoaded: true });
    }
  },

  saveToStorage: async () => {
    const { assignments, maxRetriesPerModel, segmentConfig, messageProcessingConfig, proactiveReplyConfig, chainProactiveConfig } = get();
    const data = { assignments, maxRetriesPerModel, segmentConfig, messageProcessingConfig, proactiveReplyConfig, chainProactiveConfig };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      if (isRunningInTauri()) {
        await dbSaveModelRoles(data as unknown as Parameters<typeof dbSaveModelRoles>[0]);
      }
    } catch (e) {
      console.error('Failed to save model role config:', e);
    }
  },

  setAssignment: (role, models) => {
    set((state) => ({
      assignments: { ...state.assignments, [role]: models },
    }));
    get().saveToStorage();
  },

  addModelToRole: (role, platformIndex, platformBaseUrl, modelName) => {
    const current = get().assignments[role];
    const exists = current.some(m => m.platformIndex === platformIndex && m.modelName === modelName);
    if (exists) return;
    set((state) => ({
      assignments: {
        ...state.assignments,
        [role]: [...current, { platformIndex, platformBaseUrl, modelName }],
      },
    }));
    get().saveToStorage();
  },

  removeModelFromRole: (role, platformIndex, _platformBaseUrl, modelName) => {
    set((state) => ({
      assignments: {
        ...state.assignments,
        [role]: state.assignments[role].filter(
          m => !(m.platformIndex === platformIndex && m.modelName === modelName)
        ),
      },
    }));
    get().saveToStorage();
  },

  moveModelInRole: (role, fromIndex, toIndex) => {
    const models = [...get().assignments[role]];
    if (fromIndex < 0 || fromIndex >= models.length) return;
    if (toIndex < 0 || toIndex >= models.length) return;
    const [moved] = models.splice(fromIndex, 1);
    models.splice(toIndex, 0, moved);
    set((state) => ({
      assignments: { ...state.assignments, [role]: models },
    }));
    get().saveToStorage();
  },

  setMaxRetries: (max) => {
    set({ maxRetriesPerModel: Math.max(1, Math.min(5, max)) });
    get().saveToStorage();
  },

  setSegmentConfig: (config) => {
    set((state) => ({
      segmentConfig: { ...state.segmentConfig, ...config },
    }));
    get().saveToStorage();
  },

  setMessageProcessingConfig: (config) => {
    set((state) => ({
      messageProcessingConfig: { ...state.messageProcessingConfig, ...config },
    }));
    get().saveToStorage();
  },

  setProactiveReplyConfig: (config) => {
    set((state) => ({
      proactiveReplyConfig: { ...state.proactiveReplyConfig, ...config },
    }));
    get().saveToStorage();
  },

  setChainProactiveConfig: (config) => {
    set((state) => ({
      chainProactiveConfig: { ...state.chainProactiveConfig, ...config },
    }));
    get().saveToStorage();
  },
}));

