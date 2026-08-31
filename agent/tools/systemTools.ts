/**
 * ============================================================
 * Agent 工具集 - 系统操作
 * AI 可执行系统级操作
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { useAgentStore } from '../../store/agentStore';

// ===== 1. Agent 状态 =====
export const systemAgentInfoTool: AgentTool = {
  id: 'system_agent_info',
  name: 'Agent 信息',
  description: '获取 Agent 系统的当前状态、已注册工具数、会话数等信息',
  category: 'system',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const store = useAgentStore.getState();
    const tools = store.getAllTools();
    const categories = [...new Set(tools.map((t) => t.category))];
    return {
      success: true,
      data: {
        enabled: store.config.enabled,
        permissionMode: store.config.permissionMode,
        toolCount: tools.length,
        categories,
        sessionCount: store.sessions.length,
        currentSessionId: store.currentSessionId,
        messageCount: store.getCurrentSession()?.messages.length ?? 0,
      },
      message: `Agent 系统运行中，已注册 ${tools.length} 个工具`,
    };
  },
};

// ===== 2. 获取所有可用工具 =====
export const systemToolListTool: AgentTool = {
  id: 'system_tool_list',
  name: '列出所有工具',
  description: '列出所有已注册的 Agent 工具及其说明',
  category: 'system',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const tools = useAgentStore.getState().getAllTools();
    return {
      success: true,
      data: tools.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        permission: t.permissionLevel,
        paramCount: t.parameters.length,
      })),
      message: `共 ${tools.length} 个可用工具`,
    };
  },
};

// ===== 3. 执行工具（通过 ID 和 JSON 参数） =====
export const systemExecuteTool: AgentTool = {
  id: 'system_execute',
  name: '执行工具',
  description: '通过工具 ID 和 JSON 参数执行任意已注册的工具',
  category: 'system',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'toolId',
      type: 'string',
      description: '要执行的工具 ID',
      required: true,
    },
    {
      name: 'params',
      type: 'string',
      description: 'JSON 格式的参数',
      required: false,
      default: '{}',
    },
  ],
  execute: async (params) => {
    const toolId = params.toolId as string;
    let toolParams: Record<string, unknown> = {};

    if (params.params) {
      try {
        toolParams = JSON.parse(params.params as string);
      } catch {
        return { success: false, error: '参数 JSON 格式错误' };
      }
    }

    const result = await useAgentStore.getState().executeTool(toolId, toolParams);
    return result;
  },
};

// ===== 4. 对话式创建指令生成 =====
export const systemGenerateTool: AgentTool = {
  id: 'system_generate',
  name: '生成内容',
  description: '让 Agent 根据描述生成插件代码、技能 prompt、角色设定等内容',
  category: 'system',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: '生成类型',
      required: true,
      enum: ['plugin_code', 'skill_prompt', 'character_prompt', 'system_prompt'],
    },
    {
      name: 'description',
      type: 'string',
      description: '功能描述/需求说明',
      required: true,
    },
  ],
  execute: async (params) => {
    const type = params.type as string;
    const desc = params.description as string;

    // 这些是模板指引，AI 会根据这些模板来生成内容
    const templates: Record<string, string> = {
      plugin_code: `请根据以下需求生成一个插件的 hook 配置:\n需求: ${desc}\n\n生成的插件应包含:\n1. beforePrompt: 在 system prompt 构建后注入的指令\n2. beforeSend: 用户消息发送前的处理\n3. afterReply: AI 回复后的处理\n4. onTick: 定时触发的处理`,
      skill_prompt: `请根据以下需求生成一个技能的 prompt 内容:\n需求: ${desc}\n\n生成的 prompt 应:\n1. 明确行为指引\n2. 具体可操作\n3. 语气清晰`,
      character_prompt: `请根据以下需求生成一个角色的系统提示词:\n需求: ${desc}\n\n生成的提示词应定义:\n1. 人格特征\n2. 说话风格\n3. 行为模式\n4. 情感表达方式`,
      system_prompt: `请根据以下需求生成 system prompt:\n需求: ${desc}`,
    };

    return {
      success: true,
      data: { template: templates[type] || '未知类型', type, description: desc },
      message: `已生成 ${type} 模板，请根据模板内容创建实际内容`,
    };
  },
};

export const systemTools: AgentTool[] = [
  systemAgentInfoTool,
  systemToolListTool,
  systemExecuteTool,
  systemGenerateTool,
];
