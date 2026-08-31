/**
 * ============================================================
 * D4: 创意工坊（应用内生长循环）
 *  - 提案：睡眠固化时回顾当天真实经历（事件流），生成 1~3 条新事件/商品候选，
 *    以完整 schema 存 ai_content_proposals 表
 *  - 审核：面板展示"她提议了 N 个新内容"，批准/拒绝；批准入池并标记 approved
 *  - 边界：AI 只能扩充数据（事件/商品），永不能生成代码或改模块行为；限频每周 ≤3 条
 *  - 淘汰：连坐机制由 D1 审计反向作用（命中率数据可见）
 * ============================================================
 */
import { useAiLifeStore } from '../../store/aiLifeStore';
import { useDebugLog } from '../../store/debugLogStore';
import { useCharacterStore } from '../../store/characterStore';
import {
  dbGetAiLifeEvents, dbSaveAiContentProposals, dbGetAiContentProposals,
  AiContentProposal, AiLifeEvent,
} from '../../lib/tauriBridge';
import { getCallSetting } from './llmCalls';
import { runAilifeLlm } from './contentGenerator';
import { localDateKey } from './scheduleTemplates';
import { addCustomRandomEvent } from './randomEvents';
import { addCustomShopItem } from './localShop';
import type { RandomEventDef } from './randomEvents';

const WEEKLY_LIMIT = 3;

