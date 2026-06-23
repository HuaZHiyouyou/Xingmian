import { Conversation, AffinityState, MemoryEntry } from '../types';
import { isRunningInTauri } from '../lib/tauriBridge';

type ExportFormat = 'txt' | 'json' | 'md';

function generateContent(conversations: Conversation[], format: ExportFormat, getCharacterName?: (id: string) => string): { content: string; filename: string; mimeType: string; ext: string } {
  if (format === 'json') {
    return { content: JSON.stringify(conversations, null, 2), filename: 'conversations', mimeType: 'application/json', ext: 'json' };
  }
  if (format === 'md') {
    const lines: string[] = [
      `# SoulChat 聊天记录`, '',
      `> 导出时间：${new Date().toLocaleString('zh-CN')}`,
      `> 总对话数：${conversations.length}`, '', '---', '',
    ];
    for (const conv of conversations) {
      const charName = getCharacterName?.(conv.characterId) || '';
      lines.push(`## ${conv.title}${charName ? `（${charName}）` : ''}`, '');
      lines.push(`- 创建：${new Date(conv.createdAt).toLocaleString('zh-CN')}`);
      lines.push(`- 消息数：${conv.messages.length}`, '');
      for (const msg of conv.messages) {
        const sender = msg.sender === 'user' ? '用户' : (charName || 'AI');
        const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN');
        lines.push(`**${sender}**（${time}）`, '', msg.content, '');
      }
      lines.push('---', '');
    }
    return { content: lines.join('\n'), filename: 'conversations', mimeType: 'text/markdown', ext: 'md' };
  }
  const text = conversations.map((conv) => {
    const header = `=== ${conv.title} ===\n日期: ${new Date(conv.createdAt).toLocaleString('zh-CN')}\n\n`;
    const messages = conv.messages.map((m) => {
      const sender = m.sender === 'user' ? '我' : 'AI';
      const time = new Date(m.timestamp).toLocaleTimeString('zh-CN');
      return `[${time}] ${sender}: ${m.content}`;
    }).join('\n');
    return header + messages;
  }).join('\n\n' + '-'.repeat(50) + '\n\n');
  return { content: text, filename: 'conversations', mimeType: 'text/plain', ext: 'txt' };
}

function generateSingleContent(conv: Conversation, format: ExportFormat, characterName?: string): { content: string; filename: string; mimeType: string; ext: string } {
  if (format === 'json') {
    return { content: JSON.stringify(conv, null, 2), filename: conv.title, mimeType: 'application/json', ext: 'json' };
  }
  if (format === 'md') {
    const lines: string[] = [
      `# ${conv.title}`, '',
      characterName ? `> 角色：${characterName}` : '',
      `> 创建时间：${new Date(conv.createdAt).toLocaleString('zh-CN')}`,
      `> 消息数：${conv.messages.length}`, '', '---', '',
    ];
    for (const msg of conv.messages) {
      const sender = msg.sender === 'user' ? '用户' : (characterName || 'AI');
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      lines.push(`**${sender}**（${time}）`, '', msg.content, '', '---', '');
    }
    return { content: lines.join('\n'), filename: conv.title, mimeType: 'text/markdown', ext: 'md' };
  }
  const header = `=== ${conv.title} ===\n日期: ${new Date(conv.createdAt).toLocaleString('zh-CN')}\n\n`;
  const messages = conv.messages.map((m) => {
    const sender = m.sender === 'user' ? '我' : 'AI';
    const time = new Date(m.timestamp).toLocaleTimeString('zh-CN');
    return `[${time}] ${sender}: ${m.content}`;
  }).join('\n');
  return { content: header + messages, filename: conv.title, mimeType: 'text/plain', ext: 'txt' };
}

function browserDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function nativeSave(content: string, defaultFilename: string, ext: string): Promise<boolean> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile, exists } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: `${defaultFilename}.${ext}`,
      filters: [{ name: 'Files', extensions: [ext] }],
    });
    if (path) {
      await writeTextFile(path, content);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function exportConversations(conversations: Conversation[], format: ExportFormat, getCharacterName?: (id: string) => string) {
  const { content, filename, mimeType, ext } = generateContent(conversations, format, getCharacterName);
  if (isRunningInTauri()) {
    await nativeSave(content, filename, ext);
  } else {
    browserDownload(content, `${filename}.${ext}`, mimeType);
  }
}

export async function exportSingleConversation(conv: Conversation, format: ExportFormat, characterName?: string) {
  const { content, filename, mimeType, ext } = generateSingleContent(conv, format, characterName);
  if (isRunningInTauri()) {
    await nativeSave(content, filename, ext);
  } else {
    browserDownload(content, `${filename}.${ext}`, mimeType);
  }
}

export async function importConversations(): Promise<Conversation[]> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({
      multiple: false,
      filters: [{ name: 'Files', extensions: ['json', 'txt', 'md'] }],
    });
    if (typeof path === 'string') {
      const content = await readTextFile(path);
      return parseImportContent(content, path);
    }
    return [];
  } catch {
    return [];
  }
}

