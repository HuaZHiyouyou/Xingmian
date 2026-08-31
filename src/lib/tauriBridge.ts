
import { invoke } from '@tauri-apps/api/core';
import { PlatformConfig, ModelConfig } from '../store/configStore';
// 🆕 B1.1: ailife 双后端——非 Tauri 环境路由到 IndexedDB（类型单向依赖，无运行时循环）
import * as ailifeIdb from './ailifeIdb';
import { Conversation, EmotionRecord, Character, Memory, Reflection, MemoryEntry, Message } from '../types';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface DbPlatform {
  id: number;
  display_name: string;
  base_url: string;
  api_key: string;
  enabled: boolean;
  is_default: boolean;
  models: DbModel[];
}

interface DbModel {
  id: number;
  platform_id: number;
  name: string;
  type: string;
  enabled: boolean;
  pinned: boolean;
  enabled_types: string[];
}

interface DbConversation {
  id: string;
  title: string;
  character_id: string;
  created_at: string;
  updated_at: string;
  messages: DbMessage[];
}

interface DbMessage {
  id: string;
  conversation_id: string;
  content: string;
  sender: string;
  timestamp: string;
  emotion: string | null;
  emotion_intensity: number | null;
  attachments: string | null;
  recalled?: boolean;
  recalled_at?: string | null;
}

interface DbEmotionRecord {
  id: string;
  emotion: string;
  intensity: number;
  timestamp: string;
  context: string;
  character_id: string | null;
}

function dbPlatformToPlatformConfig(db: DbPlatform): PlatformConfig {
  return {
    displayName: db.display_name,
    baseUrl: db.base_url,
    apiKey: db.api_key,
    enabled: db.enabled,
    isDefault: db.is_default,
    models: db.models.map((m) => ({
      name: m.name,
      type: m.type as ModelConfig['type'],
      enabled: m.enabled,
      pinned: m.pinned,
      enabledTypes: m.enabled_types as ModelConfig['enabledTypes'],
    })),
    fetchingModels: false,
  };
}

function dbMessageToMessage(m: Record<string, unknown>): Message {
  return {
    id: m.id as string,
    content: m.content as string,
    sender: (m.sender as 'user' | 'ai' | undefined) || 'ai',
    timestamp: new Date(m.timestamp as string | number | Date),
    emotion: (m.emotion as EmotionRecord['emotion'] | undefined) || undefined,
    emotionIntensity: (m.emotionIntensity as number | undefined) ?? (m.emotion_intensity as number | undefined) ?? undefined,
    attachments: m.attachments ? (typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments) : undefined,
    recalled: (m.recalled as boolean | undefined) ?? false,
    recalledAt: m.recalledAt ? new Date(m.recalledAt as string | number | Date) : undefined,
  };
}

function dbConversationToConversation(db: unknown): Conversation {
  const row = db as Record<string, unknown>;
  return {
    id: row.id as string,
    title: row.title as string,
    characterId: (row.character_id as string | undefined) || (row.characterId as string | undefined) || '',
    createdAt: new Date((row.created_at as string | undefined) || (row.createdAt as string | undefined) || Date.now()),
    updatedAt: new Date((row.updated_at as string | undefined) || (row.updatedAt as string | undefined) || Date.now()),
    messages: ((row.messages || []) as Record<string, unknown>[]).map(dbMessageToMessage),
  };
}

function dbEmotionRecordToEmotionRecord(db: DbEmotionRecord): EmotionRecord {
  return {
    id: db.id,
    emotion: db.emotion as EmotionRecord['emotion'],
    intensity: db.intensity,
    timestamp: new Date(db.timestamp),
    context: db.context,
    characterId: db.character_id || undefined,
  };
}

function platformConfigToDb(p: PlatformConfig) {
  return {
    displayName: p.displayName,
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    enabled: p.enabled,
    isDefault: p.isDefault ?? false,
    models: p.models.map((m) => ({
      name: m.name,
      type: m.type,
      enabled: m.enabled,
      pinned: m.pinned,
      enabledTypes: m.enabledTypes,
    })),
  };
}

function conversationToDb(c: Conversation) {
  return {
    id: c.id,
    title: c.title,
    characterId: c.characterId,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
    updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : String(c.updatedAt),
    messages: c.messages.map((m) => ({
      id: m.id,
      content: m.content,
      sender: m.sender,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
      emotion: m.emotion ?? null,
      emotionIntensity: m.emotionIntensity ?? null,
      attachments: m.attachments && m.attachments.length > 0 ? JSON.stringify(m.attachments) : null,
    })),
  };
}

function emotionRecordToDb(r: EmotionRecord) {
  return {
    id: r.id,
    emotion: r.emotion,
    intensity: r.intensity,
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
    context: r.context,
    character_id: r.characterId || null,
  };
}

export async function dbGetPlatforms(): Promise<PlatformConfig[]> {
  if (!isTauri) return [];
  const result = await invoke<DbPlatform[]>('get_platforms');
  return result.map(dbPlatformToPlatformConfig);
}

