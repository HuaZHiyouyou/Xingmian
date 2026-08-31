/**
 * ============================================================
 * Agent 工具集 - MBTI 性格分析
 * AI 可读取用户 MBTI 结果、触发测试、查询历史
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { useMbtiStore, TOTAL_QUESTIONS } from '../../store/mbtiStore';

// MBTI 类型中文描述
const MBTI_DESCRIPTIONS: Record<string, string> = {
  INTJ: '建筑师 - 富有想象力和战略性的思考者',
  INTP: '逻辑学家 - 具有创造力的发明家',
  ENTJ: '指挥官 - 大胆富有想象力的领导者',
  ENTP: '辩论家 - 机敏好奇的思想家',
  INFJ: '提倡者 - 安静而神秘的理想主义者',
  INFP: '调停者 - 诗意善良的利他主义者',
  ENFJ: '主人公 - 富有魅力鼓舞人心的领导者',
  ENFP: '竞选者 - 热情有创造力的社交达人',
  ISTJ: '物流师 - 实际且注重事实的个人',
  ISFJ: '守卫者 - 非常专注且温暖的守护者',
  ESTJ: '总经理 - 出色的管理者',
  ESFJ: '执政官 - 极有同情心的社交达人',
  ISTP: '鉴赏家 - 大胆而实际的实验家',
  ISFP: '探险家 - 灵活而有魅力的艺术家',
  ESTP: '企业家 - 聪明精力充沛的感知者',
  ESFP: '表演者 - 自发的精力充沛的表演者',
};

// ===== 1. 读取 MBTI 结果 =====
export const mbtiGetResultTool: AgentTool = {
  id: 'mbti_get_result',
  name: '获取MBTI结果',
  description: '获取用户当前的 MBTI 性格测试结果，包含类型、维度分数和测试时间',
  category: 'memory',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const { result, isCompleted } = useMbtiStore.getState();
    if (!isCompleted || !result) {
      return {
        success: true,
        data: { hasResult: false },
        message: '用户尚未完成 MBTI 测试',
      };
    }
    return {
      success: true,
      data: {
        hasResult: true,
        type: result.type,
        description: MBTI_DESCRIPTIONS[result.type] || '未知类型',
        dimensions: result.dimensions,
        completedAt: result.completedAt.toISOString(),
      },
      message: `用户 MBTI 类型: ${result.type} - ${MBTI_DESCRIPTIONS[result.type] || ''}`,
    };
  },
};

// ===== 2. 获取 MBTI 历史 =====
export const mbtiGetHistoryTool: AgentTool = {
  id: 'mbti_get_history',
  name: '获取MBTI历史',
  description: '获取用户所有的 MBTI 测试历史记录',
  category: 'memory',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const { history } = useMbtiStore.getState();
    return {
      success: true,
      data: history.map((h) => ({
        id: h.id,
        type: h.type,
        dimensions: h.dimensions,
        completedAt: h.completedAt.toISOString(),
      })),
      message: `共 ${history.length} 条 MBTI 测试记录`,
    };
  },
};

// ===== 3. 查询 MBTI 类型描述 =====
export const mbtiDescribeTool: AgentTool = {
  id: 'mbti_describe',
  name: '查询MBTI描述',
  description: '查询指定 MBTI 类型的详细描述和特征',
  category: 'memory',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: 'MBTI 类型，如 INTJ、ENFP 等',
      required: true,
      enum: [
        'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
        'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP',
      ],
    },
  ],
  execute: async (params) => {
    const type = params.type as string;
    const validTypes = Object.keys(MBTI_DESCRIPTIONS);
    if (!validTypes.includes(type)) {
      return { success: false, error: `无效的 MBTI 类型: ${type}` };
    }
    return {
      success: true,
      data: {
        type,
        description: MBTI_DESCRIPTIONS[type],
      },
      message: `${type}: ${MBTI_DESCRIPTIONS[type]}`,
    };
  },
};

// ===== 4. 重置测试 =====
export const mbtiResetTestTool: AgentTool = {
  id: 'mbti_reset_test',
  name: '重置MBTI测试',
  description: '重置用户的 MBTI 测试，清除当前结果',
  category: 'memory',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    useMbtiStore.getState().resetTest();
    return {
      success: true,
      message: 'MBTI 测试已重置，用户可重新进行测试',
    };
  },
};

// ===== 5. 获取测试进度 =====
export const mbtiGetProgressTool: AgentTool = {
  id: 'mbti_get_progress',
  name: '获取MBTI测试进度',
  description: '获取当前 MBTI 测试的答题进度',
  category: 'memory',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const { currentQuestion, questions, isCompleted, answers } = useMbtiStore.getState();
    const answered = Object.keys(answers).length;
    return {
      success: true,
      data: {
        isCompleted,
        currentQuestion,
        totalQuestions: questions.length || TOTAL_QUESTIONS,
        answeredCount: answered,
        progress: Math.round((answered / TOTAL_QUESTIONS) * 100),
      },
      message: isCompleted
        ? '测试已完成'
        : `当前进度: ${answered}/${TOTAL_QUESTIONS} (${Math.round((answered / TOTAL_QUESTIONS) * 100)}%)`,
    };
  },
};

export const mbtiTools: AgentTool[] = [
  mbtiGetResultTool,
  mbtiGetHistoryTool,
  mbtiDescribeTool,
  mbtiResetTestTool,
  mbtiGetProgressTool,
];
