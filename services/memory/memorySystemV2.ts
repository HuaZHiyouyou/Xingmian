/**
 * ============================================================
 * 记忆系统 V2 - 双层层认知架构
 * 参考: docs/upgrade-plans/02-memory-system-upgrade.md
 * 
 * 两层记忆：
 * 1. CoreMemory（核心记忆） - 长期重要的持久事实
 * 2. EpisodicMemory（情节记忆） - 对话中的事件和互动
 * 
 * 包含：遗忘曲线、情绪标签、多维度检索
 * ============================================================
 */

import { Memory, EmotionType } from '../../types';

// ---------- 双层记忆类型 ----------

export interface CoreMemory {
  id: string;
  characterId: string;
  /** 记忆类型: fact(事实)/identity(身份)/relationship(关系)/lesson(教训) */
  type: 'fact' | 'identity' | 'relationship' | 'lesson';
  content: string;
  importance: number;       // 1-10
  confidence: number;       // 0-1 置信度
  emotionTags: EmotionType[];
  createdAt: Date;
  updatedAt: Date;
  /** 源对话 ID */
  sourceConversationId: string;
  /** 关键词（用于检索） */
  keywords: string[];
}

export interface EpisodicMemory {
  id: string;
  characterId: string;
  /** 事件类型 */
  category: 'interaction' | 'emotion_change' | 'important_topic' | 'user_feedback' | 'conflict' | 'bonding';
  content: string;
  importance: number;
  /** 事件发生时间 */
  occurredAt: Date;
  /** 当时的情绪 */
  emotionAtTime: { type: EmotionType; intensity: number };
  /** 关联的核心记忆 ID */
  relatedCoreIds: string[];
  /** 事件关键词 */
  keywords: string[];
}

// ---------- 遗忘曲线 ----------

export interface ForgettingCurveParams {
  /** 初始重要性 (1-10) */
  importance: number;
  /** 自创建以来的天数 */
  daysSinceCreation: number;
  /** 上次回忆以来的天数 */
  daysSinceLastRecall: number;
  /** 回忆次数 */
  recallCount: number;
  /** 情绪强度 (0-100) */
  emotionIntensity: number;
  /** 是否启用遗忘曲线（默认启用） */
  enabled?: boolean;
  /** 衰减速率倍率（默认 1.0；>1 忘得更快，<1 更慢） */
  decayRate?: number;
}

/**
 * calculateMemoryClarity - 艾宾浩斯遗忘曲线模型
 * 
 * 公式: clarity = importance * e^(-λ*days) * boostFactor
 * boostFactor 考虑了回忆增强、情绪增强
 */
export function calculateMemoryClarity(params: ForgettingCurveParams): number {
  const { importance, daysSinceCreation, daysSinceLastRecall, recallCount, emotionIntensity, enabled = true, decayRate = 1 } = params;

  // 回忆增强（每次回忆提升 15% 清晰度，最多 5 次叠加）
  const recallBoost = 1 + Math.min(recallCount, 5) * 0.15;

  // 情绪增强（情绪强度越高，记越牢）
  const emotionBoost = 1 + (emotionIntensity / 100) * 0.3;

  // 如果关闭遗忘曲线，清晰度只受重要性、回忆、情绪影响，不受时间影响
  if (!enabled) {
    const clarity = importance * 10 * recallBoost * emotionBoost;
    return Math.round(Math.min(100, clarity));
  }

  // 基础衰减率（重要性越高，衰减越慢；decayRate 覆盖整体遗忘速度）
  const baseDecay = decayRate * (0.05 / (1 + importance * 0.15));

  // 时间复杂度衰减
  const timeFactor = Math.exp(-baseDecay * daysSinceCreation);

  // 最后回忆时间衰减（短于 1 天几乎不减）
  const recentRecallBoost = 1 + Math.exp(-daysSinceLastRecall * 0.8) * 0.5;

  // 综合清晰度 (0~100)
  const clarity = importance * 10 * timeFactor * recallBoost * recentRecallBoost * emotionBoost;
  return Math.round(Math.min(100, clarity));
}

/**
 * getMemoryClarityTier - 获取记忆清晰度等级
 */
export function getMemoryClarityTier(clarity: number): 'vivid' | 'clear' | 'hazy' | 'faded' | 'forgotten' {
  if (clarity >= 70) return 'vivid';
  if (clarity >= 50) return 'clear';
  if (clarity >= 30) return 'hazy';
  if (clarity >= 10) return 'faded';
  return 'forgotten';
}

/**
 * 清晰度等级的提示风格
 */
export function getClarityPromptStyle(tier: ReturnType<typeof getMemoryClarityTier>): string {
  switch (tier) {
    case 'vivid': return '记得很清楚：';
    case 'clear': return '还记得：';
    case 'hazy': return '隐约记得：';
    case 'faded': return '好像记得：';
    case 'forgotten': return '似乎有点印象：';
  }
}