export async function dbSavePlatforms(platforms: PlatformConfig[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_platforms', { platforms: platforms.map(platformConfigToDb) });
}

export async function dbGetConversations(): Promise<Conversation[]> {
  if (!isTauri) return [];
  const result = await invoke<DbConversation[]>('get_conversations');
  return result.map(dbConversationToConversation);
}

export async function dbGetConversationsPage(
  cursor?: string,
  limit?: number,
): Promise<{
  conversations: Conversation[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  if (!isTauri) return { conversations: [], nextCursor: null, hasMore: false };
  // 🆕 失败必须抛出而非静默返回空列表：此前吞错导致 get_conversations_page 的 SQL
  //    参数绑定错误长期无感（首页查询永远失败，上层误判"数据库为空"并自动创建幽灵会话）。
  const result = await invoke<{
    conversations: DbConversation[];
    nextCursor: string | null;
    hasMore: boolean;
  }>('get_conversations_page', {
    cursor: cursor || null,
    limit: limit || 20,
  });
  return {
    conversations: result.conversations.map(dbConversationToConversation),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  };
}

export async function dbGetConversationMessages(conversationId: string): Promise<Message[]> {
  if (!isTauri) return [];
  try {
    const result = await invoke<DbMessage[]>('get_conversation_messages', { conversationId });
    return result.map(m => dbMessageToMessage(m as unknown as Record<string, unknown>));
  } catch {
    return [];
  }
}

export async function dbSaveConversations(conversations: Conversation[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_conversations', { conversations: conversations.map(conversationToDb) });
}

export async function dbSaveConversation(conversation: Conversation): Promise<void> {
  if (!isTauri) return;
  await invoke('save_conversation', { conversation: conversationToDb(conversation) });
}

export async function dbDeleteConversation(conversationId: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_conversation', { conversationId });
}

/** 🆕 清理僵尸会话：删除无用户消息且超 24 小时未更新的会话，返回删除数量 */
export async function dbCleanupZombieConversations(): Promise<number> {
  if (!isTauri) return 0;
  try {
    return await invoke<number>('cleanup_zombie_conversations');
  } catch {
    return 0;
  }
}

/** 🆕 清理过期运行日志（默认保留 7 天），返回删除条数 */
export async function dbPruneDebugLogs(keepDays = 7): Promise<number> {
  if (!isTauri) return 0;
  try {
    return await invoke<number>('prune_debug_logs', { keepDays });
  } catch {
    return 0;
  }
}

export async function dbGetEmotionRecords(): Promise<EmotionRecord[]> {
  if (!isTauri) return [];
  const result = await invoke<DbEmotionRecord[]>('get_emotion_records');
  return result.map(dbEmotionRecordToEmotionRecord);
}

export async function dbSaveEmotionRecords(records: EmotionRecord[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_emotion_records', { records: records.map(emotionRecordToDb) });
}

export async function dbMigrateFromLocalStorage(
  configJson: string,
  conversationsJson: string,
  emotionRecordsJson: string,
): Promise<void> {
  if (!isTauri) return;
  await invoke('migrate_from_local_storage', {
    configJson,
    conversationsJson,
    emotionRecordsJson,
  });
}

export function isRunningInTauri(): boolean {
  return isTauri;
}

// ========== Character CRUD ==========

interface DbCharacter {
  id: string;
  name: string;
  avatar: string;
  personality: string;
  description: string;
  tags: string;
  greeting_message: string;
  background: string;
  likes: string;
  dislikes: string;
  habits: string;
  catchphrases: string;
  emotion_triggers: string;
  emotion_expressions: string;
  thinking_style: string;
  relationship_stages: string;
  response_style: string;
  identity_anchors: string;
  forbidden_behaviors: string;
  output_format: string;
  memory_importance_threshold: number;
  reflection_enabled: boolean;
  time_awareness_enabled: boolean;
  timezone: string;
  affinity_rate: number;
}

function dbCharacterToCharacter(db: DbCharacter): Character {
  return {
    id: db.id,
    name: db.name,
    avatar: db.avatar,
    personality: db.personality,
    description: db.description,
    tags: JSON.parse(db.tags || '[]'),
    greetingMessage: db.greeting_message,
    background: db.background,
    likes: JSON.parse(db.likes || '[]'),
    dislikes: JSON.parse(db.dislikes || '[]'),
    habits: JSON.parse(db.habits || '[]'),
    catchphrases: JSON.parse(db.catchphrases || '[]'),
    emotionTriggers: db.emotion_triggers,
    emotionExpressions: db.emotion_expressions,
    thinkingStyle: db.thinking_style,
    relationshipStages: db.relationship_stages,
    responseStyle: db.response_style,
    identityAnchors: db.identity_anchors,
    forbiddenBehaviors: db.forbidden_behaviors,
    outputFormat: db.output_format,
    memoryImportanceThreshold: db.memory_importance_threshold,
    reflectionEnabled: db.reflection_enabled,
    timeAwarenessEnabled: db.time_awareness_enabled,
    timezone: db.timezone,
    affinityRate: db.affinity_rate || 0.5,
  };
}

function characterToDb(c: Character) {
  return {
    id: c.id,
    name: c.name,
    avatar: c.avatar,
    personality: c.personality,
    description: c.description,
    tags: JSON.stringify(c.tags),
    greetingMessage: c.greetingMessage,
    background: c.background,
    likes: JSON.stringify(c.likes),
    dislikes: JSON.stringify(c.dislikes),
    habits: JSON.stringify(c.habits),
    catchphrases: JSON.stringify(c.catchphrases),
    emotionTriggers: c.emotionTriggers,
    emotionExpressions: c.emotionExpressions,
    thinkingStyle: c.thinkingStyle,
    relationshipStages: c.relationshipStages,
    responseStyle: c.responseStyle,
    identityAnchors: c.identityAnchors,
    forbiddenBehaviors: c.forbiddenBehaviors,
    outputFormat: c.outputFormat,
    memoryImportanceThreshold: c.memoryImportanceThreshold,
    reflectionEnabled: c.reflectionEnabled,
    timeAwarenessEnabled: c.timeAwarenessEnabled,
    timezone: c.timezone,
    affinityRate: c.affinityRate,
  };
}

export async function dbGetCharacters(): Promise<Character[]> {
  if (!isTauri) return [];
  const result = await invoke<DbCharacter[]>('get_characters');
  return result.map(dbCharacterToCharacter);
}

export async function dbSaveCharacters(characters: Character[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_characters', { characters: characters.map(characterToDb) });
}

export async function dbDeleteCharacter(characterId: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_character', { characterId });
}

// ========== Memory CRUD ==========

interface DbMemory {
  id: string;
  character_id: string;
  conversation_id: string;
  content: string;
  importance: number;
  tags: string;
  created_at: string;
  last_recalled_at: string | null;
  recall_count: number;
}

function dbMemoryToMemory(db: DbMemory): Memory {
  return {
    id: db.id,
    characterId: db.character_id,
    conversationId: db.conversation_id,
    content: db.content,
    importance: db.importance,
    tags: JSON.parse(db.tags || '[]'),
    createdAt: new Date(db.created_at),
    lastRecalledAt: db.last_recalled_at ? new Date(db.last_recalled_at) : undefined,
    recallCount: db.recall_count,
  };
}

function memoryToDb(m: Memory) {
  return {
    id: m.id,
    characterId: m.characterId,
    conversationId: m.conversationId,
    content: m.content,
    importance: m.importance,
    tags: JSON.stringify(m.tags),
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt),
    lastRecalledAt: m.lastRecalledAt ? (m.lastRecalledAt instanceof Date ? m.lastRecalledAt.toISOString() : String(m.lastRecalledAt)) : null,
    recallCount: m.recallCount,
  };
}

export async function dbGetMemories(characterId: string): Promise<Memory[]> {
  if (!isTauri) return [];
  const result = await invoke<DbMemory[]>('get_memories', { characterId });
  return result.map(dbMemoryToMemory);
}

export async function dbSaveMemories(memories: Memory[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_memories', { memories: memories.map(memoryToDb) });
}

// ========== Reflection CRUD ==========

interface DbReflection {
  id: string;
  character_id: string;
  trigger_text: string;
  insight: string;
  emotion_before: string;
  emotion_after: string;
  created_at: string;
}

function dbReflectionToReflection(db: DbReflection): Reflection {
  return {
    id: db.id,
    characterId: db.character_id,
    trigger: db.trigger_text,
    insight: db.insight,
    emotionBefore: db.emotion_before as Reflection['emotionBefore'],
    emotionAfter: db.emotion_after as Reflection['emotionAfter'],
    createdAt: new Date(db.created_at),
  };
}

function reflectionToDb(r: Reflection) {
  return {
    id: r.id,
    characterId: r.characterId,
    triggerText: r.trigger,
    insight: r.insight,
    emotionBefore: r.emotionBefore,
    emotionAfter: r.emotionAfter,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

export async function dbGetReflections(characterId: string): Promise<Reflection[]> {
  if (!isTauri) return [];
  const result = await invoke<DbReflection[]>('get_reflections', { characterId });
  return result.map(dbReflectionToReflection);
}

export async function dbSaveReflections(reflections: Reflection[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_reflections', { reflections: reflections.map(reflectionToDb) });
}

export async function dbClearAllData(): Promise<void> {
  if (!isTauri) return;
  await invoke('clear_all_data');
}

export async function dbClearConversations(): Promise<void> {
  if (!isTauri) return;
  await invoke('clear_conversations');
}

export async function dbClearEmotionRecords(): Promise<void> {
  if (!isTauri) return;
  await invoke('clear_emotion_records');
}

export async function dbClearMemories(): Promise<void> {
  if (!isTauri) return;
  await invoke('clear_memories');
}

export async function dbClearReflections(): Promise<void> {
  if (!isTauri) return;
  await invoke('clear_reflections');
}

// ========== Memory Entry CRUD ==========

interface DbMemoryEntry {
  id: string;
  character_id: string;
  conversation_id: string;
  category: string;
  title: string;
  content: string;
  tags: string;
  importance: number;
  created_at: string;
  trigger_message: string;
}

function dbMemoryEntryToMemoryEntry(db: unknown): MemoryEntry {
  const row = db as Record<string, unknown>;
  return {
    id: row.id as string,
    characterId: (row.character_id as string | undefined) || (row.characterId as string | undefined) || '',
    conversationId: (row.conversation_id as string | undefined) || (row.conversationId as string | undefined) || '',
    category: (row.category as MemoryEntry['category']) || 'user_message',
    title: row.title as string,
    content: row.content as string,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags as string[]) || [],
    importance: row.importance as number,
    createdAt: new Date((row.created_at as string | undefined) || (row.createdAt as string | undefined) || Date.now()),
    triggerMessage: (row.trigger_message as string | undefined) || (row.triggerMessage as string | undefined) || undefined,
  };
}

function memoryEntryToDb(e: MemoryEntry) {
  return {
    id: e.id,
    characterId: e.characterId,
    conversationId: e.conversationId,
    category: e.category,
    title: e.title,
    content: e.content,
    tags: JSON.stringify(e.tags),
    importance: e.importance,
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
    triggerMessage: e.triggerMessage || '',
  };
}

export async function dbGetMemoryEntries(characterId: string): Promise<MemoryEntry[]> {
  if (!isTauri) return [];
  const result = await invoke<DbMemoryEntry[]>('get_memory_entries', { characterId });
  return result.map(dbMemoryEntryToMemoryEntry);
}

export async function dbSearchMemoryEntries(characterId: string, query: string): Promise<MemoryEntry[]> {
  if (!isTauri) return [];
  const result = await invoke<DbMemoryEntry[]>('search_memory_entries', { characterId, query });
  return result.map(dbMemoryEntryToMemoryEntry);
}

export async function dbSaveMemoryEntries(entries: MemoryEntry[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_memory_entries', { entries: entries.map(memoryEntryToDb) });
}

export async function dbDeleteMemoryEntry(entryId: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_memory_entry', { entryId });
}

export async function dbClearMemoryEntries(): Promise<void> {
  if (!isTauri) return;
  await invoke('clear_memory_entries');
}

// ========== Debug Log CRUD ==========

export async function dbGetDebugLogs(): Promise<{ id: string; type: string; message: string; timestamp: string; characterId: string; conversationId: string; duration: number }[]> {
  if (!isTauri) return [];
  return await invoke('get_debug_logs');
}

export async function dbSaveDebugLogs(logs: { id: string; type: string; message: string; timestamp: string; characterId?: string; conversationId?: string; duration?: number }[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_debug_logs', { logs: logs.map(l => ({ ...l, characterId: l.characterId || '', conversationId: l.conversationId || '', duration: l.duration || 0 })) });
}

export async function dbBatchInsertDebugLogs(logs: { id: string; type: string; message: string; timestamp: string; characterId?: string; conversationId?: string; duration?: number }[]): Promise<void> {
  if (!isTauri) return;
  await invoke('batch_insert_debug_logs', { logs: logs.map(l => ({ ...l, characterId: l.characterId || '', conversationId: l.conversationId || '', duration: l.duration || 0 })) });
}

export async function dbDeleteDebugLogsByCharacter(characterId: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_debug_logs_by_character', { characterId });
}

// ========== 输出后处理 Pipeline（Rust 后端版） ==========

export interface PostPipelineRequest {
  text: string;
  emotion: string;
  emotionIntensity: number;
  /** 禁止行为：接受 string（原始文本）或 string[]（已拆分） */
  forbiddenText: string | string[];
  recentReplies: string[];
  cleanMarkersEnabled: boolean;
  blockClicheEnabled: boolean;
  typoSimEnabled: boolean;
  typoProb: number;
  segmentEnabled: boolean;
  segmentThreshold: number;
  maxSegments: number;
  pairProtection: boolean;
  tonePolishEnabled: boolean;
  toneIntensity: number;
  lengthRandomizeEnabled: boolean;
  colloquialismEnabled: boolean;
  smartPunctuationEnabled: boolean;
  speakingRhythmEnabled: boolean;
  finalSanitizeEnabled: boolean;
  normalizeWhitespace: boolean;
  removeDuplicatePunctuation: boolean;
  /** AI 段间基础延迟（segmentDelayMs），后处理阶段据此动态计算每段延迟 */
  segmentDelayMs?: number;
}

export interface PostPipelineResponse {
  text: string;
  segments: string[];
  /** AI 段间延迟数组：第 i 项为第 i+1 段前的等待毫秒数（后处理阶段动态计算） */
  segmentDelays?: number[];
  aborted: boolean;
  abortReason?: string;
  logs: string[];
  stepResults: Array<{ step: string; ok: boolean; aborted: boolean; msg?: string }>;
}

/** 调用 Rust 后处理 Pipeline（Tauri 模式），非 Tauri 返回 null */
export async function processPostPipeline(req: PostPipelineRequest): Promise<PostPipelineResponse | null> {
  if (!isTauri) return null;
  try {
    // forbiddenBehaviors 可能是原始字符串（按换行/分号分隔），统一转成数组
    const forbiddenText = Array.isArray(req.forbiddenText)
      ? req.forbiddenText
      : (req.forbiddenText || '').split(/[；;。\n]/).map(s => s.trim()).filter(Boolean);
    return await invoke('process_post_pipeline', { req: { ...req, forbiddenText } });
  } catch {
    return null;
  }
}

/** 带重试的 Tauri invoke，用于缓解 custom protocol 偶发失败/连接被拒绝的问题（主动回复等后台任务共用） */
export async function invokeWithRetry<T>(cmd: string, args: Record<string, unknown>, maxRetries = 2, delayMs = 300): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      lastError = e;
      const errMsg = e instanceof Error ? e.message : String(e);
      const isBusinessError = /模型返回|API Key|未配置|解析失败|序列化失败|查询失败|数据库/.test(errMsg);
      const isTransportError = /Failed to fetch|ERR_CONNECTION_REFUSED|custom protocol|IPC|timeout|NetworkError|net::|无法连接|connection|网络/.test(errMsg);
      const retryable = i < maxRetries && !isBusinessError && (isTransportError || errMsg.length < 10);
      if (!retryable) throw e;
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

export async function dbDeleteDebugLogsByConversation(conversationId: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_debug_logs_by_conversation', { conversationId });
}

export async function dbClearDebugLogs(): Promise<void> {
  if (!isTauri) return;
  await invoke('clear_debug_logs');
}

/** 🆕 按 ID 批量删除日志（落库） */
export async function dbDeleteDebugLogsByIds(ids: string[]): Promise<void> {
  if (!isTauri || ids.length === 0) return;
  await invoke('delete_debug_logs_by_ids', { ids });
}

// ========== Character Emotion CRUD ==========

export async function dbGetCharacterEmotions(): Promise<Record<string, { emotion: string; intensity: number }>> {
  if (!isTauri) return {};
  const rows = await invoke<{ characterId: string; emotion: string; intensity: number }[]>('get_character_emotions');
  const result: Record<string, { emotion: string; intensity: number }> = {};
  for (const r of rows) {
    result[r.characterId] = { emotion: r.emotion, intensity: r.intensity };
  }
  return result;
}

export async function dbSaveCharacterEmotions(states: Record<string, { emotion: string; intensity: number }>): Promise<void> {
  if (!isTauri) return;
  const emotions = Object.entries(states).map(([characterId, s]) => ({ characterId, emotion: s.emotion, intensity: s.intensity }));
  await invoke('save_character_emotions', { emotions });
}

// ========== Character Affinity CRUD ==========

export async function dbGetCharacterAffinities(): Promise<Record<string, { level: number; stage: string; history: string; lastInteraction: string }>> {
  if (!isTauri) return {};
  const rows = await invoke<{ characterId: string; level: number; stage: string; history: string; lastInteraction: string }[]>('get_character_affinities');
  const result: Record<string, { level: number; stage: string; history: string; lastInteraction: string }> = {};
  for (const r of rows) {
    result[r.characterId] = { level: r.level, stage: r.stage, history: r.history, lastInteraction: r.lastInteraction };
  }
  return result;
}

export async function dbSaveCharacterAffinities(states: Record<string, { level: number; stage: string; history: string; lastInteraction: string }>): Promise<void> {
  if (!isTauri) return;
  const affinities = Object.entries(states).map(([characterId, s]) => ({
    characterId,
    level: s.level,
    stage: s.stage,
    history: s.history,
    lastInteraction: s.lastInteraction,
  }));
  await invoke('save_character_affinities', { affinities });
}

// ========== Deleted Memory Entries (Recycle Bin) ==========

export async function dbGetDeletedMemoryEntries(): Promise<MemoryEntry[]> {
  if (!isTauri) return [];
  const rows = await invoke<Array<Record<string, unknown>>>('get_deleted_memory_entries');
  return rows.map(r => ({
    id: r.id as string,
    characterId: r.characterId as string,
    conversationId: r.conversationId as string,
    category: r.category as MemoryEntry['category'],
    title: r.title as string,
    content: r.content as string,
    tags: JSON.parse((r.tags as string) || '[]'),
    importance: r.importance as number,
    createdAt: new Date(r.createdAt as string | number | Date),
    triggerMessage: (r.triggerMessage as string | undefined) || undefined,
    deletedAt: new Date(r.deletedAt as string | number | Date),
  }));
}

export async function dbSaveDeletedMemoryEntries(entries: MemoryEntry[]): Promise<void> {
  if (!isTauri) return;
  const serialized = entries.map(e => {
    const deletedAt = (e as unknown as MemoryEntry & { deletedAt: Date }).deletedAt;
    return {
      id: e.id,
      characterId: e.characterId,
      conversationId: e.conversationId,
      category: e.category,
      title: e.title,
      content: e.content,
      tags: JSON.stringify(e.tags),
      importance: e.importance,
      createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
      triggerMessage: e.triggerMessage || '',
      deletedAt: deletedAt instanceof Date ? deletedAt.toISOString() : String(deletedAt || ''),
    };
  });
  await invoke('save_deleted_memory_entries', { entries: serialized });
}

export async function dbClearDeletedMemoryEntries(): Promise<void> {
  if (!isTauri) return;
  await invoke('clear_deleted_memory_entries');
}

// ========== Cursor-based Pagination ==========

export interface PaginatedMemoryEntries {
  entries: MemoryEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function dbGetMemoryEntriesPage(
  characterId?: string,
  category?: string,
  cursor?: string,
  limit?: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<PaginatedMemoryEntries> {
  if (!isTauri) return { entries: [], nextCursor: null, hasMore: false };
  const result = await invoke<{
    entries: DbMemoryEntry[];
    nextCursor: string | null;
    hasMore: boolean;
  }>('get_memory_entries_page', {
    characterId: characterId || null,
    category: category || null,
    cursor: cursor || null,
    limit: limit || 30,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  });
  return {
    entries: result.entries.map(dbMemoryEntryToMemoryEntry),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
  };
}

export interface PaginatedDebugLogs {
  logs: { id: string; type: string; message: string; timestamp: string; characterId: string; conversationId: string; duration: number }[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function dbGetDebugLogsPage(
  characterId?: string,
  logType?: string,
  conversationId?: string,
  cursor?: string,
  limit?: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<PaginatedDebugLogs> {
  if (!isTauri) return { logs: [], nextCursor: null, hasMore: false };
  return await invoke('get_debug_logs_page', {
    characterId: characterId || null,
    logType: logType || null,
    conversationId: conversationId || null,
    cursor: cursor || null,
    limit: limit || 300,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  });
}

export async function dbGetDebugLogsCount(
  characterId?: string,
  logType?: string,
  conversationId?: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<number> {
  if (!isTauri) return 0;
  return await invoke('get_debug_logs_count', {
    characterId: characterId || null,
    logType: logType || null,
    conversationId: conversationId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
  });
}

/**
 * 获取数据库中有数据的日期集合(从新到旧排序)。
 * 用于时间轴显示:这样时间轴可以显示用户数据真实存在的日期。
 */
export async function dbGetMemoryEntriesAvailableDates(
  characterId?: string,
  category?: string,
): Promise<string[]> {
  if (!isTauri) return [];
  return await invoke<string[]>('get_memory_entries_available_dates', {
    characterId: characterId || null,
    category: category || null,
  });
}

export async function dbGetDebugLogsAvailableDates(
  characterId?: string,
  logType?: string,
  conversationId?: string,
): Promise<string[]> {
  if (!isTauri) return [];
  return await invoke<string[]>('get_debug_logs_available_dates', {
    characterId: characterId || null,
    logType: logType || null,
    conversationId: conversationId || null,
  });
}

export async function dbGetEmotionRecordsAvailableDates(
  characterId?: string,
): Promise<string[]> {
  if (!isTauri) return [];
  return await invoke<string[]>('get_emotion_records_available_dates', {
    characterId: characterId || null,
  });
}

// ========== Model Role Config ==========

interface DbModelRoleConfig {
  assignments: Record<string, Array<{ platformIndex: number; modelName: string }>>;
  maxRetriesPerModel: number;
  segmentConfig?: {
    enabled: boolean;
    threshold: number;
    maxSegments: number;
    mode?: string;
    minSegmentLength?: number;
    segmentDelayMs?: number;
    replyDelayMs?: number;
    replyDelayRandomEnabled?: boolean;
    replyDelayRandomMs?: number;
    userReplyDelayMs?: number;
    userReplyDelayRandomEnabled?: boolean;
    userReplyDelayRandomMs?: number;
    showTypingIndicator?: boolean;
    protectPairedSymbols?: boolean;
  };
  messageProcessingConfig?: {
    enabled?: boolean;
    cleanThinkingMarkers?: boolean;
    blockAICliche?: boolean;
    removeDuplicatePunctuation?: boolean;
    normalizeWhitespace?: boolean;
    tonePolish?: boolean;
  };
  proactiveReplyConfig?: {
    enabled?: boolean;
    minIntervalMinutes?: number;
    scheduledTimes?: string[];
    maxProactivePerDay?: number;
    proactiveProbability?: number;
    customPrompt?: string;
  };
  chainProactiveConfig?: {
    enabled?: boolean;
    customPrompt?: string;
    conversationId?: string;
    dayMinMinutes?: number;
    dayMaxMinutes?: number;
    nightMinMinutes?: number;
    nightMaxMinutes?: number;
    nightStart?: string;
    nightEnd?: string;
    randomFactor?: number;
    callbackEnabled?: boolean;
    callbackDelayMinutes?: number;
  };
}

export async function dbGetModelRoles(): Promise<DbModelRoleConfig | null> {
  if (!isTauri) return null;
  try {
    const result = await invoke<DbModelRoleConfig | null>('get_model_roles');
    return result;
  } catch {
    return null;
  }
}

export async function dbSaveModelRoles(config: DbModelRoleConfig): Promise<void> {
  if (!isTauri) return;
  await invoke('save_model_roles', { config });
}

// ========== File Picker ==========

export interface PickedFile {
  name: string;
  path: string;
  size: number;
  mimeType: string;
}

/**
 * Infer MIME type from file extension.
 */
export function inferMimeType(filename: string, fallback: string = 'application/octet-stream'): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    // Images
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
    'svg': 'image/svg+xml', 'ico': 'image/x-icon', 'tiff': 'image/tiff',
    'tif': 'image/tiff', 'avif': 'image/avif', 'heic': 'image/heic',
    'heif': 'image/heif',
    // Videos
    'mp4': 'video/mp4', 'webm': 'video/webm', 'ogg': 'video/ogg',
    'mov': 'video/quicktime', 'avi': 'video/x-msvideo', 'mkv': 'video/x-matroska',
    'flv': 'video/x-flv', 'wmv': 'video/x-ms-wmv',
    // Audio
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'aac': 'audio/aac',
    'flac': 'audio/flac', 'm4a': 'audio/mp4', 'wma': 'audio/x-ms-wma',
    'opus': 'audio/opus',
    // Documents
    'pdf': 'application/pdf', 'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain', 'md': 'text/markdown', 'csv': 'text/csv',
    'json': 'application/json', 'xml': 'application/xml',
    // Archives
    'zip': 'application/zip', 'rar': 'application/vnd.rar',
    '7z': 'application/x-7z-compressed', 'tar': 'application/x-tar',
    'gz': 'application/gzip',
  };
  return mimeMap[ext] || fallback;
}

export async function pickFiles(accept: string[] = []): Promise<PickedFile[]> {
  if (!isTauri) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      if (accept.length > 0) input.accept = accept.join(',');
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        const result: PickedFile[] = [];
        for (const f of files) {
          result.push({
            name: f.name,
            path: f.name,
            size: f.size,
            mimeType: f.type || inferMimeType(f.name),
          });
        }
        resolve(result);
      };
      input.click();
    });
  }
  try {
    return await invoke<PickedFile[]>('pick_files', { accept });
  } catch {
    return [];
  }
}

export async function pickImages(): Promise<PickedFile[]> {
  return pickFiles(['image/*']);
}

export async function readFileAsBase64(path: string): Promise<string> {
  if (!isTauri) {
    return '';
  }
  try {
    return await invoke<string>('read_file_base64', { path });
  } catch {
    return '';
  }
}

export async function downloadAndSaveFile(url: string, filename: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string>('download_and_save_file', { url, filename });
  } catch (e) {
    console.error('Failed to download file:', e);
    return null;
  }
}

export async function getAppDataDir(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string>('get_app_data_dir');
  } catch {
    return null;
  }
}

// ========== Bot Integrations ==========

export interface BotIntegration {
  id: string;
  type: string;
  enabled: boolean;
  config: string;
  createdAt: string;
  updatedAt: string;
}

export interface BotConversation {
  id: string;
  integrationId: string;
  externalUserId: string;
  externalUserName: string;
  characterId: string;
  conversationId: string;
  /** 🆕 群聊会话的群ID（非空表示群会话，供主动回复路由到群） */
  externalGroupId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BotIntegrationConfig {
  ws_url: string;
  /** 🆕 NapCat 连接模式：server=反向WS（本应用监听，默认）；client=正向WS（主动连 NapCat） */
  ws_mode?: string;
  http_url: string;
  token: string;
  auto_reply: boolean;
  character_id: string;
  private_chat_enabled: boolean;
  group_chat_enabled: boolean;
  allowed_users_enabled: boolean;
  allowed_users: string;
  allowed_groups_enabled: boolean;
  allowed_groups: string;
  blocked_users_enabled: boolean;
  blocked_users: string;
  blocked_groups_enabled: boolean;
  blocked_groups: string;
  /** 🆕 QQ 开放平台：AppID */
  app_id?: string;
  /** 🆕 QQ 开放平台：AppSecret */
  client_secret?: string;
  /** 🆕 ClawBot（旧 HTTP 回调遗留）：机器人框架 HTTP API 地址 */
  api_url?: string;
  /** 🆕 ClawBot（旧 HTTP 回调遗留）：本机回调监听端口 */
  callback_port?: number;
  /** 🆕 ClawBot iLink 扫码登录：Bot Token（扫码后 Rust 自动回填） */
  bot_token?: string;
  /** 🆕 ClawBot iLink 扫码登录：Bot ID（xxx@im.bot） */
  ilink_bot_id?: string;
  /** 🆕 ClawBot iLink 扫码登录：API 基础地址 */
  base_url?: string;
  /** 🆕 ClawBot iLink 长轮询游标（Rust 自动维护） */
  get_updates_buf?: string;
}

export async function dbGetBotIntegrations(): Promise<BotIntegration[]> {
  if (!isTauri) return [];
  try {
    return await invoke<BotIntegration[]>('get_bot_integrations');
  } catch {
    return [];
  }
}

export async function dbSaveBotIntegration(
  id: string,
  type: string,
  enabled: boolean,
  config: string,
): Promise<boolean> {
  if (!isTauri) return false;
  try {
    // Rust 命令签名为 save_bot_integration(integration: Value)，必须整体作为 integration 对象传入
    await invoke('save_bot_integration', {
      integration: { id, type, enabled, config },
    });
    return true;
  } catch {
    return false;
  }
}

export async function dbDeleteBotIntegration(id: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('delete_bot_integration', { id });
    return true;
  } catch {
    return false;
  }
}

export async function dbGetBotConversations(integrationId?: string): Promise<BotConversation[]> {
  if (!isTauri) return [];
  try {
    return await invoke<BotConversation[]>('get_bot_conversations', {
      integrationId: integrationId || null,
    });
  } catch {
    return [];
  }
}

export async function dbSaveBotConversation(
  id: string,
  integrationId: string,
  externalUserId: string,
  externalUserName: string,
  characterId: string,
  conversationId: string,
  externalGroupId?: string | null,
): Promise<boolean> {
  if (!isTauri) return false;
  try {
    // 🔧 修复：Rust 命令签名为 save_bot_conversation(conversation: Value, ...)，
    // 此前传平铺参数导致 missing key `conversation` 错误被静默吞掉，映射从未持久化（重启即丢）。
    // 现整体作为 conversation 对象传入，并兼容外部群ID字段。
    await invoke('save_bot_conversation', {
      conversation: {
        id,
        integrationId,
        externalUserId,
        externalUserName,
        characterId,
        conversationId,
        externalGroupId: externalGroupId || null,
      },
    });
    return true;
  } catch (e) {
    console.error('[tauriBridge] dbSaveBotConversation failed:', e);
    return false;
  }
}

export async function dbDeleteBotConversation(id: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('delete_bot_conversation', { id });
    return true;
  } catch {
    return false;
  }
}

export async function startBotIntegration(id: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('start_bot_integration', { integrationId: id });
    return true;
  } catch (e) {
    console.error('Failed to start bot integration:', e);
    return false;
  }
}

export async function stopBotIntegration(id: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('stop_bot_integration', { integrationId: id });
    return true;
  } catch {
    return false;
  }
}

export async function sendBotMessage(integrationId: string, userId: number, message: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('send_bot_message', { integrationId, userId, message });
    return true;
  } catch (e) {
    console.error('Failed to send bot message:', e);
    return false;
  }
}

/** 🆕 统一回复：按接入类型分发到对应平台（Rust send_bot_reply） */
export async function sendBotReply(
  integrationId: string,
  integrationType: string,
  userId: string,
  groupId: string | null,
  message: string,
): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('send_bot_reply', {
      integrationId,
      integrationType,
      userId,
      groupId: groupId || null,
      message,
    });
    return true;
  } catch (e) {
    console.error('Failed to send bot reply:', e);
    return false;
  }
}

export async function sendBotGroupMessage(integrationId: string, groupId: number, message: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('send_bot_group_message', { integrationId, groupId, message });
    return true;
  } catch (e) {
    console.error('Failed to send bot group message:', e);
    return false;
  }
}

