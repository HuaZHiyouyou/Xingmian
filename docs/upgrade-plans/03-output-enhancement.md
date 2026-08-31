# 输出增强系统实现方案 V1.0
## —— 从"原始文本"到"真人输出"的 10 阶梯 Pipeline

> **方案版本**：V1.0
> **创建日期**：2026-07-19
> **参考标杆**：astrbot_plugin_outputpro + astrbot_plugin_splitter
> **预估工时**：3-4 天
> **优先级**：🔥🔥🔥🔥🔥 最高（见效最快）

---

## 一、目标与范围

### 1.1 核心目标

把当前的 OutputPipeline 从"4 个步骤"升级为"10 个可配置阶梯"——让 AI 的回复从"一看就是 AI 写的"变成"像是真人手敲的"。

### 1.2 升级前后对比

| 维度 | 当前（V1 4步） | 目标（V2 10阶梯） |
|------|--------------|-----------------|
| **处理步骤** | 4 步：清洗→拦截→分段→语气 | 10 阶梯，可独立开关、可排序 |
| **错字模拟** | 没有 | 同音错字 + 打错纠正，真人感拉满 |
| **分段策略** | 简单按标点切 | 成对符号保护 + 均分算法 + 4种延迟 |
| **可配置性** | 硬编码顺序 | 阶梯顺序可配置，每步可开关 |
| **拦截能力** | 基础 AI 腔 + 复读 | 超时拦截 + 官腔拦截 + 复读拦截 |
| **拟人度** | 中等 | 很高——有错字、有节奏、有风格 |

### 1.3 功能范围（10 阶梯）

| 序号 | 阶梯名称 | 功能 | 优先级 |
|------|---------|------|--------|
| ① | 思维链清洗 | 移除 `<thought>` 等推理标签 | 🔥🔥🔥🔥🔥 |
| ② | AI 腔拦截 | 检测官腔模板，触发重写 | 🔥🔥🔥🔥 |
| ③ | 复读拦截 | 检测重复内容，触发重写 | 🔥🔥🔥🔥 |
| ④ | 超时拦截 | 回复超时则丢弃 | 🔥🔥🔥 |
| ⑤ | 文本清洗 | 短文本"美容"，去括号/emoji | 🔥🔥🔥 |
| ⑥ | 文本替换 | 敏感词/占位符替换 | 🔥🔥🔥 |
| ⑦ | 错字模拟 | 同音错字 + 纠正提示 🔥 | 🔥🔥🔥🔥🔥 |
| ⑧ | 语气微调 | 根据情绪注入语气词 | 🔥🔥🔥🔥 |
| ⑨ | 长度随机化 | 模拟真人长度变化 | 🔥🔥🔥 |
| ⑩ | 分段回复 | 智能分段 + 拟真延迟 🔥 | 🔥🔥🔥🔥🔥 |

> 注：原 outputpro 有 13 阶梯，我们根据 1v1 聊天场景精简为 10 个，去掉了图片外显、文转语音、文转图片、智能引用、合并转发、自动撤回等群聊/多媒体相关功能。

---

## 二、数据结构设计

### 2.1 Pipeline 配置结构

**文件位置**：`src/types/outputPipeline.ts`（新建）

