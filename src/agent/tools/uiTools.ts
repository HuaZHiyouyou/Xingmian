/**
 * ============================================================
 * Agent 工具集 - UI 控制
 * AI 可控制界面显示、导航、主题等
 * ============================================================
 */
import type { AgentTool } from '../../types/agent';
import { useUIStore } from '../../store/uiStore';

// ===== 1. 切换主题 =====
export const uiThemeTool: AgentTool = {
  id: 'ui_theme',
  name: '切换主题',
  description: '切换应用主题（亮色/暗色/跟随系统）',
  category: 'ui',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'theme',
      type: 'string',
      description: '主题模式',
      required: true,
      enum: ['light', 'dark', 'system'],
    },
  ],
  execute: async (params) => {
    const theme = params.theme as 'light' | 'dark' | 'system';
    useUIStore.getState().updateConfig({ theme });
    return { success: true, message: `已切换到${theme === 'light' ? '亮色' : theme === 'dark' ? '暗色' : '系统'}主题` };
  },
};

// ===== 2. 修改壁纸 =====
export const uiWallpaperTool: AgentTool = {
  id: 'ui_wallpaper',
  name: '修改壁纸',
  description: '设置应用壁纸（预设渐变/图片/视频）',
  category: 'ui',
  permissionLevel: 'medium',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: '壁纸类型',
      required: true,
      enum: ['none', 'preset', 'image', 'video'],
    },
    {
      name: 'source',
      type: 'string',
      description: '壁纸源（预设ID、已保存壁纸ID、或URL）',
      required: false,
      default: 'aurora',
    },
  ],
  execute: async (params) => {
    const type = params.type as 'none' | 'preset' | 'image' | 'video';
    const source = (params.source as string) || 'aurora';
    const ui = useUIStore.getState();

    if (type === 'none') {
      ui.updateWallpaper({ type: 'none', source: '' });
      return { success: true, message: '已关闭壁纸' };
    }

    if (type === 'preset') {
      ui.updateWallpaper({ type: 'preset', presetId: source, source });
      return { success: true, message: `已设置预设壁纸: ${source}` };
    }

    if (type === 'image') {
      ui.updateWallpaper({ type: 'image', imageSource: source, source });
      return { success: true, message: '已设置图片壁纸' };
    }

    if (type === 'video') {
      ui.updateWallpaper({ type: 'video', videoSource: source, source });
      return { success: true, message: '已设置视频壁纸' };
    }

    return { success: false, error: '未知壁纸类型' };
  },
};

// ===== 3. 修改字体 =====
export const uiFontTool: AgentTool = {
  id: 'ui_font',
  name: '修改字体',
  description: '设置应用字体大小和样式',
  category: 'ui',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'size',
      type: 'string',
      description: '字体大小',
      required: false,
      enum: ['small', 'medium', 'large'],
    },
    {
      name: 'family',
      type: 'string',
      description: '字体族（字体ID如 "system", "sans", "serif", "kai", "mono", "rounded"）',
      required: false,
    },
  ],
  execute: async (params) => {
    const ui = useUIStore.getState();

    if (params.size) {
      ui.updateConfig({ fontSize: params.size as 'small' | 'medium' | 'large' });
    }
    if (params.family) {
      ui.updateFont({ family: params.family as string });
    }

    const parts = [];
    if (params.size) parts.push(`大小=${params.size}`);
    if (params.family) parts.push(`字体=${params.family}`);
    return { success: true, message: `已更新字体: ${parts.join(', ')}` };
  },
};

// ===== 4. 切换气泡样式 =====
export const uiBubbleTool: AgentTool = {
  id: 'ui_bubble',
  name: '切换气泡样式',
  description: '设置聊天气泡样式',
  category: 'ui',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'style',
      type: 'string',
      description: '气泡样式',
      required: true,
      enum: ['rounded', 'sharp', 'minimal', 'wechat', 'pill', 'glass', 'bubble', 'gradient'],
    },
  ],
  execute: async (params) => {
    const style = params.style as 'rounded' | 'sharp' | 'minimal' | 'wechat' | 'pill' | 'glass' | 'bubble' | 'gradient';
    useUIStore.getState().updateConfig({ bubbleStyle: style });
    return { success: true, message: `已切换气泡样式: ${style}` };
  },
};

// ===== 5. 切换粒子效果 =====
export const uiParticleTool: AgentTool = {
  id: 'ui_particle',
  name: '切换粒子效果',
  description: '设置页面粒子特效',
  category: 'ui',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: '粒子类型',
      required: true,
      enum: ['none', 'snow', 'stars', 'hearts', 'bubbles', 'petals', 'sparkles', 'firefly', 'confetti', 'rain', 'cherry', 'butterfly', 'firework'],
    },
    {
      name: 'count',
      type: 'number',
      description: '粒子数量（0-200）',
      required: false,
      default: 50,
    },
  ],
  execute: async (params) => {
    const type = params.type as string;
    const count = (params.count as number) || 50;
    const ui = useUIStore.getState();
    ui.updateParticles({
      enabled: type !== 'none',
      type: type as 'snow' | 'stars' | 'hearts' | 'bubbles' | 'petals' | 'sparkles' | 'firefly' | 'confetti' | 'rain' | 'cherry' | 'butterfly' | 'firework',
      count,
    });
    return { success: true, message: type === 'none' ? '已关闭粒子效果' : `已开启粒子效果: ${type}` };
  },
};

// ===== 6. 修改强调色 =====
export const uiAccentTool: AgentTool = {
  id: 'ui_accent',
  name: '修改强调色',
  description: '设置应用强调色（十六进制颜色值）',
  category: 'ui',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [
    {
      name: 'color',
      type: 'string',
      description: '十六进制颜色值，如 "#334155", "#ff6b6b", "#00bcd4"',
      required: true,
    },
  ],
  execute: async (params) => {
    const color = params.color as string;
    useUIStore.getState().updateConfig({ accentColor: color });
    return { success: true, message: `已设置强调色: ${color}` };
  },
};

// ===== 7. 获取当前 UI 状态 =====
export const uiStateTool: AgentTool = {
  id: 'ui_state',
  name: '查看 UI 状态',
  description: '获取当前界面的所有配置状态',
  category: 'ui',
  permissionLevel: 'low',
  executionSite: 'frontend',
  parameters: [],
  execute: async () => {
    const ui = useUIStore.getState();
    return {
      success: true,
      data: {
        theme: ui.theme,
        fontSize: ui.fontSize,
        bubbleStyle: ui.bubbleStyle,
        accentColor: ui.accentColor,
        avatarStyle: ui.avatarStyle,
        streamResponse: ui.streamResponse,
        wallpaper: {
          type: ui.wallpaper.type,
          presetId: ui.wallpaper.presetId,
          opacity: ui.wallpaper.opacity,
        },
        particles: {
          enabled: ui.particles.enabled,
          type: ui.particles.type,
          count: ui.particles.count,
        },
        font: ui.font,
        slide: ui.slide,
      },
      message: '当前 UI 状态',
    };
  },
};

export const uiTools: AgentTool[] = [
  uiThemeTool,
  uiWallpaperTool,
  uiFontTool,
  uiBubbleTool,
  uiParticleTool,
  uiAccentTool,
  uiStateTool,
];