export async function sendWechatMessage(integrationId: string, userId: string, message: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('send_wechat_message', { integrationId, userId, message });
    return true;
  } catch (e) {
    console.error('Failed to send wechat message:', e);
    return false;
  }
}

export async function testBotConnection(id: string): Promise<{ success: boolean; message: string }> {
  if (!isTauri) return { success: false, message: '非 Tauri 环境' };
  try {
    return await invoke<{ success: boolean; message: string }>('test_bot_connection', { integrationId: id });
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

/** 🆕 通用二维码生成：文本渲染为 SVG data URL */
export async function generateQrcode(text: string): Promise<string> {
  if (!isTauri) return '';
  try {
    return await invoke<string>('generate_qrcode', { text });
  } catch {
    return '';
  }
}

export async function getBotStatuses(): Promise<Record<string, { status: string; message: string }>> {
  if (!isTauri) return {};
  try {
    return await invoke<Record<string, { status: string; message: string }>>('get_bot_statuses');
  } catch {
    return {};
  }
}

// ========== MCP（Model Context Protocol）==========

export interface McpServer {
  id: string;
  name: string;
  /** "stdio" | "http" */
  transport: string;
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  description: string;
}

export interface McpTool {
  name: string;
  /** 注入 LLM 时使用的名称（mcp__{server}__{tool}） */
  llmName?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export async function mcpGetServers(): Promise<McpServer[]> {
  if (!isTauri) return [];
  try {
    return await invoke<McpServer[]>('mcp_get_servers');
  } catch (e) {
    console.error('[MCP] mcp_get_servers failed:', e);
    return [];
  }
}

export async function mcpSaveServer(server: McpServer): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('mcp_save_server', { server });
    return true;
  } catch (e) {
    console.error('[MCP] mcp_save_server failed:', e);
    return false;
  }
}

export async function mcpDeleteServer(id: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('mcp_delete_server', { id });
    return true;
  } catch (e) {
    console.error('[MCP] mcp_delete_server failed:', e);
    return false;
  }
}

