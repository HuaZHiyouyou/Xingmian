/**
 * ============================================================
 * V2 持久化管理器
 * 参考: docs/upgrade-plans/05-todo-and-gaps.md P1部分
 * 统一管理 V2 模块的数据持久化
 * 策略: 浏览器 → localStorage + IndexedDB | Tauri → JSON文件
 * ============================================================
 */

import { CoreMemory, EpisodicMemory } from '../memory/memorySystemV2';
import { LearnedVocabulary, LearnedPhrase, StyleProfile, ReviewItem } from '../learning/selfLearningV2';
import { PipelineV2Config } from '../output/pipelineV2';
import { MultiEmotionState } from '../../types';

// ---------- 存储键 ----------

const STORAGE_KEYS = {
  // 记忆系统
  CORE_MEMORIES: 'v2-core-memories',
  EPISODIC_MEMORIES: 'v2-episodic-memories',
  // 情感系统
  MULTI_EMOTIONS: 'v2-multi-emotions',
  // 自学习
  VOCABULARIES: 'v2-vocabularies',
  PHRASES: 'v2-phrases',
  STYLE_PROFILES: 'v2-style-profiles',
  REVIEW_QUEUE: 'v2-review-queue',
  // 输出增强
  PIPELINE_CONFIG: 'v2-pipeline-config',
} as const;

// ---------- 通用序列化 ----------

function serialize<T>(data: T): string {
  return JSON.stringify(data, (_key, value) => {
    if (value instanceof Date) return { __date: value.toISOString() };
    return value;
  });
}

function deserialize<T>(json: string): T {
  return JSON.parse(json, (_key, value) => {
    if (value && typeof value === 'object' && value.__date) {
      return new Date(value.__date);
    }
    return value;
  });
}

// ============================================================
// 核心持久化 API
// ============================================================

export class PersistenceManager {
  private prefix: string;

  constructor(prefix: string = 'ai-chat-v2') {
    this.prefix = prefix;
  }

  private key(name: string): string {
    return `${this.prefix}:${name}`;
  }

  // ---------- 读写通用方法 ----------

  save<T>(keyName: string, data: T): boolean {
    try {
      const key = this.key(keyName);
      localStorage.setItem(key, serialize(data));
      return true;
    } catch (e) {
      console.error(`[Persistence] 保存失败: ${keyName}`, e);
      return false;
    }
  }

  load<T>(keyName: string, fallback: T): T {
    try {
      const key = this.key(keyName);
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return deserialize<T>(raw);
    } catch (e) {
      console.error(`[Persistence] 加载失败: ${keyName}`, e);
      return fallback;
    }
  }

  remove(keyName: string): void {
    localStorage.removeItem(this.key(keyName));
  }

  // ---------- 记忆系统 ----------

  saveCoreMemories(characterId: string, memories: CoreMemory[]): boolean {
    return this.save(`${STORAGE_KEYS.CORE_MEMORIES}:${characterId}`, memories);
  }

  loadCoreMemories(characterId: string): CoreMemory[] {
    return this.load<CoreMemory[]>(`${STORAGE_KEYS.CORE_MEMORIES}:${characterId}`, []);
  }

  saveEpisodicMemories(characterId: string, memories: EpisodicMemory[]): boolean {
    return this.save(`${STORAGE_KEYS.EPISODIC_MEMORIES}:${characterId}`, memories);
  }

  loadEpisodicMemories(characterId: string): EpisodicMemory[] {
    return this.load<EpisodicMemory[]>(`${STORAGE_KEYS.EPISODIC_MEMORIES}:${characterId}`, []);
  }

  // ---------- 情感系统 ----------

  saveMultiEmotions(states: Record<string, MultiEmotionState>): boolean {
    return this.save(STORAGE_KEYS.MULTI_EMOTIONS, states);
  }

  loadMultiEmotions(): Record<string, MultiEmotionState> {
    return this.load<Record<string, MultiEmotionState>>(STORAGE_KEYS.MULTI_EMOTIONS, {});
  }

  // ---------- 自学习 ----------

  saveVocabularies(characterId: string, vocabularies: LearnedVocabulary[]): boolean {
    return this.save(`${STORAGE_KEYS.VOCABULARIES}:${characterId}`, vocabularies);
  }

