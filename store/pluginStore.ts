/**
 * ============================================================
 * 插件模块 Store
 * 允许使用自定义框架开发插件，可替代或增强原有设定。
 * 支持运行模式：standalone（单独）/ parallel（并行）/ cooperative（合作）
 *
 * 插件钩子（Hook 框架）：
 *  - beforePrompt: 在 system prompt 构建后注入插件内容
 *  - beforeSend:   用户消息发送前（可修改/追加消息）
 *  - afterReply:   AI 回复生成后（可修改回复文本）
 *  - onTick:       定时触发（分钟级）
 * ============================================================
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type PluginMode = 'standalone' | 'parallel' | 'cooperative';
export type PluginStatus = 'idle' | 'running' | 'error' | 'disabled';

export interface PluginContext {
  /** 当前角色 ID */
  characterId?: string;
  /** 原始 prompt（beforePrompt 可修改后返回） */
  prompt?: string;
  /** 用户消息 */
  userMessage?: string;
  /** AI 回复 */
  reply?: string;
  /** 附加数据（插件间共享） */
  data?: Record<string, unknown>;
}

/** 本次运行只应用哪个钩子阶段（文本模式按此过滤；code 插件通过 ctx.data.__phase 自行分流） */
export type PluginPhase = 'beforePrompt' | 'beforeSend' | 'afterReply' | 'onTick';

export interface RunPluginsOptions {
  phase?: PluginPhase;
  /** 只运行指定 id 的插件 */
  pluginId?: string;
}

export interface ChatPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  /** 运行模式：standalone=单独运行，parallel=并行（独立效果），cooperative=合作（共享上下文/接力） */
  mode: PluginMode;
  /** 是否替代原有设定（替代时优先级最高，原始 prompt 段被替换） */
  replaceDefault?: boolean;
  /** 优先级（同模式排序，数字越大越先执行） */
  priority?: number;
  /** 插件代码（JS 函数体字符串，用 new Function 动态执行） */
  code?: string;
  /** 简化配置：钩子文本 */
  hookConfig?: {
    beforePrompt?: string;
    beforeSend?: string;
    afterReply?: string;
    onTick?: string;
  };
  /** 统计 */
  stats?: {
    runs: number;
    lastRun?: number;
    errorCount: number;
  };
  createdAt: number;
}

// ==================== 内置示例插件 ====================

export function createExamplePlugin(): ChatPlugin {
  return {
    id: 'plugin_' + Date.now().toString(36),
    name: '语气增强插件',
    version: '1.0.0',
    description: '在 AI 回复后追加温暖的小动作描述，增强陪伴感（示例插件）',
    enabled: false,
    mode: 'parallel',
    replaceDefault: false,
    priority: 50,
    hookConfig: {
      afterReply: '在回复结尾追加一行轻动作描述（如"轻轻笑了下"），保持风格统一',
    },
    stats: { runs: 0, errorCount: 0 },
    createdAt: Date.now(),
  };
}

// ==================== 运行时 ====================

interface PluginStore {
  plugins: ChatPlugin[];
  statuses: Record<string, PluginStatus>;
  logs: string[];
  /** 标记示例插件是否已初始化过（防止删除后刷新时重新添加） */
  exampleInitialized: boolean;

  // CRUD
  addPlugin: (plugin: Omit<ChatPlugin, 'id' | 'createdAt' | 'stats'>) => void;
  updatePlugin: (id: string, patch: Partial<ChatPlugin>) => void;
  removePlugin: (id: string) => void;
  togglePlugin: (id: string) => void;
  resetLogs: () => void;

  // 运行时
  runPlugins: (ctx: PluginContext, options?: RunPluginsOptions) => Promise<PluginContext>;
  /** 定时驱动：运行所有启用且配置了 onTick 钩子的插件（分钟级心跳调用） */
  runTickPlugins: (characterId?: string) => Promise<void>;
  /** 单插件执行（定时任务 run_plugin 用） */
  runPluginById: (id: string, characterId?: string) => Promise<boolean>;
  log: (msg: string) => void;
}

