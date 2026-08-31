# 自学习系统升级实现方案 V1.0
## —— 从"静态人设"到"越聊越懂你"

> **方案版本**：V1.0
> **创建日期**：2026-07-19
> **参考标杆**：astrbot_plugin_self_learning v3.5.2
> **预估工时**：5-7 天
> **优先级**：🔥🔥🔥🔥 高

---

## 一、目标与范围

### 1.1 核心目标

把当前的"学习框架"升级为"渐进式自学习系统"——让 AI 不是"永远不变的人设"，而是"越聊越懂你、越聊越像你期待的样子"。

### 1.2 升级前后对比

| 维度 | 当前（V1 框架） | 目标（V2 渐进式学习） |
|------|---------------|---------------------|
| **学习方式** | 单次触发，一次性分析 | 渐进式，迭代学习 |
| **学习维度** | 词汇、短语 | 风格 + 偏好 + 关系 + 黑话 |
| **质量控制** | 没有，学了就生效 | 审查队列：批准/拒绝/回滚 |
| **注入方式** | system prompt 提一句 | 真正的 few-shot 示例注入 |
| **反馈闭环** | 没有 | 观察用户反应 → 调整学习方向 |
| **学习效果** | 不明显，聊久了还是老样子 | 能感觉到"TA 越来越懂我" |

### 1.3 功能范围

| 功能模块 | 包含 | 优先级 |
|----------|------|--------|
| 风格学习 | ✅ 说话方式、词汇、语气 | 🔥🔥🔥🔥🔥 |
| 偏好学习 | ✅ 喜好、雷区、话题偏好 | 🔥🔥🔥🔥 |
| 黑话/梗学习 | ✅ 专属梗、常用缩写 | 🔥🔥🔥 |
| few-shot 注入 | ✅ 真实对话示例注入 | 🔥🔥🔥🔥🔥 |
| 审查队列 | ✅ 批准/拒绝/删除/回滚 | 🔥🔥🔥🔥 |
| 渐进式学习 | ✅ 分阶段迭代 | 🔥🔥🔥🔥 |
| 学习质量监控 | ⚠️ 基础版 | 🔥🔥🔥 |
| 社交关系分析 | ⚠️ 简化版 | 🔥🔥🔥 |
| 知识图谱 | ❌ 暂缓 | 中 |
| WebUI Dashboard | ❌ 暂缓（当前项目有自己的 UI） | 中 |

---

## 二、数据结构设计

### 2.1 学习系统核心类型

**文件位置**：`src/types/learning.ts`（新建/扩展）

