import { create } from 'zustand';
import { saveConfig, loadConfig } from './configStorage';

export interface ModelConfig {
  name: string;
  type: 'chat' | 'vision' | 'audio' | 'video';
  enabled: boolean;
  pinned: boolean;
  enabledTypes: ('chat' | 'vision' | 'audio' | 'video')[];
}

export interface PlatformConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  displayName: string;
  models: ModelConfig[];
  fetchingModels: boolean;
  isDefault?: boolean;
  /** 🆕 可选：该平台的 embedding 模型名（不填则用内置默认映射） */
  embeddingModel?: string;
}

export const defaultPlatforms: PlatformConfig[] = [
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    displayName: 'OpenAI',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    displayName: 'Anthropic',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com',
    displayName: 'Google Gemini',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.groq.com/openai/v1',
    displayName: 'Groq',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    displayName: 'DeepSeek',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.siliconflow.cn/v1',
    displayName: '硅基流动',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    displayName: '智谱AI',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://api.moonshot.cn/v1',
    displayName: 'Kimi',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    displayName: '通义千问',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    displayName: '豆包',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://spark-api-open.xf-yun.com/v1',
    displayName: '讯飞星火',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    displayName: '百度千帆',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    displayName: 'OpenRouter',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
  {
    enabled: false,
    apiKey: '',
    baseUrl: '',
    displayName: '自定义',
    models: [],
    fetchingModels: false,
    isDefault: true,
  },
];

export type ModelType = 'chat' | 'vision' | 'audio' | 'video';
export const modelTypeLabels: Record<ModelType, string> = {
  chat: '对话',
  vision: '视觉',
  audio: '语音',
  video: '视频',
};

