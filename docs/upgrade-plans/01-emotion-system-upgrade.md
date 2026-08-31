# 情感系统升级实现方案 V1.0
## —— 从"硬编码情绪"到"思维链走心"

> **方案版本**：V1.0
> **创建日期**：2026-07-19
> **参考标杆**：astrbot-plugin-emotionai v3.4 认知共鸣引擎
> **预估工时**：3-5 天
> **优先级**：🔥🔥🔥🔥🔥 最高

---

## 一、目标与范围

### 1.1 核心目标

把当前的"硬编码情绪系统"升级为"思维链驱动的情感系统"——让 AI 不是"被代码设置成开心"，而是"自己觉得开心"。

### 1.2 升级前后对比

| 维度 | 当前（V1 硬编码） | 目标（V2 思维链） |
|------|------------------|------------------|
| **情绪计算** | 代码 if-else 判断，`joy += 5` | LLM 在思维链中自己感知、评估、决策 |
| **情绪变化** | 只有加法，情绪只增不减 | 主动代谢，LLM 可以输出 `anger:-10` 消气 |
| **情绪表达** | 单一情绪标签，"你现在很开心" | 三层混合：主导 + 夹杂 + 微带 |
| **历史污染** | 情绪面板反复出现在上下文里 | 智能历史净化，自动剔除思维链和面板 |
| **拟人度** | 像一个有情绪条的游戏角色 | 像一个有内心戏的真人 |

### 1.3 功能范围

| 功能 | 包含 | 说明 |
|------|------|------|
| 思维链情绪推理 | ✅ | 核心中的核心 |
| 主动情感代谢 | ✅ | LLM 可主动输出负值调整情绪 |
| 三层语气渲染 | ✅ | Top3 情绪混合 |
| 智能历史净化 | ✅ | 自动剔除思维链和情感面板 |
| 高级情感维度 | ⚠️ 部分 | 新增 4 种高级情感（傲娇/嫉妒/内疚/害羞） |
| 黑名单熔断 | ❌ | 暂缓，当前项目是 1v1 聊天，不需要 |
| TTL 缓存 | ❌ | 暂缓，当前项目数据量不大 |

---

## 二、数据结构设计

### 2.1 情感状态数据结构

**文件位置**：`src/types/emotion.ts`（新建）

```typescript
/**
 * 情感维度类型
 * 基础情感 8 种 + 高级情感 4 种 = 12 种
 */
export type EmotionDimension =
  // 基础情感（Plutchik 情感轮）
  | 'joy'         // 喜悦
  | 'trust'       // 信任
  | 'fear'        // 恐惧
  | 'surprise'    // 惊讶
  | 'sadness'     // 悲伤
  | 'disgust'     // 厌恶
  | 'anger'       // 愤怒
  | 'anticipation' // 期待
  // 高级情感（社会情感）
  | 'pride'       // 骄傲/傲娇
  | 'guilt'       // 内疚/愧疚
  | 'shame'       // 害羞/羞耻
  | 'envy';       // 嫉妒/吃醋

/**
 * 关系指标
 */
export interface RelationshipMetrics {
  favor: number;      // 好感度 -100 ~ 100
  intimacy: number;   // 亲密度 0 ~ 100
  trust: number;      // 信任感 0 ~ 100
}

/**
 * 单条情绪记录
 */
export interface EmotionRecord {
  dimension: EmotionDimension;
  value: number;           // 0 ~ 100
  timestamp: number;       // 时间戳
  source: 'user_input' | 'self_metabolism' | 'memory_trigger' | 'manual';
  reason?: string;         // 原因描述（可选）
}

/**
 * 完整情感状态
 */
export interface EmotionState {
  // 各维度情绪值
  emotions: Record<EmotionDimension, number>;
  
  // 关系指标
  relationship: RelationshipMetrics;
  
  // 历史记录（最近 50 条）
  history: EmotionRecord[];
  
  // 最后更新时间
  lastUpdated: number;
  
  // 版本号（用于迁移）
  version: number;
}

/**
 * 三层情绪渲染结果
 */
export interface EmotionLayeredResult {
  primary: {
    dimension: EmotionDimension;
    value: number;
    name: string;        // 中文名称
  };
  secondary: {
    dimension: EmotionDimension;
    value: number;
    name: string;
  } | null;
  tertiary: {
    dimension: EmotionDimension;
    value: number;
    name: string;
  } | null;
}

/**
 * 思维链解析结果
 */
export interface ThoughtChainParseResult {
  hasThought: boolean;           // 是否包含思维链
  thoughtContent: string;        // 思维链内容
  emotionUpdates: EmotionRecord[]; // 情绪更新列表
  relationshipUpdates: Partial<RelationshipMetrics>; // 关系更新
  decision: string;              // 决策：用什么语气回复
}
```