```typescript
/**
 * 学习项状态
 */
export type LearningItemStatus =
  | 'pending'      // 待审查
  | 'approved'     // 已批准（生效中）
  | 'rejected'     // 已拒绝
  | 'deprecated';  // 已废弃

/**
 * 学习项类型
 */
export type LearningItemType =
  | 'vocabulary'        // 词汇/口头禅
  | 'phrase'            // 常用短语
  | 'sentence_pattern'  // 句式模式
  | 'tone_style'        // 语气风格
  | 'preference'        // 偏好/喜好
  | 'forbidden_topic'   // 雷区/禁忌
  | 'jargon'            // 黑话/梗
  | 'few_shot_example'  // few-shot 示例
  | 'relationship_update'; // 关系更新

/**
 * 单条学习条目
 */
export interface LearningItem {
  id: string;
  type: LearningItemType;
  content: string;              // 学习内容
  summary?: string;              // 摘要
  examples?: string[];           // 示例（用户原话）
  sourceMessageIds: string[];  // 来源消息 ID
  characterId: string;
  
  // 状态
  status: LearningItemStatus;
  confidence: number;           // 置信度 0-100
  reviewCount: number;          // 审查次数
  
  // 效果追踪
  useCount: number;             // 被使用次数
  positiveFeedback: number;     // 正面反馈次数
  negativeFeedback: number;     // 负面反馈次数
  
  // 时间
  createdAt: number;
  reviewedAt?: number;
  lastUsedAt?: number;
  
  // 元数据
  metadata: Record<string, any>;
}

/**
 * 学习会话
 */
export interface LearningSession {
  id: string;
  characterId: string;
  startTime: number;
  endTime?: number;
  status: 'collecting' | 'analyzing' | 'reviewing' | 'completed';
  
  // 采集的消息
  collectedMessageCount: number;
  
  // 产出的学习项
  producedItemIds: string[];
  
  // 学习轮次
  round: number;
}

/**
 * 风格画像
 */
export interface StyleProfile {
  // 词汇特征
  vocabulary: {
    favoriteWords: Array<{ word: string; frequency: number }>;
    fillers: string[];          // 语气词/填充词
    petPhrases: string[];       // 口头禅
  };
  
  // 句式特征
  sentence: {
    avgLength: number;          // 平均句长
    shortRatio: number;         // 短句比例
    longRatio: number;          // 长句比例
    questionRatio: number;      // 问句比例
    exclamationRatio: number;   // 感叹句比例
  };
  
  // 语气特征
  tone: {
    formality: number;          // 正式度 0-100
    emotionality: number;       // 情绪化程度 0-100
    playfulness: number;        // 活泼程度 0-100
  };
  
  // 节奏特征
  pace: {
    avgResponseLength: number;  // 平均回复长度
    responseLengthVariance: number; // 回复长度方差
  };
}

/**
 * 黑话条目
 */
export interface JargonEntry {
  id: string;
  term: string;                 // 黑话/梗
  meaning: string;              // 含义解释
  usageExamples: string[];    // 用法示例
  frequency: number;            // 出现频率
  confidence: number;           // 含义置信度
  status: LearningItemStatus;
  firstSeenAt: number;
  lastSeenAt: number;
}

/**
 * few-shot 示例
 */
export interface FewShotExample {
  id: string;
  userMessage: string;          // 用户消息
  aiResponse: string;           // AI 回复
  styleTags: string[];        // 风格标签
  qualityScore: number;         // 质量评分 0-100
  status: LearningItemStatus;
  createdAt: number;
}

/**
 * 学习系统配置
 */
export interface LearningSystemConfig {
  enabled: boolean;
  
  // 触发设置
  triggerMode: 'rounds' | 'messages' | 'manual';
  triggerEveryNRounds: number;  // 每 N 轮触发一次学习
  triggerEveryNMessages: number; // 每 N 条消息触发一次
  
  // 学习维度开关
  enableStyleLearning: boolean;
  enablePreferenceLearning: boolean;
  enableJargonMining: boolean;
  enableFewShotGeneration: boolean;
  
  // 审查设置
  requireReview: boolean;        // 是否需要审查才生效
  autoApproveThreshold: number;  // 置信度高于此值自动批准
  
  // 质量控制
  maxPendingItems: number;       // 最大待审查数量
  maxApprovedItems: number;      // 最大生效数量
  
  // 注入设置
  maxFewShotsPerRequest: number; // 每次请求注入多少个 few-shot
  injectStyleProfile: boolean;   // 是否注入风格画像
  
  // 边界控制
  maxPersonaDrift: number;       // 最大人设偏移度 0-100
}

export const DEFAULT_LEARNING_CONFIG: LearningSystemConfig = {
  enabled: false, // 默认关闭，需要手动开启
  triggerMode: 'rounds',
  triggerEveryNRounds: 20,
  triggerEveryNMessages: 50,
  enableStyleLearning: true,
  enablePreferenceLearning: true,
  enableJargonMining: true,
  enableFewShotGeneration: true,
  requireReview: true,
  autoApproveThreshold: 85,
  maxPendingItems: 50,
  maxApprovedItems: 100,
  maxFewShotsPerRequest: 3,
  injectStyleProfile: true,
  maxPersonaDrift: 30,
};
```

---

## 三、核心算法实现

### 3.1 风格学习器

**文件位置**：`src/services/learning/styleLearner.ts`（新建）