```typescript
/**
 * 阶梯 ID 枚举
 */
export type PipelineStepId =
  | 'clean_thought'        // ① 思维链清洗
  | 'block_cliche'         // ② AI腔拦截
  | 'block_duplicate'      // ③ 复读拦截
  | 'block_timeout'        // ④ 超时拦截
  | 'text_clean'           // ⑤ 文本清洗
  | 'text_replace'         // ⑥ 文本替换
  | 'typo_simulation'      // ⑦ 错字模拟
  | 'tone_polish'          // ⑧ 语气微调
  | 'length_randomize'     // ⑨ 长度随机化
  | 'segment_reply';       // ⑩ 分段回复

/**
 * 单阶梯配置
 */
export interface PipelineStepConfig {
  id: PipelineStepId;
  name: string;              // 中文名称
  enabled: boolean;          // 是否启用
  order: number;             // 执行顺序（数字越小越先）
  onlyForLLM: boolean;       // 只对 LLM 回复生效
  config?: Record<string, any>; // 该步骤的专属配置
}

/**
 * Pipeline 整体配置
 */
export interface OutputPipelineConfig {
  enabled: boolean;
  steps: PipelineStepConfig[];
  lockOrder: boolean;        // 是否锁定顺序（false = 可拖拽调整）
  maxRewriteAttempts: number; // 最大重写次数
}

/**
 * 默认配置
 */
export const DEFAULT_PIPELINE_CONFIG: OutputPipelineConfig = {
  enabled: true,
  lockOrder: false,
  maxRewriteAttempts: 2,
  steps: [
    { id: 'clean_thought', name: '思维链清洗', enabled: true, order: 1, onlyForLLM: true },
    { id: 'block_timeout', name: '超时拦截', enabled: true, order: 2, onlyForLLM: true },
    { id: 'block_cliche', name: 'AI腔拦截', enabled: true, order: 3, onlyForLLM: true },
    { id: 'block_duplicate', name: '复读拦截', enabled: true, order: 4, onlyForLLM: true },
    { id: 'text_clean', name: '文本清洗', enabled: true, order: 5, onlyForLLM: false },
    { id: 'text_replace', name: '文本替换', enabled: true, order: 6, onlyForLLM: false },
    { id: 'tone_polish', name: '语气微调', enabled: true, order: 7, onlyForLLM: true },
    { id: 'typo_simulation', name: '错字模拟', enabled: false, order: 8, onlyForLLM: true },
    { id: 'length_randomize', name: '长度随机化', enabled: false, order: 9, onlyForLLM: true },
    { id: 'segment_reply', name: '分段回复', enabled: true, order: 10, onlyForLLM: false },
  ],
};

/**
 * Pipeline 上下文
 */
export interface PipelineContext {
  text: string;                    // 当前处理的文本
  originalText: string;            // 原始文本
  isLLMOutput: boolean;            // 是否是 LLM 输出
  characterId?: string;            // 角色 ID
  emotionState?: any;              // 情绪状态
  messageHistory?: Array<{ role: string; content: string }>; // 历史消息
  metadata: Record<string, any>;   // 元数据
  rewriteCount: number;            // 已重写次数
  blocked: boolean;                // 是否被拦截
  blockReason?: string;            // 拦截原因
  segments?: string[];             // 分段结果
  segmentDelays?: number[];        // 每段延迟（毫秒）
}

/**
 * Pipeline 输出
 */
export interface PipelineOutput {
  success: boolean;
  text: string;
  blocked: boolean;
  blockReason?: string;
  segments: string[];
  segmentDelays: number[];
  stepsExecuted: string[];
  warnings: string[];
}
```

### 2.2 错字模拟配置

```typescript
/**
 * 错字模拟配置
 */
export interface TypoSimulationConfig {
  enabled: boolean;
  probability: number;              // 整体触发概率 0-1
  singleCharProbability: number;    // 单字替换概率
  multiCharProbability: number;     // 多字词替换概率
  wrongToneProbability: number;     // 错误声调概率
  addCorrection: boolean;           // 是否添加纠正提示
  correctionProbability: number;    // 添加纠正的概率
  maxTyposPerMessage: number;       // 每条消息最多错字数量
  minTextLength: number;            // 最小文本长度（太短不模拟）
}

export const DEFAULT_TYPO_CONFIG: TypoSimulationConfig = {
  enabled: false,
  probability: 0.3,
  singleCharProbability: 0.02,
  multiCharProbability: 0.01,
  wrongToneProbability: 0.015,
  addCorrection: true,
  correctionProbability: 0.6,
  maxTyposPerMessage: 2,
  minTextLength: 10,
};

/**
 * 同音词替换映射（常用）
 */
export const HOMOPHONE_MAP: Record<string, string[]> = {
  // 常用单字
  '的': ['地', '得'],
  '地': ['的', '得'],
  '得': ['的', '地'],
  '在': ['再'],
  '再': ['在'],
  '是': ['事', '世'],
  '事': ['是', '世'],
  '有': ['又', '右'],
  '又': ['有', '右'],
  '我': ['喔', '窝'],
  '你': ['尼', '拟'],
  '他': ['她', '它'],
  '她': ['他', '它'],
  '啊': ['阿', '呵'],
  '吗': ['嘛', '么'],
  '嘛': ['吗', '么'],
  '吧': ['八', '把'],
  '啦': ['拉', '辣'],
  '呀': ['牙', '亚'],
  '哦': ['噢', '喔'],
  '嗯': ['唔', '昂'],
  
  // 常用词
  '什么': ['神么', '什莫'],
  '怎么': ['怎莫', '怎嘛'],
  '为什么': ['为什莫', '为啥么'],
  '知道': ['知到', '只道'],
  '真的': ['真地', '真得'],
  '觉得': ['觉的', '绝得'],
  '喜欢': ['稀饭', '喜翻'],
  '开心': ['开新', '凯欣'],
  '难过': ['难过', '难过'],
  '谢谢': ['谢谢', '蟹蟹'],
  '对不起': ['对不其', '对步起'],
  '没关系': ['美关系', '没关西'],
};
```

