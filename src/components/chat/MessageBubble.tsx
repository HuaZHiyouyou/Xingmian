import { useState, useMemo, useEffect, useCallback, memo } from 'react';
import { Message, MessageAttachment } from '../../types';
import { motion } from 'framer-motion';
import { ImageIcon, Music, FileText, File, Archive } from 'lucide-react';
import { formatTime } from '../../utils/chatUtils';
import { isRunningInTauri, getFileDataOnly } from '../../lib/tauriBridge';
import { MessageContextMenu } from './MessageContextMenu';
import { emotionColors, emotionLabels } from '../../utils/constants';

interface Props {
  message: Message;
  characterName: string;
  characterAvatar?: string;
  userAvatar?: string;
  onQuote?: (message: Message) => void;
  onDelete?: (messageId: string) => void;
  onRecall?: (messageId: string) => void;
  onEditRecalled?: (content: string) => void;
}

type BubbleStyle = 'rounded' | 'sharp' | 'minimal' | 'wechat' | 'pill' | 'glass' | 'bubble' | 'gradient';

let cachedBubbleStyle: BubbleStyle = 'rounded';
let cachedAvatarStyle = 'circle';
let styleInitialized = false;

function initStyleCache() {
  if (styleInitialized) return;
  cachedBubbleStyle = (document.documentElement.getAttribute('data-bubble-style') as BubbleStyle) || 'rounded';
  cachedAvatarStyle = document.documentElement.getAttribute('data-avatar-style') || 'circle';
  styleInitialized = true;
}

function invalidateStyleCache() {
  styleInitialized = false;
}

export function invalidateMessageStyleCache() {
  invalidateStyleCache();
}

const UserAvatar = memo(function UserAvatar({ avatar, avatarStyle }: { avatar?: string; avatarStyle: string }) {
  const style = avatarStyle === 'squircle' ? { borderRadius: '22%' } : undefined;
  const radiusClass = avatarStyle === 'square' ? 'rounded-xl' : avatarStyle === 'squircle' ? '' : 'rounded-full';
  return (
    <div className={`w-8 h-8 flex items-center justify-center flex-shrink-0 ${radiusClass} shadow-sm overflow-hidden ${!avatar ? 'bg-gradient-to-br from-slate-700 to-slate-700' : ''}`} style={style}>
      {avatar ? (
        <img src={avatar} alt="我" className="w-full h-full object-cover" />
      ) : (
        <span className="text-white text-xs font-bold">我</span>
      )}
    </div>
  );
});

const AIAvatar = memo(function AIAvatar({ name, avatar, avatarStyle }: { name: string; avatar?: string; avatarStyle: string }) {
  const style = avatarStyle === 'squircle' ? { borderRadius: '22%' } : undefined;
  const radiusClass = avatarStyle === 'square' ? 'rounded-xl' : avatarStyle === 'squircle' ? '' : 'rounded-full';
  return (
    <div className={`w-8 h-8 flex items-center justify-center flex-shrink-0 ${radiusClass} shadow-sm overflow-hidden ${!avatar ? 'bg-gradient-to-br from-slate-400 to-slate-600' : ''}`} style={style}>
      {avatar ? (
        <img src={avatar} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-white text-xs font-bold">{name.charAt(0)}</span>
      )}
    </div>
  );
});

const FileAttachment = memo(function FileAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState(false);
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
      return <div className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/5 text-[10px] text-gray-500 flex items-center gap-1"><ImageIcon size={12} /> <span>图片</span></div>;
    }
    if (error) {
      return (
        <div className="max-w-[200px] max-h-[150px] rounded-lg bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center gap-1 text-gray-400 text-xs px-4 py-6">
          <ImageIcon size={20} />
          <span>图片加载失败</span>
        </div>
      );
    }
    return (
      <img
        src={imgSrc}
        alt={attachment.name}
        className="max-w-[200px] max-h-[150px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
        loading="lazy"
        onError={() => setError(true)}
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
        <Music size={16} className="text-green-500 shrink-0" />
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
      <span className="shrink-0 text-gray-500">
        {ext === 'pdf' ? <FileText size={16} /> : ext === 'doc' || ext === 'docx' ? <File size={16} /> : ext === 'xls' || ext === 'xlsx' ? <File size={16} /> : ext === 'zip' || ext === 'rar' ? <Archive size={16} /> : <FileText size={16} />}
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
});

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

const ImageAttachment = memo(function ImageAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
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

  if (error) {
    return (
      <div className="max-w-[200px] max-h-[150px] rounded-lg bg-gray-100 dark:bg-gray-800 flex flex-col items-center justify-center gap-1 text-gray-400 text-xs px-4 py-6">
        <ImageIcon size={20} />
        <span>图片加载失败</span>
      </div>
    );
  }

  return (
    <>
      <img
        src={src}
        alt=""
        className="max-w-[200px] max-h-[150px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
        loading="eager"
        onError={() => setError(true)}
        onClick={() => setLightbox(true)}
      />
      {lightbox && <ImageLightbox src={src} alt="" onClose={() => setLightbox(false)} />}
    </>
  );
});

