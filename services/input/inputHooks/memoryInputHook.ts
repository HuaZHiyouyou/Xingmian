/**
 * ============================================================
 * 输入侧记忆注入 Hook
 * 在 LLM 调用前检索相关记忆并生成 memoryPrompt，写入输入 Pipeline 上下文。
 * ============================================================
 */

import { InputPipelineHook, InputPipelineContext } from '../inputPipeline';
import {
  retrieveRelevantMemories,
  buildMemoryPromptV2,
  convertToCoreMemory,
} from '../../memory/memorySystemV2';
import { useCharacterMindStore } from '../../../store/characterMindStore';
import { useConfigStore } from '../../../store/configStore';
import { useDebugLog } from '../../../store/debugLogStore';
import { getMemoryImportanceWeight } from '../../dataOverrideBridge';

export interface MemoryInputHookConfig {
  enabled: boolean;
  dualLayerMemory: boolean;
  maxRecallCount: number;
  forgettingCurve: boolean;
}

export function createMemoryInputHook(
  config?: Partial<MemoryInputHookConfig>,
): InputPipelineHook {
  return {
    name: 'memory-input',
    priority: 10,
    onBeforePipeline: (ctx: InputPipelineContext): void => {
      const v2Settings = useConfigStore.getState().v2Config;
      const cfg: MemoryInputHookConfig = {
        enabled: config?.enabled ?? true,
        dualLayerMemory: config?.dualLayerMemory ?? (v2Settings.dualLayerMemory !== false),
        maxRecallCount: config?.maxRecallCount ?? (v2Settings.maxRecallCount ?? 5),
        forgettingCurve: config?.forgettingCurve ?? (v2Settings.forgettingCurve !== false),
      };

      if (!cfg.enabled || !cfg.dualLayerMemory || !ctx.character) return;

      try {
        const characterId = ctx.character.id;
        const mindStore = useCharacterMindStore.getState();
        const coreMems = mindStore.getCoreMemories(characterId);
        const episodicMems = mindStore.getEpisodicMemories(characterId);

        let relevant;
        const importanceWeight = getMemoryImportanceWeight();
        if (coreMems.length > 0 || episodicMems.length > 0) {
          relevant = retrieveRelevantMemories({
            userMessage: ctx.processedInput,
            userEmotion: ctx.emotion.type,
            coreMemories: coreMems,
            episodicMemories: episodicMems,
            maxResults: cfg.maxRecallCount,
            importanceWeight,
          });
        } else {
          const v1Memories = mindStore.getMemories(characterId).slice(0, 5);
          const fallbackCores = v1Memories.map((m) => convertToCoreMemory(m, characterId));
          relevant = retrieveRelevantMemories({
            userMessage: ctx.processedInput,
            userEmotion: ctx.emotion.type,
            coreMemories: fallbackCores,
            episodicMemories: [],
            maxResults: cfg.maxRecallCount,
            importanceWeight,
          });
        }

        ctx.memoryPrompt = buildMemoryPromptV2(relevant, cfg.forgettingCurve);

        const summary = [
          relevant.core.length > 0 ? `核心记忆${relevant.core.length}条` : '',
          relevant.episodic.length > 0 ? `情节记忆${relevant.episodic.length}条` : '',
        ].filter(Boolean).join('，');

        if (summary) {
          useDebugLog.getState().add(
            'memory',
            `输入 Pipeline 记忆检索: ${summary}`,
            { characterId, conversationId: ctx.conversationId },
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        useDebugLog.getState().add(
          'memory',
          `输入 Pipeline 记忆检索失败: ${msg}`,
          { characterId: ctx.character?.id, conversationId: ctx.conversationId },
        );
      }
    },
  };
}
