/**
 * ============================================================
 * OOC / 复读 / AI腔 / 人设崩塌 检测 Hook
 * 从 Pipeline Step 迁移到 Hook，便于独立配置与扩展。
 * 在 block_cliche 步骤前执行，对异常输出进行角色化改写。
 * ============================================================
 */

import { PipelineHook, PipelineHookContext, StepResult } from '../outputPipeline';
import { containsAICliche, detectPersonaCollapse, isDuplicate } from '../aiService';

export interface OOCHookConfig {
  enabled: boolean;
  blockDuplicate: boolean;
  duplicateThreshold: number;
  blockAICliche: boolean;
  blockPersonaCollapse: boolean;
}

/**
 * 当检测到复读/AI腔/人设崩塌时，改写为角色化过渡句，
 * 避免整条回复被丢弃后重新调用 LLM。
 */
function rewriteBlockedReply(ctx: PipelineHookContext, reason: 'duplicate' | 'cliche' | 'collapse'): string {
  const character = ctx.character;
  const name = character?.name || '';
  const emotion = ctx.emotion?.type || 'anticipation';
  const userInput = ctx.userInput || '';

  const genericByEmotion: Record<string, string[]> = {
    anticipation: [
      '……嗯？好像走神了，能再说一遍吗？',
      '啊，不好意思，刚刚晃神了一下。',
    ],
    embarrassment: [
      `那个……不好意思，${name ? name + '刚刚' : '我刚刚'}没听清，能再说一遍吗？`,
      `啊……对不起，${name ? name : '我'}走神了……`,
    ],
    sadness: [
      `……对不起，${name ? name + '刚刚' : '我刚刚'}有点心不在焉。能再说一次吗？`,
      `${name ? name : '我'}刚刚好像没听清楚……`,
    ],
    joy: [
      `哈哈不好意思，${name ? name : '我'}太开心了有点走神！你刚才说什么？`,
      `诶嘿，${name ? name : '我'}乐了一下没注意听，能再说一遍吗？`,
    ],
    surprise: [
      `哇！不好意思${name ? name : ''}太惊讶了没回过神……你刚刚说啥？`,
      `天哪，${name ? name : '我'}有点没反应过来……能再说一次吗？`,
    ],
    anger: [
      `……${name ? name : '我'}有点心不在焉，能再说一遍吗？`,
      `${name ? name : '我'}刚刚在想事情，不好意思。`,
    ],
    fear: [
      `……${name ? name : '我'}有点慌，没听清楚……能再说一遍吗？`,
      `${name ? name : '我'}现在脑子有点乱……`,
    ],
    jealousy: [
      `……嗯？${name ? name : '我'}刚刚在想事情，没听清……`,
      `啊，不好意思${name ? name : ''}有点走神了。`,
    ],
    trust: [
      `……唔，${name ? name : '我'}好像没跟上，能再说一遍吗？`,
      `啊，${name ? name : '我'}刚刚分神了，不好意思。`,
    ],
    disgust: [
      `……啧，${name ? name : '我'}刚刚走神了，你再说一次？`,
      `不好意思，${name ? name : '我'}没听清。`,
    ],
    pride: [
      `……咳咳，${name ? name : '我'}刚刚没注意，能再说一遍吗？`,
      `啊，${name ? name : '我'}刚才在发呆。`,
    ],
    guilt: [
      `……对不起，${name ? name : '我'}刚刚走神了，能再说一次吗？`,
      `抱歉，${name ? name : '我'}没听清楚。`,
    ],
  };

  const fallback = genericByEmotion[emotion] || genericByEmotion.anticipation;
  let recovery = fallback[Math.floor(Math.random() * fallback.length)];

  // 根据关系阶段微调语气
  const stage = ctx.affinityStage || 'stranger';
  if (['affectionate', 'deep_love', 'devoted', 'undying'].includes(stage)) {
    recovery = recovery.replace(/不好意思/g, '抱歉啦').replace(/对不起/g, '对不起啦');
    if (recovery.endsWith('？') && !recovery.endsWith('~')) recovery += '~';
  } else if (['familiar', 'favorable', 'friendly', 'close'].includes(stage)) {
    recovery = recovery.replace(/不好意思/g, '抱歉');
  }

  if (reason === 'collapse' && character) {
    const personality = character.personality || '一个真实的人';
    recovery = `……不对，${name ? name : '我'}不是AI，也不是程序。${name ? name : '我'}是${personality}。刚才的话不算，重新来。`;
  } else if (reason === 'duplicate' && userInput) {
    recovery = `……等等，${name ? name + '怎么' : '怎么'}感觉刚才说过一遍了。${userInput.length > 10 ? userInput.slice(0, 10) + '……' : userInput}，是这个意思吗？`;
  }

  return recovery;
}