export const MessageBubble = memo(function MessageBubble({ message, characterName, characterAvatar, userAvatar, onQuote, onDelete, onRecall, onEditRecalled }: Props) {
  const isUser = message.sender === 'user';
  const isRecalled = message.recalled;
  initStyleCache();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

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
    // ✅ 主题色改用 CSS 变量：切换主题色后所有气泡实时换色（不再依赖模块级缓存）
    if (cachedBubbleStyle === 'gradient') {
      return { background: 'linear-gradient(135deg, var(--accent-color), color-mix(in srgb, var(--accent-color) 87%, transparent))' };
    }
    if (cachedBubbleStyle === 'glass') {
      return { background: 'color-mix(in srgb, var(--accent-color) 85%, transparent)' };
    }
    return { backgroundColor: 'var(--accent-color)' };
  }, [cachedBubbleStyle]);

  const time = formatTime(new Date(message.timestamp));

  // 🔧 修复#10：纯图片消息（无文字、无其他附件）不加气泡包裹——图片本身就是消息，
  // 再包一层彩色气泡非常难看；图片+文字时保留气泡。
  const hasImages = !!message.attachments?.some(a => a.type === 'image');
  const hasOtherAtts = !!message.attachments?.some(a => a.type !== 'image');
  const hasVisibleText = !!message.content && !(message.merged && (message.segments?.length || 0) > 1);
  const bareImage = hasImages && !hasOtherAtts && !hasVisibleText;

  if (isRecalled) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex justify-center px-4 py-1"
      >
        <div className="flex flex-col items-center max-w-[80%]">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-gray-400 dark:text-gray-500">
            <span className="italic">{isUser ? '你撤回了一条消息' : `${characterName} 撤回了一条消息`}</span>
            {isUser && message.content && onEditRecalled && (
              <button
                onClick={() => onEditRecalled(message.content)}
                className="text-slate-700 dark:text-slate-300 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-400 font-medium not-italic transition-colors"
              >
                修改
              </button>
            )}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
            {time}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex gap-2 px-4 py-1 ${isUser ? 'justify-end' : 'justify-start'}`}
      onContextMenu={handleContextMenu}
    >
      {!isUser && <AIAvatar name={characterName} avatar={characterAvatar} avatarStyle={cachedAvatarStyle} />}
      <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[75%]`}>
        {/* Quote display */}
        {message.replyTo && (
          <div className={`mb-1 px-3 py-1.5 rounded-lg text-xs max-w-full border-l-2 ${
            isUser
              ? 'bg-slate-100 dark:bg-slate-800/20 border-slate-500 text-gray-600 dark:text-gray-400'
              : 'bg-gray-50 dark:bg-gray-800 border-gray-400 dark:border-gray-500 text-gray-500 dark:text-gray-400'
          }`}>
            <span className="font-medium">{message.replyTo.sender === 'user' ? '你' : characterName}</span>
            <span className="ml-1 truncate block">{message.replyTo.content || '(无内容)'}</span>
          </div>
        )}
        <div
          className={bareImage
            ? 'p-0'
            : `${message.content ? 'px-4 py-2.5 text-sm leading-relaxed' : 'p-1'} ${isUser ? userBubbleClasses : aiBubbleClasses}`}
          style={!bareImage && isUser ? userStyle : undefined}
        >
          {cachedBubbleStyle === 'minimal' ? (
            <span className="font-medium text-gray-500 dark:text-gray-400 text-xs block mb-0.5">{characterName}</span>
          ) : null}
          {/* 🆕 合并消息：多段内容在同一条气泡内堆叠展示，段间用虚线分隔 */}
          {(() => {
            const mergeParts = message.merged
              ? (message.segments && message.segments.length > 0
                  ? message.segments
                  : message.content.split('\n').map(s => s.trim()).filter(Boolean))
              : null;
            if (mergeParts && mergeParts.length > 1) {
              return (
                <div className="space-y-0">
                  {mergeParts.map((part, i) => (
                    <div
                      key={i}
                      className={`whitespace-pre-wrap break-words ${i > 0 ? `mt-1.5 pt-1.5 border-t border-dashed ${isUser ? 'border-white/25' : 'border-gray-400/40 dark:border-gray-500/40'}` : ''}`}
                    >
                      {part}
                    </div>
                  ))}
                </div>
              );
            }
            return null;
          })()}
          {/* 🔧 修复#10：文字与图片共存时文字必须显示——旧逻辑"有图片就隐藏文字"导致
              外部平台"图+文"消息的文字凭空消失 */}
          {hasVisibleText ? message.content : null}
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
        <div className={`flex items-center gap-1.5 mt-1 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          {message.emotion && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500"
              title="该消息的情绪"
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: emotionColors[message.emotion] || '#9ca3af' }}
              />
              <span>{emotionLabels[message.emotion]}{message.emotionIntensity ? ` ${message.emotionIntensity}%` : ''}</span>
            </span>
          )}
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {time}
          </span>
        </div>
      </div>
      {isUser && <UserAvatar avatar={userAvatar} avatarStyle={cachedAvatarStyle} />}
      {contextMenu && onQuote && onDelete && onRecall && (
        <MessageContextMenu
          message={message}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onQuote={() => onQuote(message)}
          onDelete={() => onDelete(message.id)}
          onRecall={() => onRecall(message.id)}
        />
      )}
    </motion.div>
  );
});
