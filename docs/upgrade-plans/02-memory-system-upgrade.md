# 记忆系统升级实现方案 V1.0
## —— 从"向量检索"到"双层认知记忆"

> **方案版本**：V1.0
> **创建日期**：2026-07-19
> **参考标杆**：astrbot_plugin_angel_memory 双层认知架构
> **预估工时**：4-6 天
> **优先级**：🔥🔥🔥🔥🔥 最高

---

## 一、目标与范围

### 1.1 核心目标

把当前的"向量检索记忆系统"升级为"双层认知记忆系统"——让 AI 的记忆不是"数据库查询"，而是"像真人一样有温度的回忆"。

### 1.2 升级前后对比

| 维度 | 当前（V1 向量检索） | 目标（V2 双层认知） |
|------|------------------|------------------|
| **记忆层次 | 扁平化，只有 importance 字段 | 核心记忆 + 情节记忆 双层 |
| **提取方式** | 关键词/向量搜索 | LLM 主动调用记忆工具 |
| **记忆温度** | 冷的，只有事实 | 有情绪色彩，回忆带感受 |
| **遗忘机制** | 没有，或者简单 clarity 衰减 | 艾宾浩斯遗忘曲线 + 回忆强化 |
| **关联记忆** | 没有，记忆是孤立的 | 激活扩散，想到 A 就想到 B |
| **作用域** | 全局共享 | 按角色/会话分离 |

### 1.3 功能范围

| 功能 | 包含 | 说明 |
|------|------|------|
| 双层记忆架构 | ✅ | 核心记忆 + 情节记忆 |
| LLM 记忆工具调用 | ✅ | 让 AI 主动决定记什么、回忆什么 |
| 情绪标签 | ✅ | 记忆带情绪色彩 |
| 遗忘曲线 | ✅ | 艾宾浩斯遗忘 + 回忆强化 |
| 激活扩散 | ⚠️ 简化版 | 先实现基础的关联记忆 |
| 记忆作用域 | ✅ | 按角色分离 |
| 笔记系统 | ❌ | 暂缓，当前是 1v1 聊天场景 |
| 文件监控 | ❌ | 暂缓 |

---

## 二、数据结构设计

### 2.1 记忆条目数据结构

**文件位置**：`src/types/memory.ts`（扩展现有类型）

```typescript
import { EmotionDimension } from './emotion';

/**
 * 记忆类型
 */
export type MemoryType = 
  | 'core'        // 核心记忆：关于用户的根本事实
  | 'episodic'      // 情节记忆：具体事件
  | 'semantic'      // 语义记忆：知识/偏好/事实
  | 'procedural';   // 程序记忆：相处模式/习惯

/**
 * 记忆情绪标签
 */
export interface MemoryEmotionTag {
  dimension: EmotionDimension;  // 情绪维度
  intensity: number;          // 强度 0-100
}

/**
 * 关联记忆关联条目
 */
export interface MemoryAssociation {
  targetMemoryId: string;     // 关联的记忆 ID
  strength: number;       // 关联强度 0-1
  type: 'topic' | 'emotion' | 'time' | 'person'; // 关联类型
}

/**
 * 单条记忆条目（V2 增强版）
 */
export interface MemoryEntryV2 {
  id: string;
  
  // 基本信息
  type: MemoryType;           // 记忆类型
  content: string;              // 记忆内容
  summary?: string;               // 摘要（自动生成）
  
  // 角色与作用域
  characterId: string;         // 所属角色
  scope: string;               // 作用域（如 "default", "work", "family" 等）
  
  // 重要性与清晰度
  importance: number;          // 重要性 0-100
  clarity: number;            // 清晰度 0-100（会随时间衰减）
  initialImportance: number;    // 初始重要性（用于遗忘曲线计算）
  
  // 情绪标签
  emotionTags: MemoryEmotionTag[]; // 情绪标签列表
  primaryEmotion?: EmotionDimension; // 主导情绪
  
  // 时间信息
  createdAt: number;             // 创建时间
  lastRecalledAt: number;     // 最后被回忆的时间
  recallCount: number;       // 被回忆次数
  
  // 关联记忆
  associations: MemoryAssociation[]; // 关联记忆
  
  // 元数据
  source: 'auto_extract' | 'manual' | 'tool_call' | 'import'; // 来源
  tags: string[];             // 标签
  metadata?: Record<string, any>; // 额外元数据
}

/**
 * 核心记忆（用户画像
 */
export interface CoreMemoryProfile {
  // 用户基本信息
  name?: string;
  age?: number;
  gender?: string;
  occupation?: string;
  location?: string;
  
  // 喜好
  likes: string[];
  dislikes: string[];
  hobbies: string[];
  
  // 关系信息
  relationshipType: string;    // 关系类型
  relationshipLevel: number;     // 关系亲密度 0-100
  
  // 重要日期
  importantDates: Array<{
    date: string;
    event: string;
  }>;
  
  // 雷区/禁忌
  forbiddenTopics: string[];
  
  // 自定义字段
  customFields: Record<string, string>;
}

/**
 * 记忆检索结果
 */
export interface MemoryRetrievalResult {
  memory: MemoryEntryV2;
  relevanceScore: number;      // 相关性得分 0-1
  emotionalRelevance?: number;     // 情绪相关性 0-1
  recencyBonus?: number;      // 新近度加成
  totalScore: number;         // 综合得分
}

/**
 * 记忆检索配置
 */
export interface MemoryRetrievalConfig {
  enabled: boolean;
  maxResults: number;           // 最大返回数量
  minRelevance: number;        // 最小相关性
  minClarity: number;          // 最小清晰度
  enableEmotionMatching: boolean; // 启用情绪匹配
  enableActivationSpread: boolean; // 启用激活扩散
  decayEnabled: boolean;        // 启用遗忘
  coreMemoryWeight: number;       // 核心记忆权重加成
}

export const DEFAULT_MEMORY_RETRIEVAL_CONFIG: MemoryRetrievalConfig = {
  enabled: true,
  maxResults: 8,
  minRelevance: 0.5,
  minClarity: 10,
  enableEmotionMatching: true,
  enableActivationSpread: false, // 先关闭，后续再开
  decayEnabled: true,
  coreMemoryWeight: 1.5,
};
```

