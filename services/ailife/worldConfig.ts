/**
 * ============================================================
 * AI 一日 · 世界设定包（阶段 6）
 *  - 内置「现代日常」包自动播种
 *  - 导入/导出 JSON（tauri-plugin-dialog/fs）
 *  - 日程生成时按世界包校验场景与活动名
 * ============================================================
 */
import { dbDeleteWorldConfig, dbGetWorldConfigs, dbSaveWorldConfig, WorldConfigData, WorldConfigRecord } from '../../lib/tauriBridge';
import { useDebugLog } from '../../store/debugLogStore';
import { BUILTIN_GAME_WORLD_PACKS, normalizeWorldConfigData, packToRecord } from './builtinWorlds';

/** 当前世界设定包文档格式版本 */
export const WORLD_PACK_FORMAT_VERSION = 2;

/** 已退役的内置包 id（历史版本曾内置、现已移除；启动时从 DB 清除） */
const RETIRED_BUILTIN_WORLD_IDS = new Set<string>([
  'world_builtin_lads',
]);

export const BUILTIN_MODERN_WORLD_ID = 'world_builtin_modern';

export function createBuiltinModernWorld(): WorldConfigRecord {
  return {
    id: BUILTIN_MODERN_WORLD_ID,
    name: '现代日常',
    worldType: 'modern_real',
    isBuiltin: true,
    updatedAt: new Date().toISOString(),
    config: {
      description: '现实现代都市的日常生活设定',
      locations: ['卧室', '卫生间', '厨房', '餐厅', '客厅', '书房', '阳台', '办公室', '工作区', '商场', '公园', '健身房', '车内'],
      transport: ['步行', '地铁', '公交', '打车', '开车', '骑行'],
      currency: ['元'],
      activities: {
        daily: ['睡觉', '起床洗漱', '做早餐', '吃早餐', '午餐与午休', '晚餐时间', '洗漱准备休息'],
        work: ['上午工作', '下午工作'],
        leisure: ['休闲时光', '运动锻炼', '自由阅读', '观影/游戏'],
        social: ['外出逛街', '和朋友聚会'],
        special: ['买菜', '看病', '收快递'],
      },
      events: ['遇到一只很亲人的猫', '突然下雨了', '收到快递'],
    },
  };
}

/** 确保内置世界包存在（应用启动时调用；含二游世界观包，幂等；并清理已退役包） */
export async function ensureBuiltinWorlds(): Promise<void> {
  try {
    const all = await dbGetWorldConfigs();
    // 退役包清理：老用户 DB 中可能残留历史版本内置的包
    for (const w of all) {
      if (w.isBuiltin && RETIRED_BUILTIN_WORLD_IDS.has(w.id)) {
        try {
          await dbDeleteWorldConfig(w.id);
          useDebugLog.getState().add('system', `[AI一日] 已移除退役世界设定包「${w.name}」`);
        } catch { /* 单个清理失败不影响其余 */ }
      }
    }
    const remaining = await dbGetWorldConfigs();
    const seeds: WorldConfigRecord[] = [
      createBuiltinModernWorld(),
      ...BUILTIN_GAME_WORLD_PACKS.map(packToRecord),
    ];
    for (const s of seeds) {
      // 内置包随应用版本演进：每次启动都用最新内置数据刷新（内置包不可被用户编辑，覆盖安全）
      const existing = remaining.find((w) => w.id === s.id);
      if (!existing || JSON.stringify(existing.config) !== JSON.stringify(s.config)) {
        try {
          await dbSaveWorldConfig(s);
        } catch { /* 单个播种失败不影响其余 */ }
      }
    }
  } catch { /* 非 Tauri 环境静默 */ }
}

/** 获取指定 id 的世界包（未找到返回 null） */
export async function getWorldById(id?: string): Promise<WorldConfigRecord | null> {
  if (!id) return null;
  const all = await dbGetWorldConfigs();
  return all.find((w) => w.id === id) || null;
}

// ---------------- 🆕 B6.4 设定包匹配 ----------------

/**
 * 设定包关键词匹配：角色名 + 人设/背景关键词 vs 世界包的
 * 名称/世界观/术语/代表角色 计分。返回得分最高的包（阈值 2 分）。
 * 得分规则：角色名命中包名/关键词 +2；人设背景词命中 lore/术语/角色名 +1/次（封顶 3）。
 */
