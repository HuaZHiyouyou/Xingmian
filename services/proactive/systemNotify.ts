/**
 * ============================================================
 * D5: Windows 系统通知（tauri-plugin-notification 封装）
 *
 * 仅在 Tauri 桌面环境生效；Web 环境静默跳过。
 * 权限只请求一次（模块级缓存），被拒绝后不再骚扰。
 * ============================================================
 */
import { useDebugLog } from '../../store/debugLogStore';

let permResolved = false;
let permGranted = false;

/** 惰性请求权限（仅首次），返回是否可发送 */
async function ensurePermission(): Promise<boolean> {
  if (permResolved) return permGranted;
  try {
    const mod = await import('@tauri-apps/plugin-notification');
    let granted = await mod.isPermissionGranted();
    if (!granted) granted = (await mod.requestPermission()) === 'granted';
    permGranted = granted;
  } catch {
    permGranted = false;
  }
  permResolved = true;
  return permGranted;
}

/** 发送系统通知（失败静默——通知永远不应打断主流程） */
export async function sendProactiveNotification(title: string, body: string): Promise<void> {
  if (!(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)) return;
  if (!(await ensurePermission())) {
    useDebugLog.getState().add('proactive', `[通知] 权限未授予，跳过系统通知`);
    return;
  }
  try {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    sendNotification({ title, body });
    useDebugLog.getState().add('proactive', `[通知] 已发送系统通知: ${title}`);
  } catch (e) {
    useDebugLog.getState().add('proactive', `[通知] 发送失败: ${e instanceof Error ? e.message : String(e)}`);
  }
}
