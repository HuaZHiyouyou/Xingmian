import { EmotionType } from '../../types';
import { emotionColors } from '../../utils/constants';

interface Props {
  emotion: EmotionType;
  intensity: number;
}

const emotionLabels: Record<EmotionType, string> = {
  joy: '喜悦',
  sadness: '悲伤',
  anger: '愤怒',
  fear: '恐惧',
  surprise: '惊讶',
  love: '爱意',
  neutral: '平静',
  shy: '害羞',
  lonely: '孤独',
  grateful: '感激',
  brave: '勇敢',
  curiosity: '好奇',
  excitement: '兴奋',
  pride: '骄傲',
  disappointment: '失落',
  confusion: '困惑',
  contentment: '满足',
  nostalgia: '怀念',
  jealousy: '嫉妒',
  hope: '希望',
  relief: '释然',
  regret: '后悔',
  admiration: '钦佩',
  anxious: '焦虑',
  embarrassed: '尴尬',
  tender: '温柔',
  disgusted: '厌恶',
  jealous: '嫉妒',
  confused: '困惑',
  nostalgic: '怀念',
  proud: '自豪',
  surprised: '惊讶',
};

export function EmotionIndicator({ emotion, intensity }: Props) {
  const color = emotionColors[emotion];

  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-xs text-gray-500">
        {emotionLabels[emotion]} {intensity > 0 ? `${intensity}%` : ''}
      </span>
    </div>
  );
}
