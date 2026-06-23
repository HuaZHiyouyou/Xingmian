
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Wifi, WifiOff, Trash2, Plus, ChevronDown,
  MessageSquare, Bot, Check, Loader2, Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { listen } from '@tauri-apps/api/event';
import { useIntegrationStore } from '../../store/integrationStore';
import { useCharacterStore } from '../../store/characterStore';
import { BotIntegrationConfig } from '../../lib/tauriBridge';
import { Character } from '../../types';

const DEFAULT_NAPCAT_CONFIG: BotIntegrationConfig = {
  ws_url: 'ws://127.0.0.1:3001',
  http_url: '',
  token: '',
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

function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (ref.current) {
      setHeight(ref.current.scrollHeight);
    }
  }, [open, children]);

  return (
    <div
      className="overflow-hidden transition-all duration-300 ease-in-out"
      style={{ maxHeight: open ? height : 0, opacity: open ? 1 : 0 }}
    >
      <div ref={ref}>{children}</div>
    </div>
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
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const selected = characters.find((c) => c.id === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const scrollHandler = () => { if (open) setOpen(false); };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', scrollHandler, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', scrollHandler, true);
    };
  }, [open]);

  const handleToggle = () => {
    if (!open && ref.current) {
      setTriggerRect(ref.current.getBoundingClientRect());
    }
    setOpen(!open);
  };

  const dropdown = open && triggerRect ? createPortal(
    <div
      className="fixed bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden animate-[dropdownIn_0.15s_ease-out]"
      style={{
        top: triggerRect.bottom + 4,
        left: triggerRect.left,
        width: triggerRect.width,
        zIndex: 9999,
        maxHeight: 192,
        overflowY: 'auto',
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
                  ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200'
              }`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                c.id === value
                  ? 'bg-violet-500 text-white'
                  : 'bg-violet-100 dark:bg-violet-800/50 text-violet-600 dark:text-violet-300'
              }`}>
                {c.name.charAt(0)}
              </div>
              <span className="text-sm truncate flex-1">{c.name}</span>
              {c.id === value && <Check size={14} className="text-violet-500 shrink-0" />}
            </button>
          ))
        )}
      </div>
    </div>,
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
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
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
        className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all duration-150"
      />
    </div>
  );
}

