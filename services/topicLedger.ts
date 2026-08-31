/**
 * ============================================================
 * 话题账本（Topic Ledger）
 *
 * 解决"AI 重复做同一件事"：用户说过"吃饭"，之后主动消息全是"吃饭了没"。
 * 每轮 Rust 认知链输出「话题 / Topic:」（2-6字），由 chatStore 在回复完成后
 * 记入本账本（localStorage 持久化，按角色隔离）。
 *
 * 重复判定时间函数（供主动回复 prompt 注入）：
 *   - fresh    (< 1h)   刚聊过 → 严禁再主动问
 *   - cooldown (1h~24h) 当天聊过 → 不宜主动再提，被问到可自然接续
 *   - stale    (> 24h)  已隔天 → 可作为"上次聊到…"自然重温（限 1 次）
 * ============================================================
 */

interface TopicEntry {
  topic: string;
  /** 最近一次聊到该话题的时间戳 */
  ts: number;
  /** 累计聊到次数 */
  count: number;
}

interface LedgerState {
  /** characterId → 话题条目（按 ts 降序） */
  [characterId: string]: TopicEntry[];
}

const STORAGE_KEY = 'topicLedger:v1';
/** 账本容量上限（每角色保留最近话题数） */
const MAX_ENTRIES = 30;
/** 🆕 P2-2 时间窗配置独立持久化 key */
const CONFIG_KEY = 'topicLedgerConfig:v1';

/** 🆕 P2-2 可配置时间窗（默认值即原内置常量；修改走 configureTopicLedger） */
export interface TopicLedgerConfig {
  /** fresh 阈值（分钟）：此窗口内聊过 → 严禁主动再提 */
  freshMinutes: number;
  /** cooldown 阈值（分钟）：fresh ~ 此窗口内聊过 → 当天聊过，不宜主动再提 */
  cooldownMinutes: number;
  /** 遗忘保留天数（遗忘曲线）：超过该时长的账目在下次记账时自动淘汰 */
  retentionDays: number;
}

const DEFAULT_CONFIG: TopicLedgerConfig = { freshMinutes: 60, cooldownMinutes: 24 * 60, retentionDays: 7 };

function loadConfig(): TopicLedgerConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<TopicLedgerConfig>) };
  } catch { /* 损坏即用默认 */ }
  return { ...DEFAULT_CONFIG };
}

// 模块加载即恢复配置（非浏览器环境 loadConfig 内部已兜底）
let cfg: TopicLedgerConfig = loadConfig();

/** 修改时间窗/保留期配置并持久化；传空对象仅回读当前配置 */
export function configureTopicLedger(patch: Partial<TopicLedgerConfig>): TopicLedgerConfig {
  cfg = { ...cfg, ...patch };
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch { /* 静默 */ }
  return { ...cfg };
}

/** 读取当前话题账本配置 */
export function getTopicLedgerConfig(): TopicLedgerConfig {
  return { ...cfg };
}

function freshMs(): number { return cfg.freshMinutes * 60 * 1000; }
function cooldownMs(): number { return cfg.cooldownMinutes * 60 * 1000; }

export type TopicAge = 'fresh' | 'cooldown' | 'stale' | 'unknown';

function load(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as LedgerState;
  } catch { /* 损坏即重置 */ }
  return {};
}

function save(s: LedgerState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* 静默 */ }
}

/** 记录一轮对话的话题（空话题忽略；同话题合并并刷新时间戳） */
export function recordTopic(characterId: string, topic: string): void {
  const t = topic.trim();
  if (!characterId || !t) return;
  const s = load();
  const list = s[characterId] ?? [];
  const idx = list.findIndex((e) => e.topic === t);
  if (idx >= 0) {
    const e = list[idx];
    e.ts = Date.now();
    e.count += 1;
    list.splice(idx, 1);
    list.unshift(e);
  } else {
    list.unshift({ topic: t, ts: Date.now(), count: 1 });
  }
  // 🆕 P2-2 遗忘曲线：超过保留期的账目自动淘汰（保留期可在配置中调整）
  const retentionMs = Math.max(1, cfg.retentionDays) * 24 * 60 * 60 * 1000;
  s[characterId] = list.filter((e) => Date.now() - e.ts < retentionMs).slice(0, MAX_ENTRIES);
  save(s);
}

/** 获取某角色最近的话题账目（按时间降序） */
export function getRecentTopics(characterId: string, limit = 10): TopicEntry[] {
  const list = load()[characterId] ?? [];
  return list.slice(0, limit);
}

/** 判定话题的新鲜度（重复判定时间函数）；entries 传入时只查该列表 */
export function classifyTopicAge(topic: string, entries?: TopicEntry[]): TopicAge {
  const t = topic.trim();
  if (!t) return 'unknown';
  if (entries) {
    const hit = entries.find((e) => e.topic === t);
    if (!hit) return 'unknown';
    return ageOf(Date.now() - hit.ts);
  }
  const state = load();
  for (const list of Object.values(state)) {
    const hit = list.find((e) => e.topic === t);
    if (hit) return ageOf(Date.now() - hit.ts);
  }
  return 'unknown';
}

function ageOf(ageMs: number): TopicAge {
  if (ageMs < freshMs()) return 'fresh';
  if (ageMs < cooldownMs()) return 'cooldown';
  return 'stale';
}

function ageLabel(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 10 * 60 * 1000) return '几分钟前';
  if (ms < freshMs()) return `${Math.floor(ms / 60 / 1000)}分钟前`;
  if (ms < cooldownMs()) {
    const h = Math.floor(ms / 60 / 60 / 1000);
    return `${h}小时前`;
  }
  const d = Math.floor(ms / 24 / 60 / 60 / 1000);
  return `${d}天前`;
}

/**
 * 构建注入主动回复 prompt 的话题账本片段。
 * 规则随账目一起写入，让模型自行遵守时间函数：
 *   1小时内聊过 → 严禁再主动问；
 *   1~24小时 → 不要主动再提；
 *   超过1天 → 可以"上次聊到…"的方式自然重温，但也只允许一次。
 */
export function buildTopicLedgerPrompt(characterId: string): string {
  const entries = getRecentTopics(characterId, 8);
  if (entries.length === 0) return '';
  const lines = entries.map((e) => `- ${e.topic}（${ageLabel(e.ts)}，聊过${e.count}次）`);
  // 🆕 P2-2: 规则文本跟随配置的时间窗生成
  const freshLabel = cfg.freshMinutes >= 60 ? `${Math.round(cfg.freshMinutes / 60)}小时` : `${cfg.freshMinutes}分钟`;
  const cooldownLabel = cfg.cooldownMinutes >= 1440
    ? `${Math.round(cfg.cooldownMinutes / 1440)}天`
    : `${Math.round(cfg.cooldownMinutes / 60)}小时`;
  return [
    '【话题账本 / Topic Ledger】以下是你们最近聊过的话题及时间：',
    ...lines,
    `规则：${freshLabel}内聊过的话题严禁再主动提起；${cooldownLabel}内聊过的话题不要主动再问；`
    + `超过${cooldownLabel}的话题最多以"上次你说的…"方式重温一次，且只有真的有新内容可接时才提。`
    + '禁止反复追问同一件事（例如对方吃过饭之后还连续问"吃饭了没"）。',
  ].join('\n');
}

/** 清空账本（调试用） */
export function clearTopicLedger(characterId?: string): void {
  if (!characterId) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const s = load();
  delete s[characterId];
  save(s);
}