```typescript
import { StyleProfile, LearningItem, LearningItemStatus } from '@/types/learning';
import { v4 as uuidv4 } from 'uuid';

/**
 * 风格学习器
 * 
 * 从用户消息中提取说话风格特征
 */

export class StyleLearner {
  /**
   * 分析一批消息，生成风格画像
   */
  analyzeMessages(messages: Array<{ role: string; content: string }>): StyleProfile {
    const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
    
    return {
      vocabulary: this.analyzeVocabulary(userMessages),
      sentence: this.analyzeSentence(userMessages),
      tone: this.analyzeTone(userMessages),
      pace: this.analyzePace(messages),
    };
  }

  /**
   * 分析词汇特征
   */
  private analyzeVocabulary(messages: string[]): StyleProfile['vocabulary'] {
    const wordFreq: Record<string, number> = {};
    const fillers = new Set<string>();
    const petPhrases: string[] = [];
    
    // 常见语气词/填充词
    const fillerWords = ['啊', '哦', '嗯', '呀', '呢', '吧', '嘛', '啦', '诶', '哇', '哈', '唉'];
    
    for (const msg of messages) {
      // 简单分词（按字符，中文需要更复杂的分词，这里简化）
      for (let i = 0; i < msg.length; i++) {
        const char = msg[i];
        if (/[\u4e00-\u9fa5]/.test(char)) {
          wordFreq[char] = (wordFreq[char] || 0) + 1;
        }
      }
      
      // 检测语气词
      for (const filler of fillerWords) {
        if (msg.includes(filler)) {
          fillers.add(filler);
        }
      }
      
      // 检测重复字（如"哈哈哈哈"、"好好好"）
      const repeatMatch = msg.match(/(.)\1{2,}/g);
      if (repeatMatch) {
        repeatMatch.forEach(m => {
          const char = m[0];
          if (!petPhrases.includes(char + char + char)) {
            petPhrases.push(char + char + char);
          }
        });
      }
    }
    
    // 按频率排序
    const favoriteWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, frequency]) => ({ word, frequency }));
    
    return {
      favoriteWords,
      fillers: Array.from(fillers),
      petPhrases,
    };
  }

  /**
   * 分析句式特征
   */
  private analyzeSentence(messages: string[]): StyleProfile['sentence'] {
    let totalLength = 0;
    let shortCount = 0;
    let longCount = 0;
    let questionCount = 0;
    let exclamationCount = 0;
    let totalSentences = 0;
    
    for (const msg of messages) {
      // 按标点分句
      const sentences = msg.split(/[。！？!?\n]+/).filter(s => s.trim().length > 0);
      totalSentences += sentences.length;
      
      for (const sent of sentences) {
        const len = sent.trim().length;
        totalLength += len;
        
        if (len < 10) shortCount++;
        if (len > 50) longCount++;
      }
      
      if (msg.includes('?') || msg.includes('？')) questionCount++;
      if (msg.includes('!') || msg.includes('！')) exclamationCount++;
    }
    
    const avgLength = totalSentences > 0 ? totalLength / totalSentences : 0;
    
    return {
      avgLength,
      shortRatio: totalSentences > 0 ? shortCount / totalSentences : 0,
      longRatio: totalSentences > 0 ? longCount / totalSentences : 0,
      questionRatio: messages.length > 0 ? questionCount / messages.length : 0,
      exclamationRatio: messages.length > 0 ? exclamationCount / messages.length : 0,
    };
  }

  /**
   * 分析语气特征
   */
  private analyzeTone(messages: string[]): StyleProfile['tone'] {
    let formalityScore = 50;      // 默认中等
    let emotionalityScore = 50;
    let playfulnessScore = 50;
    
    const allText = messages.join('');
    
    // 正式度：正式用词越多分越高
    const formalWords = ['您好', '请问', '谢谢', '抱歉', '打扰', '请教', '承蒙'];
    const informalWords = ['你好呀', '嘿嘿', '哈哈', '嘤嘤', '呜呜', '啦', '嘛'];
    
    for (const word of formalWords) {
      if (allText.includes(word)) formalityScore += 5;
    }
    for (const word of informalWords) {
      if (allText.includes(word)) formalityScore -= 5;
    }
    
    // 情绪化：感叹号、表情符号越多分越高
    const exclamationCount = (allText.match(/[！!]/g) || []).length;
    const emojiCount = (allText.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
    emotionalityScore += exclamationCount * 2 + emojiCount * 5;
    
    // 活泼度：哈哈、嘿嘿等笑声越多分越高
    const laughCount = (allText.match(/哈哈|嘿嘿|呵呵|嘻嘻/g) || []).length;
    playfulnessScore += laughCount * 5;
    
    return {
      formality: Math.max(0, Math.min(100, formalityScore)),
      emotionality: Math.max(0, Math.min(100, emotionalityScore)),
      playfulness: Math.max(0, Math.min(100, playfulnessScore)),
    };
  }

  /**
   * 分析节奏特征
   */
  private analyzePace(messages: Array<{ role: string; content: string }>): StyleProfile['pace'] {
    const aiMessages = messages.filter(m => m.role === 'assistant').map(m => m.content);
    
    if (aiMessages.length === 0) {
      return {
        avgResponseLength: 0,
        responseLengthVariance: 0,
      };
    }
    
    const lengths = aiMessages.map(m => m.length);
    const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    
    // 方差
    const variance = lengths.length > 1
      ? lengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) / (lengths.length - 1)
      : 0;
    
    return {
      avgResponseLength: avgLength,
      responseLengthVariance: variance,
    };
  }

  /**
   * 从消息中提取学习条目
   */
  extractLearningItems(
    messages: Array<{ role: string; content: string }>,
    characterId: string,
  ): LearningItem[] {
    const items: LearningItem[] = [];
    const profile = this.analyzeMessages(messages);
    
    // 提取高频词汇
    const topWords = profile.vocabulary.favoriteWords.slice(0, 5);
    for (const { word, frequency } of topWords) {
      if (frequency >= 3) {
        items.push({
          id: uuidv4(),
          type: 'vocabulary',
          content: `用户常说"${word}"`,
          examples: [word],
          sourceMessageIds: [],
          characterId,
          status: 'pending',
          confidence: Math.min(100, frequency * 10),
          reviewCount: 0,
          useCount: 0,
          positiveFeedback: 0,
          negativeFeedback: 0,
          createdAt: Date.now(),
          metadata: { frequency },
        });
      }
    }
    
    // 提取语气词
    for (const filler of profile.vocabulary.fillers) {
      items.push({
        id: uuidv4(),
        type: 'vocabulary',
        content: `用户爱用语气词"${filler}"`,
        examples: [filler],
        sourceMessageIds: [],
        characterId,
        status: 'pending',
        confidence: 60,
        reviewCount: 0,
        useCount: 0,
        positiveFeedback: 0,
        negativeFeedback: 0,
        createdAt: Date.now(),
        metadata: { type: 'filler' },
      });
    }
    
    return items;
  }
}
```

