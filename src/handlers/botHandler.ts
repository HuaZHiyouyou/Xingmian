
import { useEffect, useRef } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useIntegrationStore } from '../store/integrationStore';
import { useChatStore } from '../store/chatStore';
import { useCharacterStore } from '../store/characterStore';
import { useDebugLog } from '../store/debugLogStore';
import { useFeatureModuleStore } from '../store/featureModuleStore';
import { generateId } from '../utils/chatUtils';
import { isStructuredContent } from '../utils/structureDetect';
import { Message, MessageAttachment } from '../types';
import { isRunningInTauri, downloadAndSaveFile } from '../lib/tauriBridge';
// 🆕 看门狗：NapCat 连接持续监控 + 双向检测 + 待发队列自动补发
import { startBotWatchdog, notifyInbound, markOutboundOk, markOutboundFail, queueFailedReply } from '../services/botWatchdog';
import { passesBotGating } from '../utils/botGating';

interface BotMessageEvent {
  integrationType: string;
  integrationId: string;
  userId: number | string;
  groupId: number | null;
  senderName: string;
  message: string;
  rawMessage: string | null;
  messageId: number | null;
  time: number | null;
  /** 🆕 消息是否 @ 了机器人（Rust 侧从 raw_message/message 数组解析，array 格式消息 rawMessage 可能为空） */
  hasAt?: boolean;
  attachments?: Array<{ type: string; url: string }>;
}

const processedMessageIds = new Set<string>();

/** 🔧 AstrBot 时间窗指纹去重（v4.23.6 同款方案，主闸）：
 *  clawbot 长轮询窗口重叠会把同一条消息重复投递 6~8 次，且各次投递的 time 字段可能漂移
 *  （create_time_ms 缺失时 Rust 用当下时间兜底）——所以主指纹不含 time：
 *  `${integrationId}:${userId}:${message原文}`，60 秒窗口内视为同一条消息。
 *  "重复已跳过"日志每个指纹只打一次（修复刷屏）。 */
const FINGERPRINT_TTL_MS = 15_000;
const recentFingerprints = new Map<string, number>();
const loggedSkipFingerprints = new Set<string>();

/** 🔧 内容指纹短窗去重：同 integration+用户+文本 5 秒内只处理一次
 *     （对付 NapCat 图片+文字拆条、客户端重试、重连窗口双报等 messageId 不同的内容级重复） */
const recentContentMap = new Map<string, number>();
const CONTENT_DEDUP_WINDOW_MS = 5000;

// 🆕 A1: 防抖窗口改从功能模块配置读取（botBehavior.sendDebounceMs）
function getBotDebounceMs(): number {
  const ms = useFeatureModuleStore.getState().botBehavior.sendDebounceMs;
  return Number.isFinite(ms) && ms >= 0 ? ms : 3000;
}
const pendingBotMessages = new Map<string, {
  timeout: ReturnType<typeof setTimeout>;
  messages: { text: string; attachments: MessageAttachment[]; timestamp: number; data: BotMessageEvent }[];
  conversationId: string;
}>();

// 🆕 修复"QQ 发消息等不到回复"：旧机制用全局 generation 计数，任何新消息 flush 都会使
//    进行中的 monitor 失效（AI 回复已生成却没人发送）。改为按会话注册持久 monitor：
//    同一会话后续消息只更新目标上下文，保留已发送集合防重复，直到空闲超时才退出。
const activeMonitors = new Map<string, {
  data: BotMessageEvent;
  userContent: string;
  sentIds: Set<string>;
  idleChecks: number;
  /** 🆕 等待首条 AI 回复的检查次数（AI 生成期间不占用空闲退出计时） */
  firstReplyChecks: number;
}>();

const MONITOR_CHECK_INTERVAL = 500;
/** 连续 2 分钟（240 × 500ms）无新 AI 回复则退出监控（仅适用于"已发过回复、等更多分段"阶段） */
const MONITOR_MAX_IDLE_CHECKS = 240;
/** 🆕 等待首条回复的看门狗：10 分钟（1200 × 500ms）——慢推理模型 + 多次重试可能远超 2 分钟，
 *  旧逻辑在 AI 生成期间就按空闲计时，超时杀掉监控 → "项目内生成成功但没有回复到外部平台" */
