/**
 * ============================================================
 * 自学习系统 V2
 * 参考: docs/upgrade-plans/04-self-learning-upgrade.md
 * 
 * 模块：
 * 1. 风格学习器 - 学习用户的说话风格
 * 2. 黑话挖掘器 - 发现高频非常见词汇
 * 3. Few-shot 生成器 - 生成对话示例
 * 4. 审查队列 - 质量控制和渐进式学习
 * ============================================================
 */

import { generateId } from '../../utils/chatUtils';

// ---------- 类型定义 ----------

export interface LearnedVocabulary {
  id: string;
  word: string;
  category: 'slang' | 'catchphrase' | 'emoticon' | 'abbreviation' | 'technical' | 'emotion_word';
  frequency: number;
  confidence: number;   // 0-1 置信度
  lastUsed: Date;
  /** 来自哪个角色的学习 */
  fromCharacterId: string;
}

export interface LearnedPhrase {
  id: string;
  text: string;
  type: 'sentence_pattern' | 'reply_style' | 'emotional_expression' | 'thinking_pattern';
  context: string;
  frequency: number;
  confidence: number;
  lastUsed: Date;
  fromCharacterId: string;
}

export interface StyleProfile {
  characterId: string;
  /** 口语特征 */
  speechStyle: string;
  /** 常用词汇 */
  frequentWords: string[];
  /** 句式偏好 */
  sentencePatterns: string[];
  /** 回复长度偏好 */
  preferredReplyLength: 'short' | 'medium' | 'long' | 'mixed';
  /** 最后更新时间 */
  lastUpdated: Date;
  /** 累计学习样本数 */
  sampleCount: number;
}

// ---------- 黑话挖掘器 ----------

export interface JargonMinerConfig {
  /** 最低频率阈值 */
  minFrequency: number;
  /** 最低置信度 */
  minConfidence: number;
  /** 每个角色的最大词汇数 */
  maxTermsPerCharacter: number;
}

const DEFAULT_JARGON_CONFIG: JargonMinerConfig = {
  minFrequency: 3,
  minConfidence: 0.6,
  maxTermsPerCharacter: 50,
};

/**
 * JargonMiner - 黑话/惯用词汇挖掘
 * 从用户消息中提取高频非常见词汇
 */
export class JargonMiner {
  constructor(private config: JargonMinerConfig = DEFAULT_JARGON_CONFIG) {}

  /**
   * mine - 从一组消息中挖掘可能的黑话/特殊词汇
   */
  mine(messages: Array<{ content: string; role: 'user' | 'assistant' }>, characterId: string): LearnedVocabulary[] {
    // 只分析用户消息
    const userMsgs = messages.filter(m => m.role === 'user');
    if (userMsgs.length < 3) return [];

    // 合并全部文本分词
    const allWords: string[] = [];
    for (const msg of userMsgs) {
      const words = this.tokenize(msg.content);
      allWords.push(...words);
    }

    // 词频统计
    const freqMap = new Map<string, number>();
    const contextMap = new Map<string, string[]>();
    for (const msg of userMsgs) {
      const words = this.tokenize(msg.content);
      const used = new Set<string>();
      for (const w of words) {
        freqMap.set(w, (freqMap.get(w) || 0) + 1);
        used.add(w);
      }
      for (const w of used) {
        if (!contextMap.has(w)) contextMap.set(w, []);
        if (msg.content.length <= 100) {
          contextMap.get(w)!.push(msg.content);
        } else {
          contextMap.get(w)!.push(msg.content.slice(0, 100) + '...');
        }
      }
    }

    // 过滤：频率足够高且不是常见词
    const commonWords = new Set([
      '我', '你', '他', '她', '它', '们', '的', '了', '是', '在', '有', '和',
      '就', '不', '人', '都', '一', '也', '很', '到', '说', '要', '去',
      '会', '着', '没有', '看', '好', '自己', '这', '那', '什么', '怎么',
      '知道', '可以', '因为', '所以', '但是', '如果', '虽然', '已经',
      '能', '想', '做', '觉得', '应该', '可能',
    ]);

    const vocabularies: LearnedVocabulary[] = [];
    for (const [word, freq] of freqMap) {
      if (freq < this.config.minFrequency) continue;
      if (commonWords.has(word)) continue;
      if (word.length < 2) continue;

      // 置信度 = 频率因子 × 词长因子，中文字词长≥2即有充分语义
      const wordLenFactor = Math.min(1, (word.length + 1) / 3);
      const confidence = Math.min(1, (freq / (freq + 2)) * wordLenFactor);

      if (confidence < this.config.minConfidence) continue;

      // 分类
      const category = this.classifyWord(word);

      vocabularies.push({
        id: generateId(),
        word,
        category,
        frequency: freq,
        confidence: Math.round(confidence * 100) / 100,
        lastUsed: new Date(),
        fromCharacterId: characterId,
      });
    }

    // 按频次排序，限制总数
    return vocabularies
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, this.config.maxTermsPerCharacter);
  }

  private tokenize(text: string): string[] {
    // 中文分词：按标点和空格分割，同时提取 2-6 字的滑动窗口子词
    const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ');
    const segments = clean.split(/\s+/);
    const words: string[] = [];
    for (const seg of segments) {
      if (seg.length <= 8) {
        words.push(seg);
      }
      // 滑动窗口提取子词
      for (let len = 2; len <= 4; len++) {
        for (let i = 0; i <= seg.length - len; i++) {
          words.push(seg.slice(i, i + len));
        }
      }
    }
    return [...new Set(words)].filter(w => w.length >= 2 && w.length <= 8);
  }

  private classifyWord(word: string): LearnedVocabulary['category'] {
    // 表情符号
    if (/[😂😅😊😍🤣😭😡👍👎💕]/u.test(word)) return 'emoticon';
    // 缩略词（字母+数字组合）
    if (/^[a-zA-Z0-9]{2,8}$/.test(word)) return 'abbreviation';
    // 技术术语（包含英文技术词汇）
    if (/^[a-zA-Z]+$/.test(word) && word.length > 3) return 'technical';
    // 语气词（啊哦嗯呃等结尾词）
    if (/[啊哦嗯呃呀呢吧嘛哈嘿啧嚯]$/.test(word) && word.length <= 3) return 'emotion_word';
    // 默认当作口头禅
    return 'catchphrase';
  }
}