### 2.2 记忆工具调用 Schema

用于 LLM Function Calling 的工具定义：

```typescript
/**
 * 记忆工具定义（用于 LLM function calling）
 */
export const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'remember_core_memory',
      description: '记住一件重要的事，写入核心记忆。只有关于用户身份、关系、重要偏好等根本事实才用这个。',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: '要记住的内容，用一句简洁的话描述',
          },
          importance: {
            type: 'number',
            description: '重要性，0-100，默认 70',
            default: 70,
          },
          emotion: {
            type: 'string',
            description: '这件事的情绪色彩，比如开心/难过/感动/生气等',
          },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall_memories',
      description: '回忆相关的记忆，搜索和当前话题相关的往事。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '要搜索的关键词或话题',
          },
          count: {
            type: 'number',
            description: '想要回忆多少条，默认 5',
            default: 5,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_episodic_memory',
      description: '保存一个具体事件到情节记忆中。比如今天发生了什么有趣的事。',
      parameters: {
        type: 'object',
        properties: {
          event: {
            type: 'string',
            description: '事件描述，详细一点',
          },
          emotion: {
            type: 'string',
            description: '当时的心情',
          },
          importance: {
            type: 'number',
            description: '重要性，0-100，默认 50',
            default: 50,
          },
        },
        required: ['event'],
      },
    },
  },
];
```

---

## 三、核心算法实现

### 3.1 遗忘曲线计算

**文件位置**：`src/services/memory/forgettingCurve.ts`（新建）

