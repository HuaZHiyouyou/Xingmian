/**
 * ============================================================
 * AgentPanel - Agent 控制面板
 * 显示 Agent 对话界面、工具执行状态
 * ============================================================
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { sendAgentMessage } from '../../agent/agentService';
import { initializeAgentTools } from '../../agent/toolRegistry';
import type { AgentMessage } from '../../types/agent';

// ==================== 工具图标映射 ====================

const CATEGORY_ICONS: Record<string, string> = {
  settings: '⚙️',
  ui: '🎨',
  navigation: '🧭',
  plugin: '🧩',
  skill: '⚡',
  character: '👤',
  chat: '💬',
  memory: '🧠',
  file: '📁',
  system: '🔧',
};

const MSG_ICONS: Record<string, string> = {
  user: '👤',
  assistant: '🤖',
  tool_call: '🔧',
  tool_result: '📋',
  system: 'ℹ️',
};

// ==================== 消息气泡组件 ====================

const AgentMessageBubble: React.FC<{ message: AgentMessage }> = ({ message }) => {
  const isUser = message.type === 'user';
  const isTool = message.type === 'tool_call' || message.type === 'tool_result';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
        isUser
          ? 'bg-slate-700 text-white'
          : isTool
            ? 'bg-gray-700 text-gray-200 border border-gray-600'
            : 'bg-gray-800 text-gray-100'
      }`}>
        {/* 消息头 */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm">{MSG_ICONS[message.type] || '💬'}</span>
          <span className="text-xs opacity-60">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
          {message.toolCall && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/30 text-slate-400">
              {message.toolCall.toolName}
            </span>
          )}
        </div>

        {/* 工具调用详情 */}
        {message.type === 'tool_call' && message.toolCall && (
          <div className="mt-2 p-2 rounded-lg bg-black/20 text-xs font-mono">
            <div className="text-green-400 mb-1">工具: {message.toolCall.toolId}</div>
            <div className="text-gray-400">参数: {JSON.stringify(message.toolCall.params, null, 2)}</div>
            {message.toolCall.result && (
              <div className={`mt-1 ${message.toolCall.result.success ? 'text-green-400' : 'text-red-400'}`}>
                结果: {message.toolCall.result.success ? '✅ 成功' : `❌ ${message.toolCall.result.error}`}
                {message.toolCall.result.message && ` - ${message.toolCall.result.message}`}
              </div>
            )}
          </div>
        )}

        {/* 消息内容 */}
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    </div>
  );
};

// ==================== 工具执行状态栏 ====================

const ToolExecutionBar: React.FC = () => {
  const isExecuting = useAgentStore((s) => s.isExecuting);
  if (!isExecuting) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-slate-700/10 border-t border-slate-700/20">
      <div className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm text-slate-400">Agent 正在执行工具...</span>
    </div>
  );
};

// ==================== 主组件 ====================

const AgentPanel: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const store = useAgentStore();
  const messages = store.getMessages();

  // 初始化工具
  useEffect(() => {
    initializeAgentTools();
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // 发送消息
  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    setInput('');
    setIsLoading(true);

    try {
      await sendAgentMessage(message);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading]);

  // 快捷操作
  const quickActions = [
    { label: '查看设置', message: '查看当前所有设置' },
    { label: '切换暗色', message: '切换到暗色主题' },
    { label: '列出插件', message: '列出所有插件' },
    { label: '列出技能', message: '列出所有技能' },
    { label: '列出角色', message: '列出所有角色' },
    { label: '对话统计', message: '查看对话统计' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-700 flex items-center justify-center">
            <span className="text-white text-sm">🤖</span>
          </div>
          <div>
            <h2 className="text-white font-bold">Agent 控制中心</h2>
            <p className="text-xs text-gray-400">
              {store.getAllTools().length} 个工具可用
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTools(!showTools)}
            className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
          >
            {showTools ? '隐藏工具' : '查看工具'}
          </button>
          <button
            onClick={() => store.createSession()}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 text-white hover:bg-slate-700 transition-colors"
          >
            新建会话
          </button>
        </div>
      </div>

      {/* 工具列表面板 */}
      {showTools && (
        <div className="border-b border-gray-700 p-4 max-h-60 overflow-y-auto bg-gray-850">
          <div className="grid grid-cols-2 gap-2">
            {store.getAllTools().map((tool) => (
              <div key={tool.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-800 border border-gray-700">
                <span>{CATEGORY_ICONS[tool.category] || '🔧'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{tool.name}</div>
                  <div className="text-xs text-gray-400 truncate">{tool.description}</div>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  tool.permissionLevel === 'high' ? 'bg-red-500/20 text-red-400' :
                  tool.permissionLevel === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-green-500/20 text-green-400'
                }`}>
                  {tool.permissionLevel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="text-6xl mb-4">🤖</div>
            <h3 className="text-lg font-bold text-gray-300 mb-2">Agent 控制中心</h3>
            <p className="text-sm text-center max-w-md mb-6">
              我可以帮你控制应用的任何功能：修改设置、切换主题、创建插件、管理角色等。<br />
              直接用自然语言告诉我你想做什么。
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => { setInput(action.message); }}
                  className="px-3 py-1.5 text-sm rounded-full bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors border border-gray-700"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <AgentMessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 工具执行状态 */}
      <ToolExecutionBar />

      {/* 输入区 */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="告诉我你想做什么... (Enter 发送, Shift+Enter 换行)"
            className="flex-1 resize-none rounded-xl bg-gray-800 text-white px-4 py-3 text-sm border border-gray-700 focus:border-slate-700 focus:outline-none transition-colors"
            rows={2}
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-4 py-3 rounded-xl bg-slate-700 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              '发送'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentPanel;
