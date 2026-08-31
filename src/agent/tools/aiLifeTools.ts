/**
 * AI 一天 Agent 工具
 */
import type { AgentTool } from '../../types/agent';
import { useDebugLog } from '../../store/debugLogStore';

export const aiLifeTools: AgentTool[] = [
  {
    id: 'ailife_status',
    name: 'AI一天状态',
    description: '获取 AI 日常活动时间线状态',
    category: 'ai',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      useDebugLog.getState().add('system', '[AI一天] 查询状态');
      return {
        success: true,
        message: 'AI 一天模块展示 AI 的日常活动时间线',
        data: { module: 'ai-life', status: 'active' },
      };
    },
  },
  {
    id: 'ailife_navigate',
    name: '打开AI一天',
    description: '导航到 AI 一天页面',
    category: 'ai',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      window.dispatchEvent(new CustomEvent('navigate', { detail: { path: '/ai-life' } }));
      useDebugLog.getState().add('system', '[AI一天] 导航到 AI 一天页面');
      return { success: true, message: '已打开 AI 一天页面' };
    },
  },
];
