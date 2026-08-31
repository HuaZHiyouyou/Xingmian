import { useState, useEffect, useRef, useMemo } from 'react';
import type { ElementType } from 'react';
import { useChatStore } from '../../store/chatStore';
import { useCharacterStore } from '../../store/characterStore';
import { useUIStore } from '../../store/uiStore';
import {
  MessageSquare, Plus, Search, X, History, Settings, Users,
  Heart, Brain, SlidersHorizontal, PanelLeftClose, PanelLeftOpen,
  Music, Sparkles
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Character } from '../../types';

function Tooltip({ children, label, disabled }: { children: React.ReactNode; label: string; disabled?: boolean }) {
  if (disabled) return <>{children}</>;
  return (
    <div className="relative group/tip inline-flex">
      {children}
      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded-md
        bg-gray-800 dark:bg-gray-700 text-white text-xs whitespace-nowrap
        opacity-0 pointer-events-none group-hover/tip:opacity-100
        transition-opacity duration-150 z-50 shadow-lg">
        {label}
      </div>
    </div>
  );
}

export function Sidebar() {
  const [isOpen, setIsOpen] = useState(false);

  // 监听 MobileTabBar "更多" 按钮触发的打开事件
  useEffect(() => {
    const handleOpenSidebar = () => setIsOpen(true);
    window.addEventListener('open-sidebar', handleOpenSidebar);
    return () => window.removeEventListener('open-sidebar', handleOpenSidebar);
  }, []);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCharPicker, setShowCharPicker] = useState(false);
  const [newConvId, setNewConvId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const sidebarRef = useRef<HTMLElement>(null);
  const conversationList = useChatStore((state) => state.conversationList);
  const hasMoreConversations = useChatStore((state) => state.hasMoreConversations);
  const loadMoreConversations = useChatStore((state) => state.loadMoreConversations);
  const currentId = useChatStore((state) => state.currentConversationId);
  const createNew = useChatStore((state) => state.createNewConversation);
  const createTestConversation = useChatStore((state) => state.createTestConversation);
  const setCurrent = useChatStore((state) => state.setCurrentConversation);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const selectedCharacterId = useCharacterStore((state) => state.selectedCharacterId);
  const characters = useCharacterStore((state) => state.characters);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClick = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!searchQuery) return conversationList;
    const q = searchQuery.toLowerCase();
    return conversationList.filter(c => c.title.toLowerCase().includes(q));
  }, [conversationList, searchQuery]);

  const closeSidebar = () => setIsOpen(false);
  const toggleCollapsed = () => setSidebarCollapsed(!collapsed);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      loadMoreConversations();
    }
  };

  const handleCreateWithCharacter = (character: Character) => {
    const id = createNew(character.id);
    setCurrent(id);
    setNewConvId(id);
    setTimeout(() => setNewConvId(null), 400);
    setShowCharPicker(false);
    closeSidebar();
  };

  const handleCreateDefault = () => {
    const id = createNew(selectedCharacterId);
    setCurrent(id);
    setNewConvId(id);
    setTimeout(() => setNewConvId(null), 400);
    setShowCharPicker(false);
    closeSidebar();
  };

  const handleCreateTest = () => {
    const id = createTestConversation();
    setCurrent(id);
    setNewConvId(id);
    setTimeout(() => setNewConvId(null), 400);
    setShowCharPicker(false);
    closeSidebar();
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setHiddenIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      deleteConversation(id);
      setHiddenIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 200);
  };

  // 核心导航：高频使用，直接展示在侧边栏
  const navItems = [
    { icon: Users, label: '角色', path: '/characters' },
    { icon: History, label: '记录', path: '/history' },
    { icon: Heart, label: '情感', path: '/emotion' },
    { icon: Brain, label: '记忆', path: '/memory' },
    { icon: Music, label: '播放器', path: '/music' },
    { icon: Sparkles, label: 'AI 一天', path: '/ai-life' },
  ];

  // 二级功能：放入"更多"页面
  // 系统设置也放入"更多"
  const moreItem = { icon: SlidersHorizontal, label: '更多', path: '/more' };

  const NavButton = ({ icon: Icon, label, path }: { icon: ElementType; label: string; path: string }) => (
    <Tooltip label={label} disabled={!collapsed}>
      <button
        onClick={() => { navigate(path); closeSidebar(); }}
        className={`
          flex items-center gap-2.5 rounded-xl text-gray-500 dark:text-gray-400
          hover:text-gray-800 dark:hover:text-gray-200
          hover:bg-black/[0.04] dark:hover:bg-white/[0.06]
          active:scale-[0.97] transition-all duration-100 text-[13px]
          ${collapsed ? 'justify-center w-9 h-9 mx-auto' : 'w-full px-3 py-2'}
        `}
      >
        <Icon size={16} className="flex-shrink-0 opacity-70" />
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    </Tooltip>
  );

  return (
    <>
      <aside
        ref={sidebarRef}
        className={`
          fixed lg:relative inset-y-0 left-0 z-40
          backdrop-blur-xl bg-white/80 dark:bg-gray-900/80
          border-r border-black/[0.04] dark:border-white/[0.06]
          flex flex-col overflow-hidden overflow-x-hidden
          transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${collapsed ? 'w-12' : 'w-64'}
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* === Fixed top section === */}
        <div className="flex-shrink-0">
          {/* Header with title and collapse toggle */}
          <div className={`flex items-center ${collapsed ? 'justify-center py-3' : 'justify-between px-4 py-3'}`}>
            {!collapsed && (
              <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 select-none">xingmian</h1>
            )}
            <button
              onClick={toggleCollapsed}
              className={`
                flex items-center justify-center rounded-lg transition-colors
                text-gray-400 hover:text-slate-700 dark:hover:text-slate-500
                hover:bg-slate-100 dark:hover:bg-slate-800/20
                ${collapsed ? 'w-8 h-8' : 'w-7 h-7'}
              `}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>

          {/* New conversation button */}
          <div className={collapsed ? 'px-1.5 mt-3 mb-1' : 'px-3 mt-3 mb-1'}>
            <Tooltip label="新对话" disabled={!collapsed}>
              <button
                onClick={() => setShowCharPicker(true)}
                className={`
                  group relative flex items-center justify-center gap-2 rounded-2xl overflow-hidden
                  bg-gradient-to-r from-indigo-500 via-blue-500 to-sky-400
                  bg-[length:200%_100%] bg-left hover:bg-right
                  text-white text-[13px] font-medium tracking-wide
                  shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/40
                  active:scale-[0.97]
                  transition-all duration-500 ease-out
                  ${collapsed ? 'w-9 h-9' : 'w-full px-3 py-2.5'}
                `}
              >
                {/* 悬停流光扫过 */}
                <span className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 ease-out" />
                {/* 顶部内高光，增加立体感 */}
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" />
                <Plus size={16} className="relative transition-transform duration-300 group-hover:rotate-90" />
                {!collapsed && <span className="relative">新对话</span>}
              </button>
            </Tooltip>
          </div>

          {/* Search (expanded only) */}
          {!collapsed && (
            <div className="px-3 pb-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索对话..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl text-[13px]
                    bg-black/[0.03] dark:bg-white/[0.04]
                    border border-black/[0.04] dark:border-white/[0.06]
                    focus:outline-none focus:ring-0 focus:border-slate-500/40 dark:focus:border-slate-500/30
                    text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600
                    transition-colors"
                />
              </div>
            </div>
          )}
        </div>

        {/* === Scrollable conversations === */}
        <div
          onScroll={handleScroll}
          className={`flex-1 overflow-y-auto overflow-x-hidden min-h-0 ${collapsed ? 'px-1 pb-2' : 'px-1.5 pb-2'}`}
        >
          {filtered.map((conv) => {
            const isActive = conv.id === currentId && !hiddenIds.has(conv.id);
            // 只有真正选中了角色(非空字符串)且不匹配对话角色时,才算 mismatch
            const isMismatch = selectedCharacterId !== null && selectedCharacterId !== '' && conv.characterId !== '' && conv.characterId !== selectedCharacterId;
            return (
              <Tooltip key={conv.id} label={isMismatch ? `${conv.title}（角色不匹配）` : conv.title} disabled={!collapsed}>
                <div
                  onClick={() => {
                    if (isMismatch) return;
                    setCurrent(conv.id);
                    navigate('/chat');
                    closeSidebar();
                  }}
                  className={`
                    group flex items-center gap-2 rounded-lg mb-0.5
                    transition-all duration-150
                    ${isMismatch
                      ? 'opacity-30 cursor-not-allowed'
                      : 'cursor-pointer'}
                    ${collapsed ? 'justify-center w-9 h-9 mx-auto' : 'px-3 py-2'}
                    ${hiddenIds.has(conv.id) ? 'opacity-0 max-h-0 overflow-hidden mb-0 py-0' : ''}
                    ${isActive && !isMismatch
                      ? 'bg-slate-700/10 dark:bg-slate-500/10 text-slate-700 dark:text-slate-500'
                      : !isMismatch ? 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-gray-600 dark:text-gray-400' : 'text-gray-400 dark:text-gray-600'}
                    ${newConvId === conv.id ? 'animate-slideIn' : ''}
                  `}
                >
                  {collapsed ? (
                    <div className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-medium text-gray-500 dark:text-gray-400">
                        {conv.title.charAt(0)}
                      </span>
                    </div>
                  ) : (
                    <>
                      <MessageSquare size={14} className="flex-shrink-0 opacity-60" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{conv.title}</p>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, conv.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-200
                          dark:hover:bg-gray-700 text-gray-400 hover:text-red-500 transition-all duration-150
                          active:scale-90"
                      >
                        <X size={12} />
                      </button>
                    </>
                  )}
                </div>
              </Tooltip>
            );
          })}
          {hasMoreConversations && !collapsed && (
            <div className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">
              加载更多…
            </div>
          )}
        </div>

        {/* === Fixed bottom nav === */}
        <div className="flex-shrink-0">
          {/* Main nav */}
          <div className={`${collapsed ? 'px-1.5 py-1' : 'px-3 py-1'} space-y-0.5 overflow-x-hidden`}>
            {navItems.map((item) => <NavButton key={item.path} {...item} />)}
          </div>

          {/* Divider */}
          <div className={`border-t border-black/[0.04] dark:border-white/[0.06] ${collapsed ? 'mx-2' : 'mx-3'}`} />

          {/* More + Settings */}
          <div className={`${collapsed ? 'px-1.5 py-1' : 'px-3 py-1'} space-y-0.5 overflow-x-hidden`}>
            <NavButton {...moreItem} />
            <NavButton icon={Settings} label="设置" path="/settings" />
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30" onClick={closeSidebar} />
      )}

      {/* Character picker */}
      {showCharPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-fadeIn">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowCharPicker(false)} />
          <div className="relative backdrop-blur-xl bg-white/90 dark:bg-gray-900/90 border border-black/[0.04] dark:border-white/[0.06] rounded-3xl shadow-2xl w-full max-w-sm mx-4 animate-slideIn">
            <div className="p-4">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">选择角色</h3>
              <p className="text-xs text-gray-500 mb-4">为新对话选择一个角色</p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                <button
                  onClick={handleCreateDefault}
                  className="w-full flex items-center gap-3 p-3 rounded-xl text-left
                    hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-[0.98] transition-all duration-150"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-500 to-slate-700
                    flex items-center justify-center text-white text-sm font-medium flex-shrink-0">AI</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">默认 AI</p>
                    <p className="text-xs text-gray-400 truncate">无角色设定的通用助手</p>
                  </div>
                </button>
                <button
                  onClick={handleCreateTest}
                  className="w-full flex items-center gap-3 p-3 rounded-xl text-left
                    hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-[0.98] transition-all duration-150"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-400 to-gray-500
                    flex items-center justify-center text-white text-sm font-medium flex-shrink-0">测试</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">测试对话</p>
                    <p className="text-xs text-gray-400 truncate">不调用 AI，直接回显消息</p>
                  </div>
                </button>
                {characters.map((char) => (
                  <button
                    key={char.id}
                    onClick={() => handleCreateWithCharacter(char)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-left
                      hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-[0.98] transition-all duration-150"
                  >
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-500 to-slate-700
                      flex items-center justify-center text-white text-sm font-medium flex-shrink-0 overflow-hidden">
                      {char.avatar ? (
                        <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" />
                      ) : char.name.slice(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{char.name}</p>
                      <p className="text-xs text-gray-400 truncate">{char.personality?.slice(0, 30) || '未设置性格'}</p>
                    </div>
                  </button>
                ))}
                {characters.length === 0 && (
                  <button
                    onClick={() => { setShowCharPicker(false); navigate('/characters'); closeSidebar(); }}
                    className="w-full flex items-center justify-center gap-2 p-4 rounded-xl text-sm text-slate-700
                      hover:bg-slate-100 dark:hover:bg-slate-800/20 transition-colors"
                  >
                    <Plus size={14} />
                    去创建角色
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.15s ease-out;
        }
        .animate-slideIn {
          animation: slideIn 0.2s ease-out;
        }
      `}</style>
    </>
  );
}
