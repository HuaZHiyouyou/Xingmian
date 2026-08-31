/**
 * 向量检索模块 — 为 MemoryEntry 提供语义搜索能力
 *
 * 工作流程:
 *   1. 新记忆写入时，异步生成 embedding 并存入索引
 *   2. 搜索时，将 query 生成 embedding，与索引做余弦相似度排序
 *   3. 索引持久化到 localStorage，避免每次冷启动都要重新计算
 */

import { generateEmbedding, generateEmbeddings, cosineSimilarity } from '../aiService';
import type { MemoryEntry } from '../../types';

// ============ Types ============

export interface VectorEntry {
  id: string;
  characterId: string;
  /** 用于生成 embedding 的文本（title + content 拼接） */
  text: string;
  embedding: number[];
  createdAt: number;
}

export interface VectorSearchResult {
  entry: MemoryEntry;
  similarity: number;
}

// ============ 内存索引 ============

const STORAGE_KEY = 'ai-memory-vector-index';

/** characterId → VectorEntry[] */
let _index: Record<string, VectorEntry[]> = {};

// ---------- 持久化 ----------

function loadIndex(): Record<string, VectorEntry[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, VectorEntry[]>;
      // 反序列化校验
      for (const key of Object.keys(parsed)) {
        parsed[key] = (parsed[key] || []).filter(
          (e) => e.embedding && e.embedding.length > 0,
        );
      }
      return parsed;
    }
  } catch { /* ignore */ }
  return {};
}

function saveIndex() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_index));
  } catch { /* ignore */ }
}

/** 初始化时加载索引 */
_index = loadIndex();

// ---------- 公共 API ----------

/**
 * 获取某角色的向量索引条目数
 */
export function getVectorCount(characterId: string): number {
  return (_index[characterId] || []).length;
}

/**
 * 获取某角色索引中缺失 embedding 的条目
 */
function findMissing(
  characterId: string,
  entries: MemoryEntry[],
): MemoryEntry[] {
  const existing = new Set(
    (_index[characterId] || []).map((e) => e.id),
  );
  return entries.filter(
    (e) => !existing.has(e.id) && e.characterId === characterId,
  );
}

/**
 * 将文本合并为 embedding 输入（保留 title + content 的语义信息）
 */
function buildEmbeddingText(entry: MemoryEntry): string {
  const parts: string[] = [];
  if (entry.title) parts.push(entry.title);
  if (entry.content) parts.push(entry.content);
  if (entry.tags && entry.tags.length > 0) parts.push(entry.tags.join(' '));
  return parts.join('\n');
}

/**
 * 为新增/缺失的记忆生成 embedding 并写入索引
 * 会自动去重，不会重复计算已有索引的条目
 */
export async function indexMemoryEntries(
  characterId: string,
  entries: MemoryEntry[],
  onProgress?: (indexed: number, total: number) => void,
): Promise<number> {
  const missing = findMissing(characterId, entries);
  if (missing.length === 0) return 0;

  const texts = missing.map(buildEmbeddingText);
  const BATCH = 20;
  let indexed = 0;

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const embeddings = await generateEmbeddings(batch);

    const newVecs: VectorEntry[] = [];
    for (let j = 0; j < batch.length; j++) {
      const emb = embeddings[j];
      if (emb && emb.length > 0) {
        newVecs.push({
          id: missing[i + j].id,
          characterId,
          text: batch[j],
          embedding: emb,
          createdAt: Date.now(),
        });
      }
    }

    if (newVecs.length > 0) {
      if (!_index[characterId]) _index[characterId] = [];
      _index[characterId].push(...newVecs);
    }

    indexed += batch.length;
    onProgress?.(indexed, texts.length);
  }

  saveIndex();
  return indexed;
}

/**
 * 向量语义搜索
 *
 * @param query       用户搜索文本
 * @param characterId 角色 ID（为空时搜所有角色）
 * @param topN        返回前 N 条
 * @param entries     当前角色的全部 MemoryEntry（用于回查完整数据）
 * @param minScore    最低相似度阈值（0-1），默认 0.25
 */
export async function vectorSearch(
  query: string,
  characterId: string | undefined,
  topN: number,
  entries: MemoryEntry[],
  minScore: number = 0.25,
): Promise<VectorSearchResult[]> {
  // 1. 生成 query embedding
  const queryEmb = await generateEmbedding(query);
  if (!queryEmb || queryEmb.length === 0) return [];

  // 2. 收集候选向量
  let candidates: VectorEntry[] = [];
  if (characterId) {
    candidates = _index[characterId] || [];
  } else {
    candidates = Object.values(_index).flat();
  }
  if (candidates.length === 0) return [];

  // 3. 构建 entry 查找表
  const entryMap = new Map<string, MemoryEntry>();
  for (const e of entries) entryMap.set(e.id, e);

  // 4. 计算余弦相似度并排序
  const scored: VectorSearchResult[] = [];
  for (const vec of candidates) {
    const entry = entryMap.get(vec.id);
    if (!entry) continue;
    const sim = cosineSimilarity(queryEmb, vec.embedding);
    if (sim >= minScore) {
      scored.push({ entry, similarity: sim });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topN);
}

/**
 * 快速向量搜索 — 仅返回 ID 和分数（不依赖外部 entries）
 * 适用于后端无法提供完整数据的场景
 */
export async function vectorSearchFast(
  query: string,
  characterId: string | undefined,
  topN: number,
  minScore: number = 0.25,
): Promise<Array<{ id: string; similarity: number }>> {
  const queryEmb = await generateEmbedding(query);
  if (!queryEmb || queryEmb.length === 0) return [];

  let candidates: VectorEntry[] = [];
  if (characterId) {
    candidates = _index[characterId] || [];
  } else {
    candidates = Object.values(_index).flat();
  }
  if (candidates.length === 0) return [];

  const scored = candidates
    .map((vec) => ({
      id: vec.id,
      similarity: cosineSimilarity(queryEmb, vec.embedding),
    }))
    .filter((s) => s.similarity >= minScore)
    .sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, topN);
}

/**
 * 从索引中移除指定条目
 */
export function removeVectorEntry(id: string): void {
  for (const charId of Object.keys(_index)) {
    _index[charId] = _index[charId].filter((e) => e.id !== id);
  }
  saveIndex();
}

/**
 * 批量移除
 */
export function removeVectorEntries(ids: string[]): void {
  const idSet = new Set(ids);
  for (const charId of Object.keys(_index)) {
    _index[charId] = _index[charId].filter((e) => !idSet.has(e.id));
  }
  saveIndex();
}

/**
 * 清空某角色的全部向量索引
 */
export function clearVectorIndex(characterId: string): void {
  delete _index[characterId];
  saveIndex();
}

/**
 * 获取索引统计
 */
export function getVectorStats(): {
  totalEntries: number;
  perCharacter: Record<string, number>;
} {
  const perCharacter: Record<string, number> = {};
  let total = 0;
  for (const [charId, vecs] of Object.entries(_index)) {
    perCharacter[charId] = vecs.length;
    total += vecs.length;
  }
  return { totalEntries: total, perCharacter };
}
