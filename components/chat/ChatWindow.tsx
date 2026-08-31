import { useEffect, useRef, useMemo, useCallback, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useChatStore } from '../../store/chatStore';
import { useCharacterStore } from '../../store/characterStore';
import { useUserProfileStore } from '../../store/userProfileStore';
import { useUIStore } from '../../store/uiStore';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { emotionColors, emotionLabels } from '../../utils/constants';
import { EmotionType, Message } from '../../types';
import { getDominantEmotion } from '../../utils/emotionAnalyzer';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { InputArea } from './InputArea';
import { ChatStatusHeader } from './ChatStatusHeader';
import { MessageCircle, AlertTriangle, WifiOff, RefreshCw, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { checkModelConnectivity, invalidateConnectivityCache, ModelConnectivityResult } from '../../services/aiService';

export function ChatWindow() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const currentId = useChatStore((s) => s.currentConversationId);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isTyping = useChatStore((s) => s.isTyping);
  const apiError = useChatStore((s) => s.apiError);
  const clearApiError = useChatStore((s) => s.clearApiError);
  const characters = useCharacterStore((s) => s.characters);
  const selectedCharacterId = useCharacterStore((s) => s.selectedCharacterId);
  const navigate = useNavigate();
  const debounceEnabled = useUIStore((s) => s.inputDebounce);
  const debounceMs = useUIStore((s) => s.inputDebounceMs);
  const isNearBottomRef = useRef(true);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasInitialScrolledRef = useRef(false); // 改动1: 首次进入不自动滚到底部
  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState<string | null>(null);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const recallMessage = useChatStore((s) => s.recallMessage);

  // 🆕 A4: 模型连通性检测——进入聊天页自动 ping（服务内有 5 分钟缓存），失败显示橙色提示条
  const [connIssue, setConnIssue] = useState<ModelConnectivityResult | null>(null);
  const [connChecking, setConnChecking] = useState(false);
  useEffect(() => {
    let cancelled = false;
    checkModelConnectivity().then((r) => {
      if (!cancelled) setConnIssue(r.ok ? null : r);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const retryConnectivity = async () => {
    setConnChecking(true);
    try {
      invalidateConnectivityCache();
      const r = await checkModelConnectivity(true);
      setConnIssue(r.ok ? null : r);
    } finally {
      setConnChecking(false);
    }
  };

  // 使用稳定的 selector，避免每次渲染返回新引用
  const messages = useChatStore((s) => {
    const conv = s.conversations.find(c => c.id === currentId);
    return conv?.messages;
  }) || [];

  const conversationCharId = useChatStore((s) => {
    const conv = s.conversations.find(c => c.id === currentId);
    return conv?.characterId || '';
  });

  const hasConversation = useChatStore((s) => {
    return s.conversations.some(c => c.id === currentId);
  });

  // 多维情绪状态 - 使用稳定的选择器
  const multiEmotion = useCharacterMindStore((s) => {
    if (!conversationCharId) return null;
    return s.multiEmotions[conversationCharId] || null;
  });

  const { type: currentEmotion, intensity: emotionIntensity } = useMemo(() => {
    if (!multiEmotion) return { type: 'anticipation' as EmotionType, intensity: 0 };
    return getDominantEmotion(multiEmotion);
  }, [multiEmotion]);
  
  const selectedCharacter = useMemo(
    () => characters.find(c => c.id === conversationCharId) || null,
    [characters, conversationCharId]
  );
  // 只有真正选中了角色(非空字符串)且不匹配对话角色时,才算 mismatch
  const isCharacterMismatch =
    selectedCharacterId !== null &&
    selectedCharacterId !== '' &&
    conversationCharId !== '' &&
    conversationCharId !== selectedCharacterId;
  const mismatchedChar = useMemo(
    () => isCharacterMismatch ? characters.find(c => c.id === selectedCharacterId) : null,
    [characters, selectedCharacterId, isCharacterMismatch]
  );
  const userAvatar = useUserProfileStore((s) => s.profile.avatar);

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  const handleScroll = useCallback(() => {
    isNearBottomRef.current = isNearBottom();
  }, [isNearBottom]);

  // 改动1: 首次进入聊天页面不自动滚轮到最底下
  useEffect(() => {
    if (!hasInitialScrolledRef.current) {
      hasInitialScrolledRef.current = true;
      return; // 首次加载不滚动
    }
    if (isNearBottomRef.current) {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [messages, isTyping]);

  if (!currentId || !hasConversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-200 dark:bg-slate-800/30 flex items-center justify-center">
            <MessageCircle size={24} className="text-slate-700 dark:text-slate-300" />
          </div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">
            开始对话
          </h2>
          <p className="text-sm text-gray-500 mb-4">选择一个角色开始聊天</p>
          <button
            onClick={() => navigate('/characters')}
            className="px-5 py-2.5 rounded-xl bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white text-sm font-medium
              hover:bg-gray-800 dark:hover:bg-white transition-all shadow-md hover:shadow-lg active:scale-95"
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
            <div className="w-full h-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center">
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

      {/* 🆕 AI 一日状态条：显示当前活动 + 所在位置 + 进度（与对话绑定角色对齐） */}
      <ChatStatusHeader characterId={conversationCharId || undefined} />

      {/* 🆕 A4: 模型连通性异常提示条（ok 时不显示任何东西） */}
      {connIssue && !connIssue.ok && (
        <div className="px-4 py-2.5 bg-orange-50 dark:bg-orange-900/20 flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-800/50 flex items-center justify-center flex-shrink-0">
            <WifiOff size={12} className="text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-orange-700 dark:text-orange-300 truncate">
              模型连接异常：{connIssue.error || '请求失败（无错误详情，请检查网络或 API 地址）'}
            </p>
            {(connIssue.model || connIssue.platform) && (
              <p className="text-[10px] text-orange-500 dark:text-orange-400 truncate">
                {connIssue.platform || ''}{connIssue.platform && connIssue.model ? ' · ' : ''}{connIssue.model || ''}
              </p>
            )}
          </div>
          <button
            onClick={retryConnectivity}
            disabled={connChecking}
            className="px-2 py-1 rounded-lg bg-orange-100 dark:bg-orange-800/50 text-orange-700 dark:text-orange-300 text-[10px] font-medium hover:bg-orange-200 dark:hover:bg-orange-700/50 transition-colors flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw size={10} className={connChecking ? 'animate-spin' : ''} />
            重试
          </button>
          <button
            onClick={() => navigate('/api-config')}
            className="px-2 py-1 rounded-lg bg-orange-100 dark:bg-orange-800/50 text-orange-700 dark:text-orange-300 text-[10px] font-medium hover:bg-orange-200 dark:hover:bg-orange-700/50 transition-colors flex items-center gap-1"
          >
            <Settings size={10} />
            前往配置
          </button>
        </div>
      )}

      {/* Character mismatch warning */}
      {isCharacterMismatch && (
        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-800/50 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={12} className="text-amber-500" />
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

      {/* Rust pipeline error */}
      {apiError && (
        <div className="px-4 py-2.5 bg-red-50 dark:bg-red-900/20 flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-800/50 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={12} className="text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-700 dark:text-red-300">
              回复生成失败：{apiError}
            </p>
          </div>
          <button
            onClick={clearApiError}
            className="px-2 py-1 rounded-lg bg-red-100 dark:bg-red-800/50 text-red-700 dark:text-red-300 text-[10px] font-medium hover:bg-red-200 dark:hover:bg-red-700/50 transition-colors"
          >
            关闭
          </button>
        </div>
      )}

      {/* Messages */}
      <AnimatePresence>
        {isTyping && <TypingIndicator />}
      </AnimatePresence>
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-4">
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            characterName={selectedCharacter?.name || 'AI'}
            characterAvatar={selectedCharacter?.avatar}
            userAvatar={userAvatar}
            onQuote={(m) => setQuotedMessage(m)}
            onDelete={(id) => currentId && deleteMessage(currentId, id)}
            onRecall={(id) => currentId && recallMessage(currentId, id)}
            onEditRecalled={(content) => setEditContent(content)}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <InputArea
        onSend={sendMessage}
        isAiTyping={isTyping}
        debounceEnabled={debounceEnabled}
        debounceMs={debounceMs}
        disabled={isCharacterMismatch}
        conversationId={currentId}
        quotedMessage={quotedMessage}
        onClearQuote={() => setQuotedMessage(null)}
        editContent={editContent}
        onClearEdit={() => setEditContent(null)}
      />
    </div>
  );
}