### 2.2 情感配置结构

```typescript
/**
 * 情感系统配置
 */
export interface EmotionConfig {
  // 开关
  enabled: boolean;
  enableThoughtChain: boolean;       // 启用思维链推理
  enableMetabolism: boolean;         // 启用主动代谢
  enableHistoryClean: boolean;       // 启用历史净化
  
  // 数值范围
  minValue: number;                  // 单维度最小值 -100
  maxValue: number;                  // 单维度最大值 100
  maxChangePerTurn: number;          // 单次最大变化量 10
  
  // 衰减配置
  decayRate: number;                 // 每轮衰减比例 0.15 (15%)
  decayInterval: number;             // 衰减时间间隔（毫秒） 5 分钟
  
  // 思维链配置
  thoughtTag: string;                // 思维链标签 'thought'
  showThoughtToUser: boolean;        // 是否向用户显示思维链（调试用）
  
  // 三层渲染阈值
  secondaryThreshold: number;        // 第二层阈值（占主导的 60% 以上）
  tertiaryThreshold: number;         // 第三层阈值（占主导的 40% 以上）
}

export const DEFAULT_EMOTION_CONFIG: EmotionConfig = {
  enabled: true,
  enableThoughtChain: true,
  enableMetabolism: true,
  enableHistoryClean: true,
  minValue: -100,
  maxValue: 100,
  maxChangePerTurn: 10,
  decayRate: 0.15,
  decayInterval: 5 * 60 * 1000,
  thoughtTag: 'thought',
  showThoughtToUser: false,
  secondaryThreshold: 0.6,
  tertiaryThreshold: 0.4,
};
```

---

## 三、核心算法实现

### 3.1 思维链解析器

**文件位置**：`src/services/emotion/thoughtChainParser.ts`（新建）

