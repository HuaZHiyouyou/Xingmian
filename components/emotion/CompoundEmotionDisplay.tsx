import { useMemo } from 'react';
import { MultiEmotionState, EmotionType } from '../../types';

interface EmotionGroup {
  id: string;
  label: string;
  color: string;
  dimensions: EmotionType[];
}

const emotionGroups: EmotionGroup[] = [
  {
    id: 'positive',
    label: '积极',
    color: '#F59E0B',
    dimensions: ['joy', 'trust', 'pride'],
  },
  {
    id: 'anticipation_group',
    label: '期待',
    color: '#22D3EE',
    dimensions: ['anticipation', 'surprise', 'curiosity'],
  },
  {
    id: 'negative_inward',
    label: '内敛',
    color: '#60A5FA',
    dimensions: ['sadness', 'fear', 'guilt'],
  },
  {
    id: 'negative_outward',
    label: '外放',
    color: '#EF4444',
    dimensions: ['anger', 'disgust', 'jealousy'],
  },
  {
    id: 'social',
    label: '社交',
    color: '#FB923C',
    dimensions: ['embarrassment', 'love', 'gratitude', 'empathy'],
  },
  {
    id: 'cognitive',
    label: '认知',
    color: '#22D3EE',
    dimensions: ['surprise', 'curiosity', 'empathy'],
  },
  {
    id: 'temporal',
    label: '时序',
    color: '#94A3B8',
    dimensions: ['anticipation', 'anxiety', 'loneliness', 'disappointment'],
  },
];

const dimensionLabels: Record<EmotionType, string> = {
  joy: '喜悦', trust: '信任', fear: '恐惧', surprise: '惊讶',
  sadness: '悲伤', disgust: '厌恶', anger: '愤怒', anticipation: '期待',
  pride: '得意', guilt: '内疚', embarrassment: '尴尬', jealousy: '嫉妒',
  curiosity: '好奇', love: '爱慕',
  gratitude: '感恩', empathy: '共情', anxiety: '焦虑',
  loneliness: '孤独', disappointment: '失望',
};

interface CompoundEmotionDisplayProps {
  multiEmotionState: MultiEmotionState | null;
}

export function CompoundEmotionDisplay({ multiEmotionState }: CompoundEmotionDisplayProps) {
  const values = multiEmotionState?.values || {};

  const groupValues = useMemo(() => {
    return emotionGroups.map(g => {
      const total = g.dimensions.reduce((sum, d) => sum + (values[d] || 0), 0);
      const avg = g.dimensions.length > 0 ? Math.round(total / g.dimensions.length) : 0;
      const topDim = g.dimensions.reduce((max, d) => (values[d] || 0) > (values[max] || 0) ? d : max, g.dimensions[0]);
      return { ...g, value: avg, topDim, topValue: Math.round(values[topDim] || 0) };
    }).sort((a, b) => b.value - a.value);
  }, [values]);

  if (!multiEmotionState || Object.keys(values).length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        暂无情绪数据，开始对话后会自动生成
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-3">
        {groupValues.map(g => (
          <div key={g.id} className="text-center">
            <div className="text-[11px] font-medium text-gray-600 dark:text-gray-300 mb-1.5">{g.label}</div>
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, g.value)}%`,
                  backgroundColor: g.color,
                  opacity: 0.6 + (g.value / 100) * 0.4,
                }}
              />
            </div>
            <div className="text-[10px] text-gray-400 mt-1.5">{g.value}%</div>
            {g.topValue > 0 && (
              <div className="text-[9px] text-gray-400 dark:text-gray-500 mt-0.5">
                {dimensionLabels[g.topDim]} {g.topValue}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-x-3 gap-y-2">
        {(Object.entries(values) as [EmotionType, number][])
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([dim, val]) => (
            <div key={dim} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: getDimColor(dim) }} />
              <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{dimensionLabels[dim]}</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono ml-auto">{Math.round(val)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function getDimColor(dim: EmotionType): string {
  const colorMap: Record<EmotionType, string> = {
    joy: '#F59E0B', trust: '#10B981', fear: '#8B5CF6', surprise: '#EC4899',
    sadness: '#60A5FA', disgust: '#86EFAC', anger: '#EF4444', anticipation: '#22D3EE',
    pride: '#D946EF', guilt: '#9CA3AF', embarrassment: '#FB923C', jealousy: '#EAB308',
    curiosity: '#34D399', love: '#FB7185',
    gratitude: '#FBBF24', empathy: '#A78BFA', anxiety: '#F87171',
    loneliness: '#94A3B8', disappointment: '#6366F1',
  };
  return colorMap[dim] || '#94A3B8';
}
