/**
 * ============================================================
 * 斜杠指令公共模块（A4.1）
 * 从 InputArea 抽出的核心解析/执行逻辑，InputArea 与 botHandler 共用。
 * 指令按工具中文名触发（如 /新建对话），与全项目风格一致。
 * ============================================================
 */
import { useAgentStore } from '../store/agentStore';
import { initializeAgentTools } from './toolRegistry';
import type { AgentTool } from '../types/agent';

/** 命令参数键名/值的中文→英文翻译映射 */
export const PARAM_KEY_REVERSE: Record<string, string> = {
  '壁纸源': 'source', '来源': 'source', '壁纸类型': 'type', '类型': 'type',
  '主题': 'theme', '样式': 'style', '大小': 'size', '颜色': 'color',
  '页面': 'page', '模式': 'mode', '字体': 'family', '数量': 'count',
  '工具': 'toolId', '工具名': 'toolName',
};

/** 枚举值中文→英文反向映射 */
export const ENUM_VALUE_REVERSE: Record<string, Record<string, string>> = {
  theme: { '亮色': 'light', '暗色': 'dark', '跟随系统': 'system' },
  type: { '无': 'none', '预设': 'preset', '图片': 'image', '视频': 'video', '插件代码': 'plugin_code', '技能提示': 'skill_prompt', '角色提示': 'character_prompt', '系统提示': 'system_prompt' },
  style: { '圆角': 'rounded', '锐利': 'sharp', '极简': 'minimal', '微信': 'wechat', '药丸': 'pill', '玻璃': 'glass', '气泡': 'bubble', '渐变': 'gradient' },
  size: { '小': 'small', '中': 'medium', '大': 'large' },
  page: { '对话': 'chat', '角色': 'characters', '历史': 'history', '情感': 'emotion', '记忆': 'memory', '设置': 'settings', '外观': 'appearance', '插件': 'plugins', '技能': 'skills', '集成': 'integrations', '文件': 'files', '功能模块': 'feature-module', 'API 配置': 'api-config' },
  particleType: { '无': 'none', '雪': 'snow', '星': 'stars', '心': 'hearts', '泡': 'bubbles', '花瓣': 'petals', '闪': 'sparkles', '萤火': 'firefly', '彩纸': 'confetti', '雨': 'rain', '樱花': 'cherry', '蝴蝶': 'butterfly', '烟花': 'firework' },
};

export interface SlashParseResult {
  toolName: string;
  paramPart: string;
}

/** 解析 "/命令 空格 参数"（按第一个空格/全角空格拆分） */
export function parseSlashInput(inputText: string): SlashParseResult {
  const raw = inputText.slice(1).trim(); // 去掉 / 前缀
  const spaceIdx = raw.search(/[\s\u3000]/);
  const toolName = spaceIdx === -1 ? raw : raw.slice(0, spaceIdx);
  const paramPart = spaceIdx === -1 ? '' : raw.slice(spaceIdx + 1).trim();
  return { toolName, paramPart };
}

/** 按工具中文名 / id / 模糊匹配查找工具 */
export function findSlashTool(toolName: string): AgentTool | undefined {
  initializeAgentTools();
  const agentStore = useAgentStore.getState();
  const tools = agentStore.getAllTools();
  let tool = tools.find((t) => t.name === toolName);
  if (!tool) tool = agentStore.getTool(toolName);
  if (!tool) {
    tool = tools.find((t) =>
      t.name.includes(toolName) || toolName.includes(t.name) ||
      t.description.includes(toolName)
    );
  }
  return tool;
}

/** 解析参数：支持 key=value 格式，兼容旧的空格分隔 positional 格式 */
export function parseSlashParams(paramPart: string, tool: AgentTool): Record<string, unknown> | undefined {
  if (!paramPart) return undefined;
  const tokens = paramPart.split(/\s+/);
  const userParams: Record<string, unknown> = {};
  for (const token of tokens) {
    const eqIdx = token.indexOf('=');
    if (eqIdx > 0) {
      let key = token.slice(0, eqIdx);
      let value = token.slice(eqIdx + 1);
      if (PARAM_KEY_REVERSE[key]) key = PARAM_KEY_REVERSE[key];
      const valueMap = ENUM_VALUE_REVERSE[key];
      if (valueMap && valueMap[value]) value = valueMap[value];
      userParams[key] = value;
    }
  }
  if (Object.keys(userParams).length === 0) {
    const requiredParams = tool.parameters.filter((p) => p.required);
    for (let i = 0; i < requiredParams.length && i < tokens.length; i++) {
      let val = tokens[i];
      const paramKey = requiredParams[i].name;
      const valueMap = ENUM_VALUE_REVERSE[paramKey];
      if (valueMap && valueMap[val]) val = valueMap[val];
      userParams[paramKey] = val;
    }
  }
  return userParams;
}

export interface SlashExecContext {
  /** 系统提示输出（缺省返回字符串结果，由调用方处理） */
  say?: (content: string) => Promise<void> | void;
}

/** 执行斜杠指令并输出结果（不经过 AI、不进聊天管线） */
export async function executeSlashCommand(inputText: string, ctx?: SlashExecContext): Promise<string> {
  const { toolName, paramPart } = parseSlashInput(inputText);

  const tool = findSlashTool(toolName);
  if (!tool) {
    const msg = `未找到命令: ${toolName}`;
    await ctx?.say?.(msg);
    return msg;
  }

  const agentStore = useAgentStore.getState();
  const userParams = parseSlashParams(paramPart, tool);

  // 合并默认值
  const params: Record<string, unknown> = { ...userParams };
  for (const p of tool.parameters) {
    if (params[p.name] === undefined && p.default !== undefined) {
      params[p.name] = p.default;
    }
  }

  const requiredParams = tool.parameters.filter((p) => p.required);
  const missing = requiredParams.filter((p) => !params[p.name]);
  if (missing.length > 0) {
    const msg = `⚠️ "${tool.name}" 缺少参数: ${missing.map((p) => `${p.name}(${p.description})`).join(', ')}。`;
    await ctx?.say?.(msg);
    return msg;
  }

  try {
    const result = await agentStore.executeTool(tool.id, params);
    const msg = result.success
      ? (result.message || `${tool.name} 执行成功`)
      : `❌ ${tool.name} 执行失败: ${result.error}`;
    await ctx?.say?.(msg);
    return msg;
  } catch (err) {
    const msg = `❌ ${tool.name} 执行出错: ${err}`;
    await ctx?.say?.(msg);
    return msg;
  }
}
