
import { create } from 'zustand';
import { isRunningInTauri, dbGetModelRoles, dbSaveModelRoles } from '../lib/tauriBridge';

export type ModelRole =
  | 'reply'
  | 'memory_extract'
  | 'memory_thinking'
  | 'memory_analysis'
  | 'memory_reflection'
  | 'memory_summary'
  | 'emotion'
  | 'affinity'
  | 'learning'
  | 'vision'
  | 'video'
  | 'user_message_importance'
  | 'reply_length';

export const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
  reply: '对话回复',
  memory_extract: '记忆提取',
  memory_thinking: 'AI思考',
  memory_analysis: '用户分析',
  memory_reflection: '内心反思',
  memory_summary: '对话总结',
  emotion: '情绪分析',
  affinity: '好感分析',
  learning: '学习分析',
  vision: '图像分析',
  video: '视频分析',
  user_message_importance: '用户消息重要度分析',
  reply_length: '回复长度顾问',
};

export const MODEL_ROLE_DESCRIPTIONS: Record<ModelRole, string> = {
  reply: '生成角色的对话回复',
  memory_extract: '从对话中提取记忆',
  memory_thinking: '生成AI的内心想法',
  memory_analysis: '分析用户意图和情绪',
  memory_reflection: '生成反思和感悟',
  memory_summary: '总结对话核心内容',
  emotion: '分析情绪变化',
  affinity: '分析好感度变化',
  learning: '学习用户的语言风格和表达习惯',
  vision: '分析图片内容',
  video: '分析视频内容',
  user_message_importance: '分析用户消息的重要度等级',
  reply_length: '根据场合判断回复长度，决定是否分段',
};

