import { motion } from 'framer-motion';
import { useCharacterStore } from '../../store/characterStore';
import { useChatStore } from '../../store/chatStore';

export function TypingIndicator() {
  const currentId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const characters = useCharacterStore((s) => s.characters);
  const pipelineStage = useChatStore((s) => s.pipelineStage);
  const conversation = conversations.find(c => c.id === currentId);
  const character = characters.find(c => c.id === conversation?.characterId);
  const charName = character?.name || 'AI';

  const statusText = pipelineStage || `${charName}正在输入中`;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-[5px] h-[5px] rounded-full bg-slate-500"
              animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                delay: i * 0.2,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
        <motion.span
          className="text-xs text-gray-400 dark:text-gray-500"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          {statusText}
        </motion.span>
      </div>
    </motion.div>
  );
}
