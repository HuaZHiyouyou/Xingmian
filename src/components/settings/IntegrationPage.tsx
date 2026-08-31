
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Wifi, WifiOff, Trash2, Plus, ChevronDown,
  MessageSquare, Bot, Check, Loader2, Zap, Globe, CircleDot,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { useIntegrationStore } from '../../store/integrationStore';
import { useCharacterStore } from '../../store/characterStore';
import { BotIntegrationConfig, generateQrcode } from '../../lib/tauriBridge';
import { Character } from '../../types';

/** 公共默认项：自动回复/白黑名单等所有类型共用 */
function defaultCommon(): Pick<BotIntegrationConfig,
  'auto_reply' | 'character_id' | 'private_chat_enabled' | 'group_chat_enabled' |
  'allowed_users_enabled' | 'allowed_users' | 'allowed_groups_enabled' | 'allowed_groups' |
  'blocked_users_enabled' | 'blocked_users' | 'blocked_groups_enabled' | 'blocked_groups'> {
  return {
    auto_reply: true,
    character_id: '',
    private_chat_enabled: true,
    group_chat_enabled: true,
    allowed_users_enabled: false,
    allowed_users: '',
    allowed_groups_enabled: false,
    allowed_groups: '',
    blocked_users_enabled: false,
    blocked_users: '',
    blocked_groups_enabled: false,
    blocked_groups: '',
  };
}

const DEFAULT_NAPCAT_CONFIG: BotIntegrationConfig = {
  ws_url: 'ws://127.0.0.1:3001',
  ws_mode: 'server',
  http_url: '',
  token: '',
  ...defaultCommon(),
};

/** 🆕 QQ 开放平台官方机器人默认配置 */
const DEFAULT_QQ_OFFICIAL_CONFIG: BotIntegrationConfig = {
  ...defaultCommon(),
  ws_url: '',
  http_url: '',
  token: '',
  app_id: '',
  client_secret: '',
};

/** 🆕 微信 ClawBot（iLink 扫码授权）默认配置：无需手填，启用后扫码登录 */
const DEFAULT_CLAWBOT_CONFIG: BotIntegrationConfig = {
  ...defaultCommon(),
  ws_url: '',
  http_url: '',
  token: '',
};

/** 🆕 QClaw（QQ 龙虾机器人）：与 QQ 官方机器人同一协议（AppID + AppSecret + WSS） */
const DEFAULT_QCLAW_CONFIG: BotIntegrationConfig = {
  ...DEFAULT_QQ_OFFICIAL_CONFIG,
};

/** 🆕 QQ Bot（龙虾插件 openclaw-qqbot）：协议同 QQ 官方机器人，支持扫码绑定引导 */
const DEFAULT_QQBOT_CONFIG: BotIntegrationConfig = {
  ...DEFAULT_QQ_OFFICIAL_CONFIG,
};

const DEFAULT_CONFIG_BY_TYPE: Record<string, BotIntegrationConfig> = {
  napcat: DEFAULT_NAPCAT_CONFIG,
  qq_official: DEFAULT_QQ_OFFICIAL_CONFIG,
  qclaw: DEFAULT_QCLAW_CONFIG,
  qqbot: DEFAULT_QQBOT_CONFIG,
  clawbot: DEFAULT_CLAWBOT_CONFIG,
};

function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  // 内容高度实时跟踪：二维码等异步内容出现/变化时自动扩展，避免 maxHeight 截断
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setHeight(el.scrollHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className="overflow-hidden transition-all duration-300 ease-in-out"
      style={{ maxHeight: open ? height : 0, opacity: open ? 1 : 0 }}
    >
      <div ref={ref}>{children}</div>
    </div>
  );
}

/** 平滑展开容器：grid-rows 0fr→1fr + 透明度过渡（与设置页其他折叠动画一致） */
function SmoothReveal({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid transition-all duration-300 ease-in-out"
      style={{ gridTemplateRows: show ? '1fr' : '0fr', opacity: show ? 1 : 0 }}
    >
      <div className="overflow-hidden min-h-0">{children}</div>
    </div>
  );
}

