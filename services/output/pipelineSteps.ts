/**
 * ============================================================
 * 10阶梯Pipeline步骤集合 V2
 * 参考: docs/upgrade-plans/03-output-enhancement.md
 * 所有步骤都支持 enabled/disabled 配置
 * ============================================================
 */

import { EmotionType } from '../../types';
import { PipelineContext, StepResult } from '../outputPipeline';
import { cleanLLMOutputMarkers } from '../textCleaner';
import { detectForbiddenViolation } from '../aiService';
import { splitIntoSegments, SegmentConfig, protectPairedSymbols } from '../../utils/segmentUtils';
import { applyTypos, TypoSimConfig, DEFAULT_TYPO_CONFIG } from './typoSimulator';

// ---------- 步骤配置接口 ----------

export interface StepEnabledConfig {
  enabled: boolean;
}

// ---------- Step 1: 思维链标记清洗 ----------

export interface CleanMarkersConfig extends StepEnabledConfig {
  removeThoughtTags: boolean;
  removeFeelingTags: boolean;
  removeActionTags: boolean;
  removeInnerMonologue: boolean;
}

export const DEFAULT_CLEAN_MARKERS_CONFIG: CleanMarkersConfig = {
  enabled: true,
  removeThoughtTags: true,
  removeFeelingTags: true,
  removeActionTags: true,
  removeInnerMonologue: true,
};

export class CleanMarkersStepV2 {
  readonly name = 'clean_markers';

  constructor(private config: CleanMarkersConfig = DEFAULT_CLEAN_MARKERS_CONFIG) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true };

    const text = ctx.processedText;
    let cleaned = text;

    if (this.config.removeThoughtTags) {
      cleaned = cleaned.replace(/<thought[\s\S]*?<\/thought>/gi, '');
      cleaned = cleaned.replace(/<思考[\s\S]*?<\/思考>/gi, '');
      cleaned = cleaned.replace(/【思考中】[\s\S]*?【\/思考中】/g, '');
    }
    if (this.config.removeFeelingTags) {
      cleaned = cleaned.replace(/<feeling[\s\S]*?<\/feeling>/gi, '');
      cleaned = cleaned.replace(/<情绪[\s\S]*?<\/情绪>/gi, '');
    }
    // 移除 <reply> 标签（保留内容）
    cleaned = cleaned.replace(/<\/?reply[^>]*>/gi, '');
    if (this.config.removeActionTags) {
      cleaned = cleaned.replace(/<action[\s\S]*?<\/action>/gi, '');
      cleaned = cleaned.replace(/<动作[\s\S]*?<\/动作>/gi, '');
      cleaned = cleaned.replace(/【动作】[\s\S]*?【\/动作】/g, '');
    }
    if (this.config.removeInnerMonologue) {
      cleaned = cleaned.replace(/【内心活动】[\s\S]*?【\/内心活动】/g, '');
    }

    // 通用标记清洗
    cleaned = cleanLLMOutputMarkers(cleaned);
    cleaned = cleaned.trim();

    if (cleaned.length === 0 && text.length > 0) {
      return { ok: false, abort: true, msg: '清洗后为空，使用原文', data: { rawLen: text.length } };
    }

    ctx.processedText = cleaned;
    return { ok: true, msg: text.length !== cleaned.length ? `清洗完成，减少${text.length - cleaned.length}字符` : undefined };
  }
}

// ---------- Step 2: AI腔/复读/违规拦截 ----------

export interface BlockClicheConfig extends StepEnabledConfig {
  blockDuplicate: boolean;
  duplicateThreshold: number;
  blockAICliche: boolean;
  blockPersonaCollapse: boolean;
  blockForbiddenViolation: boolean;
  minLength: number;
  maxLength: number;
}

export const DEFAULT_BLOCK_CLICHE_CONFIG: BlockClicheConfig = {
  enabled: true,
  blockDuplicate: true,
  duplicateThreshold: 0.85,
  blockAICliche: true,
  blockPersonaCollapse: true,
  blockForbiddenViolation: true,
  minLength: 2,
  maxLength: 2000,
};

export class BlockClicheStepV2 {
  readonly name = 'block_cliche';

