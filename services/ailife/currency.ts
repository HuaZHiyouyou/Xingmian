/**
 * ============================================================
 * AI 一日 · 多货币体系（账本本位：人民币）
 *  - 所有账本数据（余额/流水/商品定价）一律以 CNY 记账
 *  - 显示层可切换任意币种：按内置参考汇率换算展示
 *  - 汇率为静态参考值（可在 CURRENCIES 中调整）
 * ============================================================
 */

export interface CurrencyDef {
  code: string;
  name: string;
  symbol: string;
  /** 1 单位该货币 = ? CNY */
  rateToCNY: number;
  /** 显示小数位（日元/韩元等取整） */
  decimals: number;
}

export const CURRENCIES: CurrencyDef[] = [
  { code: 'CNY', name: '人民币', symbol: '¥', rateToCNY: 1, decimals: 2 },
  { code: 'USD', name: '美元', symbol: '$', rateToCNY: 7.16, decimals: 2 },
  { code: 'EUR', name: '欧元', symbol: '€', rateToCNY: 7.82, decimals: 2 },
  { code: 'GBP', name: '英镑', symbol: '£', rateToCNY: 9.05, decimals: 2 },
  { code: 'JPY', name: '日元', symbol: 'JP¥', rateToCNY: 0.048, decimals: 0 },
  { code: 'KRW', name: '韩元', symbol: '₩', rateToCNY: 0.0052, decimals: 0 },
  { code: 'HKD', name: '港币', symbol: 'HK$', rateToCNY: 0.92, decimals: 2 },
];

export function getCurrency(code: string | undefined | null): CurrencyDef {
  return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
}

/** CNY 金额 → 目标币种数值 */
export function convertFromCNY(amountCNY: number, code: string): number {
  const cur = getCurrency(code);
  return amountCNY / cur.rateToCNY;
}

/** 目标币种数值 → CNY 金额 */
export function convertToCNY(amount: number, code: string): number {
  const cur = getCurrency(code);
  return amount * cur.rateToCNY;
}

/** 格式化：把 CNY 记账金额按目标币种显示（带符号与小数位） */
export function formatMoneyFromCNY(amountCNY: number, code: string, withCode = false): string {
  const cur = getCurrency(code);
  const v = convertFromCNY(amountCNY, code);
  const s = `${cur.symbol}${v.toFixed(cur.decimals)}`;
  return withCode ? `${s} ${cur.code}` : s;
}

// ---------------- 🆕 全局显示货币（单一状态，所有模块生效） ----------------

const DISPLAY_KEY = 'display_currency';
const LEGACY_KEYS = ['wallet_display_currency', 'shop_display_currency'];
const _listeners = new Set<() => void>();

function readStoredDisplay(): string {
  try {
    const v = localStorage.getItem(DISPLAY_KEY);
    if (v) return v;
    for (const k of LEGACY_KEYS) {
      const legacy = localStorage.getItem(k);
      if (legacy) { localStorage.setItem(DISPLAY_KEY, legacy); return legacy; }
    }
  } catch { /* ignore */ }
  return 'CNY';
}

let _displayCurrency = readStoredDisplay();

/** 当前全局显示货币（默认 CNY） */
export function getDisplayCurrency(): string {
  return _displayCurrency;
}

/** 设置全局显示货币（所有订阅模块即时生效并持久化） */
export function setDisplayCurrencyGlobal(code: string): void {
  _displayCurrency = code;
  try { localStorage.setItem(DISPLAY_KEY, code); } catch { /* ignore */ }
  _listeners.forEach((l) => l());
}

export function subscribeDisplayCurrency(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}
