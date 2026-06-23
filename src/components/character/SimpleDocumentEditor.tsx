import { useState } from 'react';
import { useCharacterStore } from '../../store/characterStore';
import { Character } from '../../types';
import { ArrowLeft, Save } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  character: Character;
  onClose: () => void;
}

export function SimpleDocumentEditor({ character, onClose }: Props) {
  const updateCharacter = useCharacterStore((s) => s.updateCharacter);
  const [name, setName] = useState(character.name);
  const [background, setBackground] = useState(character.background);

  const handleSave = () => {
    updateCharacter(character.id, {
      name,
      background,
      description: background.slice(0, 200),
    });
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed inset-0 z-50 bg-gray-50 dark:bg-gray-900 overflow-y-auto"
    >
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">编辑角色文档</h1>
              <p className="text-xs text-gray-500">修改角色名称和设定文档</p>
            </div>
          </div>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium transition-colors"
          >
            <Save size={16} />
            保存
          </button>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 shadow-sm space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">角色名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="角色名称"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">角色设定文档</label>
            <p className="text-[11px] text-gray-400 mb-2">此文档内容将作为AI的角色设定（System Prompt）</p>
            <textarea
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              className="w-full px-3 py-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500 resize-y"
              rows={30}
              placeholder="在此编辑角色设定文档..."
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
