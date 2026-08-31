import { create } from 'zustand';
import {
  isRunningInTauri,
  dbGetBackups, dbCreateBackup, dbGetBackupData, dbDeleteBackup, dbPruneOldBackups,
  dbSaveConversations, dbSaveEmotionRecords, dbSaveCharacters, dbSaveMemories,
  dbSaveReflections, dbSaveMemoryEntries, dbSaveCharacterEmotions, dbSaveCharacterAffinities,
  dbSaveDeletedMemoryEntries, dbSaveModelRoles, dbSavePlatforms, dbSaveMbtiTest,
  dbSaveUserProfile,
} from '../lib/tauriBridge';
import { useChatStore } from './chatStore';
import { useCharacterStore } from './characterStore';
import { useCharacterMindStore } from './characterMindStore';
import { useMemoryStore } from './memoryStore';
import { useModelRoleStore } from './modelRoleStore';
import { useLearningStore } from './learningStore';
import { useMbtiStore } from './mbtiStore';
import { useUserProfileStore } from './userProfileStore';
import { useRecycleBinStore } from './recycleBinStore';
import { useConfigStore } from './configStore';
import { useIntegrationStore } from './integrationStore';
import type { Memory, Reflection, MemoryEntry } from '../types';

const CONFIG_KEY = 'ai-backup-config';
const LS_BACKUPS_KEY = 'ai-backups';

export interface BackupConfig {
  enabled: boolean;
  autoTimeHour: number;
  autoTimeMinute: number;
  maxBackups: number;
  debounceSeconds: number;
}

const defaultConfig: BackupConfig = {
  enabled: false,
  autoTimeHour: 3,
  autoTimeMinute: 0,
  maxBackups: 10,
  debounceSeconds: 30,
};

function loadConfig(): BackupConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...defaultConfig, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...defaultConfig };
}

