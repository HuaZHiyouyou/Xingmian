
import { useEffect, useRef } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useIntegrationStore } from '../store/integrationStore';
import { useChatStore } from '../store/chatStore';
import { useCharacterStore } from '../store/characterStore';
import { generateId } from '../utils/chatUtils';
import { Message, MessageAttachment } from '../types';
import { saveFileToDb, isRunningInTauri } from '../lib/tauriBridge';

interface BotMessageEvent {
  integrationType: string;
  integrationId: string;
  userId: number | string;
  groupId: number | null;
  senderName: string;
  message: string;
  rawMessage: string | null;
  messageId: number | null;
  time: number | null;
  attachments?: Array<{ type: string; url: string }>;
}

const processedMessageIds = new Set<string>();
const MERGE_THRESHOLD = 150;

const BOT_DEBOUNCE_MS = 3000;
const pendingBotMessages = new Map<string, {
  timeout: ReturnType<typeof setTimeout>;
  messages: { text: string; attachments: MessageAttachment[]; timestamp: number; data: BotMessageEvent }[];
  conversationId: string;
}>();

let generation = 0;

function stripCQCodes(text: string): string {
  return text.replace(/\[CQ:[^\]]*\]/g, '').trim();
}

function stripImagePlaceholders(text: string): string {
  return text
    .replace(/🖼/g, '')
    .replace(/\[图片\]/g, '')
    .replace(/\[视频\]/g, '')
    .replace(/\[表情\]/g, '')
    .replace(/\[语音\]/g, '')
    .replace(/image\.(jpg|jpeg|png|gif|webp|bmp)/gi, '')
    .replace(/video\.(mp4|webm|ogg)/gi, '')
    .replace(/audio\.(mp3|wav|ogg)/gi, '')
    .trim();
}

export function useBotMessageHandler() {
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    const setup = async () => {
      unlistenRef.current = await listen<string>('bot-message-received', async (event) => {
        try {
          const data: BotMessageEvent = JSON.parse(event.payload);
          await handleBotMessage(data);
        } catch (e) {
          console.error('[BotHandler] Failed to process bot message:', e);
        }
      });
    };

    setup();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);
}