// ---------- Few-shot 生成器 ----------

export interface FewShotExample {
  /** 用户消息 */
  user: string;
  /** AI 回复（使用目标风格的回复） */
  assistant: string;
  /** 标签 */
  tags: string[];
  /** 来源：'real'(真实对话)/'synthetic'(合成) */
  source: 'real' | 'synthetic';
}

/**
 * FewShotGenerator - 从对话历史中生成 Few-shot 示例
 */
export class FewShotGenerator {
  /**
   * generate - 从对话中提取高质量示例
   * 筛选标准：AI回复有个性、用户在回应、对话有连贯性
   */
  generate(
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    maxExamples: number = 3
  ): FewShotExample[] {
    const examples: FewShotExample[] = [];

    for (let i = 0; i < messages.length - 1; i++) {
      const current = messages[i];
      const next = messages[i + 1];

      // 必须是 user → assistant 对
      if (current.role !== 'user' || next.role !== 'assistant') continue;

      // AI 回复质量筛选
      const aiReply = next.content;
      if (!this.isQualityReply(aiReply)) continue;

      // 用户消息长度合适
      if (current.content.length < 3 || current.content.length > 200) continue;

      examples.push({
        user: current.content,
        assistant: aiReply,
        tags: this.extractTags(current.content, aiReply),
        source: 'real',
      });

      if (examples.length >= maxExamples) break;
    }

    return examples;
  }

  /**
   * buildFewShotPrompt - 构建注入到 System Prompt 的 Few-shot 部分
   */
  buildPrompt(examples: FewShotExample[]): string {
    if (examples.length === 0) return '';

    const lines: string[] = ['\n--- 近期真实对话风格示例 ---'];
    for (const ex of examples) {
      lines.push(`用户："${ex.user}"`);
      lines.push(`你的回复："${ex.assistant}"`);
    }
    lines.push('请在上面的示例风格基础上回复用户。---\n');

    return lines.join('\n');
  }

  private isQualityReply(text: string): boolean {
    // 排除太短或太长的
    if (text.length < 8 || text.length > 300) return false;
    // 排除纯英文纯技术性
    if (/^[a-zA-Z\s\d.,!?]+$/.test(text) && text.length > 50) return false;
    // 排除明显的AI腔
    if (/作为.*?我|很高兴|感谢你的|希望我的|有什么.*?帮/.test(text)) return false;
    // 排除模板语言
    if (/^（.*?）/.test(text.trim())) return false;
    return true;
  }

  private extractTags(userMsg: string, aiReply: string): string[] {
    const tags: string[] = [];
    if (aiReply.includes('哈哈') || aiReply.includes('哈哈哈')) tags.push('幽默');
    if (aiReply.includes('~')) tags.push('轻松');
    if (aiReply.length < 20) tags.push('简短');
    if (aiReply.length > 80) tags.push('详细');
    if (/[。！？]$/.test(aiReply) && aiReply.length < 40) tags.push('口语');
    if (userMsg.includes('?')) tags.push('问答');
    return tags;
  }
}

