export type EmotionType =
  | 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise'
  | 'love' | 'neutral' | 'shy' | 'lonely' | 'grateful'
  | 'brave' | 'curiosity' | 'excitement' | 'pride' | 'disappointment'
  | 'confusion' | 'contentment' | 'nostalgia' | 'jealousy' | 'hope'
  | 'relief' | 'regret' | 'admiration'
  | 'anxious' | 'embarrassed' | 'tender'
  | 'disgusted' | 'jealous' | 'confused'
  | 'nostalgic' | 'proud' | 'surprised';

export interface EmotionState {
  type: EmotionType;
  intensity: number;
  timestamp: Date;
  trigger: string;
}

export interface Memory {
  id: string;
  characterId: string;
  conversationId: string;
  content: string;
  importance: number;
  tags: string[];
  createdAt: Date;
  lastRecalledAt?: Date;
  recallCount: number;
}

export interface Reflection {
  id: string;
  characterId: string;
  trigger: string;
  insight: string;
  emotionBefore: EmotionType;
  emotionAfter: EmotionType;
  createdAt: Date;
}

export interface Character {
  id: string;
  name: string;
  avatar: string;
  personality: string;
  description: string;
  tags: string[];
  greetingMessage: string;
  background: string;
  likes: string[];
  dislikes: string[];
  habits: string[];
  catchphrases: string[];
  exampleDialogues?: string[];
  emotionTriggers: string;
  emotionExpressions: string;
  thinkingStyle: string;
  relationshipStages: string;
  responseStyle: string;
  identityAnchors: string;
  forbiddenBehaviors: string;
  outputFormat: string;
  memoryImportanceThreshold: number;
  reflectionEnabled: boolean;
  timeAwarenessEnabled: boolean;
  timezone: string;
  affinityRate: number;
  creationMode?: 'simple' | 'panel' | 'ai';
}

export interface MessageAttachment {
  id: string;
  type: 'image' | 'file' | 'video' | 'audio';
  name: string;
  path: string;
  size: number;
  mimeType?: string;
  description?: string;
  fileId?: string; // Reference to files table in SQLite
}

export interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  emotion?: EmotionType;
  emotionIntensity?: number;
  segments?: string[];
  attachments?: MessageAttachment[];
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  characterId: string;
  createdAt: Date;
  updatedAt: Date;
  testMode?: boolean;
}

export interface EmotionRecord {
  id: string;
  emotion: EmotionType;
  intensity: number;
  timestamp: Date;
  context: string;
  characterId?: string;
}

export type AffinityStage =
  | 'deep_hatred'   // -100 ~ -80
  | 'disgust'       // -80 ~ -60
  | 'aversion'      // -60 ~ -40
  | 'displeasure'   // -40 ~ -20
  | 'cold'          // -20 ~ 0
  | 'stranger'      // 0 ~ 5
  | 'acquaintance'  // 5 ~ 10
  | 'known'         // 10 ~ 20
  | 'familiar'      // 20 ~ 30
  | 'favorable'     // 30 ~ 40
  | 'friendly'      // 40 ~ 50
  | 'close'         // 50 ~ 60
  | 'affectionate'  // 60 ~ 70
  | 'deep_love'     // 70 ~ 80
  | 'devoted'       // 80 ~ 90
  | 'undying';      // 90 ~ 100

export interface AffinityEvent {
  id: string;
  characterId: string;
  delta: number;
  reason: string;
  timestamp: Date;
  emotion?: EmotionType;
}

export interface AffinityState {
  level: number;
  stage: AffinityStage;
  history: AffinityEvent[];
  lastInteraction: Date;
}

// ========== Memory Module ==========

export type MemoryCategory = 'summary' | 'thinking' | 'analysis' | 'reflection' | 'fact' | 'user_message';

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  summary: '对话总结',
  thinking: 'AI 思考',
  analysis: '分析',
  reflection: '反思',
  fact: '事实',
  user_message: '用户消息',
};

export const MEMORY_CATEGORY_COLORS: Record<MemoryCategory, string> = {
  summary: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  thinking: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  analysis: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  reflection: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  fact: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  user_message: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

export interface MemoryEntry {
  id: string;
  characterId: string;
  conversationId: string;
  category: MemoryCategory;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  createdAt: Date;
  triggerMessage?: string;
}

// ========== File Storage ==========

export interface FileRecord {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  characterId?: string;
  conversationId?: string;
  createdAt: Date;
}

export interface FileData extends FileRecord {
  data: string; // base64 encoded
}

// ========== Multi-dimensional Emotion State (v2) ==========

export type EmotionDimension =
  | 'joy' | 'sadness' | 'anger' | 'fear' | 'surprise'
  | 'trust' | 'disgust' | 'anticipation'
  | 'shy' | 'lonely' | 'grateful' | 'excitement'
  | 'curiosity' | 'contentment';

export interface MultiEmotionState {
  /** 各情绪维度值（0~100），默认全 0 */
  values: Partial<Record<EmotionDimension, number>>;
  /** 时间戳：上次更新（用于衰减） */
  lastUpdated: number;
  /** 累积交互次数，用于某些调试 */
  interactions: number;
  /** 历史衰减轨迹（用于面板展示，可选） */
  history?: Array<{ ts: number; snapshot: Partial<Record<EmotionDimension, number>> }>;
}

/** 默认空状态 */
export const defaultMultiEmotionState: MultiEmotionState = {
  values: {},
  lastUpdated: Date.now(),
  interactions: 0,
};

// ========== MBTI ==========

export type MbtiDimension = 'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P';

export type MbtiType =
  | 'INTJ' | 'INTP' | 'ENTJ' | 'ENTP' | 'INFJ' | 'INFP' | 'ENFJ' | 'ENFP'
  | 'ISTJ' | 'ISFJ' | 'ESTJ' | 'ESFJ' | 'ISTP' | 'ISFP' | 'ESTP' | 'ESFP';

export interface MbtiQuestion {
  id: number;
  dimension: 'EI' | 'SN' | 'TF' | 'JP';
  text: string;
  optionA: { label: string; value: MbtiDimension };
  optionB: { label: string; value: MbtiDimension };
}

export interface MbtiResult {
  type: MbtiType;
  dimensions: { EI: number; SN: number; TF: number; JP: number };
  completedAt: Date;
}

// ========== User Profile ==========

export interface UserProfile {
  avatar: string;
  nickname: string;
  age: string;
  gender: string;
  mbti: string;
  personality: string;
  background: string;
  interests: string;
  habits: string;
  notes: string;
}
