/**
 * ============================================================
 * AI 一日生活 · IndexedDB 双后端（B1.1）
 * 浏览器（非 Tauri）模式下承接全部 ailife 数据读写，
 * 表语义与 SQLite 对齐（activities/config/inventory/economy/diaries/
 * events/proposals/attributes/transactions）。
 * 原则：一个环境只写一个后端——Tauri 写 SQLite，浏览器写 IndexedDB。
 * 键空间：ailife:{table}:{characterId}（提案表用 ailife:proposals:all）。
 * ============================================================
 */
import { idbGet, idbSet } from './idb';
import type {
  AiLifeActivity, AiLifeConfig, AiLifeEvent, AiContentProposal,
  AiLifeDiaryRecord, AiInventoryItem,
} from './tauriBridge';

const K = {
  config: (c: string) => `ailife:config:${c}`,
  activities: (c: string) => `ailife:activities:${c}`,
  events: (c: string) => `ailife:events:${c}`,
  proposals: () => 'ailife:proposals:all',
  diaries: (c: string) => `ailife:diaries:${c}`,
  attributes: (c: string) => `ailife:attributes:${c}`,
  inventory: (c: string) => `ailife:inventory:${c}`,
  economy: (c: string) => `ailife:economy:${c}`,
  transactions: (c: string) => `ailife:transactions:${c}`,
};

const dayKey = (iso: string) => iso.slice(0, 10);

// ---------- 活动 ----------

