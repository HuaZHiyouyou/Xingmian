
import { create } from 'zustand';

export type AnalysisDetailLevel = 'minimal' | 'standard' | 'detailed';

export interface MemoryAnalysisConfig {
  autoAnalysisEnabled: boolean;
  analysisRoundTrigger: number;
  analysisTimeTriggerMinutes: number;
  scheduledAnalysisEnabled: boolean;
  scheduledAnalysisIntervalMinutes: number;
  detailLevels: {
    thinking: AnalysisDetailLevel;
    analysis: AnalysisDetailLevel;
    reflection: AnalysisDetailLevel;
    summary: AnalysisDetailLevel;
  };
  maxEntriesPerCharacter: number;
}

const defaultConfig: MemoryAnalysisConfig = {
  // ✅ 修复"没开启却在跑总结"：后台记忆任务（提取/反思/思考/分析/总结）全是真实 API 调用，
  // 必须用户显式开启（设置 → 记忆分析设置 → 自动分析/定时分析），不得默认开启。
  // 注意：memoryTasksAllowed（chatStore）与此开关联动——全部关闭时提取/反思也一并停止。
  autoAnalysisEnabled: false,
  analysisRoundTrigger: 2,
  analysisTimeTriggerMinutes: 30,
  scheduledAnalysisEnabled: false,
  scheduledAnalysisIntervalMinutes: 60,
  detailLevels: {
    thinking: 'standard',
    analysis: 'standard',
    reflection: 'standard',
    summary: 'minimal',
  },
  maxEntriesPerCharacter: 200,
};

// v2：旧 key 下持久化的配置携带旧默认值 autoAnalysisEnabled:true（随 updateConfig/recordAnalysisRun
// 整包落盘），改默认值后会被旧数据覆盖回去，故升 key 强制重置为新默认（用户需在设置页重新开启）。
const STORAGE_KEY = 'memory-analysis-config:v2';

interface MemoryAnalysisState {
  config: MemoryAnalysisConfig;
  isLoaded: boolean;
  lastScheduledAnalysis: number;
  updateConfig: (updates: Partial<MemoryAnalysisConfig>) => void;
  updateDetailLevel: (type: keyof MemoryAnalysisConfig['detailLevels'], level: AnalysisDetailLevel) => void;
  loadFromStorage: () => void;
  saveToStorage: () => void;
  shouldRunAnalysis: (roundCount: number) => boolean;
  recordAnalysisRun: () => void;
}

export const useMemoryAnalysisStore = create<MemoryAnalysisState>((set, get) => ({
  config: defaultConfig,
  isLoaded: false,
  lastScheduledAnalysis: 0,

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        set({
          config: { ...defaultConfig, ...data.config },
          lastScheduledAnalysis: data.lastScheduledAnalysis || 0,
          isLoaded: true,
        });
        return;
      }
    } catch { /* ignore */ }
    set({ isLoaded: true });
  },

  saveToStorage: () => {
    const { config, lastScheduledAnalysis } = get();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, lastScheduledAnalysis }));
  },

  updateConfig: (updates) => {
    set((state) => ({
      config: { ...state.config, ...updates },
    }));
    get().saveToStorage();
  },

  updateDetailLevel: (type, level) => {
    set((state) => ({
      config: {
        ...state.config,
        detailLevels: { ...state.config.detailLevels, [type]: level },
      },
    }));
    get().saveToStorage();
  },

  shouldRunAnalysis: (roundCount) => {
    const { config, lastScheduledAnalysis } = get();
    const now = Date.now();

    if (config.autoAnalysisEnabled && roundCount > 0 && roundCount % config.analysisRoundTrigger === 0) {
      return true;
    }

    if (config.scheduledAnalysisEnabled) {
      const timeSinceLastAnalysis = (now - lastScheduledAnalysis) / 60000;
      if (timeSinceLastAnalysis >= config.scheduledAnalysisIntervalMinutes) {
        return true;
      }
    }

    return false;
  },

  recordAnalysisRun: () => {
    set({ lastScheduledAnalysis: Date.now() });
    get().saveToStorage();
  },
}));

export const DETAIL_LEVEL_OPTIONS: { value: AnalysisDetailLevel; label: string; desc: string }[] = [
  { value: 'minimal', label: '精简', desc: '核心要点' },
  { value: 'standard', label: '标准', desc: '适中详细度' },
  { value: 'detailed', label: '详细', desc: '全面分析' },
];

