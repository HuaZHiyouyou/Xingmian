/**
 * ============================================================
 * V2 系统设置面板
 * 五个板块：输出增强、情感系统、记忆系统、自学习、输入与显示
 * 设计风格参考 ProactiveReplySection
 * ============================================================
 */

import { useState, useRef, useEffect } from 'react';
import type { ElementType } from 'react';
import { Settings, Zap, Heart, Brain, BookOpen, Monitor, Clock, Wifi, MessageSquare, ChevronDown } from 'lucide-react';
import { useConfigStore, V2SystemConfig } from '../../store/configStore';
import { useUIStore } from '../../store/uiStore';
import { useModelRoleStore, type SegmentMode } from '../../store/modelRoleStore';

// ---------- 动画辅助组件 ----------

function AnimateHeight({ open, children }: { open: boolean; children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(open ? undefined : 0);

  useEffect(() => {
    if (!contentRef.current) return () => {};
    if (open) {
      const h = contentRef.current.scrollHeight;
      setHeight(h);
      const timer = setTimeout(() => setHeight(undefined), 200);
      return () => { clearTimeout(timer); };
    } else {
      const h = contentRef.current.scrollHeight;
      setHeight(h);
      requestAnimationFrame(() => setHeight(0));
      return () => {};
    }
  }, [open]);

  return (
    <div
      className="overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
      style={{ height: height !== undefined ? `${height}px` : 'auto' }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}

function FadeIn({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`animate-[fadeIn_0.25s_ease-out] ${className || ''}`}>
      {children}
    </div>
  );
}

// ---------- 辅助组件 ----------

function ToggleRow({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer py-1.5 group rounded-lg px-2 -mx-2 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors duration-150">
      <div>
        <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors duration-150">{label}</span>
        {desc && <p className="text-xs text-gray-400 dark:text-gray-500">{desc}</p>}
      </div>
      <div className="relative shrink-0 ml-3">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
        <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
      </div>
    </label>
  );
}

function SliderRow({ label, value, min, max, step, unit, onChange, desc }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; desc?: string }) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
        <span className="text-xs text-slate-700 dark:text-slate-500 font-medium">{value}{unit || ''}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step || 1} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-slate-700"
      />
      {desc && <p className="text-[10px] text-gray-400 mt-0.5">{desc}</p>}
    </div>
  );
}

