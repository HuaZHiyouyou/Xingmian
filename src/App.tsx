import { useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "./components/sidebar/Sidebar";
import { ChatWindow } from "./components/chat/ChatWindow";
import { CharacterSelectionPage } from "./components/character/CharacterGrid";
import { ChatHistoryPage } from "./components/chat/ChatHistoryPage";
import { SettingsPage } from "./components/common/SettingsPage";
import { APIConfigPage } from "./components/common/APIConfigPage";
import { EmotionDashboard } from "./components/emotion/EmotionDashboard";
import { MemoryPanel } from "./components/memory/MemoryPanel";
import { DebugLogPanel } from "./components/debug/DebugLogPanel";
import { LearningPanel } from "./components/learning/LearningPanel";
import { IntegrationPage } from "./components/settings/IntegrationPage";
import { FileManagementPanel } from "./components/common/FileManagementPanel";
import { MbtiTest } from "./components/mbti/MbtiTest";
import { UserProfilePanel } from "./components/userProfile/UserProfilePanel";
import BackupPanel from "./components/backup/BackupPanel";
import { useBotMessageHandler } from "./handlers/botHandler";
import { useConfigStore } from "./store/configStore";
import { useChatStore } from "./store/chatStore";
import { useCharacterStore } from "./store/characterStore";
import { useCharacterMindStore } from "./store/characterMindStore";
import { useDebugLog } from "./store/debugLogStore";
import { useModelRoleStore } from "./store/modelRoleStore";
import { useMemoryAnalysisStore } from "./store/memoryAnalysisStore";
import { useLearningStore } from "./store/learningStore";
import { useLearningConfigStore } from "./store/learningConfigStore";
import { useIntegrationStore } from "./store/integrationStore";
import { useMbtiStore } from "./store/mbtiStore";
import { useUserProfileStore } from "./store/userProfileStore";
import { useBackupStore } from "./store/backupStore";
import { useProactiveReplyStore } from "./store/proactiveReplyStore";
import { migrateLocalStorageIfNeeded, migrateMemoryEntriesIfNeeded } from "./lib/migration";

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <main key={location.pathname} className="flex-1 flex flex-col min-w-0 animate-pageIn">
      <Routes location={location}>
        <Route path="/chat" element={<ChatWindow />} />
        <Route path="/chat/:id" element={<ChatWindow />} />
        <Route path="/characters" element={<CharacterSelectionPage />} />
        <Route path="/history" element={<ChatHistoryPage />} />
        <Route path="/emotion" element={<EmotionDashboard />} />
        <Route path="/memory" element={<MemoryPanel />} />
        <Route path="/api-config" element={<APIConfigPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/logs" element={<DebugLogPanel />} />
        <Route path="/learning" element={<LearningPanel />} />
        <Route path="/integrations" element={<IntegrationPage />} />
        <Route path="/files" element={<FileManagementPanel />} />
        <Route path="/mbti" element={<MbtiTest />} />
        <Route path="/user-profile" element={<UserProfilePanel />} />
        <Route path="/backups" element={<BackupPanel />} />
        <Route path="/" element={<Navigate to="/chat" replace />} />
      </Routes>
    </main>
  );
}

export default function App() {
  const loadInitialConfig = useConfigStore((s) => s.loadInitialConfig);
  const loadInitialData = useChatStore((s) => s.loadInitialData);
  const loadCharacters = useCharacterStore((s) => s.loadCharacters);

  useBotMessageHandler();

  useEffect(() => {
    async function init() {
      await migrateLocalStorageIfNeeded();
      await migrateMemoryEntriesIfNeeded();
      await Promise.all([
        loadInitialConfig(),
        loadInitialData(),
        loadCharacters(),
        useCharacterMindStore.getState().loadAllFromDb(),
        useDebugLog.getState().loadFirstPage(),
        useModelRoleStore.getState().loadFromStorage(),
        useMemoryAnalysisStore.getState().loadFromStorage(),
        useLearningStore.getState().loadFromStorage(),
        useLearningConfigStore.getState().loadFromStorage(),
        useIntegrationStore.getState().loadIntegrations(),
        useIntegrationStore.getState().loadConversations(),
        useMbtiStore.getState().loadFromStorage(),
        useUserProfileStore.getState().loadFromStorage(),
        useBackupStore.getState().loadBackups(),
        useBackupStore.getState().loadConfig(),
      ]);
      useBackupStore.getState().startScheduler();
      useProactiveReplyStore.getState().startScheduler();
    }
    init();
  }, [loadInitialConfig, loadInitialData, loadCharacters]);

  return (
    <Router>
      <div className="flex h-screen bg-white dark:bg-gray-900 overflow-hidden">
        <Sidebar />
        <AnimatedRoutes />
      </div>
      <style>{`
        @keyframes pageIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-pageIn {
          animation: pageIn 0.18s ease-out;
        }
      `}</style>
    </Router>
  );
}