### 3.2 黑话挖掘器

**文件位置**：`src/services/learning/jargonMiner.ts`（新建）

```typescript
import { JargonEntry, LearningItemStatus } from '@/types/learning';
import { v4 as uuidv4 } from 'uuid';

/**
 * 黑话/梗挖掘器
 * 
 * 从对话中找出高频但"不常见"的词，推测其含义
 */

export class JargonMiner {
  private commonWords: Set<string>;
  
  constructor() {
    // 常见词白名单（这些不是黑话）
    this.commonWords = new Set([
      '的', '了', '是', '我', '你', '他', '她', '它',
      '在', '有', '和', '就', '不', '人', '都', '一',
      '一个', '上', '也', '很', '到', '说', '要', '去',
      '你好', '谢谢', '对不起', '没关系', '再见',
      '哈哈', '呵呵', '嘿嘿', '嘻嘻', '嗯嗯', '好好',
    ]);
  }

  /**
   * 从消息中挖掘黑话候选
   */
  mineJargons(
    messages: Array<{ role: string; content: string }>,
    existingJargons: JargonEntry[] = [],
  ): JargonEntry[] {
    const allText = messages.map(m => m.content).join('\n');
    const candidates: JargonEntry[] = [];
    
    // 统计词频
    const wordFreq = this.countWords(allText);
    
    // 找出高频但不在常见词表中的词
    const existingTerms = new Set(existingJargons.map(j => j.term));
    
    for (const [word, freq] of Object.entries(wordFreq)) {
      // 过滤条件
      if (freq < 3) continue;                    // 至少出现 3 次
      if (word.length < 2) continue;              // 至少 2 个字
      if (this.commonWords.has(word)) continue;   // 不是常见词
      if (existingTerms.has(word)) continue;    // 还没收录过
      
      // 初步判断：可能是黑话
      candidates.push({
        id: uuidv4(),
        term: word,
        meaning: '',           // 含义待确定
        usageExamples: this.findExamples(word, messages).slice(0, 3),
        frequency: freq,
        confidence: 30,         // 初始置信度低，需要确认
        status: 'pending',
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
      });
    }
    
    // 按频率排序
    candidates.sort((a, b) => b.frequency - a.frequency);
    
    return candidates;
  }

  /**
   * 简单词频统计（2-4 字词组）
   */
  private countWords(text: string): Record<string, number> {
    const freq: Record<string, number> = {};
    
    // 统计 2 字词组
    for (let i = 0; i < text.length - 1; i++) {
      const word = text.substring(i, i + 2);
      if (/^[\u4e00-\u9fa5]{2}$/.test(word)) {
        freq[word] = (freq[word] || 0) + 1;
      }
    }
    
    // 统计 3 字词组
    for (let i = 0; i < text.length - 2; i++) {
      const word = text.substring(i, i + 3);
      if (/^[\u4e00-\u9fa5]{3}$/.test(word)) {
        freq[word] = (freq[word] || 0) + 1;
      }
    }
    
    return freq;
  }

  /**
   * 查找某个词的使用示例
   */
  private findExamples(
    word: string,
    messages: Array<{ role: string; content: string }>,
  ): string[] {
    const examples: string[] = [];
    
    for (const msg of messages) {
      if (msg.content.includes(word)) {
        // 截取包含这个词的上下文
        const index = msg.content.indexOf(word);
        const start = Math.max(0, index - 5);
        const end = Math.min(msg.content.length, index + word.length + 5);
        const context = msg.content.substring(start, end);
        if (!examples.includes(context)) {
          examples.push(context);
        }
      }
    }
    
    return examples;
  }

  /**
   * 生成含义解释（需要调用 LLM，这里先返回模板）
   */
  generateMeaningPrompt(term: string, examples: string[]): string {
    return `请解释以下网络用语/黑话的含义：

