/**
 * 🆕 货币选择器（自定义下拉：整体圆角、选项圆角、点击外部关闭）
 * 使用 useSyncExternalStore 订阅全局显示货币，所有模块状态一致。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { CURRENCIES, getDisplayCurrency, setDisplayCurrencyGlobal, subscribeDisplayCurrency } from '../../services/ailife/currency';

export function CurrencySelect({ compact = false }: { compact?: boolean }) {
  const currency = useSyncExternalStore(subscribeDisplayCurrency, getDisplayCurrency);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = CURRENCIES.find((c) => c.code === currency) || CURRENCIES[0];

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        title={`显示货币：${current.name}（账本以人民币记录，按参考汇率换算）`}
        className={`inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-slate-400 transition-colors ${
          compact ? 'text-[10px] pl-2 pr-4 py-0.5' : 'text-[11px] pl-2.5 pr-6 py-1'
        }`}
      >
        <span>{current.code}</span>
        <span className="text-gray-400">{current.symbol}</span>
        <ChevronDown size={compact ? 9 : 10} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-[130] min-w-[150px] rounded-xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden">
          {CURRENCIES.map((c) => (
            <button
              key={c.code}
              onClick={() => { setDisplayCurrencyGlobal(c.code); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                c.code === currency ? 'bg-slate-100 dark:bg-slate-800/60' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <span className="w-9 text-xs text-gray-500 dark:text-gray-400">{c.symbol}</span>
              <span className="flex-1 text-xs text-gray-700 dark:text-gray-200">{c.name}</span>
              <span className="text-[10px] text-gray-400">{c.code}</span>
              {c.code === currency && <Check size={12} className="text-indigo-500 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