export async function mcpConnect(id: string): Promise<{ ok: boolean; tools: McpTool[] }> {
  if (!isTauri) return { ok: false, tools: [] };
  return await invoke<{ ok: boolean; tools: McpTool[] }>('mcp_connect', { id });
}

export async function mcpDisconnect(id: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('mcp_disconnect', { id });
    return true;
  } catch {
    return false;
  }
}

export async function mcpListTools(id: string): Promise<McpTool[]> {
  if (!isTauri) return [];
  return await invoke<McpTool[]>('mcp_list_tools', { id });
}

export async function mcpCallTool(id: string, name: string, argumentsJson?: string): Promise<string> {
  if (!isTauri) throw new Error('非 Tauri 环境');
  return await invoke<string>('mcp_call_tool', { id, name, argumentsJson: argumentsJson || null });
}

export async function mcpStatus(): Promise<Array<{ id: string; connected: boolean; toolCount: number }>> {
  if (!isTauri) return [];
  try {
    return await invoke<Array<{ id: string; connected: boolean; toolCount: number }>>('mcp_status');
  } catch {
    return [];
  }
}

// ========== File DB CRUD ==========

export async function saveFileToDb(
  id: string,
  name: string,
  mimeType: string,
  data: Uint8Array,
  characterId?: string,
  conversationId?: string,
): Promise<string | null> {
  if (!isTauri) return null;
  try {
    // Use efficient chunked base64 encoding via Blob + FileReader
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data:...;base64, prefix
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([data]));
    });

    const actualId = await invoke<string>('save_file_to_db', {
      id,
      filename: name,
      mimeType,
      data: base64,
      size: data.length,
      characterId: characterId || null,
      conversationId: conversationId || null,
    });
    return actualId;
  } catch (e) {
    console.error('[tauriBridge] saveFileToDb failed:', e);
    return null;
  }
}

