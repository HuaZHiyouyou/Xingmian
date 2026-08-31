import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBackupStore } from '../../store/backupStore';
import { RotateCcw, Trash2, Plus, Clock, Database, Shield, AlertTriangle, HardDrive, FileDown, FileUp, ArrowLeft, X, Check } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function BackupPanel() {
  const navigate = useNavigate();
  const { backups, config, isLoaded, isCreating, loadBackups, loadConfig, updateConfig, createBackup, restoreBackup, softDeleteBackup, hardDeleteBackup, exportBackupToFile, exportAllBackups, importBackupFromFile } = useBackupStore();
  const [softDeleteTarget, setSoftDeleteTarget] = useState<string | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<string | null>(null);
  const [hardDeleteChecked, setHardDeleteChecked] = useState(false);
  const [hardDeleteStep, setHardDeleteStep] = useState<0 | 1>(0);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => { loadBackups(); loadConfig(); }, []);

  const confirmSoftDelete = async () => {
    if (!softDeleteTarget) return;
    await softDeleteBackup(softDeleteTarget);
    setSoftDeleteTarget(null);
    showToast('已放入回收站');
  };

  const confirmHardDelete = async () => {
    if (!hardDeleteTarget) return;
    await hardDeleteBackup(hardDeleteTarget);
    setHardDeleteTarget(null);
    setHardDeleteChecked(false);
    setHardDeleteStep(0);
    showToast('删除成功');
  };

  if (!isLoaded) {
    return (
      <div className="flex-1 min-h-0 bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">加载备份数据...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 bg-gray-50 dark:bg-gray-950 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 pt-6 pb-8 animate-[fadeUp_0.3s_ease-out]">

        {/* Header */}
        <div className="flex items-center gap-3 mb-3 animate-[fadeUp_0.3s_ease-out_0.05s_both]">
          <button onClick={() => navigate('/chat')} className="p-2 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors active:scale-95 shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center shadow-sm">
              <Database size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">数据备份</h1>
              <p className="text-[10px] text-gray-400">全模块数据备份与恢复，支持自动备份</p>
            </div>
          </div>
        </div>

        {/* Actions bar */}
        <div className="flex items-center justify-end gap-2 mb-4 animate-[fadeUp_0.3s_ease-out_0.08s_both]">
          <button
            onClick={async () => { await importBackupFromFile(); showToast('导入成功'); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium
              bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
              text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800
              transition-all active:scale-95 shadow-sm"
          >
            <FileUp size={13} /> 导入
          </button>
          {backups.length > 0 && (
            <button
              onClick={async () => { await exportAllBackups(); showToast('导出成功'); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium
                bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
                text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800
                transition-all active:scale-95 shadow-sm"
            >
              <FileDown size={13} /> 导出全部
            </button>
          )}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium
              bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700
              text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800
              transition-all active:scale-95 shadow-sm"
          >
            <Shield size={13} /> 设置
          </button>
          <button
            onClick={() => createBackup()}
            disabled={isCreating}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium
              text-white bg-gradient-to-r from-slate-700 to-slate-700
              hover:from-slate-700 hover:to-slate-700
              transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          >
            <Plus size={13} /> {isCreating ? '备份中...' : '立即备份'}
          </button>
        </div>

        {/* Auto backup config */}
        {showConfig && (
          <div className="mb-4 bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm border border-gray-100 dark:border-gray-800/50 animate-[fadeUp_0.2s_ease-out]">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center shadow-sm">
                <Shield size={12} className="text-white" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">自动备份设置</h3>
            </div>

            <div className="space-y-3">
              {/* Toggle */}
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-gray-700 dark:text-gray-300">启用自动备份</span>
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => updateConfig({ enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 dark:bg-gray-700 rounded-full peer peer-checked:bg-slate-700 transition-all duration-300 ease-in-out" />
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-sm peer-checked:translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
                </div>
              </label>

              {config.enabled && (
                <div className="space-y-3 pl-1 animate-[fadeUp_0.15s_ease-out]">
                  {/* Time */}
                  <div>
                    <span className="text-xs text-gray-600 dark:text-gray-400 block mb-1.5">备份时间</span>
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 w-fit">
                      <input
                        type="number" min={0} max={23}
                        value={config.autoTimeHour}
                        onChange={(e) => updateConfig({ autoTimeHour: Number(e.target.value) })}
                        className="w-10 text-center text-sm text-gray-700 dark:text-gray-300 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-gray-400 font-medium text-sm">:</span>
                      <input
                        type="number" min={0} max={59}
                        value={config.autoTimeMinute}
                        onChange={(e) => updateConfig({ autoTimeMinute: Number(e.target.value) })}
                        className="w-10 text-center text-sm text-gray-700 dark:text-gray-300 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  </div>

                  {/* Max backups */}
                  <div>
                    <span className="text-xs text-gray-600 dark:text-gray-400 block mb-1.5">最大备份数</span>
                    <input
                      type="number" min={1} max={50}
                      value={config.maxBackups}
                      onChange={(e) => updateConfig({ maxBackups: Number(e.target.value) })}
                      className="w-24 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-center font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-700 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>

                  {/* Debounce */}
                  <div>
                    <span className="text-xs text-gray-600 dark:text-gray-400 block mb-1.5">数据变更防抖（秒）</span>
                    <input
                      type="number" min={10} max={300}
                      value={config.debounceSeconds}
                      onChange={(e) => updateConfig({ debounceSeconds: Number(e.target.value) })}
                      className="w-24 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-center font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-slate-700 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>

                  <p className="text-[10px] text-gray-400 flex items-center gap-1">
                    <Clock size={10} /> 数据变更后 {config.debounceSeconds} 秒自动备份，每日 {String(config.autoTimeHour).padStart(2, '0')}:{String(config.autoTimeMinute).padStart(2, '0')} 定时备份
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Backup list */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800/50 overflow-hidden animate-[fadeUp_0.3s_ease-out_0.1s_both]">
          {backups.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-3">
                <HardDrive size={28} className="opacity-40" />
              </div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">暂无备份</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">点击"立即备份"创建第一个备份</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800/50">
              {backups.map((backup, index) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors"
                  style={{ animation: `listItemIn 0.15s ease-out ${index * 0.03}s both` }}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800/20 flex items-center justify-center shrink-0">
                      <Database size={14} className="text-slate-700 dark:text-slate-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{backup.label}</div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                        <span>{new Date(backup.createdAt).toLocaleString('zh-CN')}</span>
                        <span className="text-gray-300 dark:text-gray-600">·</span>
                        <span>{formatBytes(backup.sizeBytes)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3 shrink-0">
                    <button
                      onClick={async () => { await exportBackupToFile(backup.id); showToast('导出成功'); }}
                      className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-slate-700 dark:text-slate-300 transition-colors"
                      title="导出备份文件"
                    >
                      <FileDown size={14} />
                    </button>
                    <button
                      onClick={() => setRestoreTarget(backup.id)}
                      className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-green-500 transition-colors"
                      title="恢复备份"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => setSoftDeleteTarget(backup.id)}
                      className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title="普通删除（可恢复）"
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => { setHardDeleteTarget(backup.id); setHardDeleteChecked(false); setHardDeleteStep(0); }}
                      className="p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 transition-colors"
                      title="彻底删除（不可恢复）"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info notice */}
        <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 border border-amber-200/60 dark:border-amber-800/40 animate-[fadeUp_0.3s_ease-out_0.15s_both]">
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-800/40 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
              <p className="font-semibold text-sm">备份说明</p>
              <p>· 包含所有模块数据：对话、角色、记忆、情感、学习、MBTI、用户资料、配置等</p>
              <p>· 备份数据不会被"清除所有数据"功能删除</p>
              <p>· 恢复备份会覆盖当前数据，建议先创建一个备份</p>
              <p>· 支持导出为 JSON 文件，可在不同设备间迁移</p>
            </div>
          </div>
        </div>
      </div>

      {/* Restore confirmation */}
      {restoreTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setRestoreTarget(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/30">
                <RotateCcw size={18} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">恢复备份</h3>
                <p className="text-xs text-gray-500 mt-0.5">将使用备份数据覆盖当前所有数据，此操作不可撤销</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setRestoreTarget(null)}
                className="px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
              <button onClick={() => { restoreBackup(restoreTarget); setRestoreTarget(null); showToast('恢复成功'); }}
                className="px-4 py-2 rounded-xl text-sm text-white bg-amber-500 hover:bg-amber-600 transition-colors active:scale-95 shadow-sm">
                确认恢复
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Soft delete confirmation */}
      {softDeleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSoftDeleteTarget(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800">
                <Trash2 size={18} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">删除备份</h3>
                <p className="text-xs text-gray-500 mt-0.5">备份将从列表中移除，但数据保留在数据库中，可随时重新加载</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSoftDeleteTarget(null)}
                className="px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
              <button onClick={confirmSoftDelete}
                className="px-4 py-2 rounded-xl text-sm text-white bg-gray-500 hover:bg-gray-600 transition-colors active:scale-95 shadow-sm">
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hard delete confirmation (two-step) */}
      {hardDeleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setHardDeleteTarget(null); setHardDeleteChecked(false); setHardDeleteStep(0); }} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-red-100 dark:bg-red-900/30">
                <X size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {hardDeleteStep === 0 ? '确认彻底删除？' : '最后确认'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {hardDeleteStep === 0 ? '此操作不可撤销，备份数据将从数据库中永久清除' : '请勾选确认后删除'}
                </p>
              </div>
            </div>
            {hardDeleteStep === 1 && (
              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 mb-4 cursor-pointer border border-red-200/60 dark:border-red-800/40">
                <input type="checkbox" checked={hardDeleteChecked} onChange={(e) => setHardDeleteChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500" />
                <span className="text-xs text-red-700 dark:text-red-300">我确认要永久删除此备份</span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setHardDeleteTarget(null); setHardDeleteChecked(false); setHardDeleteStep(0); }}
                className="px-4 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
              <button onClick={hardDeleteStep === 0 ? () => setHardDeleteStep(1) : confirmHardDelete}
                disabled={hardDeleteStep === 1 && !hardDeleteChecked}
                className="px-4 py-2 rounded-xl text-sm text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 shadow-sm">
                {hardDeleteStep === 0 ? '下一步' : '彻底删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes listItemIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-[fadeUp_0.2s_ease-out] ${
          toast.type === 'success'
            ? 'bg-green-500 text-white'
            : 'bg-red-500 text-white'
        }`}>
          {toast.type === 'success' ? <Check size={16} /> : <X size={16} />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
