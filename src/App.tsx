import { useEffect, useRef, useState } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "./components/sidebar/Sidebar";
import { MobileTabBar } from "./components/mobile/MobileTabBar";
import { ChatWindow } from "./components/chat/ChatWindow";
import { CharacterSelectionPage } from "./components/character/CharacterGrid";
import { ChatHistoryPage } from "./components/chat/ChatHistoryPage";
import { SettingsPage } from "./components/common/SettingsPage";
import { APIConfigPage } from "./components/common/APIConfigPage";
import { EmotionDashboard } from "./components/emotion/EmotionDashboard";
import { MemoryPanel } from "./components/memory/MemoryPanel";
import MemoryNetwork from "./components/memory/MemoryNetwork";
import { DebugLogPanel } from "./components/debug/DebugLogPanel";
import { LearningPanel } from "./components/learning/LearningPanel";
import { IntegrationPage } from "./components/settings/IntegrationPage";
import { MCPServerPage } from "./components/settings/MCPServerPage";
import { FileManagementPanel } from "./components/common/FileManagementPanel";
import FeatureModulePage from "./components/settings/FeatureModulePage";
import PluginModulePage from "./components/settings/PluginModulePage";
import SkillsPage from "./components/settings/SkillsPage";
import { MbtiTest } from "./components/mbti/MbtiTest";
import { UserProfilePanel } from "./components/userProfile/UserProfilePanel";
import BackupPanel from "./components/backup/BackupPanel";
import MusicPlayerPage from "./components/music/MusicPlayerPage";
import { GlobalAudioPlayer } from "./components/music/GlobalAudioPlayer";
import { MiniPlayer } from "./components/music/MiniPlayer";
import AiLifePanel from "./components/ailife/AiLifePanel";
import { MorePage } from "./components/common/MorePage";
import { initializeAgentTools } from "./agent/toolRegistry";
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
import { useMemoryStore } from "./store/memoryStore";
import { useMusicStore } from "./store/musicStore";
import { useProactiveReplyStore } from "./store/proactiveReplyStore";
import { useFeatureModuleStore } from "./store/featureModuleStore";
import { useSkillsStore } from "./store/skillsStore";
import { usePluginStore } from "./store/pluginStore";
import { pushPendingPrompt } from "./services/dataOverrideBridge";
import { ensureLifeEngineStarted, lifeTick, clearEngineCache } from "./services/ailife/lifeEngine";
import { registerBuiltinModules } from "./services/modules/builtin";
import { useModuleRegistry } from "./services/modules/registry";
import { ensureBuiltinWorlds } from "./services/ailife/worldConfig";
import { UIApplyEffects } from "./components/ui/UIApplyEffects";
import { MusicDesktopLyricsWindow } from './components/music/MusicDressUp';
import { AppearancePage } from "./components/ui/AppearancePage";
import { migrateLocalStorageIfNeeded, migrateMemoryEntriesIfNeeded } from "./lib/migration";
import { initUIConfig } from "./store/uiStore";

// 改动2: 记录上一次浏览轨迹
const LAST_ROUTE_KEY = 'ai-last-route';
const VALID_ROUTES = [
  '/chat', '/characters', '/history', '/emotion', '/memory',
  '/memory-network', '/api-config', '/settings', '/appearance',
  '/logs', '/learning', '/integrations', '/mcp', '/files', '/feature-module',
  '/plugins', '/skills', '/mbti', '/user-profile', '/backups',
  '/music', '/ai-life', '/more',
];

