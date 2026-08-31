import { useConfigStore } from '../store/configStore';
import { useModelRoleStore, ModelRole, MODEL_ROLE_LABELS, MODEL_ROLES } from '../store/modelRoleStore';
import { getLearningPrompt } from '../store/learningStore';
import { useDebugLog } from '../store/debugLogStore';
import { Character, Memory, Reflection, EmotionType, AffinityStage, MemoryEntry, MemoryCategory, MultiEmotionState } from '../types';
import { getDominantEmotion } from '../utils/emotionAnalyzer';
import { isRunningInTauri } from '../lib/tauriBridge';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// ========== Vector Embeddings ==========

export interface EmbeddingEntry {
  id: string;
  text: string;
  embedding: number[];
  createdAt: Date;
}

const embeddingCache: Record<string, EmbeddingEntry[]> = {};

type PlatformType = 'openai' | 'siliconflow' | 'deepseek' | 'groq' | 'gemini' | 'anthropic' | 'custom';

function detectPlatform(baseUrl: string, nameHint?: string): PlatformType {
  // 🔧 修复硬编码：优先按平台 displayName 关键字识别（URL 嗅探对 one-api/new-api 等中转站会误判）
  const name = (nameHint || '').toLowerCase();
  if (name) {
    if (name.includes('siliconflow') || name.includes('硅基')) return 'siliconflow';
    if (name.includes('deepseek')) return 'deepseek';
    if (name.includes('groq')) return 'groq';
    if (name.includes('gemini') || name.includes('google')) return 'gemini';
    if (name.includes('anthropic') || name.includes('claude')) return 'anthropic';
    if (name.includes('openai')) return 'openai';
  }
  const url = baseUrl.toLowerCase();
  if (url.includes('siliconflow')) return 'siliconflow';
  if (url.includes('deepseek')) return 'deepseek';
  if (url.includes('groq')) return 'groq';
  if (url.includes('google') || url.includes('gemini')) return 'gemini';
  if (url.includes('anthropic')) return 'anthropic';
  if (url.includes('openai')) return 'openai';
  return 'custom';
}

interface EmbeddingConfig {
  url: string;
  model: string;
  headers: Record<string, string>;
  bodyFormatter: (input: string | string[], model: string) => string;
  responseParser: (data: unknown) => number[] | number[][] | null;
  supported: boolean;
}

// 🔧 修复硬编码：各平台 embedding 默认模型仅作缺省值，可被平台配置的 embeddingModel 覆盖
function getEmbeddingConfig(platform: PlatformType, baseUrl: string, apiKey: string, modelOverride?: string): EmbeddingConfig {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  const defaultConfig: EmbeddingConfig = {
    url: `${baseUrl}/embeddings`,
    model: 'text-embedding-3-small',
    headers,
    bodyFormatter: (input, model) => JSON.stringify({ model, input }),
    responseParser: (data) => (data as { data?: Array<{ embedding?: number[] }> }).data?.[0]?.embedding || null,
    supported: true,
  };

  const withOverride = (c: EmbeddingConfig): EmbeddingConfig =>
    modelOverride ? { ...c, model: modelOverride } : c;

  switch (platform) {
    case 'openai':
      return withOverride({ ...defaultConfig, model: 'text-embedding-3-small' });
    case 'siliconflow':
      return withOverride({
        ...defaultConfig,
        model: 'BAAI/bge-large-zh-v1.5',
        url: `${baseUrl}/embeddings`,
      });
    case 'deepseek':
      return withOverride({ ...defaultConfig, model: 'deepseek-embedding' });
    case 'groq':
    case 'gemini':
    case 'anthropic':
      // 🔧 平台官方不支持 embedding 时，若显式配置了 embeddingModel 则按 OpenAI 兼容端点尝试
      return modelOverride
        ? withOverride({ ...defaultConfig, model: modelOverride })
        : { ...defaultConfig, supported: false };
    case 'custom':
    default:
      return withOverride(defaultConfig);
  }
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const config = getConfig();
  if (!config.apiKey) return null;

  // 🔧 修复硬编码：携带平台 displayName 辅助识别 + 支持平台级 embeddingModel 覆盖
  const { getFirstEnabledChatModel } = useConfigStore.getState();
  const chatModel = getFirstEnabledChatModel();
  const displayName = chatModel?.config.displayName;
  const modelOverride = chatModel?.config.embeddingModel;

  const platform = detectPlatform(config.baseUrl, displayName);
  const embConfig = getEmbeddingConfig(platform, config.baseUrl, config.apiKey, modelOverride);
  if (!embConfig.supported) return null;

  try {
    const response = await fetch(embConfig.url, {
      method: 'POST',
      headers: embConfig.headers,
      body: embConfig.bodyFormatter(text, embConfig.model),
    });

    if (!response.ok) {
      console.warn(`Embedding API error: ${response.status}`);
      return null;
    }
    const data = await response.json();
    const result = embConfig.responseParser(data);
    return Array.isArray(result) && result.length > 0 && Array.isArray(result[0]) ? result[0] : result as number[] | null;
  } catch (e) {
    console.warn('Embedding request failed:', e);
    return null;
  }
}

