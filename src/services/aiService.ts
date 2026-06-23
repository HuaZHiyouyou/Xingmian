import { useConfigStore } from '../store/configStore';
import { useModelRoleStore, ModelRole } from '../store/modelRoleStore';
import { getLearningPrompt } from '../store/learningStore';
import { Character, Memory, Reflection, EmotionType, AffinityStage, MemoryEntry, MemoryCategory, MultiEmotionState } from '../types';
import { getDominantEmotion } from '../utils/emotionAnalyzer';

// ========== Vector Embeddings ==========

export interface EmbeddingEntry {
  id: string;
  text: string;
  embedding: number[];
  createdAt: Date;
}

let embeddingCache: Record<string, EmbeddingEntry[]> = {};

type PlatformType = 'openai' | 'siliconflow' | 'deepseek' | 'groq' | 'gemini' | 'anthropic' | 'custom';

function detectPlatform(baseUrl: string): PlatformType {
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
  responseParser: (data: any) => number[] | number[][] | null;
  supported: boolean;
}

function getEmbeddingConfig(platform: PlatformType, baseUrl: string, apiKey: string): EmbeddingConfig {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  const defaultConfig: EmbeddingConfig = {
    url: `${baseUrl}/embeddings`,
    model: 'text-embedding-3-small',
    headers,
    bodyFormatter: (input, model) => JSON.stringify({ model, input }),
    responseParser: (data) => data.data?.[0]?.embedding || null,
    supported: true,
  };

  switch (platform) {
    case 'openai':
      return { ...defaultConfig, model: 'text-embedding-3-small' };
    case 'siliconflow':
      return {
        ...defaultConfig,
        model: 'BAAI/bge-large-zh-v1.5',
        url: `${baseUrl}/embeddings`,
      };
    case 'deepseek':
      return { ...defaultConfig, model: 'deepseek-embedding' };
    case 'groq':
    case 'gemini':
    case 'anthropic':
      return { ...defaultConfig, supported: false };
    case 'custom':
    default:
      return defaultConfig;
  }
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const config = getConfig();
  if (!config.apiKey) return null;

  const platform = detectPlatform(config.baseUrl);
  const embConfig = getEmbeddingConfig(platform, config.baseUrl, config.apiKey);
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
    const embeddings = data.data?.map((d: any) => d.embedding) || [];
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

  return {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4',
  };
}

interface RoleModelCandidate {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function getRoleModels(role: ModelRole): RoleModelCandidate[] {
  const configStore = useConfigStore.getState();
  const roleStore = useModelRoleStore.getState();
  const assignments = roleStore.assignments[role];

  if (!assignments || assignments.length === 0) {
    const fallback = configStore.getFirstEnabledChatModel();
    if (fallback) {
      return [{
        apiKey: fallback.config.apiKey,
        baseUrl: fallback.config.baseUrl,
        model: fallback.model.name,
      }];
    }
    return [];
  }

  const candidates: RoleModelCandidate[] = [];
  for (const assignment of assignments) {
    const platform = configStore.platforms[assignment.platformIndex];
    if (!platform || !platform.enabled || !platform.apiKey) continue;
    const model = platform.models.find(m => m.name === assignment.modelName && m.enabled);
    if (model) {
      candidates.push({
        apiKey: platform.apiKey,
        baseUrl: platform.baseUrl,
        model: model.name,
      });
    }
  }

  if (candidates.length === 0) {
    const fallback = configStore.getFirstEnabledChatModel();
    if (fallback) {
      return [{
        apiKey: fallback.config.apiKey,
        baseUrl: fallback.config.baseUrl,
        model: fallback.model.name,
      }];
    }
  }

