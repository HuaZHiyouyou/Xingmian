/**
 * ============================================================
 * B4: 活动事件流（ai_life_events）
 *  - recordLifeEvent: 统一写入入口——落库（事件流表）+ DebugLog 镜像（日志面板按日可查）
 *  - injectedIntoChat 标记: 供 D1 消费审计（prompt 注入时记账）
 *  - 事件类型: meal | drink | consume | purchase | random_event | plan_change | milestone | fallback
 * ============================================================
 */
import { dbBatchSaveAiLifeEvents, AiLifeEvent } from '../../lib/tauriBridge';
import { generateId } from '../../utils/chatUtils';
import { useDebugLog } from '../../store/debugLogStore';

export type LifeEventType = AiLifeEvent['type'];

/** 记录一条生活事件：事件流是附属数据，任何失败静默（不影响主流程） */
export async function recordLifeEvent(params: {
  characterId: string;
  type: LifeEventType;
  description: string;
  activityId?: string;
  itemId?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const event: AiLifeEvent = {
    id: generateId(),
    ts: new Date().toISOString(),
    characterId: params.characterId,
    type: params.type,
    description: params.description,
    activityId: params.activityId || '',
    itemId: params.itemId || '',
    meta: params.meta,
    injectedIntoChat: false,
  };
  try {
    await dbBatchSaveAiLifeEvents([event]);
    useDebugLog.getState().add('ailife', `[事件:${event.type}] ${event.description}`, { characterId: event.characterId });
  } catch { /* 静默 */ }
}

/** 批量记录（少分配，一句话多条事件场景预留） */
export async function recordLifeEvents(events: Array<Parameters<typeof recordLifeEvent>[0]>): Promise<void> {
  if (events.length === 0) return;
  const rows: AiLifeEvent[] = events.map((p) => ({
    id: generateId(),
    ts: new Date().toISOString(),
    characterId: p.characterId,
    type: p.type,
    description: p.description,
    activityId: p.activityId || '',
    itemId: p.itemId || '',
    meta: p.meta,
    injectedIntoChat: false,
  }));
  try {
    await dbBatchSaveAiLifeEvents(rows);
    for (const e of rows) {
      useDebugLog.getState().add('ailife', `[事件:${e.type}] ${e.description}`, { characterId: e.characterId });
    }
  } catch { /* 静默 */ }
}