```typescript
import { MemoryEntryV2 } from '@/types/memory';

/**
 * 艾宾浩斯遗忘曲线计算
 * 
 * 公式：R = e^(-t/S)
 * R = 保持率（retention）
 * t = 时间
 * S = 记忆强度（由重要性和回忆次数决定）
 */

export class ForgettingCurve {
  /**
   * 计算当前清晰度
   */
  static calculateClarity(memory: MemoryEntryV2, now: number = Date.now()): number {
    const timeSinceCreation = now - memory.createdAt;
    const timeSinceLastRecall = now - memory.lastRecalledAt;
    
    // 记忆强度 S = 初始重要性 × (1 + 回忆次数 × 强化因子)
    const recallBoost = 1 + memory.recallCount * 0.3;
    const baseStrength = memory.initialImportance * recallBoost;
    
    // 时间衰减因子（以天为单位）
    const daysSinceCreation = timeSinceCreation / (1000 * 60 * 60 * 24);
    const daysSinceRecall = timeSinceLastRecall / (1000 * 60 * 60 * 24);
    
    // 艾宾浩斯曲线：R = e^(-t/S)
    // S 越大，衰减越慢
    const strengthDays = baseStrength / 10; // 强度换算成天数尺度
    const retentionFromCreation = Math.exp(-daysSinceCreation / strengthDays);
    const retentionFromRecall = Math.exp(-daysSinceRecall / (strengthDays * 0.5));
    
    // 综合保持率：取两者中较高的（最近回忆过的记忆更清晰）
    const retention = Math.max(retentionFromCreation, retentionFromRecall);
    
    // 清晰度 = 初始重要性 × 保持率
    const clarity = memory.initialImportance * retention;
    
    return Math.max(0, Math.min(100, clarity));
  }

  /**
   * 回忆后强化（每次回忆都会加强记忆）
   */
  static reinforceOnRecall(memory: MemoryEntryV2): MemoryEntryV2 {
    const now = Date.now();
    const newRecallCount = memory.recallCount + 1;
    
    // 边际递减：回忆次数越多，每次强化的效果越弱
    const reinforcementFactor = 1 / (1 + newRecallCount * 0.2);
    const clarityBoost = 10 * reinforcementFactor;
    
    const newClarity = Math.min(100, memory.clarity + clarityBoost);
    
    return {
      ...memory,
      recallCount: newRecallCount,
      lastRecalledAt: now,
      clarity: newClarity,
    };
  }

  /**
   * 计算记忆半衰期（天）
   */
  static getHalfLifeDays(memory: MemoryEntryV2): number {
    const recallBoost = 1 + memory.recallCount * 0.3;
    const baseStrength = memory.initialImportance * recallBoost;
    const strengthDays = baseStrength / 10;
    
    // 半衰期 = S × ln(2)
    return strengthDays * Math.LN2;
  }

  /**
   * 批量更新所有记忆的清晰度
   */
  static batchUpdateClarity(memories: MemoryEntryV2[]): MemoryEntryV2[] {
    const now = Date.now();
    return memories.map(mem => ({
      ...mem,
      clarity: this.calculateClarity(mem, now),
    }));
  }
}
```

### 3.2 多维度记忆检索器

**文件位置**：`src/services/memory/memoryRetriever.ts`（新建）

