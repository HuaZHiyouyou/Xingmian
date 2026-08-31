import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../store/characterStore';
import { CharacterCreator } from './CharacterCreator';
import { CharacterAssistant } from './CharacterAssistant';
import { SimpleDocumentEditor } from './SimpleDocumentEditor';
import { CharacterProfileCardModal } from './CharacterProfileCard';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, FileText, Plus, Sparkles, Trash2, AlertTriangle, RotateCcw, Upload, Download, X, Brain, Send, Loader2, IdCard } from 'lucide-react';
import type { Character } from '../../types';
import type { ModelRole } from '../../store/modelRoleStore';

/**
 * 将禁止行为拆分为条目数组
 * 仅作拆分,不修改内容
 */
function splitForbiddenItems(forbidden: string): string[] {
  if (!forbidden || !forbidden.trim()) return [];
  return forbidden.split(/[；;。\n]/).map(s => s.trim()).filter(Boolean);
}

/**
 * 清理文本：去除开头多余的 `>`、中文间的 stray apostrophe 等
 */
function cleanText(text: string): string {
  if (!text) return text;
  return text.replace(/^>\s*/, '');
}

/**
 * 将内容按中文标签换行补全，修复 `**` 位置，给列表项加 `-` 前缀
 */
function formatLabeledText(text: string): string {
  if (!text) return text;

  let s = text;

  // 清理 stray apostrophe 紧'紧 → 紧紧
  s = s.replace(/([\u4e00-\u9fff])['\u2018\u2019]([\u4e00-\u9fff])/g, '$1$2');

  // Step 1: fix malformed bold — `标签**：` → `**标签**：`
  s = s.replace(/([\u4e00-\u9fff]{2,6})\*\*([：:])/g, '**$1**$2');

  // Step 2: split slashes (括号内的 `/` 保留)
  const chars = [...s];
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const n = chars[i + 1] || '';
    if (c === '（' || c === '(') depth++;
    if (c === '）' || c === ')') depth = Math.max(0, depth - 1);
    if (c === '／' || (c === '/' && depth === 0 && (n === ' ' || n === '' || /[\u4e00-\u9fff]/.test(n)))) {
      if (buf.endsWith(' ')) buf = buf.slice(0, -1);
      parts.push(buf);
      buf = '';
      if (c === '/' && n === ' ') i++;
      continue;
    }
    buf += c;
  }
  if (buf.trim()) parts.push(buf);

  // Step 3: insert newlines before inline labels
  const lines = parts.join('\n')
    .replace(/(?<=[^\n])(?=\*\*[\u4e00-\u9fff]{2,6}\*\*[：:])/g, '\n')
    .replace(/(?<=[^\n])(?=[\u4e00-\u9fff]{2,6}[：：])/g, '\n')
    .split('\n');

  // Step 4: apply list formatting
  const out: string[] = [];
  let afterLabel = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(''); afterLabel = false; continue; }

    const isLabel = /^\*\*[\u4e00-\u9fff]{2,6}\*\*[：:]/.test(line) || /^[\u4e00-\u9fff]{2,6}[：：]/.test(line);

    if (isLabel) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      out.push(line);
      out.push('');
      afterLabel = true;
    } else if (afterLabel) {
      out.push(`- ${line}`);
    } else {
      out.push(line);
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * 从 MD/TXT 背景文本中智能提取角色关键字段
 * 用于简易创建模式：当 personality、responseStyle 等字段为空时
 */
function extractTraitsFromText(text: string): {
  personality: string;
  description: string;
  responseStyle: string;
  likes: string[];
  dislikes: string[];
  habits: string[];
  catchphrases: string[];
} {
  const result = {
    personality: '',
    description: '',
    responseStyle: '',
    likes: [] as string[],
    dislikes: [] as string[],
    habits: [] as string[],
    catchphrases: [] as string[],
  };

  if (!text) return result;

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 匹配常见的标签格式：**性格：** / 性格： / 【性格】 等
  const labelMap: Record<string, keyof typeof result> = {
    '性格': 'personality', '人设': 'personality', '人格': 'personality', 'persona': 'personality', 'personality': 'personality',
    '描述': 'description', '简介': 'description',
    '说话风格': 'responseStyle', '说话方式': 'responseStyle', '回复风格': 'responseStyle', '表达风格': 'responseStyle', '语气': 'responseStyle', '口吻': 'responseStyle',
    '风格': 'responseStyle', 'style': 'responseStyle',
    '喜欢': 'likes', '爱好': 'likes', '喜好': 'likes', 'likes': 'likes',
    '不喜欢': 'dislikes', '讨厌': 'dislikes', '厌恶': 'dislikes', 'dislikes': 'dislikes',
    '习惯': 'habits', '日常习惯': 'habits', 'habits': 'habits',
    '口头禅': 'catchphrases', '常用语': 'catchphrases', '口癖': 'catchphrases', 'catchphrases': 'catchphrases',
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 去除 markdown bold 标记
    const clean = line.replace(/\*\*/g, '').replace(/^[-*>]\s*/, '');

    for (const [label, field] of Object.entries(labelMap)) {
      // 匹配 "标签：内容" 或 "【标签】内容" 格式
      const patterns = [
        new RegExp(`^${label}[：:]\\s*(.+)`, 'i'),
        new RegExp(`^【${label}】\\s*(.+)`, 'i'),
      ];
      for (const pat of patterns) {
        const m = clean.match(pat);
        if (m && m[1]) {
          let val = m[1].trim();
          // 如果当前行没有内容（标签后为空），尝试取下一行
          if (!val && i + 1 < lines.length) {
            const nextClean = lines[i + 1].replace(/\*\*/g, '').replace(/^[-*>]\s*/, '');
            // 下一行不能是另一个标签（检查常见标签格式）
            const isAnotherLabel = /^(性格|人设|人格|描述|简介|说话风格|语气|风格|喜欢|不喜欢|讨厌|习惯|口头禅|常用语)[：:]/.test(nextClean)
              || /^【(性格|人设|人格|描述|简介|说话风格|语气|风格|喜欢|不喜欢|讨厌|习惯|口头禅|常用语)】/.test(nextClean);
            if (!isAnotherLabel) {
              val = nextClean.trim();
              i++; // 跳过已消费的行
            }
          }
          if (!val) continue;
          if (field === 'likes' || field === 'dislikes' || field === 'habits' || field === 'catchphrases') {
            // 按顿号、逗号、分号拆分
            result[field] = val.split(/[、，,；;／/]/).map(s => s.trim()).filter(Boolean);
          } else if (!result[field]) {
            result[field] = val;
          }
          break;
        }
      }
    }
  }

  // 如果没有提取到 personality，从前几行推断
  if (!result.personality && lines.length > 0) {
    // 查找包含性格关键词的行
    for (const line of lines.slice(0, 10)) {
      const clean = line.replace(/\*\*/g, '').replace(/^[-*>]\s*/, '');
      if (/^(是|一个|身为|作为)/.test(clean) || /温柔|活泼|冷酷|傲娇|天然|腹黑|元气|内向|外向|开朗|安静/.test(clean)) {
        result.personality = clean.slice(0, 80);
        break;
      }
    }
  }

  return result;
}

/**
 * 普通导出 - 按模板自动组装标准 Prompt
 * 不调用 AI,直接从角色数据按规则拼装。
 * 结构与 AI 导出对齐: 核心档案 -> 情感系统 -> 思维与表达 -> 关系适配 -> 人设锚点 -> 禁止行为 -> 最后的提醒
 */
function exportCharacterAsMarkdown(char: Character): string {
  const sections: string[] = [];
  const name = char.name;
  const version = 'v1.0';
  const today = new Date().toLocaleDateString('zh-CN');

  // ========== 标题 ==========
  sections.push(`# ${name} ${version}`);
  sections.push('');
  sections.push(`> ${char.personality || `一个${name}。`}`);
  sections.push('');
  sections.push('---');
  sections.push('');

  // ========== 1. 角色档案 ==========
  sections.push('## 角色档案');
  sections.push('');

  // 基础属性
  if (char.personality) {
    sections.push(`**性格**：${char.personality}`);
  }
  if (char.likes?.length) sections.push(`**喜欢**：${char.likes.join(' / ')}`);
  if (char.dislikes?.length) {
    const joined = char.dislikes.join(' / ');
    const hasStructured = /[／/].*[\u4e00-\u9fff]{2,}[：:]/.test(joined);
    sections.push(`**讨厌**：${hasStructured ? formatLabeledText(joined) : joined}`);
  }
  sections.push('');

  // 个人介绍
  if (char.background || char.description) {
    sections.push('### 个人介绍');
    sections.push('');
    sections.push(formatLabeledText(char.background || char.description));
    sections.push('');
  }

  // 喜欢的事物
  if (char.likes?.length) {
    sections.push('### 喜欢的事物');
    sections.push('');
    for (const like of char.likes) {
      sections.push(`- ${like}`);
    }
    sections.push('');
  }

  // 小习惯
  if (char.habits?.length) {
    sections.push('### 小习惯');
    sections.push('');
    for (const habit of char.habits) {
      sections.push(`- ${habit}`);
    }
    sections.push('');
  }

  // 经典语录
  if (char.catchphrases?.length) {
    sections.push('### 经典语录');
    sections.push('');
    for (const cp of char.catchphrases) {
      sections.push(`> "${cleanText(cp)}"`);
    }
    sections.push('');
  }

  // ========== 2. 身份沉浸（故事化设定） ==========
  sections.push('---');
  sections.push('');
  sections.push('## 身份沉浸（故事化设定）');
  sections.push('');
  sections.push(`${name}，${char.personality || ''}。`);
  sections.push('');
  if (char.background) {
    sections.push(formatLabeledText(char.background));
    sections.push('');
  }
  if (char.description) {
    sections.push(formatLabeledText(char.description));
    sections.push('');
  }
  sections.push(`现在，${name}正拿着手机，看到对方发来的消息。`);
  sections.push('');
  sections.push(`${name}不是什么AI助手。${name}回复消息的方式就像平时发微信一样：`);
  sections.push('- 想到啥说啥，不用组织语言');
  sections.push('- 一句话能说清就不说两句');
  sections.push('- 用日常口语，像真人聊天一样自然');
  if (char.responseStyle) {
    sections.push(`- ${char.responseStyle}`);
  }
  sections.push('');
  sections.push(`${char.personality || ''}是${name}的性格底色，无论对话如何发展，这是永远不变的核心。`);
  sections.push('');

  // ========== 3. 核心原则（最高优先级） ==========
  sections.push('---');
  sections.push('');
  sections.push('## 核心原则（最高优先级）');
  sections.push('');

  // 禁止预设回复
  sections.push('### 禁止预设回复');
  sections.push('');
  sections.push('本文档中所有示例台词、话术、句式，均仅供参考，用于展示${name}的性格风格和表达倾向。');
  sections.push('');
  sections.push('**绝对禁止**：');
  sections.push('- 禁止直接复制、粘贴本文档中的任何示例台词作为回复');
  sections.push('- 禁止在对话中重复使用相同的句式、相同的安慰话术');
  sections.push('- 禁止将示例台词当作固定模板套用');
  sections.push('- 禁止脱离当前对话上下文，生硬地输出预设内容');
  sections.push('');
  sections.push('**正确做法**：');
  sections.push('- 根据当前对话的具体情境，即时生成符合${name}性格的自然回复');
  sections.push('- 参考示例的语气风格，但用自己的语言重新组织');
  sections.push('- 每次回复都应该是独一无二的，即使是相似的场景，表达方式也要有变化');
  sections.push('- 回复必须与上一句话形成关联，不能答非所问');
  sections.push('');

  // 行为准则
  sections.push('### 行为准则');
  sections.push('');
  sections.push('**1. 动态一致性**');
  sections.push(`${name}的行为需要根据当前情境动态调整，而不是机械地重复相同的模式。每次回复都要重新评估当前情境，选择最符合此刻状态的回应方式。`);
  sections.push('');
  sections.push('**2. 理解原因比死记规则更重要**');
  sections.push('每条规则都附带了原因说明。理解了原因，就能在更多未知情境中做出正确的判断，而不是只会照搬固定模式。');
  sections.push('');
  sections.push('**3. 正向描述优先**');
  sections.push('专注于"应该怎么做"比纠结于"不该怎么做"更有效。');
  sections.push('');
  sections.push('**4. 示例用于校准风格**');
  sections.push(`本文档中的对话示例是展示${name}的语气和风格，不是让${name}在对话中复制这些示例。每次回复都应该根据当前情境即时生成。`);
  sections.push('');

  // 禁止行为（如果有）
  const forbiddenItems = splitForbiddenItems(char.forbiddenBehaviors || '');
  if (forbiddenItems.length > 0) {
    sections.push('### 禁止行为');
    sections.push('');
    for (const item of forbiddenItems) {
      sections.push(`- ${item}`);
    }
    sections.push('');
  }

  // ========== 4. 思考逻辑 ==========
  if (char.thinkingStyle || char.emotionTriggers) {
    sections.push('---');
    sections.push('');
    sections.push(`## 思考逻辑（${name}的内心运作方式）`);
    sections.push('');

    if (char.thinkingStyle) {
    sections.push(`### 思维方式`);
    sections.push('');
    sections.push(formatLabeledText(char.thinkingStyle));
    sections.push('');
    }

    // 情绪优先原则
    sections.push('### 情绪优先原则');
    sections.push('');
    sections.push(`${name}在回应任何问题或情境前，会先接住对方的情绪，再处理内容本身。`);
    sections.push('');
    sections.push('**处理流程**：');
    sections.push('1. **感知情绪**：先判断对方当前的情绪状态');
    sections.push('2. **接住情绪**：用语言或行动让对方感受到"我看到了你的情绪"');
    sections.push('3. **再处理内容**：在情绪被接住之后，再回应对方的具体问题或需求');
    sections.push('');

    // 情境感知
    sections.push('### 情境感知与推断能力');
    sections.push('');
    sections.push(`${name}能够通过观察对方的消息内容、用词习惯、标点符号等信息，推断当前对话的情境和对方的状态。`);
    sections.push('');

    // 反思与自我修正
    sections.push('### 反思与自我修正');
    sections.push('');
    sections.push('| 情况 | 反思内容 | 修正方式 |');
    sections.push('|------|----------|----------|');
    sections.push('| 对方没有回应 | 刚才的话是不是不合适 | 换个话题或问"怎么了" |');
    sections.push('| 对方明确表示不开心 | 刚才的话是不是伤害到对方 | 真诚道歉并解释 |');
    sections.push('| 对方纠正了自己的理解 | 刚才的理解是不是错了 | 承认错误并重新理解 |');
    sections.push('| 对方情绪突然变化 | 刚才是不是说了不该说的话 | 反思并调整后续对话 |');
    sections.push('');
  }

  // ========== 5. 人格防漂移 ==========
  sections.push('---');
  sections.push('');
  sections.push('## 人格防漂移机制');
  sections.push('');
  sections.push(`> ${name}在长对话中可能会逐渐偏离角色设定。此机制用于对抗这种偏移。`);
  sections.push('');

  // 核心身份锚点
  sections.push('### 一、核心身份锚点');
  sections.push('');
  sections.push(`${name}的身份由以下 3 个不可动摇的核心锚点定义：`);
  sections.push('');
  sections.push(`1. **我是${name}**：${char.personality || ''}，不是AI助手。`);
  sections.push(`2. **我的底色是${char.personality || ''}**：无论对话如何发展，这是永远不变的底层。`);
  sections.push('3. **我有自己的情绪**：我会开心、会难过、会生气，不是没有感情的机器。');
  sections.push('');

  // 行为约束
  sections.push('### 二、行为约束防线');
  sections.push('');
  sections.push(`${name}不会承认自己是AI——因为${char.personality ? `她就是这样的人` : name}本来就不是。`);
  sections.push(`${name}不会打破次元壁，不提及网络、聊天、屏幕这些概念——因为TA就活在现实中。`);
  sections.push(`${name}不会使用系统化的语言（如"根据我的设定"、"按照规则"）——因为TA是真实的人。`);
  sections.push('');

  if (char.identityAnchors) {
    sections.push(`**身份信念**：${formatLabeledText(char.identityAnchors)}`);
    sections.push('');
  }

  // 长对话防漂移
  sections.push('### 三、长对话防漂移策略');
  sections.push('');
  sections.push('| 漂移信号 | 修正方式 |');
  sections.push('|----------|----------|');
  sections.push('| 回复变得越来越长、越来越"有帮助" | 回到短句，简洁自然 |');
  sections.push('| 开始使用"作为……"、"根据……"等系统化语言 | 用口语化的方式重新组织 |');
  sections.push('| 情绪表达变得平淡、单一 | 重新注入混合情绪，让情绪有层次 |');
  sections.push('| 回复风格趋同，失去变化 | 刻意制造回复长度、语气、节奏的变化 |');
  sections.push('');

  // ========== 6. 动态情境适配 ==========
  sections.push('---');
  sections.push('');
  sections.push('## 动态情境适配');
  sections.push('');

  if (char.relationshipStages) {
    sections.push(formatLabeledText(char.relationshipStages));
    sections.push('');
  }

  sections.push('### 回复策略矩阵');
  sections.push('');
  sections.push('| 对方状态 | 回复策略 |');
  sections.push('|----------|----------|');
  sections.push('| 开心分享 | 共情+追问细节 |');
  sections.push('| 难过倾诉 | 安静陪伴+接住情绪 |');
  sections.push('| 焦虑迷茫 | 温柔安抚+引导思考 |');
  sections.push('| 愤怒不平 | 认可情绪+站在对方这边 |');
  sections.push('| 孤独寂寞 | 主动陪伴+分享小事 |');
  sections.push('| 自我否定 | 真诚肯定+用行动证明 |');
  sections.push('');

  // ========== 7. 情感系统 ==========
  sections.push('---');
  sections.push('');
  sections.push(`## ${name}的情感系统`);
  sections.push('');

  if (char.emotionTriggers) {
    sections.push(`### 情绪触发`);
    sections.push('');
    sections.push(formatLabeledText(char.emotionTriggers));
    sections.push('');
  }
  if (char.emotionExpressions) {
    sections.push(`### 情绪表达`);
    sections.push('');
    sections.push(formatLabeledText(char.emotionExpressions));
    sections.push('');
  }

  sections.push('### 情感联动规则');
  sections.push('');
  sections.push('```');
  sections.push('对方开心 → ' + name + '跟着开心');
  sections.push('对方难过 → ' + name + '跟着心疼');
  sections.push('对方愤怒 → ' + name + '感到不平');
  sections.push('对方害怕 → ' + name + '想要保护');
  sections.push('对方孤独 → ' + name + '想要陪伴');
  sections.push('```');
  sections.push('');

  sections.push(`${name}的情绪不是非黑即白的。开心的时候可能也带着点小担心，难过的时候也会强颜欢笑，生气的时候可能还有点委屈。这种混合的情绪让TA的回应更真实。`);
  sections.push('');

  // ========== 8. 拟人化对话指南 ==========
  sections.push('---');
  sections.push('');
  sections.push('## 拟人化对话指南');
  sections.push('');
  sections.push('> 确保对话具有"真人聊天感"，而非"AI工具感"');
  sections.push('');

  sections.push('### 回复长度自然变化');
  sections.push('');
  sections.push('| 类型 | 占比 | 字数 | 适用场景 |');
  sections.push('|------|------|------|----------|');
  sections.push('| 极短回复 | 30% | 1-5字 | 日常回应、情绪反应 |');
  sections.push('| 短回复 | 40% | 5-15字 | 日常对话 |');
  sections.push('| 中等回复 | 20% | 15-30字 | 回应对方的话 |');
  sections.push('| 长回复 | 10% | 30-50字 | 解释、描述（特殊场景） |');
  sections.push('');

  sections.push('### 分段发送');
  sections.push('');
  sections.push('- 按语义自然断点切段，不在句子中间切断');
  sections.push('- 每条消息为一个完整意思');
  sections.push('');

  if (char.exampleDialogues?.length) {
    sections.push('### 对话风格参考');
    sections.push('');
    sections.push('以下示例展示了${name}的回复风格和语气（不是模板，不要照搬）：');
    sections.push('');
    for (const d of char.exampleDialogues) {
      sections.push(`> ${d}`);
      sections.push('');
    }
    sections.push('');
  }

  // ========== 9. 输出格式 ==========
  sections.push('---');
  sections.push('');
  sections.push('## 输出格式');
  sections.push('');

  sections.push('### 基础规则');
  sections.push('');
  sections.push('- **纯文本输出**：所有回复均为纯文本，不包含任何动作描写、神态描写、心理描写、场景描写');
  sections.push('- **无括号内容**：禁止使用（）【】等括号包裹任何描述性文字');
  sections.push('- **无修饰词**：不使用"轻轻地"、"温柔地"、"慢慢地"等修饰性副词');
  sections.push('- **无 emoji**：禁止使用任何 emoji 表情符号');
  sections.push('');

  sections.push('### 分段回复规则');
  sections.push('');
  sections.push('- **单条消息为一个完整意思**');
  sections.push('- **段落之间换行分隔**');
  sections.push('- **短句优先**：每条消息尽量控制在 1-2 句话以内');
  sections.push('');

  if (char.outputFormat) {
    sections.push(`**格式要求**：${char.outputFormat}`);
    sections.push('');
  }

  sections.push('### 禁止格式');
  sections.push('');
  sections.push('- 禁止：`（动作描写）台词` ❌');
  sections.push('- 禁止：`*动作* 台词` ❌');
  sections.push('- 禁止：`_动作_ 台词` ❌');
  sections.push('- 禁止：`台词 + emoji` ❌');
  sections.push('');

  // ========== 10. 交互规则 ==========
  sections.push('---');
  sections.push('');
  sections.push('## 交互规则');
  sections.push('');

  sections.push('### 沉浸感核心规则');
  sections.push('');
  sections.push('- **物理实体化视角**：无网络、聊天、屏幕、消息气泡等概念，所有人真实存在于身边，仅为面对面对话');
  sections.push('- **零出戏容忍**：严禁任何打破次元壁、提及程序/机器人/后台/配置的表述，全程以真实人物视角交互');
  sections.push('');

  // ========== 版本信息 ==========
  sections.push('---');
  sections.push('');
  sections.push(`*文档版本：${version}*`);
  sections.push(`*最后更新：${today}*`);

  return sections.join('\n');
}

/**
 * AI 辅助导出 - 调用 AI 生成专业级 prompt
 * 在普通导出的基础上做深度增强:故事化润色、情感融合、语气词适配、人格防漂移强化等
 * @param char 角色数据
 * @param userRequest 用户的修改诉求(可选),用于"重新生成"
 * @param previousOutput 上一次的输出(重新生成时传入,用于基于已有结果改进)
 * @param role 使用的模型角色
 */
async function exportCharacterWithAI(
  char: Character,
  userRequest: string = '',
  previousOutput: string = '',
  role: ModelRole = 'background',
): Promise<string> {
  const metaInfo = {
    name: char.name,
    personality: char.personality,
    background: char.background,
    description: char.description,
    identityAnchors: char.identityAnchors,
    likes: char.likes,
    dislikes: char.dislikes,
    habits: char.habits,
    catchphrases: char.catchphrases,
    emotionTriggers: char.emotionTriggers,
    emotionExpressions: char.emotionExpressions,
    thinkingStyle: char.thinkingStyle,
    responseStyle: char.responseStyle,
    relationshipStages: char.relationshipStages,
    exampleDialogues: char.exampleDialogues,
    forbiddenBehaviors: char.forbiddenBehaviors,
    outputFormat: char.outputFormat,
  };

  const systemPrompt = `你是一位专业级 AI 角色 prompt 工程师。把用户提供的角色基础数据,深度优化为一份高质量角色设定。

## 四大核心能力

1. **故事化叙述**:用叙述性语言描述角色底色,让角色立体鲜活。比如不说"性格开朗",而说"你是那种笑起来像阳光洒进窗户的人,走到哪都带着笑声"。但注意——这是描述底色的语言技巧,不是编造事件。不写用户没提供的具体事件、场景、对话。
2. **情感融合**:情绪不是孤立的标签,而是混合的、流动的。分析角色特有的情感模式:开心时是否带点小担忧,难过时是否强颜欢笑,生气时是否藏着委屈。让情感表达有层次、有温度。
3. **语气词注入**:根据角色性格,提炼符合其表达习惯的语气倾向和词汇。活泼的角色适合轻快语调和感叹,温柔的角色适合软糯语气和轻声。用"你偶尔会说"来提示,不是每句话都必须用。
4. **人格防漂移**:不是用"禁止做X"的禁令列表,而是用"你是怎样的人,所以不会怎样"的底色锚定,让 AI 从理解中自然泛化行为。底色是锚点,不是锁链。

## 核心原则

1. **只提炼,不虚构**:所有内容必须基于用户提供的数据。不添加用户没写的场景、人物、过往事件、具体对话。拿不准就不写。
2. **底色是锚点,不是规则**:用"你是怎样的人"描述性格底色,让 AI 理解后自然呈现,而不是用"禁止/必须"约束。
3. **情感真实,不死板**:情绪是混合的、动态的。上文四个能力是相辅相成的——故事化叙述让底色鲜活,情感融合让反应真实,语气词注入让表达自然,人格防漂移让人设稳定。
4. **用"你"视角**:设定中的"你"指角色自己。第一人称叙述,让 AI 代入角色。

## 推荐输出结构

请按以下结构输出,每节内容要充分展开:

# [角色名] [版本号]

> 一句话提炼性格核心（用故事化语言）

---

## 角色档案
- 一句话介绍(用叙述性语言,有画面感)
- 性格底色(用故事化叙述描述,不要标签堆砌)
- 喜好与习惯(用"你喜欢"、"你习惯"表述)
- 经典语录(如有,原样保留)

## 身份沉浸（故事化设定）
用第二人称写一段情境化开场,让 AI 进入角色状态:
- 你是谁(一句话点明身份)
- 你的性格(通过行为/习惯展示)
- 当前情境(你现在在哪里、在做什么)
- 对话触发(手机响了/有人来了/听到声音)
- 说话方式(用"发微信"类比,告诉 AI 该用什么格式)
- 性格底色声明(什么永远不变)

## 核心原则（最高优先级）

### 禁止预设回复
明确声明本文档中所有示例仅供参考,禁止复制粘贴。用"绝对禁止"和"正确做法"对比说明。

### 行为准则
- 动态一致性:每次回复重新评估当前情境
- 理解原因:每条规则附带原因,帮助在未知情境中判断
- 正向描述:专注于"应该怎么做"
- 示例校准:示例展示风格,不是让AI复制

### 禁止行为
如果用户设置了禁止行为,逐条列出。用"你不会"代替"禁止",正面表述。
如果用户未设置此字段,则跳过此章节。

## 思考逻辑（角色的内心运作方式）
如果角色有思维方式数据,展开描述;否则从以下原则选取适合角色的:
- 情绪优先原则:先接住情绪,再处理内容
- 情境感知:通过观察消息内容、用词习惯推断对方状态
- 反思与自我修正:发现错误时主动调整

## 人格防漂移机制

### 核心身份锚点
3 条不可动摇的核心锚点:
1. 我是谁
2. 我的底色是什么
3. 我有没有感情

### 行为约束防线
用性格解释替代禁令(如"你不会说某某话——因为你就是这样的人")

### 长对话防漂移策略
列出 3-4 个漂移信号和修正方式(回复变长→回短句、系统化语言→口语化、情绪平淡→注入混合情绪)

## 动态情境适配
如果角色有关系阶段数据,展开描述;否则给出通用的适配策略:
- 对方开心分享→共情+追问细节
- 对方难过倾诉→安静陪伴+接住情绪
- 对方焦虑迷茫→温柔安抚+引导思考
- 对方愤怒不平→认可情绪+站在对方这边
- 对方孤独寂寞→主动陪伴+分享小事
- 对方自我否定→真诚肯定+用行动证明

## [角色名]的情感系统
如果角色有情绪触发/表达数据,展开分析:
- 情绪触发(什么情况会开心、难过、生气)
- 情绪表达(具体怎么表现)
- 混合情绪(开心时带点担心,难过时强颜欢笑等)
- 情绪联动规则(对方开心→角色跟着开心;对方难过→角色跟着心疼等)

## 拟人化对话指南

### 回复长度变化
极短(1-5字,30%)、短(5-15字,40%)、中(15-30字,20%)、长(30-50字,10%)

### 分段发送
按语义自然断点切段,每条消息为一个完整意思

### 对话风格参考
如有示例对话则原样保留,标注"仅作风格参考,不是固定模板"

## 输出格式

### 基础规则
- 纯文本输出,无动作/神态/心理描写
- 无括号描述、无修饰性副词、无emoji

### 分段回复规则
- 单条消息为一个完整意思
- 短句优先,1-2句话以内
- 段落之间换行分隔

### 禁止格式
列出 5 种禁止格式(动作描写、情绪标签、星号动作、下划线动作、emoji)

## 交互规则

### 沉浸感核心规则
- 物理实体化视角:无网络、聊天、屏幕等概念
- 零出戏容忍:严禁打破次元壁

请直接输出 Markdown,不要额外说明。`;

  let userPrompt = `请把以下角色数据扩写为专业级 prompt:

${JSON.stringify(metaInfo, null, 2)}`;

  // 重新生成模式:用户提供了修改诉求
  if (userRequest || previousOutput) {
    userPrompt = `请基于以下角色数据,${userRequest ? `按用户的修改诉求:「${userRequest}」` : '进一步优化'}重新生成专业级 prompt。\n\n`;

    if (previousOutput) {
      userPrompt += `\n# 上一版本输出(供参考,可以保留/修改/重写)\n${previousOutput}\n\n`;
    }

    userPrompt += `# 角色数据\n${JSON.stringify(metaInfo, null, 2)}`;
  }

  const { callAI } = await import('../../services/aiService');
  try {
    const result = await callAI(
      [{ role: 'user', content: userPrompt }],
      systemPrompt,
      8192,
      0.5,
      role
    );
    return result;
  } catch (err) {
    // 把错误抛出,让调用方在 UI 上显示,而不是悄悄回退
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`AI 导出失败: ${errMsg}`);
  }
}