async function persistConfig(platforms: PlatformConfig[]) {
  try {
    await saveConfig(platforms);
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// V2 系统配置
export interface V2SystemConfig {
  pipelineEnabled: boolean;
  // Pipeline 步骤
  cleanMarkers: boolean;
  blockCliche: boolean;
  typoSim: boolean;
  typoProb: number;
  typoCorrection: 'none' | 'asterisk' | 'strikethrough';
  smartSegment: boolean;
  segmentThreshold: number;
  maxSegments: number;
  pairProtection: boolean;
  tonePolish: boolean;
  lengthRandomize: boolean;
  colloquialism: boolean;
  smartPunctuation: boolean;
  speakingRhythm: boolean;
  finalSanitize: boolean;
  // 情感系统
  thoughtChainEnabled: boolean;
  activeMetabolism: boolean;
  decayMultiplier: number;
  toneIntensity: number;
  // 推理模型控制
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  // 🆕 #5 JSON 输出契约：要求模型整体输出单个 JSON（结构由 prompt 给定 + response_format json_object），
  // 绕开标签提取失败。平台不支持时 Rust 自动降级重试。
  jsonOutputMode: boolean;
  // V3: max_tokens 计算参数（替换硬编码常数，由 Rust 管道消费）
  cognitiveMultiplier: number;  // 认知链放大系数，默认 1.5
  reasoningBuffer: number;     // 推理模型文本缓冲 token，默认 1024
  maxTokensCap: number;        // max_tokens 绝对上限，默认 8192
  // 记忆系统
  dualLayerMemory: boolean;
  forgettingCurve: boolean;
  memoryImportanceThreshold: number;
  maxRecallCount: number;
  // 自学习
  selfLearning: boolean;
  jargonMining: boolean;
  styleLearning: boolean;
  autoApprove: boolean;
  // 消息后处理（从 MessageProcessingConfig 融合）
  messageProcessingEnabled: boolean;
  cleanThinkingMarkers: boolean;
  blockAICliche: boolean;
  removeDuplicatePunctuation: boolean;
  normalizeWhitespace: boolean;
  enableIntercept: boolean;
  duplicateThreshold: number;
  blockDuplicate: boolean;
  blockPersonaCollapse: boolean;
  blockForbiddenViolation: boolean;
  // 输入与显示（从 UIConfig 融合）
  inputDebounce: boolean;
  inputDebounceMs: number;
  streamResponse: boolean;
}

export const DEFAULT_V2_CONFIG: V2SystemConfig = {
  pipelineEnabled: true,
  cleanMarkers: true, blockCliche: true, typoSim: true, typoProb: 4, typoCorrection: 'none',
  smartSegment: true, segmentThreshold: 20, maxSegments: 8, pairProtection: true,
  tonePolish: true, lengthRandomize: true, colloquialism: true,
  smartPunctuation: true, speakingRhythm: true, finalSanitize: true,
  thoughtChainEnabled: true, activeMetabolism: true, decayMultiplier: 1.0, toneIntensity: 50, reasoningEffort: 'none',
  jsonOutputMode: true,
  cognitiveMultiplier: 1.5, reasoningBuffer: 4096, maxTokensCap: 16384,
  dualLayerMemory: true, forgettingCurve: true, memoryImportanceThreshold: 5, maxRecallCount: 5,
  selfLearning: true, jargonMining: true, styleLearning: true, autoApprove: true,
  // 消息后处理默认值
  messageProcessingEnabled: true,
  cleanThinkingMarkers: true,
  blockAICliche: true,
  removeDuplicatePunctuation: true,
  normalizeWhitespace: true,
  enableIntercept: true,
  duplicateThreshold: 0.85,
  blockDuplicate: true,
  blockPersonaCollapse: true,
  blockForbiddenViolation: true,
  // 输入与显示默认值
  inputDebounce: false,
  inputDebounceMs: 1500,
  streamResponse: false,
};

interface ConfigState {
  platforms: PlatformConfig[];
  isLoaded: boolean;
  v2Config: V2SystemConfig;
  setV2Config: (config: Partial<V2SystemConfig>) => void;
  loadV2Config: () => void;
  setPlatformEnabled: (index: number, enabled: boolean) => void;
  setPlatformConfig: (index: number, config: Partial<PlatformConfig>) => void;
  setModelEnabled: (platformIndex: number, modelIndex: number, enabled: boolean) => void;
  toggleModelType: (platformIndex: number, modelIndex: number, type: ModelType) => void;
  setModelPinned: (platformIndex: number, modelIndex: number, pinned: boolean) => void;
  setModelType: (platformIndex: number, modelIndex: number, type: ModelType) => void;
  addModel: (platformIndex: number, model: ModelConfig) => void;
  removeModel: (platformIndex: number, modelIndex: number) => void;
  addPlatform: (platform: PlatformConfig) => void;
  removePlatform: (index: number) => void;
  setModels: (platformIndex: number, models: ModelConfig[]) => void;
  setFetchingModels: (platformIndex: number, fetching: boolean) => void;
  loadInitialConfig: () => Promise<void>;
  fetchModels: (platformIndex: number, fallbackApiKey?: string) => Promise<void>;
  getEnabledPlatforms: () => { index: number; config: PlatformConfig }[];
  getFirstEnabledChatModel: () => { platformIndex: number; config: PlatformConfig; model: ModelConfig } | null;
  getAllEnabledChatModels: () => { platformIndex: number; config: PlatformConfig; model: ModelConfig }[];
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  platforms: [...defaultPlatforms],
  isLoaded: false,
  v2Config: { ...DEFAULT_V2_CONFIG },

  setV2Config: (partial) => {
    const newConfig = { ...get().v2Config, ...partial };
    set({ v2Config: newConfig });
    try { localStorage.setItem('v2-system-config', JSON.stringify(newConfig)); } catch { /* ignore */ }
  },

  loadV2Config: () => {
    try {
      const raw = localStorage.getItem('v2-system-config');
      if (raw) set({ v2Config: { ...DEFAULT_V2_CONFIG, ...JSON.parse(raw) } });
    } catch { /* ignore */ }
  },

  loadInitialConfig: async () => {
    try {
      const stored = await loadConfig();
      if (stored) {
        stored.forEach((p) => {
          p.models.forEach((m) => {
            if (m.enabledTypes === undefined) {
              m.enabledTypes = [m.type];
            }
          });
        });
        // 🆕 预设合并：应用升级后新增的内置平台预设（如智谱AI/Kimi 等）自动补入，
        // 按 displayName 去重，不打乱用户已有平台的顺序与配置
        const knownNames = new Set(stored.map((p) => p.displayName));
        const missingPresets = defaultPlatforms.filter((p) => !knownNames.has(p.displayName));
        // 🆕 清理历史预填模型：曾内置过预设模型列表，用户要求不预配置。
        // 仅清理「未配置」（无 Key 且未启用）且模型全部命中预填名单的平台，不动用户真实配置
        const PRESET_MODEL_NAMES = new Set([
          'glm-4-plus', 'glm-4-air', 'glm-4-flash', 'glm-4v-plus',
          'kimi-latest', 'moonshot-v1-8k', 'moonshot-v1-32k',
          'qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-vl-max',
          'doubao-pro-32k', 'doubao-pro-128k',
          '4.0Ultra', 'generalv3.5',
          'ernie-4.0-8k-latest', 'ernie-3.5-8k',
          'openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-2.0-flash-001',
        ]);
        for (const p of stored) {
          if (!p.apiKey && !p.enabled && p.models.length > 0 && p.models.every((m) => PRESET_MODEL_NAMES.has(m.name))) {
            p.models = [];
          }
        }
        set({ platforms: [...stored, ...missingPresets.map((p) => ({ ...p, models: p.models.map((m) => ({ ...m })) }))], isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
      get().loadV2Config();
    } catch (e) {
      console.error('Failed to load config:', e);
      set({ isLoaded: true });
      get().loadV2Config();
    }
  },

  setPlatformEnabled: (index, enabled) => {
    set((state) => {
      const platforms = [...state.platforms];
      platforms[index] = { ...platforms[index], enabled };
      persistConfig(platforms);
      return { platforms };
    });
  },

  setPlatformConfig: (index, config) => {
    set((state) => {
      const platforms = [...state.platforms];
      platforms[index] = { ...platforms[index], ...config };
      persistConfig(platforms);
      return { platforms };
    });
  },

  setModelEnabled: (platformIndex, modelIndex, enabled) => {
    set((state) => {
      const platforms = [...state.platforms];
      const models = [...platforms[platformIndex].models];
      models[modelIndex] = { ...models[modelIndex], enabled };
      platforms[platformIndex] = { ...platforms[platformIndex], models };
      persistConfig(platforms);
      return { platforms };
    });
  },

  toggleModelType: (platformIndex: number, modelIndex: number, type: ModelType) => {
    set((state) => {
      const platforms = [...state.platforms];
      const models = [...platforms[platformIndex].models];
      const model = { ...models[modelIndex] };
      const enabledTypes = new Set(model.enabledTypes || [model.type]);
      if (enabledTypes.has(type)) {
        enabledTypes.delete(type);
      } else {
        enabledTypes.add(type);
      }
      model.enabledTypes = Array.from(enabledTypes);
      model.enabled = model.enabledTypes.length > 0;
      models[modelIndex] = model;
      platforms[platformIndex] = { ...platforms[platformIndex], models };
      persistConfig(platforms);
      return { platforms };
    });
  },

  setModelPinned: (platformIndex, modelIndex, pinned) => {
    set((state) => {
      const platforms = [...state.platforms];
      const models = [...platforms[platformIndex].models];
      models[modelIndex] = { ...models[modelIndex], pinned };
      platforms[platformIndex] = { ...platforms[platformIndex], models };
      persistConfig(platforms);
      return { platforms };
    });
  },

  setModelType: (platformIndex, modelIndex, type) => {
    set((state) => {
      const platforms = [...state.platforms];
      const models = [...platforms[platformIndex].models];
      models[modelIndex] = { ...models[modelIndex], type };
      platforms[platformIndex] = { ...platforms[platformIndex], models };
      persistConfig(platforms);
      return { platforms };
    });
  },

  addModel: (platformIndex, model) => {
    set((state) => {
      const platforms = [...state.platforms];
      const newModel = { ...model, enabledTypes: model.enabledTypes || [model.type] };
      const models = [...platforms[platformIndex].models, newModel];
      platforms[platformIndex] = { ...platforms[platformIndex], models };
      persistConfig(platforms);
      return { platforms };
    });
  },

  removeModel: (platformIndex, modelIndex) => {
    set((state) => {
      const platforms = [...state.platforms];
      const models = platforms[platformIndex].models.filter((_, i) => i !== modelIndex);
      platforms[platformIndex] = { ...platforms[platformIndex], models };
      persistConfig(platforms);
      return { platforms };
    });
  },

  addPlatform: (platform) => {
    set((state) => {
      const platforms = [...state.platforms, platform];
      persistConfig(platforms);
      return { platforms };
    });
  },

  removePlatform: (index) => {
    set((state) => {
      const platforms = state.platforms.filter((_, i) => i !== index);
      persistConfig(platforms);
      return { platforms };
    });
  },

  setModels: (platformIndex, models) => {
    set((state) => {
      const platforms = [...state.platforms];
      platforms[platformIndex] = { ...platforms[platformIndex], models };
      persistConfig(platforms);
      return { platforms };
    });
  },

  setFetchingModels: (platformIndex, fetching) => {
    set((state) => {
      const platforms = [...state.platforms];
      platforms[platformIndex] = { ...platforms[platformIndex], fetchingModels: fetching };
      return { platforms };
    });
  },

  fetchModels: (platformIndex, fallbackApiKey?: string) => {
    const state = get();
    const platform = state.platforms[platformIndex];
    const apiKey = platform.apiKey || fallbackApiKey;
    if (!apiKey) return Promise.resolve();

    const pinnedModels = platform.models.filter((m) => m.pinned);

    set((s) => {
      const platforms = [...s.platforms];
      platforms[platformIndex] = { ...platforms[platformIndex], fetchingModels: true };
      return { platforms };
    });

    const baseUrl = platform.baseUrl;

    fetch(`${baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
      .then((resp) => {
        if (!resp.ok) throw new Error('Request failed');
        return resp.json();
      })
      .then((data) => {
        const items = data.data || [];
        if (items.length === 0) throw new Error('No models');
        const fetchedModels: ModelConfig[] = items.map((m: { id: string }) => ({
          name: m.id,
          type: 'chat' as const,
          enabled: false,
          pinned: false,
          enabledTypes: [],
        }));

        const pinnedNames = new Set(pinnedModels.map((m) => m.name));
        const newModels: ModelConfig[] = [
          ...pinnedModels,
          ...fetchedModels.filter((m) => !pinnedNames.has(m.name)),
        ];

        set((s) => {
          const platforms = [...s.platforms];
          platforms[platformIndex] = { ...platforms[platformIndex], models: newModels, fetchingModels: false };
          persistConfig(platforms);
          return { platforms };
        });
      })
      .catch(() => {
        set((s) => {
          const platforms = [...s.platforms];
          platforms[platformIndex] = { ...platforms[platformIndex], fetchingModels: false };
          return { platforms };
        });
      });

    return Promise.resolve();
  },

  getEnabledPlatforms: () => {
    const { platforms } = get();
    return platforms
      .map((config, index) => ({ index, config }))
      .filter(({ config }) => config.enabled && config.apiKey);
  },

  getFirstEnabledChatModel: () => {
    const { platforms } = get();
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (!p.enabled || !p.apiKey) continue;
      const chatModel = p.models.find((m) => m.enabled && m.type === 'chat');
      if (chatModel) {
        return { platformIndex: i, config: p, model: chatModel };
      }
    }
    return null;
  },

  getAllEnabledChatModels: () => {
    const { platforms } = get();
    const result: { platformIndex: number; config: PlatformConfig; model: ModelConfig }[] = [];
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i];
      if (!p.enabled || !p.apiKey) continue;
      for (const m of p.models) {
        if (m.enabled && m.type === 'chat') {
          result.push({ platformIndex: i, config: p, model: m });
        }
      }
    }
    return result;
  },
}));
