import { useEffect, useRef, useState } from 'react';
import { useUIStore, WALLPAPER_PRESETS, loadWallpaperFromDb } from '../../store/uiStore';

function resolveSrc(source: string, cb: (url: string | null) => void) {
  if (!source) { cb(null); return; }
  if (source.startsWith('db:')) {
    // Single DB call with caching (via loadWallpaperFromDb)
    loadWallpaperFromDb(source).then((dataUrl) => {
      cb(dataUrl);
    }).catch(() => cb(null));
    return;
  }
  cb(source);
}

function dataUrlToBlobUrl(dataUrl: string): string | null {
  try {
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const mime = dataUrl.slice(0, comma).split(';')[0].split(':')[1] || '';
    const raw = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch { return null; }
}

const blobCache = new Map<string, string>();

function getBlobUrl(source: string): string {
  if (source.startsWith('data:')) {
    const cached = blobCache.get(source);
    if (cached) return cached;
    const blobUrl = dataUrlToBlobUrl(source);
    if (blobUrl) {
      blobCache.set(source, blobUrl);
      return blobUrl;
    }
  }
  return source;
}

export function WallpaperLayer() {
  const wallpaper = useUIStore((s) => s.wallpaper);
  const [resolved, setResolved] = useState<string | null>(null);
  const [musicSrc, setMusicSrc] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const isVisual = wallpaper.type !== 'none';
  const isPreset = wallpaper.type === 'preset';
  const isVideo = wallpaper.type === 'video';
  const isImage = wallpaper.type === 'image' || wallpaper.type === 'url';
  const currentSource = wallpaper.type === 'video' ? wallpaper.videoSource : wallpaper.imageSource;

  useEffect(() => {
    if (isPreset) {
      const preset = WALLPAPER_PRESETS.find(p => p.id === wallpaper.presetId) || WALLPAPER_PRESETS[0];
      setResolved(preset.css);
      return undefined;
    }
    let active = true;
    resolveSrc(currentSource, (url) => { if (active) setResolved(url); });
    return () => { active = false; };
  }, [wallpaper.type, currentSource, wallpaper.presetId, isPreset]);

  useEffect(() => {
    if (wallpaper.music.enabled && wallpaper.music.source) {
      let active = true;
      resolveSrc(wallpaper.music.source, (url) => { if (active) setMusicSrc(url); });
      return () => { active = false; };
    }
    setMusicSrc(null);
    return undefined;
  }, [wallpaper.music.enabled, wallpaper.music.source]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = wallpaper.music.volume;
    if (wallpaper.music.enabled && musicSrc) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [wallpaper.music.enabled, wallpaper.music.volume, musicSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = wallpaper.videoVolume;
    video.muted = wallpaper.videoMuted;
  }, [wallpaper.videoVolume, wallpaper.videoMuted]);

  if (!isVisual) return null;

  const transform = `translate(${wallpaper.positionX}%, ${wallpaper.positionY}%) scale(${wallpaper.scale})`;
  const filter = `blur(${wallpaper.blur}px) brightness(${wallpaper.brightness})`;
  const displayUrl = resolved ? getBlobUrl(resolved) : null;
  const baseStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: -10,
    opacity: wallpaper.opacity,
    overflow: 'hidden',
    pointerEvents: 'none',
  };

  return (
    <>
      <PresetStyle css={resolved} active={isPreset} />
      <div style={baseStyle}>
        {isPreset && resolved && (
          <div className="wp-preset-bg" style={{ position: 'absolute', inset: 0, transform, filter, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        )}
        {isImage && displayUrl && (
          <img src={displayUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: wallpaper.objectFit, transform, filter }} />
        )}
        {isVideo && displayUrl && (
          <video ref={videoRef} src={displayUrl} autoPlay loop playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: wallpaper.objectFit, transform, filter }} />
        )}
      </div>
      {wallpaper.music.enabled && musicSrc && (
        <audio ref={audioRef} src={musicSrc} loop />
      )}
    </>
  );
}

function PresetStyle({ css, active }: { css: string | null; active: boolean }) {
  if (!active || !css) return null;
  const rule = `.wp-preset-bg{background:${css}!important}`;
  return <style dangerouslySetInnerHTML={{ __html: rule }} />;
}