/**
 * 创建 OOC 检测 Hook
 * 优先级较高（数字小），确保在 block_cliche 步骤前完成改写。
 */
export function createOOCHook(config?: Partial<OOCHookConfig>): PipelineHook {
  return {
    name: 'ooc-detection',
    priority: 10,
    onBeforeStep: (stepName: string, ctx: PipelineHookContext): StepResult => {
      if (stepName !== 'block_cliche') return { ok: true };

      const intercept = ctx.interceptConfig;
      const cfg: OOCHookConfig = {
        enabled: intercept?.enableIntercept ?? true,
        blockDuplicate: intercept?.blockDuplicate ?? true,
        duplicateThreshold: intercept?.duplicateThreshold ?? 0.85,
        blockAICliche: intercept?.blockAICliche ?? true,
        blockPersonaCollapse: intercept?.blockPersonaCollapse ?? true,
        ...config,
      };

      if (!cfg.enabled) return { ok: true };

      ctx.emitStage?.('正在检测OOC...');

      // V2: 信任 Rust 后端的 OOC 检测结果，但仅在对应开关开启时生效
      const rustOocDetected = ctx.extras.rustOocDetected as boolean | undefined;
      if (rustOocDetected && (cfg.blockAICliche || cfg.blockPersonaCollapse)) {
        const reason: 'collapse' | 'cliche' = cfg.blockPersonaCollapse ? 'collapse' : 'cliche';
        ctx.processedText = rewriteBlockedReply(ctx, reason);
        return {
          ok: true,
          msg: `OOC Hook: Rust 已标记 OOC(${reason})，已改写为角色过渡句`,
          data: { reason: 'rust_ooc', rewritten: true },
        };
      }

      const text = ctx.processedText;

      // 复读检测 → 改写
      if (cfg.blockDuplicate && ctx.recentReplies.length > 0) {
        if (isDuplicate(text, ctx.recentReplies, cfg.duplicateThreshold)) {
          ctx.processedText = rewriteBlockedReply(ctx, 'duplicate');
          return {
            ok: true,
            msg: 'OOC Hook: 检测到复读输出，已改写为角色过渡句',
            data: { reason: 'duplicate', rewritten: true },
          };
        }
      }

      // AI腔检测 → 改写
      if (cfg.blockAICliche && containsAICliche(text)) {
        ctx.processedText = rewriteBlockedReply(ctx, 'cliche');
        return {
          ok: true,
          msg: 'OOC Hook: 检测到客服腔，已改写为角色过渡句',
          data: { reason: 'cliche', rewritten: true },
        };
      }

      // 人设崩塌检测 → 改写
      if (cfg.blockPersonaCollapse && detectPersonaCollapse(text)) {
        ctx.processedText = rewriteBlockedReply(ctx, 'collapse');
        return {
          ok: true,
          msg: 'OOC Hook: 检测到人设崩塌，已改写为角色回归句',
          data: { reason: 'collapse', rewritten: true },
        };
      }

      return { ok: true };
    },
  };
}
