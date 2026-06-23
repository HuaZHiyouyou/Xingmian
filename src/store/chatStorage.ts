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
  } catch {
    // Storage full, ignore
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
      return parsed.map((c: any) => ({
        ...c,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        messages: (c.messages || []).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp),
          attachments: m.attachments || undefined,
        })),
      }));
    }
  } catch {
    /* ignore */
  }
  return [];
}

export async function saveEmotionRecords(records: EmotionRecord[]): Promise<void> {
  if (isRunningInTauri()) {
    await dbSaveEmotionRecords(records);
    return;
  }
  try {
    const toSave = records.map((r) => ({
      ...r,
      timestamp: serializeDate(r.timestamp),
    }));
    localStorage.setItem(EMOTION_RECORDS_KEY, JSON.stringify(toSave));
  } catch {
    // Storage full, ignore
  }
}

export async function loadEmotionRecords(): Promise<EmotionRecord[]> {
  if (isRunningInTauri()) {
    return await dbGetEmotionRecords();
  }
  try {
    const stored = localStorage.getItem(EMOTION_RECORDS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((r: any) => ({
        ...r,
        timestamp: new Date(r.timestamp),
      }));
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function clearAllChatData(): void {
  localStorage.removeItem(CONVERSATIONS_KEY);
  localStorage.removeItem(EMOTION_RECORDS_KEY);
}
