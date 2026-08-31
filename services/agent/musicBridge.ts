/**
 * ============================================================
 * #2 点歌工具桥（模型 → 音乐工具 → 页内播放器 / 外部音乐卡片）
 *
 * 模型侧协议（轻量标签，弱模型友好，不依赖 function calling API）：
 *   AI 在回复末尾另起一行输出  [[music:歌名 歌手]]
 *
 * 执行链：
 *   1. chatStore 在回复落库前调用 runMusicToolTag —— 剥离标签、在线搜歌、
 *      页内 GlobalAudioPlayer 立即播放（App.tsx 全局挂载）；
 *   2. 若本轮消息对应外部平台会话，botHandler 发送回复时调用 consumeMusicCard()
 *      把 OneBot 原生音乐分享卡片（[CQ:music,type=qq/163,id=...]）追加到外发文本，
 *      QQ/微信端收到可点击试听的卡片；60 秒未消费自动作废（防止串扰后续回复）。
 *
 * 开关：featureModuleStore.botBehavior.aiToolEnabled（功能模块页可关）。
 * ============================================================
 */
import { useMusicStore, searchMusicOnline } from '../../store/musicStore';
import type { Song } from '../../store/musicStore';
import { useDebugLog } from '../../store/debugLogStore';

/** 标签匹配：[[music:关键词]]（容忍中文冒号与空格） */
const MUSIC_TAG_RE = /\[\[\s*music\s*[:：]\s*([^\]]{1,60})\s*\]\]/;

/** 待消费的外部音乐卡片（CQ 码）与生成时间 */
let pendingCard: string | null = null;
let pendingCardAt = 0;
const CARD_TTL_MS = 60 * 1000;

/** botHandler 外发回复时消费卡片（60 秒有效期，过期作废） */
export function consumeMusicCard(): string | null {
  if (!pendingCard) return null;
  if (Date.now() - pendingCardAt > CARD_TTL_MS) {
    pendingCard = null;
    return null;
  }
  const c = pendingCard;
  pendingCard = null;
  return c;
}

/** 音乐平台 → OneBot 原生音乐卡片类型（qq/163 由 NapCat 自取曲库信息） */
function cqMusicCard(platform: string, id: string): string | null {
  const p = (platform || '').toLowerCase();
  if (p === 'qq') return `[CQ:music,type=qq,id=${id}]`;
  if (p === 'netease') return `[CQ:music,type=163,id=${id}]`;
  return null; // kugou/kuwo 等无原生卡片，仅页内播放
}

/**
 * 扫描并执行回复中的点歌标签。
 * @returns 剥离标签后的回复正文（无标签时原样返回）
 */
export async function runMusicToolTag(text: string): Promise<string> {
  const m = text.match(MUSIC_TAG_RE);
  if (!m) return text;
  const keyword = m[1].trim();
  const cleaned = text.replace(MUSIC_TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!keyword) return cleaned;

  try {
    const results = await searchMusicOnline(keyword);
    if (results.length === 0) {
      useDebugLog.getState().add('agent', `[点歌工具] 未搜到「${keyword}」，AI 文案照常发送`);
      return cleaned;
    }
    const hit = results[0];
    // 页内播放（GlobalAudioPlayer 全局挂载，playSong 即响）
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
    useMusicStore.getState().playSong(song);
    // 外部平台卡片（进入外部会话回复时由 botHandler 消费）
    const card = cqMusicCard(hit.platform, hit.id);
    if (card) {
      pendingCard = card;
      pendingCardAt = Date.now();
    }
    useDebugLog.getState().add('agent', `[点歌工具] 播放: ${hit.title} - ${hit.artist}（${hit.platform}）${card ? '，已备好音乐卡片' : '（该平台无原生卡片，仅页内播放）'}`);
  } catch (e) {
    useDebugLog.getState().add('agent', `[点歌工具] 执行失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  return cleaned;
}