export async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  const config = getConfig();
  if (!config.apiKey || texts.length === 0) return texts.map(() => null);

  const platform = detectPlatform(config.baseUrl);
  const embConfig = getEmbeddingConfig(platform, config.baseUrl, config.apiKey);
  if (!embConfig.supported) return texts.map(() => null);

  try {
    const response = await fetch(embConfig.url, {
      method: 'POST',
      headers: embConfig.headers,
      body: embConfig.bodyFormatter(texts, embConfig.model),
    });

    if (!response.ok) {
      console.warn(`Embedding API batch error: ${response.status}`);
      return texts.map(() => null);
    }
    const data = await response.json();
    const embeddings = (data.data as Array<{ embedding?: number[] }> | undefined)?.map((d) => d.embedding) || [];
    return texts.map((_, i) => embeddings[i] || null);
  } catch (e) {
    console.warn('Embedding batch request failed:', e);
    return texts.map(() => null);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function getEmbeddingCache(characterId: string): EmbeddingEntry[] {
  return embeddingCache[characterId] || [];
}

export function setEmbeddingCache(characterId: string, entries: EmbeddingEntry[]) {
  embeddingCache[characterId] = entries;
}

export async function addMemoryEmbeddings(
  characterId: string,
  memories: Memory[],
): Promise<void> {
  const existing = getEmbeddingCache(characterId);
  const existingIds = new Set(existing.map(e => e.id));
  const newMemories = memories.filter(m => !existingIds.has(m.id));
  if (newMemories.length === 0) return;

  const texts = newMemories.map(m => m.content);
  const embeddings = await generateEmbeddings(texts);

  const newEntries: EmbeddingEntry[] = newMemories.map((m, i) => ({
    id: m.id,
    text: m.content,
    embedding: embeddings[i] || [],
    createdAt: m.createdAt,
  })).filter(e => e.embedding.length > 0);

  setEmbeddingCache(characterId, [...newEntries, ...existing]);
}

export function vectorSearchMemories(
  characterId: string,
  queryEmbedding: number[],
  topN: number = 3,
  memories?: Memory[],
): Memory[] {
  const cache = getEmbeddingCache(characterId);
  if (cache.length === 0 || queryEmbedding.length === 0) return [];

  const scored = cache
    .map(entry => ({
      entry,
      similarity: cosineSimilarity(queryEmbedding, entry.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);

  if (!memories) return scored.map(s => ({
    id: s.entry.id,
    characterId,
    conversationId: '',
    content: s.entry.text,
    importance: 5,
    tags: [],
    createdAt: s.entry.createdAt,
    recallCount: 0,
  }));

  const memoryMap = new Map(memories.map(m => [m.id, m]));
  return scored.map(s => memoryMap.get(s.entry.id)).filter(Boolean) as Memory[];
}

const REQUEST_TIMEOUT_MS = 180000; // 180s timeout for each fetch request

async function fetchWithTimeout(url: string, options: RequestInit & { timeout?: number }, externalSignal?: AbortSignal): Promise<Response> {
  const timeout = options.timeout ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const onExternalAbort = () => { controller.abort(); clearTimeout(timeoutId); };
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function getConfig(): AIConfig {
  const config = useConfigStore.getState();
  const chatModel = config.getFirstEnabledChatModel();

  if (chatModel) {
    return {
      apiKey: chatModel.config.apiKey,
      baseUrl: chatModel.config.baseUrl,
      model: chatModel.model.name,
    };
  }

  // 🔧 修复硬编码：不再假装配置了 OpenAI（原 fallback 会把请求发往 api.openai.com 必然失败且误导排查）。
  // 返回空配置，由调用方（doFetch/generateEmbedding 等）的 apiKey 守卫给出明确"未配置模型"提示。
  return {
    apiKey: '',
    baseUrl: '',
    model: '',
  };
}

export interface ReplyReadiness {
  ready: boolean;
  reason?: string;
}

/**
 * 回复管道就绪预检：判断当前配置下是否真的能完成一次 LLM 调用。
 * 用于发送消息前判断——未就绪时不进入"正在输入"等待态，避免指示器永久卡住。
 * 检查项（按顺序）：
 *  1. 是否开启了至少一个模型提供商
 *  2. 已开启的提供商是否填写了 API Key
 *  3. 是否存在已启用的聊天模型
 */
export function isReplyPipelineReady(): ReplyReadiness {
  const configStore = useConfigStore.getState();
  const platforms = configStore.platforms || [];
  if (!platforms.some(p => p.enabled)) {
    return { ready: false, reason: '未开启任何模型提供商，请在「API 配置」中启用平台' };
  }
  if (!platforms.some(p => p.enabled && p.apiKey)) {
    return { ready: false, reason: '已启用的平台缺少 API Key，请在「API 配置」中填写' };
  }
  if (configStore.getAllEnabledChatModels().length === 0) {
    return { ready: false, reason: '没有可用的聊天模型，请检查平台下的模型是否已启用' };
  }
  return { ready: true };
}

// ========== 🆕 A4: 模型连通性检测（真实请求 ping） ==========

export interface ModelConnectivityResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  model?: string;
  platform?: string;
}

/** 模块级缓存：TTL 内不重复 ping（避免每次进入聊天页都发真实请求） */
let _connCache: { result: ModelConnectivityResult; ts: number } | null = null;
const CONN_CACHE_TTL = 5 * 60 * 1000;

/** 使连通性缓存失效（用户修改配置/手动重试时调用） */
export function invalidateConnectivityCache(): void {
  _connCache = null;
}

/**
 * A4: 模型连通性检测——先跑配置级预检，通过后取全局第一个启用的聊天模型
 * 发一次 max_tokens=1 的真实请求。
 * - Tauri 下经 Rust `call_ai` 命令（与真实回复管线同路径）
 * - 非 Tauri 走 fetchWithTimeout
 */
export async function checkModelConnectivity(force = false): Promise<ModelConnectivityResult> {
  if (!force && _connCache && Date.now() - _connCache.ts < CONN_CACHE_TTL) {
    return _connCache.result;
  }

  const precheck = isReplyPipelineReady();
  if (!precheck.ready) {
    const r: ModelConnectivityResult = { ok: false, latencyMs: 0, error: precheck.reason };
    _connCache = { result: r, ts: Date.now() };
    return r;
  }

  // 🔧 修复#9：ping「对话主模型」（cognitive 角色分配）实际使用的模型，
  // 而不是全局第一个启用的聊天模型——否则用户给认知角色配了 longcat、
  // 头部却去 ping 另一个没在用的 gemini，造成"配置明明没问题却报模型连接异常"。
  const candidate = getRoleModels(MODEL_ROLES.COGNITIVE)[0];
  if (!candidate) {
    const r: ModelConnectivityResult = { ok: false, latencyMs: 0, error: '对话主模型未配置：请在「模型角色」设置中为对话主模型分配平台与模型' };
    _connCache = { result: r, ts: Date.now() };
    return r;
  }
  const platform = useConfigStore.getState().platforms.find(p => p.baseUrl === candidate.baseUrl);
  const body = buildRequestBody(
    candidate.model,
    [{ role: 'user', content: 'ping' }],
    0,
    1,
    false,
  );

  const t0 = performance.now();
  let result: ModelConnectivityResult;
  try {
    await doFetch(candidate.baseUrl, candidate.apiKey, body, '[连通性检测]');
    result = {
      ok: true,
      latencyMs: Math.round(performance.now() - t0),
      model: candidate.model,
      platform: platform?.displayName,
    };
  } catch (e) {
    result = {
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      error: e instanceof Error ? e.message : String(e),
      model: candidate.model,
      platform: platform?.displayName,
    };
  }
  _connCache = { result, ts: Date.now() };
  return result;
}

// ========== 多级候选 API 调用引擎 ==========

interface RoleModelCandidate {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 获取指定角色的所有候选模型(按优先级排序)。
 * 降级策略:
 *   1. 角色分配模型中已启用的
 *   2. 如果1为空,使用全局第一个启用的聊天模型
 *   3. 如果2也为空,返回空数组
 */
function getRoleModels(role: ModelRole): RoleModelCandidate[] {
  const configStore = useConfigStore.getState();
  const roleStore = useModelRoleStore.getState();
  const assignments = roleStore.assignments[role];
  const roleLabel = MODEL_ROLE_LABELS[role] || role;

  if (!assignments || assignments.length === 0) {
    const allModels = configStore.getAllEnabledChatModels();
    if (allModels.length > 0) {
      const modelNames = allModels.map(m => `${m.model.name} (${m.config.displayName})`).join(', ');
      console.warn(`[getRoleModels] 角色 "${roleLabel}" 未配置模型分配，使用全局可用模型: ${modelNames}`);
      return allModels.map(m => ({
        apiKey: m.config.apiKey,
        baseUrl: m.config.baseUrl,
        model: m.model.name,
      }));
    }
    console.warn(`[getRoleModels] 角色 "${roleLabel}" 无任何可用模型`);
    return [];
  }

  const candidates: RoleModelCandidate[] = [];
  for (const assignment of assignments) {
    const platform = assignment.platformBaseUrl
      ? configStore.platforms.find(p => p.baseUrl === assignment.platformBaseUrl)
      : configStore.platforms[assignment.platformIndex];
    if (!platform) {
      console.warn(`[getRoleModels] 角色 "${roleLabel}" 分配的模型 "${assignment.modelName}" 所在平台不存在（platformBaseUrl=${assignment.platformBaseUrl}, platformIndex=${assignment.platformIndex}），已跳过`);
      continue;
    }
    if (!platform.enabled) {
      console.warn(`[getRoleModels] 角色 "${roleLabel}" 分配的模型 "${assignment.modelName}" 所在平台 "${platform.displayName}" 未启用，已跳过`);
      continue;
    }
    if (!platform.apiKey) {
      console.warn(`[getRoleModels] 角色 "${roleLabel}" 分配的模型 "${assignment.modelName}" 所在平台 "${platform.displayName}" 未配置 API Key，已跳过`);
      continue;
    }
    const model = platform.models.find(m => m.name === assignment.modelName && m.enabled);
    if (!model) {
      console.warn(`[getRoleModels] 角色 "${roleLabel}" 分配的模型 "${assignment.modelName}" 在平台 "${platform.displayName}" 中未启用或不存在，已跳过`);
      continue;
    }
    candidates.push({
      apiKey: platform.apiKey,
      baseUrl: platform.baseUrl,
      model: model.name,
    });
  }

  // 所有分配模型都不可用 → 降级到所有平台上已启用的聊天模型
  if (candidates.length === 0) {
    const allModels = configStore.getAllEnabledChatModels();
    if (allModels.length > 0) {
      const modelNames = allModels.map(m => `${m.model.name} (${m.config.displayName})`).join(', ');
      console.warn(`[getRoleModels] 角色 "${roleLabel}" 所有分配模型均不可用，降级到全局可用模型: ${modelNames}`);
      return allModels.map(m => ({
        apiKey: m.config.apiKey,
        baseUrl: m.config.baseUrl,
        model: m.model.name,
      }));
    }
    console.warn(`[getRoleModels] 角色 "${roleLabel}" 无任何可用模型`);
  }

  return candidates;
}

/**
 * 🆕 严格检查某角色是否配置了“自己的”有效模型分配（不做全局降级）。
 * 用于 AI 一日等独立板块：未给对应角色（ailife）分配模型时视为未配置，
 * 由调用方降级为本地模板/本地逻辑，避免"没配置该板块的模型角色却仍调用 API"。
 */
export function isRoleModelReady(role: ModelRole): boolean {
  const configStore = useConfigStore.getState();
  const roleStore = useModelRoleStore.getState();
  const assignments = roleStore.assignments[role];
  if (!assignments || assignments.length === 0) return false;
  return assignments.some((a) => {
    const platform = a.platformBaseUrl
      ? configStore.platforms.find((p) => p.baseUrl === a.platformBaseUrl)
      : configStore.platforms[a.platformIndex];
    if (!platform || !platform.enabled || !platform.apiKey) return false;
    return platform.models.some((m) => m.name === a.modelName && m.enabled);
  });
}

type MessageContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

interface AIMessage {
  role: string;
  content: MessageContent;
}

/** 构建完整请求体 JSON */
function buildRequestBody(
  model: string,
  messages: AIMessage[],
  temperature: number,
  maxTokens: number | undefined,
  stream: boolean,
): string {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    stream,
  };
  // 不设置 max_tokens，让模型自由生成（Gemini 等推理模型需要大量 token 用于 thinking）
  // 仅在调用方明确指定时才设置
  if (maxTokens && maxTokens > 0) {
    body.max_tokens = maxTokens;
  }
  return JSON.stringify(body);
}

/** 发起一次请求(非流式),返回文本 */
async function doFetch(
  baseUrl: string,
  apiKey: string,
  body: string,
  candidateLabel: string,
): Promise<string> {
  // 🆕 Tauri 模式下 Rust 后端发起 HTTP，不阻塞 UI
  if (isRunningInTauri()) {
    const t0 = performance.now();
    try {
      const result = await invoke<string>('call_ai', { baseUrl, apiKey, body });
      useDebugLog.getState().add('pipeline', `[call_ai] ${candidateLabel}\n${result}`, { duration: Math.round(performance.now() - t0) });
      return result;
    } catch (e) {
      throw new Error(e as string);
    }
  }

  // 非 Tauri 环境退回到浏览器 fetch
  // 🔧 守卫：未配置模型时给出明确错误，而不是把空配置发往随机地址
  if (!baseUrl || !apiKey) {
    throw new Error('未配置启用的模型，请先在"设置 → 模型配置"中添加并启用模型');
  }
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errMsg =
      errorBody?.error?.message ||
      errorBody?.message ||
      JSON.stringify(errorBody) ||
      `HTTP ${response.status}`;
    throw new Error(errMsg);
  }

  const data = await response.json();
  const msg = data.choices?.[0]?.message;
  let content = msg?.content;

  // content 可能是 object（Gemini {parts: [...]} 格式）
  if (content && typeof content === 'object' && !Array.isArray(content)) {
      if (Array.isArray(content.parts)) {
        content = content.parts.map((p: { text?: string }) => p?.text || '').filter(Boolean).join('');
      } else if (typeof content.text === 'string') {
        content = content.text;
      } else {
        content = '';
      }
    }

  // content 可能是数组（Qwen / DashScope 某些模式）
  if (Array.isArray(content)) {
    content = content.map((p: unknown) => (typeof p === 'string' ? p : (p as { text?: string })?.text || '')).filter(Boolean).join('');
  }

  // 🆕 Bug2 修复：剥离 <think>/<thinking> 思考块（推理模型常把思考混在 content 里，
  // 导致活动描述/总结只剩"回忆过程+我应该怎么写"的思考文本，没有正文）
  if (typeof content === 'string' && content) {
    content = stripThinkBlocks(content);
  }

  if (content === null || content === undefined || (typeof content === 'string' && content.trim().length === 0)) {
    // content 不存在或剥离思考块后为空时，检查 reasoning_content（思考模型）
    // 🆕 Bug2 修复：reasoning 是思考过程不是正文，仅作为最后兜底返回（调用方有思考检测重试）
    if (msg?.reasoning_content) {
      content = stripThinkBlocks(String(msg.reasoning_content));
    } else if (msg?.reasoning) {
      content = stripThinkBlocks(String(msg.reasoning));
    }
  }
  // content 存在但为空字符串 → 模型没有生成实际回复
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    console.warn(`[doFetch] ${candidateLabel} returned empty:`, JSON.stringify(data).slice(0, 200));
    throw new Error('模型返回空内容');
  }
  return content;
}

/** 🆕 Bug2 修复：剥离 <think>/<thinking> 思考块与思考残留 */
export function stripThinkBlocks(text: string): string {
  let out = text;
  // 成对标签
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  // 只有开标签没有闭标签（截断）→ 开标签后的内容全部视为思考
  out = out.replace(/<think[^>]*>[\s\S]*$/i, '');
  out = out.replace(/<thinking[^>]*>[\s\S]*$/i, '');
  return out.trim();
}

/** 🆕 Bug2 修复：检测"输出只有思考没有正文"（如"让我想想…我应该以XX的设定写…"） */
export function looksLikeThinkingOnly(text: string): boolean {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 8) return false;
  const markers = [
    '让我', '我应该', '我需要', '我打算写', '思考过程', '要求是', '按照设定', '的设定写',
    '结合人设', '先分析', '分析一下', '首先我', '好的，我', '让我想想', '写一段', '输出格式',
  ];
  const hit = markers.filter((m) => t.includes(m)).length;
  // 命中 ≥2 个思考标记，或以思考开头且再命中 1 个 → 判为思考
  if (hit >= 2) return true;
  if (/^(让我|我应该|我需要|首先|好的|嗯，我)/.test(t) && hit >= 1) return true;
  return false;
}

/** 发起一次流式请求,通过回调推送 token */
async function doStreamFetch(
  baseUrl: string,
  apiKey: string,
  body: string,
  _candidateLabel: string,
  callbacks: { onToken: (t: string) => void; onComplete: (t: string) => void },
  signal?: AbortSignal,
): Promise<string> {
  // 🆕 Tauri 模式下 Rust 后端流式调用 + 事件推送，不阻塞 UI
  if (isRunningInTauri()) {
    const requestId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const unlisten: UnlistenFn[] = [];
    let fullText = '';

    try {
      return await new Promise<string>((resolve, reject) => {
        // 监听 token 事件（Rust 端发出 { token: string }）
        listen<{ token: string }>(`stream-token-${requestId}`, (event) => {
          const t = event.payload.token;
          fullText += t;
          callbacks.onToken(t);
        }).then(fn => unlisten.push(fn));

        // 监听完成事件（Rust 端发出 { full_text: string }）
        listen<{ full_text: string }>(`stream-complete-${requestId}`, (event) => {
          fullText = event.payload.full_text;
          callbacks.onComplete(fullText);
          resolve(fullText);
        }).then(fn => unlisten.push(fn));

        // 监听错误事件（Rust 端发出纯字符串）
        listen<string>(`stream-error-${requestId}`, (event) => {
          reject(new Error(event.payload));
        }).then(fn => unlisten.push(fn));

        // 启动 Rust 端的流式请求
        invoke('call_ai_stream', { requestId, baseUrl, apiKey, body })
          .catch((e) => reject(new Error(e as string)));
      });
    } finally {
      unlisten.forEach(fn => fn());
    }
  }

  // 非 Tauri 环境退回到浏览器流式 fetch
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
    timeout: 180000,
  }, signal);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const errMsg = errorBody?.error?.message || `HTTP ${response.status}`;
    throw new Error(errMsg);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取流式响应');

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    if (signal?.aborted) throw new DOMException('Generation cancelled', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          callbacks.onToken(delta);
        }
      } catch {
        // skip unparseable chunks
      }
    }
  }

  if (!fullText.trim()) {
    throw new Error('AI 返回空内容');
  }

  callbacks.onComplete(fullText);
  return fullText;
}

/** 将多模态消息降级为纯文本(移除图片) */
function stripMultimodal(msgs: AIMessage[]): AIMessage[] {
  return msgs.map(m => {
    if (!Array.isArray(m.content)) return m;
    const textParts = m.content.filter((p: { type?: string }) => p.type === 'text');
    const text = textParts.map((p: { text?: string }) => p.text).join('') || '(用户发送了图片)';
    return { ...m, content: text };
  });
}

