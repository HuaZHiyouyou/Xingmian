import { create } from 'zustand';
import { useModelRoleStore } from './modelRoleStore';
import { useCharacterStore } from './characterStore';
import { useChatStore } from './chatStore';
import { useCharacterMindStore } from './characterMindStore';
import { useUserProfileStore } from './userProfileStore';
import { useDebugLog } from './debugLogStore';
import { callAI, getSystemPrompt, isDuplicate, containsAICliche, detectPersonaCollapse, getRetryTemperature, getAntiRepeatBreakPrompt, getDiversityPrompt, getAdaptiveTemperature } from '../services/aiService';
import { runPipelineV2, PipelineContext } from '../services/outputPipeline';
import { retrieveRelevantMemories, buildMemoryPromptV2, convertToCoreMemory } from '../services/memory/memorySystemV2';
import { useConfigStore } from './configStore';
import { generateId } from '../utils/chatUtils';
import { checkGate, recordSent } from '../services/proactive/intentGate';
import type { Message, AffinityStage } from '../types';

// Callback keywords that trigger follow-up timers
const CALLBACK_KEYWORDS = [
  '去开会', '开会', '去上班', '下班', '去吃饭', '吃饭',
  '去休息', '休息一下', '去睡', '睡觉', '去洗澡', '洗澡',
  '出门', '出去', '去忙', '忙去了', '等一下', '等会',
  '去学校', '上课', '下课', '去运动', '运动',
];

/** 🆕 A3: 否定前置词——关键词紧邻这些词结尾时视为否定语境，不触发回访（"没吃饭""不用去开会""别出门"） */
const NEGATION_TAIL = /(没|没有|不用|不|别|先别|还没|暂时不|不想|不去)$/;

/** 🆕 A3: 模糊词——仅当位于句尾或后跟标点时才触发（排除"等一下看你发的"这类半句） */
const VAGUE_KEYWORDS = new Set(['等一下', '等会', '休息一下']);

/**
 * 🆕 A3: 回访关键词匹配（替代裸 includes）：
 * 1. 否定语境排除——"没/不/别"等紧邻关键词前面时不触发；
 * 2. 模糊词位置约束——"等一下"类必须位于句尾或后接标点/空白；
 * 正例："去洗澡了""去开会""等一下哈~"（后跟语气字仍算句尾流出? 不，语气字前无标点不算——保守起见仅句尾与标点）。
 */
export function matchCallbackKeyword(message: string): string | null {
  const text = (message || '').trim();
  if (!text) return null;
  for (const kw of CALLBACK_KEYWORDS) {
    let idx = text.indexOf(kw);
    while (idx !== -1) {
      const before = text.slice(0, idx);
      const after = text.slice(idx + kw.length);
      // 否定语境：关键词前的文本以否定词结尾
      if (NEGATION_TAIL.test(before)) {
        idx = text.indexOf(kw, idx + 1);
        continue;
      }
      // 模糊词位置约束：句尾 或 后跟标点/空白
      if (VAGUE_KEYWORDS.has(kw)) {
        const okPos = after.length === 0 || /^[，。！？、,.!?~…\s]/.test(after);
        if (!okPos) {
          idx = text.indexOf(kw, idx + 1);
          continue;
        }
      }
      return kw;
    }
  }
  return null;
}

interface ChainProactiveState {
  // Chain timer
  chainTimerId: ReturnType<typeof setTimeout> | null;
  nextChainTime: number;
  lastChainTrigger: number;
  // Callback timers
  callbackTimers: Map<string, ReturnType<typeof setTimeout>>;
  // Status
  isActive: boolean;
  lastError: string | null;
  // Actions
  startChain: () => void;
  stopChain: () => void;
  addCallbackTimer: (conversationId: string, delayMinutes: number, context: string) => void;
  cancelCallbackTimer: (conversationId: string) => void;
  triggerChainCheck: () => Promise<void>;
  triggerCallback: (conversationId: string, context: string) => Promise<void>;
}