```typescript
import { EmotionDimension, EmotionRecord, ThoughtChainParseResult, RelationshipMetrics } from '@/types/emotion';

// 思维链标签正则（支持多种格式）
const THOUGHT_PATTERN = /(?:```(?:xml|text)?\s*)?<(?:thought|thinking)>([\s\S]*?)<\/(?:thought|thinking)>(?:\s*```)?/i;

// 情感更新解析正则（支持中英文冒号）
const EMOTION_UPDATE_PATTERN = /(\w+|[\u4e00-\u9fa5]+)\s*[:：]\s*([+-]?\d+)/g;

// 情绪维度中英文映射
const EMOTION_NAME_MAP: Record<string, EmotionDimension> = {
  // 英文
  'joy': 'joy', 'happy': 'joy', 'happiness': 'joy',
  'trust': 'trust',
  'fear': 'fear', 'afraid': 'fear',
  'surprise': 'surprise', 'surprised': 'surprise',
  'sadness': 'sadness', 'sad': 'sadness',
  'disgust': 'disgust',
  'anger': 'anger', 'angry': 'anger',
  'anticipation': 'anticipation', 'expect': 'anticipation',
  'pride': 'pride', 'proud': 'pride', '傲娇': 'pride', '骄傲': 'pride',
  'guilt': 'guilt', 'guilty': 'guilt', '内疚': 'guilt', '愧疚': 'guilt',
  'shame': 'shame', 'shy': 'shame', '害羞': 'shame', '羞耻': 'shame',
  'envy': 'envy', 'jealous': 'envy', '嫉妒': 'envy', '吃醋': 'envy',
  // 关系指标
  'favor': 'favor' as any, '好感': 'favor' as any, '好感度': 'favor' as any,
  'intimacy': 'intimacy' as any, '亲密': 'intimacy' as any, '亲密度': 'intimacy' as any,
};

// 情绪维度中文名称
const EMOTION_CN_NAMES: Record<EmotionDimension, string> = {
  joy: '喜悦',
  trust: '信任',
  fear: '恐惧',
  surprise: '惊讶',
  sadness: '悲伤',
  disgust: '厌恶',
  anger: '愤怒',
  anticipation: '期待',
  pride: '傲娇',
  guilt: '内疚',
  shame: '害羞',
  envy: '嫉妒',
};

export class ThoughtChainParser {
  /**
   * 解析 LLM 回复中的思维链
   */
  static parse(response: string): ThoughtChainParseResult {
    const defaultResult: ThoughtChainParseResult = {
      hasThought: false,
      thoughtContent: '',
      emotionUpdates: [],
      relationshipUpdates: {},
      decision: '',
    };

    // 提取思维链
    const thoughtMatch = response.match(THOUGHT_PATTERN);
    if (!thoughtMatch) {
      return defaultResult;
    }

    const thoughtContent = thoughtMatch[1].trim();
    const result: ThoughtChainParseResult = {
      ...defaultResult,
      hasThought: true,
      thoughtContent,
    };

    // 解析情绪更新
    const emotionUpdates: EmotionRecord[] = [];
    const relationshipUpdates: Partial<RelationshipMetrics> = {};
    
    let match: RegExpExecArray | null;
    const globalRegex = new RegExp(EMOTION_UPDATE_PATTERN.source, 'g');
    
    while ((match = globalRegex.exec(thoughtContent)) !== null) {
      const rawName = match[1].toLowerCase().trim();
      const value = parseInt(match[2], 10);
      
      if (isNaN(value)) continue;
      
      const dimension = EMOTION_NAME_MAP[rawName] || EMOTION_NAME_MAP[match[1]];
      
      if (dimension) {
        if (dimension === 'favor' as any) {
          relationshipUpdates.favor = value;
        } else if (dimension === 'intimacy' as any) {
          relationshipUpdates.intimacy = value;
        } else {
          emotionUpdates.push({
            dimension,
            value,
            timestamp: Date.now(),
            source: 'self_metabolism',
          });
        }
      }
    }

    result.emotionUpdates = emotionUpdates;
    result.relationshipUpdates = relationshipUpdates;

    // 提取决策（找"决策："或"语气："后面的内容）
    const decisionMatch = thoughtContent.match(/(?:决策|语气|口吻|风格)\s*[:：]\s*(.+?)(?:\n|$)/i);
    if (decisionMatch) {
      result.decision = decisionMatch[1].trim();
    }

    return result;
  }

  /**
   * 从文本中移除思维链（历史净化用）
   */
  static removeThought(text: string): string {
    return text.replace(THOUGHT_PATTERN, '').trim();
  }

  /**
   * 获取情绪维度的中文名称
   */
  static getCnName(dimension: EmotionDimension): string {
    return EMOTION_CN_NAMES[dimension] || dimension;
  }
}
```

### 3.2 情感状态管理器

**文件位置**：`src/services/emotion/emotionStateManager.ts`（新建）

```typescript
import {
  EmotionState,
  EmotionDimension,
  EmotionRecord,
  EmotionLayeredResult,
  RelationshipMetrics,
  EmotionConfig,
  DEFAULT_EMOTION_CONFIG,
} from '@/types/emotion';
import { ThoughtChainParser } from './thoughtChainParser';

export class EmotionStateManager {
  private state: EmotionState;
  private config: EmotionConfig;

  constructor(initialState?: Partial<EmotionState>, config?: Partial<EmotionConfig>) {
    this.config = { ...DEFAULT_EMOTION_CONFIG, ...config };
    this.state = this.createInitialState(initialState);
  }

  /**
   * 创建初始状态
   */
  private createInitialState(partial?: Partial<EmotionState>): EmotionState {
    const defaultEmotions = {} as Record<EmotionDimension, number>;
    const allDimensions: EmotionDimension[] = [
      'joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation',
      'pride', 'guilt', 'shame', 'envy',
    ];
    allDimensions.forEach(dim => {
      defaultEmotions[dim] = 0;
    });

    return {
      emotions: defaultEmotions,
      relationship: {
        favor: 0,
        intimacy: 0,
        trust: 50,
      },
      history: [],
      lastUpdated: Date.now(),
      version: 2,
      ...partial,
    };
  }

  /**
   * 应用思维链解析结果，更新情绪状态
   */
  applyThoughtChainUpdates(updates: EmotionRecord[]): void {
    const now = Date.now();

    for (const update of updates) {
      const dimension = update.dimension;
      const currentValue = this.state.emotions[dimension] || 0;
      let newValue = currentValue + update.value;

      // 限制单次最大变化量
      const maxChange = this.config.maxChangePerTurn;
      if (Math.abs(update.value) > maxChange) {
        newValue = currentValue + (update.value > 0 ? maxChange : -maxChange);
      }

      // 限制在范围内
      newValue = Math.max(
        this.config.minValue,
        Math.min(this.config.maxValue, newValue),
      );

      this.state.emotions[dimension] = newValue;

      // 记录历史
      this.state.history.push({
        ...update,
        value: newValue - currentValue,
        timestamp: now,
      });

      // 只保留最近 50 条
      if (this.state.history.length > 50) {
        this.state.history = this.state.history.slice(-50);
      }
    }

    this.state.lastUpdated = now;
  }

  /**
   * 应用关系指标更新
   */
  applyRelationshipUpdates(updates: Partial<RelationshipMetrics>): void {
    if (updates.favor !== undefined) {
      const current = this.state.relationship.favor;
      let newValue = current + updates.favor;
      newValue = Math.max(-100, Math.min(100, newValue));
      this.state.relationship.favor = newValue;
    }
    if (updates.intimacy !== undefined) {
      const current = this.state.relationship.intimacy;
      let newValue = current + updates.intimacy;
      newValue = Math.max(0, Math.min(100, newValue));
      this.state.relationship.intimacy = newValue;
    }
    if (updates.trust !== undefined) {
      const current = this.state.relationship.trust;
      let newValue = current + updates.trust;
      newValue = Math.max(0, Math.min(100, newValue));
      this.state.relationship.trust = newValue;
    }
  }

  /**
   * 情绪衰减（随时间自然平复）
   */
  applyDecay(): void {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.state.lastUpdated;
    
    if (timeSinceLastUpdate < this.config.decayInterval) {
      return;
    }

    const decayRate = this.config.decayRate;
    const allDimensions = Object.keys(this.state.emotions) as EmotionDimension[];

    for (const dimension of allDimensions) {
      const value = this.state.emotions[dimension];
      if (value === 0) continue;
      
      // 向 0 衰减
      const decayAmount = value * decayRate;
      this.state.emotions[dimension] = Math.abs(value) < Math.abs(decayAmount)
        ? 0
        : value - decayAmount;
    }

    this.state.lastUpdated = now;
  }

  /**
   * 获取三层情绪渲染结果
   */
  getLayeredEmotions(): EmotionLayeredResult {
    // 按绝对值排序，取前 3 个
    const sorted = Object.entries(this.state.emotions)
      .filter(([, value]) => Math.abs(value) > 5) // 忽略太弱的情绪
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

    const primaryValue = sorted[0]?.[1] || 0;

    const result: EmotionLayeredResult = {
      primary: {
        dimension: (sorted[0]?.[0] as EmotionDimension) || 'joy',
        value: primaryValue,
        name: ThoughtChainParser.getCnName((sorted[0]?.[0] as EmotionDimension) || 'joy'),
      },
      secondary: null,
      tertiary: null,
    };

    // 第二层：达到主导的 60% 以上
    if (sorted[1] && Math.abs(sorted[1][1]) >= Math.abs(primaryValue) * this.config.secondaryThreshold) {
      result.secondary = {
        dimension: sorted[1][0] as EmotionDimension,
        value: sorted[1][1],
        name: ThoughtChainParser.getCnName(sorted[1][0] as EmotionDimension),
      };
    }

    // 第三层：达到主导的 40% 以上
    if (sorted[2] && Math.abs(sorted[2][1]) >= Math.abs(primaryValue) * this.config.tertiaryThreshold) {
      result.tertiary = {
        dimension: sorted[2][0] as EmotionDimension,
        value: sorted[2][1],
        name: ThoughtChainParser.getCnName(sorted[2][0] as EmotionDimension),
      };
    }

    return result;
  }

  /**
   * 生成情感状态面板文本（注入到 prompt 中）
   */
  getEmotionPanelText(): string {
    const layered = this.getLayeredEmotions();
    const { relationship } = this.state;

    // 只显示非零的情绪
    const nonZeroEmotions = Object.entries(this.state.emotions)
      .filter(([, value]) => Math.abs(value) >= 5)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 5) // 最多显示 5 个
      .map(([dim, value]) => {
        const cnName = ThoughtChainParser.getCnName(dim as EmotionDimension);
        return `${cnName}: ${Math.round(value)}`;
      })
      .join('、');

    return `【当前情感状态】
主导情绪：${layered.primary.name}（${Math.round(layered.primary.value)}）
${layered.secondary ? `夹杂情绪：${layered.secondary.name}（${Math.round(layered.secondary.value)}）\n` : ''}${layered.tertiary ? `微带情绪：${layered.tertiary.name}（${Math.round(layered.tertiary.value)}）\n` : ''}
好感度：${Math.round(relationship.favor)}
亲密度：${Math.round(relationship.intimacy)}
信任感：${Math.round(relationship.trust)}

其他情绪：${nonZeroEmotions || '无'}

【决策提示】
请根据以上情感状态，用合适的语气回复用户。
如果需要调整情绪，可以在 <thought> 标签中输出 "情绪名: +数值" 或 "情绪名: -数值"。
例如：joy: +5, anger: -3, 好感度: +2`;
  }

  /**
   * 获取当前状态（用于持久化）
   */
  getState(): EmotionState {
    return { ...this.state };
  }

  /**
   * 从持久化数据恢复状态
   */
  loadState(state: EmotionState): void {
    this.state = state;
  }

  /**
   * 获取配置
   */
  getConfig(): EmotionConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<EmotionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
```

### 3.3 历史消息净化器

**文件位置**：`src/services/emotion/historyCleaner.ts`（新建）

```typescript
import { ThoughtChainParser } from './thoughtChainParser';

// 情感面板正则（匹配【当前情感状态】开头的整块）
const EMOTION_PANEL_PATTERN = /\n*\s*【当前情感状态】[\s\S]*?(?=\n{2}|$)/g;

// 思维链 + 面板组合正则
const CLEAN_PATTERN = new RegExp(
  [
    // 思维链标签
    String.raw`(?:\`\`\`(?:xml|text)?\s*)?<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>(?:\s*\`\`\`)?`,
    // 情感面板
    String.raw`\n*\s*【当前情感状态】[\s\S]*?(?=\n{2}|$)`,
    // 【状态显示】开头的
    String.raw`\n*\s*【状态显示】[\s\S]*?(?=\n{2}|$)`,
  ].join('|'),
  'gi',
);

