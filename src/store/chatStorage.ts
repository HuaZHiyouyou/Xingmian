import { Conversation, EmotionRecord } from '../types';
import {
  isRunningInTauri,
  dbGetConversations,
  dbSaveConversations,
  dbGetEmotionRecords,
  dbSaveEmotionRecords,
} from '../lib/tauriBridge';

const CONVERSATIONS_KEY = 'ai-conversations';
const EMOTION_RECORDS_KEY = 'ai-emotion-records';

function serializeDate(date: Date | string): string {
  return date instanceof Date ? date.toISOString() : String(date);
}

export async function saveConversations(conversations: Conversation[]): Promise<void> {
  if (isRunningInTauri()) {
    await dbSaveConversations(conversations);
    return;
  }
  try {
    const toSave = conversations.map((c) => ({
      ...c,
      createdAt: serializeDate(c.createdAt),
      updatedAt: serializeDate(c.updatedAt),
      messages: (c.messages || []).map((m) => ({
        ...m,
        timestamp: serializeDate(m.timestamp),
      })),
    }));
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn('[chatStorage] saveConversations failed:', e);
  }
}

export async function loadConversations(): Promise<Conversation[]> {
  if (isRunningInTauri()) {
    return await dbGetConversations();
  }
  try {
    const stored = localStorage.getItem(CONVERSATIONS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return (parsed as Array<Record<string, unknown> & { messages?: Record<string, unknown>[] }>).map((c) => ({
        ...c,
        createdAt: new Date(c.createdAt as string | number | Date),
        updatedAt: new Date(c.updatedAt as string | number | Date),
        messages: ((c.messages || []) as Record<string, unknown>[]).map((m) => ({
          ...m,
          timestamp: new Date(m.timestamp as string | number | Date),
          attachments: m.attachments || undefined,
        })),
      })) as Conversation[];
    }
  } catch (e) {
    console.warn('[chatStorage] loadConversations failed:', e);
  }
  return [];
}

export async function saveEmotionRecords(records: EmotionRecord[]): Promise<void> {
  try {
    const toSave = records.map((r) => ({
      ...r,
      timestamp: serializeDate(r.timestamp),
    }));
    // 🆕 始终写 localStorage（保证立即可读、不依赖 DB）
    localStorage.setItem(EMOTION_RECORDS_KEY, JSON.stringify(toSave));
    if (isRunningInTauri()) {
      // 同时写 DB（DB 是主存储，但 localStorage 是可立即读取的备份）
      await dbSaveEmotionRecords(records);
    }
  } catch (e) {
    console.warn('[chatStorage] saveEmotionRecords failed:', e);
  }
}

export async function loadEmotionRecords(): Promise<EmotionRecord[]> {
  try {
    // 🆕 优先读 localStorage（最新值），再以 DB 补充缺失
    const stored = localStorage.getItem(EMOTION_RECORDS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const localRecords = (parsed as Array<Record<string, unknown>>).map((r) => ({
        ...r,
        timestamp: new Date(r.timestamp as string | number | Date),
      }));
      if (isRunningInTauri()) {
        // 异步同步 DB（fire-and-forget），不阻塞 UI
        dbSaveEmotionRecords(
          localRecords.map((r) => ({
            ...r,
            timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
          })) as unknown as EmotionRecord[]
        ).catch(() => {});
      }
      return localRecords as EmotionRecord[];
    }
    // localStorage 没有时才从 DB 读
    if (isRunningInTauri()) {
      return await dbGetEmotionRecords();
    }
  } catch (e) {
    console.warn('[chatStorage] loadEmotionRecords failed:', e);
  }
  return [];
}

