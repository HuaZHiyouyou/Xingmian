/**
 * ============================================================
 * 用户输入预处理 Hook
 * 在输入 Pipeline 中对用户输入做标准化清洗。
 * ============================================================
 */

import { InputPipelineHook, InputPipelineContext } from '../inputPipeline';

export interface UserInputPreprocessConfig {
  enabled: boolean;
  trimWhitespace: boolean;
  collapseMultipleLines: boolean;
  maxLength: number;
}

export function createUserInputPreprocessHook(
  config?: Partial<UserInputPreprocessConfig>,
): InputPipelineHook {
  const cfg: UserInputPreprocessConfig = {
    enabled: config?.enabled ?? true,
    trimWhitespace: config?.trimWhitespace ?? true,
    collapseMultipleLines: config?.collapseMultipleLines ?? true,
    maxLength: config?.maxLength ?? 4000,
  };

  return {
    name: 'user-input-preprocess',
    priority: 1,
    onBeforePipeline: (ctx: InputPipelineContext): void => {
      if (!cfg.enabled) return;

      let text = ctx.processedInput;

      if (cfg.trimWhitespace) {
        text = text.trim();
      }

      if (cfg.collapseMultipleLines) {
        text = text.replace(/\n{3,}/g, '\n\n');
      }

      if (text.length > cfg.maxLength) {
        text = text.slice(0, cfg.maxLength);
      }

      ctx.processedInput = text;
    },
  };
}