function saveConfigToLs(config: BackupConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export interface BackupMeta {
  id: string;
  label: string;
  createdAt: string;
  sizeBytes: number;
}

interface BackupState {
  backups: BackupMeta[];
  config: BackupConfig;
  isLoaded: boolean;
  isCreating: boolean;
  lastScheduledDate: string;
  dataChangeTimer: ReturnType<typeof setTimeout> | null;
  scheduledTimer: ReturnType<typeof setInterval> | null;
  loadBackups: () => Promise<void>;
  loadConfig: () => void;
  updateConfig: (updates: Partial<BackupConfig>) => void;
  createBackup: (label?: string) => Promise<void>;
  restoreBackup: (backupId: string) => Promise<void>;
  /** Soft delete: remove from UI list only, data stays in DB */
  softDeleteBackup: (backupId: string) => Promise<void>;
  /** Hard delete: remove from DB entirely */
  hardDeleteBackup: (backupId: string) => Promise<void>;
  exportBackupToFile: (backupId: string) => Promise<void>;
  exportAllBackups: () => Promise<void>;
  importBackupFromFile: () => Promise<void>;
  startScheduler: () => void;
  stopScheduler: () => void;
  triggerDataChange: () => void;
  _collectAllData: () => Record<string, unknown>;
  _checkScheduledBackup: () => void;
  _pruneOldBackups: () => Promise<void>;
}

export const useBackupStore = create<BackupState>((set, get) => ({
  backups: [],
  config: loadConfig(),
  isLoaded: false,
  isCreating: false,
  lastScheduledDate: '',
  dataChangeTimer: null,
  scheduledTimer: null,

  loadBackups: async () => {
    if (isRunningInTauri()) {
      const list = await dbGetBackups();
      set({ backups: list, isLoaded: true });
    } else {
      try {
        const raw = localStorage.getItem(LS_BACKUPS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        set({
          backups: (arr as Array<{ id: string; label: string; createdAt: string; dataJson?: string }>).map((b) => ({
            id: b.id, label: b.label, createdAt: b.createdAt,
            sizeBytes: new Blob([b.dataJson || '']).size,
          })),
          isLoaded: true,
        });
      } catch { set({ backups: [], isLoaded: true }); }
    }
  },

  loadConfig: () => { set({ config: loadConfig() }); },

  updateConfig: (updates) => {
    const c = { ...get().config, ...updates };
    saveConfigToLs(c);
    set({ config: c });
  },

  createBackup: async (label?: string) => {
    if (get().isCreating) return;
    set({ isCreating: true });
    try {
      const data = get()._collectAllData();
      const dataJson = JSON.stringify(data);
      const id = 'backup-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const autoLabel = label || '自动备份 ' + new Date().toLocaleString('zh-CN');
      if (isRunningInTauri()) {
        await dbCreateBackup(id, autoLabel, dataJson);
      } else {
        const existing = JSON.parse(localStorage.getItem(LS_BACKUPS_KEY) || '[]');
        existing.unshift({ id, label: autoLabel, createdAt: new Date().toISOString(), dataJson });
        if (existing.length > get().config.maxBackups) existing.splice(get().config.maxBackups);
        localStorage.setItem(LS_BACKUPS_KEY, JSON.stringify(existing));
      }
      await get().loadBackups();
      await get()._pruneOldBackups();
    } catch (e) { console.error('[Backup] Create failed:', e); }
    finally { set({ isCreating: false }); }
  },

  restoreBackup: async (backupId: string) => {
    let dataJson: string | null = null;
    if (isRunningInTauri()) {
      dataJson = await dbGetBackupData(backupId);
    } else {
      try {
        const all = JSON.parse(localStorage.getItem(LS_BACKUPS_KEY) || '[]') as Array<{ id: string; dataJson?: string }>;
        const found = all.find((b) => b.id === backupId);
        dataJson = found?.dataJson || null;
      } catch { /* ignore */ }
    }
    if (!dataJson) return;
    const data = JSON.parse(dataJson);

    if (data.conversations) {
      useChatStore.setState({ conversations: data.conversations });
      if (isRunningInTauri()) await dbSaveConversations(data.conversations);
    }
    if (data.emotionRecords) {
      useChatStore.setState({ emotionRecords: data.emotionRecords });
      if (isRunningInTauri()) await dbSaveEmotionRecords(data.emotionRecords);
    }
    if (data.characters) {
      useCharacterStore.setState({ characters: data.characters });
      if (isRunningInTauri()) await dbSaveCharacters(data.characters);
    }
    if (data.emotionStates) {
      useCharacterMindStore.setState({ emotionStates: data.emotionStates });
      if (isRunningInTauri()) await dbSaveCharacterEmotions(data.emotionStates);
    }
    if (data.affinityStates) {
      useCharacterMindStore.setState({ affinityStates: data.affinityStates });
      if (isRunningInTauri()) await dbSaveCharacterAffinities(data.affinityStates);
    }
    if (data.memories) {
      useCharacterMindStore.setState({ memories: data.memories });
      if (isRunningInTauri()) {
        const a = Object.values(data.memories as Record<string, Memory[]>).flat();
        if (a.length > 0) await dbSaveMemories(a);
      }
    }
    if (data.reflections) {
      useCharacterMindStore.setState({ reflections: data.reflections });
      if (isRunningInTauri()) {
        const a = Object.values(data.reflections as Record<string, Reflection[]>).flat();
        if (a.length > 0) await dbSaveReflections(a);
      }
    }
    if (data.entries) {
      useMemoryStore.setState({ entries: data.entries });
      if (isRunningInTauri()) {
        const a = Object.values(data.entries as Record<string, MemoryEntry[]>).flat();
        if (a.length > 0) await dbSaveMemoryEntries(a);
      }
    }
    if (data.assignments) useModelRoleStore.setState({ assignments: data.assignments });
    if (data.segmentConfig) useModelRoleStore.setState({ segmentConfig: data.segmentConfig });
    if (data.messageProcessingConfig) useModelRoleStore.setState({ messageProcessingConfig: data.messageProcessingConfig });
    if (data.proactiveReplyConfig) useModelRoleStore.setState({ proactiveReplyConfig: data.proactiveReplyConfig });
    if (isRunningInTauri()) {
      const s = useModelRoleStore.getState();
      await dbSaveModelRoles({ assignments: s.assignments, maxRetriesPerModel: s.maxRetriesPerModel, segmentConfig: s.segmentConfig, messageProcessingConfig: s.messageProcessingConfig, proactiveReplyConfig: s.proactiveReplyConfig });
    }
    if (data.learningProfiles) {
      useLearningStore.setState({ profiles: data.learningProfiles });
    }
    if (data.deletedMemoryEntries) {
      useRecycleBinStore.setState({ entries: data.deletedMemoryEntries });
      if (isRunningInTauri()) await dbSaveDeletedMemoryEntries(data.deletedMemoryEntries);
    }
    if (data.userProfile) {
      useUserProfileStore.setState({ profile: data.userProfile });
      if (isRunningInTauri()) {
        const p = data.userProfile;
        await dbSaveUserProfile({ avatar: p.avatar || '', nickname: p.nickname || '', age: p.age || '', gender: p.gender || '', mbti: p.mbti || '', birthday: p.birthday || '', personality: p.personality || '', background: p.background || '', interests: p.interests || '', habits: p.habits || '', notes: p.notes || '' });
      }
    }
    if (data.platforms) {
      useConfigStore.setState({ platforms: data.platforms });
      if (isRunningInTauri()) await dbSavePlatforms(data.platforms);
    }
    if (data.mbtiTests) {
      useMbtiStore.setState({ history: data.mbtiTests });
      if (isRunningInTauri()) {
        for (const t of data.mbtiTests) {
          await dbSaveMbtiTest(t.id, t.typeCode, JSON.stringify(t.dimensions), t.completedAt);
        }
      }
    }
    if (data.integrations) useIntegrationStore.setState({ integrations: data.integrations });
    if (data.localStorage) {
      for (const [k, v] of Object.entries(data.localStorage)) {
        localStorage.setItem(k, v as string);
      }
    }
  },

  softDeleteBackup: async (backupId: string) => {
    // Soft delete: remove from UI list only, backup stays in DB
    set((state) => ({
      backups: state.backups.filter(b => b.id !== backupId),
    }));
  },

  hardDeleteBackup: async (backupId: string) => {
    if (isRunningInTauri()) {
      await dbDeleteBackup(backupId);
    } else {
      try {
        const all = JSON.parse(localStorage.getItem(LS_BACKUPS_KEY) || '[]');
        localStorage.setItem(LS_BACKUPS_KEY, JSON.stringify((all as Array<{ id: string }>).filter((b) => b.id !== backupId)));
      } catch { /* ignore */ }
    }
    await get().loadBackups();
  },

  exportBackupToFile: async (backupId: string) => {
    let dataJson: string | null = null;
    let label = '';
    if (isRunningInTauri()) {
      dataJson = await dbGetBackupData(backupId);
      label = get().backups.find(b => b.id === backupId)?.label || backupId;
    } else {
      try {
        const all = JSON.parse(localStorage.getItem(LS_BACKUPS_KEY) || '[]') as Array<{ id: string; dataJson?: string; label?: string }>;
        const f = all.find((b) => b.id === backupId);
        if (f) { dataJson = f.dataJson ?? null; label = f.label || backupId; }
      } catch { /* ignore */ }
    }
    if (!dataJson) return;
    const exp = { version: 1, exportedAt: new Date().toISOString(), label, data: JSON.parse(dataJson) };
    const blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'backup-' + label.replace(/[^\w\u4e00-\u9fff]/g, '_') + '-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  exportAllBackups: async () => {
    const { backups } = get();
    if (backups.length === 0) return;

    const allData: Record<string, unknown>[] = [];
    for (const backup of backups) {
      let dataJson: string | null = null;
      if (isRunningInTauri()) {
        dataJson = await dbGetBackupData(backup.id);
      } else {
        try {
          const all = JSON.parse(localStorage.getItem(LS_BACKUPS_KEY) || '[]') as Array<{ id: string; dataJson?: string }>;
          const f = all.find((b) => b.id === backup.id);
          if (f) dataJson = f.dataJson ?? null;
        } catch { /* ignore */ }
      }
      if (dataJson) {
        allData.push({ id: backup.id, label: backup.label, createdAt: backup.createdAt, sizeBytes: backup.sizeBytes, data: JSON.parse(dataJson) });
      }
    }

    const exp = { version: 1, exportedAt: new Date().toISOString(), count: allData.length, backups: allData };
    const blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'all-backups-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  importBackupFromFile: async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        const dataJson = JSON.stringify(imported.data || imported);
        const label = imported.label || '导入 ' + file.name;
        const id = 'backup-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        if (isRunningInTauri()) {
          await dbCreateBackup(id, label, dataJson);
        } else {
          const existing = JSON.parse(localStorage.getItem(LS_BACKUPS_KEY) || '[]');
          existing.unshift({ id, label, createdAt: new Date().toISOString(), dataJson });
          localStorage.setItem(LS_BACKUPS_KEY, JSON.stringify(existing));
        }
        await get().loadBackups();
      } catch (e) { console.error('[Backup] Import failed:', e); }
    };
    input.click();
  },

  startScheduler: () => {
    if (get().scheduledTimer) return;
    // 🆕 防泄漏：句柄挂 window，HMR 重建模块后先清掉旧实例的 interval
    const w = window as unknown as { __backupSchedTimer?: ReturnType<typeof setInterval> };
    if (w.__backupSchedTimer) clearInterval(w.__backupSchedTimer);
    const t = setInterval(() => { get()._checkScheduledBackup(); }, 60000);
    set({ scheduledTimer: t });
    w.__backupSchedTimer = t;
  },

  stopScheduler: () => {
    const t = get().scheduledTimer;
    if (t) { clearInterval(t); set({ scheduledTimer: null }); }
  },

  triggerDataChange: () => {
    const { config, dataChangeTimer } = get();
    if (!config.enabled) return;
    if (dataChangeTimer) clearTimeout(dataChangeTimer);
    const t = setTimeout(() => {
      get().createBackup('数据变更自动备份');
      set({ dataChangeTimer: null });
    }, config.debounceSeconds * 1000);
    set({ dataChangeTimer: t });
  },

  _collectAllData: () => {
    const cs = useChatStore.getState();
    const chs = useCharacterStore.getState();
    const ms = useCharacterMindStore.getState();
    const mes = useMemoryStore.getState();
    const mo = useModelRoleStore.getState();
    const ls = useLearningStore.getState();
    const mb = useMbtiStore.getState();
    const up = useUserProfileStore.getState();
    const rb = useRecycleBinStore.getState();
    const cf = useConfigStore.getState();
    const ig = useIntegrationStore.getState();
    const lsD: Record<string, string> = {};
    for (const k of ['ui-config', 'learning-config', 'memory-analysis-config', 'learning-profiles', 'ai-character-emotions-v2']) {
      const v = localStorage.getItem(k);
      if (v) lsD[k] = v;
    }
    return {
      version: 1, exportedAt: new Date().toISOString(),
      conversations: cs.conversations, emotionRecords: cs.emotionRecords,
      characters: chs.characters, emotionStates: ms.emotionStates,
      affinityStates: ms.affinityStates, memories: ms.memories, reflections: ms.reflections,
      entries: mes.entries, assignments: mo.assignments, segmentConfig: mo.segmentConfig,
      messageProcessingConfig: mo.messageProcessingConfig, proactiveReplyConfig: mo.proactiveReplyConfig,
      learningProfiles: ls.profiles,       mbtiTests: mb.history, userProfile: up.profile,
      deletedMemoryEntries: rb.entries, platforms: cf.platforms, integrations: ig.integrations,
      localStorage: lsD,
    };
  },

  _checkScheduledBackup: () => {
    const { config, lastScheduledDate } = get();
    if (!config.enabled) return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (today === lastScheduledDate) return;
    const cur = now.getHours() * 60 + now.getMinutes();
    const tgt = config.autoTimeHour * 60 + config.autoTimeMinute;
    if (cur >= tgt) {
      get().createBackup('定时备份 ' + today);
      set({ lastScheduledDate: today });
    }
  },

  _pruneOldBackups: async () => {
    const { config, backups } = get();
    if (backups.length <= config.maxBackups) return;
    if (isRunningInTauri()) {
      await dbPruneOldBackups(config.maxBackups);
    } else {
      try {
        const all = JSON.parse(localStorage.getItem(LS_BACKUPS_KEY) || '[]');
        if (all.length > config.maxBackups) {
          all.splice(config.maxBackups);
          localStorage.setItem(LS_BACKUPS_KEY, JSON.stringify(all));
        }
      } catch { /* ignore */ }
    }
    await get().loadBackups();
  },
}));
