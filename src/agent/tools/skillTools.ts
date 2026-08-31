/**
 * ============================================================
 * Agent 工具集 - 技能创建
 * AI 可通过对话创建、修改、删除技能
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { useSkillsStore, type ChatSkill, type SkillTriggerType } from '../../store/skillsStore';

// ===== 1. 创建技能 =====
export const skillCreateTool: AgentTool = {
  id: 'skill_create',
  name: '创建技能',
  description: '通过对话创建一个新技能（prompt 注入 / 行为指引），可被对话触发或手动调用',
  category: 'skill',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'name',
      type: 'string',
      description: '技能名称',
      required: true,
    },
    {
      name: 'description',
      type: 'string',
      description: '技能描述',
      required: true,
    },
    {
      name: 'trigger',
      type: 'string',
      description: '触发方式: auto(自动注入) / keyword(关键词触发) / manual(手动)',
      required: true,
      enum: ['auto', 'keyword', 'manual'],
    },
    {
      name: 'prompt',
      type: 'string',
      description: '技能 prompt 内容（注入到 system prompt 中的行为指引）',
      required: true,
    },
    {
      name: 'keywords',
      type: 'string',
      description: '关键词列表（逗号分隔），trigger=keyword 时生效',
      required: false,
    },
    {
      name: 'enabled',
      type: 'boolean',
      description: '是否启用',
      required: false,
      default: true,
    },
    {
      name: 'priority',
      type: 'number',
      description: '优先级（数字越大越先执行）',
      required: false,
      default: 50,
    },
  ],
  execute: async (params) => {
    const keywords = params.keywords
      ? (params.keywords as string).split(',').map((k) => k.trim()).filter(Boolean)
      : [];

    const skill: Omit<ChatSkill, 'id' | 'createdAt' | 'stats'> = {
      name: params.name as string,
      description: params.description as string,
      enabled: typeof params.enabled === 'boolean' ? params.enabled : true,
      trigger: params.trigger as SkillTriggerType,
      keywords,
      prompt: params.prompt as string,
      priority: (params.priority as number) || 50,
    };

    useSkillsStore.getState().addSkill(skill);

    return {
      success: true,
      message: `技能 "${skill.name}" 已创建${skill.enabled ? '并启用' : ''}`,
    };
  },
};

// ===== 2. 修改技能 =====
export const skillUpdateTool: AgentTool = {
  id: 'skill_update',
  name: '修改技能',
  description: '修改已有技能的配置、prompt 内容、触发条件等',
  category: 'skill',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: '技能 ID',
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
      name: 'trigger',
      type: 'string',
      description: '新触发方式',
      required: false,
      enum: ['auto', 'keyword', 'manual'],
    },
    {
      name: 'prompt',
      type: 'string',
      description: '新 prompt 内容',
      required: false,
    },
    {
      name: 'keywords',
      type: 'string',
      description: '新关键词列表（逗号分隔）',
      required: false,
    },
    {
      name: 'enabled',
      type: 'boolean',
      description: '是否启用',
      required: false,
    },
  ],
  execute: async (params) => {
    const id = params.id as string;
    const patch: Partial<ChatSkill> = {};

    if (params.name) patch.name = params.name as string;
    if (params.description) patch.description = params.description as string;
    if (params.trigger) patch.trigger = params.trigger as SkillTriggerType;
    if (params.prompt) patch.prompt = params.prompt as string;
    if (params.keywords) {
      patch.keywords = (params.keywords as string).split(',').map((k) => k.trim()).filter(Boolean);
    }
    if (typeof params.enabled === 'boolean') patch.enabled = params.enabled;

    useSkillsStore.getState().updateSkill(id, patch);
    return { success: true, message: `技能 "${id}" 已更新` };
  },
};

// ===== 3. 删除技能 =====
export const skillDeleteTool: AgentTool = {
  id: 'skill_delete',
  name: '删除技能',
  description: '删除一个技能',
  category: 'skill',
  permissionLevel: 'high',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: '技能 ID',
      required: true,
    },
  ],
  execute: async (params) => {
    const id = params.id as string;
    useSkillsStore.getState().removeSkill(id);
    return { success: true, message: `技能 "${id}" 已删除` };
  },
};

// ===== 4. 列出所有技能 =====
export const skillListTool: AgentTool = {
  id: 'skill_list',
  name: '列出技能',
  description: '列出所有已创建的技能及其状态',
  category: 'skill',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const skills = useSkillsStore.getState().skills;
    return {
      success: true,
      data: skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        trigger: s.trigger,
        keywords: s.keywords,
        enabled: s.enabled,
        promptLength: s.prompt.length,
        priority: s.priority,
        uses: s.stats?.uses ?? 0,
        createdAt: new Date(s.createdAt).toLocaleString(),
      })),
      message: `共 ${skills.length} 个技能`,
    };
  },
};

// ===== 5. 激活/停用技能 =====
export const skillToggleTool: AgentTool = {
  id: 'skill_toggle',
  name: '激活/停用技能',
  description: '在当前对话中激活或停用指定技能',
  category: 'skill',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'name',
      type: 'string',
      description: '技能名称',
      required: true,
    },
    {
      name: 'active',
      type: 'boolean',
      description: 'true=激活, false=停用',
      required: true,
    },
  ],
  execute: async (params) => {
    const name = params.name as string;
    const active = params.active as boolean;
    const store = useSkillsStore.getState();

    if (active) {
      store.toggleActiveSkill(name);
    } else {
      store.toggleActiveSkill(name);
    }

    return { success: true, message: `技能 "${name}" 已${active ? '激活' : '停用'}` };
  },
};

export const skillTools: AgentTool[] = [
  skillCreateTool,
  skillUpdateTool,
  skillDeleteTool,
  skillListTool,
  skillToggleTool,
];
