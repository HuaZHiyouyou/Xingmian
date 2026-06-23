
import { useState, useRef } from 'react';
import { useLearningStore } from '../../store/learningStore';
import { useCharacterStore } from '../../store/characterStore';
import { BookOpen, Trash2, Download, Upload, AlertTriangle } from 'lucide-react';

export function LearningPanel() {
  const profiles = useLearningStore((s) => s.profiles);
  const clearCharacter = useLearningStore((s) => s.clearCharacter);
  const characters = useCharacterStore((s) => s.characters);
  const updateProfile = useLearningStore((s) => s.updateProfile);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const profileEntries = Object.entries(profiles);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const activeId = selectedCharId || (profileEntries.length > 0 ? profileEntries[0][0] : null);
  const activeProfile = activeId ? profiles[activeId] : null;
  const activeCharacter = characters.find(c => c.id === activeId);

  const handleExport = () => {
    const data = JSON.stringify(profiles, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `learning-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);
        for (const [charId, profile] of Object.entries(data)) {
          const p = profile as any;
          updateProfile(charId, {
            vocabulary: p.vocabulary || [],
            phrases: p.phrases || [],
          });
        }
      } catch { /* ignore */ }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleDelete = () => {
    if (deleteTarget && confirmText === '知道后果') {
      clearCharacter(deleteTarget);
      setDeleteTarget(null);
      setConfirmText('');
      if (activeId === deleteTarget) setSelectedCharId(null);
    }
  };

  return (
    <div className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BookOpen size={20} className="text-gray-500" />
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">学习记录</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            >
              <Upload size={14} /> 导入
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <button
              onClick={handleExport}
              disabled={profileEntries.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
            >
              <Download size={14} /> 导出
            </button>
          </div>
        </div>

        {profileEntries.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <span className="text-2xl">📚</span>
            </div>
            <p className="text-sm text-gray-500">暂无学习数据</p>
            <p className="text-xs text-gray-400 mt-1">与角色对话后，系统会自动分析你的语言风格</p>
          </div>
        ) : (
          <>
            {/* Character tabs */}
            {profileEntries.length > 1 && (
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                {profileEntries.map(([charId, profile]) => {
                  const char = characters.find(c => c.id === charId);
                  const isActive = charId === activeId;
                  return (
                    <button
                      key={charId}
                      onClick={() => setSelectedCharId(charId)}
                      className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${
                        isActive
                          ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 font-medium'
                          : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      {char?.name || '未知角色'}
                      <span className="ml-1 text-[10px] opacity-60">{profile.vocabulary.length}词</span>
                    </button>
                  );
                })}
              </div>
            )}

            {activeProfile && (
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {activeCharacter?.name || 'AI'} 学到的风格
                  </h2>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setDeleteTarget(activeId)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="mb-4">
                  <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">常用词汇</h3>
                  {activeProfile.vocabulary.length === 0 ? (
                    <p className="text-xs text-gray-400">暂无数据</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {activeProfile.vocabulary.map((word, i) => (
                        <span key={i} className="px-2.5 py-1 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 text-xs">
                          {word}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">常用表达</h3>
                  {activeProfile.phrases.length === 0 ? (
                    <p className="text-xs text-gray-400">暂无数据</p>
                  ) : (
                    <div className="space-y-1.5">
                      {activeProfile.phrases.map((phrase, i) => (
                        <div key={i} className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs">
                          &ldquo;{phrase}&rdquo;
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-[10px] text-gray-400">
                    最后更新: {new Date(activeProfile.lastUpdated).toLocaleString('zh-CN')}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setDeleteTarget(null); setConfirmText(''); }}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-5 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={18} className="text-red-500" />
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">删除学习记录</h3>
            </div>
            <p className="text-xs text-gray-500 mb-2">此操作不可恢复，数据将永久删除。</p>
            <p className="text-xs text-gray-500 mb-3">请输入「知道后果」确认：</p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="知道后果"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setDeleteTarget(null); setConfirmText(''); }} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">取消</button>
              <button
                onClick={handleDelete}
                disabled={confirmText !== '知道后果'}
                className="px-3 py-1.5 rounded-lg text-xs bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                彻底删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