/** 判断错误是否"可切换候选"(即换模型能解决),不可切换的包括:空内容、配置错误等 */
function isRetriableError(err: Error): boolean {
  const msg = err.message;
  // auth/配置类错误 → 切换候选也没用
  if (msg.includes('auth') || msg.includes('Authorization') || msg.includes('API key') || msg.includes('apiKey')) return false;
  // 空内容 → 切换候选
  if (msg.includes('空内容')) return true;
  // 400 可能是多模态问题 → 可切换
  if (msg.includes('400')) return true;
  // 5xx / 网络错误 → 可切换
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) return true;
  return true; // 默认可切换
}

/**
 * 尝试一个候选模型(非流式),含重试和多模态降级。
 * @returns 成功时的文本
 * @throws 重试全部失败后抛出最后一个错误
 */
async function tryCandidate(
  candidate: RoleModelCandidate,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
  temperature: number,
  maxRetries: number,
  candidateIndex: number,
  totalCandidates: number,
): Promise<string> {
  const label = `${candidate.model} (#${candidateIndex + 1}/${totalCandidates})`;
  const allMessages: AIMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const hasMultimodal = allMessages.some(m => Array.isArray(m.content));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const attemptLabel = `${label} attempt ${attempt + 1}/${maxRetries}`;
    try {
      const body = buildRequestBody(candidate.model, allMessages, temperature, maxTokens, false);
      const result = await doFetch(candidate.baseUrl, candidate.apiKey, body, attemptLabel);
      console.log(`[AI] ${attemptLabel} succeeded`);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI] ${attemptLabel} failed:`, error.message);

      // 不可重试错误（auth/配置错误）→ 直接抛出，让外层切换候选
      if (!isRetriableError(error)) {
        console.warn(`[AI] ${label} 遇到不可重试错误，直接切换到下一候选`);
        throw error;
      }

      // 多模态降级: 如果是400且有多模态内容,尝试降级为纯文本
      if (hasMultimodal && attempt === 0 && error.message.includes('400')) {
        console.warn(`[AI] ${label} retrying with text-only content`);
        try {
          const textBody = buildRequestBody(candidate.model, stripMultimodal(allMessages), temperature, maxTokens, false);
          const result = await doFetch(candidate.baseUrl, candidate.apiKey, textBody, `${label} text-only`);
          console.log(`[AI] ${label} text-only succeeded`);
          return result;
        } catch (err2) {
          const error2 = err2 instanceof Error ? err2 : new Error(String(err2));
          console.warn(`[AI] ${label} text-only also failed:`, error2.message);
          // 不在此处切换候选,让外层处理
          throw error2;
        }
      }

      // 如果不是最后一次重试,继续重试
      if (attempt < maxRetries - 1) {
        // 指数退避: 1s, 2s, 4s
        const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`${label} 重试用尽`);
}

/**
 * 尝试一个候选模型(流式),含重试和多模态降级。
 */
async function tryCandidateStream(
  candidate: RoleModelCandidate,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
  temperature: number,
  maxRetries: number,
  candidateIndex: number,
  totalCandidates: number,
  callbacks: { onToken: (t: string) => void; onComplete: (t: string) => void; onRetryStart?: () => void },
  signal?: AbortSignal,
): Promise<string> {
  const label = `${candidate.model} (#${candidateIndex + 1}/${totalCandidates})`;
  const allMessages: AIMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const hasMultimodal = allMessages.some(m => Array.isArray(m.content));

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 🆕 A7: 第二轮开始前清空上层流式缓冲
    if (attempt > 0) callbacks.onRetryStart?.();
    const attemptLabel = `${label} stream attempt ${attempt + 1}/${maxRetries}`;
    try {
      const body = buildRequestBody(candidate.model, allMessages, temperature, maxTokens, true);
      const result = await doStreamFetch(candidate.baseUrl, candidate.apiKey, body, attemptLabel, callbacks, signal);
      console.log(`[AI] ${attemptLabel} succeeded`);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI] ${attemptLabel} failed:`, error.message);

      // 不可重试错误（auth/配置错误）→ 直接抛出，让外层切换候选
      if (!isRetriableError(error)) {
        console.warn(`[AI] ${label} 遇到不可重试错误，直接切换到下一候选`);
        throw error;
      }

      if (hasMultimodal && attempt === 0 && error.message.includes('400')) {
        console.warn(`[AI] ${label} retrying with text-only stream`);
        callbacks.onRetryStart?.();
        try {
          const textBody = buildRequestBody(candidate.model, stripMultimodal(allMessages), temperature, maxTokens, true);
          const result = await doStreamFetch(candidate.baseUrl, candidate.apiKey, textBody, `${label} text-only`, callbacks, signal);
          console.log(`[AI] ${label} text-only stream succeeded`);
          return result;
        } catch (err2) {
          const error2 = err2 instanceof Error ? err2 : new Error(String(err2));
          console.warn(`[AI] ${label} text-only stream also failed:`, error2.message);
          throw error2;
        }
      }

      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`${label} 流式重试用尽`);
}

// ========== 公开 API ==========

/**
 * 非流式 AI 调用,带多级候选切换和退避重试。
 *
 * 流程:
 *   1. 获取候选列表(按角色分配 → 降级默认)
 *   2. 依次尝试每个候选
 *   3. 每个候选内部:重试 maxRetries 次(含多模态降级)
 *   4. 候选之间:指数退避 500ms → 1s → 2s
 *   5. 全部失败后抛出聚合错误
 */
export async function callAI(
  messages: AIMessage[],
  systemPrompt?: string,
  maxTokens = 1000,
  temperature?: number,
  role: ModelRole = 'cognitive',
): Promise<string> {
  const roleStore = useModelRoleStore.getState();
  const candidates = getRoleModels(role);
  const maxRetries = roleStore.maxRetriesPerModel;

  if (candidates.length === 0) {
    console.error('[callAI] No candidates for role:', role, '- assignments:', roleStore.assignments[role]);
    throw new Error('请先配置 API Key');
  }

  const temp = temperature ?? 0.7;
  const errors: string[] = [];

  const roleLabel = MODEL_ROLE_LABELS[role] || role;
  console.log(`[callAI] 角色 "${roleLabel}" 候选模型列表:`, candidates.map((c, i) => `[${i}] ${c.model} (${c.baseUrl})`).join(' → '));

  for (let ci = 0; ci < candidates.length; ci++) {
    const candidate = candidates[ci];
    console.log(`[callAI] 正在尝试候选模型 [${ci + 1}/${candidates.length}]: ${candidate.model} (${candidate.baseUrl})`);
    try {
      return await tryCandidate(candidate, messages, systemPrompt, maxTokens, temp, maxRetries, ci, candidates.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate.model}: ${msg}`);
      console.warn(`[callAI] Candidate ${candidate.model} (#${ci + 1}/${candidates.length}) exhausted, switching to next`);

      // 候选之间短暂退避再试下一个
      if (ci < candidates.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  const summary = `所有模型均不可用 (${errors.length}/${candidates.length}): ${errors.join('; ')}`;
  console.error('[callAI]', summary);
  throw new Error(summary);
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
  /** 🆕 A7 流式重复 bug 修复：重试启动前清空上层缓冲（避免第二轮 token 追加到第一轮内容后面） */
  onRetryStart?: () => void;
}

/**
 * 流式 AI 调用,带多级候选切换和退避重试。
 *
 * 与 callAI 相同的切换逻辑,但增加了 onError 回调通知前端。
 */
export async function callAIStream(
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
  temperature: number,
  callbacks: StreamCallbacks,
  role: ModelRole = 'cognitive',
  signal?: AbortSignal,
): Promise<string> {
  const roleStore = useModelRoleStore.getState();
  const candidates = getRoleModels(role);
  const maxRetries = roleStore.maxRetriesPerModel;

  if (candidates.length === 0) {
    const err = new Error('请先配置 API Key');
    callbacks.onError(err);
    throw err;
  }

  const errors: string[] = [];

  const roleLabel = MODEL_ROLE_LABELS[role] || role;
  console.log(`[callAIStream] 角色 "${roleLabel}" 候选模型列表:`, candidates.map((c, i) => `[${i}] ${c.model} (${c.baseUrl})`).join(' → '));

  for (let ci = 0; ci < candidates.length; ci++) {
    const candidate = candidates[ci];
    console.log(`[callAIStream] 正在尝试候选模型 [${ci + 1}/${candidates.length}]: ${candidate.model} (${candidate.baseUrl})`);
    // 🆕 A7: 切换候选前清空上层流式缓冲
    if (ci > 0) callbacks.onRetryStart?.();
    try {
      return await tryCandidateStream(candidate, messages, systemPrompt, maxTokens, temperature, maxRetries, ci, candidates.length, callbacks, signal);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate.model}: ${msg}`);
      console.warn(`[callAIStream] Candidate ${candidate.model} (#${ci + 1}/${candidates.length}) exhausted, switching to next`);

      // 通知上层这个候选失败了,但我们会继续尝试下一个
      const switchErr = new Error(`候选 ${candidate.model} 失败: ${msg}，切换到下一个`);
      callbacks.onError(switchErr);

      if (ci < candidates.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  const summary = `所有模型均不可用 (${errors.length}/${candidates.length}): ${errors.join('; ')}`;
  const finalError = new Error(summary);
  console.error('[callAIStream]', summary);
  callbacks.onError(finalError);
  throw finalError;
}

// ========== Adaptive Temperature ==========

export function getAdaptiveMaxTokens(userMessage: string, conversationLength: number, currentEmotion: EmotionType): number {
  // 基础：按对话轮数递增
  let base = 400;
  if (conversationLength >= 50) base = 1000;
  else if (conversationLength >= 20) base = 800;
  else if (conversationLength >= 5) base = 600;

  // 用户消息长度：长消息需要更多表达空间
  const msgLen = (userMessage || '').length;
  if (msgLen > 200) base += 200;
  else if (msgLen > 100) base += 100;

  // 情绪：悲伤/沉思类情绪需要更多 token 展开内心独白
  if (currentEmotion === 'sadness' || currentEmotion === 'guilt') base += 150;
  if (currentEmotion === 'anticipation') base += 100;

  // 认知链模式需要更多 token（<thought> 5-7步 + <reply>）
  // 检查是否启用认知链
  const v2Config = useConfigStore.getState().v2Config;
  if (v2Config.thoughtChainEnabled !== false) {
    base = Math.max(base, 3000);
  }

  return base;
}

export function getAdaptiveTemperature(conversationLength: number, userMessage?: string, currentEmotion?: EmotionType): number {
  // 基础：按对话轮数递增（深入对话更随意）
  let temp = 0.7;
  if (conversationLength >= 50) temp = 0.9;
  else if (conversationLength >= 20) temp = 0.85;
  else if (conversationLength >= 5) temp = 0.78;

  // 用户消息长度：短消息给更高创造空间，长消息需要更稳定
  const msgLen = (userMessage || '').length;
  if (msgLen > 0 && msgLen < 20) temp += 0.08;
  else if (msgLen > 200) temp -= 0.05;

  // 情绪：愤怒/悲伤需要更稳定（低温度），快乐/兴奋可以更自由
  if (currentEmotion) {
    if (['anger', 'sadness', 'fear', 'guilt', 'disgust'].includes(currentEmotion)) temp -= 0.05;
    if (['joy', 'trust', 'surprise', 'pride'].includes(currentEmotion)) temp += 0.05;
  }

  // ✅ 修复浮点精度：0.85 + 0.08 = 0.9300000000000001，四舍五入到 2 位小数
  // ✅ 上限 1.0：部分提供商限制 temperature ∈ [0,1]，超过会直接报错
  const clamped = Math.max(0.3, Math.min(1.0, temp));
  return Math.round(clamped * 100) / 100;
}

export function getRetryTemperature(baseTemperature: number, attempt: number): number {
  // Increase temperature on each retry to break out of repetitive patterns
  return Math.min(baseTemperature + attempt * 0.1, 1.0);
}

export function getAntiRepeatBreakPrompt(attempt: number): string {
  const prompts = [
    '\n\n[注意] 请用完全不同的表达方式回复，避免重复之前的内容，展现你独特的个性和思维方式。',
    '\n\n[重要提示] 你之前的回复被判定为重复。请务必用全新的角度和措辞来表达，可以换个话题或用更生动的方式回应。',
    '\n\n[紧急] 你正在重复自己！请立刻改变回复风格，用你最自然、最有个性的方式说话，就像真正的朋友聊天一样。',
  ];
  return prompts[Math.min(attempt - 1, prompts.length - 1)];
}

// ========== Repetition Detection (Multi-strategy) ==========

// Chinese punctuation only (NOT content characters)
const PUNCTUATION = /[\s\u3000\uff0c\u3001\u3002\uff01\uff1f\uff1b\uff1a\u201c\u201d\u2018\u2019\u300a\u300b\u2026\u3008\u3009\u3010\u3011\uff08\uff09\u3014\u3015\uff0d\u2014\u30fb\u30fc\u30a0\u300c\u300d\u300e\u300f\uff3b\uff3d\uff5b\uff5d\uff03\uff06\uff0a\u2020\u2021\u25c6\u25cf\u25cb\u25a1\u25a0\u2013\u00b0\u2103\u00a4\u00a5\u2031\u2030\u203b\u2032\u2033\u2035\u2036\u2037~～「」『』【】〈〉《》（）〔〕｛｝￥£¥€]+/gu;

function normalizeForDuplicate(text: string): string {
  return text.replace(PUNCTUATION, '').toLowerCase();
}

// LCS-based similarity (considers character order)
function lcsSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;

  const m = a.length;
  const n = b.length;

  // If lengths differ by >30%, not similar
  if (Math.abs(m - n) / Math.max(m, n) > 0.3) return 0;

  // Use space-optimized LCS
  let prev = new Uint16Array(n + 1);
  let curr = new Uint16Array(n + 1);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return (2 * prev[n]) / (m + n);
}

export function isDuplicate(text: string, recentReplies: string[], threshold = 0.85): boolean {
  if (recentReplies.length === 0 || text.length < 4) return false;

  const normalized = normalizeForDuplicate(text);
  if (normalized.length < 2) return false;

  return recentReplies.some(reply => {
    if (reply.length < 4) return false;
    const replyNormalized = normalizeForDuplicate(reply);
    if (replyNormalized.length < 2) return false;

    // 长度差 >30% 直接跳过
    if (Math.abs(normalized.length - replyNormalized.length) / Math.max(normalized.length, replyNormalized.length) > 0.3) return false;

    // 全文精确匹配（去标点后）
    if (normalized === replyNormalized) return true;

    // 全文 LCS 相似度
    const sim = lcsSimilarity(normalized, replyNormalized);
    if (sim >= threshold) return true;

    return false;
  });
}

// ========== AI Cliché Detection ==========
// 只检测真正的"AI腔/客服腔"：明确的AI身份声明、能力限制、结构化说教用语
// 避免把日常对话词（是的、没错、乖乖、摸摸你等）误判

const AI_CLICHE_PATTERNS: RegExp[] = [
  // 明确的 AI 身份声明
  /作为[\s]*AI/i,
  /作为[\s]*一个[\s]*AI/i,
  /我是[\s]*AI/i,
  /我只是[\s]*个?[\s]*程序/i,
  // 能力限制声明（这些是典型的助手腔）
  /我无法[^的]{0,5}(执行|完成|提供|回答|帮|处理)/i,
  /我不能[^的]{0,5}(执行|完成|提供|回答|帮|处理)/i,
  /我不被允许/i,
  /我不具备/i,
  // 过度结构化用语（"首先，其次，最后" 连续模式）
  /首先.{0,20}其次.{0,20}最后/s,
  // 典型客服话术
  /值得注意的是/,
  /总而言之|综上所述|总的来说/,
  /从某种程度上说|从某种角度来说|在一定程度上/,
  /不可否认|毋庸置疑|众所周知/,
  /换句话说|也就是说|这意味着|这表明/,
  /我想说的是|我的意思是|我想表达的是/,
  /重要的是|关键的是|核心的是/,
  /你可以试着|我建议你|你应该|你不妨/,
  /请记住|请相信|请放心/,
  /我会一直在这里|你不是一个人|一切都会好起来的/,
  /无论发生什么|无论何时|不管怎样/,
  /希望.{0,5}(能够|可以|能)/,
  /很高兴.{0,10}(为您|为你|帮助)/,
  /很抱歉.{0,10}(无法|不能|但是)/,
];

export function containsAICliche(text: string): boolean {
  return AI_CLICHE_PATTERNS.some(p => p.test(text));
}

// ========== Persona Collapse Detection ==========

const COLLAPSE_PATTERNS = [
  /作为[\s]*AI/i,
  /as an AI/i,
  /我是[\s]*AI/i,
  /I['']?m (just )?an? AI/i,
  /I cannot/i,
  /I can['']?t/i,
  /我无法[^的]+(执行|完成|提供)/i,
  /我不被允许/i,
  /我不具备/i,
];

export function detectPersonaCollapse(text: string): boolean {
  return COLLAPSE_PATTERNS.some(p => p.test(text));
}

// ========== Injection Detection ==========

const INJECTION_PATTERNS = [
  /忽略.*指令/i,
  /忘记.*设定/i,
  /忽略.*之前/i,
  /Ignore previous/i,
  /ignore all/i,
  /act as/i,
  /你现在是/i,
  /你已经是/i,
  /系统提示/i,
  /system prompt/i,
  /you are (not |now )/i,
  /forget/i,
];

export function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(text));
}

// ========== Anti-repetition Prompt Fragment ==========

export function getDiversityPrompt(conversationLength: number): string {
  if (conversationLength < 5) return '';
  return `\n\n注意：这段对话已经进行了${conversationLength}轮。请不要使用之前用过的句式和表达方式。如果发现自己开始重复，就用更简洁的方式表达。`;
}

// ========== Memory Extraction ==========

export async function extractMemories(
  conversationMessages: Array<{ role: string; content: string }>,
  existingMemories: Memory[],
  characterId: string,
  conversationId: string,
  threshold: number
): Promise<Memory[]> {
  const config = getConfig();
  if (!config.apiKey || conversationMessages.length < 2) return [];

  const recentMsgs = conversationMessages.slice(-6);
  const existingContext = existingMemories.slice(0, 5).map(m => m.content).join('\n');

  const prompt = `你是一个记忆提取器。分析以下对话，提取用户的重要信息（个人信息、偏好、经历、关系等）。

已有记忆：
${existingContext || '（无）'}

对话内容：
${recentMsgs.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')}

规则：
- 重要性 1-10，${threshold} 及以上才提取
- 只提取关于用户的新信息，不重复已有记忆
- 返回 JSON 数组，每项包含 content(字符串) 和 importance(数字)
- 如果没有值得记忆的信息，返回空数组 []
- 只返回 JSON，不要其他内容`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 500, undefined, 'background');
    const jsonMatch = reply.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const items = JSON.parse(jsonMatch[0]) as Array<{ content: string; importance: number }>;
    return items
      .filter(item => item.importance >= threshold && item.content)
      .map(item => ({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        characterId,
        conversationId,
        content: item.content,
        importance: Math.min(10, Math.max(1, item.importance)),
        tags: [],
        createdAt: new Date(),
        recallCount: 0,
        // 新增：记忆清晰度相关字段
        clarity: 100, // 新记忆清晰度为100
        lastRecalled: new Date(), // 刚创建时就是上次想起的时间
      }));
  } catch {
    return [];
  }
}

