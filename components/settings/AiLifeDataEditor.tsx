/**
 * ============================================================
 * AI 一日数据编辑（功能模块 · 数据修改）
 * 直接手动修改生活引擎的数值类数据：
 *  - 属性数值（健康/体力/饱食/清洁/精神/压力，0-100）
 *  - 物资（从商店目录圆角多选添加，与 AI 一日商店同源）
 *  - 钱包余额（人民币基准，按显示货币汇率换算展示）
 * 数据写入 SQLite，与 AI 一日引擎/面板完全同源。
 * ============================================================
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Plus, RefreshCw, Trash2, Wallet, ChevronDown, Search, Check } from 'lucide-react';
import { useCharacterStore } from '../../store/characterStore';
import {
  dbGetAiAttributes, dbSaveAiAttributes, dbGetAiInventory, dbSaveAiInventoryItems,
  dbDeleteAiInventoryItem, dbGetAiEconomy, dbSaveAiEconomy,
  type AiLifeAttributes, type AiInventoryItem, type AiEconomy,
} from '../../lib/tauriBridge';
import { getAllShopItems, resolveCategoryMeta, type ShopEntry } from '../../services/ailife/localShop';
import { getDisplayCurrency, subscribeDisplayCurrency, formatMoneyFromCNY } from '../../services/ailife/currency';

const ATTR_FIELDS: Array<{ key: keyof AiLifeAttributes; label: string }> = [
  { key: 'health', label: '健康' },
  { key: 'stamina', label: '体力' },
  { key: 'satiety', label: '饱食' },
  { key: 'thirst', label: '饮水' },
  { key: 'cleanliness', label: '清洁' },
  { key: 'spirit', label: '精神' },
  { key: 'stress', label: '压力' },
];

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

const inputCls = "px-2 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-slate-500 transition-all";

/** 打开时按触发按钮定位弹层：先渲染后测量实际尺寸，放不下自动上翻、左右收拢 */
function useFixedPos(open: boolean) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useEffect(() => {
    if (!open) return;
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const ph = panelRef.current?.offsetHeight ?? 340;
    const pw = panelRef.current?.offsetWidth ?? 280;
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) {
      const above = r.top - ph - 6;
      top = above >= 8 ? above : Math.max(8, window.innerHeight - ph - 8);
    }
    const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    setPos({ left, top });
  }, [open]);
  return { btnRef, panelRef, pos };
}

