/**
 * ============================================================
 * 纸面风格自定义下拉（阶段 7 视觉统一）
 * 圆角 / 纸面色背景 / 手写字体 / 深色主题适配。
 * 替换原生 <select>（原生控件无法与纸面风格协调且主题适配差）。
 * ============================================================
 */
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export interface PaperSelectOption {
  value: string;
  label: string;
}

interface PaperSelectProps {
  value: string;
  onChange: (v: string) => void;
  options: PaperSelectOption[];
  title?: string;
  className?: string;
}

const HAND_FONT = "'LXGW WenKai', 'Kaiti SC', 'KaiTi', cursive";

export function PaperSelect({ value, onChange, options, title, className = '' }: PaperSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className={`relative ${className}`} ref={ref} title={title}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs
          bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200
          border border-gray-200 dark:border-gray-600 hover:border-slate-400 dark:hover:border-slate-700
          focus:outline-none transition-colors shadow-sm"
        style={{ fontFamily: HAND_FONT }}
      >
        <span>{selected?.label || options[0]?.label}</span>
        <ChevronDown size={12} className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full mt-1.5 z-50 min-w-[160px] rounded-xl overflow-hidden shadow-lg
              bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full px-3 py-2 text-xs text-left transition-colors border-b last:border-b-0
                  ${opt.value === value
                    ? 'bg-slate-100 dark:bg-slate-800/30 text-slate-800 dark:text-slate-400'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}
                  border-gray-100 dark:border-gray-700`}
                style={{ fontFamily: HAND_FONT }}
              >
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
