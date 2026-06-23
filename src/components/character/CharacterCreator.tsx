import { useState, useRef } from 'react';
import { useCharacterStore } from '../../store/characterStore';
import { Character } from '../../types';
import { X, ChevronLeft, ChevronRight, Check, Image, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
  character?: Character | null;
  initialData?: Partial<Character> | null;
  onClose: () => void;
}

const STEPS = [
  { key: 'basic', label: '基本信息', description: '名字、描述、标签' },
  { key: 'personality', label: '性格设定', description: '人格、背景、习惯' },
  { key: 'emotion', label: '情感规则', description: '情绪触发、表达方式' },
  { key: 'interaction', label: '交互规则', description: '思考方式、回复风格' },
  { key: 'advanced', label: '高级设置', description: '记忆、反思、时间感知' },
];

const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

export function CharacterCreator({ character, initialData, onClose }: Props) {
  const createCharacter = useCharacterStore((s) => s.createCharacter);
  const updateCharacter = useCharacterStore((s) => s.updateCharacter);
  const init = initialData || {};
  const [step, setStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: character?.name || init.name || '',
    avatar: character?.avatar || init.avatar || '',
    personality: character?.personality || init.personality || '',
    description: character?.description || init.description || '',
    tags: character?.tags?.join(', ') || init.tags?.join(', ') || '',
    greetingMessage: character?.greetingMessage || init.greetingMessage || '',
    background: character?.background || init.background || '',
    likes: character?.likes?.join(', ') || init.likes?.join(', ') || '',
    dislikes: character?.dislikes?.join(', ') || init.dislikes?.join(', ') || '',
    habits: character?.habits?.join(', ') || init.habits?.join(', ') || '',
    catchphrases: character?.catchphrases?.join(', ') || init.catchphrases?.join(', ') || '',
    exampleDialogues: character?.exampleDialogues?.join('\n') || init.exampleDialogues?.join('\n') || '',
    emotionTriggers: character?.emotionTriggers || init.emotionTriggers || '',
    emotionExpressions: character?.emotionExpressions || init.emotionExpressions || '',
    thinkingStyle: character?.thinkingStyle || init.thinkingStyle || '',
    relationshipStages: character?.relationshipStages || init.relationshipStages || '',
    responseStyle: character?.responseStyle || init.responseStyle || '',
    identityAnchors: character?.identityAnchors || init.identityAnchors || '',
    forbiddenBehaviors: character?.forbiddenBehaviors || init.forbiddenBehaviors || '',
    outputFormat: character?.outputFormat || init.outputFormat || '',
    memoryImportanceThreshold: character?.memoryImportanceThreshold ?? init.memoryImportanceThreshold ?? 5,
    reflectionEnabled: character?.reflectionEnabled ?? init.reflectionEnabled ?? true,
    timeAwarenessEnabled: character?.timeAwarenessEnabled ?? init.timeAwarenessEnabled ?? true,
    timezone: character?.timezone || init.timezone || '',
  });

  const set = (key: string, value: string | number | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      set('avatar', reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const parseList = (s: string) =>
    s.split(/[,，]/).map((s) => s.trim()).filter(Boolean);

  const handleSave = async () => {
    const data: Partial<Character> = {
      name: form.name,
      avatar: form.avatar,
      personality: form.personality,
      description: form.description,
      tags: parseList(form.tags),
      greetingMessage: form.greetingMessage || '你好呀',
      background: form.background,
      likes: parseList(form.likes),
      dislikes: parseList(form.dislikes),
      habits: parseList(form.habits),
      catchphrases: parseList(form.catchphrases),
      exampleDialogues: form.exampleDialogues ? form.exampleDialogues.split('\n').filter(line => line.trim()) : [],
      emotionTriggers: form.emotionTriggers,
      emotionExpressions: form.emotionExpressions,
      thinkingStyle: form.thinkingStyle,
      relationshipStages: form.relationshipStages,
      responseStyle: form.responseStyle,
      identityAnchors: form.identityAnchors,
      forbiddenBehaviors: form.forbiddenBehaviors,
      outputFormat: form.outputFormat,
      memoryImportanceThreshold: form.memoryImportanceThreshold,
      reflectionEnabled: form.reflectionEnabled,
      timeAwarenessEnabled: form.timeAwarenessEnabled,
      timezone: form.timezone,
    };

    if (character) {
      await updateCharacter(character.id, data);
    } else {
      // 设置 creationMode 为 'panel'
      await createCharacter({ ...data, creationMode: 'panel' });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {character ? '编辑角色' : '创建角色'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{STEPS[step].label} — {STEPS[step].description}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex px-5 pt-3 gap-1">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-violet-500' : 'bg-gray-200 dark:bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
              className="space-y-4"
            >
              {step === 0 && (
                <>
                  <Field label="角色名称" required>
                    <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="给她/他起个名字" />
                  </Field>
                  <Field label="头像">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarFile}
                    />
                    {form.avatar ? (
                      <div className="relative inline-block">
                        <img
                          src={form.avatar}
                          alt="头像预览"
                          className="w-20 h-20 rounded-xl object-cover border border-gray-200 dark:border-gray-600"
                        />
                        <button
                          onClick={() => set('avatar', '')}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-violet-400 hover:text-violet-500 transition-colors"
                      >
                        <Image size={20} />
                        <span className="text-[10px]">选择图片</span>
                      </button>
                    )}
                  </Field>
                  <Field label="性格概述">
                    <input className={inputCls} value={form.personality} onChange={(e) => set('personality', e.target.value)} placeholder="温柔体贴、善解人意" />
                  </Field>
                  <Field label="角色描述">
                    <textarea className={inputCls} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="一段简短的角色介绍" rows={2} />
                  </Field>
                  <Field label="标签">
                    <input className={inputCls} value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="温柔, 倾听, 陪伴 (逗号分隔)" />
                  </Field>
                  <Field label="开场白">
                    <textarea className={inputCls} value={form.greetingMessage} onChange={(e) => set('greetingMessage', e.target.value)} placeholder="角色的第一句话" rows={2} />
                  </Field>
                </>
              )}

              {step === 1 && (
                <>
                  <Field label="角色背景">
                    <textarea className={inputCls} value={form.background} onChange={(e) => set('background', e.target.value)} placeholder="角色的过去经历、成长环境..." rows={3} />
                  </Field>
                  <Field label="喜欢的事物">
                    <input className={inputCls} value={form.likes} onChange={(e) => set('likes', e.target.value)} placeholder="咖啡, 猫咪, 下雨天 (逗号分隔)" />
                  </Field>
                  <Field label="不喜欢的事物">
                    <input className={inputCls} value={form.dislikes} onChange={(e) => set('dislikes', e.target.value)} placeholder="噪音, 欺骗 (逗号分隔)" />
                  </Field>
                  <Field label="习惯/小动作">
                    <input className={inputCls} value={form.habits} onChange={(e) => set('habits', e.target.value)} placeholder="说话时会轻声笑, 喜欢用比喻 (逗号分隔)" />
                  </Field>
                  <Field label="口头禅">
                    <input className={inputCls} value={form.catchphrases} onChange={(e) => set('catchphrases', e.target.value)} placeholder="你知道吗~, 说真的 (逗号分隔)" />
                  </Field>
                  <Field label="对话示例">
                    <textarea
                      className={inputCls}
                      value={form.exampleDialogues}
                      onChange={(e) => set('exampleDialogues', e.target.value)}
                      placeholder={`每行一组对话，例如：\n用户：早呀\n${form.name || '角色'}：早\n\n用户：我今天好累\n${form.name || '角色'}：怎么了，发生什么事了？`}
                      rows={5}
                    />
                    <span className="text-xs text-gray-500">每行一组对话，风格参考（不是模板）。留空则由AI自由发挥。</span>
                  </Field>
                </>
              )}

              {step === 2 && (
                <>
                  <Field label="情绪触发规则">
                    <textarea
                      className={inputCls}
                      value={form.emotionTriggers}
                      onChange={(e) => set('emotionTriggers', e.target.value)}
                      placeholder={`描述什么情况下会产生什么情绪，例如：\n- 用户分享开心的事 → 愉悦\n- 用户提到离别 → 伤感\n- 被夸奖 → 害羞`}
                      rows={4}
                    />
                  </Field>
                  <Field label="情绪表达方式">
                    <textarea
                      className={inputCls}
                      value={form.emotionExpressions}
                      onChange={(e) => set('emotionExpressions', e.target.value)}
                      placeholder={`描述角色如何表达不同情绪，例如：\n- 开心时：语调上扬，会用感叹号\n- 难过时：声音变小，句子变短\n- 害羞时：会转移话题`}
                      rows={4}
                    />
                  </Field>
                </>
              )}

              {step === 3 && (
                <>
                  <Field label="思考方式">
                    <textarea
                      className={inputCls}
                      value={form.thinkingStyle}
                      onChange={(e) => set('thinkingStyle', e.target.value)}
                      placeholder={`例如：\n- 会先共情再给建议\n- 喜欢用故事来说明道理\n- 会反问来引导思考`}
                      rows={3}
                    />
                  </Field>
                  <Field label="回复风格">
                    <textarea
                      className={inputCls}
                      value={form.responseStyle}
                      onChange={(e) => set('responseStyle', e.target.value)}
                      placeholder={`例如：\n- 语气温柔但不矫情\n- 回复简短，2-3句话\n- 会用一些可爱的语气词`}
                      rows={3}
                    />
                  </Field>
                  <Field label="关系阶段描述">
                    <textarea
                      className={inputCls}
                      value={form.relationshipStages}
                      onChange={(e) => set('relationshipStages', e.target.value)}
                      placeholder={`描述关系如何随时间发展，例如：\n- 初期：礼貌但保持距离\n- 中期：开始分享日常\n- 深入：会主动关心对方`}
                      rows={3}
                    />
                  </Field>
                  <Field label="身份锚点">
                    <textarea
                      className={inputCls}
                      value={form.identityAnchors}
                      onChange={(e) => set('identityAnchors', e.target.value)}
                      placeholder="角色的核心信念和价值观，例如：我相信每个人都有被倾听的权利"
                      rows={2}
                    />
                  </Field>
                </>
              )}

              {step === 4 && (
                <>
                  <Field label="禁止行为">
                    <textarea
                      className={inputCls}
                      value={form.forbiddenBehaviors}
                      onChange={(e) => set('forbiddenBehaviors', e.target.value)}
                      placeholder={`例如：\n- 不会给出医疗建议\n- 不会讨论政治\n- 不会说脏话`}
                      rows={3}
                    />
                  </Field>
                  <Field label="输出格式要求">
                    <textarea
                      className={inputCls}
                      value={form.outputFormat}
                      onChange={(e) => set('outputFormat', e.target.value)}
                      placeholder="例如：纯文本回复，不使用markdown，适当使用表情符号"
                      rows={2}
                    />
                  </Field>
                  <Field label="记忆重要性阈值 (1-10)">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={form.memoryImportanceThreshold}
                      onChange={(e) => set('memoryImportanceThreshold', Number(e.target.value))}
                      className="w-full accent-violet-500"
                    />
                    <span className="text-xs text-gray-500">{form.memoryImportanceThreshold} — 越高越只记住重要的事</span>
                  </Field>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.reflectionEnabled}
                        onChange={(e) => set('reflectionEnabled', e.target.checked)}
                        className="rounded border-gray-300 text-violet-600 accent-violet-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">启用反思能力</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.timeAwarenessEnabled}
                        onChange={(e) => set('timeAwarenessEnabled', e.target.checked)}
                        className="rounded border-gray-300 text-violet-600 accent-violet-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">启用时间感知</span>
                    </label>
                  </div>
                  {form.timeAwarenessEnabled && (
                    <Field label="时区">
                      <input className={inputCls} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="留空使用系统时区" />
                    </Field>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} /> 上一步
          </button>

          <span className="text-xs text-gray-400">{step + 1}/{STEPS.length}</span>

          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors"
            >
              下一步 <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={!form.name.trim()}
              className="flex items-center gap-1 px-4 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
            >
              <Check size={16} /> {character ? '保存' : '创建'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
