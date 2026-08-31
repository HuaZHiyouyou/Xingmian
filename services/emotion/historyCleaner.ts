/**
 * ============================================================
 * 历史净化器 V2
 * 参考: docs/upgrade-plans/01-emotion-system-upgrade.md
 * 从 LLM 输出中分离出：真实回复文本 vs. 思维链/情绪标签
 * 保证用户看到的是干净的自然对话
 * ============================================================
 */

// ---------- 净化配置 ----------

export interface HistoryCleanerConfig {
  /** 移除 <thought> 标签及其内容 */
  removeThoughts: boolean;
  /** 移除 <feeling> 标签及其内容 */
  removeFeelings: boolean;
  /** 移除 <action> / 【动作】标签及其内容 */
  removeActions: boolean;
  /** 移除 【内心活动】 标签及其内容 */
  removeInnerMonologue: boolean;
  /** 移除 `AI化身:` `助手：` 等暴露身份的前缀 */
  removeIdentityPrefixes: boolean;
  /** 移除思维链模板语 */
  removeTemplateLanguage: boolean;
  /** 净化后最小长度 */
  minResultLength: number;
}

export const DEFAULT_CLEANER_CONFIG: HistoryCleanerConfig = {
  removeThoughts: true,
  removeFeelings: true,
  removeActions: true,
  removeInnerMonologue: true,
  removeIdentityPrefixes: true,
  removeTemplateLanguage: true,
  minResultLength: 2,
};

// ---------- 净化结果 ----------

export interface CleanResult {
  /** 干净的自然对话文本 */
  cleanText: string;
  /** 被移除的思维链内容（用于调试） */
  removedContent: string[];
  /** 是否触发了降级（净化后为空） */
  fallback: boolean;
  /** 降级时的原始文本 */
  fallbackText?: string;
}

// ---------- 主净化器 ----------

export class HistoryCleaner {
  constructor(private config: HistoryCleanerConfig = DEFAULT_CLEANER_CONFIG) {}

