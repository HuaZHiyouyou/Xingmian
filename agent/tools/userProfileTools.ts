/**
 * 用户信息 Agent 工具
 */
import type { AgentTool } from '../../types/agent';
import { useUserProfileStore } from '../../store/userProfileStore';
import { useDebugLog } from '../../store/debugLogStore';

export const userProfileTools: AgentTool[] = [
  {
    id: 'user_profile_get',
    name: '获取用户信息',
    description: '获取当前用户的个人资料',
    category: 'system',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      const { profile } = useUserProfileStore.getState();
      if (!profile) return { success: false, error: '未设置用户资料' };
      return {
        success: true,
        message: `昵称: ${profile.nickname || '未设置'}`,
        data: { nickname: profile.nickname, age: profile.age, gender: profile.gender, mbti: profile.mbti },
      };
    },
  },
  {
    id: 'user_profile_update',
    name: '更新用户信息',
    description: '更新当前用户的个人资料',
    category: 'system',
    permissionLevel: 'medium',
    executionSite: 'frontend',
    parameters: [
      { name: 'nickname', type: 'string', description: '昵称', required: false },
      { name: 'age', type: 'string', description: '年龄', required: false },
      { name: 'gender', type: 'string', description: '性别', required: false },
    ],
    execute: async (params) => {
      const store = useUserProfileStore.getState();
      const updates: Record<string, string> = {};
      if (params.nickname) updates.nickname = params.nickname as string;
      if (params.age) updates.age = params.age as string;
      if (params.gender) updates.gender = params.gender as string;
      store.updateProfile(updates as Parameters<typeof store.updateProfile>[0]);
      useDebugLog.getState().add('system', `[用户] 更新资料`);
      return { success: true, message: '用户信息已更新' };
    },
  },
];
