/**
 * ============================================================
 * B1: 功能模块注册表
 * 链式主动 / 定时回复 / AI-Life 等功能收敛为标准 FeatureModule：
 *   - 统一生命周期（start/stop 由注册表驱动，模块不再持有私有定时器）
 *   - 统一分钟节拍（唯一心跳在注册表，模块只实现 onTick；HMR 只会重建
 *     注册表实例并先清旧心跳，从结构上消灭"僵尸实例并发 tick"）
 *   - 活动结算钩子（onActivityStart/onActivityEnd，C1 经济结算的入口）
 *   - 设置页配置卡片消费（模块元信息 + 启停 + 运行状态）
 * ============================================================
 */
import { create } from 'zustand';
import { useDebugLog } from '../../store/debugLogStore';

export interface MinuteTickCtx {
  /** 当前选中角色（可能为空） */
  characterId?: string;
}

/** 活动结算钩子的最小活动结构（避免依赖完整 AiLifeActivity 类型造成环） */
export interface ActivityRef {
  id: string;
  name: string;
  category: string;
}

export interface FeatureModule {
  id: string;
  name: string;
  version: string;
  description: string;
  /** 是否启用（读各模块现有配置，设置卡片的启停开关写回这些配置） */
  isEnabled: () => boolean;
  /** 启停（幂等；注册表按 isEnabled 状态收敛） */
  start: () => void;
  stop: () => void;
  /** 统一分钟节拍（仅 started 且 enabled 时调用） */
  onTick?: (ctx: MinuteTickCtx) => void;
  /** 活动结算钩子（AI-Life 活动开始/结束时广播给所有模块） */
  onActivityStart?: (characterId: string, act: ActivityRef) => void;
  onActivityEnd?: (characterId: string, act: ActivityRef) => void;
}

interface ModuleRuntime {
  started: boolean;
}

interface RegistryState {
  modules: FeatureModule[];
  runtime: Record<string, ModuleRuntime>;
  register: (m: FeatureModule) => void;
  syncAll: () => void;
  tick: (ctx: MinuteTickCtx) => void;
  dispatchActivityStart: (characterId: string, act: ActivityRef) => void;
  dispatchActivityEnd: (characterId: string, act: ActivityRef) => void;
}

export const useModuleRegistry = create<RegistryState>((set, get) => ({
  modules: [],
  runtime: {},

  register: (m) => {
    if (get().modules.some((x) => x.id === m.id)) return;
    set((s) => ({ modules: [...s.modules, m], runtime: { ...s.runtime, [m.id]: { started: false } } }));
  },

  /** 按 isEnabled 收敛全部模块的启停状态 */
  syncAll: () => {
    for (const m of get().modules) {
      const rt = get().runtime[m.id];
      const shouldRun = m.isEnabled();
      if (shouldRun && !rt?.started) {
        try { m.start(); } catch (e) { console.error(`[registry] start ${m.id} failed:`, e); }
        set((s) => ({ runtime: { ...s.runtime, [m.id]: { started: true } } }));
        useDebugLog.getState().add('system', `[模块] ${m.name} 已启动`);
      } else if (!shouldRun && rt?.started) {
        try { m.stop(); } catch (e) { console.error(`[registry] stop ${m.id} failed:`, e); }
        set((s) => ({ runtime: { ...s.runtime, [m.id]: { started: false } } }));
        useDebugLog.getState().add('system', `[模块] ${m.name} 已停止`);
      }
    }
  },

  tick: (ctx) => {
    get().syncAll(); // 配置变化（设置页开关/HMR）→ 先收敛启停
    for (const m of get().modules) {
      if (!get().runtime[m.id]?.started || !m.isEnabled()) continue;
      try { m.onTick?.(ctx); } catch (e) { console.error(`[registry] tick ${m.id} failed:`, e); }
    }
  },

  dispatchActivityStart: (characterId, act) => {
    for (const m of get().modules) {
      try { m.onActivityStart?.(characterId, act); } catch (e) { console.error(`[registry] onActivityStart ${m.id} failed:`, e); }
    }
  },

  dispatchActivityEnd: (characterId, act) => {
    for (const m of get().modules) {
      try { m.onActivityEnd?.(characterId, act); } catch (e) { console.error(`[registry] onActivityEnd ${m.id} failed:`, e); }
    }
  },
}));
