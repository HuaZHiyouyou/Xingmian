/**
 * ============================================================
 * 聊天顶部状态条（AI 一日 · 阶段 1）
 * 显示当前角色正在进行的活动 + 进度条；点击跳转 AI 一日面板。
 * 数据源：aiLifeStore.currentActivity（由 lifeEngine 分钟级刷新）
 * ============================================================
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, MapPin, Moon } from 'lucide-react';
import { useAiLifeStore } from '../../store/aiLifeStore';

const CATEGORY_LABELS: Record<string, string> = {
  sleep: '睡眠', personal_care: '洗漱', meal: '用餐', travel: '出行',
  work: '工作', leisure: '休闲', social: '社交', rest: '休息', special: '特殊',
};

function formatHM(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function ChatStatusHeader({ characterId }: { characterId?: string }) {
  const navigate = useNavigate();
  const currentActivity = useAiLifeStore((s) => s.currentActivity);
  const enabled = useAiLifeStore((s) => !!s.config?.enabled && s.config?.characterId === characterId);
  const [progress, setProgress] = useState(0);

  // 进度条本地秒级动画（引擎每分钟校准真实状态）
  useEffect(() => {
    if (!currentActivity) { setProgress(0); return undefined; }
    const compute = () => {
      const now = Date.now();
      const start = new Date(currentActivity.startTime).getTime();
      const end = new Date(currentActivity.endTime).getTime();
      if (end <= start) { setProgress(100); return; }
      setProgress(Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)));
    };
    compute();
    const timer = setInterval(compute, 15000);
    return () => clearInterval(timer);
  }, [currentActivity?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;

  // 睡觉时段显示专属样式
  if (currentActivity?.category === 'sleep') {
    return (
      <div className="px-4 py-2 bg-indigo-50/80 dark:bg-indigo-900/20 flex items-center gap-2">
        <Moon size={13} className="text-indigo-400 flex-shrink-0" />
        <span className="text-xs text-indigo-600 dark:text-indigo-300">
          {currentActivity.name}中（{formatHM(currentActivity.startTime)} - {formatHM(currentActivity.endTime)}），暂时不会回复消息
        </span>
      </div>
    );
  }

  if (!currentActivity) {
    return (
      <div className="px-4 py-2 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
        <span className="text-xs text-gray-400 dark:text-gray-500">空闲中</span>
      </div>
    );
  }

  return (
    <button
      onClick={() => navigate('/ai-life')}
      className="w-full text-left px-4 py-2 bg-[color-mix(in_srgb,var(--accent-color)_6%,transparent)] hover:bg-[color-mix(in_srgb,var(--accent-color)_12%,transparent)] transition-colors"
    >
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-pulse flex-shrink-0" />
        <Clock size={12} className="text-[var(--accent-color)] flex-shrink-0" />
        <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
          {currentActivity.isChanged && currentActivity.changedFrom ? (
            <>
              <span className="line-through text-gray-400 mr-1">{currentActivity.changedFrom}</span>
              {currentActivity.name}
            </>
          ) : currentActivity.name}
        </span>
        {/* 🆕 所在位置（与 AI 一日数据对齐） */}
        {currentActivity.location && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 dark:text-gray-400 flex-shrink-0 min-w-0">
            <MapPin size={10} className="text-[color-mix(in_srgb,var(--accent-color)_75%,white)] flex-shrink-0" />
            <span className="truncate">{currentActivity.location}</span>
          </span>
        )}
        <span className="text-[10px] text-gray-400 flex-shrink-0">
          {CATEGORY_LABELS[currentActivity.category] || ''}
        </span>
        <span className="text-[10px] text-gray-400 ml-auto flex-shrink-0 tabular-nums">
          {formatHM(currentActivity.startTime)} - {formatHM(currentActivity.endTime)}
        </span>
      </div>
      <div className="h-0.5 mt-1.5 bg-gray-200/70 dark:bg-gray-700/70 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${progress}%`, background: 'linear-gradient(to right, color-mix(in srgb, var(--accent-color) 70%, white), var(--accent-color))' }}
        />
      </div>
    </button>
  );
}
