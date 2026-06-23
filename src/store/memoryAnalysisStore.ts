
import { create } from 'zustand';
import { isRunningInTauri } from '../lib/tauriBridge';

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
  autoAnalysisEnabled: true,
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

const STORAGE_KEY = 'memory-analysis-config';

interface MemoryAnalysisState {
  config: MemoryAnalysisConfig;
  isLoaded: boolean;
  lastScheduledAnalysis: number;
  updateConfig: (updates: Partial<MemoryAnalysisConfig>) => void;
  updateDetailLevel: (type: keyof MemoryAnalysisConfig['detailLevels'], level: AnalysisDetailLevel) => void;
  loadFromStorage: () => void;
  saveToStorage: () => void;
  shouldRunAnalysis: (roundCount: number, lastAnalysisTime: Date) => boolean;
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

  shouldRunAnalysis: (roundCount, lastAnalysisTime) => {
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

