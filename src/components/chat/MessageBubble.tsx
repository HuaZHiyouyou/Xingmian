import { useState, useMemo, useEffect, memo } from 'react';
import { Message, MessageAttachment } from '../../types';
import { motion } from 'framer-motion';
import { formatTime } from '../../utils/chatUtils';
import { isRunningInTauri, getFileDataOnly } from '../../lib/tauriBridge';

interface Props {
  message: Message;
  characterName: string;
  characterAvatar?: string;
  userAvatar?: string;
}

type BubbleStyle = 'rounded' | 'sharp' | 'minimal' | 'wechat' | 'pill' | 'glass' | 'bubble' | 'gradient';

let cachedBubbleStyle: BubbleStyle = 'rounded';
let cachedAccentColor = '#7c3aed';
let cachedAvatarStyle = 'circle';
let styleInitialized = false;

function initStyleCache() {
  if (styleInitialized) return;
  cachedBubbleStyle = (document.documentElement.getAttribute('data-bubble-style') as BubbleStyle) || 'rounded';
  cachedAccentColor = document.documentElement.getAttribute('data-accent-color') || '#7c3aed';
  cachedAvatarStyle = document.documentElement.getAttribute('data-avatar-style') || 'circle';
  styleInitialized = true;
}

function invalidateStyleCache() {
  styleInitialized = false;
}

export function invalidateMessageStyleCache() {
  invalidateStyleCache();
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : { r: 124, g: 58, b: 237 };
}

function UserAvatar({ avatar, avatarStyle }: { avatar?: string; avatarStyle: string }) {
  const style = avatarStyle === 'squircle' ? { borderRadius: '22%' } : undefined;
  const radiusClass = avatarStyle === 'square' ? 'rounded-xl' : avatarStyle === 'squircle' ? '' : 'rounded-full';
  return (
    <div className={`w-8 h-8 flex items-center justify-center flex-shrink-0 ${radiusClass} shadow-sm overflow-hidden ${!avatar ? 'bg-gradient-to-br from-violet-500 to-violet-600' : ''}`} style={style}>
      {avatar ? (
        <img src={avatar} alt="我" className="w-full h-full object-cover" />
      ) : (
        <span className="text-white text-xs font-bold">我</span>
      )}
    </div>
  );
}

function AIAvatar({ name, avatar, avatarStyle }: { name: string; avatar?: string; avatarStyle: string }) {
  const style = avatarStyle === 'squircle' ? { borderRadius: '22%' } : undefined;
  const radiusClass = avatarStyle === 'square' ? 'rounded-xl' : avatarStyle === 'squircle' ? '' : 'rounded-full';
  return (
    <div className={`w-8 h-8 flex items-center justify-center flex-shrink-0 ${radiusClass} shadow-sm overflow-hidden ${!avatar ? 'bg-gradient-to-br from-violet-400 to-pink-400' : ''}`} style={style}>
      {avatar ? (
        <img src={avatar} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-white text-xs font-bold">{name.charAt(0)}</span>
      )}
    </div>
  );
}

function FileAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [src, setSrc] = useState('');
  const isDbFile = attachment.path.startsWith('db:');
  const isUrl = attachment.path.startsWith('http://') || attachment.path.startsWith('https://');
  const ext = attachment.name.split('.').pop()?.toLowerCase() || '';
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'avif'];
  const isImageByExt = IMAGE_EXTS.includes(ext);
  const isVideo = ['mp4', 'webm', 'ogg', 'mov'].includes(ext) || attachment.type === 'video';
  const isAudio = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'].includes(ext) || attachment.type === 'audio';

  useEffect(() => {
    const dbId = attachment.fileId || (isDbFile ? attachment.id : undefined);
    if (dbId && isRunningInTauri()) {
      getFileDataOnly(dbId).then(b64 => {
        if (b64) setSrc(`data:${attachment.mimeType || 'application/octet-stream'};base64,${b64}`);
      }).catch(() => {});
    }
  }, [attachment.fileId, attachment.id, isDbFile, attachment.mimeType]);

  if (isImageByExt || attachment.type === 'image') {
    const imgSrc = src || attachment.path;
    if (!imgSrc || (imgSrc.startsWith('db:') && !src)) {
      return <div className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/5 text-[10px] text-gray-500">🖼</div>;
    }
    return (
      <img
        src={imgSrc}
        alt={attachment.name}
        className="max-w-[200px] max-h-[150px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
        loading="lazy"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  if (isVideo) {
    const videoSrc = src || attachment.path;
    return (
      <div className="rounded-lg overflow-hidden max-w-[280px]">
        <video
          src={videoSrc}
          controls
          className="w-full rounded-lg"
          preload="metadata"
        />
      </div>
    );
  }

  if (isAudio) {
    const audioSrc = src || attachment.path;
    return (
      <div className="px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 flex items-center gap-2 max-w-[240px]">
        <span className="text-lg">🎵</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{attachment.name}</div>
          <audio src={audioSrc} controls className="w-full h-8 mt-1" preload="metadata" />
        </div>
      </div>
    );
  }

  const downloadHref = isDbFile ? undefined : attachment.path;

  return (
    <a
      href={downloadHref}
      download={isDbFile ? undefined : attachment.name}
      target={isUrl ? '_blank' : undefined}
      rel={isUrl ? 'noopener noreferrer' : undefined}
      className="px-3 py-2 rounded-lg bg-black/5 dark:bg-white/5 flex items-center gap-2 hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer max-w-[240px]"
    >
      <span className="text-lg">
        {ext === 'pdf' ? '📕' : ext === 'doc' || ext === 'docx' ? '📘' : ext === 'xls' || ext === 'xlsx' ? '📗' : ext === 'zip' || ext === 'rar' ? '🗜️' : '📄'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{attachment.name}</div>
        {attachment.size > 0 && (
          <div className="text-[10px] text-gray-400">
            {attachment.size < 1024 ? `${attachment.size} B` : attachment.size < 1048576 ? `${(attachment.size / 1024).toFixed(1)} KB` : `${(attachment.size / 1048576).toFixed(1)} MB`}
          </div>
        )}
      </div>
    </a>
  );
}

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center animate-[fadeIn_0.15s_ease-out] cursor-pointer"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl animate-[scaleIn_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-lg transition-colors"
      >
        ✕
      </button>
    </div>
  );
}

function ImageAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [src, setSrc] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadImage() {
      if (!attachment.path) return;

      // Priority 1: DB-backed file (by fileId)
      const dbId = attachment.fileId || (attachment.path.startsWith('db:') ? attachment.id : undefined);
      if (dbId && isRunningInTauri()) {
        try {
          const b64 = await getFileDataOnly(dbId);
          if (!cancelled && b64) {
            setSrc(`data:${attachment.mimeType || 'image/png'};base64,${b64}`);
            return;
          }
        } catch { /* fall through */ }
      }

      // Priority 2: Direct URL (HTTP/HTTPS, data:, blob:)
      if (attachment.path.startsWith('http://') || attachment.path.startsWith('https://') || attachment.path.startsWith('data:') || attachment.path.startsWith('blob:')) {
        if (!cancelled) setSrc(attachment.path);
        return;
      }

      // Priority 3: Legacy local file path (Tauri, read from filesystem)
      if (!attachment.path.startsWith('db:') && isRunningInTauri()) {
        try {
          const { readFileAsBase64 } = await import('../../lib/tauriBridge');
          const b64 = await readFileAsBase64(attachment.path);
          if (!cancelled && b64) setSrc(`data:${attachment.mimeType || 'image/png'};base64,${b64}`);
        } catch { /* ignore */ }
      }
    }

    loadImage();
    return () => { cancelled = true; };
  }, [attachment.path, attachment.mimeType, attachment.fileId, attachment.id]);

  if (!src) return null;

  return (
    <>
      <img
        src={src}
        alt=""
        className="max-w-[200px] max-h-[150px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
        loading="eager"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        onClick={() => setLightbox(true)}
      />
      {lightbox && <ImageLightbox src={src} alt="" onClose={() => setLightbox(false)} />}
    </>
  );
}