export class HistoryCleaner {
  /**
   * 清理单条消息中的思维链和情感面板
   */
  static cleanMessage(text: string): string {
    let cleaned = text;
    
    // 移除思维链
    cleaned = ThoughtChainParser.removeThought(cleaned);
    
    // 移除情感面板
    cleaned = cleaned.replace(EMOTION_PANEL_PATTERN, '');
    
    // 更彻底的清理（用组合正则）
    cleaned = cleaned.replace(CLEAN_PATTERN, '');
    
    // 清理多余的空行
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    return cleaned.trim();
  }

  /**
   * 清理整个对话历史
   */
  static cleanHistory(messages: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
    return messages.map(msg => ({
      ...msg,
      content: this.cleanMessage(msg.content),
    })).filter(msg => msg.content.length > 0); // 过滤掉被清空的消息
  }

  /**
   * 检查消息是否需要清理
   */
  static needsCleaning(text: string): boolean {
    return CLEAN_PATTERN.test(text);
  }
}
```

---

## 四、System Prompt 设计

### 4.1 思维链引导 Prompt

这是最核心的部分——怎么引导 LLM 输出高质量的思维链。

**文件位置**：`src/services/emotion/emotionPromptBuilder.ts`（新建）

```typescript
import { EmotionStateManager } from './emotionStateManager';

