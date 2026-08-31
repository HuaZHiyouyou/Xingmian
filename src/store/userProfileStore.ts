import { create } from 'zustand';
import { UserProfile } from '../types';
import { dbGetUserProfile, isRunningInTauri } from '../lib/tauriBridge';

const STORAGE_KEY = 'user-profile';

const DEFAULT_PROFILE: UserProfile = {
  avatar: '',
  nickname: '',
  age: '',
  gender: '',
  mbti: '',
  birthday: '',
  personality: '',
  background: '',
  interests: '',
  habits: '',
  notes: '',
};

interface UserProfileState {
  profile: UserProfile;
  isLoaded: boolean;
  updateProfile: (updates: Partial<UserProfile>) => void;
  loadFromStorage: () => Promise<void>;
  saveToStorage: () => Promise<void>;
  getUserPrompt: () => string;
}

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  profile: { ...DEFAULT_PROFILE },
  isLoaded: false,

  updateProfile: (updates) => {
    set((state) => ({
      profile: { ...state.profile, ...updates },
    }));
    get().saveToStorage();
  },

  loadFromStorage: async () => {
    // Bug4修复: 先读 localStorage，再读 DB，以 localStorage 为优先（因为 saveToStorage 只写 localStorage）
    let localProfile: Partial<UserProfile> = {};
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        localProfile = JSON.parse(stored);
      }
    } catch { /* ignore */ }

    if (isRunningInTauri()) {
      try {
        const dbProfile = await dbGetUserProfile();
        // localStorage 优先：合并 DB 和 localStorage，localStorage 覆盖 DB（因为关闭前统一写 DB）
        set({ profile: { ...DEFAULT_PROFILE, ...dbProfile, ...localProfile }, isLoaded: true });
        return;
      } catch {
        // DB 失败，使用 localStorage
      }
    }

    // 非 Tauri 或 DB 失败，使用 localStorage
    if (Object.keys(localProfile).length > 0) {
      set({ profile: { ...DEFAULT_PROFILE, ...localProfile }, isLoaded: true });
      return;
    }
    set({ isLoaded: true });
  },

  saveToStorage: async () => {
    const { profile } = get();
    // 🆕 仅写 localStorage，DB 写入在关闭前统一处理
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  },

  getUserPrompt: () => {
    const { profile } = get();
    const parts: string[] = [];
    if (profile.nickname) parts.push(`昵称：${profile.nickname}`);
    if (profile.age) parts.push(`年龄：${profile.age}`);
    if (profile.gender) parts.push(`性别：${profile.gender}`);
    if (profile.mbti) parts.push(`MBTI人格：${profile.mbti}`);
    if (profile.birthday) parts.push(`生日：${profile.birthday}`);
    if (profile.personality) parts.push(`性格：${profile.personality}`);
    if (profile.background) parts.push(`背景：${profile.background}`);
    if (profile.interests) parts.push(`兴趣爱好：${profile.interests}`);
    if (profile.habits) parts.push(`习惯：${profile.habits}`);
    if (profile.notes) parts.push(`备注：${profile.notes}`);
    if (parts.length === 0) return '';
    return `\n\n## 你正在和谁聊天\n${parts.join('\n')}`;
  },
}));
