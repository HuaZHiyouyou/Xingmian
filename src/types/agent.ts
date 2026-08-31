/**
 * ============================================================
 * Agent 系统类型定义
 * 定义智能体可调用的工具、权限模型、执行流程
 * ============================================================
 */

// ==================== 工具定义 ====================

/** 工具参数类型 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
}

/** 工具定义 */
export interface AgentTool {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  parameters: ToolParameter[];
  /** 权限级别：low=无风险, medium=需要确认, high=高风险 */
  permissionLevel: 'low' | 'medium' | 'high';
  /** 执行位置：frontend=前端执行, backend=后端执行 */
  executionSite: 'frontend' | 'backend';
  /** 工具函数引用 */
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

/** 工具分类 */
export type ToolCategory = 
  | 'settings'      // 设置控制
  | 'ui'            // UI 控制
  | 'navigation'    // 导航控制
  | 'plugin'        // 插件管理
  | 'skill'         // 技能管理
  | 'character'     // 角色管理
  | 'chat'          // 对话控制
  | 'memory'        // 记忆系统
  | 'file'          // 文件操作
  | 'emotion'       // 情感系统
  | 'learning'      // 学习系统
  | 'music'         // 音乐播放
  | 'ai'            // AI 核心功能
  | 'system';       // 系统操作

/** 工具执行结果 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
}

// ==================== Agent 会话 ====================

/** Agent 消息类型 */
export type AgentMessageType = 
  | 'user'          // 用户输入
  | 'assistant'     // AI 回复
  | 'tool_call'     // 工具调用
  | 'tool_result'   // 工具结果
  | 'system';       // 系统消息

/** Agent 消息 */
export interface AgentMessage {
  id: string;
  type: AgentMessageType;
  content: string;
  timestamp: number;
  /** 工具调用信息（仅 tool_call 类型） */
  toolCall?: {
    toolId: string;
    toolName: string;
    params: Record<string, unknown>;
    result?: ToolResult;
  };
}

/** Agent 会话 */
export interface AgentSession {
  id: string;
  name: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
  /** 已启用的工具列表 */
  enabledTools: string[];
  /** 权限确认队列 */
  pendingConfirmations: ToolConfirmation[];
}

/** 工具执行确认 */
export interface ToolConfirmation {
  id: string;
  toolId: string;
  toolName: string;
  params: Record<string, unknown>;
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

// ==================== 设置控制 ====================

/** 设置路径 */
export type SettingsPath = 
  | 'api.*'           // API 配置
  | 'appearance.*'    // 外观设置
  | 'chat.*'          // 聊天设置
  | 'character.*'     // 角色设置
  | 'plugin.*'        // 插件设置
  | 'skill.*'         // 技能设置
  | 'system.*';       // 系统设置

/** 设置操作 */
export type SettingsAction = 'get' | 'set' | 'list' | 'reset';

// ==================== UI 控制 ====================

/** UI 组件标识 */
export type UIComponent = 
  | 'sidebar'
  | 'header'
  | 'chat-window'
  | 'input-area'
  | 'character-panel'
  | 'settings-panel'
  | 'plugin-panel'
  | 'skill-panel'
  | 'memory-panel'
  | 'emotion-panel';

/** UI 操作 */
export type UIAction = 'show' | 'hide' | 'toggle' | 'focus' | 'highlight';

// ==================== 导航控制 ====================

/** 路由路径 */
export type RoutePath = 
  | '/chat'
  | '/chat/:id'
  | '/characters'
  | '/history'
  | '/emotion'
  | '/memory'
  | '/api-config'
  | '/settings'
  | '/appearance'
  | '/plugins'
  | '/skills'
  | '/integrations'
  | '/mcp'
  | '/files'
  | '/feature-module';

// ==================== 插件创建 ====================

/** 插件模板 */
export interface PluginTemplate {
  id: string;
  name: string;
  description: string;
  mode: 'standalone' | 'parallel' | 'cooperative';
  hookConfig: {
    beforePrompt?: string;
    beforeSend?: string;
    afterReply?: string;
    onTick?: string;
  };
  /** AI 生成的代码 */
  generatedCode?: string;
}

// ==================== 技能创建 ====================

/** 技能模板 */
export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  trigger: 'auto' | 'keyword' | 'manual';
  keywords: string[];
  prompt: string;
  /** AI 生成的内容 */
  generatedPrompt?: string;
}

// ==================== Agent 配置 ====================

/** Agent 配置 */
export interface AgentConfig {
  /** 是否启用 Agent 功能 */
  enabled: boolean;
  /** 默认权限模式：strict=需要确认, relaxed=自动批准低风险 */
  permissionMode: 'strict' | 'relaxed';
  /** 已启用的工具类别 */
  enabledCategories: ToolCategory[];
  /** 工具执行超时（毫秒） */
  executionTimeout: number;
  /** 最大历史消息数 */
  maxHistoryLength: number;
}

// ==================== Store 类型 ====================

/** Agent Store */
export interface AgentStore {
  /** 当前会话 */
  currentSession: AgentSession | null;
  /** 会话历史 */
  sessions: AgentSession[];
  /** 已注册的工具 */
  tools: Map<string, AgentTool>;
  /** Agent 配置 */
  config: AgentConfig;
  /** 是否正在执行 */
  isExecuting: boolean;

  // 会话管理
  createSession: (name?: string) => AgentSession;
  deleteSession: (id: string) => void;
  switchSession: (id: string) => void;

  // 消息管理
  addUserMessage: (content: string) => void;
  addAssistantMessage: (content: string) => void;
  addToolCallMessage: (toolId: string, params: Record<string, unknown>) => string;
  addToolResultMessage: (messageId: string, result: ToolResult) => void;

  // 工具管理
  registerTool: (tool: AgentTool) => void;
  unregisterTool: (toolId: string) => void;
  getTool: (toolId: string) => AgentTool | undefined;
  getToolsByCategory: (category: ToolCategory) => AgentTool[];

  // 工具执行
  executeTool: (toolId: string, params: Record<string, unknown>) => Promise<ToolResult>;
  requestConfirmation: (toolId: string, params: Record<string, unknown>) => Promise<boolean>;

  // 配置管理
  updateConfig: (patch: Partial<AgentConfig>) => void;

  // 历史管理
  clearHistory: () => void;
  exportHistory: () => string;
  importHistory: (json: string) => void;
}
