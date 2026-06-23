import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useChatStore } from '../../store/chatStore';
import { useCharacterStore } from '../../store/characterStore';
import { useUserProfileStore } from '../../store/userProfileStore';
import { emotionColors } from '../../utils/constants';
import { EmotionType } from '../../types';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { InputArea } from './InputArea';
import { useNavigate } from 'react-router-dom';

const emotionLabels: Record<EmotionType, string> = {
  joy: '喜悦', sadness: '悲伤', anger: '愤怒', fear: '恐惧',
  surprise: '惊讶', love: '爱意', neutral: '平静', shy: '害羞',
  lonely: '孤独', grateful: '感激', brave: '勇敢',
  curiosity: '好奇', excitement: '兴奋', pride: '骄傲',
  disappointment: '失落', confusion: '困惑', contentment: '满足',
  nostalgia: '怀念', jealousy: '嫉妒', hope: '希望',
  relief: '释然', regret: '后悔', admiration: '钦佩',
  anxious: '焦虑', embarrassed: '尴尬', tender: '温柔',
  disgusted: '厌恶', jealous: '嫉妒', confused: '困惑',
  nostalgic: '怀念', proud: '自豪', surprised: '惊讶',
};

function loadInputDebounceConfig() {
  try {
    const stored = localStorage.getItem('ui-config');
    if (stored) {
      const config = JSON.parse(stored);
      return {
        enabled: config.inputDebounce ?? true,
        ms: config.inputDebounceMs ?? 1500,
      };
    }
  } catch { /* ignore */ }
  return { enabled: false, ms: 1500 };
}

export function ChatWindow() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const currentId = useChatStore((s) => s.currentConversationId);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isTyping = useChatStore((s) => s.isTyping);
  const currentEmotion = useChatStore((s) => s.currentEmotion);
  const emotionIntensity = useChatStore((s) => s.emotionIntensity);
  const characters = useCharacterStore((s) => s.characters);
  const selectedCharacterId = useCharacterStore((s) => s.selectedCharacterId);
  const navigate = useNavigate();
  const [debounceConfig, setDebounceConfig] = useState(loadInputDebounceConfig);
  const isNearBottomRef = useRef(true);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const conversation = useChatStore((s) => s.conversations.find(c => c.id === currentId));
  const selectedCharacter = useMemo(
    () => characters.find(c => c.id === conversation?.characterId) || null,
    [characters, conversation?.characterId]
  );
  const isCharacterMismatch = selectedCharacterId !== null && conversation?.characterId !== '' && conversation?.characterId !== selectedCharacterId;
  const mismatchedChar = useMemo(
    () => isCharacterMismatch ? characters.find(c => c.id === selectedCharacterId) : null,
    [characters, selectedCharacterId, isCharacterMismatch]
  );
  const userAvatar = useUserProfileStore((s) => s.profile.avatar);

  useEffect(() => {
    const handleFocus = () => setDebounceConfig(loadInputDebounceConfig());
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  const handleScroll = useCallback(() => {
    isNearBottomRef.current = isNearBottom();
  }, [isNearBottom]);

  useEffect(() => {
    if (isNearBottomRef.current) {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [conversation?.messages, isTyping]);

  if (!currentId || !conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <span className="text-2xl">💬</span>
          </div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">
            开始对话
          </h2>
          <p className="text-sm text-gray-500 mb-4">选择一个角色开始聊天</p>
          <button
            onClick={() => navigate('/characters')}
            className="px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium
              hover:bg-violet-700 transition-all shadow-md hover:shadow-lg active:scale-95"
          >
            选择角色
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl">
        <div className="w-9 h-9 flex items-center justify-center shadow-sm overflow-hidden flex-shrink-0" style={(() => {
          const s = document.documentElement.getAttribute('data-avatar-style') || 'circle';
          return s === 'squircle' ? { borderRadius: '22%' } : s === 'square' ? { borderRadius: '12px' } : { borderRadius: '9999px' };
        })()}>
          {selectedCharacter?.avatar ? (
            <img src={selectedCharacter.avatar} alt={selectedCharacter.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-violet-400 to-pink-400 flex items-center justify-center">
              <span className="text-white text-sm font-bold">
                {selectedCharacter?.name?.charAt(0) || 'AI'}
              </span>
            </div>
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 text-sm">
            {selectedCharacter?.name || 'AI'}
          </h3>
          <div className="flex items-center gap-1.5">
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{selectedCharacter?.personality}</p>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <div className="flex items-center gap-1 cursor-pointer" onClick={() => navigate('/emotion')}>
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: emotionColors[currentEmotion] }}
              />
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {emotionLabels[currentEmotion]} {emotionIntensity > 0 ? `${emotionIntensity}%` : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Character mismatch warning */}
      {isCharacterMismatch && (
        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/50 flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-800/50 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px]">⚠️</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-amber-700 dark:text-amber-300">
              当前对话属于 <span className="font-medium">{selectedCharacter?.name}</span>，但你选择了 <span className="font-medium">{mismatchedChar?.name}</span>
            </p>
            <p className="text-[10px] text-amber-500 dark:text-amber-400">请切换到匹配的对话或更改角色选择</p>
          </div>
          <button
            onClick={() => navigate('/characters')}
            className="px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-[10px] font-medium hover:bg-amber-200 dark:hover:bg-amber-700/50 transition-colors"
          >
            切换角色
          </button>
        </div>
      )}

      {/* Messages */}
      <AnimatePresence>
        {isTyping && <TypingIndicator />}
      </AnimatePresence>
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-4">
        {conversation.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} characterName={selectedCharacter?.name || 'AI'} characterAvatar={selectedCharacter?.avatar} userAvatar={userAvatar} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <InputArea
        onSend={sendMessage}
        isAiTyping={isTyping}
        debounceEnabled={debounceConfig.enabled}
        debounceMs={debounceConfig.ms}
        disabled={isCharacterMismatch}
      />
    </div>
  );
}
