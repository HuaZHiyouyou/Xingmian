/**
 * ============================================================
 * B1: 功能模块设置卡片
 * 展示注册表中全部模块的运行状态，并提供启停开关
 * （开关写回各模块现有配置，registry.syncAll 在下一节拍收敛启停）。
 * 🔧 支持 extra 插槽：可将关联配置区块（如「主动回复」调度配置）
 *     嵌入同一卡片，形成「定时任务」组合区块。
 * ============================================================
 */
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Boxes, RefreshCw } from 'lucide-react';
import { useModuleRegistry } from '../../services/modules/registry';
import { registerBuiltinModules } from '../../services/modules/builtin';
import { useModelRoleStore } from '../../store/modelRoleStore';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { getGateStatus } from '../../services/proactive/intentGate';

export function FeatureModulesCard({ extra, tasksPanel }: { extra?: ReactNode; tasksPanel?: ReactNode }) {
  const modules = useModuleRegistry((s) => s.modules);
  const runtime = useModuleRegistry((s) => s.runtime);
  const syncAll = useModuleRegistry((s) => s.syncAll);

  // 防御性注册（正常路径 App 启动已注册；设置页直开时兜底）
  useEffect(() => {
    registerBuiltinModules();
  }, []);

  // 🔧 ai-life 的开关已移至功能模块页「AI 一日数据」区块，卡片中不再重复展示
  const visibleModules = modules.filter((m) => m.id !== 'ai-life');
  const runningCount = visibleModules.filter((m) => runtime[m.id]?.started && m.isEnabled()).length;

  const toggle = (moduleId: string, next: boolean) => {
    if (moduleId === 'chain-proactive') {
      useModelRoleStore.getState().setChainProactiveConfig({ enabled: next });
    } else if (moduleId === 'proactive-reply') {
      useModelRoleStore.getState().setProactiveReplyConfig({ enabled: next });
    } else if (moduleId === 'ai-life') {
      const cfg = useAiLifeStore.getState().config;
      if (cfg) void useAiLifeStore.getState().updateConfig({ enabled: next });
    }
    // 立即收敛启停（不等下一分钟节拍）
    setTimeout(syncAll, 50);
  };

  return (
    <section className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Boxes size={16} className="text-indigo-500" />
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">调度中心</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300">
            {runningCount}/{visibleModules.length} 运行中
          </span>
        </div>
        <button
          onClick={syncAll}
          className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
          title="重新同步模块状态"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="space-y-2">
        {visibleModules.map((m) => {
          const enabled = m.isEnabled();
          const started = runtime[m.id]?.started && enabled;
          const checked = enabled;
          return (
            <div key={m.id} className="flex items-start gap-3 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
              <span
                className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${started ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                title={started ? '运行中' : '已停止'}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{m.name}</p>
                  <span className="text-[9px] text-gray-300 dark:text-gray-600">v{m.version}</span>
                </div>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">{m.description}</p>
              </div>
              <button
                onClick={() => toggle(m.id, !checked)}
                className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-indigo-500' : 'bg-gray-200 dark:bg-gray-700'}`}
                title={checked ? '点击停用' : '点击启用'}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
                />
              </button>
            </div>
          );
        })}
      </div>

      <GateStatusRow />

      {/* 🔧 组合插槽：定时任务板块（自主设定）—— 与主动回复同容器 */}
      {tasksPanel && (
        <div className="mt-3 pt-3 border-t border-gray-50 dark:border-gray-800">
          {tasksPanel}
        </div>
      )}

      {/* 🔧 组合插槽：主动回复配置（内嵌面板） */}
      {extra && <div className="mt-3">{extra}</div>}
    </section>
  );
}

/** B2: 主动消息闸门状态一览（今日预算 / 退避）+ 链式主动次数配置 */
function GateStatusRow() {
  const dailyMaxCount = useModelRoleStore((s) => s.chainProactiveConfig.dailyMaxCount);
  const setChainProactiveConfig = useModelRoleStore((s) => s.setChainProactiveConfig);
  const s = getGateStatus();
  return (
    <div className="mt-3 pt-3 border-t border-gray-50 dark:border-gray-800 space-y-2">
      {/* 🔧 链式主动次数可自行设定 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-gray-600 dark:text-gray-400">链式主动次数</p>
          <p className="text-[10px] text-gray-400">链式主动关心每天最多触发次数（0=当天不主动）</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={dailyMaxCount}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') { setChainProactiveConfig({ dailyMaxCount: 0 }); return; }
              const v = parseInt(raw, 10);
              if (!isNaN(v) && v >= 0) setChainProactiveConfig({ dailyMaxCount: v });
            }}
            className="w-14 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs text-center font-medium text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 tabular-nums"
          />
          <span className="text-[10px] text-gray-400">次/天</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
        <span>链式主动预算今日: <b className="text-gray-600 dark:text-gray-300">{s.used}/{s.budget}</b></span>
        <span>被无视退避: <b className={s.ignoreStreak > 0 ? 'text-amber-500' : 'text-gray-600 dark:text-gray-300'}>{s.ignoreStreak} 次</b></span>
        <span>窗口: <b className="text-gray-600 dark:text-gray-300">{s.windowFocused ? '前台' : '后台'}</b></span>
      </div>
    </div>
  );
}