async function handleBotMessage(data: BotMessageEvent) {
  const dedupKey = `${data.integrationId}:${data.userId}:${data.messageId || data.time}:${data.message}`;
  if (processedMessageIds.has(dedupKey)) {
    console.log('[BotHandler] Duplicate message, skipping:', dedupKey);
    return;
  }
  processedMessageIds.add(dedupKey);
  if (processedMessageIds.size > 500) {
    const arr = Array.from(processedMessageIds);
    for (let i = 0; i < 250; i++) processedMessageIds.delete(arr[i]);
  }

  const cleanMessage = stripImagePlaceholders(stripCQCodes(data.message));
  const hasAttachments = data.attachments && data.attachments.length > 0;
  if (!cleanMessage && !hasAttachments) {
    console.log('[BotHandler] Empty message after stripping, skipping');
    return;
  }

  console.log('[BotHandler] Processing:', cleanMessage);

  const { integrations, conversations, addConversation, logBot } = useIntegrationStore.getState();

  const integration = integrations.find((i) => i.id === data.integrationId);
  if (!integration) {
    console.warn('[BotHandler] Integration not found:', data.integrationId);
    return;
  }

  const config = JSON.parse(integration.config);
  if (!config.auto_reply) {
    console.log('[BotHandler] auto_reply is disabled');
    return;
  }

  if (data.groupId) {
    if (config.group_chat_enabled === false) {
      console.log('[BotHandler] 群聊回复已关闭，跳过:', data.groupId);
      return;
    }
    if (config.blocked_groups_enabled) {
      const blockedList = (config.blocked_groups || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      if (blockedList.includes(String(data.groupId))) {
        console.log('[BotHandler] 群在黑名单中，跳过:', data.groupId);
        return;
      }
    }
    if (config.allowed_groups_enabled) {
      const allowedList = (config.allowed_groups || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      if (allowedList.length > 0 && !allowedList.includes(String(data.groupId))) {
        console.log('[BotHandler] 群不在白名单中，跳过:', data.groupId);
        return;
      }
    }
  } else {
    if (config.private_chat_enabled === false) {
      console.log('[BotHandler] 私聊回复已关闭，跳过:', data.userId);
      return;
    }
    if (config.blocked_users_enabled) {
      const blockedList = (config.blocked_users || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      if (blockedList.includes(String(data.userId))) {
        console.log('[BotHandler] 用户在黑名单中，跳过:', data.userId);
        return;
      }
    }
    if (config.allowed_users_enabled) {
      const allowedList = (config.allowed_users || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      if (allowedList.length > 0 && !allowedList.includes(String(data.userId))) {
        console.log('[BotHandler] 用户不在白名单中，跳过:', data.userId);
        return;
      }
    }
  }

  const extUserId = String(data.userId);
  let conv = conversations.find(
    (c) => c.integrationId === data.integrationId && c.externalUserId === extUserId
  );

  let conversationId: string;

  if (!conv) {
    const characterId = config.character_id || useCharacterStore.getState().selectedCharacterId || useCharacterStore.getState().characters[0]?.id || '';

    const id = generateId();
    const newConversation = {
      id,
      title: data.senderName || '外部对话',
      messages: [] as Message[],
      characterId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    useChatStore.setState((state) => ({
      conversations: [newConversation, ...state.conversations],
    }));

    conversationId = id;

    await addConversation(
      data.integrationId,
      extUserId,
      data.senderName,
      characterId,
      conversationId
    );
    await logBot(data.integrationType, `新会话: ${data.senderName}`);
  } else {
    conversationId = conv.conversationId;
  }

  await logBot(data.integrationType, `收到消息: ${data.senderName}: ${cleanMessage.slice(0, 50)}`);

  const botAttachments: MessageAttachment[] = [];
  const rawAttachments = data.attachments || [];
  for (const a of rawAttachments) {
    if (!a.url) continue;

    const attId = generateId();
    let attType: MessageAttachment['type'] = 'file';
    if (a.type === 'image') attType = 'image';
    else if (a.type === 'video') attType = 'video';
    else if (a.type === 'audio') attType = 'audio';

    let filePath = a.url;
    let fileId: string | undefined;

    // Download and save to DB
    if (isRunningInTauri()) {
      try {
        const resp = await fetch(a.url, { signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
          const blob = await resp.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const data = new Uint8Array(arrayBuffer);
          const mimeType = blob.type || (attType === 'image' ? 'image/jpeg' : attType === 'video' ? 'video/mp4' : attType === 'audio' ? 'audio/mpeg' : 'application/octet-stream');
          const ext = a.url.split('.').pop()?.split('?')[0] || 'bin';
          const filename = `${attType}_${Date.now()}.${ext}`;

          fileId = attId;
          await saveFileToDb(attId, filename, mimeType, data, undefined, conversationId);
          filePath = `db:${attId}`;
        } else {
          console.warn('[BotHandler] Download failed:', resp.status, a.url);
        }
      } catch (e) {
        console.warn('[BotHandler] Download error:', e);
      }
    }

    botAttachments.push({
      id: attId,
      type: attType,
      name: a.type || attType,
      path: filePath,
      size: 0,
      mimeType: attType === 'image' ? 'image/jpeg' : attType === 'video' ? 'video/mp4' : attType === 'audio' ? 'audio/mpeg' : 'application/octet-stream',
      fileId,
    });
  }

  const textForAI = cleanMessage || '';

  const debounceKey = `${data.integrationId}:${data.userId}`;
  const newMsg = {
    text: textForAI,
    attachments: botAttachments,
    timestamp: Date.now(),
    data,
  };

  const existing = pendingBotMessages.get(debounceKey);
  if (existing) {
    clearTimeout(existing.timeout);
    existing.messages.push(newMsg);
    existing.timeout = setTimeout(() => {
      flushPendingBotMessages(debounceKey);
    }, BOT_DEBOUNCE_MS);
    return;
  }

  const timeout = setTimeout(() => {
    flushPendingBotMessages(debounceKey);
  }, BOT_DEBOUNCE_MS);
  pendingBotMessages.set(debounceKey, { timeout, messages: [newMsg], conversationId });
}

function flushPendingBotMessages(key: string) {
  const pending = pendingBotMessages.get(key);
  if (!pending || pending.messages.length === 0) {
    pendingBotMessages.delete(key);
    return;
  }

  const combinedText = pending.messages.map(m => m.text).filter(Boolean).join('\n');
  const allAttachments = pending.messages.flatMap(m => m.attachments).filter(Boolean);
  const lastData = pending.messages[pending.messages.length - 1].data;
  const convId = pending.conversationId;

  pendingBotMessages.delete(key);

  if (!combinedText && allAttachments.length === 0) return;

  useChatStore.getState().sendMessage(
    combinedText,
    allAttachments.length > 0 ? allAttachments : undefined,
    convId
  );

  generation++;
  monitorAndReply(lastData, convId, combinedText);
}

async function logBotMsg(type: string, msg: string) {
  const { logBot } = useIntegrationStore.getState();
  await logBot(type, msg);
}

function monitorAndReply(data: BotMessageEvent, conversationId: string, userContent: string) {
  const myGeneration = generation;
  let sentMsgIds = new Set<string>();
  let checkCount = 0;

  const check = () => {
    if (generation !== myGeneration) return;

    checkCount++;

    if (checkCount > 120) {
      console.warn('[BotHandler] Timeout waiting for AI reply');
      logBotMsg(data.integrationType, `回复超时: ${data.senderName}`);
      return;
    }

    const latestConvs = useChatStore.getState().conversations;
    const conv = latestConvs.find(c => c.id === conversationId);
    if (!conv) {
      setTimeout(check, 500);
      return;
    }

    let userMsgIdx = -1;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].sender === 'user' && conv.messages[i].content === userContent) {
        userMsgIdx = i;
        break;
      }
    }
    if (userMsgIdx === -1) {
      setTimeout(check, 500);
      return;
    }

    const userMsgTimestamp = new Date(conv.messages[userMsgIdx].timestamp).getTime();

    const aiMsgs = conv.messages.filter(m => {
      if (m.sender !== 'ai') return false;
      const msgTime = new Date(m.timestamp).getTime();
      return msgTime > userMsgTimestamp;
    });

    if (aiMsgs.length === 0) {
      setTimeout(check, 500);
      return;
    }

    const lastAiMsg = aiMsgs[aiMsgs.length - 1];
    const lastAiTime = new Date(lastAiMsg.timestamp).getTime();
    const timeSinceLastAi = Date.now() - lastAiTime;
    const isRecent = timeSinceLastAi < 5000;

    const firstAiMsg = aiMsgs[0];
    const timeSinceFirstAi = Date.now() - new Date(firstAiMsg.timestamp).getTime();
    const waitedLongEnough = timeSinceFirstAi > 30000;

    if (!isRecent && !waitedLongEnough) {
      setTimeout(check, 500);
      return;
    }

    const unsentAiMsgs = aiMsgs.filter(m => !sentMsgIds.has(m.id));
    if (unsentAiMsgs.length === 0) {
      setTimeout(check, 500);
      return;
    }

    const totalChars = unsentAiMsgs.reduce((sum, m) => sum + m.content.length, 0);

    if (totalChars >= MERGE_THRESHOLD) {
      sendMergedReply(data, unsentAiMsgs);
      unsentAiMsgs.forEach(m => sentMsgIds.add(m.id));
      return;
    }

    if (isRecent) {
      for (const msg of unsentAiMsgs) {
        sendSingleReply(data, msg);
        sentMsgIds.add(msg.id);
      }
    }

    setTimeout(check, 500);
  };

  setTimeout(check, 1000);
}

async function sendMergedReply(data: BotMessageEvent, aiMsgs: Message[]) {
  const segments: string[] = [];
  for (const msg of aiMsgs) {
    segments.push(msg.content);
    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.type === 'image' && att.path) {
          if (att.path.startsWith('http://') || att.path.startsWith('https://')) {
            segments.push(`[CQ:image,file=${att.path}]`);
          }
        }
      }
    }
  }
  const fullReply = segments.join('\n');

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if (data.integrationType === 'napcat') {
      await invoke('send_bot_message', {
        integrationId: data.integrationId,
        userId: data.userId,
        message: fullReply,
      });
    } else if (data.integrationType === 'wechat') {
      await invoke('send_wechat_message', {
        integrationId: data.integrationId,
        userId: String(data.userId),
        message: fullReply,
      });
    }
    await logBotMsg(data.integrationType, `合并回复已发送: ${data.senderName} (${aiMsgs.length}段, ${fullReply.length}字)`);
  } catch (e) {
    console.error('[BotHandler] Failed to send merged reply:', e);
    await logBotMsg(data.integrationType, `回复失败: ${e}`);
  }
}

async function sendSingleReply(data: BotMessageEvent, msg: Message) {
  let parts: string[] = [];
  if (msg.content) {
    parts.push(msg.content);
  }
  if (msg.attachments) {
    for (const att of msg.attachments) {
      if (att.type === 'image' && att.path && (att.path.startsWith('http://') || att.path.startsWith('https://'))) {
        parts.push(`[CQ:image,file=${att.path}]`);
      }
    }
  }
  const text = parts.join('\n');
  if (!text) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if (data.integrationType === 'napcat') {
      await invoke('send_bot_message', {
        integrationId: data.integrationId,
        userId: data.userId,
        message: text,
      });
    } else if (data.integrationType === 'wechat') {
      await invoke('send_wechat_message', {
        integrationId: data.integrationId,
        userId: String(data.userId),
        message: text,
      });
    }
    await logBotMsg(data.integrationType, `分段回复已发送: ${data.senderName}`);
  } catch (e) {
    console.error('[BotHandler] Failed to send reply:', e);
    await logBotMsg(data.integrationType, `回复失败: ${e}`);
  }
}