词语：${term}

上下文示例：
${examples.map((e, i) => `${i + 1}. ${e}`).join('\n')}

请用一句话解释它的含义，如果不确定就说"不确定"。`;
  }
}
```

### 3.3 few-shot 生成器

**文件位置**：`src/services/learning/fewShotGenerator.ts`（新建）

```typescript
import { FewShotExample, LearningItemStatus } from '@/types/learning';
import { v4 as uuidv4 } from 'uuid';

/**
 * Few-Shot 示例生成器
 * 
 * 从历史对话中挑选高质量的对话对，作为 few-shot 示例
 */

export class FewShotGenerator {
  /**
   * 从对话历史中生成 few-shot 候选
   */
  generateCandidates(
    messages: Array<{ role: string; content: string; id?: string }>,
    characterId: string,
  ): FewShotExample[] {
    const candidates: FewShotExample[] = [];
    
    // 找连续的"用户-助理"对话对
    for (let i = 0; i < messages.length - 1; i++) {
      const userMsg = messages[i];
      const aiMsg = messages[i + 1];
      
      if (userMsg.role !== 'user' || aiMsg.role !== 'assistant') continue;
      
      // 质量评估
      const qualityScore = this.evaluateQuality(userMsg.content, aiMsg.content);
      
      // 只保留质量较高的
      if (qualityScore >= 60) {
        candidates.push({
          id: uuidv4(),
          userMessage: userMsg.content,
          aiResponse: aiMsg.content,
          styleTags: this.extractStyleTags(aiMsg.content),
          qualityScore,
          status: 'pending',
          createdAt: Date.now(),
        });
      }
    }
    
    // 按质量排序
    candidates.sort((a, b) => b.qualityScore - a.qualityScore);
    
    // 最多返回 10 个候选
    return candidates.slice(0, 10);
  }

  /**
   * 评估对话对的质量
   */
  private evaluateQuality(userMsg: string, aiMsg: string): number {
    let score = 50; // 基础分
    
    // AI 回复长度适中加分（30-200 字）
    if (aiMsg.length >= 30 && aiMsg.length <= 200) {
      score += 15;
    } else if (aiMsg.length < 10 || aiMsg.length > 300) {
      score -= 15;
    }
    
    // 用户消息有意义加分
    if (userMsg.length >= 10) {
      score += 10;
    }
    
    // AI 回复包含语气词加分（更有"人味"）
    if (/[啊呀呢吧嘛啦哦嗯]/.test(aiMsg)) {
      score += 10;
    }
    
    // AI 回复包含 AI 腔减分
    if (/作为AI|我无法|综上所述/.test(aiMsg)) {
      score -= 30;
    }
    
    // AI 回复太短减分
    if (aiMsg.length < 5) {
      score -= 20;
    }
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * 提取风格标签
   */
  private extractStyleTags(text: string): string[] {
    const tags: string[] = [];
    
    if (/哈哈|嘿嘿|嘻嘻/.test(text)) tags.push('开心');
    if (/呜|哭|难过|伤心/.test(text)) tags.push('难过');
    if (/哼|讨厌|不理你/.test(text)) tags.push('傲娇');
    if (/害羞|脸红|不好意思/.test(text)) tags.push('害羞');
    if (/[？?]/.test(text) && (text.endsWith('？') || text.endsWith('?'))) tags.push('问句');
    if (/[！!]/.test(text)) tags.push('感叹');
    if (text.length > 100) tags.push('长篇');
    if (text.length < 30) tags.push('短篇');
    
    return tags;
  }

  /**
   * 选择最合适的 few-shot 注入
   */
  selectForInjection(
    query: string,
    allExamples: FewShotExample[],
    count: number = 3,
  ): FewShotExample[] {
    const approved = allExamples.filter(e => e.status === 'approved');
    if (approved.length === 0) return [];
    
    // 简单策略：选质量最高的 + 随机几个
    const topQuality = [...approved]
      .sort((a, b) => b.qualityScore - a.qualityScore)
      .slice(0, count * 2);
    
    // 随机打乱，选前 N 个
    const shuffled = topQuality.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  /**
   * 生成注入文本
   */
  formatForInjection(examples: FewShotExample[]): string {
    if (examples.length === 0) return '';
    
    let text = '\n\n【风格参考示例】\n以下是一些你之前的回复风格，可以参考：\n\n';
    
    examples.forEach((ex, i) => {
      text += `示例 ${i + 1}：\n`;
      text += `用户：${ex.userMessage}\n`;
      text += `你：${ex.aiResponse}\n\n`;
    });
    
    return text;
  }
}
```

