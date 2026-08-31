import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { FileRecord, FileData } from '../types';
import { saveFileToDb, getFileFromDb, getFilesPage, deleteFileFromDb, getFileStats, inferMimeType, isRunningInTauri } from '../lib/tauriBridge';
import { generateId } from '../utils/chatUtils';

interface FileState {
  files: FileRecord[];
  nextCursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
  stats: { total: number; totalSize: number; byType: Record<string, { count: number; size: number }> };
  filter: { characterId?: string; conversationId?: string; mimeTypeFilter?: string };

  loadFiles: (reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  uploadFile: (file: File, characterId?: string, conversationId?: string) => Promise<FileRecord | null>;
  uploadFiles: (files: File[], characterId?: string, conversationId?: string) => Promise<FileRecord[]>;
  /** Soft delete: remove from list only (files remain in DB) */
  softDeleteFile: (fileId: string) => Promise<void>;
  /** Hard delete: remove from DB entirely */
  hardDeleteFile: (fileId: string) => Promise<void>;
  getFileData: (fileId: string) => Promise<FileData | null>;
  setFilter: (filter: Partial<FileState['filter']>) => void;
  loadStats: () => Promise<void>;
}

export const useFileStore = create<FileState>()(
  subscribeWithSelector((set, get) => ({
    files: [],
    nextCursor: null,
    hasMore: false,
    isLoading: false,
    stats: { total: 0, totalSize: 0, byType: {} },
    filter: {},

    loadFiles: async () => {
      if (!isRunningInTauri()) return;
      const { filter } = get();
      set({ isLoading: true });
      try {
        const result = await getFilesPage(
          filter.characterId,
          filter.conversationId,
          filter.mimeTypeFilter,
          undefined,
          30,
        );
        set({
          files: result.files.map(f => ({
            id: f.id,
            filename: f.filename,
            mimeType: f.mimeType,
            size: f.size,
            characterId: f.characterId,
            conversationId: f.conversationId,
            createdAt: new Date(f.createdAt),
          })),
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          isLoading: false,
        });
      } catch {
        set({ isLoading: false });
      }
    },

    loadMore: async () => {
      const { nextCursor, files, filter, hasMore } = get();
      if (!hasMore || !nextCursor || !isRunningInTauri()) return;
      set({ isLoading: true });
      try {
        const result = await getFilesPage(
          filter.characterId,
          filter.conversationId,
          filter.mimeTypeFilter,
          nextCursor,
          30,
        );
        set({
          files: [...files, ...result.files.map(f => ({
            id: f.id,
            filename: f.filename,
            mimeType: f.mimeType,
            size: f.size,
            characterId: f.characterId,
            conversationId: f.conversationId,
            createdAt: new Date(f.createdAt),
          }))],
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
          isLoading: false,
        });
      } catch {
        set({ isLoading: false });
      }
    },

    uploadFile: async (file: File, characterId?: string, conversationId?: string) => {
      if (!isRunningInTauri()) return null;
      const id = generateId();
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      const mime = file.type || inferMimeType(file.name);
      const success = await saveFileToDb(id, file.name, mime, data, characterId, conversationId);
      if (!success) return null;

      const record: FileRecord = {
        id,
        filename: file.name,
        mimeType: mime,
        size: file.size,
        characterId,
        conversationId,
        createdAt: new Date(),
      };

      set(state => ({
        files: [record, ...state.files],
      }));

      return record;
    },

    uploadFiles: async (files: File[], characterId?: string, conversationId?: string) => {
      const results: FileRecord[] = [];
      for (const file of files) {
        const record = await get().uploadFile(file, characterId, conversationId);
        if (record) results.push(record);
      }
      return results;
    },

    softDeleteFile: async (fileId: string) => {
      // Remove from UI list only — file stays in DB
      set(state => ({
        files: state.files.filter(f => f.id !== fileId),
      }));
    },

    hardDeleteFile: async (fileId: string) => {
      if (!isRunningInTauri()) return;
      await deleteFileFromDb(fileId);
      set(state => ({
        files: state.files.filter(f => f.id !== fileId),
      }));
    },

    getFileData: async (fileId: string) => {
      const result = await getFileFromDb(fileId);
      if (!result) return null;
      return {
        id: result.id,
        filename: result.filename,
        mimeType: result.mimeType,
        size: result.size,
        data: result.data,
        characterId: result.characterId,
        conversationId: result.conversationId,
        createdAt: new Date(result.createdAt),
      };
    },

    setFilter: (filter) => {
      set(state => ({
        filter: { ...state.filter, ...filter },
      }));
      get().loadFiles(true);
    },

    loadStats: async () => {
      if (!isRunningInTauri()) return;
      const stats = await getFileStats();
      set({ stats });
    },
  }))
);
