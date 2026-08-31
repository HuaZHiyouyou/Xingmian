import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useConfigStore,
  modelTypeLabels,
  ModelType,
  defaultPlatforms,
} from '../../store/configStore';
import {
  ArrowLeft,
  Globe,
  Eye,
  EyeOff,
  Check,
  X,
  Monitor,
  Camera,
  Mic,
  Video,
  Plus,
  RefreshCw,
  Trash2,
  ChevronDown,
  Pin,
  Save,
  Server,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ConfirmModal } from '../settings/ModulePageShell';

const modelTypeIcons: Record<ModelType, typeof Monitor> = {
  chat: Monitor,
  vision: Camera,
  audio: Mic,
  video: Video,
};

const typeColorMap: Record<ModelType, string> = {
  chat: 'bg-blue-500',
  vision: 'bg-slate-700',
  audio: 'bg-orange-500',
  video: 'bg-slate-700',
};

const modelTypes: ModelType[] = ['chat', 'vision', 'audio', 'video'];

function getIconForType(type: ModelType): typeof Monitor {
  return modelTypeIcons[type] || Monitor;
}

function getLabelForType(type: ModelType): string {
  return modelTypeLabels[type] || '对话';
}

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 2500);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
      type === 'success'
        ? 'bg-green-500 text-white'
        : 'bg-red-500 text-white'
    }`}>
      {type === 'success' ? <Check size={16} /> : <X size={16} />}
      {message}
    </div>
  );
}

function TypeSelector({
  value,
  onChange,
}: {
  value: ModelType | null;
  onChange: (t: ModelType | null) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 bg-gray-100 dark:bg-gray-800 rounded-xl p-0.5">
      {modelTypes.map((t) => {
        const IconComp = getIconForType(t);
        const isActive = value === t;
        const colorClass = typeColorMap[t] || 'bg-gray-400';

        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(isActive ? null : t)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 cursor-pointer active:scale-90 ${
              isActive
                ? `${colorClass} text-white shadow-sm`
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50'
            }`}
            title={`${getLabelForType(t)} (筛选)`}
          >
            <IconComp size={14} />
          </button>
        );
      })}
    </div>
  );
}