### 3.4 审查队列管理器

**文件位置**：`src/services/learning/reviewQueue.ts`（新建）

```typescript
import { LearningItem, LearningItemStatus, FewShotExample, JargonEntry } from '@/types/learning';

/**
 * 审查队列管理器
 * 
 * 管理所有待审查的学习项，支持批准、拒绝、删除、回滚
 */

export class ReviewQueueManager {
  private items: Map<string, LearningItem> = new Map();
  private fewShots: Map<string, FewShotExample> = new Map();
  private jargons: Map<string, JargonEntry> = new Map();

  /**
   * 添加待审查项
   */
  addItem(item: LearningItem): void {
    this.items.set(item.id, item);
  }

  /**
   * 批量添加
   */
  addItems(items: LearningItem[]): void {
    items.forEach(item => this.items.set(item.id, item));
  }

  /**
   * 获取待审查列表
   */
  getPendingItems(status: LearningItemStatus = 'pending'): LearningItem[] {
    return Array.from(this.items.values())
      .filter(item => item.status === status)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 批准
   */
  approve(itemId: string): boolean {
    const item = this.items.get(itemId);
    if (!item) return false;
    
    item.status = 'approved';
    item.reviewedAt = Date.now();
    item.reviewCount++;
    return true;
  }

  /**
   * 拒绝
   */
  reject(itemId: string): boolean {
    const item = this.items.get(itemId);
    if (!item) return false;
    
    item.status = 'rejected';
    item.reviewedAt = Date.now();
    item.reviewCount++;
    return true;
  }

  /**
   * 删除
   */
  delete(itemId: string): boolean {
    return this.items.delete(itemId);
  }

  /**
   * 回滚（从 approved 变回 pending）
   */
  rollback(itemId: string): boolean {
    const item = this.items.get(itemId);
    if (!item || item.status !== 'approved') return false;
    
    item.status = 'pending';
    return true;
  }

  /**
   * 自动批准高置信度项
   */
  autoApprove(threshold: number = 85): string[] {
    const approvedIds: string[] = [];
    
    for (const [id, item] of this.items) {
      if (item.status === 'pending' && item.confidence >= threshold) {
        item.status = 'approved';
        item.reviewedAt = Date.now();
        approvedIds.push(id);
      }
    }
    
    return approvedIds;
  }

  /**
   * 获取统计数据
   */
  getStats() {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    
    for (const item of this.items.values()) {
      switch (item.status) {
        case 'pending': pending++; break;
        case 'approved': approved++; break;
        case 'rejected': rejected++; break;
      }
    }
    
    return {
      total: this.items.size,
      pending,
      approved,
      rejected,
      fewShotsCount: this.fewShots.size,
      jargonsCount: this.jargons.size,
    };
  }

  // ===== Few-Shot 管理 =====
  
  addFewShot(example: FewShotExample): void {
    this.fewShots.set(example.id, example);
  }

  getFewShots(status?: LearningItemStatus): FewShotExample[] {
    let list = Array.from(this.fewShots.values());
    if (status) {
      list = list.filter(e => e.status === status);
    }
    return list.sort((a, b) => b.qualityScore - a.qualityScore);
  }

  approveFewShot(id: string): boolean {
    const item = this.fewShots.get(id);
    if (!item) return false;
    item.status = 'approved';
    return true;
  }

  rejectFewShot(id: string): boolean {
    const item = this.fewShots.get(id);
    if (!item) return false;
    item.status = 'rejected';
    return true;
  }

  // ===== 黑话管理 =====
  
  addJargon(jargon: JargonEntry): void {
    this.jargons.set(jargon.id, jargon);
  }

  getJargons(status?: LearningItemStatus): JargonEntry[] {
    let list = Array.from(this.jargons.values());
    if (status) {
      list = list.filter(j => j.status === status);
    }
    return list.sort((a, b) => b.frequency - a.frequency);
  }

  approveJargon(id: string): boolean {
    const item = this.jargons.get(id);
    if (!item) return false;
    item.status = 'approved';
    return true;
  }

  rejectJargon(id: string): boolean {
    const item = this.jargons.get(id);
    if (!item) return false;
    item.status = 'rejected';
    return true;
  }
}
```

