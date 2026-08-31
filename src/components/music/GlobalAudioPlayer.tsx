import { useEffect, useRef, useCallback, useState } from 'react';
import { useMusicStore } from '../../store/musicStore';
import { audioEngine } from './audioEngine';

/**
 * 全局音频播放器组件
 * - 在 App 层级挂载，确保切换路由时音频不中断
 * - 持有唯一的 HTMLAudioElement，响应 store 状态变化
 * - 自身无 UI，仅作为音频引擎存在
 */
export function GlobalAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [loadedUrl, setLoadedUrl] = useState<string>('');
  const [shouldPlay, setShouldPlay] = useState(false);

  const currentSong = useMusicStore((s) => s.currentSong);
  const isPlaying = useMusicStore((s) => s.isPlaying);
  const volume = useMusicStore((s) => s.volume);
  const isMuted = useMusicStore((s) => s.isMuted);
  const setCurrentTime = useMusicStore((s) => s.setCurrentTime);
  const nextSong = useMusicStore((s) => s.nextSong);

  // 注册 audio 元素到共享引擎
  useEffect(() => {
    audioEngine.set(audioRef.current);
    return () => audioEngine.set(null);
  }, []);

  // 解析音频源 URL
  const resolveAudioSrc = useCallback((song: typeof currentSong): string => {
    if (!song?.source) return '';
    // 🆕 本地文件也走 music-proxy（Rust 端读文件并注入 CORS 头），
    //    与在线音源统一，保证 WebAudio 频谱分析在所有音源下可用
    if (song.sourceType === 'local') {
      const filePath = song.source.startsWith('file://')
        ? song.source
        : `file://${song.source.replace(/^\/+/, (m) => m)}`;
      return `http://music-proxy.localhost/proxy/${encodeURIComponent(filePath)}`;
    }
    if (!song.source.startsWith('http')) return '';
    // 在线歌曲：通过 music-proxy 协议代理，后端自动添加 Referer 与 CORS 头
    return `http://music-proxy.localhost/proxy/${encodeURIComponent(song.source)}`;
  }, []);

  // 当歌曲变化时，解析并设置播放源
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentSong) {
      setLoadedUrl('');
      setShouldPlay(false);
      audio.removeAttribute('src');
      audio.load();
      return;
    }

    const url = resolveAudioSrc(currentSong);

    // 如果在线歌曲没有直接 URL，等待 MusicPlayerPage 获取后更新 store
    if (!url && currentSong.sourceType === 'online' && currentSong.platform) {
      return;
    }

    if (url && loadedUrl !== url) {
      console.log('[GlobalAudioPlayer] 加载音频:', url.substring(0, 80) + '...');
      setLoadedUrl(url);
      setShouldPlay(isPlaying);
      // 🆕 crossOrigin='anonymous'：music-proxy 协议已注入 ACAO:*，
      //    使 WebAudio AnalyserNode 可分析真实频谱（否则分析数据全为 0）
      audio.crossOrigin = 'anonymous';
      audio.src = url;
      audio.load();
    }
  }, [currentSong?.id, currentSong?.source, currentSong?.sourceType, currentSong?.platform, resolveAudioSrc, loadedUrl, isPlaying]);

  // 当音频可以播放时，执行待处理的播放请求
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !loadedUrl || !shouldPlay) {
      return undefined;
    }

    let playAttempted = false;

    const attemptPlay = () => {
      if (playAttempted) return;
      playAttempted = true;
      console.log('[GlobalAudioPlayer] 尝试播放, readyState:', audio.readyState);
      audio.play().then(() => {
        console.log('[GlobalAudioPlayer] 播放成功');
      }).catch((err) => {
        console.error('[GlobalAudioPlayer] 播放失败:', err.name, err.message);
        // 如果播放失败，可能是浏览器策略问题，重置状态
        if (err.name === 'NotAllowedError') {
          console.warn('[GlobalAudioPlayer] 浏览器阻止了自动播放，需要用户交互');
        }
      });
    };

    // 监听多个事件以确保能捕获到可播放状态
    const onCanPlay = () => attemptPlay();
    const onLoadedData = () => attemptPlay();

    audio.addEventListener('canplaythrough', onCanPlay);
    audio.addEventListener('loadeddata', onLoadedData);
    audio.addEventListener('canplay', onCanPlay);

    // 如果已经可以播放，直接尝试
    if (audio.readyState >= 3) {
      attemptPlay();
    }

    // 超时兜底：2秒后如果还没播放，再试一次
    const timeout = setTimeout(() => {
      if (!playAttempted && audio.readyState >= 2) {
        console.warn('[GlobalAudioPlayer] 超时兜底尝试播放');
        attemptPlay();
      }
    }, 2000);

    return () => {
      clearTimeout(timeout);
      audio.removeEventListener('canplaythrough', onCanPlay);
      audio.removeEventListener('loadeddata', onLoadedData);
      audio.removeEventListener('canplay', onCanPlay);
    };
  }, [loadedUrl, shouldPlay]);

  // 播放/暂停控制（已加载的音频）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !loadedUrl) return;

    if (isPlaying && audio.paused && audio.readyState >= 3) {
      audio.play().catch((err) => console.error('[GlobalAudioPlayer] play error:', err));
    } else if (!isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [isPlaying, loadedUrl]);

  // 音量与静音同步
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
    audio.muted = isMuted;
  }, [volume, isMuted]);

  // 监听音频事件：时间更新、播放结束、错误处理
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => nextSong();
    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration) && audio.duration > 0) {
        const store = useMusicStore.getState();
        const song = store.currentSong;
        if (song) {
          const idx = store.playlist.findIndex((s) => s.id === song.id);
          if (idx !== -1) {
            const existing = store.playlist[idx];
            if (!existing.duration || Math.abs(existing.duration - audio.duration) >= 1) {
              const updated = { ...existing, duration: audio.duration };
              const newPlaylist = [...store.playlist];
              newPlaylist[idx] = updated;
              useMusicStore.setState({
                playlist: newPlaylist,
                currentSong: store.currentSong?.id === song.id ? updated : store.currentSong,
              });
            }
          }
        }
      }
    };
    const onError = (_e: Event) => {
      const errCode = audio.error?.code;
      const errMsg = audio.error?.message || '';
      console.error('[GlobalAudioPlayer] 音频错误:', errCode, errMsg, 'src:', audio.src?.substring(0, 100));
      // 🆕 在线歌曲播放失败（403/404/过期）→ 走智能解析链：
      //    已存歌源 → 原平台刷新 → 跨平台模糊匹配换源，自动替换当前播放
      if (errCode && errCode >= 2 && currentSong?.sourceType === 'online') {
        const failed = currentSong;
        const store = useMusicStore.getState();
        const idx = store.playlist.findIndex((s) => s.id === failed.id);
        if (idx !== -1) {
          const newPlaylist = [...store.playlist];
          newPlaylist[idx] = { ...newPlaylist[idx], source: '' };
          useMusicStore.setState({
            playlist: newPlaylist,
            currentSong: store.currentSong?.id === failed.id ? { ...store.currentSong, source: '' } : store.currentSong,
          });
        }
        store.resolveSongSource({ ...failed, source: '' }).then((applied) => {
          if (!applied) {
            console.warn('[GlobalAudioPlayer] 换源失败，停止播放:', failed.title);
            useMusicStore.getState().setPlaying(false);
          }
        });
      }
    };
    const onStalled = () => {
      console.warn('[GlobalAudioPlayer] 音频加载停滞');
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('error', onError);
    audio.addEventListener('stalled', onStalled);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('stalled', onStalled);
    };
  }, [setCurrentTime, nextSong]);

  return <audio ref={audioRef} preload="auto" />;
}
