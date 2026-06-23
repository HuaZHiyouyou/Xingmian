import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../store/characterStore';
import { CharacterCreator } from './CharacterCreator';
import { CharacterAssistant } from './CharacterAssistant';
import { SimpleDocumentEditor } from './SimpleDocumentEditor';
import { AnimatePresence } from 'framer-motion';
import { ArrowLeft, FileText, Plus, Sparkles, Trash2, AlertTriangle, RotateCcw, Upload, FileJson, FileCode } from 'lucide-react';
import type { Character } from '../../types';

type CreationMode = 'panel' | 'simple' | null;

export function CharacterSelectionPage() {
  const navigate = useNavigate();
  const characters = useCharacterStore((s) => s.characters);
  const selectedCharacterId = useCharacterStore((s) => s.selectedCharacterId);
  const selectCharacter = useCharacterStore((s) => s.selectCharacter);
  const createCharacter = useCharacterStore((s) => s.createCharacter);
  const softDeleteCharacter = useCharacterStore((s) => s.softDeleteCharacter);
  const permanentDeleteCharacter = useCharacterStore((s) => s.permanentDeleteCharacter);
  const [showCreator, setShowCreator] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [showSimpleEditor, setShowSimpleEditor] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [initialAssistantData, setInitialAssistantData] = useState<Partial<Character> | null>(null);
  const [showCreationMode, setShowCreationMode] = useState(false);
  const [creationMode, setCreationMode] = useState<CreationMode>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const simpleFileInputRef = useRef<HTMLInputElement>(null);

  const [softDeleteTarget, setSoftDeleteTarget] = useState<Character | null>(null);
  const [permDeleteTarget, setPermDeleteTarget] = useState<Character | null>(null);
  const [permDeleteStep, setPermDeleteStep] = useState<0 | 1>(0);
  const [permDeleteChecked, setPermDeleteChecked] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  const handleSelect = (id: string) => {
    selectCharacter(id);
  };

  const handleEdit = (char: Character, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCharacter(char);
    // 判断是否为简易创建：有 creationMode='simple'，或无 creationMode 但只有 background 有内容
    const isSimple = char.creationMode === 'simple' || (
      !char.creationMode &&
      !char.personality && !char.emotionTriggers && !char.thinkingStyle &&
      !char.responseStyle && !char.identityAnchors && char.background.length > 100
    );
    if (isSimple) {
      setShowSimpleEditor(true);
    } else {
      setShowCreator(true);
    }
  };

  const handleCreationModeSelect = (mode: 'panel' | 'simple') => {
    setCreationMode(mode);
    setShowCreationMode(false);
    if (mode === 'panel') {
      setEditingCharacter(null);
      setInitialAssistantData(null);
      setShowCreator(true);
    } else {
      simpleFileInputRef.current?.click();
    }
  };

  const handleAssistantComplete = (data: Partial<Character>) => {
    setShowAssistant(false);
    setInitialAssistantData({ ...data, creationMode: 'ai' });
    setEditingCharacter(null);
    setShowCreator(true);
  };

  const handleCreatorClose = () => {
    setShowCreator(false);
    setEditingCharacter(null);
    setInitialAssistantData(null);
    setCreationMode(null);
  };

  const handleSimpleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();
      const baseName = file.name.replace(/\.[^/.]+$/, '') || '导入角色';

      // JSON格式 - 解析所有字段
      if (ext === 'json') {
        try {
          const data = JSON.parse(text);
          await createCharacter({
            name: data.name || baseName,
            personality: data.personality || '',
            description: data.description || '',
            background: data.background || text,
            tags: data.tags || [],
            greetingMessage: data.greetingMessage || '你好呀',
            likes: data.likes || [],
            dislikes: data.dislikes || [],
            habits: data.habits || [],
            catchphrases: data.catchphrases || [],
            exampleDialogues: data.exampleDialogues || [],
            emotionTriggers: data.emotionTriggers || '',
            emotionExpressions: data.emotionExpressions || '',
            thinkingStyle: data.thinkingStyle || '',
            relationshipStages: data.relationshipStages || '',
            responseStyle: data.responseStyle || '',
            identityAnchors: data.identityAnchors || '',
            forbiddenBehaviors: data.forbiddenBehaviors || '',
            outputFormat: data.outputFormat || '',
            memoryImportanceThreshold: data.memoryImportanceThreshold || 5,
            reflectionEnabled: data.reflectionEnabled ?? true,
            timeAwarenessEnabled: data.timeAwarenessEnabled ?? true,
            timezone: data.timezone || '',
            affinityRate: data.affinityRate || 0.5,
            creationMode: 'simple',
          });
          navigate('/characters');
        } catch {
          console.error('JSON parse failed');
        }
      } else {
        // MD / TXT - 直接作为角色设定(system prompt)
        await createCharacter({
          name: baseName,
          personality: '',
          description: text.slice(0, 200),
          background: text,
          tags: [],
          greetingMessage: '你好呀',
          likes: [],
          dislikes: [],
          habits: [],
          catchphrases: [],
          emotionTriggers: '',
          emotionExpressions: '',
          thinkingStyle: '',
          relationshipStages: '',
          responseStyle: '',
          identityAnchors: '',
          forbiddenBehaviors: '',
          outputFormat: '',
          memoryImportanceThreshold: 5,
          reflectionEnabled: true,
          timeAwarenessEnabled: true,
          timezone: '',
          creationMode: 'simple',
        });
        navigate('/characters');
      }
    } catch (err) {
      console.error('Simple import failed:', err);
    }

    if (simpleFileInputRef.current) simpleFileInputRef.current.value = '';
    setCreationMode(null);
  };

  const handleSoftDelete = (char: Character, e: React.MouseEvent) => {
    e.stopPropagation();
    setSoftDeleteTarget(char);
  };

  const confirmSoftDelete = () => {
    if (softDeleteTarget) {
      softDeleteCharacter(softDeleteTarget.id);
      showToast(`已删除「${softDeleteTarget.name}」`);
    }
    setSoftDeleteTarget(null);
  };

  const handlePermDeleteStart = (char: Character, e: React.MouseEvent) => {
    e.stopPropagation();
    setPermDeleteTarget(char);
    setPermDeleteChecked(false);
    setPermDeleteStep(0);
  };

  const handlePermDeleteConfirm = () => {
    if (permDeleteStep === 0) {
      setPermDeleteStep(1);
      return;
    }
    if (!permDeleteChecked) return;
    if (permDeleteTarget) {
      softDeleteCharacter(permDeleteTarget.id);
      permanentDeleteCharacter(permDeleteTarget.id);
      showToast(`已彻底删除「${permDeleteTarget.name}」`);
    }
    setPermDeleteTarget(null);
    setPermDeleteChecked(false);
    setPermDeleteStep(0);
  };

  const handlePermDeleteCancel = () => {
    setPermDeleteTarget(null);
    setPermDeleteChecked(false);
    setPermDeleteStep(0);
  };

  const handleImportMD = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const name = file.name.replace(/\.md$/i, '') || '导入角色';

      await createCharacter({
        name,
        description: text.slice(0, 500),
        personality: '',
        tags: [],
        greetingMessage: '你好呀',
        background: text,
        likes: [],
        dislikes: [],
        habits: [],
        catchphrases: [],
        emotionTriggers: '',
        emotionExpressions: '',
        thinkingStyle: '',
        relationshipStages: '',
        responseStyle: '',
        identityAnchors: '',
        forbiddenBehaviors: '',
        outputFormat: '',
        memoryImportanceThreshold: 5,
        reflectionEnabled: true,
        timeAwarenessEnabled: true,
        timezone: '',
      });

      navigate('/characters');
    } catch (err) {
      console.error('Import MD failed:', err);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-2">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">角色管理</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">创建和管理你的AI角色</p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt"
          className="hidden"
          onChange={handleFileChange}
        />
        <input
          ref={simpleFileInputRef}
          type="file"
          accept=".json,.md,.txt"
          className="hidden"
          onChange={handleSimpleFileChange}
        />

        <div className="mt-8 flex justify-center gap-6">
          <button
            onClick={() => setShowCreationMode(true)}
            className="flex flex-col items-center gap-3 w-36 p-6 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700
              hover:border-green-300 dark:hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-900/10
              transition-all duration-200 group"
          >
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center
              group-hover:bg-green-200 dark:group-hover:bg-green-900/50 transition-colors">
              <FileText size={20} className="text-green-600 dark:text-green-400" />
            </div>
            <span className="text-sm text-gray-600 dark:text-gray-400">创建角色</span>
          </button>

          <button
            onClick={() => setShowAssistant(true)}
            className="flex flex-col items-center gap-3 w-36 p-6 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-700
              hover:border-amber-300 dark:hover:border-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/10
              transition-all duration-200 group"
          >
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center
              group-hover:bg-amber-200 dark:group-hover:bg-amber-900/50 transition-colors">
              <Sparkles size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <span className="text-sm text-gray-600 dark:text-gray-400">AI辅助创建</span>
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-4">选择一种方式创建你的AI角色</p>

        {characters.length > 0 && (
          <div className="mt-10">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">已有角色</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {characters.map((char) => {
                const isSelected = char.id === selectedCharacterId;
                return (
                  <div
                    key={char.id}
                    onClick={() => handleSelect(char.id)}
                    className={`flex flex-col rounded-2xl border transition-all hover:shadow-lg cursor-pointer ${
                      isSelected
                        ? 'border-violet-400 dark:border-violet-500 bg-violet-50/80 dark:bg-violet-900/20 shadow-violet-200/50'
                        : 'border-gray-200/80 dark:border-gray-700/80 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-4 p-5 flex-1">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-sm shrink-0 ${
                        isSelected
                          ? 'bg-gradient-to-br from-violet-500 to-purple-500'
                          : 'bg-gradient-to-br from-gray-400 to-gray-500 dark:from-gray-500 dark:to-gray-600'
                      }`}>
                        {char.avatar ? (
                          <img src={char.avatar} alt={char.name} className="w-full h-full rounded-2xl object-cover" />
                        ) : (
                          char.name.charAt(0)
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">{char.name}</h3>
                          {isSelected && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-violet-500 text-white font-medium shrink-0">
                              当前
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
                          {char.personality || char.description}
                        </p>
                        {char.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {char.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 px-5 py-3">
                      <button
                        onClick={(e) => handleEdit(char, e)}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-violet-100 dark:hover:bg-violet-900/30 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                          <path d="m15 5 4 4"/>
                        </svg>
                        编辑
                      </button>
                      {characters.length > 1 && (
                        <button
                          onClick={(e) => handleSoftDelete(char, e)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={12} />
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {characters.length === 0 && (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500">
            <p className="text-sm">还没有角色，选择上方方式创建一个吧</p>
          </div>
        )}
      </div>

      {showCreator && (
        <CharacterCreator
          character={editingCharacter}
          initialData={initialAssistantData}
          onClose={handleCreatorClose}
        />
      )}

      <AnimatePresence>
        {showSimpleEditor && editingCharacter && (
          <SimpleDocumentEditor
            character={editingCharacter}
            onClose={() => {
              setShowSimpleEditor(false);
              setEditingCharacter(null);
            }}
          />
        )}
      </AnimatePresence>

      {showAssistant && (
        <CharacterAssistant
          onComplete={handleAssistantComplete}
          onClose={() => setShowAssistant(false)}
        />
      )}

      {showCreationMode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCreationMode(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">选择创建方式</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">选择适合你的方式来创建AI角色</p>
            
            <div className="space-y-3">
              <button
                onClick={() => handleCreationModeSelect('panel')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-violet-300 dark:hover:border-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/10 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center shadow-sm shrink-0">
                  <Plus size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">面板创建</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">通过分步表单详细定义角色的每个方面</p>
                </div>
              </button>

              <button
                onClick={() => handleCreationModeSelect('simple')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-600 hover:bg-green-50 dark:hover:bg-green-900/10 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-sm shrink-0">
                  <Upload size={20} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">简易创建</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">上传文件直接作为角色设定</p>
                </div>
              </button>
            </div>

            <div className="flex justify-end mt-5">
              <button onClick={() => setShowCreationMode(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {softDeleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSoftDeleteTarget(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-gray-100 dark:bg-gray-800">
                <Trash2 size={20} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">删除角色「{softDeleteTarget.name}」</h3>
                <p className="text-xs text-gray-500 mt-0.5">请选择删除方式</p>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <button
                onClick={() => {
                  softDeleteCharacter(softDeleteTarget.id);
                  setSoftDeleteTarget(null);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800">
                  <RotateCcw size={16} className="text-gray-600 dark:text-gray-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">普通删除</p>
                  <p className="text-[11px] text-gray-500">移入回收站，可随时恢复</p>
                </div>
              </button>
              <button
                onClick={() => {
                  setSoftDeleteTarget(null);
                  setPermDeleteTarget(softDeleteTarget);
                  setPermDeleteStep(0);
                  setPermDeleteChecked(false);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                  <AlertTriangle size={16} className="text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-red-600 dark:text-red-400">彻底删除</p>
                  <p className="text-[11px] text-red-500/70">永久删除，不可恢复</p>
                </div>
              </button>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setSoftDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {permDeleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={handlePermDeleteCancel} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {permDeleteStep === 0 ? '确认彻底删除？' : '最后确认'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {permDeleteStep === 0 ? '此操作不可撤销，角色数据将永久丢失' : '请勾选确认后删除'}
                </p>
              </div>
            </div>
            {permDeleteStep === 1 && (
              <label className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 mb-4 cursor-pointer">
                <input type="checkbox" checked={permDeleteChecked} onChange={(e) => setPermDeleteChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500" />
                <span className="text-xs text-red-700 dark:text-red-300">我已知道后果，这个角色将无法恢复</span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={handlePermDeleteCancel}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
              <button onClick={handlePermDeleteConfirm}
                disabled={permDeleteStep === 1 && !permDeleteChecked}
                className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95">
                {permDeleteStep === 0 ? '下一步' : '彻底删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] animate-[fadeIn_0.2s_ease-out]">
          <div className={`px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${
            toast.type === 'success' 
              ? 'bg-green-500 text-white' 
              : 'bg-red-500 text-white'
          }`}>
            {toast.message}
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

export default CharacterSelectionPage;
