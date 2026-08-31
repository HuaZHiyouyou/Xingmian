/**
 * ============================================================
 * AI 一日 · 模态框与引导集合
 *  - SetupGuideBanner : 初始设定四步引导（常驻两 Tab 顶部，完成即勾掉）
 *  - AiInfoModal      : 查看 AI 的相关信息与设定（初始面板入口）
 *  - LlmSettingsModal : LLM 生成总控（一键预设 + 每项独立开关/详细度）
 *  - DeleteScopeModal : 删除三选一（仅活动 / 仅日记 / 全部）
 *  - LedgerModal      : 记一笔开销 / 补一笔财产（AI 回复拼进流水描述）
 * ============================================================
 */
import { useEffect, useState, useCallback, useSyncExternalStore, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Check, Circle, Sparkles, Wallet, ArrowDownCircle, ArrowUpCircle,
  Loader2, Settings2, Info, Trash2, BookOpen, Globe, Cpu, Home, ShoppingBag, Plus, ChevronDown,
} from 'lucide-react';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { useCharacterStore } from '../../store/characterStore';
import {
  dbGetAiAttributes, dbGetAiEconomy, dbAddAiTransaction, dbGetWorldConfigs,
  dbSaveAiEconomy, dbGetAiLifeConfig, dbSaveAiLifeConfig, dbSaveAiInventoryItems, dbGetAiInventory,
  AiTransaction, AiInventoryItem, AiEconomy,
} from '../../lib/tauriBridge';
import { getWorldById } from '../../services/ailife/worldConfig';
import {
  LLM_CALL_META, presetCalls, getCallSetting, readLifeProfile,
  type LlmCallId, type LlmDetail, type LlmCallsMap,
} from '../../services/ailife/llmCalls';
import { runAilifeLlm, generateInitialProfile, type LifeProfileInit } from '../../services/ailife/contentGenerator';
// 🆕 B2.3: 条件基线目录 + 耐用品标记
import { buildBaselinePicks, buildInventoryItems } from '../../services/ailife/baselineCatalog';
import { useDebugLog } from '../../store/debugLogStore';
import { localDateKey } from '../../services/ailife/scheduleTemplates';
import { formatMoneyFromCNY, subscribeDisplayCurrency, getDisplayCurrency } from '../../services/ailife/currency';
import { Skeleton } from '../common/Skeleton';
import {
  purchaseItem, getAllShopItems, getAllCategoryTabs, resolveCategoryMeta, addCustomShopItem, addCustomCategory,
  type ShopEntry,
} from '../../services/ailife/localShop';

const HAND_FONT = "'LXGW WenKai', 'Kaiti SC', 'KaiTi', cursive";

// ---------------- 通用弹层外壳 ----------------

