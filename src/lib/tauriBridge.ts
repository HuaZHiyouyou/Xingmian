
import { invoke } from '@tauri-apps/api/core';
import { PlatformConfig, ModelConfig } from '../store/configStore';
import { Conversation, EmotionRecord, Character, Memory, Reflection, MemoryEntry, MessageAttachment } from '../types';

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

function dbConversationToConversation(db: any): Conversation {
  return {
    id: db.id,
    title: db.title,
    characterId: db.character_id || db.characterId,
    createdAt: new Date(db.created_at || db.createdAt),
    updatedAt: new Date(db.updated_at || db.updatedAt),
    messages: (db.messages || []).map((m: any) => ({
      id: m.id,
      content: m.content,
      sender: m.sender as 'user' | 'ai',
      timestamp: new Date(m.timestamp),
      emotion: m.emotion as EmotionRecord['emotion'] | undefined,
      emotionIntensity: m.emotionIntensity ?? m.emotion_intensity ?? undefined,
      attachments: m.attachments ? (typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments) : undefined,
    })),
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

export async function dbSaveConversations(conversations: Conversation[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_conversations', { conversations: conversations.map(conversationToDb) });
}

export async function dbDeleteConversation(conversationId: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_conversation', { conversationId });
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

function dbMemoryEntryToMemoryEntry(db: any): MemoryEntry {
  return {
    id: db.id,
    characterId: db.character_id || db.characterId,
    conversationId: db.conversation_id || db.conversationId,
    category: db.category as MemoryEntry['category'],
    title: db.title,
    content: db.content,
    tags: typeof db.tags === 'string' ? JSON.parse(db.tags || '[]') : db.tags || [],
    importance: db.importance,
    createdAt: new Date(db.created_at || db.createdAt),
    triggerMessage: db.trigger_message || db.triggerMessage || undefined,
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

export async function dbGetDebugLogs(): Promise<{ id: string; type: string; message: string; timestamp: string; characterId: string; conversationId: string }[]> {
  if (!isTauri) return [];
  return await invoke('get_debug_logs');
}

export async function dbSaveDebugLogs(logs: { id: string; type: string; message: string; timestamp: string; characterId?: string; conversationId?: string }[]): Promise<void> {
  if (!isTauri) return;
  await invoke('save_debug_logs', { logs: logs.map(l => ({ ...l, characterId: l.characterId || '', conversationId: l.conversationId || '' })) });
}

export async function dbBatchInsertDebugLogs(logs: { id: string; type: string; message: string; timestamp: string; characterId?: string; conversationId?: string }[]): Promise<void> {
  if (!isTauri) return;
  await invoke('batch_insert_debug_logs', { logs: logs.map(l => ({ ...l, characterId: l.characterId || '', conversationId: l.conversationId || '' })) });
}

export async function dbDeleteDebugLogsByCharacter(characterId: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_debug_logs_by_character', { characterId });
}

export async function dbDeleteDebugLogsByConversation(conversationId: string): Promise<void> {
  if (!isTauri) return;
  await invoke('delete_debug_logs_by_conversation', { conversationId });
}

export async function dbClearDebugLogs(): Promise<void> {
  if (!isTauri) return;
  await invoke('clear_debug_logs');
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
  const rows = await invoke<any[]>('get_deleted_memory_entries');
  return rows.map(r => ({
    id: r.id,
    characterId: r.characterId,
    conversationId: r.conversationId,
    category: r.category,
    title: r.title,
    content: r.content,
    tags: JSON.parse(r.tags || '[]'),
    importance: r.importance,
    createdAt: new Date(r.createdAt),
    triggerMessage: r.triggerMessage || undefined,
    deletedAt: new Date(r.deletedAt),
  }));
}

export async function dbSaveDeletedMemoryEntries(entries: MemoryEntry[]): Promise<void> {
  if (!isTauri) return;
  const serialized = entries.map(e => ({
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
    deletedAt: (e as any).deletedAt instanceof Date ? (e as any).deletedAt.toISOString() : String((e as any).deletedAt || ''),
  }));
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
  logs: { id: string; type: string; message: string; timestamp: string; characterId: string; conversationId: string }[];
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
  createdAt: string;
  updatedAt: string;
}

export interface BotIntegrationConfig {
  ws_url: string;
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
    await invoke('save_bot_integration', {
      id,
      integrationType: type,
      enabled,
      config,
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
): Promise<boolean> {
  if (!isTauri) return false;
  try {
    await invoke('save_bot_conversation', {
      id,
      integrationId,
      externalUserId,
      externalUserName,
      characterId,
      conversationId,
    });
    return true;
  } catch {
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
    return await invoke<{ success: boolean; message: string }>('test_bot_connection', { id });
  } catch (e) {
    return { success: false, message: String(e) };
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

// ========== File DB CRUD ==========

export async function saveFileToDb(
  id: string,
  name: string,
  mimeType: string,
  data: Uint8Array,
  characterId?: string,
  conversationId?: string,
): Promise<boolean> {
  if (!isTauri) return false;
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

    await invoke('save_file_to_db', {
      id,
      filename: name,
      mimeType,
      data: base64,
      size: data.length,
      characterId: characterId || null,
      conversationId: conversationId || null,
    });
    return true;
  } catch (e) {
    console.error('[tauriBridge] saveFileToDb failed:', e);
    return false;
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
  personality: string;
  background: string;
  interests: string;
  habits: string;
  notes: string;
}

export async function dbGetUserProfile(): Promise<DbUserProfile> {
  if (!isTauri) return { avatar: '', nickname: '', age: '', gender: '', mbti: '', personality: '', background: '', interests: '', habits: '', notes: '' };
  try {
    return await invoke<DbUserProfile>('get_user_profile');
  } catch {
    return { avatar: '', nickname: '', age: '', gender: '', mbti: '', personality: '', background: '', interests: '', habits: '', notes: '' };
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