```typescript
import {
  MemoryEntryV2,
  MemoryRetrievalResult,
  MemoryRetrievalConfig,
  DEFAULT_MEMORY_RETRIEVAL_CONFIG,
} from '@/types/memory';
import { ForgettingCurve } from './forgettingCurve';

export class MemoryRetriever {
  private config: MemoryRetrievalConfig;

  constructor(config?: Partial<MemoryRetrievalConfig>) {
    this.config = { ...DEFAULT_MEMORY_RETRIEVAL_CONFIG, ...config };
  }

  /**
   * 检索相关记忆
   * 
   * 综合考虑：
   * 1. 语义相关性（向量相似度）
   * 2. 情绪匹配度
   * 3. 新近度
   * 4. 重要性/清晰度
   * 5. 核心记忆权重加成
   */
  retrieve(
    query: string,
    allMemories: MemoryEntryV2[],
    currentEmotion?: string,
  ): MemoryRetrievalResult[] {
    if (!this.config.enabled || allMemories.length === 0) {
      return [];
    }

    const now = Date.now();
    const results: MemoryRetrievalResult[] = [];

    for (const memory of allMemories) {
      // 跳过清晰度太低的记忆
      const currentClarity = ForgettingCurve.calculateClarity(memory, now);
      if (currentClarity < this.config.minClarity) {
        continue;
      }

      // 1. 语义相关性（这里先用简单的关键词匹配，实际用向量）
      const relevanceScore = this.calculateKeywordRelevance(query, memory.content);
      if (relevanceScore < this.config.minRelevance) {
        continue;
      }

      // 2. 情绪相关性
      let emotionalRelevance = 0;
      if (this.config.enableEmotionMatching && currentEmotion) {
        emotionalRelevance = this.calculateEmotionRelevance(memory, currentEmotion);
      }

      // 3. 新近度加成
      const recencyBonus = this.calculateRecencyBonus(memory, now);

      // 4. 核心记忆权重
      const typeWeight = memory.type === 'core' ? this.config.coreMemoryWeight : 1;

      // 5. 综合得分
      const totalScore = (
        relevanceScore * 0.5 +
        emotionalRelevance * 0.2 +
        recencyBonus * 0.1 +
        (currentClarity / 100) * 0.2
      ) * typeWeight;

      results.push({
        memory: { ...memory, clarity: currentClarity },
        relevanceScore,
        emotionalRelevance,
        recencyBonus,
        totalScore,
      });
    }

    // 按综合得分排序
    results.sort((a, b) => b.totalScore - a.totalScore);

    // 限制返回数量
    const topResults = results.slice(0, this.config.maxResults);

    // 更新回忆次数和时间
    topResults.forEach(result => {
      result.memory = ForgettingCurve.reinforceOnRecall(result.memory);
    });

    return topResults;
  }

  /**
   * 关键词相关性计算（简化版，实际用向量搜索）
   */
  private calculateKeywordRelevance(query: string, content: string): number {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const contentLower = content.toLowerCase();
    
    if (queryWords.length === 0) return 0.5;
    
    let matchCount = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        matchCount++;
      }
    }
    
    return matchCount / queryWords.length;
  }

  /**
   * 情绪相关性计算
   */
  private calculateEmotionRelevance(memory: MemoryEntryV2, currentEmotion: string): number {
    if (!memory.primaryEmotion) return 0;
    
    // 相同情绪：高相关
    if (memory.primaryEmotion === currentEmotion) {
      return 0.8;
    }
    
    // 情绪维度相近（比如 joy 和 trust 是相近的正面情绪）
    const emotionGroups: Record<string, string[]> = {
      positive: ['joy', 'trust', 'anticipation', 'surprise'],
      negative: ['sadness', 'fear', 'anger', 'disgust'],
      social: ['pride', 'guilt', 'shame', 'envy'],
    };
    
    for (const group of Object.values(emotionGroups)) {
      if (group.includes(memory.primaryEmotion) && group.includes(currentEmotion)) {
        return 0.5;
      }
    }
    
    return 0.1;
  }

  /**
   * 新近度加成
   */
  private calculateRecencyBonus(memory: MemoryEntryV2, now: number): number {
    const daysSince = (now - memory.lastRecalledAt) / (1000 * 60 * 60 * 24);
    
    if (daysSince < 1) return 1;           // 1天内：满加成
    if (daysSince < 7) return 0.7;           // 1周内：高加成
    if (daysSince < 30) return 0.4;          // 1个月内：中加成
    if (daysSince < 90) return 0.2;          // 3个月内：低加成
    return 0.05;                               // 更久：微加成
  }

  /**
   * 激活扩散（简化版）
   * 从初始结果出发，找到关联的记忆
   */
  activationSpread(
    initialResults: MemoryRetrievalResult[],
    allMemories: MemoryEntryV2[],
  ): MemoryRetrievalResult[] {
    if (!this.config.enableActivationSpread) {
      return initialResults;
    }

    const resultMap = new Map<string, MemoryRetrievalResult>();
    
    // 先把初始结果加入
    for (const result of initialResults) {
      resultMap.set(result.memory.id, result);
    }

    // 对每个结果，找它的关联记忆
    for (const result of initialResults) {
      for (const assoc of result.memory.associations) {
        if (resultMap.has(assoc.targetMemoryId)) continue;
        
        const assocMemory = allMemories.find(m => m.id === assoc.targetMemoryId);
        if (!assocMemory) continue;
        
        // 关联记忆得分 = 原得分 × 关联强度 × 衰减因子
        const spreadScore = result.totalScore * assoc.strength * 0.6;
        
        if (spreadScore > this.config.minRelevance * 0.5) {
          resultMap.set(assocMemory.id, {
            memory: assocMemory,
            relevanceScore: spreadScore,
            totalScore: spreadScore,
          });
        }
      }
    }

    // 重新排序
    return Array.from(resultMap.values())
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, this.config.maxResults);
  }
}
```

### 3.3 记忆自动提取器

**文件位置**：`src/services/memory/memoryExtractor.ts`（新建）

