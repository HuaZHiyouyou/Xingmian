/**
 * 认知调用函数
 *
 * 单次 LLM 调用完成"感知→评估→代谢→决策→更新"等阶段组合，
 * 替代原来分散的 analyzeEmotion + selectRelevantMemories + callAI。
 *
 * 设计思路（参考 AstrBot ToolLoopAgentRunner）：
 * - 支持 fallback：主要模型失败时自动降级到备用模型
 * - 输出解析健壮：解析失败时有兜底
 * - 与 aiService.ts 的 callAI 对接，复用现有的多级候选机制
 */

import { callAI } from '../aiService';
import type { ModelRole } from '../../store/modelRoleStore';
import { buildCognitivePrompt, type CognitivePromptParams } from './cognitivePrompt';
import {
  parseCognitiveOutput,
  parseConsultOutput,
  type CognitiveOutput,
  type ConsultOutput,
  EMPTY_COGNITIVE_OUTPUT,
  EMPTY_CONSULT_OUTPUT,
} from './cognitiveParser';
import type { CognitiveContext } from './cognitiveContext';

/** 与 aiService.ts 一致的 AIMessage 类型 */
type MessageContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

export interface AIMessage {
  role: string;
  content: MessageContent;
}

/** 认知调用配置 */
export interface CognitiveCallConfig {
  /** 模型的 candidate 角色（默认 'reply'） */
  role?: string;
  /** 最大 tokens */
  maxTokens?: number;
  /** 温度 */
  temperature?: number;
  /** 重试次数 */
  maxRetries?: number;
}

const DEFAULT_CONFIG: CognitiveCallConfig = {
  role: 'reply',
  maxTokens: 1200,
  temperature: 0.85,
  maxRetries: 1,
};

/**
 * 认知主回复调用
 *
 * 执行一次 LLM 调用，产出 7 步思维链 + 回复正文。
 * 结果写入 context，返回解析后的 CognitiveOutput。
 */
export async function cognitiveReply(
  messages: AIMessage[],
  params: CognitivePromptParams,
  config: CognitiveCallConfig = {},
): Promise<{ output: CognitiveOutput; context: CognitiveContext }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const systemPrompt = buildCognitivePrompt(params);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const rawOutput = await callAI(
        messages,
        systemPrompt,
        cfg.maxTokens,
        cfg.temperature,
        cfg.role as ModelRole, // ModelRole 类型兼容
      );

      const parsed = parseCognitiveOutput(rawOutput);

      // 重试检测：如果完全没有有效内容，重试
      if (!parsed.hasValidContent) {
        if (attempt < cfg.maxRetries) continue;
      }

      // 构建上下文
      const context: CognitiveContext = {
        userMessage: params.character.name,
        character: params.character,
        emotionState: params.emotionState,
        affinity: params.affinity,
        stageSetId: params.composition.id,
        completedStages: [...params.composition.stages],
        metadata: {},
        ...(parsed.reply ? { reply: parsed.reply } : {}),
        ...(parsed.perception ? { perception: parsed.perception } : {}),
        ...(parsed.assessment ? { assessment: parsed.assessment } : {}),
        ...(Object.keys(parsed.metabolism).length > 0 ? { metabolism: parsed.metabolism } : {}),
        ...(parsed.decision ? { decision: parsed.decision } : {}),
        ...(Object.keys(parsed.emotionUpdate).length > 0 ? { emotionUpdate: parsed.emotionUpdate } : {}),
        ...(parsed.affinityDelta !== 0 ? { affinityDelta: parsed.affinityDelta } : {}),
        ...(parsed.learning ? { learning: parsed.learning } : {}),
      };

      return { output: parsed, context };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= cfg.maxRetries) break;
    }
  }

  // 所有重试失败 — 兜底返回空结果
  const errorContext: CognitiveContext = {
    userMessage: params.character.name,
    character: params.character,
    emotionState: params.emotionState,
    affinity: params.affinity,
    stageSetId: params.composition.id,
    completedStages: [],
    metadata: {},
    error: lastError?.message || '认知调用失败',
  };

  return { output: EMPTY_COGNITIVE_OUTPUT, context: errorContext };
}

/**
 * 情绪咨询调用
 *
 * 执行一次 LLM 调用，产出 5 步专家内省 + 情绪报告。
 * 与 cognitiveReply 共享同一套解析基础设施。
 */
export async function emotionConsult(
  messages: AIMessage[],
  params: CognitivePromptParams,
  config: CognitiveCallConfig = {},
): Promise<{ output: ConsultOutput; context: CognitiveContext }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const systemPrompt = buildCognitivePrompt(params);

  try {
    const rawOutput = await callAI(
      messages,
      systemPrompt,
      cfg.maxTokens,
      cfg.temperature,
      cfg.role as ModelRole,
    );

    const parsed = parseConsultOutput(rawOutput);

    const context: CognitiveContext = {
      userMessage: params.character.name,
      character: params.character,
      emotionState: params.emotionState,
      affinity: params.affinity,
      stageSetId: params.composition.id,
      completedStages: parsed.hasValidContent ? [...params.composition.stages] : [],
      metadata: {},
    };

    return { output: parsed, context };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      output: { ...EMPTY_CONSULT_OUTPUT },
      context: {
        userMessage: params.character.name,
        character: params.character,
        emotionState: params.emotionState,
        affinity: params.affinity,
        stageSetId: params.composition.id,
        completedStages: [],
        metadata: {},
        error: errorMsg,
      },
    };
  }
}

/**
 * 智能判断：是否需要走完整思维链
 * 短消息/简单问候 → 跳过
 */
export function shouldUseFullCognitive(
  userMessage: string,
  affinityStage: string,
): boolean {
  // 短消息（纯语气词/问候）
  const shortPatterns = /^(嗯|哦|啊|哈|嗯嗯|哈哈|呵呵|嘿嘿|哦哦|早|晚安|好的|好哒|好的吧|行|ok|okay|fine|nb|确实|确实|对|对的|是|是的|好|来了|在|在的)$/i;
  if (shortPatterns.test(userMessage.trim())) return false;

  // 🆕 超短消息（1~2 字）：即使关系亲密也走轻量路径。
  // 推理模型（Nemotron 等）在长上下文 + 极短输入下容易发散思考、耗尽 max_tokens
  // 导致 content=null（如只输出 "The" 就被截断），超短消息没有深入内省的必要。
  if (userMessage.trim().length <= 2) return false;

  // 带情绪关键词
  const hasEmotionKeyword = /开心|难过|生气|害怕|喜欢|讨厌|累|哭|笑|孤单|担心|焦虑|伤心|失望|烦|无聊|辛苦|累死|崩溃|感动|惊喜|紧张|慌/.test(userMessage);

  // 长消息
  const isLong = userMessage.length > 30;

  // 关系密切
  const isClose = ['familiar', 'favorable', 'friendly', 'close', 'affectionate', 'deep_love', 'devoted', 'undying'].includes(affinityStage);

  return hasEmotionKeyword || isLong || isClose;
}
