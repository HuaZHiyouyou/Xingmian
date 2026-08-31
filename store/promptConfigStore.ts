import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Prompt 热更新配置 Store。
 * 前端面板编辑这些字段 → 立即持久化 → 下次调用 Rust process_message 时透传，
 * Rust 端 build_cognitive_prompt 会用它覆盖/追加内置 prompt，无需重启应用即生效。
 */
interface PromptConfigState {
  /** 自定义系统指令（追加在 system prompt 末尾，最后生效） */
  customSystemPrompt: string;
  /** 自定义人格描述（覆盖内置性格/背景/风格） */
  customPersonality: string;
  /** 自定义关怀方式（覆盖内置【关怀方式】段落） */
  customCareGuidance: string;
  /** 自定义环境意识（覆盖内置【环境意识】段落） */
  customEnvironmentAwareness: string;
  /** 设置器 */
  setCustomSystemPrompt: (v: string) => void;
  setCustomPersonality: (v: string) => void;
  setCustomCareGuidance: (v: string) => void;
  setCustomEnvironmentAwareness: (v: string) => void;
  /** 批量导入 */
  applyConfig: (cfg: Partial<Pick<PromptConfigState, 'customSystemPrompt' | 'customPersonality' | 'customCareGuidance' | 'customEnvironmentAwareness'>>) => void;
  /** 清空全部自定义 */
  resetAll: () => void;
}

export const usePromptConfigStore = create<PromptConfigState>()(
  persist(
    (set) => ({
      customSystemPrompt: '',
      customPersonality: '',
      customCareGuidance: '',
      customEnvironmentAwareness: '',
      setCustomSystemPrompt: (v) => set({ customSystemPrompt: v }),
      setCustomPersonality: (v) => set({ customPersonality: v }),
      setCustomCareGuidance: (v) => set({ customCareGuidance: v }),
      setCustomEnvironmentAwareness: (v) => set({ customEnvironmentAwareness: v }),
      applyConfig: (cfg) => set(cfg),
      resetAll: () =>
        set({
          customSystemPrompt: '',
          customPersonality: '',
          customCareGuidance: '',
          customEnvironmentAwareness: '',
        }),
    }),
    { name: 'ai-prompt-config' }
  )
);