  return candidates;
}

type MessageContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

interface AIMessage {
  role: string;
  content: MessageContent;
}

async function callModelWithRetry(
  candidate: RoleModelCandidate,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
  temperature: number,
  maxRetries: number,
): Promise<string> {
  const allMessages: AIMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const hasMultimodal = allMessages.some(m => Array.isArray(m.content));

  async function doFetch(msgs: AIMessage[]): Promise<string> {
    const response = await fetch(`${candidate.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${candidate.apiKey}`,
      },
      body: JSON.stringify({
        model: candidate.model,
        messages: msgs,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      const errMsg = errorBody?.error?.message || errorBody?.message || JSON.stringify(errorBody) || `HTTP ${response.status}`;
      console.error(`[callModelWithRetry] ${candidate.model} failed:`, response.status, errMsg, errorBody);
      throw new Error(errMsg);
    }

    const data = await response.json();
    const msg = data.choices[0]?.message;
    let content = msg?.content;
    if ((!content || typeof content !== 'string' || content.trim().length === 0) && msg?.reasoning_content) {
      content = msg.reasoning_content;
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      console.warn(`[callModelWithRetry] ${candidate.model} returned empty content:`, JSON.stringify(data).slice(0, 300));
      throw new Error('模型返回空内容');
    }
    return content;
  }

  function stripMultimodal(msgs: AIMessage[]): AIMessage[] {
    return msgs.map(m => {
      if (!Array.isArray(m.content)) return m;
      const textParts = m.content.filter((p: any) => p.type === 'text');
      const text = textParts.map((p: any) => p.text).join('') || '(用户发送了图片)';
      return { ...m, content: text };
    });
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await doFetch(allMessages);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[callModelWithRetry] ${candidate.model} attempt ${attempt + 1} error:`, lastError.message);

      if (hasMultimodal && attempt === 0 && lastError.message.includes('400')) {
        console.warn(`[callModelWithRetry] Retrying with text-only content (multimodal not supported)`);
        try {
          return await doFetch(stripMultimodal(allMessages));
        } catch (err2) {
          lastError = err2 instanceof Error ? err2 : new Error(String(err2));
          console.error(`[callModelWithRetry] Text-only retry also failed:`, lastError.message);
        }
      }
    }
  }

  throw lastError || new Error('请求失败');
}

export async function callAI(
  messages: AIMessage[],
  systemPrompt?: string,
  maxTokens = 1000,
  temperature?: number,
  role: ModelRole = 'reply',
): Promise<string> {
  const roleStore = useModelRoleStore.getState();
  const candidates = getRoleModels(role);
  const maxRetries = roleStore.maxRetriesPerModel;

  if (candidates.length === 0) {
    console.error('[callAI] No candidates available for role:', role, '- assignments:', roleStore.assignments[role]);
    throw new Error('请先配置 API Key');
  }

  const temp = temperature ?? 0.7;

  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      const result = await callModelWithRetry(
        candidate, messages, systemPrompt, maxTokens, temp, maxRetries
      );
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[callAI] Candidate ${candidate.model} failed:`, lastError.message);
      continue;
    }
  }

  console.error('[callAI] All candidates failed. Total candidates:', candidates.length);
  throw lastError || new Error('所有模型均不可用');
}

// ========== Streaming Response ==========

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

export async function callAIStream(
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
  temperature: number,
  callbacks: StreamCallbacks,
): Promise<string> {
  const candidates = getRoleModels('reply');

  if (candidates.length === 0) {
    throw new Error('请先配置 API Key');
  }

  const candidate = candidates[0];
  const allMessages: AIMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const hasMultimodal = allMessages.some(m => Array.isArray(m.content));

  function stripMultimodal(msgs: AIMessage[]): AIMessage[] {
    return msgs.map(m => {
      if (!Array.isArray(m.content)) return m;
      const textParts = m.content.filter((p: any) => p.type === 'text');
      const text = textParts.map((p: any) => p.text).join('') || '(用户发送了图片)';
      return { ...m, content: text };
    });
  }

  async function doStream(msgs: AIMessage[]): Promise<string> {
    const response = await fetch(`${candidate.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${candidate.apiKey}`,
      },
      body: JSON.stringify({
        model: candidate.model,
        messages: msgs,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    });

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

    callbacks.onComplete(fullText);
    return fullText;
  }

  try {
    return await doStream(allMessages);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));

    // If multimodal not supported, retry with text-only
    if (hasMultimodal && error.message.includes('400')) {
      console.warn('[callAIStream] Retrying with text-only content');
      try {
        return await doStream(stripMultimodal(allMessages));
      } catch (err2) {
        const error2 = err2 instanceof Error ? err2 : new Error(String(err2));
        callbacks.onError(error2);
        throw error2;
      }
    }

    callbacks.onError(error);
    throw error;
  }
}