```typescript
import { MemoryEntryV2, MemoryType } from '@/types/memory';
import { v4 as uuidv4 } from 'uuid';

/**
 * 记忆自动提取器
 * 
 * 从对话中自动提取值得记住的内容
 */

export class MemoryExtractor {
  /**
   * 判断是否值得记忆
   */
  static shouldRemember(
    message: string,
    role: 'user' | 'assistant',
    importanceThreshold: number = 40,
  ): boolean {
    if (role !== 'user') return false;
    
    const lowerMsg = message.toLowerCase();
    
    // 太短的不记
    if (message.length < 5) return false;
    
    // 包含以下类型的内容值得记
    const memoryWorthyPatterns = [
      // 自我介绍/我叫/我是/我的名字',
      /我喜欢|我讨厌|我爱好|我擅长|我不喜欢',
      /我家|我住|我在.*工作|我的职业',
      /今天.*生日|今天.*纪念日',
      /我(觉得|认为|希望|想要).{3,}/,  // 表达观点/愿望
      /记得|别忘了|一定要记住',
    ];
    
    for (const pattern of memoryWorthyPatterns) {
      if (pattern.test(lowerMsg)) {
        return true;
      }
    }
    
    // 长度适中且包含具体信息的长消息
    if (message.length > 50 && /我|我的|今天|昨天|之前/.test(message)) {
      return true;
    }
    
    return false;
  }

  /**
   * 从用户消息中提取记忆
   */
  static extractFromUserMessage(
    message: string,
    characterId: string,
    emotion?: string,
  ): MemoryEntryV2 | null {
    if (!this.shouldRemember(message, 'user')) {
      return null;
    }

    // 判断记忆类型
    const type = this.determineMemoryType(message);
    
    // 估算重要性
    const importance = this.estimateImportance(message, type);
    
    // 生成摘要
    const summary = this.generateSummary(message);
    
    const memory: MemoryEntryV2 = {
      id: uuidv4(),
      type,
      content: message,
      summary,
      characterId,
      scope: 'default',
      importance,
      clarity: importance, // 初始清晰度 = 重要性
      initialImportance: importance,
      emotionTags: emotion ? [{ dimension: emotion as any, intensity: 50 }] : [],
      primaryEmotion: emotion as any,
      createdAt: Date.now(),
      lastRecalledAt: Date.now(),
      recallCount: 0,
      associations: [],
      source: 'auto_extract',
      tags: this.extractTags(message),
      metadata: {},
    };

    return memory;
  }

  /**
   * 判断记忆类型
   */
  private static determineMemoryType(message: string): MemoryType {
    const lowerMsg = message.toLowerCase();
    
    // 核心记忆：关于身份、关系、重要偏好
    if (/我叫|我是|我的名字|我.*岁|我.*工作|我的职业/.test(lowerMsg)) {
      return 'core';
    }
    
    // 情节记忆：具体事件
    if (/今天|昨天|前天|上次|有一次|记得吗|还记得/.test(lowerMsg)) {
      return 'episodic';
    }
    
    // 语义记忆：偏好、事实
    if (/喜欢|讨厌|爱好|擅长|不喜欢|觉得.*好/.test(lowerMsg)) {
      return 'semantic';
    }
    
    // 默认语义记忆
    return 'semantic';
  }

  /**
   * 估算重要性
   */
  private static estimateImportance(message: string, type: MemoryType): number {
    let baseScore = 50;
    
    // 核心记忆重要性更高
    if (type === 'core') baseScore += 20;
    
    // 包含强烈情绪词
    if (/非常|特别|超级|最|永远|一辈子/.test(message)) {
      baseScore += 15;
    }
    
    // 长度加成
    if (message.length > 100) baseScore += 5;
    
    // 限制范围
    return Math.max(20, Math.min(95, baseScore));
  }

  /**
   * 生成摘要
   */
  private static generateSummary(message: string): string {
    // 简单版：取前 50 个字
    if (message.length <= 50) return message;
    return message.substring(0, 47) + '...';
  }

  /**
   * 提取标签
   */
  private static extractTags(message: string): string[] {
    const tags: string[] = [];
    
    // 简单提取关键词
    const keywords = ['喜欢', '讨厌', '工作', '生日', '爱好', '家庭', '朋友'];
    for (const kw of keywords) {
      if (message.includes(kw)) {
        tags.push(kw);
      }
    }
    
    return tags;
  }
}
```

---

## 四、LLM 记忆工具调用集成

### 4.1 记忆工具处理器

**文件位置**：`src/services/memory/memoryToolHandler.ts`（新建）

