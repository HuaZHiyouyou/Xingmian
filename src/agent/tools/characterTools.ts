/**
 * ============================================================
 * Agent 工具集 - 角色管理
 * AI 可创建、修改、切换角色
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { useCharacterStore } from '../../store/characterStore';
import type { Character } from '../../types';

// ===== 1. 创建角色 =====
export const characterCreateTool: AgentTool = {
  id: 'character_create',
  name: '创建角色',
  description: '创建一个新的 AI 角色/伴侣',
  category: 'character',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'name',
      type: 'string',
      description: '角色名称',
      required: true,
    },
    {
      name: 'description',
      type: 'string',
      description: '角色描述/简介',
      required: true,
    },
    {
      name: 'personality',
      type: 'string',
      description: '角色人格描述（定义说话风格、行为模式等）',
      required: false,
    },
    {
      name: 'avatar',
      type: 'string',
      description: '角色头像 URL',
      required: false,
    },
  ],
  execute: async (params) => {
    const char = await useCharacterStore.getState().createCharacter({
      name: params.name as string,
      description: params.description as string,
      personality: (params.personality as string) || '',
      avatar: (params.avatar as string) || '',
    });

    return {
      success: true,
      data: { id: char.id, name: char.name },
      message: `角色 "${char.name}" 已创建`,
    };
  },
};

// ===== 2. 修改角色 =====
export const characterUpdateTool: AgentTool = {
  id: 'character_update',
  name: '修改角色',
  description: '修改已有角色的名称、描述、系统提示词等',
  category: 'character',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: '角色 ID（可选，默认当前选中角色）',
      required: false,
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
      name: 'personality',
      type: 'string',
      description: '新人格描述',
      required: false,
    },
    {
      name: 'avatar',
      type: 'string',
      description: '新头像 URL',
      required: false,
    },
  ],
  execute: async (params) => {
    const id = (params.id as string) || useCharacterStore.getState().selectedCharacterId;
    if (!id) return { success: false, error: '未指定角色且没有选中角色' };

    const patch: Partial<Character> = {};
    if (params.name) patch.name = params.name as string;
    if (params.description) patch.description = params.description as string;
    if (params.personality) patch.personality = params.personality as string;
    if (params.avatar) patch.avatar = params.avatar as string;

    await useCharacterStore.getState().updateCharacter(id, patch);
    return { success: true, message: `角色 "${id}" 已更新` };
  },
};

// ===== 3. 切换角色 =====
export const characterSelectTool: AgentTool = {
  id: 'character_select',
  name: '切换角色',
  description: '切换当前活跃的角色',
  category: 'character',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: '角色 ID',
      required: true,
    },
  ],
  execute: async (params) => {
    const id = params.id as string;
    useCharacterStore.getState().selectCharacter(id);
    const char = useCharacterStore.getState().getCharacterById(id);
    return { success: true, message: `已切换到角色 "${char?.name ?? id}"` };
  },
};

// ===== 4. 列出角色 =====
export const characterListTool: AgentTool = {
  id: 'character_list',
  name: '列出角色',
  description: '列出所有已创建的角色',
  category: 'character',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const { characters, selectedCharacterId } = useCharacterStore.getState();
    return {
      success: true,
      data: characters.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        selected: c.id === selectedCharacterId,
      })),
      message: `共 ${characters.length} 个角色，当前选中: ${selectedCharacterId ?? '无'}`,
    };
  },
};

// ===== 5. 删除角色 =====
export const characterDeleteTool: AgentTool = {
  id: 'character_delete',
  name: '删除角色',
  description: '删除一个角色（移到回收站）',
  category: 'character',
  permissionLevel: 'high',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: '角色 ID',
      required: true,
    },
  ],
  execute: async (params) => {
    const id = params.id as string;
    const char = useCharacterStore.getState().getCharacterById(id);
    await useCharacterStore.getState().softDeleteCharacter(id);
    return { success: true, message: `角色 "${char?.name ?? id}" 已移到回收站` };
  },
};

export const characterTools: AgentTool[] = [
  characterCreateTool,
  characterUpdateTool,
  characterSelectTool,
  characterListTool,
  characterDeleteTool,
];
