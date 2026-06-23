import { EmotionType, EmotionDimension, MultiEmotionState, defaultMultiEmotionState } from '../types';

const emotionKeywords: Record<EmotionType, string[]> = {
  joy: ['太开心', '很快乐', '真高兴', '太喜欢', '哈哈', '哈哈哈', '太棒了', '太完美', '太幸福', '太爽了', 'nice', 'great', 'happy', 'awesome', 'amazing'],
  sadness: ['太难过', '好伤心', '想哭', '好痛苦', '太糟糕', '好失望', '好累', '好烦', '好郁闷', '好不幸', '好悲伤', 'depressed', 'tired'],
  anger: ['好生气', '太愤怒', '真讨厌', '太垃圾', '太差劲', '真不满', '太可恶', '气死', 'angry', 'hate', 'annoyed'],
  fear: ['好害怕', '好担心', '好紧张', '好恐惧', '好不安', '好忧虑', '真恐慌', 'scared', 'afraid', 'nervous', 'worried'],
  surprise: ['哇塞', '天哪', '真意外', '居然真的', '太震惊', '没想到', 'wow', 'omg', 'surprise', 'unbelievable'],
  love: ['好爱你', '好想你', '抱抱你', '好关心', '好温暖', '好贴心', 'love you', 'miss you', 'sweet', 'dear'],
  shy: ['好害羞', '好脸红', '不好意思', 'shy', 'blush'],
  lonely: ['好孤独', '好寂寞', '一个人', '没人陪', 'lonely', 'alone'],
  grateful: ['非常感谢', '太谢谢', '真感恩', '多谢你', 'thanks', 'grateful', 'appreciate'],
  brave: ['好勇敢', '不害怕', '加油', '坚持住', '努力', 'brave', 'courage'],
  curiosity: ['好好奇', '真想知道', '为什么', '怎么回事', '为什么呢', 'curious', 'wonder'],
  excitement: ['好兴奋', '好期待', '迫不及待', '太好啦', '耶', '终于', 'excited', 'thrilled'],
  pride: ['好骄傲', '好自豪', '真厉害', '做到了', '成功了', 'proud', 'accomplished'],
  disappointment: ['好失望', '真可惜', '好遗憾', '不开心', 'disappointed'],
  confusion: ['好困惑', '真不懂', '不明白', '搞不懂', 'confused', 'puzzled'],
  contentment: ['好满足', '好满意', '很知足', '太舒服', '好惬意', 'content', 'satisfied'],
  nostalgia: ['好怀念', '好回忆', '以前', '过去', '那时候', '曾经', 'nostalgic', 'remember'],
  jealousy: ['好嫉妒', '好羡慕', '真羡慕', '不公平', 'jealous', 'envious'],
  hope: ['好希望', '期待', '相信', '会好的', '未来', 'hope', 'believe', 'wish'],
  relief: ['好放心', '松口气', '还好', '释然', 'relief', 'relieved'],
  regret: ['好后悔', '早知道', '真不该', '好遗憾', 'regret'],
  admiration: ['好佩服', '真厉害', '好尊敬', '好崇拜', 'admirable', 'impressive'],
  neutral: ['好', '啊', '嗯', '哦', '嗯嗯', '好呀', '好的', '好吧', '嗯好的'],
  anxious: ['好焦虑', '好紧张', '坐立不安', 'anxious', 'restless'],
  embarrassed: ['好尴尬', '真丢人', '不好意思', 'embarrassed', 'awkward'],
  tender: ['好温柔', '好贴心', '好暖心', 'tender', 'gentle'],
  disgusted: ['好恶心', '真讨厌', '受不了', 'disgusted', 'gross'],
  jealous: ['好嫉妒', '真嫉妒', '不公平', 'jealous', 'envious'],
  confused: ['好困惑', '搞不懂', '不明白', 'confused', 'puzzled'],
  nostalgic: ['好怀念', '想当年', '以前', 'nostalgic', 'reminisce'],
  proud: ['好自豪', '真厉害', '做到了', 'proud', 'accomplished'],
  surprised: ['太惊讶了', '没想到', '真意外', 'surprised', 'astonished'],
};

function analyzeKeyword(text: string): { emotion: EmotionType; intensity: number } {
  const lowerText = text.toLowerCase();
  let maxScore = 0;
  let detectedEmotion: EmotionType = 'neutral';

  for (const [emotion, keywords] of Object.entries(emotionKeywords)) {
    if (emotion === 'neutral') continue;
    let score = 0;
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        score += 2;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      detectedEmotion = emotion as EmotionType;
    }
  }

  const intensity = Math.min(Math.round(maxScore * 20), 100);
  return { emotion: detectedEmotion, intensity };
}

