import { create } from 'zustand';
import { saveConfig, loadConfig } from './configStorage';
import { isRunningInTauri } from '../lib/tauriBridge';

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

interface ConfigState {
  platforms: PlatformConfig[];
  isLoaded: boolean;
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
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  platforms: [...defaultPlatforms],
  isLoaded: false,

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
        set({ platforms: stored, isLoaded: true });
      } else {
        set({ isLoaded: true });
      }
    } catch (e) {
      console.error('Failed to load config:', e);
      set({ isLoaded: true });
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
}));
