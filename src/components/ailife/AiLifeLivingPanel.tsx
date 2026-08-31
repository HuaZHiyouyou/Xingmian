/**
 * ============================================================
 * AI 一日 · 生活面板（详细版）
 *  - 钱包：余额 + 记一笔开销/补一笔财产（模态框+AI 回复） + 最近流水
 *  - 冰箱/衣柜/药箱/杂物：数量增删、库存不足提醒
 *  - 衣柜：今日穿搭（AI 每日挑选）
 *  - 生活记录：食品消耗 / 服装变更 时间线
 * ============================================================
 */
import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { subscribeDisplayCurrency, getDisplayCurrency } from '../../services/ailife/currency';
import {
  Wallet, UtensilsCrossed, Shirt, Pill, Package, Plus,
  Minus, Trash2, AlertTriangle, ShoppingBag, Palette, Home as HomeIcon, Gift,
  Lightbulb, Check,
} from 'lucide-react';
import {
  dbGetAiInventory, dbGetAiEconomy, dbGetAiTransactions,
  dbSaveAiInventoryItems, dbDeleteAiInventoryItem, dbSaveAiEconomy,
  AiInventoryItem, AiEconomy, AiTransaction, AiContentProposal,
} from '../../lib/tauriBridge';
// 🆕 D4: 创意工坊审核
import { getWorkshopOverview, approveProposal, rejectProposal } from '../../services/ailife/contentWorkshop';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { useDebugLog } from '../../store/debugLogStore';
import { LedgerModal, ShopModal } from './AiLifeModals';
import { getAllShopItems, resolveCategoryMeta } from '../../services/ailife/localShop';
import { Skeleton, SkeletonRows, SkeletonCard } from '../common/Skeleton';
import { formatMoneyFromCNY } from '../../services/ailife/currency';
import { CurrencySelect } from '../common/CurrencySelect';

const HAND_FONT = "'LXGW WenKai', 'Kaiti SC', 'KaiTi', cursive";

function hm(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/** 🆕 C1: 流水展示带日期（跨月/跨日可读） */
function dhm(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  return sameYear ? `${md} ${hm(iso)}` : `${d.getFullYear()}/${md}`;
}

const CATEGORY_META: Record<string, { icon: typeof UtensilsCrossed; label: string }> = {
  food: { icon: UtensilsCrossed, label: '冰箱' },
  clothing: { icon: Shirt, label: '衣柜' },
  medicine: { icon: Pill, label: '药箱' },
  tool: { icon: Package, label: '日用品' },
  hobby: { icon: Palette, label: '兴趣' },
  home: { icon: HomeIcon, label: '家居' },
  gift: { icon: Gift, label: '礼物' },
};

function economyStatus(balance: number): { label: string; color: string } {
  if (balance > 10000) return { label: '宽裕', color: '#2c5f2d' };
  if (balance > 3000) return { label: '平衡', color: '#2c3e50' };
  if (balance > 500) return { label: '偏紧', color: '#a05a00' };
  return { label: '危机', color: '#8b0000' };
}

/** 🆕 C1: 月薪编辑器——此前 monthlyIncome 全工程无赋值点（写死 0），工资逻辑永不触发 */
function MonthlyIncomeEditor({ characterId, monthlyIncome, onSaved, displayCurrency }: {
  characterId: string;
  monthlyIncome: number;
  onSaved: () => void;
  displayCurrency: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const num = Math.max(0, Math.round(Number(val) || 0));
    setSaving(true);
    try {
      const eco = await dbGetAiEconomy(characterId);
      if (eco) {
        await dbSaveAiEconomy({ ...eco, monthlyIncome: num, updatedAt: new Date().toISOString() });
        useDebugLog.getState().add('ailife', `[AI-Life] 月薪调整为 ¥${num}（出勤日结 ¥${Math.max(1, Math.round(num / 22))}/天）`, { characterId });
      }
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => { setVal(String(monthlyIncome || '')); setEditing(true); }}
        className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
        title="点击设置月薪；有月薪后，AI 每完成一天的工作会当日结算薪水"
      >
        月薪 ¥{monthlyIncome > 0 ? `${monthlyIncome}（日结 ¥${Math.max(1, Math.round(monthlyIncome / 22))}）` : '未设置'} ✎
      </button>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0">月薪 ¥</span>
      <input
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/[^\d.]/g, ''))}
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false); }}
        placeholder="如 6000"
        className="w-20 text-[11px] px-1.5 py-0.5 rounded-md border border-[#d8cdb4] dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 focus:outline-none focus:border-slate-400"
      />
      <button
        onClick={() => void save()}
        disabled={saving}
        className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-700 text-white hover:bg-slate-600 disabled:opacity-50 transition-colors"
      >
        保存
      </button>
      <button onClick={() => setEditing(false)} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">取消</button>
      <span className="text-[9px] text-slate-400 dark:text-slate-500 truncate">{displayCurrency !== 'CNY' ? `（账本本位 CNY）` : ''}</span>
    </div>
  );
}

