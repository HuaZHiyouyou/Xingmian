/**
 * ============================================================
 * 错字模拟器 V2
 * 参考: docs/upgrade-plans/03-output-enhancement.md
 * 模拟真人打字的非恶意错误：同音替换、偏旁误触、拼音输入法特有错误
 * ============================================================
 */

// ---------- 配置 ----------

export interface TypoSimConfig {
  enabled: boolean;
  /** 整体错字概率 0~1，推荐 0.03~0.08 */
  probability: number;
  /** 修正提示模式: 'none' | 'asterisk' | 'strikethrough' */
  correctionMode: 'none' | 'asterisk' | 'strikethrough';
  /** 最小文本长度才触发 */
  minLength: number;
}

export const DEFAULT_TYPO_CONFIG: TypoSimConfig = {
  enabled: true,
  probability: 0.05,
  correctionMode: 'none',
  minLength: 6,
};

// ---------- 同音/近音字映射 ----------

const HOMOPHONE_MAP: Record<string, string[]> = {
  '的': ['德', '得'],
  '了': ['乐', '勒'],
  '是': ['事', '市'],
  '我': ['窝', '卧'],
  '不': ['步', '布'],
  '在': ['再', '载'],
  '有': ['又', '友'],
  '他': ['她', '它'],
  '你': ['拟', '泥'],
  '就': ['旧', '救'],
  '都': ['嘟', '督'],
  '和': ['河', '合'],
  '要': ['药', '腰'],
  '会': ['回', '慧'],
  '可': ['渴', '克'],
  '很': ['狠', '痕'],
  '想': ['响', '享'],
  '做': ['坐', '作'],
  '能': ['嫩'],
  '说': ['硕', '朔'],
  '去': ['取', '趣'],
  '过': ['果', '郭'],
  '里': ['理', '礼'],
  '来': ['莱', '赖'],
  '没': ['美', '梅'],
  '看': ['坎', '刊'],
  '知': ['之', '支'],
  '道': ['到', '稻'],
  '时': ['十', '石'],
  '把': ['爸', '巴'],
  '让': ['嚷', '瓤'],
  '用': ['永', '泳'],
  '对': ['队', '兑'],
  '给': ['个', '哥'],
  '真': ['针', '珍'],
  '这': ['者', '折'],
  '那': ['拿', '哪'],
  '跟': ['根', '更'],
  '哦': ['喔', '偶'],
  '嗯': ['恩', '摁'],
  '吧': ['八', '巴'],
  '吗': ['马', '麻'],
  '呢': ['讷', '呐'],
  '啦': ['拉', '辣'],
  '呀': ['鸭', '压'],
  '哈': ['蛤', '铪'],
  '哇': ['蛙', '挖'],
  '哎': ['爱', '艾'],
  '诶': ['额', '蛾'],
  '呗': ['被', '备'],
  '嘛': ['马', '麻'],
  '咯': ['各', '阁'],
  '呵': ['喝', '河'],
  '哼': ['横', '恒'],
  '啧': ['则', '泽'],
  '啥': ['沙', '纱'],
};

// ---------- 拼音输入法特有错误（连打时的错误候选） ----------

interface PinyinError {
  /** 正确文字 */
  correct: string;
  /** 错误候选词 */
  errors: string[];
}

const PINYIN_ERRORS: PinyinError[] = [
  { correct: '知道', errors: ['直到', '指导', '之道'] },
  { correct: '因为', errors: ['应为', '阴为', '应为'] },
  { correct: '可以', errors: ['刻意', '可疑', '可依'] },
  { correct: '什么', errors: ['神马', '审吗'] },
  { correct: '没有', errors: ['煤油', '没油'] },
  { correct: '怎么', errors: ['这么', '则么'] },
  { correct: '已经', errors: ['一经', '意境'] },
  { correct: '所有', errors: ['所以', '缩有'] },
  { correct: '应该', errors: ['硬该', '因该'] },
  { correct: '正在', errors: ['载在', '在正'] },
  { correct: '可能', errors: ['可鞥', '可能'] },
];

// ---------- 手误（键盘相邻键位） ----------

