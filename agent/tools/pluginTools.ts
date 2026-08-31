/**
 * ============================================================
 * Agent 工具集 - 插件创建
 * AI 可通过对话创建、修改、删除插件
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { usePluginStore, type ChatPlugin, type PluginMode } from '../../store/pluginStore';

// ===== 1. 创建插件 =====
export const pluginCreateTool: AgentTool = {
  id: 'plugin_create',
  name: '创建插件',
  description: '通过对话创建一个自定义插件，支持 3 种运行模式和 4 个钩子。AI 可根据用户描述生成完整的插件配置。',
  category: 'plugin',
  permissionLevel: 'high',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'name',
      type: 'string',
      description: '插件名称',
      required: true,
    },
    {
      name: 'description',
      type: 'string',
      description: '插件描述',
      required: true,
    },
    {
      name: 'mode',
      type: 'string',
      description: '运行模式: standalone(单独运行) / parallel(并行) / cooperative(合作)',
      required: true,
      enum: ['standalone', 'parallel', 'cooperative'],
    },
    {
      name: 'beforePrompt',
      type: 'string',
      description: 'beforePrompt 钩子: 在 system prompt 构建后注入的指令/内容',
      required: false,
    },
    {
      name: 'beforeSend',
      type: 'string',
      description: 'beforeSend 钩子: 用户消息发送前的处理指令',
      required: false,
    },
    {
      name: 'afterReply',
      type: 'string',
      description: 'afterReply 钩子: AI 回复生成后的处理指令',
      required: false,
    },
    {
      name: 'onTick',
      type: 'string',
      description: 'onTick 钩子: 定时触发的处理指令',
      required: false,
    },
    {
      name: 'replaceDefault',
      type: 'boolean',
      description: '是否替代默认设定（仅 standalone 模式有效）',
      required: false,
      default: false,
    },
  ],
  execute: async (params) => {
    const hookConfig: Record<string, string> = {};
    if (params.beforePrompt) hookConfig.beforePrompt = params.beforePrompt as string;
    if (params.beforeSend) hookConfig.beforeSend = params.beforeSend as string;
    if (params.afterReply) hookConfig.afterReply = params.afterReply as string;
    if (params.onTick) hookConfig.onTick = params.onTick as string;

    const pluginData = {
      name: params.name as string,
      version: '1.0.0',
      description: params.description as string,
      enabled: true,
      mode: params.mode as PluginMode,
      replaceDefault: (params.replaceDefault as boolean) || false,
      priority: 50,
      hookConfig: Object.keys(hookConfig).length > 0 ? hookConfig as ChatPlugin['hookConfig'] : undefined,
    };

    usePluginStore.getState().addPlugin(pluginData);

    return {
      success: true,
      data: pluginData,
      message: `插件 "${pluginData.name}" 已创建并启用`,
    };
  },
};

// ===== 2. 修改插件 =====
export const pluginUpdateTool: AgentTool = {
  id: 'plugin_update',
  name: '修改插件',
  description: '修改已有插件的配置、钩子内容、运行模式等',
  category: 'plugin',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: '插件 ID',
      required: true,
    },
    {
      name: 'name',
      type: 'string',
      description: '新名称',
      required: false,
    },
    {
      name: 'description',
      type: 'string',
      description: '新描述',
      required: false,
    },
    {
      name: 'mode',
      type: 'string',
      description: '新运行模式',
      required: false,
      enum: ['standalone', 'parallel', 'cooperative'],
    },
    {
      name: 'enabled',
      type: 'boolean',
      description: '是否启用',
      required: false,
    },
    {
      name: 'beforePrompt',
      type: 'string',
      description: '更新 beforePrompt 钩子',
      required: false,
    },
    {
      name: 'beforeSend',
      type: 'string',
      description: '更新 beforeSend 钩子',
      required: false,
    },
    {
      name: 'afterReply',
      type: 'string',
      description: '更新 afterReply 钩子',
      required: false,
    },
    {
      name: 'onTick',
      type: 'string',
      description: '更新 onTick 钩子',
      required: false,
    },
  ],
  execute: async (params) => {
    const id = params.id as string;
    const patch: Partial<ChatPlugin> = {};

    if (params.name) patch.name = params.name as string;
    if (params.description) patch.description = params.description as string;
    if (params.mode) patch.mode = params.mode as PluginMode;
    if (typeof params.enabled === 'boolean') patch.enabled = params.enabled;
    if (params.beforePrompt || params.beforeSend || params.afterReply || params.onTick) {
      patch.hookConfig = {};
      if (params.beforePrompt) patch.hookConfig.beforePrompt = params.beforePrompt as string;
      if (params.beforeSend) patch.hookConfig.beforeSend = params.beforeSend as string;
      if (params.afterReply) patch.hookConfig.afterReply = params.afterReply as string;
      if (params.onTick) patch.hookConfig.onTick = params.onTick as string;
    }

    usePluginStore.getState().updatePlugin(id, patch);
    return { success: true, message: `插件 "${id}" 已更新` };
  },
};

// ===== 3. 删除插件 =====
export const pluginDeleteTool: AgentTool = {
  id: 'plugin_delete',
  name: '删除插件',
  description: '删除一个插件',
  category: 'plugin',
  permissionLevel: 'high',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: '插件 ID',
      required: true,
    },
  ],
  execute: async (params) => {
    const id = params.id as string;
    usePluginStore.getState().removePlugin(id);
    return { success: true, message: `插件 "${id}" 已删除` };
  },
};

// ===== 4. 列出所有插件 =====
export const pluginListTool: AgentTool = {
  id: 'plugin_list',
  name: '列出插件',
  description: '列出所有已创建的插件及其状态',
  category: 'plugin',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const plugins = usePluginStore.getState().plugins;
    return {
      success: true,
      data: plugins.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        mode: p.mode,
        enabled: p.enabled,
        hookCount: Object.keys(p.hookConfig || {}).filter((k) => (p.hookConfig as Record<string, string>)[k]).length,
        runs: p.stats?.runs ?? 0,
        createdAt: new Date(p.createdAt).toLocaleString(),
      })),
      message: `共 ${plugins.length} 个插件`,
    };
  },
};

export const pluginTools: AgentTool[] = [
  pluginCreateTool,
  pluginUpdateTool,
  pluginDeleteTool,
  pluginListTool,
];
