/**
 * 认知上下文
 *
 * 设计思路（参考 AstrBot AstrMessageEvent._extras 机制）：
 * - 跨 Pipeline 阶段传递中间状态
 * - 每个阶段将产出写入 context，后续阶段可读取
 * - 类似 AstrBot 中插件通过 event.get_extra / set_extra 传递数据
 */

import type { Character, MultiEmotionState } from '../../types';
import type { ThinkStage } from './thinkStages';

/** 认知管道上下文 */
export interface CognitiveContext {
  // ========== 输入 ==========
  /** 用户原始消息 */
  userMessage: string;
  /** 角色信息 */
  character: Character;
  /** 当前情绪状态 */
  emotionState: MultiEmotionState;
  /** 好感度 */
  affinity: { level: number; stage: string };
  /** 用户画像摘要 */
  userProfile?: string;

  // ========== 各阶段产出 ==========
  /** 感知结果 */
  perception?: string;
  /** 评估结果 */
  assessment?: string;
  /** 代谢建议（情绪名 ± 数值） */
  metabolism?: Record<string, number>;
  /** 决策 */
  decision?: string;
  /** 更新后的情绪值 */
  emotionUpdate?: Record<string, number>;
  /** 好感度变化量 */
  affinityDelta?: number;
  /** 学习利用结果 */
  learning?: string;
  /** 回复正文 */
  reply?: string;

  // ========== 注入信息 ==========
  /** 相关记忆 */
  relevantMemories?: Array<{ content: string; importance: number }>;
  /** 格式化后的用户消息（含时间/引用/说话人） */
  formattedMessage?: string;

  // ========== 控制 ==========
  /** 使用的阶段组合 ID */
  stageSetId: string;
  /** 已完成的阶段列表 */
  completedStages: ThinkStage[];
  /** 扩展元数据（类似 AstrBot _extras） */
  metadata: Record<string, unknown>;

  // ========== 错误 ==========
  /** 是否发生错误 */
  error?: string;
}

/** 创建空的认知上下文 */
export function createCognitiveContext(params: {
  userMessage: string;
  character: Character;
  emotionState: MultiEmotionState;
  affinity: { level: number; stage: string };
  stageSetId: string;
  userProfile?: string;
  relevantMemories?: Array<{ content: string; importance: number }>;
}): CognitiveContext {
  return {
    userMessage: params.userMessage,
    character: params.character,
    emotionState: params.emotionState,
    affinity: params.affinity,
    userProfile: params.userProfile,
    relevantMemories: params.relevantMemories,
    stageSetId: params.stageSetId,
    completedStages: [],
    metadata: {},
  };
}
