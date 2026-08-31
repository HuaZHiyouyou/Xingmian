import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useMusicStore,
  type Song,
  searchMusicOnline,
  fetchLyrics,
  fetchMusicPlatforms,
  getOriginalSongId,
  parseLrc,
} from '../../store/musicStore';
import { audioEngine } from './audioEngine';
import {
  MusicDressBackground, MusicAudioBars, MusicDesktopLyrics, DressUpPanel,
} from './MusicDressUp';
import {
  Search, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Music, List, ChevronLeft, X, Upload, Radio, Globe, Disc3,
  Plus, Minus, Shuffle, Repeat, Repeat1, Languages, Palette,
} from 'lucide-react';

/* ─── 在线平台定义 ─── */
const ONLINE_PLATFORMS = [
  { id: 'netease', name: '网易云音乐', color: '#E62E2E', icon: Radio },
  { id: 'qq', name: 'QQ音乐', color: '#31C27C', icon: Music },
  { id: 'kugou', name: '酷狗音乐', color: '#2CA2F9', icon: Disc3 },
  { id: 'kuwo', name: '酷我音乐', color: '#F5B731', icon: Globe },
  { id: 'bilibili', name: 'B站', color: '#FB7299', icon: Radio },
];

/* ─── 格式化平台名称 ─── */
function getPlatformName(id: string): string {
  return ONLINE_PLATFORMS.find(p => p.id === id)?.name || id;
}

