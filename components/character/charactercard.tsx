import { Character } from '../../types';
import { motion } from 'framer-motion';
import { useCharacterStore } from '../../store/characterStore';
import { useChatStore } from '../../store/chatStore';
import { useNavigate } from 'react-router-dom';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface Props {
  character: Character;
  index: number;
  onEdit?: () => void;
}

export function CharacterCard({ character, index, onEdit }: Props) {
  const selectedId = useCharacterStore((state) => state.selectedCharacterId);
  const selectCharacter = useCharacterStore((state) => state.selectCharacter);
  const deleteCharacter = useCharacterStore((state) => state.deleteCharacter);
  const createNew = useChatStore((state) => state.createNewConversation);
  const setCurrent = useChatStore((state) => state.setCurrentConversation);
  const navigate = useNavigate();
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const isSelected = character.id === selectedId;

  const handleSelect = () => {
    selectCharacter(character.id);
    const id = createNew(character.id);
    setCurrent(id);
    navigate('/chat');
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showConfirmDelete) {
      deleteCharacter(character.id);
      setShowConfirmDelete(false);
    } else {
      setShowConfirmDelete(true);
      setTimeout(() => setShowConfirmDelete(false), 3000);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ scale: 1.02 }}
      onClick={handleSelect}
      className={`
        relative cursor-pointer rounded-lg p-4 transition-all duration-200
        ${isSelected 
          ? 'bg-slate-100 dark:bg-slate-800/20 border border-slate-400 dark:border-slate-800' 
          : 'bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 border border-gray-200 dark:border-gray-700'}
      `}
    >
      {isSelected && (
        <div className="absolute top-3 right-3">
          <Check size={16} className="text-slate-700 dark:text-slate-500" />
        </div>
      )}
      
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-900/50 flex items-center justify-center flex-shrink-0">
          {character.avatar ? (
            <img src={character.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <span className="text-lg font-medium text-slate-700 dark:text-slate-400">
              {character.name.charAt(0)}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-0.5">{character.name}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
            {character.personality || character.description}
          </p>
          {character.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {character.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    isSelected 
                      ? 'bg-slate-200 dark:bg-slate-900/50 text-slate-800 dark:text-slate-400' 
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-2 right-2 flex gap-1">
        <button
          onClick={handleEdit}
          className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-all"
          style={{ opacity: 1 }}
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={handleDelete}
          className={`p-1.5 rounded-md transition-all ${
            showConfirmDelete 
              ? 'opacity-100 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' 
              : 'opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-red-500'
          }`}
          style={{ opacity: 1 }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </motion.div>
  );
}
