import { isRunningInTauri, dbMigrateFromLocalStorage, dbGetPlatforms, dbGetConversations, dbSaveMemoryEntries } from './tauriBridge';

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
    const allEntries = Object.values(parsed).flat() as any[];
    if (allEntries.length === 0) {
      localStorage.setItem(MEMORY_MIGRATION_KEY, '1');
      return;
    }

    const entries = allEntries.map((e: any) => ({
      id: e.id || '',
      characterId: e.characterId || '',
      conversationId: e.conversationId || '',
      category: e.category || 'user_message',
      title: e.title || '',
      content: e.content || '',
      tags: Array.isArray(e.tags) ? e.tags : [],
      importance: e.importance ?? 5,
      createdAt: e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt),
      triggerMessage: e.triggerMessage || '',
    }));

    await dbSaveMemoryEntries(entries);
    localStorage.setItem(MEMORY_MIGRATION_KEY, '1');
  } catch (e) {
    console.error('Memory migration from localStorage failed:', e);
    localStorage.setItem(MEMORY_MIGRATION_KEY, '1');
  }
}