/* ─── 波形可视化组件 ─── */
function WaveformVisualizer({ isPlaying }: { isPlaying: boolean }) {
  return (
    <div className="flex items-end gap-[2px] h-6">
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          className="w-[3px] rounded-full bg-blue-500"
          animate={isPlaying ? {
            height: [8, 16 + Math.random() * 8, 6, 14 + Math.random() * 6, 8],
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

/* ─── 封面图片（加载失败时回退） ─── */
function CoverImage({
  src,
  isPlaying,
  size = 'small',
  className = '',
}: {
  src: string;
  isPlaying: boolean;
  size?: 'small' | 'large';
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);
  // src 变化时重置错误状态
  useEffect(() => { setHasError(false); }, [src]);
  if (!src || hasError) {
    if (size === 'large') {
      // 大封面：回退到 Disc3 图标
      return (
        <div className="flex flex-col items-center justify-center">
          <Disc3 className={`w-12 h-12 text-blue-400 dark:text-blue-300 ${isPlaying ? 'animate-spin' : ''}`} />
        </div>
      );
    }
    return <WaveformVisualizer isPlaying={isPlaying} />;
  }
  return (
    <img
      src={src}
      alt=""
      className={`object-cover ${className}`}
      onError={() => setHasError(true)}
    />
  );
}

/* ─── 主组件 ─── */
const MusicPlayerPage: React.FC = () => {
  const navigate = useNavigate();
  const store = useMusicStore();
  const {
    playlist, currentSong, isPlaying, currentTime, volume, isMuted, currentLyricIndex,
    searchResults, searchQuery, playMode, showTranslation,
    setPlaying, nextSong, prevSong, setVolume, setCurrentTime, setCurrentLyricIndex,
    addToPlaylist, removeFromPlaylist, setSearchQuery, playSong, cyclePlayMode, toggleTranslation,
  } = store;

  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showDressUp, setShowDressUp] = useState(false);
  const [availablePlatforms, setAvailablePlatforms] = useState<string[]>(ONLINE_PLATFORMS.map((platform) => platform.id));
  const [selectedPlatform, setSelectedPlatform] = useState('netease');
  const [onlineResults, setOnlineResults] = useState<Song[]>([]);
  const [isOnlineSearch, setIsOnlineSearch] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

  // 初始化本地音乐文件列表（通过用户手动导入）
  // 注意：Tauri v2 不再直接暴露 musicDir API，音乐文件通过"导入"按钮添加

  useEffect(() => {
    let cancelled = false;
    fetchMusicPlatforms().then((platforms) => {
      if (cancelled || platforms.length === 0) return;
      setAvailablePlatforms(platforms);
      if (!platforms.includes(selectedPlatform)) setSelectedPlatform(platforms[0]);
    });
    return () => { cancelled = true; };
  }, [selectedPlatform]);

  useEffect(() => {
    if (!currentSong || currentSong.sourceType !== 'online' || !currentSong.platform) {
      return undefined;
    }
    let cancelled = false;
    const loadLyrics = async () => {
      const raw = currentSong.lrcRaw || await fetchLyrics(getOriginalSongId(currentSong), currentSong.platform!);
      if (cancelled) return;
      const lrcParsed = raw ? parseLrc(raw) : [];
      const latest = useMusicStore.getState();
      const playlist = latest.playlist.map((song) => song.id === currentSong.id ? { ...song, lrcRaw: raw || '', lrcParsed } : song);
      useMusicStore.setState({
        playlist,
        currentSong: latest.currentSong?.id === currentSong.id
          ? { ...latest.currentSong, lrcRaw: raw || '', lrcParsed }
          : latest.currentSong,
        currentLyricIndex: -1,
      });
    };
    loadLyrics();
    return () => { cancelled = true; };
  }, [currentSong?.id, currentSong?.platform, currentSong?.lrcRaw]);

  useEffect(() => {
    const lrcParsed = currentSong?.lrcParsed || [];
    const index = lrcParsed.reduce((activeIndex, lyric, lyricIndex) => (
      lyric.time <= currentTime ? lyricIndex : activeIndex
    ), -1);
    if (index !== currentLyricIndex) setCurrentLyricIndex(index);
  }, [currentSong?.lrcParsed, currentTime, currentLyricIndex, setCurrentLyricIndex]);

  // 当切换歌曲时，如果是在线歌曲则异步获取播放URL并更新 store
  useEffect(() => {
    if (!currentSong) return undefined;

    // 本地歌曲：不覆盖原始 source，resolveAudioSrc 在播放时动态转换
    // 避免将 http://asset.localhost/... URL 回写导致重启后双重编码
    if (currentSong.sourceType === 'local' && currentSong.source) {
      return undefined;
    }

    // 在线歌曲：已有 URL 则无需处理，GlobalAudioPlayer 会自动加载
    if (currentSong.sourceType === 'online' && currentSong.source?.startsWith('http')) return undefined;

    // 在线歌曲：统一走智能解析链（已存源 → 原平台刷新 → 跨平台换源）
    if (currentSong.sourceType === 'online' && currentSong.platform) {
      let cancelled = false;
      useMusicStore.getState().resolveSongSource(currentSong).then((applied) => {
        if (cancelled) return;
        if (!applied) {
          console.warn('所有平台均无法获取播放URL:', currentSong.title);
          setPlaying(false);
        }
      }).catch((err) => {
        console.error('解析播放源失败:', err);
        if (!cancelled) setPlaying(false);
      });
      return () => { cancelled = true; };
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSong?.id, currentSong?.source]);

  // 音量与静音同步到全局 audio 元素
  useEffect(() => {
    audioEngine.setVolume(volume, isMuted);
  }, [volume, isMuted]);

  // 搜索音乐（调用 Rust 后端多源搜索）
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsOnlineSearch(true);
    try {
      const results = await searchMusicOnline(searchQuery, selectedPlatform);
      const songs: Song[] = results.map((r) => ({
        id: `${r.platform}_${r.id}`,
        title: r.title,
        artist: r.artist,
        album: r.album,
        source: r.url || '',
        sourceType: 'online' as const,
        duration: r.duration,
        cover: r.cover || '',
        platform: r.platform,
        lrcRaw: r.lyrics || undefined,
        lrcParsed: r.lyrics ? parseLrc(r.lyrics) : [],
      }));
      setOnlineResults(songs);
    } catch (err) {
      console.error('在线搜索失败:', err);
      setOnlineResults([]);
    } finally {
      setIsOnlineSearch(false);
    }
  }, [searchQuery, selectedPlatform]);

  // 进度条点击
  const handleProgressClick = useCallback((e: React.MouseEvent) => {
    if (!progressRef.current || !currentSong) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const time = percent * (currentSong.duration || 0);
    setCurrentTime(time);
    audioEngine.seek(time);
  }, [currentSong, setCurrentTime]);

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 处理本地文件导入
  const handleFileImport = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        filters: [{ name: '音乐文件', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a'] }],
      });
      if (selected) {
        const files = Array.isArray(selected) ? selected : [selected];
        const newSongs: Song[] = files.map((filePath) => {
          const name = filePath.split(/[\\/]/).pop() || '未知文件';
          return {
            id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: name.replace(/\.[^/.]+$/, ''),
            artist: '本地音乐',
            source: filePath,
            sourceType: 'local' as const,
            duration: 0,
          };
        });
        addToPlaylist(newSongs);
      }
    } catch (err) {
      console.log('导入文件失败:', err);
    }
  };

  // 获取当前歌词
  const lyrics = currentSong?.lrcParsed || [];

  // 🆕 当前桌面台词文本（当前时间对应歌词行）
  const currentLyricText = (() => {
    if (lyrics.length === 0) return '';
    let text = '';
    for (const l of lyrics) {
      if (l.time <= currentTime) text = l.text;
      else break;
    }
    return text;
  })();

  // 🆕 桌面歌词窗口开启时，向独立窗口广播当前台词
  // 修复：无歌词/换歌时也要广播（回退显示歌名），避免卡在上一首的最后一句
  const dlEnabled = useMusicStore((s) => s.dressUp.desktopLyrics);
  useEffect(() => {
    if (!dlEnabled) return;
    const text = currentLyricText || (currentSong ? `♪ ${currentSong.title}` : '');
    import('@tauri-apps/api/event').then(({ emit }) => emit('music-dl-line', text)).catch(() => {});
  }, [dlEnabled, currentLyricText, currentSong?.id, currentSong?.title]);

  const displayResults = onlineResults.length > 0 ? onlineResults : searchResults;

  return (
    <div className="relative h-full flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
      {/* 🆕 装扮背景层（流光/渐变等，浓度/模糊可调） */}
      <MusicDressBackground />

      <div className="relative z-10 flex flex-col min-h-0 flex-1">
      {/* 顶部导航 - 无分割线 */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => navigate(-1)}
            className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </motion.button>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">音乐播放器</h1>
        </div>
        <div className="flex items-center gap-1">
          {[
            { icon: Palette, active: false, onClick: () => setShowDressUp(true), label: '装扮' },
            { icon: Search, active: showSearch, onClick: () => setShowSearch(!showSearch), label: '搜索' },
            { icon: Upload, active: false, onClick: handleFileImport, label: '导入' },
            { icon: List, active: showPlaylist, onClick: () => setShowPlaylist(!showPlaylist), label: '列表' },
          ].map(({ icon: Icon, active, onClick, label }) => (
            <motion.button
              key={label}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onClick}
              title={label}
              className={`p-2.5 rounded-xl transition-colors ${
                active
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <Icon className="w-4.5 h-4.5" />
            </motion.button>
          ))}
        </div>
      </div>

      {/* 搜索栏 - 无分割线 */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-6 pb-4 space-y-3">
              {/* 平台选择标签 */}
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide whitespace-nowrap">
                {ONLINE_PLATFORMS.filter((platform) => availablePlatforms.includes(platform.id)).map((platform) => {
                  const Icon = platform.icon;
                  return (
                    <motion.button
                      key={platform.id}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setSelectedPlatform(platform.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                        selectedPlatform === platform.id
                          ? 'text-white shadow-md'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                      style={selectedPlatform === platform.id ? { backgroundColor: platform.color } : {}}
                    >
                      <Icon size={12} />
                      {platform.name}
                    </motion.button>
                  );
                })}
                <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  <Upload size={12} />
                  本地文件
                </motion.button>
              </div>

              {/* 搜索输入 */}
              <div className="flex gap-2">
                <div className="flex-1 flex items-center bg-gray-50 dark:bg-gray-800 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500/30">
                  <Search size={16} className="text-gray-400 flex-shrink-0" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder={`在${ONLINE_PLATFORMS.find(p => p.id === selectedPlatform)?.name || ''}搜索...`}
                    className="flex-1 bg-transparent outline-none text-sm ml-2 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="text-gray-400 hover:text-gray-600">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSearch}
                  disabled={isOnlineSearch || !searchQuery.trim()}
                  className="px-5 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {isOnlineSearch ? (
                    <span className="flex items-center gap-1.5">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      >
                        <Music size={14} />
                      </motion.div>
                      搜索中
                    </span>
                  ) : '搜索'}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 搜索结果面板 */}
      <AnimatePresence>
        {showSearch && displayResults.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-6 mb-3 max-h-48 overflow-y-auto overflow-x-hidden scrollbar-hide rounded-xl bg-gray-50 dark:bg-gray-800/80 shadow-sm"
          >
            {displayResults.map((result, index) => (
              <motion.div
                key={result.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ backgroundColor: 'rgba(59,130,246,0.05)' }}
                className="flex items-center gap-3 px-4 py-2.5 cursor-pointer group"
                onClick={() => {
                  // 在线歌曲会通过 useEffect 异步获取播放URL，直接播放即可
                  playSong(result);
                  setShowSearch(false);
                }}
              >
                <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30 transition-colors">
                  <Play size={12} className="text-gray-500 group-hover:text-blue-500 transition-colors" fill="currentColor" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{result.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {result.artist} {result.album ? `· ${result.album}` : ''}
                    {result.platform && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                        {getPlatformName(result.platform)}
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-xs text-gray-400 font-mono">{result.duration ? formatTime(result.duration) : '--:--'}</span>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={(e) => { e.stopPropagation(); addToPlaylist([result]); }}
                  className="p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-blue-500"
                >
                  <Plus size={14} />
                </motion.button>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 主体内容 - 无分割线 */}
      <div className="flex-1 overflow-hidden flex">
        {/* 左侧：封面/信息区域 */}
        <div className="flex-1 flex items-center justify-center p-8">
          <motion.div
            animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
            transition={isPlaying ? { duration: 20, repeat: Infinity, ease: 'linear' } : { duration: 0.5 }}
            className="w-56 h-56 rounded-full bg-gradient-to-br from-blue-50 via-indigo-50 to-slate-100 dark:from-gray-800 dark:via-gray-700 dark:to-gray-800 flex items-center justify-center shadow-xl border-4 border-white dark:border-gray-600 overflow-hidden"
          >
            {currentSong ? (
              <CoverImage
                src={currentSong.cover || ''}
                isPlaying={isPlaying}
                size="large"
                className="w-full h-full rounded-full"
              />
            ) : (
              <div className="text-center">
                <Music className="w-12 h-12 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p className="text-xs text-gray-500 dark:text-gray-400">选择一首歌曲</p>
              </div>
            )}
          </motion.div>
        </div>

        {/* 右侧：歌词列表 - 无分割线 */}
        <div className="w-80 overflow-y-auto p-4">
          {lyrics.length > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">歌词</h3>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={toggleTranslation}
                  className={`p-1.5 rounded-lg text-xs flex items-center gap-1 transition-colors ${
                    showTranslation
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                  title={showTranslation ? '隐藏翻译' : '显示翻译'}
                >
                  <Languages size={14} />
                  <span>译</span>
                </motion.button>
              </div>
              {lyrics.map((line, index) => (
                <motion.div
                  key={index}
                  animate={index === currentLyricIndex ? { scale: 1.02 } : { scale: 1 }}
                  className={`py-1.5 px-3 rounded-lg transition-colors cursor-pointer ${
                    index === currentLyricIndex
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  <div>{line.text}</div>
                  {showTranslation && line.translation && (
                    <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{line.translation}</div>
                  )}
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 dark:text-gray-400 py-12">
              <Music className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">暂无歌词</p>
            </div>
          )}
        </div>
      </div>

      {/* 🆕 音频条可视化（律动条/声波/粒子点，可在装扮面板调整） */}
      <div className="relative z-10 px-6 pb-1">
        <MusicAudioBars isPlaying={isPlaying} />
      </div>

      {/* 底部播放栏 - 无分割线 */}
      <div className="theme-player relative z-10 px-5 py-2.5">
        {/* 进度条 */}
        <div
          ref={progressRef}
          className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer mb-2.5 group"
          onClick={handleProgressClick}
        >
          <motion.div
            className="h-full bg-blue-500 rounded-full relative"
            style={{ width: currentSong && currentSong.duration ? `${(currentTime / currentSong.duration) * 100}%` : '0%' }}
            whileHover={{ height: 6 }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md" />
          </motion.div>
        </div>

        <div className="flex items-center justify-between">
          {/* 当前曲目信息 */}
          <div className="flex items-center gap-3 w-1/4">
            {currentSong && (
              <>
                <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <CoverImage
                    src={currentSong.cover || ''}
                    isPlaying={isPlaying}
                    size="small"
                    className="w-full h-full rounded-lg"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{currentSong.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{currentSong.artist}</p>
                </div>
              </>
            )}
          </div>

          {/* 播放控制按钮 */}
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={prevSong}
              className="p-2 rounded-full text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <SkipBack className="w-4 h-4" fill="currentColor" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setPlaying(!isPlaying)}
              className="p-3 rounded-full bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/25 transition-colors"
            >
              {isPlaying ? <Pause className="w-5 h-5" fill="white" /> : <Play className="w-5 h-5" fill="white" />}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={nextSong}
              className="p-2 rounded-full text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <SkipForward className="w-4 h-4" fill="currentColor" />
            </motion.button>
            {/* 循环模式按钮（下一首右侧） */}
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={cyclePlayMode}
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
              {playMode === 'shuffle' ? <Shuffle className="w-4 h-4" /> :
               playMode === 'single' ? <Repeat1 className="w-4 h-4" /> :
               <Repeat className="w-4 h-4" />}
            </motion.button>
          </div>

          {/* 时间和音量 */}
          <div className="flex items-center gap-3 w-1/4 justify-end">
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
              {formatTime(currentTime)} / {currentSong && currentSong.duration ? formatTime(currentSong.duration) : '0:00'}
            </span>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setVolume(volume > 0 ? 0 : 0.5)}
              className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </motion.button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-20 h-1 accent-blue-500"
            />
          </div>
        </div>
      </div>

      {/* 播放列表抽屉 */}
      <AnimatePresence>
        {showPlaylist && (
          <motion.div
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            transition={{ type: 'spring', damping: 25, stiffness: 250 }}
            className="absolute top-0 right-0 w-80 h-full bg-white dark:bg-gray-900 shadow-2xl z-30 flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-4">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">播放列表</h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">{playlist.length} 首歌曲</span>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowPlaylist(false)}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
              >
                <X size={18} />
              </motion.button>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
              {playlist.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <Music size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">播放列表为空</p>
                </div>
              ) : (
                playlist.map((track, index) => (
                  <motion.div
                    key={track.id}
                    whileHover={{ x: 2 }}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer group transition-colors ${
                      currentSong?.id === track.id
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    onClick={() => playSong(track)}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      currentSong?.id === track.id
                        ? 'bg-blue-100 dark:bg-blue-800/30'
                        : 'bg-gray-100 dark:bg-gray-800'
                    }`}>
                      {currentSong?.id === track.id && isPlaying ? (
                        <WaveformVisualizer isPlaying={true} />
                      ) : (
                        <span className="text-xs font-mono text-gray-400">{index + 1}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${
                        currentSong?.id === track.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {track.title}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{track.artist}</p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={(e) => { e.stopPropagation(); removeFromPlaylist(index); }}
                      className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Minus size={14} />
                    </motion.button>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 🆕 桌面台词（悬浮歌词，可拖拽） */}
      <MusicDesktopLyrics line={currentLyricText} />

      {/* 🆕 装扮设置面板 */}
      <AnimatePresence>
        {showDressUp && <DressUpPanel onClose={() => setShowDressUp(false)} />}
      </AnimatePresence>
      </div>{/* /relative z-10 content wrapper */}
    </div>
  );
};

export default MusicPlayerPage;