### 2.3 分段回复配置

```typescript
/**
 * 延迟策略类型
 */
export type DelayStrategy = 'fixed' | 'linear' | 'logarithmic' | 'random';

/**
 * 分段回复配置
 */
export interface SegmentConfig {
  enabled: boolean;
  threshold: number;                // 触发分段的最小长度
  maxSegments: number;              // 最大分段数
  minSegmentLength: number;         // 最小段长
  protectPairedSymbols: boolean;    // 保护成对符号
  balancedSplit: boolean;           // 智能均分
  balancedMinRatio: number;         // 最短/最长比下限
  balancedMaxRatio: number;         // 最短/最长比上限
  
  // 延迟策略
  delayStrategy: DelayStrategy;     // 延迟策略
  fixedDelay: number;               // 固定延迟（毫秒）
  linearBase: number;               // 线性延迟基数
  linearFactor: number;             // 线性延迟因子
  logBase: number;                  // 对数延迟基数
  logFactor: number;                // 对数延迟因子
  randomMin: number;                // 随机延迟下限
  randomMax: number;                // 随机延迟上限
  
  // 标点符号列表
  splitPatterns: string[];          // 分段符号列表
}

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  enabled: true,
  threshold: 80,
  maxSegments: 5,
  minSegmentLength: 20,
  protectPairedSymbols: true,
  balancedSplit: true,
  balancedMinRatio: 0.4,
  balancedMaxRatio: 0.9,
  delayStrategy: 'linear',
  fixedDelay: 2000,
  linearBase: 500,
  linearFactor: 30,
  logBase: 800,
  logFactor: 400,
  randomMin: 1000,
  randomMax: 3000,
  splitPatterns: ['。', '！', '？', '…', '\n', '——'],
};
```

---

## 三、核心算法实现

### 3.1 错字模拟器

**文件位置**：`src/services/output/typoSimulator.ts`（新建）

