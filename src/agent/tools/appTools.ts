/**
 * 应用生命周期控制工具
 * 刷新、关闭、重启应用
 */
import type { AgentTool } from '../../types/agent';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const appTools: AgentTool[] = [
  {
    id: 'app_refresh',
    name: '刷新应用',
    category: 'system',
    description: '刷新当前应用页面，重新加载所有数据',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      // 刷新：直接走 webview 的 location.reload（Tauri 下同样生效）
      window.location.reload();
      return { success: true, message: '应用已刷新' };
    },
  },
  {
    id: 'app_close',
    name: '关闭应用',
    category: 'system',
    description: '关闭当前应用窗口并退出应用',
    permissionLevel: 'high',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      if (isTauri) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().close();
          return { success: true, message: '应用正在关闭' };
        } catch (e) {
          return { success: false, message: `关闭失败: ${String(e)}` };
        }
      } else {
        window.close();
        return { success: true, message: '应用已关闭' };
      }
    },
  },
  {
    id: 'app_restart',
    name: '重启应用',
    category: 'system',
    description: '关闭并重新启动应用',
    permissionLevel: 'high',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      if (isTauri) {
        try {
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
          return { success: true, message: '应用正在重启' };
        } catch {
          // fallback: 先关闭再由用户手动启动
          try {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            await getCurrentWindow().close();
            return { success: true, message: '应用已关闭，请手动重新启动' };
          } catch (e2) {
            return { success: false, message: `重启失败: ${String(e2)}` };
          }
        }
      } else {
        window.location.reload();
        return { success: true, message: '页面已刷新（浏览器模式不支持应用重启）' };
      }
    },
  },
];