function genId(): string {
  return 'plugin_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

export const usePluginStore = create<PluginStore>()(
  persist(
    (set, get) => ({
      plugins: [],
      statuses: {},
      logs: [],
      exampleInitialized: false,

      addPlugin: (plugin) => set((s) => ({
        plugins: [...s.plugins, {
          ...plugin,
          id: genId(),
          createdAt: Date.now(),
          stats: { runs: 0, errorCount: 0 },
        } as ChatPlugin],
      })),
      updatePlugin: (id, patch) => set((s) => ({
        plugins: s.plugins.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      })),
      removePlugin: (id) => set((s) => {
        const statuses = { ...s.statuses };
        delete statuses[id];
        return { plugins: s.plugins.filter((p) => p.id !== id), statuses };
      }),
      togglePlugin: (id) => set((s) => ({
        plugins: s.plugins.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
      })),
      resetLogs: () => set({ logs: [] }),

      log: (msg) => set((s) => ({
        logs: [`[${new Date().toLocaleTimeString()}] ${msg}`, ...s.logs].slice(0, 100),
      })),

      /**
       * 运行所有启用的插件（按 mode 分组执行）：
       *  - standalone：每个插件独立执行 beforePrompt/afterReply
       *  - parallel：并行执行（互不干扰，但结果聚合）
       *  - cooperative：按 priority 串行接力，共享 ctx（前一个的输出给后一个）
       *
       * options.phase 指定时只应用该阶段的钩子：
       *  - 文本模式：只拼对应 hookConfig 字段
       *  - code 模式：照常执行整体函数体，ctx.data.__phase 供插件自行分流
       */
      runPlugins: async (ctx, options) => {
        const phase = options?.phase;
        const pluginIdFilter = options?.pluginId;
        const enabled = get().plugins.filter((p) => p.enabled && (!pluginIdFilter || p.id === pluginIdFilter));
        if (enabled.length === 0) return ctx;

        // phase 过滤：跳过没有该阶段文本配置的纯文本插件
        const hasPhaseHook = (p: ChatPlugin): boolean => {
          if (!phase) return true;
          if (p.code) return true; // code 插件由插件自行判断阶段
          return !!p.hookConfig?.[phase];
        };
        const applicable = enabled.filter(hasPhaseHook);
        if (applicable.length === 0) return ctx;

        const cooperative = applicable.filter((p) => p.mode === 'cooperative').sort((a, b) => (b.priority || 0) - (a.priority || 0));
        const parallel = applicable.filter((p) => p.mode === 'parallel').sort((a, b) => (b.priority || 0) - (a.priority || 0));
        const standalone = applicable.filter((p) => p.mode === 'standalone');

        let resultCtx: PluginContext = { ...ctx, data: { ...(ctx.data || {}), ...(phase ? { __phase: phase } : {}) } };

        const runOne = async (plugin: ChatPlugin, shared: PluginContext): Promise<PluginContext> => {
          let local = { ...shared, data: { ...(shared.data || {}) } };
          // 替代模式：直接替换 prompt（仅 beforePrompt 阶段生效）
          if ((!phase || phase === 'beforePrompt') && plugin.replaceDefault && plugin.hookConfig?.beforePrompt) {
            local.prompt = plugin.hookConfig.beforePrompt;
          }
          // 执行钩子：有代码则动态执行，否则用文本配置
          try {
            if (plugin.code) {
              const fn = new Function('ctx', `"use strict";\n${plugin.code}\nreturn ctx;`) as (c: PluginContext) => PluginContext | Promise<PluginContext>;
              const out = await fn(local);
              if (out) local = { ...local, ...out };
            } else {
              // 文本配置模式：按当前阶段注入对应钩子内容
              if ((!phase || phase === 'beforePrompt') && plugin.hookConfig?.beforePrompt && local.prompt !== undefined) {
                local.prompt = local.prompt
                  ? `${local.prompt}\n\n【插件·${plugin.name}】\n${plugin.hookConfig.beforePrompt}`
                  : `【插件·${plugin.name}】\n${plugin.hookConfig.beforePrompt}`;
              }
              if ((!phase || phase === 'afterReply') && plugin.hookConfig?.afterReply && local.reply) {
                local.reply = `${local.reply}\n\n${plugin.hookConfig.afterReply}`;
              }
            }
            set((s) => ({
              plugins: s.plugins.map((p) => p.id === plugin.id ? {
                ...p,
                stats: { runs: (p.stats?.runs || 0) + 1, lastRun: Date.now(), errorCount: p.stats?.errorCount || 0 },
              } : p),
              statuses: { ...s.statuses, [plugin.id]: 'running' },
            }));
            get().log(`✅ ${plugin.name}${phase ? ` [${phase}]` : ''} 执行成功`);
            return local;
          } catch (e) {
            set((s) => ({
              statuses: { ...s.statuses, [plugin.id]: 'error' },
              plugins: s.plugins.map((p) => p.id === plugin.id ? {
                ...p,
                stats: { runs: p.stats?.runs || 0, lastRun: p.stats?.lastRun, errorCount: (p.stats?.errorCount || 0) + 1 },
              } : p),
            }));
            get().log(`❌ ${plugin.name} 执行失败: ${e instanceof Error ? e.message : String(e)}`);
            return local;
          }
        };

        // cooperative：串行接力
        for (const p of cooperative) {
          resultCtx = await runOne(p, resultCtx);
        }
        // parallel + standalone：并行（各自独立，但结果合并——后执行的用前一个的 prompt/reply 基址）
        const parGroups = [...parallel, ...standalone];
        if (parGroups.length > 0) {
          // 并行执行但合并到同一个 ctx（用第一个成功修改的）
          let merged = resultCtx;
          await Promise.all(parGroups.map(async (p) => {
            const out = await runOne(p, resultCtx);
            if (out.prompt !== undefined && out.prompt !== resultCtx.prompt) merged = { ...merged, prompt: out.prompt };
            if (out.reply !== undefined && out.reply !== resultCtx.reply) merged = { ...merged, reply: out.reply };
            if (out.userMessage !== undefined && out.userMessage !== resultCtx.userMessage) merged = { ...merged, userMessage: out.userMessage };
          }));
          resultCtx = merged;
        }

        return resultCtx;
      },

      /** 定时驱动：运行所有启用且配置了 onTick 钩子的插件（逐个独立执行） */
      runTickPlugins: async (characterId) => {
        const tickPlugins = get().plugins.filter((p) => p.enabled && (p.hookConfig?.onTick || p.code));
        for (const plugin of tickPlugins) {
          try {
            await get().runPlugins(
              { characterId, data: { tick: Date.now() } },
              { phase: 'onTick', pluginId: plugin.id },
            );
          } catch { /* runPlugins 内部已处理错误 */ }
        }
      },

      /** 单插件执行（定时任务 run_plugin 用）：仅触发该插件的代码/onTick */
      runPluginById: async (id, characterId) => {
        const plugin = get().plugins.find((p) => p.id === id);
        if (!plugin || !plugin.enabled) return false;
        try {
          if (plugin.code) {
            const fn = new Function('ctx', `"use strict";\n${plugin.code}\nreturn ctx;`) as (c: PluginContext) => PluginContext | Promise<PluginContext>;
            await fn({ characterId, data: { __phase: 'onTick', trigger: 'scheduled', pluginId: id } });
          }
          set((s) => ({
            plugins: s.plugins.map((p) => p.id === id ? {
              ...p,
              stats: { runs: (p.stats?.runs || 0) + 1, lastRun: Date.now(), errorCount: p.stats?.errorCount || 0 },
            } : p),
            statuses: { ...s.statuses, [id]: 'running' },
          }));
          get().log(`⏰ ${plugin.name} 由定时任务触发`);
          return true;
        } catch (e) {
          set((s) => ({ statuses: { ...s.statuses, [id]: 'error' } }));
          get().log(`❌ ${plugin.name} 定时触发失败: ${e instanceof Error ? e.message : String(e)}`);
          return false;
        }
      },
    }),
    {
      name: 'plugin-module',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        plugins: s.plugins,
        exampleInitialized: s.exampleInitialized,
      }),
    }
  )
);
