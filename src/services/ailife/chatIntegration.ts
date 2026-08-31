/**
 * ============================================================
 * AI 一日 · 聊天联动（阶段 5）
 *  - buildLifeStatePrompt: 把当前活动/今日经历/变卦信息组装为
 *    【当前生活状态】文本块，双轨注入（浏览器拼 systemPrompt；
 *    Tauri 走 customSystemPrompt 随请求传给 Rust 追加）
 *  - getReplyDelayForActivity: 按活动类别模拟回复延迟
 *  - isSleepBlocked: 睡觉时段拦截回复（不调用、不回复）
 *  - maybeProactiveOnActivityStart / wakeUpCatchUp:
 *    活动开始概率性主动发消息；睡醒后轻描淡写带过积压消息
 * ============================================================
 */
import { useAiLifeStore } from '../../store/aiLifeStore';
import type { AiLifeActivity } from '../../lib/tauriBridge';
import { useDebugLog } from '../../store/debugLogStore';
import { useChatStore } from '../../store/chatStore';
import { checkGate, recordSent } from '../proactive/intentGate';
import { localDateKey } from './scheduleTemplates';

const CATEGORY_LABELS: Record<string, string> = {
  sleep: '睡觉', personal_care: '洗漱', meal: '吃饭', travel: '在路上',
  work: '工作', leisure: '休闲', social: '社交', rest: '休息', special: '特殊',
};

/** 当前生活素材：当前进行中活动 + 今日最近完成 + 下一个计划（供生活状态块与主动消息取材）。
 *  全部按本地日期/时间判定（✅ 修复：原今日经历用 UTC 日期取 key，晚 8 点后会取到错误的一天）。 */
export function getLifeNowMaterial(): {
  current: AiLifeActivity | null;
  lastDone: AiLifeActivity | null;
  next: AiLifeActivity | null;
} {
  const store = useAiLifeStore.getState();
  const now = new Date();
  const todayActs = (store.dayActivities[localDateKey(now)] || []).filter((a) => a.status !== 'cancelled');
  const lastDone = todayActs
    .filter((a) => a.endTime && new Date(a.endTime).getTime() <= now.getTime())
    .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime())[0] || null;
  const next = todayActs
    .filter((a) => a.startTime && new Date(a.startTime).getTime() > now.getTime())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0] || null;
  return { current: store.currentActivity, lastDone, next };
}

/** 当前生活状态 prompt 块（引擎未启用或无数据时返回空串） */
export function buildLifeStatePrompt(characterId?: string): string {
  const store = useAiLifeStore.getState();
  if (!store.config?.enabled || (characterId && store.config.characterId !== characterId)) return '';

  const lines: string[] = [];
  const { current, lastDone, next } = getLifeNowMaterial();

  if (current) {
    const elapsedMin = Math.max(0, Math.floor((Date.now() - new Date(current.startTime).getTime()) / 60000));
    lines.push(`正在：${current.name}（${CATEGORY_LABELS[current.category] || current.category}，地点：${current.location || '未指定'}，已进行 ${elapsedMin} 分钟）`);
    if (current.isChanged && current.changedFrom) {
      lines.push(`活动变卦：本来计划「${current.changedFrom}」，因为${current.changedReason || '某些原因'}改成了现在的安排`);
    }
  } else {
    // 🆕 P2-1：空闲时也给出时间方位（刚做完什么、等下做什么），回复与主动消息都有生活素材
    const parts: string[] = [];
    if (lastDone) parts.push(`刚做完「${lastDone.name}」`);
    if (next) parts.push(`等下要去「${next.name}」`);
    lines.push(parts.length > 0 ? `现在是空闲时间（${parts.join('，')}）` : '现在是空闲时间');
  }

  // 今日经历摘要（已完成活动的总结）——按本地日期取 key（UTC 修复见 getLifeNowMaterial）
  const todayActs = store.dayActivities[localDateKey(new Date())] || [];
  const done = todayActs.filter((a) => a.status === 'completed' && (a.summary || a.processDescription));
  if (done.length > 0) {
    lines.push('今天已经历：');
    for (const a of done.slice(-4)) {
      lines.push(`- ${a.name}：${(a.summary || a.processDescription || '').slice(0, 50)}`);
    }
  }

  if (lines.length === 0) return '';

  return [
    '\n【当前生活状态】',
    ...lines,
    '请让你的回复自然体现以上状态（如正在忙就简短回复，睡觉则不该有此段）。',
  ].join('\n');
}

// ---------------- 回复延迟模拟 ----------------

/** 温和版延迟映射（毫秒）：保持"在忙"的感觉但不至于让用户干等数分钟 */
const DELAY_BY_CATEGORY: Record<string, number> = {
  work: 8000,
  travel: 10000,
  meal: 12000,
  personal_care: 15000,
  leisure: 5000,
  rest: 6000,
  social: 0,
};

export function getReplyDelayForActivity(activity: AiLifeActivity | null, fallback: number): number {
  if (!activity) return fallback;
  const d = DELAY_BY_CATEGORY[activity.category];
  return typeof d === 'number' ? d : fallback;
}

