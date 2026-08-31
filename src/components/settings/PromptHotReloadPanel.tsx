/**
 * Prompt 热更新 — 内容区
 * 纯内容组件，不含外层标题/折叠（由 ModuleSection 或父容器提供）。
 * 编辑即自动保存（zustand persist），下次发送消息时 Rust 后端会使用。
 */
import { Zap } from 'lucide-react';
import { usePromptConfigStore } from '../../store/promptConfigStore';
import { useCharacterStore } from '../../store/characterStore';

const PLACEHOLDERS = {
  customSystemPrompt: '例如：\n- 回复时多使用撒娇的语气\n- 当用户情绪低落时，主动提及你们一起经历过的回忆',
  customPersonality: '例如：\n性格：傲娇但藏不住关心\n说话风格：简短，偶尔嘴硬心软',
  customCareGuidance: '当用户表达强烈负面情绪时，优先陪伴与共情，不强行提供求助热线。',
  customEnvironmentAwareness: '留空则使用默认环境提示。',
};

const FIELD_DEFS = [
  { key: 'customSystemPrompt', label: '自定义系统指令', desc: '追加在 system prompt 末尾，最后生效。适合补充全局规则/语气偏好。' },
  { key: 'customPersonality', label: '自定义人格', desc: '覆盖内置性格/背景/说话风格。留空则使用角色自身设定。' },
  { key: 'customCareGuidance', label: '自定义关怀方式', desc: '覆盖内置【关怀方式】段落（危机关怀时如何回应）。留空则用内置默认。' },
  { key: 'customEnvironmentAwareness', label: '自定义环境意识', desc: '覆盖内置【环境意识】段落。留空则用内置默认（虚拟陪伴场景声明）。' },
] as const;

type FieldKey = (typeof FIELD_DEFS)[number]['key'];

/** setter 名映射：customSystemPrompt → setCustomSystemPrompt */
function setterName(k: FieldKey): string {
  return 'set' + k.charAt(0).toUpperCase() + k.slice(1);
}

export function PromptHotReloadPanel() {
  const store = usePromptConfigStore();
  const selectedChar = useCharacterStore((s) =>
    s.characters.find((c) => c.id === s.selectedCharacterId) || null,
  );

  const charName = selectedChar?.name;

  return (
    <div className="space-y-3">
      {/* 提示条 */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30">
        <Zap size={14} className="text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          这里的改动无需重启应用，编辑时自动保存到本地。下次发送消息时自定义内容会自动覆盖/追加到 system prompt。（作用于 Rust 后端管道的 prompt 构建，前端管道仍走 aiService）
        </p>
      </div>

      {/* 输入区 */}
      {FIELD_DEFS.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {f.label}
            {charName && (
              <span className="ml-1 text-[10px] text-gray-400 dark:text-gray-500">（当前：{charName}）</span>
            )}
          </label>
          <p className="text-[10px] text-gray-400 dark:text-gray-500">{f.desc}</p>
          <textarea
            value={(store as any)[f.key]}
            onChange={(e) => (store as any)[setterName(f.key)](e.target.value)}
            placeholder={PLACEHOLDERS[f.key]}
            rows={3}
            className="w-full px-3 py-2 rounded-xl text-xs leading-relaxed resize-none
              bg-gray-50 dark:bg-gray-800/50
              border border-gray-200 dark:border-gray-700/50
              text-gray-800 dark:text-gray-200
              placeholder-gray-300 dark:placeholder-gray-600
              focus:outline-none focus:ring-2 focus:ring-amber-300/50 focus:border-amber-300
              transition-all duration-200"
          />
        </div>
      ))}
    </div>
  );
}