export async function matchWorldForCharacter(
  character: { name?: string; personality?: string; background?: string },
): Promise<{ world: WorldConfigRecord; score: number } | null> {
  try {
    const MATCH_THRESHOLD = 2;
    const all = await dbGetWorldConfigs();
    if (all.length === 0) return null;

    const charName = (character.name || '').trim();
    const bioText = `${character.personality || ''} ${character.background || ''}`;

    let best: { world: WorldConfigRecord; score: number } | null = null;
    for (const w of all) {
      let score = 0;
      const nameHay = `${w.name} ${w.config.description || ''}`;
      if (charName && charName.length >= 2 && nameHay.includes(charName)) score += 2;

      // 人设/背景关键词命中：lore / 术语 / 代表角色名
      const loreHay = [
        w.config.lore || '',
        Object.keys(w.config.terminology || {}).join(' '),
        Object.values(w.config.terminology || {}).join(' '),
        (w.config.characters || []).map((c) => `${c.name} ${c.relation || ''}`).join(' '),
      ].join(' ');
      if (loreHay) {
        // 取人设/背景中的 2 字词粗扫（中文场景够用）
        const tokens = bioText.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
        const uniqueTokens = Array.from(new Set(tokens)).slice(0, 30);
        let hits = 0;
        for (const tk of uniqueTokens) {
          if (loreHay.includes(tk)) hits++;
          if (hits >= 3) break;
        }
        score += hits;
      }

      if (!best || score > best.score) best = { world: w, score };
    }

    return best && best.score >= MATCH_THRESHOLD ? best : null;
  } catch {
    return null;
  }
}

// ---------------- 活动校验 ----------------

/**
 * 按世界包校验活动：场景不在地点库时回退到"家"；
 * 活动名包含不匹配的交通方式时替换为默认。
 * 返回修正后的 sceneId/location。
 */
export function sanitizeActivityAgainstWorld(
  scene: string,
  world: WorldConfigRecord | null,
): string {
  if (!world) return scene;
  const locations = world.config.locations || [];
  if (locations.length === 0) return scene;
  // 场景名在库中或为组合场景（如 "卧室/卫生间"，任一命中即可）
  const parts = scene.split(/[/、，,]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return scene;
  if (parts.some((p) => locations.some((l) => l === p || p.includes(l) || l.includes(p)))) {
    return scene;
  }
  useDebugLog.getState().add('system', `[AI一日] 世界包过滤: 场景「${scene}」不在「${world.name}」中，回退到「${locations[0]}」`);
  return locations[0];
}

// ---------------- 导入 / 导出 ----------------

export async function exportWorldConfig(world: WorldConfigRecord): Promise<boolean> {
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({
      defaultPath: `${world.name || 'world'}.ailworld.json`,
      filters: [{ name: 'AI 一日世界设定包', extensions: ['json'] }],
    });
    if (!path) return false;
    await writeTextFile(path, JSON.stringify({
      formatVersion: WORLD_PACK_FORMAT_VERSION,
      name: world.name,
      worldType: world.worldType,
      config: world.config,
    }, null, 2));
    return true;
  } catch (e) {
    console.error('[worldConfig] export failed:', e);
    return false;
  }
}

export async function importWorldConfig(): Promise<WorldConfigRecord | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await open({
      multiple: false,
      filters: [{ name: 'AI 一日世界设定包', extensions: ['json'] }],
    });
    if (!path || typeof path !== 'string') return null;
    const raw = JSON.parse(await readTextFile(path)) as Partial<WorldConfigRecord> & { config?: WorldConfigData };
    if (!raw.name || typeof raw.config !== 'object') throw new Error('格式无效');
    const record: WorldConfigRecord = {
      id: `world_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: String(raw.name),
      worldType: String(raw.worldType || 'custom'),
      isBuiltin: false,
      updatedAt: new Date().toISOString(),
      // v1/v2 均可导入：字段级规范化，非法值剔除
      config: normalizeWorldConfigData(raw.config),
    };
    await dbSaveWorldConfig(record);
    const ver = typeof (raw as { formatVersion?: unknown }).formatVersion === 'number' ? (raw as { formatVersion: number }).formatVersion : 1;
    useDebugLog.getState().add('system', `[AI一日] 已导入世界设定包「${record.name}」（formatVersion ${ver}）`);
    return record;
  } catch (e) {
    console.error('[worldConfig] import failed:', e);
    return null;
  }
}