  constructor(private config: BlockClicheConfig = DEFAULT_BLOCK_CLICHE_CONFIG) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true };

    const text = ctx.processedText;

    // 违规检测 → abort，无法安全改写
    if (this.config.blockForbiddenViolation && ctx.forbiddenText) {
      const violated = detectForbiddenViolation(text, ctx.forbiddenText);
      if (violated) {
        return { ok: false, abort: true, msg: `违反禁止项: ${violated}`, data: { reason: 'forbidden', violatedItem: violated } };
      }
    }

    // 长度检查
    if (text.length < this.config.minLength) {
      return { ok: false, abort: true, msg: '回复过短', data: { reason: 'too_short' } };
    }
    if (text.length > this.config.maxLength) {
      return { ok: false, abort: false, msg: '回复过长', data: { reason: 'too_long' } };
    }

    return { ok: true };
  }
}

// ---------- Step 3: 错字模拟 ----------

export class TypoSimStep {
  readonly name = 'typo_sim';

  constructor(private config: TypoSimConfig = DEFAULT_TYPO_CONFIG) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true };

    const result = applyTypos(ctx.processedText, this.config);
    if (result.corrections.length > 0) {
      ctx.processedText = result.text;
      return { ok: true, msg: `错字模拟: ${result.corrections.length}处`, data: { corrections: result.corrections } };
    }

    return { ok: true };
  }
}

// ---------- Step 4: 智能分段 ----------

export interface SmartSegmentConfig extends SegmentConfig {
  pairProtection: boolean;
  /** AI 段间基础延迟（前端 pipeline 兜底时用于动态计算段间延迟，与 Rust 端 segmentDelayMs 对齐） */
  segmentDelayMs?: number;
}

export const DEFAULT_SMART_SEGMENT_CONFIG: SmartSegmentConfig = {
  enabled: true,
  threshold: 20,
  maxSegments: 8,
  mode: 'smart',
  minSegmentLength: 6,
  pairProtection: true,
  segmentDelayMs: 800,
};

/**
 * AI 段间延迟：与 Rust 端 compute_segment_delays 对齐的兜底实现。
 * 第 i 项 = 第 i+1 段前的等待毫秒数。段越长等待越久；情绪越激动间隔越短。
 *
 * 🆕 E1: 三系数实时化（各 clamp，缺省 1 不改变基线行为）：
 *  - userCadenceMs    节奏跟随：用户最近消息平均间隔 ms → 归一化 0.6~1.5
 *                     （用户连发快消息时 AI 分段也快）
 *  - activityFactor   活动系数：复用 getReplyDelayForActivity 的类别延迟，
 *                     相对基线归一化 0.7~1.5（活动中回复更慢）
 *  - excitementFactor 对话兴奋度：最近双方消息平均长度倒数代理，
 *                     短消息互抛压短(0.75)、长段落讨论拉长(≤1.6)
 */
export interface SegmentDelayCtx {
  userCadenceMs?: number;
  activityFactor?: number;
  excitementFactor?: number;
}

const clampF = (v: number | undefined, lo: number, hi: number): number =>
  (typeof v === 'number' && Number.isFinite(v)) ? Math.min(Math.max(v, lo), hi) : 1;

export function computeSegmentDelays(
  segments: string[],
  baseDelayMs: number,
  intensity: number,
  ctx?: SegmentDelayCtx,
): number[] {
  if (segments.length <= 1) return [];
  const base = Math.max(baseDelayMs || 800, 100);
  const emotionFactor = Math.min(Math.max(1 - (Math.min(Math.max(intensity, 0), 100) / 100) * 0.35, 0.6), 1);
  // E1 三系数（各独立 clamp）
  const cadenceFactor = clampF(typeof ctx?.userCadenceMs === 'number' ? ctx.userCadenceMs / 8000 : undefined, 0.6, 1.5);
  const actFactor = clampF(ctx?.activityFactor, 0.7, 1.5);
  const exciteFactor = clampF(ctx?.excitementFactor, 0.75, 1.6);
  const delays: number[] = [];
  for (let i = 1; i < segments.length; i++) {
    const len = segments[i].length;
    const lengthFactor = Math.min(Math.max(len / 12, 0.5), 2.2);
    delays.push(Math.max(Math.round(base * lengthFactor * emotionFactor * cadenceFactor * actFactor * exciteFactor), 120));
  }
  return delays;
}

export class SmartSegmentStep {
  readonly name = 'segment';

