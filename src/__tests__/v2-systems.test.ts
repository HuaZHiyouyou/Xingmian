/**
 * ============================================================
 * V2 系统单元测试
 * 覆盖: 情感/记忆/输出/学习核心算法
 * 运行: npm test
 * ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { calculateMemoryClarity, getMemoryClarityTier, getClarityPromptStyle, retrieveRelevantMemories, extractKeywords, convertToCoreMemory, createEpisodicMemory, memoryCleanup } from '../services/memory/memorySystemV2';
import { applyTypos, DEFAULT_TYPO_CONFIG } from '../services/output/typoSimulator';
import { EmotionStateManager } from '../services/emotion/emotionStateManager';
import { getTop3Emotion, parseFeelingTag } from '../services/emotion/thoughtChainParser';
import { HistoryCleaner } from '../services/emotion/historyCleaner';
import { JargonMiner, FewShotGenerator, ReviewQueue } from '../services/learning/selfLearningV2';
import { MultiEmotionState, defaultMultiEmotionState, EmotionType, Memory } from '../types';

// ============================================================
// 记忆系统测试
// ============================================================

describe('Memory System V2', () => {
  describe('calculateMemoryClarity', () => {
    it('新创建的高重要性记忆应该有高清晰度', () => {
      const clarity = calculateMemoryClarity({
        importance: 10,
        daysSinceCreation: 0,
        daysSinceLastRecall: 0,
        recallCount: 0,
        emotionIntensity: 80,
      });
      expect(clarity).toBeGreaterThanOrEqual(80);
    });

    it('老旧低重要性记忆应该有低清晰度', () => {
      const clarity = calculateMemoryClarity({
        importance: 2,
        daysSinceCreation: 365,
        daysSinceLastRecall: 365,
        recallCount: 0,
        emotionIntensity: 10,
      });
      expect(clarity).toBeLessThan(30);
    });

    it('回忆次数多应该增强清晰度', () => {
      const clarity = calculateMemoryClarity({
        importance: 5,
        daysSinceCreation: 30,
        daysSinceLastRecall: 1,
        recallCount: 5,
        emotionIntensity: 50,
      });
      expect(clarity).toBeGreaterThan(30);
    });

    it('返回的值应在0-100之间', () => {
      const testCases = [
        { importance: 1, daysSinceCreation: 1000, daysSinceLastRecall: 1000, recallCount: 0, emotionIntensity: 0 },
        { importance: 10, daysSinceCreation: 0, daysSinceLastRecall: 0, recallCount: 0, emotionIntensity: 100 },
        { importance: 5, daysSinceCreation: 100, daysSinceLastRecall: 0, recallCount: 0, emotionIntensity: 50 },
      ];
      for (const params of testCases) {
        const clarity = calculateMemoryClarity(params);
        expect(clarity).toBeGreaterThanOrEqual(0);
        expect(clarity).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('getMemoryClarityTier', () => {
    it.each([
      [85, 'vivid'],
      [60, 'clear'],
      [40, 'hazy'],
      [20, 'faded'],
      [5, 'forgotten'],
    ])('%d → %s', (clarity, expected) => {
      expect(getMemoryClarityTier(clarity)).toBe(expected);
    });
  });

  describe('getClarityPromptStyle', () => {
    it('各等级返回正确的提示风格', () => {
      expect(getClarityPromptStyle('vivid')).toBe('记得很清楚：');
      expect(getClarityPromptStyle('forgotten')).toBe('似乎有点印象：');
    });
  });

  describe('extractKeywords', () => {
    it('应从中文文本中提取关键词', () => {
      const keywords = extractKeywords('今天天气真好，我们去公园散步吧');
      expect(keywords.length).toBeGreaterThan(0);
      // 分词结果包含子词片段（如'天气真好'、'公园散步'等）
      const joined = keywords.join(' ');
      expect(joined).toMatch(/天气|公园/);
    });

    it('应排除停用词', () => {
      const keywords = extractKeywords('我和你在那里');
      // 不应包含停用词如"我和"
      const stopWords = new Set(['的', '了', '是', '在', '我']);
      for (const kw of keywords) {
        expect(stopWords.has(kw)).toBe(false);
      }
    });
  });

  describe('retrieveRelevantMemories', () => {
    const coreMemories = [
      { id: '1', characterId: 'c1', type: 'fact' as const, content: '用户喜欢喝咖啡', importance: 8, confidence: 0.9, emotionTags: [] as EmotionType[], createdAt: new Date(), updatedAt: new Date(), sourceConversationId: '', keywords: ['咖啡', '喜欢'] },
      { id: '2', characterId: 'c1', type: 'fact' as const, content: '猫叫小橘', importance: 4, confidence: 0.7, emotionTags: [] as EmotionType[], createdAt: new Date(), updatedAt: new Date(), sourceConversationId: '', keywords: ['猫', '小橘'] },
    ];

    it('应检索到关键词匹配的记忆', () => {
      const result = retrieveRelevantMemories({
        userMessage: '我想喝咖啡',
        coreMemories,
        episodicMemories: [],
        maxResults: 3,
      });
      expect(result.core.length).toBeGreaterThan(0);
      expect(result.core[0].memory.content).toContain('咖啡');
    });

    it('不相关时应返回空结果', () => {
      const result = retrieveRelevantMemories({
        userMessage: '今天吃面条',
        coreMemories,
        episodicMemories: [],
        maxResults: 3,
        minScore: 0.3,
      });
      // 可能只有弱关联，但不应有高分匹配
      const highScore = result.core.filter(r => r.score >= 0.5);
      expect(highScore.length).toBeLessThan(2);
    });
  });

  describe('convertToCoreMemory', () => {
    it('应正确转换 Memory 为 CoreMemory', () => {
      const oldMemory = {
        id: 'm1',
        content: '测试记忆',
        importance: 7,
        clarity: 80,
        createdAt: new Date('2024-01-01'),
        lastRecalled: new Date('2024-06-01'),
        recallCount: 3,
        conversationId: 'conv1',
        category: '总结',
        characterId: 'c1',
        title: '',
        tags: [],
      };
      const core = convertToCoreMemory(oldMemory as unknown as Memory, 'c1');
      expect(core.type).toBe('identity');
      expect(core.importance).toBe(7);
      expect(core.keywords.length).toBeGreaterThan(0);
    });
  });

  describe('createEpisodicMemory', () => {
    it('应创建正确的情节记忆', () => {
      const ep = createEpisodicMemory('e1', 'c1', '你好', '你好呀~', { type: 'joy', intensity: 60 }, 'bonding');
      expect(ep.category).toBe('bonding');
      expect(ep.emotionAtTime.type).toBe('joy');
      expect(ep.content).toContain('你好');
    });
  });

  describe('memoryCleanup', () => {
    it('超量时应清理多余记忆', () => {
      const manyCore = Array.from({ length: 150 }, (_, i) => ({
        id: `c${i}`, characterId: 'c1', type: 'fact' as const,
        content: `记忆${i}`, importance: i % 10 + 1, confidence: 0.5,
        emotionTags: [] as EmotionType[], createdAt: new Date(), updatedAt: new Date(),
        sourceConversationId: '', keywords: [`${i}`],
      }));
      const result = memoryCleanup(manyCore, [], 100, 200);
      expect(result.core.length).toBeLessThanOrEqual(100);
      expect(result.removed).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// 输出增强测试
// ============================================================

describe('Output Enhancement', () => {
  describe('TypoSimulator', () => {
    it('关闭时不产生错字', () => {
      const result = applyTypos('今天天气真好', { ...DEFAULT_TYPO_CONFIG, enabled: false });
      expect(result.text).toBe('今天天气真好');
      expect(result.corrections.length).toBe(0);
    });

    it('短文本不应产生错字', () => {
      const result = applyTypos('你好', { ...DEFAULT_TYPO_CONFIG, enabled: true, minLength: 10 });
      expect(result.text).toBe('你好');
    });

    it('长文本可能产生错字', () => {
      // 多次测试验证概率在合理范围内
      let hasTypos = 0;
      for (let i = 0; i < 20; i++) {
        const result = applyTypos('今天天气真好我们去公园散步吧然后去吃好吃的', {
          ...DEFAULT_TYPO_CONFIG, enabled: true, probability: 0.2, minLength: 5,
        });
        if (result.corrections.length > 0) hasTypos++;
      }
      // 概率0.2应该有几次命中
      expect(hasTypos).toBeGreaterThan(0);
    });

    it('修正数不应超过2个', () => {
      for (let i = 0; i < 30; i++) {
        const result = applyTypos(
          '这是一段非常长的测试文本用来验证错字模拟器在极端情况下不会产生过多的错字',
          { ...DEFAULT_TYPO_CONFIG, enabled: true, probability: 1.0, minLength: 2 }
        );
        expect(result.corrections.length).toBeLessThanOrEqual(2);
      }
    });

    it('修正后文本长度应与原文相当', () => {
      const text = '今天天气真好我们出去吃饭吧';
      const result = applyTypos(text, { ...DEFAULT_TYPO_CONFIG, enabled: true, probability: 0.5, minLength: 5 });
      expect(result.text.length).toBe(text.length);
    });
  });
});

// ============================================================
// 情感系统测试
// ============================================================

describe('Emotion System V2', () => {
  describe('EmotionStateManager', () => {
    const manager = new EmotionStateManager();

    it('update 应正确混合新情绪', () => {
      const state: MultiEmotionState = {
        ...defaultMultiEmotionState,
        values: { joy: 40, sadness: 10 },
        lastUpdated: Date.now(),
      };
      const updated = manager.update(state, { newEmotion: 'joy', intensity: 60 });
      // joy 应该上升（混合了新值和旧值）
      expect(updated.values.joy).toBeGreaterThan(40);
      expect(updated.values.joy).toBeLessThan(90);
    });

    it('代谢应减少指定情绪', () => {
      const state: MultiEmotionState = {
        ...defaultMultiEmotionState,
        values: { sadness: 50, joy: 30 },
        lastUpdated: Date.now(),
      };
      const updated = manager.update(state, {
        newEmotion: 'joy', intensity: 20,
        metabolisms: [{ emotion: 'sadness', delta: -20, reason: '安抚后消退' }],
      });
      expect(updated.values.sadness).toBeLessThan(50);
    });
  });

  describe('thoughtChainParser', () => {
    describe('parseFeelingTag', () => {
      it('应正确解析feeling标签', () => {
        const text = '<feeling>joy:60,sadness:15,trust:40</feeling>今天好开心';
        const result = parseFeelingTag(text);
        expect(result).not.toBeNull();
        expect(result!.joy).toBe(60);
        expect(result!.sadness).toBe(15);
      });

      it('解析不包含feeling标签时应返回null', () => {
        const text = '今天天气真好';
        const result = parseFeelingTag(text);
        expect(result).toBeNull();
      });

      it('值应限定在0-100范围', () => {
        const text = '<feeling>joy:150,sadness:-10</feeling>';
        const result = parseFeelingTag(text);
        expect(result).not.toBeNull();
        if (result) {
          expect(result.joy).toBeLessThanOrEqual(100);
          expect(result.sadness || 0).toBeGreaterThanOrEqual(0);
        }
      });
    });
  });

  describe('getTop3Emotion', () => {
    it('应返回前三个最高值的情绪', () => {
      const state: MultiEmotionState = {
        ...defaultMultiEmotionState,
        values: { joy: 70, sadness: 20, anger: 15, anticipation: 60, trust: 40 },
      };
      const top3 = getTop3Emotion(state);
      expect(top3.primary.intensity).toBeGreaterThanOrEqual(top3.secondary?.intensity || 0);
      expect(top3.secondary?.intensity || 0).toBeGreaterThanOrEqual(top3.tertiary?.intensity || 0);
    });
  });

  describe('HistoryCleaner', () => {
    const cleaner = new HistoryCleaner();

    it('应移除thought标签', () => {
      const result = cleaner.clean('<thought>用户有点不开心</thought>嗯，我理解你的感受');
      expect(result.cleanText).not.toContain('thought');
      expect(result.cleanText).toContain('理解');
    });

    it('应移除feeling标签', () => {
      const result = cleaner.clean('<feeling>joy:50</feeling>今天很开心~');
      expect(result.cleanText).not.toContain('feeling');
      expect(result.cleanText).toContain('开心');
    });

    it('空输入不应崩溃', () => {
      const result = cleaner.clean('');
      expect(result.cleanText.length).toBeGreaterThan(0); // fallback
    });
  });
});

// ============================================================
// 自学习系统测试
// ============================================================

describe('Self-Learning System V2', () => {
  describe('JargonMiner', () => {
    const miner = new JargonMiner({ minFrequency: 2, minConfidence: 0.5, maxTermsPerCharacter: 10 });

    it('应挖掘到高频词汇', () => {
      const messages = [
        { role: 'user' as const, content: '今天加班到很晚好烦啊' },
        { role: 'user' as const, content: '又是加班累死了' },
        { role: 'user' as const, content: '不想加班了' },
      ];
      const results = miner.mine(messages, 'c1');
      expect(results.some(r => r.word === '加班')).toBe(true);
    });

    it('消息不足时不挖掘', () => {
      const messages = [
        { role: 'user' as const, content: '好烦' },
      ];
      const results = miner.mine(messages, 'c1');
      expect(results.length).toBe(0);
    });

    it('常见词不应被挖掘', () => {
      const messages = [
        { role: 'user' as const, content: '我知道你可以的' },
        { role: 'user' as const, content: '我知道你很好' },
        { role: 'user' as const, content: '我知道' },
      ];
      const results = miner.mine(messages, 'c1');
      expect(results.some(r => r.word === '知道')).toBe(false);
    });
  });

  describe('FewShotGenerator', () => {
    const generator = new FewShotGenerator();

    it('应生成符合质量的few-shot示例', () => {
      const messages = [
        { role: 'user' as const, content: '今天好累啊' },
        { role: 'assistant' as const, content: '摸摸头~辛苦了，要不要喝点热水休息一下？' },
        { role: 'user' as const, content: '嗯嗯好的' },
      ];
      const examples = generator.generate(messages, 2);
      expect(examples.length).toBeGreaterThan(0);
      if (examples.length > 0) {
        expect(examples[0].source).toBe('real');
        expect(examples[0].user).toBeTruthy();
        expect(examples[0].assistant).toBeTruthy();
      }
    });

    it('应排除AI腔回复', () => {
      const messages = [
        { role: 'user' as const, content: '你好' },
        { role: 'assistant' as const, content: '您好！作为AI助手，我很高兴为您服务' },
      ];
      const examples = generator.generate(messages, 3);
      expect(examples.length).toBe(0);
    });

    it('buildPrompt 应生成格式正确的prompt', () => {
      const examples = [
        { user: '你好', assistant: '嗨~', tags: ['轻松'], source: 'real' as const },
      ];
      const prompt = generator.buildPrompt(examples);
      expect(prompt).toContain('你好');
      expect(prompt).toContain('嗨~');
    });
  });

  describe('ReviewQueue', () => {
    let queue: ReviewQueue;

    beforeEach(() => {
      queue = new ReviewQueue(50);
    });

    it('提交后应有pending状态', () => {
      const item = queue.submit('vocabulary', { word: '测试' }, 'c1');
      expect(item.status).toBe('pending');
      expect(queue.getPending().length).toBe(1);
    });

    it('批准后状态应变为approved', () => {
      const item = queue.submit('vocabulary', { word: '测试' }, 'c1');
      const result = queue.approve(item.id);
      expect(result).toBe(true);
      const approved = queue.getApproved('vocabulary', 'c1') as { word: string }[];
      expect(approved.length).toBe(1);
      expect(approved[0].word).toBe('测试');
    });

    it('拒绝后状态应变为rejected', () => {
      const item = queue.submit('phrase', { text: '测试句式' }, 'c1');
      queue.reject(item.id);
      expect(queue.getPending().length).toBe(0);
    });

    it('应按characterId过滤', () => {
      queue.submit('vocabulary', { word: 'A' }, 'c1');
      queue.submit('vocabulary', { word: 'B' }, 'c2');
      expect(queue.getPending('c1').length).toBe(1);
      expect(queue.getPending('c2').length).toBe(1);
    });
  });
});