function AnimatedRoutes() {
  const location = useLocation();
  const savedRouteRef = useRef<string | null>(null);
  const isMusicPage = location.pathname === '/music';
  const currentSong = useMusicStore((s) => s.currentSong);

  // 首次挂载：读取上次浏览轨迹
  if (!savedRouteRef.current) {
    try {
      const stored = localStorage.getItem(LAST_ROUTE_KEY);
      if (stored && VALID_ROUTES.some(r => stored.startsWith(r))) {
        savedRouteRef.current = stored;
      }
    } catch { /* ignore */ }
  }

  // 路由变化时保存
  useEffect(() => {
    try {
      localStorage.setItem(LAST_ROUTE_KEY, location.pathname);
    } catch { /* ignore */ }
  }, [location.pathname]);

  // 如果在根路径且有保存的路由，重定向
  const shouldRedirect = location.pathname === '/' && savedRouteRef.current && savedRouteRef.current !== '/';

  // 当 MiniPlayer 可见时（非音乐页面且有歌曲），需要底部 padding 避免遮挡
  const showMiniPlayer = !isMusicPage && !!currentSong;

  return (
    <main key={location.pathname} className={`flex-1 flex flex-col min-w-0 overflow-hidden animate-pageIn pb-[56px] lg:pb-0 ${showMiniPlayer ? 'lg:!pb-[72px] pb-[128px]' : ''}`}>
      <Routes location={location}>
        <Route path="/chat" element={<ChatWindow />} />
        <Route path="/chat/:id" element={<ChatWindow />} />
        <Route path="/characters" element={<CharacterSelectionPage />} />
        <Route path="/history" element={<ChatHistoryPage />} />
        <Route path="/emotion" element={<EmotionDashboard />} />
        <Route path="/memory" element={<MemoryPanel />} />
        <Route path="/memory-network" element={<MemoryNetwork />} />
        <Route path="/api-config" element={<APIConfigPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/appearance" element={<AppearancePage />} />
        <Route path="/logs" element={<DebugLogPanel />} />
        <Route path="/learning" element={<LearningPanel />} />
        <Route path="/integrations" element={<IntegrationPage />} />
        <Route path="/mcp" element={<MCPServerPage />} />
        <Route path="/files" element={<FileManagementPanel />} />
        <Route path="/feature-module" element={<FeatureModulePage />} />
        <Route path="/plugins" element={<PluginModulePage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/mbti" element={<MbtiTest />} />
        <Route path="/user-profile" element={<UserProfilePanel />} />
        <Route path="/backups" element={<BackupPanel />} />
        <Route path="/music" element={<MusicPlayerPage />} />
        <Route path="/desktop-lyrics" element={<MusicDesktopLyricsWindow />} />
        <Route path="/ai-life" element={<AiLifePanel />} />
        <Route path="/more" element={<MorePage />} />
        <Route
          path="/"
          element={
            shouldRedirect
              ? <Navigate to={savedRouteRef.current!} replace />
              : <Navigate to="/chat" replace />
          }
        />
      </Routes>
    </main>
  );
}

export default function App() {
  // 🆕 桌面歌词独立窗口：裸渲染歌词层（无侧栏/路由布局）
  const [isLyricsWindow] = useState(() => {
    try {
      return window.location.pathname === '/desktop-lyrics';
    } catch { return false; }
  });
  const loadInitialConfig = useConfigStore((s) => s.loadInitialConfig);
  const loadInitialData = useChatStore((s) => s.loadInitialData);
  const loadCharacters = useCharacterStore((s) => s.loadCharacters);
  const selectedCharacterId = useCharacterStore((s) => s.selectedCharacterId);

  if (isLyricsWindow) {
    return <MusicDesktopLyricsWindow />;
  }

  useBotMessageHandler();

  // 🆕 AI 一日引擎：角色切换时重载配置 + 离线快进
  useEffect(() => {
    if (!selectedCharacterId) return;
    clearEngineCache(selectedCharacterId);
    ensureLifeEngineStarted(selectedCharacterId)
      .then(() => lifeTick(selectedCharacterId))
      .catch(() => {});
  }, [selectedCharacterId]);

  // 初始化 Agent 工具
  useEffect(() => {
    initializeAgentTools();
  }, []);

  useEffect(() => {
    let mounted = true;

    async function init() {
      // 页面加载时清除 localStorage 临时缓存（输入框草稿等,刷新失效）
      import('./components/chat/InputArea').then(m => m.clearDrafts()).catch(() => {});

      await migrateLocalStorageIfNeeded();
      await migrateMemoryEntriesIfNeeded();
      // 🆕 数据保存策略：localStorage 即时自动保存（本地优先），
      //    DB 由 memoryStore 内部防抖后台静默同步，不再有空闲检测/退出提醒。

      // 🆕 一次性数据清理（后台静默）：
      //    1) 删除重复且未使用的会话（历史 bug 产生的同内容副本；每组保留最新一个，有时间线的会话不动）
      //    2) 运行日志保留 7 天，防止无限累积（此前只增不删，已达上万条）
      import('./lib/tauriBridge').then(({ dbCleanupZombieConversations, dbPruneDebugLogs }) => {
        dbCleanupZombieConversations().then((n) => {
          if (n > 0) useDebugLog.getState().add('system', `[清理] 已移除 ${n} 个重复且未使用的会话（每组保留最新一个）`);
        });
        dbPruneDebugLogs(7).then((n) => {
          if (n > 0) useDebugLog.getState().add('system', `[清理] 已清理 ${n} 条 7 天前的运行日志`);
        });
      }).catch(() => {});

      // 退出前刷盘：仅处理调试日志批量写入的丢失窗口
      window.addEventListener('beforeunload', () => {
        try { useDebugLog.getState().flushPending(); } catch { /* 静默 */ }
      });

      // 页面隐藏时刷盘：仅调试日志
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          useDebugLog.getState().flushPending().catch(() => {});
        }
      });
      // 暴露store到window，方便控制台调试
      (window as unknown as { __memoryStore?: typeof useMemoryStore }).__memoryStore = useMemoryStore;
      // 🆕 性能优化：启动分两批——关键路径先行，次要 store 空闲时再加载。
      // 此前十几个 store 在同一帧并发 invoke + loadFirstPage 拉 2000 条日志，
      // 与首屏渲染争抢主线程，导致桌面端启动/刷新后卡顿数秒。
      await Promise.all([
        loadInitialConfig(),
        loadInitialData(),
        loadCharacters(),
        useCharacterMindStore.getState().loadAllFromDb(),
        useModelRoleStore.getState().loadFromStorage(),
      ]);

      const idle = (fn: () => void, delayMs: number) => {
        if ('requestIdleCallback' in window) {
          (window as unknown as { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback(fn, { timeout: delayMs });
        } else {
          setTimeout(fn, delayMs);
        }
      };
      // 批次1（空闲即载）：🆕 本地记忆缓存补载（首屏后解析，避免启动卡顿）、调试日志、记忆分析
      idle(() => {
        useMemoryStore.getState().hydrateLocal();
        useDebugLog.getState().loadFirstPage();
        useMemoryAnalysisStore.getState().loadFromStorage();
      }, 600);
      // 批次2：学习/MBTI/用户画像
      idle(() => {
        useLearningStore.getState().loadFromStorage();
        useLearningConfigStore.getState().loadFromStorage();
        useMbtiStore.getState().loadFromStorage();
        useUserProfileStore.getState().loadFromStorage();
      }, 4000);
      // 批次3：备份（🆕 A3: 集成账号与会话映射改为同步加载，保证早到 Bot 消息能查到会话映射）
      idle(() => {
        useBackupStore.getState().loadBackups();
        useBackupStore.getState().loadConfig();
      }, 6000);

      // 🆕 A3: 接入数据同步加载 + 已启用接入自动拉起（重启后自动恢复，不再需要手动开关）
      try {
        await useIntegrationStore.getState().loadIntegrations();
        await useIntegrationStore.getState().loadConversations();
        const enabledIntegrations = useIntegrationStore.getState().integrations.filter(i => i.enabled);
        for (const integ of enabledIntegrations) {
          useIntegrationStore.getState().startIntegration(integ.id)
            .then((ok) => {
              if (ok) {
                console.log(`[App] 接入 ${integ.type}(${integ.id}) 已自动恢复`);
              } else {
                console.warn(`[App] 接入 ${integ.type}(${integ.id}) 自动恢复失败`);
              }
            })
            .catch((e) => console.warn(`[App] 接入 ${integ.type} 自动恢复异常:`, e));
        }
      } catch (e) {
        console.warn('[App] 接入自动恢复失败:', e);
      }

      // 启动时加载所有角色的记忆和反思,确保AI有记忆
      // 🆕 性能：延迟到空闲执行，不阻塞首屏（聊天开始前必然已完成）
      const allCharIds = useCharacterStore.getState().characters.map(c => c.id).filter(Boolean);
      if (allCharIds.length > 0) {
        idle(() => {
          useCharacterMindStore.getState().loadAllMindsFromDb(allCharIds);
        }, 3000);
      }

      // 只在组件仍然挂载时启动调度器
      if (mounted) {
        useBackupStore.getState().startScheduler();
        // 🆕 B1: 链式主动/定时回复的启停由模块注册表收敛（下方 registerBuiltinModules + syncAll）
        // 🆕 AI 一日：播种内置世界设定包（幂等）
        ensureBuiltinWorlds();
        // 🆕 功能模块定时任务：每分钟检查一次 + 执行触发 + 功能模块注册表分钟节拍
        // 🆕 防泄漏：HMR/StrictMode 重跑会再次进入此处，先清掉旧定时器再建新的。
        //    此前旧 interval 永远不清除 → 泄漏的旧模块实例持续并发 tick，
        //    每个实例基于自己的空内存判定"无覆盖"，各自写入一份重复活动。
        // 🆕 B1: 链式主动/定时回复/AI-Life 的启停与节拍统一收敛到模块注册表，
        //    各模块不再持有私有定时器；checkTasks 与插件 tick 仍在此处驱动。
        registerBuiltinModules();
        const wFeature = window as unknown as { __featureTimer?: number };
        if (wFeature.__featureTimer) clearInterval(wFeature.__featureTimer);
        const featureTimer = setInterval(() => {
          useFeatureModuleStore.getState().checkTasks();
          // 🆕 B1: 注册表分钟节拍（内部先按配置收敛启停，再分发 onTick：
          //    链式主动自愈 / 定时回复检查 / AI-Life lifeTick）
          const charId = useCharacterStore.getState().selectedCharacterId || undefined;
          useModuleRegistry.getState().tick({ characterId: charId });
          // 🆕 插件 onTick 钩子驱动
          usePluginStore.getState().runTickPlugins(charId).catch(() => {});
        }, 60000);
        useFeatureModuleStore.getState().checkTasks(); // 启动时立即检查
        useModuleRegistry.getState().syncAll(); // 🆕 B1: 启动即收敛模块启停（不等首帧 tick）
        wFeature.__featureTimer = featureTimer as unknown as number;

        // 🆕 AI 一日引擎启动：加载配置 + 离线快进 + 今日日程生成
        const bootCharId = useCharacterStore.getState().selectedCharacterId || undefined;
        ensureLifeEngineStarted(bootCharId)
          .then(() => lifeTick(bootCharId))
          .catch((e) => console.error('[App] lifeEngine start failed:', e));

        // 任务触发执行器：根据任务类型执行动作
        const unsubTask = useFeatureModuleStore.getState().subscribeTaskTrigger((taskId) => {
          const task = useFeatureModuleStore.getState().tasks.find((t) => t.id === taskId);
          if (!task) return;
          useDebugLog.getState().add('system', `[定时任务] 触发: ${task.name} (${task.type})`);
          const charId = useCharacterStore.getState().selectedCharacterId;
          // 不同类型任务动作：
          if (task.type === 'memory_cleanup') {
            // 清理当前角色重要度 < 2 的旧记忆（软删除）
            if (charId) {
              const memStore = useMemoryStore.getState();
              const lowImportance = memStore.getEntries(charId).filter((m) => (m.importance ?? 0) < 2);
              lowImportance.slice(0, 20).forEach((m) => memStore.softDeleteEntry(m.id));
            }
          }
          if (task.type === 'emotion_boost') {
            // 情绪增益：当前角色情绪小幅提升
            if (charId) {
              const mind = useCharacterMindStore.getState();
              const cur = mind.getMultiEmotion(charId);
              const boosted = { ...cur, values: { ...cur.values, joy: Math.min(100, (cur.values.joy || 0) + 5) } };
              mind.setMultiEmotion(charId, boosted);
            }
          }
          if (task.type === 'send_message') {
            // 🆕 已接线：经主动回复管线以角色身份发送任务内容
            if (charId) {
              useProactiveReplyStore.getState().sendTaskMessage(charId, task.payload)
                .then((sent) => useDebugLog.getState().add('proactive', `[定时任务] send_message ${sent ? '已发送' : '发送失败'}: ${task.name}`))
                .catch(() => {});
            } else {
              useDebugLog.getState().add('system', `[定时任务] send_message 跳过：无选中角色`);
            }
          }
          if (task.type === 'custom_prompt') {
            // 🆕 已接线：注入队列，下一次 sendMessage 时拼入 systemPrompt
            pushPendingPrompt(task.payload, task.name);
          }
          if (task.type === 'run_skill') {
            // 🆕 已接线：manual/keyword skill 由定时任务触发，prompt 注入下一次回复
            const skills = useSkillsStore.getState().skills;
            const skill = skills.find((s) => s.name === task.payload && s.enabled);
            if (skill) {
              pushPendingPrompt(skill.prompt, skill.name);
              useSkillsStore.getState().recordUse(skill.id);
            } else {
              useDebugLog.getState().add('system', `[定时任务] run_skill 未找到启用技能「${task.payload}」`);
            }
          }
          if (task.type === 'run_plugin') {
            // 🆕 已接线：按 plugin id 触发单插件
            usePluginStore.getState().runPluginById(task.payload, charId || undefined)
              .catch(() => {});
          }
        });
        (window as unknown as { __unsubTask?: () => void }).__unsubTask = unsubTask;
      }

      // Load UI config from SQLite, migrate wallpapers, resolve active sources
      await initUIConfig();
    }
    init();

    return () => {
      mounted = false;
    };
  }, []); // 只在组件挂载时运行一次

  return (
    <Router>
      <UIApplyEffects />
      <div className="flex h-screen bg-[#f8f9fb] dark:bg-[#0a0f1a] overflow-hidden">
        {/* PC 端侧栏 */}
        <Sidebar />

        {/* 主内容区 */}
        <AnimatedRoutes />

        {/* 手机端底部 TabBar */}
        <MobileTabBar />
      </div>
      {/* 全局音频播放器：路由切换时保持播放不中断 */}
      <GlobalAudioPlayer />
      {/* 迷你悬浮播放器：非音乐页面显示 */}
      <MiniPlayer />
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