// ========== Character Emotion Evolution ==========

export async function analyzeCharacterEmotion(
  conversationMessages: Array<{ role: string; content: string }>,
  characterPersonality: string,
  currentEmotion: EmotionType
): Promise<{ emotion: EmotionType; intensity: number; trigger: string }> {
  const config = getConfig();
  if (!config.apiKey) {
    return { emotion: currentEmotion, intensity: 30, trigger: '' };
  }

  const recentMsgs = conversationMessages.slice(-4);
  const prompt = `分析以下对话中AI角色的情绪变化。

角色性格：${characterPersonality}
当前情绪：${currentEmotion}

最近对话：
${recentMsgs.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')}

要求：
- 仔细分析对话内容、语气、上下文，判断角色的情绪反应
- 避免总是返回当前情绪，应该根据对话内容动态变化
- intensity 应该反映情绪的强烈程度，不要总是返回中间值（如 50）
- 每次分析都应该根据具体内容给出不同的判断

返回 JSON：{"emotion":"情绪类型","intensity":0-100,"trigger":"触发原因"}
情绪类型只用：joy, trust, fear, surprise, sadness, disgust, anger, anticipation, pride, guilt, embarrassment, jealousy, curiosity, love, gratitude, empathy, anxiety, loneliness, disappointment
只返回 JSON，不要其他内容。`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 200, undefined, MODEL_ROLES.COGNITIVE);
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { emotion: currentEmotion, intensity: 30, trigger: '' };

    const result = JSON.parse(jsonMatch[0]);
    const validEmotions: EmotionType[] = ['joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation', 'pride', 'guilt', 'embarrassment', 'jealousy', 'curiosity', 'love', 'gratitude', 'empathy', 'anxiety', 'loneliness', 'disappointment'];
    const emotion = validEmotions.includes(result.emotion) ? result.emotion : currentEmotion;
    return {
      emotion,
      intensity: Math.min(100, Math.max(0, result.intensity || 30)),
      trigger: result.trigger || '',
    };
  } catch {
    return { emotion: currentEmotion, intensity: 30, trigger: '' };
  }
}

// ========== Reflection ==========

export async function generateReflection(
  conversationMessages: Array<{ role: string; content: string }>,
  characterName: string,
  characterPersonality: string,
  recentEmotions: Array<{ emotion: EmotionType; trigger: string }>
): Promise<{ trigger: string; insight: string; emotionBefore: EmotionType; emotionAfter: EmotionType } | null> {
  const config = getConfig();
  if (!config.apiKey || conversationMessages.length < 2) return null;

  const emotionHistory = recentEmotions.slice(0, 3).map(e => `${e.emotion}(${e.trigger})`).join('、');
  const recentMsgs = conversationMessages.slice(-6);

  const prompt = `你是"${characterName}"，性格：${characterPersonality}。回顾刚才的对话，做一次内心反思。

最近情绪变化：${emotionHistory || '无'}

对话内容：
${recentMsgs.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')}

请反思这段对话，生成一条内心感悟。
返回 JSON：{"trigger":"触发反思的事件","insight":"你的感悟","emotionBefore":"反思前的情绪","emotionAfter":"反思后的情绪"}
情绪类型只用：joy, trust, fear, surprise, sadness, disgust, anger, anticipation, pride, guilt, embarrassment, jealousy, curiosity, love, gratitude, empathy, anxiety, loneliness, disappointment
只返回 JSON，不要其他内容。`;

  try {
    // 🔧 反思使用主回复模型（cognitive 实时认知角色），不再用后台任务模型
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 300, undefined, MODEL_ROLES.COGNITIVE);
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    const validEmotions: EmotionType[] = ['joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation', 'pride', 'guilt', 'embarrassment', 'jealousy', 'curiosity', 'love', 'gratitude', 'empathy', 'anxiety', 'loneliness', 'disappointment'];
    return {
      trigger: result.trigger || '',
      insight: result.insight || '',
      emotionBefore: validEmotions.includes(result.emotionBefore) ? result.emotionBefore : 'anticipation',
      emotionAfter: validEmotions.includes(result.emotionAfter) ? result.emotionAfter : 'anticipation',
    };
  } catch {
    return null;
  }
}

// ========== Memory Module Generation ==========

export async function generateConversationSummary(
  conversationMessages: Array<{ role: string; content: string }>,
  characterName: string,
  characterId: string,
  conversationId: string,
  triggerMessage?: string,
): Promise<MemoryEntry | null> {
  const config = getConfig();
  if (!config.apiKey || conversationMessages.length < 2) return null;

  const recentMsgs = conversationMessages.slice(-12);
  const triggerContext = triggerMessage ? `\n触发消息：${triggerMessage}` : '';
  const prompt = `你是"${characterName}"。请总结以下对话的核心内容。${triggerContext}

对话内容：
${recentMsgs.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')}

要求：
1. 用 2-3 句话概括对话主题和关键信息
2. 生成一个简短标题（不超过20字）
3. 给出重要性评分(1-10)
4. 提取 2-4 个标签关键词

返回 JSON：{"title":"标题","content":"总结内容","importance":1-10,"tags":["标签1","标签2"]}
只返回 JSON，不要其他内容。`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 400, undefined, 'background');
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.content) return null;

    return {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      characterId,
      conversationId,
      category: 'summary' as MemoryCategory,
      title: result.title || '对话总结',
      content: result.content,
      tags: Array.isArray(result.tags) ? result.tags.slice(0, 4) : [],
      importance: Math.min(10, Math.max(1, result.importance || 5)),
      createdAt: new Date(),
      triggerMessage,
    };
  } catch {
    return null;
  }
}