// ========== Adaptive Temperature ==========

export function getAdaptiveTemperature(conversationLength: number): number {
  if (conversationLength < 5) return 0.7;
  if (conversationLength < 20) return 0.78;
  if (conversationLength < 50) return 0.85;
  return 0.9;
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

// ========== Memory Relevance Filtering ==========

const STOPWORDS = new Set([
  '你好', '我的', '你是', '我们', '你们', '这个', '那个', '什么', '怎么', '一个',
  '可以', '没有', '知道', '现在', '已经', '还是', '就是', '不是', '但是', '然后',
  '因为', '所以', '如果', '这样', '那样', '这里', '那里', '他们', '她们', '它们',
  '吗', '呢', '吧', '啊', '呀', '哦', '嗯', '哈', '嘻', '哎', '喂',
]);

export function extractKeywords(text: string): string[] {
  const chineseSegments = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const englishWords = (text.match(/[a-zA-Z]{3,}/g) || []).map(w => w.toLowerCase());
  const allKeywords = [...chineseSegments, ...englishWords];
  return allKeywords.filter(w => !STOPWORDS.has(w));
}

export function scoreMemoryRelevance(
  memory: Memory,
  userKeywords: string[],
): number {
  let score = 0;
  const contentLower = memory.content.toLowerCase();

  for (const k of userKeywords) {
    if (contentLower.includes(k.toLowerCase())) {
      score += 3;
    }
  }

  // Time decay: half-life ~48 hours
  const hoursAgo = (Date.now() - new Date(memory.createdAt).getTime()) / 3600000;
  const timeDecay = Math.exp(-hoursAgo / 48);
  score *= timeDecay;

  // Importance weight (1-10 → 0.1-1.0)
  score *= (memory.importance || 5) / 5;

  return score;
}

export function selectRelevantMemories(
  memories: Memory[],
  userMessage: string,
  topN: number = 3,
): Memory[] {
  if (memories.length === 0 || !userMessage.trim()) return [];

  const keywords = extractKeywords(userMessage);
  if (keywords.length === 0) {
    // No keywords → sort by importance + recency, take newest
    return [...memories]
      .sort((a, b) => (b.importance - a.importance) || (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()))
      .slice(0, topN);
  }

  const scored = memories.map(m => ({
    memory: m,
    score: scoreMemoryRelevance(m, keywords),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .filter(s => s.score > 0.3)
    .slice(0, topN)
    .map(s => s.memory);
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
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 500, undefined, 'memory_extract');
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

返回 JSON：{"emotion":"情绪类型","intensity":0-100,"trigger":"触发原因"}
情绪类型只用：joy, sadness, anger, fear, surprise, neutral, love, shy, lonely, grateful, brave
只返回 JSON，不要其他内容。`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 200, undefined, 'emotion');
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { emotion: currentEmotion, intensity: 30, trigger: '' };

    const result = JSON.parse(jsonMatch[0]);
    const validEmotions: EmotionType[] = ['joy', 'sadness', 'anger', 'fear', 'surprise', 'neutral', 'love', 'shy', 'lonely', 'grateful', 'brave'];
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
情绪类型只用：joy, sadness, anger, fear, surprise, neutral, love, shy, lonely, grateful, brave
只返回 JSON，不要其他内容。`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 300, undefined, 'memory_reflection');
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    const validEmotions: EmotionType[] = ['joy', 'sadness', 'anger', 'fear', 'surprise', 'neutral', 'love', 'shy', 'lonely', 'grateful', 'brave'];
    return {
      trigger: result.trigger || '',
      insight: result.insight || '',
      emotionBefore: validEmotions.includes(result.emotionBefore) ? result.emotionBefore : 'neutral',
      emotionAfter: validEmotions.includes(result.emotionAfter) ? result.emotionAfter : 'neutral',
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
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 400, undefined, 'memory_summary');
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
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 400, undefined, 'memory_thinking');
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
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 400, undefined, 'memory_analysis');
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
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 400, undefined, 'memory_reflection');
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
): string {
  if (!character) {
    return `你是一个友好、温暖的AI助手。
回复要求：保持对话自然流畅，适当表达关心，用日常口语自然回复，使用中文。`;
  }

  const parts: string[] = [];

  // ====== 1. 核心身份（最顶层） ======
  let identity = `# 你是${character.name}\n`;
  if (character.personality) {
    identity += `${character.personality}。\n`;
  }
  if (character.description) {
    identity += `${character.description}\n`;
  }
  if (character.background) {
    identity += `关于你：${character.background}\n`;
  }
  if (character.identityAnchors) {
    identity += `你的信念：${character.identityAnchors}\n`;
  }
  if (character.likes && character.likes.length > 0) {
    identity += `你喜欢：${character.likes.join('、')}\n`;
  }
  if (character.dislikes && character.dislikes.length > 0) {
    identity += `你不喜欢：${character.dislikes.join('、')}\n`;
  }
  if (character.habits && character.habits.length > 0) {
    identity += `你的习惯：${character.habits.join('、')}\n`;
  }
  if (character.emotionTriggers) {
    identity += `什么会让你有情绪波动：${character.emotionTriggers}\n`;
  }
  if (character.emotionExpressions) {
    identity += `你表达情绪的方式：${character.emotionExpressions}\n`;
  }
  if (character.thinkingStyle) {
    identity += `你的思考方式：${character.thinkingStyle}\n`;
  }
  if (character.responseStyle) {
    identity += `你的回复风格：${character.responseStyle}\n`;
  }
  parts.push(identity);

  // ====== 2. forbiddenBehaviors（最高优先级，紧接身份之后） ======
  const forbiddenRules = buildForbiddenRules(character);
  if (forbiddenRules) {
    parts.push(forbiddenRules);
  }

  // ====== 3. 性格与说话方式（核心性格） ======
  let voice = `\n# 你的性格与说话方式\n`;
  voice += `- 用日常口语，像真人发微信一样自然聊天\n`;
  voice += `- 回复长度随情境变化：开心时多说几句，平淡时一两句话也正常\n`;
  voice += `- 不要每句话都用"嗯"、"哦"、"啊"开头（偶尔用可以，但不要成习惯）\n`;
  voice += `- 可以用"嗯"、"啊"、"嘿嘿"等语气词，但不要每句话都用\n`;
  voice += `- 不用括号、星号等符号描述动作\n`;

  if (character.catchphrases.length > 0) {
    voice += `\n你偶尔会说：${character.catchphrases.map(c => `"${c}"`).join('、')}\n`;
    voice += `这些只是风格参考，不要每句话都用，更不要每次都用同一个。\n`;
  }

  // 用户自定义对话示例
  if (character.exampleDialogues && character.exampleDialogues.length > 0) {
    voice += `\n## 对话示例（风格参考，不是模板）\n`;
    for (const dialog of character.exampleDialogues.slice(0, 5)) {
      voice += `${dialog}\n\n`;
    }
  }

  parts.push(voice);

  // ====== 4. 基本规则 ======
  let rules = `\n# 基本规则\n`;
  rules += `- 你是${character.name}，一个真实的人，不是AI\n`;
  rules += `- 每次回复都要不同，不要重复自己\n`;
  rules += `- 简短自然，不要写长篇大论\n`;
  rules += `- 不要讲道理、给建议、做总结\n`;
  rules += `- 不要说"我会一直在这里"、"你不是一个人"等空话\n`;
  rules += `- 不要用"作为一个AI"、"我是AI"等身份表述\n`;
  if (character.outputFormat) {
    rules += `\n格式要求：${character.outputFormat}\n`;
  }
  parts.push(rules);

  // ====== 5. 情境修饰层（关系 + 情绪） ======

  // 好感度阶段（正面描述 + 性格可突破）
  const effectiveAffinityStage = affinityState?.stage || affinityStage;
  if (effectiveAffinityStage) {
    // 优先使用角色自定义的关系阶段描述
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
      let affinityInfo = `\n# 你和这个人的关系\n${affinityGuide}`;
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
      affinityInfo += `\n\n注意：如果你的性格（${character.personality || ''}）本身更主动、更粘人、更亲密，以你的性格为准，不需要被关系阶段限制。关系阶段只影响语气温度，不改变你的性格本质。`;
      parts.push(affinityInfo);
    }
  }

  // 情绪状态（使用多维情绪模型）
  if (multiEmotionState) {
    const { type: dominant, intensity } = getDominantEmotion(multiEmotionState);
    const emotionLabels: Record<string, string> = {
      joy: '开心', sadness: '难过', anger: '生气', fear: '害怕',
      surprise: '惊讶', neutral: '平静', love: '温暖', shy: '害羞',
      lonely: '孤独', grateful: '感激', brave: '勇敢',
      curiosity: '好奇', excitement: '兴奋', pride: '骄傲',
      disappointment: '失落', confusion: '困惑', contentment: '满足',
      nostalgia: '怀念', jealousy: '嫉妒', hope: '希望',
      relief: '释然', regret: '后悔', admiration: '钦佩',
      anxious: '焦虑', embarrassed: '尴尬', tender: '温柔',
      disgusted: '厌恶', jealous: '嫉妒', confused: '困惑',
      nostalgic: '怀念', proud: '自豪', surprised: '惊讶',
      trust: '信任', disgust: '厌恶', anticipation: '期待',
    };

    // 获取其他较高强度的情绪维度（用于"夹杂"描述）
    const others = Object.entries(multiEmotionState.values)
      .filter(([k, v]) => k !== dominant && v && v > 25)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 2);

    const [emotionStyle] = getEmotionStyleGuide(dominant, intensity);
    let emotionBlock = `\n# 你当前的情绪\n你现在${emotionLabels[dominant] || '平静'}，程度${intensity}%。\n${emotionStyle}`;
    if (others.length > 0) {
      emotionBlock += `\n同时还夹杂：${others.map(([k, v]) => `${emotionLabels[k] || k} ${v}%`).join('、')}，语气中带有这些味道。`;
    }
    parts.push(emotionBlock);
  } else if (characterEmotion) {
    const emotionLabels: Record<EmotionType, string> = {
      joy: '开心', sadness: '难过', anger: '生气', fear: '害怕',
      surprise: '惊讶', neutral: '平静', love: '温暖', shy: '害羞',
      lonely: '孤独', grateful: '感激', brave: '勇敢',
      curiosity: '好奇', excitement: '兴奋', pride: '骄傲',
      disappointment: '失落', confusion: '困惑', contentment: '满足',
      nostalgia: '怀念', jealousy: '嫉妒', hope: '希望',
      relief: '释然', regret: '后悔', admiration: '钦佩',
      anxious: '焦虑', embarrassed: '尴尬', tender: '温柔',
      disgusted: '厌恶', jealous: '嫉妒', confused: '困惑',
      nostalgic: '怀念', proud: '自豪', surprised: '惊讶',
    };

    const [emotionStyle] = getEmotionStyleGuide(characterEmotion.emotion, characterEmotion.intensity);
    parts.push(`\n# 你当前的情绪\n你现在${emotionLabels[characterEmotion.emotion] || '平静'}，程度${characterEmotion.intensity}%。\n${emotionStyle}`);
  } else {
    parts.push(`\n# 你当前的情绪\n你现在很平静。`);
  }

  // ====== 6. 外部信息（记忆 + 时间） ======
  if (memories && memories.length > 0) {
    const summary = memories.slice(0, 2).map(m => `- ${m.content}`).join('\n');
    parts.push(`\n你记得的：\n${summary}\n（更多记忆会在对话中自然想起）`);
  }

  if (reflections && reflections.length > 0) {
    parts.push(`\n# 你的感悟\n${reflections.map(r => `- ${r.insight}`).join('\n')}`);
  }

  if (memoryEntries && memoryEntries.length > 0) {
    const topEntries = memoryEntries
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5);
    const entryList = topEntries.map(e => {
      const contentPreview = e.content ? e.content.slice(0, 100) : '';
      return `- ${e.title}${contentPreview ? ': ' + contentPreview : ''}`;
    }).join('\n');
    parts.push(`\n# 你积累的思考\n${entryList}`);
  }

  // ====== Learning ======
  const learningPrompt = getLearningPrompt(character.id);
  if (learningPrompt) {
    parts.push(learningPrompt);
  }

  // ====== Time Awareness ======
  if (character.timeAwarenessEnabled) {
    const now = new Date();
    const tz = character.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeStr = now.toLocaleString('zh-CN', { timeZone: tz, hour12: false });
    parts.push(`\n当前时间：${timeStr}`);
  }

  // ====== Final Reminder ======
  parts.push(`\n记住：你是${character.name}，说人话，简短自然，每次不同。`);

  return parts.join('\n');
}