let cachedPrompt: ((text: string) => Promise<{ emotion: EmotionType; intensity: number }>) | null = null;

export async function analyzeEmotion(text: string): Promise<{ emotion: EmotionType; intensity: number }> {
  const { getConfig, callAI } = await import('../services/aiService');
  const config = getConfig();
  if (!config.apiKey) {
    return analyzeKeyword(text);
  }

  const prompt = `分析以下用户消息的情绪。只返回JSON，不要其他内容。

消息：${text}

要求：
- 从以下情绪中选择最匹配的一个：joy, sadness, anger, fear, surprise, love, shy, lonely, grateful, brave, curiosity, excitement, pride, disappointment, confusion, contentment, nostalgia, jealousy, hope, relief, regret, admiration, neutral
- intensity 0-100，表示情绪强度
- 考虑语气词、表情符号、感叹号、重复词等

返回格式：{"emotion":"情绪类型","intensity":0-100}`;

  try {
    const reply = await callAI([{ role: 'user', content: prompt }], undefined, 150);
    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return analyzeKeyword(text);

    const result = JSON.parse(jsonMatch[0]);
    const validEmotions: EmotionType[] = ['joy', 'sadness', 'anger', 'fear', 'surprise', 'love', 'shy', 'lonely', 'grateful', 'brave', 'curiosity', 'excitement', 'pride', 'disappointment', 'confusion', 'contentment', 'nostalgia', 'jealousy', 'hope', 'relief', 'regret', 'admiration', 'neutral'];
    const emotion = validEmotions.includes(result.emotion) ? result.emotion : 'neutral';
    return {
      emotion,
      intensity: Math.min(100, Math.max(0, result.intensity || 0)),
    };
  } catch {
    return analyzeKeyword(text);
  }
}

// ============================================================
// 多维情感模型（v2）：主动代谢 + 自平衡
// 参考：emotionai / main.py 的主动代谢逻辑
// ============================================================

/**
 * 把 LLM 分析得到的"单一情绪"，扩展为多维增量
 * 如 joy=70 → { joy: +70, sadness: -10, anger: -15 }
 */
function spreadToDimensions(primaryEmotion: EmotionType, intensity: number): Partial<Record<EmotionDimension, number>> {
  const intensityRatio = intensity / 100;

  const spreadMap: Partial<Record<EmotionType, Partial<Record<EmotionDimension, number>>>> = {
    joy: { joy: intensity, sadness: -10 * intensityRatio, anger: -15 * intensityRatio, fear: -5 * intensityRatio, excitement: 20 * intensityRatio, contentment: 15 * intensityRatio },
    sadness: { sadness: intensity, joy: -20 * intensityRatio, contentment: -10 * intensityRatio, lonely: 15 * intensityRatio },
    anger: { anger: intensity, joy: -10 * intensityRatio, trust: -15 * intensityRatio, disgust: 10 * intensityRatio },
    fear: { fear: intensity, trust: -20 * intensityRatio, anticipation: 10 * intensityRatio },
    surprise: { surprise: intensity, curiosity: 10 * intensityRatio },
    love: { joy: 20 * intensityRatio, trust: intensity, contentment: 20 * intensityRatio, shy: 10 * intensityRatio },
    shy: { shy: intensity, joy: -5 * intensityRatio },
    lonely: { lonely: intensity, sadness: 15 * intensityRatio, trust: -10 * intensityRatio },
    grateful: { grateful: intensity, joy: 15 * intensityRatio, trust: 20 * intensityRatio },
    curiosity: { curiosity: intensity, anticipation: 15 * intensityRatio },
    excitement: { excitement: intensity, joy: 25 * intensityRatio, anticipation: 15 * intensityRatio },
    nostalgia: { sadness: 15 * intensityRatio, contentment: 10 * intensityRatio },
    hope: { anticipation: intensity, joy: 15 * intensityRatio },
    regret: { sadness: intensity, disgust: 10 * intensityRatio },
    neutral: { joy: 5 * intensityRatio, contentment: 5 * intensityRatio },
    pride: { joy: 15 * intensityRatio, anticipation: 10 * intensityRatio },
    disappointment: { sadness: intensity, anticipation: -10 * intensityRatio },
    confusion: { curiosity: 5 * intensityRatio },
    contentment: { contentment: intensity, joy: 10 * intensityRatio },
    jealousy: { anger: 10 * intensityRatio, trust: -15 * intensityRatio },
    relief: { contentment: intensity, fear: -10 * intensityRatio },
    admiration: { trust: intensity, joy: 15 * intensityRatio },
    brave: { trust: 10 * intensityRatio, fear: -15 * intensityRatio },
    anxious: { fear: intensity, anticipation: 5 * intensityRatio },
    embarrassed: { shy: intensity, joy: -5 * intensityRatio },
    tender: { joy: 10 * intensityRatio, trust: 15 * intensityRatio },
    disgusted: { disgust: intensity, trust: -10 * intensityRatio },
    confused: { curiosity: 5 * intensityRatio },
    nostalgic: { sadness: 10 * intensityRatio, contentment: 10 * intensityRatio },
    proud: { joy: 15 * intensityRatio, anticipation: 10 * intensityRatio },
    surprised: { surprise: intensity, curiosity: 10 * intensityRatio },
  };

  return spreadMap[primaryEmotion] || { [primaryEmotion as any]: intensity };
}