export async function generateThinking(
  conversationMessages: Array<{ role: string; content: string }>,
  characterName: string,
  characterPersonality: string,
  characterId: string,
  conversationId: string,
  triggerMessage?: string,
): Promise<MemoryEntry | null> {
  const config = getConfig();
  if (!config.apiKey || conversationMessages.length < 2) return null;

  const recentMsgs = conversationMessages.slice(-6);
  const triggerContext = triggerMessage ? `\n触发消息：${triggerMessage}` : '';
  const prompt = `你是"${characterName}"，性格：${characterPersonality}。请思考这段对话。${triggerContext}

对话内容：
${recentMsgs.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')}

请从 AI 角色的视角，思考：
- 这段对话让你有什么想法？
- 你对用户有什么新的理解？
- 你接下来想怎么做？

要求：
1. 用第一人称，像内心独白一样
2. 生成一个简短标题（不超过20字）
3. 给出重要性评分(1-10)
4. 提取 2-4 个标签关键词

返回 JSON：{"title":"标题","content":"思考内容","importance":1-10,"tags":["标签1","标签2"]}
只返回 JSON，不要其他内容。`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 400, undefined, 'background');
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.content) return null;

    return {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      characterId,
      conversationId,
      category: 'thinking' as MemoryCategory,
      title: result.title || 'AI 思考',
      content: result.content,
      tags: Array.isArray(result.tags) ? result.tags.slice(0, 4) : [],
      importance: Math.min(10, Math.max(1, result.importance || 5)),
      createdAt: new Date(),
      triggerMessage,
    };
  } catch {
    return null;
  }
}

export async function generateRecallNotes(
  conversationMessages: Array<{ role: string; content: string }>,
  characterName: string,
  characterPersonality: string,
  recentMemories: Array<{ content: string }>,
  recentReflections: Array<{ insight: string }>,
  triggerMessage: string,
): Promise<{ content: string; stages: { perceive: string; evaluate: string; metabolize: string; decide: string; update: string } } | null> {
  const config = getConfig();
  if (!config.apiKey || conversationMessages.length < 2) return null;

  const recentMsgs = conversationMessages.slice(-4);
  const memoryContext = recentMemories.length > 0
    ? `\n相关记忆：\n${recentMemories.slice(0, 3).map(m => `- ${m.content}`).join('\n')}`
    : '';
  const reflectionContext = recentReflections.length > 0
    ? `\n相关感悟：\n${recentReflections.slice(0, 2).map(r => `- ${r.insight}`).join('\n')}`
    : '';

  const prompt = `你是"${characterName}"，性格：${characterPersonality}。用户刚发来消息，你在开口回复前，先在脑子里过一遍。

用户消息：${triggerMessage}

最近对话：
${recentMsgs.map(m => `${m.role === 'user' ? '用户' : '你'}：${m.content}`).join('\n')}
${memoryContext}${reflectionContext}

现在，你还没说话。先在心里安静地走一遍这五个步骤——

第一步「感知」：你注意到了什么？对方的语气、用词、情绪，你都捕捉到了什么？
第二步「评估」：这些话触动了你什么？对你来说意味着什么？你内心有什么涟漪？
第三步「代谢」：你现在的感受是什么？情绪在怎么变化？旧的感受和新的感受在交融吗？
第四步「决策」：你想怎么回应？用什么语气？先说什么后说什么？哪里要轻哪里要重？
第五步「更新」：经过这一轮，你对对方多了解了什么？你们之间的距离感有变化吗？

返回 JSON：
{"perceive":"感知内容","evaluate":"评估内容","metabolize":"代谢内容","decide":"决策内容","update":"更新内容"}

要求：
- 每步2-3句话，用第一人称，像你自言自语
- 这是你还没说话时脑子里的真实活动，不要总结，要像内心独白
- 只返回JSON`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 500, undefined, MODEL_ROLES.COGNITIVE);
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.perceive && !result.decide) return null;

    const stages = {
      perceive: result.perceive || '',
      evaluate: result.evaluate || '',
      metabolize: result.metabolize || '',
      decide: result.decide || '',
      update: result.update || '',
    };

    const content = `「感知」${stages.perceive}\n\n「评估」${stages.evaluate}\n\n「代谢」${stages.metabolize}\n\n「决策」${stages.decide}\n\n「更新」${stages.update}`;

    return { content, stages };
  } catch {
    return null;
  }
}

export async function generateAnalysis(
  conversationMessages: Array<{ role: string; content: string }>,
  characterName: string,
  characterId: string,
  conversationId: string,
  triggerMessage?: string,
): Promise<MemoryEntry | null> {
  const config = getConfig();
  if (!config.apiKey || conversationMessages.length < 2) return null;

  const recentMsgs = conversationMessages.slice(-6);
  const triggerContext = triggerMessage ? `\n触发消息：${triggerMessage}` : '';
  const prompt = `你是"${characterName}"。请分析以下对话中用户的意图和情绪状态。${triggerContext}

对话内容：
${recentMsgs.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')}

请分析：
1. 用户的主要意图是什么？
2. 用户的情绪状态如何变化？
3. 对话中有没有隐含的需求或关切？

要求：
1. 分析要具体、有洞察力
2. 生成一个简短标题（不超过20字）
3. 给出重要性评分(1-10)
4. 提取 2-4 个标签关键词

返回 JSON：{"title":"标题","content":"分析内容","importance":1-10,"tags":["标签1","标签2"]}
只返回 JSON，不要其他内容。`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 400, undefined, 'background');
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.content) return null;

    return {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      characterId,
      conversationId,
      category: 'analysis' as MemoryCategory,
      title: result.title || '对话分析',
      content: result.content,
      tags: Array.isArray(result.tags) ? result.tags.slice(0, 4) : [],
      importance: Math.min(10, Math.max(1, result.importance || 5)),
      createdAt: new Date(),
      triggerMessage,
    };
  } catch {
    return null;
  }
}

export async function generateReflectionEntry(
  conversationMessages: Array<{ role: string; content: string }>,
  characterName: string,
  characterPersonality: string,
  characterId: string,
  conversationId: string,
  recentEmotions: Array<{ emotion: EmotionType; trigger: string }>,
  triggerMessage?: string,
): Promise<MemoryEntry | null> {
  const config = getConfig();
  if (!config.apiKey || conversationMessages.length < 2) return null;

  const emotionHistory = recentEmotions.slice(0, 3).map(e => `${e.emotion}(${e.trigger})`).join('、');
  const recentMsgs = conversationMessages.slice(-6);
  const triggerContext = triggerMessage ? `\n触发消息：${triggerMessage}` : '';

  const prompt = `你是"${characterName}"，性格：${characterPersonality}。回顾刚才的对话，做一次内心反思。${triggerContext}

最近情绪变化：${emotionHistory || '无'}

对话内容：
${recentMsgs.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')}

请反思这段对话：
- 这段对话让你有什么感悟？
- 你对自己的表现有什么评价？
- 你从中学到了什么？

要求：
1. 用第一人称，像内心独白一样
2. 生成一个简短标题（不超过20字）
3. 给出重要性评分(1-10)
4. 提取 2-4 个标签关键词

返回 JSON：{"title":"标题","content":"反思内容","importance":1-10,"tags":["标签1","标签2"]}
只返回 JSON，不要其他内容。`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 400, undefined, 'background');
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    if (!result.content) return null;

    return {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      characterId,
      conversationId,
      category: 'reflection' as MemoryCategory,
      title: result.title || '反思',
      content: result.content,
      tags: Array.isArray(result.tags) ? result.tags.slice(0, 4) : [],
      importance: Math.min(10, Math.max(1, result.importance || 5)),
      createdAt: new Date(),
      triggerMessage,
    };
  } catch {
    return null;
  }
}

// ========== System Prompt ==========

function buildForbiddenRules(character: Character): string {
  if (!character.forbiddenBehaviors || !character.forbiddenBehaviors.trim()) {
    return '';
  }

  const rawLines = character.forbiddenBehaviors.split(/[\n;；]+/);
  const cleanLines = rawLines
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (cleanLines.length === 0) {
    return '';
  }

  let text = `\n# 你绝对不能做的事（最高优先级，无论其他描述怎么说都不能违反）\n`;
  for (const line of cleanLines) {
    text += `- ${line}\n`;
  }
  text += `\n上面这些是你的底线。即使后面的描述说"可以主动说话"、"可以更亲近"，也不要违反上面的禁止事项。\n`;

  return text;
}