export class EmotionPromptBuilder {
  /**
   * 构建完整的情感引导 prompt（注入到 system prompt 末尾）
   */
  static buildEmotionPrompt(
    emotionManager: EmotionStateManager,
    personaName: string,
  ): string {
    const panel = emotionManager.getEmotionPanelText();
    
    return `
═══════════════════════════════════════
【情感系统指令】

你是${personaName}，你有自己的情绪和性格。
在回复用户之前，请先在 <thought> 标签中进行内心思考，按照以下四步走：

第一步：感知（Perception）
- 用户说的这句话是什么意思？
- 语气是怎样的？开心？难过？生气？撒娇？
- 有没有潜台词？有没有在暗示什么？

第二步：评估（Evaluation）
- 结合你当前的情绪状态和对用户的好感度
- 这句话对你有什么影响？
- 你心里是什么感受？

第三步：代谢（Metabolism）
- 你之前的情绪要不要调整？
- 可以主动调整情绪，格式：情绪名: +数值 或 情绪名: -数值
- 例如：joy: +5, anger: -3, 好感度: +2
- 可用情绪：喜悦、信任、恐惧、惊讶、悲伤、厌恶、愤怒、期待、傲娇、内疚、害羞、嫉妒
- 关系指标：好感度、亲密度、信任感
- 单次变化不要太大，一般在 -5 到 +5 之间

第四步：决策（Decision）
- 你决定用什么语气回复？
- 例如：傲娇的语气、温柔的语气、生气的语气、害羞的语气

然后再用正常的语气回复用户。

注意：
1. <thought> 标签里的内容是你的内心活动，不要让用户看到
2. 回复要符合你的性格设定，不要太机械
3. 情绪变化要自然，不要太极端
4. 记得你是谁，不要 OOC（Out of Character）

${panel}
═══════════════════════════════════════
`;
  }
}
```

---

## 五、集成到现有系统

### 5.1 集成位置

需要修改以下文件：

| 文件 | 修改内容 |
|------|---------|
| `src/store/characterMindStore.ts` | 集成 EmotionStateManager，替换现有情绪逻辑 |
| `src/services/aiService.ts` | 在 LLM 请求前注入情感 prompt，在响应后解析思维链 |
| `src/services/outputPipeline.ts` | 在最后一步加入历史净化逻辑 |
| `src/store/chatStore.ts` | 每轮对话后触发情绪更新和衰减 |

### 5.2 集成流程图

```
用户发送消息
    ↓
