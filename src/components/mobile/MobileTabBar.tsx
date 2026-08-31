import { useLocation, useNavigate } from 'react-router-dom';
import { MessageSquare, Users, Brain, Music, LayoutGrid } from 'lucide-react';
import { useMusicStore } from '../../store/musicStore';
import { motion } from 'framer-motion';

const tabs = [
  { icon: MessageSquare, label: '对话', path: '/chat' },
  { icon: Users, label: '角色', path: '/characters' },
  { icon: Brain, label: '记忆', path: '/memory' },
  { icon: Music, label: '音乐', path: '/music' },
];

export function MobileTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentSong = useMusicStore((s) => s.currentSong);

  // MiniPlayer 显示时，TabBar 需要上移
  const showMiniPlayer = location.pathname !== '/music' && !!currentSong;

  return (
    <nav
      className={`
        fixed left-0 right-0 z-50 lg:hidden
        backdrop-blur-2xl bg-white/80 dark:bg-gray-950/80
        border-t border-black/[0.04] dark:border-white/[0.06]
      `}
      style={{
        bottom: showMiniPlayer ? 72 : 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="flex items-center justify-around h-14 px-1 safe-bottom">
        {tabs.map(tab => {
          const Icon = tab.icon;
          const isActive = location.pathname.startsWith(tab.path);
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className="relative flex flex-col items-center justify-center gap-0.5 flex-1 py-1"
            >
              {isActive && (
                <motion.div
                  layoutId="tab-indicator"
                  className="absolute top-0 w-5 h-[2px] rounded-full bg-slate-700"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <Icon
                size={20}
                strokeWidth={isActive ? 2.2 : 1.6}
                className={`
                  transition-colors duration-150
                  ${isActive
                    ? 'text-slate-700 dark:text-slate-500'
                    : 'text-gray-400 dark:text-gray-500'}
                `}
              />
              <span
                className={`
                  text-[10px] leading-none transition-colors duration-150
                  ${isActive
                    ? 'text-slate-700 dark:text-slate-500 font-medium'
                    : 'text-gray-400 dark:text-gray-500'}
                `}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
        {/* 更多 - 导航到 /more 页面 */}
        <button
          onClick={() => navigate('/more')}
          className="relative flex flex-col items-center justify-center gap-0.5 flex-1 py-1"
        >
          {location.pathname === '/more' && (
            <motion.div
              layoutId="tab-indicator"
              className="absolute top-0 w-5 h-[2px] rounded-full bg-slate-700"
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
          <LayoutGrid
            size={20}
            strokeWidth={location.pathname === '/more' ? 2.2 : 1.6}
            className={`transition-colors duration-150 ${
              location.pathname === '/more'
                ? 'text-slate-700 dark:text-slate-500'
                : 'text-gray-400 dark:text-gray-500'
            }`}
          />
          <span className={`text-[10px] leading-none transition-colors duration-150 ${
            location.pathname === '/more'
              ? 'text-slate-700 dark:text-slate-500 font-medium'
              : 'text-gray-400 dark:text-gray-500'
          }`}>
            更多
          </span>
        </button>
      </div>
    </nav>
  );
}