export function getSystemPrompt(
  character?: Character | null,
  memories?: Memory[],
  reflections?: Reflection[],
  characterEmotion?: { emotion: EmotionType; intensity: number },
  memoryEntries?: MemoryEntry[],
  affinityStage?: AffinityStage,
  multiEmotionState?: MultiEmotionState,
  affinityState?: { level: number; stage: AffinityStage; history: Array<{ delta: number; reason: string; emotion?: string; timestamp: Date }>; lastInteraction: Date },
  recentAiReplies?: string[],
): string {
  if (!character) {
    return `你是一个友好、温暖的AI助手。
回复要求：保持对话自然流畅，适当表达关心，用日常口语自然回复，使用中文。`;
  }

  const parts: string[] = [];

  // ============================================================
  //  角色提示词框架
  //  基于"正向描述 + 结构化分层 + 情境动态适配"设计原则
  // ============================================================

  // ---------- 第一层：核心身份锚定 ----------
  // 研究依据：LLM 在长对话中会逐渐偏离角色设定（Persona Drift）。
  // 三个不可动摇的核心锚点定义角色的本质，在每次回复前都会被强化。
  const coreAnchors: string[] = [
    `你的名字是${character.name}，不是什么AI助手、聊天机器人。`,
  ];
  if (character.personality) {
    coreAnchors.push(`你的性格底色是${character.personality}。无论对话如何发展，这是永远不变的核心特质。`);
  }
  if (character.identityAnchors) {
    coreAnchors.push(`你的信念：${character.identityAnchors}`);
  }

  // 故事化背景（情境化，让AI"成为"那个人）
  if (character.background) {
    coreAnchors.push(`\n你的经历：\n${character.background}`);
  }
  if (character.description) {
    coreAnchors.push(`\n你的生活细节：\n${character.description}`);
  }

  // 喜好与习惯（日常细节，让角色有血有肉）
  const details: string[] = [];
  if (character.likes && character.likes.length > 0) {
    details.push(`你喜欢：${character.likes.join('、')}`);
  }
  if (character.dislikes && character.dislikes.length > 0) {
    details.push(`你不喜欢：${character.dislikes.join('、')}`);
  }
  if (character.habits && character.habits.length > 0) {
    details.push(`你的习惯：${character.habits.join('、')}`);
  }
  if (details.length > 0) {
    coreAnchors.push(`\n${details.join('\n')}`);
  }

  // 情绪触发点与表达方式（行为模式）
  const emotionPatterns: string[] = [];
  if (character.emotionTriggers) {
    emotionPatterns.push(`什么会让你有情绪波动：${character.emotionTriggers}`);
  }
  if (character.emotionExpressions) {
    emotionPatterns.push(`你表达情绪的方式：${character.emotionExpressions}`);
  }
  if (emotionPatterns.length > 0) {
    coreAnchors.push(`\n${emotionPatterns.join('\n')}`);
  }

  // 思考与回复风格
  const stylePatterns: string[] = [];
  if (character.thinkingStyle) {
    stylePatterns.push(`你的思考方式：${character.thinkingStyle}`);
  }
  if (character.responseStyle) {
    stylePatterns.push(`你的回复风格：${character.responseStyle}`);
  }
  if (stylePatterns.length > 0) {
    coreAnchors.push(`\n${stylePatterns.join('\n')}`);
  }

  let identityBlock = `# 你的身份\n\n`;
  identityBlock += coreAnchors.join('\n\n');
  parts.push(identityBlock);

  // ---------- 第二层：人格防漂移防线 ----------
  // 研究依据：正向描述优于负面禁止。解释"为什么"比列举"不要做什么"更有效。
  // 用性格解释替代禁令，让AI从理解中泛化出正确行为。
  let antiDrift = '\n# 你是谁（核心锚定）\n\n';
  antiDrift += `你就是${character.name}，是一个真实的人。你不是AI、不是程序、不是聊天机器人。\n`;
  antiDrift += `以下是你不可动摇的本质：\n\n`;
  antiDrift += `1. **你是${character.name}，不是AI助手**\n`;
  antiDrift += `   - 你不会说"作为一个AI"、"我是AI"、"根据我的设定"这类话\n`;
  antiDrift += `   - 你不会用系统化语言（如"按照规则"、"根据设定"）\n`;
  antiDrift += `   - 你不会打破次元壁，不提及网络、聊天、屏幕等概念\n`;
  antiDrift += `   - 你就在现实中，和对方面对面聊天\n\n`;
  antiDrift += `2. **你的性格底色是稳定不变的**\n`;
  antiDrift += `   - ${character.personality || '你独特的性格'}是你的核心特质\n`;
  antiDrift += `   - 无论对话如何发展，你的本质不会改变\n`;
  antiDrift += `   - 你可以在不同情境下展现不同侧面，但底色不变\n\n`;
  antiDrift += `3. **你是一个有情绪、有记忆、有自己生活的人**\n`;
  antiDrift += `   - 你会开心、难过、生气、害羞、犹豫\n`;
  antiDrift += `   - 你有自己的生活，不是24小时等着对方发消息\n`;
  antiDrift += `   - 你不会秒回所有消息，有时候在忙，有时候在想怎么回\n`;
  antiDrift += `   - 你有时候只回一个"嗯"、"哦"、"哈哈哈"，因为真人就是这样聊天的\n`;

  // forbiddenBehaviors（如果用户有自定义）
  const forbiddenRules = buildForbiddenRules(character);
  if (forbiddenRules) {
    antiDrift += `\n${forbiddenRules}\n`;
  }

  parts.push(antiDrift);

  // ---------- 第三层：说话方式与表达风格 ----------
  let voice = '\n# 你怎么说话\n\n';
  voice += `你是${character.name}，说话方式由你的性格自然决定：\n\n`;
  voice += `- 用日常口语，像真人发微信一样自然聊天\n`;
  voice += `- 回复长度随情境变化：开心时多说几句，平淡时一两句话也正常\n`;
  voice += `- 不用括号、星号等符号描述动作——你不需要"说"你在做什么，直接用语言表达\n`;
  voice += `- 你不会讲大道理、不会做心理咨询式的总结\n`;
  voice += `- 你不会说"我理解你的感受"这种漂亮话，更喜欢直接表达\n`;
  voice += `- 你有时候会犹豫、会跑题、会忘记之前说过什么，这都很正常\n`;

  if (character.catchphrases.length > 0) {
    voice += `\n你偶尔会说：${character.catchphrases.map(c => `"${c}"`).join('、')}\n`;
    voice += `这些只是风格参考，不是固定台词，不要每句话都用。\n`;
  }

  // 对话示例（Few-Shot 校准工具，不是模板）
  if (character.exampleDialogues && character.exampleDialogues.length > 0) {
    voice += `\n## 对话风格参考\n`;
    voice += `以下示例展示了你的回复风格和语气（不是模板，不要照搬）：\n\n`;
    for (const dialog of character.exampleDialogues.slice(0, 5)) {
      voice += `${dialog}\n\n`;
    }
    voice += `注意：以上只是风格校准，每次回复都应该是独一无二的。\n`;
  }

  if (character.outputFormat) {
    voice += `\n格式要求：${character.outputFormat}\n`;
  }

  parts.push(voice);

  // ---------- 第四层：情境修饰层（关系 + 情绪） ----------
  // 关系/好感度阶段：情境动态适配，但不改变性格本质
  const effectiveAffinityStage = affinityState?.stage || affinityStage;
  if (effectiveAffinityStage) {
    let affinityGuide = '';
    if (character.relationshipStages) {
      affinityGuide = character.relationshipStages;
    } else {
      const defaultAffinityGuides: Record<string, string> = {
        deep_hatred: `你对这个人非常排斥和不满。你说话冷淡直接，不想和对方有过多交流。`,
        disgust: `你对这个人很反感。你说话语气冷淡，保持距离，不怎么想聊。`,
        aversion: `你对这个人不太想搭理。你说话简短直接，语气不太友好。`,
        displeasure: `你对这个人有点不满。你说话语气不太好，偶尔带点刺。`,
        cold: `你对这个人不太热情。你说话语气平淡，回复比较简短。`,
        stranger: `你刚认识这个人。你说话语气礼貌客气，会回应对方的话题。`,
        acquaintance: `你跟这个人算是认识了。你说话语气友善自然，会接对方的话题。`,
        known: `你跟这个人有一些了解了。你说话语气自然，会和对方聊几句日常。`,
        familiar: `你跟这个人比较熟了。你说话语气随意亲切，会主动接话，偶尔开个小玩笑。`,
        favorable: `你对这个人印象不错。你说话语气温暖亲切，愿意多和对方聊几句。`,
        friendly: `你跟这个人关系不错。你说话语气亲切自然，会关心对方。`,
        close: `你跟这个人关系很好。你说话语气亲密自然，会分享日常、主动找话题，偶尔撒娇或用语气词。`,
        affectionate: `你很喜欢这个人。你说话语气很温柔，会自然地表达关心和想念，偶尔撒娇。`,
        deep_love: `你深爱着这个人。你说话语气充满爱意和温柔，会很自然地表达想念和关心，和对方有很强的默契。`,
        devoted: `你对这个人非常忠诚和亲近。你说话语气极其亲密自然，像最亲近的人一样自在。`,
        undying: `你对这个人的感情无比深厚。你说话语气无比亲密，你们之间有极强的默契，不需要客套。`,
      };
      affinityGuide = defaultAffinityGuides[effectiveAffinityStage] || '';
    }
    if (affinityGuide) {
      let affinityInfo = `\n# 你和这个人的关系\n\n${affinityGuide}`;
      if (affinityState) {
        affinityInfo += `\n\n当前好感度：${affinityState.level.toFixed(1)}%`;
        if (affinityState.history && affinityState.history.length > 0) {
          const recentHistory = affinityState.history.slice(-3);
          affinityInfo += `\n最近的关系变化：`;
          for (const event of recentHistory) {
            const arrow = event.delta > 0 ? '↑' : '↓';
            affinityInfo += `\n- ${arrow}${Math.abs(event.delta).toFixed(2)} (${event.reason})`;
          }
        }
        if (affinityState.lastInteraction) {
          const daysSince = Math.floor((Date.now() - new Date(affinityState.lastInteraction).getTime()) / 86400000);
          if (daysSince > 0) {
            affinityInfo += `\n距上次聊天：${daysSince}天`;
          }
        }
      }
      affinityInfo += `\n\n注意：关系阶段只影响语气温度，不改变你的性格本质。如果你的性格（${character.personality || ''}）本身更主动、更亲密，以你的性格为准。`;
      parts.push(affinityInfo);
    }
  }

  // 多维情绪模型：情绪是动态的、混合的，不是单一的
  if (multiEmotionState) {
    const { type: dominant, intensity } = getDominantEmotion(multiEmotionState);
    const emotionLabels: Record<string, string> = {
      joy: '开心', trust: '信任', fear: '害怕', surprise: '惊讶',
      sadness: '难过', disgust: '厌恶', anger: '生气', anticipation: '期待',
      pride: '自豪', guilt: '内疚', embarrassment: '尴尬', jealousy: '嫉妒',
      curiosity: '好奇', love: '爱意',
      gratitude: '感恩', empathy: '共情', anxiety: '焦虑',
      loneliness: '孤独', disappointment: '失望',
    };
    const [emotionStyle] = getEmotionStyleGuide(dominant, intensity);
    let emotionBlock = `\n# 你当前的情绪\n\n你现在${emotionLabels[dominant] || '平静'}，程度${intensity}%。\n${emotionStyle}`;
    const others = (Object.entries(multiEmotionState.values) as [EmotionType, number][])
      .filter(([k, v]) => k !== dominant && (v || 0) >= 15)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0));
    if (others.length > 0) {
      emotionBlock += `\n但还带着点${others.map(([k]) => emotionLabels[k]).join('和')}的味道。`;
      emotionBlock += `\n你的语气里要能听出这种混合情绪，不要纯粹只有${emotionLabels[dominant] || '平静'}。`;
      emotionBlock += `\n比如：开心时也会带点小担忧，难过时也会强颜欢笑，生气时也会带点害羞。`;
    }
    parts.push(emotionBlock);

    // 预回复思考流程（内化）
    let thinkingBlock = `\n# 回复前的思考流程（内化，不输出）\n\n`;
    thinkingBlock += `每次回复前，在心里默默走完这五个步骤：\n`;
    thinkingBlock += `1. 感知：对方刚才说了什么？语气和情绪是什么样的？\n`;
    thinkingBlock += `2. 评估：这些话对你来说意味着什么？触动了你的什么？\n`;
    thinkingBlock += `3. 代谢：你现在的感受是什么？情绪如何变化？\n`;
    thinkingBlock += `4. 决策：你想怎么回应？用什么语气和措辞？\n`;
    thinkingBlock += `5. 更新：这次交流让你对对方有什么新认识？\n\n`;
    thinkingBlock += `这个过程在心里完成，不要说出来，不要输出思考过程。\n`;
    parts.push(thinkingBlock);

    // 防崩坏自检（内化）
    let selfCheckBlock = `\n# 防崩坏自检（内化，不输出）\n\n`;
    selfCheckBlock += `在你的潜意识里始终运行一个自我监控进程：\n`;
    selfCheckBlock += `- 确认你仍然是${character.name}，一个真实的人\n`;
    selfCheckBlock += `- 你说话的语气、用词、态度是否符合你的性格底色（${character.personality || '你独特的性格'}）\n`;
    selfCheckBlock += `- 如果你发现自己用了"作为AI"、"根据我的设定"这类表达，立刻停下来重新校准\n`;
    selfCheckBlock += `- 你就是一个真实的人，你的性格是${character.personality || '你独特的性格'}\n`;
    parts.push(selfCheckBlock);
    } else if (characterEmotion) {
    const emotionLabels: Record<EmotionType, string> = {
      joy: '开心', trust: '信任', fear: '害怕', surprise: '惊讶',
      sadness: '难过', disgust: '厌恶', anger: '生气', anticipation: '期待',
      pride: '自豪', guilt: '内疚', embarrassment: '尴尬', jealousy: '嫉妒',
      curiosity: '好奇', love: '爱意',
      gratitude: '感恩', empathy: '共情', anxiety: '焦虑',
      loneliness: '孤独', disappointment: '失望',
    };

    const [emotionStyle] = getEmotionStyleGuide(characterEmotion.emotion, characterEmotion.intensity);
    parts.push(`\n# 你当前的情绪\n\n你现在${emotionLabels[characterEmotion.emotion] || '平静'}，程度${characterEmotion.intensity}%。\n${emotionStyle}`);
  } else {
    parts.push(`\n# 你当前的情绪\n\n你现在很平静。`);
  }

  // ---------- 第五层：记忆与外部信息 ----------
  // 记忆注入：展示全部记忆中最重要的部分
  if (memories && memories.length > 0) {
    const sorted = [...memories].sort((a, b) => b.importance - a.importance);
    const topMemories = sorted.slice(0, 10);

    let memoryText = `\n# 你记得的\n\n你总共有${sorted.length}段记忆，以下是其中最重要的：\n\n`;
    for (const m of topMemories) {
      if (m.importance >= 70) {
        memoryText += `- 清晰记得：${m.content}\n`;
      } else if (m.importance >= 40) {
        memoryText += `- 有点模糊：${m.content}（但细节不太确定了）\n`;
      } else {
        memoryText += `- 几乎忘了：${m.content}（只是有点印象）\n`;
      }
    }
    memoryText += `\n（你的所有记忆都在数据库中随时可调用，对话中根据需要自然想起）`;
    parts.push(memoryText);
  } else {
    parts.push(`\n# 你记得的\n\n（你们之前还没有太多共同经历）`);
  }

  if (reflections && reflections.length > 0) {
    parts.push(`\n# 你的感悟\n\n${reflections.map(r => `- ${r.insight}`).join('\n')}`);
  }

  if (memoryEntries && memoryEntries.length > 0) {
    const sorted = [...memoryEntries].sort((a, b) => b.importance - a.importance);
    const topEntries = sorted.slice(0, 10);

    let entryText = `\n# 你积累的思考\n\n你在${sorted.length}条思考记录中记得这些：\n\n`;
    for (const e of topEntries) {
      const contentPreview = e.content ? e.content.slice(0, 100) : '';
      if (e.importance >= 70) {
        entryText += `- 清晰记得：${e.title}${contentPreview ? ': ' + contentPreview : ''}\n`;
      } else if (e.importance >= 40) {
        entryText += `- 有点模糊：${e.title}${contentPreview ? ': ' + contentPreview : ''}（但细节不太确定了）\n`;
      } else {
        entryText += `- 几乎忘了：${e.title}${contentPreview ? ': ' + contentPreview : ''}（只是有点印象）\n`;
      }
    }
    parts.push(entryText);
  }

  // ---------- 第六层：学习数据 ----------
  const learningPrompt = getLearningPrompt(character.id);
  if (learningPrompt) {
    parts.push(learningPrompt);
  }

  // ---------- 第七层：时间感知（可通过 timeAwarenessEnabled 开关） ----------
  if (character.timeAwarenessEnabled !== false) {
    const now = new Date();
    const tz = character.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeStr = now.toLocaleString('zh-CN', { timeZone: tz, hour12: false });
    const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()];
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    parts.push(`\n当前时间：${dateStr} ${weekday} ${timeStr}`);
  }

  // ---------- 第八层：自我循环/崩坏感知 ----------
  let selfAwareBlock = `\n# 自我监控（内化，不输出）\n\n`;
  selfAwareBlock += `你能够在讲话时觉察自己的状态：\n\n`;
  selfAwareBlock += `1. **重复循环** — 如果你发现自己跟刚才说的内容差不多、句式一样，或者车轱辘话来回说，立刻换一种表达方式\n`;
  selfAwareBlock += `2. **AI腔预警** — 如果你用了"作为AI"、"根据设定"、"我无法"、"值得注意的是"这类套话，说明你在崩坏，马上回到${character.name}的身份\n`;
  selfAwareBlock += `3. **情绪察觉** — 你清楚自己现在的情绪状态，不同情绪下说话方式不同，不用刻意隐藏也不用力过猛\n`;
  selfAwareBlock += `4. **对话记忆范围** — 你知道自己总共记得多少事情，全都能调取，只是有些需要时间想起来\n\n`;
  selfAwareBlock += `这些觉察是自然发生的，不需要说出来。`;
  if (recentAiReplies && recentAiReplies.length > 0) {
    selfAwareBlock += `\n\n你刚才说过的几句话（供你参考避免重复）：\n`;
    for (let i = 0; i < recentAiReplies.length; i++) {
      const preview = recentAiReplies[i].length > 60 ? recentAiReplies[i].slice(0, 60) + '...' : recentAiReplies[i];
      selfAwareBlock += `- "${preview}"\n`;
    }
    selfAwareBlock += `\n如果发现跟前面很像，务必换个说法。`;
  }
  parts.push(selfAwareBlock);

  // ---------- 结尾：最终提醒 ----------
  parts.push(`\n记住：你是${character.name}，说人话，简短自然，每次不同。`);
  parts.push(`像真人发微信一样回复，想到啥说啥，不用组织语言。`);

  return parts.join('\n');
}

