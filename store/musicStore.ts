import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useDebugLog } from './debugLogStore';

function musicLog(message: string): void {
  try { useDebugLog.getState().add('system', message); } catch { /* ignore */ }
}

/** LRC 歌词行 */
export interface LrcLine {
  time: number; // 秒
  text: string;
  /** 翻译文本（可选） */
  translation?: string;
}

/** 歌曲信息 */
export interface Song {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number; // 秒
  /** 本地文件路径或在线 URL */
  source: string;
  sourceType: 'local' | 'online';
  /** 歌词原始文本 */
  lrcRaw?: string;
  /** 解析后的歌词 */
  lrcParsed?: LrcLine[];
  /** 封面 URL */
  cover?: string;
  /** 在线平台标识 */
  platform?: string;
}

/** 播放模式 */
export type PlayMode = 'sequential' | 'loop' | 'shuffle' | 'single';

/** 在线搜索结果 */
export interface SearchResult {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  platform: string;
  /** 搜索时随结果返回的歌词（部分平台支持） */
  lyrics?: string;
  /** 在线播放 URL（可能有时效性） */
  url?: string;
  cover?: string;
}

/** Rust 后端返回的统一歌曲结构 */
interface UnifiedSong {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  platform: string;
  cover?: string;
  lyrics?: string;
}

/** Rust 后端返回的播放 URL 结果 */
interface PlayUrlResult {
  url: string;
  quality: string;
  format: string;
  file_size?: number;
  needs_proxy: boolean;
  fallback_urls: string[];
}

/** 搜索音乐 - 调用 Rust 后端多源搜索 */
export async function searchMusicOnline(
  keyword: string,
  platform?: string,
  page = 1,
  pageSize = 20
): Promise<SearchResult[]> {
  try {
    const result = await invoke<{
      songs: UnifiedSong[];
      total: number;
      has_more: boolean;
      searched_platforms: string[];
    }>('music_search', {
      request: { keyword, platform: platform || null, page, page_size: pageSize },
    });

    return result.songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      platform: song.platform,
      lyrics: song.lyrics,
      cover: song.cover,
    }));
  } catch (error) {
    console.error('音乐搜索失败:', error);
    return [];
  }
}

/** 获取播放 URL - 调用 Rust 后端含降级策略 */
export async function fetchPlayUrl(
  songId: string,
  platform: string
): Promise<PlayUrlResult | null> {
  try {
    return await invoke<PlayUrlResult>('music_get_play_url', {
      request: { song_id: songId, platform },
    });
  } catch (error) {
    console.error('获取播放URL失败:', error);
    return null;
  }
}

/** 获取歌词 - 调用 Rust 后端 */
export async function fetchLyrics(
  songId: string,
  platform: string
): Promise<string | null> {
  try {
    return await invoke<string | null>('music_get_lyrics', {
      request: { song_id: songId, platform },
    });
  } catch (error) {
    console.error('获取歌词失败:', error);
    return null;
  }
}

/** 获取后端实际启用的平台，避免展示没有解析器的平台。 */
export async function fetchMusicPlatforms(): Promise<string[]> {
  try {
    return await invoke<string[]>('music_get_platforms');
  } catch (error) {
    console.error('获取音乐平台失败:', error);
    return [];
  }
}

/** 去除前端播放列表使用的平台前缀，保留服务端需要的原始歌曲 ID。 */
export function getOriginalSongId(song: Pick<Song, 'id' | 'platform'>): string {
  const prefix = song.platform ? `${song.platform}_` : '';
  return prefix && song.id.startsWith(prefix) ? song.id.slice(prefix.length) : song.id;
}

// ---------------- 🆕 播放器装扮系统 ----------------

export type MusicDressTheme = 'none' | 'aurora' | 'gradient' | 'sunset' | 'midnight';
export type AudioBarStyle = 'bars' | 'wave' | 'dots' | 'off';