const FIRST_REPLY_MAX_CHECKS = 1200;

function registerMonitor(data: BotMessageEvent, conversationId: string, userContent: string) {
  const existing = activeMonitors.get(conversationId);
  if (existing) {
    existing.data = data;
    existing.userContent = userContent;
    existing.idleChecks = 0;
    existing.firstReplyChecks = 0;
    return;
  }
  activeMonitors.set(conversationId, { data, userContent, sentIds: new Set(), idleChecks: 0, firstReplyChecks: 0 });
  runMonitorLoop(conversationId);
}

function runMonitorLoop(conversationId: string) {
  const check = async () => {
    const state = activeMonitors.get(conversationId);
    if (!state) return;
    const { data, userContent, sentIds } = state;

    const latestConvs = useChatStore.getState().conversations;
    const conv = latestConvs.find(c => c.id === conversationId);
    if (!conv) {
      activeMonitors.delete(conversationId);
      return;
    }

    // 找到目标用户消息（从后往前按内容匹配；两侧 trim 防拼接差异）
    let userMsgIdx = -1;
    const targetContent = userContent.trim();
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].sender === 'user' && conv.messages[i].content?.trim() === targetContent) {
        userMsgIdx = i;
        break;
      }
    }

    // 🔧 修复"生成成功但没回复到外部平台"：AI 生成期间（目标用户消息已存在但还没有任何
    // 已发送回复）不占用空闲退出计时，改用 10 分钟看门狗——慢推理模型 + 方案E/连通性重试
    // 很容易超过旧的 2 分钟空闲上限，监控被提前杀掉后生成的回复就没人外发了。
    const hasSentAny = sentIds.size > 0;
    const bumpWaitFirstReply = (reason: string) => {
      state.firstReplyChecks++;
      if (state.firstReplyChecks > FIRST_REPLY_MAX_CHECKS) {
        console.warn('[BotHandler] 等待首条回复超时，停止监控:', conversationId);
        useDebugLog.getState().add('bot', `[Bot] 等待 AI 回复超过 10 分钟（${reason}），停止监控外发: ${data.senderName}`);
        void logBotMsg(data.integrationType, `等待回复超时，停止外发监控: ${data.senderName}`);
        activeMonitors.delete(conversationId);
      }
    };

    if (userMsgIdx !== -1) {
      const userMsgTimestamp = new Date(conv.messages[userMsgIdx].timestamp).getTime();
      // 🆕 空回复保护：内容为空的 AI 消息不发送（空回复 bug 修复点之一）
      const aiMsgs = conv.messages.filter(m => {
        if (m.sender !== 'ai' || !m.content?.trim()) return false;
        return new Date(m.timestamp).getTime() > userMsgTimestamp;
      });
      const unsent = aiMsgs.filter(m => !sentIds.has(m.id));

      if (unsent.length > 0) {
        state.idleChecks = 0;
        state.firstReplyChecks = 0;
        // 🆕 A1 智能合并模式：合并条件 = 开关开启 && 长度达标 && （结构化 || 未启用结构要求）
        const { botBehavior } = useFeatureModuleStore.getState();
        const totalChars = unsent.reduce((sum, m) => sum + m.content.length, 0);
        const joined = unsent.map(m => m.content).join('\n');
        const shouldMerge =
          botBehavior.mergeEnable &&
          totalChars >= (botBehavior.mergeThreshold || 150) &&
          (!botBehavior.mergeRequireStructure || isStructuredContent(joined));

        if (shouldMerge) {
          useDebugLog.getState().add('bot', `[Bot][合并判定] 字数=${totalChars} 阈值=${botBehavior.mergeThreshold} 结构化=${isStructuredContent(joined)} → 合并发送`);
          await sendMergedReply(data, unsent);
          unsent.forEach(m => sentIds.add(m.id));
        } else {
          for (const msg of unsent) {
            await sendSingleReply(data, msg);
            sentIds.add(msg.id);
          }
        }
      } else if (hasSentAny) {
        state.idleChecks++;
      } else {
        bumpWaitFirstReply('AI 生成中');
      }
    } else if (hasSentAny) {
      state.idleChecks++;
    } else {
      bumpWaitFirstReply('用户消息未落库');
    }

    if (state.idleChecks > MONITOR_MAX_IDLE_CHECKS) {
      console.warn('[BotHandler] Monitor idle timeout, stopping:', conversationId);
      logBotMsg(data.integrationType, `回复监控空闲超时退出: ${data.senderName}`);
      activeMonitors.delete(conversationId);
      return;
    }
    setTimeout(check, MONITOR_CHECK_INTERVAL);
  };

  setTimeout(check, 1000);
}

