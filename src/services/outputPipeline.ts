// ============================================================
// Pipeline + Step 模式：消息后处理管道
// 参考：astrbot_plugin_outputpro / core/pipeline.py
// ============================================================

import { EmotionType } from '../types';
import { containsAICliche, detectPersonaCollapse, isDuplicate, detectForbiddenViolation } from './aiService';
import { splitIntoSegments, SegmentConfig, protectPairedSymbols } from '../utils/segmentUtils';
import { cleanLLMOutputMarkers } from './textCleaner';

// ---------- 类型定义 ----------

export interface PipelineContext {
  /** LLM 原始输出 */
  rawText: string;
  /** 当前处理后的文本（步骤会修改它） */
  processedText: string;
  /** 当前角色情绪（用于某些步骤的条件判断） */
  emotion: { type: EmotionType; intensity: number };
  /** 最近 N 条 AI 回复，用于复读检测 */
  recentReplies: string[];
  /** 用户原始输入（用于某些步骤的上下文判断） */
  userInput: string;
  /** 当前关系阶段 */
  affinityStage: string;
  /** forbiddenBehaviors 原始文本（用于 forbidden 检测） */
  forbiddenText?: string;
  /** 拦截系统配置 */
  interceptConfig?: {
    enableIntercept: boolean;
    duplicateThreshold: number;
    blockDuplicate: boolean;
    blockAICliche: boolean;
    blockPersonaCollapse: boolean;
    blockForbiddenViolation: boolean;
  };
}

export interface StepResult {
  ok: boolean;
  /** 是否中止后续步骤（如检测到严重的 AI 腔需完全重写） */
  abort?: boolean;
  /** 日志信息 */
  msg?: string;
  /** 步骤产出的附加数据 */
  data?: any;
}

/** 所有步骤的基类：子类实现 handle() */
export abstract class BaseStep {
  abstract readonly name: string;
  abstract handle(ctx: PipelineContext): StepResult;
}

// ---------- Step 1：标记清洗 ----------
/**
 * 移除 LLM 输出中的结构性"提示语标记"，如
 * - <thought>...</thought>
 * - <feeling>...</feeling>
 * - 【内心活动】
 * - 开头带有 "AI：" 或 "助手："
 * 参考 emotionai 的历史净化逻辑
 */
class CleanMarkersStep extends BaseStep {
  readonly name = 'clean_markers';

  handle(ctx: PipelineContext): StepResult {
    const text = ctx.processedText;
    const cleaned = cleanLLMOutputMarkers(text);

    if (cleaned.length === 0 && text.length > 0) {
      return { ok: false, abort: true, msg: '清洗后为空，使用原文', data: { rawLen: text.length } };
    }

    ctx.processedText = cleaned;
    return { ok: true };
  }
}

// ---------- Step 2：拦截 AI 腔 / 复读 / forbidden ----------
/**
 * 检测"客服腔"、"模板化表达"、"重复输出"、"违反 forbiddenBehaviors"
 * - 命中 → abort=true（外部调用者负责走 getRoleRecoveryReply 重写）
 * 参考：outputpro / block 步骤
 */
class BlockClicheStep extends BaseStep {
  readonly name = 'block_cliche';

  handle(ctx: PipelineContext): StepResult {
    const text = ctx.processedText;
    const config = ctx.interceptConfig;

    // If intercept is disabled, skip all checks
    if (config && !config.enableIntercept) {
      return { ok: true };
    }

    // 0. Forbidden violation detection (highest priority)
    if (config?.blockForbiddenViolation !== false && ctx.forbiddenText) {
      const violated = detectForbiddenViolation(text, ctx.forbiddenText);
      if (violated) {
        return { ok: false, abort: true, msg: `违反禁止项: ${violated}`, data: { reason: 'forbidden', violatedItem: violated } };
      }
    }

    // 1. 复读检测
    if (config?.blockDuplicate !== false) {
      const dupThreshold = config?.duplicateThreshold ?? 0.85;
      if (ctx.recentReplies.length > 0 && isDuplicate(text, ctx.recentReplies, dupThreshold)) {
        return { ok: false, abort: true, msg: '检测到复读输出', data: { reason: 'duplicate' } };
      }
    }

    // 2. AI 腔检测（"作为一个AI..." "感谢您的理解..."）
    if (config?.blockAICliche !== false && containsAICliche(text)) {
      return { ok: false, abort: true, msg: '检测到客服腔', data: { reason: 'cliche' } };
    }

    // 3. 人设崩塌检测（显式说"我是AI" "我没有感情"）
    if (config?.blockPersonaCollapse !== false && detectPersonaCollapse(text)) {
      return { ok: false, abort: true, msg: '检测到人设崩塌', data: { reason: 'collapse' } };
    }

    // 4. 超短/超长（极端值）
    if (text.length < 2) {
      return { ok: false, abort: true, msg: '回复过短', data: { reason: 'too_short' } };
    }
    if (text.length > 600) {
      return { ok: false, abort: false, msg: '回复过长，后续由分段处理', data: { reason: 'too_long' } };
    }

    return { ok: true };
  }
}

