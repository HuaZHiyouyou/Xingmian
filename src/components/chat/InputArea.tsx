import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Send, X, Paperclip, Image as ImageIcon, Quote, Music, Video, Zap, ChevronRight, ChevronLeft, Square, MessagesSquare, MessageCircle } from 'lucide-react';
import { Message, MessageAttachment } from '../../types';
import { pickFiles, readFileAsBase64, saveFileToDb, getFileDataOnly, inferMimeType, isRunningInTauri, getFileFromDb, type PickedFile } from '../../lib/tauriBridge';
import { generateId } from '../../utils/chatUtils';
import { useChatStore } from '../../store/chatStore';
import { useAgentStore } from '../../store/agentStore';
import { executeSlashCommand } from '../../agent/slashCommand';
import { useUIStore, WALLPAPER_PRESETS } from '../../store/uiStore';
import type { AgentTool } from '../../types/agent';

/** 消息发送方式 */
type MessageMode = 'normal' | 'merge';

interface Props {
  onSend: (message: string, attachments?: MessageAttachment[], targetConversationId?: string, replyTo?: Message['replyTo'], opts?: { merged?: boolean }) => void;
  isAiTyping?: boolean;
  debounceEnabled?: boolean;
  debounceMs?: number;
  disabled?: boolean;
  quotedMessage?: Message | null;
  onClearQuote?: () => void;
  editContent?: string | null;
  onClearEdit?: () => void;
  /** 当前对话 ID,用于分别保存每个对话的草稿 */
  conversationId?: string | null;
}

const DRAFT_STORAGE_KEY = 'ai-input-drafts';
const MSG_MODE_STORAGE_KEY = 'ai-message-mode';

function loadMessageMode(): MessageMode {
  try {
    return localStorage.getItem(MSG_MODE_STORAGE_KEY) === 'merge' ? 'merge' : 'normal';
  } catch {
    return 'normal';
  }
}

function loadDrafts(): Record<string, string> {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveDrafts(drafts: Record<string, string>) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch { /* ignore */ }
}

/** 页面加载时清除草稿（实现"刷新失效"） */
export function clearDrafts() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* ignore */ }
}

/* ──────── 斜杠命令弹出菜单 ──────── */

const CATEGORY_LABEL: Record<string, string> = {
  settings: '设置控制', ui: 'UI 控制', navigation: '导航', plugin: '插件管理',
  skill: '技能管理', character: '角色管理', chat: '对话控制',
  memory: '记忆系统', file: '文件操作', system: '系统操作',
};

interface SlashCommandMenuProps {
  input: string;
  onSelect: (cmd: string) => void;
}

/** 枚举值的中文映射 */
const ENUM_LABELS: Record<string, Record<string, string>> = {
  theme: { light: '亮色', dark: '暗色', system: '跟随系统' },
  type: { none: '无', preset: '预设', image: '图片', video: '视频', plugin_code: '插件代码', skill_prompt: '技能提示', character_prompt: '角色提示', system_prompt: '系统提示' },
  style: { rounded: '圆角', sharp: '锐利', minimal: '极简', wechat: '微信', pill: '药丸', glass: '玻璃', bubble: '气泡', gradient: '渐变' },
  size: { small: '小', medium: '中', large: '大' },
  page: { chat: '对话', characters: '角色', history: '历史', emotion: '情感', memory: '记忆', settings: '设置', appearance: '外观', plugins: '插件', skills: '技能', integrations: '集成', files: '文件', 'feature-module': '功能模块', 'api-config': 'API 配置' },
  particleType: { none: '无', snow: '雪', stars: '星', hearts: '心', bubbles: '泡', petals: '花瓣', sparkles: '闪', firefly: '萤火', confetti: '彩纸', rain: '雨', cherry: '樱花', butterfly: '蝴蝶', firework: '烟花' },
  mbtiType: { INTJ: 'INTJ', INTP: 'INTP', ENTJ: 'ENTJ', ENTP: 'ENTP', INFJ: 'INFJ', INFP: 'INFP', ENFJ: 'ENFJ', ENFP: 'ENFP', ISTJ: 'ISTJ', ISFJ: 'ISFJ', ESTJ: 'ESTJ', ESFJ: 'ESFJ', ISTP: 'ISTP', ISFP: 'ISFP', ESTP: 'ESTP', ESFP: 'ESFP' },
};

/** 解析 db: 引用为 data: URL */
function useResolvedUrl(source: string): string {
  const [resolved, setResolved] = useState(source.startsWith('db:') ? '' : source);
  useEffect(() => {
    if (!source || !source.startsWith('db:')) { setResolved(source); return undefined; }
    if (!isRunningInTauri()) { setResolved(''); return undefined; }
    const id = source.slice(3);
    let active = true;
    getFileFromDb(id).then((file) => {
      if (!active || !file) return;
      setResolved(`data:${file.mimeType};base64,${file.data}`);
    }).catch(() => { if (active) setResolved(''); });
    return () => { active = false; };
  }, [source]);
  return resolved;
}

/** 🔧 参数中文映射已抽至 src/agent/slashCommand.ts（A4.1 共用） */

/** 已保存壁纸缩略图（小巧版） */
function SavedWallpaperThumb({ sw, isSelected, onClick }: {
  sw: { id: string; type: string; source: string; name: string };
  isSelected: boolean;
  onClick: () => void;
}) {
  const resolved = useResolvedUrl(sw.source);
  return (
    <button
      onClick={onClick}
      className={`relative rounded-md overflow-hidden transition-all ${
        isSelected ? 'ring-2 ring-slate-700 ring-offset-1 dark:ring-offset-gray-800' : 'hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600'
      }`}
    >
      {resolved ? (
        sw.type === 'image' ? (
          <img src={resolved} alt="" className="w-full h-9 object-cover" />
        ) : (
          <video src={resolved} className="w-full h-9 object-cover" muted />
        )
      ) : (
        <div className="w-full h-9 bg-gray-200 dark:bg-gray-700 animate-pulse" />
      )}
    </button>
  );
}