  constructor(private config: SmartSegmentConfig = DEFAULT_SMART_SEGMENT_CONFIG) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true, data: { segments: [ctx.processedText] } };

    let segments = splitIntoSegments(ctx.processedText, {
      enabled: this.config.enabled,
      threshold: this.config.threshold,
      maxSegments: this.config.maxSegments,
      mode: this.config.mode,
      minSegmentLength: this.config.minSegmentLength,
    });

    // 成对符号保护
    if (this.config.pairProtection) {
      segments = protectPairedSymbols(segments);
    }

    // 合并过短段
    segments = mergeTinySegments(segments, 4);

    // 限制段数
    if (segments.length > this.config.maxSegments) {
      const take = segments.slice(0, this.config.maxSegments - 1);
      const tail = segments.slice(this.config.maxSegments - 1).join('，');
      take.push(tail);
      segments = take;
    }

    const segmentDelays = computeSegmentDelays(segments, this.config.segmentDelayMs ?? 800, ctx.emotion?.intensity ?? 50);
    return { ok: true, data: { segments, segmentDelays }, msg: segments.length > 1 ? `分段: ${segments.length}段` : undefined };
  }
}

// ---------- Step 5: 语气微调增强 ----------

export interface TonePolishConfig extends StepEnabledConfig {
  emotionExpressions: Record<string, string[]>;
  prefixProb: number;  // 句首语气词基础概率
  suffixProb: number;  // 句末语气词基础概率
  intensity?: number;  // 语气强度倍率（0~100，默认50）
}

export const DEFAULT_TONE_POLISH_CONFIG: TonePolishConfig = {
  enabled: true,
  emotionExpressions: {},
  prefixProb: 0.06,
  suffixProb: 0.08,
  intensity: 50,
};

export class TonePolishStepV2 {
  readonly name = 'tone_polish';

  constructor(private config: TonePolishConfig = DEFAULT_TONE_POLISH_CONFIG) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true };

    const { type, intensity } = ctx.emotion;
    if (intensity < 15) return { ok: true };

    // 语气强度倍率：配置的 intensity 是 0~100，转换为 0~2 的倍率（50=1倍）
    const intensityMult = (this.config.intensity ?? 50) / 50;

    let text = ctx.processedText;
    let changed = false;

    // 句首语气词
    const prefixProb = ((this.config.prefixProb ?? 0.06) + (intensity / 100) * 0.06) * intensityMult;
    if (Math.random() < Math.min(0.5, prefixProb)) {
      const prefix = this.getPrefixParticle(type);
      if (prefix && !text.startsWith(prefix.replace(/[。！？!?~，、\s]/g, '').slice(0, 2))) {
        text = prefix + text;
        changed = true;
      }
    }

    // 句末语气词
    const suffixProb = ((this.config.suffixProb ?? 0.08) + (intensity / 100) * 0.08) * intensityMult;
    if (Math.random() < Math.min(0.6, suffixProb)) {
      const suffix = this.getSuffixParticle(type);
      if (suffix) {
        text = this.appendParticle(text, suffix);
        changed = true;
      }
    }

    if (changed) {
      ctx.processedText = text;
      return { ok: true, msg: '语气微调完成' };
    }
    return { ok: true };
  }

  private getPrefixParticle(emotion: EmotionType): string {
    const particles: Record<string, string[]> = {
      joy: ['嘿嘿，', '哈哈，', '诶嘿~', '哇，'],
      trust: ['嗯~', '好呀~', '谢谢~'],
      fear: ['嘶...', '那个...', '唔...'],
      surprise: ['诶？！', '哇！', '啊？', '等等，', '嚯！'],
      sadness: ['唉...', '唔...', '嗯...', '害...'],
      disgust: ['啧...', '呃...', '唉...'],
      anger: ['哼！', '啧，', '切，', '喂，'],
      anticipation: ['嗯...', '诶？', '哦？'],
      pride: ['嘿嘿~', '看吧~', '哼哼~'],
      guilt: ['那个...', '对不起...', '唔...'],
      embarrassment: ['那个...', '嗯...', '唔...', '呃...'],
      jealousy: ['哼...', '切...', '啧...'],
    };
    const list = particles[emotion] || [];
    if (list.length === 0) return '';
    return list[Math.floor(Math.random() * list.length)];
  }

  private getSuffixParticle(emotion: EmotionType): string {
    const particles: Record<string, string[]> = {
      joy: ['~', '呀', '啦', '哦', '呢', '嘻嘻'],
      trust: ['~', '哦', '呢'],
      fear: ['...', '呢', '吧'],
      surprise: ['！', '？', '哦！'],
      sadness: ['...', '呢', '吧', '。唉'],
      disgust: ['...', '唉', '。'],
      anger: ['！', '哼！', '真是的'],
      anticipation: ['？', '呢', '吧'],
      pride: ['~', '哦', '哼哼'],
      guilt: ['...', '呢', '吧'],
      embarrassment: ['...', '啦', '嘛', '呜...'],
      jealousy: ['...', '哼', '切'],
    };
    const list = particles[emotion] || [];
    if (list.length === 0) return '';
    return list[Math.floor(Math.random() * list.length)];
  }

  private appendParticle(text: string, particle: string): string {
    const lastPunctMatch = text.match(/[。！？!?~]+$/);
    if (lastPunctMatch) {
      const punctIndex = text.length - lastPunctMatch[0].length;
      return text.slice(0, punctIndex) + particle + lastPunctMatch[0];
    }
    return text + particle;
  }
}

