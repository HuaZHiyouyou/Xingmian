import { create } from 'zustand';
import { useCharacterStore } from './characterStore';
import { useChatStore } from './chatStore';
import { useCharacterMindStore } from './characterMindStore';
import { useModelRoleStore, MODEL_ROLES } from './modelRoleStore';
import { useUserProfileStore } from './userProfileStore';
import { useConfigStore } from './configStore';
import { callAI, getSystemPrompt, extractMemories, generateReflection, getDiversityPrompt, isDuplicate, containsAICliche, detectPersonaCollapse } from '../services/aiService';
import { getFileDataOnly, processPostPipeline, isRunningInTauri, invokeWithRetry } from '../lib/tauriBridge';
import { runPipelineV2 } from '../services/outputPipeline';
import { generateId, stripReplySignature } from '../utils/chatUtils';
import type { Message, EmotionType, AffinityStage } from '../types';
import { getSegmentedConfig } from './chatStore';
import { checkGate, recordSent } from '../services/proactive/intentGate';
import { usePromptConfigStore } from './promptConfigStore';
import { useDebugLog } from './debugLogStore';
import { getEmotionStateManager } from '../services/emotion/emotionStateManager';
import { retrieveRelevantMemories, buildMemoryPromptV2, convertToCoreMemory } from '../services/memory/memorySystemV2';
// 🆕 A6 统一上下文构建器：主动回复与正常聊天同源组装
import {
  collectRecentAiReplies, getLastUserMessage, buildLastRoundQuery,
  buildConversationSummary, buildTimeGapHint, buildRustReqCommon,
  buildAdaptiveTemperature, buildAdaptiveMaxTokens,
} from '../services/chatContextBuilder';
import { getDominantEmotionFromUpdate } from '../services/chatContextBuilder';
// 🆕 P0-1 话题账本：主动回复的防重复时间函数（1小时内聊过→严禁再提；隔天→可重温一次）
import { buildTopicLedgerPrompt } from '../services/topicLedger';
// 🆕 P2-1 AI-Life：主动消息"此刻生活"切入点的真实素材源
import { useAiLifeStore } from './aiLifeStore';
import { getLifeNowMaterial } from '../services/ailife/chatIntegration';
import { localDateKey } from '../services/ailife/scheduleTemplates';
// 🆕 增强3：每日三件小事——预生成（fire-and-forget）+ 缓存读取
import { ensureDailyBits, getCachedDailyBits } from '../services/ailife/contentGenerator';

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
  /** 🆕 定时任务专用：以指定内容主动发送角色消息 */
  sendTaskMessage: (characterId: string, payload: string) => Promise<boolean>;
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

/**
 * 🆕 P2-1: AI-Life 此刻生活提示——把生活引擎的当前状态注入主动 prompt，
 * 作为切入点2【此刻生活】的真实素材（Soul DailyAgent 思路：主动消息的内容来自"生活"，
 * 而非上一条聊天记录）。
 * 有进行中活动 → 活动详情；空闲/间隙 → 今日最近完成/下一个计划活动做素材；
 * 引擎未启用或该角色无日程 → 空串。
 */