function isNightTime(nightStart: string, nightEnd: string): boolean {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = nightStart.split(':').map(Number);
  const [endH, endM] = nightEnd.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Night crosses midnight
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

function calculateDelay(config: {
  dayMinMinutes: number;
  dayMaxMinutes: number;
  nightMinMinutes: number;
  nightMaxMinutes: number;
  nightStart: string;
  nightEnd: string;
  randomFactor: number;
}): number {
  const night = isNightTime(config.nightStart, config.nightEnd);
  const min = night ? config.nightMinMinutes : config.dayMinMinutes;
  const max = night ? config.nightMaxMinutes : config.dayMaxMinutes;

  const base = min + Math.random() * (max - min);
  const randomOffset = base * (config.randomFactor / 100) * (Math.random() - 0.5);
  return Math.round((base + randomOffset) * 60 * 1000); // Convert to ms
}

async function sendChainMessage(
  characterId: string,
  conversationId: string,
  _triggerType: 'chain' | 'callback',
  context: string,
): Promise<boolean> {
  const characters = useCharacterStore.getState().characters;
  const character = characters.find(c => c.id === characterId);
  if (!character) return false;

  const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
  if (!conversation) return false;

  const convMsgs = conversation.messages || [];
  const convLen = convMsgs.length;

  const messages = (await Promise.all(
    convMsgs.map(async (msg) => ({
      role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
      content: msg.content,
    }))
  )).filter(m => m.content && m.content.trim().length > 0);

  const mindStore = useCharacterMindStore.getState();
  const memories = mindStore.getMemories(characterId);
  const charEmotion = mindStore.getEmotion(characterId);
  const affinityState = mindStore.getAffinity(characterId);
  const affinityStage: AffinityStage | undefined = affinityState?.stage;

  // V2: 双层记忆检索 + 记忆Prompt生成
  let memoryPromptV2 = '';
  const v2MemorySettings = useConfigStore.getState().v2Config;
  const dualLayerEnabled = v2MemorySettings.dualLayerMemory !== false;
  const maxRecall = v2MemorySettings.maxRecallCount ?? 5;

  if (dualLayerEnabled) {
    try {
      const coreMems = mindStore.getCoreMemories(characterId);
      const episodicMems = mindStore.getEpisodicMemories(characterId);

      const hasV2Memories = coreMems.length > 0 || episodicMems.length > 0;

      if (hasV2Memories) {
        const v2Result = retrieveRelevantMemories({
          userMessage: context,
          userEmotion: charEmotion?.emotion,
          coreMemories: coreMems,
          episodicMemories: episodicMems,
          maxResults: maxRecall,
        });
        memoryPromptV2 = buildMemoryPromptV2(v2Result, dualLayerEnabled && v2MemorySettings.forgettingCurve !== false);
      } else {
        const coreMemoriesV2 = memories.map(m => convertToCoreMemory(m, characterId));
        const fallbackResult = retrieveRelevantMemories({
          userMessage: context,
          userEmotion: charEmotion?.emotion,
          coreMemories: coreMemoriesV2,
          episodicMemories: [],
          maxResults: maxRecall,
        });
        if (fallbackResult.core.length > 0) {
          memoryPromptV2 = buildMemoryPromptV2(fallbackResult, dualLayerEnabled && v2MemorySettings.forgettingCurve !== false);
        }
      }
    } catch {
      // 静默失败，不影响主流程
    }
  }

  const config = useModelRoleStore.getState().chainProactiveConfig;

  let systemPrompt = getSystemPrompt(character, [], [], charEmotion, [], affinityStage)
    + getDiversityPrompt(convLen)
    + useUserProfileStore.getState().getUserPrompt()
    + memoryPromptV2
    + `\n\n[主动消息] 你是${character.name}，现在主动找用户聊天。`;
  if (config.customPrompt) {
    systemPrompt = systemPrompt + '\n\n' + config.customPrompt;
  }

  // 🆕 情境并入 system prompt，不再伪装成用户消息——
  // 此前内部指令被当作最后一条 user 消息，模型会复读预制措辞（"你醒了吗"式突兀问候的根因之一）
  systemPrompt = systemPrompt + '\n\n' + context;

  const temperature = getAdaptiveTemperature(convLen, context, 'anticipation');

  // 复读检测：取最近5条AI回复
  const recentAiReplies = convMsgs.filter(m => m.sender === 'ai').slice(-5).map(m => m.content);

  // 重试机制：首次 + 最多1次重试（加温+破局指令）
  let aiReply = '';
  let chainAttempt = 0;
  const maxChainRetries = 1;
  let chainTemp = temperature;
  let chainPrompt = systemPrompt;
   
  while (true) {
    aiReply = await callAI(messages, chainPrompt, 800, chainTemp);
    chainAttempt++;

    // 🆕 A2: NO_REPLY 裁决——模型按指令表示"本轮不发言"时安静退出，
    //    此前该字面量会穿透所有校验被当作正常消息发给用户
    if (aiReply && aiReply.trim().toUpperCase().startsWith('NO_REPLY')) {
      useDebugLog.getState().add('intercept', '[链式主动] 模型判断本轮不发言（NO_REPLY）', { characterId, conversationId });
      return false;
    }

    if (!aiReply || aiReply.trim().length === 0) {
      if (chainAttempt <= maxChainRetries) {
        chainTemp = getRetryTemperature(temperature, chainAttempt);
        chainPrompt = systemPrompt + getAntiRepeatBreakPrompt(chainAttempt);
        continue;
      }
      return false;
    }

    // 复读/客服腔/人设崩塌检测
    const isDup = isDuplicate(aiReply, recentAiReplies);
    const hasCliche = containsAICliche(aiReply);
    const hasCollapse = detectPersonaCollapse(aiReply);
    if ((isDup || hasCliche || hasCollapse) && chainAttempt <= maxChainRetries) {
      useDebugLog.getState().add('intercept', `[链式主动] 第${chainAttempt}次拦截(${isDup ? '复读' : hasCliche ? '客服腔' : '人设崩塌'}), 重试中...`, { characterId, conversationId });
      chainTemp = getRetryTemperature(temperature, chainAttempt);
      chainPrompt = systemPrompt + getAntiRepeatBreakPrompt(chainAttempt);
      continue;
    }
    if (isDup || hasCliche || hasCollapse) {
      useDebugLog.getState().add('intercept', `[链式主动] 重试后仍被拦截, 放弃发送`, { characterId, conversationId });
      return false;
    }
    break;
  }

  // Pipeline V2 检测
  const messageProcessingConfig = useModelRoleStore.getState().messageProcessingConfig;
  const v2Settings = useConfigStore.getState().v2Config;
  const pipelineCtx: PipelineContext = {
    rawText: aiReply,
    processedText: aiReply,
    emotion: { type: charEmotion?.emotion || 'anticipation', intensity: charEmotion?.intensity || 0 },
    recentReplies: recentAiReplies,
    userInput: context,
    affinityStage: affinityStage || 'stranger',
    forbiddenText: character.forbiddenBehaviors,
    character,
    interceptConfig: messageProcessingConfig,
  };
  let pipelineResult: { text: string; logs: string[]; aborted: boolean; abortReason?: string; segments?: string[] };

  if (v2Settings.pipelineEnabled) {
    pipelineResult = await runPipelineV2(pipelineCtx, {
      cleanMarkers: { enabled: v2Settings.cleanMarkers && v2Settings.cleanThinkingMarkers, removeThoughtTags: true, removeFeelingTags: true, removeActionTags: true, removeInnerMonologue: true },
      blockCliche: {
        enabled: v2Settings.blockCliche && v2Settings.messageProcessingEnabled && v2Settings.enableIntercept,
        blockDuplicate: v2Settings.blockDuplicate,
        duplicateThreshold: v2Settings.duplicateThreshold,
        blockAICliche: v2Settings.blockAICliche,
        blockPersonaCollapse: v2Settings.blockPersonaCollapse,
        blockForbiddenViolation: v2Settings.blockForbiddenViolation,
        minLength: 2,
        maxLength: 600
      },
      typoSim: { enabled: v2Settings.typoSim, probability: v2Settings.typoProb / 100, correctionMode: v2Settings.typoCorrection, minLength: 8 },
      segment: { enabled: v2Settings.smartSegment, threshold: v2Settings.segmentThreshold, maxSegments: v2Settings.maxSegments, mode: 'smart', minSegmentLength: 6, pairProtection: v2Settings.pairProtection },
      tonePolish: { enabled: v2Settings.tonePolish, emotionExpressions: {}, prefixProb: 0.06, suffixProb: 0.08, intensity: v2Settings.toneIntensity },
      lengthRandomize: { enabled: v2Settings.lengthRandomize },
      colloquialism: { enabled: v2Settings.colloquialism, prefixProb: 0.12, suffixProb: 0.18, repeatProb: 0.08, ellipsisProb: 0.06 },
      smartPunctuation: { enabled: v2Settings.smartPunctuation, commaInsertProb: 0.05, exclamationProb: 0.3, tildeProb: 0.25 },
      speakingRhythm: { enabled: v2Settings.speakingRhythm, breathPauseProb: 0.15 },
      finalSanitize: { enabled: v2Settings.finalSanitize, removeDuplicatePunctuation: v2Settings.removeDuplicatePunctuation, normalizeWhitespace: v2Settings.normalizeWhitespace },
    });
  } else {
    pipelineResult = { text: aiReply, logs: ['Pipeline V2 已关闭'], aborted: false };
  }
  if (pipelineResult.aborted) {
    useDebugLog.getState().add('intercept', `[链式主动] Pipeline拦截: ${pipelineResult.abortReason}, 放弃发送`, { characterId, conversationId });
    return false;
  }
  aiReply = pipelineResult.text || aiReply;

  const aiMsg: Message = {
    id: generateId(),
    content: aiReply,
    sender: 'ai',
    timestamp: new Date(),
    emotion: 'anticipation',
  };

  useChatStore.setState((state) => ({
    conversations: state.conversations.map(c =>
      c.id === conversationId
        ? { ...c, messages: [...c.messages, aiMsg], updatedAt: new Date() }
        : c
    ),
  }));

  return true;
}

/**
 * 🆕 去预制化：主动情境不再使用任何成品句（"你之前说要X，现在怎么样了？"），
 * 只提供真实情境（时间、距上次聊天间隔、最近对话片段、回访事件原始描述），
 * 由模型根据情境随机应变地组织语言。
 */
function buildProactiveContext(triggerType: 'chain' | 'callback', conversationId: string, context: string): string {
  const conv = useChatStore.getState().conversations.find(c => c.id === conversationId);
  const now = new Date();
  const timeInfo = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  const lines: string[] = [
    `[${timeInfo}] 【内部情境（这不是用户说的话，用户看不到本段）】`,
    triggerType === 'callback'
      ? `触发原因：回访——${context}`
      : '触发原因：链式主动检查——由你决定是否主动找用户说话',
  ];

  // 真实对话情境：最后一条消息 + 间隔 + 最近片段
  const msgs = conv?.messages || [];
  if (msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    const gapMin = Math.max(0, Math.floor((now.getTime() - new Date(last.timestamp).getTime()) / 60000));
    const who = last.sender === 'user' ? '用户' : '你';
    const gapText = gapMin === 0 ? '刚刚' : gapMin < 60 ? `${gapMin} 分钟前` : `${Math.floor(gapMin / 60)} 小时前`;
    lines.push(`对话近况：最后一条消息是${gapText}，${who}说："${last.content.slice(0, 80)}"`);

    if (gapMin <= 5) {
      lines.push('⚠️ 注意：用户刚刚还在和你聊天——绝对禁止发"在吗/醒了吗/吃了吗/在忙吗"这类空洞问候，应自然衔接当前话题，或分享你此刻的状态和想法。');
    } else if (gapMin <= 60) {
      lines.push(`距上次聊天已隔 ${gapMin} 分钟，可以从上次话题自然延续，或分享你刚经历的事。`);
    } else {
      lines.push('距上次聊天已有较长时间，可以像许久没联系一样自然开启话题。');
    }

    const recent = msgs.slice(-6)
      .map(m => `${m.sender === 'user' ? '用户' : '你'}: ${m.content.slice(0, 50)}`)
      .join('\n');
    lines.push(`最近对话片段（供参考）：\n${recent}`);
  } else {
    lines.push('该会话还没有对话记录。');
  }

  lines.push(
    '要求：说什么、怎么说完全由你根据以上情境即兴决定，内容必须贴合刚聊过的话题和当下时间，' +
    '禁止任何模板化问候（在吗/醒了吗/吃了吗/在忙吗/你睡了吗等）；' +
    '回访时用你自己的语言自然提起，绝不照搬触发原因里的措辞。' +
    '如果此刻不适合说话（刚聊完、深夜、无话可说），只回复 NO_REPLY。',
  );
  return lines.join('\n');
}

export const useChainProactiveStore = create<ChainProactiveState>((set, get) => ({
  chainTimerId: null,
  nextChainTime: 0,
  lastChainTrigger: 0,
  callbackTimers: new Map(),
  isActive: false,
  lastError: null,

  startChain: () => {
    const state = get();
    // 🆕 防泄漏：句柄挂 window，HMR 重建模块后先清掉旧实例的自续 setTimeout 链
    const w = window as unknown as { __chainProactiveTimer?: ReturnType<typeof setTimeout> };
    if (w.__chainProactiveTimer) clearTimeout(w.__chainProactiveTimer);
    if (state.chainTimerId) {
      clearTimeout(state.chainTimerId);
    }

    const config = useModelRoleStore.getState().chainProactiveConfig;
    if (!config.enabled) {
      set({ isActive: false });
      return;
    }

    const delay = calculateDelay(config);
    const nextTime = Date.now() + delay;

    const timerId = setTimeout(async () => {
      await get().triggerChainCheck();
      // Re-schedule next chain (self-sustaining)
      get().startChain();
    }, delay);

    w.__chainProactiveTimer = timerId;
    set({
      chainTimerId: timerId,
      nextChainTime: nextTime,
      isActive: true,
      lastError: null,
    });

    // 延迟添加调试日志，避免在初始化时阻塞
    setTimeout(() => {
      useDebugLog.getState().add('system', `[链式主动] 下次触发: ${new Date(nextTime).toLocaleTimeString('zh-CN')}`);
    }, 100);
  },

  stopChain: () => {
    const { chainTimerId, callbackTimers } = get();
    if (chainTimerId) clearTimeout(chainTimerId);
    callbackTimers.forEach(timer => clearTimeout(timer));
    set({
      chainTimerId: null,
      nextChainTime: 0,
      isActive: false,
      callbackTimers: new Map(),
    });
  },

  addCallbackTimer: (conversationId, delayMinutes, context) => {
    const state = get();
    // Cancel existing timer for this conversation
    const existing = state.callbackTimers.get(conversationId);
    if (existing) clearTimeout(existing);

    const delayMs = delayMinutes * 60 * 1000;
    const timerId = setTimeout(async () => {
      await get().triggerCallback(conversationId, context);
      // Remove from map after execution
      set(s => {
        const newMap = new Map(s.callbackTimers);
        newMap.delete(conversationId);
        return { callbackTimers: newMap };
      });
    }, delayMs);

    const newMap = new Map(state.callbackTimers);
    newMap.set(conversationId, timerId);
    set({ callbackTimers: newMap });

    useDebugLog.getState().add('system', `[回访定时] ${conversationId} 将在 ${delayMinutes} 分钟后回访`);
  },

  cancelCallbackTimer: (conversationId) => {
    const { callbackTimers } = get();
    const existing = callbackTimers.get(conversationId);
    if (existing) clearTimeout(existing);
    const newMap = new Map(callbackTimers);
    newMap.delete(conversationId);
    set({ callbackTimers: newMap });
  },

  triggerChainCheck: async () => {
    const config = useModelRoleStore.getState().chainProactiveConfig;
    if (!config.enabled) return;

    const selectedCharId = useCharacterStore.getState().selectedCharacterId;
    if (!selectedCharId) return;

    try {
      // 🆕 B2: 统一闸门——随机闲聊级（优先级4）主动先过预算/退避/睡眠裁决，不通过则省掉整次 LLM 调用
      const gate = checkGate({ source: 'chain', priority: 4, reason: '链式主动检查', characterId: selectedCharId, payload: '' });
      if (!gate.allowed) {
        useDebugLog.getState().add('proactive', `[闸门] 链式主动被拦截: ${gate.reason}`);
        return;
      }

      // Find target conversation
      const conversations = useChatStore.getState().conversations;
      let targetConv = config.conversationId
        ? conversations.find(c => c.id === config.conversationId && c.characterId === selectedCharId)
        : undefined;
      if (!targetConv) {
        targetConv = conversations
          .filter(c => c.characterId === selectedCharId)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
      }
      if (!targetConv) return;

      const context = buildProactiveContext('chain', targetConv.id, '');
      const sent = await sendChainMessage(selectedCharId, targetConv.id, 'chain', context);
      if (sent) recordSent({ source: 'chain', priority: 4, reason: '链式主动', characterId: selectedCharId, payload: '' });

      set({ lastChainTrigger: Date.now() });
      useDebugLog.getState().add('system', `[链式主动] 触发检查，发送: ${sent}`);
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : 'Unknown error' });
      useDebugLog.getState().add('system', `[链式主动] 错误: ${e}`);
    }
  },

  triggerCallback: async (conversationId, context) => {
    const config = useModelRoleStore.getState().chainProactiveConfig;
    if (!config.enabled || !config.callbackEnabled) return;

    const selectedCharId = useCharacterStore.getState().selectedCharacterId;
    if (!selectedCharId) return;

    try {
      // 🆕 B2: 回访属情绪级（优先级2）——同样过统一闸门
      const gate = checkGate({ source: 'callback', priority: 2, reason: `回访: ${context.slice(0, 40)}`, characterId: selectedCharId, payload: context });
      if (!gate.allowed) {
        useDebugLog.getState().add('proactive', `[闸门] 回访被拦截: ${gate.reason}`);
        return;
      }

      const proactiveContext = buildProactiveContext('callback', conversationId, context);
      const sent = await sendChainMessage(selectedCharId, conversationId, 'callback', proactiveContext);
      if (sent) recordSent({ source: 'callback', priority: 2, reason: '回访', characterId: selectedCharId, payload: context });
      useDebugLog.getState().add('system', `[回访] ${sent ? '已发送' : '未发送'}: ${conversationId}`);
    } catch (e) {
      useDebugLog.getState().add('system', `[回访] 错误: ${e}`);
    }
  },
}));

// Check for callback keywords in user messages
export function checkCallbackKeywords(message: string, conversationId: string) {
  const config = useModelRoleStore.getState().chainProactiveConfig;
  if (!config.enabled || !config.callbackEnabled) return;

  const matchedKeyword = matchCallbackKeyword(message);
  if (matchedKeyword) {
    // 🆕 去预制化：只传原始事件描述，成品话术由模型即兴组织（见 buildProactiveContext）
    useChainProactiveStore.getState().addCallbackTimer(
      conversationId,
      config.callbackDelayMinutes,
      `用户在 ${config.callbackDelayMinutes} 分钟前提到了"${matchedKeyword}"相关的事，回访时机已到`,
    );
    useDebugLog.getState().add('system', `[回访触发] 关键词: "${matchedKeyword}"，${config.callbackDelayMinutes} 分钟后回访`);
  }
}