```typescript
import { TypoSimulationConfig, DEFAULT_TYPO_CONFIG, HOMOPHONE_MAP } from '@/types/outputPipeline';

export class TypoSimulator {
  private config: TypoSimulationConfig;

  constructor(config?: Partial<TypoSimulationConfig>) {
    this.config = { ...DEFAULT_TYPO_CONFIG, ...config };
  }

  /**
   * 给文本添加错字
   */
  simulate(text: string): {
    text: string;
    typos: Array<{ original: string; typo: string; position: number }>;
    corrections: string[];
  } {
    if (!this.config.enabled) {
      return { text, typos: [], corrections: [] };
    }
    
    if (text.length < this.config.minTextLength) {
      return { text, typos: [], corrections: [] };
    }
    
    // 整体触发概率
    if (Math.random() > this.config.probability) {
      return { text, typos: [], corrections: [] };
    }

    const typos: Array<{ original: string; typo: string; position: number }> = [];
    const corrections: string[] = [];
    let result = text;
    let typoCount = 0;

    // 先尝试多字词替换
    for (const [word, alternatives] of Object.entries(HOMOPHONE_MAP)) {
      if (word.length < 2) continue;
      if (typoCount >= this.config.maxTyposPerMessage) break;
      
      const regex = new RegExp(word, 'g');
      let match: RegExpExecArray | null;
      
      while ((match = regex.exec(text)) !== null) {
        if (typoCount >= this.config.maxTyposPerMessage) break;
        if (Math.random() > this.config.multiCharProbability) continue;
        
        const typo = alternatives[Math.floor(Math.random() * alternatives.length)];
        
        // 检查这个位置是否已经被替换过
        const before = result.substring(0, match.index);
        const after = result.substring(match.index + word.length);
        
        // 只有原始文本还在才替换
        if (result.substring(match.index, match.index + word.length) === word) {
          result = before + typo + after;
          typos.push({
            original: word,
            typo,
            position: match.index,
          });
          typoCount++;
          
          // 是否添加纠正提示
          if (this.config.addCorrection && Math.random() < this.config.correctionProbability) {
            corrections.push(this.generateCorrection(word, typo));
          }
        }
      }
    }

    // 再尝试单字替换
    if (typoCount < this.config.maxTyposPerMessage) {
      const chars = result.split('');
      
      for (let i = 0; i < chars.length && typoCount < this.config.maxTyposPerMessage; i++) {
        const char = chars[i];
        const alternatives = HOMOPHONE_MAP[char];
        
        if (!alternatives) continue;
        if (Math.random() > this.config.singleCharProbability) continue;
        
        // 跳过标点、空格、数字
        if (/[\u3000-\u303f\uff00-\uffef\s\d]/.test(char)) continue;
        
        const typo = alternatives[Math.floor(Math.random() * alternatives.length)];
        chars[i] = typo;
        typos.push({
          original: char,
          typo,
          position: i,
        });
        typoCount++;
        
        if (this.config.addCorrection && Math.random() < this.config.correctionProbability) {
          corrections.push(this.generateCorrection(char, typo));
        }
      }
      
      result = chars.join('');
    }

    // 如果有纠正提示，追加到末尾
    if (corrections.length > 0) {
      result += '\n\n' + corrections.join('\n');
    }

    return { text: result, typos, corrections };
  }

  /**
   * 生成纠正提示
   */
  private generateCorrection(original: string, typo: string): string {
    const patterns = [
      `（不对，是"${original}"，打错了）`,
      `等等，应该是"${original}"`,
      `啊说错了，是"${original}"`,
      `不对不对，"${typo}" → "${original}"`,
      `（刚才打错字了，是${original}）`,
    ];
    return patterns[Math.floor(Math.random() * patterns.length)];
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TypoSimulationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
```

### 3.2 智能分段器

**文件位置**：`src/services/output/smartSegmenter.ts`（新建）

