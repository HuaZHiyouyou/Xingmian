/**
 * ============================================================
 * B1: 内置功能模块（链式主动 / 定时回复 / AI-Life）
 * 各模块不再持有私有定时器——唯一的分钟心跳在 App（防泄漏句柄），
 * 经 registry.tick 分发；模块自身状态机（如链式自续循环）内部保留，
 * 但由注册表按 isEnabled 收敛启停，HMR 后自动恢复到正确状态。
 * ============================================================
 */
import { useModuleRegistry, FeatureModule } from './registry';
import { useModelRoleStore } from '../../store/modelRoleStore';
import { useChainProactiveStore } from '../../store/chainProactiveStore';
import { useProactiveReplyStore } from '../../store/proactiveReplyStore';
import { useAiLifeStore } from '../../store/aiLifeStore';
import { lifeTick } from '../ailife/lifeEngine';
import { settleActivityStart, settleActivityEnd } from '../ailife/activitySettlement';
import type { MinuteTickCtx } from './registry';

const chainProactiveModule: FeatureModule = {
  id: 'chain-proactive',
  name: '链式主动',
  version: '1.0.0',
  description: '自续循环 + 模型裁决（REPLY/NO_REPLY）的主动关心；含回访定时器',
  isEnabled: () => useModelRoleStore.getState().chainProactiveConfig.enabled,
  start: () => useChainProactiveStore.getState().startChain(),
  stop: () => useChainProactiveStore.getState().stopChain(),
  // 自愈：自续 setTimeout 链在 HMR/异常中断后由分钟节拍重新拉起
  onTick: () => {
    const chain = useChainProactiveStore.getState();
    if (useModelRoleStore.getState().chainProactiveConfig.enabled && !chain.isActive) {
      chain.startChain();
    }
  },
};

const proactiveReplyModule: FeatureModule = {
  id: 'proactive-reply',
  name: '主动调度',
  version: '1.0.0',
  description: '分钟级定时器检查定时任务与随机主动；sendTaskMessage 为统一任务发送管线',
  isEnabled: () => useModelRoleStore.getState().proactiveReplyConfig.enabled,
  start: () => useProactiveReplyStore.getState().startScheduler(),
  stop: () => useProactiveReplyStore.getState().stopScheduler(),
  // 私有 setInterval 已移除：分钟节拍直接驱动检查（proactiveReplyStore 内部自带频控/去重）
  onTick: () => useProactiveReplyStore.getState().checkScheduledTrigger(),
};

const aiLifeModule: FeatureModule = {
  id: 'ai-life',
  name: 'AI 一日生活',
  version: '1.0.0',
  description: '日程引擎分钟 tick / 属性衰减 / 随机事件 / 经济自主运转；活动结算广播入口',
  isEnabled: () => !!useAiLifeStore.getState().config?.enabled,
  start: () => { /* 引擎由 ensureLifeEngineStarted 初始化，这里无需额外动作 */ },
  stop: () => { /* 停止 = 不再 tick；不销毁已有日程数据 */ },
  onTick: (ctx: MinuteTickCtx) => { lifeTick(ctx.characterId).catch(() => {}); },
  onActivityStart: (characterId, act) => { settleActivityStart(characterId, act.category).catch(() => {}); },
  onActivityEnd: (characterId, act) => { settleActivityEnd(characterId, act.id, act.category, act.name).catch(() => {}); },
};

/** 应用启动时调用一次：注册全部内置模块并做首轮启停收敛 */
export function registerBuiltinModules(): void {
  const reg = useModuleRegistry.getState();
  reg.register(chainProactiveModule);
  reg.register(proactiveReplyModule);
  reg.register(aiLifeModule);
  reg.syncAll();
}
