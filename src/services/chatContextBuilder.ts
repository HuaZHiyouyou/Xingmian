/**
 * ============================================================
 * 统一上下文构建器（A6 核心）
 * 主动回复与正常聊天共用的上下文组装路径：
 * 记忆检索 query、对话摘要、跨时间提醒、Rust req 公共字段、
 * 自适应温度/maxTokens、拦截字段。记忆一致性由构造保证。
 * 主动路径只读共享对话状态，绝不自建或覆盖历史。
 * ============================================================
 */
import { useChatStore } from '../store/chatStore';
import { MODEL_ROLES } from '../store/modelRoleStore';
import type { Conversation, Character, AffinityStage, EmotionType } from '../types';
import { useConfigStore } from '../store/configStore';
import { useFeatureModuleStore } from '../store/featureModuleStore';
import { getAdaptiveTemperature, getAdaptiveMaxTokens } from './aiService';
import { getEffectiveEmotionDecayMultiplier } from './dataOverrideBridge';
import * as memoryStoreModule from '../store/memoryStore';

/** 最近 AI 回复（复读拦截数据源，与正常聊天同源；P1-4 窗口 5 → 10） */
export function collectRecentAiReplies(conv: Conversation, count = 10): string[] {
  return (conv.messages || [])
    .filter((m) => m.sender === 'ai')
    .slice(-count)
    .map((m) => m.content);
}

/** 用户最后一句话（原文，供主动回复接续锚点/记忆检索使用） */
export function getLastUserMessage(conv: Conversation): string {
  const msgs = conv.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].sender === 'user' && msgs[i].content?.trim()) return msgs[i].content.trim();
  }
  return '';
}

/** AI 最后一次回复（接续锚点第二半） */
export function getLastAiReply(conv: Conversation): string {
  const msgs = conv.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].sender === 'ai' && msgs[i].content?.trim()) return msgs[i].content.trim();
  }
  return '';
}

/** 最后一轮真实对话拼接（截断 200 字）——记忆检索 query 与正常聊天对齐 */
export function buildLastRoundQuery(conv: Conversation): string {
  const u = getLastUserMessage(conv);
  const a = getLastAiReply(conv);
  const q = [u, a].filter(Boolean).join(' / ');
  return q.slice(0, 200);
}

/** V6 对话摘要——从记忆库取 summary 类记忆（与 chatStore 正常聊天同源） */
export function buildConversationSummary(characterId: string): string {
  const { useMemoryStore } = memoryStoreModule;
  const allEntries = useMemoryStore.getState().entries[characterId] || [];
  const summaryEntry = allEntries.find((e) => e.category === 'summary');
  return summaryEntry?.content
    ? `【历史对话总结】${summaryEntry.content}${summaryEntry.createdAt instanceof Date ? `（总结时间 ${summaryEntry.createdAt.toLocaleDateString()}）` : ''}`
    : '';
}

/** V6 跨时间提醒——当前时间与最后一条消息的时间差 */
export function buildTimeGapHint(conv: Conversation): string {
  const msgs = conv.messages || [];
  const lastMsg = msgs[msgs.length - 1];
  if (!lastMsg?.timestamp) return '';
  const lastTs = lastMsg.timestamp instanceof Date ? lastMsg.timestamp.getTime() : new Date(lastMsg.timestamp).getTime();
  const gapMs = Date.now() - lastTs;
  if (gapMs <= 15 * 60 * 1000) return '';
  const mins = Math.floor(gapMs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days > 0) return `（距离上次对话约 ${days} 天 ${hrs % 24} 小时）`;
  if (hrs > 0) return `（距离上次对话约 ${hrs} 小时 ${mins % 60} 分）`;
  return `（距离上次对话约 ${mins} 分钟）`;
}

export interface RustReqCommonInput {
  character: Character;
  affinityLevel: number;
  affinityStage: AffinityStage | '';
  emotionValuesJson: string;
  emotionLastUpdated: number;
  emotionIntensity: number;
  emotion: EmotionType | string;
  temperature: number;
  maxTokens: number;
  /** 真实用户输入（温度/maxTokens 自适应依据）；主动回复传最后一轮对话 query */
  adaptiveInput: string;
  convLen: number;
  replyDelayMs: number;
  replyDelayRandomMs: number;
  streamEnabled: boolean;
  useFullCognitive: boolean;
  segmentConfig: {
    enabled: boolean;
    threshold: number;
    maxSegments: number;
    protectPairedSymbols?: boolean;
    mode?: string;
    minSegmentLength?: number;
    segmentDelayMs?: number;
  };
  modelRole?: string;
}

