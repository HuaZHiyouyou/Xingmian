/**
 * ============================================================
 * 角色名片：用多种"文档模板"展示角色核心信息，帮助用户快速、清晰地认识 AI。
 *
 * 可扩展设计：模板统一注册在 CARD_TEMPLATES（id / 标签 / 图标 / 渲染函数）。
 * 新增类型（如"求职简历""毕业证书""角色名片"之外的体检报告、警察档案等）
 * 只需追加一个条目并实现 render(ctx)，无需改动弹层与切换逻辑。
 * ============================================================
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, IdCard, FileText, GraduationCap, Quote, MapPin, BriefcaseBusiness, Heart, Plus, Trash2, Check, Pencil } from 'lucide-react';
import { Character } from '../../types';
import { useCharacterMindStore } from '../../store/characterMindStore';
import { useCharacterStore } from '../../store/characterStore';
import { getDominantEmotion } from '../../utils/emotionAnalyzer';
import { emotionLabels, affinityStageLabels } from '../../utils/constants';
import { dbGetAiLifeConfig, dbSaveAiLifeConfig } from '../../lib/tauriBridge';
import { getWorldById } from '../../services/ailife/worldConfig';

/** 名片渲染上下文：聚合角色静态字段 + 生活引擎/心智数据，新增数据源时在此扩展 */
export interface ProfileCardContext {
  character: Character;
  job: string;
  worldName: string;
  affinityLabel: string;
  emotionLabel: string;
  /** 🆕 用户自定义扩展字段（名片/简历等模板中会展示） */
  customFields: CustomField[];
}

/** 🆕 自定义扩展字段：用户可自行添加/删除。
 *  存储：SQLite（ai_life_config.extra.profileCardCustomFields）为主，
 *  localStorage 仅作打开弹窗时的即时缓存，DB 读取后覆盖。 */
export interface CustomField {
  id: string;
  label: string;
  value: string;
}

const CUSTOM_FIELDS_CACHE_PREFIX = 'profile-card-custom-fields:';
const CUSTOM_FIELDS_EXTRA_KEY = 'profileCardCustomFields';

