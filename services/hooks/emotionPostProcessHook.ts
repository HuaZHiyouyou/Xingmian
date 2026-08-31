/**
 * ============================================================
 * 情绪后处理 Hook
 * 在 Pipeline 运行前解析 LLM 原始输出中的认知链 / feeling 标签，
 * 更新角色多维情绪状态，并将最终情绪写回 PipelineContext，
 * 供后续步骤（语气微调、标点优化等）使用。
 * ============================================================
 */

import { PipelineHook, PipelineHookContext, StepResult } from '../outputPipeline';
import { parseCognitiveOutput, EMPTY_COGNITIVE_OUTPUT } from '../cognitive';
import { getEmotionStateManager } from '../emotion/emotionStateManager';
import { parseFeelingTag, parseThoughtChain, parseEmotionReport, EmotionMetabolism } from '../emotion/thoughtChainParser';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useDebugLog } from '../../store/debugLogStore';
import { useConfigStore } from '../../store/configStore';
import { getDominantEmotion } from '../../utils/emotionAnalyzer';
import { EmotionType, MultiEmotionState } from '../../types';
import { getEffectiveEmotionDecayMultiplier } from '../dataOverrideBridge';

export interface EmotionPostProcessHookConfig {
  enabled: boolean;
  thoughtChainEnabled: boolean;
  activeMetabolism: boolean;
  decayMultiplier: number;
}

/**
 * 创建情绪后处理 Hook
 * 优先级最高（数字最小），确保在其它 Hook 之前完成情绪更新。
 */
