/**
 * 数据备份 Agent 工具
 */
import type { AgentTool } from '../../types/agent';
import { useBackupStore } from '../../store/backupStore';
import { useDebugLog } from '../../store/debugLogStore';

export const backupTools: AgentTool[] = [
  {
    id: 'backup_list',
    name: '列出备份',
    description: '获取所有备份列表',
    category: 'system',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      const { backups } = useBackupStore.getState();
      return {
        success: true,
        message: `共 ${backups.length} 个备份`,
        data: backups.map(b => ({ id: b.id, label: b.label, createdAt: b.createdAt, sizeBytes: b.sizeBytes })),
      };
    },
  },
  {
    id: 'backup_create',
    name: '创建备份',
    description: '立即创建一个新的数据备份',
    category: 'system',
    permissionLevel: 'high',
    executionSite: 'frontend',
    parameters: [
      { name: 'label', type: 'string', description: '备份名称（可选）', required: false },
    ],
    execute: async (params) => {
      try {
        await useBackupStore.getState().createBackup(params.label as string | undefined);
        useDebugLog.getState().add('system', `[备份] 创建备份成功`);
        return { success: true, message: '备份创建成功' };
      } catch (err) {
        return { success: false, error: `备份创建失败: ${err}` };
      }
    },
  },
  {
    id: 'backup_delete',
    name: '删除备份',
    description: '删除指定的备份',
    category: 'system',
    permissionLevel: 'high',
    executionSite: 'frontend',
    parameters: [
      { name: 'backupId', type: 'string', description: '备份 ID', required: true },
    ],
    execute: async (params) => {
      try {
        await useBackupStore.getState().hardDeleteBackup(params.backupId as string);
        useDebugLog.getState().add('system', `[备份] 删除备份`);
        return { success: true, message: '备份已删除' };
      } catch (err) {
        return { success: false, error: `删除失败: ${err}` };
      }
    },
  },
  {
    id: 'backup_restore',
    name: '恢复备份',
    description: '从指定备份恢复数据',
    category: 'system',
    permissionLevel: 'high',
    executionSite: 'frontend',
    parameters: [
      { name: 'backupId', type: 'string', description: '备份 ID', required: true },
    ],
    execute: async (params) => {
      try {
        await useBackupStore.getState().restoreBackup(params.backupId as string);
        useDebugLog.getState().add('system', `[备份] 恢复备份成功`);
        return { success: true, message: '备份恢复成功' };
      } catch (err) {
        return { success: false, error: `恢复失败: ${err}` };
      }
    },
  },
  {
    id: 'backup_config',
    name: '备份配置',
    description: '查看或更新自动备份配置',
    category: 'system',
    permissionLevel: 'medium',
    executionSite: 'frontend',
    parameters: [
      { name: 'enabled', type: 'boolean', description: '是否开启自动备份', required: false },
      { name: 'maxBackups', type: 'number', description: '最大保留备份数', required: false },
    ],
    execute: async (params) => {
      const store = useBackupStore.getState();
      const updates: Record<string, unknown> = {};
      if (params.enabled !== undefined) updates.enabled = params.enabled;
      if (params.maxBackups !== undefined) updates.maxBackups = params.maxBackups;
      if (Object.keys(updates).length > 0) store.updateConfig(updates as Partial<typeof store.config>);
      const config = useBackupStore.getState().config;
      return {
        success: true,
        message: `自动备份: ${config.enabled ? '开启' : '关闭'}, 最大: ${config.maxBackups}`,
        data: config,
      };
    },
  },
];
