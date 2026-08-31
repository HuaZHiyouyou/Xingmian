/**
 * ============================================================
 * 兜底文案治理（A7）
 * Rust 失败/空回复等降级场景的本地文案：角色口吻模板 + 轮换选取，
 * 杜绝"走神了"三连。不调 LLM。进入对话前应记录 fallback_degraded 日志。
 * ============================================================
 */
import type { Character, EmotionType } from '../types';

/** 降级类型：empty=Rust 空回复兜底；error=Rust 报错兜底 */
export type FallbackKind = 'empty' | 'error';

/** 轮换索引（进程内持久，按 类型+情绪 键控） */
const rotationIdx: Record<string, number> = {};

function pickRotating(key: string, variants: string[]): string {
  if (variants.length === 0) return '……嗯。';
  const idx = rotationIdx[key] ?? Math.floor(Math.random() * variants.length);
  rotationIdx[key] = (idx + 1) % variants.length;
  return variants[idx];
}

/** 生成降级回复（角色口吻，本地模板拼接） */
export function getDegradedReply(opts: {
  character?: Character | null;
  kind: FallbackKind;
  emotion?: EmotionType;
  /** 触发降级时的用户输入（error 型回显用） */
  userInput?: string;
}): string {
  const { character, kind, emotion, userInput } = opts;
  const name = character?.name || '';
  // 用角色口头禅做点缀（最多 1 条）
  const catchphrase = (character?.catchphrases || [])[0] || '';

  if (kind === 'empty') {
    if (!character) {
      return pickRotating('empty:generic', [
        '（对方轻轻应了一声。）',
        '（一阵短暂的沉默后，对方回过神来。）',
        '（对方眨了眨眼，像是在整理思绪。）',
      ]);
    }
    const variants = [
      `（${name}轻轻应了一声，眼睛亮晶晶地看着你。）`,
      `（${name}歪了歪头，认真地看着你。）${catchphrase}`,
      `（${name}眨了眨眼，凑近了一些。）嗯？`,
      `（${name}抿了抿嘴，似乎在斟酌怎么回答。）`,
    ];
    return pickRotating(`empty:${name}`, variants);
  }

  // kind === 'error'
  const echo = userInput && userInput.length > 6 ? userInput.slice(0, 6) + '…' : (userInput || '');
  if (!character) {
    return pickRotating('error:generic', [
      '（信号不太好，请稍后再试。）',
      '（对方暂时没有回应，稍等一下。）',
    ]);
  }
  const variants = [
    `（${name}顿了顿，认真听着。）嗯……你刚才说${echo}，我在听呢。`,
    `（${name}眨眨眼，凑近了一点。）再说一遍好不好？刚刚没太听清。${catchphrase}`,
    `（${name}歪头看你。）嗯，${echo}……然后呢？`,
    `（${name}抿了抿嘴，慢慢点头。）嗯，我知道了。`,
  ];
  const key = emotion ? `error:${name}:${emotion}` : `error:${name}`;
  return pickRotating(key, variants);
}
