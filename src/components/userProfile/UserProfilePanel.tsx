import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Trash2, Image } from 'lucide-react';
import { useUserProfileStore } from '../../store/userProfileStore';

const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors";

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
                className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-violet-400 hover:text-violet-500 transition-colors"
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

          <Field label="MBTI人格类型">
            <input className={inputCls} value={profile.mbti} onChange={(e) => set('mbti', e.target.value.toUpperCase())} placeholder="如：INFP、ENFJ（可选）" maxLength={4} />
          </Field>

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