export interface MusicDressUpConfig {
  /** 背景装扮主题 */
  theme: MusicDressTheme;
  /** 背景浓度 0~1 */
  intensity: number;
  /** 背景模糊 0~30px */
  blur: number;
  /** 音频条样式 */
  audioBarStyle: AudioBarStyle;
  /** 桌面台词开关 */
  desktopLyrics: boolean;
  /** 桌面台词字号 18~44 */
  dlFontSize: number;
  /** 桌面台词不透明度 0.2~1 */
  dlOpacity: number;
  /** 🆕 桌面台词颜色 */
  dlColor: string;
  /** 🆕 点击穿透锁定（锁定后歌词窗不再阻挡下方软件点击） */
  dlLocked: boolean;
  /** 🆕 台词文字效果：霓虹辉光 / 流光渐变 / 描边 / 纯色 */
  dlEffect: 'glow' | 'aurora' | 'outline' | 'plain';
}

const DRESS_UP_KEY = 'music_dressup';

export const MUSIC_DRESS_PRESETS: Array<{
  id: MusicDressTheme; name: string; description: string;
  /** 预览用 CSS 背景 */
  preview: string;
  /** 实际渲染的背景（支持动画类名配合） */
  css: string;
  animated: boolean;
}> = [
  { id: 'none', name: '无装扮', description: '原生界面', preview: 'linear-gradient(135deg,#f1f5f9,#e2e8f0)', css: '', animated: false },
  {
    id: 'aurora', name: '流光', description: '极光流彩缓慢流动',
    preview: 'linear-gradient(120deg,#0f2027,#2c5364 40%,#4a1f7a)',
    css: 'linear-gradient(115deg,#0f2027 0%,#203a43 25%,#2c5364 45%,#1a3a6b 60%,#4a1f7a 80%,#0f2027 100%)',
    animated: true,
  },
  {
    id: 'gradient', name: '渐变', description: '蓝紫柔雾渐变',
    preview: 'linear-gradient(135deg,#667eea,#764ba2)',
    css: 'linear-gradient(135deg,#667eea 0%,#764ba2 50%,#5b3fa8 100%)',
    animated: false,
  },
  {
    id: 'sunset', name: '日落', description: '暖橙粉紫晚霞',
    preview: 'linear-gradient(135deg,#ff9a56,#ff6b95 50%,#8e44ad)',
    css: 'linear-gradient(135deg,#ff9a56 0%,#ff6b95 45%,#c0399f 75%,#8e44ad 100%)',
    animated: false,
  },
  {
    id: 'midnight', name: '午夜', description: '深邃星空夜色',
    preview: 'linear-gradient(135deg,#0f0c29,#302b63 60%,#24243e)',
    css: 'linear-gradient(135deg,#0f0c29 0%,#302b63 55%,#24243e 100%)',
    animated: false,
  },
];

const defaultDressUp: MusicDressUpConfig = {
  theme: 'none',
  intensity: 0.85,
  blur: 0,
  audioBarStyle: 'bars',
  desktopLyrics: false,
  dlFontSize: 28,
  dlOpacity: 0.9,
  dlColor: '#ffffff',
  dlEffect: 'glow',
  dlLocked: false,
};

