/**
 * ============================================================
 * 输入侧 Pipeline / Hook 机制
 * 参考 AstrBot 的 Event / Pipeline 设计，将 Prompt 组装前的横切关注点
 *（用户输入预处理、记忆检索、系统 Prompt 构建等）解耦为可插拔 Hook。
 * ============================================================
 */

import { Character, EmotionType } from '../../types';

export interface InputPipelineContext {
  /** 用户原始输入 */
  userInput: string;
  /** 预处理后的用户输入（Hook 可修改） */
  processedInput: string;
  /** 当前角色 */
  character?: Character;
  /** 当前对话 ID */
  conversationId?: string;
  /** 当前主导情绪 */
  emotion: { type: EmotionType; intensity: number };
  /** 关系阶段 */
  affinityStage?: string;
  /** 记忆 Prompt（由 memory-input Hook 生成） */
  memoryPrompt: string;
  /** 系统 Prompt（由 system-prompt Hook 生成） */
  systemPrompt?: string;
  /** 阶段通知回调 */
  emitStage?: (stage: string, detail?: unknown) => void;
  /** 跨 Hook 数据传递 */
  extras: Record<string, unknown>;
}

/** 输入侧 Hook 接口 */
export interface InputPipelineHook {
  name: string;
  priority?: number;
  onBeforePipeline?: (ctx: InputPipelineContext) => void | Promise<void>;
  onAfterPipeline?: (ctx: InputPipelineContext) => void | Promise<void>;
}

/** 全局输入侧 Hook 注册表 */
class InputPipelineHookRegistry {
  private hooks: InputPipelineHook[] = [];

  register(hook: InputPipelineHook): () => void {
    this.unregister(hook.name);
    this.hooks.push(hook);
    this.sort();
    return () => this.unregister(hook.name);
  }

  unregister(name: string): void {
    this.hooks = this.hooks.filter((h) => h.name !== name);
  }

  getHooks(): InputPipelineHook[] {
    return [...this.hooks];
  }

  clear(): void {
    this.hooks = [];
  }

  private sort(): void {
    this.hooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }
}

export const inputPipelineHookRegistry = new InputPipelineHookRegistry();

/** 创建输入 Pipeline 上下文 */
export function createInputPipelineContext(
  init: Omit<InputPipelineContext, 'processedInput' | 'memoryPrompt' | 'extras'>,
): InputPipelineContext {
  return {
    ...init,
    processedInput: init.userInput,
    memoryPrompt: '',
    extras: {},
  };
}

/** 执行输入 Pipeline，返回被 Hook 修改后的上下文 */
export async function runInputPipeline(
  ctx: InputPipelineContext,
): Promise<InputPipelineContext> {
  ctx.emitStage?.('输入 Pipeline 启动...');

  for (const hook of inputPipelineHookRegistry.getHooks()) {
    if (!hook.onBeforePipeline) continue;
    ctx.emitStage?.(`[输入] ${hook.name}`);
    await hook.onBeforePipeline(ctx);
  }

  for (const hook of inputPipelineHookRegistry.getHooks()) {
    if (!hook.onAfterPipeline) continue;
    ctx.emitStage?.(`[输入后] ${hook.name}`);
    await hook.onAfterPipeline(ctx);
  }

  ctx.emitStage?.('输入 Pipeline 完成');
  return ctx;
}
