/**
 * Bot 收发统一门控：群聊/私聊开关 + 黑/白名单。
 * 供 botHandler（收消息）与主动回复外发（proactiveReplyStore）共用，
 * 确保主动发到群聊时同样遵守接入管理中的白/黑名单。
 */

/** 解析逗号分隔的 ID 列表（白/黑名单输入） */
export function parseIdList(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface BotGatingResult {
  allowed: boolean;
  reason?: string;
}

/**
 * 判断一条收发是否通过接入配置的门控。
 * @param config 接入配置 JSON 对象（字段与接入管理页一致）
 * @param groupId 群ID（非空表示群聊场景；null/空表示私聊场景）
 * @param userId 用户ID（私聊场景用）
 */
export function passesBotGating(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any> | null | undefined,
  groupId: string | null | undefined,
  userId: string,
): BotGatingResult {
  if (!config) return { allowed: false, reason: '接入配置为空' };

  if (groupId != null && groupId !== '') {
    if (config.group_chat_enabled === false) {
      return { allowed: false, reason: '群聊回复已关闭' };
    }
    if (config.blocked_groups_enabled && parseIdList(config.blocked_groups).includes(String(groupId))) {
      return { allowed: false, reason: `群 ${groupId} 在黑名单中` };
    }
    if (config.allowed_groups_enabled) {
      const allowed = parseIdList(config.allowed_groups);
      if (allowed.length > 0 && !allowed.includes(String(groupId))) {
        return { allowed: false, reason: `群 ${groupId} 不在白名单中` };
      }
    }
    return { allowed: true };
  }

  if (config.private_chat_enabled === false) {
    return { allowed: false, reason: '私聊回复已关闭' };
  }
  if (config.blocked_users_enabled && parseIdList(config.blocked_users).includes(String(userId))) {
    return { allowed: false, reason: `用户 ${userId} 在黑名单中` };
  }
  if (config.allowed_users_enabled) {
    const allowed = parseIdList(config.allowed_users);
    if (allowed.length > 0 && !allowed.includes(String(userId))) {
      return { allowed: false, reason: `用户 ${userId} 不在白名单中` };
    }
  }
  return { allowed: true };
}