/** Rust process_message req 公共字段（正常聊天与主动回复完全同源） */
export function buildRustReqCommon(input: RustReqCommonInput): Record<string, unknown> {
  const v2Config = useConfigStore.getState().v2Config;
  const seg = input.segmentConfig;
  return {
    characterName: input.character.name,
    characterPersonality: input.character.personality || '',
    characterBackground: input.character.background || '',
    characterStyle: input.character.responseStyle || '',
    characterCatchphrases: JSON.stringify(input.character.catchphrases || []),
    affinityLevel: input.affinityLevel,
    affinityStage: input.affinityStage,
    emotionValuesJson: input.emotionValuesJson,
    emotionLastUpdated: input.emotionLastUpdated,
    modelRole: input.modelRole || MODEL_ROLES.COGNITIVE,
    useFullCognitive: input.useFullCognitive,
    // 🆕 #5 JSON 输出契约：模型整体输出单个 JSON，Rust 直读字段绕开标签提取
    jsonOutputMode: v2Config.jsonOutputMode !== false,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    reasoningEffort: v2Config.reasoningEffort,
    activeMetabolism: v2Config.activeMetabolism,
    decayMultiplier: getEffectiveEmotionDecayMultiplier(v2Config.decayMultiplier),
    inputDebounceMs: v2Config.inputDebounceMs,
    currentTime: new Date().toISOString(),
    timezone: input.character.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    cognitiveMultiplier: v2Config.cognitiveMultiplier ?? 1.5,
    reasoningBuffer: v2Config.reasoningBuffer ?? 1024,
    maxTokensCap: v2Config.maxTokensCap ?? 8192,
    replyDelayMs: input.replyDelayMs,
    replyDelayRandomMs: input.replyDelayRandomMs,
    streamEnabled: input.streamEnabled,
    postConfig: {
      segmentEnabled: seg.enabled,
      segmentThreshold: seg.threshold,
      maxSegments: seg.maxSegments,
      pairProtection: seg.protectPairedSymbols ?? true,
      typoSimEnabled: v2Config.typoSim,
      typoProb: v2Config.typoProb / 100,
      tonePolishEnabled: v2Config.tonePolish,
      toneIntensity: v2Config.toneIntensity,
      colloquialismEnabled: v2Config.colloquialism,
      smartPunctuationEnabled: v2Config.smartPunctuation,
      speakingRhythmEnabled: v2Config.speakingRhythm,
      finalSanitizeEnabled: v2Config.finalSanitize,
      normalizeWhitespace: v2Config.normalizeWhitespace,
      removeDuplicatePunctuation: v2Config.removeDuplicatePunctuation,
      cleanMarkersEnabled: v2Config.cleanMarkers && v2Config.cleanThinkingMarkers,
      blockClicheEnabled: v2Config.messageProcessingEnabled && v2Config.enableIntercept && v2Config.blockCliche,
      lengthRandomizeEnabled: v2Config.lengthRandomize,
      emotionIntensity: input.emotionIntensity ?? 50,
      duplicateThreshold: v2Config.duplicateThreshold,
      segmentMode: seg.mode || 'smart',
      minSegmentLength: seg.minSegmentLength ?? 8,
      segmentDelayMs: seg.segmentDelayMs ?? 800,
    },
  };
}

/** 自适应温度（真实输入驱动；A7 上限由 retryPolicy.adaptiveTempMax 约束） */
export function buildAdaptiveTemperature(convLen: number, userInput: string, emotion: EmotionType | string): number {
  const t = getAdaptiveTemperature(convLen, userInput, emotion as EmotionType);
  const retryPolicy = useFeatureModuleStore.getState().retryPolicy;
  const cap = Number.isFinite(retryPolicy?.adaptiveTempMax) && (retryPolicy.adaptiveTempMax as number) > 0
    ? (retryPolicy.adaptiveTempMax as number)
    : 0.95;
  return Math.min(t, cap);
}

/** 自适应 maxTokens（真实情绪驱动） */
export function buildAdaptiveMaxTokens(userInput: string, convLen: number, emotion: EmotionType | string): number {
  return getAdaptiveMaxTokens(userInput, convLen, emotion as EmotionType);
}

/** 从 chatStore 读取当前会话（主动回复只读共享状态，绝不自建历史） */
export function getSharedConversation(conversationId: string): Conversation | undefined {
  return useChatStore.getState().conversations.find((c) => c.id === conversationId);
}

/**
 * 🆕 A6.3 情绪连续：从 Rust 认知链 emotion_update 中取变化量最大的维度
 * 作为消息情绪标签（无变化则回退当前情绪）。
 */
export function getDominantEmotionFromUpdate(
  update: Record<string, number> | undefined,
  fallback: EmotionType | string,
): EmotionType | string {
  if (!update || typeof update !== 'object') return fallback;
  let bestKey: string | null = null;
  let bestVal = 0;
  for (const [k, v] of Object.entries(update)) {
    const n = Math.abs(Number(v) || 0);
    if (n > bestVal) { bestVal = n; bestKey = k; }
  }
  return bestKey ? (bestKey as EmotionType) : fallback;
}