interface DbFileRecord {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  character_id: string | null;
  conversation_id: string | null;
  created_at: string;
}

interface DbFileData extends DbFileRecord {
  data: string;
}

export async function getFileFromDb(id: string): Promise<{
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  data: string;
  characterId: string | undefined;
  conversationId: string | undefined;
  createdAt: string;
} | null> {
  if (!isTauri) return null;
  try {
    const result = await invoke<DbFileData>('get_file_from_db', { id });
    if (!result) return null;
    return {
      id: result.id,
      filename: result.filename,
      mimeType: result.mime_type,
      size: result.size,
      data: result.data,
      characterId: result.character_id || undefined,
      conversationId: result.conversation_id || undefined,
      createdAt: result.created_at,
    };
  } catch {
    return null;
  }
}

export async function getFileDataOnly(id: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const result = await invoke<{ data: string }>('get_file_data_only', { id });
    return result?.data || null;
  } catch {
    return null;
  }
}

/**
 * 🆕 性能优化：通过自定义协议直接以二进制流加载文件内容。
 * 相比 getFileDataOnly（BLOB→base64→JSON→IPC→JS 解码，内存放大 ~3 倍），
 * 该 URL 由 WebView 原生请求 Rust 直出字节流并自带 HTTP 缓存，
 * 适合 <img>/<video>/<audio> 的 src 与大文件预览。
 */
