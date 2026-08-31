import { create } from 'zustand';
import {
  mcpGetServers,
  mcpSaveServer,
  mcpDeleteServer,
  mcpConnect,
  mcpDisconnect,
  mcpListTools,
  mcpStatus,
  type McpServer,
  type McpTool,
} from '../lib/tauriBridge';
import { useDebugLog } from './debugLogStore';

interface McpState {
  servers: McpServer[];
  /** serverId → 连接状态 */
  connected: Record<string, boolean>;
  /** serverId → 工具列表 */
  tools: Record<string, McpTool[]>;
  loading: boolean;
  lastError: string | null;

  loadServers: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  addServer: (server: McpServer) => Promise<boolean>;
  updateServer: (server: McpServer) => Promise<boolean>;
  removeServer: (id: string) => Promise<boolean>;
  connect: (id: string) => Promise<boolean>;
  disconnect: (id: string) => Promise<boolean>;
  loadTools: (id: string) => Promise<McpTool[]>;
  /** 所有已连接服务器的工具总列表（供展示） */
  allTools: () => McpTool[];
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  connected: {},
  tools: {},
  loading: false,
  lastError: null,

  loadServers: async () => {
    set({ loading: true });
    try {
      const servers = await mcpGetServers();
      set({ servers });
      await get().refreshStatus();
    } finally {
      set({ loading: false });
    }
  },

  refreshStatus: async () => {
    const statuses = await mcpStatus();
    const connected: Record<string, boolean> = {};
    for (const s of statuses) connected[s.id] = s.connected;
    set({ connected });
  },

  addServer: async (server) => {
    const ok = await mcpSaveServer(server);
    if (ok) {
      await get().loadServers();
      useDebugLog.getState().add('system', `[MCP] 已添加服务器: ${server.name}`);
    } else {
      set({ lastError: '保存 MCP 服务器失败' });
    }
    return ok;
  },

  updateServer: async (server) => {
    const ok = await mcpSaveServer(server);
    if (ok) await get().loadServers();
    else set({ lastError: '更新 MCP 服务器失败' });
    return ok;
  },

  removeServer: async (id) => {
    const ok = await mcpDeleteServer(id);
    if (ok) {
      await get().loadServers();
      set((s) => {
        const tools = { ...s.tools };
        delete tools[id];
        return { tools };
      });
    }
    return ok;
  },

  connect: async (id) => {
    try {
      const result = await mcpConnect(id);
      set((s) => ({
        connected: { ...s.connected, [id]: true },
        tools: { ...s.tools, [id]: result.tools },
        lastError: null,
      }));
      const server = get().servers.find((x) => x.id === id);
      useDebugLog.getState().add('system', `[MCP] 连接成功: ${server?.name || id}（${result.tools.length} 个工具）`);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set((s) => ({ connected: { ...s.connected, [id]: false }, lastError: msg }));
      useDebugLog.getState().add('system', `[MCP] 连接失败: ${msg}`);
      return false;
    }
  },

  disconnect: async (id) => {
    const ok = await mcpDisconnect(id);
    if (ok) {
      set((s) => ({ connected: { ...s.connected, [id]: false } }));
    }
    return ok;
  },

  loadTools: async (id) => {
    try {
      const list = await mcpListTools(id);
      set((s) => ({ tools: { ...s.tools, [id]: list }, connected: { ...s.connected, [id]: true } }));
      return list;
    } catch (e) {
      set((s) => ({ connected: { ...s.connected, [id]: false }, lastError: e instanceof Error ? e.message : String(e) }));
      return [];
    }
  },

  allTools: () => {
    const { tools } = get();
    return Object.values(tools).flat();
  },
}));
