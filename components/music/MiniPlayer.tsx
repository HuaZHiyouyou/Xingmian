import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Repeat, Repeat1, Shuffle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useMusicStore } from '../../store/musicStore';
import { useUIStore } from '../../store/uiStore';
import { audioEngine } from './audioEngine';

/**
 * 动态音频波形（与 MusicPlayerPage 同步的 framer-motion 动画）
 */
function WaveformVisualizer({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-5">
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full bg-blue-500"
          animate={isPlaying ? {
            height: [6, 14 + Math.random() * 8, 5, 12 + Math.random() * 6, 6],
          } : { height: 4 }}
          transition={isPlaying ? {
            duration: 0.8 + Math.random() * 0.4,
            repeat: Infinity,
            ease: 'easeInOut',
          } : { duration: 0.3 }}
        />
      ))}
    </div>
  );
}

/**
 * 封面图片（加载失败时回退到蓝色频条）
 */
function CoverImage({ src, isPlaying, alt }: { src: string; isPlaying: boolean; alt?: string }) {
  const [hasError, setHasError] = useState(false);
  // src 变化时重置错误状态
  useEffect(() => { setHasError(false); }, [src]);
  if (!src || hasError) {
    return <WaveformVisualizer isPlaying={isPlaying} />;
  }
  return (
    <img
      src={src}
      alt={alt || ''}
      className="w-full h-full object-cover rounded-md"
      onError={() => setHasError(true)}
    />
  );
}

/**
 * 迷你底部播放栏
 * - 当用户不在 /music 路由时显示在底部
 * - 蓝色顶部进度条 + 封面占位 + 歌曲信息 + 播放控制 + 时间 + 音量滑块
 */
export function MiniPlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const [progress, setProgress] = useState(0);

  const currentSong = useMusicStore((s) => s.currentSong);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const isMuted = useMusicStore((s) => s.isMuted);
  const volume = useMusicStore((s) => s.volume);
  const playMode = useMusicStore((s) => s.playMode);
  const toggleMute = useMusicStore((s) => s.toggleMute);
  const setPlaying = useMusicStore((s) => s.setPlaying);
  const setVolume = useMusicStore((s) => s.setVolume);
  const nextSong = useMusicStore((s) => s.nextSong);
  const prevSong = useMusicStore((s) => s.prevSong);
  const cyclePlayMode = useMusicStore((s) => s.cyclePlayMode);

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  // 实时更新进度（hooks 必须在条件返回之前）
  useEffect(() => {
    if (!isPlaying || !currentSong) return undefined;
    const timer = setInterval(() => {
      const current = audioEngine.getCurrentTime();
      const duration = audioEngine.getDuration();
      if (duration > 0) {
        setProgress((current / duration) * 100);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [isPlaying, currentSong?.id]);

  // 所有 useCallback 必须在条件返回之前
  const handlePlayPause = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPlaying(!isPlaying);
  }, [setPlaying, isPlaying]);

  const handleNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    nextSong();
  }, [nextSong]);

  const handlePrev = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    prevSong();
  }, [prevSong]);

  const handleToggleMute = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleMute();
  }, [toggleMute]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (val > 0 && isMuted) toggleMute();
  }, [setVolume, isMuted, toggleMute]);

  // 只在非音乐页面显示（条件返回放在所有 hooks 之后）
  const isMusicPage = location.pathname === '/music';
  if (isMusicPage || !currentSong) return null;

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const currentTime = audioEngine.getCurrentTime();
  const duration = audioEngine.getDuration();

  // 根据侧边栏状态计算 left 偏移
  const leftOffset = sidebarCollapsed ? '3rem' : '16rem'; // w-12=3rem, w-64=16rem

  return (
    <div
      className="theme-player fixed bottom-0 right-0 z-50 border-t border-gray-200 dark:border-gray-700/50 cursor-pointer transition-all duration-300"
      style={{ left: leftOffset }}
      onClick={() => navigate('/music')}
    >
      {/* 进度条（与音乐模块一致） */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gray-200 dark:bg-gray-700">
        <div
          className="h-full bg-blue-500 transition-all duration-500"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {/* 三栏布局：封面+信息 | 控制 | 时间+音量 */}
      <div className="flex items-center px-5 py-2.5">
        {/* 左栏：封面 + 歌曲信息 */}
        <div className="flex items-center gap-3 w-1/4 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
            <CoverImage
              src={currentSong.cover && !currentSong.cover.startsWith('blob:') ? currentSong.cover : ''}
              isPlaying={isPlaying}
              alt={currentSong.title}
            />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate leading-tight">{currentSong.title}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate leading-tight mt-0.5">{currentSong.artist || '未知歌手'}</p>
          </div>
        </div>

        {/* 中栏：播放控制按钮（flex-1 占满剩余空间并居中） */}
        <div className="flex items-center gap-3 flex-1 justify-center" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handlePrev}
            className="p-2 rounded-full text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <SkipBack size={16} className="text-gray-600 dark:text-gray-400" fill="currentColor" />
          </button>
          <button
            onClick={handlePlayPause}
            className="p-3 rounded-full bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/25 transition-colors"
          >
            {isPlaying ? (
              <Pause size={18} fill="white" />
            ) : (
              <Play size={18} fill="white" className="ml-0.5" />
            )}
          </button>
          <button
            onClick={handleNext}
            className="p-2 rounded-full text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <SkipForward size={16} className="text-gray-600 dark:text-gray-400" fill="currentColor" />
          </button>
          {/* 循环模式按钮 */}
          <button
            onClick={(e) => { e.stopPropagation(); cyclePlayMode(); }}
            className={`p-2 rounded-full transition-colors ${
              playMode === 'shuffle'
                ? 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                : playMode === 'single'
                  ? 'text-blue-500 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
            title={
              playMode === 'sequential' ? '顺序播放' :
              playMode === 'loop' ? '列表循环' :
              playMode === 'single' ? '单曲循环' :
              '随机播放'
            }
          >
            {playMode === 'shuffle' ? <Shuffle size={16} /> :
             playMode === 'single' ? <Repeat1 size={16} /> :
             <Repeat size={16} />}
          </button>
        </div>

        {/* 右栏：时间 + 音量 */}
        <div className="hidden sm:flex items-center gap-3 w-1/4 justify-end">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono whitespace-nowrap">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); handleToggleMute(e); }}
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            onClick={(e) => e.stopPropagation()}
            className="w-20 h-1 accent-blue-500 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
}
