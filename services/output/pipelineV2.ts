/**
 * ============================================================
 * 10阶梯Pipeline执行器 V2
 * 参考: docs/upgrade-plans/03-output-enhancement.md
 * 支持步骤可配置化、可排序、运行日志
 * ============================================================
 */

import {
  PipelineContext,
  PipelineOutput,
  PipelineHookContext,
  createHookContext,
  runBeforePipelineHooks,
  runBeforeStepHooks,
  runAfterStepHooks,
  runAfterPipelineHooks,
} from '../outputPipeline';
import {
  CleanMarkersStepV2,
  BlockClicheStepV2,
  TypoSimStep,
  SmartSegmentStep,
  TonePolishStepV2,
  LengthRandomizeStepV2,
  ColloquialismStepV2,
  ColloquialismConfig,
  SmartPunctuationStep,
  SmartPunctuationConfig,
  SpeakingRhythmStep,
  SpeakingRhythmConfig,
  FinalSanitizeStep,
  FinalSanitizeConfig,
  StepEnabledConfig,
  CleanMarkersConfig,
  BlockClicheConfig,
  SmartSegmentConfig,
  TonePolishConfig,
} from './pipelineSteps';
import { TypoSimConfig } from './typoSimulator';

// ---------- Pipeline V2 配置 ----------

export interface PipelineV2Config {
  /** 步骤启用/禁用 */
  cleanMarkers: CleanMarkersConfig;
  blockCliche: BlockClicheConfig;
  typoSim: TypoSimConfig;
  segment: SmartSegmentConfig;
  tonePolish: TonePolishConfig;
  lengthRandomize: StepEnabledConfig;
  colloquialism: ColloquialismConfig;
  smartPunctuation: SmartPunctuationConfig;
  speakingRhythm: SpeakingRhythmConfig;
  finalSanitize: FinalSanitizeConfig;
}

export const DEFAULT_PIPELINE_V2_CONFIG: PipelineV2Config = {
  cleanMarkers: { enabled: true, removeThoughtTags: true, removeFeelingTags: true, removeActionTags: true, removeInnerMonologue: true },
  blockCliche: { enabled: true, blockDuplicate: true, duplicateThreshold: 0.85, blockAICliche: true, blockPersonaCollapse: true, blockForbiddenViolation: true, minLength: 2, maxLength: 2000 },
  typoSim: { enabled: true, probability: 0.04, correctionMode: 'none', minLength: 8 },
  segment: { enabled: true, threshold: 20, maxSegments: 8, mode: 'smart', minSegmentLength: 6, pairProtection: true },
  tonePolish: { enabled: true, emotionExpressions: {}, prefixProb: 0.06, suffixProb: 0.08 },
  lengthRandomize: { enabled: true },
  colloquialism: { enabled: true, prefixProb: 0.12, suffixProb: 0.18, repeatProb: 0.08, ellipsisProb: 0.06 },
  smartPunctuation: { enabled: true, commaInsertProb: 0.05, exclamationProb: 0.3, tildeProb: 0.25 },
  speakingRhythm: { enabled: true, breathPauseProb: 0.15 },
  finalSanitize: { enabled: true, removeDuplicatePunctuation: true, normalizeWhitespace: true },
};

// ---------- 步骤工厂 ----------

function createSteps(config: PipelineV2Config) {
  return [
    new CleanMarkersStepV2(config.cleanMarkers),       // 1. 清洗 <thought>/<feeling> 标签
    new BlockClicheStepV2(config.blockCliche),         // 2. 拦截复读/AI腔
    new TypoSimStep(config.typoSim),                   // 3. 错字模拟
    new LengthRandomizeStepV2(config.lengthRandomize), // 4. Bug 5 fix: 先裁长度再分段（避免 segments 与 text 不一致）
    new SmartSegmentStep(config.segment),              // 5. 智能分段
    new TonePolishStepV2(config.tonePolish),           // 6. 语气微调
    new ColloquialismStepV2(config.colloquialism),     // 7. 口语化注入
    new SmartPunctuationStep(config.smartPunctuation), // 8. 标点优化
    new SpeakingRhythmStep(config.speakingRhythm),     // 9. 断句节奏
    new FinalSanitizeStep(config.finalSanitize),       // 10. 最终清洗
  ];
}

// ---------- Pipeline 执行器 ----------

export interface PipelineV2Output extends PipelineOutput {
  /** 每个步骤的执行状态 */
  stepResults: Array<{
    step: string;
    ok: boolean;
    aborted: boolean;
    msg?: string;
  }>;
}