function buildLifeNowHint(characterId: string): string {
  try {
    const aiLife = useAiLifeStore.getState();
    if (!aiLife.config?.enabled || aiLife.config.characterId !== characterId) return '';
    const { current, lastDone, next } = getLifeNowMaterial();
    if (current && current.name) {
      const loc = current.location || current.sceneId || '';
      const mood = current.mood || '';
      const desc = (current.processDescription || current.summary || '').slice(0, 40);
      return [
        `\n你此刻的生活状态：正在「${current.name}」${loc ? `（在${loc}）` : ''}${mood ? `，心情${mood}` : ''}。`,
        desc ? `刚发生：${desc}。` : '',
        '切入点2【此刻生活】可以从中取材，像随口提起自己的近况，不要机械复述这段文字。',
      ].filter(Boolean).join('');
    }
    const parts: string[] = [];
    if (lastDone?.name) parts.push(`刚做完「${lastDone.name}」`);
    if (next?.name) parts.push(`等下要去「${next.name}」`);
    if (parts.length === 0) return '';
    // 🆕 P2-5 富素材：从今天已完成经历中随机挑一件——多次主动消息不会总说同一件事
    let extra = '';
    const doneActs = (aiLife.dayActivities[localDateKey(new Date())] || [])
      .filter((a) => a.status === 'completed' && (a.summary || a.processDescription));
    if (doneActs.length > 0) {
      const pick = doneActs[Math.floor(Math.random() * doneActs.length)];
      const text = (pick.summary || pick.processDescription || '').slice(0, 40);
      if (text) extra = ` 今天你经历了：「${pick.name}」——${text}。没有更自然的切入点时，可以随口聊起这件事。`;
    } else {
      // 🆕 增强3：无已完成经历时，退回预生成的"今日三件小事"
      const bits = getCachedDailyBits(characterId, localDateKey(new Date()));
      if (bits.length > 0) {
        const bit = bits[Math.floor(Math.random() * bits.length)];
        extra = ` 今天你遇到件小事：${bit}。没有更自然的切入点时，可以随口聊起这件事。`;
      }
    }
    return `\n你此刻的生活状态：现在是空闲时间，${parts.join('，')}。${extra}`
      + '切入点2【此刻生活】可以从中取材（聊聊刚做的事、或为接下来要做的事做准备），像随口提起自己的近况，不要机械复述。';
  } catch { /* store 未就绪时静默 */ }
  return '';
}

/**
 * 发送主动消息。
 * 🔧 主动回复外发修复：若目标会话映射到外部平台接入（bot 会话），除写入本地会话外，
 * 同时经 Rust send_bot_reply 发送到外部平台（私聊发私聊、群会话发群聊）。
 * @returns 成功发送的最终文本；失败/被拦截返回 null
 */