/**
 * 根据工具 ID 和参数名，从 uiStore 获取当前值
 * 用于在打开命令参数面板时，预选当前已生效的设置
 */
function getToolCurrentParamValue(
  toolId: string,
  paramName: string,
  ui: ReturnType<typeof useUIStore.getState>,
): string | undefined {
  switch (toolId) {
    case 'ui_theme':
      if (paramName === 'theme') return ui.theme;
      break;
    case 'ui_wallpaper':
      if (paramName === 'type') return ui.wallpaper.type;
      if (paramName === 'source') {
        if (ui.wallpaper.type === 'preset') return ui.wallpaper.presetId;
        if (ui.wallpaper.type === 'image') return ui.wallpaper.imageSource;
        if (ui.wallpaper.type === 'video') return ui.wallpaper.videoSource;
        return ui.wallpaper.source;
      }
      break;
    case 'ui_font':
      if (paramName === 'size') return ui.font?.size || ui.fontSize;
      if (paramName === 'family') return ui.font?.family || '';
      break;
    case 'ui_bubble':
      if (paramName === 'style') return ui.bubbleStyle;
      break;
    case 'ui_particle':
      if (paramName === 'type') return ui.particles.type;
      if (paramName === 'count') return String(ui.particles.count);
      break;
    case 'ui_accent':
      if (paramName === 'color') return ui.accentColor;
      break;
    default:
      break;
  }
  return undefined;
}

