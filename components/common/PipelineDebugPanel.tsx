/**
 * 🆕 管道调试面板
 *
 * 实时显示消息处理管道各阶段的调用和流转：
 * - invoke 命令调用（process_message / extract_memories / call_ai 等）
 * - 消息发送→接收→保存的完整流程
 * - Rust 后端调用耗时
 * - 错误和警告
 *
 * 悬浮在右下角，可通过设置中按钮打开
 */

import { useEffect, useRef, useState } from 'react';
import { Bug } from 'lucide-react';

export interface PipelineEvent {
  id: string;
  timestamp: Date;
  type: 'invoke' | 'reply' | 'save' | 'error' | 'task' | 'info';
  label: string;
  detail: string;
  duration?: number;
}

// 全局事件收集器（无渲染依赖，可从任何地方 push）
export let _pipelineEvents: PipelineEvent[] = [];
export let _onUpdate: (() => void) | null = null;

export function pushPipelineEvent(evt: Omit<PipelineEvent, 'id' | 'timestamp'>) {
  _pipelineEvents = [
    {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      ...evt,
    },
    ..._pipelineEvents,
  ].slice(0, 200); // 最多保留 200 条
  _onUpdate?.();
}

export function clearPipelineEvents() {
  _pipelineEvents = [];
  _onUpdate?.();
}

export function usePipelineEvents() {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    _onUpdate = () => forceUpdate(n => n + 1);
    return () => { _onUpdate = null; };
  }, []);
  return _pipelineEvents;
}

export function PipelineDebugPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const events = usePipelineEvents();
  const listRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (!collapsed && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [events, collapsed]);

  const typeColor = (t: PipelineEvent['type']) => {
    switch (t) {
      case 'invoke': return 'bg-blue-500';
      case 'reply': return 'bg-green-500';
      case 'save': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      case 'task': return 'bg-slate-700';
      case 'info': return 'bg-gray-400';
    }
  };

  const typeLabel = (t: PipelineEvent['type']) => {
    switch (t) {
      case 'invoke': return '调用';
      case 'reply': return '回复';
      case 'save': return '保存';
      case 'error': return '错误';
      case 'task': return '任务';
      case 'info': return '信息';
    }
  };

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 transition-all duration-300 ${
        collapsed ? 'w-12 h-12 cursor-pointer' : 'w-[420px] max-h-[500px]'
      }`}
    >
      <div
        className={`bg-gray-900/95 backdrop-blur-sm rounded-lg shadow-2xl border border-gray-700 overflow-hidden ${
          collapsed ? 'p-0' : 'p-2'
        }`}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-gray-800/50 rounded"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <div className="flex items-center gap-2">
              <Bug size={16} className="text-yellow-400" />
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">管道调试</span>
                <span className="text-xs text-gray-400">({events.length})</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="text-xs px-2 py-0.5 bg-gray-700 rounded hover:bg-gray-600 text-gray-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearPipelineEvents();
                  }}
                >
                  清空
                </button>
                <span className="text-gray-500 text-xs">收起</span>
              </div>
            </>
          )}
        </div>

        {/* 事件列表 */}
        {!collapsed && (
          <div ref={listRef} className="overflow-y-auto max-h-[440px] space-y-0.5 px-1">
            {events.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-xs">
               暂无管道事件
              </div>
            )}
            {events.map((evt) => {
              const isExpanded = expandedId === evt.id;
              return (
                <div
                  key={evt.id}
                  className="flex flex-col py-1.5 px-2 rounded hover:bg-gray-800/50 text-xs font-mono cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : evt.id)}
                >
                  <div className="flex items-start gap-2">
                    {/* 类型标签 */}
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-white shrink-0 ${typeColor(evt.type)}`}>
                      {typeLabel(evt.type)}
                    </span>
                    {/* 时间 */}
                    <span className="text-gray-500 shrink-0 w-14">
                      {evt.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    {/* 内容 */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-gray-200 ${isExpanded ? '' : 'truncate'}`}>{evt.label}</div>
                      <div className={`text-gray-500 ${isExpanded ? 'whitespace-pre-wrap break-all' : 'truncate'}`}>{evt.detail}</div>
                    </div>
                    {/* 耗时 */}
                    {evt.duration != null && (
                      <span className={`shrink-0 text-[10px] ${evt.duration > 2000 ? 'text-red-400' : evt.duration > 500 ? 'text-yellow-400' : 'text-gray-400'}`}>
                        {evt.duration}ms
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
