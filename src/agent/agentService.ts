/**
 * ============================================================
 * Agent 对话服务
 * 将用户消息发送给 AI，AI 通过 tool_call 调用工具
 * ============================================================
 */
import { useAgentStore } from '../store/agentStore';
import { callAI } from '../services/aiService';
import { getToolsDescriptionForPrompt } from './toolRegistry';
import { MODEL_ROLES } from '../store/modelRoleStore';

/** Agent 使用的消息类型 */
interface AgentAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Agent 系统提示词
 */
const AGENT_SYSTEM_PROMPT = `你是一个全能型 xingmian Agent，可以控制整个应用的一切功能。

## 你的能力

你可以通过调用工具来执行以下操作：

### 设置控制
- 读取/修改应用的所有设置（主题、字体、壁纸、API 配置等）
- 查看所有可配置项及其当前值

### UI 控制
- 切换主题（亮色/暗色/系统）
- 修改壁纸（预设渐变/图片）
- 修改字体大小和样式
- 切换聊天气泡样式
- 切换粒子特效
- 修改强调色

### 插件管理
- 通过对话创建新插件（支持 3 种模式：独立/并行/合作）
- 修改插件的钩子配置（beforePrompt/beforeSend/afterReply/onTick）
- 删除插件
- 查看所有插件

### 技能管理
- 通过对话创建新技能
- 修改技能的 prompt 内容和触发条件
- 激活/停用技能
- 删除技能
- 查看所有技能

### 角色管理
- 创建新角色
- 修改角色的人格设定、系统提示词
- 切换当前活跃角色
- 删除角色

### 对话控制
- 查看所有对话列表
- 查看 AI 记忆系统
- 查看对话统计

### 导航
- 跳转到任意页面

## 工作方式

1. 理解用户的意图
2. 选择合适的工具
3. 提供正确的参数
4. 执行工具并返回结果
5. 用自然语言总结执行结果

## 重要格式要求

当你需要调用工具时，必须使用以下格式：

[TOOL_CALL]工具id:{"参数名":"参数值"}[/TOOL_CALL]

示例：
- 切换暗色主题：[TOOL_CALL]ui_theme:{"theme":"dark"}[/TOOL_CALL]
- 读取设置：[TOOL_CALL]settings_get:{"path":"ui.theme"}[/TOOL_CALL]
- 创建插件：[TOOL_CALL]plugin_create:{"name":"情绪感知","description":"根据用户情绪调整回复","mode":"parallel","afterReply":"分析用户情绪并记录"}[/TOOL_CALL]

一次可以调用多个工具，每个工具调用用单独的 [TOOL_CALL] 标签包裹。

## 注意事项

- 高权限操作（删除、创建）会请求用户确认
- 修改设置前可以先读取当前值
- 创建插件/技能时，根据用户描述生成合理的内容
- 如果用户描述不够清晰，可以先查看当前状态再操作
- 如果不需要调用工具，直接用自然语言回复即可
`;

/**
 * 发送消息给 Agent 并处理工具调用
 */
export async function sendAgentMessage(
  userMessage: string,
  onToolCall?: (toolId: string, params: Record<string, unknown>) => void,
  onToolResult?: (toolId: string, result: { success: boolean; message?: string; error?: string }) => void,
): Promise<string> {
  const store = useAgentStore.getState();

  // 确保有当前会话
  if (!store.currentSessionId) {
    store.createSession();
  }

  // 添加用户消息
  store.addMessage('user', userMessage);

  // 构建消息历史
  const session = store.getCurrentSession();
  if (!session) return '无法创建会话';

  const aiMessages: AgentAIMessage[] = session.messages
    .filter((m) => m.type === 'user' || m.type === 'assistant')
    .map((m) => ({
      role: m.type === 'user' ? 'user' as const : 'assistant' as const,
      content: m.content,
    }));

  const fullSystemPrompt = AGENT_SYSTEM_PROMPT + '\n\n## 可用工具\n\n' + getToolsDescriptionForPrompt();

  try {
    // 调用 AI
    let fullResponse = await callAI(
      aiMessages,
      fullSystemPrompt,
      2000,
      0.7,
      MODEL_ROLES.COGNITIVE,
    );

    // 检查响应中是否包含工具调用
    // 格式: [TOOL_CALL]tool_id:{"param":"value"}[/TOOL_CALL]
    const toolCallRegex = /\[TOOL_CALL\](\w+):\{([\s\S]*?)\}\[\/TOOL_CALL\]/g;
    let match;

    while ((match = toolCallRegex.exec(fullResponse)) !== null) {
      const [, toolId, paramsJson] = match;
      try {
        const params = JSON.parse(`{${paramsJson}}`);
        onToolCall?.(toolId, params);

        const result = await store.executeTool(toolId, params);
        onToolResult?.(toolId, result);

        // 将工具调用和结果记录到消息中
        store.addMessage('tool_call', `执行工具: ${toolId}`, {
          toolId,
          toolName: store.getTool(toolId)?.name ?? toolId,
          params,
          result,
        });
      } catch (err) {
        onToolResult?.(toolId, { success: false, error: String(err) });
      }
    }

    // 清理响应中的工具调用标记
    const processedResponse = fullResponse
      .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, '')
      .trim();

    // 添加助手消息
    store.addMessage('assistant', processedResponse || '(工具已执行完成)');

    return processedResponse;
  } catch (err) {
    const errorMsg = `Agent 执行错误: ${err}`;
    store.addMessage('assistant', errorMsg);
    return errorMsg;
  }
}
