
import { useState, useRef, useMemo, useEffect } from 'react';
import { useLearningStore } from '../../store/learningStore';
import { useCharacterStore } from '../../store/characterStore';
import { useChatStore } from '../../store/chatStore';
import { BookOpen, Trash2, Download, Upload, AlertTriangle, MessageCircle, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
import { getReviewQueue, ReviewItem, StyleProfile } from '../../services/learning/selfLearningV2';
import { getPersistence } from '../../services/persistence/persistenceManager';

export function LearningPanel() {
  const profiles = useLearningStore((s) => s.profiles);
  const clearCharacter = useLearningStore((s) => s.clearCharacter);
  const characters = useCharacterStore((s) => s.characters);
  const conversations = useChatStore((s) => s.conversations);
  const updateProfile = useLearningStore((s) => s.updateProfile);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeView, setActiveView] = useState<'learned' | 'review'>('learned');
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewStats, setReviewStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [styleProfiles, setStyleProfiles] = useState<Record<string, StyleProfile>>({});

  const profileEntries = Object.entries(profiles);
  const [selectedCharId, setSelectedCharId] = useState<string>('__all__');
  const [animKey, setAnimKey] = useState(0);

  // 加载审核队列数据和风格画像
  const loadReviewData = () => {
    const queue = getReviewQueue();
    setReviewItems(queue.getPending());
    setReviewStats(queue.getStats());
    setStyleProfiles(getPersistence().loadStyleProfiles());
  };

  useEffect(() => {
    loadReviewData();
  }, []);

  // 切换角色时重置动画 key,触发重新动画
  useEffect(() => {
    setAnimKey(k => k + 1);
  }, [selectedCharId]);

  // 获取所有有对话的角色ID — 使用 useMemo 避免新引用
  const charIdsWithData = useMemo(() => {
    const ids = new Set<string>();
    for (const conv of conversations) {
      if (conv.characterId) ids.add(conv.characterId);
    }
    return ids;
  }, [conversations]);

  // 综合所有角色 — 使用 useMemo 避免新数组
  const relevantChars = useMemo(() => {
    return characters.filter(c => charIdsWithData.has(c.id) || profiles[c.id]);
  }, [characters, charIdsWithData, profiles]);

  // 有学习数据的角色ID集合
  const charIdsWithProfile = useMemo(() => new Set(profileEntries.map(([id]) => id)), [profileEntries]);

  // 选择"全部"时,合并所有角色的学习数据
  const mergedProfile = useMemo(() => {
    if (selectedCharId === '__all__') {
      if (profileEntries.length === 0) return null;
      const allVocab = new Set<string>();
      const allPhrases = new Set<string>();
      let latestUpdate = new Date(0);
      for (const [, p] of profileEntries) {
        for (const v of p.vocabulary) allVocab.add(v);
        for (const ph of p.phrases) allPhrases.add(ph);
        if (new Date(p.lastUpdated) > latestUpdate) latestUpdate = new Date(p.lastUpdated);
      }
      return {
        vocabulary: Array.from(allVocab),
        phrases: Array.from(allPhrases),
        lastUpdated: latestUpdate,
      };
    }
    return profiles[selectedCharId] || null;
  }, [selectedCharId, profileEntries, profiles]);

  const activeCharacter = characters.find(c => c.id === selectedCharId);

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
          const p = profile as { vocabulary?: string[]; phrases?: string[] };
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
    }
  };

  // 审核操作
  const handleApprove = (id: string) => {
    const queue = getReviewQueue();
    queue.approve(id);
    loadReviewData();
  };

  const handleReject = (id: string) => {
    const queue = getReviewQueue();
    queue.reject(id);
    loadReviewData();
  };

  const handleClearProcessed = () => {
    const queue = getReviewQueue();
    queue.clearProcessed();
    loadReviewData();
  };

  // 审核项类型标签
  const typeLabels: Record<string, string> = {
    vocabulary: '词汇',
    phrase: '句式',
    style_update: '风格',
    few_shot: '示例',
  };

  const typeColors: Record<string, string> = {
    vocabulary: 'bg-slate-200 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500',
    phrase: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    style_update: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    few_shot: 'bg-slate-200 dark:bg-slate-800/30 text-slate-700 dark:text-slate-500',
  };

  // 如果完全没有角色和学习数据,显示空状态
  const hasNoData = characters.length === 0;

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

        {/* 视图切换 */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 mb-4">
          <button
            onClick={() => setActiveView('learned')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeView === 'learned'
                ? 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-500 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <BookOpen size={14} />
            已学内容
          </button>
          <button
            onClick={() => setActiveView('review')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeView === 'review'
                ? 'bg-white dark:bg-gray-700 text-slate-700 dark:text-slate-500 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Clock size={14} />
            审核队列
            {reviewStats.pending > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
                {reviewStats.pending}
              </span>
            )}
          </button>
        </div>

        {/* Character tabs - 参考情感/记忆模块的UI */}
        {relevantChars.length > 0 && (
          <div className="flex gap-1.5 mb-4 overflow-x-auto py-1 px-1">
            <button
              onClick={() => setSelectedCharId('__all__')}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all shrink-0 border ${
                selectedCharId === '__all__'
                  ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400 font-medium'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              全部
            </button>
            {relevantChars.map(c => {
              const hasData = charIdsWithProfile.has(c.id);
              const isActive = selectedCharId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedCharId(c.id)}
                  className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all shrink-0 flex items-center gap-1.5 border ${
                    isActive
                      ? 'border-slate-400 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/20 text-slate-800 dark:text-slate-400 font-medium'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${hasData ? 'bg-green-400' : 'bg-gray-300'}`} />
                  {c.name}
                  {hasData && (
                    <span className="text-[10px] opacity-60">({profiles[c.id]?.vocabulary.length || 0}词)</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {hasNoData ? (
          <div key={animKey} className="animate-[fadeUp_0.35s_ease-out]">
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-200 dark:bg-slate-800/30 flex items-center justify-center">
                <BookOpen size={24} className="text-slate-700 dark:text-slate-300" />
              </div>
              <p className="text-sm text-gray-500">暂无角色和学习数据</p>
              <p className="text-xs text-gray-400 mt-1">先创建角色并开始对话吧</p>
            </div>
          </div>
        ) : activeView === 'review' ? (
          /* 审核队列视图 */
          <div key={`review-${animKey}`} className="animate-[fadeUp_0.35s_ease-out]">
            {/* 统计卡片 */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="bg-white dark:bg-gray-900 rounded-xl p-3 shadow-sm text-center">
                <div className="text-lg font-bold text-gray-800 dark:text-gray-200">{reviewStats.total}</div>
                <div className="text-[10px] text-gray-400">总计</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl p-3 shadow-sm text-center">
                <div className="text-lg font-bold text-amber-600 dark:text-amber-400">{reviewStats.pending}</div>
                <div className="text-[10px] text-gray-400">待审核</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl p-3 shadow-sm text-center">
                <div className="text-lg font-bold text-slate-700 dark:text-slate-500">{reviewStats.approved}</div>
                <div className="text-[10px] text-gray-400">已通过</div>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl p-3 shadow-sm text-center">
                <div className="text-lg font-bold text-red-600 dark:text-red-400">{reviewStats.rejected}</div>
                <div className="text-[10px] text-gray-400">已拒绝</div>
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={loadReviewData}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
              >
                <RefreshCw size={14} /> 刷新
              </button>
              <button
                onClick={handleClearProcessed}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
              >
                清除已处理
              </button>
            </div>

            {/* 待审核列表 */}
            {reviewItems.length === 0 ? (
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-8 shadow-sm text-center">
                <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <CheckCircle size={20} className="text-gray-400" />
                </div>
                <p className="text-sm text-gray-500">暂无待审核内容</p>
                <p className="text-xs text-gray-400 mt-1">新学习的内容会出现在这里等待审核</p>
              </div>
            ) : (
              <div className="space-y-2">
                {reviewItems.map((item, i) => {
                  const char = characters.find(c => c.id === item.characterId);
                  const dataDisplay = typeof item.data === 'string' 
                    ? item.data 
                    : (item.data as { word?: string; phrase?: string } | null)?.word || (item.data as { word?: string; phrase?: string } | null)?.phrase || JSON.stringify(item.data);
                  
                  return (
                    <div 
                      key={item.id} 
                      className="bg-white dark:bg-gray-900 rounded-xl p-3 shadow-sm animate-[fadeUp_0.3s_ease-out_both]"
                      style={{ animationDelay: `${Math.min(i * 0.05, 0.3)}s` }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[item.type] || 'bg-gray-100 text-gray-500'}`}>
                              {typeLabels[item.type] || item.type}
                            </span>
                            <span className="text-[10px] text-gray-400">{char?.name || '未知角色'}</span>
                            <span className="text-[10px] text-gray-300">·</span>
                            <span className="text-[10px] text-gray-400">{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                          </div>
                          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{dataDisplay}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleApprove(item.id)}
                            className="p-1.5 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/20 transition-colors"
                            title="通过"
                          >
                            <CheckCircle size={16} />
                          </button>
                          <button
                            onClick={() => handleReject(item.id)}
                            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title="拒绝"
                          >
                            <XCircle size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : !mergedProfile && selectedCharId !== '__all__' ? (
          <div key={animKey} className="animate-[fadeUp_0.35s_ease-out]">
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                <MessageCircle size={24} className="text-gray-400" />
              </div>
              <p className="text-sm text-gray-500">暂无学习数据</p>
              <p className="text-xs text-gray-400 mt-1">
                {activeCharacter ? `与「${activeCharacter.name}」对话后，系统会自动分析你的语言风格` : '与角色对话后，系统会自动分析你的语言风格'}
              </p>
            </div>
          </div>
        ) : mergedProfile ? (
          <div key={animKey} className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm animate-[fadeUp_0.35s_ease-out]">
            <div className="flex items-center justify-between mb-3 animate-[fadeUp_0.3s_ease-out_both]" style={{ animationDelay: '0.05s' }}>
              <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {selectedCharId === '__all__' ? '全部角色' : activeCharacter?.name || '未知角色'} 学到的风格
              </h2>
              <div className="flex items-center gap-1">
                {selectedCharId !== '__all__' && (
                  <button
                    onClick={() => setDeleteTarget(selectedCharId)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    title="删除此角色的学习数据"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="mb-4 animate-[fadeUp_0.3s_ease-out_both]" style={{ animationDelay: '0.1s' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">常用词汇</h3>
                <span className="text-[10px] text-gray-400">{mergedProfile.vocabulary.length}个</span>
              </div>
              {mergedProfile.vocabulary.length === 0 ? (
                <p className="text-xs text-gray-400">暂无数据</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {mergedProfile.vocabulary.map((word, i) => {
                    // 根据词汇长度分配不同颜色
                    const colorMap: Record<number, string> = {
                      2: 'bg-slate-100 dark:bg-slate-800/20 text-slate-700 dark:text-slate-500',
                      3: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
                      4: 'bg-slate-100 dark:bg-slate-800/20 text-slate-700 dark:text-slate-500',
                    };
                    const colorClass = colorMap[word.length] || colorMap[2];
                    
                    return (
                      <span 
                        key={i} 
                        className={`px-2.5 py-1 rounded-full text-xs animate-[fadeUp_0.3s_ease-out_both] ${colorClass}`}
                        style={{ animationDelay: `${Math.min(i * 0.03, 0.4)}s` }}
                        title={`${word.length}字词汇`}
                      >
                        {word}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mb-4 animate-[fadeUp_0.3s_ease-out_both]" style={{ animationDelay: '0.15s' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">常用表达</h3>
                <span className="text-[10px] text-gray-400">{mergedProfile.phrases.length}个</span>
              </div>
              {mergedProfile.phrases.length === 0 ? (
                <p className="text-xs text-gray-400">暂无数据</p>
              ) : (
                <div className="space-y-1.5">
                  {mergedProfile.phrases.map((phrase, i) => (
                    <div key={i} className="px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-xs animate-[fadeUp_0.3s_ease-out_both] flex items-center justify-between"
                      style={{ animationDelay: `${Math.min(i * 0.05, 0.5)}s` }}
                    >
                      <span>&ldquo;{phrase}&rdquo;</span>
                      <span className="text-[10px] opacity-50 shrink-0 ml-2">{phrase.length}字</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 风格学习 — StyleProfile */}
            {selectedCharId !== '__all__' && styleProfiles[selectedCharId] && (
              <div className="mb-4 animate-[fadeUp_0.3s_ease-out_both]" style={{ animationDelay: '0.18s' }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                  <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide">风格学习</h3>
                  <span className="text-[10px] text-gray-400">— AI 学到的用户表达风格</span>
                </div>
                <div className="space-y-2.5">
                  {/* 口语特征 */}
                  {styleProfiles[selectedCharId].speechStyle && (
                    <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800/20 text-slate-700 dark:text-slate-500 text-xs">
                      <span className="font-medium opacity-60">口语特征：</span>
                      {styleProfiles[selectedCharId].speechStyle}
                    </div>
                  )}
                  {/* 句式偏好 */}
                  {styleProfiles[selectedCharId].sentencePatterns.length > 0 && (
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1">句式偏好</p>
                      <div className="flex flex-wrap gap-1.5">
                        {styleProfiles[selectedCharId].sentencePatterns.map((pat, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800/20 text-slate-700 dark:text-slate-500 text-[10px]">
                            {pat}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 回复长度偏好 + 样本数 */}
                  <div className="flex items-center gap-3 text-[10px] text-gray-400">
                    <span>长度偏好：<span className="text-gray-500 dark:text-gray-400 font-medium">{
                      { short: '简短', medium: '适中', long: '详细', mixed: '混合' }[styleProfiles[selectedCharId].preferredReplyLength] || '未知'
                    }</span></span>
                    <span>学习样本：<span className="text-gray-500 dark:text-gray-400 font-medium">{styleProfiles[selectedCharId].sampleCount}条</span></span>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-gray-100 dark:border-gray-800 animate-[fadeUp_0.3s_ease-out_both]" style={{ animationDelay: '0.2s' }}>
              <p className="text-[10px] text-gray-400">
                最后更新: {new Date(mergedProfile.lastUpdated).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Global keyframes */}
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Delete dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => { setDeleteTarget(null); setConfirmText(''); }}>
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