```typescript
import { MemoryEntryV2 } from '@/types/memory';
import { MemoryRetriever } from './memoryRetriever';
import { v4 as uuidv4 } from 'uuid';

/**
 * 记忆工具调用处理器
 * 
 * 处理 LLM 通过 function calling 发起的记忆操作
 */

export class MemoryToolHandler {
  private memories: Map<string, MemoryEntryV2[]> = new Map();
  private retriever: MemoryRetriever;

  constructor(retriever?: MemoryRetriever) {
    this.retriever = retriever || new MemoryRetriever({});
  }

  /**
   * 处理工具调用
   */
  async handleToolCall(
    toolName: string,
    args: Record<string, any>,
    characterId: string,
  ): Promise<string> {
    switch (toolName) {
      case 'remember_core_memory':
        return this.handleRememberCore(args, characterId);
      
      case 'recall_memories':
        return this.handleRecall(args, characterId);
      
      case 'save_episodic_memory':
        return this.handleSaveEpisodic(args, characterId);
      
      default:
        return `未知工具: ${toolName}`;
    }
  }

  /**
   * 处理：记住核心记忆
   */
  private handleRememberCore(
    args: { content: string; importance?: number; emotion?: string },
    characterId: string,
  ): string {
    const memory: MemoryEntryV2 = {
      id: uuidv4(),
      type: 'core',
      content: args.content,
      characterId,
      scope: 'default',
      importance: args.importance || 70,
      clarity: args.importance || 70,
      initialImportance: args.importance || 70,
      emotionTags: args.emotion ? [{ dimension: args.emotion as any, intensity: 60 }] : [],
      primaryEmotion: args.emotion as any,
      createdAt: Date.now(),
      lastRecalledAt: Date.now(),
      recallCount: 0,
      associations: [],
      source: 'tool_call',
      tags: [],
      metadata: {},
    };

    this.addMemory(characterId, memory);
    return `已记住：${args.content}`;
  }

  /**
   * 处理：回忆记忆
   */
  private handleRecall(
    args: { query: string; count?: number },
    characterId: string,
  ): string {
    const allMemories = this.getMemories(characterId);
    const results = this.retriever.retrieve(args.query, allMemories);
    
    if (results.length === 0) {
      return '没有找到相关的记忆。';
    }

    const count = args.count || 5;
    const topResults = results.slice(0, count);

    let response = '想起了这些事：\n\n';
    topResults.forEach((result, index) => {
      const mem = result.memory;
      const emoji = mem.type === 'core' ? '💎' : '📝';
      response += `${index + 1}. ${emoji} ${mem.content}\n`;
      if (mem.primaryEmotion) {
        response += `   （当时的心情：${mem.primaryEmotion}）\n`;
      }
      response += `   清晰度：${Math.round(mem.clarity)}%\n\n`;
    });

    return response.trim();
  }

  /**
   * 处理：保存情节记忆
   */
  private handleSaveEpisodic(
    args: { event: string; emotion?: string; importance?: number },
    characterId: string,
  ): string {
    const memory: MemoryEntryV2 = {
      id: uuidv4(),
      type: 'episodic',
      content: args.event,
      characterId,
      scope: 'default',
      importance: args.importance || 50,
      clarity: args.importance || 50,
      initialImportance: args.importance || 50,
      emotionTags: args.emotion ? [{ dimension: args.emotion as any, intensity: 70 }] : [],
      primaryEmotion: args.emotion as any,
      createdAt: Date.now(),
      lastRecalledAt: Date.now(),
      recallCount: 0,
      associations: [],
      source: 'tool_call',
      tags: [],
      metadata: {},
    };

    this.addMemory(characterId, memory);
    return `已记住这个事件：${args.event.substring(0, 50)}...`;
  }

  // ===== 存储辅助方法 =====

  private getMemories(characterId: string): MemoryEntryV2[] {
    return this.memories.get(characterId) || [];
  }

  private addMemory(characterId: string, memory: MemoryEntryV2): void {
    const existing = this.getMemories(characterId);
    existing.push(memory);
    this.memories.set(characterId, existing);
  }

  /**
   * 加载记忆（从持久化存储）
   */
  loadMemories(characterId: string, memories: MemoryEntryV2[]): void {
    this.memories.set(characterId, memories);
  }

  /**
   * 获取所有记忆（用于持久化）
   */
  getAllMemories(characterId: string): MemoryEntryV2[] {
    return this.getMemories(characterId);
  }
}
```