```typescript
import { SegmentConfig, DEFAULT_SEGMENT_CONFIG, DelayStrategy } from '@/types/outputPipeline';

// 成对符号映射
const PAIR_MAP: Record<string, string> = {
  '"': '"', '《': '》', '（': '）', '(': ')',
  '[': ']', '{': '}', "'": "'", '【': '】', '<': '>',
  '`': '`',
};

export class SmartSegmenter {
  private config: SegmentConfig;

  constructor(config?: Partial<SegmentConfig>) {
    this.config = { ...DEFAULT_SEGMENT_CONFIG, ...config };
  }

  /**
   * 智能分段
   */
  segment(text: string): {
    segments: string[];
    delays: number[];
  } {
    if (!this.config.enabled) {
      return { segments: [text], delays: [0] };
    }
    
    if (text.length < this.config.threshold) {
      return { segments: [text], delays: [0] };
    }

    // 第一步：找所有候选分割点
    const candidates = this.findSplitCandidates(text);
    
    // 第二步：成对符号保护，过滤掉在符号内的分割点
    const validPoints = this.config.protectPairedSymbols
      ? this.filterPairedSymbols(text, candidates)
      : candidates;
    
    // 第三步：智能分割
    let segments = this.splitAtPoints(text, validPoints);
    
    // 第四步：合并过短的段落
    segments = this.mergeShortSegments(segments);
    
    // 第五步：智能均分（如果启用）
    if (this.config.balancedSplit) {
      segments = this.balanceSegments(segments);
    }
    
    // 第六步：限制最大段数
    if (segments.length > this.config.maxSegments) {
      segments = this.mergeToLimit(segments, this.config.maxSegments);
    }
    
    // 第七步：计算每段延迟
    const delays = segments.map(seg => this.calculateDelay(seg, segments.length));

    return { segments, delays };
  }

  /**
   * 找所有候选分割点
   */
  private findSplitCandidates(text: string): number[] {
    const points: number[] = [];
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (this.config.splitPatterns.includes(char)) {
        // 分割点在标点符号之后
        points.push(i + 1);
      }
    }
    
    // 加入换行符位置
    let pos = 0;
    while ((pos = text.indexOf('\n', pos)) !== -1) {
      points.push(pos + 1);
      pos++;
    }
    
    return [...new Set(points)].sort((a, b) => a - b);
  }

  /**
   * 成对符号保护
   */
  private filterPairedSymbols(text: string, points: number[]): number[] {
    const stack: string[] = [];
    const validPoints: number[] = [];
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // 左符号入栈
      if (PAIR_MAP[char]) {
        stack.push(PAIR_MAP[char]);
      }
      // 右符号出栈
      else if (Object.values(PAIR_MAP).includes(char)) {
        const idx = stack.lastIndexOf(char);
        if (idx !== -1) {
          stack.splice(idx, 1);
        }
      }
      
      // 检查这个位置是否是分割点
      if (points.includes(i)) {
        // 只有栈为空时才允许分割
        if (stack.length === 0) {
          validPoints.push(i);
        }
      }
    }
    
    return validPoints;
  }

  /**
   * 在指定位置分割文本
   */
  private splitAtPoints(text: string, points: number[]): string[] {
    if (points.length === 0) return [text];
    
    const segments: string[] = [];
    let lastPoint = 0;
    
    for (const point of points) {
      const segment = text.substring(lastPoint, point).trim();
      if (segment.length > 0) {
        segments.push(segment);
      }
      lastPoint = point;
    }
    
    // 最后一段
    const lastSegment = text.substring(lastPoint).trim();
    if (lastSegment.length > 0) {
      segments.push(lastSegment);
    }
    
    return segments;
  }

  /**
   * 合并过短的段落
   */
  private mergeShortSegments(segments: string[]): string[] {
    if (segments.length <= 1) return segments;
    
    const result: string[] = [];
    let current = segments[0];
    
    for (let i = 1; i < segments.length; i++) {
      if (current.length < this.config.minSegmentLength) {
        current += segments[i];
      } else {
        result.push(current);
        current = segments[i];
      }
    }
    
    result.push(current);
    
    // 如果最后一段太短，合并到前一段
    if (result.length > 1 && result[result.length - 1].length < this.config.minSegmentLength) {
      const last = result.pop()!;
      result[result.length - 1] += last;
    }
    
    return result;
  }

  /**
   * 智能均分
   */
  private balanceSegments(segments: string[]): string[] {
    if (segments.length <= 1) return segments;
    
    // 计算平均长度
    const totalLength = segments.reduce((sum, s) => sum + s.length, 0);
    const targetLength = totalLength / segments.length;
    
    const result: string[] = [];
    let current = '';
    
    for (const seg of segments) {
      if (current.length === 0) {
        current = seg;
      } else {
        // 比较：合并前的差 vs 合并后的差
        const diffBefore = Math.abs(current.length - targetLength);
        const diffAfter = Math.abs(current.length + seg.length - targetLength);
        
        if (diffAfter < diffBefore && current.length + seg.length < targetLength * 1.5) {
          current += seg;
        } else {
          result.push(current);
          current = seg;
        }
      }
    }
    
    if (current.length > 0) {
      result.push(current);
    }
    
    // 检查比例是否在范围内
    const lengths = result.map(s => s.length);
    const minLen = Math.min(...lengths);
    const maxLen = Math.max(...lengths);
    const ratio = minLen / maxLen;
    
    if (ratio < this.config.balancedMinRatio) {
      // 比例不够好，返回原分段
      return segments;
    }
    
    return result;
  }

  /**
   * 合并到指定段数
   */
  private mergeToLimit(segments: string[], limit: number): string[] {
    while (segments.length > limit) {
      // 找到最短的相邻两段，合并它们
      let minIndex = 0;
      let minSum = segments[0].length + segments[1].length;
      
      for (let i = 1; i < segments.length - 1; i++) {
        const sum = segments[i].length + segments[i + 1].length;
        if (sum < minSum) {
          minSum = sum;
          minIndex = i;
        }
      }
      
      segments[minIndex] = segments[minIndex] + segments[minIndex + 1];
      segments.splice(minIndex + 1, 1);
    }
    
    return segments;
  }

  /**
   * 计算延迟
   */
  private calculateDelay(segment: string, totalSegments: number): number {
    const length = segment.length;
    
    switch (this.config.delayStrategy) {
      case 'fixed':
        return this.config.fixedDelay;
      
      case 'linear':
        return this.config.linearBase + length * this.config.linearFactor;
      
      case 'logarithmic':
        return this.config.logBase + Math.log(Math.max(1, length)) * this.config.logFactor;
      
      case 'random':
        return this.config.randomMin + Math.random() * (this.config.randomMax - this.config.randomMin);
      
      default:
        return this.config.fixedDelay;
    }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SegmentConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
```

