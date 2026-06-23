import { create } from 'zustand';
import { useCharacterStore } from './characterStore';
import { useChatStore } from './chatStore';
import { useCharacterMindStore } from './characterMindStore';
import { useMemoryStore } from './memoryStore';
import { useModelRoleStore } from './modelRoleStore';
import { useUserProfileStore } from './userProfileStore';
import { useLearningStore } from './learningStore';
import { callAI, getSystemPrompt, selectRelevantMemories, extractMemories, analyzeCharacterEmotion, generateReflection, analyzeAffinityChange, getAdaptiveTemperature, getDiversityPrompt, isDuplicate, containsAICliche, detectPersonaCollapse, addMemoryEmbeddings, generateEmbedding, vectorSearchMemories } from '../services/aiService';
import { getFileDataOnly } from '../lib/tauriBridge';
import { OutputPipeline, PipelineContext } from '../services/outputPipeline';
import { generateId } from '../utils/chatUtils';
import type { Message, EmotionType, AffinityStage, MemoryEntry } from '../types';
import { getSegmentedConfig } from './chatStore';

function getAdaptiveMaxTokens(conversationLength: number): number {
  if (conversationLength < 5) return 400;
  if (conversationLength < 20) return 600;
  if (conversationLength < 50) return 800;
  return 1000;
}

interface ProactiveReplyState {
  lastProactiveTime: Record<string, number>;
  scheduledCountToday: number;
  lastCountResetDate: string;
  lastScheduledTracked: string[];
  isSending: boolean;
  schedulerTimer: ReturnType<typeof setInterval> | null;
  lastConfigChangeTime: number;

  triggerProactiveAfterReply: (characterId: string, conversationId: string) => Promise<void>;
  sendScheduledReply: () => Promise<void>;
  checkScheduledTrigger: () => void;
  markConfigChanged: () => void;
  startScheduler: () => void;
  stopScheduler: () => void;
}

/**
 * Build message content with attachment support (same logic as chatStore.sendMessage).
 */
