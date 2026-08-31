import { create } from 'zustand';
import { MbtiQuestion, MbtiType, MbtiResult } from '../types';
import { dbGetMbtiTests, dbSaveMbtiTest, dbDeleteMbtiTest, isRunningInTauri } from '../lib/tauriBridge';

const STORAGE_KEY = 'mbti-result';
const QUESTIONS_PER_DIMENSION = 10;
const TOTAL_QUESTIONS = QUESTIONS_PER_DIMENSION * 4;

export interface MbtiTestRecord {
  id: string;
  type: MbtiType;
  dimensions: { EI: number; SN: number; TF: number; JP: number };
  completedAt: Date;
}

const ALL_QUESTIONS: MbtiQuestion[] = [
  // ==================== E/I 维度 (10题) ====================
  { id: 1, dimension: 'EI', text: '参加聚会后，你通常会感到：', optionA: { label: '精力充沛，意犹未尽', value: 'E' }, optionB: { label: '疲惫，需要独处恢复', value: 'I' } },
  { id: 2, dimension: 'EI', text: '在小组讨论中，你更倾向于：', optionA: { label: '积极发言，边说边理清思路', value: 'E' }, optionB: { label: '认真听完再发表看法', value: 'I' } },
  { id: 3, dimension: 'EI', text: '周末你更想做什么？', optionA: { label: '约一群朋友出去玩', value: 'E' }, optionB: { label: '在家看书或看电影', value: 'I' } },
  { id: 4, dimension: 'EI', text: '遇到难题时，你更喜欢：', optionA: { label: '找人讨论，集思广益', value: 'E' }, optionB: { label: '自己独立思考解决', value: 'I' } },
  { id: 5, dimension: 'EI', text: '你的朋友圈通常是：', optionA: { label: '广泛，认识各行各业的人', value: 'E' }, optionB: { label: '小而精，几个知心朋友', value: 'I' } },
  { id: 6, dimension: 'EI', text: '工作/学习时你更喜欢：', optionA: { label: '开放环境，可以随时交流', value: 'E' }, optionB: { label: '安静的私人空间', value: 'I' } },
  { id: 7, dimension: 'EI', text: '长时间独处后你会：', optionA: { label: '感到无聊，想找人说话', value: 'E' }, optionB: { label: '感到充实满足', value: 'I' } },
  { id: 8, dimension: 'EI', text: '电话响了，你的第一反应是：', optionA: { label: '马上接起来', value: 'E' }, optionB: { label: '等一会儿再接', value: 'I' } },
  { id: 9, dimension: 'EI', text: '你更容易被哪种工作吸引？', optionA: { label: '需要频繁与人互动的', value: 'E' }, optionB: { label: '可以独立完成的', value: 'I' } },
  { id: 10, dimension: 'EI', text: '派对上你通常会：', optionA: { label: '主动和陌生人聊天', value: 'E' }, optionB: { label: '找个安静的角落待着', value: 'I' } },

  // ==================== S/N 维度 (10题) ====================
  { id: 11, dimension: 'SN', text: '你更关注的是：', optionA: { label: '当下正在发生的事情', value: 'S' }, optionB: { label: '未来可能发生的事情', value: 'N' } },
  { id: 12, dimension: 'SN', text: '阅读时你更喜欢：', optionA: { label: '按部就班、详细的描述', value: 'S' }, optionB: { label: '天马行空、富有想象力的故事', value: 'N' } },
  { id: 13, dimension: 'SN', text: '学习新技能时，你更倾向于：', optionA: { label: '按照教程一步一步来', value: 'S' }, optionB: { label: '先了解整体原理', value: 'N' } },
  { id: 14, dimension: 'SN', text: '你更相信什么？', optionA: { label: '亲身经历和事实', value: 'S' }, optionB: { label: '直觉和灵感', value: 'N' } },
  { id: 15, dimension: 'SN', text: '描述一件事时，你更倾向于：', optionA: { label: '具体、精确地描述细节', value: 'S' }, optionB: { label: '用比喻和类比来表达', value: 'N' } },
  { id: 16, dimension: 'SN', text: '做计划时，你更看重：', optionA: { label: '切实可行的步骤', value: 'S' }, optionB: { label: '宏大的愿景', value: 'N' } },
  { id: 17, dimension: 'SN', text: '你觉得哪种人更有魅力？', optionA: { label: '脚踏实地、务实的人', value: 'S' }, optionB: { label: '天马行空、有创意的人', value: 'N' } },
  { id: 18, dimension: 'SN', text: '处理数据时，你更倾向于：', optionA: { label: '逐条分析具体信息', value: 'S' }, optionB: { label: '寻找模式和关联', value: 'N' } },
  { id: 19, dimension: 'SN', text: '你更享受：', optionA: { label: '按照传统方式做事', value: 'S' }, optionB: { label: '尝试全新的方法', value: 'N' } },
  { id: 20, dimension: 'SN', text: '和别人聊天时，你更常聊：', optionA: { label: '实际发生的事情', value: 'S' }, optionB: { label: '想法和理论', value: 'N' } },

  // ==================== T/F 维度 (10题) ====================
  { id: 21, dimension: 'TF', text: '做决定时，你更看重：', optionA: { label: '逻辑分析和客观事实', value: 'T' }, optionB: { label: '他人的感受和价值观', value: 'F' } },
  { id: 22, dimension: 'TF', text: '朋友向你倾诉烦恼时，你更倾向于：', optionA: { label: '帮TA分析问题找解决方案', value: 'T' }, optionB: { label: '先安慰TA的情绪', value: 'F' } },
  { id: 23, dimension: 'TF', text: '在团队合作中，你更看重：', optionA: { label: '效率和结果', value: 'T' }, optionB: { label: '团队和谐和氛围', value: 'F' } },
  { id: 24, dimension: 'TF', text: '面对不公平时，你更倾向于：', optionA: { label: '用事实和规则维护正义', value: 'T' }, optionB: { label: '考虑各方感受寻求平衡', value: 'F' } },
  { id: 25, dimension: 'TF', text: '你更容易被什么打动？', optionA: { label: '严密的逻辑论证', value: 'T' }, optionB: { label: '真诚的情感表达', value: 'F' } },
  { id: 26, dimension: 'TF', text: '给别人反馈时，你更倾向于：', optionA: { label: '直接指出问题所在', value: 'T' }, optionB: { label: '先肯定优点再委婉提建议', value: 'F' } },
  { id: 27, dimension: 'TF', text: '你更不能容忍：', optionA: { label: '逻辑上的错误', value: 'T' }, optionB: { label: '对他人的不尊重', value: 'F' } },
  { id: 28, dimension: 'TF', text: '辩论中你更在意：', optionA: { label: '论点是否有说服力', value: 'T' }, optionB: { label: '是否伤害了对方', value: 'F' } },
  { id: 29, dimension: 'TF', text: '你认为好的领导应该：', optionA: { label: '公正无私，按规则办事', value: 'T' }, optionB: { label: '体恤下属，关心每个人', value: 'F' } },
  { id: 30, dimension: 'TF', text: '面对冲突时，你更倾向于：', optionA: { label: '讲道理，摆事实', value: 'T' }, optionB: { label: '调和双方的情绪', value: 'F' } },

  // ==================== J/P 维度 (10题) ====================
  { id: 31, dimension: 'JP', text: '你的桌面通常是：', optionA: { label: '整齐有序，各归其位', value: 'J' }, optionB: { label: '随意摆放，需要时再找', value: 'P' } },
  { id: 32, dimension: 'JP', text: '旅行前你更倾向于：', optionA: { label: '提前做好详细攻略', value: 'J' }, optionB: { label: '到了再说，随性而为', value: 'P' } },
  { id: 33, dimension: 'JP', text: '面对截止日期，你更习惯：', optionA: { label: '提前完成，留出余量', value: 'J' }, optionB: { label: '临近截止才高效完成', value: 'P' } },
  { id: 34, dimension: 'JP', text: '你更喜欢的生活方式是：', optionA: { label: '有计划、可预测的', value: 'J' }, optionB: { label: '灵活多变的', value: 'P' } },
  { id: 35, dimension: 'JP', text: '制定计划后，你通常：', optionA: { label: '严格执行，不喜欢改变', value: 'J' }, optionB: { label: '根据情况灵活调整', value: 'P' } },
  { id: 36, dimension: 'JP', text: '买东西时你更倾向于：', optionA: { label: '列好清单，按计划购买', value: 'J' }, optionB: { label: '看到什么喜欢就买什么', value: 'P' } },
  { id: 37, dimension: 'JP', text: '做任务时，你更习惯：', optionA: { label: '先做完再玩', value: 'J' }, optionB: { label: '穿插着做，劳逸结合', value: 'P' } },
  { id: 38, dimension: 'JP', text: '面对多个任务时，你更倾向于：', optionA: { label: '列优先级，逐一完成', value: 'J' }, optionB: { label: '哪个先来就先做哪个', value: 'P' } },
  { id: 39, dimension: 'JP', text: '你更享受：', optionA: { label: '事情按部就班地进行', value: 'J' }, optionB: { label: '即兴发挥，随机应变', value: 'P' } },
  { id: 40, dimension: 'JP', text: '整理房间时，你更倾向于：', optionA: { label: '一次性彻底整理', value: 'J' }, optionB: { label: '想整理的时候再整理', value: 'P' } },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function selectQuestions(): MbtiQuestion[] {
  const dimensions = ['EI', 'SN', 'TF', 'JP'] as const;
  const selected: MbtiQuestion[] = [];
  for (const dim of dimensions) {
    const pool = ALL_QUESTIONS.filter(q => q.dimension === dim);
    selected.push(...shuffle(pool).slice(0, QUESTIONS_PER_DIMENSION));
  }
  return shuffle(selected);
}

function calculateType(answers: Record<number, 'A' | 'B'>, questions: MbtiQuestion[]): MbtiResult {
  const scores = { EI: 0, SN: 0, TF: 0, JP: 0 };
  for (const q of questions) {
    const answer = answers[q.id];
    if (!answer) continue;
    const chosen = answer === 'A' ? q.optionA : q.optionB;
    if (chosen.value === 'E' || chosen.value === 'S' || chosen.value === 'T' || chosen.value === 'J') {
      scores[q.dimension] += 1;
    } else {
      scores[q.dimension] -= 1;
    }
  }
  const type: MbtiType = (
    (scores.EI >= 0 ? 'E' : 'I') +
    (scores.SN >= 0 ? 'S' : 'N') +
    (scores.TF >= 0 ? 'T' : 'F') +
    (scores.JP >= 0 ? 'J' : 'P')
  ) as MbtiType;
  const normalize = (val: number) => Math.min(100, Math.round((val / QUESTIONS_PER_DIMENSION) * 100));
  return {
    type,
    dimensions: { EI: normalize(scores.EI), SN: normalize(scores.SN), TF: normalize(scores.TF), JP: normalize(scores.JP) },
    completedAt: new Date(),
  };
}

interface MbtiState {
  questions: MbtiQuestion[];
  currentQuestion: number;
  answers: Record<number, 'A' | 'B'>;
  result: MbtiResult | null;
  isCompleted: boolean;
  history: MbtiTestRecord[];
  answerQuestion: (questionId: number, choice: 'A' | 'B') => void;
  goBack: () => void;
  calculateResult: () => void;
  resetTest: () => void;
  loadFromStorage: () => void;
  saveToStorage: () => void;
  loadHistory: () => Promise<void>;
  deleteTest: (id: string) => Promise<void>;
}

export const useMbtiStore = create<MbtiState>((set, get) => ({
  questions: selectQuestions(),
  currentQuestion: 0,
  answers: {},
  result: null,
  isCompleted: false,
  history: [],

  answerQuestion: (questionId, choice) => {
    set((state) => ({
      answers: { ...state.answers, [questionId]: choice },
      currentQuestion: state.currentQuestion + 1,
    }));
  },

  goBack: () => {
    set((state) => {
      if (state.currentQuestion <= 0) return state;
      const prevQ = state.questions[state.currentQuestion - 1];
      const newAnswers = { ...state.answers };
      delete newAnswers[prevQ.id];
      return { currentQuestion: state.currentQuestion - 1, answers: newAnswers };
    });
  },

  calculateResult: () => {
    const state = get();
    const result = calculateType(state.answers, state.questions);
    set({ result, isCompleted: true });
    get().saveToStorage();
    // Also save to SQLite history
    if (isRunningInTauri()) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      dbSaveMbtiTest(id, result.type, JSON.stringify(result.dimensions), result.completedAt.toISOString());
      get().loadHistory();
    }
  },

  resetTest: () => {
    set({
      questions: selectQuestions(),
      currentQuestion: 0,
      answers: {},
      result: null,
      isCompleted: false,
    });
    localStorage.removeItem(STORAGE_KEY);
  },

  loadFromStorage: () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.result) {
          set({
            result: { ...data.result, completedAt: new Date(data.result.completedAt) },
            isCompleted: true,
          });
        }
      }
    } catch { /* ignore */ }
  },

  saveToStorage: () => {
    const { result } = get();
    if (result) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ result }));
    }
  },

  loadHistory: async () => {
    if (!isRunningInTauri()) {
      // localStorage fallback: read all stored results
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const data = JSON.parse(stored);
          if (data.result) {
            set({ history: [{ id: 'local', ...data.result, completedAt: new Date(data.result.completedAt) }] });
          }
        }
      } catch { /* ignore */ }
      return;
    }
    try {
      const records = await dbGetMbtiTests();
      set({
        history: records.map(r => ({
          id: r.id,
          type: r.type as MbtiType,
          dimensions: JSON.parse(r.dimensions),
          completedAt: new Date(r.completedAt),
        })),
      });
    } catch { /* ignore */ }
  },

  deleteTest: async (id) => {
    if (isRunningInTauri()) {
      await dbDeleteMbtiTest(id);
    }
    set((state) => ({ history: state.history.filter(h => h.id !== id) }));
  },
}));

export { ALL_QUESTIONS, TOTAL_QUESTIONS };