const KEYBOARD_ADJACENT: Record<string, string> = {
  'q': 'w', 'w': 'e', 'e': 'r', 'r': 't', 't': 'y', 'y': 'u', 'u': 'i', 'i': 'o', 'o': 'p',
  'a': 's', 's': 'd', 'd': 'f', 'f': 'g', 'g': 'h', 'h': 'j', 'j': 'k', 'k': 'l',
  'z': 'x', 'x': 'c', 'c': 'v', 'v': 'b', 'b': 'n', 'n': 'm',
};

// ---------- 实现 ----------

export interface TypoResult {
  /** 修改后的文本 */
  text: string;
  /** 修改点列表 */
  corrections: Array<{
    /** 错误字符所在位置 */
    index: number;
    /** 错误的字符 */
    wrong: string;
    /** 正确的字符 */
    correct: string;
    /** 错误类型 */
    type: 'homophone' | 'pinyin' | 'keyboard' | 'missing_stroke';
  }>;
}

/**
 * applyTypos - 在文本中模拟真人的非恶意错字
 * 
 * 三种错误类型混合：
 * 1. 同音/近音替换（60%）
 * 2. 拼音输入法连打错误（30%）
 * 3. 键盘手误（10%）
 */
export function applyTypos(text: string, config: TypoSimConfig = DEFAULT_TYPO_CONFIG): TypoResult {
  const corrections: TypoResult['corrections'] = [];
  
  if (!config.enabled || text.length < config.minLength) {
    return { text, corrections: [] };
  }

  const chars = [...text];
  const result = [...chars];

  // 遍历每个字符，根据概率决定是否修改
  for (let i = 0; i < chars.length; i++) {
    if (Math.random() > config.probability) continue;

    const char = chars[i];
    
    // 跳过标点、数字、英文
    if (/[\p{P}\p{N}a-zA-Z0-9]/u.test(char)) continue;

    const rand = Math.random();
    
    if (rand < 0.6) {
      // 60%: 同音替换
      const homophones = HOMOPHONE_MAP[char];
      if (homophones && homophones.length > 0) {
        const replacement = homophones[Math.floor(Math.random() * homophones.length)];
        result[i] = replacement;
        corrections.push({ index: i, wrong: replacement, correct: char, type: 'homophone' });
      }
    } else if (rand < 0.9) {
      // 30%: 拼音连打错误（检查是否在某个pinyin错误词中）
      const remaining = chars.slice(i).join('');
      for (const pe of PINYIN_ERRORS) {
        if (remaining.startsWith(pe.correct)) {
          const error = pe.errors[Math.floor(Math.random() * pe.errors.length)];
          for (let j = 0; j < error.length && i + j < result.length; j++) {
            if (error[j] !== chars[i + j]) {
              result[i + j] = error[j];
              corrections.push({ index: i + j, wrong: error[j], correct: chars[i + j], type: 'pinyin' });
            }
          }
          i += pe.correct.length - 1;
          break;
        }
      }
    } else {
      // 10%: 键盘手误
      const lowerChar = char.toLowerCase();
      const adjacent = KEYBOARD_ADJACENT[lowerChar];
      if (adjacent) {
        const replacementChar = char === lowerChar ? adjacent : adjacent.toUpperCase();
        result[i] = replacementChar;
        corrections.push({ index: i, wrong: replacementChar, correct: char, type: 'keyboard' });
      }
    }
  }

  // 限制最多 2 个错误，避免太假
  if (corrections.length > 2) {
    const toKeep = corrections.slice(0, 2);
    // Revert excess corrections
    for (let k = 2; k < corrections.length; k++) {
      result[corrections[k].index] = corrections[k].correct;
    }
    return { text: result.join(''), corrections: toKeep };
  }

  return { text: result.join(''), corrections };
}

/**
 * formatTypoCorrection - 将错字修正信息追加到消息末尾
 */
export function formatTypoCorrection(
  text: string,
  corrections: TypoResult['corrections'],
  mode: 'none' | 'asterisk' | 'strikethrough'
): string {
  if (mode === 'none' || corrections.length === 0) return text;

  if (mode === 'asterisk') {
    const parts = corrections.map(c => `*${c.wrong}→${c.correct}`);
    return `${text}（${parts.join(', ')}）`;
  }

  // strikethrough not supported in plain text, use asterisk
  const parts = corrections.map(c => `~~${c.wrong}~~${c.correct}`);
  return `${text}（${parts.join(', ')}）`;
}