/** 二维码图源兜底：兼容完整 data URL / http 链接 / 纯 base64 */
function qrImageSrc(raw: string): string {
  const clean = raw.replace(/\s/g, '');
  if (clean.startsWith('data:') || clean.startsWith('http')) return clean;
  return `data:image/png;base64,${clean}`;
}

/** 二维码图片：加载失败时给出重试提示 */
function QrImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (failed) {
    return (
      <div className="w-48 h-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white flex items-center justify-center text-xs text-gray-400 px-3 text-center">
        二维码加载失败，请关闭开关后重新开启重试
      </div>
    );
  }
  return (
    <img
      src={qrImageSrc(src)}
      alt="微信登录二维码"
      onError={() => setFailed(true)}
      className="w-48 h-48 rounded-lg border border-gray-200 dark:border-gray-700 bg-white p-1"
    />
  );
}

function CharacterSelect({
  value,
  onChange,
  characters,
}: {
  value: string;
  onChange: (id: string) => void;
  characters: Character[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999, width: 260 });
  const selected = characters.find((c) => c.id === value);

  // 点击外部收起：必须同时排除触发器容器与 portal 弹层，否则选项点击会被误判为"外部"导致选不上
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = () => {
    if (!open && ref.current) {
      const btn = ref.current.querySelector('button');
      const r = (btn ?? ref.current).getBoundingClientRect();
      const H = 192;
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
        top: r.bottom + 4 + H > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4,
        width: Math.max(200, r.width),
      });
    }
    setOpen(!open);
  };

  const dropdown = open ? createPortal(
    <>
      <div className="fixed inset-0 z-[98]" onClick={() => setOpen(false)} />
      <div
        ref={panelRef}
        className="fixed bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg animate-[dropdownIn_0.15s_ease-out] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: 99,
          maxHeight: 192,
          overflowY: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
      <div className="p-1">
        {characters.length === 0 ? (
          <div className="px-3 py-4 text-center text-sm text-gray-400">暂无角色</div>
        ) : (
          characters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange(c.id); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 cursor-pointer ${
                c.id === value
                  ? 'bg-slate-100 dark:bg-slate-800/20 text-slate-700 dark:text-slate-500'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200'
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                c.id === value
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-200 dark:bg-slate-900/50 text-slate-700 dark:text-slate-400'
              }`}>
                {c.name.charAt(0)}
              </div>
              <span className="text-sm truncate flex-1">{c.name}</span>
              {c.id === value && <Check size={14} className="text-slate-700 dark:text-slate-300 shrink-0" />}
            </button>
          ))
        )}
      </div>
      </div>
    </>,
    document.body,
  ) : null;

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 text-left active:scale-[0.98]"
      >
        {selected ? (
          <>
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {selected.name.charAt(0)}
            </div>
            <span className="text-sm text-gray-900 dark:text-gray-100 truncate">{selected.name}</span>
          </>
        ) : (
          <span className="text-sm text-gray-400">选择角色...</span>
        )}
        <ChevronDown
          size={14}
          className={`ml-auto text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {dropdown}
    </div>
  );
}

function ConfigInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  optional?: boolean;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {label}
        {optional && <span className="ml-1 text-gray-300 dark:text-gray-600 normal-case">(可选)</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-slate-700 transition-all duration-150"
      />
    </div>
  );
}

