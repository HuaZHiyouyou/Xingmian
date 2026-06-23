import { create } from 'zustand';
import {
  BotIntegration,
  BotConversation,
  BotIntegrationConfig,
  dbGetBotIntegrations,
  dbSaveBotIntegration,
  dbDeleteBotIntegration,
  dbGetBotConversations,
  dbSaveBotConversation,
  dbDeleteBotConversation,
  startBotIntegration,
  stopBotIntegration,
  testBotConnection,
  dbSaveDebugLogs,
} from '../lib/tauriBridge';
import { invoke } from '@tauri-apps/api/core';
import { generateId } from '../utils/chatUtils';

interface IntegrationState {
  integrations: BotIntegration[];
  conversations: BotConversation[];
  isLoaded: boolean;
  loading: boolean;

  loadIntegrations: () => Promise<void>;
  loadConversations: (integrationId?: string) => Promise<void>;
  logBot: (type: string, message: string) => Promise<void>;
  addIntegration: (type: string, config: BotIntegrationConfig) => Promise<BotIntegration>;
  updateIntegration: (id: string, updates: Partial<BotIntegration>) => Promise<void>;
  removeIntegration: (id: string) => Promise<void>;
  toggleIntegration: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<{ success: boolean; message: string }>;
  startIntegration: (id: string) => Promise<boolean>;
  stopIntegration: (id: string) => Promise<boolean>;
  addConversation: (
    integrationId: string,
    externalUserId: string,
    externalUserName: string,
    characterId: string,
    conversationId: string,
  ) => Promise<void>;
  updateConversationCharacter: (id: string, characterId: string) => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
}

export const useIntegrationStore = create<IntegrationState>((set, get) => ({
  integrations: [],
  conversations: [],
  isLoaded: false,
  loading: false,

  loadIntegrations: async () => {
    set({ loading: true });
    try {
      const integrations = await dbGetBotIntegrations();
      set({ integrations, isLoaded: true, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadConversations: async (integrationId?: string) => {
    try {
      const conversations = await dbGetBotConversations(integrationId);
      set({ conversations });
    } catch {
      // ignore
    }
  },

  logBot: async (type, message) => {
    await dbSaveDebugLogs([{
      id: generateId(),
      type: 'system',
      message: `[${type}] ${message}`,
      timestamp: new Date().toISOString(),
      characterId: '',
      conversationId: '',
    }]);
  },

  addIntegration: async (type, config) => {
    const id = generateId();
    const now = new Date().toISOString();
    const integration: BotIntegration = {
      id,
      type,
      enabled: false,
      config: JSON.stringify(config),
      createdAt: now,
      updatedAt: now,
    };
    await dbSaveBotIntegration(id, type, false, JSON.stringify(config));
    set((state) => ({
      integrations: [...state.integrations, integration],
    }));
    return integration;
  },

  updateIntegration: async (id, updates) => {
    const { integrations } = get();
    const existing = integrations.find((i) => i.id === id);
    if (!existing) return;

    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await dbSaveBotIntegration(id, updated.type, updated.enabled, updated.config);
    set((state) => ({
      integrations: state.integrations.map((i) => (i.id === id ? updated : i)),
    }));
  },

  removeIntegration: async (id) => {
    await stopBotIntegration(id);
    await dbDeleteBotIntegration(id);
    set((state) => ({
      integrations: state.integrations.filter((i) => i.id !== id),
    }));
  },

  toggleIntegration: async (id) => {
    const { integrations } = get();
    const existing = integrations.find((i) => i.id === id);
    if (!existing) return;

    const newEnabled = !existing.enabled;
    if (newEnabled) {
      await dbSaveBotIntegration(id, existing.type, true, existing.config);
      const success = await startBotIntegration(id);
      if (!success) {
        await dbSaveBotIntegration(id, existing.type, false, existing.config);
        return;
      }
    } else {
      await stopBotIntegration(id);
      await dbSaveBotIntegration(id, existing.type, false, existing.config);
    }

    set((state) => ({
      integrations: state.integrations.map((i) =>
        i.id === id ? { ...i, enabled: newEnabled, updatedAt: new Date().toISOString() } : i
      ),
    }));
  },

  startIntegration: async (id) => {
    return startBotIntegration(id);
  },

  stopIntegration: async (id) => {
    return stopBotIntegration(id);
  },

  testConnection: async (id) => {
    return testBotConnection(id);
  },

  addConversation: async (integrationId, externalUserId, externalUserName, characterId, conversationId) => {
    const id = generateId();
    const now = new Date().toISOString();
    const conversation: BotConversation = {
      id,
      integrationId,
      externalUserId,
      externalUserName,
      characterId,
      conversationId,
      createdAt: now,
      updatedAt: now,
    };
    await dbSaveBotConversation(id, integrationId, externalUserId, externalUserName, characterId, conversationId);
    set((state) => ({
      conversations: [...state.conversations, conversation],
    }));
  },

  removeConversation: async (id) => {
    await dbDeleteBotConversation(id);
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
    }));
  },

  updateConversationCharacter: async (id, characterId) => {
    const { conversations } = get();
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    await dbSaveBotConversation(id, conv.integrationId, conv.externalUserId, conv.externalUserName, characterId, conv.conversationId);
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, characterId, updatedAt: new Date().toISOString() } : c
      ),
    }));
  },
}));
