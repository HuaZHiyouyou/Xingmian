/**
 * ============================================================
 * 历史净化 Hook
 * 在 Pipeline 开始前对 processedText 进行净化：
 * 移除 <thought> / <feeling> / <action> / 内心活动 / 身份前缀 / 模板语言。
 * 将历史净化逻辑从 chatStore 解耦到 Pipeline Hook。
 * ============================================================
 */

import { PipelineHook, PipelineHookContext, StepResult } from '../outputPipeline';
import {
  HistoryCleaner,
  HistoryCleanerConfig,
  DEFAULT_CLEANER_CONFIG,
  CleanResult,
} from '../emotion/historyCleaner';
import { useDebugLog } from '../../store/debugLogStore';

export interface HistoryCleanHookConfig extends Partial<HistoryCleanerConfig> {
  enabled: boolean;
}

/**
 * 创建历史净化 Hook
 * 优先级 2，在 emotion-post-process (priority 1) 之后、其它 Hook 之前执行。
 */
export function createHistoryCleanHook(
  _config?: Partial<HistoryCleanHookConfig>,
): PipelineHook {
  const cleaner = new HistoryCleaner({
    ...DEFAULT_CLEANER_CONFIG,
    ...(_config ?? {}),
  });

  return {
    name: 'history-clean',
    priority: 2,
    onBeforePipeline: (ctx: PipelineHookContext): StepResult => {
      const cfg: HistoryCleanHookConfig = {
        enabled: _config?.enabled ?? true,
        ...(_config ?? {}),
      };

      if (!cfg.enabled) return { ok: true };

      ctx.emitStage?.('正在净化历史...');

      const before = ctx.processedText;
      const result: CleanResult = cleaner.clean(before);

      ctx.processedText = result.cleanText;
      ctx.extras.historyCleanResult = result;

      const logCtx = {
        characterId: ctx.character?.id,
        conversationId: ctx.conversationId,
      };

      if (result.fallback) {
        useDebugLog.getState().add(
          'system',
          `Pipeline Hook 历史净化降级: ${result.fallbackText ? result.fallbackText.slice(0, 40) : result.cleanText}`,
          logCtx,
        );
        return {
          ok: true,
          msg: `历史净化降级: 原始${before.length}字符 → 输出${result.cleanText.length}字符`,
          data: { fallback: true, removedCount: result.removedContent.length },
        };
      }

      if (result.removedContent.length > 0) {
        useDebugLog.getState().add(
          'system',
          `Pipeline Hook 历史净化: 移除${result.removedContent.length}处标记/前缀`,
          logCtx,
        );
        return {
          ok: true,
          msg: `历史净化: 移除${result.removedContent.length}处标记/前缀`,
          data: { removedCount: result.removedContent.length },
        };
      }

      return { ok: true };
    },
  };
}

/**
 * 兼容旧版：净化用于记忆存储的文本
 */
export function cleanForHistory(text: string): string {
  return new HistoryCleaner().cleanForHistory(text);
}
