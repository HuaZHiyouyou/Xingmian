/**
 * ============================================================
 * Skills 模块 Store
 * 定义可复用的能力技能（prompt 注入 / 行为指引），可被对话触发或定时任务调用。
 * ============================================================
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type SkillTriggerType = 'auto' | 'keyword' | 'manual';

export interface ChatSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** 触发方式：auto=自动注入，keyword=关键词触发，manual=手动/定时调用 */
  trigger: SkillTriggerType;
  /** 关键词列表（trigger=keyword 时生效） */
  keywords: string[];
  /** prompt 内容（注入到 system prompt） */
  prompt: string;
  /** 优先级 */
  priority?: number;
  /** 使用次数 */
  stats?: {
    uses: number;
    lastUsed?: number;
  };
  createdAt: number;
}

interface SkillsStore {
  skills: ChatSkill[];
  /** 当前对话中已启用的 skill 名 */
  activeSkills: string[];

  addSkill: (skill: Omit<ChatSkill, 'id' | 'createdAt' | 'stats'>) => void;
  updateSkill: (id: string, patch: Partial<ChatSkill>) => void;
  removeSkill: (id: string) => void;
  toggleSkill: (id: string) => void;
  setActiveSkills: (names: string[]) => void;
  toggleActiveSkill: (name: string) => void;

  /** 收集当前启用的 skills 的 prompt 内容（供注入 system prompt） */
  collectPrompts: () => string;
  /** 关键词匹配（返回匹配的 skill 名） */
  matchKeywords: (text: string) => string[];
  recordUse: (id: string) => void;
}

function genId(): string {
  return 'skill_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

export function createExampleSkill(): ChatSkill {
  return {
    id: 'skill_' + Date.now().toString(36),
    name: '鼓励技能',
    description: '当用户情绪低落时，使用温暖鼓励的语气给予支持（示例技能）',
    enabled: false,
    trigger: 'keyword',
    keywords: ['难过', '低落', '不开心', 'emo', '烦'],
    prompt: '【鼓励技能】当用户表达低落情绪时，优先共情与鼓励：先认可感受，再给出一个具体的小建议，语气温暖但不敷衍。',
    priority: 50,
    stats: { uses: 0 },
    createdAt: Date.now(),
  };
}

export const useSkillsStore = create<SkillsStore>()(
  persist(
    (set, get) => ({
      skills: [],
      activeSkills: [],

      addSkill: (skill) => set((s) => ({
        skills: [...s.skills, { ...skill, id: genId(), createdAt: Date.now(), stats: { uses: 0 } } as ChatSkill],
      })),
      updateSkill: (id, patch) => set((s) => ({
        skills: s.skills.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      })),
      removeSkill: (id) => set((s) => ({
        skills: s.skills.filter((x) => x.id !== id),
        activeSkills: s.activeSkills.filter((n) => n !== s.skills.find((x) => x.id === id)?.name),
      })),
      toggleSkill: (id) => set((s) => ({
        skills: s.skills.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
      })),
      setActiveSkills: (names) => set({ activeSkills: names }),
      toggleActiveSkill: (name) => set((s) => ({
        activeSkills: s.activeSkills.includes(name)
          ? s.activeSkills.filter((n) => n !== name)
          : [...s.activeSkills, name],
      })),

      collectPrompts: () => {
        const { skills, activeSkills } = get();
        return skills
          .filter((sk) => sk.enabled && (sk.trigger === 'auto' || activeSkills.includes(sk.name)))
          .sort((a, b) => (b.priority || 0) - (a.priority || 0))
          .map((sk) => sk.prompt.trim())
          .filter(Boolean)
          .join('\n');
      },

      matchKeywords: (text) => {
        const { skills } = get();
        return skills
          .filter((sk) => sk.enabled && sk.trigger === 'keyword' && sk.keywords.some((k) => text.includes(k)))
          .map((sk) => sk.name);
      },

      recordUse: (id) => set((s) => ({
        skills: s.skills.map((x) => x.id === id ? {
          ...x,
          stats: { uses: (x.stats?.uses || 0) + 1, lastUsed: Date.now() },
        } : x),
      })),
    }),
    {
      name: 'skills-module',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