async function sendProactiveMessage(
  characterId: string,
  conversationId: string,
  proactiveSuffix: string,
  triggerMessage: string,
): Promise<string | null> {
  const characters = useCharacterStore.getState().characters;
  const character = characters.find(c => c.id === characterId);
  if (!character) return null;

  const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
  if (!conversation) return null;

  const convMsgs = conversation.messages || [];
  const convLen = convMsgs.length;

  // 🆕 A6: 与正常聊天同源的数据源
  const recentAiReplies = collectRecentAiReplies(conversation);
  const lastUserMsg = getLastUserMessage(conversation);
  const lastRoundQuery = buildLastRoundQuery(conversation);
  const conversationSummary = buildConversationSummary(characterId);
  const timeGapHint = buildTimeGapHint(conversation);

  useDebugLog.getState().add('proactive', `[主动回复] 上下文组装: 轮数=${convLen} 检索query="${lastRoundQuery.slice(0, 60)}" 最近AI回复=${recentAiReplies.length}条 摘要=${conversationSummary ? '有' : '无'} 时距=${timeGapHint || '无'}`, { characterId, conversationId });

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
  const charEmotion = mindStore.getEmotion(characterId);
  const affinityState = mindStore.getAffinity(characterId);
  const affinityStage: AffinityStage | undefined = affinityState?.stage;

  // V2: 双层记忆检索 + 记忆Prompt生成
  let memoryPromptV2 = '';
  let relevantMemories: { content: string; importance: number }[] = [];
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
          userMessage: lastRoundQuery, // 🆕 A6.4: 真实对话检索（原为假元指令）
          userEmotion: charEmotion?.emotion,
          coreMemories: coreMems,
          episodicMemories: episodicMems,
          maxResults: maxRecall,
        });
        memoryPromptV2 = buildMemoryPromptV2(v2Result, dualLayerEnabled && v2MemorySettings.forgettingCurve !== false);
        relevantMemories = v2Result.core.map(r => ({ content: r.memory.content, importance: r.memory.importance }));
      } else {
        const coreMemoriesV2 = memories.map(m => convertToCoreMemory(m, characterId));
        const fallbackResult = retrieveRelevantMemories({
          userMessage: lastRoundQuery,
          userEmotion: charEmotion?.emotion,
          coreMemories: coreMemoriesV2,
          episodicMemories: [],
          maxResults: maxRecall,
        });
        if (fallbackResult.core.length > 0) {
          memoryPromptV2 = buildMemoryPromptV2(fallbackResult, dualLayerEnabled && v2MemorySettings.forgettingCurve !== false);
        }
        relevantMemories = fallbackResult.core.map(r => ({ content: r.memory.content, importance: r.memory.importance }));
      }
    } catch {
      // 静默失败，不影响主流程
    }
  }

  // 🆕 A6.4: memoriesJson 用相关性检索结果（不再 slice(0,5)）
  const memoriesForRust = relevantMemories.length > 0
    ? relevantMemories
    : memories.map(m => ({ content: m.content, importance: m.importance }));

  const reanchorPrompt = (convLen > 0 && convLen % 15 === 0)
    ? `\n\n[提醒] ${convLen}轮对话过去了，请确认你仍然是${character.name}，保持${character.personality}的性格底色。不要因为对话变长而改变自己的本质。`
    : '';

  const diversityPrompt = getDiversityPrompt(convLen);
  const multiEmotionState = useCharacterMindStore.getState().getMultiEmotion(characterId);

  const systemPrompt = getSystemPrompt(character, [], [], charEmotion, [], affinityStage, multiEmotionState)
    + reanchorPrompt + diversityPrompt
    + useUserProfileStore.getState().getUserPrompt()
    + memoryPromptV2
    + proactiveSuffix;

  // 🆕 A6: 温度/maxTokens 与正常聊天同源（真实对话输入 + 真实情绪驱动，温度上限受 retryPolicy 约束）
  const temperature = buildAdaptiveTemperature(convLen, lastUserMsg || lastRoundQuery, charEmotion.emotion);
  const maxTokens = buildAdaptiveMaxTokens(lastUserMsg || lastRoundQuery, convLen, charEmotion.emotion);
  // Pipeline V2 配置（提前声明，供 Rust 分支透传 postConfig 使用）
  const v2Settings = useConfigStore.getState().v2Config;

  // ✅ V4 后端迁移：Tauri 模式下主动回复直接调用 Rust process_message，
  // 完整认知链 + 输出后处理（清洗/拦截/分段）都在 Rust 完成，前端只渲染返回的分段。
  let aiReply = '';
  let rustSegments: string[] | undefined;
  let rustSucceeded = false;
  // 🆕 A6.3: 消息情绪标签（Rust emotion_update 主导维度，回退当前情绪）
  let msgEmotion: EmotionType = charEmotion.emotion;

  if (isRunningInTauri()) {
    try {
      const segConfig = getSegmentedConfig();
      // 🆕 A6.5: req 公共字段由统一构建器生成（与正常聊天完全同源），
      // 并补齐 forbiddenText/recentReplies/conversationSummary/timeGapHint——Rust 复读/违规拦截从此对主动回复生效
      const rustResult = await invokeWithRetry<{
        reply?: string;
        segments?: string[];
        emotion_update?: Record<string, number>;
        affinity_delta?: number;
        ooc_detected?: boolean;
        parse_warnings?: string[];
      }>('process_message', {
        req: {
          ...buildRustReqCommon({
            character,
            affinityLevel: affinityState?.level || 0,
            affinityStage: affinityStage || '',
            emotionValuesJson: JSON.stringify(multiEmotionState?.values || {}),
            emotionLastUpdated: multiEmotionState?.lastUpdated || 0,
            emotionIntensity: charEmotion?.intensity ?? 50,
            emotion: charEmotion?.emotion,
            temperature,
            maxTokens,
            adaptiveInput: lastUserMsg || lastRoundQuery,
            convLen,
            replyDelayMs: segConfig.replyDelay,
            replyDelayRandomMs: segConfig.replyDelayRandomEnabled ? segConfig.replyDelayRandom : 0,
            streamEnabled: false,
            useFullCognitive: true,
            segmentConfig: {
              enabled: segConfig.enabled,
              threshold: segConfig.threshold,
              maxSegments: segConfig.maxSegments,
              protectPairedSymbols: segConfig.protectPairedSymbols,
              mode: segConfig.mode,
              minSegmentLength: segConfig.minSegmentLength,
            },
            modelRole: MODEL_ROLES.COGNITIVE,
          }),
          userMessage: triggerMessage,
          userProfile: useUserProfileStore.getState().getUserPrompt(),
          memoriesJson: JSON.stringify(memoriesForRust),
          messagesJson: JSON.stringify(messages),
          conversationSummary,
          timeGapHint,
          customSystemPrompt: usePromptConfigStore.getState().customSystemPrompt,
          customPersonality: usePromptConfigStore.getState().customPersonality,
          customCareGuidance: usePromptConfigStore.getState().customCareGuidance,
          customEnvironmentAwareness: usePromptConfigStore.getState().customEnvironmentAwareness,
          // V4: 主动回复后缀 + 后处理配置（Rust 端完成分段）
          proactiveSuffix,
          // V5: 违规/复读拦截数据（根治主动回复重复刷屏）
          forbiddenText: character.forbiddenBehaviors || '',
          recentReplies: recentAiReplies,
        },
      });
      aiReply = rustResult?.reply || '';
      if (Array.isArray(rustResult?.segments) && rustResult.segments.length > 0) {
        rustSegments = rustResult.segments;
      }
      if (rustResult?.parse_warnings && rustResult.parse_warnings.length > 0) {
        for (const w of rustResult.parse_warnings) {
          useDebugLog.getState().add('system', `[主动回复] Rust 解析警告: ${w}`, { characterId, conversationId });
        }
      }
      // 主动回复的情绪/好感度状态由 Rust 认知链更新
      if (rustResult?.emotion_update) {
        const currentMulti = useCharacterMindStore.getState().getMultiEmotion(characterId);
        const manager = getEmotionStateManager();
        const updated = manager.applyRustCognitiveUpdate(currentMulti, rustResult.emotion_update, v2Settings.activeMetabolism);
        updated.lastUpdated = Date.now();
        useCharacterMindStore.getState().setMultiEmotion(characterId, updated);
        // 🆕 A6.3: 消息情绪标签取变化量最大的维度（修复"上面喜悦、下面变成期待"）
        msgEmotion = getDominantEmotionFromUpdate(rustResult.emotion_update, charEmotion.emotion) as EmotionType;
        useDebugLog.getState().add('proactive', `[主动回复] 情绪更新: ${JSON.stringify(rustResult.emotion_update)} → 消息标签=${msgEmotion}`, { characterId, conversationId });
      }
      if (rustResult?.affinity_delta && Math.abs(rustResult.affinity_delta) > 0.001) {
        // 使用现有 updateAffinity API（内部处理衰减/持久化/历史记录）
        useCharacterMindStore.getState().updateAffinity(characterId, rustResult.affinity_delta || 0, '主动回复情绪联动');
      }
      useDebugLog.getState().add('proactive', `[主动回复] Rust process_message 完成: ${aiReply.length}字 | 温度=${temperature} maxTokens=${maxTokens}`, { characterId, conversationId });
      rustSucceeded = !!aiReply && aiReply.trim().length > 0;
    } catch (e) {
      useDebugLog.getState().add('proactive', `主动回复 Rust 管道失败，回退前端: ${e instanceof Error ? e.message : String(e)}`, { characterId, conversationId });
      rustSucceeded = false;
    }
  }

  // 非 Tauri 或 Rust 失败时回退前端调用（同源温度/maxTokens）
  if (!rustSucceeded) {
    aiReply = await callAI(messages, systemPrompt, maxTokens, temperature);
    // 🆕 Bug1 修复：前端兜底路径剥离署名
    aiReply = stripReplySignature(aiReply, character.name);
  }

  // 🆕 P0-1 PASS 机制：prompt 允许模型"保持沉默"——找不到好切入点时只输出 <pass/>。
  // 命中则静默放弃本次主动（不发送、不落账、不占任何配额，下次触发重新决策）。
  const passReply = aiReply.trim();
  if (/^\s*(<\s*pass\s*\/?\s*>|\[pass\]|pass\s*\/?)\s*$/i.test(passReply)) {
    useDebugLog.getState().add('proactive', '[主动回复] PASS: 模型判断当前没有值得开口的切入点，保持沉默', { characterId, conversationId });
    return null;
  }

  // 🆕 A6.6/A6.7: 不再"静默放弃"——每类放弃都记录原因日志（空回复也可能是模型选择沉默的变体）
  if (!aiReply || aiReply.trim().length === 0) {
    useDebugLog.getState().add('proactive', '[主动回复] 放弃: 回复为空（模型可能选择沉默或被 Rust 拦截）', { characterId, conversationId });
    return null;
  }

  // Duplication and quality checks
  const isDup = isDuplicate(aiReply, recentAiReplies);
  const hasCliche = containsAICliche(aiReply);
  const hasCollapse = detectPersonaCollapse(aiReply);
  if (isDup || hasCliche || hasCollapse) {
    useDebugLog.getState().add('proactive', `[主动回复] 放弃: 质量拦截 dup=${isDup} cliche=${hasCliche} collapse=${hasCollapse} 内容="${aiReply.slice(0, 50)}"`, { characterId, conversationId });
    return null;
  }

  // Pipeline V2 处理
  const pipelineCtx = {
    rawText: aiReply,
    processedText: aiReply,
    emotion: { type: charEmotion.emotion, intensity: charEmotion.intensity },
    recentReplies: recentAiReplies,
    userInput: triggerMessage,
    affinityStage: affinityStage || 'stranger',
    forbiddenText: character.forbiddenBehaviors,
    character,
    interceptConfig: {
      enableIntercept: true,
      duplicateThreshold: 0.85,
      blockDuplicate: true,
      blockAICliche: true,
      blockPersonaCollapse: true,
      blockForbiddenViolation: true,
    },
  };
  
  let pipelineResult: { text: string; logs: string[]; aborted: boolean; abortReason?: string; segments?: string[] };
  
  // ✅ V4 后端迁移：Rust process_message 已内部完成后处理并返回 segments（含主动回复场景），
  // 直接使用 Rust 结果，不再重复调用前端 pipeline（避免二次后处理 + 二次成本）。
  if (rustSucceeded && rustSegments && rustSegments.length > 0) {
    pipelineResult = {
      text: aiReply,
      segments: rustSegments,
      aborted: false,
      logs: ['Rust 已完成后处理与分段'],
    };
    useDebugLog.getState().add('proactive', `[RustPipeline] 主动回复使用 Rust 分段 (${rustSegments.length}段)`, { characterId, conversationId });
  } else if (v2Settings.pipelineEnabled) {
    // ✅ 后端迁移：Tauri 模式下优先调用 Rust process_post_pipeline
    const rustPipelineResp = isRunningInTauri()
      ? await processPostPipeline({
          text: aiReply,
          emotion: charEmotion.emotion,
          emotionIntensity: charEmotion.intensity,
          forbiddenText: character.forbiddenBehaviors || [],
          recentReplies: recentAiReplies,
          cleanMarkersEnabled: v2Settings.cleanMarkers && v2Settings.cleanThinkingMarkers,
          blockClicheEnabled: v2Settings.blockCliche && v2Settings.messageProcessingEnabled && v2Settings.enableIntercept,
          typoSimEnabled: v2Settings.typoSim,
          typoProb: v2Settings.typoProb / 100,
          segmentEnabled: v2Settings.smartSegment,
          segmentThreshold: v2Settings.segmentThreshold,
          maxSegments: v2Settings.maxSegments,
          pairProtection: v2Settings.pairProtection,
          tonePolishEnabled: v2Settings.tonePolish,
          toneIntensity: v2Settings.toneIntensity,
          lengthRandomizeEnabled: v2Settings.lengthRandomize,
          colloquialismEnabled: v2Settings.colloquialism,
          smartPunctuationEnabled: v2Settings.smartPunctuation,
          speakingRhythmEnabled: v2Settings.speakingRhythm,
          finalSanitizeEnabled: v2Settings.finalSanitize,
          normalizeWhitespace: v2Settings.normalizeWhitespace,
          removeDuplicatePunctuation: v2Settings.removeDuplicatePunctuation,
        })
      : null;

    if (rustPipelineResp) {
      pipelineResult = {
        text: rustPipelineResp.text,
        segments: rustPipelineResp.segments,
        aborted: rustPipelineResp.aborted,
        abortReason: rustPipelineResp.abortReason,
        logs: rustPipelineResp.logs,
      };
    } else {
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
    }
  } else {
    pipelineResult = { text: aiReply, logs: ['Pipeline V2 已关闭'], aborted: false };
  }

  if (pipelineResult.aborted) return null;

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
      emotion: msgEmotion,
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
        emotion: msgEmotion,
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
      emotion: msgEmotion,
    };
    useChatStore.setState((state) => ({
      conversations: state.conversations.map(c =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, aiMsg], updatedAt: new Date() }
          : c
      ),
    }));
  }

  // Post-reply processing（与主聊天同源闸门）：
  // ✅ 修复双重更新：情绪与好感度已由 Rust 认知链（emotion_update/affinity_delta）统一更新，
  //    此处不再调用前端 analyzeCharacterEmotion / analyzeAffinityChange 二次覆盖（情绪大幅波动根因）。
  const allMsgsText = [...convMsgs.map(msg => ({
    role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
    content: msg.content,
  })), { role: 'assistant' as const, content: finalText }];
  const chatState = useChatStore.getState();
  const MIN_INTERVAL_MEMORY = 5 * 60 * 1000;
  const MIN_INTERVAL_REFLECTION = 30 * 60 * 1000;
  const memoryTasksEnabled = v2Settings.dualLayerMemory !== false;
  const nowTs = Date.now();

  // 记忆提取：受 dualLayerMemory 总开关 + 5 分钟间隔控制（与主聊天一致）
  if (memoryTasksEnabled && nowTs - chatState.lastMemoryExtractAt > MIN_INTERVAL_MEMORY) {
    extractMemories(allMsgsText, memories, characterId, conversationId, character.memoryImportanceThreshold)
      .then(newMemories => {
        if (newMemories.length > 0) {
          useCharacterMindStore.getState().addMemories(characterId, newMemories);
          useDebugLog.getState().add('memory', `[主动回复] 记忆提取成功: ${newMemories.length}条`, { characterId, conversationId });
        }
        useChatStore.setState({ lastMemoryExtractAt: Date.now() });
      }).catch(() => {});
  }

  // 反思：仅在 AI 状态不好时由项目识别发起（负面情绪或高强度）+ 30 分钟间隔（与主聊天一致）
  const NEGATIVE_EMOTIONS: string[] = ['sadness', 'anger', 'fear', 'disgust', 'anxiety', 'loneliness', 'disappointment', 'guilt', 'embarrassment', 'jealousy'];
  const isAffectiveEvent = NEGATIVE_EMOTIONS.includes(charEmotion.emotion) || (charEmotion.intensity ?? 0) >= 70;
  if (character.reflectionEnabled && isAffectiveEvent && nowTs - chatState.lastReflectionAt > MIN_INTERVAL_REFLECTION) {
    const emotionHistory = [charEmotion.emotion, ...convMsgs.slice(-6).map(m => m.emotion || 'anticipation' as EmotionType)]
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
          useDebugLog.getState().add('proactive', `[主动回复] 状态反思已生成: ${result.trigger}`, { characterId, conversationId });
        }
        useChatStore.setState({ lastReflectionAt: Date.now() });
      }).catch(() => {});
  }

  return finalText;
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

    // 🆕 A6.7: 回复后主动入口纳入 intentGate 闸门（原来不计数、无退避）
    const gate = checkGate({ source: 'callback', priority: 2, reason: '回复后主动', characterId, payload: '' });
    if (!gate.allowed) {
      useDebugLog.getState().add('proactive', `[闸门] 回复后主动被拦截: ${gate.reason}`, { characterId, conversationId });
      return;
    }

    set({ isSending: true });
    try {
      // 🆕 增强3：顺手预生成今日三件小事（有缓存即用；无缓存则异步生成，供本轮或后续主动消息取材）
      ensureDailyBits(characterId, localDateKey(new Date()));
      // 🆕 P0-1: 去"接续锚点"——旧指令"必须直接接着上一条回复往下说……这是唯一的续写起点"
      // 把话题永久锁死在上一轮，是"用户说吃饭→之后全是问吃饭"死循环的直接元凶。
      // 新设计（对标 N.E.K.O 主动搭话两阶段决策）：切入点优先级菜单 + PASS 沉默选项 + 话题账本时间函数。
      // 模型拥有完整对话历史，无需再注入上一条回复的摘录。
      const customPrompt = config.customPrompt ? '\n\n' + config.customPrompt : '';
      const proactiveSuffix = [
        customPrompt,
        '\n\n[系统提示] 你刚回复完用户，现在考虑要不要再主动补一句（可以沉默）。',
        '先在心里按优先级找切入点，找不到就不要说：',
        '1.【收尾】上一轮有挂着没说完的事（对方说要去做什么、问题没答完、约定没确认）→ 自然补一句或确认；',
        '2.【此刻生活】你此刻正在做的事、刚注意到的小事 → 随口分享一句；',
        '3.【时间氛围】结合当前时刻说点应景的话（饭点、深夜、下班、天气）；',
        '4.【旧话题】隔了一天以上的旧事，真的有新内容可接 → 用"上次你说的…"带出，最多提一次；',
        '5. 都没有合适的 → 只输出 <pass/>，保持沉默（沉默不代表冷淡，硬找话说才会）。',
        buildLifeNowHint(characterId),
        '硬性禁止：话题账本里"几分钟前/几小时前"刚聊过的话题一个字都不要再提，尤其禁止反复问吃饭、睡觉、累不累。',
        '若决定说话：只说一件事，15~40字，像随手发的微信；不要提到"主动""系统"等字眼。',
        buildTopicLedgerPrompt(characterId),
      ].filter(Boolean).join('\n');

      const sent = await sendProactiveMessage(characterId, conversationId, proactiveSuffix, '[你刚回复完用户，在考虑要不要再补一句]');

      if (sent) {
        recordSent({ source: 'callback', priority: 2, reason: '回复后主动', characterId, payload: '' });
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

    // 🆕 B2: 统一闸门——定时主动属任务级（优先级1），受全局预算/退避约束
    const selectedCharId0 = useCharacterStore.getState().selectedCharacterId;
    const gate = checkGate({ source: 'scheduled', priority: 1, reason: '定时主动', characterId: selectedCharId0 || '', payload: '' });
    if (!gate.allowed) {
      useDebugLog.getState().add('proactive', `[闸门] 定时主动被拦截: ${gate.reason}`);
      return;
    }

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
        // 🆕 内存未命中时先查会话列表（库内分页数据），避免冷启动/重载初期误建重复会话
        const listConv = useChatStore.getState().conversationList.find(c => c.characterId === selectedCharId);
        if (listConv) {
          await useChatStore.getState().setCurrentConversation(listConv.id);
          targetConv = useChatStore.getState().conversations.find(c => c.id === listConv.id);
        }
      }

      if (!targetConv) {
        // 🆕 角色库尚未加载完成（启动初期）时禁止兜底建会话，
        //    否则会产生标题/问候语全部走兜底的"新对话"幽灵会话并被持久化
        if (useCharacterStore.getState().characters.length === 0) return;
        const convId = useChatStore.getState().createNewConversation(selectedCharId);
        targetConv = useChatStore.getState().conversations.find(c => c.id === convId);
        if (!targetConv) return;
      }

      const customPrompt = config.customPrompt ? '\n\n' + config.customPrompt : '';
      // 🆕 增强3：顺手预生成今日三件小事（见 triggerProactiveAfterReply 注释）
      ensureDailyBits(selectedCharId, localDateKey(new Date()));
      // 🆕 P0-1: 与回复后主动同一套"切入点菜单 + PASS + 话题账本"设计（见 triggerProactiveAfterReply 注释）。
      // 旧 prompt"根据之前的对话选择话题"仍然锚定历史；新 prompt 把话题来源解耦为：没下文的事/此刻生活/时间氛围/隔天旧话题。
      const scheduledSuffix = [
        customPrompt,
        '\n\n[系统提示] 距上次聊天已过了一段时间，你在考虑要不要主动找对方聊两句（可以沉默）。',
        '先按优先级找切入点，找不到就不要打扰：',
        '1.【没下文的事】对方之前提到要去做的事、答应你的事、挂着的问题 → 自然问一句结果；',
        '2.【此刻生活】你此刻正在做的事、今天遇到的小事 → 随口分享；',
        '3.【时间氛围】当前时刻该聊什么（早晨问昨晚睡得怎样、午饭问吃了什么、深夜劝早点休息）；',
        '4.【旧话题】隔了一天以上的旧话题，有新由头 → 用"上次你说的…"自然带出；',
        '5. 都没有 → 只输出 <pass/>，今天先不打扰。',
        buildLifeNowHint(selectedCharId),
        '硬性禁止：话题账本里当天聊过的话题禁止再主动提起；同一话题无论隔多久，最多主动提起一次。',
        '若决定说话：只说一件事，15~40字，像随口发来的微信；不要提到"主动消息"或"系统"。',
        buildTopicLedgerPrompt(selectedCharId),
      ].filter(Boolean).join('\n');

      const sent = await sendProactiveMessage(selectedCharId, targetConv.id, scheduledSuffix, '[你在考虑要不要主动找对方聊两句]');

      if (sent) {
        recordSent({ source: 'scheduled', priority: 1, reason: '定时主动', characterId: selectedCharId, payload: '' });
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

  /**
   * 🆕 定时任务专用：以指定内容主动发送一条角色消息（绕过概率/频控）。
   * 返回是否成功发送。
   */
  sendTaskMessage: async (characterId: string, payload: string) => {
    if (get().isSending) return false;
    if (!payload?.trim()) return false;

    set({ isSending: true });
    try {
      const conversations = useChatStore.getState().conversations;
      let targetConv = conversations
        .filter(c => c.characterId === characterId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

      if (!targetConv) {
        // 🆕 内存未命中时先查会话列表（库内分页数据），避免冷启动/重载初期误建重复会话
        const listConv = useChatStore.getState().conversationList.find(c => c.characterId === characterId);
        if (listConv) {
          await useChatStore.getState().setCurrentConversation(listConv.id);
          targetConv = useChatStore.getState().conversations.find(c => c.id === listConv.id);
        }
      }

      if (!targetConv) {
        // 🆕 角色库尚未加载完成时禁止兜底建会话（防"新对话"幽灵会话）
        if (useCharacterStore.getState().characters.length === 0) return false;
        const convId = useChatStore.getState().createNewConversation(characterId);
        targetConv = useChatStore.getState().conversations.find(c => c.id === convId);
        if (!targetConv) return false;
      }

      const suffix = [
        '\n\n[系统提示] 请根据下面的内容以你的口吻发起一条消息。',
        `【定时任务内容】${payload.trim()}`,
        '保持你的角色设定，表现自然，不要提到"任务""系统"等字眼。',
      ].join('');

      const sent = await sendProactiveMessage(characterId, targetConv.id, suffix, `[定时任务触发: ${payload.trim()}]`);
      return typeof sent === 'string' && sent.length > 0;
    } catch (e) {
      console.error('[TaskMessage] Failed:', e);
      return false;
    } finally {
      set({ isSending: false });
    }
  },

  startScheduler: () => {
    // 🆕 B1: 私有 setInterval 已移除——分钟节拍由模块注册表驱动（checkScheduledTrigger）。
    //    保留 window 句柄清理：清掉历史版本泄漏的旧 interval。
    const w = window as unknown as { __proactiveSchedTimer?: ReturnType<typeof setInterval> };
    if (w.__proactiveSchedTimer) { clearInterval(w.__proactiveSchedTimer); w.__proactiveSchedTimer = undefined; }
  },

  stopScheduler: () => {
    const t = get().schedulerTimer;
    if (t) { clearInterval(t); set({ schedulerTimer: null }); }
  },
}));
