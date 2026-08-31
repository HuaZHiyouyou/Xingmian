import { useState, useMemo, useRef, useEffect } from 'react';
import { useChatStore } from '../../store/chatStore';
import { useCharacterStore } from '../../store/characterStore';
import { useUserProfileStore } from '../../store/userProfileStore';
import { Conversation, Message } from '../../types';
import { ArrowLeft, Search, Trash2, MessageSquare, Filter, X, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

export function ChatHistoryPage() {
  const conversations = useChatStore((s) => s.conversations);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const hydrateHistoryConversations = useChatStore((s) => s.hydrateHistoryConversations);
  const characters = useCharacterStore((s) => s.characters);
  const userAvatar = useUserProfileStore((s) => s.profile.avatar);
  const navigate = useNavigate();

  // 🆕 挂载时从数据库水合全部会话：刷新/重载后内存里只有当前会话，
  //    不水合的话历史页会显示成"只剩一个对话"（数据其实都在库里）
  useEffect(() => {
    hydrateHistoryConversations();
  }, [hydrateHistoryConversations]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterCharacterId, setFilterCharacterId] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'messages'>('date');
  const [showFilters, setShowFilters] = useState(false);
  const [viewingConv, setViewingConv] = useState<Conversation | null>(null);
  // 🆕 待删除确认的会话（弹窗确认制，替代此前"3 秒内点两下"的隐藏交互）
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  const getCharacterName = (characterId: string) => {
    return characters.find(c => c.id === characterId)?.name || '未分类';
  };

  const getCharacterAvatar = (characterId: string) => {
    return characters.find(c => c.id === characterId)?.avatar || '';
  };

  const filtered = useMemo(() => {
    let result = [...conversations];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.title.toLowerCase().includes(q) ||
        getCharacterName(c.characterId).toLowerCase().includes(q) ||
        c.messages.some(m => m.content.toLowerCase().includes(q))
      );
    }

    if (filterCharacterId !== 'all') {
      result = result.filter(c => c.characterId === filterCharacterId);
    }

    result.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      return b.messages.length - a.messages.length;
    });

    return result;
  }, [conversations, searchQuery, filterCharacterId, sortBy, characters]);

  const formatDate = (d: Date) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-950 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate('/chat')}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">聊天记录</h1>
            <p className="text-sm text-gray-500">共 {conversations.length} 个对话，{filtered.length} 个匹配</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索对话标题、角色名、消息内容..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-700"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X size={14} className="text-gray-400 hover:text-gray-600" />
            </button>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2" ref={filterRef}>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-full border cursor-pointer
              active:scale-95
              transition-all duration-150 ease-out
              ${showFilters || filterCharacterId !== 'all'
                ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400 hover:shadow-sm'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:-translate-y-px hover:shadow-sm'
              }`}
          >
            <Filter size={12} />
            筛选
            {filterCharacterId !== 'all' && (
              <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
            )}
          </button>

          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[10px] text-gray-400">排序：</span>
            <button
              onClick={() => setSortBy('date')}
              className={`px-2 py-1 text-xs rounded-full border transition-all duration-200 ${
                sortBy === 'date'
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              时间
            </button>
            <button
              onClick={() => setSortBy('messages')}
              className={`px-2 py-1 text-xs rounded-full border transition-all duration-200 ${
                sortBy === 'messages'
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              消息数
            </button>
          </div>
        </div>

      </div>

      {/* Scrollable area: filter tags + conversation list */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <motion.div layout transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}>
          {/* Character filter */}
          <AnimatePresence initial={false}>
            {showFilters && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="pb-3 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFilterCharacterId('all')}
                    className={`px-2.5 py-1 text-xs rounded-full cursor-pointer border
                      active:scale-95
                      transition-all duration-150 ease-out
                      ${filterCharacterId === 'all'
                        ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                  >
                    全部
                  </button>
                  {characters.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setFilterCharacterId(c.id)}
                      className={`px-2.5 py-1 text-xs rounded-full cursor-pointer border
                        active:scale-95
                        transition-all duration-150 ease-out
                        ${filterCharacterId === c.id
                          ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {filtered.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p className="text-gray-500 dark:text-gray-400">
              {conversations.length === 0 ? '还没有任何对话' : '没有匹配的对话'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((conv) => (
              <div
                key={conv.id}
                className="bg-white dark:bg-gray-900 rounded-2xl p-4 cursor-pointer
                  shadow-sm hover:shadow-md
                  hover:-translate-y-0.5
                  active:scale-[0.98] active:shadow-sm
                  transition-all duration-200 ease-out
                  group"
                onClick={() => setViewingConv(conv)}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-400">
                      {getCharacterName(conv.characterId).charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{conv.title}</h3>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{formatDate(conv.updatedAt)}</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {getCharacterName(conv.characterId)} · {conv.messages.length} 条消息
                    </p>
                    {conv.messages.length > 0 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">
                        最后：{conv.messages[conv.messages.length - 1].content.slice(0, 60)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewingConv(conv); }}
                      className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-slate-700 transition-colors"
                      title="查看"
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(conv);
                      }}
                      className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        </motion.div>
      </div>

      {/* Delete Confirm Modal 🆕 */}
      <AnimatePresence>
        {pendingDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
            onClick={() => setPendingDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ type: 'spring', damping: 25, stiffness: 320 }}
              className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 mb-4">
                <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30 shrink-0">
                  <Trash2 size={20} className="text-red-600 dark:text-red-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">确认删除对话？</h3>
                  <p className="text-xs text-gray-500 mt-1 break-all">
                    「{pendingDelete.title || '未命名对话'}」（{pendingDelete.messages.length} 条消息）将被彻底删除，此操作不可撤销。
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setPendingDelete(null)}
                  className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    deleteConversation(pendingDelete.id);
                    if (viewingConv?.id === pendingDelete.id) setViewingConv(null);
                    setPendingDelete(null);
                  }}
                  className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 transition-colors active:scale-95"
                >
                  彻底删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conversation Viewer Modal */}
      <AnimatePresence>
        {viewingConv && (
          <ConversationViewer
            conversation={viewingConv}
            characterName={getCharacterName(viewingConv.characterId)}
            characterAvatar={getCharacterAvatar(viewingConv.characterId)}
            userAvatar={userAvatar}
            onClose={() => setViewingConv(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ConversationViewer({ conversation, characterName, characterAvatar, userAvatar, onClose }: {
  conversation: Conversation;
  characterName: string;
  characterAvatar?: string;
  userAvatar?: string;
  onClose: () => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [searchInConv, setSearchInConv] = useState('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const highlightedMessages = useMemo(() => {
    if (!searchInConv) return conversation.messages;
    const q = searchInConv.toLowerCase();
    return conversation.messages.filter(m => m.content.toLowerCase().includes(q));
  }, [conversation.messages, searchInConv]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Viewer Header */}
        <div className="px-5 py-4 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0" style={{ backgroundColor: characterAvatar ? 'transparent' : undefined }}>
                {characterAvatar ? (
                  <img src={characterAvatar} alt={characterName} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-slate-200 dark:bg-slate-900/30 flex items-center justify-center">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-400">
                      {characterName.charAt(0)}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{conversation.title}</h3>
                <p className="text-[10px] text-gray-400">
                  {characterName} · {conversation.messages.length} 条消息 ·{' '}
                  {new Date(conversation.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <X size={18} className="text-gray-500" />
            </button>
          </div>
          {/* Search in conversation */}
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchInConv}
              onChange={(e) => setSearchInConv(e.target.value)}
              placeholder="搜索此对话..."
              className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-700"
            />
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {highlightedMessages.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">没有匹配的消息</p>
          ) : (
            <div className="space-y-3">
              {highlightedMessages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} characterName={characterName} characterAvatar={characterAvatar} userAvatar={userAvatar} />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </motion.div>
    </motion.div>
  );
}

function MessageBubble({ message, characterName, characterAvatar, userAvatar }: { message: Message; characterName: string; characterAvatar?: string; userAvatar?: string }) {
  const isUser = message.sender === 'user';
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? 'order-1' : 'order-1'}`}>
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-0.5">
            <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0">
              {characterAvatar ? (
                <img src={characterAvatar} alt={characterName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-slate-200 dark:bg-slate-900/30 flex items-center justify-center">
                  <span className="text-[8px] font-medium text-slate-700 dark:text-slate-400">{characterName.charAt(0)}</span>
                </div>
              )}
            </div>
            <span className="text-[10px] text-gray-400">{characterName}</span>
          </div>
        )}
        <div
          className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-slate-700 text-white rounded-br-md'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-md'
          }`}
        >
          {message.content}
        </div>
        <span className={`text-[10px] text-gray-400 mt-0.5 block ${isUser ? 'text-right' : 'text-left'}`}>
          {time}
        </span>
      </div>
      {isUser && (
        <div className="w-5 h-5 flex-shrink-0 ml-1.5 mt-0.5 overflow-hidden rounded-full">
          {userAvatar ? (
            <img src={userAvatar} alt="我" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-700 to-slate-700 flex items-center justify-center">
              <span className="text-white text-[8px] font-bold">我</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