export function IntegrationPage() {
  const navigate = useNavigate();
  const characters = useCharacterStore((s) => s.characters);
  const {
    integrations,
    conversations,
    isLoaded,
    loadIntegrations,
    loadConversations,
    logBot,
    addIntegration,
    updateIntegration,
    removeIntegration,
    toggleIntegration,
    testConnection,
    updateConversationCharacter,
    removeConversation,
  } = useIntegrationStore();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addType, setAddType] = useState<'napcat' | 'wechat'>('napcat');
  const [addConfig, setAddConfig] = useState<BotIntegrationConfig>(DEFAULT_NAPCAT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);

  const [editingConfigs, setEditingConfigs] = useState<Record<string, BotIntegrationConfig>>({});
  const [botStatuses, setBotStatuses] = useState<Record<string, { status: string; message: string }>>({});

  useEffect(() => {
    loadIntegrations();
    loadConversations();
  }, [loadIntegrations, loadConversations]);

  useEffect(() => {
    const unlisten = listen<string>('bot-status', (event) => {
      try {
        const data = JSON.parse(event.payload) as { integrationId: string; status: string; message: string };
        setBotStatuses((prev) => ({ ...prev, [data.integrationId]: { status: data.status, message: data.message } }));
      } catch {}
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const getEditConfig = useCallback(
    (integration: { id: string; config: string }) => {
      if (editingConfigs[integration.id]) return editingConfigs[integration.id];
      try { return JSON.parse(integration.config); }
      catch { return DEFAULT_NAPCAT_CONFIG; }
    },
    [editingConfigs],
  );

  const setEditConfigField = useCallback((id: string, config: BotIntegrationConfig, field: keyof BotIntegrationConfig, value: any) => {
    const updated = { ...config, [field]: value };
    setEditingConfigs((prev) => ({ ...prev, [id]: updated }));
  }, []);

  const handleAdd = async () => {
    setSaving(true);
    try {
      const config = addType === 'napcat' ? addConfig : { ...DEFAULT_NAPCAT_CONFIG, auto_reply: true };
      const integration = await addIntegration(addType, config);
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
      case 'wechat': return '微信 (iLink Bot)';
      default: return type;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'napcat': return <MessageSquare size={16} />;
      case 'wechat': return <Bot size={16} />;
      default: return <Bot size={16} />;
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
                管理外部平台接入 (NapCat, 微信 iLink Bot)
              </p>
            </div>
          </div>

          {/* Add Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full mb-4 p-3 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-violet-300 dark:hover:border-violet-600 transition-all duration-200 flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-violet-600 active:scale-[0.98]"
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
                          {integration.type === 'napcat' ? config.ws_url : 'iLink Bot API'} / {convCount} 个会话
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggle(integration.id); }}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                          integration.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                        }`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                          integration.enabled ? 'translate-x-5' : 'translate-x-0.5'
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
                          {integration.type === 'napcat' ? (
                            <>
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
                          ) : (
                            <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
                              <Bot size={24} className="mx-auto mb-2 text-gray-300" />
                              <p>微信接入通过 iLink Bot API 连接</p>
                              <p className="text-xs text-gray-400 mt-1">启用后自动建立连接</p>
                            </div>
                          )}

                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-sm text-gray-700 dark:text-gray-300">自动回复</span>
                              <p className="text-[11px] text-gray-400">收到消息后 AI 自动回复</p>
                            </div>
                            <button
                              onClick={() => setEditConfigField(integration.id, config, 'auto_reply', !config.auto_reply)}
                              className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
                                config.auto_reply ? 'bg-violet-500' : 'bg-gray-300 dark:bg-gray-600'
                              }`}
                            >
                              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                                config.auto_reply ? 'translate-x-5' : 'translate-x-0.5'
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
                          <div className="flex gap-2 pt-2">
                            <button
                              onClick={() => handleSaveConfig(integration.id)}
                              disabled={saving || !editingConfigs[integration.id]}
                              className="flex-1 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-all duration-150 disabled:opacity-50 active:scale-[0.97]"
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
                              className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 text-sm transition-all duration-150 active:scale-[0.97]"
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
                                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
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
                  const character = characters.find((c) => c.id === conv.characterId);
                  const integration = integrations.find((i) => i.id === conv.integrationId);
                  return (
                    <div
                      key={conv.id}
                      className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-3 flex items-center gap-3 animate-[slideUp_0.25s_ease-out]"
                      style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
                    >
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center text-white text-xs font-bold">
                        {conv.externalUserName.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {conv.externalUserName}
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {integration?.type === 'napcat' ? 'QQ' : '微信'} | ID: {conv.externalUserId}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div
            className="absolute inset-0 bg-black/40 animate-[fadeIn_0.15s_ease-out]"
            onClick={() => setShowAddModal(false)}
          />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              添加接入
            </h3>

            <div className="flex gap-2 mb-4">
              {(['napcat', 'wechat'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setAddType(type)}
                  className={`flex-1 p-3 rounded-xl border-2 transition-all duration-200 active:scale-[0.97] ${
                    addType === type
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 shadow-sm'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 justify-center">
                    {getTypeIcon(type)}
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {getTypeLabel(type)}
                    </span>
                  </div>
                  {type === 'wechat' && (
                    <p className="text-[11px] text-gray-400 mt-1 text-center">iLink Bot API</p>
                  )}
                </button>
              ))}
            </div>

            {addType === 'napcat' && (
              <div className="space-y-3 mb-4">
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
                <div>
                  <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    关联角色
                  </label>
                  <CharacterSelect
                    value={addConfig.character_id}
                    onChange={(id) => setAddConfig({ ...addConfig, character_id: id })}
                    characters={characters}
                  />
                </div>
              </div>
            )}

            {addType === 'wechat' && (
              <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
                <Bot size={24} className="mx-auto mb-2 text-gray-300" />
                <p>微信接入通过 iLink Bot API 连接</p>
                <p className="text-xs text-gray-400 mt-1">创建后启用即可自动连接</p>
              </div>
            )}

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
                className="flex-1 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-all duration-150 disabled:opacity-50 active:scale-[0.97]"
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

