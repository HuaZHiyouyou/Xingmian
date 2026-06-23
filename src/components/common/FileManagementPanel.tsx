import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useFileStore } from '../../store/fileStore';
import { useCharacterStore } from '../../store/characterStore';
import { FileRecord } from '../../types';
import { getFileDataOnly, isRunningInTauri } from '../../lib/tauriBridge';
import { X, Trash2, Image as ImageIcon, Video, Music, FileText, HardDrive } from 'lucide-react';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return <ImageIcon size={16} className="text-pink-500" />;
  if (mimeType.startsWith('video/')) return <Video size={16} className="text-blue-500" />;
  if (mimeType.startsWith('audio/')) return <Music size={16} className="text-green-500" />;
  return <FileText size={16} className="text-gray-500" />;
}

function CustomSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-xs rounded-xl border dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-violet-300 dark:hover:border-violet-600 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all flex items-center gap-1 min-w-[80px]"
      >
        <span className="flex-1 text-left">{selected?.label || options[0]?.label}</span>
        <svg className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 left-0 w-full bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-xl shadow-lg overflow-hidden animate-[fadeIn_0.15s_ease-out]">
            {options.map(opt => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full px-3 py-2 text-xs text-left transition-colors ${
                  value === opt.value
                    ? 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const LARGE_GIF_THRESHOLD = 2.4 * 1024 * 1024;
const isLargeGif = (mime: string, size: number) => mime === 'image/gif' && size >= LARGE_GIF_THRESHOLD;

function FilePreview({ file, onClose }: { file: FileRecord; onClose: () => void }) {
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isRunningInTauri()) return;
    setLoading(true);
    setSrc('');
    getFileDataOnly(file.id).then(b64 => {
      if (b64) setSrc(`data:${file.mimeType};base64,${b64}`);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [file.id, file.mimeType]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center cursor-pointer"
      onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-[90vw] max-h-[90vh] overflow-hidden animate-[scaleIn_0.2s_ease-out]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            {getFileIcon(file.mimeType)}
            <span className="text-sm font-medium truncate max-w-[300px]">{file.filename}</span>
            <span className="text-xs text-gray-400">{formatSize(file.size)}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 flex items-center justify-center min-h-[200px] max-h-[70vh] overflow-auto">
          {file.mimeType.startsWith('image/') ? (
            <>
              {loading && (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-gray-400">加载中...</p>
                </div>
              )}
              {src && (
                <img
                  src={src}
                  alt={file.filename}
                  className={`max-w-full max-h-[65vh] rounded-lg object-contain ${isLargeGif(file.mimeType, file.size) ? 'transition-opacity duration-700 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]' : 'transition-opacity duration-300'} ${loading ? 'opacity-0 absolute' : 'opacity-100'}`}
                  onLoad={() => setLoading(false)}
                />
              )}
            </>
          ) : file.mimeType.startsWith('video/') && src ? (
            <video src={src} controls className="max-w-full max-h-[65vh] rounded-lg" />
          ) : file.mimeType.startsWith('audio/') && src ? (
            <div className="w-80">
              <div className="text-center mb-4 text-4xl">🎵</div>
              <audio src={src} controls className="w-full" />
              <p className="text-center text-sm text-gray-500 mt-2">{file.filename}</p>
            </div>
          ) : (
            <div className="text-center text-gray-500">
              <FileText size={48} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">{file.filename}</p>
              <p className="text-xs text-gray-400 mt-1">{formatSize(file.size)}</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ImageThumbnail({ file }: { file: FileRecord }) {
  const [src, setSrc] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isRunningInTauri()) return;
    getFileDataOnly(file.id).then(b64 => {
      if (b64) setSrc(`data:${file.mimeType};base64,${b64}`);
    });
  }, [file.id, file.mimeType]);

  return (
    <div className="h-24 overflow-hidden relative bg-gray-100 dark:bg-gray-700">
      {!src && (
        <div className="absolute inset-0">
          <div className="h-full w-full bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-[shimmer_1.5s_infinite]" />
        </div>
      )}
      {src && (
        <img
          src={src}
          alt={file.filename}
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          loading="lazy"
        />
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-xl border dark:border-gray-700 overflow-hidden bg-gray-50 dark:bg-gray-800 animate-[fadeIn_0.3s_ease-out]">
          <div className="h-24 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 animate-[shimmer_1.5s_infinite]" />
          <div className="px-2 py-1.5 space-y-1">
            <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 animate-[shimmer_1.5s_infinite]" />
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-1/2 animate-[shimmer_1.5s_infinite]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FileManagementPanel() {
  const { files, nextCursor, hasMore, isLoading, stats, filter, loadFiles, loadMore, softDeleteFile, hardDeleteFile, setFilter, loadStats } = useFileStore();
  const characters = useCharacterStore(state => state.characters);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [filterCharacter, setFilterCharacter] = useState<string>('');
  const [softDeleteTarget, setSoftDeleteTarget] = useState<FileRecord | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<FileRecord | null>(null);
  const [hardDeleteChecked, setHardDeleteChecked] = useState(false);
  const [hardDeleteStep, setHardDeleteStep] = useState<0 | 1>(0);
  const [initialLoaded, setInitialLoaded] = useState(false);

  const refreshData = useCallback(() => {
    if (isRunningInTauri()) {
      loadFiles(true);
      loadStats();
    }
  }, [loadFiles, loadStats]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!isLoading && files.length >= 0) {
      setInitialLoaded(true);
    }
  }, [isLoading, files.length]);

  useEffect(() => {
    if (!isRunningInTauri()) return;
    window.addEventListener('focus', refreshData);
    return () => window.removeEventListener('focus', refreshData);
  }, [refreshData]);

  useEffect(() => {
    setFilter({ mimeTypeFilter: filterType || undefined, characterId: filterCharacter || undefined });
  }, [filterType, filterCharacter]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 100 && hasMore && !isLoading) {
      loadMore();
    }
  }, [hasMore, isLoading, loadMore]);

  const confirmSoftDelete = async () => {
    if (!softDeleteTarget) return;
    await softDeleteFile(softDeleteTarget.id);
    loadStats();
    setSoftDeleteTarget(null);
  };

  const confirmHardDelete = async () => {
    if (!hardDeleteTarget) return;
    await hardDeleteFile(hardDeleteTarget.id);
    loadStats();
    setHardDeleteTarget(null);
    setHardDeleteChecked(false);
    setHardDeleteStep(0);
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">文件管理</h2>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <HardDrive size={14} />
            <span>{stats.total} 个文件 · {formatSize(stats.totalSize)}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <CustomSelect
            value={filterType}
            onChange={setFilterType}
            options={[
              { value: '', label: '全部类型' },
              { value: 'image', label: '图片' },
              { value: 'video', label: '视频' },
              { value: 'audio', label: '音频' },
            ]}
          />

          <CustomSelect
            value={filterCharacter}
            onChange={setFilterCharacter}
            options={[
              { value: '', label: '全部角色' },
              ...characters.map(c => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4" onScroll={handleScroll}>
        {!initialLoaded && isLoading ? (
          <SkeletonGrid />
        ) : files.length === 0 && !isLoading ? (
          <div className="text-center text-gray-400 py-12 animate-[fadeIn_0.3s_ease-out]">
            <HardDrive size={48} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">暂无文件</p>
            <p className="text-xs mt-1">发送或接收的文件会自动保存到这里</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {files.map((file, idx) => (
              <div
                key={file.id}
                className="group relative rounded-xl border dark:border-gray-700 overflow-hidden cursor-pointer hover:shadow-md transition-all bg-gray-50 dark:bg-gray-800 animate-[fadeInUp_0.3s_ease-out]"
                style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
                onClick={() => setPreviewFile(file)}
              >
                {file.mimeType.startsWith('image/') ? (
                  <ImageThumbnail file={file} />
                ) : (
                  <div className="h-24 flex items-center justify-center">
                    {getFileIcon(file.mimeType)}
                  </div>
                )}
                <div className="px-2 py-1.5">
                  <p className="text-[11px] font-medium truncate">{file.filename}</p>
                  <p className="text-[10px] text-gray-400">{formatSize(file.size)}</p>
                </div>
                <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); setSoftDeleteTarget(file); }}
                    className="p-1 rounded-full bg-black/50 text-white hover:bg-gray-600"
                    title="普通删除（可恢复）"
                  >
                    <Trash2 size={11} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setHardDeleteTarget(file); setHardDeleteChecked(false); setHardDeleteStep(0); }}
                    className="p-1 rounded-full bg-red-600/80 text-white hover:bg-red-600"
                    title="彻底删除（不可恢复）"
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {isLoading && initialLoaded && (
          <div className="text-center py-4">
            <div className="inline-block w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {hasMore && !isLoading && (
          <button onClick={loadMore} className="w-full py-2 text-xs text-violet-500 hover:text-violet-600">
            加载更多...
          </button>
        )}
      </div>

      <AnimatePresence>
        {previewFile && <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />}
      </AnimatePresence>

      {/* Soft delete confirmation */}
      {softDeleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSoftDeleteTarget(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-gray-100 dark:bg-gray-800">
                <Trash2 size={20} className="text-gray-600 dark:text-gray-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">删除文件</h3>
                <p className="text-xs text-gray-500 mt-0.5">文件将从列表中移除，但数据保留在数据库中</p>
                <p className="text-xs text-gray-400 mt-1 truncate max-w-[250px]">{softDeleteTarget.filename}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setSoftDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
              <button onClick={confirmSoftDelete}
                className="px-4 py-2 rounded-lg text-sm text-white bg-gray-600 hover:bg-gray-700 transition-colors active:scale-95">
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hard delete confirmation */}
      {hardDeleteTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center animate-[fadeIn_0.15s_ease-out]">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setHardDeleteTarget(null); setHardDeleteChecked(false); setHardDeleteStep(0); }} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 animate-[scaleIn_0.2s_ease-out]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <X size={20} className="text-red-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {hardDeleteStep === 0 ? '确认彻底删除？' : '最后确认'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {hardDeleteStep === 0 ? '此操作不可撤销，文件数据将从数据库中永久清除' : '请勾选确认后删除'}
                </p>
                <p className="text-xs text-gray-400 mt-1 truncate max-w-[250px]">{hardDeleteTarget.filename}</p>
              </div>
            </div>
            {hardDeleteStep === 1 && (
              <label className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 mb-4 cursor-pointer">
                <input type="checkbox" checked={hardDeleteChecked} onChange={(e) => setHardDeleteChecked(e.target.checked)}
                  className="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500" />
                <span className="text-xs text-red-700 dark:text-red-300">我确认要永久删除此文件</span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setHardDeleteTarget(null); setHardDeleteChecked(false); setHardDeleteStep(0); }}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                取消
              </button>
              <button onClick={hardDeleteStep === 0 ? () => setHardDeleteStep(1) : confirmHardDelete}
                disabled={hardDeleteStep === 1 && !hardDeleteChecked}
                className="px-4 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95">
                {hardDeleteStep === 0 ? '下一步' : '彻底删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