// ---------- Step 6: 长度随机化增强 ----------

export class LengthRandomizeStepV2 {
  readonly name = 'length_randomize';

  constructor(private config: StepEnabledConfig = { enabled: true }) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true };

    const text = ctx.processedText;
    if (text.length <= 10) return { ok: true };

    // 只做微调：缩短过长的单句，不截断句子数量
    const segments = text.split(/(?<=[。！？….!?])/).filter(s => s.trim());
    if (segments.length === 0) return { ok: true };

    let changed = false;
    const result = segments.map(seg => {
      // 只处理超过 80 字的句子（原 50，但包含动作描写的角色语极易超限），
      // 随机缩短到 50-65 字（原 30-40，避免把括号内容切成碎片）
      if (seg.length > 80) {
        const targetLen = 50 + Math.floor(Math.random() * 16); // 50-65
        // 找最近的标点或自然断点截断
        const cutPoint = this.findNaturalCut(seg, targetLen);
        if (cutPoint > 10 && cutPoint < seg.length) {
          changed = true;
          return seg.slice(0, cutPoint);
        }
      }
      return seg;
    });

    if (changed) {
      const newText = result.join('');
      ctx.processedText = newText;
      return { ok: true, msg: `长度微调: ${text.length}→${newText.length}字` };
    }

    return { ok: true };
  }

  /** 找自然断点：标点、空格、语气词边界，并跳过成对符号内部 */
  private findNaturalCut(text: string, targetLen: number): number {
    // 在 targetLen 附近找标点（含成对符号的右括号，可借此完整跳过动作/引文）
    for (let i = targetLen; i >= targetLen - 10 && i >= 0; i--) {
      if ('，,、；;。！？…）」』】'.includes(text[i])) {
        return i + 1;
      }
    }
    // 找空格
    const spaceIdx = text.lastIndexOf(' ', targetLen);
    if (spaceIdx > targetLen - 10) return spaceIdx + 1;
    // 找语气词边界
    for (let i = targetLen; i >= targetLen - 8 && i >= 0; i--) {
      if ('呢啊吧呀嘛哦哈嗯啦'.includes(text[i])) {
        return i + 1;
      }
    }
    // ── 兜底截断：避免切在成对符号内部（如（动作描述）、「引文」等） ──
    const pairs: Array<[string, string]> = [['（', '）'], ['「', '」'], ['『', '』'], ['【', '】'], ['"', '"'], ["'", "'"]];
    for (const [open, close] of pairs) {
      // 检查 targetLen 位置是否在一对 open…close 之间
      const before = text.lastIndexOf(open, targetLen);
      const after = text.indexOf(close, targetLen);
      if (before !== -1 && after !== -1 && after > targetLen) {
        // 在 open…close 内部 → 跳过整个括号内容
        return after + 1;
      }
    }
    return targetLen;
  }
}

// ---------- Step 7: 口语化注入增强 ----------

export interface ColloquialismConfig extends StepEnabledConfig {
  prefixProb: number;
  suffixProb: number;
  repeatProb: number;
  ellipsisProb: number;
}

export const DEFAULT_COLLOQUIALISM_CONFIG: ColloquialismConfig = {
  enabled: true, prefixProb: 0.12, suffixProb: 0.18, repeatProb: 0.08, ellipsisProb: 0.06,
};

export class ColloquialismStepV2 {
  readonly name = 'colloquialism';