export function IntegrationPage() {
  const navigate = useNavigate();
  const characters = useCharacterStore((s) => s.characters);
  const integrations = useIntegrationStore((s) => s.integrations);
  const conversations = useIntegrationStore((s) => s.conversations);
  const isLoaded = useIntegrationStore((s) => s.isLoaded);
  const loadIntegrations = useIntegrationStore((s) => s.loadIntegrations);
  const loadConversations = useIntegrationStore((s) => s.loadConversations);
  const logBot = useIntegrationStore((s) => s.logBot);
  const addIntegration = useIntegrationStore((s) => s.addIntegration);
  const updateIntegration = useIntegrationStore((s) => s.updateIntegration);
  const removeIntegration = useIntegrationStore((s) => s.removeIntegration);
  const toggleIntegration = useIntegrationStore((s) => s.toggleIntegration);
  const testConnection = useIntegrationStore((s) => s.testConnection);
  const updateConversationCharacter = useIntegrationStore((s) => s.updateConversationCharacter);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addType, setAddType] = useState<'napcat' | 'qq_official' | 'qclaw' | 'qqbot' | 'clawbot'>('napcat');
  const [addConfig, setAddConfig] = useState<BotIntegrationConfig>(DEFAULT_NAPCAT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  /** QClaw / QQ Bot 扫码绑定入口二维码（integrationId → SVG data URL） */
  const [bindQr, setBindQr] = useState<Record<string, string>>({});

  const [editingConfigs, setEditingConfigs] = useState<Record<string, BotIntegrationConfig>>({});
  const [botStatuses, setBotStatuses] = useState<Record<string, { status: string; message: string }>>({});
  /** ClawBot 扫码登录：二维码图片（data URL）与扫码阶段 */
  const [clawbotQr, setClawbotQr] = useState<Record<string, string>>({});
  const [clawbotLoginStage, setClawbotLoginStage] = useState<Record<string, string>>({});

  useEffect(() => {
    loadIntegrations();
    loadConversations();
  }, [loadIntegrations, loadConversations]);

  useEffect(() => {
    const unlisten = listen<string>('bot-status', (event) => {
      try {
        const data = JSON.parse(event.payload) as { integrationId: string; status: string; message: string };
        setBotStatuses((prev) => ({ ...prev, [data.integrationId]: { status: data.status, message: data.message } }));
      } catch { /* ignore */ }
    });
    // ClawBot 扫码登录事件：二维码 / 扫码阶段
    const unlistenQr = listen<string>('clawbot-qrcode', (event) => {
      try {
        const data = JSON.parse(event.payload) as { integrationId: string; qrcodeImg: string };
        setClawbotQr((prev) => ({ ...prev, [data.integrationId]: data.qrcodeImg }));
      } catch { /* ignore */ }
    });
    const unlistenStage = listen<string>('clawbot-login-status', (event) => {
      try {
        const data = JSON.parse(event.payload) as { integrationId: string; status: string; botId?: string };
        setClawbotLoginStage((prev) => ({ ...prev, [data.integrationId]: data.status }));
        if (data.status === 'confirmed') {
          setClawbotQr((prev) => {
            const next = { ...prev };
            delete next[data.integrationId];
            return next;
          });
          // 实时更新列表摘要：登录成功后把 botId 写进内存 config（DB 已由 Rust 持久化）
          if (data.botId) {
            useIntegrationStore.setState((state) => ({
              integrations: state.integrations.map((i) => {
                if (i.id !== data.integrationId) return i;
                try {
                  const cfg = { ...(JSON.parse(i.config || '{}') as Record<string, unknown>), ilink_bot_id: data.botId };
                  return { ...i, config: JSON.stringify(cfg) };
                } catch { return i; }
              }),
            }));
          }
        }
      } catch { /* ignore */ }
    });
    return () => {
      unlisten.then((fn) => fn());
      unlistenQr.then((fn) => fn());
      unlistenStage.then((fn) => fn());
    };
  }, []);

  const getEditConfig = useCallback(
    (integration: { id: string; type: string; config: string }) => {
      if (editingConfigs[integration.id]) return editingConfigs[integration.id];
      try {
        const parsed = JSON.parse(integration.config);
        // 🆕 用对应类型的默认值补齐缺失字段（新旧配置兼容）
        const defaults = DEFAULT_CONFIG_BY_TYPE[integration.type] || DEFAULT_NAPCAT_CONFIG;
        return { ...defaults, ...parsed };
      } catch {
        return DEFAULT_CONFIG_BY_TYPE[integration.type] || DEFAULT_NAPCAT_CONFIG;
      }
    },
    [editingConfigs],
  );

  const setEditConfigField = useCallback(<K extends keyof BotIntegrationConfig>(id: string, config: BotIntegrationConfig, field: K, value: BotIntegrationConfig[K]) => {
    const updated = { ...config, [field]: value };
    setEditingConfigs((prev) => ({ ...prev, [id]: updated }));
  }, []);

  const handleAdd = async () => {
    setSaving(true);
    try {
      const config = DEFAULT_CONFIG_BY_TYPE[addType] || addConfig;
      await addIntegration(addType, config);
      await logBot(addType, `接入已创建 (${getTypeLabel(addType)})`);
      setShowAddModal(false);
      setAddConfig(DEFAULT_NAPCAT_CONFIG);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConfig = async (id: string) => {
    if (!editingConfigs[id]) return;
    const integration = integrations.find((i) => i.id === id);
    if (!integration) return;
    setSaving(true);
    try {
      await updateIntegration(id, { config: JSON.stringify(editingConfigs[id]) });
      await logBot(integration.type, '配置已更新');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const integration = integrations.find((i) => i.id === id);
    await removeIntegration(id);
    if (expandedId === id) setExpandedId(null);
    setEditingConfigs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (integration) {
      await logBot(integration.type, '接入已删除');
    }
  };

  const handleToggle = async (id: string) => {
    const integration = integrations.find((i) => i.id === id);
    if (!integration) return;
    const wasEnabled = integration.enabled;
    await toggleIntegration(id);
    await logBot(integration.type, wasEnabled ? '接入已停止' : '接入已启动');
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    setTestResult(null);
    try {
      const result = await testConnection(id);
      setTestResult({ id, ...result });
    } finally {
      setTesting(null);
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'napcat': return 'NapCat (QQ)';
      case 'qq_official': return 'QQ 官方机器人 (开放平台)';
      case 'qclaw': return 'QClaw (QQ 龙虾)';
      case 'qqbot': return 'QQ Bot (龙虾插件)';
      case 'clawbot': return '微信 (ClawBot 扫码)';
      default: return type;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'napcat': return <MessageSquare size={16} />;
      case 'qq_official': return <Globe size={16} />;
      case 'qclaw': return <Zap size={16} />;
      case 'qqbot': return <Bot size={16} />;
      case 'clawbot': return <CircleDot size={16} />;
      default: return <Bot size={16} />;
    }
  };

  const getPlatformName = (type: string) => {
    switch (type) {
      case 'napcat':
      case 'qq_official':
      case 'qclaw':
      case 'qqbot': return 'QQ';
      case 'clawbot': return '微信';
      default: return type;
    }
  };

  /** 列表摘要行：按类型展示关键配置 */
  const getTypeSummary = (type: string, config: BotIntegrationConfig) => {
    switch (type) {
      case 'napcat': return config.ws_url;
      case 'qq_official': return config.app_id ? `AppID: ${config.app_id}` : '未配置 AppID';
      case 'qclaw': return config.app_id ? `AppID: ${config.app_id}` : '待扫码/未配置';
      case 'qqbot': return config.app_id ? `AppID: ${config.app_id}` : '待扫码/未配置';
      case 'clawbot': return config.ilink_bot_id ? `已登录: ${config.ilink_bot_id}` : '待扫码登录';
      default: return '';
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950 overflow-hidden">
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors active:scale-95"
            >
              <ArrowLeft size={18} className="text-gray-500" />
            </button>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                接入管理
              </h1>
              <p className="text-xs text-gray-400">
               管理外部平台接入 (NapCat / QQ 开放平台 / QClaw / QQ Bot / 微信 ClawBot 扫码)
              </p>
            </div>
          </div>

          {/* Add Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full mb-4 p-3 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-slate-400 dark:hover:border-slate-700 transition-all duration-200 flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-slate-700 active:scale-[0.98]"
          >
            <Plus size={16} />
            添加接入
          </button>

          {/* Integration List */}
          {!isLoaded ? (
            <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>
          ) : integrations.length === 0 ? (
            <div className="text-center py-12 animate-[fadeIn_0.3s_ease-out]">
              <Wifi size={40} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-gray-500 dark:text-gray-400 text-sm">暂无接入配置</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                点击上方按钮添加 NapCat 或微信接入
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {integrations.map((integration, index) => {
                const config = getEditConfig(integration);
                const isExpanded = expandedId === integration.id;
                const convCount = conversations.filter((c) => c.integrationId === integration.id).length;

                return (
                  <div
                    key={integration.id}
                    className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 animate-[slideUp_0.25s_ease-out]"
                    style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
                  >
                    {/* Header */}
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : integration.id)}
                    >
                      <div className={`p-2 rounded-lg transition-colors duration-200 ${integration.enabled ? 'bg-green-50 dark:bg-green-900/20 text-green-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
                        {integration.enabled ? <Wifi size={16} /> : <WifiOff size={16} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {getTypeIcon(integration.type)}
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {getTypeLabel(integration.type)}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors duration-200 ${
                            integration.enabled
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                          }`}>
                            {integration.enabled ? '已启用' : '已停用'}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                          {getTypeSummary(integration.type, config)} / {convCount} 个会话
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggle(integration.id); }}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                          integration.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      >
                        <div className={`absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                          integration.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`} />
                      </button>
                      <ChevronDown
                        size={14}
                        className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </div>

                    {/* Expanded Config */}
                    <Collapsible open={isExpanded}>
                      <div className="px-4 pb-4">
                        <div className="pt-3 space-y-3">
                          {integration.type === 'napcat' && (
                            <>
                              <div>
                                <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">连接模式</label>
                                <div className="relative mt-1">
                                  <select
                                    value={config.ws_mode || 'server'}
                                    onChange={(e) => setEditConfigField(integration.id, config, 'ws_mode', e.target.value)}
                                    className="w-full appearance-none px-3 py-2 pr-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 cursor-pointer focus:outline-none focus:ring-1 focus:ring-slate-700 transition-all duration-150"
                                  >
                                    <option value="server">反向 WS（推荐）— 本应用监听，NapCat 连入</option>
                                    <option value="client">正向 WS 客户端 — 主动连接 NapCat 的 WS 服务</option>
                                  </select>
                                  <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                </div>
                                <p className="mt-1 text-[10px] text-gray-400">
                                  {(config.ws_mode || 'server') === 'client'
                                    ? '填 NapCat 正向 WebSocket 服务的地址（如 ws://127.0.0.1:3001），断线自动重连；Token 非空时以 access_token 参数附加'
                                    : 'NapCat 网络配置中添加「反向 WebSocket 客户端」，URL 填 ws://127.0.0.1:3001'}
                                </p>
                              </div>
                              <ConfigInput
                                label="WebSocket URL"
                                value={config.ws_url}
                                onChange={(v) => setEditConfigField(integration.id, config, 'ws_url', v)}
                                placeholder="ws://127.0.0.1:3001"
                              />
                              <ConfigInput
                                label="HTTP API URL"
                                value={config.http_url}
                                onChange={(v) => setEditConfigField(integration.id, config, 'http_url', v)}
                                placeholder="http://127.0.0.1:3000"
                                optional
                              />
                              <ConfigInput
                                label="Token"
                                value={config.token}
                                onChange={(v) => setEditConfigField(integration.id, config, 'token', v)}
                                placeholder="留空则无需认证"
                                type="password"
                                optional
                              />
                            </>
                          )}

                          {(integration.type === 'qq_official' || integration.type === 'qclaw' || integration.type === 'qqbot') && (
                            <>
                              {(integration.type === 'qclaw' || integration.type === 'qqbot') && (
                                <div className="rounded-xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-900/10 p-3 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium text-blue-700 dark:text-blue-300">扫码绑定（推荐）</span>
                                    <button
                                      onClick={async () => {
                                        if (bindQr[integration.id]) {
                                          setBindQr((prev) => { const n = { ...prev }; delete n[integration.id]; return n; });
                                        } else {
                                          const url = 'https://q.qq.com/qqbot/openclaw/login.html';
                                          const dataUrl = await generateQrcode(url);
                                          if (dataUrl) setBindQr((prev) => ({ ...prev, [integration.id]: dataUrl }));
                                        }
                                      }}
                                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-700 active:scale-95 transition-all"
                                    >
                                      {bindQr[integration.id] ? '收起二维码' : '显示扫码入口'}
                                    </button>
                                  </div>
                                  <SmoothReveal show={Boolean(bindQr[integration.id])}>
                                    <div className="flex flex-col items-center gap-1.5 pt-1">
                                      <img src={bindQr[integration.id] || ''} alt="QQ 龙虾登录入口二维码" className="w-40 h-40 rounded-lg border border-blue-100 dark:border-blue-800 bg-white p-1" />
                                      <p className="text-[10px] text-blue-500/80 text-center leading-relaxed">
                                        手机 QQ 扫码打开官方登录页 → 登录并「创建机器人」→<br />复制 AppID / AppSecret 填入下方保存
                                      </p>
                                    </div>
                                  </SmoothReveal>
                                </div>
                              )}
                              <ConfigInput
                                label="AppID"
                                value={config.app_id || ''}
                                onChange={(v) => setEditConfigField(integration.id, config, 'app_id', v)}
                                placeholder="QQ 开放平台 AppID"
                              />
                              <ConfigInput
                                label="AppSecret"
                                value={config.client_secret || ''}
                                onChange={(v) => setEditConfigField(integration.id, config, 'client_secret', v)}
                                placeholder="QQ 开放平台 AppSecret"
                                type="password"
                              />
                              <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-[11px] text-blue-600 dark:text-blue-400">
                                {integration.type === 'qq_official'
                                  ? '在 QQ 开放平台 (q.qq.com) 创建机器人后获取凭证。启用后自动获取 Token 并连接官方 WebSocket 网关，支持群@、单聊与私信事件，回复自动携带被动消息凭证。'
                                  : '龙虾生态 QQ 机器人：与 QQ 官方机器人同一协议。扫码登录官方入口创建机器人后，将 AppID / AppSecret 填入即可，支持 C2C 私聊与群聊 @消息。'}
                              </div>
                            </>
                          )}

                          {integration.type === 'clawbot' && (
                            <>
                              {/* 扫码登录区：启用后 Rust 自动取码并轮询状态 */}
                              <SmoothReveal show={Boolean(clawbotQr[integration.id]) && integration.enabled}>
                                <div className="flex flex-col items-center py-2">
                                  <QrImage src={clawbotQr[integration.id] || ''} />
                                  <p className="text-xs text-gray-500 mt-2">
                                    {clawbotLoginStage[integration.id] === 'scaned'
                                      ? '已扫码，请在手机上确认登录'
                                      : '请用手机微信扫描二维码登录'}
                                  </p>
                                </div>
                              </SmoothReveal>
                              {config.ilink_bot_id && (
                                <div className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-[11px] text-green-600 dark:text-green-400">
                                  已登录账号：{config.ilink_bot_id}。会话失效时会自动重新出示二维码，重新扫码即可。
                                </div>
                              )}
                              <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-[11px] text-blue-600 dark:text-blue-400">
                                通过微信官方 ClawBot 插件（iLink 协议）接入：启用后出示二维码，用手机微信扫码确认即可。登录凭证自动保存，重启无需重复扫码；无需填写任何服务器地址。
                              </div>
                            </>
                          )}

                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm text-gray-700 dark:text-gray-300">自动回复</span>
                              <p className="text-[11px] text-gray-400">收到消息后 AI 自动回复</p>
                            </div>
                            <button
                              onClick={() => setEditConfigField(integration.id, config, 'auto_reply', !config.auto_reply)}
                              className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                                config.auto_reply ? 'bg-slate-700' : 'bg-gray-300 dark:bg-gray-600'
                              }`}
                            >
                              <div className={`absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                                config.auto_reply ? 'translate-x-[22px]' : 'translate-x-0.5'
                              }`} />
                            </button>
                          </div>

                          <div>
                            <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                              关联角色
                            </label>
                            <CharacterSelect
                              value={config.character_id}
                              onChange={(id) => setEditConfigField(integration.id, config, 'character_id', id)}
                              characters={characters}
                            />
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-stretch gap-2 pt-2">
                            <button
                              onClick={() => handleSaveConfig(integration.id)}
                              disabled={saving || !editingConfigs[integration.id]}
                              className="flex-1 px-3 py-2 rounded-lg border border-transparent bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium transition-all duration-150 disabled:opacity-50 active:scale-[0.97]"
                            >
                              {saving ? '保存中...' : '保存配置'}
                            </button>
                            <button
                              onClick={() => handleTest(integration.id)}
                              disabled={testing === integration.id}
                              className="px-3 py-2 rounded-lg border border-blue-200 dark:border-blue-800 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-sm transition-all duration-150 active:scale-[0.97] flex items-center gap-1"
                            >
                              {testing === integration.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Zap size={14} />
                              )}
                              测试
                            </button>
                            <button
                              onClick={() => handleDelete(integration.id)}
                              className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm transition-all duration-150 active:scale-[0.97] flex items-center justify-center"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {/* Test result */}
                          {testResult && testResult.id === integration.id && (
                            <div className={`px-3 py-2 rounded-lg text-xs ${
                              testResult.success
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                            }`}>
                              {testResult.message}
                            </div>
                          )}

                          {/* Bot status */}
                          {botStatuses[integration.id] && (
                            <div className={`px-3 py-2 rounded-lg text-xs ${
                              botStatuses[integration.id].status === 'connected' || botStatuses[integration.id].status === 'listening'
                                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                : botStatuses[integration.id].status === 'error'
                                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                                : 'bg-gray-50 dark:bg-gray-800/50 text-gray-500'
                            }`}>
                              {botStatuses[integration.id].message}
                            </div>
                          )}

                          {/* Routing config */}
                          {(() => {
                            const integrationConvs = conversations.filter((c) => c.integrationId === integration.id);
                            if (integrationConvs.length === 0) return null;
                            return (
                              <div className="mt-2">
                                <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                                  角色路由 ({integrationConvs.length})
                                </div>
                                <div className="space-y-1.5">
                                  {integrationConvs.map((conv) => (
                                    <div key={conv.id} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-2.5 py-2">
                                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                                        {conv.externalUserName.charAt(0)}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{conv.externalUserName}</div>
                                        <div className="text-[10px] text-gray-400">{conv.externalUserId}</div>
                                      </div>
                                      <div className="shrink-0">
                                        <CharacterSelect
                                          value={conv.characterId}
                                          onChange={(charId) => updateConversationCharacter(conv.id, charId)}
                                          characters={characters}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </Collapsible>
                  </div>
                );
              })}
            </div>
          )}

          {/* Connected Conversations */}
          {conversations.length > 0 && (
            <div className="mt-8">
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">
                外部会话 ({conversations.length})
              </h2>
              <div className="space-y-2">
                {conversations.map((conv, index) => {
                  const integration = integrations.find((i) => i.id === conv.integrationId);
                  return (
                    <div
                      key={conv.id}
                      className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-3 flex items-center gap-3 animate-[slideUp_0.25s_ease-out]"
                      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center text-white text-xs font-bold">
                        {conv.externalUserName.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {conv.externalUserName}
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {integration ? getPlatformName(integration.type) : ''} | ID: {conv.externalUserId}
                        </div>
                      </div>
                      <div className="shrink-0 w-36">
                        <CharacterSelect
                          value={conv.characterId}
                          onChange={(charId) => updateConversationCharacter(conv.id, charId)}
                          characters={characters}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Spacer for scroll */}
          <div className="h-6" />
        </div>
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div
            className="absolute inset-0 bg-black/40 animate-[fadeIn_0.15s_ease-out]"
            onClick={() => setShowAddModal(false)}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              添加接入
            </h3>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {(['napcat', 'qq_official', 'qclaw', 'qqbot', 'clawbot'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => { setAddType(type); setAddConfig(DEFAULT_CONFIG_BY_TYPE[type]); }}
                  className={`p-3 rounded-xl border-2 transition-all duration-200 active:scale-[0.97] ${
                    addType === type
                      ? 'border-slate-700 bg-slate-100 dark:bg-slate-800/20 shadow-sm'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 justify-center">
                    {getTypeIcon(type)}
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {getTypeLabel(type)}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1 text-center">
                    {type === 'napcat' && 'QQ NT (NapCat)'}
                    {type === 'qq_official' && 'QQ 开放平台官方 API'}
                    {type === 'qclaw' && '腾讯官方龙虾客户端'}
                    {type === 'qqbot' && 'QQ 机器人 · 扫码绑定'}
                    {type === 'clawbot' && '微信扫码授权接入'}
                  </p>
                </button>
              ))}
            </div>

            {addType === 'napcat' && (
              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">连接模式</label>
                  <div className="relative mt-1">
                    <select
                      value={addConfig.ws_mode || 'server'}
                      onChange={(e) => setAddConfig({ ...addConfig, ws_mode: e.target.value })}
                      className="w-full appearance-none px-3 py-2 pr-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 cursor-pointer focus:outline-none focus:ring-1 focus:ring-slate-700 transition-all duration-150"
                    >
                      <option value="server">反向 WS（推荐）— 本应用监听，NapCat 连入</option>
                      <option value="client">正向 WS 客户端 — 主动连接 NapCat 的 WS 服务</option>
                    </select>
                    <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </div>
                <ConfigInput
                  label="WebSocket URL"
                  value={addConfig.ws_url}
                  onChange={(v) => setAddConfig({ ...addConfig, ws_url: v })}
                  placeholder="ws://127.0.0.1:3001"
                />
                <ConfigInput
                  label="HTTP API URL"
                  value={addConfig.http_url}
                  onChange={(v) => setAddConfig({ ...addConfig, http_url: v })}
                  placeholder="http://127.0.0.1:3000"
                  optional
                />
                <ConfigInput
                  label="Token"
                  value={addConfig.token}
                  onChange={(v) => setAddConfig({ ...addConfig, token: v })}
                  placeholder="留空则无需认证"
                  type="password"
                  optional
                />
              </div>
            )}

            {(addType === 'qq_official' || addType === 'qclaw' || addType === 'qqbot') && (
              <div className="space-y-3 mb-4">
                {(addType === 'qclaw' || addType === 'qqbot') && (
                  <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-[11px] text-blue-600 dark:text-blue-400">
                    推荐用扫码绑定：添加后在接入卡片中点「显示扫码入口」，手机 QQ 扫码打开官方登录页
                    (<span className="underline">q.qq.com/qqbot/openclaw/login.html</span>)
                    登录并创建机器人，再把 AppID / AppSecret 填到下方。也可以直接手动填写。
                  </div>
                )}
                <ConfigInput
                  label="AppID"
                  value={addConfig.app_id || ''}
                  onChange={(v) => setAddConfig({ ...addConfig, app_id: v })}
                  placeholder={addType === 'qq_official' ? 'QQ 开放平台 AppID' : '龙虾机器人 AppID'}
                />
                <ConfigInput
                  label="AppSecret"
                  value={addConfig.client_secret || ''}
                  onChange={(v) => setAddConfig({ ...addConfig, client_secret: v })}
                  placeholder="QQ 开放平台 AppSecret"
                  type="password"
                />
                <div className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-[11px] text-blue-600 dark:text-blue-400">
                  在 QQ 开放平台 (q.qq.com) 创建机器人后获取凭证，添加后在列表中展开可继续配置。
                </div>
              </div>
            )}

            {addType === 'clawbot' && (
              <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
                <CircleDot size={24} className="mx-auto mb-2 text-green-500" />
                <p>微信官方 ClawBot 插件（iLink 协议）</p>
                <p className="text-xs text-gray-400 mt-1">创建后启用，扫码即可登录微信，无需填写地址</p>
              </div>
            )}

            <div className="mb-4">
              <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                关联角色
              </label>
              <CharacterSelect
                value={addConfig.character_id}
                onChange={(id) => setAddConfig({ ...addConfig, character_id: id })}
                characters={characters}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm transition-all duration-150 active:scale-[0.97]"
              >
                取消
              </button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium transition-all duration-150 disabled:opacity-50 active:scale-[0.97]"
              >
                {saving ? '添加中...' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes dropdownIn {
          from { opacity: 0; transform: translateY(-4px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