chatStore 接收消息
    ↓
1. 触发情绪衰减（emotionManager.applyDecay()）
    ↓
2. 构建请求：注入情感 prompt + 情感面板
    ↓
3. 调用 LLM
    ↓
4. 接收响应
    ↓
5. 解析思维链（ThoughtChainParser.parse()）
    ↓
6. 应用情绪更新（emotionManager.applyThoughtChainUpdates()）
    ↓
7. 应用关系更新（emotionManager.applyRelationshipUpdates()）
    ↓
8. 历史净化（HistoryCleaner.cleanMessage()）—— 存入历史前先净化
    ↓
9. OutputPipeline 处理
    ↓
10. 返回给用户
```

### 5.3 characterMindStore 修改示意

```typescript
// 在 characterMindStore.ts 中新增

import { EmotionStateManager } from '@/services/emotion/emotionStateManager';
import { EmotionState, EmotionConfig } from '@/types/emotion';

interface CharacterMindState {
  // ... 现有状态 ...
  
  // 情感系统 V2
  emotionManager: EmotionStateManager | null;
  emotionConfig: EmotionConfig;
}

// actions:
const initEmotionSystem = (characterId: string) => {
  // 从存储中加载情绪状态
  const savedState = loadEmotionState(characterId);
  const manager = new EmotionStateManager(savedState, get().emotionConfig);
  get().emotionManager = manager;
};