export async function runPipelineV2(ctx: PipelineContext, config?: Partial<PipelineV2Config>): Promise<PipelineV2Output> {
  const mergedConfig = { ...DEFAULT_PIPELINE_V2_CONFIG, ...config };
  const steps = createSteps(mergedConfig);
  const hookCtx: PipelineHookContext = createHookContext(ctx);
  const logs: string[] = [];
  const stepResults: PipelineV2Output['stepResults'] = [];
  let aborted = false;
  let abortReason: string | undefined;
  let abortData: unknown = undefined;
  let lastSegmentData = { segments: [ctx.processedText], segmentDelays: [] as number[] };

  const STEP_STAGE_LABELS: Record<string, string> = {
    clean_markers: '清洗标记',
    block_cliche: '检测异常输出',
    typo_sim: '模拟错字',
    length_randomize: '调整长度',
    segment: '智能分段',
    tone_polish: '语气微调',
    colloquialism: '口语化注入',
    smart_punctuation: '标点优化',
    speaking_rhythm: '断句节奏',
    final_sanitize: '最终清洗',
  };

  ctx.emitStage?.('Pipeline 启动...');

  // 1. before-pipeline hooks
  const beforePipeline = await runBeforePipelineHooks(hookCtx);
  if (beforePipeline) {
    logs.push(...hookCtx.logs);
    if (!beforePipeline.ok) {
      return {
        text: ctx.processedText,
        segments: [ctx.processedText],
        aborted: true,
        abortReason: beforePipeline.data?.reason || beforePipeline.msg,
        abortData: beforePipeline.data,
        logs,
        stepResults,
      };
    }
  }

  for (const step of steps) {
    ctx.emitStage?.(`正在${STEP_STAGE_LABELS[step.name] || step.name}...`);

    // 2. before-step hooks
    const beforeStep = await runBeforeStepHooks(step.name, hookCtx);
    if (beforeStep) {
      if (!beforeStep.ok) {
        logs.push(`[hook] before-step:${step.name} ${beforeStep.abort ? 'abort' : 'blocked'}: ${beforeStep.msg || ''}`);
        if (beforeStep.abort) {
          aborted = true;
          abortReason = beforeStep.data?.reason || beforeStep.msg;
          abortData = beforeStep.data;
          break;
        }
        continue;
      }
    }

    // 3. run step
    let result = step.handle(ctx);
    const stepMsg = result.msg ? `[${step.name}] ${result.msg}` : undefined;
    if (stepMsg) logs.push(stepMsg);

    // 4. after-step hooks
    result = await runAfterStepHooks(step.name, hookCtx, result);
    if (result.msg && result.msg !== stepMsg?.replace(`[${step.name}] `, '')) {
      // hook 产生了新日志，但避免重复
      const hookMsg = result.msg.startsWith('[') ? result.msg : `[${step.name}] ${result.msg}`;
      if (!logs.includes(hookMsg)) logs.push(hookMsg);
    }

    stepResults.push({
      step: step.name,
      ok: result.ok,
      aborted: result.abort || false,
      msg: result.msg,
    });

    if (step.name === 'segment' && result.data?.segments) {
      lastSegmentData = result.data as { segments: string[]; segmentDelays: number[] };
    }

    if (result.abort) {
      aborted = true;
      abortReason = result.data?.reason || result.msg;
      abortData = result.data;
      break;
    }
  }

  logs.push(...hookCtx.logs);

  let output: PipelineV2Output = {
    text: ctx.processedText,
    segments: lastSegmentData.segments,
    segmentDelays: lastSegmentData.segmentDelays,
    aborted,
    abortReason,
    abortData,
    logs,
    stepResults,
  };

  // 5. after-pipeline hooks（保留 stepResults，防止 Hook 返回的 PipelineOutput 丢失该字段）
  const afterOutput = await runAfterPipelineHooks(hookCtx, output);
  output = { ...output, ...afterOutput, stepResults: output.stepResults };

  ctx.emitStage?.('Pipeline 完成');

  return output;
}

/**
 * 快速运行：仅清洗 + 分段，不使用完整 10 步
 */
export async function runQuickPipeline(text: string): Promise<{ text: string; segments: string[] }> {
  const ctx: PipelineContext = {
    rawText: text,
    processedText: text,
    emotion: { type: 'anticipation', intensity: 0 },
    recentReplies: [],
    userInput: '',
    affinityStage: 'stranger',
  };

  const config = {
    ...DEFAULT_PIPELINE_V2_CONFIG,
    typoSim: { ...DEFAULT_PIPELINE_V2_CONFIG.typoSim, enabled: false },
    tonePolish: { ...DEFAULT_PIPELINE_V2_CONFIG.tonePolish, enabled: false },
  };

  const result = await runPipelineV2(ctx, config);
  return { text: result.text, segments: result.segments };
}
