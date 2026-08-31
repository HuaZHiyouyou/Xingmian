/**
 * ============================================================
 * 输入侧 Skill 关键词触发 Hook
 * 用户消息命中 keyword 型 skill 的关键词时自动激活该 skill，
 * 并记录使用统计。修复此前 matchKeywords 无调用方的断链。
 * ============================================================
 */

import { InputPipelineHook, InputPipelineContext } from '../inputPipeline';
import { useSkillsStore } from '../../../store/skillsStore';
import { useDebugLog } from '../../../store/debugLogStore';

export function createSkillKeywordInputHook(): InputPipelineHook {
  return {
    name: 'skill-keyword-input',
    priority: 5,
    onBeforePipeline: (ctx: InputPipelineContext): void => {
      const text = ctx.processedInput;
      if (!text) return;

      const skillsStore = useSkillsStore.getState();
      const matched = skillsStore.matchKeywords(text);
      if (matched.length === 0) return;

      // 只激活尚未激活的 skill，避免重复计数
      const newlyActivated = matched.filter((name) => !skillsStore.activeSkills.includes(name));
      if (newlyActivated.length === 0) return;

      const nextActive = [...skillsStore.activeSkills, ...newlyActivated];
      skillsStore.setActiveSkills(nextActive);

      // 记录每个新激活 skill 的使用统计
      skillsStore.skills.forEach((sk) => {
        if (newlyActivated.includes(sk.name)) skillsStore.recordUse(sk.id);
      });

      useDebugLog.getState().add(
        'injection',
        `[Skill] 关键词触发激活: ${newlyActivated.join('、')}`,
        { characterId: ctx.character?.id, conversationId: ctx.conversationId },
      );
    },
  };
}