export interface ModelRoleAssignment {
  role: ModelRole;
  models: Array<{
    platformIndex: number;
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
  showTypingIndicator: boolean;
  protectPairedSymbols: boolean;
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
  scheduledChance: number;
  scheduledMaxPerDay: number;

  customPrompt: string;
  conversationId: string;
}

const defaultProactiveReplyConfig: ProactiveReplyConfig = {
  enabled: true,

  proactiveEnabled: true,
  proactiveDelayMs: 3000,
  proactiveChance: 30,

  scheduledEnabled: false,
  scheduledTimes: [],
  scheduledChance: 30,
  scheduledMaxPerDay: 5,

  customPrompt: '',
  conversationId: '',
};

interface ModelRoleState {
  assignments: Record<ModelRole, ModelRoleAssignment['models']>;
  maxRetriesPerModel: number;
  segmentConfig: SegmentConfig;
  messageProcessingConfig: MessageProcessingConfig;
  proactiveReplyConfig: ProactiveReplyConfig;
  isLoaded: boolean;
  setAssignment: (role: ModelRole, models: ModelRoleAssignment['models']) => void;
  addModelToRole: (role: ModelRole, platformIndex: number, modelName: string) => void;
  removeModelFromRole: (role: ModelRole, platformIndex: number, modelName: string) => void;
  moveModelInRole: (role: ModelRole, fromIndex: number, toIndex: number) => void;
  setMaxRetries: (max: number) => void;
  setSegmentConfig: (config: Partial<SegmentConfig>) => void;
  setMessageProcessingConfig: (config: Partial<MessageProcessingConfig>) => void;
  setProactiveReplyConfig: (config: Partial<ProactiveReplyConfig>) => void;
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
}

const STORAGE_KEY = 'model-role-config';

const defaultAssignments: Record<ModelRole, ModelRoleAssignment['models']> = {
  reply: [],
  memory_extract: [],
  memory_thinking: [],
  memory_analysis: [],
  memory_reflection: [],
  memory_summary: [],
  emotion: [],
  affinity: [],
  learning: [],
  vision: [],
  video: [],
  user_message_importance: [],
  reply_length: [],
};

const defaultSegmentConfig: SegmentConfig = {
  enabled: false,
  threshold: 50,
  maxSegments: 10,
  mode: 'punctuation',
  minSegmentLength: 8,
  segmentDelayMs: 800,
  replyDelayMs: 0,
  replyDelayRandomEnabled: false,
  replyDelayRandomMs: 0,
  userReplyDelayMs: 0,
  userReplyDelayRandomEnabled: false,
  userReplyDelayRandomMs: 0,
  showTypingIndicator: false,
  protectPairedSymbols: true,
};

const defaultMessageProcessingConfig: MessageProcessingConfig = {
  enabled: false,
  cleanThinkingMarkers: true,
  blockAICliche: true,
  removeDuplicatePunctuation: true,
  normalizeWhitespace: true,
  tonePolish: false,
  enableIntercept: true,
  duplicateThreshold: 0.92,
  blockDuplicate: true,
  blockPersonaCollapse: true,
  blockForbiddenViolation: true,
};

function _mergeSegmentConfig(saved: any): SegmentConfig {
  return {
    ...defaultSegmentConfig,
    ...(saved || {}),
    mode: (saved?.mode as SegmentMode) || 'punctuation',
  };
}

function _mergeMessageProcessingConfig(saved: any): MessageProcessingConfig {
  return {
    ...defaultMessageProcessingConfig,
    ...(saved || {}),
  };
}

function _mergeProactiveReplyConfig(saved: any): ProactiveReplyConfig {
  return {
    ...defaultProactiveReplyConfig,
    ...(saved || {}),
  };
}

export const useModelRoleStore = create<ModelRoleState>((set, get) => ({
  assignments: { ...defaultAssignments },
  maxRetriesPerModel: 3,
  segmentConfig: { ...defaultSegmentConfig },
  messageProcessingConfig: { ...defaultMessageProcessingConfig },
  proactiveReplyConfig: { ...defaultProactiveReplyConfig },
  isLoaded: false,

  loadFromStorage: async () => {
    try {
      if (isRunningInTauri()) {
        const data = await dbGetModelRoles();
        if (data) {
          set({
            assignments: data.assignments || defaultAssignments,
            maxRetriesPerModel: data.maxRetriesPerModel ?? 3,
            segmentConfig: _mergeSegmentConfig(data.segmentConfig),
            messageProcessingConfig: _mergeMessageProcessingConfig(data.messageProcessingConfig),
            proactiveReplyConfig: _mergeProactiveReplyConfig(data.proactiveReplyConfig),
            isLoaded: true,
          });
          return;
        }
      } else {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const data = JSON.parse(stored);
          set({
            assignments: data.assignments || defaultAssignments,
            maxRetriesPerModel: data.maxRetriesPerModel ?? 3,
            segmentConfig: _mergeSegmentConfig(data.segmentConfig),
            messageProcessingConfig: _mergeMessageProcessingConfig(data.messageProcessingConfig),
            proactiveReplyConfig: _mergeProactiveReplyConfig(data.proactiveReplyConfig),
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
    const { assignments, maxRetriesPerModel, segmentConfig, messageProcessingConfig, proactiveReplyConfig } = get();
    try {
      if (isRunningInTauri()) {
        await dbSaveModelRoles({ assignments, maxRetriesPerModel, segmentConfig, messageProcessingConfig, proactiveReplyConfig });
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ assignments, maxRetriesPerModel, segmentConfig, messageProcessingConfig, proactiveReplyConfig }));
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

  addModelToRole: (role, platformIndex, modelName) => {
    const current = get().assignments[role];
    const exists = current.some(m => m.platformIndex === platformIndex && m.modelName === modelName);
    if (exists) return;
    set((state) => ({
      assignments: {
        ...state.assignments,
        [role]: [...current, { platformIndex, modelName }],
      },
    }));
    get().saveToStorage();
  },

  removeModelFromRole: (role, platformIndex, modelName) => {
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
}));