/** 角色圆角下拉（自绘弹层，风格与其他板块一致） */
function CharacterDropdown({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const { btnRef, panelRef, pos } = useFixedPos(open);
  const current = options.find((c) => c.id === value);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex-1 h-[28px] px-3 rounded-full text-xs bg-white dark:bg-gray-900 border text-left inline-flex items-center justify-between gap-1 transition-all
          ${open ? 'border-violet-400 ring-2 ring-violet-400/25'
                 : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}
      >
        <span className="text-gray-700 dark:text-gray-300 truncate">{current?.name || '选择角色'}</span>
        <ChevronDown size={12} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* portal 到 body：规避 transform 祖先导致的 fixed 失效/裁剪 */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={panelRef} className="fixed z-50 w-[240px] max-h-[264px] overflow-y-auto py-1 rounded-xl border border-gray-100 dark:border-gray-800
            bg-white dark:bg-gray-900 shadow-xl shadow-black/10 animate-[fadeUp_0.15s_ease-out]
            [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            style={{ left: pos.left, top: pos.top }}>
            {options.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id); setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${
                  c.id === value ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <span className="truncate">{c.name}</span>
                {c.id === value && <Check size={11} />}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}

/** 🔧 物资栏配色（同名分组一眼可辨） */
const STORAGE_META: Record<string, { label: string; dot: string }> = {
  all: { label: '全部', dot: '' },
  food: { label: '冰箱', dot: 'bg-emerald-500' },
  clothing: { label: '衣柜', dot: 'bg-blue-500' },
  medicine: { label: '药箱', dot: 'bg-red-500' },
  tool: { label: '日用品', dot: 'bg-amber-500' },
  hobby: { label: '兴趣', dot: 'bg-violet-500' },
  home: { label: '家居', dot: 'bg-sky-500' },
  gift: { label: '礼物', dot: 'bg-pink-500' },
};

/** 分组彩色圆点徽章 */
function CategoryBadge({ category }: { category: string }) {
  const label = STORAGE_META[category]?.label || category;
  const dot = STORAGE_META[category]?.dot;
  return (
    <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0">
      {dot && <span className={`w-1 h-1 rounded-full ${dot}`} />}
      {label}
    </span>
  );
}

/** 商店目录多选弹层（物资添加入口，与 AI 一日商店同源） */
function ShopItemPicker({ onConfirm }: { onConfirm: (items: ShopEntry[]) => void }) {
  const [open, setOpen] = useState(false);
  const { btnRef, panelRef, pos } = useFixedPos(open);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const catalog = useRef(getAllShopItems());

  // 🔧 按物资栏（入库分类）过滤，而非商店原始分类
  const filtered = catalog.current.filter((e) => {
    if (tab !== 'all' && resolveCategoryMeta(e.category).invCategory !== tab) return false;
    if (!search.trim()) return true;
    return e.name.toLowerCase().includes(search.trim().toLowerCase()) || e.tags.some((t) => t.includes(search.trim()));
  });
  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const confirm = () => {
    const items = catalog.current.filter((e) => checked.has(e.id));
    if (items.length > 0) onConfirm(items);
    setChecked(new Set());
    setSearch('');
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(!open)}
        disabled={open}
        className="inline-flex items-center gap-1 h-[28px] px-3 rounded-full text-[11px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
          hover:border-violet-300 hover:text-violet-500 text-gray-500 transition-all active:scale-95"
      >
        <Plus size={11} /> 从商店添加
      </button>
      {/* portal 到 body：规避 transform 祖先导致的 fixed 失效/裁剪 */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            ref={panelRef}
            className="fixed z-50 w-[280px] p-3 rounded-xl border border-gray-100 dark:border-gray-800 space-y-2
            bg-white dark:bg-gray-900 shadow-xl shadow-black/10 animate-[fadeUp_0.15s_ease-out]"
            style={{ left: pos.left, top: pos.top }}>
            {/* 搜索 */}
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索商品名或标签…"
                className="w-full h-[28px] pl-7 pr-2.5 rounded-full text-[11px] bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700
                  focus:outline-none focus:ring-2 focus:ring-violet-400/40 transition-all"
              />
            </div>
            {/* 物资栏过滤（冰箱/衣柜/药箱/日用品/兴趣/家居/礼物） */}
            <div className="flex flex-wrap gap-1">
              {Object.entries(STORAGE_META).map(([key, m]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                    tab === key ? 'bg-slate-700 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {/* 商品列表（可多选） */}
            <div className="max-h-52 overflow-y-auto space-y-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {filtered.length === 0 && <p className="text-[11px] text-gray-400 py-3 text-center">没有匹配的商品</p>}
              {filtered.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                    checked.has(e.id) ? 'bg-violet-50 dark:bg-violet-900/30' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full border shrink-0 flex items-center justify-center transition-colors ${
                    checked.has(e.id) ? 'bg-slate-700 border-slate-700' : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {checked.has(e.id) && <Check size={9} className="text-white" strokeWidth={3} />}
                  </span>
                  <span className="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-200 truncate">{e.name}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0">¥{e.price}</span>
                </button>
              ))}
            </div>
            {/* 底部确认 */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-gray-400">已选 {checked.size} 项</span>
              <button
                type="button"
                onClick={confirm}
                disabled={checked.size === 0}
                className="px-4 h-[26px] rounded-full text-[11px] text-white bg-slate-700 hover:bg-slate-600 disabled:opacity-40 transition-all active:scale-95"
              >
                添加所选
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

export function AiLifeDataEditorSection() {
  const characters = useCharacterStore((s) => s.characters);
  const globalSelectedId = useCharacterStore((s) => s.selectedCharacterId);
  const [charId, setCharId] = useState(globalSelectedId || characters[0]?.id || '');

  const [attrs, setAttrs] = useState<AiLifeAttributes | null>(null);
  const [inventory, setInventory] = useState<AiInventoryItem[]>([]);
  const [economy, setEconomy] = useState<AiEconomy | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  // 🔧 汇率对齐：跟随 AI 一日模块的显示货币设置
  const [displayCur, setDisplayCur] = useState(getDisplayCurrency());
  useEffect(() => subscribeDisplayCurrency(() => setDisplayCur(getDisplayCurrency())), []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2000);
  }, []);

  const reload = useCallback(async () => {
    if (!charId) return;
    setLoading(true);
    try {
      let inv = await dbGetAiInventory(charId);
      // 🔧 清理历史遗留的数量为0的物资（与生活面板显示口径一致）
      const dead = inv.filter((i) => (Number(i.quantity) || 0) <= 0);
      if (dead.length > 0) {
        await Promise.all(dead.map((d) => dbDeleteAiInventoryItem(d.id).catch(() => {})));
        inv = inv.filter((i) => (Number(i.quantity) || 0) > 0);
      }
      const [a, eco] = await Promise.all([
        dbGetAiAttributes(charId),
        dbGetAiEconomy(charId),
      ]);
      setAttrs(a);
      setInventory(inv);
      setEconomy(eco);
    } finally {
      setLoading(false);
    }
  }, [charId]);

  useEffect(() => { reload(); }, [reload]);

  /* ---------- 属性 ---------- */
  const saveAttrs = async () => {
    if (!attrs || !charId) return;
    const clamped = { ...attrs };
    for (const f of ATTR_FIELDS) {
      (clamped as Record<string, unknown>)[f.key] = Math.max(0, Math.min(100, Number(clamped[f.key]) || 0));
    }
    await dbSaveAiAttributes({
      ...clamped,
      characterId: charId,
      timestamp: new Date().toISOString(),
      id: genId('attr'),
      reason: '手动修改（功能模块）',
    }).catch(() => {});
    flash('属性已保存');
    reload();
  };

  /* ---------- 物资 ---------- */
  const updateItemQty = async (item: AiInventoryItem, delta: number) => {
    const next = Math.max(0, (Number(item.quantity) || 0) + delta);
    const updated: AiInventoryItem = { ...item, quantity: next, updatedAt: new Date().toISOString() };
    if (next === 0) {
      await dbDeleteAiInventoryItem(item.id).catch(() => {});
      setInventory((prev) => prev.filter((i) => i.id !== item.id));
    } else {
      await dbSaveAiInventoryItems([updated]).catch(() => {});
      setInventory((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    }
  };

  const removeItem = async (item: AiInventoryItem) => {
    await dbDeleteAiInventoryItem(item.id).catch(() => {});
    setInventory((prev) => prev.filter((i) => i.id !== item.id));
    flash(`已删除「${item.name}」`);
  };

  /** 🔧 从商店目录批量添加（同名物资自动叠加数量） */
  const addFromCatalog = async (entries: ShopEntry[]) => {
    if (!charId) return;
    let addedNew = 0;
    const merged = [...inventory];
    const toPersist: AiInventoryItem[] = [];
    for (const entry of entries) {
      const invCategory = resolveCategoryMeta(entry.category).invCategory;
      const existIdx = merged.findIndex((i) => i.name === entry.name);
      if (existIdx >= 0) {
        const updated: AiInventoryItem = { ...merged[existIdx], quantity: (merged[existIdx].quantity || 0) + 1, updatedAt: new Date().toISOString() };
        merged[existIdx] = updated;
        toPersist.push(updated);
      } else {
        const item: AiInventoryItem = {
          id: genId('inv'),
          characterId: charId,
          category: invCategory,
          name: entry.name,
          quantity: 1,
          quality: 'normal',
          extra: {},
          updatedAt: new Date().toISOString(),
        };
        merged.push(item);
        toPersist.push(item);
        addedNew += 1;
      }
    }
    await dbSaveAiInventoryItems(toPersist).catch(() => {});
    setInventory(merged);
    flash(`已添加 ${entries.length} 项${addedNew < entries.length ? `（新增 ${addedNew}，叠加 ${entries.length - addedNew}）` : ''}`);
  };

  /* ---------- 钱包 ---------- */
  const saveBalance = async () => {
    if (!economy || !charId) return;
    const next: AiEconomy = {
      ...economy,
      characterId: charId,
      balance: Math.round((Number(economy.balance) || 0) * 100) / 100,
      updatedAt: new Date().toISOString(),
    };
    await dbSaveAiEconomy(next).catch(() => {});
    flash('余额已保存');
    reload();
  };

  if (characters.length === 0) {
    return <p className="text-xs text-gray-400 py-2 text-center">还没有角色，先去创建一个吧</p>;
  }

  return (
    <div className="space-y-3">
      {/* 角色选择（圆角下拉） */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">角色</span>
        <CharacterDropdown value={charId} onChange={setCharId} options={characters.map((c) => ({ id: c.id, name: c.name }))} />
        <button onClick={reload} title="重新加载"
          className="p-1.5 rounded-lg text-gray-400 hover:text-slate-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && !attrs && (
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-gray-400">
          <Loader2 size={13} className="animate-spin" />加载中…
        </div>
      )}

      {/* 属性数值 */}
      {attrs && (
        <div className="p-3 bg-gray-50/50 dark:bg-gray-800/30 rounded-xl space-y-2">
          <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">属性数值（0-100）</p>
          <div className="grid grid-cols-3 gap-2">
            {ATTR_FIELDS.map((f) => (
              <label key={String(f.key)} className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-400">{f.label}</span>
                <input
                  type="number" min={0} max={100}
                  value={Number(attrs[f.key]) || 0}
                  onChange={(e) => setAttrs({ ...attrs, [f.key]: Number(e.target.value) } as AiLifeAttributes)}
                  className={`${inputCls} text-center font-mono`}
                />
              </label>
            ))}
          </div>
          <button onClick={saveAttrs}
            className="w-full px-3 py-1.5 rounded-xl text-xs text-white bg-slate-700 hover:bg-slate-600 transition-all active:scale-95 disabled:opacity-40"
            disabled={loading}>
            保存属性
          </button>
        </div>
      )}

      {/* 钱包余额（汇率对齐 AI 一日显示货币） */}
      {economy && (
        <div className="p-3 bg-gray-50/50 dark:bg-gray-800/30 rounded-xl space-y-2">
          <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300 flex items-center gap-1">
            <Wallet size={11} className="text-slate-700 dark:text-slate-300" />钱包余额
            <span className="ml-auto text-[10px] font-normal text-gray-400">按 {displayCur} 显示 ≈ {formatMoneyFromCNY(Number(economy.balance) || 0, displayCur)}</span>
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 shrink-0">¥</span>
            <input
              type="number" step="0.01"
              value={economy.balance}
              onChange={(e) => setEconomy({ ...economy, balance: Number(e.target.value) })}
              className={`${inputCls} flex-1 font-mono`}
            />
            <button onClick={saveBalance} disabled={loading}
              className="px-3 py-1.5 rounded-xl text-xs text-white bg-slate-700 hover:bg-slate-600 transition-all active:scale-95 disabled:opacity-40">
              保存
            </button>
          </div>
          <p className="text-[10px] text-gray-400">输入为人民币基准；折算由 AI 一日货币模块统一处理</p>
        </div>
      )}

      {/* 物资 */}
      <div className="p-3 bg-gray-50/50 dark:bg-gray-800/30 rounded-xl space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">物资（{inventory.length}）</p>
          <ShopItemPicker onConfirm={addFromCatalog} />
        </div>
        {/* 按7种物品栏分组排版（与生活面板容器一一对应） */}
        <div className="space-y-2 max-h-64 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {inventory.length === 0 && <p className="text-[11px] text-gray-400 py-1 text-center">暂无物资，点击右上角「从商店添加」</p>}
          {Object.entries(STORAGE_META)
            .filter(([key]) => key !== 'all')
            .map(([key, meta]) => {
              const items = inventory.filter((i) => i.category === key);
              return (
                <div key={key}>
                  <p className="flex items-center gap-1.5 px-0.5 pb-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400">
                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                    {meta.label}
                    <span className="text-gray-300 dark:text-gray-600 tabular-nums">{items.length}</span>
                  </p>
                  {items.length > 0 ? (
                    <div className="space-y-1 pl-3 border-l-2 border-gray-100 dark:border-gray-800 ml-1">
                      {items.map((item) => (
                        <div key={item.id} className="flex items-center gap-1.5 group">
                          <span className="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-200 truncate">{item.name}</span>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button onClick={() => updateItemQty(item, -1)}
                              className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs leading-none hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">−</button>
                            <span className="w-7 text-center text-xs font-mono text-gray-700 dark:text-gray-200">{item.quantity}</span>
                            <button onClick={() => updateItemQty(item, 1)}
                              className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs leading-none hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">+</button>
                          </div>
                          <button onClick={() => removeItem(item)} title="删除"
                            className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="pl-3 ml-1 text-[10px] text-gray-300 dark:text-gray-600">空 · 从上方商店添加</p>
                  )}
                </div>
              );
            })}
          {/* 未归入7栏的遗留分类兜底展示 */}
          {(() => {
            const others = inventory.filter((i) => !STORAGE_META[i.category] || i.category === 'all');
            if (others.length === 0) return null;
            return (
              <div>
                <p className="px-0.5 pb-0.5 text-[10px] font-medium text-gray-400">其他</p>
                <div className="space-y-1 pl-3 border-l-2 border-gray-100 dark:border-gray-800 ml-1">
                  {others.map((item) => (
                    <div key={item.id} className="flex items-center gap-1.5 group">
                      <CategoryBadge category={item.category} />
                      <span className="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-200 truncate">{item.name}</span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => updateItemQty(item, -1)}
                          className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs leading-none hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">−</button>
                        <span className="w-7 text-center text-xs font-mono text-gray-700 dark:text-gray-200">{item.quantity}</span>
                        <button onClick={() => updateItemQty(item, 1)}
                          className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs leading-none hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">+</button>
                      </div>
                      <button onClick={() => removeItem(item)} title="删除"
                        className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* 保存反馈 */}
      {toast && (
        <p className="text-[11px] text-slate-700 dark:text-slate-500 text-center animate-[fadeIn_0.2s_ease-out]">{toast}</p>
      )}
    </div>
  );
}