// ---------- 记忆检索器 ----------

export interface MemoryRetrievalParams {
  /** 当前用户消息（用于关键词匹配） */
  userMessage: string;
  /** 当前用户消息的情绪 */
  userEmotion?: EmotionType;
  /** 核心记忆列表 */
  coreMemories: CoreMemory[];
  /** 情节记忆列表 */
  episodicMemories: EpisodicMemory[];
  /** 最大返回数量 */
  maxResults?: number;
  /** 最低匹配分数阈值 */
  minScore?: number;
  /** 重要度权重倍率（默认 1.0；影响检索评分中 importance 分量） */
  importanceWeight?: number;
}

export interface MemoryRetrievalResult {
  core: Array<{ memory: CoreMemory; score: number; reason: string }>;
  episodic: Array<{ memory: EpisodicMemory; score: number; reason: string }>;
}

/**
 * retrieveRelevantMemories - 多维度记忆检索
 * 维度：关键词匹配 + 情绪匹配 + 重要性 + 时间衰减
 */
export function retrieveRelevantMemories(params: MemoryRetrievalParams): MemoryRetrievalResult {
  const { userMessage, userEmotion, coreMemories, episodicMemories, maxResults = 5, minScore = 0.1, importanceWeight = 1 } = params;

  // 提取用户消息的关键词
  const userKeywords = extractKeywords(userMessage);

  // 检索核心记忆
  const coreResults = coreMemories
    .map(memory => {
      const score = calculateMatchScore(memory.keywords, memory.importance * (importanceWeight || 1), memory.emotionTags, userKeywords, userEmotion);
      return { memory, score, reason: buildRetrievalReason(score) };
    })
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  // 检索情节记忆
  const episodicResults = episodicMemories
    .map(memory => {
      const score = calculateMatchScore(memory.keywords, memory.importance * (importanceWeight || 1), memory.emotionAtTime.type ? [memory.emotionAtTime.type] : [], userKeywords, userEmotion);
      return { memory, score, reason: buildRetrievalReason(score) };
    })
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.floor(maxResults / 2));

  return { core: coreResults, episodic: episodicResults };
}

// ---------- 检索辅助函数 ----------

function calculateMatchScore(
  memoryKeywords: string[],
  importance: number,
  emotionTags: EmotionType[],
  userKeywords: string[],
  userEmotion?: EmotionType,
): number {
  let score = 0;

  // 1. 关键词匹配 (权重 50%)
  if (memoryKeywords.length > 0 && userKeywords.length > 0) {
    let matchCount = 0;
    for (const uk of userKeywords) {
      for (const mk of memoryKeywords) {
        if (mk.includes(uk) || uk.includes(mk)) {
          matchCount++;
          break;
        }
      }
    }
    score += (matchCount / Math.max(userKeywords.length, 1)) * 0.5;
  }

  // 2. 重要性 (权重 25%)
  score += (importance / 10) * 0.25;

  // 3. 情绪匹配 (权重 15%)
  if (userEmotion && emotionTags.length > 0) {
    const emotionMatch = emotionTags.some(t => t === userEmotion);
    if (emotionMatch) score += 0.15;
    else score += 0.05; // 情绪不匹配也有微弱关联
  }

  // 4. 默认关联度 (10%)
  score += 0.1;

  return Math.min(1, score);
}

// 关键词缓存索引（LRU，最多缓存 50 条）
const keywordCache = new Map<string, string[]>();
const KEYWORD_CACHE_MAX = 50;

export function extractKeywords(text: string): string[] {
  // 缓存命中
  const cached = keywordCache.get(text);
  if (cached) return cached;

  // 简单的中文分词：按标点和空间分割，取长度 >= 2 的词
  const segments = text.split(/[，。！？、；：""''「」『』【】（）\s\t\n]+/);
  const keywords: string[] = [];
  const stopWords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这']);

  for (const seg of segments) {
    if (seg.length >= 2 && !stopWords.has(seg)) {
      keywords.push(seg);
    }
    // 也提取 4+ 字符的连续字串
    if (seg.length >= 4) {
      for (let i = 0; i < seg.length - 3; i++) {
        const sub = seg.slice(i, i + 4);
        if (!stopWords.has(sub)) {
          keywords.push(sub);
        }
      }
    }
  }

  const result = [...new Set(keywords)].slice(0, 20);

  // 缓存管理（LRU）
  if (keywordCache.size >= KEYWORD_CACHE_MAX) {
    const firstKey = keywordCache.keys().next().value;
    if (firstKey !== undefined) keywordCache.delete(firstKey);
  }
  keywordCache.set(text, result);

  return result;
}

/** 清理关键词缓存（内存优化） */
export function clearKeywordCache(): void {
  keywordCache.clear();
}

function buildRetrievalReason(score: number): string {
  if (score >= 0.8) return '高度相关';
  if (score >= 0.5) return '相关';
  if (score >= 0.3) return '部分相关';
  return '弱关联';
}