// ---------- Step 3：分段 ----------
/**
 * 智能切分：优先按标点 → 成对符号保护 → 均分兜底
 * 本步骤把 processedText 切成 segments 数组（存入 ctx.data）
 * 参考：astrbot_plugin_splitter 的 pair_map 保护栈
 */
class SegmentStep extends BaseStep {
  readonly name = 'segment';

  constructor(private config: SegmentConfig & { pairProtection?: boolean } = {
    enabled: true,
    threshold: 20,
    maxSegments: 8,
    mode: 'smart',
    pairProtection: true,
  }) {
    super();
  }

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true, data: { segments: [ctx.processedText] } };

    // 先过基础分段（复用现有实现）
    let segments = splitIntoSegments(ctx.processedText, this.config);

    // 成对符号保护：检查段末是否残留未闭合的括号，若是则与下一段合并
    if (this.config.pairProtection) {
      segments = protectPairedSymbols(segments);
    }

    // 合并过短段（长度 <= 3 的与前一段合并）
    segments = mergeTinySegments(segments);

    // 限制段数上限
    if (segments.length > this.config.maxSegments) {
      const take = segments.slice(0, this.config.maxSegments - 1);
      const tail = segments.slice(this.config.maxSegments - 1).join('，');
      take.push(tail);
      segments = take;
    }

    return { ok: true, data: { segments } };
  }
}

// ---------- Step 4：语气微调（可选） ----------
/**
 * 根据情绪微调个别词：
 * - anger>=60 → "哼" "气死我了"
 * - joy>=60 → "哈哈" "嘿嘿"
 * 不改变意思，只增加口语味道
 */
class TonePolishStep extends BaseStep {
  readonly name = 'tone_polish';

  handle(ctx: PipelineContext): StepResult {
    const { type, intensity } = ctx.emotion;
    if (intensity < 40) return { ok: true }; // 情绪较平静时不处理

    // （当前保持 conservative：只对纯文本场景做极轻度处理）
    // 真正的语气注入应该由 LLM 在 system prompt 中完成，这里只做兜底
    // 如果未来需要更激进的注入，在此扩展

    return { ok: true };
  }
}

// ---------- 辅助函数 ----------

function mergeTinySegments(segments: string[], minLen = 4): string[] {
  const result: string[] = [];
  for (const seg of segments) {
    if (result.length > 0 && seg.length < minLen) {
      result[result.length - 1] = result[result.length - 1] + seg;
    } else {
      result.push(seg);
    }
  }
  return result;
}

// ---------- Pipeline 执行器 ----------

export interface PipelineOutput {
  /** 最终文本 */
  text: string;
  /** 分段后的数组 */
  segments: string[];
  /** 是否被拦截（需要外部走重写路径） */
  aborted: boolean;
  /** 被拦截时的原因 */
  abortReason?: string;
  /** 被拦截时的附加信息 */
  abortData?: any;
  /** 各步骤日志 */
  logs: string[];
}

export class OutputPipeline {
  private steps: BaseStep[];

  constructor(customSteps?: BaseStep[]) {
    this.steps = customSteps ?? [
      new CleanMarkersStep(),
      new BlockClicheStep(),
      new SegmentStep(),
      new TonePolishStep(),
    ];
  }

  run(ctx: PipelineContext): PipelineOutput {
    const logs: string[] = [];
    let aborted = false;
    let abortReason: string | undefined;
    let abortData: any = undefined;
    let lastSegmentData = { segments: [ctx.processedText] };

    for (const step of this.steps) {
      const result = step.handle(ctx);
      if (result.msg) logs.push(`[${step.name}] ${result.msg}`);
      if (step.name === 'segment' && result.data?.segments) {
        lastSegmentData = result.data;
      }
      if (result.abort) {
        aborted = true;
        abortReason = result.data?.reason || result.msg;
        abortData = result.data;
        break;
      }
    }

    return {
      text: ctx.processedText,
      segments: lastSegmentData.segments,
      aborted,
      abortReason,
      abortData,
      logs,
    };
  }
}