function ModalShell({ title, icon, onClose, children, wide }: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-gray-800 shadow-2xl`}>
        <div className="sticky top-0 flex items-center gap-2 px-5 py-4 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 rounded-t-2xl">
          {icon}
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="ml-auto p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}

// ---------------- ① 初始设定引导（常驻横幅） ----------------

export function SetupGuideBanner({ onGoLifeTab, onGenerate, onOpenInit, characterReady }: {
  onGoLifeTab: () => void;
  onGenerate: () => void;
  onOpenInit: () => void;
  /** 🆕 生效角色判定（全局选择 or 引擎绑定角色，任一即可） */
  characterReady?: boolean;
}) {
  const selectedCharacterId = useCharacterStore((s) => s.selectedCharacterId);
  const config = useAiLifeStore((s) => s.config);
  const todayActs = useAiLifeStore((s) => s.dayActivities[localDateKey(new Date())]);
  const updateConfig = useAiLifeStore((s) => s.updateConfig);
  const [dismissed, setDismissed] = useState(false);
  const [worldReady, setWorldReady] = useState(true);

  useEffect(() => {
    dbGetWorldConfigs().then((ws) => setWorldReady(ws.length > 0)).catch(() => {});
  }, []);

  if (dismissed) return null;

  const initialized = !!(config?.extra as { initialized?: boolean } | undefined)?.initialized;
  const steps: { key: string; label: string; done: boolean; action?: () => void; actionLabel?: string }[] = [
    { key: 'char', label: '选择一个角色', done: characterReady ?? !!selectedCharacterId },
    {
      key: 'init', label: 'AI 初始创建（生活档案 + 初始存款 + 家当，一键完成）', done: initialized,
      action: !initialized ? onOpenInit : undefined, actionLabel: '初始创建',
    },
    {
      key: 'engine', label: '开启生活引擎', done: !!config?.enabled,
      action: config && !config.enabled ? () => updateConfig({ enabled: true }) : undefined,
      actionLabel: '立即开启',
    },
    { key: 'world', label: '世界设定包（内置「现代日常」自动就绪，可自行导入）', done: worldReady, action: onGoLifeTab, actionLabel: '去查看' },
    {
      key: 'plan', label: '让 AI 生成今日日程', done: (todayActs || []).filter((a) => a.status !== 'cancelled').length > 0,
      action: config?.enabled ? onGenerate : undefined, actionLabel: '立即安排',
    },
  ];
  const allDone = steps.every((s) => s.done);
  if (allDone) return null;

  return (
    <section className="mb-4 rounded-2xl bg-slate-100/80 dark:bg-slate-800/15 border border-slate-300 dark:border-slate-900/50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} className="text-slate-700 dark:text-slate-500" />
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-400">初始设定引导</span>
        <button onClick={() => setDismissed(true)} className="ml-auto text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">暂时收起</button>
      </div>
      <div className="space-y-1.5">
        {steps.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            {s.done
              ? <Check size={13} className="text-slate-700 dark:text-slate-300 shrink-0" />
              : <Circle size={13} className="text-gray-300 dark:text-gray-600 shrink-0" />}
            <span className={s.done ? 'text-gray-400 dark:text-gray-500 line-through' : 'text-gray-700 dark:text-gray-200'}>{s.label}</span>
            {!s.done && s.action && (
              <button onClick={s.action}
                className="ml-auto px-2.5 py-1 rounded-full bg-slate-700 text-white text-[11px] hover:bg-slate-700 transition-colors shrink-0">
                {s.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------- ② 查看 AI 的相关信息与设定 ----------------

export function AiInfoModal({ onClose }: { onClose: () => void }) {
  const characterId = useCharacterStore((s) => s.selectedCharacterId);
  const character = useCharacterStore((s) => s.characters.find((c) => c.id === s.selectedCharacterId));
  const config = useAiLifeStore((s) => s.config);
  const [attrs, setAttrs] = useState<Awaited<ReturnType<typeof dbGetAiAttributes>>>(null);
  const [economy, setEconomy] = useState<Awaited<ReturnType<typeof dbGetAiEconomy>>>(null);
  const [worldName, setWorldName] = useState<string>('');

  useEffect(() => {
    if (!characterId) return;
    dbGetAiAttributes(characterId).then(setAttrs).catch(() => {});
    dbGetAiEconomy(characterId).then(setEconomy).catch(() => {});
    getWorldById((config?.extra as { worldId?: string } | undefined)?.worldId)
      .then((w) => setWorldName(w?.name || '现代日常（内置）')).catch(() => {});
  }, [characterId, config]);

  const enabledCalls = (Object.keys(LLM_CALL_META) as LlmCallId[])
    .filter((id) => getCallSetting(config, id).enabled);

  return (
    <ModalShell title="AI 的信息与设定" icon={<Info size={16} className="text-slate-700 dark:text-slate-300" />} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        {/* 角色 */}
        <section className="rounded-xl p-4 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen size={13} className="text-slate-700 dark:text-slate-300" />
            <h4 className="font-semibold text-gray-800 dark:text-gray-100">角色人设</h4>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            <span className="font-medium">{character?.name || '未选择角色'}</span>
            {character?.personality ? `：${character.personality}` : ''}
          </p>
          {character?.catchphrases?.length ? (
            <p className="mt-1 text-[11px] text-gray-400">口头禅：{character.catchphrases.join('、')}</p>
          ) : null}
        </section>

        {/* 世界 */}
        <section className="rounded-xl p-4 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <Globe size={13} className="text-slate-700 dark:text-slate-300" />
            <h4 className="font-semibold text-gray-800 dark:text-gray-100">世界设定包</h4>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">当前生效：{worldName || '…'}</p>
          <p className="mt-1 text-[11px] text-gray-400">世界包决定活动地点与规则边界；可在「状态与生活」页导入自定义包。</p>
        </section>

        {/* 引擎与生成 */}
        <section className="rounded-xl p-4 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <Cpu size={13} className="text-slate-700 dark:text-slate-300" />
            <h4 className="font-semibold text-gray-800 dark:text-gray-100">生活引擎</h4>
            <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full ${config?.enabled ? 'bg-slate-200 dark:bg-slate-800/40 text-slate-800 dark:text-slate-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
              {config?.enabled ? '运行中' : '未开启'}
            </span>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">
            已启用的生成项：{enabledCalls.length > 0 ? enabledCalls.map((id) => LLM_CALL_META[id].label).join('、') : '无（可在生成设置中开启）'}
          </p>
        </section>

        {/* 当前状态 */}
        <section className="rounded-xl p-4 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <Wallet size={13} className="text-slate-700 dark:text-slate-300" />
            <h4 className="font-semibold text-gray-800 dark:text-gray-100">当前状态</h4>
          </div>
          {attrs ? (
            <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              健康 {attrs.health} · 体力 {attrs.stamina} · 饱腹 {attrs.satiety} · 饮水 {attrs.thirst ?? 80} · 清洁 {attrs.cleanliness} · 精神 {attrs.spirit} · 压力 {attrs.stress}
            </p>
          ) : (
            <p className="text-xs text-gray-400">暂无状态记录——开启引擎并推进活动后生成。</p>
          )}
          {economy && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">钱包余额：¥{economy.balance.toFixed(2)}</p>
          )}
        </section>

        {/* 生活档案 + 导出 / AI 优化 */}
        <LifeProfileSection characterId={characterId} />
      </div>
    </ModalShell>
  );
}

/** 生活档案展示 + 导出设定 + AI 优化设定 */
function LifeProfileSection({ characterId }: { characterId?: string }) {
  const config = useAiLifeStore((s) => s.config);
  const character = useCharacterStore((s) => s.characters.find((c) => c.id === s.selectedCharacterId));
  const profile = (config?.extra as { profile?: { job?: string; routine?: string } } | undefined)?.profile;
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeResult, setOptimizeResult] = useState('');
  const [exported, setExported] = useState(false);

  const handleExport = async () => {
    if (!characterId) return;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await save({
        defaultPath: `${character?.name || 'character'}-ailife.json`,
        filters: [{ name: 'AI 一日生活设定', extensions: ['json'] }],
      });
      if (!path) return;
      const payload = {
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        character: { name: character?.name, personality: character?.personality, background: character?.background, catchphrases: character?.catchphrases },
        profile: profile || {},
        engine: {
          enabled: config?.enabled,
          contentLevel: config?.contentLevel,
          eventFrequency: config?.eventFrequency,
          llmCalls: (config?.extra as { llmCalls?: unknown } | undefined)?.llmCalls || {},
        },
        worldId: (config?.extra as { worldId?: string } | undefined)?.worldId,
        prompts: {
          schedule: '基于人设+职业作息+世界包生成 JSON 日程；今天模式禁止超前时段（开始时间必须早于当前时刻）',
          nextActivity: '空闲续写：单个活动 JSON，30-120 分钟，深夜安排睡觉',
          diary: '第一人称日记：标题+正文，回顾全天活动与用户互动',
          emotionShift: '回顾今天经历与聊天 → JSON{mood,reason,activityName,category,description}',
        },
      };
      await writeTextFile(path, JSON.stringify(payload, null, 2));
      setExported(true);
      setTimeout(() => setExported(false), 2500);
    } catch { /* 静默 */ }
  };

  const handleOptimize = async () => {
    if (!characterId || !character || optimizing) return;
    setOptimizing(true);
    setOptimizeResult('');
    try {
      const prompt = `你是设定优化助手。请根据以下信息，优化角色的「AI 一日生活」档案。
角色：${character.name}（人设：${character.personality || ''}；背景：${character.background || ''}）
当前档案：职业=${profile?.job || '未设置'}；作息=${profile?.routine || '未设置'}

输出 JSON（只输出 JSON 本身）：
{"job":"优化后的职业/身份（10字内，更贴合人设）","routine":"优化后的作息说明（40字内，具体到时间段）"}`;
      const out = await runAilifeLlm('schedule', characterId, prompt, 260);
      const m = out.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('AI 未返回有效结果');
      const parsed = JSON.parse(m[0]) as { job?: string; routine?: string };
      const job = typeof parsed.job === 'string' && parsed.job.trim() ? parsed.job.trim().slice(0, 14) : profile?.job || '';
      const routine = typeof parsed.routine === 'string' && parsed.routine.trim() ? parsed.routine.trim().slice(0, 60) : profile?.routine || '';
      const cfg = await dbGetAiLifeConfig(characterId);
      const mergedProfile = { ...readLifeProfile(cfg), job, routine };
      const mergedExtra = { ...(cfg.extra || {}), profile: mergedProfile };
      await dbSaveAiLifeConfig({ ...cfg, extra: mergedExtra, updatedAt: new Date().toISOString() });
      // 同步内存中的 config，让界面立即反映
      useAiLifeStore.setState({ config: { ...cfg, extra: mergedExtra } });
      setOptimizeResult(`已更新：${job}｜${routine}`);
    } catch (e) {
      setOptimizeResult(`优化失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <section className="rounded-xl p-4 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-2">
        <Home size={13} className="text-slate-700 dark:text-slate-300" />
        <h4 className="font-semibold text-gray-800 dark:text-gray-100">生活档案</h4>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={handleExport} disabled={!characterId}
            className="text-[10px] px-2 py-1 rounded-full border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-slate-500 hover:text-slate-700 transition-colors disabled:opacity-40">
            {exported ? '已导出 ✓' : '导出设定'}
          </button>
          <button onClick={handleOptimize} disabled={!characterId || optimizing}
            className="text-[10px] px-2 py-1 rounded-full border border-slate-300 dark:border-slate-900 text-slate-700 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/20 transition-colors disabled:opacity-40 inline-flex items-center gap-1">
            {optimizing ? <><Loader2 size={10} className="animate-spin" />AI 优化中…</> : <><Sparkles size={10} />AI 优化</>}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-300">职业：{profile?.job || '未设置'}</p>
      <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">作息：{profile?.routine || '未设置'}</p>
      {optimizeResult && <p className="text-[10px] text-slate-700 dark:text-slate-300 mt-1.5">{optimizeResult}</p>}
      <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
        导出包含角色档案、引擎配置与 prompt 说明；AI 优化会按人设重写职业与作息（可在角色管理面板手动修改）。
      </p>
    </section>
  );
}

