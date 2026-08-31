import { useState, useRef, useEffect } from 'react';
import { useCharacterStore } from '../../store/characterStore';
import { Character } from '../../types';
import { X, ChevronLeft, ChevronRight, Check, Image, Trash2, Sparkles, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { dbGetAiLifeConfig, dbSaveAiLifeConfig, dbGetWorldConfigs, WorldConfigRecord } from '../../lib/tauriBridge';
import { BUILTIN_MODERN_WORLD_ID } from '../../services/ailife/worldConfig';

/**
 * ============================================================
 * 角色创建 / 编辑面板（分区注册表结构，便于扩展）
 *
 * 扩展方式：
 *  1. 新增字段   → 在 FormState 中加键，并在对应 SECTION 的 body 里追加控件；
 *  2. 新增分区   → 在 SECTIONS 注册表中 push 一个 { key, label, description, body }
 *                  条目即可，步骤条与前后台切换逻辑自动生效；
 *  3. 控件统一走 TextInput / TextArea / ListInput / SelectField，
 *                  新控件类型在文件底部追加通用组件后即可复用。
 * ============================================================
 */

interface Props {
  character?: Character | null;
  initialData?: Partial<Character> | null;
  onClose: () => void;
}

const inputCls = "w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-slate-700 transition-colors";

/** 🆕 下拉框统一样式：圆角 + 自定义箭头（原生 select 外观在各平台不一致，这里统一处理） */
const selectCls = "w-full appearance-none px-3 py-2 pr-9 rounded-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-slate-700 transition-colors cursor-pointer";

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <span className="text-xs text-gray-500 mt-1 block">{hint}</span>}
    </div>
  );
}

/* ---------------- 通用输入控件（新字段优先使用这些组件） ---------------- */

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} />;
}

/** 逗号分隔列表输入（保存时自动拆分为 string[]） */
function ListInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <TextInput value={value} onChange={onChange} placeholder={placeholder ? `${placeholder} (逗号分隔)` : undefined} />;
}

function SelectField({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="relative">
      <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
    </div>
  );
}

/* ---------------- 表单状态 ---------------- */

interface FormState {
  name: string;
  avatar: string;
  personality: string;
  description: string;
  tags: string;
  greetingMessage: string;
  background: string;
  likes: string;
  dislikes: string;
  habits: string;
  catchphrases: string;
  exampleDialogues: string;
  emotionTriggers: string;
  emotionExpressions: string;
  thinkingStyle: string;
  relationshipStages: string;
  responseStyle: string;
  identityAnchors: string;
  forbiddenBehaviors: string;
  outputFormat: string;
  memoryImportanceThreshold: number;
  reflectionEnabled: boolean;
  timeAwarenessEnabled: boolean;
  timezone: string;
}

function initForm(character?: Character | null, init?: Partial<Character>): FormState {
  const i = init || {};
  return {
    name: character?.name || i.name || '',
    avatar: character?.avatar || i.avatar || '',
    personality: character?.personality || i.personality || '',
    description: character?.description || i.description || '',
    tags: character?.tags?.join(', ') || i.tags?.join(', ') || '',
    greetingMessage: character?.greetingMessage || i.greetingMessage || '',
    background: character?.background || i.background || '',
    likes: character?.likes?.join(', ') || i.likes?.join(', ') || '',
    dislikes: character?.dislikes?.join(', ') || i.dislikes?.join(', ') || '',
    habits: character?.habits?.join(', ') || i.habits?.join(', ') || '',
    catchphrases: character?.catchphrases?.join(', ') || i.catchphrases?.join(', ') || '',
    exampleDialogues: character?.exampleDialogues?.join('\n') || i.exampleDialogues?.join('\n') || '',
    emotionTriggers: character?.emotionTriggers || i.emotionTriggers || '',
    emotionExpressions: character?.emotionExpressions || i.emotionExpressions || '',
    thinkingStyle: character?.thinkingStyle || i.thinkingStyle || '',
    relationshipStages: character?.relationshipStages || i.relationshipStages || '',
    responseStyle: character?.responseStyle || i.responseStyle || '',
    identityAnchors: character?.identityAnchors || i.identityAnchors || '',
    forbiddenBehaviors: character?.forbiddenBehaviors || i.forbiddenBehaviors || '',
    outputFormat: character?.outputFormat || i.outputFormat || '',
    memoryImportanceThreshold: character?.memoryImportanceThreshold ?? i.memoryImportanceThreshold ?? 5,
    reflectionEnabled: character?.reflectionEnabled ?? i.reflectionEnabled ?? true,
    timeAwarenessEnabled: character?.timeAwarenessEnabled ?? i.timeAwarenessEnabled ?? true,
    timezone: character?.timezone || i.timezone || '',
  };
}

