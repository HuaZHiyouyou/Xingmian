import { PlatformConfig, ModelConfig } from './configStore';
import {
  isRunningInTauri,
  dbGetPlatforms,
  dbSavePlatforms,
} from '../lib/tauriBridge';

const STORAGE_KEY = 'ai-config';

function migratePlatform(p: PlatformConfig): void {
  if (Array.isArray(p.models)) {
    p.models.forEach((m: ModelConfig) => {
      if (m.pinned === undefined) {
        m.pinned = true;
      }
      if (m.enabledTypes === undefined) {
        m.enabledTypes = [m.type];
      }
    });
  }
}

export async function saveConfig(platforms: PlatformConfig[]): Promise<void> {
  if (isRunningInTauri()) {
    await dbSavePlatforms(platforms);
    return;
  }
  const toSave = platforms.map((p) => ({
    ...p,
    models: p.models,
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

export async function loadConfig(): Promise<PlatformConfig[] | null> {
  if (isRunningInTauri()) {
    const platforms = await dbGetPlatforms();
    platforms.forEach(migratePlatform);
    return platforms.length > 0 ? platforms : null;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && Array.isArray(parsed)) {
        parsed.forEach((p: PlatformConfig) => migratePlatform(p));
      }
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