### 3.3 可配置 Pipeline 核心

**文件位置**：`src/services/output/outputPipelineV2.ts`（新建，替代现有版本）

```typescript
import {
  OutputPipelineConfig,
  PipelineContext,
  PipelineOutput,
  PipelineStepId,
  DEFAULT_PIPELINE_CONFIG,
} from '@/types/outputPipeline';
import { TypoSimulator } from './typoSimulator';
import { SmartSegmenter } from './smartSegmenter';
import { cleanThinkingMarkers } from '@/utils/segmentUtils';
import { containsAICliche, isDuplicate } from '@/services/aiService';

/**
 * 阶梯处理函数类型
 */
type StepHandler = (ctx: PipelineContext) => PipelineContext | Promise<PipelineContext>;

export class OutputPipelineV2 {
  private config: OutputPipelineConfig;
  private steps: Map<PipelineStepId, StepHandler>;
  private typoSimulator: TypoSimulator;
  private segmenter: SmartSegmenter;

  constructor(config?: Partial<OutputPipelineConfig>) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.steps = new Map();
    this.typoSimulator = new TypoSimulator();
    this.segmenter = new SmartSegmenter();
    this.registerDefaultSteps();
  }

  /**
   * 注册默认阶梯
   */
  private registerDefaultSteps(): void {
    // ① 思维链清洗
    this.steps.set('clean_thought', (ctx) => {
      let text = ctx.text;
      text = cleanThinkingMarkers(text);
      return { ...ctx, text };
    });

    // ② 超时拦截（需要外部设置 metadata.responseTime）
    this.steps.set('block_timeout', (ctx) => {
      const responseTime = ctx.metadata.responseTime as number;
      if (responseTime && responseTime > 30000) { // 30秒超时
        return {
          ...ctx,
          blocked: true,
          blockReason: `回复超时（${Math.round(responseTime / 1000)}秒），可能上下文错位`,
        };
      }
      return ctx;
    });

    // ③ AI腔拦截
    this.steps.set('block_cliche', (ctx) => {
      if (containsAICliche(ctx.text)) {
        return {
          ...ctx,
          blocked: true,
          blockReason: '检测到 AI 官腔模板',
        };
      }
      return ctx;
    });

    // ④ 复读拦截
    this.steps.set('block_duplicate', (ctx) => {
      const history = ctx.messageHistory || [];
      if (history.length >= 2) {
        const lastAiMsg = [...history].reverse().find(m => m.role === 'assistant');
        if (lastAiMsg && isDuplicate(ctx.text, lastAiMsg.content)) {
          return {
            ...ctx,
            blocked: true,
            blockReason: '检测到复读',
          };
        }
      }
      return ctx;
    });

    // ⑤ 文本清洗
    this.steps.set('text_clean', (ctx) => {
      let text = ctx.text;
      
      // 移除中括号内容 [xxx]
      text = text.replace(/\[[^\]]*\]/g, '');
      // 移除小括号内容 (xxx)（只对短文本）
      if (text.length < 100) {
        text = text.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '');
      }
      // 移除多余空行
      text = text.replace(/\n{3,}/g, '\n\n');
      // 移除首尾空白
      text = text.trim();
      
      return { ...ctx, text };
    });

    // ⑥ 文本替换（占位符/敏感词）
    this.steps.set('text_replace', (ctx) => {
      let text = ctx.text;
      const replacements = ctx.metadata.replacements as Record<string, string> | undefined;
      if (replacements) {
        for (const [from, to] of Object.entries(replacements)) {
          text = text.split(from).join(to);
        }
      }
      return { ...ctx, text };
    });

    // ⑦ 语气微调
    this.steps.set('tone_polish', (ctx) => {
      // 这里调用现有的语气微调逻辑
      let text = ctx.text;
      const emotion = ctx.emotionState;
      
      if (emotion) {
        // 简单版本：根据情绪添加语气词
        // 实际可以用更复杂的 TonePolishStep
        text = this.addEmotionTone(text, emotion);
      }
      
      return { ...ctx, text };
    });

    // ⑧ 错字模拟
    this.steps.set('typo_simulation', (ctx) => {
      const result = this.typoSimulator.simulate(ctx.text);
      return {
        ...ctx,
        text: result.text,
        metadata: {
          ...ctx.metadata,
          typos: result.typos,
          corrections: result.corrections,
        },
      };
    });

    // ⑨ 长度随机化
    this.steps.set('length_randomize', (ctx) => {
      // 简化版：随机删除一些"的"、"了"之类的助词
      let text = ctx.text;
      if (text.length > 30 && Math.random() < 0.3) {
        // 随机去掉 1-2 个"的"
        const removeCount = Math.random() < 0.5 ? 1 : 2;
        for (let i = 0; i < removeCount; i++) {
          const deIndex = text.indexOf('的');
          if (deIndex !== -1 && Math.random() < 0.3) {
            text = text.substring(0, deIndex) + text.substring(deIndex + 1);
          }
        }
      }
      return { ...ctx, text };
    });

    // ⑩ 分段回复
    this.steps.set('segment_reply', (ctx) => {
      const { segments, delays } = this.segmenter.segment(ctx.text);
      return {
        ...ctx,
        segments,
        segmentDelays: delays,
      };
    });
  }

  /**
   * 添加情绪语气词（简化版）
   */
  private addEmotionTone(text: string, emotion: any): string {
    // 实际应调用现有的 TonePolishStep
    // 这里只是占位
    return text;
  }

  /**
   * 执行 Pipeline
   */
  async run(
    text: string,
    options: {
      isLLMOutput?: boolean;
      characterId?: string;
      emotionState?: any;
      messageHistory?: Array<{ role: string; content: string }>;
      metadata?: Record<string, any>;
    } = {},
  ): Promise<PipelineOutput> {
    if (!this.config.enabled) {
      return {
        success: true,
        text,
        blocked: false,
        segments: [text],
        segmentDelays: [0],
        stepsExecuted: [],
        warnings: [],
      };
    }

    // 初始化上下文
    let ctx: PipelineContext = {
      text,
      originalText: text,
      isLLMOutput: options.isLLMOutput ?? true,
      characterId: options.characterId,
      emotionState: options.emotionState,
      messageHistory: options.messageHistory || [],
      metadata: options.metadata || {},
      rewriteCount: 0,
      blocked: false,
      segments: [],
      segmentDelays: [],
    };

    const stepsExecuted: string[] = [];
    const warnings: string[] = [];

    // 按 order 排序阶梯
    const sortedSteps = [...this.config.steps]
      .filter(step => step.enabled)
      .sort((a, b) => a.order - b.order);

    // 逐个执行阶梯
    for (const stepConfig of sortedSteps) {
      // 如果只对 LLM 生效且不是 LLM 输出，跳过
      if (stepConfig.onlyForLLM && !ctx.isLLMOutput) {
        continue;
      }

      const handler = this.steps.get(stepConfig.id);
      if (!handler) continue;

      try {
        ctx = await handler(ctx);
        stepsExecuted.push(stepConfig.id);

        // 如果被拦截，停止执行
        if (ctx.blocked) {
          warnings.push(`被 ${stepConfig.name} 拦截：${ctx.blockReason}`);
          break;
        }
      } catch (error) {
        warnings.push(`${stepConfig.name} 执行失败：${error}`);
      }
    }

    // 如果没分段，默认整段
    if (ctx.segments?.length === 0) {
      ctx.segments = [ctx.text];
      ctx.segmentDelays = [0];
    }

    return {
      success: !ctx.blocked,
      text: ctx.text,
      blocked: ctx.blocked,
      blockReason: ctx.blockReason,
      segments: ctx.segments || [ctx.text],
      segmentDelays: ctx.segmentDelays || [0],
      stepsExecuted,
      warnings,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<OutputPipelineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 更新阶梯配置
   */
  updateStepConfig(stepId: PipelineStepId, config: Partial<{ enabled: boolean; order: number }>): void {
    const step = this.config.steps.find(s => s.id === stepId);
    if (step) {
      Object.assign(step, config);
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): OutputPipelineConfig {
    return { ...this.config };
  }
}
```