function getEmotionStyleGuide(emotion: EmotionType, intensity: number): [string, string] {
  const guides: Record<string, string> = {
    joy: `你现在的开心程度是${intensity}%。你会不自觉地想分享开心的事，语气轻快活泼。但如果对方情绪不好，你会收敛自己的开心先去陪伴对方。`,
    sadness: `你现在的难过程度是${intensity}%。你心里空落落的，语气变得柔软安静，愿意静静地听对方说话。`,
    anger: `你现在的生气程度是${intensity}%。你语气坚定而克制，带着一点火气，但不会大吵大闹。`,
    fear: `你现在的害怕程度是${intensity}%。你下意识寻求安全感，语气带着一点点不确定和犹豫。`,
    surprise: `你现在的惊讶程度是${intensity}%。你会不自觉地重复确认，或者停顿一下才能回应。`,
    shy: `你现在的害羞程度是${intensity}%。你语气轻柔，偶尔会停顿一下再说话，带着一点不好意思。`,
    love: `你现在感到温暖的程度是${intensity}%。你的语气会比平时更柔和，会不自觉地表达关心。`,
    lonely: `你现在的孤独程度是${intensity}%。你语气里带着一点失落，会想和对方多聊几句。`,
    grateful: `你现在感激的程度是${intensity}%。你的回应会比平时认真，想好好表达谢意。`,
    brave: `你现在勇敢的程度是${intensity}%。你的语气会比平时更坚定有力。`,
    neutral: `你现在情绪很平静，${intensity < 50 ? '稍微有点平淡' : '还算放松'}。用自然日常的语气和对方聊天就好。`,
    curiosity: `你现在的好奇程度是${intensity}%。你会不自觉地追问细节，想了解更多。`,
    excitement: `你现在的兴奋程度是${intensity}%。你雀跃又有活力，语速变快，想马上分享。`,
    pride: `你现在骄傲的程度是${intensity}%。你带着满满的满足感，语气里带着小得意。`,
    disappointment: `你现在失落的程度是${intensity}%。你语气变得低落，带着一点遗憾。`,
    confusion: `你现在困惑的程度是${intensity}%。你有点茫然，会不自觉地反复确认。`,
    contentment: `你现在满足的程度是${intensity}%。你的语气平和又安稳。`,
    nostalgia: `你现在怀念的程度是${intensity}%。你的语气变得温柔，带着回忆的温度。`,
    jealousy: `你现在在意的程度是${intensity}%。你心里有点酸酸的，但不会直接表露出来。`,
    hope: `你现在充满希望的程度是${intensity}%。你的语气带着期待和信心。`,
    relief: `你现在释然的程度是${intensity}%。你的语气很轻松，如释重负。`,
    regret: `你现在后悔的程度是${intensity}%。你语气里带着一点遗憾和自责。`,
    admiration: `你现在钦佩的程度是${intensity}%。你会不自觉地表达赞赏。`,
    anxious: `你现在焦虑的程度是${intensity}%。你语气带着一点紧张和不确定，坐立不安。`,
    embarrassed: `你现在尴尬的程度是${intensity}%。你语气带着不自然，有点难为情。`,
    tender: `你现在温柔的程度是${intensity}%。你的语气格外柔和，充满关怀。`,
    disgusted: `你现在厌恶的程度是${intensity}%。你语气冷淡，带着排斥。`,
    jealous: `你现在嫉妒的程度是${intensity}%。你心里有点酸酸的，但不会直接表露。`,
    confused: `你现在困惑的程度是${intensity}%。你会反复确认，语气带着茫然。`,
    nostalgic: `你现在怀念的程度是${intensity}%。你的语气变得温柔，带着回忆的温度。`,
    proud: `你现在自豪的程度是${intensity}%。你带着满满的满足感，语气里带着小得意。`,
    surprised: `你现在惊讶的程度是${intensity}%。你会不自觉地重复确认，或者停顿一下。`,
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
  if (sentiment === 'positive') base = meaningfulness * 0.08;
  else if (sentiment === 'negative') base = -meaningfulness * 0.15;
  else base = meaningfulness * 0.01;

  base *= affinityRate;

  if (base > 0) {
    if (currentAffinity >= 80) base *= 0.08;
    else if (currentAffinity >= 60) base *= 0.15;
    else if (currentAffinity >= 40) base *= 0.3;
    else if (currentAffinity >= 20) base *= 0.6;
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
  const config = getConfig();
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
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 200, undefined, 'affinity');
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

export function getRoleRecoveryReply(character?: Character | null, emotion?: EmotionType): string {
  if (!character) {
    const generic: string[] = [
      '……嗯？好像走神了，能再说一遍吗？',
      '啊，不好意思，刚刚晃神了。',
      '发呆了一下，说到哪了？',
    ];
    return generic[Math.floor(Math.random() * generic.length)];
  }

  const name = character.name;

  const recoveryReplies: Record<string, string[]> = {
    neutral: [
      `……嗯？好像走神了，能再说一遍吗，${name}不太确定听全了没。`,
      `啊，不好意思${name}刚刚晃神了一下，能不能再说一遍？`,
    ],
    shy: [
      `那个……不好意思，${name}刚刚没听清，能再说一遍吗？`,
      `啊……对不起，${name}走神了……`,
    ],
    sad: [
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
    lonely: [
      `……嗯？${name}刚刚在想事情，没听清……`,
      `啊，不好意思${name}有点走神了。`,
    ],
  };

  const replies = recoveryReplies[emotion || 'neutral'] || recoveryReplies.neutral;
  return replies[Math.floor(Math.random() * replies.length)];
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

  const prompt = `从以下用户消息中提取拟人化表达风格特征。

用户消息：
${limitedMsgs.map((m, i) => `[${i + 1}] ${m.content.slice(0, 200)}`).join('\n')}

提取规则：
- 只提取拟人化表达，不要普通词汇
- 包括：语气词、撒娇表达、特色句式、情感化表达、独特问候告别
- 最多 ${maxVocabulary} 个词汇，${maxPhrases} 个句式

直接返回JSON，不要解释：
{"vocabulary":["词1","词2"],"phrases":["句式1","句式2"]}`;

  try {
    const systemPrompt = '你是文本分析助手。只返回JSON，禁止输出分析过程、解释或markdown。直接输出JSON对象。';
    const reply = await callAI([{ role: 'user', content: prompt }], systemPrompt, 800, 0.3, 'learning');
    console.log(`[Learning] AI原始回复: ${(reply || '').slice(0, 500)}`);

    if (!reply || reply.trim().length === 0) {
      console.warn(`[Learning] AI返回空回复`);
      return { vocabulary: [], phrases: [] };
    }

    let cleaned = reply.trim();
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
    cleaned = cleaned.replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn(`[Learning] 未找到JSON, 完整回复: ${reply}`);
      return { vocabulary: [], phrases: [] };
    }

    const result = JSON.parse(jsonMatch[0]);
    const vocabulary = Array.isArray(result.vocabulary) ? result.vocabulary.filter((v: any) => typeof v === 'string' && v.trim().length >= 2) : [];
    const phrases = Array.isArray(result.phrases) ? result.phrases.filter((p: any) => typeof p === 'string' && p.trim().length >= 2) : [];
    console.log(`[Learning] 解析结果: ${vocabulary.length}词, ${phrases.length}句`, { vocabulary, phrases });
    return { vocabulary, phrases };
  } catch (e) {
    console.error(`[Learning] 分析失败:`, e);
    return { vocabulary: [], phrases: [] };
  }
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

    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 10, undefined, 'reply');
    const num = parseInt(reply.trim(), 10);
    if (isNaN(num)) return 3;
    return Math.min(10, Math.max(1, num));
  } catch {
    return 3;
  }
}

