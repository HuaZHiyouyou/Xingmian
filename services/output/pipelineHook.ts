// ============================================================
// Pipeline Hook 机制
// 参考 AstrBot 的 Pipeline / Event 设计：
// 允许外部模块在 Pipeline 执行前后、每个步骤前后插入自定义逻辑，
// 实现 OOC 检测、记忆注入、情绪后处理等能力的插件化解耦。
// ============================================================

import { PipelineContext, PipelineOutput, StepResult } from '../outputPipeline';

/** Hook 可访问的上下文：PipelineContext + 日志 + 跨阶段数据传递 */
export interface PipelineHookContext extends PipelineContext {
  /** 当前 Pipeline 的运行日志，Hook 可以追加 */
  logs: string[];
  /** 跨 Hook/步骤传递的额外数据，如 OOC 标志、情绪更新结果等 */
  extras: Record<string, unknown>;
}

/** Pipeline 钩子接口 */
export interface PipelineHook {
  /** 唯一名称 */
  name: string;
  /** 优先级，数字越小越先执行；默认 100 */
  priority?: number;

  /** Pipeline 开始前调用；返回 abort 可提前终止 */
  onBeforePipeline?: (ctx: PipelineHookContext) => StepResult | Promise<StepResult>;

  /** 每个步骤开始前调用；返回 abort 可跳过该步骤 */
  onBeforeStep?: (stepName: string, ctx: PipelineHookContext) => StepResult | Promise<StepResult>;

  /** 每个步骤结束后调用；可修改 result 或 ctx */
  onAfterStep?: (
    stepName: string,
    ctx: PipelineHookContext,
    result: StepResult,
  ) => StepResult | Promise<StepResult> | void;

  /** Pipeline 结束后调用；可修改最终输出 */
  onAfterPipeline?: (
    ctx: PipelineHookContext,
    output: PipelineOutput,
  ) => PipelineOutput | Promise<PipelineOutput> | void;
}

/** 全局 Pipeline Hook 注册表 */
class PipelineHookRegistry {
  private hooks: PipelineHook[] = [];

  /** 注册一个 Hook，返回取消注册函数 */
  register(hook: PipelineHook): () => void {
    this.unregister(hook.name);
    this.hooks.push(hook);
    this.sort();
    return () => this.unregister(hook.name);
  }

  /** 按名称注销 Hook */
  unregister(name: string): void {
    this.hooks = this.hooks.filter((h) => h.name !== name);
  }

  /** 获取已排序的 Hook 列表 */
  getHooks(): PipelineHook[] {
    return [...this.hooks];
  }

  /** 清空所有 Hook */
  clear(): void {
    this.hooks = [];
  }

  private sort(): void {
    this.hooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }
}

export const pipelineHookRegistry = new PipelineHookRegistry();

/** 将 PipelineContext 转为 HookContext */
export function createHookContext(ctx: PipelineContext): PipelineHookContext {
  return {
    ...ctx,
    logs: [],
    extras: {},
  };
}

/** 执行所有 Hook 的 onBeforePipeline，若有 abort 则返回该结果 */
export async function runBeforePipelineHooks(
  ctx: PipelineHookContext,
): Promise<StepResult | undefined> {
  for (const hook of pipelineHookRegistry.getHooks()) {
    if (!hook.onBeforePipeline) continue;
    const result = await hook.onBeforePipeline(ctx);
    if (result && !result.ok) {
      ctx.logs.push(`[hook:${hook.name}] before-pipeline ${result.abort ? 'abort' : 'blocked'}: ${result.msg || ''}`);
      return result;
    }
    if (result?.msg) {
      ctx.logs.push(`[hook:${hook.name}] ${result.msg}`);
    }
  }
  return undefined;
}

/** 执行所有 Hook 的 onBeforeStep，若有 abort 则返回该结果 */
export async function runBeforeStepHooks(
  stepName: string,
  ctx: PipelineHookContext,
): Promise<StepResult | undefined> {
  for (const hook of pipelineHookRegistry.getHooks()) {
    if (!hook.onBeforeStep) continue;
    const result = await hook.onBeforeStep(stepName, ctx);
    if (result && !result.ok) {
      ctx.logs.push(`[hook:${hook.name}] before-step:${stepName} ${result.abort ? 'abort' : 'blocked'}: ${result.msg || ''}`);
      return result;
    }
    if (result?.msg) {
      ctx.logs.push(`[hook:${hook.name}] ${result.msg}`);
    }
  }
  return undefined;
}

/** 执行所有 Hook 的 onAfterStep，允许 Hook 返回新的 StepResult */
export async function runAfterStepHooks(
  stepName: string,
  ctx: PipelineHookContext,
  result: StepResult,
): Promise<StepResult> {
  let current = result;
  for (const hook of pipelineHookRegistry.getHooks()) {
    if (!hook.onAfterStep) continue;
    const updated = await hook.onAfterStep(stepName, ctx, current);
    if (updated) {
      current = updated;
      if (updated.msg) {
        ctx.logs.push(`[hook:${hook.name}] after-step:${stepName}: ${updated.msg}`);
      }
    }
  }
  return current;
}

/** 执行所有 Hook 的 onAfterPipeline，允许 Hook 修改输出 */
export async function runAfterPipelineHooks(
  ctx: PipelineHookContext,
  output: PipelineOutput,
): Promise<PipelineOutput> {
  let current = output;
  for (const hook of pipelineHookRegistry.getHooks()) {
    if (!hook.onAfterPipeline) continue;
    const updated = await hook.onAfterPipeline(ctx, current);
    if (updated) {
      current = updated;
    }
  }
  return current;
}