export function CharacterCreator({ character, initialData, onClose }: Props) {
  const createCharacter = useCharacterStore((s) => s.createCharacter);
  const updateCharacter = useCharacterStore((s) => s.updateCharacter);
  const [step, setStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(() => initForm(character, initialData));

  const set = (key: string, value: string | number | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // ---------- AI 一日参数（存于 ai_life_config.extra.profile） ----------
  const [ailifeJob, setAilifeJob] = useState('');
  const [ailifeRoutine, setAilifeRoutine] = useState('');
  const [ailifeEngine, setAilifeEngine] = useState(false);
  const [ailifeWorldId, setAilifeWorldId] = useState(BUILTIN_MODERN_WORLD_ID);
  const [worlds, setWorlds] = useState<WorldConfigRecord[]>([]);

  useEffect(() => {
    if (!character?.id) return;
    dbGetAiLifeConfig(character.id).then((cfg) => {
      const profile = (cfg.extra?.profile && typeof cfg.extra.profile === 'object')
        ? cfg.extra.profile as { job?: string; routine?: string }
        : {};
      setAilifeJob(profile.job || '');
      setAilifeRoutine(profile.routine || '');
      setAilifeEngine(cfg.enabled);
      setAilifeWorldId((cfg.extra as { worldId?: string } | undefined)?.worldId || BUILTIN_MODERN_WORLD_ID);
    }).catch(() => {});
    dbGetWorldConfigs().then(setWorlds).catch(() => {});
  }, [character?.id]);

  const persistAilifeConfig = async () => {
    if (!character?.id) return;
    try {
      const cfg = await dbGetAiLifeConfig(character.id);
      const oldProfile = (cfg.extra?.profile && typeof cfg.extra.profile === 'object')
        ? cfg.extra.profile as Record<string, unknown>
        : {};
      await dbSaveAiLifeConfig({
        ...cfg,
        enabled: ailifeEngine,
        extra: {
          ...(cfg.extra || {}),
          worldId: ailifeWorldId,
          profile: { ...oldProfile, job: ailifeJob.trim(), routine: ailifeRoutine.trim() },
        },
        updatedAt: new Date().toISOString(),
      });
    } catch { /* 静默 */ }
  };

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
      await persistAilifeConfig();
    } else {
      // 设置 creationMode 为 'panel'
      await createCharacter({ ...data, creationMode: 'panel' });
    }
    onClose();
  };

  /* ============================================================
   * 🆕 分区注册表（扩展点）
   * 每个 SECTION 是一个独立分区：label/description 展示在步骤条，
   * body 渲染该分区全部字段。新增信息分区直接在此 push 即可。
   * ============================================================ */
  interface SectionCtx {
    form: FormState;
    set: (key: string, value: string | number | boolean) => void;
    /** 头像上传等特殊控件的辅助句柄 */
    fileInputRef: React.RefObject<HTMLInputElement>;
    onAvatarFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
    /** AI 一日参数（仅编辑已有角色时可用） */
    ailife: {
      job: string; setJob: (v: string) => void;
      routine: string; setRoutine: (v: string) => void;
      engine: boolean; setEngine: (v: boolean) => void;
      worldId: string; setWorldId: (v: string) => void;
      worlds: WorldConfigRecord[];
      hasCharacter: boolean;
    };
  }

  const SECTIONS: Array<{ key: string; label: string; description: string; body: (ctx: SectionCtx) => React.ReactNode }> = [
    {
      key: 'basic',
      label: '基本信息',
      description: '名字、描述、标签',
      body: ({ form: f, set: s, fileInputRef: fir, onAvatarFile }) => (
        <>
          <Field label="角色名称" required>
            <TextInput value={f.name} onChange={(v) => s('name', v)} placeholder="给她/他起个名字" />
          </Field>
          <Field label="头像">
            <input ref={fir} type="file" accept="image/*" className="hidden" onChange={onAvatarFile} />
            {f.avatar ? (
              <div className="relative inline-block">
                <img src={f.avatar} alt="头像预览" className="w-20 h-20 rounded-xl object-cover border border-gray-200 dark:border-gray-600" />
                <button
                  onClick={() => s('avatar', '')}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fir.current?.click()}
                className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center gap-1 text-gray-400 hover:border-slate-500 hover:text-slate-700 dark:text-slate-300 transition-colors"
              >
                <Image size={20} />
                <span className="text-[10px]">选择图片</span>
              </button>
            )}
          </Field>
          <Field label="性格概述">
            <TextInput value={f.personality} onChange={(v) => s('personality', v)} placeholder="温柔体贴、善解人意" />
          </Field>
          <Field label="角色描述">
            <TextArea value={f.description} onChange={(v) => s('description', v)} placeholder="一段简短的角色介绍" rows={2} />
          </Field>
          <Field label="标签">
            <ListInput value={f.tags} onChange={(v) => s('tags', v)} placeholder="温柔, 倾听, 陪伴" />
          </Field>
          <Field label="开场白">
            <TextArea value={f.greetingMessage} onChange={(v) => s('greetingMessage', v)} placeholder="角色的第一句话" rows={2} />
          </Field>
        </>
      ),
    },
    {
      key: 'personality',
      label: '性格设定',
      description: '人格、背景、习惯',
      body: ({ form: f, set: s }) => (
        <>
          <Field label="角色背景">
            <TextArea value={f.background} onChange={(v) => s('background', v)} placeholder="角色的过去经历、成长环境..." rows={3} />
          </Field>
          <Field label="喜欢的事物">
            <ListInput value={f.likes} onChange={(v) => s('likes', v)} placeholder="咖啡, 猫咪, 下雨天" />
          </Field>
          <Field label="不喜欢的事物">
            <ListInput value={f.dislikes} onChange={(v) => s('dislikes', v)} placeholder="噪音, 欺骗" />
          </Field>
          <Field label="习惯/小动作">
            <ListInput value={f.habits} onChange={(v) => s('habits', v)} placeholder="说话时会轻声笑, 喜欢用比喻" />
          </Field>
          <Field label="口头禅">
            <ListInput value={f.catchphrases} onChange={(v) => s('catchphrases', v)} placeholder="你知道吗~, 说真的" />
          </Field>
          <Field label="对话示例" hint="每行一组对话，风格参考（不是模板）。留空则由AI自由发挥。">
            <TextArea
              value={f.exampleDialogues}
              onChange={(v) => s('exampleDialogues', v)}
              placeholder={`每行一组对话，例如：\n用户：早呀\n${f.name || '角色'}：早\n\n用户：我今天好累\n${f.name || '角色'}：怎么了，发生什么事了？`}
              rows={5}
            />
          </Field>
        </>
      ),
    },
    {
      key: 'emotion',
      label: '情感规则',
      description: '情绪触发、表达方式',
      body: ({ form: f, set: s }) => (
        <>
          <Field label="情绪触发规则">
            <TextArea
              value={f.emotionTriggers}
              onChange={(v) => s('emotionTriggers', v)}
              placeholder={`描述什么情况下会产生什么情绪，例如：\n- 用户分享开心的事 → 愉悦\n- 用户提到离别 → 伤感\n- 被夸奖 → 害羞`}
              rows={4}
            />
          </Field>
          <Field label="情绪表达方式">
            <TextArea
              value={f.emotionExpressions}
              onChange={(v) => s('emotionExpressions', v)}
              placeholder={`描述角色如何表达不同情绪，例如：\n- 开心时：语调上扬，会用感叹号\n- 难过时：声音变小，句子变短\n- 害羞时：会转移话题`}
              rows={4}
            />
          </Field>
        </>
      ),
    },
    {
      key: 'interaction',
      label: '交互规则',
      description: '思考方式、回复风格',
      body: ({ form: f, set: s }) => (
        <>
          <Field label="思考方式">
            <TextArea
              value={f.thinkingStyle}
              onChange={(v) => s('thinkingStyle', v)}
              placeholder={`例如：\n- 会先共情再给建议\n- 喜欢用故事来说明道理\n- 会反问来引导思考`}
              rows={3}
            />
          </Field>
          <Field label="回复风格">
            <TextArea
              value={f.responseStyle}
              onChange={(v) => s('responseStyle', v)}
              placeholder={`例如：\n- 语气温柔但不矫情\n- 回复简短，2-3句话\n- 会用一些可爱的语气词`}
              rows={3}
            />
          </Field>
          <Field label="关系阶段描述">
            <TextArea
              value={f.relationshipStages}
              onChange={(v) => s('relationshipStages', v)}
              placeholder={`描述关系如何随时间发展，例如：\n- 初期：礼貌但保持距离\n- 中期：开始分享日常\n- 深入：会主动关心对方`}
              rows={3}
            />
          </Field>
          <Field label="身份锚点">
            <TextArea
              value={f.identityAnchors}
              onChange={(v) => s('identityAnchors', v)}
              placeholder="角色的核心信念和价值观，例如：我相信每个人都有被倾听的权利"
              rows={2}
            />
          </Field>
        </>
      ),
    },
    {
      key: 'advanced',
      label: '高级设置',
      description: '记忆、反思、时间感知',
      body: ({ form: f, set: s }) => (
        <>
          <Field label="禁止行为">
            <TextArea
              value={f.forbiddenBehaviors}
              onChange={(v) => s('forbiddenBehaviors', v)}
              placeholder={`例如：\n- 不会给出医疗建议\n- 不会讨论政治\n- 不会说脏话`}
              rows={3}
            />
          </Field>
          <Field label="输出格式要求">
            <TextArea
              value={f.outputFormat}
              onChange={(v) => s('outputFormat', v)}
              placeholder="例如：纯文本回复，不使用markdown，适当使用表情符号"
              rows={2}
            />
          </Field>
          <Field label="记忆重要性阈值 (1-10)">
            <input
              type="range"
              min={1}
              max={10}
              value={f.memoryImportanceThreshold}
              onChange={(e) => s('memoryImportanceThreshold', Number(e.target.value))}
              className="w-full accent-slate-700"
            />
            <span className="text-xs text-gray-500">{f.memoryImportanceThreshold} — 越高越只记住重要的事</span>
          </Field>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={f.reflectionEnabled}
                onChange={(e) => s('reflectionEnabled', e.target.checked)}
                className="rounded border-gray-300 text-slate-700 accent-slate-700"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">启用反思能力</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={f.timeAwarenessEnabled}
                onChange={(e) => s('timeAwarenessEnabled', e.target.checked)}
                className="rounded border-gray-300 text-slate-700 accent-slate-700"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">启用时间感知</span>
            </label>
          </div>
          {f.timeAwarenessEnabled && (
            <Field label="时区">
              <TextInput value={f.timezone} onChange={(v) => s('timezone', v)} placeholder="留空使用系统时区" />
            </Field>
          )}
        </>
      ),
    },
    {
      key: 'ailife',
      label: 'AI 一日',
      description: '职业、作息、生活引擎',
      body: ({ ailife }) =>
        ailife.hasCharacter ? (
          <>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-100 dark:bg-slate-800/20 border border-slate-300 dark:border-slate-900/50">
              <Sparkles size={14} className="text-slate-700 dark:text-slate-300 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-800 dark:text-slate-400 leading-relaxed">
                这些参数供「AI 一日生活」引擎使用：AI 会按职业与作息生成贴合人设的日程。
                也可以稍后在 AI 一日面板使用「初始创建」让 AI 全自动完成设定。
              </p>
            </div>
            <Field label="职业 / 身份">
              <TextInput value={ailife.job} onChange={ailife.setJob} placeholder="例如：自由插画师 / 大学生 / 咖啡店店员" />
            </Field>
            <Field label="作息说明">
              <TextArea value={ailife.routine} onChange={ailife.setRoutine}
                placeholder="例如：早睡早起型，工作日 9 点上班，周末喜欢睡懒觉和逛街" rows={3} />
            </Field>
            <Field label="世界设定包">
              <SelectField
                value={ailife.worldId}
                onChange={ailife.setWorldId}
                options={ailife.worlds.map((w) => ({ value: w.id, label: `${w.name}${w.isBuiltin ? '（内置）' : ''}` }))}
              />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={ailife.engine} onChange={(e) => ailife.setEngine(e.target.checked)}
                className="rounded border-gray-300 text-slate-700 accent-slate-700" />
              <span className="text-sm text-gray-700 dark:text-gray-300">保存后立即开启生活引擎</span>
            </label>
          </>
        ) : (
          <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900/60 border border-dashed border-gray-300 dark:border-gray-600 text-center">
            <Sparkles size={18} className="text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              保存角色后，回到这里即可配置 AI 一日参数（职业、作息、世界包）。<br />
              也可以在「AI 一日生活」面板使用「初始创建」，让 AI 一键完成全部设定。
            </p>
          </div>
        ),
    },
  ];

  const sectionCtx: SectionCtx = {
    form,
    set,
    fileInputRef,
    onAvatarFile: handleAvatarFile,
    ailife: {
      job: ailifeJob, setJob: setAilifeJob,
      routine: ailifeRoutine, setRoutine: setAilifeRoutine,
      engine: ailifeEngine, setEngine: setAilifeEngine,
      worldId: ailifeWorldId, setWorldId: setAilifeWorldId,
      worlds,
      hasCharacter: !!character?.id,
    },
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm">
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
            <p className="text-xs text-gray-500 mt-0.5">{SECTIONS[step].label} — {SECTIONS[step].description}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex px-5 pt-3 gap-1">
          {SECTIONS.map((sec, i) => (
            <div
              key={sec.key}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= step ? 'bg-slate-700' : 'bg-gray-200 dark:bg-gray-700'
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
              {SECTIONS[step].body(sectionCtx)}
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

          <span className="text-xs text-gray-400">{step + 1}/{SECTIONS.length}</span>

          {step < SECTIONS.length - 1 ? (
            <button
              onClick={() => setStep((s) => Math.min(SECTIONS.length - 1, s + 1))}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-slate-700 text-white hover:bg-slate-800 transition-colors"
            >
              下一步 <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={!form.name.trim()}
              className="flex items-center gap-1 px-4 py-1.5 text-sm rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              <Check size={16} /> {character ? '保存' : '创建'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