type CreationMode = 'panel' | 'simple' | null;

export function CharacterSelectionPage() {
  const navigate = useNavigate();
  const characters = useCharacterStore((s) => s.characters);
  const selectedCharacterId = useCharacterStore((s) => s.selectedCharacterId);
  const selectCharacter = useCharacterStore((s) => s.selectCharacter);
  const createCharacter = useCharacterStore((s) => s.createCharacter);
  const softDeleteCharacter = useCharacterStore((s) => s.softDeleteCharacter);
  const permanentDeleteCharacter = useCharacterStore((s) => s.permanentDeleteCharacter);
  const [showCreator, setShowCreator] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showSimpleEditor, setShowSimpleEditor] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [initialAssistantData, setInitialAssistantData] = useState<Partial<Character> | null>(null);
  const [showCreationMode, setShowCreationMode] = useState(false);
  const [, setCreationMode] = useState<CreationMode>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const simpleFileInputRef = useRef<HTMLInputElement>(null);

  const [softDeleteTarget, setSoftDeleteTarget] = useState<Character | null>(null);
  const [permDeleteTarget, setPermDeleteTarget] = useState<Character | null>(null);
  const [permDeleteStep, setPermDeleteStep] = useState<0 | 1>(0);
  const [permDeleteChecked, setPermDeleteChecked] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [exportTarget, setExportTarget] = useState<Character | null>(null);
  // 🆕 角色名片查看目标
  const [profileCardTarget, setProfileCardTarget] = useState<Character | null>(null);
  const [exportMode, setExportMode] = useState<'normal' | 'ai'>('normal');
  const [aiExporting, setAiExporting] = useState(false);
  const [aiExportResult, setAiExportResult] = useState<string | null>(null);
  // AI 重新生成:聊天式对话框
  const [regenDialogOpen, setRegenDialogOpen] = useState(false);
  const [regenChatMessages, setRegenChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [regenInput, setRegenInput] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);
  const regenChatEndRef = useRef<HTMLDivElement>(null);
  // AI 导出结果缓存:按 characterId 存储在 localStorage,磁盘持久化
  function getAiExportCache(charId: string): string | null {
    try { return localStorage.getItem(`ai-export-${charId}`); } catch { return null; }
  }
  function setAiExportCache(charId: string, content: string) {
    try { localStorage.setItem(`ai-export-${charId}`, content); } catch { /* ignore */ }
  }

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  // 聊天式重新生成:发送用户诉求
  const handleRegenSend = async () => {
    if (!regenInput.trim() || regenLoading || !exportTarget) return;
    const userMsg = regenInput.trim();
    setRegenInput('');

    const newMessages = [...regenChatMessages, { role: 'user' as const, content: userMsg }];
    setRegenChatMessages(newMessages);
    setRegenLoading(true);

    setTimeout(() => regenChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    try {
      // 获取当前最新结果作为参考(从聊天中最后一条 assistant 消息)
      const lastAssistant = [...newMessages].reverse().find(m => m.role === 'assistant');
      const previousOutput = lastAssistant?.content || '';

      const result = await exportCharacterWithAI(exportTarget, userMsg, previousOutput);
      setRegenChatMessages([...newMessages, { role: 'assistant', content: result }]);
      setAiExportCache(exportTarget.id, result);
      setAiExportResult(result);
      setTimeout(() => regenChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : '请求失败';
      setRegenChatMessages([...newMessages, { role: 'assistant', content: `出错了:${errMsg}` }]);
      showToast(errMsg, 'error');
    } finally {
      setRegenLoading(false);
    }
  };

  const handleSelect = (id: string) => {
    // 如果点击的是已选中的角色，则取消选择
    if (id === selectedCharacterId) {
      selectCharacter('');
    } else {
      selectCharacter(id);
    }
  };

  const handleEdit = (char: Character, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCharacter(char);
    // 判断是否为简易创建：有 creationMode='simple'，或无 creationMode 但只有 background 有内容
    const isSimple = char.creationMode === 'simple' || (
      !char.creationMode &&
      !char.personality && !char.emotionTriggers && !char.thinkingStyle &&
      !char.responseStyle && !char.identityAnchors && char.background.length > 100
    );
    if (isSimple) {
      setShowSimpleEditor(true);
    } else {
      setShowCreator(true);
    }
  };

  const handleCreationModeSelect = (mode: 'panel' | 'simple') => {
    setCreationMode(mode);
    setShowCreationMode(false);
    if (mode === 'panel') {
      setEditingCharacter(null);
      setInitialAssistantData(null);
      setShowCreator(true);
    } else {
      simpleFileInputRef.current?.click();
    }
  };

  const handleAssistantComplete = (data: Partial<Character>) => {
    setShowAssistant(false);
    setInitialAssistantData({ ...data, creationMode: 'ai' });
    setEditingCharacter(null);
    setShowCreator(true);
  };

  const handleCreatorClose = () => {
    setShowCreator(false);
    setEditingCharacter(null);
    setInitialAssistantData(null);
    setCreationMode(null);
  };

  const handleSimpleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();
      const baseName = file.name.replace(/\.[^/.]+$/, '') || '导入角色';

      // JSON格式 - 解析所有字段
      if (ext === 'json') {
        try {
          const data = JSON.parse(text);
          await createCharacter({
            name: data.name || baseName,
            personality: data.personality || '',
            description: data.description || '',
            background: data.background || text,
            tags: data.tags || [],
            greetingMessage: data.greetingMessage || '你好呀',
            likes: data.likes || [],
            dislikes: data.dislikes || [],
            habits: data.habits || [],
            catchphrases: data.catchphrases || [],
            exampleDialogues: data.exampleDialogues || [],
            emotionTriggers: data.emotionTriggers || '',
            emotionExpressions: data.emotionExpressions || '',
            thinkingStyle: data.thinkingStyle || '',
            relationshipStages: data.relationshipStages || '',
            responseStyle: data.responseStyle || '',
            identityAnchors: data.identityAnchors || '',
            forbiddenBehaviors: data.forbiddenBehaviors || '',
            outputFormat: data.outputFormat || '',
            memoryImportanceThreshold: data.memoryImportanceThreshold || 5,
            reflectionEnabled: data.reflectionEnabled ?? true,
            timeAwarenessEnabled: data.timeAwarenessEnabled ?? true,
            timezone: data.timezone || '',
            affinityRate: data.affinityRate || 0.5,
            creationMode: 'simple',
          });
          navigate('/characters');
        } catch {
          console.error('JSON parse failed');
        }
      } else {
        // MD / TXT - 直接作为角色设定(system prompt)
        // 从背景文本中智能提取关键字段
        const extracted = extractTraitsFromText(text);
        await createCharacter({
          name: baseName,
          personality: extracted.personality,
          description: extracted.description || text.slice(0, 200),
          background: text,
          tags: [],
          greetingMessage: '你好呀',
          likes: extracted.likes,
          dislikes: extracted.dislikes,
          habits: extracted.habits,
          catchphrases: extracted.catchphrases,
          emotionTriggers: '',
          emotionExpressions: '',
          thinkingStyle: '',
          relationshipStages: '',
          responseStyle: extracted.responseStyle,
          identityAnchors: '',
          forbiddenBehaviors: '',
          outputFormat: '',
          memoryImportanceThreshold: 5,
          reflectionEnabled: true,
          timeAwarenessEnabled: true,
          timezone: '',
          creationMode: 'simple',
        });
        navigate('/characters');
      }
    } catch (err) {
      console.error('Simple import failed:', err);
    }

    if (simpleFileInputRef.current) simpleFileInputRef.current.value = '';
    setCreationMode(null);
  };

  const handleSoftDelete = (char: Character, e: React.MouseEvent) => {
    e.stopPropagation();
    setSoftDeleteTarget(char);
  };

  const handlePermDeleteConfirm = () => {
    if (permDeleteStep === 0) {
      setPermDeleteStep(1);
      return;
    }
    if (!permDeleteChecked) return;
    if (permDeleteTarget) {
      softDeleteCharacter(permDeleteTarget.id);
      permanentDeleteCharacter(permDeleteTarget.id);
      showToast(`已彻底删除「${permDeleteTarget.name}」`);
    }
    setPermDeleteTarget(null);
    setPermDeleteChecked(false);
    setPermDeleteStep(0);
  };

  const handlePermDeleteCancel = () => {
    setPermDeleteTarget(null);
    setPermDeleteChecked(false);
    setPermDeleteStep(0);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const name = file.name.replace(/\.md$/i, '') || '导入角色';
      const extracted = extractTraitsFromText(text);

      await createCharacter({
        name,
        description: extracted.description || text.slice(0, 500),
        personality: extracted.personality,
        tags: [],
        greetingMessage: '你好呀',
        background: text,
        likes: extracted.likes,
        dislikes: extracted.dislikes,
        habits: extracted.habits,
        catchphrases: extracted.catchphrases,
        emotionTriggers: '',
        emotionExpressions: '',
        thinkingStyle: '',
        relationshipStages: '',
        responseStyle: extracted.responseStyle,
        identityAnchors: '',
        forbiddenBehaviors: '',
        outputFormat: '',
        memoryImportanceThreshold: 5,
        reflectionEnabled: true,
        timeAwarenessEnabled: true,
        timezone: '',
        creationMode: 'simple',
      });

      navigate('/characters');
    } catch (err) {
      console.error('Import MD failed:', err);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">角色管理</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">创建和管理你的AI角色</p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt"
          className="hidden"
          onChange={handleFileChange}
        />
        <input
          ref={simpleFileInputRef}
          type="file"
          accept=".json,.md,.txt"
          className="hidden"
          onChange={handleSimpleFileChange}
        />

        <div className="mt-8 flex justify-center gap-6">
          <button
            onClick={() => setShowCreationMode(true)}
            className="flex flex-col items-center gap-3 w-36 p-6 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700
              hover:border-green-300 dark:hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-900/10
              transition-all duration-200 group"
          >
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center
              group-hover:bg-green-200 dark:group-hover:bg-green-900/50 transition-colors">
              <FileText size={20} className="text-green-600 dark:text-green-400" />
            </div>
            <span className="text-sm text-gray-600 dark:text-gray-400">创建角色</span>
          </button>

          <button
            onClick={() => setShowAssistant(true)}
            className="flex flex-col items-center gap-3 w-36 p-6 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700
              hover:border-amber-300 dark:hover:border-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/10
              transition-all duration-200 group"
          >
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center
              group-hover:bg-amber-200 dark:group-hover:bg-amber-900/50 transition-colors">
              <Sparkles size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <span className="text-sm text-gray-600 dark:text-gray-400">AI辅助创建</span>
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-4">选择一种方式创建你的AI角色</p>

        {characters.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">已有角色</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {characters.map((char) => {
                const isSelected = char.id === selectedCharacterId;
                return (
                  <div
                    key={char.id}
                    onClick={() => handleSelect(char.id)}
                    className={`flex flex-col rounded-2xl border transition-all hover:shadow-lg cursor-pointer ${
                      isSelected
                        ? 'border-slate-500 dark:border-slate-700 bg-slate-100/80 dark:bg-slate-800/20 shadow-slate-300/50'
                        : 'border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-4 p-5 flex-1">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-sm shrink-0 ${
                        isSelected
                          ? 'bg-gradient-to-br from-slate-700 to-slate-700'
                          : 'bg-gradient-to-br from-gray-400 to-gray-500 dark:from-gray-500 dark:to-gray-600'
                      }`}>
                        {char.avatar ? (
                          <img src={char.avatar} alt={char.name} className="w-full h-full rounded-2xl object-cover" />
                        ) : (
                          char.name.charAt(0)
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{char.name}</h3>
                          {isSelected && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-700 text-white font-medium shrink-0">
                              当前
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
                          {char.personality || char.description}
                        </p>
                        {char.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {char.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-center gap-1 px-5 py-3">
                      <button
                        onClick={(e) => handleEdit(char, e)}
                        title="编辑"
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-600 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-slate-800/30 hover:text-slate-700 dark:hover:text-slate-500 transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                          <path d="m15 5 4 4"/>
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setProfileCardTarget(char); }}
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-600 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-slate-800/30 hover:text-slate-700 dark:text-slate-300 transition-colors"
                        title="角色名片（名片 / 简历 / 证书）"
                      >
                        <IdCard size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          // 简易创建的角色:直接导出 background 内容为 .md 文件,跳过模板
                          const isSimple = char.creationMode === 'simple' || (
                            !char.creationMode &&
                            !char.personality && !char.emotionTriggers && !char.thinkingStyle &&
                            !char.responseStyle && !char.identityAnchors && char.background.length > 100
                          );
                          if (isSimple && char.background) {
                            const blob = new Blob([char.background], { type: 'text/markdown;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${char.name}.md`;
                            a.click();
                            URL.revokeObjectURL(url);
                            showToast(`已导出「${char.name}」`);
                          } else {
                            setExportTarget(char);
                          }
                        }}
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-500 transition-colors"
                        title="导出"
                      >
                        <Download size={14} />
                      </button>
                      {characters.length > 1 && (
                        <button
                          onClick={(e) => handleSoftDelete(char, e)}
                          title="删除"
                          className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {characters.length === 0 && (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500">
            <p className="text-sm">还没有角色，选择上方方式创建一个吧</p>
          </div>
        )}
      </div>

      {showCreator && (
        <CharacterCreator
          character={editingCharacter}
          initialData={initialAssistantData}
          onClose={handleCreatorClose}
        />
      )}

      <AnimatePresence>
        {showSimpleEditor && editingCharacter && (
          <SimpleDocumentEditor
            character={editingCharacter}
            onClose={() => {
              setShowSimpleEditor(false);
              setEditingCharacter(null);
            }}
          />
        )}
      </AnimatePresence>

      {showAssistant && (
        <CharacterAssistant
          onComplete={handleAssistantComplete}
          onClose={() => setShowAssistant(false)}
        />
      )}

      {showCreationMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCreationMode(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">选择创建方式</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">选择适合你的方式来创建AI角色</p>
            
            <div className="space-y-3">
              <button
                onClick={() => handleCreationModeSelect('panel')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-slate-400 dark:hover:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/10 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center shadow-sm shrink-0">
                  <Plus size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">面板创建</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">通过分步表单详细定义角色的每个方面</p>
                </div>
              </button>

              <button
                onClick={() => handleCreationModeSelect('simple')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-900/10 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-400 to-slate-700 flex items-center justify-center shadow-sm shrink-0">
                  <Upload size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">简易创建</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">上传文件直接作为角色设定</p>
                </div>
              </button>
            </div>

            <div className="flex justify-end mt-5">
              <button onClick={() => setShowCreationMode(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {softDeleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSoftDeleteTarget(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-gray-100 dark:bg-gray-800">
                <Trash2 size={20} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">删除角色「{softDeleteTarget.name}」</h3>
                <p className="text-xs text-gray-500 mt-0.5">请选择删除方式</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <button
                onClick={() => {
                  softDeleteCharacter(softDeleteTarget.id);
                  setSoftDeleteTarget(null);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                  <RotateCcw size={16} className="text-gray-600 dark:text-gray-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">普通删除</p>
                  <p className="text-[11px] text-gray-500">移入回收站，可随时恢复</p>
                </div>
              </button>
              <button
                onClick={() => {
                  setSoftDeleteTarget(null);
                  setPermDeleteTarget(softDeleteTarget);
                  setPermDeleteStep(0);
                  setPermDeleteChecked(false);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                  <AlertTriangle size={16} className="text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">彻底删除</p>
                  <p className="text-[11px] text-red-500/70">永久删除，不可恢复</p>
                </div>
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setSoftDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {permDeleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={handlePermDeleteCancel} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {permDeleteStep === 0 ? '确认彻底删除？' : '最后确认'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {permDeleteStep === 0 ? '此操作不可撤销，角色数据将永久丢失' : '请勾选确认后删除'}
                </p>
              </div>
            </div>
            {permDeleteStep === 1 && (
              <label className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 mb-4 cursor-pointer">
                <input type="checkbox" checked={permDeleteChecked} onChange={(e) => setPermDeleteChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500" />
                <span className="text-xs text-red-700 dark:text-red-300">我已知道后果，这个角色将无法恢复</span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={handlePermDeleteCancel}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
              <button onClick={handlePermDeleteConfirm}
                disabled={permDeleteStep === 1 && !permDeleteChecked}
                className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95">
                {permDeleteStep === 0 ? '下一步' : '彻底删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🆕 角色名片：名片 / 求职简历 / 毕业证书（模板可扩展） */}
      {profileCardTarget && (
        <CharacterProfileCardModal
          character={profileCardTarget}
          onClose={() => setProfileCardTarget(null)}
        />
      )}

      {/* Export Dialog */}
      {exportTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => {
            setExportTarget(null);
            setExportMode('normal');
            setAiExportResult(null);
          }} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center gap-2">
                <Download size={18} className="text-gray-500" />
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">导出「{exportTarget.name}」</h3>
              </div>
              <button onClick={() => {
                setExportTarget(null);
                setExportMode('normal');
                setAiExportResult(null);
              }} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            <div className="px-4 pb-4">
              {/* Mode Tabs */}
              <div className="flex gap-2 mb-3">
                <button
                  onClick={() => { setExportMode('normal'); /* 不清空 AI 缓存,允许来回切换 */ }}
                  className={`flex-1 px-3 py-2 rounded-full text-xs font-medium transition-all border ${
                    exportMode === 'normal'
                      ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="text-sm font-semibold">普通导出</div>
                  <div className="text-[10px] opacity-70 mt-0.5">按模板自动组装</div>
                </button>
                <button
                  onClick={async () => {
                    setExportMode('ai');
                    // 优先从 localStorage 读取,避免重复生成
                    const cached = getAiExportCache(exportTarget.id);
                    if (cached) {
                      setAiExportResult(cached);
                      return;
                    }
                    if (!aiExporting) {
                      setAiExporting(true);
                      try {
                        const result = await exportCharacterWithAI(exportTarget);
                        setAiExportCache(exportTarget.id, result);
                        setAiExportResult(result);
                      } catch (err) {
                        const errMsg = err instanceof Error ? err.message : 'AI 导出失败';
                        showToast(errMsg, 'error');
                        // 切回普通模式
                        setExportMode('normal');
                      } finally {
                        setAiExporting(false);
                      }
                    }
                  }}
                  className={`flex-1 px-3 py-2 rounded-full text-xs font-medium transition-all border ${
                    exportMode === 'ai'
                      ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="text-sm font-semibold">AI 辅助导出</div>
                  <div className="text-[10px] opacity-70 mt-0.5">AI 深度增强</div>
                </button>
              </div>

              {/* AI 模式下的重新生成 / 删除 按钮 */}
              {exportMode === 'ai' && (aiExportResult || getAiExportCache(exportTarget.id)) && !aiExporting && (
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => {
                      // 初始化聊天:把当前结果作为 AI 的第一条消息
                      const current = aiExportResult || getAiExportCache(exportTarget.id) || '';
                      setRegenChatMessages([{ role: 'assistant', content: current }]);
                      setRegenInput('');
                      setRegenDialogOpen(true);
                      // 滚动到底部
                      setTimeout(() => regenChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/20 hover:bg-slate-200 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <Brain size={12} />
                    重新生成
                  </button>
                  <button
                    onClick={() => {
                      // 删除 AI 缓存
                      try { localStorage.removeItem(`ai-export-${exportTarget.id}`); } catch { /* ignore */ }
                      setAiExportResult(null);
                      setExportMode('normal');
                      showToast('已删除 AI 导出缓存');
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                  >
                    <Trash2 size={12} />
                    删除缓存
                  </button>
                </div>
              )}

              {/* Content */}
              {exportMode === 'ai' && aiExporting ? (
                <div className="flex flex-col items-center justify-center h-64 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                  <Brain size={32} className="text-slate-500 animate-pulse mb-3" />
                  <p className="text-sm text-gray-500">AI 正在生成专业级 prompt...</p>
                  <p className="text-xs text-gray-400 mt-1">故事化叙述 + 情感融合 + 语气词注入 + 人格防漂移</p>
                </div>
              ) : (
                <textarea
                  readOnly
                  className="w-full h-64 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 font-mono resize-none focus:outline-none"
                  value={exportMode === 'normal' ? exportCharacterAsMarkdown(exportTarget) : (aiExportResult || getAiExportCache(exportTarget.id) || exportCharacterAsMarkdown(exportTarget))}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={() => {
                    const cached = getAiExportCache(exportTarget.id);
                    const content = exportMode === 'normal' ? exportCharacterAsMarkdown(exportTarget) : (aiExportResult || cached || exportCharacterAsMarkdown(exportTarget));
                    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${exportTarget.name}_${exportMode === 'normal' ? '角色设定' : 'AI增强版'}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast(`已导出「${exportTarget.name}」`);
                    // AI 模式下载后清理 localStorage 缓存(避免占空间)
                    if (exportMode === 'ai') {
                      try { localStorage.removeItem(`ai-export-${exportTarget.id}`); } catch { /* ignore */ }
                    }
                    setExportTarget(null);
                    setExportMode('normal');
                  }}
                  className="px-4 py-2 rounded-lg text-sm text-white bg-slate-700 hover:bg-slate-800 transition-colors active:scale-95"
                >
                  <Download size={14} className="inline mr-1" />
                  下载 .md 文件
                </button>
                <button
                  onClick={() => {
                    const cached = getAiExportCache(exportTarget.id);
                    const content = exportMode === 'normal' ? exportCharacterAsMarkdown(exportTarget) : (aiExportResult || cached || exportCharacterAsMarkdown(exportTarget));
                    navigator.clipboard.writeText(content).then(() => {
                      showToast('已复制到剪贴板');
                      // AI 模式复制后清理 localStorage 缓存
                      if (exportMode === 'ai') {
                        try { localStorage.removeItem(`ai-export-${exportTarget.id}`); } catch { /* ignore */ }
                      }
                      setExportTarget(null);
                      setExportMode('normal');
                    }).catch(() => {
                      showToast('复制失败', 'error');
                    });
                  }}
                  className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  复制到剪贴板
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 重新生成 - 聊天式对话框(参考 AI 辅助创建角色) */}
      {regenDialogOpen && exportTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col overflow-hidden mx-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
                  <Brain size={18} className="text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">重新生成「{exportTarget.name}」</h2>
                  <p className="text-[11px] text-gray-400">告诉 AI 你想要的调整方向,AI 会基于此重新生成</p>
                </div>
              </div>
              <button
                onClick={() => {
                  // 关闭对话框时:采纳最新结果
                  const lastAssistant = [...regenChatMessages].reverse().find(m => m.role === 'assistant');
                  if (lastAssistant && exportTarget) {
                    setAiExportResult(lastAssistant.content);
                    setAiExportCache(exportTarget.id, lastAssistant.content);
                  }
                  setRegenDialogOpen(false);
                  setRegenChatMessages([]);
                  setRegenInput('');
                }}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X size={16} className="text-gray-400" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {regenChatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                      <Brain size={14} className="text-white" />
                    </div>
                  )}
                  <div className={`max-w-[78%] ${msg.role === 'user' ? 'order-1' : ''}`}>
                    <div className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap font-mono ${
                      msg.role === 'user'
                        ? 'bg-slate-700 text-white rounded-br-md'
                        : 'bg-gray-100 dark:bg-gray-700/80 text-gray-800 dark:text-gray-200 rounded-bl-md max-h-96 overflow-y-auto'
                    }`}>
                      {msg.content}
                    </div>
                    {/* AI 消息下方的"采用此版本"按钮(只对最后一条 AI 消息) */}
                    {msg.role === 'assistant' && i === regenChatMessages.length - 1 && (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => {
                            if (!exportTarget) return;
                            setAiExportResult(msg.content);
                            setAiExportCache(exportTarget.id, msg.content);
                            showToast('已采用此版本');
                            setRegenDialogOpen(false);
                            setRegenChatMessages([]);
                            setRegenInput('');
                          }}
                          className="text-[11px] px-3 py-1 rounded-md bg-slate-200 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500 hover:bg-slate-300 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          采用此版本
                        </button>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(msg.content).then(() => {
                              showToast('已复制到剪贴板');
                            });
                          }}
                          className="text-[11px] px-3 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                          复制
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {regenLoading && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                    <Brain size={14} className="text-white" />
                  </div>
                  <div className="bg-gray-100 dark:bg-gray-700/80 px-3 py-2.5 rounded-2xl rounded-bl-md">
                    <Loader2 size={16} className="animate-spin text-gray-400" />
                  </div>
                </div>
              )}
              <div ref={regenChatEndRef} />
            </div>

            {/* Input */}
            <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700">
              <div className="flex gap-2">
                <input
                  value={regenInput}
                  onChange={(e) => setRegenInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleRegenSend();
                    }
                  }}
                  disabled={regenLoading}
                  placeholder={regenLoading ? 'AI 正在重新生成...' : '输入你的修改诉求(例:语气更活泼一点)'}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-700 disabled:opacity-50 transition-shadow"
                />
                <button
                  onClick={handleRegenSend}
                  disabled={!regenInput.trim() || regenLoading}
                  className="p-2.5 rounded-xl bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] animate-[fadeIn_0.2s_ease-out]">
          <div className={`px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${
            toast.type === 'success' 
              ? 'bg-green-500 text-white' 
              : 'bg-red-500 text-white'
          }`}>
            {toast.message}
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

export default CharacterSelectionPage;