function SelectRow({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
      <div className="relative">
        <select value={value} onChange={e => onChange(e.target.value)} className="text-xs rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-2.5 pr-6 py-1 text-gray-700 dark:text-gray-300 appearance-none focus:outline-none focus:ring-1 focus:ring-slate-700 cursor-pointer">
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

function CollapsibleSection({ icon: Icon, title, subtitle, color, defaultOpen, children }: { icon: ElementType; title: string; subtitle?: string; color?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-all duration-150 active:scale-[0.98]"
      >
        <Icon size={16} className={color || 'text-slate-700 dark:text-slate-300'} />
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm text-gray-800 dark:text-gray-200">{title}</span>
          {subtitle && <p className="text-[10px] text-gray-400">{subtitle}</p>}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimateHeight open={open}>
        <div className="px-4 pb-3">{children}</div>
      </AnimateHeight>
    </div>
  );
}

// ---------- 主组件 ----------

export default function V2SettingsPanel() {
  const v2Config = useConfigStore(s => s.v2Config);
  const setV2Config = useConfigStore(s => s.setV2Config);
  const [activeTab, setActiveTab] = useState<'output' | 'emotion' | 'memory' | 'learning' | 'inputDisplay'>('output');

  // 输入与显示：从 uiStore 读写（保持向后兼容）
  const uiInputDebounce = useUIStore(s => s.inputDebounce);
  const uiInputDebounceMs = useUIStore(s => s.inputDebounceMs);
  const uiStreamResponse = useUIStore(s => s.streamResponse);
  const setUIStore = useUIStore.setState;

  // 分段回复：从 modelRoleStore 读写
  const segmentConfig = useModelRoleStore(s => s.segmentConfig);
  const setSegmentConfig = useModelRoleStore(s => s.setSegmentConfig);

  const update = (patch: Partial<V2SystemConfig>) => setV2Config(patch);

  const tabs = [
    { id: 'output' as const, icon: Zap, label: '输出增强' },
    { id: 'emotion' as const, icon: Heart, label: '情感系统' },
    { id: 'memory' as const, icon: Brain, label: '记忆系统' },
    { id: 'learning' as const, icon: BookOpen, label: '自学习' },
    { id: 'inputDisplay' as const, icon: Monitor, label: '输入与显示' },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 space-y-3
      animate-[fadeUp_0.3s_ease-out_both]">
      {/* 总开关 */}
      <div
        className="flex items-center justify-between px-1 cursor-pointer"
        onClick={() => update({ pipelineEnabled: !v2Config.pipelineEnabled })}
      >
        <div className="flex items-center gap-2.5">
          <Settings size={16} className="text-slate-700 dark:text-slate-300 transition-transform duration-200 hover:scale-110 hover:rotate-3" />
          <div>
            <span className="font-medium text-sm text-gray-800 dark:text-gray-200">Pipeline V2</span>
            <p className="text-[10px] text-gray-400">AI 回复后处理管线</p>
          </div>
        </div>
        <label className="relative cursor-pointer" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={v2Config.pipelineEnabled}
            onChange={(e) => update({ pipelineEnabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
        </label>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
              activeTab === tab.id
                ? 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-500 shadow-sm scale-[1.02]'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-white/50 dark:hover:bg-gray-700/50'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ==================== 输出增强 ==================== */}
      {activeTab === 'output' && (
        <FadeIn>
          <div className="space-y-2">
            <CollapsibleSection icon={Zap} title="Pipeline 步骤" subtitle="AI 回复文本处理流程" color="text-gray-500" defaultOpen={true}>
              <div className="space-y-1">
                <ToggleRow label="清洗标记" desc="移除 thought/feeling/action 标签" value={v2Config.cleanMarkers} onChange={v => update({ cleanMarkers: v })} />
                <ToggleRow label="错字模拟" desc={`${v2Config.typoProb}% 概率注入真实错字`} value={v2Config.typoSim} onChange={v => update({ typoSim: v })} />
                {v2Config.typoSim && (
                  <div className="pl-4 space-y-1 border-l-2 border-slate-300 dark:border-slate-900 ml-1">
                    <SliderRow label="错字概率" value={v2Config.typoProb} min={0} max={10} unit="%" onChange={v => update({ typoProb: v })} />
                    <SelectRow label="修正模式" value={v2Config.typoCorrection} options={[
                      { value: 'none', label: '不修正' },
                      { value: 'asterisk', label: '星号标注' },
                      { value: 'strikethrough', label: '删除线' },
                    ]} onChange={v => update({ typoCorrection: v as 'none' | 'asterisk' | 'strikethrough' })} />
                  </div>
                )}
                <ToggleRow label="语气微调" desc="根据情绪添加句首句末语气词" value={v2Config.tonePolish} onChange={v => update({ tonePolish: v })} />
                <ToggleRow label="长度随机化" desc="模拟真人聊天长度分布" value={v2Config.lengthRandomize} onChange={v => update({ lengthRandomize: v })} />
                <ToggleRow label="口语化注入" desc="语气词、重复字、省略号" value={v2Config.colloquialism} onChange={v => update({ colloquialism: v })} />
                <ToggleRow label="智能标点" desc="自然化标点使用" value={v2Config.smartPunctuation} onChange={v => update({ smartPunctuation: v })} />
                <ToggleRow label="说话节奏" desc="模拟自然停顿换行" value={v2Config.speakingRhythm} onChange={v => update({ speakingRhythm: v })} />
                <ToggleRow label="最终净化" desc="空白/换行/标点规范化" value={v2Config.finalSanitize} onChange={v => update({ finalSanitize: v })} />
              </div>
            </CollapsibleSection>

            <CollapsibleSection icon={MessageSquare} title="消息后处理" subtitle="去除 AI 腔和多余符号" color="text-slate-700 dark:text-slate-300" defaultOpen={false}>
              <div className="space-y-1">
                <ToggleRow label="启用消息后处理" value={v2Config.messageProcessingEnabled} onChange={v => update({ messageProcessingEnabled: v })} />

                {v2Config.messageProcessingEnabled && (
                  <>
                    <ToggleRow label="清洗思维链标记" desc="去除 <thinking>、括号注释等内部推理文字" value={v2Config.cleanThinkingMarkers} onChange={v => update({ cleanThinkingMarkers: v })} />
                    <ToggleRow label="拦截 AI 腔套话" desc={'"作为一个"、"首先/其次/最后"等模板化表达'} value={v2Config.blockAICliche} onChange={v => update({ blockAICliche: v })} />
                    <ToggleRow label="去除重复标点" desc='合并连续的"。！？，"等为合理数量' value={v2Config.removeDuplicatePunctuation} onChange={v => update({ removeDuplicatePunctuation: v })} />
                    <ToggleRow label="规范化空白与换行" desc="去除多余空格，保留段落换行" value={v2Config.normalizeWhitespace} onChange={v => update({ normalizeWhitespace: v })} />

                    <div className="pt-1">
                      <ToggleRow label="启用智能拦截" desc="检测复读、客服腔、人设崩塌、禁止项并丢弃" value={v2Config.enableIntercept} onChange={v => update({ enableIntercept: v })} />
                    </div>

                    {v2Config.enableIntercept && (
                      <div className="pl-4 space-y-1 border-l-2 border-slate-300 dark:border-slate-900 ml-1">
                        <ToggleRow label="拦截复读" desc="检测与最近回复高度相似的内容" value={v2Config.blockDuplicate} onChange={v => update({ blockDuplicate: v })} />
                        {v2Config.blockDuplicate && (
                          <SliderRow label="复读检测阈值" value={v2Config.duplicateThreshold} min={0.5} max={0.95} step={0.05} desc="越高越宽松，建议 0.75-0.90" onChange={v => update({ duplicateThreshold: v })} />
                        )}
                        <ToggleRow label="拦截客服腔" desc={'"作为一个AI"、"感谢您的理解"等'} value={v2Config.blockAICliche} onChange={v => update({ blockAICliche: v })} />
                        <ToggleRow label="拦截人设崩塌" desc={'"我是AI"、"我没有感情"等'} value={v2Config.blockPersonaCollapse} onChange={v => update({ blockPersonaCollapse: v })} />
                        <ToggleRow label="拦截禁止项" desc="角色设定中定义的禁止行为" value={v2Config.blockForbiddenViolation} onChange={v => update({ blockForbiddenViolation: v })} />
                      </div>
                    )}
                  </>
                )}
              </div>
            </CollapsibleSection>
          </div>
        </FadeIn>
      )}

      {/* ==================== 情感系统 ==================== */}
      {activeTab === 'emotion' && (
        <FadeIn>
          <CollapsibleSection icon={Heart} title="情感系统" subtitle="情绪推理与代谢" color="text-rose-500" defaultOpen={true}>
            <div className="space-y-1">
              <ToggleRow label="思维链情绪推理" desc="LLM 在标签内自主推理情绪" value={v2Config.thoughtChainEnabled} onChange={v => update({ thoughtChainEnabled: v })} />
              <ToggleRow label="主动情感代谢" desc="自动调节负值情绪、防止情绪累积" value={v2Config.activeMetabolism} onChange={v => update({ activeMetabolism: v })} />
              <SelectRow label="推理努力程度" value={v2Config.reasoningEffort} options={[
                { value: 'none', label: '不设置（默认）' },
                { value: 'low', label: '低（省 token）' },
                { value: 'medium', label: '中' },
                { value: 'high', label: '高（更深度）' },
              ]} onChange={v => update({ reasoningEffort: v as V2SystemConfig['reasoningEffort'] })} />
              {/* 🆕 #5 JSON 输出契约 */}
              <ToggleRow
                label="JSON 输出契约"
                desc="模型整体输出单个 JSON、系统直读字段（推荐弱模型开启；平台不支持时自动降级）"
                value={v2Config.jsonOutputMode !== false}
                onChange={v => update({ jsonOutputMode: v })}
              />
              <SliderRow label="情绪衰减速率" value={v2Config.decayMultiplier} min={0.1} max={3} step={0.1} unit="x" onChange={v => update({ decayMultiplier: v })} />
              <SliderRow label="语气微调入强度" value={v2Config.toneIntensity} min={0} max={100} unit="%" onChange={v => update({ toneIntensity: v })} />
            </div>
          </CollapsibleSection>
        </FadeIn>
      )}

      {/* ==================== 记忆系统 ==================== */}
      {activeTab === 'memory' && (
        <FadeIn>
          <CollapsibleSection icon={Brain} title="记忆系统" subtitle="双层记忆与遗忘曲线" color="text-amber-500" defaultOpen={true}>
            <div className="space-y-1">
              <ToggleRow label="双层记忆架构" desc="核心记忆 + 情节记忆分层存储" value={v2Config.dualLayerMemory} onChange={v => update({ dualLayerMemory: v })} />
              <ToggleRow label="遗忘曲线" desc="艾宾浩斯遗忘曲线自动管理记忆清晰度" value={v2Config.forgettingCurve} onChange={v => update({ forgettingCurve: v })} />
              <SliderRow label="记忆重要性阈值" value={v2Config.memoryImportanceThreshold} min={1} max={10} unit="/10" onChange={v => update({ memoryImportanceThreshold: v })} />
              <SliderRow label="最大召回数量" value={v2Config.maxRecallCount} min={1} max={15} unit="条" onChange={v => update({ maxRecallCount: v })} />
            </div>
          </CollapsibleSection>
        </FadeIn>
      )}

      {/* ==================== 自学习 ==================== */}
      {activeTab === 'learning' && (
        <FadeIn>
          <CollapsibleSection icon={BookOpen} title="自学习" subtitle="自动学习用户说话风格" color="text-slate-700 dark:text-slate-300" defaultOpen={true}>
            <div className="space-y-1">
              <ToggleRow label="自学习总开关" desc="启用后自动学习用户说话风格" value={v2Config.selfLearning} onChange={v => update({ selfLearning: v })} />
              <ToggleRow label="黑话挖掘" desc="自动发现高频非常见词汇" value={v2Config.jargonMining} onChange={v => update({ jargonMining: v })} />
              <ToggleRow label="风格学习" desc="学习语句模式和回复偏好" value={v2Config.styleLearning} onChange={v => update({ styleLearning: v })} />
              <ToggleRow label="自动审核" desc="学习结果自动通过（关闭则需人工审查）" value={v2Config.autoApprove} onChange={v => update({ autoApprove: v })} />
            </div>
          </CollapsibleSection>
        </FadeIn>
      )}

      {/* ==================== 输入与显示 ==================== */}
      {activeTab === 'inputDisplay' && (
        <FadeIn>
          <div className="space-y-2">
            <CollapsibleSection icon={Clock} title="等待输入" subtitle="避免消息碎片化" color="text-blue-500" defaultOpen={true}>
              <div className="space-y-1">
                <p className="text-xs text-gray-400 mb-1">开启后，按下回车不会立即发送，而是等待你停止输入后再一并发送</p>
                <ToggleRow label="启用等待输入" value={uiInputDebounce} onChange={v => {
                  setUIStore({ inputDebounce: v });
                  update({ inputDebounce: v });
                }} />
                {uiInputDebounce && (
                  <SliderRow
                    label="等待时间"
                    value={uiInputDebounceMs}
                    min={500}
                    max={3000}
                    step={250}
                    unit="ms"
                    onChange={v => {
                      setUIStore({ inputDebounceMs: v });
                      update({ inputDebounceMs: v });
                    }}
                  />
                )}
              </div>
            </CollapsibleSection>

            <CollapsibleSection icon={Wifi} title="流式输出" subtitle="逐字显示，响应更快" color="text-cyan-500" defaultOpen={true}>
              <div className="space-y-1">
                <p className="text-xs text-gray-400 mb-1">开启后 AI 回复将逐字显示，关闭则等待完整回复后一次性显示</p>
                <ToggleRow label="启用流式输出" value={uiStreamResponse} onChange={v => {
                  setUIStore({ streamResponse: v });
                  update({ streamResponse: v });
                }} />
              </div>
            </CollapsibleSection>

            <CollapsibleSection icon={MessageSquare} title="分段回复" subtitle="自动判断是否分段" color="text-slate-700 dark:text-slate-300" defaultOpen={true}>
              <div className="space-y-1">
                <p className="text-xs text-gray-400 mb-1">AI 根据场合自动判断是否分段，配置"回复长度顾问"模型决定分段策略</p>
                <ToggleRow label="启用分段回复" value={segmentConfig.enabled} onChange={v => setSegmentConfig({ enabled: v })} />
                <ToggleRow
                  label="合并消息模式"
                  desc="AI 回复不分段，多条内容合并进同一条气泡（优先级高于分段）"
                  value={segmentConfig.aiMergeMessages}
                  onChange={v => setSegmentConfig({ aiMergeMessages: v })}
                />

                {segmentConfig.enabled && (
                  <>
                    <SelectRow label="分段依据" value={segmentConfig.mode || 'smart'} options={[
                      { value: 'punctuation', label: '按标点符号' },
                      { value: 'sentence', label: '按句子' },
                      { value: 'paragraph', label: '按段落' },
                      { value: 'smart', label: '智能分段' },
                    ]} onChange={v => setSegmentConfig({ mode: v as SegmentMode })} />
                    <p className="text-[10px] text-gray-400">按标点：以。！？等断句；按句子：每句话一段；按段落：以换行分段；智能：段落+标点混合</p>

                    <SliderRow label="触发阈值" value={segmentConfig.threshold} min={10} max={200} step={5} unit="字" onChange={v => setSegmentConfig({ threshold: v })} />
                    <SliderRow label="单段最小长度" value={segmentConfig.minSegmentLength} min={5} max={40} unit="字" onChange={v => setSegmentConfig({ minSegmentLength: v })} />
                    <SliderRow label="最大段数" value={segmentConfig.maxSegments} min={2} max={30} unit="段" onChange={v => setSegmentConfig({ maxSegments: v })} />
                    <SliderRow label="段间延迟" value={segmentConfig.segmentDelayMs} min={200} max={3000} step={100} unit="ms" onChange={v => setSegmentConfig({ segmentDelayMs: v })} />

                    <SliderRow label="AI 回复延迟" value={segmentConfig.replyDelayMs} min={0} max={3000} step={100} unit="ms" desc="AI 收到消息后的思考等待时间，模拟真人回复节奏" onChange={v => setSegmentConfig({ replyDelayMs: v })} />

                    <ToggleRow label="随机延迟" desc="在回复延迟基础上额外增加随机等待" value={segmentConfig.replyDelayRandomEnabled} onChange={v => setSegmentConfig({ replyDelayRandomEnabled: v })} />
                    {segmentConfig.replyDelayRandomEnabled && (
                      <SliderRow label="随机延迟范围" value={segmentConfig.replyDelayRandomMs} min={100} max={2000} step={100} unit="ms" onChange={v => setSegmentConfig({ replyDelayRandomMs: v })} />
                    )}

                    <SliderRow label="用户回复延迟" value={segmentConfig.userReplyDelayMs} min={0} max={3000} step={100} unit="ms" desc="用户消息发出后的等待时间，模拟用户打字中的节奏" onChange={v => setSegmentConfig({ userReplyDelayMs: v })} />

                    <ToggleRow label="用户随机延迟" value={segmentConfig.userReplyDelayRandomEnabled} onChange={v => setSegmentConfig({ userReplyDelayRandomEnabled: v })} />
                    {segmentConfig.userReplyDelayRandomEnabled && (
                      <SliderRow label="用户随机延迟范围" value={segmentConfig.userReplyDelayRandomMs} min={100} max={2000} step={100} unit="ms" onChange={v => setSegmentConfig({ userReplyDelayRandomMs: v })} />
                    )}

                    {/* 🆕 A1 真实等待模拟：调制而非覆盖 */}
                    <ToggleRow label="真实等待模拟" desc="记录你在输入框外的真实等待时长，按 基础值+等待×20% 调制用户延迟（关闭时严格使用上方设置值）" value={segmentConfig.userWaitSimulateEnabled ?? false} onChange={v => setSegmentConfig({ userWaitSimulateEnabled: v })} />
                    {(segmentConfig.userWaitSimulateEnabled ?? false) && (
                      <SliderRow label="真实等待钳制上限" value={segmentConfig.userWaitClampMs ?? 5000} min={1000} max={15000} step={500} unit="ms" desc="调制后的延迟上限，防止异常等待值" onChange={v => setSegmentConfig({ userWaitClampMs: v })} />
                    )}

                    <ToggleRow label="保护成对符号" desc="引号/括号不被切断" value={segmentConfig.protectPairedSymbols} onChange={v => setSegmentConfig({ protectPairedSymbols: v })} />
                    <ToggleRow label="显示正在输入" desc="AI 回复前显示打字指示器" value={segmentConfig.showTypingIndicator} onChange={v => setSegmentConfig({ showTypingIndicator: v })} />
                  </>
                )}
              </div>
            </CollapsibleSection>
          </div>
        </FadeIn>
      )}
    </div>
  );
}