/**
 * 共享音频引擎模块
 * 提供全局唯一的 HTMLAudioElement 引用，供 GlobalAudioPlayer、MusicPlayerPage、MiniPlayer 共享
 */
class AudioEngine {
  private _audio: HTMLAudioElement | null = null;
  /** 🆕 WebAudio 频谱分析（音频条可视化） */
  private _ctx: AudioContext | null = null;
  private _analyser: AnalyserNode | null = null;

  set(audio: HTMLAudioElement | null) {
    this._audio = audio;
  }

  get(): HTMLAudioElement | null {
    return this._audio;
  }

  /**
   * 🆕 获取频谱分析器（懒创建，单例）。
   * 前提：audio 元素以 crossOrigin='anonymous' 加载，且音源带 CORS 头
   *（在线/本地均经 music-proxy 协议注入 ACAO）。
   */
  ensureAnalyser(): AnalyserNode | null {
    const audio = this._audio;
    if (!audio) return null;
    try {
      if (!this._ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        this._ctx = new AC();
        const source = this._ctx.createMediaElementSource(audio);
        const analyser = this._ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.82;
        source.connect(analyser);
        analyser.connect(this._ctx.destination);
        this._analyser = analyser;
      }
      if (this._ctx.state === 'suspended') {
        this._ctx.resume().catch(() => {});
      }
      return this._analyser;
    } catch {
      return null;
    }
  }

  /** 🆕 是否挂起（频谱回退判定用） */
  isContextSuspended(): boolean {
    return !this._ctx || this._ctx.state === 'suspended';
  }

  /** 🆕 恢复 AudioContext */
  resumeContext() {
    if (this._ctx?.state === 'suspended') this._ctx.resume().catch(() => {});
  }

  // 便捷方法
  seek(time: number) {
    if (this._audio) this._audio.currentTime = time;
  }

  play() {
    // 🆕 播放前恢复 AudioContext（浏览器自动播放策略）
    if (this._ctx?.state === 'suspended') this._ctx.resume().catch(() => {});
    return this._audio?.play();
  }

  pause() {
    this._audio?.pause();
  }

  setVolume(volume: number, muted = false) {
    if (!this._audio) return;
    this._audio.volume = muted ? 0 : volume;
    this._audio.muted = muted;
  }

  getCurrentTime(): number {
    return this._audio?.currentTime ?? 0;
  }

  getDuration(): number {
    return this._audio?.duration ?? 0;
  }
}

export const audioEngine = new AudioEngine();
