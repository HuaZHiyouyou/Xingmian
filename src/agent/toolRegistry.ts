/**
 * ============================================================
 * Agent 工具注册中心
 * 统一注册所有工具到 Agent Store
 * ============================================================
 */
import { useAgentStore } from '../store/agentStore';
import { settingsTools } from './tools/settingsTools';
import { uiTools } from './tools/uiTools';
import { pluginTools } from './tools/pluginTools';
import { skillTools } from './tools/skillTools';
import { navigationTools } from './tools/navigationTools';
import { characterTools } from './tools/characterTools';
import { chatTools } from './tools/chatTools';
import { systemTools } from './tools/systemTools';
import { mbtiTools } from './tools/mbtiTools';
import { appTools } from './tools/appTools';
import { memoryTools } from './tools/memoryTools';
import { learningTools } from './tools/learningTools';
import { musicTools } from './tools/musicTools';
import { emotionTools } from './tools/emotionTools';
import { backupTools } from './tools/backupTools';
import { userProfileTools } from './tools/userProfileTools';
import { aiLifeTools } from './tools/aiLifeTools';
import { projectTools } from './tools/projectTools';
import { botTools } from './tools/botTools';

let _initialized = false;

/**
 * 初始化注册所有 Agent 工具
 * 应在应用启动时调用一次
 */
export function initializeAgentTools(): void {
  if (_initialized) return;
  _initialized = true;

  const store = useAgentStore.getState();
  store.registerTools([
    // 设置控制
    ...settingsTools,
    // UI 控制
    ...uiTools,
    // 插件管理
    ...pluginTools,
    // 技能管理
    ...skillTools,
    // 导航控制
    ...navigationTools,
    // 角色管理
    ...characterTools,
    // 对话控制
    ...chatTools,
    // 系统操作
    ...systemTools,
    // MBTI 性格分析
    ...mbtiTools,
    // 应用生命周期
    ...appTools,
    // 记忆管理
    ...memoryTools,
    // 学习系统
    ...learningTools,
    // 音乐播放
    ...musicTools,
    // 情感系统
    ...emotionTools,
    // 数据备份
    ...backupTools,
    // 用户信息
    ...userProfileTools,
    // AI 一天
    ...aiLifeTools,
    // 项目全内容控制（会话/接入/日志/Pipeline）
    ...projectTools,
    // Bot 指令（新建对话/当前会话/帮助）
    ...botTools,
  ]);

  console.log(`[Agent] 已注册 ${store.getAllTools().length} 个工具`);
}

/**
 * 获取工具的 JSON Schema（供 AI 模型理解工具参数）
 */
export function getToolsJsonSchema(): Record<string, unknown>[] {
  return useAgentStore.getState().getAllTools().map((tool) => ({
    type: 'function',
    function: {
      name: tool.id,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          tool.parameters.map((p) => [
            p.name,
            {
              type: p.type,
              description: p.description,
              ...(p.enum ? { enum: p.enum } : {}),
              ...(p.default !== undefined ? { default: p.default } : {}),
            },
          ])
        ),
        required: tool.parameters.filter((p) => p.required).map((p) => p.name),
      },
    },
  }));
}

/**
 * 将工具定义转换为 AI prompt 中的工具描述文本
 */
export function getToolsDescriptionForPrompt(): string {
  return useAgentStore.getState().getToolsForPrompt();
}
