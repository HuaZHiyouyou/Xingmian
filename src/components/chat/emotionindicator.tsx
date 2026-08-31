import { EmotionType } from '../../types';
import { emotionColors, emotionLabels } from '../../utils/constants';

interface Props {
  emotion: EmotionType;
  intensity: number;
}

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
