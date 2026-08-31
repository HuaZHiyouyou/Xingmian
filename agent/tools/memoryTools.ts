/**
 * 记忆网络 & 记忆管理 Agent 工具
 */
import type { AgentTool } from '../../types/agent';
import { useMemoryStore } from '../../store/memoryStore';
import { useCharacterStore } from '../../store/characterStore';
import { useDebugLog } from '../../store/debugLogStore';
import type { MemoryEntry } from '../../types';

export const memoryTools: AgentTool[] = [
  {
    id: 'memory_list_entries',
    name: '列出记忆条目',
    description: '获取当前角色的记忆条目列表',
    category: 'memory',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [
      { name: 'tag', type: 'string', description: '按标签筛选', required: false },
      { name: 'limit', type: 'number', description: '返回数量上限，默认20', required: false },
    ],
    execute: async (params) => {
      const charId = useCharacterStore.getState().selectedCharacterId;
      if (!charId) return { success: false, error: '未选择角色' };
      const store = useMemoryStore.getState();
      const entries = store.getEntries(charId);
      const limit = (params.limit as number) ?? 20;
      const filtered = params.tag ? entries.filter(e => e.tags?.includes(params.tag as string)) : entries;
      const sliced = filtered.slice(0, limit);
      useDebugLog.getState().add('system', `[记忆] 列出 ${sliced.length} 条记忆`);
      return {
        success: true,
        message: `共 ${filtered.length} 条记忆（显示前 ${sliced.length} 条）`,
        data: sliced.map(e => ({ id: e.id, content: e.content, category: e.category, tags: e.tags })),
      };
    },
  },
  {
    id: 'memory_add_entry',
    name: '添加记忆',
    description: '为当前角色添加一条新记忆',
    category: 'memory',
    permissionLevel: 'medium',
    executionSite: 'frontend',
    parameters: [
      { name: 'content', type: 'string', description: '记忆内容', required: true },
      { name: 'tags', type: 'string', description: '标签，逗号分隔', required: false },
    ],
    execute: async (params) => {
      const charId = useCharacterStore.getState().selectedCharacterId;
      if (!charId) return { success: false, error: '未选择角色' };
      const tags = params.tags ? (params.tags as string).split(',').map(t => t.trim()) : [];
      const entry: MemoryEntry = {
        id: 'mem-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        characterId: charId,
        conversationId: '',
        content: params.content as string,
        category: 'fact',
        title: (params.content as string).slice(0, 30) || '手动记忆',
        tags,
        importance: 5,
        createdAt: new Date(),
      };
      await useMemoryStore.getState().addEntry(entry);
      useDebugLog.getState().add('system', `[记忆] 新增记忆: ${(params.content as string).slice(0, 30)}...`);
      return { success: true, message: `记忆已添加 (ID: ${entry.id})` };
    },
  },
  {
    id: 'memory_delete_entry',
    name: '删除记忆',
    description: '删除指定的记忆条目',
    category: 'memory',
    permissionLevel: 'high',
    executionSite: 'frontend',
    parameters: [
      { name: 'entryId', type: 'string', description: '记忆条目 ID', required: true },
    ],
    execute: async (params) => {
      useMemoryStore.getState().softDeleteEntry(params.entryId as string);
      useDebugLog.getState().add('system', `[记忆] 已删除记忆: ${params.entryId}`);
      return { success: true, message: `记忆已移至回收站` };
    },
  },
  {
    id: 'memory_analyze',
    name: '记忆分析',
    description: '获取记忆分析统计',
    category: 'memory',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      const charId = useCharacterStore.getState().selectedCharacterId;
      if (!charId) return { success: false, error: '未选择角色' };
      const entries = useMemoryStore.getState().getEntries(charId);
      const tagCounts: Record<string, number> = {};
      entries.forEach(e => e.tags?.forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
      const catCounts: Record<string, number> = {};
      entries.forEach(e => { catCounts[e.category] = (catCounts[e.category] || 0) + 1; });
      return {
        success: true,
        message: `共 ${entries.length} 条记忆`,
        data: { totalEntries: entries.length, categoryDistribution: catCounts, tagDistribution: tagCounts },
      };
    },
  },
];