---

## 四、学习工作流

### 4.1 整体流程

```
消息积累（达到触发阈值）
    ↓
第 1 轮：采集与筛选
    ↓
    ├─ 筛选高质量对话
    └─ 保存到学习缓冲区
    ↓
第 2 轮：风格分析
    ↓
    ├─ StyleLearner 提取风格特征
    ├─ JargonMiner 挖掘黑话
    └─ FewShotGenerator 生成示例
    ↓
第 3 轮：生成学习条目
    ↓
    ├─ 生成学习项（待审查状态）
    └─ 加入审查队列
    ↓
第 4 轮：审查（自动 + 人工）
    ↓
    ├─ 高置信度 → 自动批准
    └─ 低置信度 → 人工审查
    ↓
第 5 轮：注入上下文
    ↓
    ├─ 风格画像注入
    ├─ few-shot 注入
    └─ 黑话解释注入
    ↓
LLM 生成回复
    ↓
第 6 轮：效果追踪
    ↓
    ├─ 记录使用情况
    └─ 收集用户反馈（隐式）
```

### 4.2 注入 Prompt 示例

```
【学习到的用户特征】
- 说话风格：活泼、爱用"呀"、"呢"等语气词
- 常用口头禅："哈哈哈哈"
- 喜欢的话题：猫、游戏、美食
- 雷区：别提工作压力

【黑话小词典】
- yyds = 永远滴神，表示赞叹
- 绝绝子 = 太棒了/太绝了

【风格参考】
示例 1：
用户：今天好开心呀！
你：哈哈哈哈什么事这么开心呀~说出来让我也乐乐！

示例 2：
用户：你在干嘛呢
你：在想你呀~嘿嘿
```