export function fileBlobUrl(id: string): string {
  return `http://file-blob.localhost/${encodeURIComponent(id)}`;
}

export async function getFilesPage(
  characterId?: string,
  conversationId?: string,
  mimeTypeFilter?: string,
  cursor?: string,
  limit?: number,
): Promise<{
  files: { id: string; filename: string; mimeType: string; size: number; characterId: string | null; conversationId: string | null; createdAt: string }[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  if (!isTauri) return { files: [], nextCursor: null, hasMore: false };
  try {
    const result = await invoke<{
      files: DbFileRecord[];
      nextCursor: string | null;
      hasMore: boolean;
    }>('get_files_page', {
      characterId: characterId || null,
      conversationId: conversationId || null,
      mimeTypeFilter: mimeTypeFilter || null,
      cursor: cursor || null,
      limit: limit || 30,
    });
    return {
      files: result.files.map((f) => ({
        id: f.id,
        filename: f.filename,
        mimeType: f.mime_type,
        size: f.size,
        characterId: f.character_id,
        conversationId: f.conversation_id,
        createdAt: f.created_at,
      })),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  } catch {
    return { files: [], nextCursor: null, hasMore: false };
  }
}

export async function deleteFileFromDb(id: string): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke('delete_file_from_db', { id });
  } catch (e) {
    console.error('[tauriBridge] deleteFileFromDb failed:', e);
  }
}

export async function getFileStats(): Promise<{
  total: number;
  totalSize: number;
  byType: Record<string, { count: number; size: number }>;
}> {
  if (!isTauri) return { total: 0, totalSize: 0, byType: {} };
  try {
    return await invoke('get_file_stats');
  } catch {
    return { total: 0, totalSize: 0, byType: {} };
  }
}

// ========== MBTI Tests ==========

export interface DbMbtiTest {
  id: string;
  type: string;
  dimensions: string;
  completedAt: string;
}

export async function dbGetMbtiTests(): Promise<DbMbtiTest[]> {
  if (!isTauri) return [];
  try {
    return await invoke<DbMbtiTest[]>('get_mbti_tests');
  } catch {
    return [];
  }
}

export async function dbSaveMbtiTest(id: string, typeCode: string, dimensions: string, completedAt: string): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke('save_mbti_test', { id, typeCode: typeCode, dimensions, completedAt });
  } catch (e) {
    console.error('[tauriBridge] dbSaveMbtiTest failed:', e);
  }
}

export async function dbDeleteMbtiTest(id: string): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke('delete_mbti_test', { id });
  } catch (e) {
    console.error('[tauriBridge] dbDeleteMbtiTest failed:', e);
  }
}

// ========== User Profile ==========

export interface DbUserProfile {
  avatar: string;
  nickname: string;
  age: string;
  gender: string;
  mbti: string;
  birthday: string;
  personality: string;
  background: string;
  interests: string;
  habits: string;
  notes: string;
}

export async function dbGetUserProfile(): Promise<DbUserProfile> {
  if (!isTauri) return { avatar: '', nickname: '', age: '', gender: '', mbti: '', birthday: '', personality: '', background: '', interests: '', habits: '', notes: '' };
  try {
    return await invoke<DbUserProfile>('get_user_profile');
  } catch {
    return { avatar: '', nickname: '', age: '', gender: '', mbti: '', birthday: '', personality: '', background: '', interests: '', habits: '', notes: '' };
  }
}

export async function dbSaveUserProfile(profile: DbUserProfile): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke('save_user_profile', {
      avatar: profile.avatar,
      nickname: profile.nickname,
      age: profile.age,
      gender: profile.gender,
      mbti: profile.mbti,
      birthday: profile.birthday,
      personality: profile.personality,
      background: profile.background,
      interests: profile.interests,
      habits: profile.habits,
      notes: profile.notes,
    });
  } catch (e) {
    console.error('[tauriBridge] dbSaveUserProfile failed:', e);
  }
}

// ========== Backup CRUD ==========

export interface BackupMeta {
  id: string;
  label: string;
  createdAt: string;
  sizeBytes: number;
}

export async function dbGetBackups(): Promise<BackupMeta[]> {
  if (!isTauri) return [];
  try {
    return await invoke<BackupMeta[]>('get_backups');
  } catch {
    return [];
  }
}

export async function dbCreateBackup(id: string, label: string, dataJson: string): Promise<void> {
  if (!isTauri) return;
  await invoke('create_backup', { id, label, dataJson });
}

export async function dbGetBackupData(backupId: string): Promise<string | null> {
  if (!isTauri) return null;
  try {
    return await invoke<string | null>('get_backup_data', { backupId });
  } catch {
    return null;
  }
}

export async function dbDeleteBackup(backupId: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_backup', { backupId });
}

