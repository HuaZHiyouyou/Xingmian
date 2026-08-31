/**
 * 认知思维链阶段定义
 *
 * 设计思路（参考 AstrBot StarHandlerRegistry）：
 * - 不同的"事件类型"（认知主回复 / 情绪咨询）注册不同的 handler 链
 * - 每个阶段可独立配置、复用、组合
 * - 后续可在不同阶段之间插入 hook（回调/中间件）
 *
 * 当前支持的阶段组合：
 * - cognitive (7步)：感知→评估→代谢→决策→更新→学习利用→回复
 * - consult   (5步)：感知→评估→代谢→决策→更新
 */

/** 单个思维链阶段 */
export type ThinkStage =
  | 'perceive'      // 感知：看透对方的状态、语气、情绪
  | 'assess'        // 评估：这件事怎么做，关系如何，走什么流程
  | 'metabolize'    // 代谢：情绪怎么变，要不要抑制消极/过度
  | 'decide'        // 决策：回复策略 + 行动意图
  | 'update'        // 更新：自己算出新情绪/好感度值
  | 'learn'         // 学习利用：把学到的用户风格用回回复
  | 'reply';        // 回复正文

/** 各阶段中文标签 */
export const STAGE_LABELS: Record<ThinkStage, string> = {
  perceive: '感知',
  assess: '评估',
  metabolize: '代谢',
  decide: '决策',
  update: '更新',
  learn: '学习利用',
  reply: '回复',
};

/** 阶段组合：定义一组阶段及其元数据 */
export interface StageComposition {
  /** 唯一标识 */
  id: string;
  /** 阶段列表（按执行顺序） */
  stages: ThinkStage[];
  /** 中文名称 */
  label: string;
  /** 用途描述 */
  description: string;
}

/** 可用的阶段组合 */
export const STAGE_COMPOSITIONS: Record<string, StageComposition> = {
  /** 完整认知链路：主回复使用 — 7步 */
  cognitive: {
    id: 'cognitive',
    stages: ['perceive', 'assess', 'metabolize', 'decide', 'update', 'learn', 'reply'],
    label: '完整认知链路',
    description: '7 步思维链：感知→评估→代谢→决策→更新→学习→回复',
  },
  /** 情绪咨询/调和：情绪子流程使用 — 5步 */
  consult: {
    id: 'consult',
    stages: ['perceive', 'assess', 'metabolize', 'decide', 'update'],
    label: '情绪咨询/调和',
    description: '5 步专家内省：感知→评估→代谢→决策→更新',
  },
};

/**
 * 获取指定组合中各阶段的中文标签（按顺序）
 */
export function getStageLabels(stageIds: ThinkStage[]): string[] {
  return stageIds.map(id => STAGE_LABELS[id]);
}

/**
 * 构建阶段描述的 Prompt 段落（给 LLM 看的）
 */
export function buildStagesInstruction(stages: ThinkStage[]): string {
  const lines = stages.map((stage) => {
    switch (stage) {
      case 'perceive':
        return '感知：用户是谁、说了什么、对方的情绪状态如何（看透对方，不是看自己）';
      case 'assess':
        return '评估：这件事我要怎么做？考虑到双方关系，需要安慰/鼓励/分享/……？';
      case 'metabolize':
        return '代谢：我自己的情绪需要调整吗？要不要抑制某种情绪或增强某种？（输出格式示例：sadness -10, joy +5）';
      case 'decide':
        return '决策：我决定怎么回复，语气、长度、重点。';
      case 'update':
        return '更新：根据以上推理决定 19 维情绪的**新值**。\n'
          + '          ⚠ 必须输出所有 19 种情绪的最终值（0-100），数值应符合当前对话的真实情绪。\n'
          + '          ⚠ 如果用户心情轻松愉快，你的悲伤/愤怒等负面情绪应当大幅降低（≤5）。\n'
          + '          格式：sadness=5, joy=55, trust=50, fear=2, surprise=15, disgust=0, anger=0, anticipation=30, pride=0, guilt=0, embarrassment=10, jealousy=0, curiosity=0, love=0, gratitude=0, empathy=0, anxiety=0, loneliness=0, disappointment=0，好感度+2';
      case 'learn':
        return '学习利用：用户平时喜欢什么说话风格？把学到的特点自然用回回复里。';
      case 'reply':
        return '回复正文：写一段符合人格的回复给用户，不要提及 thought 里的内容。';
      default:
        return '';
    }
  }).filter(Boolean);

  return lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
}
