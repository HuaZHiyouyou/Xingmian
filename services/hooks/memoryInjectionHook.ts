/**
 * ============================================================
 * 记忆注入 Hook
 * 在 Pipeline 运行前检索与用户输入相关的记忆，
 * 将记忆上下文写入 ctx.extras，供后续 Hook 或日志模块使用。
 *
 * 注：当前 LLM 调用已在 chatStore 中完成，此 Hook 主要用于：
 * 1) 统一记忆检索逻辑，便于未来迁移到输入侧 Pipeline；
 * 2) 在 Pipeline 日志中展示“本次回复参考了哪些记忆”。
 * ============================================================
 */

import { PipelineHook, PipelineHookContext, StepResult } from '../outputPipeline';
import {
  retrieveRelevantMemories,
  buildMemoryPromptV2,
  convertToCoreMemory,
  MemoryRetrievalResult,
} from '../memory/memorySystemV2';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useDebugLog } from '../../store/debugLogStore';
import { useConfigStore } from '../../store/configStore';

export interface MemoryInjectionHookConfig {
  enabled: boolean;
  dualLayerMemory: boolean;
  maxRecallCount: number;
  forgettingCurve: boolean;
}

/**
 * 检索角色相关记忆（V2 双层记忆 + V1 fallback）
 */
function retrieveMemories(
  ctx: PipelineHookContext,
  maxRecall: number,
  useForgettingCurve: boolean,
): { prompt: string; relevant: MemoryRetrievalResult } | null {
  if (!ctx.character) return null;

  const characterId = ctx.character.id;
  const mindStore = useCharacterMindStore.getState();
  const coreMems = mindStore.getCoreMemories(characterId);
  const episodicMems = mindStore.getEpisodicMemories(characterId);

  let relevant: MemoryRetrievalResult;
  if (coreMems.length > 0 || episodicMems.length > 0) {
    relevant = retrieveRelevantMemories({
      userMessage: ctx.userInput,
      userEmotion: ctx.emotion.type,
      coreMemories: coreMems,
      episodicMemories: episodicMems,
      maxResults: maxRecall,
    });
  } else {
    const v1Memories = mindStore.getMemories(characterId).slice(0, 5);
    const fallbackCores = v1Memories.map((m) => convertToCoreMemory(m, characterId));
    relevant = retrieveRelevantMemories({
      userMessage: ctx.userInput,
      userEmotion: ctx.emotion.type,
      coreMemories: fallbackCores,
      episodicMemories: [],
      maxResults: maxRecall,
    });
  }

  const prompt = buildMemoryPromptV2(relevant, useForgettingCurve);
  return { prompt, relevant };
}

/**
 * 创建记忆注入 Hook
 */
export function createMemoryInjectionHook(
  _config?: Partial<MemoryInjectionHookConfig>,
): PipelineHook {
  return {
    name: 'memory-injection',
    priority: 5,
    onBeforePipeline: (ctx: PipelineHookContext): StepResult => {
      const v2Settings = useConfigStore.getState().v2Config;
      const cfg: MemoryInjectionHookConfig = {
        enabled: _config?.enabled ?? true,
        dualLayerMemory: _config?.dualLayerMemory ?? (v2Settings.dualLayerMemory !== false),
        maxRecallCount: _config?.maxRecallCount ?? (v2Settings.maxRecallCount ?? 5),
        forgettingCurve: _config?.forgettingCurve ?? (v2Settings.forgettingCurve !== false),
      };

      if (!cfg.enabled || !cfg.dualLayerMemory || !ctx.character) return { ok: true };

      ctx.emitStage?.('正在检索记忆...');

      try {
        const result = retrieveMemories(ctx, cfg.maxRecallCount, cfg.forgettingCurve);
        if (!result) return { ok: true };

        const { prompt, relevant } = result;
        ctx.extras.memoryPrompt = prompt;
        ctx.extras.relevantMemories = relevant;

        const summary = [
          relevant.core.length > 0 ? `核心记忆${relevant.core.length}条` : '',
          relevant.episodic.length > 0 ? `情节记忆${relevant.episodic.length}条` : '',
        ].filter(Boolean).join('，');

        if (summary) {
          useDebugLog.getState().add(
            'memory',
            `Pipeline Hook 记忆检索: ${summary}`,
            { characterId: ctx.character.id, conversationId: ctx.conversationId },
          );
        }

        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        useDebugLog.getState().add(
          'memory',
          `Pipeline Hook 记忆检索失败: ${msg}`,
          { characterId: ctx.character?.id, conversationId: ctx.conversationId },
        );
        return { ok: true };
      }
    },
  };
}