export async function idbGetAiActivities(
  characterId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<AiLifeActivity[]> {
  const all = (await idbGet<AiLifeActivity[]>(K.activities(characterId))) || [];
  return all
    .filter((a) => {
      const d = dayKey(a.startTime);
      if (dateFrom && d < dayKey(dateFrom)) return false;
      if (dateTo && d > dayKey(dateTo)) return false;
      return true;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function idbBatchSaveAiActivities(activities: AiLifeActivity[]): Promise<void> {
  if (activities.length === 0) return;
  // 按角色分组 upsert（以 id 去重）
  const byChar = new Map<string, AiLifeActivity[]>();
  for (const a of activities) {
    const list = byChar.get(a.characterId) || [];
    list.push(a);
    byChar.set(a.characterId, list);
  }
  for (const [charId, incoming] of byChar) {
    const key = K.activities(charId);
    await idbRegisterKey(key);
    const existing = (await idbGet<AiLifeActivity[]>(key)) || [];
    const map = new Map(existing.map((a) => [a.id, a]));
    for (const a of incoming) map.set(a.id, a);
    await idbSet(key, Array.from(map.values()));
  }
}

export async function idbDeleteAiActivitiesByDate(characterId: string, dateFrom: string, dateTo: string): Promise<void> {
  const all = (await idbGet<AiLifeActivity[]>(K.activities(characterId))) || [];
  const kept = all.filter((a) => {
    const d = dayKey(a.startTime);
    return d < dayKey(dateFrom) || d > dayKey(dateTo);
  });
  await idbSet(K.activities(characterId), kept);
}

export async function idbGetCurrentAiActivity(characterId: string, now?: string): Promise<AiLifeActivity | null> {
  const ts = now || new Date().toISOString();
  const all = await idbGetAiActivities(characterId);
  return all.find((a) => a.status === 'ongoing' && a.startTime <= ts && a.endTime >= ts) || null;
}

export async function idbUpdateAiActivityStatus(id: string, status: string): Promise<void> {
  // id 不含角色信息 → 扫描键空间内的活动表
  // （浏览器模式活动键数量有限，可接受；写入时按 characterId 分组）
  const keys = await idbKeysByPrefix('ailife:activities:');
  for (const key of keys) {
    const list = (await idbGet<AiLifeActivity[]>(key)) || [];
    let changed = false;
    for (const a of list) {
      if (a.id === id) { a.status = status; a.updatedAt = new Date().toISOString(); changed = true; }
    }
    if (changed) { await idbSet(key, list); return; }
  }
}

export async function idbGetAiActivitiesAvailableDates(characterId?: string): Promise<string[]> {
  const dates = new Set<string>();
  if (characterId) {
    for (const a of (await idbGet<AiLifeActivity[]>(K.activities(characterId))) || []) dates.add(dayKey(a.startTime));
  } else {
    for (const key of await idbKeysByPrefix('ailife:activities:')) {
      for (const a of (await idbGet<AiLifeActivity[]>(key)) || []) dates.add(dayKey(a.startTime));
    }
  }
  return Array.from(dates).sort().reverse();
}

// ---------- 生活配置（启动门禁） ----------

export async function idbGetAiLifeConfig(characterId: string): Promise<AiLifeConfig | null> {
  return (await idbGet<AiLifeConfig>(K.config(characterId))) ?? null;
}

export async function idbSaveAiLifeConfig(config: AiLifeConfig): Promise<void> {
  await idbSet(K.config(config.characterId), { ...config, updatedAt: new Date().toISOString() });
}

// ---------- 生活事件流 ----------

export async function idbBatchSaveAiLifeEvents(events: AiLifeEvent[]): Promise<void> {
  if (events.length === 0) return;
  const byChar = new Map<string, AiLifeEvent[]>();
  for (const e of events) {
    const list = byChar.get(e.characterId) || [];
    list.push(e);
    byChar.set(e.characterId, list);
  }
  for (const [charId, incoming] of byChar) {
    const key = K.events(charId);
    await idbRegisterKey(key);
    const existing = (await idbGet<AiLifeEvent[]>(key)) || [];
    const map = new Map(existing.map((e) => [e.id, e]));
    for (const e of incoming) map.set(e.id, e);
    await idbSet(key, Array.from(map.values()));
  }
}

export async function idbGetAiLifeEvents(characterId: string, tsFrom?: string, tsTo?: string, limit?: number): Promise<AiLifeEvent[]> {
  const all = (await idbGet<AiLifeEvent[]>(K.events(characterId))) || [];
  const filtered = all
    .filter((e) => {
      if (tsFrom && e.ts < tsFrom) return false;
      if (tsTo && e.ts > tsTo) return false;
      return true;
    })
    .sort((a, b) => b.ts.localeCompare(a.ts));
  return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
}

export async function idbMarkAiLifeEventsInjected(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  for (const key of await idbKeysByPrefix('ailife:events:')) {
    const list = (await idbGet<AiLifeEvent[]>(key)) || [];
    let changed = false;
    for (const e of list) {
      if (idSet.has(e.id)) { e.injectedIntoChat = true; changed = true; }
    }
    if (changed) await idbSet(key, list);
  }
}

// ---------- 内容提案 ----------

export async function idbSaveAiContentProposals(proposals: AiContentProposal[]): Promise<void> {
  if (proposals.length === 0) return;
  const existing = (await idbGet<AiContentProposal[]>(K.proposals())) || [];
  const map = new Map(existing.map((p) => [p.id, p]));
  for (const p of proposals) map.set(p.id, p);
  await idbSet(K.proposals(), Array.from(map.values()));
}

export async function idbGetAiContentProposals(characterId?: string, status?: string, limit?: number): Promise<AiContentProposal[]> {
  const all = (await idbGet<AiContentProposal[]>(K.proposals())) || [];
  const filtered = all
    .filter((p) => (!characterId || p.characterId === characterId) && (!status || p.status === status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
}

export async function idbDecideAiContentProposal(id: string, status: 'approved' | 'rejected' | 'retired'): Promise<void> {
  const all = (await idbGet<AiContentProposal[]>(K.proposals())) || [];
  for (const p of all) {
    if (p.id === id) { p.status = status; p.decidedAt = new Date().toISOString(); }
  }
  await idbSet(K.proposals(), all);
}

// ---------- 日记 ----------

export async function idbGetAiDiaries(characterId: string, dateFrom?: string, dateTo?: string): Promise<AiLifeDiaryRecord[]> {
  const all = (await idbGet<AiLifeDiaryRecord[]>(K.diaries(characterId))) || [];
  return all
    .filter((d) => {
      if (dateFrom && d.date < dateFrom) return false;
      if (dateTo && d.date > dateTo) return false;
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function idbSaveAiDiary(diary: AiLifeDiaryRecord): Promise<void> {
  const key = K.diaries(diary.characterId);
  await idbRegisterKey(key);
  const all = (await idbGet<AiLifeDiaryRecord[]>(key)) || [];
  const map = new Map(all.map((d) => [d.id, d]));
  map.set(diary.id, diary);
  await idbSet(key, Array.from(map.values()));
}

export async function idbDeleteAiDiaryRecord(id: string): Promise<void> {
  for (const key of await idbKeysByPrefix('ailife:diaries:')) {
    const list = (await idbGet<AiLifeDiaryRecord[]>(key)) || [];
    const kept = list.filter((d) => d.id !== id);
    if (kept.length !== list.length) { await idbSet(key, kept); return; }
  }
}

// ---------- 属性 ----------

export async function idbGetAiAttributes<T>(characterId: string): Promise<T | null> {
  return (await idbGet<T>(K.attributes(characterId))) ?? null;
}

export async function idbSaveAiAttributes<T extends { characterId: string }>(snapshot: T): Promise<void> {
  await idbSet(K.attributes(snapshot.characterId), snapshot);
}

// ---------- 物资 ----------

export async function idbGetAiInventory(characterId: string): Promise<AiInventoryItem[]> {
  return (await idbGet<AiInventoryItem[]>(K.inventory(characterId))) || [];
}

export async function idbSaveAiInventoryItems(items: AiInventoryItem[]): Promise<void> {
  if (items.length === 0) return;
  const byChar = new Map<string, AiInventoryItem[]>();
  for (const it of items) {
    const list = byChar.get(it.characterId) || [];
    list.push(it);
    byChar.set(it.characterId, list);
  }
  for (const [charId, incoming] of byChar) {
    const key = K.inventory(charId);
    await idbRegisterKey(key);
    const existing = (await idbGet<AiInventoryItem[]>(key)) || [];
    const map = new Map(existing.map((it) => [it.id, it]));
    for (const it of incoming) map.set(it.id, it);
    await idbSet(key, Array.from(map.values()));
  }
}

export async function idbDeleteAiInventoryItem(id: string): Promise<void> {
  for (const key of await idbKeysByPrefix('ailife:inventory:')) {
    const list = (await idbGet<AiInventoryItem[]>(key)) || [];
    const kept = list.filter((it) => it.id !== id);
    if (kept.length !== list.length) { await idbSet(key, kept); return; }
  }
}

// ---------- 经济 ----------

export async function idbGetAiEconomy<T>(characterId: string): Promise<T | null> {
  return (await idbGet<T>(K.economy(characterId))) ?? null;
}

export async function idbSaveAiEconomy<T extends { characterId: string }>(economy: T): Promise<void> {
  await idbSet(K.economy(economy.characterId), economy);
}

export async function idbAddAiTransaction<T extends { characterId: string; id: string }>(tx: T): Promise<void> {
  const all = (await idbGet<T[]>(K.transactions(tx.characterId))) || [];
  all.unshift(tx);
  await idbSet(K.transactions(tx.characterId), all.slice(0, 500));
}

export async function idbGetAiTransactions<T>(characterId: string, limit = 30): Promise<T[]> {
  const all = (await idbGet<T[]>(K.transactions(characterId))) || [];
  return all.slice(0, limit);
}

// ---------- 工具 ----------

/** 前缀扫描（IndexedDB KV 无原生索引，键空间小可接受） */
async function idbKeysByPrefix(prefix: string): Promise<string[]> {
  // 复用 kv store：IDB 不支持 key cursor via idbGet，这里扫描已知角色键不可行；
  // 采用注册表：所有 ailife 角色键写入注册表
  const registry = (await idbGet<string[]>('ailife:registry')) || [];
  return registry.filter((k) => k.startsWith(prefix));
}

/** 注册键（各 save 入口调用，保证前缀扫描可用） */
export async function idbRegisterKey(key: string): Promise<void> {
  const registry = (await idbGet<string[]>('ailife:registry')) || [];
  if (!registry.includes(key)) {
    registry.push(key);
    await idbSet('ailife:registry', registry);
  }
}