export function createEmotionPostProcessHook(
  _config?: Partial<EmotionPostProcessHookConfig>,
): PipelineHook {
  return {
    name: 'emotion-post-process',
    priority: 1,
    onBeforePipeline: (ctx: PipelineHookContext): StepResult => {
      const v2Settings = useConfigStore.getState().v2Config;
      const cfg: EmotionPostProcessHookConfig = {
        enabled: _config?.enabled ?? true,
        thoughtChainEnabled: _config?.thoughtChainEnabled ?? (v2Settings.thoughtChainEnabled !== false),
        activeMetabolism: _config?.activeMetabolism ?? (v2Settings.activeMetabolism !== false),
        decayMultiplier: getEffectiveEmotionDecayMultiplier(_config?.decayMultiplier ?? (v2Settings.decayMultiplier ?? 1)),
      };

      if (!cfg.enabled || !cfg.thoughtChainEnabled) return { ok: true };
      if (!ctx.character) return { ok: true };
      ctx.emitStage?.('正在解析情绪...');

      try {
        const characterId = ctx.character.id;
        const conversationId = ctx.conversationId;

        const manager = getEmotionStateManager();
        const currentMulti = useCharacterMindStore.getState().getMultiEmotion(characterId);
        let updated: MultiEmotionState;

        // Rust 后端已在 <thought> 认知链中完成情绪分析，前端跳过解析避免重复
        let emotionDelta: Record<string, number> = {};
        let affinityDelta = 0;
        if (ctx.extras.isRustHandled) {
          const rustEmotionUpdate = ctx.extras.rustEmotionUpdate as Record<string, number> | undefined;
          emotionDelta = rustEmotionUpdate || {};
          // 🆕 修复双次更新：chatStore 已在 Rust 路径将最终情绪值写入 multiEmotions，
          // 这里只读取最新状态并同步 ctx.emotion，不再重复 applyRustCognitiveUpdate，
          // 避免未更新维度被二次衰减、trust 等数值反复叠加导致暴涨
          updated = useCharacterMindStore.getState().getMultiEmotion(characterId);
          useDebugLog.getState().add(
            'emotion',
            `Pipeline Hook Rust 情绪已写入，跳过重复更新`,
            { characterId, conversationId },
          );
        } else {
          let cognitiveResult = EMPTY_COGNITIVE_OUTPUT;
          let feeling: Partial<Record<EmotionType, number>> | null = null;
          let thought: { metabolisms: EmotionMetabolism[] } | null = null;

          cognitiveResult = parseCognitiveOutput(ctx.rawText);
          feeling = parseFeelingTag(ctx.rawText);
          thought = parseThoughtChain(ctx.rawText);

          emotionDelta = cognitiveResult.emotionUpdate;
          affinityDelta = cognitiveResult.affinityDelta;

          const hasCognitiveUpdate =
            cognitiveResult.hasValidContent &&
            Object.keys(cognitiveResult.emotionUpdate).length > 0;

          if (hasCognitiveUpdate) {
            updated = manager.applyCognitiveUpdate(
              currentMulti,
              cognitiveResult.emotionUpdate,
            );

            if (cognitiveResult.affinityDelta !== 0) {
              useCharacterMindStore.getState().updateAffinity(
                characterId,
                cognitiveResult.affinityDelta,
                `认知管道: ${cognitiveResult.decision || '对话影响'}`,
                ctx.emotion.type,
              );
              useDebugLog.getState().add(
                'affinity',
                `Pipeline Hook 好感度变化: ${cognitiveResult.affinityDelta > 0 ? '+' : ''}${cognitiveResult.affinityDelta}`,
                { characterId, conversationId },
              );
            }

            useDebugLog.getState().add(
              'emotion',
              `Pipeline Hook 认知管道解析: 更新${Object.keys(cognitiveResult.emotionUpdate).length}维情绪 | 好感度Δ=${cognitiveResult.affinityDelta > 0 ? '+' : ''}${cognitiveResult.affinityDelta}`,
              { characterId, conversationId },
            );
          } else {
            updated = manager.update(currentMulti, {
              newEmotion: ctx.emotion.type,
              intensity: ctx.emotion.intensity,
              triggerText: ctx.userInput,
              metabolisms: thought?.metabolisms || [],
              enableMetabolism: cfg.activeMetabolism,
              decayMultiplier: cfg.decayMultiplier,
            });

            if (feeling) {
              for (const [dim, val] of Object.entries(feeling)) {
                if (val && val > 0) {
                  const currentVal = updated.values[dim as EmotionType] || 0;
                  const blended = currentVal * 0.6 + val * 0.4;
                  const clamped = currentVal + Math.max(-5, Math.min(5, blended - currentVal));
                  updated.values[dim as EmotionType] = Math.max(0, Math.min(100, Math.round(clamped * 10) / 10));
                }
              }
              useDebugLog.getState().add('emotion', `Pipeline Hook 回退feeling标签更新: ${JSON.stringify(feeling)}`, { characterId, conversationId });
            }
          }
        }

        // 解析 <report> 情绪报告并作为最终情绪状态覆盖（Rust 路径下也生效）
        const report = parseEmotionReport(ctx.rawText);
        if (report && Object.keys(report).length > 0) {
          for (const [dim, val] of Object.entries(report)) {
            if (val !== undefined && val >= 0) {
              updated.values[dim as EmotionType] = Math.max(0, Math.min(100, val));
            }
          }
          useDebugLog.getState().add('emotion', `Pipeline Hook <report> 情绪报告更新: ${JSON.stringify(report)}`, { characterId, conversationId });
        }

        // 🆕 幂等保护：Rust 路径下 chatStore 已写入最终情绪值，这里跳过重复 setMultiEmotion，
        // 仅同步 ctx.emotion 供 pipeline 使用（避免双写 + store 重复通知）
        if (!ctx.extras.isRustHandled) {
          updated.lastUpdated = Date.now();
          useCharacterMindStore.getState().setMultiEmotion(characterId, updated);
        }

        const dominant = getDominantEmotion(updated);
        // 原地修改 emotion 对象，保证 pipelineCtx.emotion 同步更新
        ctx.emotion.type = dominant.type;
        ctx.emotion.intensity = dominant.intensity;

        ctx.extras.emotionDelta = emotionDelta;
        ctx.extras.affinityDelta = affinityDelta;
        ctx.extras.emotionReport = report;

        useDebugLog.getState().add(
          'emotion',
          `Pipeline Hook 情绪更新完成: 主导=${dominant.type}:${Math.round(dominant.intensity)}, 维度数=${Object.keys(updated.values).length}`,
          { characterId, conversationId },
        );

        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        useDebugLog.getState().add(
          'system',
          `Pipeline Hook 情绪解析失败: ${msg}`,
          { characterId: ctx.character?.id, conversationId: ctx.conversationId },
        );
        return { ok: true };
      }
    },
  };
}