async function buildMessageContent(msg: Message): Promise<string | Array<{ type: string; text?: string; image_url?: { url: string } }>> {
  try {
    if (msg.sender === 'ai' || !msg.attachments || msg.attachments.length === 0) {
      return msg.content;
    }
    const imageAtts = msg.attachments.filter(a => a.type === 'image');
    if (imageAtts.length === 0) return msg.content;

    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    parts.push({ type: 'text', text: msg.content || '(用户发送了图片)' });

    for (const att of imageAtts) {
      let dataUrl = '';

      // Priority 1: DB-backed file
      const dbId = att.fileId || (att.path.startsWith('db:') ? att.id : undefined);
      if (dbId) {
        try {
          const b64 = await getFileDataOnly(dbId);
          if (b64) dataUrl = `data:${att.mimeType || 'image/jpeg'};base64,${b64}`;
        } catch { /* fall through */ }
      }

      // Priority 2: Direct URL
      if (!dataUrl && (att.path.startsWith('http://') || att.path.startsWith('https://') || att.path.startsWith('data:') || att.path.startsWith('blob:'))) {
        dataUrl = att.path;
      }

      if (dataUrl) parts.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
    if (parts.length === 0) return msg.content || '(用户发送了图片)';
    return parts;
  } catch {
    return msg.content || '(用户发送了图片)';
  }
}

async function sendProactiveMessage(
  characterId: string,
  conversationId: string,
  proactiveSuffix: string,
  triggerMessage: string,
): Promise<boolean> {
  const characters = useCharacterStore.getState().characters;
  const character = characters.find(c => c.id === characterId);
  if (!character) return false;

  const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
  if (!conversation) return false;

  const convMsgs = conversation.messages || [];
  const convLen = convMsgs.length;
  const config = getConfig();

  // Build messages with full attachment support (same as sendMessage)
  const messages = (await Promise.all(
    convMsgs.map(async (msg) => ({
      role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
      content: await buildMessageContent(msg),
    }))
  )).filter(m => {
    if (typeof m.content === 'string') return m.content.trim().length > 0;
    if (Array.isArray(m.content)) return m.content.some(p => p.type === 'text' && p.text?.trim());
    return true;
  });

  // Add trigger message as a user message
  messages.push({ role: 'user' as const, content: triggerMessage });

  const mindStore = useCharacterMindStore.getState();
  const memories = mindStore.getMemories(characterId);
  const reflections = mindStore.getReflections(characterId);
  const charEmotion = mindStore.getEmotion(characterId);
  const memoryEntries = useMemoryStore.getState().getEntries(characterId);
  const affinityState = mindStore.getAffinity(characterId);
  const affinityStage: AffinityStage | undefined = affinityState?.stage;

  // --- Memory relevance filtering (same as sendMessage) ---
  let relevantMemories = selectRelevantMemories(memories, triggerMessage, 3);

  // Vector search (non-blocking)
  if (config?.apiKey && memories.length > 0) {
    addMemoryEmbeddings(characterId, memories).catch(() => {});
    generateEmbedding(triggerMessage).then(queryEmb => {
      if (queryEmb) {
        const vecResults = vectorSearchMemories(characterId, queryEmb, 3, memories);
        if (vecResults.length > 0) relevantMemories = vecResults;
      }
    }).catch(() => {});
  }

  const reanchorPrompt = (convLen > 0 && convLen % 15 === 0)
    ? `\n\n[提醒] ${convLen}轮对话过去了，请确认你仍然是${character.name}，保持${character.personality}的性格底色。不要因为对话变长而改变自己的本质。`
    : '';

  const diversityPrompt = getDiversityPrompt(convLen);
  const multiEmotionState = useCharacterMindStore.getState().getMultiEmotion(characterId);

  const systemPrompt = getSystemPrompt(character, relevantMemories, reflections, charEmotion, memoryEntries, affinityStage, multiEmotionState)
    + reanchorPrompt + diversityPrompt
    + useUserProfileStore.getState().getUserPrompt()
    + proactiveSuffix;

  // Inject memories into messages (same as sendMessage)
  const messagesWithMemory = [...messages];
  if (relevantMemories.length > 0) {
    const memoryText = relevantMemories.map(m => `之前聊过：${m.content}`).join('\n');
    messagesWithMemory.unshift({ role: 'assistant' as const, content: memoryText });
  }
  if (reflections.length > 0) {
    messagesWithMemory.unshift({ role: 'assistant' as const, content: `我之前想过：${reflections[0].insight}` });
  }

  const temperature = getAdaptiveTemperature(convLen);
  let aiReply = await callAI(messagesWithMemory, systemPrompt, getAdaptiveMaxTokens(convLen), temperature);

  if (!aiReply || aiReply.trim().length === 0) return false;

  // Apply message processing (same logic as chatStore)
  const { messageProcessingConfig } = useModelRoleStore.getState();
  if (messageProcessingConfig?.enabled) {
    const { processMessageText } = await import('../utils/segmentUtils');
    aiReply = processMessageText(aiReply, messageProcessingConfig);
  }

  // Duplication and quality checks
  const recentAiReplies = convMsgs.filter(m => m.sender === 'ai').slice(-5).map(m => m.content);
  const isDup = isDuplicate(aiReply, recentAiReplies);
  const hasCliche = containsAICliche(aiReply);
  const hasCollapse = detectPersonaCollapse(aiReply);
  if (isDup || hasCliche || hasCollapse) return false;

  // Output pipeline (same as sendMessage)
  const pipelineCtx: PipelineContext = {
    rawText: aiReply,
    processedText: aiReply,
    emotion: { type: charEmotion.emotion, intensity: charEmotion.intensity },
    recentReplies: recentAiReplies,
    userInput: triggerMessage,
    affinityStage: affinityStage || 'stranger',
    forbiddenText: character.forbiddenBehaviors,
    interceptConfig: messageProcessingConfig,
  };

  const pipeline = new OutputPipeline();
  const pipelineResult = pipeline.run(pipelineCtx);
  if (pipelineResult.aborted) return false;

  const finalText = pipelineResult.text || aiReply;
  const segments = pipelineResult.segments;
  const segConfig = getSegmentedConfig();
  const baseTime = new Date();

  // Send message (support segmented replies)
  if (segments && segments.length > 1) {
    const firstMsg: Message = {
      id: generateId(),
      content: segments[0],
      sender: 'ai',
      timestamp: baseTime,
      emotion: 'neutral',
    };

    useChatStore.setState((state) => ({
      conversations: state.conversations.map(c =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, firstMsg], updatedAt: new Date() }
          : c
      ),
    }));

    for (let i = 1; i < segments.length; i++) {
      await new Promise(resolve => setTimeout(resolve, segConfig.delay));
      const segMsg: Message = {
        id: generateId(),
        content: segments[i],
        sender: 'ai',
        timestamp: new Date(),
        emotion: 'neutral',
      };
      useChatStore.setState((state) => ({
        conversations: state.conversations.map(c =>
          c.id === conversationId
            ? { ...c, messages: [...c.messages, segMsg], updatedAt: new Date() }
            : c
        ),
      }));
    }
  } else {
    const aiMsg: Message = {
      id: generateId(),
      content: finalText,
      sender: 'ai',
      timestamp: baseTime,
      emotion: 'neutral',
    };
    useChatStore.setState((state) => ({
      conversations: state.conversations.map(c =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, aiMsg], updatedAt: new Date() }
          : c
      ),
    }));
  }

  // Post-reply processing (same as sendMessage)
  const allMsgsText = [...convMsgs.map(msg => ({
    role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
    content: msg.content,
  })), { role: 'assistant' as const, content: finalText }];

  extractMemories(allMsgsText, memories, characterId, conversationId, character.memoryImportanceThreshold)
    .then(newMemories => {
      if (newMemories.length > 0) {
        useCharacterMindStore.getState().addMemories(characterId, newMemories);
      }
    }).catch(() => {});

  analyzeCharacterEmotion(allMsgsText, character.personality, charEmotion.emotion)
    .then(result => {
      useCharacterMindStore.getState().updateEmotion(characterId, result.emotion, result.intensity);
      useCharacterMindStore.getState().updateMultiEmotion(characterId, result.emotion, result.intensity);
    }).catch(() => {});

  const currentAffinity = mindStore.getAffinity(characterId);
  analyzeAffinityChange(allMsgsText, character.personality, currentAffinity.level, character.affinityRate || 0.5)
    .then(result => {
      useCharacterMindStore.getState().updateAffinity(characterId, result.delta, result.reason, charEmotion.emotion);
    }).catch(() => {});

  if (character.reflectionEnabled) {
    const emotionHistory = [charEmotion.emotion, ...convMsgs.slice(-6).map(m => m.emotion || 'neutral' as EmotionType)]
      .filter(Boolean)
      .map((e, i) => ({ emotion: e as EmotionType, trigger: i === 0 ? '用户最新消息' : '对话进行中' }));
    generateReflection(allMsgsText, character.name, character.personality, emotionHistory)
      .then(result => {
        if (result) {
          useCharacterMindStore.getState().addReflection(characterId, {
            id: generateId(),
            characterId,
            trigger: result.trigger,
            insight: result.insight,
            emotionBefore: result.emotionBefore,
            emotionAfter: result.emotionAfter,
            createdAt: new Date(),
          });
        }
      }).catch(() => {});
  }

  return true;
}

