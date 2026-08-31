import { useMemo } from 'react';
import { MultiEmotionState, EmotionType } from '../../types';

const dimensionLabels: Record<EmotionType, string> = {
  joy: '喜悦', trust: '信任', fear: '恐惧', surprise: '惊讶',
  sadness: '悲伤', disgust: '厌恶', anger: '愤怒', anticipation: '期待',
  pride: '得意', guilt: '内疚', embarrassment: '尴尬', jealousy: '嫉妒',
  curiosity: '好奇', love: '爱意',
  gratitude: '感恩', empathy: '共情', anxiety: '焦虑',
  loneliness: '孤独', disappointment: '失望',
};

const dimensionColors: Record<EmotionType, string> = {
  joy: '#F59E0B', trust: '#10B981', fear: '#8B5CF6', surprise: '#EC4899',
  sadness: '#60A5FA', disgust: '#86EFAC', anger: '#EF4444', anticipation: '#22D3EE',
  pride: '#D946EF', guilt: '#9CA3AF', embarrassment: '#FB923C', jealousy: '#EAB308',
  curiosity: '#06B6D4', love: '#FB7185',
  gratitude: '#FBBF24', empathy: '#A78BFA', anxiety: '#F87171',
  loneliness: '#94A3B8', disappointment: '#6366F1',
};

const dimensionOrder: EmotionType[] = [
  'joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust',
  'anger', 'anticipation', 'pride', 'guilt', 'embarrassment', 'jealousy',
  'curiosity', 'love', 'gratitude', 'empathy', 'anxiety', 'loneliness', 'disappointment',
];

interface MultiEmotionDisplayProps {
  multiEmotionState: MultiEmotionState | null;
}

export function MultiEmotionDisplay({ multiEmotionState }: MultiEmotionDisplayProps) {
  const sortedDimensions = useMemo(() => {
    if (!multiEmotionState?.values) return [];
    return dimensionOrder
      .map(dim => ({ dimension: dim, value: multiEmotionState.values[dim] || 0 }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [multiEmotionState]);

  if (sortedDimensions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        暂无情绪数据，开始对话后会自动生成
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sortedDimensions.map(({ dimension, value }) => {
        const barPct = Math.round((value / 100) * 100);
        return (
          <div key={dimension} className="flex items-center gap-3">
            <div className="flex items-center gap-2 w-16 flex-shrink-0">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: dimensionColors[dimension] }}
              />
              <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                {dimensionLabels[dimension]}
              </span>
            </div>
            <div className="flex-1 h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${barPct}%`,
                  backgroundColor: dimensionColors[dimension],
                  opacity: 0.8 + (value / 100) * 0.2,
                }}
              />
            </div>
            <span className="text-[10px] text-gray-500 w-10 text-right font-mono">
              {value}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
