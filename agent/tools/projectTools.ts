/**
 * ============================================================
 * Agent 工具集 - 项目全内容控制
 * 会话管理 / 接入管理 / 日志管理 / Pipeline V2 开关
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { useChatStore } from '../../store/chatStore';
import { useCharacterStore } from '../../store/characterStore';
import { useIntegrationStore } from '../../store/integrationStore';
import { useDebugLog } from '../../store/debugLogStore';
import { useConfigStore } from '../../store/configStore';
import { dbClearDebugLogs } from '../../lib/tauriBridge';

// ===== 1. 切换会话 =====
const conversationSwitchTool: AgentTool = {
  id: 'conversation_switch',
  name: '切换会话',
  description: '切换到指定会话（支持会话 ID 或标题关键词模糊匹配）',
  category: 'chat',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    { name: 'query', type: 'string', description: '会话 ID 或标题关键词', required: true },
  ],
  execute: async (params) => {
    const query = String(params.query ?? '').trim();
    if (!query) return { success: false, error: '缺少 query 参数' };
    const { conversations, setCurrentConversation } = useChatStore.getState();
    const target =
      conversations.find((c) => c.id === query) ??
      conversations.find((c) => c.title?.includes(query)) ??
      conversations.find((c) => c.characterId === query);
    if (!target) {
      return { success: false, error: `未找到匹配「${query}」的会话（共 ${conversations.length} 个）` };
    }
    await setCurrentConversation(target.id);
    return { success: true, message: `已切换到会话「${target.title || target.id}」`, data: { id: target.id, title: target.title } };
  },
};

// ===== 2. 新建会话 =====
const conversationCreateTool: AgentTool = {
  id: 'conversation_create',
  name: '新建会话',
  description: '为指定角色新建会话（支持角色 ID 或名称模糊匹配；该角色已有会话时自动复用）',
  category: 'chat',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    { name: 'character', type: 'string', description: '角色 ID 或角色名称关键词', required: true },
  ],
  execute: async (params) => {
    const query = String(params.character ?? '').trim();
    if (!query) return { success: false, error: '缺少 character 参数' };
    const chars = useCharacterStore.getState().characters || [];
    const character =
      chars.find((c) => c.id === query) ??
      chars.find((c) => c.name === query) ??
      chars.find((c) => c.name?.includes(query));
    if (!character) {
      return { success: false, error: `未找到角色「${query}」，可用角色: ${chars.map((c) => c.name).join('、')}` };
    }
    const id = useChatStore.getState().createNewConversation(character.id);
    return { success: true, message: `已为「${character.name}」创建/复用会话 ${id}`, data: { conversationId: id, characterId: character.id } };
  },
};

// ===== 3. 删除会话 =====
const conversationDeleteTool: AgentTool = {
  id: 'conversation_delete',
  name: '删除会话',
  description: '彻底删除指定会话（含全部消息，同步删除数据库记录，不可恢复）',
  category: 'chat',
  permissionLevel: 'high',
  executionSite: 'frontend',
  parameters: [
    { name: 'query', type: 'string', description: '会话 ID 或标题关键词', required: true },
  ],
  execute: async (params) => {
    const query = String(params.query ?? '').trim();
    if (!query) return { success: false, error: '缺少 query 参数' };
    const { conversations, deleteConversation } = useChatStore.getState();
    const target =
      conversations.find((c) => c.id === query) ??
      conversations.find((c) => c.title?.includes(query));
    if (!target) return { success: false, error: `未找到会话「${query}」` };
    const msgCount = target.messages?.length ?? 0;
    deleteConversation(target.id);
    useDebugLog.getState().add('system', `[Agent] 已删除会话「${target.title || target.id}」（${msgCount} 条消息）`);
    return { success: true, message: `已删除会话「${target.title || target.id}」（${msgCount} 条消息）` };
  },
};

// ===== 4. 列出接入 =====
const integrationListTool: AgentTool = {
  id: 'integration_list',
  name: '列出接入',
  description: '列出所有机器人接入（QQ/微信等）及其启用状态',
  category: 'system',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const store = useIntegrationStore.getState();
    if (!store.isLoaded) await store.loadIntegrations();
    const list = useIntegrationStore.getState().integrations;
    return {
      success: true,
      data: list.map((i) => ({ id: i.id, type: i.type, enabled: i.enabled })),
      message: list.length ? `共 ${list.length} 个接入` : '暂无接入',
    };
  },
};

// ===== 5. 启用/禁用接入 =====
const integrationToggleTool: AgentTool = {
  id: 'integration_toggle',
  name: '启停接入',
  description: '启用或禁用指定机器人接入（按 ID 或平台类型匹配）',
  category: 'system',
  permissionLevel: 'high',
  executionSite: 'frontend',
  parameters: [
    { name: 'query', type: 'string', description: '接入 ID 或平台类型（如 qq / clawbot）', required: true },
    { name: 'enabled', type: 'boolean', description: 'true=启用 false=禁用；不填则取反', required: false },
  ],
  execute: async (params) => {
    const query = String(params.query ?? '').trim();
    const store = useIntegrationStore.getState();
    if (!store.isLoaded) await store.loadIntegrations();
    const list = useIntegrationStore.getState().integrations;
    const target = list.find((i) => i.id === query) ?? list.find((i) => i.type?.toLowerCase() === query.toLowerCase());
    if (!target) return { success: false, error: `未找到接入「${query}」` };
    const next = typeof params.enabled === 'boolean' ? params.enabled : !target.enabled;
    if (next !== target.enabled) {
      await useIntegrationStore.getState().toggleIntegration(target.id);
    }
    useDebugLog.getState().add('system', `[Agent] 接入 ${target.type} 已${next ? '启用' : '禁用'}`);
    return { success: true, message: `接入 ${target.type} 已${next ? '启用' : '禁用'}` };
  },
};

// ===== 6. 日志统计 =====
const logStatsTool: AgentTool = {
  id: 'log_stats',
  name: '日志统计',
  description: '查看调试日志总数（数据库总量）与当前已加载数量',
  category: 'system',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const { totalCount, logs, hasMore } = useDebugLog.getState();
    return {
      success: true,
      data: { totalCount, loadedCount: logs.length, hasMore },
      message: `日志总量 ${totalCount} 条（已加载 ${logs.length} 条${hasMore ? '，还有更多' : ''}）`,
    };
  },
};

// ===== 7. 清空日志 =====
const logClearTool: AgentTool = {
  id: 'log_clear',
  name: '清空日志',
  description: '清空全部调试日志（内存 + 数据库，不可恢复）',
  category: 'system',
  permissionLevel: 'high',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const { totalCount } = useDebugLog.getState();
    try {
      await dbClearDebugLogs();
    } catch (e) {
      return { success: false, error: `数据库清理失败: ${e}` };
    }
    useDebugLog.getState().clear();
    return { success: true, message: `已清空全部日志（${totalCount} 条）` };
  },
};

// ===== 8. 读取 Pipeline V2 配置 =====
const pipelineGetTool: AgentTool = {
  id: 'pipeline_get',
  name: '读取Pipeline配置',
  description: '读取 Pipeline V2 / 系统 V2 配置（分段、情绪、记忆、自学习、拦截等全部开关）',
  category: 'settings',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    { name: 'key', type: 'string', description: '配置键名（不填返回全部）', required: false },
  ],
  execute: async (params) => {
    const v2 = useConfigStore.getState().v2Config as unknown as Record<string, unknown>;
    const key = params.key ? String(params.key) : '';
    if (key && !(key in v2)) {
      return { success: false, error: `未知配置键「${key}」，可用键: ${Object.keys(v2).join(', ')}` };
    }
    const data = key ? { [key]: v2[key] } : v2;
    return { success: true, data, message: key ? `${key} = ${JSON.stringify(v2[key])}` : '已返回全部 V2 配置' };
  },
};

// ===== 9. 修改 Pipeline V2 配置 =====
const pipelineSetTool: AgentTool = {
  id: 'pipeline_set',
  name: '修改Pipeline配置',
  description: '修改 Pipeline V2 配置项。传 JSON 对象批量修改，如 {"blockCliche": true, "duplicateThreshold": 0.9}',
  category: 'settings',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    { name: 'patch', type: 'string', description: 'JSON 格式的配置补丁对象', required: true },
  ],
  execute: async (params) => {
    let patch: Record<string, unknown>;
    try {
      patch = typeof params.patch === 'string' ? JSON.parse(params.patch) : (params.patch as Record<string, unknown>);
    } catch {
      return { success: false, error: 'patch 必须是合法 JSON 对象' };
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return { success: false, error: 'patch 必须是 JSON 对象' };
    }
    useConfigStore.getState().setV2Config(patch);
    useDebugLog.getState().add('system', `[Agent] 已更新 V2 配置: ${JSON.stringify(patch)}`);
    return { success: true, message: `已更新 ${Object.keys(patch).length} 项 V2 配置`, data: patch };
  },
};

export const projectTools: AgentTool[] = [
  conversationSwitchTool,
  conversationCreateTool,
  conversationDeleteTool,
  integrationListTool,
  integrationToggleTool,
  logStatsTool,
  logClearTool,
  pipelineGetTool,
  pipelineSetTool,
];