interface ItemHistoryEntry { date: string; qty: number; reason: string; itemName: string }

/** 今日穿搭条（读取 config.extra.todayOutfit） */
function TodayOutfit() {
  const config = useAiLifeStore((s) => s.config);
  const outfit = (config?.extra as { todayOutfit?: { date: string; names: string[] } } | undefined)?.todayOutfit;
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
  if (!outfit || outfit.date !== todayKey || !outfit.names?.length) return null;
  return (
    <p className="mb-2 text-[11px] px-2.5 py-1.5 rounded-lg bg-white/70 dark:bg-gray-900/40 border border-dashed border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 truncate">
      今日穿搭：{outfit.names.join('、')}
    </p>
  );
}

export function AiLifeLivingPanel({ characterId }: { characterId?: string }) {
  const [inventory, setInventory] = useState<AiInventoryItem[]>([]);
  const [economy, setEconomy] = useState<AiEconomy | null>(null);
  const [loading, setLoading] = useState(true);
  const displayCurrency = useSyncExternalStore(subscribeDisplayCurrency, getDisplayCurrency);
  const [transactions, setTransactions] = useState<AiTransaction[]>([]);
  const [ledgerType, setLedgerType] = useState<'expense' | 'income' | null>(null);
  const [showShop, setShowShop] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemNote, setItemNote] = useState('');
  // 🆕 添加物品模态框：商店多选快速入库
  const [shopSel, setShopSel] = useState<Record<string, boolean>>({});
  const [shopQuery, setShopQuery] = useState('');
  const [shopGroup, setShopGroup] = useState('all');
  // 🆕 D4: 创意工坊待审核提案
  const [proposals, setProposals] = useState<AiContentProposal[]>([]);
  const [workshopApprovalRate, setWorkshopApprovalRate] = useState(-1);

  const reload = useCallback(async () => {
    if (!characterId) return;
    setLoading(true);
    try {
      setInventory(await dbGetAiInventory(characterId));
      setEconomy(await dbGetAiEconomy(characterId));
      setTransactions(await dbGetAiTransactions(characterId, 30));
      try {
        const w = await getWorkshopOverview(characterId);
        setProposals(w.pending);
        setWorkshopApprovalRate(w.approvalRate);
      } catch { /* 非核心功能静默 */ }
    } catch { /* 非法状态静默 */ } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!characterId) return null;

  // 🆕 D4: 提案采纳/拒绝
  const handleApprove = async (p: AiContentProposal) => {
    setProposals((list) => list.filter((x) => x.id !== p.id));
    await approveProposal(p);
    reload();
  };
  const handleReject = async (p: AiContentProposal) => {
    setProposals((list) => list.filter((x) => x.id !== p.id));
    await rejectProposal(p);
  };

  const changeQty = async (item: AiInventoryItem, delta: number) => {
    const next = { ...item, quantity: Math.max(0, item.quantity + delta), updatedAt: new Date().toISOString() };
    if (next.quantity === 0) {
      await dbDeleteAiInventoryItem(item.id);
    } else {
      await dbSaveAiInventoryItems([next]);
    }
    reload();
  };

  const removeItem = async (item: AiInventoryItem) => {
    await dbDeleteAiInventoryItem(item.id);
    reload();
  };

  /** 🆕 确认添加：商店多选批量入库（同名合并数量），留言随物品落库 */
  const confirmAddItems = async () => {
    let picked: ReturnType<typeof getAllShopItems> = [];
    try { picked = getAllShopItems().filter((e) => shopSel[e.id]); } catch { picked = []; }
    if (picked.length === 0) return;
    const note = itemNote.trim();
    const now = new Date().toISOString();
    const toSave: AiInventoryItem[] = [];
    const newKeys = new Map<string, AiInventoryItem>();
    for (const p of picked) {
      const cat = resolveCategoryMeta(p.category).invCategory;
      const exist = inventory.find((i) => i.category === cat && i.name === p.name);
      if (exist) {
        toSave.push({ ...exist, quantity: exist.quantity + 1, updatedAt: now });
        continue;
      }
      const key = `${cat}::${p.name}`;
      const merged = newKeys.get(key);
      if (merged) { merged.quantity += 1; continue; }
      const item: AiInventoryItem = {
        id: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}_${newKeys.size}`,
        characterId, category: cat, name: p.name, quantity: 1, quality: 'good',
        extra: note ? { note } : {}, updatedAt: now,
      };
      newKeys.set(key, item);
    }
    for (const it of newKeys.values()) toSave.push(it);
    if (toSave.length > 0) await dbSaveAiInventoryItems(toSave);
    setShopSel({});
    setShopQuery('');
    setShopGroup('all');
    setItemNote('');
    setItemModalOpen(false);
    reload();
  };

  const handleLedgerSubmit = () => {
    reload();
  };

  // 🆕 添加物品模态框的商店候选与分组
  const SHOP_GROUPS: Array<{ key: string; label: string }> = [
    { key: 'food', label: '冰箱' }, { key: 'clothing', label: '衣柜' }, { key: 'medicine', label: '药箱' },
    { key: 'tool', label: '日用品' }, { key: 'hobby', label: '兴趣' }, { key: 'home', label: '家居' }, { key: 'gift', label: '礼物' },
  ];
  const shopCandidates = (() => {
    try {
      return getAllShopItems().filter((e) => {
        if (shopGroup !== 'all' && resolveCategoryMeta(e.category).invCategory !== shopGroup) return false;
        const q = shopQuery.trim().toLowerCase();
        if (!q) return true;
        return e.name.toLowerCase().includes(q) || (e.tags || []).some((t) => t.toLowerCase().includes(q));
      });
    } catch { return []; }
  })();
  const pickedCount = Object.values(shopSel).filter(Boolean).length;

  // 🆕 分组动态化：内置四类 + 库存中出现的自定义分类
  const knownCats = Object.keys(CATEGORY_META);
  const invCats = Array.from(new Set(inventory.map((i) => i.category)));
  const customCats = invCats.filter((c) => !knownCats.includes(c));
  const grouped: Array<{ icon: typeof UtensilsCrossed; label: string; cat: string; items: AiInventoryItem[] }> = [
    ...Object.entries(CATEGORY_META).map(([cat, meta]) => ({
      ...meta,
      cat,
      items: inventory.filter((i) => i.category === cat),
    })),
    ...customCats.map((c) => ({
      icon: Package,
      label: c,
      cat: c,
      items: inventory.filter((i) => i.category === c),
    })),
  ];
  const foodTotal = inventory.filter((i) => i.category === 'food').reduce((s, i) => s + i.quantity, 0);
  const status = economy ? economyStatus(economy.balance) : null;

  // 最近消耗/更换记录（从物资 extra.history 汇总）
  const historyRows: ItemHistoryEntry[] = inventory
    .flatMap((it) => {
      const raw = it.extra && typeof it.extra === 'object' ? (it.extra as Record<string, unknown>) : {};
      const list = Array.isArray(raw.history) ? (raw.history as { date: string; qty: number; reason: string }[]) : [];
      return list.map((h) => ({ ...h, itemName: it.name }));
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);

  return (
    <div className="space-y-4">
      {/* 钱包 */}
      <section className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <Wallet size={14} className="text-slate-700 dark:text-slate-500" />
          <h3 className="text-sm font-bold text-[#2c3e50] dark:text-gray-100" style={{ fontFamily: HAND_FONT }}>钱包</h3>
          {status && (
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: `${status.color}18`, color: status.color }}>
              {status.label}
            </span>
          )}
        </div>
        {/* 🆕 余额加载骨架 + 货币切换（账本本位 CNY，按参考汇率换算显示） */}
        {loading ? (
          <Skeleton className="w-28 h-7 my-1" />
        ) : economy ? (
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold tabular-nums text-[#2c3e50] dark:text-gray-100" style={{ fontFamily: "'Caveat', 'LXGW WenKai', cursive" }}>
              {formatMoneyFromCNY(economy.balance, displayCurrency)}
            </p>
            <CurrencySelect compact />
          </div>
        ) : (
          <p className="text-lg font-semibold text-[#2c3e50] dark:text-gray-100" style={{ fontFamily: "'Caveat', 'LXGW WenKai', cursive" }}>--</p>
        )}
        {/* 🆕 C1: 月薪配置（出勤日结薪 = 月薪/22，有工作才有收入因果） */}
        {economy && <MonthlyIncomeEditor characterId={characterId} monthlyIncome={economy.monthlyIncome} onSaved={reload} displayCurrency={displayCurrency} />}
        <div className="mt-2 flex gap-2">
          <button onClick={() => setLedgerType('expense')}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/50 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/30 transition-colors">
            记一笔开销
          </button>
          <button onClick={() => setLedgerType('income')}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/20 border border-slate-300 dark:border-slate-900/50 text-slate-700 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800/30 transition-colors">
            补一笔财产
          </button>
          <button onClick={() => setShowShop(true)}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-700 text-white hover:bg-slate-600 transition-colors inline-flex items-center gap-1">
            <ShoppingBag size={11} />
            商店
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">生活自主运转中：缺货自动补、每月发薪、偶尔犒劳自己——都记在流水里</p>
        {/* 最近流水 */}
        {loading ? (
          <div className="mt-3 pt-3 space-y-1.5">
            <p className="text-[10px] text-gray-400 mb-1">最近流水</p>
            <SkeletonRows rows={3} />
          </div>
        ) : transactions.length > 0 && (
          <div className="mt-3 pt-3 space-y-1.5 animate-[fadeIn_0.35s_ease-out]">
            <p className="text-[10px] text-gray-400 mb-1">最近流水</p>
            {transactions.map((tx) => {
              const parts = (tx.description || '').split('｜');
              const base = parts[0] || '（无描述）';
              const aiPart = parts.find((p) => p.startsWith('AI：'));
              const income = tx.type === 'income';
              return (
                <div key={tx.id} className="flex items-start gap-2 text-[11px]">
                  <span className={`tabular-nums shrink-0 font-medium ${income ? 'text-slate-700 dark:text-slate-500' : 'text-rose-500'}`}>
                    {income ? '+' : '-'}{tx.amount.toFixed(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-600 dark:text-gray-300 truncate">{base}</p>
                    {aiPart && (
                      <p className="text-[10px] text-slate-700 dark:text-slate-300 dark:text-slate-500 truncate" title={aiPart}>{aiPart.replace(/^AI：/, '')}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-300 dark:text-gray-600 shrink-0 tabular-nums">{dhm(tx.timestamp)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 物资分组（🆕 加载骨架 → 数据淡入） */}
      {loading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : grouped.map(({ icon: Icon, label, cat, items }) => {
        const lowFood = cat === 'food' && foodTotal <= 2;
        return (
          <section key={label} className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={13} className="text-slate-700 dark:text-slate-500" />
              <h3 className="text-sm font-bold text-[#2c3e50] dark:text-gray-100" style={{ fontFamily: HAND_FONT }}>{label}</h3>
              {lowFood && (
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  <AlertTriangle size={10} />快空了，该买菜了
                </span>
              )}
            </div>
            {cat === 'clothing' && <TodayOutfit />}
            <ul className="space-y-1">
              {items.map((it) => {
                const raw = it.extra && typeof it.extra === 'object' ? (it.extra as Record<string, unknown>) : {};
                const note = typeof raw.note === 'string' ? raw.note : '';
                return (
                  <li key={it.id} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 group">
                    <div className="min-w-0 flex-1" title={note}>
                      <span className="block truncate">
                        {it.name.includes('套装') && (
                          <span className="mr-1 text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 align-middle">套装</span>
                        )}
                        {it.name}
                        {/* 🆕 物品标签 chips */}
                        {Array.isArray(raw.tags) && (raw.tags as string[]).length > 0 && (
                          (raw.tags as string[]).slice(0, 3).map((tag) => (
                            <span key={tag} className="ml-1 text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 align-middle">
                              {tag}
                            </span>
                          ))
                        )}
                      </span>
                      {/* 🆕 留言独立一行完整可见（不再随名称截断） */}
                      {note && (
                        <span className="block mt-0.5 text-[10px] leading-snug text-gray-500 dark:text-gray-400 break-words" style={{ fontFamily: HAND_FONT }}>
                          「{note}」
                        </span>
                      )}
                    </div>
                    <span className="tabular-nums text-gray-400 shrink-0">×{it.quantity}</span>
                    <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button title="减一" onClick={() => changeQty(it, -1)} className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600"><Minus size={11} /></button>
                      <button title="加一" onClick={() => changeQty(it, 1)} className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600"><Plus size={11} /></button>
                      <button title="删除" onClick={() => removeItem(it)} className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-500"><Trash2 size={11} /></button>
                    </span>
                  </li>
                );
              })}
              {items.length === 0 && <li className="text-[11px] text-gray-400">空空如也</li>}
            </ul>
          </section>
        );
      })}

      {/* 生活记录（消耗/穿搭时间线） */}
      {historyRows.length > 0 && (
        <section className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700 shadow-sm">
          <h3 className="text-sm font-bold text-[#2c3e50] dark:text-gray-100 mb-2" style={{ fontFamily: HAND_FONT }}>生活记录</h3>
          <ul className="space-y-1">
            {historyRows.map((h, i) => (
              <li key={`${h.itemName}-${h.date}-${i}`} className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                <span className="tabular-nums text-gray-400 shrink-0">{h.date}</span>
                <span className="truncate">{h.reason}{h.qty > 0 ? ` ×${h.qty}` : ''} · {h.itemName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 🆕 D4: 创意工坊——她提议的新内容，等待你的审核 */}
      {proposals.length > 0 && (
        <section className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700 shadow-sm">
          <h3 className="text-sm font-bold text-[#2c3e50] dark:text-gray-100 mb-1 flex items-center gap-1.5" style={{ fontFamily: HAND_FONT }}>
            <Lightbulb size={14} className="text-amber-500" />她的提议
          </h3>
          {workshopApprovalRate >= 0 && (
            <p className="text-[10px] text-gray-400 mb-2">历史采纳率 {workshopApprovalRate}% · 限每周 3 条</p>
          )}
          <ul className="space-y-2">
            {proposals.map((p) => (
              <li key={p.id} className="rounded-lg bg-white/70 dark:bg-gray-900/40 border border-[#e5dcc3] dark:border-gray-700 p-2.5">
                <p className="text-xs text-gray-800 dark:text-gray-200 font-medium">{p.title}</p>
                {p.reason && <p className="text-[10px] text-gray-500 mt-0.5">「{p.reason}」</p>}
                <div className="flex gap-2 mt-2">
                  <button onClick={() => handleApprove(p)}
                    className="px-3 py-1 rounded-full text-[11px] bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 transition-colors">
                    采纳
                  </button>
                  <button onClick={() => handleReject(p)}
                    className="px-3 py-1 rounded-full text-[11px] bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 transition-colors">
                    不要
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 添加物品入口 */}
      <section className="rounded-xl p-4 bg-[#fdf6e3] dark:bg-gray-800/60 border border-[#d8cdb4] dark:border-gray-700 shadow-sm">
        <button onClick={() => { setItemModalOpen(true); setItemNote(''); setShopSel({}); setShopQuery(''); setShopGroup('all'); }}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 hover:border-slate-500 hover:text-slate-700 dark:hover:text-slate-500 transition-colors">
          <Plus size={13} />添加物品
        </button>
      </section>

      {/* 添加物品模态框：分类 + 物品名称 + 留言 */}
      {itemModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => setItemModalOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-800 shadow-2xl p-5 animate-[fadeUp_0.22s_cubic-bezier(0.34,1.3,0.64,1)]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">添加物品</h3>
            <div className="space-y-3">
              {/* 🆕 从商店快速多选 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">从商店快速选择（可多选）</label>
                <input
                  value={shopQuery}
                  onChange={(e) => setShopQuery(e.target.value)}
                  placeholder="搜索商品名或标签…"
                  className="w-full px-3 py-1.5 text-xs rounded-full bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-500 mb-1.5" />
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {[{ key: 'all', label: '全部' }, ...SHOP_GROUPS].map((g) => (
                    <button key={g.key} onClick={() => setShopGroup(g.key)}
                      className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                        shopGroup === g.key ? 'bg-slate-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}>
                      {g.label}
                    </button>
                  ))}
                </div>
                <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800/60
                  [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  {shopCandidates.length === 0 && <p className="text-[10px] text-gray-400 text-center py-3">没有匹配的商品</p>}
                  {shopCandidates.map((e) => {
                    const on = !!shopSel[e.id];
                    return (
                      <button key={e.id} type="button"
                        onClick={() => setShopSel((s) => ({ ...s, [e.id]: !s[e.id] }))}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${on ? 'bg-slate-50 dark:bg-gray-700/40' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                        <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                          on ? 'bg-slate-700 border-slate-700' : 'border-gray-300 dark:border-gray-600'}`}>
                          {on && <Check size={9} className="text-white" />}
                        </span>
                        <span className="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-200 truncate">{e.name}</span>
                        <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{formatMoneyFromCNY(e.price, displayCurrency)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">留言（可选，会展示在物品旁边）</label>
                <textarea
                  value={itemNote}
                  onChange={(e) => setItemNote(e.target.value)}
                  rows={2}
                  placeholder="关于这件物品想说的话…"
                  className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-gray-900/60 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-500 resize-none" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={confirmAddItems} disabled={pickedCount === 0}
                  className="flex-1 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-700 text-white text-sm font-medium transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
                  <Check size={14} />{pickedCount > 0 ? `添加所选 ${pickedCount} 件` : '请先选择商品'}
                </button>
                <button onClick={() => setItemModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 记账模态框 */}
      {ledgerType && (
        <LedgerModal
          type={ledgerType}
          characterId={characterId}
          onSubmit={handleLedgerSubmit}
          onClose={() => { setLedgerType(null); reload(); }}
        />
      )}

      {/* 🆕 内置商店 */}
      {showShop && (
        <ShopModal
          characterId={characterId}
          onClose={() => setShowShop(false)}
          onPurchased={reload}
        />
      )}
    </div>
  );
}
