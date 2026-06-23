import { create } from 'zustand';
import { UserProfile } from '../types';
import { dbGetUserProfile, dbSaveUserProfile, isRunningInTauri } from '../lib/tauriBridge';

const STORAGE_KEY = 'user-profile';

const DEFAULT_PROFILE: UserProfile = {
  avatar: '',
  nickname: '',
  age: '',
  gender: '',
  mbti: '',
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
    if (isRunningInTauri()) {
      try {
        const dbProfile = await dbGetUserProfile();
        set({ profile: { ...DEFAULT_PROFILE, ...dbProfile }, isLoaded: true });
      } catch {
        set({ isLoaded: true });
      }
      return;
    }
    // localStorage fallback
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        set({ profile: { ...DEFAULT_PROFILE, ...data }, isLoaded: true });
        return;
      }
    } catch { /* ignore */ }
    set({ isLoaded: true });
  },

  saveToStorage: async () => {
    const { profile } = get();
    if (isRunningInTauri()) {
      await dbSaveUserProfile({
        avatar: profile.avatar,
        nickname: profile.nickname,
        age: profile.age,
        gender: profile.gender,
        mbti: profile.mbti,
        personality: profile.personality,
        background: profile.background,
        interests: profile.interests,
        habits: profile.habits,
        notes: profile.notes,
      });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  },

  getUserPrompt: () => {
    const { profile } = get();
    const parts: string[] = [];
    if (profile.nickname) parts.push(`昵称：${profile.nickname}`);
    if (profile.age) parts.push(`年龄：${profile.age}`);
    if (profile.gender) parts.push(`性别：${profile.gender}`);
    if (profile.mbti) parts.push(`MBTI人格：${profile.mbti}`);
    if (profile.personality) parts.push(`性格：${profile.personality}`);
    if (profile.background) parts.push(`背景：${profile.background}`);
    if (profile.interests) parts.push(`兴趣爱好：${profile.interests}`);
    if (profile.habits) parts.push(`习惯：${profile.habits}`);
    if (profile.notes) parts.push(`备注：${profile.notes}`);
    if (parts.length === 0) return '';
    return `\n\n## 你正在和谁聊天\n${parts.join('\n')}`;
  },
}));
