/**
 * ============================================================
 * Agent Store
 * 智能体核心状态管理 - 工具注册、会话管理、执行引擎
 * ============================================================
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AgentSession,
  AgentMessage,
  AgentTool,
  AgentConfig,
  ToolCategory,
  ToolResult,
  ToolConfirmation,
} from '../types/agent';
import { generateId } from '../utils/chatUtils';

// ==================== 默认配置 ====================

const defaultConfig: AgentConfig = {
  enabled: true,
  permissionMode: 'relaxed',
  enabledCategories: [
    'settings', 'ui', 'navigation', 'plugin', 'skill',
    'character', 'chat', 'memory', 'file', 'system',
  ],
  executionTimeout: 30000,
  maxHistoryLength: 200,
};

// ==================== Store ====================

interface AgentState {
  currentSessionId: string | null;
  sessions: AgentSession[];
  tools: Map<string, AgentTool>;
  config: AgentConfig;
  isExecuting: boolean;
  pendingConfirmations: ToolConfirmation[];

  // 会话
  createSession: (name?: string) => AgentSession;
  deleteSession: (id: string) => void;
  switchSession: (id: string) => void;
  getSessions: () => AgentSession[];
  getCurrentSession: () => AgentSession | null;

  // 消息
  addMessage: (type: AgentMessage['type'], content: string, toolCall?: AgentMessage['toolCall']) => AgentMessage;
  getMessages: (sessionId?: string) => AgentMessage[];

  // 工具
  registerTool: (tool: AgentTool) => void;
  registerTools: (tools: AgentTool[]) => void;
  unregisterTool: (toolId: string) => void;
  getTool: (toolId: string) => AgentTool | undefined;
  getAllTools: () => AgentTool[];
  getToolsByCategory: (category: ToolCategory) => AgentTool[];
  getToolsForPrompt: () => string;

  // 工具执行
  executeTool: (toolId: string, params: Record<string, unknown>) => Promise<ToolResult>;
  requestConfirmation: (toolId: string, params: Record<string, unknown>) => Promise<boolean>;
  resolveConfirmation: (id: string, approved: boolean) => void;

  // 配置
  updateConfig: (patch: Partial<AgentConfig>) => void;
  toggleAgent: () => void;

  // 历史
  clearHistory: () => void;
}

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
      currentSessionId: null,
      sessions: [],
      tools: new Map(),
      config: defaultConfig,
      isExecuting: false,
      pendingConfirmations: [],

      // ===== 会话 =====
      createSession: (name) => {
        const session: AgentSession = {
          id: generateId(),
          name: name || `Agent 对话 ${get().sessions.length + 1}`,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          enabledTools: [],
          pendingConfirmations: [],
        };
        set((s) => ({
          sessions: [session, ...s.sessions],
          currentSessionId: session.id,
        }));
        return session;
      },

      deleteSession: (id) => set((s) => {
        const sessions = s.sessions.filter((x) => x.id !== id);
        return {
          sessions,
          currentSessionId: s.currentSessionId === id
            ? (sessions[0]?.id ?? null)
            : s.currentSessionId,
        };
      }),

      switchSession: (id) => set({ currentSessionId: id }),

      getSessions: () => get().sessions,

      getCurrentSession: () => {
        const { currentSessionId, sessions } = get();
        return sessions.find((s) => s.id === currentSessionId) ?? null;
      },

      // ===== 消息 =====
      addMessage: (type, content, toolCall) => {
        const msg: AgentMessage = {
          id: generateId(),
          type,
          content,
          timestamp: Date.now(),
          toolCall,
        };
        set((s) => {
          const sessions = s.sessions.map((sess) => {
            if (sess.id === s.currentSessionId) {
              const messages = [...sess.messages, msg];
              // 裁剪超长历史
              if (messages.length > s.config.maxHistoryLength) {
                messages.splice(0, messages.length - s.config.maxHistoryLength);
              }
              return { ...sess, messages, updatedAt: Date.now() };
            }
            return sess;
          });
          return { sessions };
        });
        return msg;
      },

      getMessages: (sessionId) => {
        const targetId = sessionId || get().currentSessionId;
        const session = get().sessions.find((s) => s.id === targetId);
        return session?.messages ?? [];
      },

      // ===== 工具 =====
      registerTool: (tool) => set((s) => {
        const tools = new Map(s.tools);
        tools.set(tool.id, tool);
        return { tools };
      }),

      registerTools: (toolList) => set((s) => {
        const tools = new Map(s.tools);
        toolList.forEach((t) => tools.set(t.id, t));
        return { tools };
      }),

      unregisterTool: (toolId) => set((s) => {
        const tools = new Map(s.tools);
        tools.delete(toolId);
        return { tools };
      }),

      getTool: (toolId) => get().tools.get(toolId),

      getAllTools: () => Array.from(get().tools.values()),

      getToolsByCategory: (category) =>
        Array.from(get().tools.values()).filter((t) => t.category === category),

      getToolsForPrompt: () => {
        const tools = Array.from(get().tools.values());
        const config = get().config;
        return tools
          .filter((t) => config.enabledCategories.includes(t.category))
          .map((t) => {
            const params = t.parameters.map((p) => {
              const req = p.required ? '(必填)' : `(可选, 默认 ${p.default ?? '无'})`;
              const enumHint = p.enum ? ` [可选值: ${p.enum.join(', ')}]` : '';
              return `    - ${p.name}: ${p.type} - ${p.description} ${req}${enumHint}`;
            }).join('\n');
            return `  - ${t.id} (${t.name}): ${t.description}\n    分类: ${t.category} | 权限: ${t.permissionLevel} | 执行: ${t.executionSite}\n    参数:\n${params}`;
          }).join('\n');
      },

      // ===== 工具执行 =====
      executeTool: async (toolId, params) => {
        const tool = get().tools.get(toolId);
        if (!tool) {
          return { success: false, error: `工具 "${toolId}" 未注册` };
        }

        // 高权限工具需要确认
        if (tool.permissionLevel === 'high') {
          const approved = await get().requestConfirmation(toolId, params);
          if (!approved) {
            return { success: false, error: '用户拒绝执行' };
          }
        }

        set({ isExecuting: true });
        try {
          const result = await Promise.race([
            tool.execute(params),
            new Promise<ToolResult>((_, reject) =>
              setTimeout(() => reject(new Error('工具执行超时')), get().config.executionTimeout)
            ),
          ]);
          return result;
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        } finally {
          set({ isExecuting: false });
        }
      },

      requestConfirmation: (toolId, params) => {
        return new Promise<boolean>((resolve) => {
          const confirmation: ToolConfirmation = {
            id: generateId(),
            toolId,
            toolName: get().tools.get(toolId)?.name ?? toolId,
            params,
            timestamp: Date.now(),
            status: 'pending',
          };
          set((s) => ({
            pendingConfirmations: [...s.pendingConfirmations, { ...confirmation, _resolve: resolve } as ToolConfirmation & { _resolve: (v: boolean) => void }],
          }));
        });
      },

      resolveConfirmation: (id, approved) => {
        set((s) => {
          const conf = s.pendingConfirmations.find((c) => c.id === id) as (ToolConfirmation & { _resolve?: (v: boolean) => void }) | undefined;
          if (conf?._resolve) conf._resolve(approved);
          return {
            pendingConfirmations: s.pendingConfirmations.map((c) =>
              c.id === id ? { ...c, status: approved ? 'approved' as const : 'rejected' as const } : c
            ),
          };
        });
      },

      // ===== 配置 =====
      updateConfig: (patch) => set((s) => ({
        config: { ...s.config, ...patch },
      })),

      toggleAgent: () => set((s) => ({
        config: { ...s.config, enabled: !s.config.enabled },
      })),

      // ===== 历史 =====
      clearHistory: () => set({ sessions: [], currentSessionId: null }),
    }),
    {
      name: 'agent-store',
      storage: createJSONStorage(() => localStorage, {
        replacer: (_key, value) => {
          if (value instanceof Map) {
            return { __type: 'Map', entries: Array.from(value.entries()) };
          }
          return value;
        },
        reviver: (_key, value) => {
          if (value && typeof value === 'object' && '__type' in value && (value as Record<string, unknown>).__type === 'Map') {
            const v = value as Record<string, unknown>;
            return new Map(v.entries as [string, unknown][]);
          }
          return value;
        },
      }),
      partialize: (state) => ({
        currentSessionId: state.currentSessionId,
        sessions: state.sessions,
        config: state.config,
      }),
    }
  )
);