// ---------------- ③ LLM 生成总控面板 ----------------

const DETAIL_OPTIONS: { value: LlmDetail; label: string }[] = [
  { value: 'concise', label: '简洁' },
  { value: 'standard', label: '标准' },
  { value: 'detailed', label: '详细' },
];

const PRESETS: { level: string; label: string }[] = [
  { level: 'off', label: '关闭全部' },
  { level: 'minimal', label: '极简' },
  { level: 'simplified', label: '标准' },
  { level: 'full', label: '完整' },
];

export function LlmSettingsModal({ onClose }: { onClose: () => void }) {
  const config = useAiLifeStore((s) => s.config);
  const updateConfig = useAiLifeStore((s) => s.updateConfig);
  const [draft, setDraft] = useState<LlmCallsMap>({});

  useEffect(() => {
    if (!config) return;
    const map: LlmCallsMap = {};
    for (const id of Object.keys(LLM_CALL_META) as LlmCallId[]) {
      map[id] = getCallSetting(config, id);
    }
    setDraft(map);
  }, [config]);

  if (!config) return null;

  const applyPreset = (level: string) => {
    const map: LlmCallsMap = { ...presetCalls(level) };
    setDraft(map);
    updateConfig({
      contentLevel: level,
      extra: { ...(config.extra || {}), llmCalls: map },
    });
  };

  const persist = (next: LlmCallsMap, contentLevel?: string) => {
    setDraft(next);
    updateConfig({
      ...(contentLevel ? { contentLevel } : {}),
      extra: { ...(config.extra || {}), llmCalls: next },
    });
  };

  const toggle = (id: LlmCallId) => {
    const cur = draft[id] || { enabled: false, detail: 'standard' as LlmDetail };
    persist({ ...draft, [id]: { ...cur, enabled: !cur.enabled } });
  };

  const setDetail = (id: LlmCallId, detail: LlmDetail) => {
    const cur = draft[id] || { enabled: true, detail: 'standard' as LlmDetail };
    persist({ ...draft, [id]: { ...cur, detail } });
  };

  return (
    <ModalShell title="生成设置" icon={<Settings2 size={16} className="text-slate-700 dark:text-slate-300" />} onClose={onClose} wide>
      {/* 一键预设 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">一键预设：</span>
        {PRESETS.map((p) => (
          <button key={p.level} onClick={() => applyPreset(p.level)}
            className="text-[11px] px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-slate-500 hover:text-slate-700 dark:hover:text-slate-500 transition-colors">
            {p.label}
          </button>
        ))}
      </div>
      {/* 调用项列表 */}
      <div className="space-y-2">
        {(Object.keys(LLM_CALL_META) as LlmCallId[]).map((id) => {
          const setting = draft[id] || { enabled: false, detail: 'standard' as LlmDetail };
          return (
            <div key={id} className={`rounded-xl border p-3 transition-colors ${setting.enabled ? 'border-slate-300 dark:border-slate-900/60 bg-slate-100/40 dark:bg-slate-800/10' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40'}`}>
              <div className="flex items-center gap-2">
                <button onClick={() => toggle(id)} title={setting.enabled ? '点击关闭' : '点击开启'}
                  className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${setting.enabled ? 'bg-slate-700' : 'bg-gray-300 dark:bg-gray-600'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${setting.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-100">{LLM_CALL_META[id].label}</p>
                  <p className="text-[10px] text-gray-400 truncate">{LLM_CALL_META[id].desc}</p>
                </div>
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {DETAIL_OPTIONS.map((d) => (
                    <button key={d.value} onClick={() => setDetail(id, d.value)}
                      className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${setting.detail === d.value ? 'bg-slate-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-gray-400 leading-relaxed">
        关闭某项后，对应功能自动降级为本地模板文案（零 token 消耗）；详细度影响生成内容的篇幅与细节。
      </p>
    </ModalShell>
  );
}

// ---------------- ④ 删除三选一 ----------------

export type DeleteScope = 'activities' | 'diary' | 'all';

export function DeleteScopeModal({ date, onConfirm, onClose }: {
  date: string;
  onConfirm: (scope: DeleteScope) => void;
  onClose: () => void;
}) {
  const options: { scope: DeleteScope; label: string; desc: string }[] = [
    { scope: 'activities', label: '仅删除一日活动', desc: '清空这一天的时间线安排，保留日记' },
    { scope: 'diary', label: '仅删除日记', desc: '只删 AI 写的日记正文，活动安排保留' },
    { scope: 'all', label: '全部删除', desc: '这一天的活动与日记全部清除，并重置属性和生活状态（若是今天）' },
  ];
  return (
    <ModalShell title={`删除 ${date} 的记录`} icon={<Trash2 size={16} className="text-red-500" />} onClose={onClose}>
      <div className="space-y-2">
        {options.map((o) => (
          <button key={o.scope} onClick={() => { onConfirm(o.scope); onClose(); }}
            className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50/60 dark:hover:bg-red-900/15 transition-colors">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{o.label}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{o.desc}</p>
          </button>
        ))}
      </div>
    </ModalShell>
  );
}

// ---------------- ⑤ 记账模态框（开销 / 补财产 + AI 回复） ----------------

export interface LedgerSubmit {
  type: 'expense' | 'income';
  name: string;
  amount: number;
  note: string;
  reply: string;
}

export function LedgerModal({ type, characterId, onSubmit, onClose }: {
  type: 'expense' | 'income';
  characterId: string;
  /** 提交完成（含 AI 回复），父组件刷新流水 */
  onSubmit: (entry: LedgerSubmit) => void;
  onClose: () => void;
}) {
  const character = useCharacterStore((s) => s.characters.find((c) => c.id === characterId));
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');

  const canSubmit = name.trim() && Number(amount) > 0 && !replying && !reply;

  const submit = async () => {
    if (!canSubmit) return;
    setReplying(true);
    setError('');
    const amt = Math.round(Number(amount) * 100) / 100;
    try {
      // 1) AI 感想回复（关闭/失败时用兜底文案）
      let aiReply = '';
      try {
        const prompt = `你是「${character?.name || '角色'}」（人设：${character?.personality || ''}）。
你刚刚${type === 'expense' ? `花了一笔钱：${name.trim()}，${amt}元` : `进账一笔：${name.trim()}，${amt}元`}。
${note.trim() ? `用户对这笔账说：「${note.trim()}」` : ''}
请用第一人称对这笔账做一句自然的感想回复（30字以内，符合性格，口语化）。直接输出回复本身。`;
        aiReply = await runAilifeLlm('ledgerReply', characterId, prompt, 120);
      } catch {
        aiReply = type === 'expense' ? '记下了，这笔花得值不值回头再评估。' : '收到，小金库又厚了一点。';
      }

      // 2) 更新余额
      const { dbGetAiEconomy, dbSaveAiEconomy } = await import('../../lib/tauriBridge');
      const economy = await dbGetAiEconomy(characterId);
      if (economy) {
        const delta = type === 'income' ? amt : -amt;
        await dbSaveAiEconomy({
          ...economy,
          balance: Math.max(0, Math.round((economy.balance + delta) * 100) / 100),
          updatedAt: new Date().toISOString(),
        });
      }

      // 3) 写流水（AI 回复拼进 description 持久化）
      const tx: AiTransaction = {
        id: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        characterId,
        type,
        amount: amt,
        description: `${name.trim()}${note.trim() ? `｜想说：${note.trim()}` : ''}｜AI：${aiReply}`,
        timestamp: new Date().toISOString(),
      };
      await dbAddAiTransaction(tx);

      setReply(aiReply);
      onSubmit({ type, name: name.trim(), amount: amt, note: note.trim(), reply: aiReply });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplying(false);
    }
  };

  return (
    <ModalShell
      title={type === 'expense' ? '记一笔开销' : '补一笔财产'}
      icon={<Wallet size={16} className="text-slate-700 dark:text-slate-300" />}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">什么东西</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!!reply}
            placeholder={type === 'expense' ? '例如：一把新雨伞' : '例如：这个月工资'}
            className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">多少钱</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">¥</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} disabled={!!reply}
              inputMode="decimal" placeholder="0.00"
              className="w-full pl-7 pr-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">想说什么（可选）</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={!!reply} rows={2}
            placeholder="对这笔账说点什么，AI 会回应你…"
            className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-500 resize-none" />
        </div>

        {/* AI 回复气泡 */}
        <AnimatePresence>
          {(reply || replying) && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="flex items-start gap-2">
              <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800/30 flex items-center justify-center text-[10px] font-medium text-slate-700 shrink-0">AI</div>
              <div className="flex-1 rounded-2xl rounded-tl-sm px-3 py-2 bg-slate-100 dark:bg-slate-800/20 border border-slate-200 dark:border-slate-900/40">
                {replying ? (
                  <span className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                    <Loader2 size={11} className="animate-spin" />正在想对你说什么…
                  </span>
                ) : (
                  <p className="text-xs text-slate-800 dark:text-slate-400 leading-relaxed" style={{ fontFamily: HAND_FONT }}>{reply}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          {!reply ? (
            <>
              <button onClick={submit} disabled={!canSubmit}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-40 ${type === 'expense' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-slate-700 hover:bg-slate-700'}`}>
                <span className="inline-flex items-center justify-center gap-1.5">
                  {type === 'expense' ? <ArrowDownCircle size={14} /> : <ArrowUpCircle size={14} />}
                  确认记账
                </span>
              </button>
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                取消
              </button>
            </>
          ) : (
            <button onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-700 text-white text-sm font-medium transition-colors">
              完成
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------- ⑥ AI 初始创建（一键生成生活档案+初始家当） ----------------

const INIT_STEPS = [
  'AI 阅读角色人设，构思生活档案',
  '写入职业、作息与初始存款',
  '置办初始物资（食材/衣物/药品）',
  '生成今天的生活安排',
];

export function InitialCreateModal({ characterId, onClose, onDone }: {
  characterId: string;
  onClose: () => void;
  /** 全部完成后回调（父组件负责触发生成今日计划并刷新） */
  onDone: () => void;
}) {
  const character = useCharacterStore((s) => s.characters.find((c) => c.id === characterId));
  const [running, setRunning] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1); // -1 = 未开始
  const [result, setResult] = useState<LifeProfileInit | null>(null);
  const [error, setError] = useState('');

  const start = async () => {
    setRunning(true);
    setError('');
    try {
      // 1) AI 生成档案
      setStepIdx(0);
      const profile = await generateInitialProfile(character || { id: characterId, name: '角色' } as Parameters<typeof generateInitialProfile>[0]);

      // 2) 写入档案 + 标记已初始化
      setStepIdx(1);
      const cfg = await dbGetAiLifeConfig(characterId);
      // 🆕 B6.4: 设定包匹配——角色名/人设关键词命中内置或已有世界包（≥2 分）→ 自动继承
      let worldPatch: Record<string, unknown> = {};
      try {
        const { matchWorldForCharacter } = await import('../../services/ailife/worldConfig');
        const matched = await matchWorldForCharacter({
          name: character?.name,
          personality: character?.personality,
          background: character?.background,
        });
        if (matched) {
          worldPatch = { worldId: matched.world.id };
          useDebugLog.getState().add('ailife', `[AI一日] 设定包匹配：「${character?.name}」→「${matched.world.name}」（得分 ${matched.score}）`, { characterId });
        }
      } catch { /* ignore */ }
      await dbSaveAiLifeConfig({
        ...cfg,
        enabled: true,
        extra: {
          ...(cfg.extra || {}),
          initialized: true,
          ...worldPatch,
          profile: { ...readLifeProfile(cfg), job: profile.job, routine: profile.routine },
        },
        updatedAt: new Date().toISOString(),
      });
      // 初始存款：仅在无钱包记录时写入，避免覆盖
      const economy = await dbGetAiEconomy(characterId);
      if (!economy) {
        const initEconomy: AiEconomy = {
          characterId,
          balance: profile.balance,
          monthlyIncome: 0,
          monthlyExpense: 0,
          lastPayday: '',
          updatedAt: new Date().toISOString(),
        };
        await dbSaveAiEconomy(initEconomy);
        await dbAddAiTransaction({
          id: `tx_${Date.now().toString(36)}`,
          characterId,
          type: 'income',
          amount: profile.balance,
          description: `初始家当｜AI：这是${character?.name || '我'}的全部家当啦。`,
          timestamp: new Date().toISOString(),
        });
      }

      // 3) 置办初始物资（🆕 B2.3: 先铺确定性基线（大米粮油/水/药/衣物），再落 AI 个性化采购（跳过重名））
      setStepIdx(2);
      const existing = await dbGetAiInventory(characterId);
      const existingNames = new Set(existing.map((i) => i.name));
      const newItems: AiInventoryItem[] = [];

      // 3a) 条件基线（性别/季节过滤，商店目录内选品，耐用品自动标记）
      //     Character 类型暂无 gender 字段 → 从用户画像/人设关键词推断，缺省不限
      const genderHint = /女|她|女生|少女|女性/.test(character?.personality || '') || /女|她/.test(character?.background || '')
        ? 'female' : undefined;
      const baselinePicks = buildBaselinePicks({ gender: genderHint });
      const baselineItems = buildInventoryItems(characterId, baselinePicks)
        .filter((it) => !existingNames.has(it.name));
      for (const it of baselineItems) existingNames.add(it.name);
      newItems.push(...baselineItems);

      // 3b) AI 个性化采购（从人设推导；目录外物品由生成器白名单保证）
      newItems.push(...profile.items
        .filter((it) => !existingNames.has(it.name))
        .map((it) => ({
          id: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${Math.random().toString(36).slice(2, 4)}`,
          characterId,
          category: it.category,
          name: it.name,
          quantity: it.quantity,
          quality: 'good',
          extra: { note: 'AI 初始创建置办' },
          updatedAt: new Date().toISOString(),
        })));
      if (newItems.length > 0) await dbSaveAiInventoryItems(newItems);

      // 3c) 🆕 B4: 性格三参数落库（数据覆盖总开关关闭时仍保存，启用后即生效）
      try {
        const { useFeatureModuleStore } = await import('../../store/featureModuleStore');
        useFeatureModuleStore.getState().setDataOverride({ personality: profile.personality });
      } catch { /* ignore */ }

      setResult(profile);
      setStepIdx(3);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <ModalShell title="AI 初始创建" icon={<Home size={16} className="text-slate-700 dark:text-slate-300" />} onClose={onClose} wide>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
        首次使用的推荐步骤：AI 会阅读「{character?.name || '角色'}」的人设，自动完成生活档案（职业/作息）、
        初始存款与家中物资的设定，然后安排今天的生活。全程无需手动填写。
      </p>

      <div className="space-y-2 mb-4">
        {INIT_STEPS.map((label, i) => {
          const done = result !== null || (stepIdx > i);
          const active = running && stepIdx === i;
          return (
            <div key={label} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border transition-colors ${
              done ? 'border-slate-300 dark:border-slate-900/60 bg-slate-100/50 dark:bg-slate-800/10'
                : active ? 'border-slate-400 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/20'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40'
            }`}>
              {done ? <Check size={13} className="text-slate-700 dark:text-slate-300 shrink-0" />
                : active ? <Loader2 size={13} className="text-slate-700 dark:text-slate-300 animate-spin shrink-0" />
                  : <Circle size={13} className="text-gray-300 dark:text-gray-600 shrink-0" />}
              <span className={done || active ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400'}>{label}</span>
            </div>
          );
        })}
      </div>

      {/* 档案结果 */}
      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-3 bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 space-y-1 mb-4">
          <p><span className="text-gray-400">职业：</span>{result.job}</p>
          <p><span className="text-gray-400">作息：</span>{result.routine}</p>
          <p><span className="text-gray-400">初始存款：</span>¥{result.balance.toFixed(2)}</p>
          <p><span className="text-gray-400">置办物资：</span>{result.items.map((i) => `${i.name}×${i.quantity}`).join('、')}</p>
        </motion.div>
      )}

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      <div className="flex gap-2">
        {!result ? (
          <>
            <button onClick={start} disabled={running}
              className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-700 text-white text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
              {running ? <><Loader2 size={14} className="animate-spin" />AI 正在设定…</> : <><Sparkles size={14} />开始 AI 初始创建</>}
            </button>
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
              稍后再说
            </button>
          </>
        ) : (
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-700 hover:bg-slate-700 text-white text-sm font-medium transition-colors">
            完成，去看看 AI 的一天
          </button>
        )}
      </div>
    </ModalShell>
  );
}


/** 🆕 可滚动标签行：箭头常驻（并排不遮挡）+ 内容变化自动重算 */
function ChipScrollRow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return undefined;
    // 🆕 监听子节点变化：切换分类或标签后立即重算箭头状态
    const mo = new MutationObserver(() => update());
    mo.observe(el, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    const t1 = setTimeout(update, 150);
    const t2 = setTimeout(update, 600);
    return () => {
      mo.disconnect();
      window.removeEventListener('resize', update);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [update]);

  const scrollBy = (dx: number) => ref.current?.scrollBy({ left: dx, behavior: 'smooth' });

  return (
    <div className={`flex items-center gap-1 min-w-0 ${className}`}>
      {/* 左箭头（并排，不遮挡内容；到边缘置灰） */}
      <button
        onClick={() => canLeft && scrollBy(-140)}
        title="向左滚动"
        className={`shrink-0 w-5 h-5 rounded-full bg-white dark:bg-gray-700 shadow-sm border border-gray-200 dark:border-gray-600 flex items-center justify-center text-[10px] leading-none transition-opacity ${
          canLeft ? 'text-slate-600 dark:text-gray-200 opacity-100 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 opacity-40 cursor-default'
        }`}
      >
        ‹
      </button>
      <div ref={ref} onScroll={update} className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide whitespace-nowrap scroll-smooth min-w-0 flex-1">
        {children}
      </div>
      {/* 右箭头 */}
      <button
        onClick={() => canRight && scrollBy(140)}
        title="向右滚动"
        className={`shrink-0 w-5 h-5 rounded-full bg-white dark:bg-gray-700 shadow-sm border border-gray-200 dark:border-gray-600 flex items-center justify-center text-[10px] leading-none transition-opacity ${
          canRight ? 'text-slate-600 dark:text-gray-200 opacity-100 hover:bg-gray-100 dark:hover:bg-gray-600' : 'text-gray-300 dark:text-gray-600 opacity-40 cursor-default'
        }`}
      >
        ›
      </button>
    </div>
  );
}

// ---------------- 🆕 内置商店 ----------------

/** 🆕 弹层定位：portal 到 body 后按触发按钮实测摆放（下不够翻上、左右收拢），规避模态框/transform 裁剪 */
function useDropdownPos(open: boolean, btnRef: React.RefObject<HTMLElement | null>, estH = 200) {
  const [pos, setPos] = useState({ left: -9999, top: -9999, width: 260 });
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
      top: r.bottom + 6 + estH > window.innerHeight ? Math.max(8, r.top - estH - 6) : r.bottom + 6,
      width: Math.max(200, r.width),
    });
  }, [open, btnRef, estH]);
  return pos;
}

const DROPDOWN_LIST_CLS = 'max-h-40 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden';

export function TagPicker({ allTags, selected, onChange, placeholder = '选择或添加标签…', allowCustom = true }: {
  allTags: string[];
  selected: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  /** 是否允许「＋ 自定义标签」新增入口（默认允许） */
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const pos = useDropdownPos(open, btnRef, 220);

  const toggle = (t: string) =>
    selected.includes(t) ? onChange(selected.filter((x) => x !== t)) : onChange([...selected, t]);

  const addTag = () => {
    const v = input.trim();
    if (v && !selected.includes(v)) onChange([...selected, v]);
    setInput('');
    setAdding(false);
  };

  const customTags = selected.filter((t) => !allTags.includes(t));

  return (
    <div className="relative">
      {/* 触发器：与一级分类同款圆角胶囊 */}
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-full border bg-gray-50 dark:bg-gray-900/60 text-sm text-left transition-colors ${
          open ? 'border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-300' : 'border-gray-200 dark:border-gray-700'
        }`}
      >
        <span className={`truncate ${selected.length > 0 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}`}>
          {selected.length > 0 ? selected.join('、') : placeholder}
        </span>
        <ChevronDown size={13} className={`shrink-0 ml-2 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* 🆕 自定义输入：与一级同款——出现在触发器下方外部，下拉列表始终可重新打开 */}
      {adding && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } if (e.key === 'Escape') { setAdding(false); setInput(''); } }}
            placeholder="输入标签名称"
            className="flex-1 px-3 py-2 text-sm rounded-full border border-indigo-200 dark:border-indigo-700 bg-gray-50 dark:bg-gray-900/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button onClick={addTag}
            className="px-3 py-2 rounded-full bg-indigo-500 text-white text-xs hover:bg-indigo-600 transition-colors shrink-0">添加</button>
          <button onClick={() => { setAdding(false); setInput(''); }}
            className="px-2.5 py-2 rounded-full text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0">取消</button>
        </div>
      )}

      {/* 下拉面板：portal 到 body，fixed 实测定位不被模态框裁剪；样式与商店展开一致 */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[85]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[90] rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden animate-[fadeUp_0.16s_ease-out]"
            style={{ left: pos.left, top: pos.top, width: pos.width }}>
            <div className={DROPDOWN_LIST_CLS}>
              {selected.map((tag) => (
                <button key={`sel-${tag}`} onClick={() => toggle(tag)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left bg-indigo-50/60 dark:bg-indigo-900/20 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                  <span className="flex-1 truncate text-gray-800 dark:text-gray-100">{tag}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">✕ 移除</span>
                </button>
              ))}
              {allTags.filter((t) => !selected.includes(t)).map((tag) => (
                <button key={tag} onClick={() => toggle(tag)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{tag}</span>
                </button>
              ))}
              {customTags.map((tag) => (
                <button key={`cus-${tag}`} onClick={() => toggle(tag)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left bg-indigo-50/60 dark:bg-indigo-900/20 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors">
                  <span className="flex-1 truncate text-gray-800 dark:text-gray-100">{tag}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">✕ 移除</span>
                </button>
              ))}
            </div>
            {/* 自定义入口（点击后面板收起，外部输入框出现） */}
            {allowCustom && (
              <button onClick={() => { setAdding(true); setOpen(false); }}
                className="w-full px-3 py-2 text-left text-xs text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors border-t border-gray-100 dark:border-gray-700">
                ＋ 自定义标签…
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

/** 🆕 统一一级分类选择器：沿用二级标签（TagPicker）圆角胶囊设计，下拉 + 自定义新增（带「添加」按钮） */
export function CategoryPicker({ value, onChange, placeholder, allowCustom = true }: {
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  /** 是否允许"＋ 自定义分类"新增（默认允许） */
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const pos = useDropdownPos(open, btnRef, 200);

  const tabs = getAllCategoryTabs();
  const current = tabs.find((t) => t.key === value);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
  };

  const addCustom = () => {
    const v = input.trim();
    if (v) {
      const code = addCustomCategory(v);
      if (code) { onChange(code); setOpen(false); }
      setInput('');
      setAdding(false);
    }
  };

  return (
    <div className="relative">
      {/* 触发器：与二级标签同款圆角胶囊 */}
      <button
        ref={btnRef}
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-full border bg-gray-50 dark:bg-gray-900/60 text-sm text-left transition-colors ${
          open ? 'border-indigo-300 dark:border-indigo-700 ring-1 ring-indigo-300' : 'border-gray-200 dark:border-gray-700'
        }`}
      >
        <span className={`truncate ${current ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}`}>
          {current?.label || value || placeholder || '选择分类'}
        </span>
        <ChevronDown size={13} className={`shrink-0 ml-2 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* 自定义新增：与二级同款——触发器下方外部，输入 + 添加按钮 */}
      {allowCustom && adding && (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } if (e.key === 'Escape') { setAdding(false); setInput(''); } }}
            placeholder="输入新分类名称"
            className="flex-1 px-3 py-2 text-sm rounded-full border border-indigo-200 dark:border-indigo-700 bg-gray-50 dark:bg-gray-900/60 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button onClick={addCustom}
            className="px-3 py-2 rounded-full bg-indigo-500 text-white text-xs hover:bg-indigo-600 transition-colors shrink-0">添加</button>
          <button onClick={() => { setAdding(false); setInput(''); }}
            className="px-2.5 py-2 rounded-full text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors shrink-0">取消</button>
        </div>
      )}

      {/* 下拉面板：portal 到 body，fixed 实测定位不被模态框裁剪；样式与商店展开一致 */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[85]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[90] rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden animate-[fadeUp_0.16s_ease-out]"
            style={{ left: pos.left, top: pos.top, width: pos.width }}>
            <div className={DROPDOWN_LIST_CLS}>
              {tabs.map((t) => (
                <button key={t.key} onClick={() => pick(t.key)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                    t.key === value
                      ? 'bg-indigo-50/60 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}>
                  <span className="flex-1 truncate">{t.label}</span>
                  {t.key === value && <span className="text-[11px] text-indigo-400 shrink-0">✓</span>}
                </button>
              ))}
            </div>
            {allowCustom && (
              <button onClick={() => { setAdding(true); setOpen(false); }}
                className="w-full px-3 py-2 text-left text-xs text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors border-t border-gray-100 dark:border-gray-700">
                ＋ 自定义分类…
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}


/** 🆕 新增商品模态框：一级分类（可选/可自定义新增）+ 二级标签（可自定义） */
function AddShopItemModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const tabs = getAllCategoryTabs();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [desc, setDesc] = useState('');
  const [catKey, setCatKey] = useState(tabs[0]?.key || 'food');
  const [tags, setTags] = useState<string[]>([]);
  const [stock, setStock] = useState(true);
  const [error, setError] = useState('');

  const submit = () => {
    const n = name.trim();
    const p = parseFloat(price);
    if (!n) { setError('请填写商品名称'); return; }
    if (!Number.isFinite(p) || p < 0) { setError('请填写有效价格'); return; }
    addCustomShopItem({
      name: n,
      category: catKey, // 已由 CategoryPicker 直接解析为合法分类 code
      tags,
      price: p,
      description: desc.trim() || '自定义商品',
      stock,
    });
    onAdded();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 shadow-2xl p-5 max-h-[85vh] overflow-y-auto"
      >
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
          <Plus size={15} className="text-indigo-500" />新增商品
        </h3>
        <div className="space-y-3">
          {/* 一级分类：可选可自定义（与二级标签同款设计，带「添加」按钮） */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">类型（一级分类）</label>
            <CategoryPicker value={catKey} onChange={setCatKey} placeholder="选择或新增分类" />
          </div>
          {/* 名称 / 价格 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">商品名称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：蓝牙耳机"
                className="w-full px-3 py-2 text-sm rounded-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">价格 ¥</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min={0} placeholder="0"
                className="w-full px-3 py-2 text-sm rounded-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
          </div>
          {/* 二级标签：已有点选 + 自定义新增（TagPicker） */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">标签（二级）</label>
            <TagPicker
              allTags={Array.from(new Set(getAllShopItems().flatMap((e) => e.tags)))}
              selected={tags}
              onChange={setTags}
              placeholder="输入自定义标签，回车添加…"
            />
          </div>
          {/* 描述 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">描述（可选）</label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="一句话介绍"
              className="w-full px-3 py-2 text-sm rounded-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>
          {/* 入库开关 */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-gray-600 dark:text-gray-300">购买后入库（关闭 = 即时消耗）</span>
            <input type="checkbox" checked={stock} onChange={(e) => setStock(e.target.checked)}
              className="w-4 h-4 accent-indigo-500" />
          </label>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={!name.trim()}
              className="flex-1 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors disabled:opacity-40">
              添加到商店
            </button>
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
              取消
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export function ShopModal({ characterId, onClose, onPurchased }: {
  characterId: string;
  onClose: () => void;
  onPurchased?: () => void;
}) {
  const [cat, setCat] = useState<string>('all');
  const [balance, setBalance] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // 🆕 自定义商品：添加面板开关 + 版本号（新增后强制刷新目录）
  const [addOpen, setAddOpen] = useState(false);
  const [version, setVersion] = useState(0);
  // 🆕 显示货币：订阅全局（在钱包处选择，所有模块生效）
  const currency = useSyncExternalStore(subscribeDisplayCurrency, getDisplayCurrency);

  const reloadBalance = useCallback(() => {
    dbGetAiEconomy(characterId).then((e) => setBalance(e?.balance ?? 0)).catch(() => {});
  }, [characterId]);

  useEffect(() => { reloadBalance(); }, [reloadBalance]);


  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2400);
  }, []);

  const buy = async (entry: ShopEntry) => {
    setBusyId(entry.id);
    try {
      const r = await purchaseItem(characterId, entry, 1);
      if (r.ok) {
        flash(`${entry.name} 已购买（-${formatMoneyFromCNY(entry.price, currency)}）${r.comment ? ` ${r.comment.replace(/^AI：/, '')}` : ''}`);
        reloadBalance();
        onPurchased?.();
      } else {
        flash(r.reason || '购买失败');
      }
    } finally {
      setBusyId(null);
    }
  };

  const [activeTag, setActiveTag] = useState<string | null>(null);

  // 🆕 目录 = 内置 + 用户/AI 自定义（version 驱动刷新）
  void version;
  const catalog = getAllShopItems();
  const list = (cat === 'all' ? catalog : catalog.filter((e) => e.category === cat))
    .filter((e) => !activeTag || e.tags.includes(activeTag));
  const tabs = getAllCategoryTabs();
  // 🆕 标签体系：从目录聚合（当前分类内），点击筛选
  // 修复：剔除无区分性的标签——与分类同名的、以及当前范围内覆盖率 ≥90% 的
  //（如「数码」分类下每件都带「数码」标 → 该标在筛选行毫无意义）
  const scopeItems = cat === 'all' ? catalog : catalog.filter((e) => e.category === cat);
  const catLabel = cat === 'all' ? '' : resolveCategoryMeta(cat).label;
  const allTags = Array.from(new Set(scopeItems.flatMap((e) => e.tags))).filter((tag) => {
    if (catLabel && tag === catLabel) return false;
    const coverage = scopeItems.filter((e) => e.tags.includes(tag)).length / Math.max(1, scopeItems.length);
    return coverage < 0.9;
  });

  const changeCat = (key: string) => { setCat(key); setActiveTag(null); };

  return (
    <ModalShell title="商店" icon={<ShoppingBag size={16} className="text-slate-700 dark:text-slate-300" />} onClose={onClose} wide>
      <div className="flex items-center justify-between mb-2 gap-2">
        <ChipScrollRow className="flex-1">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => changeCat(t.key)}
              className={`text-[11px] px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${
                cat === t.key ? 'bg-slate-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}>
              {t.label}
            </button>
          ))}
        </ChipScrollRow>
        {/* 🆕 添加自定义商品 */}
        <button onClick={() => setAddOpen(true)} title="新增商品"
          className="shrink-0 w-6 h-6 rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-indigo-500 hover:border-indigo-400 flex items-center justify-center transition-colors">
          <Plus size={12} />
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {/* 🆕 货币在钱包处统一选择，商店订阅全局状态 */}
          {balance === null ? (
            <Skeleton className="w-20 h-4" />
          ) : (
            <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold tabular-nums">
              余额 {formatMoneyFromCNY(balance, currency, currency !== 'CNY')}
            </span>
          )}
        </div>
      </div>

      {/* 🆕 标签筛选行（左右滚动 + 渐隐箭头） */}
      {allTags.length > 0 && (
        <ChipScrollRow>
          <span className="text-[10px] text-gray-400 shrink-0">标签</span>
          <button onClick={() => setActiveTag(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors shrink-0 ${
              !activeTag ? 'bg-slate-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}>
            不限
          </button>
          {allTags.map((tag) => (
            <button key={tag} onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors shrink-0 ${
                activeTag === tag ? 'bg-slate-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}>
              {tag}
            </button>
          ))}
        </ChipScrollRow>
      )}

      <div className="max-h-[46vh] overflow-y-auto pr-1">
        <motion.div key={`${cat}-${activeTag}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }} className="space-y-1.5">
        {list.length === 0 && (
          <p className="text-[11px] text-gray-400 py-6 text-center">该筛选下暂无商品</p>
        )}
        {list.map((entry) => (
          <div key={entry.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-800">

            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                {entry.name}
                {(entry.isSet || entry.tags.includes('套装')) && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 align-middle">套装</span>}
                {!entry.stock && <span className="ml-1 text-[9px] text-gray-400">即时消耗</span>}
              </p>
              <p className="text-[10px] text-gray-400 truncate">{entry.description}</p>
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 tabular-nums shrink-0">
              {formatMoneyFromCNY(entry.price, currency)}
            </span>
            <button onClick={() => buy(entry)} disabled={busyId === entry.id}
              className="px-2.5 py-1 rounded-lg text-[11px] text-white bg-slate-700 hover:bg-slate-600 disabled:opacity-40 transition-colors shrink-0 inline-flex items-center gap-1">
              {busyId === entry.id ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
              购买
            </button>
          </div>
        ))}
        </motion.div>
      </div>

      <p className="text-[10px] text-gray-400 mt-3">
        生活自主运转中：日用品用完会自动补货、冰箱空了会买菜、每月发薪与添新衣——都可以在流水中看到记录。
        {currency !== 'CNY' && ' 账本以人民币（CNY）记录，价格按参考汇率换算显示。'}
      </p>
      {toast && (
        <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="mt-2 text-[11px] text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/40 rounded-lg px-3 py-2">
          {toast}
        </motion.p>
      )}
      {addOpen && (
        <AddShopItemModal
          onClose={() => setAddOpen(false)}
          onAdded={() => { setVersion((v) => v + 1); onPurchased?.(); }}
        />
      )}
    </ModalShell>
  );
}