export async function dbPruneOldBackups(keepCount: number): Promise<void> {
  if (!isTauri) return;
  await invoke('prune_old_backups', { keepCount });
}

export async function dbGetBackupCount(): Promise<number> {
  if (!isTauri) return 0;
  try {
    return await invoke<number>('get_backup_count');
  } catch {
    return 0;
  }
}

// ========== UI Config (SQLite) ==========

export async function dbGetUiConfig(): Promise<Record<string, unknown> | null> {
  if (!isTauri) return null;
  try {
    const result = await invoke<Record<string, unknown> | null>('get_ui_config');
    return result ?? null;
  } catch {
    return null;
  }
}

export async function dbSaveUiConfig(config: Record<string, unknown>): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke('save_ui_config', { config });
  } catch (e) {
    console.error('[tauriBridge] dbSaveUiConfig failed:', e);
  }
}

// ========== AI Life（AI 一日生活） ==========

/** 活动槽位评论 */
export interface AiActivityComment {
  id: string;
  content: string;
  timestamp: string;
  type: 'user' | 'ai' | string;
}

/** 🆕 B7 活动过程节点（引擎掷骰、LLM 叙事；start/mid/end/interrupted 四相） */
export interface AiActivityStep {
  time: string;
  phase: 'start' | 'mid' | 'end' | 'interrupted';
  note: string;
}

/** 活动条目（与 Rust ai_activities 表字段一一对应，ISO 时间戳） */
export interface AiLifeActivity {
  id: string;
  characterId: string;
  name: string;
  category: string;
  startTime: string;
  endTime: string;
  sceneId: string;
  status: 'planned' | 'ongoing' | 'completed' | 'interrupted' | 'cancelled' | string;
  processDescription: string;
  summary: string;
  mood: string;
  location: string;
  weather: string;
  isChanged: boolean;
  changedFrom: string;
  changedReason: string;
  replacedBy: string;
  comments: AiActivityComment[];
  /** 🆕 B7: 结构化过程时间轴 */
  steps?: AiActivityStep[];
  createdAt: string;
  updatedAt: string;
}

/** 每角色生活引擎配置 */
export interface AiLifeConfig {
  characterId: string;
  enabled: boolean;
  contentLevel: 'off' | 'minimal' | 'simplified' | 'full' | string;
  eventFrequency: 'off' | 'low' | 'medium' | 'high' | string;
  scheduleMode: 'auto' | 'custom' | string;
  customSchedule: unknown[];
  lastActiveTime: string;
  extra: Record<string, unknown>;
  updatedAt: string;
}