function parseImportContent(content: string, filename: string): Conversation[] {
  if (filename.endsWith('.json')) {
    try {
      const data = JSON.parse(content);
      if (Array.isArray(data)) return data.filter(isValidConversation);
      if (data && typeof data === 'object' && data.messages) return [data].filter(isValidConversation);
    } catch { /* ignore */ }
  }

  // Try parsing exported TXT/MD format: [time] sender: content
  const lines = content.split('\n');
  const conversations: Conversation[] = [];
  let currentConv: { title: string; messages: { id: string; content: string; sender: 'user' | 'ai'; timestamp: Date }[]; createdAt: Date } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match conversation header: === Title ===
    const headerMatch = trimmed.match(/^={3,}\s*(.+?)\s*={3,}$/);
    if (headerMatch) {
      if (currentConv && currentConv.messages.length > 0) {
        conversations.push({
          id: Date.now().toString(36) + Math.random().toString(36).substr(2),
          title: currentConv.title,
          messages: currentConv.messages,
          characterId: '',
          createdAt: currentConv.createdAt,
          updatedAt: new Date(),
        });
      }
      currentConv = { title: headerMatch[1], messages: [], createdAt: new Date() };
      continue;
    }

    // Match date line: 日期: ...
    const dateMatch = trimmed.match(/^日期[:：]\s*(.+)$/);
    if (dateMatch && currentConv) {
      const d = new Date(dateMatch[1]);
      if (!isNaN(d.getTime())) currentConv.createdAt = d;
      continue;
    }

    // Match message: [time] sender: content
    const msgMatch = trimmed.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(AI|我|用户)[:：]\s*(.+)$/);
    if (msgMatch && currentConv) {
      const sender = msgMatch[2] === '我' || msgMatch[2] === '用户' ? 'user' : 'ai';
      const timeParts = msgMatch[1].split(':');
      const date = new Date(currentConv.createdAt);
      date.setHours(parseInt(timeParts[0]), parseInt(timeParts[1]), timeParts[2] ? parseInt(timeParts[2]) : 0);
      currentConv.messages.push({
        id: `${currentConv.messages.length}`,
        content: msgMatch[3],
        sender,
        timestamp: date,
      });
      continue;
    }

    // Match markdown format: **sender**（time）
    const mdMatch = trimmed.match(/^\*\*(AI|用户|我)\*\*[（(](.+?)[）)]$/);
    if (mdMatch && currentConv) {
      const sender = mdMatch[1] === '我' || mdMatch[1] === '用户' ? 'user' : 'ai';
      currentConv.messages.push({
        id: `${currentConv.messages.length}`,
        content: '',
        sender,
        timestamp: new Date(mdMatch[2] || currentConv.createdAt),
      });
      continue;
    }

    // If we have a current conversation and this line is not a header/separator, it's message content
    if (currentConv && currentConv.messages.length > 0) {
      const lastMsg = currentConv.messages[currentConv.messages.length - 1];
      if (lastMsg.content === '') {
        lastMsg.content = trimmed;
      } else {
        lastMsg.content += '\n' + trimmed;
      }
    }
  }

  // Push last conversation
  if (currentConv && currentConv.messages.length > 0) {
    conversations.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      title: currentConv.title,
      messages: currentConv.messages,
      characterId: '',
      createdAt: currentConv.createdAt,
      updatedAt: new Date(),
    });
  }

  if (conversations.length > 0) return conversations;

  // Fallback: treat entire content as single conversation with user messages
  return [{
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    title: filename.replace(/\.[^.]+$/, ''),
    messages: content.split('\n').filter(Boolean).map((line, i) => ({
      id: `${i}`,
      content: line,
      sender: 'user' as const,
      timestamp: new Date(),
    })),
    characterId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  }];
}

function isValidConversation(obj: unknown): obj is Conversation {
  return obj !== null && typeof obj === 'object' && 'messages' in obj && Array.isArray((obj as Conversation).messages);
}

