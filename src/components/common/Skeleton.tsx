/**
 * 通用加载骨架组件：让数据加载→显示有平滑过渡，不再瞬间弹出。
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200/70 dark:bg-gray-700/40 ${className}`} />;
}

/** 多行文本骨架 */
export function SkeletonRows({ rows = 3, gap = 'space-y-2', className = '' }: { rows?: number; gap?: string; className?: string }) {
  return (
    <div className={gap} style={{ opacity: 0.7 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${i === rows - 1 ? 'w-2/3' : i % 2 === 0 ? 'w-full' : 'w-5/6'} ${className}`}
        />
      ))}
    </div>
  );
}

/** 卡片骨架（标题行 + 内容行） */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-xl p-4 space-y-3 ${className}`} style={{ opacity: 0.7 }}>
      <div className="flex items-center gap-2">
        <Skeleton className="w-4 h-4 rounded-full" />
        <Skeleton className="w-20 h-3.5" />
        <Skeleton className="ml-auto w-12 h-3.5" />
      </div>
      <Skeleton className="w-1/2 h-6" />
      <SkeletonRows rows={2} />
    </div>
  );
}

/** 加载完成后的淡入包装 */
export function FadeIn({ show, children, className = '' }: { show: boolean; children: React.ReactNode; className?: string }) {
  if (!show) return null;
  return (
    <div className={`animate-[fadeIn_0.35s_ease-out] ${className}`}>
      {children}
    </div>
  );
}