export function loadDressUp(): MusicDressUpConfig {
  try {
    const raw = localStorage.getItem(DRESS_UP_KEY);
    if (raw) return { ...defaultDressUp, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultDressUp;
}

export function saveDressUp(cfg: MusicDressUpConfig) {
  try { localStorage.setItem(DRESS_UP_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

// ---------------- 🆕 智能换源解析（多级备用 + 歌源自动存储） ----------------

const SOURCE_MAP_KEY = 'music_source_map';

interface SourceMapEntry { platform: string; id: string; resolvedAt: number }

function loadSourceMap(): Record<string, SourceMapEntry> {
  try { return JSON.parse(localStorage.getItem(SOURCE_MAP_KEY) || '{}'); } catch { return {}; }
}

function saveSourceMap(map: Record<string, SourceMapEntry>) {
  try { localStorage.setItem(SOURCE_MAP_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function sourceMapKey(song: Pick<Song, 'title' | 'artist'>): string {
  return `${song.title.trim().toLowerCase()}|${(song.artist || '').trim().toLowerCase()}`;
}

/** 同 key 10 秒内不重复解析（防音频错误→解析→错误 死循环） */
let _lastResolveKey = '';
let _lastResolveAt = 0;

interface MusicState {
  /** 当前播放歌曲 */
  currentSong: Song | null;
  /** 播放列表 */
  playlist: Song[];
  /** 播放索引 */
  currentIndex: number;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 当前进度（秒） */
  currentTime: number;
  /** 音量 (0-1) */
  volume: number;
  /** 播放模式 */
  playMode: PlayMode;
  /** 是否静音 */
  isMuted: boolean;
  /** 搜索关键词 */
  searchQuery: string;
  /** 搜索结果 */
  searchResults: SearchResult[];
  /** 搜索来源 */
  searchSource: 'all' | 'local' | 'netease' | 'qq' | 'kugou' | 'kuwo' | 'bilibili';
  /** 是否正在搜索 */
  isSearching: boolean;
  /** 当前歌词行索引 */
  currentLyricIndex: number;
  /** 是否显示歌词面板 */
  showLyrics: boolean;
  /** 是否显示播放列表 */
  showPlaylist: boolean;
  /** 是否显示歌词翻译 */
  showTranslation: boolean;
  /** 历史播放 */
  history: Song[];
  /** 🆕 播放器装扮配置 */
  dressUp: MusicDressUpConfig;

  // Actions
  updateDressUp: (patch: Partial<MusicDressUpConfig>) => void;
  /**
   * 🆕 智能解析在线歌曲可用源（多级备用）：
   *  1. 已存歌源映射（自动存储，跨会话生效）
   *  2. 原平台重新获取（URL 时效性刷新）
   *  3. Rust 跨平台模糊匹配换源（网易云→QQ→酷狗）
   * 成功后自动应用到当前播放与播放列表并持久化映射。
   * 返回应用后的歌曲；失败返回 null。
   */
  resolveSongSource: (song: Song) => Promise<Song | null>;
  /** 🆕 将解析出的可用源写回当前播放与播放列表 */
  applyOnlineSource: (originalId: string, applied: Song) => void;
  setPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlayMode: (mode: PlayMode) => void;
  cyclePlayMode: () => void;
  playSong: (song: Song) => void;
  playSongAt: (index: number) => void;
  addToPlaylist: (songs: Song[]) => void;
  removeFromPlaylist: (index: number) => void;
  clearPlaylist: () => void;
  nextSong: () => void;
  prevSong: () => void;
  setSearchQuery: (query: string) => void;
  setSearchSource: (source: MusicState['searchSource']) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setSearching: (searching: boolean) => void;
  setCurrentLyricIndex: (index: number) => void;
  toggleLyrics: () => void;
  togglePlaylist: () => void;
  toggleTranslation: () => void;
  addLocalFiles: (songs: Song[]) => void;
}

/** 解析 LRC 格式歌词（支持多语言 + 翻译行） */
export function parseLrc(raw: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const regex = /\[(\d{2}):(\d{2})\.?(\d{0,3})\](.*)/g;
  for (const line of raw.split('\n')) {
    const match = [...line.matchAll(regex)];
    if (match.length > 0) {
      for (const m of match) {
        const min = parseInt(m[1], 10);
        const sec = parseInt(m[2], 10);
        const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
        const time = min * 60 + sec + ms / 1000;
        const text = m[4].trim();
        if (text) {
          // 检查是否是翻译行（同行时间戳已存在）
          const existing = lines.find(l => Math.abs(l.time - time) < 0.1);
          if (existing && !existing.translation) {
            existing.translation = text;
          } else {
            lines.push({ time, text });
          }
        }
      }
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

export const useMusicStore = create<MusicState>((set, get) => ({
  currentSong: null,
  // playlist 在下方从 localStorage 初始化
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  volume: 0.5,
  playMode: 'sequential',
  isMuted: false,
  searchQuery: '',
  searchResults: [],
  searchSource: 'all',
  isSearching: false,
  currentLyricIndex: -1,
  showLyrics: false,
  showPlaylist: false,
  showTranslation: false,
  history: JSON.parse(localStorage.getItem('music_history') || '[]'),
  // Bug3: 本地歌曲导入持久化 — 从 localStorage 恢复播放列表
  // 🆕 在线歌曲不保留过期 URL（有时效性）——每次会话重新解析，杜绝刷新后歌源失效
  playlist: (JSON.parse(localStorage.getItem('music_playlist') || '[]') as Song[]).map((s) =>
    s.sourceType === 'online' ? { ...s, source: '' } : s
  ),
  dressUp: loadDressUp(),

  updateDressUp: (patch) => {
    set((s) => {
      const next = { ...s.dressUp, ...patch };
      saveDressUp(next);
      return { dressUp: next };
    });
  },

  applyOnlineSource: (originalId, applied) => {
    set((s) => {
      const playlist = s.playlist.map((x) => (x.id === originalId ? applied : x));
      try { localStorage.setItem('music_playlist', JSON.stringify(playlist)); } catch { /* ignore */ }
      return {
        playlist,
        currentSong: s.currentSong?.id === originalId ? applied : s.currentSong,
      };
    });
  },

  resolveSongSource: async (song) => {
    if (song.sourceType !== 'online' || !song.platform) return null;

    // 防死循环守卫：同曲 10 秒内只解析一次
    const key = sourceMapKey(song);
    const now = Date.now();
    if (key === _lastResolveKey && now - _lastResolveAt < 10000) return null;
    _lastResolveKey = key;
    _lastResolveAt = now;

    const origId = getOriginalSongId(song);
    const applyTo = (platform: string, id: string, url: string, cover?: string): Song => ({
      ...song,
      platform,
      id: `${platform}_${id}`,
      source: url,
      sourceType: 'online',
      cover: cover || song.cover,
    });
    const commit = (applied: Song) => {
      useMusicStore.getState().applyOnlineSource(song.id, applied);
      return applied;
    };

    const map = loadSourceMap();

    // 1) 已存歌源映射（自动存储，跨会话直接命中可用源）
    const saved = map[key];
    if (saved && !(saved.platform === song.platform && saved.id === origId)) {
      try {
        const r = await fetchPlayUrl(saved.id, saved.platform);
        if (r?.url) {
          musicLog(`[换源] 命中已存源 ${saved.platform}:${saved.id.slice(0, 12)}…`);
          return commit(applyTo(saved.platform, saved.id, r.url));
        }
      } catch { /* 继续下一级 */ }
    }

    // 2) 原平台重新获取（URL 有时效性，刷新后必须重取）
    try {
      const r = await fetchPlayUrl(origId, song.platform);
      if (r?.url) return commit(applyTo(song.platform, origId, r.url));
    } catch { /* 继续下一级 */ }

    // 3) Rust 跨平台模糊匹配换源（网易云→QQ→酷狗）
    try {
      const r = await invoke<{
        matched: { id: string; title: string; artist: string; platform: string; cover?: string } | null;
        play_url: { url: string } | null;
        tried: string[];
      }>('music_resolve_song', {
        request: {
          title: song.title,
          artist: song.artist || null,
          original_platform: song.platform,
          original_song_id: origId,
          duration: song.duration || null,
          fallback_platforms: ['netease', 'qq', 'kugou'],
        },
      });
      if (r.play_url?.url) {
        if (r.matched) {
          map[key] = { platform: r.matched.platform, id: r.matched.id, resolvedAt: now };
          saveSourceMap(map);
          musicLog(`[换源] ${song.platform} → ${r.matched.platform}：「${r.matched.title}」`);
          return commit(applyTo(r.matched.platform, r.matched.id, r.play_url.url, r.matched.cover || undefined));
        }
        return commit(applyTo(song.platform, origId, r.play_url.url));
      }
    } catch { /* 全部失败 */ }

    return null;
  },

  setPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
  toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),
  setPlayMode: (mode) => set({ playMode: mode }),
  cyclePlayMode: () => {
    const modes: PlayMode[] = ['sequential', 'loop', 'single', 'shuffle'];
    set((s) => {
      const idx = modes.indexOf(s.playMode);
      return { playMode: modes[(idx + 1) % modes.length] };
    });
  },

  playSong: (song) => {
    const { playlist } = get();
    const idx = playlist.findIndex((s) => s.id === song.id);
    if (idx !== -1) {
      set({ currentSong: song, currentIndex: idx, isPlaying: true, currentTime: 0, currentLyricIndex: -1 });
    } else {
      const newPlaylist = [...playlist, song];
      set({
        playlist: newPlaylist,
        currentSong: song,
        currentIndex: playlist.length,
        isPlaying: true,
        currentTime: 0,
        currentLyricIndex: -1,
      });
      localStorage.setItem('music_playlist', JSON.stringify(newPlaylist));
    }
    // 保存到历史
    const { history } = get();
    const newHistory = [song, ...history.filter((h) => h.id !== song.id)].slice(0, 100);
    set({ history: newHistory });
    localStorage.setItem('music_history', JSON.stringify(newHistory));
  },

  playSongAt: (index) => {
    const { playlist } = get();
    if (index >= 0 && index < playlist.length) {
      set({ currentSong: playlist[index], currentIndex: index, isPlaying: true, currentTime: 0, currentLyricIndex: -1 });
    }
  },

  addToPlaylist: (songs) => {
    set((s) => {
      const updated = [...s.playlist, ...songs];
      localStorage.setItem('music_playlist', JSON.stringify(updated));
      return { playlist: updated };
    });
  },

  removeFromPlaylist: (index) => {
    const { playlist, currentIndex, currentSong } = get();
    const newPlaylist = playlist.filter((_, i) => i !== index);
    let newIndex = currentIndex;
    let newSong = currentSong;
    if (index < currentIndex) {
      newIndex = currentIndex - 1;
    } else if (index === currentIndex) {
      if (newPlaylist.length === 0) {
        newIndex = -1;
        newSong = null;
      } else {
        newIndex = Math.min(newIndex, newPlaylist.length - 1);
        newSong = newPlaylist[newIndex];
      }
    }
    set({ playlist: newPlaylist, currentIndex: newIndex, currentSong: newSong });
    localStorage.setItem('music_playlist', JSON.stringify(newPlaylist));
  },

  clearPlaylist: () => {
    set({ playlist: [], currentIndex: -1, currentSong: null, isPlaying: false });
    localStorage.setItem('music_playlist', '[]');
  },

  nextSong: () => {
    const { playlist, currentIndex, playMode } = get();
    if (playlist.length === 0) return;
    let nextIdx: number;
    if (playMode === 'shuffle') {
      nextIdx = Math.floor(Math.random() * playlist.length);
    } else if (playMode === 'single') {
      nextIdx = currentIndex;
    } else {
      nextIdx = (currentIndex + 1) % playlist.length;
    }
    set({ currentSong: playlist[nextIdx], currentIndex: nextIdx, isPlaying: true, currentTime: 0, currentLyricIndex: -1 });
  },

  prevSong: () => {
    const { playlist, currentIndex } = get();
    if (playlist.length === 0) return;
    const prevIdx = (currentIndex - 1 + playlist.length) % playlist.length;
    set({ currentSong: playlist[prevIdx], currentIndex: prevIdx, isPlaying: true, currentTime: 0, currentLyricIndex: -1 });
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchSource: (source) => set({ searchSource: source }),
  setSearchResults: (results) => set({ searchResults: results }),
  setSearching: (searching) => set({ isSearching: searching }),
  setCurrentLyricIndex: (index) => set({ currentLyricIndex: index }),
  toggleLyrics: () => set((s) => ({ showLyrics: !s.showLyrics })),
  togglePlaylist: () => set((s) => ({ showPlaylist: !s.showPlaylist })),
  toggleTranslation: () => set((s) => ({ showTranslation: !s.showTranslation })),

  addLocalFiles: (songs) => {
    set((s) => {
      const existing = new Set(s.playlist.map((x) => x.id));
      const newSongs = songs.filter((x) => !existing.has(x.id));
      if (newSongs.length === 0) return {};
      const updated = [...s.playlist, ...newSongs];
      localStorage.setItem('music_playlist', JSON.stringify(updated));
      return { playlist: updated };
    });
  },
}));