  constructor(private config: ColloquialismConfig = DEFAULT_COLLOQUIALISM_CONFIG) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true };

    const text = ctx.processedText;
    if (text.length <= 4) return { ok: true };

    let result = text;
    let changes = 0;

    // 语气词前缀
    if (Math.random() < (this.config.prefixProb ?? 0.12) && !result.match(/^[嗯啊哦诶嘿哼嘶额害]/)) {
      const prefixes = ['嗯...', 'emm...', '害...', '诶？', '嘶...', '额...', '啊...', '咦...'];
      const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
      result = prefix + result;
      changes++;
    }

    // 语气词后缀
    if (Math.random() < (this.config.suffixProb ?? 0.18) && !result.endsWith('~') && !result.endsWith('啦') && !result.endsWith('呢')) {
      const suffixes = ['~', '啦', '呢', '嘛', '吧', '哈', '呐'];
      const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
      result = result + suffix;
      changes++;
    }

    // 重复字增强
    if (Math.random() < (this.config.repeatProb ?? 0.08) && result.length > 5) {
      const repeatPatterns = [
        { regex: /哈哈/g, replace: '哈哈哈' },
        { regex: /好好(?!好)/g, replace: '好好好' },
        { regex: /对对(?!对)/g, replace: '对对对' },
        { regex: /嗯嗯(?!嗯)/g, replace: '嗯嗯嗯' },
        { regex: /啊啊(?!啊)/g, replace: '啊啊啊' },
      ];
      const pattern = repeatPatterns[Math.floor(Math.random() * repeatPatterns.length)];
      if (pattern.regex.test(result)) {
        result = result.replace(pattern.regex, pattern.replace);
        changes++;
      }
    }

    // 省略号/波浪线
    if (Math.random() < (this.config.ellipsisProb ?? 0.06) && !result.includes('...') && !result.includes('。。')) {
      const sentences = result.split(/(?<=[。！？!?~])/);
      if (sentences.length > 1) {
        const insertIndex = Math.floor(Math.random() * (sentences.length - 1)) + 1;
        sentences[insertIndex] = '...' + sentences[insertIndex];
        result = sentences.join('');
        changes++;
      }
    }

    if (changes > 0) {
      ctx.processedText = result;
      return { ok: true, msg: `口语化注入: ${changes}处` };
    }

    return { ok: true };
  }
}

// ---------- Step 8: 智能标点 ----------

export interface SmartPunctuationConfig extends StepEnabledConfig {
  commaInsertProb: number;
  exclamationProb: number;
  tildeProb: number;
}

export const DEFAULT_SMART_PUNCTUATION_CONFIG: SmartPunctuationConfig = {
  enabled: true, commaInsertProb: 0.05, exclamationProb: 0.3, tildeProb: 0.25,
};

export class SmartPunctuationStep {
  readonly name = 'smart_punctuation';

  constructor(private config: SmartPunctuationConfig = DEFAULT_SMART_PUNCTUATION_CONFIG) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true };

    let text = ctx.processedText;
    let changed = false;

    // 去掉过多的感叹号
    if (/[！!]{3,}/.test(text)) {
      text = text.replace(/[！!]{3,}/g, '！！');
      changed = true;
    }

    // 逗号自然化
    if (text.length > 30 && (text.match(/[，,]/g) || []).length < 2) {
      const words = [...text];
      for (let i = Math.floor(words.length * 0.3); i < words.length; i++) {
        if (i > 5 && /[\u4e00-\u9fff]/.test(words[i]) && !/[。，！？，.!?]/.test(words[i]) && Math.random() < (this.config.commaInsertProb ?? 0.05)) {
          words.splice(i, 0, '，');
          i++;
          changed = true;
          break;
        }
      }
      if (changed) text = words.join('');
    }

    // 句号 → 感叹号
    if (ctx.emotion.intensity > 60 && ['anger', 'surprise', 'joy', 'pride'].includes(ctx.emotion.type)) {
      if (Math.random() < (this.config.exclamationProb ?? 0.3)) {
        text = text.replace(/。$/, '！');
        changed = true;
      }
    }

    // 句号 → 波浪线
    if (['trust', 'joy', 'embarrassment'].includes(ctx.emotion.type) && ctx.emotion.intensity > 40) {
      if (Math.random() < (this.config.tildeProb ?? 0.25)) {
        text = text.replace(/。$/, '~');
        changed = true;
      }
    }

    if (changed) {
      ctx.processedText = text;
      return { ok: true, msg: '标点自然化' };
    }

    return { ok: true };
  }
}