// Affinity export/import
export async function exportAffinityData(affinityStates: Record<string, AffinityState>, getCharacterName?: (id: string) => string) {
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    affinities: Object.entries(affinityStates).map(([charId, state]) => ({
      characterId: charId,
      characterName: getCharacterName?.(charId) || charId,
      level: state.level,
      stage: state.stage,
      history: state.history,
      lastInteraction: state.lastInteraction,
    })),
  };
  const content = JSON.stringify(exportData, null, 2);
  if (isRunningInTauri()) {
    await nativeSave(content, 'affinity-data', 'json');
  } else {
    browserDownload(content, 'affinity-data.json', 'application/json');
  }
}

export async function importAffinityData(): Promise<Record<string, AffinityState>> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (typeof path === 'string') {
      const content = await readTextFile(path);
      const data = JSON.parse(content);
      if (data && data.affinities && Array.isArray(data.affinities)) {
        const result: Record<string, AffinityState> = {};
        for (const item of data.affinities) {
          if (item.characterId) {
            result[item.characterId] = {
              level: item.level || 0,
              stage: item.stage || 'stranger',
              history: item.history || [],
              lastInteraction: new Date(item.lastInteraction),
            };
          }
        }
        return result;
      }
    }
    return {};
  } catch {
    return {};
  }
}

// Memory entries export/import
export async function exportMemoryEntries(entries: Record<string, MemoryEntry[]>, getCharacterName?: (id: string) => string) {
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: Object.entries(entries).map(([charId, charEntries]) => ({
      characterId: charId,
      characterName: getCharacterName?.(charId) || charId,
      entries: charEntries,
    })),
  };
  const content = JSON.stringify(exportData, null, 2);
  if (isRunningInTauri()) {
    await nativeSave(content, 'memory-entries', 'json');
  } else {
    browserDownload(content, 'memory-entries.json', 'application/json');
  }
}

export async function importMemoryEntries(): Promise<Record<string, MemoryEntry[]>> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (typeof path === 'string') {
      const content = await readTextFile(path);
      const data = JSON.parse(content);
      if (data && data.entries && Array.isArray(data.entries)) {
        const result: Record<string, MemoryEntry[]> = {};
        for (const item of data.entries) {
          if (item.characterId && Array.isArray(item.entries)) {
            result[item.characterId] = item.entries.map((e: Record<string, unknown>) => ({
              ...e,
              createdAt: new Date(e.createdAt as string),
            })) as MemoryEntry[];
          }
        }
        return result;
      }
    }
    return {};
  } catch {
    return {};
  }
}

export async function exportLearningData(profiles: Record<string, { vocabulary: string[]; phrases: string[] }>, getCharacterName?: (id: string) => string) {
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: Object.entries(profiles).map(([charId, profile]) => ({
      characterId: charId,
      characterName: getCharacterName?.(charId) || charId,
      vocabulary: profile.vocabulary,
      phrases: profile.phrases,
    })),
  };
  const content = JSON.stringify(exportData, null, 2);
  if (isRunningInTauri()) {
    await nativeSave(content, 'learning-data', 'json');
  } else {
    browserDownload(content, 'learning-data.json', 'application/json');
  }
}

export async function importLearningData(): Promise<Record<string, { vocabulary: string[]; phrases: string[] }>> {
  try {
    if (isRunningInTauri()) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (typeof path === 'string') {
        const content = await readTextFile(path);
        return parseLearningImport(content);
      }
      return {};
    }
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve({}); return; }
        const text = await file.text();
        resolve(parseLearningImport(text));
      };
      input.click();
    });
  } catch {
    return {};
  }
}

function parseLearningImport(content: string): Record<string, { vocabulary: string[]; phrases: string[] }> {
  try {
    const data = JSON.parse(content);
    const result: Record<string, { vocabulary: string[]; phrases: string[] }> = {};
    if (data && data.profiles && Array.isArray(data.profiles)) {
      for (const item of data.profiles) {
        if (item.characterId) {
          result[item.characterId] = {
            vocabulary: Array.isArray(item.vocabulary) ? item.vocabulary : [],
            phrases: Array.isArray(item.phrases) ? item.phrases : [],
          };
        }
      }
    } else if (data && typeof data === 'object') {
      for (const [charId, profile] of Object.entries(data)) {
        const p = profile as any;
        if (typeof p === 'object' && p !== null) {
          result[charId] = {
            vocabulary: Array.isArray(p.vocabulary) ? p.vocabulary : [],
            phrases: Array.isArray(p.phrases) ? p.phrases : [],
          };
        }
      }
    }
    return result;
  } catch {
    return {};
  }
}