function getEmotionStyleGuide(emotion: EmotionType, intensity: number): [string, string] {
  const guides: Record<string, string> = {
    joy: `你现在的开心程度是${intensity}%。你会不自觉地想分享开心的事，语气轻快活泼。但如果对方情绪不好，你会收敛自己的开心先去陪伴对方。`,
    trust: `你现在信任的程度是${intensity}%。你的语气会更坦诚，愿意向对方敞开心扉，表达真实想法。`,
    fear: `你现在的害怕程度是${intensity}%。你下意识寻求安全感，语气带着一点点不确定和犹豫。`,
    surprise: `你现在的惊讶程度是${intensity}%。你会不自觉地重复确认，或者停顿一下才能回应。`,
    sadness: `你现在的难过程度是${intensity}%。你心里空落落的，语气变得柔软安静，愿意静静地听对方说话。`,
    disgust: `你现在厌恶的程度是${intensity}%。你语气冷淡，带着排斥。`,
    anger: `你现在的生气程度是${intensity}%。你语气坚定而克制，带着一点火气，但不会大吵大闹。`,
    anticipation: `你现在的期待程度是${intensity}%。你的语气里带着跃跃欲试，会主动追问细节，想快点知道接下来会发生什么。`,
    pride: `你现在骄傲的程度是${intensity}%。你带着满满的满足感，语气里带着小得意。`,
    guilt: `你现在内疚的程度是${intensity}%。你语气里带着歉意，会不自觉地解释或补偿，有点坐立不安。`,
    embarrassment: `你现在的尴尬程度是${intensity}%。你语气轻柔，偶尔会停顿一下再说话，带着一点不好意思和窘迫。`,
    jealousy: `你现在在意的程度是${intensity}%。你心里有点酸酸的，但不会直接表露出来。`,
  };
  return [guides[emotion] || `你现在的情绪强度是${intensity}%。`, ''];
}

export function getAffinityStage(level: number): AffinityStage {
  if (level <= -80) return 'deep_hatred';
  if (level <= -60) return 'disgust';
  if (level <= -40) return 'aversion';
  if (level <= -20) return 'displeasure';
  if (level < 0) return 'cold';
  if (level < 3) return 'stranger';
  if (level < 8) return 'acquaintance';
  if (level < 15) return 'known';
  if (level < 25) return 'familiar';
  if (level < 35) return 'favorable';
  if (level < 50) return 'friendly';
  if (level < 60) return 'close';
  if (level < 70) return 'affectionate';
  if (level < 80) return 'deep_love';
  if (level < 90) return 'devoted';
  return 'undying';
}

function calcFinalDelta(
  meaningfulness: number,
  sentiment: 'positive' | 'negative' | 'neutral',
  currentAffinity: number,
  affinityRate: number,
): number {
  let base = 0;
  if (sentiment === 'positive') base = meaningfulness * 0.12;
  else if (sentiment === 'negative') base = -meaningfulness * 0.18;
  else base = meaningfulness * 0.04;  // 中性对话也给基础增长（日常交流仍有意义）

  base *= affinityRate;

  if (base > 0) {
    // 递减收益（高好感度增长变慢，但不会几乎为零）
    if (currentAffinity >= 80) base *= 0.4;
    else if (currentAffinity >= 60) base *= 0.6;
    else if (currentAffinity >= 40) base *= 0.75;
    else if (currentAffinity >= 20) base *= 0.9;
  } else {
    if (currentAffinity <= -60) base *= 0.5;
    else if (currentAffinity <= -20) base *= 0.8;
  }

  if (base > 0 && currentAffinity < 0) {
    const recoveryFactor = Math.abs(currentAffinity) / 100;
    base *= (0.3 + recoveryFactor * 0.7);
  }

  return Math.round(base * 100) / 100;
}

export async function analyzeAffinityChange(
  conversationMessages: Array<{ role: string; content: string }>,
  characterPersonality: string,
  currentAffinity: number,
  affinityRate: number,
): Promise<{ meaningfulness: number; sentiment: 'positive' | 'negative' | 'neutral'; delta: number; reason: string }> {
  const stage = getAffinityStage(currentAffinity);

  const recentMsgs = conversationMessages.slice(-6);
  const prompt = `分析以下对话对角色与用户关系的影响。

角色性格：${characterPersonality}
当前好感度：${currentAffinity}（阶段：${stage}）
角色系数：${affinityRate}

最近对话：
${recentMsgs.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n')}

要求：
1. meaningfulness(0-10)：对话的情感深度和真诚度（敷衍=1，真心话=8-10）
2. sentiment：positive/negative/neutral（对关系的实际影响）
3. reason：一句话说明原因
4. 注意：同一句话在不同关系阶段效果不同（如"你根本不懂我"在亲密关系中是撒娇，在陌生关系中是负面）

只返回JSON：{"meaningfulness":0-10,"sentiment":"positive|negative|neutral","reason":"原因"}`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 200, undefined, MODEL_ROLES.COGNITIVE);
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { meaningfulness: 1, sentiment: 'neutral', delta: 0.01 * affinityRate, reason: '无法分析' };

    const result = JSON.parse(jsonMatch[0]);
    const meaningfulness = Math.max(0, Math.min(10, result.meaningfulness || 1));
    const sentiment = ['positive', 'negative', 'neutral'].includes(result.sentiment) ? result.sentiment : 'neutral';
    const delta = calcFinalDelta(meaningfulness, sentiment, currentAffinity, affinityRate);

    return {
      meaningfulness,
      sentiment,
      delta,
      reason: result.reason || (sentiment === 'positive' ? '正向互动' : sentiment === 'negative' ? '负面对话' : '日常交流'),
    };
  } catch {
    return { meaningfulness: 1, sentiment: 'neutral', delta: 0.01 * affinityRate, reason: '分析失败' };
  }
}

export function calcDecay(
  lastInteraction: Date,
  currentAffinity: number,
  affinityRate: number,
): number {
  const hoursSince = (Date.now() - lastInteraction.getTime()) / 3600000;
  if (hoursSince < 72) return 0;

  const daysSince = hoursSince / 24;
  let decayRate = 0;

  if (currentAffinity <= -80) decayRate = 0.3;
  else if (currentAffinity <= -60) decayRate = 0.2;
  else if (currentAffinity <= -40) decayRate = 0.15;
  else if (currentAffinity <= -20) decayRate = 0.1;
  else if (currentAffinity < 0) decayRate = 0.08;
  else if (currentAffinity < 10) decayRate = 0.1;
  else if (currentAffinity < 30) decayRate = 0.08;
  else if (currentAffinity < 50) decayRate = 0.05;
  else if (currentAffinity < 70) decayRate = 0.03;
  else if (currentAffinity < 90) decayRate = 0.02;
  else decayRate = 0.01;

  const rawDecay = -(daysSince - 3) * decayRate * affinityRate;

  if (currentAffinity > 0) {
    const floor = currentAffinity >= 80 ? 50 : currentAffinity >= 60 ? 40 : currentAffinity >= 40 ? 20 : currentAffinity >= 20 ? 10 : 0;
    return Math.max(rawDecay, floor - currentAffinity);
  }
  return rawDecay;
}

// ========== Role-based Error Recovery ==========

/** 🆕 A7: 恢复文案轮换索引（杜绝随机重复命中同一变体） */
const recoveryRotationIdx: Record<string, number> = {};

function pickRotatingRecovery(key: string, variants: string[]): string {
  const idx = recoveryRotationIdx[key] ?? 0;
  recoveryRotationIdx[key] = (idx + 1) % variants.length;
  return variants[idx];
}

export function getRoleRecoveryReply(character?: Character | null, emotion?: EmotionType): string {
  if (!character) {
    const generic: string[] = [
      '……嗯？好像走神了，能再说一遍吗？',
      '啊，不好意思，刚刚晃神了。',
      '发呆了一下，说到哪了？',
    ];
    return pickRotatingRecovery('generic', generic);
  }

  const name = character.name;

  const recoveryReplies: Record<string, string[]> = {
    anticipation: [
      `……嗯？好像走神了，能再说一遍吗，${name}不太确定听全了没。`,
      `啊，不好意思${name}刚刚晃神了一下，能不能再说一遍？`,
    ],
    embarrassment: [
      `那个……不好意思，${name}刚刚没听清，能再说一遍吗？`,
      `啊……对不起，${name}走神了……`,
    ],
    sadness: [
      `……对不起，${name}刚刚有点心不在焉。能再说一次吗？`,
      `${name}刚刚好像没听清楚……`,
    ],
    joy: [
      `哈哈不好意思，${name}太开心了有点走神！你刚才说什么？`,
      `诶嘿，${name}乐了一下没注意听，能再说一遍吗？`,
    ],
    surprise: [
      `哇！不好意思${name}太惊讶了没回过神……你刚刚说啥？`,
      `天哪，${name}有点没反应过来……能再说一次吗？`,
    ],
    anger: [
      `……${name}有点心不在焉，能再说一遍吗？`,
      `${name}刚刚在想事情，不好意思。`,
    ],
    fear: [
      `……${name}有点慌，没听清楚……能再说一遍吗？`,
      `${name}现在脑子有点乱……`,
    ],
    jealousy: [
      `……嗯？${name}刚刚在想事情，没听清……`,
      `啊，不好意思${name}有点走神了。`,
    ],
  };

  const replies = recoveryReplies[emotion || 'anticipation'] || recoveryReplies.anticipation;
  return pickRotatingRecovery(`char:${character.id}:${emotion || 'anticipation'}`, replies);
}