// ============================================================
// 记忆 V2 集成层 - 与现有 Memory/Reflection/MemoryEntry 互转
// ============================================================

/**
 * convertToCoreMemory - 将旧的 Memory 对象转为 V2 CoreMemory
 */
export function convertToCoreMemory(memory: Memory, characterId: string): CoreMemory {
  return {
    id: memory.id,
    characterId,
    type: memory.importance >= 7 ? 'identity' : (memory.importance >= 5 ? 'relationship' : 'fact'),
    content: memory.content,
    importance: memory.importance,
    confidence: (memory.clarity || 70) / 100,
    emotionTags: [],
    createdAt: new Date(memory.createdAt),
    updatedAt: new Date(memory.lastRecalled || memory.createdAt),
    sourceConversationId: memory.conversationId || '',
    keywords: extractKeywords(memory.content),
  };
}

/**
 * buildMemoryPromptV2 - 构建记忆注入到 System Prompt 的文本
 * 包含双层记忆结果和清晰度等级
 */
export function buildMemoryPromptV2(result: MemoryRetrievalResult, forgettingEnabled: boolean = true): string {
  if (result.core.length === 0 && result.episodic.length === 0) return '';

  const lines: string[] = ['--- 当前相关记忆 ---'];

  // 核心记忆 (长期知识)
  if (result.core.length > 0) {
    lines.push('你知道：');
    for (const { memory, score } of result.core) {
      const clarity = calculateMemoryClarity({
        importance: memory.importance,
        daysSinceCreation: (Date.now() - memory.createdAt.getTime()) / 86400000,
        daysSinceLastRecall: 0,
        recallCount: 1,
        emotionIntensity: 50,
        enabled: forgettingEnabled,
      });
      const tier = getMemoryClarityTier(clarity);
      const prefix = getClarityPromptStyle(tier);
      lines.push(`- ${prefix}${memory.content} (相关性:${Math.round(score * 100)}%)`);
    }
  }

  // 情节记忆 (近期互动)
  if (result.episodic.length > 0) {
    lines.push('\n近期事件：');
    for (const { memory } of result.episodic) {
      const timeAgo = formatTimeAgo(memory.occurredAt);
      const emoLabel = memory.emotionAtTime.type !== 'anticipation' ? `[当时${memory.emotionAtTime.type}]` : '';
      lines.push(`- ${timeAgo}${emoLabel} ${memory.content}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * createEpisodicMemoryEntry - 从当前对话创建一个情节记忆
 */
export function createEpisodicMemory(
  id: string,
  characterId: string,
  userMsg: string,
  aiReply: string,
  emotion: { type: EmotionType; intensity: number },
  category: EpisodicMemory['category'],
): EpisodicMemory {
  const combined = `${userMsg} → ${aiReply.slice(0, 100)}`;
  return {
    id,
    characterId,
    category,
    content: combined,
    importance: emotion.intensity > 50 ? 5 : 3,
    occurredAt: new Date(),
    emotionAtTime: emotion,
    relatedCoreIds: [],
    keywords: extractKeywords(combined).slice(0, 10),
  };
}

/**
 * memoryCleanup - 记忆爆炸防护：清理低清晰度记忆
 */
export function memoryCleanup(
  coreMemories: CoreMemory[],
  episodicMemories: EpisodicMemory[],
  maxCore: number = 100,
  maxEpisodic: number = 200,
): { core: CoreMemory[]; episodic: EpisodicMemory[]; removed: number } {
  let removed = 0;

  // 清理核心记忆：按 important_score 排序，保留 top N
  let cleanCore = [...coreMemories];
  if (cleanCore.length > maxCore) {
    const overage = cleanCore.length - maxCore;
    cleanCore = cleanCore
      .sort((a, b) => {
        const scoreA = a.importance * a.confidence;
        const scoreB = b.importance * b.confidence;
        return scoreB - scoreA;
      })
      .slice(0, maxCore);
    removed += overage;
  }

  // 清理情节记忆：按时间排序，保留最近 N 条
  let cleanEpisodic = [...episodicMemories];
  if (cleanEpisodic.length > maxEpisodic) {
    cleanEpisodic = cleanEpisodic
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, maxEpisodic);
    removed += (episodicMemories.length - maxEpisodic);
  }

  return { core: cleanCore, episodic: cleanEpisodic, removed };
}

/**
 * buildForbiddenContext - 从核心记忆中提取禁忌事项
 */
export function extractForbiddenContext(memories: CoreMemory[]): string {
  const forbidden = memories.filter(m => m.type === 'lesson' || m.content.includes('不要') || m.content.includes('禁止') || m.content.includes('不喜欢'));
  if (forbidden.length === 0) return '';
  return '\n用户禁忌/不喜欢的事：\n' + forbidden.map(m => `- ${m.content}`).join('\n');
}

// ---------- 辅助 ----------

function formatTimeAgo(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}
