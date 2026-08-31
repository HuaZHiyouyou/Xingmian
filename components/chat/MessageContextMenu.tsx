import { useEffect, useRef } from 'react';
import { Quote, Trash2, Undo2, Copy } from 'lucide-react';
import { Message } from '../../types';

interface Props {
  message: Message;
  position: { x: number; y: number };
  onClose: () => void;
  onQuote: () => void;
  onDelete: () => void;
  onRecall: () => void;
}

export function MessageContextMenu({ message, position, onClose, onQuote, onDelete, onRecall }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  const isUser = message.sender === 'user';
  const isRecalled = message.recalled;
  const canRecall = isUser && !isRecalled;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleCopy = () => {
    if (message.content) {
      navigator.clipboard.writeText(message.content).catch(() => {});
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-1 min-w-[140px] animate-[fadeIn_0.1s_ease-out]"
      style={{ left: position.x, top: position.y }}
    >
      {message.content && (
        <button
          onClick={handleCopy}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Copy size={14} />
          复制
        </button>
      )}
      <button
        onClick={() => { onQuote(); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <Quote size={14} />
        引用
      </button>
      {canRecall && (
        <button
          onClick={() => { onRecall(); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <Undo2 size={14} />
          撤回
        </button>
      )}
      <button
        onClick={() => { onDelete(); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      >
        <Trash2 size={14} />
        删除
      </button>
    </div>
  );
}