function ModelTypeMultiToggle({
  types,
  activeTypes,
  onToggle,
}: {
  types: ModelType[];
  activeTypes: Set<ModelType>;
  onToggle: (type: ModelType) => void;
}) {
  return (
    <div className="inline-flex gap-1 flex-shrink-0">
      {types.map((t) => {
        const IconComp = getIconForType(t);
        const isActive = activeTypes.has(t);
        const colorClass = typeColorMap[t] || 'bg-gray-400';

        return (
          <button
            key={t}
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle(t); }}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${
              isActive
                ? `${colorClass} text-white shadow-sm`
                : 'text-gray-300 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-500'
            }`}
            title={`${getLabelForType(t)}${isActive ? ' (已标记)' : ''}`}
          >
            <IconComp size={14} />
          </button>
        );
      })}
    </div>
  );
}

export function APIConfigPage() {
  const navigate = useNavigate();
  const {
    platforms,
    setPlatformEnabled,
    setPlatformConfig,
    setModelPinned,
    setModelEnabled,
    toggleModelType,
    addModel,
    removeModel,
    addPlatform,
    removePlatform,
    fetchModels,
  } = useConfigStore();

  const [localApiKeys, setLocalApiKeys] = useState<Record<number, string>>({});
  const [localBaseUrls, setLocalBaseUrls] = useState<Record<number, string>>({});
  const [showKeys, setShowKeys] = useState<Record<number, boolean>>({});
  const [newModelName, setNewModelName] = useState('');
  const [newModelType] = useState<ModelType>('chat');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [sessionFetched, setSessionFetched] = useState<Record<number, boolean>>({});
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [testingPlatform, setTestingPlatform] = useState<number | null>(null);
  const [savingPlatform, setSavingPlatform] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<ModelType | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addModalTemplate, setAddModalTemplate] = useState<number | null>(null);
  const [addModalName, setAddModalName] = useState('');
  const [deletePlatformTarget, setDeletePlatformTarget] = useState<{ index: number; name: string } | null>(null);

  useEffect(() => {
    const urls: Record<number, string> = {};
    platforms.forEach((p, i) => {
      urls[i] = p.baseUrl || '';
    });
    setLocalBaseUrls(urls);
  }, [platforms.map(p => p.baseUrl).join(',')]);

  useEffect(() => {
    const keys: Record<number, string> = {};
    platforms.forEach((p, i) => {
      keys[i] = p.apiKey || '';
    });
    setLocalApiKeys(keys);
  }, [platforms.map(p => p.apiKey).join(',')]);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const handleSaveKey = (index: number) => {
    setSavingPlatform(index);
    setPlatformConfig(index, {
      apiKey: localApiKeys[index] || '',
      baseUrl: localBaseUrls[index] || '',
    });
    setTimeout(() => setSavingPlatform(null), 300);
    showToast('配置已保存', 'success');
  };

  const handleTest = async (index: number) => {
    setTestingPlatform(index);
    const config = platforms[index];
    const apiKey = config.apiKey || localApiKeys[index];
    const baseUrl = config.baseUrl || localBaseUrls[index];
    if (!apiKey) {
      showToast('请先输入 API Key', 'error');
      setTestingPlatform(null);
      return;
    }

    try {
      const enabledModel = config.models.find((m) => m.enabled && m.name);
      const model = enabledModel?.name || config.models[0]?.name || 'test';
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 10,
        }),
      });
      if (response.ok) {
        showToast('连接测试成功', 'success');
      } else {
        showToast(`测试失败 (${response.status})`, 'error');
      }
    } catch {
      showToast('连接测试失败', 'error');
    } finally {
      setTestingPlatform(null);
    }
  };

  const handleAddModel = (index: number) => {
    if (!newModelName.trim()) return;
    addModel(index, {
      name: newModelName.trim(),
      type: newModelType,
      enabled: false,
      pinned: false,
      enabledTypes: [],
    });
    setNewModelName('');
    showToast('模型已添加', 'success');
  };

  const handlePinSelected = (platformIndex: number) => {
    if (!selectedModelKey) return;
    const [pi, mi] = selectedModelKey.split('-').map(Number);
    if (pi !== platformIndex) return;
    const model = platforms[platformIndex]?.models[mi];
    if (!model) return;

    if (model.pinned) {
      const newEnabled = !model.enabled;
      setModelEnabled(platformIndex, mi, newEnabled);
      showToast(newEnabled ? '模型已启用' : '模型已禁用', 'success');
    } else {
      const hasTypes = model.enabledTypes && model.enabledTypes.length > 0;
      setModelPinned(platformIndex, mi, true);
      if (hasTypes) {
        setModelEnabled(platformIndex, mi, true);
      }
      showToast('模型已固定', 'success');
      setSelectedModelKey(null);
    }
  };

  const toggleExpand = (index: number) => {
    if (expandedIndex === index) {
      setExpandedIndex(null);
      setSessionFetched((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      setSelectedModelKey(null);
      setFilterType(null);
    } else {
      setExpandedIndex(index);
      setSelectedModelKey(null);
      setFilterType(null);
    }
  };

  const handleFetchModels = (index: number) => {
    const apiKey = platforms[index].apiKey || localApiKeys[index];
    if (!apiKey) {
      showToast('请先保存 API Key', 'error');
      return;
    }
    setSessionFetched((prev) => ({ ...prev, [index]: true }));
    fetchModels(index, apiKey);
    showToast('正在获取模型...', 'success');
  };

  const getEnabledTypes = (model: { enabledTypes?: ModelType[]; type: ModelType }): Set<ModelType> => {
    if (model.enabledTypes !== undefined) {
      return new Set(model.enabledTypes);
    }
    return new Set<ModelType>([model.type]);
  };

  const handleAddPlatform = () => {
    if (!addModalName.trim() || addModalTemplate === null) return;
    const template = defaultPlatforms[addModalTemplate];
    addPlatform({
      ...template,
      displayName: addModalName.trim(),
      enabled: false,
      apiKey: '',
      models: [],
      fetchingModels: false,
      isDefault: false,
    });
    setShowAddModal(false);
    setAddModalName('');
    setAddModalTemplate(null);
    showToast('平台已添加', 'success');
  };

  const pinnedCount = platforms.filter((p) => p.enabled && p.apiKey && p.models.some((m) => m.pinned)).length;

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate('/chat')}
            className="p-2.5 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">API 配置</h1>
            <p className="text-sm text-gray-500 mt-0.5">{pinnedCount} 个平台已配置</p>
          </div>
        </div>

        <div className="space-y-4">
          {platforms.map((p, i) => {
            const isExpanded = expandedIndex === i;
            const isSessionFetched = sessionFetched[i];
            const hasPinnedModels = p.models.some((m) => m.pinned);
            const showModels = isExpanded && p.enabled && (isSessionFetched || hasPinnedModels);
            const pinnedModelCount = p.models.filter((m) => m.pinned).length;

            const displayModels = p.models
              .reduce((acc, m, origIdx) => {
                if (!isSessionFetched && !m.pinned) return acc;
                if (filterType) {
                  const types = getEnabledTypes(m);
                  if (!types.has(filterType)) return acc;
                }
                acc.push({ ...m, _origIdx: origIdx });
                return acc;
              }, [] as (typeof p.models[number] & { _origIdx: number })[])
              .sort((a, b) => {
                if (a.pinned && !b.pinned) return -1;
                if (!a.pinned && b.pinned) return 1;
                return 0;
              });

            return (
              <div
                key={i}
                className={`rounded-2xl border transition-all duration-300 ${
                  p.enabled
                    ? 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 shadow-sm'
                    : 'bg-gray-50 dark:bg-gray-900/60 border-gray-200 dark:border-gray-800 opacity-90'
                }`}
              >
                {/* Platform header */}
                <div
                  className="flex items-center gap-3 p-4 cursor-pointer"
                  onClick={() => toggleExpand(i)}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlatformEnabled(i, !p.enabled);
                    }}
                    className={`w-11 h-6 rounded-full transition-all duration-300 relative flex-shrink-0 ${
                      p.enabled ? 'bg-slate-700' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-300 ${
                        p.enabled ? 'left-5' : 'left-0.5'
                      }`}
                    />
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">{p.displayName}</h3>
                      {p.fetchingModels && (
                        <RefreshCw size={12} className="animate-spin text-gray-400" />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{p.baseUrl || '未配置地址'}</p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                      pinnedModelCount > 0
                        ? 'bg-slate-200 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                    }`}>
                      {pinnedModelCount} 个模型
                    </span>
                    {!p.isDefault && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletePlatformTarget({ index: i, name: p.displayName });
                        }}
                        className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30
                          text-gray-400 hover:text-red-500 transition-colors"
                        title="删除平台"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <div className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                      <ChevronDown size={16} className="text-gray-400" />
                    </div>
                  </div>
                </div>

                {/* Expandable content */}
                <AnimatePresence>
                  {isExpanded && p.enabled && (
                    <motion.div
                      key={`expand-${i}`}
                      className="overflow-hidden"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 28, mass: 1 }}
                    >
                      <div className="px-5 pt-3 pb-5 space-y-4">
                        {/* API Key row */}
                        <div className="flex gap-2">
                          <div className="flex-1 relative">
                            <input
                              type={showKeys[i] ? 'text' : 'password'}
                              value={localApiKeys[i] || ''}
                              onChange={(e) => setLocalApiKeys((prev) => ({ ...prev, [i]: e.target.value }))}
                              placeholder="输入 API Key"
                              className="w-full px-4 py-2.5 pr-10 rounded-xl border border-gray-200 dark:border-gray-700
                                bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm
                                focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-transparent"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowKeys((prev) => ({ ...prev, [i]: !prev[i] }));
                              }}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                              {showKeys[i] ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSaveKey(i); }}
                            disabled={savingPlatform === i}
                            className={`px-4 py-2.5 rounded-xl text-white text-sm font-medium transition-all shadow-sm flex items-center gap-2 flex-shrink-0 ${
                              savingPlatform === i
                                ? 'bg-green-500'
                                : 'bg-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            <Save size={14} />
                            保存
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleTest(i); }}
                            disabled={(!p.apiKey && !localApiKeys[i]) || testingPlatform === i}
                            className={`px-4 py-2.5 rounded-xl border text-sm transition-all font-medium flex items-center gap-2 flex-shrink-0 ${
                              testingPlatform === i
                                ? 'border-green-300 text-green-600 bg-green-50 dark:bg-green-900/20 dark:border-green-700 dark:text-green-400'
                                : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                            } disabled:opacity-50`}
                          >
                            {testingPlatform === i ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                            测试
                          </button>
                        </div>

                        {/* Base URL row */}
                        <div className="flex gap-2">
                          <div className="flex-1 relative">
                            <Globe size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="text"
                              value={localBaseUrls[i] || ''}
                              onChange={(e) => { e.stopPropagation(); setLocalBaseUrls((prev) => ({ ...prev, [i]: e.target.value })); }}
                              placeholder="https://api.openai.com/v1"
                              className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700
                                bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm
                                focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-transparent"
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFetchModels(i); }}
                            disabled={!localApiKeys[i] || p.fetchingModels}
                            className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700
                              text-gray-600 dark:text-gray-400 text-sm hover:bg-gray-50
                              dark:hover:bg-gray-800 transition-colors disabled:opacity-50
                              flex items-center gap-2 whitespace-nowrap font-medium"
                          >
                            {p.fetchingModels ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            获取模型
                          </button>
                        </div>

                        {/* Model name input + TypeSelector + Add/Pin button */}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={newModelName}
                            onChange={(e) => setNewModelName(e.target.value)}
                            placeholder="模型名称 (如 gpt-4o)"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddModel(i)}
                            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700
                              bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm
                              focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-transparent"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <TypeSelector
                            value={filterType}
                            onChange={(t) => setFilterType(t)}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (selectedModelKey) {
                                handlePinSelected(i);
                              } else {
                                handleAddModel(i);
                              }
                            }}
                            disabled={!newModelName.trim() && !selectedModelKey}
                            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-sm flex items-center gap-2 ${
                              selectedModelKey
                                ? (() => {
                                    const [pi, mi] = selectedModelKey.split('-').map(Number);
                                    const m = platforms[pi]?.models[mi];
                                    if (!m || !m.pinned) return 'bg-slate-700 hover:bg-slate-800 text-white';
                                    return m.enabled
                                      ? 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                                      : 'bg-slate-700 hover:bg-slate-800 text-white';
                                  })()
                                : 'bg-slate-700 hover:bg-slate-800 text-white disabled:opacity-50'
                            }`}
                            title={
                              selectedModelKey
                                ? (() => {
                                    const [pi, mi] = selectedModelKey.split('-').map(Number);
                                    const m = platforms[pi]?.models[mi];
                                    if (!m || !m.pinned) return '固定模型';
                                    return m.enabled ? '停用模型' : '启用模型';
                                  })()
                                : '添加模型'
                            }
                          >
                            {selectedModelKey
                              ? (() => {
                                  const [pi, mi] = selectedModelKey.split('-').map(Number);
                                  const m = platforms[pi]?.models[mi];
                                  if (!m || !m.pinned) return <Pin size={14} />;
                                  return m.enabled ? (
                                    <div className="flex items-center gap-1.5">
                                      <Pin size={14} className="opacity-60" />
                                      <span className="text-[10px] font-medium opacity-60">禁用</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <Pin size={14} />
                                      <span className="text-[10px] font-medium">启用</span>
                                    </div>
                                  );
                                })()
                              : <Plus size={14} />
                            }
                          </button>
                        </div>

                        {/* Filter indicator */}
                        {filterType && (
                          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>筛选:</span>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800">
                              {getLabelForType(filterType)}
                            </span>
                            <button
                              onClick={() => setFilterType(null)}
                              className="text-slate-700 dark:text-slate-300 hover:text-slate-700 transition-colors"
                            >
                              清除
                            </button>
                          </div>
                        )}

                        {/* Model list */}
                        {showModels && (
                          <div className="space-y-2 max-h-72 overflow-y-auto pr-1 scrollbar-hide">
                            {displayModels.map((model) => {
                              const modelKey = `${i}-${model._origIdx}`;
                              const isSelected = selectedModelKey === modelKey;
                              const isPinned = model.pinned;

                              return (
                                <div
                                  key={model._origIdx}
                                  className={`flex items-center gap-3 p-3 rounded-xl transition-colors duration-150 relative ${
                                    isSelected
                                      ? 'bg-slate-100 dark:bg-slate-800/10 border border-slate-400 dark:border-slate-800 ring-1 ring-slate-300 dark:ring-slate-700'
                                      : model.enabled
                                      ? 'bg-slate-100/60 dark:bg-slate-800/10 border border-slate-200 dark:border-slate-900/30'
                                      : 'bg-white dark:bg-gray-800 border border-transparent hover:border-gray-200 dark:hover:border-gray-700'
                                  }`}
                                >
                                  {model.enabled && (
                                    <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 w-1 h-6 bg-slate-700 rounded-r-full" />
                                  )}
                                  <button
                                    onClick={() => {
                                      setSelectedModelKey(isSelected ? null : modelKey);
                                    }}
                                    className="flex-1 flex items-center gap-2 text-left cursor-pointer pl-2"
                                  >
                                    <Pin size={12} className={`flex-shrink-0 ${
                                      isPinned ? 'text-slate-700 dark:text-slate-300' : 'text-gray-300 dark:text-gray-600'
                                    }`} />
                                    <span className={`text-sm truncate font-medium ${
                                      isSelected
                                        ? 'text-slate-800 dark:text-slate-400'
                                        : model.enabled
                                        ? 'text-slate-700 dark:text-slate-500'
                                        : 'text-gray-800 dark:text-gray-200'
                                    }`}>
                                      {model.name}
                                    </span>
                                    {isPinned && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500 flex-shrink-0 font-medium">
                                        已固定
                                      </span>
                                    )}
                                  </button>
                                  <ModelTypeMultiToggle
                                    types={modelTypes}
                                    activeTypes={getEnabledTypes(model)}
                                    onToggle={(type) => {
                                      toggleModelType(i, model._origIdx, type);
                                    }}
                                  />
                                  <button
                                    onClick={(e) => { e.stopPropagation(); removeModel(i, model._origIdx); }}
                                    className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30
                                      text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {!showModels && (
                          <div className="text-center py-6">
                            <RefreshCw size={20} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                            <p className="text-sm text-gray-400">
                              点击"获取模型"自动获取或手动添加
                            </p>
                          </div>
                        )}

                        {/* Pinned models summary */}
                        {showModels && pinnedModelCount > 0 && (
                          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
                            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">已固定模型</h4>
                            <div className="flex flex-wrap gap-2">
                              {p.models
                                .reduce((acc, m, origIdx) => {
                                  if (m.pinned && m.name) acc.push({ m, origIdx });
                                  return acc;
                                }, [] as { m: typeof p.models[number]; origIdx: number }[])
                                .map(({ m, origIdx }) => {
                                  const enabledTypes = getEnabledTypes(m);
                                  const isEnabled = m.enabled;
                                  const typeLabels = Array.from(enabledTypes).map(getLabelForType).join(' + ');
                                  const isThisSelected = selectedModelKey === `${i}-${origIdx}`;

                                  return (
                                    <button
                                      key={m.name + origIdx}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const key = `${i}-${origIdx}`;
                                        setSelectedModelKey(selectedModelKey === key ? null : key);
                                      }}
                                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs shadow-sm transition-all cursor-pointer ${
                                        isThisSelected
                                          ? 'bg-slate-100 dark:bg-slate-800/30 border-slate-400 dark:border-slate-700 ring-1 ring-slate-300 dark:ring-slate-700'
                                          : isEnabled
                                          ? 'bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-slate-400 dark:hover:border-slate-700'
                                          : 'bg-gray-100 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:border-gray-300 dark:hover:border-gray-500'
                                      }`}
                                    >
                                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                        isEnabled ? 'bg-blue-500' : 'bg-gray-400'
                                      }`} />
                                      {typeLabels || '无类型'}: {m.name}
                                      {!isEnabled && ' (未启用)'}
                                    </button>
                                  );
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}

          {/* Add more platforms button */}
          <button
            onClick={() => {
              setShowAddModal(true);
              setAddModalName('');
              setAddModalTemplate(null);
            }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed
              border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400
              hover:border-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-slate-500
              transition-all text-sm font-medium"
          >
            <Plus size={16} />
            添加更多平台
          </button>
        </div>
      </div>

      {/* Add Platform Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 dark:bg-black/50"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">添加新平台</h2>
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    选择平台模板
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {defaultPlatforms.map((dp, idx) => (
                      <button
                        key={idx}
                        onClick={() => setAddModalTemplate(idx)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-all ${
                          addModalTemplate === idx
                            ? 'border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <Server size={14} />
                        <span className="truncate">{dp.displayName}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    平台名称
                  </label>
                  <input
                    type="text"
                    value={addModalName}
                    onChange={(e) => setAddModalName(e.target.value)}
                    placeholder="自定义平台名称"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700
                      bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm
                      focus:outline-none focus:ring-2 focus:ring-slate-700 focus:border-transparent"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700
                      text-gray-600 dark:text-gray-400 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800
                      transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleAddPlatform}
                    disabled={!addModalName.trim() || addModalTemplate === null}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-slate-700 text-white text-sm font-medium
                      hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                  >
                    添加
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* 删除平台确认 */}
      <ConfirmModal
        open={!!deletePlatformTarget}
        onClose={() => setDeletePlatformTarget(null)}
        onConfirm={() => {
          if (deletePlatformTarget) {
            removePlatform(deletePlatformTarget.index);
            showToast('平台已删除', 'success');
            setDeletePlatformTarget(null);
          }
        }}
        title={`删除平台「${deletePlatformTarget?.name || ''}」？`}
        description="删除后需要重新添加和配置该平台。"
        icon={Trash2}
        confirmLabel="删除"
      />
    </div>
  );
}