export const MessageBubble = memo(function MessageBubble({ message, characterName, characterAvatar, userAvatar }: Props) {
  const isUser = message.sender === 'user';
  initStyleCache();
  const rgb = useMemo(() => hexToRgb(cachedAccentColor), [cachedAccentColor]);

  const userBubbleClasses = (() => {
    switch (cachedBubbleStyle) {
      case 'wechat':
        return 'rounded-lg bg-[#95EC69] dark:bg-[#3EB575] text-gray-900 dark:text-gray-100';
      case 'pill':
        return 'rounded-full px-5 text-white shadow-md';
      case 'glass':
        return 'rounded-2xl text-white backdrop-blur-xl border border-white/20 shadow-lg';
      case 'bubble':
        return 'rounded-2xl rounded-br-sm text-white shadow-md';
      case 'gradient':
        return 'rounded-2xl text-white shadow-lg';
      case 'sharp':
        return 'rounded-none text-white';
      case 'minimal':
        return 'rounded-none bg-transparent! px-0';
      default:
        return 'rounded-2xl text-white shadow-sm';
    }
  })();

  const aiBubbleClasses = (() => {
    switch (cachedBubbleStyle) {
      case 'wechat':
        return 'rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm';
      case 'pill':
        return 'rounded-full px-5 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm';
      case 'glass':
        return 'rounded-2xl bg-white/70 dark:bg-gray-800/70 text-gray-900 dark:text-gray-100 backdrop-blur-xl border border-gray-200/50 dark:border-gray-700/50 shadow-lg';
      case 'bubble':
        return 'rounded-2xl rounded-bl-sm bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm';
      case 'gradient':
        return 'rounded-2xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm';
      case 'sharp':
        return 'rounded-none bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100';
      case 'minimal':
        return 'rounded-none bg-transparent! px-0 py-1 text-gray-900 dark:text-gray-100';
      default:
        return 'rounded-2xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm';
    }
  })();

  const userStyle: React.CSSProperties = useMemo(() => {
    if (cachedBubbleStyle === 'wechat' || cachedBubbleStyle === 'minimal') return {};
    if (cachedBubbleStyle === 'pill' || cachedBubbleStyle === 'bubble') {
      return { backgroundColor: cachedAccentColor };
    }
    if (cachedBubbleStyle === 'gradient') {
      return { background: `linear-gradient(135deg, ${cachedAccentColor}, ${cachedAccentColor}dd)` };
    }
    if (cachedBubbleStyle === 'glass') {
      return { background: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.85)` };
    }
    return { backgroundColor: cachedAccentColor };
  }, [rgb]);

  const time = formatTime(new Date(message.timestamp));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex gap-2 px-4 py-1 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && <AIAvatar name={characterName} avatar={characterAvatar} avatarStyle={cachedAvatarStyle} />}
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[75%]`}>
        <div
          className={`${message.content ? 'px-4 py-2.5 text-sm leading-relaxed' : 'p-1'} ${isUser ? userBubbleClasses : aiBubbleClasses}`}
          style={isUser ? userStyle : undefined}
        >
          {cachedBubbleStyle === 'minimal' ? (
            <span className="font-medium text-gray-500 dark:text-gray-400 text-xs block mb-0.5">{characterName}</span>
          ) : null}
          {/* Show text content only if there are no image attachments (images have their own display) */}
          {message.content && (!message.attachments || !message.attachments.some(a => a.type === 'image')) ? message.content : null}
          {message.attachments && message.attachments.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 ${message.content ? 'mt-2' : ''}`}>
              {message.attachments.map((a) => {
                if (a.type === 'image') {
                  return <ImageAttachment key={a.id} attachment={a} />;
                }
                return <FileAttachment key={a.id} attachment={a} />;
              })}
            </div>
          )}
        </div>
        <p className={`text-[10px] text-gray-400 dark:text-gray-500 mt-1 px-1 ${isUser ? 'text-right' : 'text-left'}`}>
          {time}
        </p>
      </div>
      {isUser && <UserAvatar avatar={userAvatar} avatarStyle={cachedAvatarStyle} />}
    </motion.div>
  );
});