---

## 五、集成到现有系统

### 5.1 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/store/memoryStore.ts` | 升级为 V2 记忆系统，集成双层架构 |
| `src/services/aiService.ts` | 支持 function calling，集成记忆工具 |
| `src/store/chatStore.ts` | 每轮对话后自动提取记忆 |
| `src/types/index.ts 或 types/memory.ts | 扩展记忆类型 |

### 5.2 集成流程图

```
用户发送消息
    ↓
1. 请求前（on_llm_request）
    ↓
├─ a. 自动提取：从最近对话中提取候选记忆
├─ b. 检索记忆：根据当前消息检索相关记忆
└─ c. 注入上下文：把记忆注入到 system prompt 中
    ↓
2. 调用 LLM（支持 function calling）
    ↓
3. 响应后（on_llm_response）
    ↓
├─ a. 检查是否有 function call
│   ├─ 有 → 调用记忆工具 → 获取结果
│   └─ 无 → 继续
├─ b. 自动提取：从 AI 回复中提取记忆候选
└─ c. 后台整理：异步执行记忆整理和遗忘计算
    ↓
4. 返回给用户
```

### 5.3 记忆注入 Prompt 示例

```
【相关记忆】
以下是一些你想起的事情，回复时可以参考：

💎 核心记忆：
- 用户的名字是小明
- 用户喜欢吃火锅

📝 情节记忆：
- 上次一起去看了电影，用户很开心（清晰度：85%）

注意：
1. 记忆只是参考，不要机械引用
2. 如果记忆不清楚或不确定，就当不知道
3. 你可以用 remember_core_memory 等工具来记住新的事情
```

---

## 六、分阶段实施计划

### 阶段一：基础升级（1-2 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 扩展类型定义 | MemoryEntryV2、相关类型 | 2h |
| 实现遗忘曲线 | forgettingCurve.ts | 2h |
| 升级 memoryStore | 集成 V2 数据结构 | 4h |
| 数据迁移 | 把旧记忆迁移到新格式 | 2h |
| 单元测试 | 核心算法测试 | 2h |

### 阶段二：记忆工具调用（2 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 实现记忆检索器 | memoryRetriever.ts 多维度检索 | 4h |
| 实现工具处理器 | memoryToolHandler.ts | 3h |
| 集成 function calling | aiService 支持工具调用 | 4h |
| 实现自动提取器 | memoryExtractor.ts | 3h |
| 集成到 chatStore | 自动提取 + 注入上下文 | 4h |

### 阶段三：增强功能（1-2 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 情绪标签集成 | 和情感系统联动 | 3h |
| 记忆作用域 | 按角色分离记忆 | 2h |
| 激活扩散（简化版） | 关联记忆 | 4h |
| UI 展示优化 | 记忆列表显示清晰度、情绪标签 | 4h |
| 实机测试 | 实际对话测试效果 | 2h |

---

## 七、风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|---------|
| LLM 不调用记忆工具 | 记忆系统失效 | 降级方案：继续用自动提取 + 被动检索 |
| 自动提取噪音太多 | 记忆质量差 | 重要性阈值 + 人工审查机制 |
| 遗忘太快/太慢 | 不真实 | 可配置参数 + A/B 测试调优 |
| 记忆太多检索慢 | 性能问题 | 索引优化 + 分页 + 缓存 |
| function calling 增加 token | 成本上升 | 可配置开关 + 只在需要时启用 |

---

## 八、验证标准

1. **记忆提取准确率**：自动提取的记忆中，>70% 是真正有价值的
2. **检索相关性**：人工评估，检索结果和话题相关度 > 80%
3. **遗忘自然度**：记忆遗忘曲线符合直觉，不会突然消失
4. **工具调用率**：LLM 在合适的时候会调用记忆工具（>30% 的对话轮次）
5. **拟人度提升**：用户评价"TA 记得我的事"

---

## 九、后续扩展方向

- [ ] 激活扩散完整版：记忆网络更复杂的关联
- [ ] 记忆整合/摘要：定期把多个相关记忆整合成一条
- [ ] 记忆反思：定期"睡觉"时整理和反思记忆
- [ ] 记忆可视化：记忆图谱 UI
- [ ] 记忆导入/导出：支持备份和迁移
