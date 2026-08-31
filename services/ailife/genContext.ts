/**
 * ============================================================
 * 生活生成统一上下文（B5.3）
 * 所有 AI 一日生成器（日记/活动/总结/情绪转变/日程/初始档案）
 * 共用的"生成上下文前缀"：用户昵称 + V2 记忆检索 + 情绪 + 属性。
 * 修复实证问题：日记/活动文案以"用户"泛称主人、无记忆与情绪上下文。
 * ============================================================
 */
import { useUserProfileStore } from '../../store/userProfileStore';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useConfigStore } from '../../store/configStore';
import { useChatStore } from '../../store/chatStore';
import { retrieveRelevantMemories, buildMemoryPromptV2, convertToCoreMemory } from '../memory/memorySystemV2';
import { getCachedAttributes } from './attributeSystem';
import type { Character } from '../../types';

export interface LifeGenContext {
  /** 复用聊天管线的 getUserPrompt()：昵称、年龄、性别、与用户的关系 */
  userPrompt: string;
  /** V2 双层记忆检索（query=今日互动内容/活动关键词） */
  memoryPrompt: string;
  /** 当前主导情绪 + 多维情绪 top3 */
  moodLine: string;
  /** 七维属性快照（疲倦/饥饿等影响日记语气） */
  attrLine: string;
  /** 用户昵称（角色专属称呼优先级：后续可扩展 per-character 称呼） */
  nickname: string;
}

function extractNickname(userPrompt: string): string {
  // getUserPrompt 格式含 "昵称：xxx"（## 你正在和谁聊天 昵称：xxx）
  const m = userPrompt.match(/昵称[：:]\s*([^\n\r，,。]+)/);
  return m ? m[1].trim().slice(0, 12) : '';
}

function buildAttrLine(characterId: string): string {
  try {
    const attrs = getCachedAttributes(characterId);
    if (!attrs) return '';
    const fmt = (label: string, v: number | undefined, invert = false) => {
      if (typeof v !== 'number') return '';
      const low = invert ? v > 70 : v < 35;
      return low ? `${label}${invert ? '偏高' : '偏低'}(${Math.round(v)})` : '';
    };
    const parts = [
      fmt('精力', attrs.stamina),
      fmt('饱腹', attrs.satiety),
      fmt('清洁', attrs.cleanliness),
      fmt('心情', attrs.spirit),
      fmt('压力', attrs.stress, true),
    ].filter(Boolean);
    return parts.length > 0 ? `当前身体状态：${parts.join('、')}` : '';
  } catch {
    return '';
  }
}

function buildMoodLine(characterId: string): string {
  try {
    const mind = useCharacterMindStore.getState();
    const multi = mind.getMultiEmotion(characterId);
    const top = Object.entries(multi.values || {})
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([k, v]) => `${k}:${Math.round(v as number)}`)
      .join(' ');
    return top ? `当前情绪：${top}` : '';
  } catch {
    return '';
  }
}

function buildMemoryPrompt(characterId: string): string {
  try {
    const v2Settings = useConfigStore.getState().v2Config;
    if (v2Settings.dualLayerMemory === false) return '';
    const mind = useCharacterMindStore.getState();
    const coreMems = mind.getCoreMemories(characterId);
    const episodicMems = mind.getEpisodicMemories(characterId);

    // 检索 query：今日与该角色的互动内容摘要
    let query = `${characterId} 日常生活`;
    try {
      const convs = useChatStore.getState().conversations.filter((c) => c.characterId === characterId);
      const recent: string[] = [];
      for (const conv of convs) {
        for (const msg of (conv.messages || []).slice(-10)) {
          if (typeof msg.content === 'string' && msg.content.trim()) recent.push(msg.content.trim());
        }
      }
      if (recent.length > 0) query = recent.join(' / ').slice(0, 200);
    } catch { /* ignore */ }

    const maxRecall = v2Settings.maxRecallCount ?? 5;
    const coreV2 = coreMems.length > 0 ? coreMems : (mind.getMemories(characterId) || []).map((m) => convertToCoreMemory(m, characterId));
    if (coreV2.length === 0) return '';
    const result = retrieveRelevantMemories({
      userMessage: query,
      userEmotion: undefined,
      coreMemories: coreV2,
      episodicMemories: episodicMems,
      maxResults: maxRecall,
    });
    return buildMemoryPromptV2(result, v2Settings.forgettingCurve !== false);
  } catch {
    return '';
  }
}

/** 构建统一的生成上下文前缀（所有生活生成 prompt 拼接） */
export function buildLifeGenContext(character: Character): LifeGenContext {
  const userPrompt = useUserProfileStore.getState().getUserPrompt();
  return {
    userPrompt,
    memoryPrompt: buildMemoryPrompt(character.id),
    moodLine: buildMoodLine(character.id),
    attrLine: buildAttrLine(character.id),
    nickname: extractNickname(userPrompt),
  };
}

/** 统一称呼规则行（所有生成器末尾追加） */
export function buildNamingRule(ctx: LifeGenContext): string {
  const name = ctx.nickname || 'TA';
  return `\n[称呼规则] 提到聊天对象时，一律使用你对 TA 的称呼/昵称（如「${name}」），绝对不要用"用户"这个词。`;
}