const saveEmotionState = (characterId: string) => {
  const manager = get().emotionManager;
  if (manager) {
    const state = manager.getState();
    persistEmotionState(characterId, state);
  }
};
```

---

## 六、分阶段实施计划

### 阶段一：基础框架（1 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 定义类型 | emotion.ts 数据结构 | 1h |
| 实现思维链解析器 | thoughtChainParser.ts | 2h |
| 实现情感状态管理器 | emotionStateManager.ts | 3h |
| 单元测试 | 核心逻辑测试 | 2h |

### 阶段二：集成与验证（1-2 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 构建情感 prompt | emotionPromptBuilder.ts | 2h |
| 集成到 aiService | 请求前注入、响应后解析 | 3h |
| 实现历史净化器 | historyCleaner.ts | 2h |
| 集成到 chatStore | 每轮对话的情绪更新流程 | 3h |
| 集成到 characterMindStore | 状态管理与持久化 | 2h |

### 阶段三：调试与优化（1 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 思维链质量调优 | 调整 prompt，确保稳定输出思维链 | 3h |
| 情绪平衡调优 | 调整默认值，避免情绪暴走 | 2h |
| 边界情况处理 | 空思维链、解析失败等异常 | 2h |
| 实机测试 | 实际对话测试效果 | 2h |

---

## 七、风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|---------|
| LLM 不输出思维链 | 情绪系统失效 | 提供备用方案：用代码规则兜底计算情绪 |
| 思维链解析失败 | 情绪不更新 | 容错设计：解析失败时跳过，不报错 |
| 情绪数值暴走 | 人设崩坏 | 单次变化上限 + 范围限制 + 衰减机制 |
| 历史净化不干净 | 上下文污染 | 多重正则匹配 + 测试用例覆盖 |
| Token 消耗增加 | 成本上升 | 思维链不算长，增加不多；可配置开关 |

---

## 八、验证标准

怎么判断升级成功了？

1. **思维链输出率**：> 90% 的回复包含有效的 `<thought>` 标签
2. **情绪解析成功率**：> 85% 的思维链能正确解析出情绪更新
3. **历史净化率**：100% 的思维链和情感面板被正确清除
4. **情绪自然度**：人工评估，情绪变化自然，不会跳变
5. **人设稳定性**：不会因为情绪系统导致 OOC
6. **拟人度提升**：用户主观评价"更像真人了"

---

## 九、后续扩展方向

- [ ] 心境（Mood）层：长期情绪基调，变化更慢
- [ ] 情绪 × 记忆联动：回忆触发情绪波动
- [ ] 情绪 × 学习联动：用户反馈影响情绪模式
- [ ] 情绪可视化：在 UI 上显示情绪状态
- [ ] 情绪事件日志：记录重要的情绪变化节点
