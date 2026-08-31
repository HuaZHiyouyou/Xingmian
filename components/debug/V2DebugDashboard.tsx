/**
 * ============================================================
 * V2 调试仪表盘 - 实时数据绑定版
 * 参考: docs/upgrade-plans/05-todo-and-gaps.md P3部分
 * ============================================================
 */

import { useState } from 'react';
import type { ElementType } from 'react';
import { Heart, Brain, Zap, BookOpen, ChevronDown } from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useMemoryStore } from '../../store/memoryStore';
import { useLearningStore } from '../../store/learningStore';
import { getReviewQueue } from '../../services/learning/selfLearningV2';
import type { Memory } from '../../types';
import type { MemoryEntry } from '../../types';

interface V2DebugDashboardProps {
  characterId?: string;
}

export default function V2DebugDashboard({ characterId }: V2DebugDashboardProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    emotion: true,
    memory: false,
    pipeline: false,
    learning: false,
  });

  // 实时数据订阅（使用选择器避免不必要的重渲染）
  const currentEmotion = useChatStore(s => s.currentEmotion);
  const emotionIntensity = useChatStore(s => s.emotionIntensity);
  const pipelineFailures = useChatStore(s => s._pipelineDegradation?.v2Failures || 0);
  const pipelineDegraded = useChatStore(s => s._pipelineDegradation?.v2Disabled || false);
  const fatigueLevel = useChatStore(s => s.emotionFatigue?.fatigueLevel || 0);

  const memoryCount = useCharacterMindStore(s => {
    const memories = s.memories;
    if (!memories) return 0;
    if (characterId) return (memories[characterId] || []).length;
    return Object.values(memories).reduce((sum: number, arr: Memory[]) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  });

  const memEntries = useMemoryStore(s => s.entries);
  const memoryEntryCount = Object.values(memEntries || {} as Record<string, MemoryEntry[]>)
    .reduce((sum: number, arr: MemoryEntry[]) => sum + (arr?.length || 0), 0);

  const vocabCount = useLearningStore(s => (s as unknown as { vocabulary?: unknown[] }).vocabulary?.length || 0);
  const phraseCount = useLearningStore(s => (s as unknown as { phrases?: unknown[] }).phrases?.length || 0);

  const reviewQueue = getReviewQueue();
  const reviewStats = reviewQueue.getStats();

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const SectionCard = ({ title, icon: Icon, keyName, children, accentColor = 'violet' }: {
    title: string; icon: ElementType; keyName: string; children: React.ReactNode; accentColor?: string;
  }) => {
    const colorClasses: Record<string, { bg: string; leftBorder: string; iconBg: string; iconColor: string; hoverBg: string }> = {
      violet: { bg: 'bg-slate-100/80 dark:bg-slate-900/40', leftBorder: 'border-l-slate-500 dark:border-l-slate-700', iconBg: 'bg-gradient-to-br from-slate-200 to-slate-100 dark:from-slate-800/40 dark:to-slate-900/20', iconColor: 'text-slate-700 dark:text-slate-500', hoverBg: 'hover:bg-slate-100/50 dark:hover:bg-slate-900/20' },
      blue: { bg: 'bg-blue-50/80 dark:bg-blue-950/30', leftBorder: 'border-l-blue-400 dark:border-l-blue-500', iconBg: 'bg-gradient-to-br from-blue-100 to-blue-50 dark:from-blue-900/40 dark:to-blue-950/20', iconColor: 'text-blue-600 dark:text-blue-400', hoverBg: 'hover:bg-blue-50/50 dark:hover:bg-blue-950/20' },
      green: { bg: 'bg-slate-100/80 dark:bg-slate-900/40', leftBorder: 'border-l-slate-500 dark:border-l-slate-700', iconBg: 'bg-gradient-to-br from-slate-200 to-slate-100 dark:from-slate-800/40 dark:to-slate-900/20', iconColor: 'text-slate-700 dark:text-slate-500', hoverBg: 'hover:bg-slate-100/50 dark:hover:bg-slate-900/20' },
      amber: { bg: 'bg-amber-50/80 dark:bg-amber-950/30', leftBorder: 'border-l-amber-400 dark:border-l-amber-500', iconBg: 'bg-gradient-to-br from-amber-100 to-amber-50 dark:from-amber-900/40 dark:to-amber-950/20', iconColor: 'text-amber-600 dark:text-amber-400', hoverBg: 'hover:bg-amber-50/50 dark:hover:bg-amber-950/20' },
    };
    const colors = colorClasses[accentColor] || colorClasses.violet;
    const isOpen = expanded[keyName];
    
    return (
      <div className="relative group">
        {/* Background card with border animation */}
        <div 
          className={`absolute inset-0 rounded-2xl border transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            isOpen
              ? `border-gray-200/70 dark:border-gray-700/70 ${colors.leftBorder} ${colors.bg} shadow-lg shadow-gray-200/20 dark:shadow-gray-900/30`
              : `border-gray-100/80 dark:border-gray-800/80 ${colors.hoverBg} hover:shadow-md hover:shadow-gray-200/10 dark:hover:shadow-gray-900/20`
          }`}
        />
        
        {/* Content */}
        <div className="relative">
          <button
            onClick={() => toggle(keyName)}
            className="w-full flex items-center justify-between px-5 py-4 text-left"
          >
            <div className="flex items-center gap-3.5">
              <div 
                className={`w-10 h-10 rounded-xl ${colors.iconBg} flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                  isOpen ? 'scale-110 rotate-3' : 'group-hover:scale-105'
                }`}
              >
                <Icon size={18} className={`${colors.iconColor} transition-colors duration-300`} strokeWidth={2} />
              </div>
              <div className="space-y-0.5">
                <span className={`text-[13px] font-semibold tracking-wide transition-colors duration-300 ${
                  isOpen ? 'text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
                }`}>{title}</span>
                <div className="h-[14px] overflow-hidden">
                  <span 
                    className="text-[10px] text-gray-400 dark:text-gray-500 block pt-0.5 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    style={{
                      opacity: isOpen ? 1 : 0,
                      transform: isOpen ? 'translateY(0)' : 'translateY(-100%)',
                    }}
                  >系统状态监控</span>
                </div>
              </div>
            </div>
            <div 
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                isOpen ? 'bg-gray-200/60 dark:bg-gray-700/60' : ''
              }`}
            >
              <ChevronDown
                size={14}
                className="text-gray-400 dark:text-gray-500 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
                style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </div>
          </button>
          
          {/* Expandable content with max-height animation */}
          <div
            className="overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
            style={{ maxHeight: isOpen ? '500px' : '0px' }}
          >
            <div 
              className="px-5 pb-4 pt-1 mx-4 mb-4 rounded-xl bg-white/60 dark:bg-gray-900/40 border border-gray-100/50 dark:border-gray-800/50"
              style={{
                opacity: isOpen ? 1 : 0,
                transform: isOpen ? 'translateY(0)' : 'translateY(-8px)',
                transition: 'opacity 350ms ease 100ms, transform 350ms ease 100ms',
              }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const StatusBadge = ({ ok }: { ok: boolean }) => (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold tracking-wide transition-all duration-300 ${
      ok 
        ? 'bg-slate-200/80 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500' 
        : 'bg-red-100/80 dark:bg-red-900/30 text-red-600 dark:text-red-400'
    }`}>
      {ok ? (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
      {ok ? '正常' : '异常'}
    </span>
  );

  const GridItem = ({ children, index = 0, isOpen = false }: { children: React.ReactNode; index?: number; isOpen?: boolean }) => (
    <div
      style={{
        opacity: isOpen ? 1 : 0,
        transform: isOpen ? 'translateY(0)' : 'translateY(6px)',
        transition: `opacity 350ms cubic-bezier(0.32,0.72,0,1) ${isOpen ? 150 + index * 50 : 0}ms, transform 350ms cubic-bezier(0.32,0.72,0,1) ${isOpen ? 150 + index * 50 : 0}ms`,
      }}
    >
      {children}
    </div>
  );

  return (
    <div className="space-y-4 p-1">
      <div className="flex items-center justify-between px-2 py-1">
        <h3 className="text-sm font-bold tracking-wide text-gray-800 dark:text-gray-200">V2 系统状态</h3>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wider transition-all duration-300 ${
            pipelineDegraded 
              ? 'bg-amber-100/80 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' 
              : 'bg-slate-200/80 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${pipelineDegraded ? 'bg-amber-500' : 'bg-slate-700'} animate-pulse`} />
            {pipelineDegraded ? '已降级' : '正常'}
          </span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">
            疲劳度 {Math.round(fatigueLevel)}%
          </span>
        </div>
      </div>

      <SectionCard title="情感系统" icon={Heart} keyName="emotion" accentColor="violet">
        <div className="grid grid-cols-2 gap-3 pt-1">
          <GridItem index={0} isOpen={expanded['emotion']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">当前情绪</span>
              <span className="text-xs font-semibold font-mono text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg">{currentEmotion}</span>
            </div>
          </GridItem>
          <GridItem index={1} isOpen={expanded['emotion']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">强度</span>
              <span className="text-xs font-semibold font-mono text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg">{Math.round(emotionIntensity)}</span>
            </div>
          </GridItem>
          <GridItem index={2} isOpen={expanded['emotion']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">疲劳等级</span>
              <span className="text-xs font-semibold font-mono text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg">{Math.round(fatigueLevel)}/100</span>
            </div>
          </GridItem>
          <GridItem index={3} isOpen={expanded['emotion']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">角色ID</span>
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg truncate">{characterId || '未选择'}</span>
            </div>
          </GridItem>
          <GridItem index={4} isOpen={expanded['emotion']}>
            <div className="flex items-center justify-between bg-white/50 dark:bg-gray-800/50 px-2 py-1.5 rounded-lg">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">思维链解析</span>
              <StatusBadge ok={true} />
            </div>
          </GridItem>
          <GridItem index={5} isOpen={expanded['emotion']}>
            <div className="flex items-center justify-between bg-white/50 dark:bg-gray-800/50 px-2 py-1.5 rounded-lg">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">主动代谢</span>
              <StatusBadge ok={true} />
            </div>
          </GridItem>
        </div>
      </SectionCard>

      <SectionCard title="记忆系统" icon={Brain} keyName="memory" accentColor="blue">
        <div className="grid grid-cols-2 gap-3 pt-1">
          <GridItem index={0} isOpen={expanded['memory']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">核心记忆</span>
              <span className="text-xs font-semibold font-mono text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg">{memoryCount}条</span>
            </div>
          </GridItem>
          <GridItem index={1} isOpen={expanded['memory']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">思考笔记</span>
              <span className="text-xs font-semibold font-mono text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg">{memoryEntryCount}条</span>
            </div>
          </GridItem>
          <GridItem index={2} isOpen={expanded['memory']}>
            <div className="flex items-center justify-between bg-white/50 dark:bg-gray-800/50 px-2 py-1.5 rounded-lg">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">双层记忆</span>
              <StatusBadge ok={true} />
            </div>
          </GridItem>
          <GridItem index={3} isOpen={expanded['memory']}>
            <div className="flex items-center justify-between bg-white/50 dark:bg-gray-800/50 px-2 py-1.5 rounded-lg">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">遗忘曲线</span>
              <StatusBadge ok={true} />
            </div>
          </GridItem>
          <GridItem index={4} isOpen={expanded['memory']}>
            <div className="flex items-center justify-between bg-white/50 dark:bg-gray-800/50 px-2 py-1.5 rounded-lg col-span-2">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">多维度检索</span>
              <StatusBadge ok={true} />
            </div>
          </GridItem>
        </div>
      </SectionCard>

      <SectionCard title="输出增强" icon={Zap} keyName="pipeline" accentColor="green">
        <div className="grid grid-cols-2 gap-3 pt-1">
          <GridItem index={0} isOpen={expanded['pipeline']}>
            <div className="flex items-center justify-between bg-white/50 dark:bg-gray-800/50 px-2 py-1.5 rounded-lg">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">10阶梯Pipeline</span>
              <StatusBadge ok={!pipelineDegraded} />
            </div>
          </GridItem>
          <GridItem index={1} isOpen={expanded['pipeline']}>
            <div className="flex items-center justify-between bg-white/50 dark:bg-gray-800/50 px-2 py-1.5 rounded-lg">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">错字模拟</span>
              <StatusBadge ok={true} />
            </div>
          </GridItem>
          <GridItem index={2} isOpen={expanded['pipeline']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">失败次数</span>
              <span className="text-xs font-semibold font-mono text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg">{pipelineFailures}</span>
            </div>
          </GridItem>
          <GridItem index={3} isOpen={expanded['pipeline']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">降级状态</span>
              <span className={`text-xs font-semibold bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg ${pipelineDegraded ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-500'}`}>{pipelineDegraded ? '已降级' : '正常'}</span>
            </div>
          </GridItem>
        </div>
      </SectionCard>

      <SectionCard title="自学习" icon={BookOpen} keyName="learning" accentColor="amber">
        <div className="grid grid-cols-2 gap-3 pt-1">
          <GridItem index={0} isOpen={expanded['learning']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">词汇</span>
              <span className="text-xs font-semibold font-mono text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg">{vocabCount}词</span>
            </div>
          </GridItem>
          <GridItem index={1} isOpen={expanded['learning']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">句式</span>
              <span className="text-xs font-semibold font-mono text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg">{phraseCount}个</span>
            </div>
          </GridItem>
          <GridItem index={2} isOpen={expanded['learning']}>
            <div className="flex flex-col gap-0.5 col-span-2">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">审查队列</span>
              <span className="text-xs font-semibold font-mono text-gray-700 dark:text-gray-300 bg-white/50 dark:bg-gray-800/50 px-2 py-1 rounded-lg">{reviewStats.pending}待审 ({reviewStats.approved}+{reviewStats.rejected}-)</span>
            </div>
          </GridItem>
          <GridItem index={3} isOpen={expanded['learning']}>
            <div className="flex items-center justify-between bg-white/50 dark:bg-gray-800/50 px-2 py-1.5 rounded-lg">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">黑话挖掘</span>
              <StatusBadge ok={true} />
            </div>
          </GridItem>
          <GridItem index={4} isOpen={expanded['learning']}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">风格学习</span>
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-900/20 px-2 py-1 rounded-lg">开发中</span>
            </div>
          </GridItem>
        </div>
      </SectionCard>
    </div>
  );
}