function stripCQCodes(text: string): string {
  return text.replace(/\[CQ:[^\]]*\]/g, '').trim();
}

function stripImagePlaceholders(text: string): string {
  return text
    .replace(/🖼/g, '')
    .replace(/\[图片\]/g, '')
    .replace(/\[视频\]/g, '')
    .replace(/\[表情\]/g, '')
    .replace(/\[语音\]/g, '')
    .replace(/image\.(jpg|jpeg|png|gif|webp|bmp)/gi, '')
    .replace(/video\.(mp4|webm|ogg)/gi, '')
    .replace(/audio\.(mp3|wav|ogg)/gi, '')
    .trim();
}

export function useBotMessageHandler() {
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useEffect(() => {
    const setup = async () => {
      unlistenRef.current = await listen<string>('bot-message-received', async (event) => {
        try {
          const data: BotMessageEvent = JSON.parse(event.payload);
          await handleBotMessage(data);
        } catch (e) {
          console.error('[BotHandler] Failed to process bot message:', e);
        }
      });
      // 🆕 看门狗：持续监控 NapCat 连接状态，断连期间回复入待发队列，重连自动补发
      void startBotWatchdog();
    };

    setup();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);
}

async function handleBotMessage(data: BotMessageEvent) {
  // 🔧 AstrBot 时间窗指纹去重（主闸，先于一切日志）：
  //    clawbot 长轮询窗口重叠会把同一条消息重复投递多次（真机实测 8 次），
  //    且各次投递的 time 字段可能漂移 → 指纹不含 time，60 秒窗口内只处理一次；
  //    "重复已跳过"日志每个指纹只打一次（修复跳过日志刷屏）。
  const nowMs = Date.now();
  const fingerprint = `${data.integrationId}:${data.userId}:${(data.message || '').trim()}`;
  for (const [k, ts] of recentFingerprints) {
    if (nowMs - ts > FINGERPRINT_TTL_MS) {
      recentFingerprints.delete(k);
      loggedSkipFingerprints.delete(k);
    }
  }
  if (recentFingerprints.has(fingerprint)) {
    console.log('[BotHandler] Duplicate fingerprint, skipping:', fingerprint);
    if (!loggedSkipFingerprints.has(fingerprint)) {
      loggedSkipFingerprints.add(fingerprint);
      useDebugLog.getState().add('bot', `[Bot] 重复消息（时间窗指纹命中，平台重复投递），已跳过: ${data.senderName}: ${(data.message || '').slice(0, 40)}`);
    }
    return;
  }
  recentFingerprints.set(fingerprint, nowMs);
  if (recentFingerprints.size > 500) {
    const first = recentFingerprints.keys().next().value;
    if (first !== undefined) recentFingerprints.delete(first);
  }

  // messageId 级去重（次闸，防"同 messageId 不同内容"与跨窗口重发）
  if (data.messageId) {
    const dedupKey = `${data.integrationId}:${data.userId}:mid:${data.messageId}`;
    if (processedMessageIds.has(dedupKey)) {
      console.log('[BotHandler] Duplicate message, skipping:', dedupKey);
      return;
    }
    processedMessageIds.add(dedupKey);
    if (processedMessageIds.size > 500) {
      const arr = Array.from(processedMessageIds);
      for (let i = 0; i < 250; i++) processedMessageIds.delete(arr[i]);
    }
  }

  // 🔧 群@修复：@ 检测提前到"空消息丢弃"之前。
  // 此前只 @ 不打字的消息清洗后为空被直接丢弃（"群@没反应"的根因之一）；
  // 且 array 格式消息 rawMessage 可能为空，仅靠它判断 @ 会漏，需结合 Rust 解析的 hasAt。
  const isMentionEvent = data.hasAt === true || (!!data.rawMessage && data.rawMessage.includes('[CQ:at,'));

  let cleanMessage = stripImagePlaceholders(stripCQCodes(data.message));
  const hasAttachments = data.attachments && data.attachments.length > 0;
  if (!cleanMessage && !hasAttachments) {
    if (data.groupId != null && isMentionEvent) {
      // 裸 @（未附带文字）：视为有效唤醒，注入提示文本后走正常回复流程
      cleanMessage = `[${data.senderName || '有人'} @了你（未附带文字）]`;
      console.log('[BotHandler] 裸@消息，注入提示:', cleanMessage);
      useDebugLog.getState().add('bot', '[Bot] 收到裸@消息（无文字），注入提示后继续处理');
    } else {
      console.log('[BotHandler] Empty message after stripping, skipping');
      useDebugLog.getState().add('bot', '[Bot] 消息清洗后为空，已跳过');
      return;
    }
  }

  console.log('[BotHandler] Processing:', cleanMessage);

  // 🔧 内容指纹短窗去重（仅在文本非空时生效）
  if (cleanMessage) {
    const contentFingerprint = `${data.integrationId}:${data.userId}:${cleanMessage}`;
    const nowMs = Date.now();
    const lastSeen = recentContentMap.get(contentFingerprint);
    if (lastSeen && nowMs - lastSeen < CONTENT_DEDUP_WINDOW_MS) {
      console.log('[BotHandler] Content duplicate within window, skipping:', contentFingerprint);
      useDebugLog.getState().add('bot', '[Bot] 5秒内重复相同内容，已跳过（防拆条/重发双处理）');
      return;
    }
    recentContentMap.set(contentFingerprint, nowMs);
    if (recentContentMap.size > 300) {
      for (const [k, ts] of recentContentMap) {
        if (nowMs - ts > CONTENT_DEDUP_WINDOW_MS) recentContentMap.delete(k);
      }
    }
  }

  // 🔧 修复#11：入口日志移到两道去重之后——只有真正进入处理链路的消息才打印"收到"，
  // 拆条/双报场景不再出现两条重复的传入消息日志
  useDebugLog.getState().add('bot', `[Bot] 收到${data.integrationType}消息: ${data.senderName}: ${(cleanMessage || (hasAttachments ? '[图片]' : '')).slice(0, 40)}${hasAttachments ? `（附件${data.attachments!.length}个）` : ''}`);

  const { integrations, addConversation, logBot } = useIntegrationStore.getState();
  // 🆕 A3: 处理前确保会话映射已加载（防止启动初期早到消息查不到映射而误建新会话）
  await useIntegrationStore.getState().ensureConversationsLoaded();

  const integration = integrations.find((i) => i.id === data.integrationId);
  if (!integration) {
    console.warn('[BotHandler] Integration not found:', data.integrationId);
    useDebugLog.getState().add('bot', `[Bot] 未找到接入记录 (${data.integrationType}:${data.integrationId})，消息已丢弃。请在接入管理中确认已启用`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: any;
  try {
    config = JSON.parse(integration.config || '{}');
  } catch (e) {
    console.error('[BotHandler] Failed to parse integration config:', e);
    useDebugLog.getState().add('bot', '[Bot] 接入配置解析失败，消息已丢弃');
    return;
  }
  if (!config.auto_reply) {
    console.log('[BotHandler] auto_reply is disabled');
    useDebugLog.getState().add('bot', '[Bot] 自动回复未开启，消息已跳过（接入管理中开启「自动回复」后消息才会进入会话）');
    return;
  }

  // 🔧 门控统一：群聊/私聊开关 + 黑白名单（与主动回复外发共用 botGating）
  const gating = passesBotGating(config, data.groupId != null ? String(data.groupId) : null, String(data.userId));
  if (!gating.allowed) {
    console.log('[BotHandler] 门控拦截:', gating.reason);
    useDebugLog.getState().add('bot', `[Bot] ${gating.reason}，消息已跳过`);
    return;
  }

  // 🆕 A4.2 群聊唤醒门控：mention_prefix 模式下，群消息仅 @机器人 或以唤醒前缀开头才进入回复流程
  // 🔧 @检测增强：优先使用 Rust 解析的 hasAt（array 格式消息 rawMessage 可能为空）
  if (data.groupId) {
    const { botBehavior } = useFeatureModuleStore.getState();
    if (botBehavior.wakeupMode === 'mention_prefix') {
      const prefix = botBehavior.wakeupPrefix || '/';
      const isMention = isMentionEvent;
      const hasPrefix = cleanMessage.startsWith(prefix);
      if (!isMention && !hasPrefix) {
        console.log('[BotHandler] 群消息未 @机器人 且无唤醒前缀，跳过');
        useDebugLog.getState().add('bot', '[Bot] 群消息未@机器人且无唤醒前缀，跳过');
        return;
      }
    }
  }

  // 🆕 A4.1 Bot 指令路由：唤醒前缀开头 → 本地执行，不进聊天管线、不触发 AI
  const { botBehavior } = useFeatureModuleStore.getState();
  if (botBehavior.commandEnabled && cleanMessage.startsWith(botBehavior.wakeupPrefix || '/')) {
    const { setBotCommandContext } = await import('../agent/tools/botTools');
    const { executeSlashCommand } = await import('../agent/slashCommand');
    const externalKey = data.groupId != null ? String(data.groupId) : String(data.userId);
    setBotCommandContext({
      integrationId: data.integrationId,
      externalUserId: String(data.userId),
      groupId: data.groupId != null ? String(data.groupId) : null,
      senderName: data.senderName || externalKey,
    });
    try {
      const resultText = await executeSlashCommand(cleanMessage);
      if (resultText) {
        const { sendBotReply } = await import('../lib/tauriBridge');
        await sendBotReply(
          data.integrationId,
          data.integrationType,
          String(data.userId),
          data.groupId != null ? String(data.groupId) : null,
          resultText,
        );
      }
      await logBot(data.integrationType, `指令已执行: ${cleanMessage}`);
    } catch (e) {
      console.error('[BotHandler] 指令执行失败:', e);
      await logBot(data.integrationType, `指令执行失败: ${e}`);
    } finally {
      setBotCommandContext(null);
    }
    return;
  }

  // 🆕 A4.2: 群会话按 group_id 维度隔离（群内共享一个会话），私聊按 user_id
  const extUserId = data.groupId != null ? String(data.groupId) : String(data.userId);
  // 🆕 A3: 会话映射从 store 最新状态读取（ensureConversationsLoaded 已保证加载完成）
  const conversations = useIntegrationStore.getState().conversations;
  const conv = conversations.find(
    (c) => c.integrationId === data.integrationId && c.externalUserId === extUserId
  );

  let conversationId: string;

  if (!conv) {
    const characterId = config.character_id || useCharacterStore.getState().selectedCharacterId || useCharacterStore.getState().characters[0]?.id || '';

    const id = generateId();
    const newConversation = {
      id,
      title: data.groupId != null ? `群 ${extUserId}` : (data.senderName || '外部对话'),
      messages: [] as Message[],
      characterId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    useChatStore.setState((state) => ({
      conversations: [newConversation, ...state.conversations],
      // 🆕 同步侧栏摘要列表，否则新微信会话在侧栏不可见
      conversationList: [newConversation, ...state.conversationList],
    }));

    conversationId = id;

    await addConversation(
      data.integrationId,
      extUserId,
      data.senderName,
      characterId,
      conversationId,
      // 🆕 群会话记录群ID（供主动回复路由到群聊）
      data.groupId != null ? String(data.groupId) : null
    );
    await logBot(data.integrationType, `新会话: ${data.senderName}`);
  } else {
    conversationId = conv.conversationId;
  }

  await logBot(data.integrationType, `收到消息: ${data.senderName}: ${cleanMessage}`);

  const botAttachments: MessageAttachment[] = [];
  const rawAttachments = data.attachments || [];
  for (const a of rawAttachments) {
    if (!a.url) continue;

    const attId = generateId();
    let attType: MessageAttachment['type'] = 'file';
    if (a.type === 'image') attType = 'image';
    else if (a.type === 'video') attType = 'video';
    else if (a.type === 'audio') attType = 'audio';

    let filePath = a.url;
    let fileId: string | undefined;

    // 🔧 修复#10：改用 Rust 侧 download_and_save_file（reqwest，无 CORS 限制）——
    //   旧 webview fetch 外部 CDN 常被反盗链/CORS 拦截 → 下载失败 → 只存过期即失效的
    //   签名 URL（"刷新后图片消失"的根因）。Rust 下载入库后：
    //   · SQLite files 表持久化 → 刷新不丢；
    //   · content_hash 去重 → NapCat 拆条双报同一张图只存一份（治"一次显示两张"）。
    if (isRunningInTauri()) {
      try {
        const urlPath = a.url.split('?')[0];
        const ext = urlPath.split('.').pop()?.split('/')[0] || 'bin';
        const filename = `${attType}_${Date.now()}_${attId}.${ext.length <= 5 ? ext : 'bin'}`;
        const savedId = await downloadAndSaveFile(a.url, filename);
        if (savedId) {
          fileId = savedId;
          filePath = `db:${savedId}`;
        } else {
          console.warn('[BotHandler] Rust 下载失败（返回空），保留原 URL:', a.url);
        }
      } catch (e) {
        console.warn('[BotHandler] Rust 下载异常:', e, a.url);
      }
    }

    botAttachments.push({
      id: attId,
      type: attType,
      name: a.type || attType,
      path: filePath,
      size: 0,
      mimeType: attType === 'image' ? 'image/jpeg' : attType === 'video' ? 'video/mp4' : attType === 'audio' ? 'audio/mpeg' : 'application/octet-stream',
      fileId,
    });
  }

  // 🔧 非图片附件（文件等）以占位注入文本，让 AI 能感知并"读取"文件信息（图片走 attachments 真实识别）
  const fileNames = botAttachments
    .filter(a => a.type === 'file')
    .map(a => `[文件: ${a.name}]`)
    .join(' ');
  const textForAI = [cleanMessage, fileNames].filter(Boolean).join('\n');

  // 🆕 A4.2: 防抖键与群会话隔离键一致（群按 group，私聊按 user）
  const debounceKey = `${data.integrationId}:${extUserId}`;
  const newMsg = {
    text: textForAI,
    attachments: botAttachments,
    timestamp: Date.now(),
    data,
  };

  const existing = pendingBotMessages.get(debounceKey);
  if (existing) {
    clearTimeout(existing.timeout);
    existing.messages.push(newMsg);
    existing.timeout = setTimeout(() => {
      flushPendingBotMessages(debounceKey);
    }, getBotDebounceMs());
    return;
  }

  const timeout = setTimeout(() => {
    flushPendingBotMessages(debounceKey);
  }, getBotDebounceMs());
  pendingBotMessages.set(debounceKey, { timeout, messages: [newMsg], conversationId });
}

function flushPendingBotMessages(key: string) {
  const pending = pendingBotMessages.get(key);
  if (!pending || pending.messages.length === 0) {
    pendingBotMessages.delete(key);
    return;
  }

  const combinedText = pending.messages.map(m => m.text).filter(Boolean).join('\n');
  // 🔧 修复#10"一次显示两张"：拆条/双报的同一张图（同 path）在合并时去重
  const seenPaths = new Set<string>();
  const allAttachments = pending.messages.flatMap(m => m.attachments).filter(Boolean)
    .filter((a) => {
      if (seenPaths.has(a.path)) return false;
      seenPaths.add(a.path);
      return true;
    });
  const lastData = pending.messages[pending.messages.length - 1].data;
  const convId = pending.conversationId;

  pendingBotMessages.delete(key);

  if (!combinedText && allAttachments.length === 0) return;

  useChatStore.getState().sendMessage(
    combinedText,
    allAttachments.length > 0 ? allAttachments : undefined,
    convId
  );

  registerMonitor(lastData, convId, combinedText);
  // 🆕 看门狗：入站消息 = 下行链路活跃 → 标记在线并立即补发待发队列（任意一端发送消息自动恢复）
  notifyInbound(lastData.integrationId);
}

async function logBotMsg(type: string, msg: string) {
  const { logBot } = useIntegrationStore.getState();
  await logBot(type, msg);
}

/** 🆕 发送失败自动重试一次（1s 后），避免偶发 IPC/网络错误导致用户等不到回复 */
async function sendBotReplyWithRetry(
  integrationId: string,
  integrationType: string,
  userId: string,
  groupId: string | null,
  text: string,
) {
  const { sendBotReply } = await import('../lib/tauriBridge');
  try {
    await sendBotReply(integrationId, integrationType, userId, groupId, text);
  } catch (e) {
    console.warn('[BotHandler] send failed, retrying in 1s:', e);
    await new Promise(r => setTimeout(r, 1000));
    await sendBotReply(integrationId, integrationType, userId, groupId, text);
  }
}

async function sendMergedReply(data: BotMessageEvent, aiMsgs: Message[]) {
  const segments: string[] = [];
  for (const msg of aiMsgs) {
    segments.push(msg.content);
    if (msg.attachments) {
      for (const att of msg.attachments) {
        if (att.type === 'image' && att.path) {
          if (att.path.startsWith('http://') || att.path.startsWith('https://')) {
            segments.push(`[CQ:image,file=${att.path}]`);
          }
        }
      }
    }
  }
  // 🆕 #2 点歌工具：本轮 AI 触发了点歌 → 追加 OneBot 原生音乐分享卡片（QQ/微信内可点击试听）
  const { consumeMusicCard } = await import('../services/agent/musicBridge');
  const musicCard = consumeMusicCard();
  if (musicCard) segments.push(musicCard);
  const fullReply = segments.join('\n');
  // 🆕 空回复保护：合并后仍为空则不发送
  if (!fullReply.trim()) {
    console.warn('[BotHandler] Merged reply is empty, skipping send');
    return;
  }

  try {
    // 🆕 统一回复路径：Rust 侧按 integrationType 分发（含 qq_official/clawbot 新类型）
    await sendBotReplyWithRetry(
      data.integrationId,
      data.integrationType,
      String(data.userId),
      data.groupId != null ? String(data.groupId) : null,
      fullReply,
    );
    await logBotMsg(data.integrationType, `合并回复已发送: ${data.senderName} (${aiMsgs.length}段, ${fullReply.length}字)`);
    markOutboundOk(data.integrationId);
  } catch (e) {
    console.error('[BotHandler] Failed to send merged reply:', e);
    markOutboundFail(data.integrationId);
    queueFailedReply({
      integrationId: data.integrationId,
      integrationType: data.integrationType,
      userId: String(data.userId),
      groupId: data.groupId != null ? String(data.groupId) : null,
      text: fullReply,
    });
    useDebugLog.getState().add('bot', `[Bot] 外发失败（合并回复）: ${e instanceof Error ? e.message : String(e)}——已加入待发队列，链路恢复后自动补发`);
    await logBotMsg(data.integrationType, `回复失败: ${e}`);
  }
}

async function sendSingleReply(data: BotMessageEvent, msg: Message) {
  const parts: string[] = [];
  if (msg.content) {
    parts.push(msg.content);
  }
  if (msg.attachments) {
    for (const att of msg.attachments) {
      if (att.type === 'image' && att.path && (att.path.startsWith('http://') || att.path.startsWith('https://'))) {
        parts.push(`[CQ:image,file=${att.path}]`);
      }
    }
  }
  // 🆕 #2 点歌工具：本轮 AI 触发了点歌 → 追加 OneBot 原生音乐分享卡片
  const { consumeMusicCard } = await import('../services/agent/musicBridge');
  const musicCard = consumeMusicCard();
  if (musicCard) parts.push(musicCard);
  const text = parts.join('\n');
  if (!text) return;

  try {
    // 🆕 统一回复路径：Rust 侧按 integrationType 分发（含 qq_official/clawbot 新类型）
    await sendBotReplyWithRetry(
      data.integrationId,
      data.integrationType,
      String(data.userId),
      data.groupId != null ? String(data.groupId) : null,
      text,
    );
    await logBotMsg(data.integrationType, `分段回复已发送: ${data.senderName}`);
    markOutboundOk(data.integrationId);
  } catch (e) {
    console.error('[BotHandler] Failed to send reply:', e);
    markOutboundFail(data.integrationId);
    queueFailedReply({
      integrationId: data.integrationId,
      integrationType: data.integrationType,
      userId: String(data.userId),
      groupId: data.groupId != null ? String(data.groupId) : null,
      text,
    });
    useDebugLog.getState().add('bot', `[Bot] 外发失败（分段回复）: ${e instanceof Error ? e.message : String(e)}——已加入待发队列，链路恢复后自动补发`);
    await logBotMsg(data.integrationType, `回复失败: ${e}`);
  }
}

