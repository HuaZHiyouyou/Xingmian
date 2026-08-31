/**
 * ============================================================
 * Agent 工具集 - 对话控制
 * AI 可管理对话、查看历史、清理数据
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { useChatStore } from '../../store/chatStore';
import { useMemoryStore } from '../../store/memoryStore';

// ===== 1. 列出对话 =====
export const chatListTool: AgentTool = {
  id: 'chat_list',
  name: '列出对话',
  description: '列出所有对话及其状态',
  category: 'chat',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const { conversations, currentConversationId } = useChatStore.getState();
    return {
      success: true,
      data: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        characterId: c.characterId,
        messageCount: c.messages?.length ?? 0,
        lastMessage: c.messages?.[c.messages.length - 1]?.content?.substring(0, 50),
        updatedAt: c.updatedAt ? new Date(c.updatedAt).toLocaleString() : '未知',
        selected: c.id === currentConversationId,
      })),
      message: `共 ${conversations.length} 个对话`,
    };
  },
};

// ===== 2. 查看记忆 =====
export const chatMemoryTool: AgentTool = {
  id: 'chat_memory',
  name: '查看记忆',
  description: '查看 AI 的记忆系统中的条目',
  category: 'memory',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'category',
      type: 'string',
      description: '记忆分类（不填则查看全部）',
      required: false,
    },
  ],
  execute: async (params) => {
    const store = useMemoryStore.getState();
    const allEntries = store.entries || {};
    const category = params.category as string | undefined;

    // 展平所有角色的记忆
    const flatEntries = Object.values(allEntries).flat();
    const filtered = category
      ? flatEntries.filter((m) => m.category === category)
      : flatEntries;

    return {
      success: true,
      data: filtered.slice(0, 50).map((m) => ({
        id: m.id,
        content: m.content?.substring(0, 100),
        category: m.category,
        importance: m.importance,
        createdAt: m.createdAt ? new Date(m.createdAt).toLocaleString() : '未知',
      })),
      message: `共 ${filtered.length} 条记忆${category ? ` (${category})` : ''}`,
    };
  },
};

// ===== 3. 查看对话统计 =====
export const chatStatsTool: AgentTool = {
  id: 'chat_stats',
  name: '查看统计',
  description: '查看对话系统的整体统计数据',
  category: 'chat',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const chat = useChatStore.getState();
    const memory = useMemoryStore.getState();
    const totalMessages = chat.conversations.reduce(
      (sum, c) => sum + (c.messages?.length ?? 0), 0
    );
    const totalMemories = Object.values(memory.entries || {}).reduce((sum, arr) => sum + arr.length, 0);

    return {
      success: true,
      data: {
        conversations: chat.conversations.length,
        totalMessages,
        memories: totalMemories,
        currentConversationId: chat.currentConversationId,
      },
      message: `对话统计: ${chat.conversations.length} 个对话, ${totalMessages} 条消息, ${totalMemories} 条记忆`,
    };
  },
};

export const chatTools: AgentTool[] = [
  chatListTool,
  chatMemoryTool,
  chatStatsTool,
];
