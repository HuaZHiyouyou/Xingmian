/**
 * ============================================================
 * 初始置办 · 条件基线目录（B2.3）+ 耐用品双模型工具（B2.2）
 * 基线：按性别/季节条件从商店目录确定性铺货（不走 LLM），
 *       保证"大米粮油/饮用水/常备药"等生活常理物品存在。
 * 耐久：itemClass/durability 存于库存 item.extra（免 DB 迁移），
 *       穿戴/使用扣耐久，durability≤0 → 物品损坏事件。
 * ============================================================
 */
import { getAllShopItems, SHOP_CATEGORY_META, type ShopEntry } from './localShop';
import type { AiInventoryItem } from '../../lib/tauriBridge';
import { recordLifeEvent } from './lifeEvents';

// ---------------- B2.3 条件基线 ----------------

interface BaselineRule {
  /** 商店目录按名称关键词匹配（任一命中即选该商品） */
  nameKeywords: string[];
  quantity: number;
  /** 性别条件（缺省 = 不限） */
  gender?: 'female' | 'male';
  /** 上架月份（缺省 = 常驻） */
  months?: number[];
  /** 说明（导出/日志用） */
  label: string;
}

/**
 * 条件基线规则：主食粮油/饮用水/鸡蛋/常备药/换洗衣物/洗漱。
 * 全部从商店目录选（保证后续扣库存/补货闭环）。
 */
const BASELINE_RULES: BaselineRule[] = [
  { nameKeywords: ['大米'], quantity: 2, label: '主食' },
  { nameKeywords: ['面条', '面粉', '挂面'], quantity: 1, label: '主食备选' },
  { nameKeywords: ['食用油', '调和油', '花生油'], quantity: 1, label: '粮油' },
  { nameKeywords: ['盐', '酱油'], quantity: 1, label: '调味' },
  { nameKeywords: ['矿泉水'], quantity: 2, label: '饮用水' },
  { nameKeywords: ['鸡蛋'], quantity: 2, label: '蛋白质' },
  { nameKeywords: ['感冒药'], quantity: 1, label: '常备药' },
  { nameKeywords: ['肠胃药', '创可贴'], quantity: 1, label: '常备药备选' },
  { nameKeywords: ['居家服', '睡衣'], quantity: 2, label: '换洗衣物' },
  { nameKeywords: ['毛巾'], quantity: 1, label: '洗漱' },
  // 性别必需品示例（目录含卫生巾类目时对女性角色生效）
  { nameKeywords: ['卫生巾', '卫生棉'], quantity: 1, gender: 'female', label: '性别必需品' },
];

export interface BaselinePick {
  shopItem: ShopEntry;
  quantity: number;
  label: string;
}

/** 按角色性别 + 当前月份铺基线（确定性，不走 LLM；目录无匹配项自动跳过） */
export function buildBaselinePicks(opts: { gender?: string; month?: number }): BaselinePick[] {
  const catalog = getAllShopItems().filter((s) => s.stock !== false);
  const month = opts.month ?? new Date().getMonth() + 1;
  const picks: BaselinePick[] = [];
  const usedIds = new Set<string>();

  for (const rule of BASELINE_RULES) {
    if (rule.gender && opts.gender && opts.gender !== rule.gender) continue;
    if (rule.months && !rule.months.includes(month)) continue;
    // 已被更早的规则占用的商品不重复选
    const hit = catalog.find(
      (s) => !usedIds.has(s.id) && rule.nameKeywords.some((kw) => s.name.includes(kw) || s.tags.some((t) => t.includes(kw)))
    );
    if (hit) {
      usedIds.add(hit.id);
      picks.push({ shopItem: hit, quantity: rule.quantity, label: rule.label });
    }
  }
  return picks;
}

/** 基线预算占比：初始存款中划给 AI 自由采购的比例 */
export const BASELINE_AI_SHOP_BUDGET_RATIO = 0.3;

/** 把基线 + AI 采购清单转成库存行（耐用品自动标记 itemClass/durability） */
export function buildInventoryItems(
  characterId: string,
  picks: Array<{ shopItem: ShopEntry; quantity: number }>,
): AiInventoryItem[] {
  const now = new Date().toISOString();
  return picks.map(({ shopItem, quantity }) => {
    const invCategory = SHOP_CATEGORY_META[shopItem.category as keyof typeof SHOP_CATEGORY_META]?.invCategory || 'tool';
    const durable = ['clothing', 'hobby', 'home', 'digital'].includes(shopItem.category);
    return {
      id: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      characterId,
      category: invCategory,
      name: shopItem.name,
      quantity: durable ? 1 : quantity,
      quality: 'good',
      extra: durable
        ? { itemClass: 'durable', durability: 100, shopItemId: shopItem.id }
        : { itemClass: 'consumable', shopItemId: shopItem.id },
      updatedAt: now,
    };
  });
}

// ---------------- B2.2 耐用品双模型工具 ----------------

/** 从 item.extra 读取耐久（无标记视为消耗品） */
export function getItemClass(item: AiInventoryItem): 'consumable' | 'durable' {
  return (item.extra?.itemClass as 'consumable' | 'durable') || 'consumable';
}

export function getDurability(item: AiInventoryItem): number | undefined {
  const d = item.extra?.durability;
  return typeof d === 'number' ? d : undefined;
}

/** 穿戴/使用扣耐久：返回更新后的 item（ durability≤0 → 损坏标记 broken） */
export function applyWear(item: AiInventoryItem, amount: number): AiInventoryItem {
  if (getItemClass(item) !== 'durable') return item;
  const cur = getDurability(item) ?? 100;
  const next = Math.max(0, cur - amount);
  return { ...item, extra: { ...item.extra, durability: next, broken: next <= 0 }, updatedAt: new Date().toISOString() };
}

/** 扫描库存：耐久 <20 或已损坏 → 换新念头/损坏事件（决策引擎库存路调用） */
export async function checkDurableWear(characterId: string, inventory: AiInventoryItem[]): Promise<void> {
  for (const item of inventory) {
    if (getItemClass(item) !== 'durable') continue;
    const d = getDurability(item);
    if (d === undefined) continue;
    if (d <= 0) {
      await recordLifeEvent({
        characterId, type: 'consume', itemId: item.id,
        description: `「${item.name}」已经用坏了，需要换新`,
        meta: { itemClass: 'durable', durability: d, broken: true },
      });
    } else if (d < 20) {
      await recordLifeEvent({
        characterId, type: 'consume', itemId: item.id,
        description: `「${item.name}」快用坏了（耐久 ${Math.round(d)}），该看看新的了`,
        meta: { itemClass: 'durable', durability: d },
      });
    }
  }
}