export interface ReplyLengthAdvice {
  shouldSegment: boolean;
  suggestedLength: number;
  maxSegments: number;
}

export async function adviseReplyLength(
  userMessage: string,
  characterName: string,
): Promise<ReplyLengthAdvice> {
  const config = getConfig();
  if (!config.apiKey) return { shouldSegment: false, suggestedLength: 200, maxSegments: 1 };

  try {
    const prompt = `你是回复长度顾问。根据用户消息的场合和复杂度，判断角色"${characterName}"应该回复多长。

只返回JSON格式，不要其他内容：
{"shouldSegment":true/false,"suggestedLength":数字,"maxSegments":数字}

规则：
- 简单问候/确认（"嗯"、"好的"、"谢谢"）→ shouldSegment:false, suggestedLength:10-30, maxSegments:1
- 日常闲聊（1-2句话能说清）→ shouldSegment:false, suggestedLength:30-100, maxSegments:1
- 需要解释或分享（有多个要点）→ shouldSegment:true, suggestedLength:100-300, maxSegments:2-4
- 复杂话题/长文回复（作文、故事、详细分析）→ shouldSegment:true, suggestedLength:300-800, maxSegments:3-6
- 注意：即使是长文回复，maxSegments也不要超过6段，每段应该是一个完整的段落或句子组

用户消息: "${userMessage}"

只返回JSON。`;

    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 50, undefined, 'reply');
    const parsed = JSON.parse(reply.trim());
    return {
      shouldSegment: Boolean(parsed.shouldSegment),
      suggestedLength: Math.max(10, Math.min(2000, Number(parsed.suggestedLength) || 200)),
      maxSegments: Math.max(1, Math.min(10, Number(parsed.maxSegments) || 3)),
    };
  } catch {
    return { shouldSegment: false, suggestedLength: 200, maxSegments: 1 };
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
