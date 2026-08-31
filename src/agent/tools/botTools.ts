/**
 * ============================================================
 * Agent 工具集 - Bot 指令（A4.1）
 * 外部平台（NapCat/微信）用户可通过 /指令 触发，
 * 应用内斜杠菜单自动收录（SlashCommandMenu 按工具中文名）。
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { useChatStore } from '../../store/chatStore';
import { useCharacterStore } from '../../store/characterStore';
import { useIntegrationStore } from '../../store/integrationStore';
import { useAgentStore } from '../../store/agentStore';
import { generateId } from '../../utils/chatUtils';
import { Message } from '../../types';

/**
 * Bot 指令上下文：botHandler 执行指令前设置，
 * 让指令知道"当前外部用户/群"是哪个会话。
 * 应用内斜杠调用时不设置，回退到当前会话。
 */
export interface BotCommandContext {
  integrationId: string;
  externalUserId: string;
  groupId: string | null;
  senderName: string;
}

let _botContext: BotCommandContext | null = null;

export function setBotCommandContext(ctx: BotCommandContext | null): void {
  _botContext = ctx;
}

/** 解析 Bot 当前上下文对应的会话（无上下文时回退到当前选中会话） */
function resolveBotConversation(): { conversationId: string | null; externalKey: string | null } {
  const chatStore = useChatStore.getState();
  const { conversations, currentConversationId } = chatStore;

  if (_botContext) {
    const { conversations: botConvs } = useIntegrationStore.getState();
    const externalKey = _botContext.groupId || _botContext.externalUserId;
    // 群会话按 group_id 维度隔离（群内共享一个会话），私聊按 user_id
    const mapping = botConvs.find(
      (c) => c.integrationId === _botContext!.integrationId && c.externalUserId === externalKey
    );
    if (mapping) {
      const conv = conversations.find((c) => c.id === mapping.conversationId);
      if (conv) return { conversationId: conv.id, externalKey };
    }
    return { conversationId: null, externalKey };
  }

  return { conversationId: currentConversationId || conversations[0]?.id || null, externalKey: null };
}

/** 在指定会话中追加一条 AI 消息（指令结果以 Bot 消息回复） */
function appendAiMessage(conversationId: string, content: string): void {
  const msg: Message = {
    id: generateId(),
    content,
    sender: 'ai',
    timestamp: new Date(),
  };
  useChatStore.setState((state) => ({
    conversations: state.conversations.map((c) =>
      c.id === conversationId
        ? { ...c, messages: [...c.messages, msg], updatedAt: new Date() }
        : c
    ),
  }));
}

// ===== 1. 新建对话 =====
export const botNewConversationTool: AgentTool = {
  id: 'bot_new_conversation',
  name: '新建对话',
  description: '为当前外部用户/群新建会话并更新映射（默认复用已有会话，仅此指令才主动新建）',
  category: 'chat',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const characterId =
      useCharacterStore.getState().selectedCharacterId ||
      useCharacterStore.getState().characters[0]?.id || '';

    const id = generateId();
    const now = new Date();
    const title = _botContext
      ? `${_botContext.senderName || '外部对话'} ${new Date().toLocaleDateString()}`
      : `新对话 ${now.toLocaleString()}`;

    const newConversation = {
      id,
      title,
      messages: [] as Message[],
      characterId,
      createdAt: now,
      updatedAt: now,
    };

    useChatStore.setState((state) => ({
      conversations: [newConversation, ...state.conversations],
      conversationList: [newConversation, ...state.conversationList],
      currentConversationId: id,
    }));

    // 更新接入映射（upsert）
    if (_botContext) {
      const externalKey = _botContext.groupId || _botContext.externalUserId;
      await useIntegrationStore.getState().addConversation(
        _botContext.integrationId,
        externalKey,
        _botContext.senderName,
        characterId,
        id,
      );
    }

    appendAiMessage(id, `✅ 已新建对话「${title}」`);
    return { success: true, data: { conversationId: id }, message: `已新建对话「${title}」` };
  },
};

// ===== 2. 当前会话 =====
export const botCurrentConversationTool: AgentTool = {
  id: 'bot_current_conversation',
  name: '当前会话',
  description: '查看当前会话信息（标题、消息数、创建时间）',
  category: 'chat',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const { conversationId } = resolveBotConversation();
    const conv = useChatStore.getState().conversations.find((c) => c.id === conversationId);
    if (!conv) {
      return { success: false, error: '未找到当前会话', message: '未找到当前会话' };
    }
    const info = `当前会话：${conv.title}\n消息数：${conv.messages?.length ?? 0}\n创建时间：${new Date(conv.createdAt).toLocaleString()}`;
    appendAiMessage(conv.id, `ℹ️ ${info}`);
    return {
      success: true,
      data: { id: conv.id, title: conv.title, messageCount: conv.messages?.length ?? 0 },
      message: info,
    };
  },
};

// ===== 3. 帮助 =====
export const botHelpTool: AgentTool = {
  id: 'bot_help',
  name: '帮助',
  description: '列出全部 Bot 可用指令（/指令名）',
  category: 'chat',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const tools = useAgentStore.getState().getAllTools();
    const lines = tools.map((t) => `/${t.name} —— ${t.description}`);
    const text = `可用指令：\n${lines.join('\n')}`;
    const { conversationId } = resolveBotConversation();
    if (conversationId) appendAiMessage(conversationId, text);
    return { success: true, data: lines, message: `共 ${tools.length} 个指令` };
  },
};

export const botTools: AgentTool[] = [
  botNewConversationTool,
  botCurrentConversationTool,
  botHelpTool,
];
