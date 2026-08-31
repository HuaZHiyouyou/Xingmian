import { isRunningInTauri, dbMigrateFromLocalStorage, dbGetPlatforms, dbSaveMemoryEntries } from './tauriBridge';
import type { MemoryCategory } from '../types';

const MIGRATION_DONE_KEY = 'ai-tauri-migrated';
const MEMORY_MIGRATION_KEY = 'ai-tauri-memory-migrated';

export async function migrateLocalStorageIfNeeded(): Promise<void> {
  if (!isRunningInTauri()) return;
  if (localStorage.getItem(MIGRATION_DONE_KEY)) return;

  try {
    const hasExistingData = await dbGetPlatforms();
    if (hasExistingData.length > 0) {
      localStorage.setItem(MIGRATION_DONE_KEY, '1');
      return;
    }

    const configJson = localStorage.getItem('ai-config') || '[]';
    const conversationsJson = localStorage.getItem('ai-conversations') || '[]';
    const emotionRecordsJson = localStorage.getItem('ai-emotion-records') || '[]';

    const hasLocalStorage =
      configJson !== '[]' || conversationsJson !== '[]' || emotionRecordsJson !== '[]';

    if (hasLocalStorage) {
      await dbMigrateFromLocalStorage(configJson, conversationsJson, emotionRecordsJson);
    }

    localStorage.setItem(MIGRATION_DONE_KEY, '1');
  } catch (e) {
    console.error('Migration from localStorage failed:', e);
  }
}

export async function migrateMemoryEntriesIfNeeded(): Promise<void> {
  if (!isRunningInTauri()) return;
  if (localStorage.getItem(MEMORY_MIGRATION_KEY)) return;

  try {
    const stored = localStorage.getItem('ai-memory-entries');
    if (!stored) {
      localStorage.setItem(MEMORY_MIGRATION_KEY, '1');
      return;
    }

    const parsed = JSON.parse(stored);
    const allEntries = Object.values(parsed).flat() as unknown[];
    if (allEntries.length === 0) {
      localStorage.setItem(MEMORY_MIGRATION_KEY, '1');
      return;
    }

    const entries = allEntries.map((e) => {
      const item = e as Record<string, unknown>;
      return {
        id: (item.id as string | undefined) || '',
        characterId: (item.characterId as string | undefined) || '',
        conversationId: (item.conversationId as string | undefined) || '',
        category: ((item.category as string | undefined) || 'user_message') as MemoryCategory,
        title: (item.title as string | undefined) || '',
        content: (item.content as string | undefined) || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        importance: typeof item.importance === 'number' ? item.importance : 5,
        createdAt: item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt as string | number | Date),
        triggerMessage: (item.triggerMessage as string | undefined) || '',
      };
    });

    await dbSaveMemoryEntries(entries);
    localStorage.setItem(MEMORY_MIGRATION_KEY, '1');
  } catch (e) {
    console.error('Memory migration from localStorage failed:', e);
    localStorage.setItem(MEMORY_MIGRATION_KEY, '1');
  }
}
