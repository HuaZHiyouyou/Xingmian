import { Character } from '../types';

function extractList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^[-*]\s*\*?\*?/, '').replace(/\*?\*?$/, '').trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('|'));
}

function extractKeyValues(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/[-*]\s*\*?\*?(.+?)\*?\*?\s*[：:]\s*(.+)/);
    if (match) {
      result[match[1].trim()] = match[2].trim();
    }
  }
  return result;
}

function findSection(content: string, ...headings: string[]): string {
  const lines = content.split('\n');
  for (const heading of headings) {
    const regex = new RegExp(`^#{1,3}\\s*${heading}`, 'i');
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i].trim())) {
        startIdx = i + 1;
        break;
      }
    }
    if (startIdx === -1) continue;

    let endIdx = lines.length;
    for (let i = startIdx; i < lines.length; i++) {
      if (/^#{1,3}\s+/.test(lines[i].trim()) && i > startIdx) {
        endIdx = i;
        break;
      }
    }
    return lines.slice(startIdx, endIdx).join('\n').trim();
  }
  return '';
}

function findSectionAsList(content: string, ...headings: string[]): string[] {
  const text = findSection(content, ...headings);
  if (!text) return [];
  return extractList(text);
}

export function parseMdToCharacter(mdContent: string): Partial<Character> {
  const result: Partial<Character> = {};

  // Name: first H1
  const nameMatch = mdContent.match(/^#\s+(.+)$/m);
  if (nameMatch) {
    result.name = nameMatch[1].replace(/\s*[\w]+\s*$/, '').trim();
  }

  // Description: blockquote after H1 or first paragraph
  const quoteMatch = mdContent.match(/^>\s*(.+)$/m);
  const introText = findSection(mdContent, '个人介绍', '简介', '介绍', '描述', 'description');
  result.description = introText || (quoteMatch ? quoteMatch[1] : '');

  // Background / story
  const backgroundText = findSection(mdContent, '背景故事', '背景', 'backstory', 'background');
  result.background = backgroundText;

  // Personality: from 角色档案 or 性格
  const profileText = findSection(mdContent, '角色档案', '角色信息', '基本资料', '人物设定', 'profile');
  if (profileText) {
    const kv = extractKeyValues(profileText);
    if (kv['性格']) result.personality = kv['性格'];
    if (kv['种族']) result.description = (result.description ? result.description + '\n' : '') + `种族：${kv['种族']}`;
    if (kv['年龄']) result.description = (result.description ? result.description + '\n' : '') + `年龄：${kv['年龄']}`;
    if (kv['生日']) result.description = (result.description ? result.description + '\n' : '') + `生日：${kv['生日']}`;
  }

  const personalityText = findSection(mdContent, '性格', '性格特点', 'personality');
  if (personalityText && !result.personality) {
    result.personality = personalityText.split('\n')[0].replace(/^[-*]\s*/, '').trim();
  }
  if (personalityText && result.personality) {
    result.personality = result.personality + '\n' + personalityText;
  }

  // Likes
  const likes = findSectionAsList(mdContent, '喜欢', '喜好', 'likes');
  if (likes.length > 0) {
    result.likes = likes;
  } else if (profileText) {
    const kv = extractKeyValues(profileText);
    if (kv['喜欢']) {
      result.likes = kv['喜欢'].split(/\s*[/、,]\s*/).map((s) => s.trim()).filter(Boolean);
    }
  }

  // Dislikes
  const dislikes = findSectionAsList(mdContent, '讨厌', '不喜欢', '厌恶', 'dislikes');
  if (dislikes.length > 0) {
    result.dislikes = dislikes;
  } else if (profileText) {
    const kv = extractKeyValues(profileText);
    if (kv['讨厌']) {
      result.dislikes = kv['讨厌'].split(/\s*[/、,]\s*/).map((s) => s.trim()).filter(Boolean);
    }
  }

  // Habits
  result.habits = findSectionAsList(mdContent, '小习惯', '习惯', 'habits', '行为习惯');

  // Catchphrases
  const catchphraseText = findSection(mdContent, '经典语录', '语录', '台词', '口头禅', 'catchphrases', '经典台词');
  if (catchphraseText) {
    const phrases = extractList(catchphraseText)
      .map((p) => p.replace(/^["「『"「]+/, '').replace(/["」』"」]+$/, '').trim())
      .filter((p) => p.length > 0);
    result.catchphrases = phrases;
  }

  // Thinking style
  const thinkingText = findSection(mdContent, '思考逻辑', '思考方式', '思维模式', 'thinking', '思维方式', '思考风格');
  result.thinkingStyle = thinkingText;

  // Emotion triggers
  const emotionTriggerText = findSection(mdContent, '情绪触发', '情绪规则', '情绪表达', 'emotion', '情绪触发规则', '情感规则');
  result.emotionTriggers = emotionTriggerText;

  // Emotion expressions
  const emotionExpressionText = findSection(mdContent, '情绪表达', '表达方式', '情感表达', 'emotion expression');
  result.emotionExpressions = emotionExpressionText || emotionTriggerText;

  // Response style
  const responseText = findSection(mdContent, '回复风格', '说话风格', '回复规则', '对话风格', 'response', '回复要求', '语言风格');
  result.responseStyle = responseText;

  // Relationship stages
  const relationText = findSection(mdContent, '关系发展', '关系阶段', '好感系统', 'relationship', '喜欢的人');
  result.relationshipStages = relationText;

  // Identity anchors
  const identityText = findSection(mdContent, '核心原则', '核心信念', '身份锚点', 'identity', '最高优先级');
  result.identityAnchors = identityText;

  // Forbidden behaviors
  const forbiddenText = findSection(mdContent, '禁止行为', '禁止', '禁止预设回复', 'forbidden', '核心原则');
  result.forbiddenBehaviors = forbiddenText;

  // Output format
  const outputText = findSection(mdContent, '输出格式', '回复格式', 'output', '格式要求');
  result.outputFormat = outputText;

  // Tags: extract from various places
  const allTags: string[] = [];
  if (profileText) {
    const kv = extractKeyValues(profileText);
    Object.values(kv).forEach((v) => {
      const parts = v.split(/\s*[/、,|]\s*/);
      parts.forEach((p) => {
        const trimmed = p.trim();
        if (trimmed.length > 0 && trimmed.length < 10) allTags.push(trimmed);
      });
    });
  }
  result.tags = [...new Set(allTags)].slice(0, 10);

  return result;
}
