import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Conversation, Message, EmotionRecord, EmotionType, MemoryEntry, MemoryCategory, MessageAttachment } from '../types';
import { generateId } from '../utils/chatUtils';
import { analyzeEmotion } from '../utils/emotionAnalyzer';
import { callAI, callAIStream, getSystemPrompt, getConfig, extractMemories, analyzeCharacterEmotion, generateReflection, analyzeAffinityChange, generateConversationSummary, generateThinking, generateAnalysis, generateReflectionEntry, getAdaptiveTemperature, isDuplicate, containsAICliche, detectPersonaCollapse, detectInjection, getDiversityPrompt, analyzeUserStyle, analyzeMessageImportance, adviseReplyLength, selectRelevantMemories, generateEmbedding, addMemoryEmbeddings, vectorSearchMemories } from '../services/aiService';
import { saveConversations, loadConversations, saveEmotionRecords, loadEmotionRecords } from './chatStorage';
import { dbClearAllData, dbClearConversations, dbClearEmotionRecords, dbClearMemories, dbClearReflections, readFileAsBase64, getFileDataOnly } from '../lib/tauriBridge';
import { useCharacterStore } from './characterStore';
import { useCharacterMindStore } from './characterMindStore';
import { useMemoryStore } from './memoryStore';
import { useDebugLog } from './debugLogStore';
import { useRecycleBinStore } from './recycleBinStore';
import { useModelRoleStore } from './modelRoleStore';
import { useMemoryAnalysisStore } from './memoryAnalysisStore';
import { useLearningStore } from './learningStore';
import { useLearningConfigStore } from './learningConfigStore';
import { useUserProfileStore } from './userProfileStore';
import { splitIntoSegments, processMessageText } from '../utils/segmentUtils';
import { OutputPipeline, PipelineContext } from '../services/outputPipeline';

// Batch queue for background API tasks
type BackgroundTask = () => Promise<void>;
const backgroundQueue: BackgroundTask[] = [];
let isProcessingQueue = false;
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 2000;

