/**
 * 学习系统 Agent 工具
 */
import type { AgentTool } from '../../types/agent';
import { useLearningStore } from '../../store/learningStore';
import { useLearningConfigStore } from '../../store/learningConfigStore';
import { useCharacterStore } from '../../store/characterStore';
import { useDebugLog } from '../../store/debugLogStore';

export const learningTools: AgentTool[] = [
  {
    id: 'learning_status',
    name: '学习状态',
    description: '获取 AI 学习系统的当前状态',
    category: 'learning',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      const config = useLearningConfigStore.getState().config;
      const profiles = useLearningStore.getState().profiles;
      const charId = useCharacterStore.getState().selectedCharacterId;
      const profile = charId ? useLearningStore.getState().getProfile(charId) : null;
      return {
        success: true,
        message: `学习系统: ${config.enabled ? '开启' : '关闭'}, 已学习 ${Object.keys(profiles).length} 个角色`,
        data: {
          enabled: config.enabled,
          scheduledEnabled: config.scheduledEnabled,
          intervalMinutes: config.scheduledIntervalMinutes,
          currentVocab: profile?.vocabulary.length ?? 0,
          currentPhrases: profile?.phrases.length ?? 0,
        },
      };
    },
  },
  {
    id: 'learning_toggle',
    name: '开关学习系统',
    description: '开启或关闭 AI 自主学习功能',
    category: 'learning',
    permissionLevel: 'medium',
    executionSite: 'frontend',
    parameters: [
      { name: 'enabled', type: 'boolean', description: 'true=开启，false=关闭', required: true },
    ],
    execute: async (params) => {
      useLearningConfigStore.getState().updateConfig({ enabled: params.enabled as boolean });
      useDebugLog.getState().add('system', `[学习] ${params.enabled ? '开启' : '关闭'}自主学习`);
      return { success: true, message: `学习系统已${params.enabled ? '开启' : '关闭'}` };
    },
  },
  {
    id: 'learning_set_interval',
    name: '设置学习间隔',
    description: '设置 AI 自主学习的时间间隔（分钟）',
    category: 'learning',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [
      { name: 'interval', type: 'number', description: '学习间隔（分钟），最小5', required: true },
    ],
    execute: async (params) => {
      const interval = Math.max(5, Math.round(params.interval as number));
      useLearningConfigStore.getState().updateConfig({ scheduledIntervalMinutes: interval });
      useDebugLog.getState().add('system', `[学习] 设置学习间隔: ${interval} 分钟`);
      return { success: true, message: `学习间隔已设为 ${interval} 分钟` };
    },
  },
  {
    id: 'learning_view_profile',
    name: '查看学习档案',
    description: '查看当前角色的学习档案',
    category: 'learning',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      const charId = useCharacterStore.getState().selectedCharacterId;
      if (!charId) return { success: false, error: '未选择角色' };
      const profile = useLearningStore.getState().getProfile(charId);
      return {
        success: true,
        message: `词汇: ${profile.vocabulary.length} 个, 表达: ${profile.phrases.length} 个`,
        data: {
          vocabulary: profile.vocabulary.slice(0, 20),
          phrases: profile.phrases.slice(0, 15),
          lastUpdated: profile.lastUpdated,
        },
      };
    },
  },
];