export async function dbGetAiActivities(
  characterId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<AiLifeActivity[]> {
  // 🆕 B1.1: 双后端路由——浏览器模式写 IndexedDB
  if (!isTauri) return ailifeIdb.idbGetAiActivities(characterId, dateFrom, dateTo);
  try {
    return await invoke<AiLifeActivity[]>('get_ai_activities', {
      characterId,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    });
  } catch (e) {
    console.error('[tauriBridge] dbGetAiActivities failed:', e);
    return [];
  }
}

export async function dbBatchSaveAiActivities(activities: AiLifeActivity[]): Promise<void> {
  if (!isTauri) return ailifeIdb.idbBatchSaveAiActivities(activities);
  await invoke('batch_save_ai_activities', { activities });
}

// ========== 🆕 B4: 活动事件流 ai_life_events ==========

/** 生活事件（B4 事件流表行） */
export interface AiLifeEvent {
  id: string;
  characterId: string;
  ts: string;
  type: 'meal' | 'drink' | 'consume' | 'purchase' | 'random_event' | 'plan_change' | 'milestone' | 'fallback' | 'income';
  description: string;
  activityId?: string;
  itemId?: string;
  meta?: Record<string, unknown>;
  injectedIntoChat?: boolean;
}

export async function dbBatchSaveAiLifeEvents(events: AiLifeEvent[]): Promise<void> {
  if (!isTauri) return ailifeIdb.idbBatchSaveAiLifeEvents(events);
  await invoke('batch_save_ai_life_events', { events });
}

export async function dbGetAiLifeEvents(characterId: string, tsFrom?: string, tsTo?: string, limit?: number): Promise<AiLifeEvent[]> {
  if (!isTauri) return ailifeIdb.idbGetAiLifeEvents(characterId, tsFrom, tsTo, limit);
  return await invoke('get_ai_life_events', { characterId, tsFrom: tsFrom ?? null, tsTo: tsTo ?? null, limit: limit ?? null });
}

export async function dbMarkAiLifeEventsInjected(ids: string[]): Promise<void> {
  if (!isTauri) return ailifeIdb.idbMarkAiLifeEventsInjected(ids);
  await invoke('mark_ai_life_events_injected', { ids });
}

// ========== 🆕 D4: 创意工坊 ai_content_proposals ==========

/** AI 内容提案（事件/商品候选，用户审核后入池） */
export interface AiContentProposal {
  id: string;
  characterId: string;
  /** random_event | shop_item */
  kind: 'random_event' | 'shop_item' | string;
  title: string;
  /** 领域 schema：random_event → RandomEventDef 子集；shop_item → {name,category,price,...} */
  payload?: Record<string, unknown>;
  /** 提案理由（从当天真实经历提炼） */
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'retired' | string;
  createdAt: string;
  decidedAt?: string;
}

export async function dbSaveAiContentProposals(proposals: AiContentProposal[]): Promise<void> {
  if (!isTauri) return ailifeIdb.idbSaveAiContentProposals(proposals);
  await invoke('save_ai_content_proposals', { proposals });
}

export async function dbGetAiContentProposals(characterId?: string, status?: string, limit?: number): Promise<AiContentProposal[]> {
  if (!isTauri) return ailifeIdb.idbGetAiContentProposals(characterId, status, limit);
  return await invoke('get_ai_content_proposals', { characterId: characterId ?? null, status: status ?? null, limit: limit ?? null });
}

export async function dbDecideAiContentProposal(id: string, status: 'approved' | 'rejected' | 'retired'): Promise<void> {
  if (!isTauri) return ailifeIdb.idbDecideAiContentProposal(id, status);
  await invoke('decide_ai_content_proposal', { id, status });
}

export async function dbDeleteAiActivitiesByDate(characterId: string, dateFrom: string, dateTo: string): Promise<void> {
  if (!isTauri) return ailifeIdb.idbDeleteAiActivitiesByDate(characterId, dateFrom, dateTo);
  await invoke('delete_ai_activities_by_date', { characterId, dateFrom, dateTo });
}

export async function dbGetCurrentAiActivity(characterId: string, now?: string): Promise<AiLifeActivity | null> {
  if (!isTauri) return ailifeIdb.idbGetCurrentAiActivity(characterId, now);
  try {
    return await invoke<AiLifeActivity | null>('get_current_ai_activity', {
      characterId,
      now: now || new Date().toISOString(),
    });
  } catch {
    return null;
  }
}

export async function dbUpdateAiActivityStatus(id: string, status: string): Promise<void> {
  if (!isTauri) return ailifeIdb.idbUpdateAiActivityStatus(id, status);
  await invoke('update_ai_activity_status', { id, status });
}

export async function dbGetAiActivitiesAvailableDates(characterId?: string): Promise<string[]> {
  if (!isTauri) return ailifeIdb.idbGetAiActivitiesAvailableDates(characterId);
  try {
    return await invoke<string[]>('get_ai_activities_available_dates', { characterId: characterId || null });
  } catch {
    return [];
  }
}

export async function dbGetAiLifeConfig(characterId: string): Promise<AiLifeConfig> {
  const fallback: AiLifeConfig = {
    characterId, enabled: false, contentLevel: 'full', eventFrequency: 'medium',
    scheduleMode: 'auto', customSchedule: [], lastActiveTime: '', extra: {}, updatedAt: '',
  };
  // 🆕 B1.1: 启动门禁修复——浏览器模式读 IndexedDB 配置（首次未初始化返回默认 enabled:false）
  if (!isTauri) return (await ailifeIdb.idbGetAiLifeConfig(characterId)) ?? fallback;
  try {
    return await invoke<AiLifeConfig>('get_ai_life_config', { characterId });
  } catch {
    return fallback;
  }
}

export async function dbSaveAiLifeConfig(config: AiLifeConfig): Promise<void> {
  if (!isTauri) return ailifeIdb.idbSaveAiLifeConfig(config);
  await invoke('save_ai_life_config', { config });
}

/** AI 一日日记（存 ai_diaries 表） */
export interface AiLifeDiaryRecord {
  id: string;
  characterId: string;
  date: string;
  title: string;
  content: string;
  mood: string;
  activities: unknown[];
  thoughts: unknown[];
  comments: unknown[];
  createdAt: string;
  updatedAt: string;
}

export async function dbGetAiDiaries(characterId: string, dateFrom?: string, dateTo?: string): Promise<AiLifeDiaryRecord[]> {
  if (!isTauri) return ailifeIdb.idbGetAiDiaries(characterId, dateFrom, dateTo);
  try {
    return await invoke<AiLifeDiaryRecord[]>('get_ai_diaries', {
      characterId,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
    });
  } catch {
    return [];
  }
}

export async function dbSaveAiDiary(diary: AiLifeDiaryRecord): Promise<void> {
  if (!isTauri) return ailifeIdb.idbSaveAiDiary(diary);
  await invoke('save_ai_diary', { diary });
}

export async function dbDeleteAiDiaryRecord(id: string): Promise<void> {
  if (!isTauri) return ailifeIdb.idbDeleteAiDiaryRecord(id);
  await invoke('delete_ai_diary', { id });
}

// ---------- AI Life 属性 / 物资 / 经济 / 世界包 ----------

export interface AiLifeAttributes {
  characterId: string;
  health: number;
  stamina: number;
  satiety: number;
  /** 🆕 B2.1 七维属性：口渴 */
  thirst: number;
  cleanliness: number;
  spirit: number;
  stress: number;
  timestamp: string;
}

export async function dbGetAiAttributes(characterId: string): Promise<AiLifeAttributes | null> {
  if (!isTauri) return ailifeIdb.idbGetAiAttributes<AiLifeAttributes>(characterId);
  try {
    return await invoke<AiLifeAttributes | null>('get_ai_attributes', { characterId });
  } catch {
    return null;
  }
}

export async function dbSaveAiAttributes(snapshot: AiLifeAttributes & { id: string; reason?: string }): Promise<void> {
  if (!isTauri) return ailifeIdb.idbSaveAiAttributes(snapshot);
  await invoke('save_ai_attributes', { snapshot });
}

export interface AiInventoryItem {
  id: string;
  characterId: string;
  category: 'food' | 'clothing' | 'tool' | 'medicine' | 'asset' | string;
  name: string;
  quantity: number;
  quality: string;
  extra: Record<string, unknown>;
  updatedAt: string;
}

export async function dbGetAiInventory(characterId: string): Promise<AiInventoryItem[]> {
  if (!isTauri) return ailifeIdb.idbGetAiInventory(characterId);
  try {
    return await invoke<AiInventoryItem[]>('get_ai_inventory', { characterId });
  } catch {
    return [];
  }
}

export async function dbSaveAiInventoryItems(items: AiInventoryItem[]): Promise<void> {
  if (!isTauri) return ailifeIdb.idbSaveAiInventoryItems(items);
  await invoke('save_ai_inventory_items', { items });
}

export async function dbDeleteAiInventoryItem(id: string): Promise<void> {
  if (!isTauri) return ailifeIdb.idbDeleteAiInventoryItem(id);
  await invoke('delete_ai_inventory_item', { id });
}

export interface AiEconomy {
  characterId: string;
  balance: number;
  monthlyIncome: number;
  monthlyExpense: number;
  lastPayday: string;
  updatedAt: string;
}

export async function dbGetAiEconomy(characterId: string): Promise<AiEconomy | null> {
  if (!isTauri) return ailifeIdb.idbGetAiEconomy<AiEconomy>(characterId);
  try {
    return await invoke<AiEconomy>('get_ai_economy', { characterId });
  } catch {
    return null;
  }
}

export async function dbSaveAiEconomy(economy: AiEconomy): Promise<void> {
  if (!isTauri) return ailifeIdb.idbSaveAiEconomy(economy);
  await invoke('save_ai_economy', { economy });
}

export interface AiTransaction {
  id: string;
  characterId: string;
  type: 'income' | 'expense' | string;
  amount: number;
  description: string;
  timestamp: string;
}

export async function dbAddAiTransaction(tx: AiTransaction): Promise<void> {
  if (!isTauri) return ailifeIdb.idbAddAiTransaction(tx);
  await invoke('add_ai_transaction', { tx });
}

export async function dbGetAiTransactions(characterId: string, limit?: number): Promise<AiTransaction[]> {
  if (!isTauri) return ailifeIdb.idbGetAiTransactions<AiTransaction>(characterId, limit || 30);
  try {
    return await invoke<AiTransaction[]>('get_ai_transactions', { characterId, limit: limit || 30 });
  } catch {
    return [];
  }
}

export interface WorldConfigRecord {
  id: string;
  name: string;
  worldType: string;
  config: WorldConfigData;
  isBuiltin: boolean;
  updatedAt: string;
}

/** 世界设定包 v2 · 阵营 / 组织 */
export interface WorldFaction {
  name: string;
  description?: string;
}

/** 世界设定包 v2 · 代表角色参考模板 */
export interface WorldCharacterTemplate {
  name: string;
  /** 外号 / 称号 */
  nickname?: string;
  role?: string;
  /** 分属：所属国家 / 地区 / 组织 */
  affiliation?: string;
  /** 游戏内稀有度，如 5★ / 4★ / SSR */
  rarity?: string;
  personality?: string;
  speechStyle?: string;
  /** 代表事迹：做过的事情（一句话） */
  deeds?: string;
  /** 与主角（玩家角色）的关系 */
  relation?: string;
}

/**
 * 世界设定包数据。
 * - v1 基础字段：日程生成与场景校验的最小依赖
 * - v2 扩展字段（formatVersion 2）：世界观术语、阵营、角色模板等，全部可选
 */
export interface WorldConfigData {
  // ---- v1 基础字段 ----
  description?: string;
  locations?: string[];
  transport?: string[];
  currency?: string[];
  activities?: { daily?: string[]; work?: string[]; leisure?: string[]; social?: string[]; special?: string[] };
  events?: string[];
  items?: Record<string, unknown>;
  // ---- v2 扩展字段 ----
  /** 原作来源，如「游戏《原神》」（非官方同人参考包） */
  source?: string;
  /** 时代背景一句话概述 */
  era?: string;
  /** 世界观概述（建议 ≤200 字） */
  lore?: string;
  /** 术语表：术语 → 一句话释义 */
  terminology?: Record<string, string>;
  /** 主要阵营 / 组织 */
  factions?: WorldFaction[];
  /** 代表角色模板（供角色创建/日程生成参考） */
  characters?: WorldCharacterTemplate[];
  /** 世界禁忌：该世界里不该出现的事物（用于约束 AI 输出） */
  taboos?: string[];
  /** 时间体系说明（历法 / 作息特点） */
  timeNotes?: string;
  /** 资料统计截止日期，如「2026-08-24」 */
  statsAsOf?: string;
  /** 资料对应的游戏最后版本，如「7.0」 */
  gameVersion?: string;
  /** 免责声明 */
  disclaimer?: string;
}

export async function dbGetWorldConfigs(): Promise<WorldConfigRecord[]> {
  if (!isTauri) return [];
  try {
    return await invoke<WorldConfigRecord[]>('get_world_configs');
  } catch {
    return [];
  }
}

export async function dbSaveWorldConfig(config: WorldConfigRecord): Promise<void> {
  if (!isTauri) return;
  await invoke('save_world_config', { config });
}

export async function dbDeleteWorldConfig(id: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_world_config', { id });
}