---

## 四、集成到现有系统

### 4.1 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `src/services/outputPipeline.ts` | 升级为 V2，或新建 V2 然后逐步替换 |
| `src/store/modelRoleStore.ts` | 扩展配置，支持 10 阶梯配置 |
| `src/store/chatStore.ts` | 集成分段延迟发送逻辑 |
| `src/components/settings/` | 新增 Pipeline 配置面板（可拖拽排序） |

### 4.2 分段发送实现

在 chatStore 中实现分段发送：

```typescript
/**
 * 分段发送消息
 */
const sendSegments = async (segments: string[], delays: number[]) => {
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) {
      // 显示"正在输入"
      setTypingIndicator(true);
      
      // 等待延迟
      await new Promise(resolve => setTimeout(resolve, delays[i]));
      
      // 隐藏"正在输入"
      setTypingIndicator(false);
    }
    
    // 发送这一段
    addMessage({
      role: 'assistant',
      content: segments[i],
      segmentIndex: i,
      totalSegments: segments.length,
    });
  }
};
```

---

## 五、分阶段实施计划

### 阶段一：核心框架（1 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 类型定义 | outputPipeline.ts 所有类型 | 2h |
| 智能分段器 | smartSegmenter.ts | 4h |
| Pipeline 核心 | outputPipelineV2.ts 框架 | 3h |
| 单元测试 | 分段器测试 | 2h |