/**
 * 应用时间衰减：值向 0 回落
 * - 24 小时内衰减 50%（指数衰减）
 * - 但不低于 1（保留"曾经发生过"的感觉，除非用户要求彻底归零）
 */
function decayValues(values: Partial<Record<EmotionDimension, number>>, elapsedHours: number): Partial<Record<EmotionDimension, number>> {
  const halfLifeHours = 24; // 24 小时衰减一半
  const decayFactor = Math.pow(0.5, elapsedHours / halfLifeHours);

  const out: Partial<Record<EmotionDimension, number>> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const decayed = v * decayFactor;
    out[k as EmotionDimension] = Math.abs(decayed) < 0.5 ? 0 : Math.round(decayed);
  }
  return out;
}

/**
 * 合并"已衰减的旧值"与"新交互的增量"
 * 约束每个维度在 [0, 100] 范围
 */
function mergeValues(
  oldDecayed: Partial<Record<EmotionDimension, number>>,
  delta: Partial<Record<EmotionDimension, number>>,
): Partial<Record<EmotionDimension, number>> {
  const keys = new Set([...Object.keys(oldDecayed), ...Object.keys(delta)]) as Set<EmotionDimension>;
  const out: Partial<Record<EmotionDimension, number>> = {};
  for (const k of keys) {
    const old = oldDecayed[k] || 0;
    const d = delta[k] || 0;
    const next = Math.max(0, Math.min(100, old + d));
    out[k] = Math.round(next);
  }
  return out;
}

/** 取当前主导情绪（值最高的那一个） */
export function getDominantEmotion(state: MultiEmotionState): { type: EmotionType; intensity: number } {
  const entries = Object.entries(state.values) as [EmotionDimension, number][];
  if (entries.length === 0) return { type: 'neutral', intensity: 0 };

  entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const [topDim, topValue] = entries[0];
  const validType = (topDim as string) as EmotionType;
  const intensity = Math.min(100, Math.max(0, topValue || 0));

  // 如果最高值也很低（< 10），则保持 neutral
  if (intensity < 10) return { type: 'neutral', intensity: 0 };
  return { type: validType, intensity };
}

/**
 * 主入口：给定"旧状态"和"新分析结果"，返回新状态
 */
export function updateMultiEmotionState(
  oldState: MultiEmotionState | null | undefined,
  newPrimaryEmotion: EmotionType,
  newIntensity: number,
): MultiEmotionState {
  const base = oldState || { ...defaultMultiEmotionState };
  const now = Date.now();
  const elapsedHours = (now - base.lastUpdated) / (1000 * 60 * 60);

  // 1. 旧值衰减
  const decayed = decayValues(base.values, elapsedHours);

  // 2. 新交互 → 多维增量（仅当 intensity > 0 时叠加）
  let merged = decayed;
  if (newIntensity > 0) {
    const delta = spreadToDimensions(newPrimaryEmotion, newIntensity);
    merged = mergeValues(decayed, delta);
  }

  // 3. 保留最近 10 次快照（用于面板可视化）
  const history = base.history ? [...base.history] : [];
  history.push({ ts: now, snapshot: { ...merged } });
  if (history.length > 10) history.shift();

  return {
    values: merged,
    lastUpdated: now,
    interactions: base.interactions + 1,
    history,
  };
}