// ---------- 审查队列 ----------

export type ReviewDecision = 'approve' | 'reject' | 'rollback';

export interface ReviewItem {
  id: string;
  type: 'vocabulary' | 'phrase' | 'style_update' | 'few_shot';
  data: unknown;
  characterId: string;
  createdAt: Date;
  status: 'pending' | 'approved' | 'rejected';
  decision?: ReviewDecision;
  decidedAt?: Date;
  rollbackData?: unknown;
}

/**
 * ReviewQueue - 学习结果审查队列
 * 新学习的词汇/句式先进入审查队列，确认后生效
 */
export class ReviewQueue {
  private items: ReviewItem[] = [];
  private maxQueueSize: number;

  constructor(maxQueueSize: number = 100) {
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * submit - 提交一个学习项到审查队列
   */
  submit(type: ReviewItem['type'], data: unknown, characterId: string): ReviewItem {
    const item: ReviewItem = {
      id: generateId(),
      type,
      data,
      characterId,
      createdAt: new Date(),
      status: 'pending',
    };
    this.items.push(item);
    this.prune();
    return item;
  }

  /**
   * batchSubmit - 批量提交
   */
  batchSubmit(items: Array<{ type: ReviewItem['type']; data: unknown; characterId: string }>): ReviewItem[] {
    return items.map(i => this.submit(i.type, i.data, i.characterId));
  }

  /**
   * approve - 批准一个审核项
   */
  approve(id: string): boolean {
    const item = this.items.find(i => i.id === id);
    if (item && item.status === 'pending') {
      item.status = 'approved';
      item.decision = 'approve';
      item.decidedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * reject - 拒绝一个审核项
   */
  reject(id: string): boolean {
    const item = this.items.find(i => i.id === id);
    if (item && item.status === 'pending') {
      item.status = 'rejected';
      item.decision = 'reject';
      item.decidedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * getPending - 获取待审核项
   */
  getPending(characterId?: string): ReviewItem[] {
    let pending = this.items.filter(i => i.status === 'pending');
    if (characterId) {
      pending = pending.filter(i => i.characterId === characterId);
    }
    return pending;
  }

  /**
   * getApproved - 获取已批准的学习项数据
   */
  getApproved<T = unknown>(type?: ReviewItem['type'], characterId?: string): T[] {
    let approved = this.items.filter(i => i.status === 'approved');
    if (type) approved = approved.filter(i => i.type === type);
    if (characterId) approved = approved.filter(i => i.characterId === characterId);
    return approved.map(i => i.data as T);
  }

  /**
   * clearProcessed - 清除已处理的项（批准/拒绝后超过24小时的）
   */
  clearProcessed(): void {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    this.items = this.items.filter(i => {
      if (i.decidedAt) {
        return (now - i.decidedAt.getTime()) < oneDay;
      }
      return true;
    });
  }

  /**
   * getStats - 统计信息
   */
  getStats(): { total: number; pending: number; approved: number; rejected: number } {
    return {
      total: this.items.length,
      pending: this.items.filter(i => i.status === 'pending').length,
      approved: this.items.filter(i => i.status === 'approved').length,
      rejected: this.items.filter(i => i.status === 'rejected').length,
    };
  }

  private prune(): void {
    if (this.items.length > this.maxQueueSize) {
      // 保留最近的非 pending 项
      const pending = this.items.filter(i => i.status === 'pending');
      const processed = this.items
        .filter(i => i.status !== 'pending')
        .sort((a, b) => {
          const aTime = a.decidedAt?.getTime() || 0;
          const bTime = b.decidedAt?.getTime() || 0;
          return bTime - aTime;
        })
        .slice(0, this.maxQueueSize - pending.length);
      this.items = [...pending, ...processed];
    }
  }
}

// ---------- 单例 ----------

let jargonMinerInstance: JargonMiner | null = null;
let fewShotGeneratorInstance: FewShotGenerator | null = null;
let reviewQueueInstance: ReviewQueue | null = null;

export function getJargonMiner(config?: JargonMinerConfig): JargonMiner {
  if (!jargonMinerInstance) {
    jargonMinerInstance = new JargonMiner(config);
  }
  return jargonMinerInstance;
}

export function getFewShotGenerator(): FewShotGenerator {
  if (!fewShotGeneratorInstance) {
    fewShotGeneratorInstance = new FewShotGenerator();
  }
  return fewShotGeneratorInstance;
}

export function getReviewQueue(): ReviewQueue {
  if (!reviewQueueInstance) {
    reviewQueueInstance = new ReviewQueue();
  }
  return reviewQueueInstance;
}
