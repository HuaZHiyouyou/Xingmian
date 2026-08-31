
import { create } from 'zustand';

export interface LearningConfig {
  enabled: boolean;
  roundTrigger: number;
  scheduledEnabled: boolean;
  scheduledIntervalMinutes: number;
  startTimeEnabled: boolean;
  scheduledStartTime: string;
  maxVocabulary: number;
  maxPhrases: number;
  maxMessages: number;
}

const defaultConfig: LearningConfig = {
  enabled: true,
  roundTrigger: 5,
  scheduledEnabled: false,
  scheduledIntervalMinutes: 60,
  startTimeEnabled: false,
  scheduledStartTime: '08:00',
  maxVocabulary: 200,
  maxPhrases: 100,
  maxMessages: 50,
};

const STORAGE_KEY = 'learning-config';

interface LearningConfigState {
  config: LearningConfig;
  isLoaded: boolean;
  lastScheduledRun: number;
  lastRoundTriggerCount: number;
  updateConfig: (updates: Partial<LearningConfig>) => void;
  loadFromStorage: () => void;
  saveToStorage: () => void;
  shouldRun: (roundCount: number) => boolean;
  recordRun: (roundCount: number) => void;
}

export const useLearningConfigStore = create<LearningConfigState>((set, get) => ({
  config: defaultConfig,
  isLoaded: false,
  lastScheduledRun: 0,
  lastRoundTriggerCount: 0,

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        set({
          config: { ...defaultConfig, ...data.config },
          lastScheduledRun: data.lastScheduledRun || 0,
          lastRoundTriggerCount: data.lastRoundTriggerCount || 0,
          isLoaded: true,
        });
        return;
      }
    } catch { /* ignore */ }
    set({ isLoaded: true });
  },

  saveToStorage: () => {
    const { config, lastScheduledRun, lastRoundTriggerCount } = get();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, lastScheduledRun, lastRoundTriggerCount }));
  },

  updateConfig: (updates) => {
    set((state) => ({
      config: { ...state.config, ...updates },
    }));
    get().saveToStorage();
  },

  shouldRun: (roundCount) => {
    const { config, lastScheduledRun, lastRoundTriggerCount } = get();
    const now = Date.now();

    if (config.enabled && roundCount > 0 && roundCount - lastRoundTriggerCount >= config.roundTrigger) {
      return true;
    }

    if (config.scheduledEnabled) {
      const minutesSinceLast = (now - lastScheduledRun) / 60000;
      if (minutesSinceLast < config.scheduledIntervalMinutes) {
        return false;
      }

      if (config.startTimeEnabled) {
        const [startHour, startMinute] = config.scheduledStartTime.split(':').map(Number);
        const currentDate = new Date(now);
        const startTime = new Date(currentDate);
        startTime.setHours(startHour, startMinute, 0, 0);
        
        if (now < startTime.getTime()) {
          return false;
        }
      }

      return true;
    }

    return false;
  },

  recordRun: (roundCount: number) => {
    set({
      lastScheduledRun: Date.now(),
      lastRoundTriggerCount: roundCount,
    });
    get().saveToStorage();
  },
}));
