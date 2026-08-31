/**
 * ============================================================
 * Agent 工具集 - 设置控制
 * AI 可读写所有应用设置
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { useUIStore } from '../../store/uiStore';
import { useCharacterStore } from '../../store/characterStore';
import { usePromptConfigStore } from '../../store/promptConfigStore';

// ===== 1. 读取设置 =====
export const settingsGetTool: AgentTool = {
  id: 'settings_get',
  name: '读取设置',
  description: '读取应用的任意设置值，支持主题、字体、API、角色、插件等所有配置',
  category: 'settings',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: '设置路径，用点号分隔。示例: "ui.theme", "character.selectedId", "prompt.customSystemPrompt"',
      required: true,
    },
  ],
  execute: async (params) => {
    const path = params.path as string;
    try {
      const parts = path.split('.');
      let result: unknown;

      switch (parts[0]) {
        case 'ui': {
          const ui = useUIStore.getState() as unknown as Record<string, unknown>;
          result = parts[1] ? ui[parts[1]] : ui;
          break;
        }
        case 'character': {
          const char = useCharacterStore.getState();
          result = parts[1] ? (char as unknown as Record<string, unknown>)[parts[1]] : {
            characters: char.characters,
            selectedId: char.selectedCharacterId,
          };
          break;
        }
        case 'prompt': {
          const prompt = usePromptConfigStore.getState();
          result = parts[1] ? (prompt as unknown as Record<string, unknown>)[parts[1]] : prompt;
          break;
        }
        default:
          return { success: false, error: `未知的设置域 "${parts[0]}"，支持: ui, character, prompt` };
      }

      return { success: true, data: result, message: `已读取 ${path}` };
    } catch (err) {
      return { success: false, error: `读取失败: ${err}` };
    }
  },
};

// ===== 2. 写入设置 =====
export const settingsSetTool: AgentTool = {
  id: 'settings_set',
  name: '修改设置',
  description: '修改应用的任意设置值（主题、字体、壁纸、API 配置、角色设定等）',
  category: 'settings',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'path',
      type: 'string',
      description: '设置路径，用点号分隔。示例: "ui.theme", "ui.fontSize", "ui.accentColor"',
      required: true,
    },
    {
      name: 'value',
      type: 'string',
      description: '新的值（JSON 格式，字符串用引号包裹）。示例: "dark", "#334155", "{\"enabled\": true}"',
      required: true,
    },
  ],
  execute: async (params) => {
    const path = params.path as string;
    let value: unknown;
    try {
      value = JSON.parse(params.value as string);
    } catch {
      value = params.value;
    }

    const parts = path.split('.');
    try {
      switch (parts[0]) {
        case 'ui': {
          const ui = useUIStore.getState();
          if (parts[1] && typeof ui.updateConfig === 'function') {
            ui.updateConfig({ [parts[1]]: value });
          }
          break;
        }
        case 'character': {
          const char = useCharacterStore.getState();
          if (parts[1] === 'selectedId' && typeof value === 'string') {
            char.selectCharacter(value);
          } else if (parts[1] && typeof value === 'string') {
            const id = char.selectedCharacterId;
            if (id) {
              await char.updateCharacter(id, { [parts[1]]: value });
            }
          }
          break;
        }
        case 'prompt': {
          const prompt = usePromptConfigStore.getState();
          const key = parts[1] as string;
          if (key === 'customSystemPrompt') prompt.setCustomSystemPrompt(value as string);
          else if (key === 'customPersonality') prompt.setCustomPersonality(value as string);
          else if (key === 'customCareGuidance') prompt.setCustomCareGuidance(value as string);
          else if (key === 'customEnvironmentAwareness') prompt.setCustomEnvironmentAwareness(value as string);
          break;
        }
        default:
          return { success: false, error: `不支持写入 "${parts[0]}" 域，支持: ui, character, prompt` };
      }

      return { success: true, message: `已将 ${path} 设置为 ${JSON.stringify(value)}` };
    } catch (err) {
      return { success: false, error: `写入失败: ${err}` };
    }
  },
};

// ===== 3. 列出所有设置项 =====
export const settingsListTool: AgentTool = {
  id: 'settings_list',
  name: '列出设置项',
  description: '列出某个设置域下所有可配置项及其当前值',
  category: 'settings',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'domain',
      type: 'string',
      description: '设置域: "ui", "config", "character", "prompt", "mind", "all"',
      required: false,
      default: 'all',
      enum: ['ui', 'character', 'prompt', 'all'],
    },
  ],
  execute: async (params) => {
    const domain = (params.domain as string) || 'all';
    const result: Record<string, unknown> = {};

    if (domain === 'all' || domain === 'ui') {
      const ui = useUIStore.getState();
      result.ui = {
        theme: ui.theme,
        fontSize: ui.fontSize,
        bubbleStyle: ui.bubbleStyle,
        accentColor: ui.accentColor,
        avatarStyle: ui.avatarStyle,
        streamResponse: ui.streamResponse,
        wallpaper: ui.wallpaper.type,
        particles: ui.particles.enabled ? ui.particles.type : 'none',
      };
    }

    if (domain === 'all' || domain === 'character') {
      const char = useCharacterStore.getState();
      result.character = {
        count: char.characters.length,
        selectedId: char.selectedCharacterId,
        names: char.characters.map((c) => ({ id: c.id, name: c.name })),
      };
    }

    if (domain === 'all' || domain === 'prompt') {
      const prompt = usePromptConfigStore.getState();
      result.prompt = {
        hasCustomSystemPrompt: !!prompt.customSystemPrompt,
        customSystemPromptLength: prompt.customSystemPrompt?.length ?? 0,
      };
    }

    return { success: true, data: result, message: '设置项列表' };
  },
};

export const settingsTools: AgentTool[] = [
  settingsGetTool,
  settingsSetTool,
  settingsListTool,
];