  /**
   * clean - 净化 LLM 输出，只保留真实对话内容
   */
  clean(text: string): CleanResult {
    let result = text;
    const removed: string[] = [];

    // 1. 移除 <reply> 标签（保留内容）
    // 用 greedy 匹配：从第一个 <reply> 到最后一个 </reply>，防止多块或内嵌 </reply> 截断
    {
      const lowerResult = result.toLowerCase();
      const firstReply = lowerResult.indexOf('<reply>');
      const lastReply = lowerResult.lastIndexOf('</reply>');
      if (firstReply !== -1 && lastReply > firstReply) {
        // 保留 <reply> 块之间的所有内容，只移除标签本身
        result = result.replace(/<\/?reply[^>]*>/gi, '');
      } else if (firstReply !== -1) {
        // 只有开标签没有闭标签：移除孤立标签
        result = result.replace(/<\/?reply[^>]*>/gi, '');
      }
    }

    // 2. 移除 <thought> 标签
    if (this.config.removeThoughts) {
      const thoughtMatches = result.match(/<thought[\s\S]*?<\/thought>/gi);
      if (thoughtMatches) {
        for (const m of thoughtMatches) {
          removed.push(m);
        }
        result = result.replace(/<thought[\s\S]*?<\/thought>/gi, '');
      }
    }

    // 2. 移除 <feeling> 标签
    if (this.config.removeFeelings) {
      const feelingMatches = result.match(/<feeling[\s\S]*?<\/feeling>/gi);
      if (feelingMatches) {
        for (const m of feelingMatches) {
          removed.push(m);
        }
        result = result.replace(/<feeling[\s\S]*?<\/feeling>/gi, '');
      }
    }

    // 3. 移除 <action> 和中文标签
    if (this.config.removeActions) {
      // 英文标签
      const actionMatches = result.match(/<action[\s\S]*?<\/action>/gi);
      if (actionMatches) {
        for (const m of actionMatches) { removed.push(m); }
        result = result.replace(/<action[\s\S]*?<\/action>/gi, '');
      }
      // 中文标签
      const cnActionMatches = result.match(/【动作】[\s\S]*?【\/动作】/g);
      if (cnActionMatches) {
        for (const m of cnActionMatches) { removed.push(m); }
        result = result.replace(/【动作】[\s\S]*?【\/动作】/g, '');
      }
    }

    // 4. 移除【内心活动】
    if (this.config.removeInnerMonologue) {
      const monoMatches = result.match(/【内心活动】[\s\S]*?【\/内心活动】/g);
      if (monoMatches) {
        for (const m of monoMatches) { removed.push(m); }
        result = result.replace(/【内心活动】[\s\S]*?【\/内心活动】/g, '');
      }
    }

    // 5. 移除身份暴露前缀
    if (this.config.removeIdentityPrefixes) {
      const prefixPatterns = [
        /^(AI[：:]\s*)/,
        /^(助手[：:]\s*)/,
        /^(角色[：:]\s*)/,
        /^(NPC[：:]\s*)/i,
        /^(Agent[：:]\s*)/i,
        /^（.*?说[：:]）/,
      ];
      for (const pattern of prefixPatterns) {
        if (pattern.test(result)) {
          const match = result.match(pattern);
          if (match) removed.push(match[0]);
          result = result.replace(pattern, '');
        }
      }
    }

    // 6. 移除模板语言
    if (this.config.removeTemplateLanguage) {
      const tmplPatterns = [
        /您好！作为.*?，我很乐意/,
        /根据您的要求/,
        /综上所述/,
        /希望我的回答/,
        /^（思考中）/,
        /^（分析中）/,
        /^（正在回复）/,
      ];
      for (const pattern of tmplPatterns) {
        if (pattern.test(result)) {
          const match = result.match(pattern);
          if (match) removed.push(match[0]);
          result = result.replace(pattern, '');
        }
      }
    }

    // 7. 清理残留的孤立右括号（如去掉 action 标签后留下的 ））
    result = result.replace(/^[）)）\]>】》」』]+/, '');

    // 清理多余空白
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.replace(/^\n+/, '');
    result = result.trim();

    // 降级处理
    if (result.length < this.config.minResultLength) {
      // 尝试仅清理标签，保留原始文本
      const fallbackText = text
        .replace(/<\/?thought[^>]*>/gi, '')
        .replace(/<\/?reply[^>]*>/gi, '')
        .replace(/<\/?feeling[^>]*>/gi, '')
        .replace(/<\/?action[^>]*>/gi, '')
        .replace(/【动作】|【\/动作】|【内心活动】|【\/内心活动】/g, '')
        .trim();

      if (fallbackText.length >= 2) {
        return { cleanText: fallbackText, removedContent: removed, fallback: true, fallbackText: fallbackText };
      }

      // 尝试提取 thought 标签内部文本作为回复（AI 可能把正文放在 thought 里）
      const thoughtInner = text.match(/<thought[^>]*>([\s\S]*?)<\/thought>/gi);
      if (thoughtInner && thoughtInner.length > 0) {
        const extracted = thoughtInner
          .map(t => t.replace(/<\/?thought[^>]*>/gi, '').trim())
          .filter(t => t.length >= 2)
          .join('\n');
        if (extracted.length >= 2) {
          return { cleanText: extracted, removedContent: removed, fallback: true, fallbackText: extracted };
        }
      }

      // 完全为空，使用简短占位而非长文本
      return { cleanText: '...', removedContent: removed, fallback: true, fallbackText: text };
    }

    return { cleanText: result, removedContent: removed, fallback: false };
  }

  /**
   * cleanForHistory - 净化用于记忆存储的历史文本
   * 比 clean() 更激进：完全移除所有标签而非仅隐藏
   */
  cleanForHistory(text: string): string {
    const result = this.clean(text);
    if (result.fallback) return text;

    // 额外移除剩余的 XML 标签残留
    let clean = result.cleanText;
    clean = clean.replace(/<[^>]*>/g, ''); // 移除所有 XML 标签
    clean = clean.replace(/^[\s\n]+/, '');
    clean = clean.replace(/[\s\n]+$/, '');
    return clean;
  }
}

// 单例
let cleanerInstance: HistoryCleaner | null = null;

export function getHistoryCleaner(): HistoryCleaner {
  if (!cleanerInstance) {
    cleanerInstance = new HistoryCleaner();
  }
  return cleanerInstance;
}