// ---------- Step 9: 说话节奏 ----------

export interface SpeakingRhythmConfig extends StepEnabledConfig {
  breathPauseProb: number;
}

export const DEFAULT_SPEAKING_RHYTHM_CONFIG: SpeakingRhythmConfig = {
  enabled: true, breathPauseProb: 0.15,
};

export class SpeakingRhythmStep {
  readonly name = 'speaking_rhythm';

  constructor(private config: SpeakingRhythmConfig = DEFAULT_SPEAKING_RHYTHM_CONFIG) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true };

    const text = ctx.processedText;
    if (text.length <= 15) return { ok: true };

    let result = text;
    let changed = false;

    // 换气停顿
    if (Math.random() < (this.config.breathPauseProb ?? 0.15) && text.length > 25) {
      const breakPoints = [...text.matchAll(/[，,。！？!?~]/g)];
      if (breakPoints.length > 1) {
        const mid = breakPoints[Math.floor(breakPoints.length * 0.4)];
        if (mid.index !== undefined) {
          result = text.slice(0, mid.index + 1) + '\n' + text.slice(mid.index + 1);
          changed = true;
        }
      }
    }

    if (changed) {
      ctx.processedText = result;
      return { ok: true, msg: '节奏调整' };
    }

    return { ok: true };
  }
}

// ---------- Step 10: 最终净化 ----------

export interface FinalSanitizeConfig extends StepEnabledConfig {
  removeDuplicatePunctuation?: boolean;
  normalizeWhitespace?: boolean;
}

export const DEFAULT_FINAL_SANITIZE_CONFIG: FinalSanitizeConfig = {
  enabled: true,
  removeDuplicatePunctuation: true,
  normalizeWhitespace: true,
};

export class FinalSanitizeStep {
  readonly name = 'final_sanitize';

  constructor(private config: FinalSanitizeConfig = DEFAULT_FINAL_SANITIZE_CONFIG) {}

  handle(ctx: PipelineContext): StepResult {
    if (!this.config.enabled) return { ok: true };

    let text = ctx.processedText;

    // 文本洗练：智能修复"嗯的、的呢？"式冗余"的"（与 Rust 端 fix_redundant_de 对齐）
    // 1) "的、的" 双"的"夹顿号 → 折叠为单"的"；2) "顿号+的+语气词" → 去顿号留"的"
    while (/的、的/.test(text)) {
      text = text.replace(/的、的/g, '的');
    }
    text = text.replace(/、的(?=呢|啊|呀|哦|嘛|吧|诶|哇|哎|哈|嘿|嗯|吗|？|\?|。|！|!)/g, '的');

    // 去除重复标点
    if (this.config.removeDuplicatePunctuation) {
      text = text
        .replace(/([。！？!?.])\1{3,}/g, '$1$1$1')
        .replace(/([，,、；;：:])\1+/g, '$1')
        .replace(/([。！？!?.])\1+/g, '$1$1');
    }

    // 规范化空白与换行
    if (this.config.normalizeWhitespace) {
      text = text
        .replace(/^[\s\n]+/, '')
        .replace(/[\s\n]+$/, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+([，,、；;：:。！？])/g, '$1')
        .replace(/([，,、；;：:。！？])\s+/g, '$1');
    } else {
      // 即使关闭规范化，也做基本的 trim 和多余空格处理
      text = text.replace(/^[\s\n]+/, '');
      text = text.replace(/[\s\n]+$/, '');
      text = text.replace(/[ ]{2,}/g, ' ');
      text = text.replace(/\n{3,}/g, '\n\n');
    }

    text = text.replace(/……+/g, '……');
    text = text.replace(/\.\.\.\.\.\./g, '...');
    text = text.trim();

    if (text.length === 0) {
      return { ok: false, abort: true, msg: '净化后为空' };
    }

    ctx.processedText = text;
    return { ok: true };
  }
}

// ---------- 辅助函数 ----------

function mergeTinySegments(segments: string[], minLen = 4): string[] {
  const result: string[] = [];
  for (const seg of segments) {
    if (result.length > 0 && seg.length < minLen) {
      result[result.length - 1] = result[result.length - 1] + seg;
    } else {
      result.push(seg);
    }
  }
  return result;
}