// ---------------- 睡眠门控 ----------------

/** 是否处于睡眠时段（不回复、不调用 LLM；顶部状态条负责展示） */
export function isSleepBlocked(): boolean {
  const act = useAiLifeStore.getState().currentActivity;
  return !!act && act.category === 'sleep' && act.endTime > new Date().toISOString();
}

// ---------------- 睡眠积压消息 ----------------

let pendingDuringSleep = 0;

export function markSleepPendingMessage(): void {
  pendingDuringSleep += 1;
}

export function consumeSleepPendingCount(): number {
  const n = pendingDuringSleep;
  pendingDuringSleep = 0;
  return n;
}

// ---------------- 主动消息 ----------------

type SendTaskFn = (characterId: string, payload: string) => Promise<boolean>;

/**
 * 🆕 随机应变：构建"最近对话实况"提示块，供主动消息感知真实聊天状态——
 * 修复"前面聊了很久，突然冒一句'你醒了吗'"：主动消息此前完全不知道用户刚聊过，
 * LLM 只能凭 payload 想象场景，产出与实际脱节的模板化问候。
 */
function buildRecentChatHint(characterId: string): string {
  try {
    const conv = useChatStore.getState().conversations
      .filter(c => c.characterId === characterId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (!conv || !conv.messages || conv.messages.length === 0) return '';

    const msgs = conv.messages;
    const last = msgs[msgs.length - 1];
    const gapMin = Math.max(0, Math.floor((Date.now() - new Date(last.timestamp).getTime()) / 60000));
    const who = last.sender === 'user' ? '用户' : '你';
    const gapText = gapMin === 0 ? '刚刚' : gapMin < 60 ? `${gapMin} 分钟前` : `${Math.floor(gapMin / 60)} 小时前`;

    let hint = `\n【最近对话实况】最后一条消息是${gapText}，${who}说："${last.content.slice(0, 60)}"。`;
    if (gapMin <= 5 && last.sender === 'user') {
      hint += '用户刚刚还在和你聊天——绝对禁止发"在吗/醒了吗/你睡了吗"这类空洞问候，应衔接刚才的话题，或自然解释你刚才为什么没顾上回复。';
    }
    const recent = msgs.slice(-4)
      .map(m => `${m.sender === 'user' ? '用户' : '你'}: ${m.content.slice(0, 40)}`)
      .join(' / ');
    hint += `\n最近聊过：${recent}`;
    return hint;
  } catch {
    return '';
  }
}

/**
 * 活动开始时的概率性主动消息。
 * eventFrequency: off=0% / low=10% / medium=25% / high=45%
 */
export async function maybeProactiveOnActivityStart(
  characterId: string,
  activity: AiLifeActivity,
  sendTaskMessage: SendTaskFn,
): Promise<void> {
  const config = useAiLifeStore.getState().config;
  if (!config?.enabled) return;
  if (activity.category === 'sleep') return; // 睡觉不发

  const chance = { off: 0, low: 0.1, medium: 0.25, high: 0.45 }[config.eventFrequency] ?? 0.15;
  if (Math.random() >= chance) return;

  // 🆕 B2: 统一闸门——活动分享属优先级3，受全局预算/退避约束
  const gate = checkGate({ source: 'ai-life', priority: 3, reason: `活动开始: ${activity.name}`, characterId, payload: '' });
  if (!gate.allowed) {
    useDebugLog.getState().add('proactive', `[闸门] 活动主动被拦截: ${gate.reason}`, { characterId });
    return;
  }

  const payload = `你刚开始「${activity.name}」（${CATEGORY_LABELS[activity.category] || ''}）。如果合适的话，给用户随手发一条和当前活动相关的短消息（50字以内，自然口语，符合你的性格）。如果不适合打扰就说一句简单的日常分享。${buildRecentChatHint(characterId)}`;
  try {
    const sent = await sendTaskMessage(characterId, payload);
    if (sent) recordSent({ source: 'ai-life', priority: 3, reason: `活动开始: ${activity.name}`, characterId, payload: '' });
    useDebugLog.getState().add('proactive', `[AI-Life] 活动主动消息${sent ? '已发送' : '未发送'}: ${activity.name}`, { characterId });
  } catch { /* 静默 */ }
}

/**
 * 睡醒后轻描淡写带过睡眠期间的积压消息（不逐条回复）。
 */
export async function wakeUpCatchUp(
  characterId: string,
  sendTaskMessage: SendTaskFn,
): Promise<void> {
  const count = consumeSleepPendingCount();
  if (count <= 0) return;
  const payload = `你刚睡醒。你睡觉的时候用户给你发了 ${count} 条消息。请在开场简短自然地提到这一点并带过（比如"刚看到消息"），不要逐条回复，一两句话就好。${buildRecentChatHint(characterId)}`;
  try {
    await sendTaskMessage(characterId, payload);
    useDebugLog.getState().add('proactive', `[AI-Life] 醒来带过 ${count} 条积压消息`, { characterId });
  } catch { /* 静默 */ }
}
