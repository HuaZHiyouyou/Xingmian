import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Trash2, Image, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useUserProfileStore } from '../../store/userProfileStore';

const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-700 transition-colors";

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

/** 生日美化日历（AI一日同款风格）：portaled 弹层，选中后自动回填年龄 */
function BirthdayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const parsed = value.replace(/\//g, '-');
  const init = parsed ? new Date(`${parsed}T00:00:00`) : new Date();
  const [viewYear, setViewYear] = useState(init.getFullYear());
  const [viewMonth, setViewMonth] = useState(init.getMonth()); // 0-based

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const W = 264, H = 316;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
      top: r.bottom + 6 + H > window.innerHeight ? Math.max(8, r.top - H - 6) : r.bottom + 6,
    });
  }, [open]);

  const firstDay = new Date(viewYear, viewMonth, 1);
  // 周一起始的偏移
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayKey = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${(n.getMonth() + 1).toString().padStart(2, '0')}-${n.getDate().toString().padStart(2, '0')}`;
  })();

  const pick = (day: number) => {
    const key = `${viewYear}-${(viewMonth + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    onChange(key);
    setOpen(false);
  };

  const cells: Array<{ day: number; key: string; muted: boolean }> = [];
  for (let i = offset; i > 0; i--) {
    const d = new Date(viewYear, viewMonth, 1 - i);
    cells.push({ day: d.getDate(), key: `p${i}`, muted: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, key: `c${d}`, muted: false });
  }

  return (
    <>
      <button
        ref={btnRef} type="button" onClick={() => setOpen(!open)}
        className={`${inputCls} flex items-center gap-2 text-left ${open ? 'ring-2 ring-slate-700 border-slate-700' : ''}`}
      >
        <CalendarDays size={15} className="text-gray-400 shrink-0" />
        <span className={value ? '' : 'text-gray-400'}>{value || '选择生日'}</span>
      </button>
      {/* portal 到 body：规避 transform 祖先导致的 fixed 失效/裁剪 */}
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div ref={panelRef}
            className="fixed z-50 w-[264px] p-3 rounded-2xl border border-gray-100 dark:border-gray-700
            bg-white dark:bg-gray-800 shadow-xl shadow-black/10 animate-[fadeUp_0.18s_ease-out]"
            style={{ left: pos.left, top: pos.top }}>
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => viewMonth === 0 ? (setViewMonth(11), setViewYear(viewYear - 1)) : setViewMonth(viewMonth - 1)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors"><ChevronLeft size={14} /></button>
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{viewYear}年{viewMonth + 1}月</span>
              <button type="button" onClick={() => viewMonth === 11 ? (setViewMonth(0), setViewYear(viewYear + 1)) : setViewMonth(viewMonth + 1)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors"><ChevronRight size={14} /></button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((w) => (
                <span key={w} className="text-center text-[10px] text-gray-400 py-0.5">{w}</span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((c) => {
                const key = `${viewYear}-${(viewMonth + 1).toString().padStart(2, '0')}-${c.day.toString().padStart(2, '0')}`;
                const selected = key === parsed;
                const isToday = key === todayKey;
                return (
                  <button key={c.key} type="button" onClick={() => !c.muted && pick(c.day)} disabled={c.muted}
                    className={`h-8 rounded-lg text-xs transition-colors ${
                      selected ? 'bg-slate-700 text-white font-medium'
                      : c.muted ? 'text-gray-300 dark:text-gray-600'
                      : isToday ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 font-medium hover:bg-violet-100 dark:hover:bg-violet-900/50'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                    {c.day}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50 dark:border-gray-700/60">
              <button type="button" onClick={() => { onChange(''); setOpen(false); }}
                className="text-[10px] text-gray-400 hover:text-red-500 transition-colors">清除</button>
              <button type="button" onClick={() => { setViewYear(new Date().getFullYear()); setViewMonth(new Date().getMonth()); }}
                className="text-[10px] text-gray-400 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">回到今天</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

/** 由生日推算年龄（周岁），无效日期返回空串 */
function calcAge(birthday: string): string {
  const d = new Date(`${birthday.replace(/\//g, '-')}T00:00:00`);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 && age < 150 ? String(age) : '';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  );
}

export function UserProfilePanel() {
  const navigate = useNavigate();
  const { profile, updateProfile } = useUserProfileStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = (key: string, value: string) =>
    updateProfile({ [key]: value });

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => set('avatar', reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/chat')} className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div className="flex items-center gap-2">
            <User size={18} className="text-gray-500" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">我的信息</h1>
          </div>
        </div>

        <p className="text-xs text-gray-400 mb-4">设置你的个人信息，AI 会据此更好地了解你。</p>

        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm space-y-4">
          {/* Avatar */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">头像</label>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
            {profile.avatar ? (
              <div className="relative inline-block">
                <img src={profile.avatar} alt="我的头像" className="w-20 h-20 rounded-xl object-cover border border-gray-200 dark:border-gray-600" />
                <button
                  onClick={() => set('avatar', '')}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-slate-500 hover:text-slate-700 dark:text-slate-300 transition-colors"
              >
                <Image size={20} />
                <span className="text-[10px]">选择图片</span>
              </button>
            )}
          </div>

          <Field label="昵称">
            <input className={inputCls} value={profile.nickname} onChange={(e) => set('nickname', e.target.value)} placeholder="你的昵称" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="年龄">
              <input className={inputCls} value={profile.age} onChange={(e) => set('age', e.target.value)} placeholder="如：22" />
            </Field>
            <Field label="性别">
              <input className={inputCls} value={profile.gender} onChange={(e) => set('gender', e.target.value)} placeholder="如：女" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="MBTI人格类型">
              <input className={inputCls} value={profile.mbti} onChange={(e) => set('mbti', e.target.value.toUpperCase())} placeholder="如：INFP、ENFJ（可选）" maxLength={4} />
            </Field>
            <Field label="生日">
              <BirthdayPicker
                value={profile.birthday}
                onChange={(v) => {
                  set('birthday', v);
                  // 🔧 填完生日自动推算年龄；清除生日时年龄保持手动值不动
                  const age = calcAge(v);
                  if (age) set('age', age);
                }}
              />
            </Field>
          </div>

          <Field label="性格特点">
            <textarea className={inputCls} value={profile.personality} onChange={(e) => set('personality', e.target.value)} placeholder="如：开朗活泼、喜欢聊天" rows={2} />
          </Field>

          <Field label="个人背景">
            <textarea className={inputCls} value={profile.background} onChange={(e) => set('background', e.target.value)} placeholder="简单介绍你的职业、生活状态等" rows={2} />
          </Field>

          <Field label="兴趣爱好">
            <textarea className={inputCls} value={profile.interests} onChange={(e) => set('interests', e.target.value)} placeholder="如：看电影、打游戏、旅行" rows={2} />
          </Field>

          <Field label="生活习惯">
            <textarea className={inputCls} value={profile.habits} onChange={(e) => set('habits', e.target.value)} placeholder="如：熬夜、早起、喜欢喝咖啡" rows={2} />
          </Field>

          <Field label="备注">
            <textarea className={inputCls} value={profile.notes} onChange={(e) => set('notes', e.target.value)} placeholder="其他你想让 AI 了解的信息" rows={2} />
          </Field>
        </div>
      </div>
    </div>
  );
}