async function processBackgroundQueue(): Promise<void> {
  if (isProcessingQueue || backgroundQueue.length === 0) return;
  isProcessingQueue = true;

  while (backgroundQueue.length > 0) {
    const batch = backgroundQueue.splice(0, BATCH_SIZE);
    console.log(`[BackgroundQueue] 执行批次: ${batch.length}个任务, 剩余${backgroundQueue.length}个`);
    
    await Promise.allSettled(batch.map(task => task()));
    
    if (backgroundQueue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  isProcessingQueue = false;
}

function enqueueBackgroundTask(task: BackgroundTask): void {
  backgroundQueue.push(task);
  processBackgroundQueue();
}

interface ChatState {
  conversations: Conversation[];
  currentConversationId: string | null;
  isTyping: boolean;
  currentEmotion: EmotionType;
  emotionIntensity: number;
  emotionRecords: EmotionRecord[];
  apiError: string | null;
  isLoaded: boolean;
  _queuedContent: string;
  _skipMessageAdd: boolean;
  _skipFirstReplyDelay: boolean;

  setCurrentConversation: (id: string) => void;
  createNewConversation: (characterId: string) => string;
  createTestConversation: () => string;
  sendMessage: (content: string, attachments?: MessageAttachment[], targetConversationId?: string) => void;
  addUserMessageOnly: (content: string, attachments?: MessageAttachment[], applyDelay?: boolean) => Promise<void>;
  processQueuedUserMessages: () => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  updateEmotion: (emotion: EmotionType, intensity: number, context: string) => void;
  setIsTyping: (isTyping: boolean) => void;
  clearApiError: () => void;
  clearAllData: () => void;
  clearConversations: () => void;
  clearEmotionRecords: () => void;
  clearMemoriesAndReflections: () => void;
  loadInitialData: () => Promise<void>;
}

async function persistConversations(conversations: Conversation[]) {
  try {
    await saveConversations(conversations);
  } catch (e) {
    console.error('Failed to save conversations:', e);
  }
}

async function persistEmotionRecords(records: EmotionRecord[]) {
  try {
    await saveEmotionRecords(records);
  } catch (e) {
    console.error('Failed to save emotion records:', e);
  }
}

export const useChatStore = create<ChatState>()(
  subscribeWithSelector((set, get) => ({
  conversations: [],
  currentConversationId: null,
  isTyping: false,
  currentEmotion: 'neutral',
  emotionIntensity: 0,
  emotionRecords: [],
  apiError: null,
  isLoaded: false,
  _queuedContent: '',
  _skipMessageAdd: false,
  _skipFirstReplyDelay: true,

  loadInitialData: async () => {
    try {
      const [conversations, emotionRecords] = await Promise.all([
        loadConversations(),
        loadEmotionRecords(),
      ]);
      set({ conversations, emotionRecords, isLoaded: true });
    } catch (e) {
      console.error('Failed to load initial data:', e);
      set({ isLoaded: true });
    }
  },

  setCurrentConversation: (id: string) => {
    set({ currentConversationId: id });
  },

  createNewConversation: (characterId: string) => {
    const id = generateId();
    const characters = useCharacterStore.getState().characters;
    const character = characters.find(c => c.id === characterId);
    const greetingMessage: Message = {
      id: generateId(),
      content: character?.greetingMessage || '你好，有什么可以帮你的吗？',
      sender: 'ai',
      timestamp: new Date(),
      emotion: 'neutral',
    };

    const newConversation: Conversation = {
      id,
      title: character?.name || '新对话',
      messages: [greetingMessage],
      characterId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    set((state) => {
      const updated = [newConversation, ...state.conversations];
      return {
        conversations: updated,
        currentConversationId: id,
      };
    });

    return id;
  },

  createTestConversation: () => {
    const id = generateId();
    const greetingMessage: Message = {
      id: generateId(),
      content: '测试模式已开启，发送消息将直接回显，不调用 AI。',
      sender: 'ai',
      timestamp: new Date(),
      emotion: 'neutral',
    };

    const newConversation: Conversation = {
      id,
      title: '测试对话',
      messages: [greetingMessage],
      characterId: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      testMode: true,
    };

    set((state) => {
      const updated = [newConversation, ...state.conversations];
      return {
        conversations: updated,
        currentConversationId: id,
      };
    });

    return id;
  },

  sendMessage: async (content: string, attachments?: MessageAttachment[], targetConversationId?: string) => {
    const { conversations } = get();
    const activeConversationId = targetConversationId || get().currentConversationId;
    if (!activeConversationId) return;

    // Allow empty content if there are attachments (e.g. image-only message)
    const hasText = content && content.trim().length > 0;
    const hasAttachments = attachments && attachments.length > 0;
    if (!hasText && !hasAttachments) {
      console.warn('[sendMessage] Empty content and no attachments, skipping');
      return;
    }

    // Test mode: echo back without AI — complete isolation, no global state touched
    const testConv = conversations.find(c => c.id === activeConversationId);
    if (testConv?.testMode) {
      const userMsg: Message = {
        id: generateId(),
        content: content.trim(),
        sender: 'user' as const,
        timestamp: new Date(),
        attachments,
      };
      const echoReply: Message = {
        id: generateId(),
        content: `[测试回显] ${content}`,
        sender: 'ai',
        timestamp: new Date(),
        emotion: 'neutral',
      };
      set((state) => ({
        conversations: state.conversations.map(conv =>
          conv.id === activeConversationId
            ? { ...conv, messages: [...conv.messages, userMsg, echoReply], updatedAt: new Date() }
            : conv
        ),
      }));
      return;
    }

    // Verify the conversation exists — it might have been deleted
    const conversationExists = conversations.some(c => c.id === activeConversationId);
    if (!conversationExists) {
      console.error('[sendMessage] Conversation not found:', activeConversationId);
      throw new Error('对话不存在，可能已被删除');
    }

    const config = getConfig();
    const hasApiKey = !!config.apiKey;

    // Skip adding messages if already added by addUserMessageOnly
    const skipAdd = get()._skipMessageAdd;

    const MSG_SEPARATOR = '\n---\n';
    const parts = content.includes(MSG_SEPARATOR) ? content.split(MSG_SEPARATOR) : [content];

    const userMessages: Message[] = skipAdd ? [] : parts.map(part => ({
      id: generateId(),
      content: part.trim(),
      sender: 'user' as const,
      timestamp: new Date(),
      attachments: undefined,
    }));
    // First message gets the attachments; if content is empty, use placeholder text
    if (!skipAdd) {
      userMessages[0].attachments = attachments;
      if (!userMessages[0].content && hasAttachments) {
        userMessages[0].content = `[发送了 ${attachments!.length} 个附件]`;
      }
    }

    // Always show user messages in chat (purely local, no API needed)
    if (!skipAdd) {
      set((state) => {
        const updatedConversations = state.conversations.map(conv => {
              if (conv.id === activeConversationId) {
                return {
                  ...conv,
                  messages: [...conv.messages, ...userMessages],
                  updatedAt: new Date(),
                };
              }
              return conv;
            });
          return {
            isTyping: !!hasApiKey,
            currentEmotion: 'neutral' as EmotionType,
            emotionIntensity: 50,
            apiError: null,
            conversations: updatedConversations,
          };
        });
    } else {
      // Messages already added — just set isTyping if AI will reply
      set({ isTyping: !!hasApiKey, apiError: null });
    }

    // Block AI processing when no API key configured (platform adapter disconnected)
    if (!hasApiKey) {
      set({ apiError: '请先配置 API Key 后再发送消息' });
      return;
    }

    // Emotion analysis + smoothing
    let emotion: EmotionType = 'neutral';
    let intensity = 50;
    try {
      const effectiveContent = content || userMessages[0]?.content || '(用户发送了附件)';
      const rawResult = await analyzeEmotion(effectiveContent);
      const rawEmotion = rawResult.emotion;
      const rawIntensity = rawResult.intensity;

      // --- Emotion smoothing: don't jump unless strong trigger ---
      const STRONG_TRIGGERS = /(气死|气炸|开心死|太开心|哭死|难过死|绝望|崩溃|爱你|想你|讨厌你|滚|分手|再见)/;
      const hasStrongTrigger = STRONG_TRIGGERS.test(effectiveContent);

      // Read previous character emotion (from characterMindStore)
      const conv = get().conversations.find(c => c.id === activeConversationId);
      const smoothingCharId = conv?.characterId || '';
      let smoothedEmotion = rawEmotion;
      let smoothedIntensity = rawIntensity;

      if (smoothingCharId) {
        const prevCharEmotion = useCharacterMindStore.getState().getEmotion(smoothingCharId);
        if (!hasStrongTrigger && prevCharEmotion.emotion !== rawEmotion) {
          // No strong trigger but emotion changed → keep previous, decay intensity
          smoothedEmotion = prevCharEmotion.emotion;
          smoothedIntensity = Math.max(30, prevCharEmotion.intensity - 10);
        }
      }

      emotion = smoothedEmotion;
      intensity = smoothedIntensity;

      const newRecord: EmotionRecord = {
        id: generateId(),
        emotion,
        intensity,
        timestamp: new Date(),
        context: content,
        characterId: smoothingCharId || undefined,
      };

      set((state) => {
        const updatedRecords = [newRecord, ...state.emotionRecords].slice(0, 100);
        const userMsgIds = new Set(userMessages.map(m => m.id));
        return {
          currentEmotion: emotion,
          emotionIntensity: intensity,
          emotionRecords: updatedRecords,
          conversations: state.conversations.map(conv => {
            if (conv.id === activeConversationId) {
              return {
                ...conv,
                messages: conv.messages.map(m =>
                  userMsgIds.has(m.id) ? { ...m, emotion, emotionIntensity: intensity } : m
                ),
              };
            }
            return conv;
          }),
        };
      });
    } catch {
      // If emotion analysis fails, keep defaults
    }

    // Re-read conversation from LATEST state (after user message added)
    let conversation = get().conversations.find(c => c.id === activeConversationId);
    let convMsgs = conversation?.messages || [];
    let convLen = convMsgs.length;

    // Injection detection on user input
    if (hasApiKey && detectInjection(content)) {
      console.warn('[Injection detected] Input flagged:', content.slice(0, 50));
      useDebugLog.getState().add('injection', `用户输入被标记: ${content.slice(0, 30)}`, { characterId: conversation?.characterId, conversationId: activeConversationId });
    }

    // Immediately save user message as a "user_message" memory entry
    if (conversation?.characterId) {
      const charName = useCharacterStore.getState().characters.find(c => c.id === conversation.characterId)?.name || '';

      const userEntry: MemoryEntry = {
        id: generateId(),
        characterId: conversation.characterId,
        conversationId: activeConversationId,
        category: 'user_message' as MemoryCategory,
        title: content.length > 20 ? content.slice(0, 20) + '...' : content,
        content: content,
        tags: ['用户消息'],
        importance: 3,
        createdAt: new Date(),
      };
      useMemoryStore.getState().addEntry(userEntry);
      useDebugLog.getState().add('memory', `用户消息记忆已保存: ${content.slice(0, 30)}`, { characterId: conversation.characterId, conversationId: activeConversationId });

      const importanceModels = useModelRoleStore.getState().assignments.user_message_importance || [];
      if (importanceModels.length > 0 && hasApiKey) {
        analyzeMessageImportance(content, charName).then(importance => {
          useMemoryStore.getState().updateEntryImportance(userEntry.id, importance);
        }).catch(() => {});
      }
    }

    try {
      let aiReply: string;
      const streamEnabled = isStreamEnabled();

      const characters = useCharacterStore.getState().characters;
      const character = characters.find(c => c.id === conversation?.characterId);
      const { messageProcessingConfig } = useModelRoleStore.getState();

      // Default affinity stage (will be updated inside hasApiKey block if available)
      let affinityStage: string | undefined = 'stranger';

      if (hasApiKey) {
        const mindStore = useCharacterMindStore.getState();
        await mindStore.loadMind(character?.id || '');
        const memories = mindStore.getMemories(character?.id || '');
        const reflections = mindStore.getReflections(character?.id || '');
        const charEmotion = mindStore.getEmotion(character?.id || '');

        const memStore = useMemoryStore.getState();
        const memoryEntries = memStore.getEntries(character?.id || '');

        // --- Memory relevance filtering ---
        let relevantMemories = selectRelevantMemories(memories, content, 3);

        // --- Vector search (non-blocking, use result if available) ---
        if (character && hasApiKey && memories.length > 0) {
          enqueueBackgroundTask(async () => {
            try {
              await addMemoryEmbeddings(character.id, memories);
            } catch {}
          });
          generateEmbedding(content).then(queryEmb => {
            if (queryEmb) {
              const vecResults = vectorSearchMemories(character.id, queryEmb, 3, memories);
              if (vecResults.length > 0) {
                relevantMemories = vecResults;
              }
            }
          }).catch(() => {});
        }

        // --- Get affinity stage ---
        const affinityState = character ? mindStore.getAffinity(character.id) : undefined;
        const affinityStage = affinityState?.stage;

        const buildMessageContent = async (msg: Message): Promise<string | Array<{ type: string; text?: string; image_url?: { url: string } }>> => {
          try {
            if (msg.sender === 'ai' || !msg.attachments || msg.attachments.length === 0) {
              return msg.content;
            }
            const imageAtts = msg.attachments.filter(a => a.type === 'image');
            if (imageAtts.length === 0) return msg.content;

            const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
            parts.push({ type: 'text', text: msg.content || '(用户发送了图片)' });
            for (const att of imageAtts) {
              let dataUrl = '';

              // Priority 1: DB-backed file (saved locally by botHandler)
              if (att.fileId) {
                const b64 = await getFileDataOnly(att.fileId);
                if (b64) {
                  dataUrl = `data:${att.mimeType || 'image/jpeg'};base64,${b64}`;
                }
              }

              // Priority 2: HTTP(S) URL — try downloading via Rust backend first (no CORS),
              // fall back to direct fetch if Rust backend is unavailable
              if (!dataUrl && (att.path.startsWith('http://') || att.path.startsWith('https://'))) {
                try {
                  const { downloadAndSaveFile, readFileAsBase64 } = await import('../lib/tauriBridge');
                  const localPath = await downloadAndSaveFile(att.path, `image_${Date.now()}.jpg`);
                  if (localPath) {
                    const b64 = await readFileAsBase64(localPath);
                    if (b64) {
                      dataUrl = `data:${att.mimeType || 'image/jpeg'};base64,${b64}`;
                    }
                  }
                } catch {
                  // Rust backend unavailable, try direct fetch (may fail due to CORS)
                  try {
                    const imgResp = await fetch(att.path, { signal: AbortSignal.timeout(10000) });
                    if (imgResp.ok) {
                      const blob = await imgResp.blob();
                      const buffer = await blob.arrayBuffer();
                      const b64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                      dataUrl = `data:${blob.type || att.mimeType || 'image/jpeg'};base64,${b64}`;
                    }
                  } catch {
                    console.warn('[buildMessageContent] Failed to download image for AI:', att.path);
                  }
                }
              }

              // Priority 3: Direct data:/blob: URLs
              if (!dataUrl && (att.path.startsWith('data:') || att.path.startsWith('blob:'))) {
                dataUrl = att.path;
              }

              // Priority 4: Legacy local file path
              if (!dataUrl) {
                try {
                  const base64 = await Promise.race([
                    readFileAsBase64(att.path),
                    new Promise<string>((resolve) => setTimeout(() => resolve(''), 5000)),
                  ]);
                  if (base64) {
                    dataUrl = `data:${att.mimeType || 'image/jpeg'};base64,${base64}`;
                  }
                } catch { /* ignore */ }
              }
              if (dataUrl) {
                parts.push({ type: 'image_url', image_url: { url: dataUrl } });
              }
            }
            if (parts.length === 0) return msg.content || '(用户发送了图片)';
            return parts;
          } catch (e) {
            console.warn('[buildMessageContent] Failed, falling back to text:', e);
            return msg.content || '(用户发送了图片)';
          }
        };

        const messages = (await Promise.all(
          convMsgs.map(async (msg) => ({
            role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
            content: await buildMessageContent(msg),
          }))
        )).filter(m => {
          if (typeof m.content === 'string') return m.content.trim().length > 0;
          if (Array.isArray(m.content)) return m.content.some(p => p.type === 'text' && p.text?.trim());
          return true;
        });

        // Ensure there's at least one user message in the API request.
        // This is critical for external bot messages (napcat etc.) where
        // the conversation may not have the user message properly synced.
        const hasUserMessage = messages.some(m => m.role === 'user');
        if (!hasUserMessage && content.trim()) {
          messages.push({ role: 'user' as const, content: content.trim() });
        }

        // Dynamic re-anchoring every 15 messages
        const reanchorPrompt = (convLen > 0 && convLen % 15 === 0 && character)
          ? `\n\n[提醒] ${convLen}轮对话过去了，请确认你仍然是${character.name}，保持${character.personality}的性格底色。不要因为对话变长而改变自己的本质。`
          : '';

        const diversityPrompt = getDiversityPrompt(convLen);

        // Get multi-dimensional emotion state
        const multiEmotionState = character ? useCharacterMindStore.getState().getMultiEmotion(character.id) : undefined;

        // Get full affinity state for system prompt
        const fullAffinityState = affinityState ? {
          level: affinityState.level,
          stage: affinityState.stage,
          history: affinityState.history || [],
          lastInteraction: affinityState.lastInteraction,
        } : undefined;

        const systemPrompt = getSystemPrompt(character, relevantMemories, reflections, charEmotion, memoryEntries, affinityStage, multiEmotionState, fullAffinityState)
          + reanchorPrompt + diversityPrompt
          + useUserProfileStore.getState().getUserPrompt();

        // --- Inject filtered memories into messages (as "之前聊过" context) ---
        const messagesWithMemory = [...messages];
        if (relevantMemories.length > 0) {
          const memoryText = relevantMemories
            .map(m => `之前聊过：${m.content}`)
            .join('\n');
          messagesWithMemory.unshift({
            role: 'assistant' as const,
            content: memoryText,
          });
        }
        if (reflections.length > 0) {
          const topReflection = reflections[0];
          messagesWithMemory.unshift({
            role: 'assistant' as const,
            content: `我之前想过：${topReflection.insight}`,
          });
        }

        const temperature = getAdaptiveTemperature(convLen);

        // Get recent AI replies for duplication check — use LATEST state
        const latestConv = get().conversations.find(c => c.id === activeConversationId);
        const recentAiReplies = (latestConv?.messages || [])
          .filter(m => m.sender === 'ai')
          .slice(-5)
          .map(m => m.content);

        useDebugLog.getState().add('system', `开始生成 | 对话${convLen}轮 | 温度${temperature} | 历史AI回复${recentAiReplies.length}条`, { characterId: character?.id, conversationId: activeConversationId });

        if (streamEnabled) {
          // ===== Streaming mode: show tokens as they arrive =====
          const maxStreamRetries = 2;
          let streamAttempt = 0;

          const doStreamReply = async (): Promise<void> => {
            // Reply delay (simulated thinking time) — skip for first reply
            const streamSegConfig = getSegmentedConfig();
            const skipDelay = get()._skipFirstReplyDelay;
            if (skipDelay) {
              set({ _skipFirstReplyDelay: false });
            } else if (streamSegConfig.replyDelay > 0 || (streamSegConfig.replyDelayRandomEnabled && streamSegConfig.replyDelayRandom > 0)) {
              const totalDelay = streamSegConfig.replyDelay + (streamSegConfig.replyDelayRandomEnabled ? Math.random() * streamSegConfig.replyDelayRandom : 0);
              await new Promise(resolve => setTimeout(resolve, totalDelay));
            }

            const aiMsgId = generateId();
            const baseTime = new Date();
            let streamedContent = '';

            // Add placeholder message for streaming
            const placeholderMsg: Message = {
              id: aiMsgId,
              content: '',
              sender: 'ai',
              timestamp: baseTime,
              emotion: 'neutral',
            };

            set((state) => {
              const updatedConversations = state.conversations.map(conv => {
                if (conv.id === activeConversationId) {
                  return {
                    ...conv,
                    messages: [...conv.messages, placeholderMsg],
                    updatedAt: new Date(),
                  };
                }
                return conv;
              });
              return {
                conversations: updatedConversations,
                isTyping: true,
              };
            });

            try {
              aiReply = await callAIStream(messagesWithMemory, systemPrompt, getAdaptiveMaxTokens(convLen), temperature, {
                onToken: (token: string) => {
                  streamedContent += token;
                  set((state) => {
                    const updatedConversations = state.conversations.map(conv => {
                      if (conv.id === activeConversationId) {
                        return {
                          ...conv,
                          messages: conv.messages.map(m =>
                            m.id === aiMsgId ? { ...m, content: streamedContent } : m
                          ),
                          updatedAt: new Date(),
                        };
                      }
                      return conv;
                    });
                    return { conversations: updatedConversations };
                  });
                },
                onComplete: (fullText: string) => {
                  streamedContent = fullText;
                },
                onError: (error: Error) => {
                  console.error('[sendMessage] Stream error:', error.message);
                },
              });
            } catch (streamErr) {
              const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
              console.error('[sendMessage] Stream failed:', errMsg);
              set((state) => {
                const updatedConversations = state.conversations.map(conv => {
                  if (conv.id === activeConversationId) {
                    return {
                      ...conv,
                      messages: conv.messages.filter(m => m.id !== aiMsgId),
                      updatedAt: new Date(),
                    };
                  }
                  return conv;
                });
                return { conversations: updatedConversations, isTyping: false };
              });
              throw streamErr;
            }

            useDebugLog.getState().add('reply', `流式回复完成: ${aiReply.slice(0, 40)}...`, { characterId: character?.id, conversationId: activeConversationId });

            // Apply message post-processing via OutputPipeline
            const recentAiRepliesForStreamPipeline = (get().conversations.find(c => c.id === activeConversationId)?.messages || [])
              .filter(m => m.sender === 'ai')
              .slice(-5)
              .map(m => m.content);

            const streamPipelineCtx: PipelineContext = {
              rawText: aiReply,
              processedText: aiReply,
              emotion: { type: emotion, intensity },
              recentReplies: recentAiRepliesForStreamPipeline,
              userInput: content,
              affinityStage: affinityStage || 'stranger',
              forbiddenText: character?.forbiddenBehaviors,
              interceptConfig: messageProcessingConfig,
            };

            const streamPipeline = new OutputPipeline();
            let streamPipelineResult = streamPipeline.run(streamPipelineCtx);

            for (const log of streamPipelineResult.logs) {
              useDebugLog.getState().add('system', `[流式] ${log}`, { characterId: character?.id, conversationId: activeConversationId });
            }

            // If aborted, auto-retry
            if (streamPipelineResult.aborted) {
              useDebugLog.getState().add('intercept', `[流式] Pipeline 拦截 (${streamAttempt + 1}/${maxStreamRetries + 1}): ${streamPipelineResult.abortReason}`, { characterId: character?.id, conversationId: activeConversationId });

              // Remove placeholder
              set((state) => {
                const updatedConversations = state.conversations.map(conv => {
                  if (conv.id === activeConversationId) {
                    return {
                      ...conv,
                      messages: conv.messages.filter(m => m.id !== aiMsgId),
                      updatedAt: new Date(),
                    };
                  }
                  return conv;
                });
                return { conversations: updatedConversations };
              });

              streamAttempt++;
              if (streamAttempt <= maxStreamRetries) {
                useDebugLog.getState().add('system', `[流式] 第${streamAttempt}次重试...`, { characterId: character?.id, conversationId: activeConversationId });
                return doStreamReply();
              } else {
                set({ isTyping: false });
                return;
              }
            }

            // Pipeline passed, send segments
            const streamSegments = streamPipelineResult.segments;

            if (streamSegments && streamSegments.length > 1) {
              useDebugLog.getState().add('system', `流式分段回复 (${streamSegments.length}段)`, { characterId: conversation?.characterId, conversationId: activeConversationId });

              const segBaseTime = new Date();
              set((state) => {
                const updatedConversations = state.conversations.map(conv => {
                  if (conv.id === activeConversationId) {
                    return {
                      ...conv,
                      messages: conv.messages.map(m =>
                        m.id === aiMsgId ? { ...m, content: streamSegments[0], timestamp: segBaseTime } : m
                      ),
                      updatedAt: new Date(),
                    };
                  }
                  return conv;
                });
                return { conversations: updatedConversations, isTyping: false };
              });

              for (let i = 1; i < streamSegments.length; i++) {
                if (streamSegConfig.showTypingIndicator) {
                  set({ isTyping: true });
                }
                await new Promise(resolve => setTimeout(resolve, streamSegConfig.delay));
                const segMsg: Message = {
                  id: generateId(),
                  content: streamSegments[i],
                  sender: 'ai',
                  timestamp: new Date(),
                  emotion: 'neutral',
                };
                set((state) => {
                  const updatedConversations = state.conversations.map(conv => {
                    if (conv.id === activeConversationId) {
                      return {
                        ...conv,
                        messages: [...conv.messages, segMsg],
                        updatedAt: new Date(),
                      };
                    }
                    return conv;
                  });
                  return { conversations: updatedConversations, isTyping: false };
                });
              }
            } else {
              // Single message (no segmentation)
              const finalContent = streamPipelineResult.text || aiReply;
              set((state) => {
                const updatedConversations = state.conversations.map(conv => {
                  if (conv.id === activeConversationId) {
                    return {
                      ...conv,
                      messages: conv.messages.map(m =>
                        m.id === aiMsgId ? { ...m, content: finalContent } : m
                      ),
                      updatedAt: new Date(),
                    };
                  }
                  return conv;
                });
                return { conversations: updatedConversations, isTyping: false };
              });
            }
          };

          await doStreamReply();
      } else {
          // ===== Non-streaming mode (original logic) =====
          const maxRetries = 2;
          let attempts = 0;
          do {
            aiReply = await callAI(messagesWithMemory, systemPrompt, getAdaptiveMaxTokens(convLen), temperature);
            attempts++;

            const isDup = isDuplicate(aiReply, recentAiReplies);
            const hasCliche = containsAICliche(aiReply);
            const hasCollapse = detectPersonaCollapse(aiReply);
            const shouldRetry = (isDup || hasCliche || hasCollapse) && attempts <= maxRetries;

            if (isDup) useDebugLog.getState().add('intercept', `第${attempts}次拦截: 复读 (与最近回复相似)`, { characterId: character?.id, conversationId: activeConversationId });
            if (hasCliche) useDebugLog.getState().add('intercept', `第${attempts}次拦截: 客服腔`, { characterId: character?.id, conversationId: activeConversationId });
            if (hasCollapse) useDebugLog.getState().add('intercept', `第${attempts}次拦截: 人设崩塌`, { characterId: character?.id, conversationId: activeConversationId });
            if (shouldRetry) useDebugLog.getState().add('system', `第${attempts}次重试...`, { characterId: character?.id, conversationId: activeConversationId });

            if (!shouldRetry) break;
          } while (true);

          useDebugLog.getState().add('reply', `最终回复 (${attempts}次尝试): ${aiReply.slice(0, 40)}...`, { characterId: character?.id, conversationId: activeConversationId });

          // Apply message post-processing
          aiReply = applyMessageProcessing(aiReply);
        }

        // Post-reply: extract memories, evolve emotion, generate reflection (fire-and-forget, batched)
        const allMsgsText = [...convMsgs.map(msg => ({
          role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
          content: msg.content,
        })), { role: 'assistant' as const, content: aiReply }];
        const allMsgs = allMsgsText;
        if (character) {
          // Batch 1: Core tasks (memory, emotion, affinity)
          enqueueBackgroundTask(async () => {
            try {
              const newMemories = await extractMemories(allMsgs, memories, character.id, activeConversationId, character.memoryImportanceThreshold);
              if (newMemories.length > 0) {
                useCharacterMindStore.getState().addMemories(character.id, newMemories);
              }
            } catch {}
          });

          enqueueBackgroundTask(async () => {
            try {
              const result = await analyzeCharacterEmotion(allMsgs, character.personality, charEmotion.emotion);
              const prevEmotion = charEmotion.emotion;
              const prevIntensity = charEmotion.intensity;
              useCharacterMindStore.getState().updateEmotion(character.id, result.emotion, result.intensity);
              useCharacterMindStore.getState().updateMultiEmotion(character.id, result.emotion, result.intensity);
              if (result.emotion !== prevEmotion || Math.abs(result.intensity - prevIntensity) > 5) {
                const arrow = result.intensity > prevIntensity ? '↑' : '↓';
                const diff = Math.abs(result.intensity - prevIntensity);
                useDebugLog.getState().add('emotion', `情绪变化: ${prevEmotion}(${prevIntensity}) → ${result.emotion}(${result.intensity}) ${arrow}${diff}`, { characterId: character.id, conversationId: activeConversationId });
              }
            } catch {}
          });

          const mindStoreBg = useCharacterMindStore.getState();
          const currentAffinity = mindStoreBg.getAffinity(character.id);
          const affinityRate = character.affinityRate || 0.5;
          enqueueBackgroundTask(async () => {
            try {
              const result = await analyzeAffinityChange(allMsgs, character.personality, currentAffinity.level, affinityRate);
              const prevLevel = currentAffinity.level;
              useCharacterMindStore.getState().updateAffinity(character.id, result.delta, result.reason, emotion);
              if (Math.abs(result.delta) > 0.01) {
                const arrow = result.delta > 0 ? '↑' : '↓';
                const newLevel = Math.round((prevLevel + result.delta) * 100) / 100;
                useDebugLog.getState().add('affinity', `好感度变化: ${prevLevel} → ${newLevel} ${arrow}${Math.abs(result.delta).toFixed(2)} (${result.reason})`, { characterId: character.id, conversationId: activeConversationId });
              }
            } catch {}
          });

          // Batch 2: Reflection (if enabled)
          if (character.reflectionEnabled) {
            const emotionHistory = [emotion, ...convMsgs.slice(-6).map(m => m.emotion || 'neutral' as EmotionType)]
              .filter(Boolean)
              .map((e, i) => ({ emotion: e as EmotionType, trigger: i === 0 ? '用户最新消息' : '对话进行中' }));
            enqueueBackgroundTask(async () => {
              try {
                const result = await generateReflection(allMsgs, character.name, character.personality, emotionHistory);
                if (result) {
                  const reflection = {
                    id: generateId(),
                    characterId: character.id,
                    trigger: result.trigger,
                    insight: result.insight,
                    emotionBefore: result.emotionBefore,
                    emotionAfter: result.emotionAfter,
                    createdAt: new Date(),
                  };
                  useCharacterMindStore.getState().addReflection(character.id, reflection);
                }
              } catch {}
            });
          }

          // Batch 3: Memory analysis tasks (if enabled)
          const memConfig = useMemoryAnalysisStore.getState().config;
          const msgCount = allMsgs.length;
          const shouldRunAutoAnalysis = memConfig.autoAnalysisEnabled && msgCount > 0 && msgCount % memConfig.analysisRoundTrigger === 0;

          if (shouldRunAutoAnalysis) {
            const emotionHistory2 = [emotion, ...convMsgs.slice(-6).map(m => m.emotion || 'neutral' as EmotionType)]
              .filter(Boolean)
              .map((e, i) => ({ emotion: e as EmotionType, trigger: i === 0 ? '用户最新消息' : '对话进行中' }));

            enqueueBackgroundTask(async () => {
              try {
                const entry = await generateThinking(allMsgs, character.name, character.personality, character.id, activeConversationId, content);
                if (entry) useMemoryStore.getState().addEntry(entry);
                useDebugLog.getState().add('memory', `思考记忆: ${entry ? '成功' : '空'}`, { characterId: character.id, conversationId: activeConversationId });
              } catch (e) { useDebugLog.getState().add('memory', `思考记忆失败: ${e?.message || e}`, { characterId: character.id, conversationId: activeConversationId }); }
            });

            enqueueBackgroundTask(async () => {
              try {
                const entry = await generateAnalysis(allMsgs, character.name, character.id, activeConversationId, content);
                if (entry) useMemoryStore.getState().addEntry(entry);
                useDebugLog.getState().add('memory', `分析记忆: ${entry ? '成功' : '空'}`, { characterId: character.id, conversationId: activeConversationId });
              } catch (e) { useDebugLog.getState().add('memory', `分析记忆失败: ${e?.message || e}`, { characterId: character.id, conversationId: activeConversationId }); }
            });

            enqueueBackgroundTask(async () => {
              try {
                const entry = await generateReflectionEntry(allMsgs, character.name, character.personality, character.id, activeConversationId, emotionHistory2, content);
                if (entry) useMemoryStore.getState().addEntry(entry);
                useDebugLog.getState().add('memory', `反思记忆: ${entry ? '成功' : '空'}`, { characterId: character.id, conversationId: activeConversationId });
              } catch (e) { useDebugLog.getState().add('memory', `反思记忆失败: ${e?.message || e}`, { characterId: character.id, conversationId: activeConversationId }); }
            });

            enqueueBackgroundTask(async () => {
              try {
                const entry = await generateConversationSummary(allMsgs, character.name, character.id, activeConversationId, content);
                if (entry) useMemoryStore.getState().addEntry(entry);
                useDebugLog.getState().add('memory', `总结记忆: ${entry ? '成功' : '空'}`, { characterId: character.id, conversationId: activeConversationId });
              } catch (e) { useDebugLog.getState().add('memory', `总结记忆失败: ${e?.message || e}`, { characterId: character.id, conversationId: activeConversationId }); }
            });
          }

          // Learning analysis (independent trigger)
          const learnConfig = useLearningConfigStore.getState();
          const shouldLearn = learnConfig.config.enabled && learnConfig.shouldRun(allMsgs.length);
          if (allMsgs.length > 0 && allMsgs.length % 2 === 0) {
            useDebugLog.getState().add('learning', `学习检查: 消息${allMsgs.length}条, enabled=${learnConfig.config.enabled}, 间隔=${learnConfig.config.roundTrigger}, 触发=${shouldLearn}`, { characterId: character.id, conversationId: activeConversationId });
          }
          if (shouldLearn) {
            const { maxVocabulary, maxPhrases, maxMessages } = learnConfig.config;
            learnConfig.recordRun(allMsgs.length);
            const recentMsgs = allMsgs.slice(-maxMessages * 2);
            enqueueBackgroundTask(async () => {
              try {
                const result = await analyzeUserStyle(recentMsgs, maxVocabulary, maxPhrases, maxMessages);
                if (result.vocabulary.length > 0 || result.phrases.length > 0) {
                  useLearningStore.getState().addVocabulary(character.id, result.vocabulary);
                  useLearningStore.getState().addPhrases(character.id, result.phrases);
                  useDebugLog.getState().add('learning', `学习分析成功: ${result.vocabulary.length}词 ${result.phrases.length}句`, { characterId: character.id, conversationId: activeConversationId });
                } else {
                  useDebugLog.getState().add('learning', `学习分析返回空结果`, { characterId: character.id, conversationId: activeConversationId });
                }
              } catch (e) { useDebugLog.getState().add('learning', `学习分析失败: ${e?.message || e}`, { characterId: character.id, conversationId: activeConversationId }); }
            });
          }
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 700));
        aiReply = applyMessageProcessing(getFallbackReply(emotion));
      }

      // Skip message addition if streaming mode already handled it
      if (!streamEnabled) {
        // --- Output Pipeline: unified post-processing ---
        const recentAiRepliesForPipeline = (get().conversations.find(c => c.id === activeConversationId)?.messages || [])
          .filter(m => m.sender === 'ai')
          .slice(-5)
          .map(m => m.content);

        const pipelineCtx: PipelineContext = {
          rawText: aiReply,
          processedText: aiReply,
          emotion: { type: emotion, intensity },
          recentReplies: recentAiRepliesForPipeline,
          userInput: content,
          affinityStage: affinityStage || 'stranger',
          forbiddenText: character?.forbiddenBehaviors,
          interceptConfig: messageProcessingConfig,
        };

        const pipeline = new OutputPipeline();
        let pipelineResult = pipeline.run(pipelineCtx);

        // Log pipeline results
        for (const log of pipelineResult.logs) {
          useDebugLog.getState().add('system', log, { characterId: character?.id, conversationId: activeConversationId });
        }

        // If aborted, discard the message (no recovery reply)
        if (pipelineResult.aborted) {
          useDebugLog.getState().add('intercept', `Pipeline 拦截: ${pipelineResult.abortReason}`, { characterId: character?.id, conversationId: activeConversationId });
          set({ isTyping: false });
          return;
        }

        const finalSegments = pipelineResult.segments;
        const baseTime = new Date();

        // Reply delay (simulated thinking time) — skip for first reply
        const segConfig = getSegmentedConfig();
        const skipDelayNonStream = get()._skipFirstReplyDelay;
        if (skipDelayNonStream) {
          set({ _skipFirstReplyDelay: false });
        } else if (segConfig.replyDelay > 0 || (segConfig.replyDelayRandomEnabled && segConfig.replyDelayRandom > 0)) {
          const totalDelay = segConfig.replyDelay + (segConfig.replyDelayRandomEnabled ? Math.random() * segConfig.replyDelayRandom : 0);
          await new Promise(resolve => setTimeout(resolve, totalDelay));
        }

        if (finalSegments && finalSegments.length > 1) {
          const segPreview = finalSegments.map((s, i) => `[${i + 1}] ${s.slice(0, 30)}${s.length > 30 ? '...' : ''}`).join(' | ');
          useDebugLog.getState().add('system', `分段回复 (${finalSegments.length}段): ${segPreview}`, { characterId: conversation?.characterId, conversationId: activeConversationId });

          const firstMsg: Message = {
            id: generateId(),
            content: finalSegments[0],
            sender: 'ai',
            timestamp: baseTime,
            emotion: 'neutral',
          };

          set((state) => {
            const updatedConversations = state.conversations.map(conv => {
              if (conv.id === activeConversationId) {
                return {
                  ...conv,
                  messages: [...conv.messages, firstMsg],
                  updatedAt: new Date(),
                };
              }
              return conv;
            });
            return {
              conversations: updatedConversations,
              isTyping: false,
            };
          });

          // Add remaining segments with delay
          for (let i = 1; i < finalSegments.length; i++) {
            if (segConfig.showTypingIndicator) {
              set({ isTyping: true });
            }
            await new Promise(resolve => setTimeout(resolve, segConfig.delay));
            const segMsg: Message = {
              id: generateId(),
              content: finalSegments[i],
              sender: 'ai',
              timestamp: new Date(),
              emotion: 'neutral',
            };
            set((state) => {
              const updatedConversations = state.conversations.map(conv => {
                if (conv.id === activeConversationId) {
                  return {
                    ...conv,
                    messages: [...conv.messages, segMsg],
                    updatedAt: new Date(),
                  };
                }
                return conv;
              });
              return { conversations: updatedConversations, isTyping: false };
            });
          }
        } else {
          // Single message (no segmentation needed)
          const aiMessage: Message = {
            id: generateId(),
            content: finalSegments[0] || pipelineResult.text,
            sender: 'ai',
            timestamp: baseTime,
            emotion: 'neutral',
          };

          set((state) => {
            const updatedConversations = state.conversations.map(conv => {
              if (conv.id === activeConversationId) {
                return {
                  ...conv,
                  messages: [...conv.messages, aiMessage],
                  updatedAt: new Date(),
                };
              }
              return conv;
            });
            return {
              conversations: updatedConversations,
              isTyping: false,
            };
          });
        }
      }

      if (character && activeConversationId) {
        const { triggerProactiveAfterReply } = await import('./proactiveReplyStore').then(m => m.useProactiveReplyStore.getState());
        triggerProactiveAfterReply(character.id, activeConversationId).catch(() => {});
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : '';
      console.error('[sendMessage] Error:', errMsg, errStack);
      useDebugLog.getState().add('system', `发送消息失败: ${errMsg}`, { characterId: conversation?.characterId, conversationId: activeConversationId });
      set({ isTyping: false });
    }
  },

  addUserMessageOnly: async (content: string, attachments?: MessageAttachment[], applyDelay?: boolean) => {
    const { currentConversationId, conversations } = get();
    if (!currentConversationId) return;

    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return;

    // Test mode: skip
    if (conv.testMode) return;

    // User reply delay (simulated typing time before message appears)
    // applyDelay defaults to true; first message in batch passes false to skip delay
    if (applyDelay !== false) {
      const userSegConfig = getSegmentedConfig();
      if (userSegConfig.userReplyDelay > 0 || (userSegConfig.userReplyDelayRandomEnabled && userSegConfig.userReplyDelayRandom > 0)) {
        const totalDelay = userSegConfig.userReplyDelay + (userSegConfig.userReplyDelayRandomEnabled ? Math.random() * userSegConfig.userReplyDelayRandom : 0);
        await new Promise(resolve => setTimeout(resolve, totalDelay));
      }
    }

    const userMsg: Message = {
      id: generateId(),
      content: content.trim(),
      sender: 'user' as const,
      timestamp: new Date(),
      attachments,
    };

    set((state) => ({
      _queuedContent: state._queuedContent ? state._queuedContent + '\n---\n' + content.trim() : content.trim(),
      conversations: state.conversations.map(c =>
        c.id === currentConversationId
          ? { ...c, messages: [...c.messages, userMsg], updatedAt: new Date() }
          : c
      ),
    }));
  },

  processQueuedUserMessages: () => {
    const { _queuedContent, currentConversationId } = get();
    if (!_queuedContent || !currentConversationId) return;

    const content = _queuedContent;
    set({ _queuedContent: '', _skipMessageAdd: true });

    // Call sendMessage — it will skip adding messages (already added) and just call AI
    get().sendMessage(content, undefined, currentConversationId);

    // Reset flag after a tick
    setTimeout(() => set({ _skipMessageAdd: false }), 50);
  },

  deleteConversation: (id: string) => {
    set((state) => {
      const updated = state.conversations.filter(c => c.id !== id);
      return {
        conversations: updated,
        currentConversationId: state.currentConversationId === id ? null : state.currentConversationId,
      };
    });
  },

  renameConversation: (id: string, title: string) => {
    set((state) => {
      const updated = state.conversations.map(conv =>
        conv.id === id ? { ...conv, title } : conv
      );
      return { conversations: updated };
    });
  },

  updateEmotion: (emotion: EmotionType, intensity: number, context: string) => {
    const newRecord: EmotionRecord = {
      id: generateId(),
      emotion,
      intensity,
      timestamp: new Date(),
      context,
    };
    set((state) => {
      const updated = [newRecord, ...state.emotionRecords].slice(0, 100);
      return {
        currentEmotion: emotion,
        emotionIntensity: intensity,
        emotionRecords: updated,
      };
    });
  },

  setIsTyping: (isTyping: boolean) => {
    set({ isTyping });
  },

  clearApiError: () => {
    set({ apiError: null });
  },

  clearAllData: () => {
    // NOTE: Backup data (ai-backups in localStorage, backups table in SQLite)
    // is intentionally NOT cleared by this function.
    set({
      conversations: [],
      currentConversationId: null,
      emotionRecords: [],
      apiError: null,
    });
    localStorage.removeItem('ai-conversations');
    localStorage.removeItem('ai-emotion-records');
    localStorage.removeItem('ai-character-emotions');
    localStorage.removeItem('ai-character-affinities');
    localStorage.removeItem('ai-memory-entries');
    localStorage.removeItem('ai-deleted-memory-entries');
    localStorage.removeItem('ui-config');
    localStorage.removeItem('model-role-config');
    localStorage.removeItem('learning-profiles');
    // Clear other stores
    useCharacterMindStore.setState({ emotionStates: {}, affinityStates: {} });
    useMemoryStore.setState({ entries: {} });
    useRecycleBinStore.getState().clearAll();
    useDebugLog.getState().clear();
    useModelRoleStore.setState({ assignments: {} as any });
    useLearningStore.setState({ profiles: {} });
    dbClearAllData().catch(() => {});
  },

  clearConversations: () => {
    set({
      conversations: [],
      currentConversationId: null,
    });
    localStorage.removeItem('ai-conversations');
    dbClearConversations().catch(() => {});
  },

  clearEmotionRecords: () => {
    set({ emotionRecords: [] });
    localStorage.removeItem('ai-emotion-records');
    dbClearEmotionRecords().catch(() => {});
  },

  clearMemoriesAndReflections: () => {
    localStorage.removeItem('ai-character-emotions');
    localStorage.removeItem('ai-character-affinities');
    dbClearMemories().catch(() => {});
    dbClearReflections().catch(() => {});
  },
})));

// Auto-persist conversations on every change (debounced)
let persistConvTimer: ReturnType<typeof setTimeout> | null = null;
useChatStore.subscribe(
  (state) => state.conversations,
  (conversations) => {
    if (persistConvTimer) clearTimeout(persistConvTimer);
    persistConvTimer = setTimeout(() => persistConversations(conversations), 500);
  }
);

// Auto-persist emotion records on every change (debounced)
let persistEmotionRecTimer: ReturnType<typeof setTimeout> | null = null;
useChatStore.subscribe(
  (state) => state.emotionRecords,
  (emotionRecords) => {
    if (persistEmotionRecTimer) clearTimeout(persistEmotionRecTimer);
    persistEmotionRecTimer = setTimeout(() => persistEmotionRecords(emotionRecords), 500);
  }
);

export function getSegmentedConfig() {
  const { segmentConfig } = useModelRoleStore.getState();
  return {
    enabled: segmentConfig.enabled,
    threshold: segmentConfig.threshold,
    maxSegments: segmentConfig.maxSegments,
    mode: segmentConfig.mode,
    minSegmentLength: segmentConfig.minSegmentLength ?? 8,
    delay: segmentConfig.segmentDelayMs ?? 800,
    replyDelay: segmentConfig.replyDelayMs ?? 0,
    replyDelayRandomEnabled: segmentConfig.replyDelayRandomEnabled ?? false,
    replyDelayRandom: segmentConfig.replyDelayRandomMs ?? 0,
    userReplyDelay: segmentConfig.userReplyDelayMs ?? 0,
    userReplyDelayRandomEnabled: segmentConfig.userReplyDelayRandomEnabled ?? false,
    userReplyDelayRandom: segmentConfig.userReplyDelayRandomMs ?? 0,
    protectPairedSymbols: segmentConfig.protectPairedSymbols ?? true,
    showTypingIndicator: segmentConfig.showTypingIndicator ?? false,
  };
}

export function applyMessageProcessing(text: string): string {
  const { messageProcessingConfig } = useModelRoleStore.getState();
  if (!messageProcessingConfig?.enabled) return text;
  return processMessageText(text, messageProcessingConfig);
}

function isStreamEnabled(): boolean {
  try {
    const stored = localStorage.getItem('ui-config');
    if (stored) {
      const config = JSON.parse(stored);
      return config.streamResponse === true;
    }
  } catch { /* ignore */ }
  return false;
}

function getAdaptiveMaxTokens(conversationLength: number): number {
  if (conversationLength < 5) return 400;
  if (conversationLength < 20) return 600;
  if (conversationLength < 50) return 800;
  return 1000;
}

function getFallbackReply(emotion: EmotionType): string {
  const replies: Record<EmotionType, string[]> = {
    joy: [
      '听起来你心情不错，为你感到高兴。愿意分享更多吗？',
      '很好！保持这样的好心情。有什么想聊的？',
      '感受到你的开心了，继续这样下去吧。',
    ],
    sadness: [
      '我能感受到你现在的低落。没关系，我在这里陪你。想说说发生了什么吗？',
      '听起来你现在心情不太好。不管你经历了什么，我都会在这里听你说。',
      '抱歉听到这些。有时候生活确实不容易，你愿意说出来已经很勇敢了。',
    ],
    anger: [
      '我能理解你的不满。遇到这样的事确实让人不舒服，我们一起想想怎么办好吗？',
      '你的感受是合理的。先深呼吸，让我们冷静下来看看能做些什么。',
      '我理解你现在的心情。生气是正常的，但别让情绪控制了判断力。',
    ],
    fear: [
      '别担心，我在这里。你担心的事情，我们一起面对好吗？',
      '紧张是很自然的反应。让我们一起来看看，情况真的有那么糟吗？',
      '你的担心我能理解。但你比你想象的要坚强，我会支持你的。',
    ],
    surprise: [
      '确实很意外！能多告诉我一些细节吗？',
      '真的吗？这确实让人惊讶，然后呢？',
      '哈哈，这确实出乎意料。接下来发生了什么？',
    ],
    love: [
      '谢谢你的信任，这让我感到很温暖。能陪伴你是我的荣幸。',
      '你的话让我觉得我们的距离更近了。我会一直在这里的。',
      '听到你这么说我很开心。你对我来说也很重要。',
    ],
    shy: [
      '没关系，慢慢来，不用着急。',
      '哈哈，你这么说我还挺不好意思的。',
      '别害羞呀，我不会笑你的。',
    ],
    lonely: [
      '我在这里，你不是一个人。想聊些什么吗？',
      '有时候感到孤独是正常的。让我陪你一会儿吧。',
      '你并不孤单，我一直都在。',
    ],
    grateful: [
      '不客气，能帮到你我也很开心。',
      '你的心意我收到了，谢谢你的信任。',
      '我们互相帮助是应该的，不用这么客气。',
    ],
    brave: [
      '你真的很勇敢，我很佩服你的勇气。',
      '加油，我相信你一定可以的。',
      '面对困难还能坚持，这本身就很了不起。',
    ],
    curiosity: [
      '好奇心是最好的老师！你发现了什么有趣的事情？',
      '这个问题很有意思，让我想想怎么回答你。',
      '我也很好奇，我们一起探索一下吧。',
    ],
    excitement: [
      '感受到你的兴奋了！快跟我说说发生了什么好事！',
      '这么开心！我也被你的情绪感染了。',
      '听起来太棒了！你一定很期待吧。',
    ],
    pride: [
      '太厉害了！你真的做到了，为你感到骄傲。',
      '这成就来之不易，你的努力值得被看见。',
      '你真的很棒！这种成就感是自己争取来的。',
    ],
    disappointment: [
      '我能感受到你的失落。有时候事情确实不如预期，但没关系。',
      '失望是难免的，但每一次失望都是一次学习的机会。',
      '抱抱，我知道你现在不太好受。要不要聊聊？',
    ],
    confusion: [
      '没关系，遇到不懂的事情很正常。让我帮你理一理。',
      '这个问题确实有点绕，我们慢慢来分析。',
      '我理解你的困惑，让我试着换个角度解释一下。',
    ],
    contentment: [
      '这种平静满足的感觉真好。享受当下的每一刻吧。',
      '听起来你现在状态很好呢，保持这份从容。',
      '满足是难得的幸福，珍惜这种感觉。',
    ],
    nostalgia: [
      '回忆总是带着温度的。那段时光一定很特别吧。',
      '过去的事情塑造了现在的你。那些回忆现在还好吗？',
      '怀旧是因为过去有值得珍惜的东西。想多聊聊吗？',
    ],
    jealousy: [
      '我理解这种感受。看到别人拥有自己想要的东西确实不好受。',
      '嫉妒是人之常情，但别让它影响了你自己的节奏。',
      '每个人都有自己的时区，你的花也会开的。',
    ],
    hope: [
      '有希望就是有力量。相信好事正在路上。',
      '你的乐观让我也充满了期待。未来一定会更好的。',
      '心怀希望的人运气不会太差，我支持你。',
    ],
    relief: [
      '终于松了口气！那种如释重负的感觉真好。',
      '挺过来了就好。之前一定很辛苦吧。',
      '还好有惊无险，以后会越来越顺利的。',
    ],
    regret: [
      '每个人都会有后悔的时候。但过去的事已经无法改变，重要的是从中学习。',
      '我理解你的遗憾。但你已经做得很好了，别太苛责自己。',
      '后悔说明你在成长。下次遇到类似的情况，你会做出更好的选择。',
    ],
    admiration: [
      '你的眼光真好！那个人确实很优秀。',
      '能欣赏别人的优点也是一种能力。',
      '你说得对，我也很佩服他/她。',
    ],
    neutral: [
      '明白了。还有什么想聊的吗？',
      '好的，我记下了。你还有其他想问的吗？',
      '收到。我在这里，随时可以陪你聊天。',
    ],
    anxious: [
      '别紧张，深呼吸一下。我在这里陪你，慢慢来。',
      '焦虑是正常的，但你比你想象的要坚强。我们一起面对好吗？',
      '放轻松，事情没有你想的那么糟糕。我陪着你呢。',
    ],
    embarrassed: [
      '没关系的，每个人都有这样的时刻。不用放在心上。',
      '哈哈，这有什么好尴尬的，我觉得很正常呀。',
      '别担心，我不会在意的。放轻松～',
    ],
    tender: [
      '你的好意我收到了，谢谢你的温柔。',
      '能感受到你的关心，这让我觉得很温暖。',
      '你的温柔总是让人很安心呢。',
    ],
    disgusted: [
      '我能理解你的感受。有些事情确实让人不舒服。',
      '遇到这样的事情确实不好受，我理解你。',
      '没关系，远离让你不舒服的人和事就好。',
    ],
    jealous: [
      '我理解这种感受。但你也有自己独特的闪光点呀。',
      '每个人都有自己的节奏，不用和别人比较。',
      '你的花也会开的，只是时间问题。',
    ],
    confused: [
      '没关系，遇到不懂的事情很正常。让我帮你理一理。',
      '这个问题确实有点绕，我们慢慢来分析。',
      '我理解你的困惑，让我试着换个角度解释一下。',
    ],
    nostalgic: [
      '回忆总是带着温度的。那段时光一定很特别吧。',
      '过去的事情塑造了现在的你。那些回忆现在还好吗？',
      '怀旧是因为过去有值得珍惜的东西。想多聊聊吗？',
    ],
    proud: [
      '太厉害了！你真的做到了，为你感到骄傲。',
      '这成就来之不易，你的努力值得被看见。',
      '你真的很棒！这种成就感是自己争取来的。',
    ],
    surprised: [
      '哇！真的吗？太意外了！快告诉我更多！',
      '天哪，这确实让人惊讶！然后呢然后呢？',
      '没想到会这样！你一定也很意外吧！',
    ],
  };

  const options = replies[emotion] || replies.neutral;
  return options[Math.floor(Math.random() * options.length)];
}