  loadVocabularies(characterId: string): LearnedVocabulary[] {
    return this.load<LearnedVocabulary[]>(`${STORAGE_KEYS.VOCABULARIES}:${characterId}`, []);
  }

  savePhrases(characterId: string, phrases: LearnedPhrase[]): boolean {
    return this.save(`${STORAGE_KEYS.PHRASES}:${characterId}`, phrases);
  }

  loadPhrases(characterId: string): LearnedPhrase[] {
    return this.load<LearnedPhrase[]>(`${STORAGE_KEYS.PHRASES}:${characterId}`, []);
  }

  saveStyleProfiles(profiles: Record<string, StyleProfile>): boolean {
    return this.save(STORAGE_KEYS.STYLE_PROFILES, profiles);
  }

  loadStyleProfiles(): Record<string, StyleProfile> {
    return this.load<Record<string, StyleProfile>>(STORAGE_KEYS.STYLE_PROFILES, {});
  }

  saveReviewQueue(items: ReviewItem[]): boolean {
    return this.save(STORAGE_KEYS.REVIEW_QUEUE, items);
  }

  loadReviewQueue(): ReviewItem[] {
    return this.load<ReviewItem[]>(STORAGE_KEYS.REVIEW_QUEUE, []);
  }

  // ---------- 输出增强 ----------

  savePipelineConfig(characterId: string, config: Partial<PipelineV2Config>): boolean {
    return this.save(`${STORAGE_KEYS.PIPELINE_CONFIG}:${characterId}`, config);
  }

  loadPipelineConfig(characterId: string): Partial<PipelineV2Config> {
    return this.load<Partial<PipelineV2Config>>(`${STORAGE_KEYS.PIPELINE_CONFIG}:${characterId}`, {});
  }

  // ---------- 批量操作 ----------

  /** 导出全部 V2 数据（用于备份） */
  exportAll(characterIds: string[]): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    data[STORAGE_KEYS.MULTI_EMOTIONS] = this.loadMultiEmotions();
    data[STORAGE_KEYS.STYLE_PROFILES] = this.loadStyleProfiles();
    data[STORAGE_KEYS.REVIEW_QUEUE] = this.loadReviewQueue();

    for (const cid of characterIds) {
      data[`${STORAGE_KEYS.CORE_MEMORIES}:${cid}`] = this.loadCoreMemories(cid);
      data[`${STORAGE_KEYS.EPISODIC_MEMORIES}:${cid}`] = this.loadEpisodicMemories(cid);
      data[`${STORAGE_KEYS.VOCABULARIES}:${cid}`] = this.loadVocabularies(cid);
      data[`${STORAGE_KEYS.PHRASES}:${cid}`] = this.loadPhrases(cid);
      data[`${STORAGE_KEYS.PIPELINE_CONFIG}:${cid}`] = this.loadPipelineConfig(cid);
    }

    return data;
  }

  /** 导入数据并保存 */
  importAll(data: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(data)) {
      if (value) {
        try {
          localStorage.setItem(this.key(key), typeof value === 'string' ? value : serialize(value));
        } catch (e) {
          console.error(`[Persistence] 导入失败: ${key}`, e);
        }
      }
    }
  }

  /** 清除全部 V2 数据 */
  clearAll(characterIds: string[]): void {
    this.remove(STORAGE_KEYS.MULTI_EMOTIONS);
    this.remove(STORAGE_KEYS.STYLE_PROFILES);
    this.remove(STORAGE_KEYS.REVIEW_QUEUE);

    for (const cid of characterIds) {
      this.remove(`${STORAGE_KEYS.CORE_MEMORIES}:${cid}`);
      this.remove(`${STORAGE_KEYS.EPISODIC_MEMORIES}:${cid}`);
      this.remove(`${STORAGE_KEYS.VOCABULARIES}:${cid}`);
      this.remove(`${STORAGE_KEYS.PHRASES}:${cid}`);
      this.remove(`${STORAGE_KEYS.PIPELINE_CONFIG}:${cid}`);
    }
  }
}

// ---------- 单例 ----------

let persistenceInstance: PersistenceManager | null = null;

export function getPersistence(): PersistenceManager {
  if (!persistenceInstance) {
    persistenceInstance = new PersistenceManager();
  }
  return persistenceInstance;
}