function SlashCommandMenu({ input, onSelect }: SlashCommandMenuProps) {
  const agentStore = useAgentStore();
  const allTools = agentStore.getAllTools();
  const wallpaper = useUIStore((s) => s.wallpaper);
  const [selectedTool, setSelectedTool] = useState<AgentTool | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const stageTransitionRef = useRef(false);

  // 只在输入以 "/" 开头时显示
  const show = input.startsWith('/');
  const query = input.slice(1).trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!show) return [];
    return allTools.filter((t) => {
      if (!query) return true;
      return (
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query) ||
        t.id.toLowerCase().includes(query)
      );
    });
  }, [show, query, allTools]);

  // 按 category 分组
  const grouped = useMemo(() => {
    const map: Record<string, AgentTool[]> = {};
    for (const tool of filtered) {
      if (!map[tool.category]) map[tool.category] = [];
      map[tool.category].push(tool);
    }
    return map;
  }, [filtered]);

  // 当输入变化且不再匹配当前选中工具时，重置到阶段一（修复二阶段卡住问题）
  useEffect(() => {
    if (stageTransitionRef.current) {
      stageTransitionRef.current = false;
      return; // 刚通过点击进入二阶段，跳过本次检查
    }
    if (selectedTool) {
      const raw = input.startsWith('/') ? input.slice(1).trim() : '';
      const inputCmdName = raw.split(/\s+/)[0].toLowerCase();
      if (!inputCmdName || inputCmdName !== selectedTool.name.toLowerCase()) {
        setSelectedTool(null);
        setParamValues({});
      }
    }
  }, [input, selectedTool]);

  // 处理工具点击 → 进入参数选择阶段
  const handleToolClick = useCallback((tool: AgentTool) => {
    stageTransitionRef.current = true;
    setSelectedTool(tool);
    // 从 uiStore 读取当前设置值，作为参数选择器的初始值
    const currentUI = useUIStore.getState();
    const initialValues: Record<string, string> = {};
    for (const param of tool.parameters) {
      // 优先使用当前 UI 设置值
      const currentVal = getToolCurrentParamValue(tool.id, param.name, currentUI);
      if (currentVal !== undefined) {
        initialValues[param.name] = currentVal;
      } else if (param.default !== undefined) {
        initialValues[param.name] = String(param.default);
      } else if (param.enum && param.enum.length > 0) {
        initialValues[param.name] = param.enum[0] || '';
      } else {
        initialValues[param.name] = '';
      }
    }
    setParamValues(initialValues);
  }, []);

  // 选择参数值后构建命令字符串（key=value 格式）
  const handleParamSelect = useCallback((tool: AgentTool, paramName: string, paramValue: string) => {
    const newValues = { ...paramValues, [paramName]: paramValue };
    setParamValues(newValues);
    // 构建 /命令名 key1=value1 key2=value2 格式
    const parts: string[] = [`/${tool.name}`];
    for (const p of tool.parameters) {
      const val = p.name === paramName ? paramValue : newValues[p.name];
      if (val) parts.push(`${p.name}=${val}`);
    }
    onSelect(parts.join(' '));
  }, [paramValues, onSelect]);

  // 返回命令列表（重选）
  const handleBack = useCallback(() => {
    setSelectedTool(null);
    setParamValues({});
  }, []);

  if (!show) return null;

  // ── 阶段二：参数选择 ──
  if (selectedTool) {
    const tool = selectedTool;
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-gray-100 dark:bg-gray-800 rounded-xl shadow-xl animate-[fadeIn_0.15s_ease-out]">
        <div className="px-3 py-2 flex items-center gap-1.5 sticky top-0 bg-gray-100 dark:bg-gray-800 rounded-t-xl">
          <button onClick={handleBack} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <ChevronLeft size={14} />
          </button>
          <Zap size={12} className="text-slate-700 dark:text-slate-300" />
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{tool.name}</span>
          <span className="text-[10px] text-gray-400 truncate flex-1">{tool.description}</span>
        </div>
        <div className="py-2 px-3 space-y-2">
          {tool.parameters.map((param) => {
            // ── 特殊处理：壁纸源参数，根据 type 显示不同的选择器 ──
            const isWallpaperSource = tool.id === 'ui_wallpaper' && param.name === 'source';
            const wallType = paramValues.type || 'none';

            // 壁纸源 - 预设渐变
            if (isWallpaperSource && wallType === 'preset') {
              return (
                <div key={param.name}>
                  <div className="text-[10px] text-gray-400 mb-1">选择预设</div>
                  <div className="grid grid-cols-6 gap-1">
                    {WALLPAPER_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => handleParamSelect(tool, param.name, preset.id)}
                        className={`relative flex flex-col items-center gap-0.5 p-0.5 rounded-md transition-all ${
                          paramValues[param.name] === preset.id
                            ? 'ring-2 ring-slate-700 ring-offset-1 dark:ring-offset-gray-800'
                            : 'hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-600'
                        }`}
                      >
                        <div
                          className="w-full h-9 rounded shadow-sm"
                          style={{ background: preset.css }}
                        />
                        <span className="text-[8px] text-gray-500 dark:text-gray-400 leading-tight truncate w-full text-center">
                          {preset.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            }

            // 壁纸源 - 图片/视频（从已保存壁纸中选择）
            if (isWallpaperSource && (wallType === 'image' || wallType === 'video')) {
              const savedForType = wallpaper.savedWallpapers.filter((w) => w.type === wallType);
              return (
                <div key={param.name}>
                  <div className="text-[10px] text-gray-400 mb-1">
                    {wallType === 'image' ? '选择图片' : '选择视频'}
                    {savedForType.length === 0 && (
                      <span className="ml-1 text-gray-300 dark:text-gray-600">（暂无已保存的{wallType === 'image' ? '图片' : '视频'}）</span>
                    )}
                  </div>
                  {savedForType.length > 0 ? (
                    <div className="grid grid-cols-6 gap-1">
                      {savedForType.map((sw) => (
                        <SavedWallpaperThumb
                          key={sw.id}
                          sw={sw}
                          isSelected={paramValues[param.name] === sw.source}
                          onClick={() => handleParamSelect(tool, param.name, sw.source)}
                        />
                      ))}
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={paramValues[param.name] || ''}
                      onChange={(e) => {
                        const newValues = { ...paramValues, [param.name]: e.target.value };
                        setParamValues(newValues);
                        const parts: string[] = [`/${tool.name}`];
                        for (const p of tool.parameters) {
                          const val = newValues[p.name];
                          if (val) parts.push(`${p.name}=${val}`);
                        }
                        onSelect(parts.join(' '));
                      }}
                      placeholder={wallType === 'image' ? '图片URL或路径' : '视频URL或路径'}
                      className="w-full text-[11px] px-2 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-slate-500"
                    />
                  )}
                </div>
              );
            }

            // 壁纸源 - 其他情况时隐藏（不显示输入框，由 type 决定）
            if (isWallpaperSource) {
              return null;
            }

            // ── 通用参数渲染 ──
            return (
              <div key={param.name}>
                <div className="text-[10px] text-gray-400 mb-1">
                  {param.description || param.name}
                  {param.required && <span className="text-slate-700 dark:text-slate-300 ml-0.5">*</span>}
                </div>
                {param.enum && param.enum.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {param.enum.map((val) => (
                      <button
                        key={val}
                        onClick={() => handleParamSelect(tool, param.name, val)}
                        className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                          paramValues[param.name] === val
                            ? 'bg-slate-700 text-white'
                            : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-slate-800/30'
                        }`}
                      >
                        {ENUM_LABELS[param.name]?.[val] || val}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={paramValues[param.name] || ''}
                    onChange={(e) => {
                      const newValues = { ...paramValues, [param.name]: e.target.value };
                      setParamValues(newValues);
                      const parts: string[] = [`/${tool.name}`];
                      for (const p of tool.parameters) {
                        const val = newValues[p.name];
                        if (val) parts.push(`${p.name}=${val}`);
                      }
                      onSelect(parts.join(' '));
                    }}
                    placeholder={param.description || `输入 ${param.name}`}
                    className="w-full text-[11px] px-2 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:border-slate-500"
                  />
                )}
              </div>
            );
          })}
          {tool.parameters.length === 0 && (
            <div className="text-[11px] text-gray-400 py-1">此命令无需参数，直接发送即可</div>
          )}
        </div>
      </div>
    );
  }

  // ── 阶段一：命令列表 ──
  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 z-50 max-h-72 overflow-y-auto bg-gray-100 dark:bg-gray-800 rounded-xl shadow-xl animate-[fadeIn_0.15s_ease-out]">
      <div className="px-3 py-2 flex items-center gap-1.5 sticky top-0 bg-gray-100 dark:bg-gray-800 rounded-t-xl">
        <Zap size={12} className="text-slate-700 dark:text-slate-300" />
        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
          Agent 命令 {query && <span className="text-slate-700 dark:text-slate-300">"{query}"</span>}
        </span>
        <span className="ml-auto text-[10px] text-gray-400">{filtered.length} 个匹配</span>
      </div>
      <div className="py-1">
        {Object.entries(grouped).map(([cat, tools]) => (
          <div key={cat}>
            <div className="px-3 py-1 text-[10px] text-gray-400 uppercase tracking-wide">
              {CATEGORY_LABEL[cat] || cat}
            </div>
            {tools.map((tool) => {
              const hasQuickParams = tool.parameters.some((p) => p.required && p.enum && p.enum.length > 0);
              const quickHints = tool.parameters
                .filter((p) => p.required && p.enum)
                .map((p) => p.enum!.map((v) => ENUM_LABELS[p.name]?.[v] || v).join('/'))
                .join(' · ');

              return (
                <button
                  key={tool.id}
                  onClick={() => handleToolClick(tool)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{tool.name}</span>
                      {hasQuickParams && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300">
                          可选
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {hasQuickParams ? quickHints : tool.description}
                    </div>
                  </div>
                  <ChevronRight size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function InputArea({ onSend, isAiTyping = false, debounceEnabled = true, debounceMs = 1500, disabled = false, quotedMessage, onClearQuote, editContent, onClearEdit, conversationId }: Props) {
  // 草稿持久化:按 conversationId 单独保存每个对话的输入草稿
  const [input, setInput] = useState<string>(() => {
    if (conversationId) {
      const drafts = loadDrafts();
      return drafts[conversationId] || '';
    }
    return '';
  });
  const [pendingMessages, setPendingMessages] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);
  // 🆕 消息发送方式：普通（Enter 发送）/ 合并（Enter 换行，多条内容合并进一条气泡）
  const [messageMode, setMessageMode] = useState<MessageMode>(loadMessageMode);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<string[]>([]);
  const onSendRef = useRef(onSend);
  const attachmentsRef = useRef(attachments);
  const sendingRef = useRef(false);
  const inputFocusedRef = useRef(false);
  const processQueueRef = useRef<Promise<void> | null>(null);
  const processedPathsRef = useRef<Set<string>>(new Set());
  // Track last drop signature to dedup Tauri's multi-fire bug
  const lastDropSigRef = useRef<{ sig: string; ts: number } | null>(null);
  const quotedMessageRef = useRef(quotedMessage);
  // ✅ V7: 用户开始输入的时间戳（用于失焦时计算"等待输入时间"作为用户延迟）
  const inputStartTimeRef = useRef<number>(0);
  // 草稿保存节流
  const draftSaveTimerRef = useRef<number | null>(null);

  onSendRef.current = onSend;
  attachmentsRef.current = attachments;
  quotedMessageRef.current = quotedMessage;

  // 切换对话时重新加载草稿
  useEffect(() => {
    if (!conversationId) {
      setInput('');
      return;
    }
    const drafts = loadDrafts();
    setInput(drafts[conversationId] || '');
    setAttachments([]);
    setImagePreviews({});
  }, [conversationId]);

  // 输入变化时自动保存草稿(防抖 500ms)
  useEffect(() => {
    if (!conversationId) return undefined;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      const drafts = loadDrafts();
      if (input.trim()) {
        drafts[conversationId] = input;
      } else {
        delete drafts[conversationId];
      }
      saveDrafts(drafts);
    }, 500);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [input, conversationId]);

  useEffect(() => {
    pendingRef.current = pendingMessages;
  }, [pendingMessages]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // When editContent is set (from recalled message), put it in the input
  useEffect(() => {
    if (editContent) {
      setInput(editContent);
      onClearEdit?.();
      textareaRef.current?.focus();
    }
  }, [editContent, onClearEdit]);

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  // 清除当前对话的草稿
  const clearCurrentDraft = () => {
    if (!conversationId) return;
    const drafts = loadDrafts();
    delete drafts[conversationId];
    saveDrafts(drafts);
  };

  // 直接执行斜杠命令工具（不经过 AI）—— 🔧 A4.1 核心逻辑抽至 src/agent/slashCommand.ts 共用
  const handleSlashCommand = useCallback(async (inputText: string) => {
    // 先将命令文本作为用户消息显示在聊天中
    await addUserMessageToChat(inputText);
    await executeSlashCommand(inputText, { say: addSystemMessageToChat });
  }, []);

  // 向聊天窗口添加 AI 消息
  const addSystemMessageToChat = useCallback(async (content: string) => {
    const chatStore = (await import('../../store/chatStore')).useChatStore.getState();
    const { currentConversationId } = chatStore;
    if (!currentConversationId) return;
    const aiMsg: Message = {
      id: generateId(),
      content,
      sender: 'ai',
      timestamp: new Date(),
    };
    (await import('../../store/chatStore')).useChatStore.setState((state: any) => ({
      conversations: state.conversations.map((c: any) =>
        c.id === currentConversationId
          ? { ...c, messages: [...c.messages, aiMsg], updatedAt: new Date() }
          : c
      ),
    }));
  }, []);

  // 向当前对话添加用户消息
  const addUserMessageToChat = useCallback(async (content: string) => {
    const chatStore = (await import('../../store/chatStore')).useChatStore.getState();
    const { currentConversationId } = chatStore;
    if (!currentConversationId) return;
    const userMsg: Message = {
      id: generateId(),
      content,
      sender: 'user',
      timestamp: new Date(),
    };
    (await import('../../store/chatStore')).useChatStore.setState((state: any) => ({
      conversations: state.conversations.map((c: any) =>
        c.id === currentConversationId
          ? { ...c, messages: [...c.messages, userMsg], updatedAt: new Date() }
          : c
      ),
    }));
  }, []);

  const doSend = useCallback(async (msgs: string[], att?: MessageAttachment[], replyTo?: Message['replyTo']) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    clearTimer();

    const validMsgs = msgs.filter(m => m.trim());
    const hasContent = validMsgs.length > 0 || (att && att.length > 0);

    // 检测斜杠命令 /工具名
    if (validMsgs.length === 1 && validMsgs[0].startsWith('/') && !validMsgs[0].startsWith('/➕')) {
      const inputText = validMsgs[0];
      setInput('');
      setAttachments([]);
      setImagePreviews({});
      setPendingMessages([]);
      clearCurrentDraft();
      sendingRef.current = false;
      await handleSlashCommand(inputText);
      return;
    }

    if (hasContent) {
      const { addUserMessageOnly, processQueuedUserMessages } = await import('../../store/chatStore').then(m => m.useChatStore.getState());

      // Clear input state immediately so UI is responsive
      setInput('');
      setAttachments([]);
      setImagePreviews({});
      clearCurrentDraft();
      processedPathsRef.current = new Set();
      onClearQuote?.();

      // Release sendingRef now — the rest is async background work
      sendingRef.current = false;

      // Send messages one by one, removing from pending as each is sent
      for (let i = 0; i < validMsgs.length; i++) {
        // Remove this message from pending (one by one disappearance)
        setPendingMessages(prev => prev.filter((_, idx) => idx !== 0));
        // First message: no delay; 2nd+: applyDelay=true（用户段间延迟由 addUserMessageOnly 应用 userReplyDelayMs）
        await addUserMessageOnly(validMsgs[i], i === 0 ? att : undefined, i > 0, i === 0 ? replyTo : undefined);
      }

      // All messages shown — now trigger AI
      await new Promise(r => setTimeout(r, 200));
      processQueuedUserMessages();
    } else {
      setAttachments([]);
      setImagePreviews({});
      processedPathsRef.current = new Set();
      setPendingMessages([]);
      sendingRef.current = false;
    }
  }, [onClearQuote]);

  const flushPending = useCallback(() => {
    const msgs = pendingRef.current;
    const att = attachmentsRef.current;
    if (msgs.length > 0) {
      const replyTo = quotedMessageRef.current ? {
        messageId: quotedMessageRef.current.id,
        content: quotedMessageRef.current.content,
        sender: quotedMessageRef.current.sender,
      } : undefined;
      doSend(msgs, att, replyTo);
    }
  }, [doSend]);

  const handleSend = useCallback(() => {
    const curInput = input.trim();
    const curAttachments = attachmentsRef.current;
    const hasContent = curInput || curAttachments.length > 0;
    if (!hasContent) return;

    console.log('[InputArea] handleSend debounceEnabled=', debounceEnabled, 'debounceMs=', debounceMs);

    const finalAttachments = curAttachments;

    if (!debounceEnabled) {
      if (sendingRef.current) return;
      sendingRef.current = true;
      setTimeout(() => { sendingRef.current = false; }, 500);
      const replyTo = quotedMessageRef.current ? {
        messageId: quotedMessageRef.current.id,
        content: quotedMessageRef.current.content,
        sender: quotedMessageRef.current.sender,
      } : undefined;
      onSendRef.current(curInput, finalAttachments.length > 0 ? finalAttachments : undefined, undefined, replyTo);
      setInput('');
      setAttachments([]);
      setImagePreviews({});
      processedPathsRef.current = new Set();
      clearCurrentDraft();
      onClearQuote?.();
      return;
    }

    // Debounce mode: add text to pending, always include attachments
    if (curInput) {
      console.log('[InputArea] debounce mode: adding to pending, current pending=', pendingRef.current.length);
      const newPending = [...pendingRef.current, curInput];
      setPendingMessages(newPending);
      clearTimer();
      // Timer: flush only when user leaves textarea (cursor not blinking)
      // Re-arms if user is still focused when timer fires
      const startTimer = () => {
        timerRef.current = window.setTimeout(() => {
          if (!inputFocusedRef.current) {
            // 读取最新 pending 而非闭包快照，避免发送过期消息
            doSend(pendingRef.current, attachmentsRef.current);
          } else {
            // User still focused — re-arm timer as safety net
            startTimer();
          }
        }, debounceMs);
      };
      startTimer();
    } else if (finalAttachments.length > 0) {
      // Only attachments, no text — send immediately
      if (sendingRef.current) return;
      sendingRef.current = true;
      setTimeout(() => { sendingRef.current = false; }, 500);
      onSendRef.current('', finalAttachments);
      setAttachments([]);
      setImagePreviews({});
      processedPathsRef.current = new Set();
    }
    setInput('');
    clearCurrentDraft();
    // Auto-resize back to single line
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, debounceEnabled, debounceMs, doSend]);

  const cancelPending = useCallback(() => {
    clearTimer();
    setPendingMessages([]);
  }, []);

  const handlePickFiles = async () => {
    const files = await pickFiles(['image/*', 'video/*', 'audio/*', 'application/pdf', 'text/*']);
    processFiles(files);
  };

  const processFiles = async (files: PickedFile[], rawFiles?: File[]) => {
    // Cooperative single-flight guard: a second call queues behind the
    // first one. We no longer DROP the second call, because Tauri can
    // legitimately emit several drop events in quick succession when the
    // user drags multiple separate batches.
    if (processQueueRef.current) {
      processQueueRef.current = processQueueRef.current.then(() => processFiles(files, rawFiles));
      return;
    }

    const task = (async () => {
      const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'avif'];

      const detectType = (mimeType: string, name: string): 'image' | 'video' | 'audio' | 'file' => {
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        const ext = name.split('.').pop()?.toLowerCase() || '';
        if (IMAGE_EXTS.includes(ext)) return 'image';
        if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        if (['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma'].includes(ext)) return 'audio';
        return 'file';
      };

      // Build a stable dedup key per file: path + size + lastModified (if known).
      // This catches the case where the OS gives us the same path twice, but
      // also keeps legitimate "same name, different file" imports working.
      const dedupKey = (f: PickedFile) => `${f.path}::${f.size}`;

      // Hard-cap the dedup set so memory doesn't grow unbounded across
      // a long session. 200 entries is far more than any realistic single
      // session needs. The set is also cleared whenever the user sends or
      // cancels (see handleSend and clearAttachment callsites).
      if (processedPathsRef.current.size > 200) {
        processedPathsRef.current = new Set();
      }

      const dedupedFiles = files.filter(f => {
        const key = dedupKey(f);
        if (processedPathsRef.current.has(key)) {
          console.log('[InputArea] Skipping duplicate file:', key);
          return false;
        }
        processedPathsRef.current.add(key);
        return true;
      });

      if (dedupedFiles.length === 0) return;

      const newAttachments: MessageAttachment[] = [];

      // Step 1: Build previews + attachment records synchronously so the UI
      // updates immediately, and kick off DB saves with bounded concurrency.
      const dbTasks: Array<{ attId: string; promise: Promise<string | null>; f: PickedFile }> = [];

      for (let i = 0; i < dedupedFiles.length; i++) {
        const f = dedupedFiles[i];
        if (!f.mimeType || f.mimeType === 'application/octet-stream') {
          f.mimeType = inferMimeType(f.name, f.mimeType);
        }
        const attId = generateId();
        const type = detectType(f.mimeType, f.name);

        // Preview
        let previewUrl = '';
        if (type === 'image') {
          if (rawFiles && rawFiles[i]) {
            previewUrl = URL.createObjectURL(rawFiles[i]);
          } else if (isRunningInTauri() && f.path) {
            try {
              const b64 = await readFileAsBase64(f.path);
              if (b64) previewUrl = `data:${f.mimeType || 'image/png'};base64,${b64}`;
            } catch { /* ignore */ }
          }
          if (previewUrl) {
            setImagePreviews(prev => ({ ...prev, [attId]: previewUrl }));
          }
        }

        newAttachments.push({
          id: attId,
          type,
          name: f.name,
          path: previewUrl || f.path,
          size: f.size,
          mimeType: f.mimeType,
        });

        // Schedule DB save (limited concurrency below)
        if (isRunningInTauri()) {
          if (rawFiles && rawFiles[i]) {
            const rf = rawFiles[i];
            const data = new Uint8Array(await rf.arrayBuffer());
            const p = saveFileToDb(attId, f.name, f.mimeType || 'application/octet-stream', data);
            dbTasks.push({ attId, promise: p, f });
          } else if (f.path) {
            const doSave = async (): Promise<string | null> => {
              try {
                const b64 = await readFileAsBase64(f.path);
                if (b64) {
                  const binary = atob(b64);
                  const data = new Uint8Array(binary.length);
                  for (let j = 0; j < binary.length; j++) data[j] = binary.charCodeAt(j);
                  return await saveFileToDb(attId, f.name, f.mimeType || 'application/octet-stream', data);
                }
              } catch { /* ignore */ }
              return null;
            };
            dbTasks.push({ attId, promise: doSave(), f });
          }
        }
      }

      setAttachments(prev => [...prev, ...newAttachments]);

      // Step 2: Bounded-concurrency DB writer pool. Running 6+ base64
      // encodes at once saturates the bridge and stalls the UI; 2 is a
      // good balance for typical 2–10 file drops.
      const CONCURRENCY = 2;
      const runPool = async () => {
        let cursor = 0;
        const workers: Promise<void>[] = [];
        const tick = async () => {
          while (cursor < dbTasks.length) {
            const idx = cursor++;
            const task = dbTasks[idx];
            const saved = await task.promise.catch(() => null);
            if (saved) {
              attachmentsRef.current = attachmentsRef.current.map(a =>
                a.id === task.attId ? { ...a, path: `db:${task.attId}`, fileId: task.attId } : a
              );
              setAttachments(prev => prev.map(a =>
                a.id === task.attId ? { ...a, path: `db:${task.attId}`, fileId: task.attId } : a
              ));
              if (task.f.mimeType.startsWith('image/')) {
                getFileDataOnly(task.attId).then(b64 => {
                  if (b64) {
                    setImagePreviews(prev => ({ ...prev, [task.attId]: `data:${task.f.mimeType || 'image/png'};base64,${b64}` }));
                  }
                }).catch(() => {});
              }
            }
          }
        };
        for (let w = 0; w < CONCURRENCY; w++) workers.push(tick());
        await Promise.allSettled(workers);
      };
      await runPool();
    })();

    // Queue subsequent calls behind this one
    processQueueRef.current = task.finally(() => {
      if (processQueueRef.current === task) processQueueRef.current = null;
    });
    await processQueueRef.current;
  };

  // Tauri native drag-drop listener
  useEffect(() => {
    if (!isRunningInTauri()) return undefined;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const setupDragDrop = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        // Tauri 2.x: onDragDropEvent provides enter/over/drop/leave.
        // IMPORTANT: Tauri can fire multiple "drop" events for a single
        // physical drag-drop gesture in some webview versions, and React
        // StrictMode mounts effects twice in dev. We must:
        //   1) dedup the (paths) signature with a short cooldown
        //   2) keep unlisten strictly scoped to this effect lifetime
        unlisten = await win.onDragDropEvent((event) => {
          if (cancelled) return;
          const payload = event.payload as unknown as { type: string; paths?: string[] };
          if (payload.type === 'enter' || payload.type === 'over') {
            setIsDragging(true);
            return;
          }
          if (payload.type === 'leave') {
            setIsDragging(false);
            return;
          }
          if (payload.type !== 'drop') return;

          const paths: string[] = Array.isArray(payload.paths) ? payload.paths : [];
          if (paths.length === 0) return;
          setIsDragging(false);

          // Signature-based dedup: same set of paths dropped within a short
          // window (350ms) is treated as a duplicate emission. This handles
          // the multi-fire bug without blocking legitimate back-to-back drops.
          const sig = paths.slice().sort().join('|');
          const now = Date.now();
          const last = lastDropSigRef.current;
          if (last && last.sig === sig && now - last.ts < 350) {
            console.log('[DragDrop] Ignored duplicate drop within 350ms');
            return;
          }
          lastDropSigRef.current = { sig, ts: now };

          const files: PickedFile[] = paths.map((p) => {
            const name = p.split(/[/\\]/).pop() || p;
            return {
              name,
              path: p,
              size: 0,
              mimeType: inferMimeType(name),
            };
          });
          processFiles(files);
        });
      } catch (e) {
        console.warn('[InputArea] Tauri drag-drop listener failed:', e);
      }
    };

    setupDragDrop();
    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = undefined;
    };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    // In Tauri, onDragDropEvent already handles file processing
    if (isRunningInTauri()) return;
    const rawFiles = Array.from(e.dataTransfer.files);
    const files = rawFiles.map(f => ({
      name: f.name,
      path: (f as unknown as { path?: string }).path || f.name,
      size: f.size,
      mimeType: f.type || 'application/octet-stream',
    }));
    if (files.length > 0) {
      processFiles(files, rawFiles);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    // ✅ V7: 记录用户开始输入的时间，失焦（点击空白处）时据此计算"等待输入时间"作为用户延迟
    if (inputStartTimeRef.current === 0) {
      inputStartTimeRef.current = Date.now();
    }
    setInput(value);

    // Auto-resize textarea
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  };

  /** 🆕 切换消息发送方式（普通 / 合并） */
  const toggleMessageMode = useCallback(() => {
    setMessageMode((prev) => {
      const next: MessageMode = prev === 'normal' ? 'merge' : 'normal';
      try { localStorage.setItem(MSG_MODE_STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /** 🆕 终止 AI 回复（等待状态下随时可点） */
  const handleStopGeneration = useCallback(() => {
    useChatStore.getState().cancelGeneration();
  }, []);

  /** 🆕 合并发送：把待发送队列 + 当前输入合并成一条消息（一条气泡内多段） */
  const handleMergeSend = useCallback(() => {
    if (sendingRef.current) return;
    const curInput = input.trim();
    const curAttachments = attachmentsRef.current;
    const pending = pendingRef.current;
    const allParts = [...pending, ...(curInput ? [curInput] : [])];
    if (allParts.length === 0 && curAttachments.length === 0) return;

    sendingRef.current = true;
    setTimeout(() => { sendingRef.current = false; }, 500);

    const replyTo = quotedMessageRef.current ? {
      messageId: quotedMessageRef.current.id,
      content: quotedMessageRef.current.content,
      sender: quotedMessageRef.current.sender,
    } : undefined;

    clearTimer();
    setPendingMessages([]);
    setInput('');
    setAttachments([]);
    setImagePreviews({});
    processedPathsRef.current = new Set();
    clearCurrentDraft();
    onClearQuote?.();

    onSendRef.current(allParts.join('\n'), curAttachments.length > 0 ? curAttachments : undefined, undefined, replyTo, { merged: true });

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, onClearQuote]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 🆕 合并模式：Enter 换行输入；Ctrl/Cmd + Enter 发送
    if (messageMode === 'merge') {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleMergeSend();
      }
      return; // 其余按键保持默认（Enter 插入换行）
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleButtonClick = useCallback(() => {
    // 🆕 等待状态：按钮即"终止"，随时点击停止 AI 回复
    if (isAiTyping) {
      handleStopGeneration();
      return;
    }
    // 🆕 合并模式：待发送队列 + 当前输入合并成一条消息
    if (messageMode === 'merge') {
      handleMergeSend();
      return;
    }
    if (debounceEnabled) {
      // Flush pending + send current input immediately
      const curInput = input.trim();
      const curAttachments = attachmentsRef.current;
      const pending = pendingRef.current;
      const allMsgs = curInput ? [...pending, curInput] : [...pending];
      const replyTo = quotedMessageRef.current ? {
        messageId: quotedMessageRef.current.id,
        content: quotedMessageRef.current.content,
        sender: quotedMessageRef.current.sender,
      } : undefined;
      if (allMsgs.length > 0) {
        clearTimer();
        doSend(allMsgs, curAttachments.length > 0 ? curAttachments : undefined, replyTo);
      }
    } else {
      handleSend();
    }
  }, [isAiTyping, messageMode, debounceEnabled, input, doSend, handleSend, handleStopGeneration, handleMergeSend]);

  return (
    <div className="relative px-4 pb-4 pt-2">
      {/* Pending messages indicator */}
      {pendingMessages.length > 0 && (
        <div className="mb-2 px-3 py-2.5 bg-slate-100 dark:bg-slate-900/40 rounded-xl text-xs animate-[fadeIn_0.2s_ease-out]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-700 dark:text-slate-500 font-medium">
              待发送 {pendingMessages.length} 条消息
            </span>
            <button onClick={cancelPending} className="text-gray-400 hover:text-red-500 transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="space-y-0.5 max-h-16 overflow-y-auto">
            {pendingMessages.map((msg, i) => (
              <p key={i} className="text-gray-500 dark:text-gray-400 truncate">{msg}</p>
            ))}
          </div>
          <button
            onClick={cancelPending}
            className="mt-1.5 text-[11px] text-gray-400 hover:text-slate-700 dark:text-slate-300 transition-colors"
          >
            &gt; 不需要回复
          </button>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="mb-2 px-3 py-2 bg-slate-100 dark:bg-slate-900/40 rounded-xl text-xs animate-[fadeIn_0.2s_ease-out]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-slate-700 dark:text-slate-500 font-medium">
              {attachments.length} 个附件
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {attachments.map((a) => (
              <div key={a.id} className="relative group">
                {a.type === 'image' && imagePreviews[a.id] ? (
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                    <img src={imagePreviews[a.id]} alt={a.name} className="w-full h-full object-cover" />
                    <button
                      onClick={() => {
                        setAttachments(prev => prev.filter(p => p.id !== a.id));
                        setImagePreviews(prev => { const n = { ...prev }; delete n[a.id]; return n; });
                      }}
                      className="absolute top-0.5 right-0.5 p-0.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 px-2 py-1 bg-white dark:bg-gray-800 rounded-lg">
                    {a.type === 'image' ? <ImageIcon size={10} /> : a.type === 'audio' ? <Music size={10} className="text-green-500" /> : a.type === 'video' ? <Video size={10} className="text-blue-500" /> : <Paperclip size={10} />}
                    <span className="text-gray-600 dark:text-gray-400 truncate max-w-[100px]">{a.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter(p => p.id !== a.id))} className="text-gray-400 hover:text-red-500">
                      <X size={10} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quote preview */}
      {quotedMessage && (
        <div className="mb-2 px-3 py-2 bg-slate-100 dark:bg-slate-900/40 rounded-xl text-xs animate-[fadeIn_0.2s_ease-out]">
          <div className="flex items-center justify-between mb-1">
            <span className="flex items-center gap-1 text-slate-700 dark:text-slate-500 font-medium">
              <Quote size={12} />
              引用 {quotedMessage.sender === 'user' ? '你' : 'AI'}
            </span>
            <button onClick={onClearQuote} className="text-gray-400 hover:text-red-500 transition-colors">
              <X size={14} />
            </button>
          </div>
          <p className="text-gray-500 dark:text-gray-400 truncate">{quotedMessage.content || '(无内容)'}</p>
        </div>
      )}

      {/* Agent 斜杠命令弹出菜单 — 输入 / 向上弹出 */}
      <SlashCommandMenu
        input={input}
        onSelect={(cmd) => setInput(cmd)}
      />

      {/* 🆕 消息方式切换：普通 / 合并 */}
      <div className="flex items-center gap-1.5 mb-2">
        <button
          onClick={() => { if (messageMode !== 'normal') toggleMessageMode(); }}
          className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-colors ${
            messageMode === 'normal'
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400 font-medium'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-500'
          }`}
          title="普通模式：Enter 发送，Shift+Enter 换行"
        >
          <MessageCircle size={12} />
          普通
        </button>
        <button
          onClick={() => { if (messageMode !== 'merge') toggleMessageMode(); }}
          className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-colors ${
            messageMode === 'merge'
              ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400 font-medium'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-500'
          }`}
          title="合并模式：Enter 换行，多条内容合并进同一条气泡发送"
        >
          <MessagesSquare size={12} />
          合并
        </button>
        {messageMode === 'merge' && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Enter 换行 · Ctrl+Enter 发送（多条内容合并在一条气泡内）</span>
        )}
      </div>

      {/* Input area */}
      <div
        className={`flex items-end gap-2 rounded-2xl px-3 py-2 shadow-sm transition-colors ${
          isAiTyping && !disabled
            ? 'bg-slate-100 dark:bg-slate-800/20 ring-1 ring-slate-400/60 dark:ring-slate-800/60'
            : disabled
              ? 'bg-gray-50 dark:bg-gray-900 opacity-50'
              : isDragging
                ? 'bg-slate-200 dark:bg-slate-800/30 ring-2 ring-slate-500 dark:ring-slate-700'
                : 'bg-gray-100 dark:bg-gray-800'
        }`}
        onDragOver={disabled ? undefined : handleDragOver}
        onDragLeave={disabled ? undefined : handleDragLeave}
        onDrop={disabled ? undefined : handleDrop}
      >
        <button
          onClick={handlePickFiles}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
          title="添加附件"
        >
          <Paperclip size={18} />
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          onFocus={() => {
            inputFocusedRef.current = true;
            // User came back to input — cancel pending flush, they're still active
            if (debounceEnabled && pendingRef.current.length > 0) {
              clearTimer();
            }
          }}
          onBlur={() => {
            inputFocusedRef.current = false;
            // ✅ V7: 点击输入框外部（失焦）→ 触发发送，同时记录"等待输入时间"作为用户延迟。
            // 等待输入时间 = 用户从开始输入到点击空白处失焦之间的时长。
            if (debounceEnabled && pendingRef.current.length > 0) {
              if (inputStartTimeRef.current > 0) {
                const waitMs = Date.now() - inputStartTimeRef.current;
                useChatStore.getState().setUserWaitMs(waitMs);
              }
              inputStartTimeRef.current = 0;
              clearTimer();
              flushPending();
            }
          }}
          placeholder={
            disabled
              ? '输入消息...'
              : isAiTyping
                ? 'AI 回复中…可继续输入，发送后将排队处理'
                : messageMode === 'merge'
                  ? '输入消息…（Enter 换行）'
                  : '输入消息...'
          }
          rows={1}
          className="flex-1 px-2 py-1.5 bg-transparent border-0 text-sm resize-none focus:outline-none placeholder-gray-400 dark:text-gray-100 leading-relaxed"
          style={{ maxHeight: 120 }}
        />
        <button
          onClick={handleButtonClick}
          disabled={isAiTyping ? false : disabled || (!input.trim() && attachments.length === 0 && pendingMessages.length === 0)}
          title={isAiTyping ? '终止 AI 回复' : '发送'}
          className={`p-2 rounded-xl transition-all flex-shrink-0 ${
            isAiTyping
              ? 'bg-red-500 text-white shadow-md hover:bg-red-600 active:scale-95 animate-pulse'
              : !disabled && (input.trim() || attachments.length > 0 || pendingMessages.length > 0)
                ? 'bg-[var(--accent-color)] text-white shadow-md hover:brightness-110 active:scale-95'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
          }`}
        >
          {isAiTyping ? <Square size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
