/**
 * ============================================================
 * Bot 连接看门狗（双向检测 + 自动恢复）
 *
 * 解决"回复生成成功但没有回复到外部平台"的最后一环：NapCat 断连
 * 期间生成的回复此前会被直接丢弃，且没有任何恢复手段。
 *
 * 双向检测：
 *   · 下行（外部→应用）：Rust bot-status 事件（connected/disconnected/error）
 *     + 任意外部消息到达（notifyInbound）都能证明链路状态；
 *   · 上行（应用→外部）：发送成功/失败计数（markOutboundOk/Fail），
 *     连续 2 次失败判定链路异常。
 *
 * 自动恢复（任意一端发送消息即触发补发）：
 *   · NapCat 重连（bot-status connected）→ 立即补发待发队列；
 *   · 收到外部新消息（下行活跃证明）→ 立即补发；
 *   · 应用侧任何一次外发成功 → 顺带补发；
 *   · 兜底：每 60 秒周期扫描补发一次。
 *
 * 待发队列：localStorage 持久化（刷新不丢），单条 10 分钟 TTL、
 * 最多补发 3 次、队列上限 20 条——宁可少发也不迟到轰炸。
 * ============================================================
 */
import { listen } from '@tauri-apps/api/event';
import { sendBotReply, isRunningInTauri } from '../lib/tauriBridge';
import { useDebugLog } from '../store/debugLogStore';

const OUTBOX_KEY = 'botOutbox:v1';
const OUTBOX_TTL_MS = 10 * 60 * 1000;
const OUTBOX_MAX = 20;
const OUTBOX_MAX_ATTEMPTS = 3;

interface OutboxEntry {
  id: string;
  integrationId: string;
  integrationType: string;
  userId: string;
  groupId: string | null;
  text: string;
  queuedAt: number;
  attempts: number;
}

type ConnState = 'unknown' | 'online' | 'offline';
const connState: Record<string, ConnState> = {};
/** 连续外发失败计数（按接入） */
const outboundFailStreak: Record<string, number> = {};
let started = false;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function loadOutbox(): OutboxEntry[] {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]') as OutboxEntry[]; } catch { return []; }
}

function saveOutbox(list: OutboxEntry[]): void {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(-OUTBOX_MAX))); } catch { /* 静默 */ }
}

export function getOutboxSize(): number {
  return loadOutbox().length;
}

/** 外发失败入队（TTL 内、连接恢复或任一侧有新消息时自动补发） */
export function queueFailedReply(entry: Omit<OutboxEntry, 'id' | 'queuedAt' | 'attempts'>): void {
  const now = Date.now();
  const list = loadOutbox().filter(e => now - e.queuedAt < OUTBOX_TTL_MS);
  list.push({ ...entry, id: `${now}-${Math.random().toString(36).slice(2, 8)}`, queuedAt: now, attempts: 0 });
  saveOutbox(list);
}

async function attemptSend(e: OutboxEntry): Promise<boolean> {
  try {
    await sendBotReply(e.integrationId, e.integrationType, e.userId, e.groupId, e.text);
    return true;
  } catch { return false; }
}

/** 补发待发队列（integrationId 传入则只补发该接入）；返回成功条数 */
export async function flushOutbox(integrationId?: string): Promise<number> {
  const list = loadOutbox();
  if (list.length === 0) return 0;
  const now = Date.now();
  const remaining: OutboxEntry[] = [];
  let sent = 0;
  for (const e of list) {
    if (now - e.queuedAt > OUTBOX_TTL_MS) continue; // 过期丢弃
    if (integrationId && e.integrationId !== integrationId) { remaining.push(e); continue; }
    if (e.attempts >= OUTBOX_MAX_ATTEMPTS) continue; // 放弃
    if (await attemptSend(e)) {
      sent++;
      useDebugLog.getState().add('bot', `[Bot] 待发回复已补发 → ${e.integrationType}:${e.userId}「${e.text.slice(0, 30)}${e.text.length > 30 ? '…' : ''}」`);
    } else {
      e.attempts++;
      remaining.push(e);
    }
  }
  saveOutbox(remaining);
  return sent;
}

/** 入站活动：外部平台来消息 = 下行链路活着 → 标记在线并立即补发 */
export function notifyInbound(integrationId: string): void {
  if (connState[integrationId] !== 'online') {
    connState[integrationId] = 'online';
    useDebugLog.getState().add('bot', '[Bot] 收到外部消息，下行链路正常');
  }
  outboundFailStreak[integrationId] = 0;
  if (getOutboxSize() > 0) void flushOutbox(integrationId);
}

/** 出站成功：清失败计数；有待发队列则顺带补发（本次成功证明上行可用） */
export function markOutboundOk(integrationId: string): void {
  outboundFailStreak[integrationId] = 0;
  if (getOutboxSize() > 0) void flushOutbox(integrationId);
}

/** 出站失败：连续 2 次判定上行链路异常（只告警一次，直到恢复） */
export function markOutboundFail(integrationId: string): void {
  const n = (outboundFailStreak[integrationId] || 0) + 1;
  outboundFailStreak[integrationId] = n;
  if (n === 2) {
    useDebugLog.getState().add('bot', '[Bot] 连续外发失败，NapCat 可能已断开——回复进入待发队列，链路恢复后自动补发');
  }
}

/**
 * 启动看门狗（幂等）：监听 Rust bot-status 事件 + 60s 周期补发扫描。
 * bot-status 词表：connected=NapCat 接入 | disconnected/stopped=断开 |
 * listening=服务监听中（NapCat 尚未接入）| error=连接异常（自动重试中）
 */
export async function startBotWatchdog(): Promise<void> {
  if (started || !isRunningInTauri()) return;
  started = true;
  try {
    await listen<string>('bot-status', (event) => {
      try {
        const d = JSON.parse(event.payload) as { integrationId: string; status: string; message?: string };
        const prev = connState[d.integrationId] || 'unknown';
        if (d.status === 'connected') {
          connState[d.integrationId] = 'online';
          outboundFailStreak[d.integrationId] = 0;
          if (prev !== 'online') {
            useDebugLog.getState().add('bot', `[Bot] NapCat 已连接${d.message ? `（${d.message}）` : ''}${getOutboxSize() > 0 ? '，正在补发待发回复…' : ''}`);
          }
          void flushOutbox(d.integrationId);
        } else if (d.status === 'disconnected' || d.status === 'stopped') {
          if (prev !== 'offline') {
            connState[d.integrationId] = 'offline';
            useDebugLog.getState().add('bot', `[Bot] NapCat 连接${d.status === 'stopped' ? '已停止' : '断开'}${d.message ? `（${d.message}）` : ''}——期间生成的回复将进入待发队列，重连后自动补发`);
          }
        } else if (d.status === 'error') {
          if (prev !== 'offline') {
            connState[d.integrationId] = 'offline';
            useDebugLog.getState().add('bot', `[Bot] NapCat 连接异常：${d.message || ''}（自动重试中）`);
          }
        }
        // listening：NapCat 尚未接入，状态不变不刷日志
      } catch { /* 忽略单条事件解析失败 */ }
    });
  } catch { /* 非 Tauri 环境 */ }
  // 出站侧自愈：每 60 秒尝试补发一次待发队列
  sweepTimer = setInterval(() => {
    if (getOutboxSize() > 0) void flushOutbox();
  }, 60_000);
}

export function stopBotWatchdog(): void {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  started = false;
}
