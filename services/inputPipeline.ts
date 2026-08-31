// ============================================================
// 输入侧 Pipeline 统一出口
// ============================================================

export {
  inputPipelineHookRegistry,
  createInputPipelineContext,
  runInputPipeline,
} from './input/inputPipeline';
export type {
  InputPipelineContext,
  InputPipelineHook,
} from './input/inputPipeline';

export { createUserInputPreprocessHook } from './input/inputHooks/userInputPreprocessHook';
export type { UserInputPreprocessConfig } from './input/inputHooks/userInputPreprocessHook';

export { createMemoryInputHook } from './input/inputHooks/memoryInputHook';
export type { MemoryInputHookConfig } from './input/inputHooks/memoryInputHook';
