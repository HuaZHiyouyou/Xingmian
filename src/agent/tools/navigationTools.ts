/**
 * ============================================================
 * Agent 工具集 - 导航控制
 * AI 可控制页面跳转、路由导航
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';

// ===== 1. 导航到页面 =====
export const navGotoTool: AgentTool = {
  id: 'nav_goto',
  name: '导航到页面',
  description: '跳转到指定页面（聊天、角色、设置、插件、技能等）',
  category: 'navigation',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'page',
      type: 'string',
      description: '目标页面',
      required: true,
      enum: ['chat', 'characters', 'history', 'emotion', 'memory', 'settings', 'api-config', 'plugins', 'skills', 'integrations', 'files', 'feature-module', 'appearance'],
    },
    {
      name: 'conversationId',
      type: 'string',
      description: '对话 ID（仅 chat 页面需要）',
      required: false,
    },
  ],
  execute: async (params) => {
    const page = params.page as string;
    const convId = params.conversationId as string | undefined;

    // 使用浏览器 history API 进行路由跳转
    // 这是 React SPA，通过 hash 路由
    let path = '/';
    switch (page) {
      case 'chat': path = convId ? `/chat/${convId}` : '/chat'; break;
      case 'characters': path = '/characters'; break;
      case 'history': path = '/history'; break;
      case 'emotion': path = '/emotion'; break;
      case 'memory': path = '/memory'; break;
      case 'settings': path = '/settings'; break;
      case 'api-config': path = '/api-config'; break;
      case 'plugins': path = '/plugins'; break;
      case 'skills': path = '/skills'; break;
      case 'integrations': path = '/integrations'; break;
      case 'mcp': path = '/mcp'; break;
      case 'files': path = '/files'; break;
      case 'feature-module': path = '/feature-module'; break;
      case 'appearance': path = '/appearance'; break;
    }

    window.location.hash = path;
    return { success: true, message: `已导航到 ${page}` };
  },
};

export const navigationTools: AgentTool[] = [
  navGotoTool,
];