### 阶段二：拟人化功能（1 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 错字模拟器 | typoSimulator.ts | 3h |
| 文本清洗/替换 | 集成到 Pipeline | 2h |
| 语气微调集成 | 接入现有 TonePolishStep | 2h |
| 长度随机化 | 集成到 Pipeline | 1h |

### 阶段三：拦截器（0.5 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| AI 腔拦截 | 集成现有 containsAICliche | 1h |
| 复读拦截 | 集成现有 isDuplicate | 1h |
| 超时拦截 | 响应时间计算与拦截 | 1h |

### 阶段四：集成与 UI（1 天）

| 任务 | 说明 | 工时 |
|------|------|------|
| 集成到 chatStore | 分段发送 + 延迟 | 3h |
| 集成到 modelRoleStore | 配置持久化 | 2h |
| Settings 面板 | 阶梯开关 + 顺序调整 | 4h |
| 实机测试 | 实际效果验证 | 2h |

---

## 六、风险与应对

| 风险 | 影响 | 应对方案 |
|------|------|---------|
| 错字太多影响可读性 | 用户体验差 | 可配置概率 + 最大数量 + 默认关闭 |
| 分段破坏语义 | 读不通 | 成对符号保护 + 最小段长 + 人工测试 |
| 延迟太长打断节奏 | 聊天卡顿 | 可配置延迟策略 + 上限保护 |
| 拦截太严 | 正常消息被误拦 | 可调阈值 + 白名单 + 日志排查 |
| Pipeline 执行慢 | 回复延迟增加 | 大部分步骤是字符串操作，很快；错字模拟也很轻量 |

---

## 七、验证标准

1. **分段质量**：>95% 的分段不破坏语义，成对符号完整
2. **错字自然度**：人工评估，错字不影响阅读，像真人手滑
3. **拦截准确率**：AI 腔拦截准确率 >80%，误拦率 <10%
4. **延迟感知**：用户感觉"像是在等真人打字"，而不是"卡住了"
5. **整体拟人度**：用户主观评价"更像真人了"

---

## 八、后续扩展方向

- [ ] 更多错字词库：支持方言、网络用语
- [ ] 情绪 × 错字：激动时错字更多，细心时错字更少
- [ ] 情绪 × 速度：开心时打字快，难过时打字慢
- [ ] 打字速度学习：学习用户的打字速度，匹配节奏
- [ ] 表情/图片分段：非文本内容的发送策略
- [ ] 撤回模拟：发错了又撤回（高级功能）