function loadCustomFieldsCache(characterId: string): CustomField[] {
  try {
    const raw = localStorage.getItem(CUSTOM_FIELDS_CACHE_PREFIX + characterId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((f) => f && typeof f.label === 'string' && typeof f.value === 'string') : [];
  } catch {
    return [];
  }
}

function saveCustomFieldsCache(characterId: string, fields: CustomField[]) {
  try {
    localStorage.setItem(CUSTOM_FIELDS_CACHE_PREFIX + characterId, JSON.stringify(fields));
  } catch { /* ignore */ }
}

/** 从 extra 对象解析自定义字段（容错） */
function loadCustomFieldsFromExtra(extra: Record<string, unknown> | undefined): CustomField[] {
  const raw = extra?.[CUSTOM_FIELDS_EXTRA_KEY];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter((f): f is CustomField =>
    !!f && typeof f === 'object' && typeof (f as CustomField).label === 'string' && typeof (f as CustomField).value === 'string'
  );
}

/** 写入 SQLite（合并进现有 extra，不覆盖其它键） */
async function saveCustomFieldsToDb(characterId: string, fields: CustomField[]): Promise<void> {
  const cfg = await dbGetAiLifeConfig(characterId);
  await dbSaveAiLifeConfig({
    ...cfg,
    extra: { ...(cfg.extra || {}), [CUSTOM_FIELDS_EXTRA_KEY]: fields },
    updatedAt: new Date().toISOString(),
  });
}

interface CardTemplate {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** 模板描述（切换 Tab 下的小字说明） */
  description: string;
  render: (ctx: ProfileCardContext) => React.ReactNode;
}

const HAND_FONT = "'LXGW WenKai', 'Kaiti SC', 'KaiTi', cursive";

/* ---------------- 模板一：社交名片 ---------------- */

const NameCardTemplate: React.FC<{ ctx: ProfileCardContext }> = ({ ctx }) => {
  const { character: c } = ctx;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-700 via-slate-700 to-slate-700 p-6 text-white shadow-xl">
      <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
      <div className="absolute -bottom-10 -left-6 w-28 h-28 rounded-full bg-white/10" />
      <div className="relative flex items-start gap-4">
        <div className="w-16 h-16 rounded-2xl overflow-hidden bg-white/20 flex items-center justify-center text-2xl font-bold shrink-0 shadow-lg">
          {c.avatar ? <img src={c.avatar} alt={c.name} className="w-full h-full object-cover" /> : c.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold">{c.name}</h3>
          {ctx.job && (
            <p className="text-xs opacity-90 mt-0.5 flex items-center gap-1"><BriefcaseBusiness size={11} />{ctx.job}</p>
          )}
          {ctx.worldName && (
            <p className="text-xs opacity-75 mt-0.5 flex items-center gap-1"><MapPin size={11} />{ctx.worldName}</p>
          )}
        </div>
      </div>
      {c.personality && (
        <p className="relative text-sm leading-relaxed mt-4 opacity-95 line-clamp-3">{c.personality}</p>
      )}
      {(c.tags.length > 0 || ctx.affinityLabel) && (
        <div className="relative flex flex-wrap gap-1.5 mt-3">
          {ctx.affinityLabel && (
            <span className="px-2 py-0.5 rounded-full bg-white/20 text-[10px]">关系 · {ctx.affinityLabel}</span>
          )}
          {c.tags.slice(0, 5).map((t) => (
            <span key={t} className="px-2 py-0.5 rounded-full bg-white/15 text-[10px]">{t}</span>
          ))}
        </div>
      )}
      {c.catchphrases.length > 0 && (
        <p className="relative text-xs italic opacity-90 mt-3 flex items-start gap-1">
          <Quote size={11} className="mt-0.5 shrink-0" />
          {c.catchphrases[0]}
        </p>
      )}
      {/* 🆕 自定义扩展字段 */}
      {ctx.customFields.length > 0 && (
        <div className="relative mt-3 pt-3 space-y-1">
          {ctx.customFields.map((f) => (
            <p key={f.id} className="text-xs opacity-90 flex gap-2">
              <span className="shrink-0 font-medium">{f.label}</span>
              <span className="opacity-80 truncate">{f.value}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

/* ---------------- 模板二：求职简历 ---------------- */

function ResumeSection({ title, children }: { title: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-500 uppercase tracking-wide mb-1">{title}</h4>
      <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed space-y-1">{children}</div>
    </div>
  );
}

const ResumeTemplate: React.FC<{ ctx: ProfileCardContext }> = ({ ctx }) => {
  const { character: c } = ctx;
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-4 shadow-sm">
      {/* 简历抬头 */}
      <div className="flex items-center gap-4 pb-3 border-b border-gray-200 dark:border-gray-700">
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-800/30 flex items-center justify-center text-xl font-bold text-slate-700 dark:text-slate-400 shrink-0">
          {c.avatar ? <img src={c.avatar} alt={c.name} className="w-full h-full object-cover" /> : c.name.charAt(0)}
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{c.name}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            求职意向：{ctx.job || (c.personality ? `${c.personality.slice(0, 12)}…` : '待定')}
          </p>
          {c.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {c.tags.slice(0, 6).map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/20 text-[10px] text-slate-700 dark:text-slate-400">{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      <ResumeSection title="个人优势">
        {c.personality || '——'}
        {c.thinkingStyle && <p className="text-xs text-gray-500 dark:text-gray-400">思考方式：{c.thinkingStyle}</p>}
      </ResumeSection>

      {c.likes.length > 0 && (
        <ResumeSection title="兴趣爱好">
          <div className="flex flex-wrap gap-1.5">
            {c.likes.map((like) => (
              <span key={like} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-pink-50 dark:bg-pink-900/20 text-[11px] text-pink-600 dark:text-pink-300">
                <Heart size={10} />{like}
              </span>
            ))}
          </div>
        </ResumeSection>
      )}

      {c.habits.length > 0 && (
        <ResumeSection title="工作习惯">
          <ul className="list-disc list-inside text-xs space-y-0.5">
            {c.habits.map((h) => <li key={h}>{h}</li>)}
          </ul>
        </ResumeSection>
      )}

      {c.description && (
        <ResumeSection title="自我评价">
          <p className="text-xs line-clamp-4">{c.description}</p>
        </ResumeSection>
      )}

      {ctx.worldName && (
        <ResumeSection title="期望工作地点">
          <span className="inline-flex items-center gap-1 text-xs"><MapPin size={11} />{ctx.worldName}</span>
        </ResumeSection>
      )}

      {/* 🆕 自定义扩展字段 */}
      {ctx.customFields.length > 0 && (
        <ResumeSection title="附加信息">
          <div className="space-y-1">
            {ctx.customFields.map((f) => (
              <p key={f.id} className="text-xs flex gap-2">
                <span className="shrink-0 font-medium text-gray-500 dark:text-gray-400">{f.label}</span>
                <span className="text-gray-700 dark:text-gray-300 break-all">{f.value}</span>
              </p>
            ))}
          </div>
        </ResumeSection>
      )}
    </div>
  );
};

/* ---------------- 模板三：毕业证书 ---------------- */

const DiplomaTemplate: React.FC<{ ctx: ProfileCardContext }> = ({ ctx }) => {
  const { character: c } = ctx;
  const today = new Date();
  const dateStr = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;
  return (
    <div
      className="relative rounded-2xl p-1 bg-gradient-to-br from-amber-300 via-yellow-200 to-amber-400 shadow-lg"
      style={{ fontFamily: HAND_FONT }}
    >
      <div className="rounded-xl border-2 border-double border-amber-600/60 bg-[#fffbeb] dark:bg-amber-950/40 px-6 py-8 text-center relative overflow-hidden">
        <GraduationCap size={34} className="mx-auto text-amber-600 dark:text-amber-400 mb-2" />
        <h3 className="text-2xl font-bold tracking-[0.3em] text-amber-800 dark:text-amber-300 mb-1">毕业证书</h3>
        <p className="text-[11px] text-amber-700/70 dark:text-amber-500/70 mb-5">CERTIFICATE OF GRADUATION</p>

        <p className="text-sm text-gray-700 dark:text-gray-300 leading-loose">
          兹证明
          <span className="text-lg font-bold text-amber-700 dark:text-amber-300 mx-1">{c.name}</span>
          同学已完成「人设设定」全部课程，
          <br />
          性格品行：<span className="text-amber-700 dark:text-amber-300">{c.personality || '性格鲜明'}</span>，
          顺利毕业。
        </p>

        {c.background && (
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-4 line-clamp-3 px-4">
            在校经历：{c.background}
          </p>
        )}

        <div className="flex items-end justify-between mt-8 text-xs text-gray-500 dark:text-gray-400">
          <span>颁发日期：{dateStr}</span>
          <span className="italic">{ctx.worldName || '星眠学院'} · 盖章</span>
        </div>

        <div className="absolute bottom-3 right-6 w-14 h-14 rounded-full border-2 border-red-400/60 flex items-center justify-center rotate-[-12deg] opacity-70">
          <span className="text-[9px] text-red-500 font-bold">合格</span>
        </div>
      </div>
    </div>
  );
};

/* ---------------- 模板注册表（扩展点：在此追加新模板） ---------------- */

export const CARD_TEMPLATES: CardTemplate[] = [
  {
    id: 'namecard',
    label: '角色名片',
    icon: <IdCard size={13} />,
    description: '快速认识：头像、职业、性格关键词与口头禅',
    render: (ctx) => <NameCardTemplate ctx={ctx} />,
  },
  {
    id: 'resume',
    label: '求职简历',
    icon: <FileText size={13} />,
    description: '以简历视角查看角色的优势、兴趣与习惯',
    render: (ctx) => <ResumeTemplate ctx={ctx} />,
  },
  {
    id: 'diploma',
    label: '毕业证书',
    icon: <GraduationCap size={13} />,
    description: '趣味向：为角色颁发一张人设毕业证书',
    render: (ctx) => <DiplomaTemplate ctx={ctx} />,
  },
];

/* ---------------- 弹层 ---------------- */

export function CharacterProfileCardModal({ character, onClose }: {
  character: Character;
  onClose: () => void;
}) {
  const updateCharacter = useCharacterStore((s) => s.updateCharacter);
  const [templateId, setTemplateId] = useState(CARD_TEMPLATES[0]?.id || '');
  const [job, setJob] = useState('');
  const [worldName, setWorldName] = useState('');
  // 自定义扩展字段（添加 / 编辑 / 删除；SQLite 持久化，localStorage 即时缓存）
  const [customFields, setCustomFields] = useState<CustomField[]>(() => loadCustomFieldsCache(character.id));
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  // 🆕 资料编辑模式：可直接修改名片展示的核心内容
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: character.name,
    personality: character.personality,
    description: character.description,
    tags: character.tags.join(', '),
    job: '',
  });
  // 🆕 自定义字段行内编辑
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [editFieldLabel, setEditFieldLabel] = useState('');
  const [editFieldValue, setEditFieldValue] = useState('');
  const affinityState = useCharacterMindStore((s) => character.id ? s.affinityStates[character.id] : undefined);
  const multiEmotion = useCharacterMindStore((s) => character.id ? s.multiEmotions[character.id] : undefined);

  // 加载生活引擎档案（职业 / 世界名）+ 自定义字段（SQLite 为主，缓存兜底）
  useEffect(() => {
    let active = true;
    dbGetAiLifeConfig(character.id).then((cfg) => {
      if (!active) return;
      const profile = (cfg.extra?.profile && typeof cfg.extra.profile === 'object')
        ? cfg.extra.profile as { job?: string }
        : {};
      setJob(profile.job || '');
      setEditForm((prev) => ({ ...prev, job: profile.job || '' }));
      const dbFields = loadCustomFieldsFromExtra(cfg.extra);
      setCustomFields(dbFields);
      saveCustomFieldsCache(character.id, dbFields);
      const worldId = (cfg.extra as { worldId?: string } | undefined)?.worldId;
      if (worldId) {
        getWorldById(worldId).then((world) => {
          if (active && world) setWorldName(world.name);
        }).catch(() => {});
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [character.id]);

  /** 统一持久化自定义字段（缓存 + SQLite） */
  const persistCustomFields = (next: CustomField[]) => {
    setCustomFields(next);
    saveCustomFieldsCache(character.id, next);
    saveCustomFieldsToDb(character.id, next).catch(() => {});
  };

  /** 🆕 保存资料编辑（角色字段 → characterStore/DB；职业 → ai_life_config.extra.profile） */
  const saveProfileEdit = async () => {
    const name = editForm.name.trim();
    if (!name) return;
    const tags = editForm.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    await updateCharacter(character.id, {
      name,
      personality: editForm.personality.trim(),
      description: editForm.description.trim(),
      tags,
    });
    const trimmedJob = editForm.job.trim();
    if (trimmedJob !== job) {
      setJob(trimmedJob);
      try {
        const cfg = await dbGetAiLifeConfig(character.id);
        const oldProfile = (cfg.extra?.profile && typeof cfg.extra.profile === 'object')
          ? cfg.extra.profile as Record<string, unknown>
          : {};
        await dbSaveAiLifeConfig({
          ...cfg,
          extra: { ...(cfg.extra || {}), profile: { ...oldProfile, job: trimmedJob } },
          updatedAt: new Date().toISOString(),
        });
      } catch { /* 静默 */ }
    }
    setEditing(false);
  };

  /** 添加自定义字段 */
  const addCustomField = () => {
    const label = newFieldLabel.trim();
    const value = newFieldValue.trim();
    if (!label || !value) return;
    const field: CustomField = { id: `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, label, value };
    persistCustomFields([...customFields, field]);
    setNewFieldLabel('');
    setNewFieldValue('');
  };

  /** 删除自定义字段 */
  const removeCustomField = (id: string) => {
    persistCustomFields(customFields.filter((f) => f.id !== id));
    if (editingFieldId === id) setEditingFieldId(null);
  };

  /** 🆕 开始行内编辑自定义字段 */
  const startEditField = (f: CustomField) => {
    setEditingFieldId(f.id);
    setEditFieldLabel(f.label);
    setEditFieldValue(f.value);
  };

  /** 🆕 保存行内编辑 */
  const saveEditField = () => {
    if (!editingFieldId) return;
    const label = editFieldLabel.trim();
    const value = editFieldValue.trim();
    if (!label || !value) return;
    persistCustomFields(customFields.map((f) => (f.id === editingFieldId ? { ...f, label, value } : f)));
    setEditingFieldId(null);
  };

  const dominant = multiEmotion ? getDominantEmotion(multiEmotion) : null;
  const ctx: ProfileCardContext = {
    character,
    job,
    worldName,
    affinityLabel: affinityState ? (affinityStageLabels[affinityState.stage] || affinityState.stage) : '',
    emotionLabel: dominant ? (emotionLabels[dominant.type] || dominant.type) : '',
    customFields,
  };

  const activeTemplate = CARD_TEMPLATES.find((t) => t.id === templateId) || CARD_TEMPLATES[0];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-gray-50 dark:bg-gray-900 shadow-2xl"
        >
          {/* 头部 */}
          <div className="sticky top-0 z-10 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur px-5 pt-4 pb-3">
            <div className="flex items-center gap-2">
              <IdCard size={16} className="text-slate-700 dark:text-slate-300" />
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">角色名片</h3>
              <div className="ml-auto flex items-center gap-1.5">
                {!editing && (
                  <button
                    onClick={() => { setEditForm({ name: character.name, personality: character.personality, description: character.description, tags: character.tags.join(', '), job }); setEditing(true); }}
                    title="修改名片内容"
                    className="px-2.5 py-1 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    编辑资料
                  </button>
                )}
                <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* 🆕 编辑模式：直接修改名片核心内容 */}
            {editing ? (
              <div className="mt-3 space-y-2 animate-[fadeIn_0.15s_ease-out]">
                <div className="grid grid-cols-2 gap-2">
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="名字"
                    className="px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-slate-500" />
                  <input value={editForm.job} onChange={(e) => setEditForm({ ...editForm, job: e.target.value })}
                    placeholder="职业 / 身份"
                    className="px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-slate-500" />
                </div>
                <input value={editForm.personality} onChange={(e) => setEditForm({ ...editForm, personality: e.target.value })}
                  placeholder="性格概述"
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-slate-500" />
                <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="角色描述" rows={2}
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-slate-500 resize-none" />
                <input value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                  placeholder="标签（逗号分隔）"
                  className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-slate-500" />
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button onClick={() => setEditing(false)}
                    className="px-3 py-1.5 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                    取消
                  </button>
                  <button onClick={saveProfileEdit} disabled={!editForm.name.trim()}
                    className="px-3 py-1.5 rounded-lg text-[11px] text-white bg-slate-700 hover:bg-slate-800 disabled:opacity-40 transition-colors">
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* 模板切换 Tabs（由 CARD_TEMPLATES 驱动，自动扩展） */}
                <div className="flex items-center gap-1.5 mt-3">
                  {CARD_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full transition-colors ${
                        t.id === templateId
                          ? 'bg-slate-700 text-white shadow-sm'
                          : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:text-slate-700'
                      }`}
                    >
                      {t.icon}{t.label}
                    </button>
                  ))}
                </div>
                {activeTemplate?.description && (
                  <p className="text-[10px] text-gray-400 mt-1.5">{activeTemplate.description}</p>
                )}
              </>
            )}
          </div>

          {/* 卡片内容（编辑模式下隐藏） */}
          {!editing && (
            <div className="px-5 pb-5">
              {activeTemplate?.render(ctx)}

              {/* 自定义内容：添加 / 编辑 / 删除（SQLite 持久化，名片与简历模板中展示） */}
              <div className="mt-4 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 p-3">
                <button
                  onClick={() => setShowFieldEditor((v) => !v)}
                  className="w-full flex items-center gap-1.5 text-left"
                >
                  <Plus size={12} className="text-slate-700 dark:text-slate-300" />
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-300">自定义内容（{customFields.length}）</span>
                  <span className="ml-auto text-[10px] text-gray-400">{showFieldEditor ? '收起' : '展开管理'}</span>
                </button>

                {showFieldEditor && (
                  <div className="mt-2.5 space-y-2 animate-[fadeIn_0.15s_ease-out]">
                    {customFields.length === 0 && (
                      <p className="text-[10px] text-gray-400">暂无自定义内容。添加后会展示在名片与简历模板中。</p>
                    )}
                    {customFields.map((f) => (
                      <div key={f.id} className="flex items-center gap-2 group">
                        {editingFieldId === f.id ? (
                          <>
                            <input value={editFieldLabel} onChange={(e) => setEditFieldLabel(e.target.value)}
                              placeholder="名称"
                              className="w-20 px-2 py-1 rounded-lg text-[11px] bg-white dark:bg-gray-800 border border-slate-400 dark:border-slate-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-slate-500" />
                            <input value={editFieldValue} onChange={(e) => setEditFieldValue(e.target.value)}
                              placeholder="内容"
                              className="flex-1 min-w-0 px-2 py-1 rounded-lg text-[11px] bg-white dark:bg-gray-800 border border-slate-400 dark:border-slate-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-slate-500"
                              onKeyDown={(e) => { if (e.key === 'Enter') saveEditField(); }} />
                            <button onClick={saveEditField} title="保存"
                              className="p-1 rounded text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/20 transition-all shrink-0">
                              <Check size={12} />
                            </button>
                            <button onClick={() => setEditingFieldId(null)} title="取消"
                              className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all shrink-0">
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/30 text-slate-700 dark:text-slate-400 shrink-0">
                              {f.label}
                            </span>
                            <span className="flex-1 min-w-0 text-xs text-gray-700 dark:text-gray-300 truncate">{f.value}</span>
                            <button onClick={() => startEditField(f)} title="编辑此条"
                              className="p-1 rounded text-gray-400 hover:text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/20 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                              <Pencil size={11} />
                            </button>
                            <button onClick={() => removeCustomField(f.id)} title="删除此条"
                              className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                              <Trash2 size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}

                    {/* 添加表单 */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <input
                        value={newFieldLabel}
                        onChange={(e) => setNewFieldLabel(e.target.value)}
                        placeholder="名称（如：生日）"
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-500"
                      />
                      <input
                        value={newFieldValue}
                        onChange={(e) => setNewFieldValue(e.target.value)}
                        placeholder="内容"
                        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-slate-500"
                        onKeyDown={(e) => { if (e.key === 'Enter') addCustomField(); }}
                      />
                      <button
                        onClick={addCustomField}
                        disabled={!newFieldLabel.trim() || !newFieldValue.trim()}
                        title="添加"
                        className="p-1.5 rounded-lg bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 transition-all active:scale-95 shrink-0"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