/** 提案生成入口：睡眠固化窗口调用（限频内置，静默失败） */
export async function generateContentProposals(characterId: string): Promise<void> {
  const store = useAiLifeStore.getState();
  const config = store.config;
  if (!config?.enabled) return;
  // 随机事件 LLM 子开关关闭 → 创意工坊一并不触发（自学习类功能关闭必须完全禁止 LLM 调用）
  if (!getCallSetting(config, 'randomEvent').enabled) return;

  // 限频：最近 7 天已产出（含 pending/approved/rejected 的全部提案）≥3 条则跳过
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const recent = await dbGetAiContentProposals(characterId).catch(() => [] as AiContentProposal[]);
  const weeklyCount = recent.filter((p) => p.createdAt >= weekAgo).length;
  if (weeklyCount >= WEEKLY_LIMIT) return;

  const char = useCharacterStore.getState().characters.find((c) => c.id === characterId);
  if (!char) return;

  // 当天真实经历：事件流 + 进行中活动名
  const todayKey = localDateKey(new Date());
  const dayStartIso = new Date(`${todayKey}T00:00:00`).toISOString();
  const events = await dbGetAiLifeEvents(characterId, dayStartIso).catch(() => [] as AiLifeEvent[]);
  const experienceText = events.slice(-8).map((e) => e.description).join('；') || '平常的一天，没什么特别的事';

  try {
    const prompt = `你是「${char.name}」（人设：${char.personality || ''}）。
今天你经历了这些小事：${experienceText}。
请从这些真实经历里提炼出 1~2 个你希望添加到自己生活里的「新小事件」，让日子更有味道。
只输出 JSON 数组（最多2条），每条：
{"name":"事件名(12字内)","category":"positive/neutral/negative/social/milestone","moodKey":"joy/sadness/anger/fear/surprise/anticipation","moodDelta":-6到6整数,"reason":"为什么想加它(20字内)"}
要求：贴合人设与今天发生的事，具体而微小，不要夸张，不要重复已有事件。`;

    const out = await runAilifeLlm('randomEvent', characterId, prompt, 300);
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) return;
    const parsed = JSON.parse(m[0]) as Array<{
      name?: string; category?: string; moodKey?: string; moodDelta?: number | string; reason?: string;
    }>;
    if (!Array.isArray(parsed)) return;

    const proposals: AiContentProposal[] = [];
    for (const p of parsed.slice(0, 2)) {
      const name = typeof p.name === 'string' ? p.name.trim().slice(0, 16) : '';
      if (!name) continue;
      if (recent.some((r) => r.title === name)) continue; // 不重复提案
      let moodDelta = typeof p.moodDelta === 'number' ? p.moodDelta : parseInt(String(p.moodDelta ?? 0), 10);
      if (!Number.isFinite(moodDelta)) moodDelta = 0;
      moodDelta = Math.max(-6, Math.min(6, moodDelta));
      proposals.push({
        id: `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        characterId,
        kind: 'random_event',
        title: name,
        payload: {
          name,
          category: ['positive', 'neutral', 'negative', 'social', 'milestone'].includes(String(p.category))
            ? p.category : 'neutral',
          mood: typeof p.moodKey === 'string' && moodDelta !== 0 ? { [p.moodKey]: moodDelta } : {},
        },
        reason: String(p.reason || '').slice(0, 60),
        status: 'pending',
        createdAt: new Date().toISOString(),
        decidedAt: '',
      });
    }
    if (proposals.length === 0) return;
    await dbSaveAiContentProposals(proposals);
    useDebugLog.getState().add('ailife', `[AI-Life][创意工坊] 睡眠构思出 ${proposals.length} 条新事件提议，等待审核`, { characterId });
  } catch { /* 静默 */ }
}

/** 批准提案：入池（随机事件池 / 自定义商店）+ 落账 approved */
export async function approveProposal(proposal: AiContentProposal): Promise<void> {
  try {
    if (proposal.kind === 'shop_item') {
      const payload = (proposal.payload || {}) as Partial<{ name: string; category: string; price: number; description: string }>;
      addCustomShopItem({
        name: proposal.title,
        category: payload.category || 'daily',
        tags: [],
        price: Math.max(1, Math.min(9999, Number(payload.price) || 30)),
        description: payload.description || `${useCharacterStore.getState().characters.find((c) => c.id === proposal.characterId)?.name || 'AI'}想要的东西`,
        stock: true,
      });
    } else {
      const payload = (proposal.payload || {}) as Partial<RandomEventDef>;
      addCustomRandomEvent({
        name: proposal.title,
        category: (['positive', 'neutral', 'negative', 'social', 'milestone'].includes(String(payload.category))
          ? payload.category : 'neutral') as RandomEventDef['category'],
        mood: (payload.mood && typeof payload.mood === 'object' ? payload.mood : {}) as Record<string, number>,
      });
    }
    await dbDecideSafe(proposal.id, 'approved');
    useDebugLog.getState().add('ailife', `[AI-Life][创意工坊] 已采纳提议「${proposal.title}」并入生活池`, { characterId: proposal.characterId });
  } catch { /* 静默 */ }
}

/** 拒绝提案：落账 rejected（不污染池子） */
export async function rejectProposal(proposal: AiContentProposal): Promise<void> {
  try {
    await dbDecideSafe(proposal.id, 'rejected');
  } catch { /* 静默 */ }
}

async function dbDecideSafe(id: string, status: 'approved' | 'rejected'): Promise<void> {
  const { dbDecideAiContentProposal } = await import('../../lib/tauriBridge');
  await dbDecideAiContentProposal(id, status);
}

/** 面板读取：pending 优先展示；附上该 AI 历史提案通过率 */
export async function getWorkshopOverview(characterId: string): Promise<{
  pending: AiContentProposal[];
  decidedRecent: AiContentProposal[];
  approvalRate: number;
}> {
  const all = await dbGetAiContentProposals(characterId).catch(() => [] as AiContentProposal[]);
  const approved = all.filter((p) => p.status === 'approved').length;
  const rejected = all.filter((p) => p.status === 'rejected').length;
  const decided = approved + rejected;
  return {
    pending: all.filter((p) => p.status === 'pending'),
    decidedRecent: all.filter((p) => p.status !== 'pending').slice(0, 10),
    approvalRate: decided > 0 ? Math.round((approved / decided) * 100) : -1,
  };
}