function getConfig() {
  try {
    const stored = localStorage.getItem('ai-config');
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return { apiKey: '' };
}

export const useProactiveReplyStore = create<ProactiveReplyState>((set, get) => ({
  lastProactiveTime: {},
  scheduledCountToday: 0,
  lastCountResetDate: '',
  lastScheduledTracked: [],
  isSending: false,
  schedulerTimer: null,
  lastConfigChangeTime: 0,

  triggerProactiveAfterReply: async (characterId: string, conversationId: string) => {
    if (get().isSending) return;

    const config = useModelRoleStore.getState().proactiveReplyConfig;
    if (!config.enabled || !config.proactiveEnabled) return;

    if (Math.random() * 100 > config.proactiveChance) return;

    const lastTime = get().lastProactiveTime[characterId] || 0;
    const secondsSince = (Date.now() - lastTime) / 1000;
    if (secondsSince < config.proactiveDelayMs / 1000) return;

    set({ isSending: true });
    try {
      const customPrompt = config.customPrompt ? '\n\n' + config.customPrompt : '';
      const proactiveSuffix = [
        customPrompt,
        '\n\n[系统提示] 你刚刚回复了用户，现在想要主动延续对话。',
        '结合你们之前的对话内容和你对用户的记忆，延续刚才的话题。',
        '可以是：补充想法、追问、关心对方、分享延伸话题等。',
        '保持你的角色设定，表现自然，不要提到这是"主动消息"。',
      ].join('');

      const sent = await sendProactiveMessage(characterId, conversationId, proactiveSuffix, '[你刚刚回复了用户，想要主动延续对话]');

      if (sent) {
        set((state) => ({
          lastProactiveTime: { ...state.lastProactiveTime, [characterId]: Date.now() },
        }));
      }
    } catch (e) {
      console.error('[ProactiveReply] Failed:', e);
    } finally {
      set({ isSending: false });
    }
  },

  sendScheduledReply: async () => {
    if (get().isSending) return;

    const config = useModelRoleStore.getState().proactiveReplyConfig;
    if (!config.enabled || !config.scheduledEnabled) return;

    const selectedCharId = useCharacterStore.getState().selectedCharacterId;
    if (!selectedCharId) return;

    const today = new Date().toISOString().slice(0, 10);
    if (get().lastCountResetDate !== today) {
      set({ scheduledCountToday: 0, lastCountResetDate: today, lastScheduledTracked: [] });
    }
    // 0 = unlimited
    if (config.scheduledMaxPerDay > 0 && get().scheduledCountToday >= config.scheduledMaxPerDay) return;

    if (Math.random() * 100 > config.scheduledChance) return;

    set({ isSending: true });
    try {
      const conversations = useChatStore.getState().conversations;

      let targetConv = config.conversationId
        ? conversations.find(c => c.id === config.conversationId && c.characterId === selectedCharId)
        : undefined;

      if (!targetConv) {
        targetConv = conversations
          .filter(c => c.characterId === selectedCharId)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
      }

      if (!targetConv) {
        const convId = useChatStore.getState().createNewConversation(selectedCharId);
        targetConv = useChatStore.getState().conversations.find(c => c.id === convId);
        if (!targetConv) return;
      }

      const customPrompt = config.customPrompt ? '\n\n' + config.customPrompt : '';
      const scheduledSuffix = [
        customPrompt,
        '\n\n[系统提示] 你正在定时主动联系用户。',
        '根据你对用户的了解和记忆，以及你们之前的对话，选择一个自然的话题发起对话。',
        '可以是：关心对方、分享想法、提问、或者任何你觉得自然的开场白。',
        '保持你的角色设定，表现自然，不要提到这是"主动消息"。',
      ].join('');

      const sent = await sendProactiveMessage(selectedCharId, targetConv.id, scheduledSuffix, '[你想要主动找用户聊天]');

      if (sent) {
        set((state) => ({
          scheduledCountToday: state.scheduledCountToday + 1,
        }));
      }
    } catch (e) {
      console.error('[ScheduledReply] Failed:', e);
    } finally {
      set({ isSending: false });
    }
  },

  checkScheduledTrigger: () => {
    const config = useModelRoleStore.getState().proactiveReplyConfig;
    if (!config.enabled || !config.scheduledEnabled) return;
    if (!useCharacterStore.getState().selectedCharacterId) return;
    if (get().isSending) return;

    if (Date.now() - get().lastConfigChangeTime < 5000) return;

    const now = new Date();
    const currentHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    if (config.scheduledTimes.length > 0 && config.scheduledTimes.includes(currentHHMM)) {
      const tracked = get().lastScheduledTracked;
      const today = now.toISOString().slice(0, 10);
      const key = today + '-' + currentHHMM;
      if (!tracked.includes(key)) {
        set({ lastScheduledTracked: [...tracked, key] });
        get().sendScheduledReply();
      }
    }
  },

  markConfigChanged: () => {
    set({ lastConfigChangeTime: Date.now() });
  },

  startScheduler: () => {
    if (get().schedulerTimer) return;
    const timer = setInterval(() => { get().checkScheduledTrigger(); }, 60000);
    set({ schedulerTimer: timer });
  },

  stopScheduler: () => {
    const t = get().schedulerTimer;
    if (t) { clearInterval(t); set({ schedulerTimer: null }); }
  },
}));