---

## 五、集成到现有系统

### 5.1 需要修改/新增的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/learning/styleLearner.ts` | 新建 | 风格学习器 |
| `src/services/learning/jargonMiner.ts` | 新建 | 黑话挖掘器 |
| `src/services/learning/fewShotGenerator.ts` | 新建 | few-shot 生成器 |
| `src/services/learning/reviewQueue.ts` | 新建 | 审查队列 |
| `src/store/learningStore.ts` | 大幅改造 | 升级为 V2 学习系统 |
| `src/services/aiService.ts` | 修改 | 集成学习注入 |
| `src/store/chatStore.ts` | 修改 | 触发学习流程 |
| `src/types/learning.ts` | 新建 | 类型定义 |

### 5.2 触发时机

```typescript
// 在 chatStore 中：
const sendUserMessage = async (content: string) => {
  // ... 现有逻辑 ...
  
  // 检查是否触发学习
  const config = learningStore.getState().config;
  if (config.enabled && config.triggerMode === 'rounds') {
    const roundCount = currentRoundCount++;
    if (roundCount % config.triggerEveryNRounds === 0) {
      // 后台触发学习（不阻塞）
      triggerLearningAsync(characterId);
    }
  }
};
```

---

## 六、分阶段实施计划

### 阶段一：基础框架（1 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 类型定义 | learning.ts 所有类型 | 2h |
| 风格学习器 | styleLearner.ts | 4h |
| 审查队列 | reviewQueue.ts | 3h |
| 单元测试 | 核心逻辑测试 | 2h |

### 阶段二：学习功能（2 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 黑话挖掘器 | jargonMiner.ts | 3h |
| few-shot 生成器 | fewShotGenerator.ts | 3h |
| 学习工作流 | 学习触发 + 迭代 | 4h |
| 升级 learningStore | 状态管理与持久化 | 4h |

### 阶段三：注入与集成（1-2 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| Prompt 注入 | 学习结果注入到 LLM 请求 | 3h |
| 集成到 aiService | 请求前注入 + 响应后学习 | 3h |
| 集成到 chatStore | 触发机制 | 2h |
| 效果追踪 | 使用统计 + 隐式反馈 | 3h |

### 阶段四：UI 与调优（1 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 审查面板 UI | 批准/拒绝/回滚界面 | 4h |
| 学习统计面板 | 展示学习进度和效果 | 3h |
| 实机测试 | 实际对话测试 | 2h |
| 参数调优 | 阈值、频率等调优 | 2h |

---

## 七、风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|---------|
| 学错了，人设跑偏 | OOC 风险 | 审查机制 + 人设偏移限制 + 回滚功能 |
| 学习噪音太多 | 质量差 | 置信度过滤 + 自动批准阈值 + 人工审查 |
| few-shot 效果不稳定 | 时好时坏 | 质量评分 + 人工审查 + 可关闭 |
| Token 消耗增加 | 成本上升 | 限制 few-shot 数量 + 可配置开关 |
| 学习太慢，用户没感觉 | 体验差 | 可调学习频率 + 第一阶段见效快的先上 |

---

## 八、验证标准

1. **学习质量**：批准的学习项中，>70% 是真正有价值的
2. **人设稳定性**：学习后人设偏移度 < 30%
3. **注入效果**：人工评估，few-shot 确实能改善回复风格
4. **用户感知**：用户评价"TA 越来越懂我了"
5. **审查效率**：自动批准率 > 50%，减少人工工作量

---

## 九、后续扩展方向

- [ ] 镜像效应：AI 的风格逐渐向用户靠拢
- [ ] 反馈闭环：根据用户隐式反馈调整学习方向
- [ ] 知识图谱：记忆和学习内容关联可视化
- [ ] 人格演化：长期关系中性格微妙变化
- [ ] 学习分享：导出/导入学习数据
