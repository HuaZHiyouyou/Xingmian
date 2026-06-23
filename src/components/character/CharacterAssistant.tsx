
import { useState, useRef, useEffect } from 'react';
import { Character } from '../../types';
import { callAI } from '../../services/aiService';
import { X, Send, Loader2, Upload, FileText } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  onComplete: (data: Partial<Character>) => void;
  onClose: () => void;
}

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  file?: { name: string; size: string; ext: string };
  rawText?: string;
};

const SYSTEM_PROMPT = `你是一个角色设计助手。用户想创建一个AI角色，你需要通过提问来了解角色的设定。

规则：
1. 所有回复必须用中文，禁止输出英文
2. 每次只问一个问题，问题要简洁
3. 根据用户之前的回答调整后续问题
4. 当用户说"创建角色"、"确认"、"正确"、"没问题"时，立即输出JSON格式的角色数据

JSON格式：
{"name":"角色名","personality":"性格","description":"描述","background":"背景","likes":["喜欢"],"dislikes":["讨厌"],"habits":["习惯"],"catchphrases":["口头禅"],"thinkingStyle":"思考方式","responseStyle":"回复风格","emotionTriggers":"情绪触发","emotionExpressions":"情绪表达","relationshipStages":"关系阶段描述","identityAnchors":"身份信念","forbiddenBehaviors":"禁止行为","tags":["标签"]}

- likes/dislikes/habits/catchphrases/tags 都是字符串数组
- 所有字符串字段如果不确定就留空字符串
- 只输出JSON，不要其他内容`;

const QUESTIONS = [
  '这个角色叫什么名字？是什么类型的角色？',
  '角色的性格是什么样的？',
  '角色的背景故事是什么？',
  '角色有什么喜欢和讨厌的事物？',
  '角色有什么小习惯或标志性动作？',
  '角色的说话风格和口头禅是什么？',
  '角色的思考方式是什么？',
  '什么情况会让角色情绪波动？角色如何表达情绪？',
  '角色有什么绝对不能做的事？',
  '你和角色的关系阶段是怎样的？',
  '角色的回复风格偏好？',
];

const getFirstQuestion = () => QUESTIONS[0];

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function extractJSON(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (e) { console.error('JSON parse error:', e); }
  }
  return null;
}

function buildCharacterData(data: Record<string, unknown>, fallbackName: string, fallbackText: string): Partial<Character> {
  return {
    name: (data.name as string) || fallbackName,
    personality: (data.personality as string) || '',
    description: (data.description as string) || '',
    background: (data.background as string) || fallbackText,
    likes: Array.isArray(data.likes) ? data.likes as string[] : [],
    dislikes: Array.isArray(data.dislikes) ? data.dislikes as string[] : [],
    habits: Array.isArray(data.habits) ? data.habits as string[] : [],
    catchphrases: Array.isArray(data.catchphrases) ? data.catchphrases as string[] : [],
    thinkingStyle: (data.thinkingStyle as string) || '',
    responseStyle: (data.responseStyle as string) || '',
    emotionTriggers: (data.emotionTriggers as string) || '',
    emotionExpressions: (data.emotionExpressions as string) || '',
    relationshipStages: (data.relationshipStages as string) || '',
    identityAnchors: (data.identityAnchors as string) || '',
    forbiddenBehaviors: (data.forbiddenBehaviors as string) || '',
    tags: Array.isArray(data.tags) ? data.tags as string[] : [],
  };
}

