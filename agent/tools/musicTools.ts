/**
 * 音乐播放器 Agent 工具
 */
import type { AgentTool } from '../../types/agent';
import { useMusicStore, searchMusicOnline } from '../../store/musicStore';
import type { Song } from '../../store/musicStore';
import { useDebugLog } from '../../store/debugLogStore';

export const musicTools: AgentTool[] = [
  {
    id: 'music_list_songs',
    name: '列出歌曲',
    description: '获取音乐库中的歌曲列表',
    category: 'music',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [
      { name: 'limit', type: 'number', description: '返回数量上限，默认20', required: false },
    ],
    execute: async (params) => {
      const { playlist } = useMusicStore.getState();
      const limit = (params.limit as number) ?? 20;
      const sliced = playlist.slice(0, limit);
      return {
        success: true,
        message: `共 ${playlist.length} 首歌曲（显示前 ${sliced.length} 首）`,
        data: sliced.map(s => ({ id: s.id, title: s.title, artist: s.artist, duration: s.duration })),
      };
    },
  },
  {
    id: 'music_play',
    name: '播放歌曲',
    description: '播放指定歌曲或继续播放',
    category: 'music',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [
      { name: 'songId', type: 'string', description: '歌曲 ID（不填则继续播放）', required: false },
    ],
    execute: async (params) => {
      const store = useMusicStore.getState();
      if (params.songId) {
        const song = store.playlist.find(s => s.id === params.songId);
        if (song) { store.playSong(song); }
        else { return { success: false, error: `未找到歌曲: ${params.songId}` }; }
      } else {
        store.setPlaying(true);
      }
      const song = useMusicStore.getState().currentSong;
      useDebugLog.getState().add('system', `[音乐] 播放: ${song?.title ?? '未知'}`);
      return { success: true, message: `正在播放: ${song?.title ?? '未知歌曲'}` };
    },
  },
  {
    id: 'music_pause',
    name: '暂停播放',
    description: '暂停当前播放的歌曲',
    category: 'music',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      useMusicStore.getState().setPlaying(false);
      return { success: true, message: '已暂停播放' };
    },
  },
  {
    id: 'music_next',
    name: '下一首',
    description: '切换到下一首歌曲',
    category: 'music',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      useMusicStore.getState().nextSong();
      const song = useMusicStore.getState().currentSong;
      return { success: true, message: `正在播放: ${song?.title ?? '未知歌曲'}` };
    },
  },
  {
    id: 'music_previous',
    name: '上一首',
    description: '切换到上一首歌曲',
    category: 'music',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [],
    execute: async () => {
      useMusicStore.getState().prevSong();
      const song = useMusicStore.getState().currentSong;
      return { success: true, message: `正在播放: ${song?.title ?? '未知歌曲'}` };
    },
  },
  {
    id: 'music_set_volume',
    name: '设置音量',
    description: '设置播放音量（0-100）',
    category: 'music',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [
      { name: 'volume', type: 'number', description: '音量 0-100', required: true },
    ],
    execute: async (params) => {
      const vol = Math.max(0, Math.min(100, params.volume as number)) / 100;
      useMusicStore.getState().setVolume(vol);
      return { success: true, message: `音量已设为 ${Math.round(vol * 100)}%` };
    },
  },
  {
    id: 'music_search_online',
    name: '搜索歌曲',
    description: '在线搜索歌曲（多平台：网易云/QQ/酷狗），返回匹配列表',
    category: 'music',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [
      { name: 'keyword', type: 'string', description: '搜索关键词（歌名、歌手、歌名+歌手）', required: true },
      { name: 'platform', type: 'string', description: '平台（netease/qq/kugou），不填则聚合搜索', required: false },
      { name: 'limit', type: 'number', description: '返回数量上限，默认 10', required: false },
    ],
    execute: async (params) => {
      const keyword = String(params.keyword ?? '').trim();
      if (!keyword) return { success: false, error: '缺少 keyword 参数' };
      const results = await searchMusicOnline(keyword, params.platform as string | undefined);
      if (results.length === 0) {
        return { success: false, error: `未搜到「${keyword}」相关歌曲` };
      }
      const limit = (params.limit as number) ?? 10;
      const sliced = results.slice(0, limit);
      useDebugLog.getState().add('system', `[音乐] Agent 在线搜索「${keyword}」: ${results.length} 条结果`);
      return {
        success: true,
        message: `搜到 ${results.length} 首（显示前 ${sliced.length} 首），可用 music_search_play 播放`,
        data: sliced.map((s, i) => ({ index: i, id: s.id, title: s.title, artist: s.artist, album: s.album, platform: s.platform })),
      };
    },
  },
  {
    id: 'music_search_play',
    name: '搜歌并播放',
    description: '在线搜索并直接播放最匹配的歌曲（默认第一个结果，可用 index 选其他候选）',
    category: 'music',
    permissionLevel: 'low',
    executionSite: 'frontend',
    parameters: [
      { name: 'keyword', type: 'string', description: '搜索关键词（歌名、歌手）', required: true },
      { name: 'index', type: 'number', description: '候选序号（从 0 开始，默认 0）', required: false },
    ],
    execute: async (params) => {
      const keyword = String(params.keyword ?? '').trim();
      if (!keyword) return { success: false, error: '缺少 keyword 参数' };
      const results = await searchMusicOnline(keyword);
      if (results.length === 0) {
        return { success: false, error: `未搜到「${keyword}」相关歌曲` };
      }
      const idx = Math.max(0, Math.min(results.length - 1, (params.index as number) ?? 0));
      const hit = results[idx];
      // 构造在线歌曲（source 留空，播放器自动走解析链：原平台 → 跨平台换源）
      const song: Song = {
        id: hit.id,
        title: hit.title,
        artist: hit.artist,
        album: hit.album,
        duration: hit.duration,
        source: '',
        sourceType: 'online',
        platform: hit.platform,
        cover: hit.cover,
        lrcRaw: hit.lyrics,
      };
      const store = useMusicStore.getState();
      store.playSong(song);
      useDebugLog.getState().add('system', `[音乐] Agent 播放: ${hit.title} - ${hit.artist}（${hit.platform}）`);
      return {
        success: true,
        message: `正在播放: ${hit.title} - ${hit.artist}（${hit.platform}）`,
        data: { id: hit.id, title: hit.title, artist: hit.artist, platform: hit.platform, candidates: results.length },
      };
    },
  },
];
