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
import { generateId } from '../utils/chatUtils';

interface IntegrationState {
  integrations: BotIntegration[];
  conversations: BotConversation[];
  isLoaded: boolean;
  loading: boolean;
  /** 🆕 A3: 内部加载 Promise 缓存 */
  _conversationsLoadPromise: Promise<void> | null;

  loadIntegrations: () => Promise<void>;
  loadConversations: (integrationId?: string) => Promise<void>;
  /** 🆕 A3: 确保会话映射已加载（带 Promise 缓存，botHandler 处理消息前 await，防止早到消息查不到映射误建新会话） */
  ensureConversationsLoaded: () => Promise<void>;
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
    /** 🆕 群聊会话的群ID（群会话必传，供主动回复路由） */
    externalGroupId?: string | null,
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

  // 🆕 A3: Promise 缓存，避免并发消息触发多次加载
  _conversationsLoadPromise: null as Promise<void> | null,
  ensureConversationsLoaded: async () => {
    if (!get()._conversationsLoadPromise) {
      const p = (async () => {
        if (!get().isLoaded) await get().loadIntegrations();
        await get().loadConversations();
      })();
      set({ _conversationsLoadPromise: p });
    }
    await get()._conversationsLoadPromise!;
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
    // 🆕 A3: upsert——按 (integrationId, externalUserId) 查重，存在则更新映射，避免重启后重复建会话
    const existing = get().conversations.find(
      (c) => c.integrationId === integrationId && c.externalUserId === externalUserId
    );
    const now = new Date().toISOString();
    if (existing) {
      await dbSaveBotConversation(existing.id, integrationId, externalUserId, externalUserName, characterId, conversationId);
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === existing.id
            ? { ...c, externalUserName, characterId, conversationId, updatedAt: now }
            : c
        ),
      }));
      return;
    }
    const id = generateId();
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
    await dbSaveBotConversation(id, conv.integrationId, conv.externalUserId, conv.externalUserName, characterId, conv.conversationId, conv.externalGroupId ?? null);
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, characterId, updatedAt: new Date().toISOString() } : c
      ),
    }));
  },
}));