export function CharacterAssistant({ onComplete, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [fileContext, setFileContext] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const assistantLocalFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const greeting = `你好！我来帮你创建角色。你可以直接描述角色，也可以上传设定文件。\n\n上传文件后，我会读取内容并和你确认哪些信息填到哪些字段。\n\n${getFirstQuestion()}`;
    setMessages([{ role: 'assistant', content: greeting }]);
  }, []);

  const handleFileUpload = async (file: File) => {
    const text = await file.text();
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const baseName = file.name.replace(/\.[^/.]+$/, '') || '导入角色';
    const sizeStr = formatSize(file.size);

    const userMsg: ChatMessage = {
      role: 'user',
      content: '已上传文件',
      file: { name: file.name, size: sizeStr, ext },
      rawText: text,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // JSON文件 - 客户端直接解析
      if (ext === 'json') {
        const data = extractJSON(text);
        if (data) {
          const charData = buildCharacterData(data, baseName, text);
          setMessages([...newMessages, {
            role: 'assistant',
            content: `文件解析成功！我提取到了以下信息，请确认：\n\n• 名称：${charData.name}\n• 性格：${charData.personality || '（未找到）'}\n• 描述：${charData.description || '（未找到）'}\n• 标签：${charData.tags?.join('、') || '（未找到）'}\n\n这些信息正确吗？确认后我来生成角色。`,
          }]);
          setFileContext(JSON.stringify(charData));
          return;
        }
      }

      // MD/TXT - 发给AI，让AI分析并和用户确认
      const fileAnalysisPrompt = `你是角色设计助手。分析用户上传的文件，用中文列出找到的信息。

规则：
1. 所有输出必须是中文
2. 禁止输出英文或分析过程
3. 只输出以下格式，不要其他内容

格式：
角色名称：xxx
性格特点：xxx
角色描述：xxx
背景故事：xxx
喜欢的事物：xxx
讨厌的事物：xxx
小习惯：xxx
口头禅：xxx
思考方式：xxx
回复风格：xxx
情绪触发：xxx
情绪表达：xxx
身份信念：xxx
禁止行为：xxx
标签：xxx

没找到的字段写"未找到"。最后问"这些信息正确吗？确认后我来生成角色。"`;

      const aiMessages = [{ role: 'user' as const, content: `分析这个角色设定文件：\n\n${text}` }];
      const reply = await callAI(aiMessages, fileAnalysisPrompt, 2500);

      setMessages([...newMessages, { role: 'assistant', content: reply }]);
      setFileContext(text);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '请求失败';
      setMessages([...newMessages, { role: 'assistant', content: `文件分析出错：${errMsg}。你可以直接描述角色信息。` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      // 构建AI消息列表（包含文件上下文）
      const aiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

      for (const m of newMessages) {
        if (m.file && m.rawText) {
          // 文件消息：用文件内容作为上下文
          aiMessages.push({ role: 'user', content: `我上传了文件「${m.file.name}」，内容如下：\n\n${m.rawText}\n\n（请在分析角色时参考此文件内容）` });
        } else if (m.role === 'assistant' && m.file) {
          // 跳过文件卡片的assistant消息
          continue;
        } else {
          aiMessages.push({ role: m.role, content: m.content });
        }
      }

      const systemPrompt = fileContext
        ? `用户之前上传了一份设定文件，你已经分析过文件内容。当用户说"创建角色"、"确认"、"正确"时，直接根据文件内容输出JSON格式的角色数据。\n\n${SYSTEM_PROMPT}`
        : SYSTEM_PROMPT;

      const reply = await callAI(aiMessages, systemPrompt, 2000);

      const data = extractJSON(reply);
      if (data) {
        setIsComplete(true);
        const fallbackText = fileContext || '';
        const charData = buildCharacterData(data, '', fallbackText);
        setMessages([...newMessages, { role: 'assistant', content: '角色生成完成！正在跳转编辑...' }]);
        setTimeout(async () => {
          try {
            await onComplete(charData);
          } catch (error) {
            console.error('Character creation failed:', error);
            setIsComplete(false);
            setMessages([...newMessages, { role: 'assistant', content: '创建失败，请重试或联系管理员。' }]);
          }
        }, 500);
        return;
      }

      setMessages([...newMessages, { role: 'assistant', content: reply }]);
      setQuestionIndex((i) => i + 1);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '请求失败';
      setMessages([...newMessages, { role: 'assistant', content: `出错了：${errMsg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg h-[75vh] flex flex-col overflow-hidden"
      >
        <input
          ref={assistantLocalFileRef}
          type="file"
          accept=".json,.md,.txt"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) await handleFileUpload(file);
            if (assistantLocalFileRef.current) assistantLocalFileRef.current.value = '';
          }}
        />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <span className="text-white text-sm">AI</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI 辅助创建</h2>
              <p className="text-[11px] text-gray-400">
                {isComplete ? '创建完成' : fileContext ? '已上传文件，确认信息中' : `第 ${questionIndex + 1}/${QUESTIONS.length} 步`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => assistantLocalFileRef.current?.click()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              <Upload size={14} />
              上传文件
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
              <X size={16} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                  <span className="text-white text-[10px] font-bold">AI</span>
                </div>
              )}
              <div className={`max-w-[78%] ${msg.role === 'user' ? 'order-1' : ''}`}>
                {/* 文件卡片 */}
                {msg.file ? (
                  <div className="inline-flex items-center gap-3 px-4 py-3 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-sm">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                      <FileText size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate max-w-[180px]">{msg.file.name}</p>
                      <p className="text-[10px] opacity-70">{msg.file.size}</p>
                    </div>
                  </div>
                ) : (
                  <div className={`px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-violet-600 text-white rounded-br-md'
                      : 'bg-gray-100 dark:bg-gray-700/80 text-gray-800 dark:text-gray-200 rounded-bl-md'
                  }`}>
                    {msg.content.split('\n').map((line, j) => (
                      <p key={j} className={j > 0 ? 'mt-1.5' : ''}>{line}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                <span className="text-white text-[10px] font-bold">AI</span>
              </div>
              <div className="bg-gray-100 dark:bg-gray-700/80 px-3 py-2.5 rounded-2xl rounded-bl-md">
                <Loader2 size={16} className="animate-spin text-gray-400" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading || isComplete}
              placeholder={isComplete ? '角色已生成，即将跳转...' : '输入你的回答...'}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 transition-shadow"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isLoading || isComplete}
              className="p-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
