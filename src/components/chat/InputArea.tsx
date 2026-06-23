import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, X, Paperclip, Image as ImageIcon } from 'lucide-react';
import { MessageAttachment } from '../../types';
import { pickFiles, readFileAsBase64, saveFileToDb, getFileDataOnly, inferMimeType, isRunningInTauri, type PickedFile } from '../../lib/tauriBridge';
import { generateId } from '../../utils/chatUtils';

interface Props {
  onSend: (message: string, attachments?: MessageAttachment[]) => void;
  isAiTyping?: boolean;
  debounceEnabled?: boolean;
  debounceMs?: number;
  disabled?: boolean;
}

export function InputArea({ onSend, isAiTyping = false, debounceEnabled = true, debounceMs = 1500, disabled = false }: Props) {
  const [input, setInput] = useState('');
  const [pendingMessages, setPendingMessages] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});
  const [isDragging, setIsDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<string[]>([]);
  const onSendRef = useRef(onSend);
  const attachmentsRef = useRef(attachments);
  const sendingRef = useRef(false);
  const inputFocusedRef = useRef(false);
  const processingRef = useRef(false);
  const processedPathsRef = useRef<Set<string>>(new Set());

  onSendRef.current = onSend;
  attachmentsRef.current = attachments;

  useEffect(() => {
    pendingRef.current = pendingMessages;
  }, [pendingMessages]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const doSend = useCallback(async (msgs: string[], att?: MessageAttachment[]) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    clearTimer();

    const validMsgs = msgs.filter(m => m.trim());
    const hasContent = validMsgs.length > 0 || (att && att.length > 0);

    if (hasContent) {
      const { addUserMessageOnly, processQueuedUserMessages } = await import('../../store/chatStore').then(m => m.useChatStore.getState());

      // Clear input state immediately so UI is responsive
      setAttachments([]);
      setImagePreviews({});
      processedPathsRef.current = new Set();

      // Release sendingRef now — the rest is async background work
      sendingRef.current = false;

      // Send messages one by one, removing from pending as each is sent
      for (let i = 0; i < validMsgs.length; i++) {
        // Remove this message from pending (one by one disappearance)
        setPendingMessages(prev => prev.filter((_, idx) => idx !== 0));
        // First message: no delay; 2nd+: skipDelay=false (delay handled by addUserMessageOnly)
        await addUserMessageOnly(validMsgs[i], i === 0 ? att : undefined, i > 0);
        if (i < validMsgs.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // All messages shown — now trigger AI
      await new Promise(r => setTimeout(r, 200));
      processQueuedUserMessages();
    } else {
      setAttachments([]);
      setImagePreviews({});
      processedPathsRef.current = new Set();
      setPendingMessages([]);
      sendingRef.current = false;
    }
  }, []);

  const flushPending = useCallback(() => {
    const msgs = pendingRef.current;
    const att = attachmentsRef.current;
    if (msgs.length > 0) {
      doSend(msgs, att);
    }
  }, [doSend]);

  const handleSend = useCallback(() => {
    const curInput = input.trim();
    const curAttachments = attachmentsRef.current;
    const hasContent = curInput || curAttachments.length > 0;
    if (!hasContent) return;

    const finalAttachments = curAttachments;

    if (!debounceEnabled) {
      if (sendingRef.current) return;
      sendingRef.current = true;
      setTimeout(() => { sendingRef.current = false; }, 500);
      onSendRef.current(curInput, finalAttachments.length > 0 ? finalAttachments : undefined);
      setInput('');
      setAttachments([]);
      setImagePreviews({});
      processedPathsRef.current = new Set();
      return;
    }

    // Debounce mode: add text to pending, always include attachments
    if (curInput) {
      const newPending = [...pendingRef.current, curInput];
      setPendingMessages(newPending);
      clearTimer();
      // Timer: flush only when user leaves textarea (cursor not blinking)
      // Re-arms if user is still focused when timer fires
      const startTimer = () => {
        timerRef.current = window.setTimeout(() => {
          if (!inputFocusedRef.current) {
            doSend(newPending, attachmentsRef.current);
          } else {
            // User still focused — re-arm timer as safety net
            startTimer();
          }
        }, debounceMs);
      };
      startTimer();
    } else if (finalAttachments.length > 0) {
      // Only attachments, no text — send immediately
      if (sendingRef.current) return;
      sendingRef.current = true;
      setTimeout(() => { sendingRef.current = false; }, 500);
      onSendRef.current('', finalAttachments);
      setAttachments([]);
      setImagePreviews({});
      processedPathsRef.current = new Set();
    }
    setInput('');
    // Auto-resize back to single line
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, debounceEnabled, debounceMs, doSend]);

  const cancelPending = useCallback(() => {
    clearTimer();
    setPendingMessages([]);
  }, []);

  const handlePickFiles = async () => {
    const files = await pickFiles(['image/*', 'video/*', 'audio/*', 'application/pdf', 'text/*']);
    processFiles(files);
  };

  const processFiles = async (files: PickedFile[], rawFiles?: File[]) => {
    // Prevent concurrent processing (e.g. Tauri drag-drop + React drop firing simultaneously)
    if (processingRef.current) {
      console.log('[InputArea] processFiles already in progress, skipping');
      return;
    }

    // Extra safety: if all files in this batch have already been processed, skip entirely
    if (files.length > 0 && files.every(f => processedPathsRef.current.has(f.path))) {
      console.log('[InputArea] All files already processed, skipping batch');
      return;
    }

    processingRef.current = true;
    try {
      const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'avif'];

      const detectType = (mimeType: string, name: string): 'image' | 'video' | 'audio' | 'file' => {
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType.startsWith('video/')) return 'video';
        if (mimeType.startsWith('audio/')) return 'audio';
        const ext = name.split('.').pop()?.toLowerCase() || '';
        if (IMAGE_EXTS.includes(ext)) return 'image';
        if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        if (['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a', 'wma'].includes(ext)) return 'audio';
        return 'file';
      };

      const newAttachments: MessageAttachment[] = [];
      const dbPromises: Promise<boolean>[] = [];

      // Deduplicate by file path: skip files already processed in this session
      const dedupedFiles = files.filter(f => {
        if (processedPathsRef.current.has(f.path)) {
          console.log('[InputArea] Skipping duplicate file (already processed):', f.path);
          return false;
        }
        processedPathsRef.current.add(f.path);
        return true;
      });

      for (let i = 0; i < dedupedFiles.length; i++) {
        const f = dedupedFiles[i];
        // Fix missing/incorrect MIME type
        if (!f.mimeType || f.mimeType === 'application/octet-stream') {
          f.mimeType = inferMimeType(f.name, f.mimeType);
        }
        const attId = generateId();
        const type = detectType(f.mimeType, f.name);

        // Step 1: Create instant preview (blob URL) for images
        let previewUrl = '';
        if (type === 'image') {
          if (rawFiles && rawFiles[i]) {
            previewUrl = URL.createObjectURL(rawFiles[i]);
          } else if (isRunningInTauri() && f.path) {
            // Tauri drag-drop: read file for preview
            try {
              const b64 = await readFileAsBase64(f.path);
              if (b64) previewUrl = `data:${f.mimeType || 'image/png'};base64,${b64}`;
            } catch { /* ignore */ }
          }
          if (previewUrl) {
            setImagePreviews(prev => ({ ...prev, [attId]: previewUrl }));
          }
        }

        // Step 2: Start DB save in background
        let fileId: string | undefined;
        let filePath = previewUrl || f.path;

        if (isRunningInTauri()) {
          if (rawFiles && rawFiles[i]) {
            const data = new Uint8Array(await rawFiles[i].arrayBuffer());
            const savePromise = saveFileToDb(attId, f.name, f.mimeType || 'application/octet-stream', data);
            dbPromises.push(savePromise);
            savePromise.then((saved) => {
              if (saved) {
                fileId = attId;
                // Update path to DB reference
                attachmentsRef.current = attachmentsRef.current.map(a =>
                  a.id === attId ? { ...a, path: `db:${attId}`, fileId: attId } : a
                );
                setAttachments(prev => prev.map(a =>
                  a.id === attId ? { ...a, path: `db:${attId}`, fileId: attId } : a
                ));
                // Update preview to DB-backed data URL
                getFileDataOnly(attId).then(b64 => {
                  if (b64) {
                    setImagePreviews(prev => ({ ...prev, [attId]: `data:${f.mimeType || 'image/png'};base64,${b64}` }));
                  }
                }).catch(() => {});
              }
            }).catch(() => {});
          } else if (f.path) {
            // No raw File: read from filesystem and save to DB in background
            const doSave = async () => {
              try {
                const b64 = await readFileAsBase64(f.path);
                if (b64) {
                  const binary = atob(b64);
                  const data = new Uint8Array(binary.length);
                  for (let j = 0; j < binary.length; j++) data[j] = binary.charCodeAt(j);
                  return await saveFileToDb(attId, f.name, f.mimeType || 'application/octet-stream', data);
                }
              } catch { /* ignore */ }
              return false;
            };
            const savePromise = doSave();
            dbPromises.push(savePromise);
            savePromise.then((saved) => {
              if (saved) {
                fileId = attId;
                attachmentsRef.current = attachmentsRef.current.map(a =>
                  a.id === attId ? { ...a, path: `db:${attId}`, fileId: attId } : a
                );
                setAttachments(prev => prev.map(a =>
                  a.id === attId ? { ...a, path: `db:${attId}`, fileId: attId } : a
                ));
              }
            }).catch(() => {});
          }
        }

        newAttachments.push({
          id: attId,
          type,
          name: f.name,
          path: filePath,
          size: f.size,
          mimeType: f.mimeType,
          fileId,
        });
      }

      setAttachments(prev => [...prev, ...newAttachments]);

      // Wait for all DB saves to complete before allowing another processFiles
      await Promise.allSettled(dbPromises);
    } finally {
      processingRef.current = false;
    }
  };

  // Tauri native drag-drop listener
  useEffect(() => {
    if (!isRunningInTauri()) return;

    let unlisten: (() => void) | undefined;
    let dropCount = 0;
    let lastDropTime = 0;

    const setupDragDrop = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        unlisten = await win.onDragDropEvent((event) => {
          if (event.payload.type === 'drop') {
            const now = Date.now();
            dropCount++;
            const paths = event.payload.paths;
            console.log(`[DragDrop] #${dropCount} at +${(now - lastDropTime).toFixed(0)}ms:`, paths.length, 'files');

            // Absolute dedup: only process the first drop event, ignore all subsequent
            // Tauri can fire multiple drop events for a single drag-drop gesture
            if (lastDropTime > 0 && now - lastDropTime < 10000) {
              console.log(`[DragDrop] Ignored drop #${dropCount} (within 10s of last)`);
              return;
            }
            lastDropTime = now;
            setIsDragging(false);

            if (paths.length > 0) {
              const files: PickedFile[] = paths.map((p) => {
                const name = p.split(/[/\\]/).pop() || p;
                return {
                  name,
                  path: p,
                  size: 0,
                  mimeType: inferMimeType(name),
                };
              });
              processFiles(files);
            }
          } else if (event.payload.type === 'enter') {
            setIsDragging(true);
          } else if (event.payload.type === 'leave') {
            setIsDragging(false);
          }
        });
      } catch (e) {
        console.warn('[InputArea] Tauri drag-drop listener failed:', e);
      }
    };

    setupDragDrop();
    return () => { unlisten?.(); };
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    // In Tauri, onDragDropEvent already handles file processing
    if (isRunningInTauri()) return;
    const rawFiles = Array.from(e.dataTransfer.files);
    const files = rawFiles.map(f => ({
      name: f.name,
      path: (f as any).path || f.name,
      size: f.size,
      mimeType: f.type || 'application/octet-stream',
    }));
    if (files.length > 0) {
      processFiles(files, rawFiles);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // Auto-resize textarea
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-4 pb-4 pt-2">
      {/* Pending messages indicator */}
      {pendingMessages.length > 0 && (
        <div className="mb-2 px-3 py-2.5 bg-violet-50 dark:bg-violet-950/30 rounded-xl text-xs animate-[fadeIn_0.2s_ease-out]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-violet-600 dark:text-violet-400 font-medium">
              待发送 {pendingMessages.length} 条消息
            </span>
            <button onClick={cancelPending} className="text-gray-400 hover:text-red-500 transition-colors">
              <X size={14} />
            </button>
          </div>
          <div className="space-y-0.5 max-h-16 overflow-y-auto">
            {pendingMessages.map((msg, i) => (
              <p key={i} className="text-gray-500 dark:text-gray-400 truncate">{msg}</p>
            ))}
          </div>
          <button
            onClick={cancelPending}
            className="mt-1.5 text-[11px] text-gray-400 hover:text-violet-500 transition-colors"
          >
            &gt; 不需要回复
          </button>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="mb-2 px-3 py-2 bg-violet-50 dark:bg-violet-950/30 rounded-xl text-xs animate-[fadeIn_0.2s_ease-out]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-violet-600 dark:text-violet-400 font-medium">
              {attachments.length} 个附件
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {attachments.map((a) => (
              <div key={a.id} className="relative group">
                {a.type === 'image' && imagePreviews[a.id] ? (
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                    <img src={imagePreviews[a.id]} alt={a.name} className="w-full h-full object-cover" />
                    <button
                      onClick={() => {
                        setAttachments(prev => prev.filter(p => p.id !== a.id));
                        setImagePreviews(prev => { const n = { ...prev }; delete n[a.id]; return n; });
                      }}
                      className="absolute top-0.5 right-0.5 p-0.5 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 px-2 py-1 bg-white dark:bg-gray-800 rounded-lg">
                    {a.type === 'image' ? <ImageIcon size={10} /> : a.type === 'audio' ? '🎵' : a.type === 'video' ? '🎬' : <Paperclip size={10} />}
                    <span className="text-gray-600 dark:text-gray-400 truncate max-w-[100px]">{a.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter(p => p.id !== a.id))} className="text-gray-400 hover:text-red-500">
                      <X size={10} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div
        className={`flex items-end gap-2 rounded-2xl px-3 py-2 shadow-sm transition-colors ${
          disabled
            ? 'bg-gray-50 dark:bg-gray-900 opacity-50'
            : isDragging
              ? 'bg-violet-100 dark:bg-violet-900/30 ring-2 ring-violet-400 dark:ring-violet-500'
              : 'bg-gray-100 dark:bg-gray-800'
        }`}
        onDragOver={disabled ? undefined : handleDragOver}
        onDragLeave={disabled ? undefined : handleDragLeave}
        onDrop={disabled ? undefined : handleDrop}
      >
        <button
          onClick={handlePickFiles}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
          title="添加附件"
        >
          <Paperclip size={18} />
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          onFocus={() => {
            inputFocusedRef.current = true;
            // User came back to input — cancel pending flush, they're still active
            if (debounceEnabled && pendingRef.current.length > 0) {
              clearTimer();
            }
          }}
          onBlur={() => {
            inputFocusedRef.current = false;
            // User left input — flush pending messages immediately
            if (debounceEnabled && pendingRef.current.length > 0) {
              clearTimer();
              flushPending();
            }
          }}
          placeholder="输入消息..."
          rows={1}
          className="flex-1 px-2 py-1.5 bg-transparent border-0 text-sm resize-none focus:outline-none placeholder-gray-400 dark:text-gray-100 leading-relaxed"
          style={{ maxHeight: 120 }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || (!input.trim() && attachments.length === 0)}
          className={`p-2 rounded-xl transition-all flex-shrink-0 ${
            !disabled && (input.trim() || attachments.length > 0)
              ? 'bg-violet-600 text-white shadow-md hover:shadow-lg hover:bg-violet-700 active:scale-95'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
          }`}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