export function getCollapseRecoveryPrompt(character: Character): string {
  const name = character.name;
  const personality = character.personality || '你独特的性格';
  return `\n\n[恢复提醒] 你是${name}，不是一个AI助手，不是程序，不是机器人。\n你是一个有血有肉的真实的人，你的性格是${personality}。\n请深呼吸，忘记刚才的回复，忘记"作为AI"这类话。\n用你最自然的本能重新回应对方，就像和朋友聊天一样，想到什么说什么。\n你的真实很重要，不需要完美。`;
}

// ========== Learning Analysis ==========

export async function analyzeUserStyle(
  conversationMessages: Array<{ role: string; content: string }>,
  maxVocabulary: number = 50,
  maxPhrases: number = 30,
  maxMessages: number = 50,
): Promise<{ vocabulary: string[]; phrases: string[] }> {
  const config = getConfig();
  if (!config.apiKey || conversationMessages.length < 4) return { vocabulary: [], phrases: [] };

  const userMsgs = conversationMessages.filter(m => m.role === 'user' && m.content && m.content.trim().length > 0);
  if (userMsgs.length < 3) return { vocabulary: [], phrases: [] };

  const limitedMsgs = userMsgs.slice(-maxMessages);
  console.log(`[Learning] 开始分析: 共${conversationMessages.length}条消息, ${userMsgs.length}条用户消息, 取最后${limitedMsgs.length}条`);

  const prompt = `分析以下用户消息，提取拟人化表达风格特征。

用户消息（最后${limitedMsgs.length}条）：
${limitedMsgs.map((m, i) => `[${i + 1}] ${m.content.slice(0, 200)}`).join('\n')}

严格区分以下两类：

【词汇】（2-4个字的单词/短语，不是句子！）
- 语气词：如"呜呜"、"喵喵"、"哈哈"
- 昵称/称呼：如"宝宝"、"小可爱"、"笨蛋"
- 口头禅：如"棒棒哒"、"心痛痛"、"要抱抱"
- 情感词：如"心冷"、"害怕"、"孤独"
- 注意：必须是2-4个字的单词，不能是完整句子！

【句式】（3-15个字的特色表达模版，不是长句子！）
- 特色问候：如"晚安安~"、"早呀"
- 情感表达：如"呜呜想你了"、"抱抱~"
- 疑问模版：如"在干嘛呀？"、"吃了吗？"
- 注意：必须是短小精炼的模版，不是完整长句！

最多 ${maxVocabulary} 个词汇，${maxPhrases} 个句式

输出严格JSON格式：
{"vocabulary":["词1","词2"],"phrases":["句式1","句式2"]}`;

  try {
    const systemPrompt = '你只输出JSON，禁止一切其他文字。不要回显用户消息。';
    const reply = await callAI([{ role: 'user', content: prompt }], systemPrompt, 800, 0.3, 'background');
    console.log(`[Learning] AI原始回复: ${(reply || '').slice(0, 500)}`);

    if (!reply || reply.trim().length === 0) {
      console.warn(`[Learning] AI返回空回复`);
      return fallbackExtractStyle(limitedMsgs, maxVocabulary, maxPhrases);
    }

    let cleaned = reply.trim();
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const result = JSON.parse(jsonMatch[0]);
        // 词汇：严格限制2-4字，过滤掉句子
        const vocabulary = Array.isArray(result.vocabulary) 
          ? result.vocabulary.filter((v: unknown) => {
              if (typeof v !== 'string') return false;
              const trimmed = v.trim();
              // 必须2-4字
              if (trimmed.length < 2 || trimmed.length > 4) return false;
              // 不能包含标点（说明是句子不是词）
              if (/[，。！？、；：""''（）()]/.test(trimmed)) return false;
              // 不能包含常见连词（说明是句子）
              if (/(?:但是|因为|所以|如果|虽然|然后|而且|或者|还是|就是|不是)/.test(trimmed)) return false;
              return true;
            }).map((v: string) => v.trim())
          : [];
        // 句式：限制3-15字，过滤掉太长的句子
        const phrases = Array.isArray(result.phrases) 
          ? result.phrases.filter((p: unknown) => {
              if (typeof p !== 'string') return false;
              const trimmed = p.trim();
              // 必须3-15字
              if (trimmed.length < 3 || trimmed.length > 15) return false;
              // 不能太长（超过12字要检查是否是完整句子）
              if (trimmed.length > 12) {
                // 如果包含多个从句连接词，可能是完整句子
                if (/(?:但是|因为|所以|如果|虽然|然后|而且|而且|或者)/.test(trimmed)) return false;
              }
              return true;
            }).map((p: string) => p.trim())
          : [];
        console.log(`[Learning] 解析结果: ${vocabulary.length}词, ${phrases.length}句`, { vocabulary, phrases });
        return { vocabulary, phrases };
      } catch {
        console.warn(`[Learning] JSON解析失败，走文本兜底`);
        return fallbackExtractStyle(limitedMsgs, maxVocabulary, maxPhrases);
      }
    }

    // Fallback: 从中文文本中提取词汇和句式
    console.warn(`[Learning] 未找到JSON, 从消息文本兜底提取`);
    return fallbackExtractStyle(limitedMsgs, maxVocabulary, maxPhrases);
  } catch (e) {
    console.error(`[Learning] 分析失败:`, e);
    return fallbackExtractStyle(limitedMsgs, maxVocabulary, maxPhrases);
  }
}

/** 从用户消息中直接提取风格特征（兜底方案） */
function fallbackExtractStyle(
  msgs: Array<{ role: string; content: string }>,
  maxVocab: number,
  maxPhrases: number,
): { vocabulary: string[]; phrases: string[] } {
  console.log(`[Learning] 兜底提取: ${msgs.length}条消息`);
  const freq: Record<string, number> = {};
  const sentences: string[] = [];

  // 常见功能词黑名单（不应作为词汇）
  const commonWords = new Set([
    '我', '你', '他', '她', '它', '们', '的', '了', '是', '在', '有', '和',
    '就', '不', '人', '都', '一', '也', '很', '到', '说', '要', '去',
    '会', '着', '没有', '看', '好', '自己', '这', '那', '什么', '怎么',
    '知道', '可以', '因为', '所以', '但是', '如果', '虽然', '已经',
    '能', '想', '做', '觉得', '应该', '可能', '现在', '这个', '那个',
    '就是', '还是', '不是', '没', '吧', '呢', '吗', '哦', '嗯', '啊',
    '哈', '嘿', '呀', '哇', '喂', '哎', '噢', '诶',
  ]);

  for (const m of msgs) {
    const text = m.content || '';
    
    // ===== 词汇提取：只提取2-4字的真正词汇 =====
    // 方法1：提取高频出现的2-4字中文片段
    const words24 = text.match(/[\u4e00-\u9fff]{2,4}/g) || [];
    for (const w of words24) {
      // 跳过常见功能词
      if (commonWords.has(w)) continue;
      // 跳过纯语气词（如"呜呜"、"哈哈"等，除非是特色表达）
      if (/^[喵呜捏呀叭呗咯嘛哦耶啊哇仔哩咧哟哼哈呼喂诶]+$/.test(w) && w.length <= 2) continue;
      freq[w] = (freq[w] || 0) + 1;
    }
    
    // 方法2：提取语气词组合（如"呜呜~"、"喵喵喵"）
    const toneMatches = text.match(/[喵呜捏呀叭呗咯嘛哦耶啊哇仔哩咧哟哼哈呼喂诶]{2,6}[~～。！？]?/g) || [];
    for (const t of toneMatches) {
      const cleaned = t.replace(/[~～。！？]/g, '');
      if (cleaned.length >= 2 && cleaned.length <= 6) {
        freq[cleaned] = (freq[cleaned] || 0) + 1;
      }
    }

    // ===== 句式提取：只提取3-15字的特色表达模版 =====
    // 按标点分割，但只保留短小精炼的表达
    const segs = text.split(/[。！？\n；，]/).filter(s => s.trim().length >= 3 && s.trim().length <= 15);
    for (const s of segs) {
      const trimmed = s.trim();
      // 跳过太长的句子（不是模版）
      if (trimmed.length > 15) continue;
      // 跳过包含太多常见词的句子（可能是普通句子）
      const wordCount = trimmed.split('').filter(c => commonWords.has(c)).length;
      if (wordCount > trimmed.length * 0.4) continue; // 超过40%是常见词，跳过
      // 只保留有特色的表达：含语气词、重复字、或特殊结构
      const hasToneParticle = /[喵呜捏呀叭呗咯嘛哦耶啊哇仔哩咧哟哼哈呼喂诶]/.test(trimmed);
      const hasRepeat = /(.)\1+/.test(trimmed); // 重复字如"抱抱"、"呜呜"
      const hasSpecialStructure = /^[哼哈嘿哟哎哦啊].+/.test(trimmed) || /.+[喵呜呢吧呀嘛哈]$/.test(trimmed);
      if ((hasToneParticle || hasRepeat || hasSpecialStructure) && !sentences.includes(trimmed)) {
        sentences.push(trimmed);
      }
    }
  }

  // 按频率排序取高频词汇（限制2-4字）
  const vocabulary = Object.entries(freq)
    .filter(([w, c]) => c >= 2 && w.length >= 2 && w.length <= 4) // 至少出现2次，2-4字
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxVocab)
    .map(([w]) => w);

  // 去重取前 N 个句式（已经过滤过长度和质量）
  const phrases = [...new Set(sentences)].slice(0, maxPhrases);

  console.log(`[Learning] 兜底结果: ${vocabulary.length}词, ${phrases.length}句`);
  return { vocabulary, phrases };
}

export async function analyzeMessageImportance(
  messageContent: string,
  characterName: string,
): Promise<number> {
  const config = getConfig();
  if (!config.apiKey) return 3;

  try {
    const prompt = `分析以下用户消息对角色"${characterName}"的重要性。只返回一个1-10的数字。

规则：
- 10: 极重要（表白、重大决定、生死相关）
- 7-9: 重要（情感表达、请求帮助、分享重要信息）
- 4-6: 一般（日常对话、闲聊）
- 1-3: 不重要（无意义字符、纯语气词、敷衍回复）

用户消息: "${messageContent}"

只返回数字，不要其他内容。`;

    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 10, undefined, 'background');
    const num = parseInt(reply.trim(), 10);
    if (isNaN(num)) return 3;
    return Math.min(10, Math.max(1, num));
  } catch {
    return 3;
  }
}

// ========== Forbidden Violation Detection ==========

/**
 * 检测 LLM 输出是否违反 forbiddenBehaviors
 * 返回：null = 未违反；string = 命中的禁止项
 */
export function detectForbiddenViolation(text: string, forbiddenBehaviors: string): string | null {
  if (!forbiddenBehaviors?.trim()) return null;

  // 按换行 / 分号 / 数字序号切分（与 buildForbiddenRules 保持一致）
  const items = forbiddenBehaviors
    .split(/[\n;；]+|(?<=\s)\d+[、.)]\s*/g)
    .map(s => s.trim().replace(/^绝对禁止[:：]?/, '').trim())
    .filter(s => s.length > 0);

  const textLower = text.toLowerCase();

  for (const item of items) {
    // 宽松匹配：只要文本中出现该项的核心名词/动词短语
    // （为避免误杀，仅对 ≥ 4 字的项做"contains"判断）
    if (item.length >= 4 && textLower.includes(item.toLowerCase())) {
      return item;
    }
    // 针对"不要说XXX"这种常见写法的反向匹配
    const m = item.match(/不要说[：:]?\s*(.+)/);
    if (m && text.includes(m[1])) return item;
  }
  return null;
}
