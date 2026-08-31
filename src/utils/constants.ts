import { Character, EmotionType } from '../types';
import defaultCharactersData from '../data/builtin-characters.json';

export const defaultCharacters: Character[] = defaultCharactersData as Character[];

const VALID_EMOTION_SET = new Set<string>([
  'joy', 'trust', 'fear', 'surprise',
  'sadness', 'disgust', 'anger', 'anticipation',
  'pride', 'guilt', 'embarrassment', 'jealousy',
  'curiosity', 'love',
  'gratitude', 'empathy', 'anxiety',
  'loneliness', 'disappointment',
]);

/** 旧版 27 种情绪 → 12 维映射（用于读取旧数据兼容） */
const LEGACY_EMOTION_MAP: Record<string, EmotionType> = {
  love: 'trust', neutral: 'anticipation', lonely: 'loneliness',
  grateful: 'gratitude', brave: 'trust', curiosity: 'anticipation',
  excitement: 'joy', disappointment: 'disappointment', confusion: 'fear',
  contentment: 'anticipation', nostalgia: 'sadness', hope: 'anticipation',
  relief: 'joy', regret: 'guilt', admiration: 'trust',
  anxious: 'anxiety', embarrassed: 'embarrassment', tender: 'joy',
  disgusted: 'disgust', shy: 'embarrassment',
};

export function normalizeEmotion(emotion: string): EmotionType {
  if (VALID_EMOTION_SET.has(emotion)) return emotion as EmotionType;
  const mapped = LEGACY_EMOTION_MAP[emotion];
  if (mapped) return mapped;
  return 'anticipation';
}

/** 19 维情绪中文标签 */
export const emotionLabels: Record<EmotionType, string> = {
  joy: '喜悦', trust: '信任', fear: '恐惧', surprise: '惊讶',
  sadness: '悲伤', disgust: '厌恶', anger: '愤怒', anticipation: '期待',
  pride: '得意', guilt: '内疚', embarrassment: '尴尬', jealousy: '嫉妒',
  curiosity: '好奇', love: '爱慕',
  gratitude: '感恩', empathy: '共情', anxiety: '焦虑',
  loneliness: '孤独', disappointment: '失望',
};

export const emotionColors: Record<EmotionType, string> = {
  joy: '#F59E0B',
  trust: '#10B981',
  fear: '#8B5CF6',
  surprise: '#EC4899',
  sadness: '#60A5FA',
  disgust: '#86EFAC',
  anger: '#EF4444',
  anticipation: '#22D3EE',
  pride: '#D946EF',
  guilt: '#9CA3AF',
  embarrassment: '#FB923C',
  jealousy: '#EAB308',
  curiosity: '#34D399',
  love: '#FB7185',
  gratitude: '#FBBF24',
  empathy: '#A78BFA',
  anxiety: '#F87171',
  loneliness: '#94A3B8',
  disappointment: '#6366F1',
};

export const affinityStageLabels: Record<string, string> = {
  deep_hatred: '深仇',
  disgust: '厌恶',
  aversion: '反感',
  displeasure: '不悦',
  cold: '冷淡',
  stranger: '陌路',
  acquaintance: '初识',
  known: '认识',
  familiar: '熟悉',
  favorable: '好感',
  friendly: '友好',
  close: '亲近',
  affectionate: '喜爱',
  deep_love: '深情',
  devoted: '痴恋',
  undying: '至死不渝',
};
