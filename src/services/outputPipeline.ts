// ============================================================
// Pipeline 类型定义
// V2 集成: runPipelineV2 支持10阶梯可配置Pipeline
// ============================================================

import { EmotionType, Character } from '../types';

// Re-export V2 pipeline
export { runPipelineV2, runQuickPipeline } from './output/pipelineV2';
export type { PipelineV2Config, PipelineV2Output } from './output/pipelineV2';
export { applyTypos } from './output/typoSimulator';
export type { TypoSimConfig, TypoResult } from './output/typoSimulator';
export {
  pipelineHookRegistry,
  createHookContext,
  runBeforePipelineHooks,
  runBeforeStepHooks,
  runAfterStepHooks,
  runAfterPipelineHooks,
} from './output/pipelineHook';
export type { PipelineHook, PipelineHookContext } from './output/pipelineHook';
export {
  CleanMarkersStepV2,
  BlockClicheStepV2,
  TypoSimStep,
  SmartSegmentStep,
  TonePolishStepV2,
  LengthRandomizeStepV2,
  ColloquialismStepV2,
  SmartPunctuationStep,
  SpeakingRhythmStep,
  FinalSanitizeStep,
} from './output/pipelineSteps';
export type {
  CleanMarkersConfig,
  BlockClicheConfig,
  SmartSegmentConfig,
  TonePolishConfig,
  StepEnabledConfig,
} from './output/pipelineSteps';

// Pipeline Hooks
export { createOOCHook } from './hooks/oocDetectionHook';
export type { OOCHookConfig } from './hooks/oocDetectionHook';
export { createEmotionPostProcessHook } from './hooks/emotionPostProcessHook';
export type { EmotionPostProcessHookConfig } from './hooks/emotionPostProcessHook';
export { createMemoryInjectionHook } from './hooks/memoryInjectionHook';
export type { MemoryInjectionHookConfig } from './hooks/memoryInjectionHook';
export { createHistoryCleanHook, cleanForHistory } from './hooks/historyCleanHook';
export type { HistoryCleanHookConfig } from './hooks/historyCleanHook';

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
  /** 当前角色信息（用于拦截后的角色化改写） */
  character?: Character;
  /** 当前对话 ID（用于 Hook 日志与状态更新） */
  conversationId?: string;
  /** Pipeline 阶段通知回调，用于前端展示"正在情绪解析/历史净化..." */
  emitStage?: (stage: string, detail?: unknown) => void;
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
  data?: Record<string, unknown> & { reason?: string; segments?: string[] };
}

// ---------- Pipeline 输出 ----------

export interface PipelineOutput {
  /** 最终文本 */
  text: string;
  /** 分段后的数组 */
  segments: string[];
  /** AI 段间延迟数组：第 i 项为第 i+1 段前的等待毫秒数（前端 pipeline 兜底计算） */
  segmentDelays?: number[];
  /** 是否被拦截（需要外部走重写路径） */
  aborted: boolean;
  /** 被拦截时的原因 */
  abortReason?: string;
  /** 被拦截时的附加信息 */
  abortData?: unknown;
  /** 各步骤日志 */
  logs: string[];
}
