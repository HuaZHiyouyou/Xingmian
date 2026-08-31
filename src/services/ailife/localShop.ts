/**
 * ============================================================
 * AI 一日 · 内置商店（纯本地，无 API）
 *  - 细分分类：水果/蔬菜/饮料/食材粮油/调味/日用品/个护美妆/药品/衣物/小娱乐
 *  - 每件商品带标签（tags），支持标签筛选，商品归类更准确
 *  - purchaseItem：余额校验 → 扣款 → 入库/消耗 → 流水（带角色语气备注）
 *  - 供商店 UI 与本地自主补货引擎（localEconomy）共用
 * ============================================================
 */
import {
  dbGetAiEconomy, dbSaveAiEconomy, dbAddAiTransaction,
  dbSaveAiInventoryItems, dbGetAiInventory,
  type AiInventoryItem,
} from '../../lib/tauriBridge';
import { useDebugLog } from '../../store/debugLogStore';

export type ShopCategory =
  | 'fruit' | 'vegetable' | 'drink' | 'food' | 'seasoning'
  | 'daily' | 'feminine' | 'medicine' | 'clothing' | 'digital' | 'fun'
  | 'hobby' | 'home' | 'gift' | 'festival' | 'service';

export interface ShopEntry {
  id: string;
  name: string;
  /** 分类 code（内置或用户/AI 自定义） */
  category: string;
  /** 🆕 标签（用于筛选与更准确的归类） */
  tags: string[];
  price: number;
  description: string;
  /** 购买后是否入库（false = 即时消耗，如奶茶） */
  stock: boolean;
  /** 套装标记（服装套装展示用） */
  isSet?: boolean;
  /** 🆕 C3: 耐用品解锁的活动/消遣名（买吉他 → 解锁「练吉他」；C2 抽签池与日记可引用） */
  unlocks?: string[];
  /** 🆕 C3: 节日/季节限定上架月份（缺省 = 常驻） */
  availableMonths?: number[];
}

/** 分类 → 库存分类映射（冰箱/衣柜/药箱/日用品） */
export const SHOP_CATEGORY_META: Record<ShopCategory, { label: string; invCategory: string }> = {
  fruit: { label: '水果', invCategory: 'food' },
  vegetable: { label: '蔬菜', invCategory: 'food' },
  drink: { label: '饮料', invCategory: 'food' },
  food: { label: '食材粮油', invCategory: 'food' },
  seasoning: { label: '调味', invCategory: 'food' },
  daily: { label: '日用品', invCategory: 'tool' },
  feminine: { label: '个护美妆', invCategory: 'tool' },
  medicine: { label: '药品', invCategory: 'medicine' },
  clothing: { label: '衣物', invCategory: 'clothing' },
  digital: { label: '数码', invCategory: 'tool' },
  fun: { label: '小娱乐', invCategory: 'tool' },
  hobby: { label: '兴趣耐用品', invCategory: 'hobby' },
  home: { label: '家居耐用品', invCategory: 'home' },
  gift: { label: '礼物', invCategory: 'gift' },
  festival: { label: '节日限定', invCategory: 'gift' },
  service: { label: '服务型', invCategory: 'tool' },
};

export const SHOP_CATALOG: ShopEntry[] = [
  // —— 水果 ——
  { id: 'shop_fr_apple', name: '苹果', category: 'fruit', tags: ['新鲜', '日常'], price: 6, description: '一天一苹果', stock: true },
  { id: 'shop_fr_banana', name: '香蕉', category: 'fruit', tags: ['能量', '日常'], price: 5, description: '运动前后都合适', stock: true },
  { id: 'shop_fr_orange', name: '橙子', category: 'fruit', tags: ['维C', '新鲜'], price: 8, description: '剥皮即食', stock: true },
  { id: 'shop_fr_grape', name: '葡萄', category: 'fruit', tags: ['下午茶'], price: 12, description: '一口一个', stock: true },
  { id: 'shop_fr_watermelon', name: '西瓜', category: 'fruit', tags: ['夏季', '解暑'], price: 15, description: '冰镇更佳', stock: true },
  { id: 'shop_fr_strawberry', name: '草莓', category: 'fruit', tags: ['下午茶', '甜'], price: 18, description: '红彤彤一盒', stock: true },
  { id: 'shop_fr_kiwi', name: '猕猴桃', category: 'fruit', tags: ['维C'], price: 10, description: '酸酸甜甜', stock: true },
  { id: 'shop_fr_pear', name: '雪梨', category: 'fruit', tags: ['润肺'], price: 5, description: '炖冰糖好搭配', stock: true },
  { id: 'shop_fr_peach', name: '水蜜桃', category: 'fruit', tags: ['夏季'], price: 8, description: '软糯多汁', stock: true },
  { id: 'shop_fr_lychee', name: '荔枝', category: 'fruit', tags: ['夏季'], price: 14, description: '日啖三百颗', stock: true },
  { id: 'shop_fr_mango', name: '芒果', category: 'fruit', tags: ['热带'], price: 13, description: '香甜浓郁', stock: true },
  { id: 'shop_fr_cherry', name: '车厘子', category: 'fruit', tags: ['下午茶', '贵贵'], price: 32, description: '偶尔奢侈一下', stock: true },
  { id: 'shop_fr_pomelo', name: '柚子', category: 'fruit', tags: ['秋冬'], price: 11, description: '一瓣一瓣慢慢吃', stock: true },
  { id: 'shop_fr_durian', name: '榴莲', category: 'fruit', tags: ['热带', '重口味'], price: 59, description: '爱的爱恨的恨', stock: true },

  // —— 蔬菜 ——
  { id: 'shop_ve_tomato', name: '番茄', category: 'vegetable', tags: ['新鲜', '沙拉'], price: 6, description: '生吃炒蛋两相宜', stock: true },
  { id: 'shop_ve_cucumber', name: '黄瓜', category: 'vegetable', tags: ['新鲜', '沙拉'], price: 4, description: '拍个凉菜', stock: true },
  { id: 'shop_ve_lettuce', name: '生菜', category: 'vegetable', tags: ['沙拉', '轻食'], price: 5, description: '涮炒皆可', stock: true },
  { id: 'shop_ve_potato', name: '土豆', category: 'vegetable', tags: ['家常', '耐放'], price: 6, description: '丝片泥全能', stock: true },
  { id: 'shop_ve_carrot', name: '胡萝卜', category: 'vegetable', tags: ['家常'], price: 5, description: '配菜担当', stock: true },
  { id: 'shop_ve_broccoli', name: '西兰花', category: 'vegetable', tags: ['健康', '轻食'], price: 9, description: '水煮就很好', stock: true },
  { id: 'shop_ve_mushroom', name: '蘑菇', category: 'vegetable', tags: ['鲜'], price: 8, description: '提鲜神器', stock: true },

  // —— 饮料 ——
  { id: 'shop_dr_water', name: '矿泉水（12瓶）', category: 'drink', tags: ['基础', '囤货'], price: 12, description: '家里常备', stock: true },
  { id: 'shop_dr_sparkling', name: '气泡水', category: 'drink', tags: ['无糖'], price: 18, description: '0糖0卡', stock: true },
  { id: 'shop_dr_juice', name: '鲜榨橙汁', category: 'drink', tags: ['维C'], price: 15, description: '早餐来一杯', stock: true },
  { id: 'shop_dr_cola', name: '可乐', category: 'drink', tags: ['快乐水'], price: 12, description: '冰镇快乐水', stock: true },
  { id: 'shop_dr_tea', name: '绿茶', category: 'drink', tags: ['清爽'], price: 10, description: '解腻去火', stock: true },
  { id: 'shop_dr_yogurt', name: '酸奶', category: 'drink', tags: ['益生菌', '早餐'], price: 14, description: '饭后一杯', stock: true },
  { id: 'shop_dr_soy', name: '豆浆', category: 'drink', tags: ['早餐', '植物蛋白'], price: 8, description: '暖乎乎一杯', stock: true },

  // —— 食材粮油 ——
  { id: 'shop_fd_rice', name: '大米（5kg）', category: 'food', tags: ['主食', '基础', '囤货'], price: 30, description: '主食担当', stock: true },
  { id: 'shop_fd_flour', name: '面粉（2kg）', category: 'food', tags: ['主食', '烘焙'], price: 12, description: '包子面条的起点', stock: true },
  { id: 'shop_fd_noodle', name: '挂面', category: 'food', tags: ['主食', '快手'], price: 8, description: '五分钟一碗面', stock: true },
  { id: 'shop_fd_egg', name: '鸡蛋一盒', category: 'food', tags: ['蛋白', '早餐', '基础'], price: 12, description: '万能食材', stock: true },
  { id: 'shop_fd_milk', name: '牛奶', category: 'food', tags: ['蛋白', '早餐'], price: 8, description: '早餐标配', stock: true },
  { id: 'shop_fd_bread', name: '吐司面包', category: 'food', tags: ['早餐', '快手'], price: 10, description: '两片夹一切', stock: true },
  { id: 'shop_fd_bento', name: '速食便当', category: 'food', tags: ['快手'], price: 15, description: '微波炉叮三分钟', stock: true },
  { id: 'shop_fd_chicken', name: '鸡胸肉', category: 'food', tags: ['蛋白', '健身'], price: 15, description: '低脂高蛋白', stock: true },
  { id: 'shop_fd_oil', name: '食用油（1L）', category: 'food', tags: ['烹饪', '基础', '囤货'], price: 28, description: '炒菜离不开', stock: true },
  { id: 'shop_fd_coffee', name: '咖啡豆', category: 'food', tags: ['续命'], price: 38, description: '手磨更香', stock: true },
  { id: 'shop_fd_snack', name: '零食大礼包', category: 'food', tags: ['追剧', '组合', '套装'], price: 25, description: '多种零食混装一包', stock: true, isSet: true },

  // —— 调味 ——
  { id: 'shop_se_salt', name: '食用盐', category: 'seasoning', tags: ['基础', '烹饪'], price: 5, description: '百味之首', stock: true },
  { id: 'shop_se_soy', name: '酱油', category: 'seasoning', tags: ['中式', '烹饪'], price: 8, description: '红烧必备', stock: true },
  { id: 'shop_se_vinegar', name: '香醋', category: 'seasoning', tags: ['中式'], price: 7, description: '蘸饺子灵魂', stock: true },
  { id: 'shop_se_oyster', name: '蚝油', category: 'seasoning', tags: ['中式'], price: 9, description: '提鲜一绝', stock: true },
  { id: 'shop_se_cookwine', name: '料理料酒', category: 'seasoning', tags: ['中式', '去腥'], price: 8, description: '腌肉去腥', stock: true },
  { id: 'shop_se_pepper', name: '黑胡椒粉', category: 'seasoning', tags: ['西式'], price: 10, description: '牛排伴侣', stock: true },
  { id: 'shop_se_dressing', name: '沙拉酱', category: 'seasoning', tags: ['西式', '沙拉'], price: 12, description: '蔬菜好伙伴', stock: true },
  { id: 'shop_se_set', name: '调味料套装', category: 'seasoning', tags: ['组合', '套装', '新家'], price: 22, description: '十三香+蚝油+料酒 多件组合', stock: true, isSet: true },

  // —— 日用品 ——
  { id: 'shop_daily_shampoo', name: '洗发水', category: 'daily', tags: ['洗护', '囤货'], price: 32, description: '用得挺快的', stock: true },
  { id: 'shop_daily_bodywash', name: '沐浴露', category: 'daily', tags: ['洗护'], price: 28, description: '香香的', stock: true },
  { id: 'shop_daily_laundry', name: '洗衣液', category: 'daily', tags: ['清洁', '囤货'], price: 35, description: '衣服要香香', stock: true },
  { id: 'shop_daily_tissue', name: '纸巾（4包）', category: 'daily', tags: ['纸品', '囤货'], price: 15, description: '永远不嫌多', stock: true },
  { id: 'shop_daily_toothpaste', name: '牙膏', category: 'daily', tags: ['洗护'], price: 12, description: '早晚各一次', stock: true },
  { id: 'shop_daily_cleanser', name: '洗面奶', category: 'daily', tags: ['洗护'], price: 26, description: '认真洗脸', stock: true },
  { id: 'shop_daily_towel', name: '毛巾', category: 'daily', tags: ['家纺'], price: 18, description: '柔软吸水', stock: true },
  { id: 'shop_daily_dishcloth', name: '洗碗布（3片）', category: 'daily', tags: ['清洁'], price: 6, description: '厨房消耗品', stock: true },
  { id: 'shop_daily_trashbag', name: '垃圾袋（3卷）', category: 'daily', tags: ['清洁', '囤货'], price: 9, description: '家家必备', stock: true },
  { id: 'shop_daily_wrap', name: '保鲜膜', category: 'daily', tags: ['厨房'], price: 8, description: '剩菜救星', stock: true },
  { id: 'shop_daily_soap', name: '香皂', category: 'daily', tags: ['洗护'], price: 6, description: '经典不过时', stock: true },
  { id: 'shop_daily_toothbrush', name: '牙刷（2支）', category: 'daily', tags: ['洗护'], price: 10, description: '三个月一换', stock: true },
  { id: 'shop_daily_handwash', name: '洗手液', category: 'daily', tags: ['清洁'], price: 15, description: '饭前便后', stock: true },
  { id: 'shop_daily_freshener', name: '空气清新剂', category: 'daily', tags: ['家居'], price: 12, description: '满屋清香', stock: true },
  { id: 'shop_daily_mothball', name: '樟脑丸', category: 'daily', tags: ['收纳'], price: 8, description: '衣柜防潮防虫', stock: true },

  // —— 个护美妆 ——
  { id: 'shop_fem_pad_day', name: '卫生巾（日用）', category: 'feminine', tags: ['护理', '囤货'], price: 12, description: '日常必备', stock: true },
  { id: 'shop_fem_pad_night', name: '卫生巾（夜用）', category: 'feminine', tags: ['护理', '囤货'], price: 15, description: '安睡整晚', stock: true },
  { id: 'shop_fem_liner', name: '纯棉护垫', category: 'feminine', tags: ['护理'], price: 10, description: '轻薄透气', stock: true },
  { id: 'shop_fem_wash', name: '护理洗液', category: 'feminine', tags: ['护理'], price: 22, description: '温和清洁', stock: true },
  { id: 'shop_fem_remover', name: '卸妆水', category: 'feminine', tags: ['美妆'], price: 39, description: '温和不刺激', stock: true },
  { id: 'shop_fem_cotton', name: '化妆棉（200片）', category: 'feminine', tags: ['美妆'], price: 10, description: '护肤好搭档', stock: true },
  { id: 'shop_fem_mask', name: '补水面膜（5片）', category: 'feminine', tags: ['美妆', '护肤'], price: 29, description: '敷一片回血', stock: true },
  { id: 'shop_fem_lipstick', name: '口红', category: 'feminine', tags: ['美妆'], price: 89, description: '气色全靠它', stock: true },
  { id: 'shop_fem_perfume', name: '淡香水', category: 'feminine', tags: ['美妆'], price: 128, description: '若隐若现的温柔', stock: true },

  // —— 药品 ——
  { id: 'shop_med_cold', name: '感冒药', category: 'medicine', tags: ['常备'], price: 20, description: '家里常备', stock: true },
  { id: 'shop_med_stomach', name: '肠胃药', category: 'medicine', tags: ['常备'], price: 18, description: '吃坏了救急', stock: true },
  { id: 'shop_med_bandage', name: '创可贴', category: 'medicine', tags: ['常备'], price: 8, description: '小伤口处理', stock: true },
  { id: 'shop_med_vc', name: '维C泡腾片', category: 'medicine', tags: ['保健'], price: 22, description: '每天一杯', stock: true },
  { id: 'shop_med_fever', name: '退烧贴', category: 'medicine', tags: ['常备'], price: 14, description: '物理降温', stock: true },

  // —— 衣物（含套装） ——
  { id: 'shop_clo_tee', name: '基础T恤', category: 'clothing', tags: ['百搭'], price: 59, description: '百搭款', stock: true },
  { id: 'shop_clo_hoodie', name: '连帽卫衣', category: 'clothing', tags: ['休闲'], price: 129, description: '舒适出行', stock: true },
  { id: 'shop_clo_jeans', name: '牛仔裤', category: 'clothing', tags: ['经典'], price: 149, description: '耐穿经典', stock: true },
  { id: 'shop_clo_dress', name: '连衣裙', category: 'clothing', tags: ['约会'], price: 169, description: '约会战袍', stock: true },
  { id: 'shop_clo_sneaker', name: '运动鞋', category: 'clothing', tags: ['运动'], price: 199, description: '走路都轻快', stock: true },
  { id: 'shop_clo_scarf', name: '围巾', category: 'clothing', tags: ['保暖'], price: 49, description: '冬天的温柔', stock: true },
  { id: 'shop_clo_shirt', name: '衬衫', category: 'clothing', tags: ['通勤'], price: 79, description: '干净利落', stock: true },
  { id: 'shop_clo_sweater', name: '毛衣', category: 'clothing', tags: ['保暖'], price: 139, description: '软糯温暖', stock: true },
  { id: 'shop_clo_skirt', name: '半身裙', category: 'clothing', tags: ['约会'], price: 99, description: '百搭温柔', stock: true },
  { id: 'shop_clo_shorts', name: '短裤', category: 'clothing', tags: ['夏季'], price: 49, description: '清凉一夏', stock: true },
  { id: 'shop_clo_cap', name: '鸭舌帽', category: 'clothing', tags: ['休闲', '配饰'], price: 39, description: '防晒凹造型', stock: true },
  { id: 'shop_clo_socks', name: '袜子（5双）', category: 'clothing', tags: ['基础', '囤货'], price: 29, description: '一次囤够', stock: true },
  { id: 'shop_clo_belt', name: '皮带', category: 'clothing', tags: ['配饰'], price: 45, description: '细节质感', stock: true },
  { id: 'shop_clo_canvas', name: '帆布鞋', category: 'clothing', tags: ['休闲'], price: 119, description: '青春记忆', stock: true },
  { id: 'shop_clo_set_spring', name: '春日裙装套装', category: 'clothing', tags: ['套装', '约会'], price: 239, description: '上衣+半裙成套搭配', stock: true, isSet: true },
  { id: 'shop_clo_set_business', name: '商务正装套装', category: 'clothing', tags: ['套装', '通勤'], price: 399, description: '面试通勤一步到位', stock: true, isSet: true },
  { id: 'shop_clo_set_home', name: '居家绒睡套装', category: 'clothing', tags: ['套装', '居家'], price: 119, description: '柔软亲肤三件套', stock: true, isSet: true },
  { id: 'shop_clo_set_winter', name: '冬季羽绒套装', category: 'clothing', tags: ['套装', '保暖'], price: 459, description: '羽绒服+加绒裤', stock: true, isSet: true },

  // —— 🆕 数码 ——
  { id: 'shop_dig_earphone', name: '蓝牙耳机', category: 'digital', tags: ['数码', '无线'], price: 199, description: '通勤好伙伴', stock: true },
  { id: 'shop_dig_powerbank', name: '充电宝（10000mAh）', category: 'digital', tags: ['数码', '出门'], price: 89, description: '电量焦虑救星', stock: true },
  { id: 'shop_dig_cable', name: '数据线', category: 'digital', tags: ['数码', '基础'], price: 19, description: '永远不够用', stock: true },
  { id: 'shop_dig_case', name: '手机壳', category: 'digital', tags: ['数码', '保护'], price: 39, description: '换个心情', stock: true },
  { id: 'shop_dig_speaker', name: '蓝牙音箱', category: 'digital', tags: ['数码', '氛围'], price: 149, description: '房间充满音乐', stock: true },
  { id: 'shop_dig_watch', name: '智能手表', category: 'digital', tags: ['数码', '健康'], price: 299, description: '运动监测', stock: true },
  { id: 'shop_dig_keyboard', name: '机械键盘', category: 'digital', tags: ['数码', '办公'], price: 179, description: '敲击的爽感', stock: true },
  { id: 'shop_dig_fan', name: 'USB小风扇', category: 'digital', tags: ['数码', '夏季'], price: 35, description: '桌面清凉', stock: true },

  // —— 小娱乐（部分即时消耗） ——
  { id: 'shop_fun_milktea', name: '一杯奶茶', category: 'fun', tags: ['即时消耗', '快乐水'], price: 16, description: '快乐水', stock: false },
  { id: 'shop_fun_comic', name: '漫画单行本', category: 'fun', tags: ['收藏'], price: 35, description: '收藏向', stock: true },
  { id: 'shop_fun_candle', name: '香薰蜡烛', category: 'fun', tags: ['氛围'], price: 45, description: '氛围感满分', stock: true },
  { id: 'shop_fun_sticker', name: '手账贴纸', category: 'fun', tags: ['可爱'], price: 12, description: '可爱装饰', stock: true },

  // —— 🆕 C3 耐用品·兴趣爱好（灵魂类目：解锁消遣活动） ——
  { id: 'shop_hoby_easel', name: '画板画架套装', category: 'hobby', tags: ['耐用品', '绘画'], price: 158, description: '画画的起点', stock: true, unlocks: ['画画'] },
  { id: 'shop_hoby_guitar', name: '入门吉他', category: 'hobby', tags: ['耐用品', '音乐'], price: 499, description: '总有一天学会它', stock: true, unlocks: ['练吉他'] },
  { id: 'shop_hoby_switch', name: '游戏主机', category: 'hobby', tags: ['耐用品', '游戏'], price: 1899, description: '客厅快乐源泉', stock: true, unlocks: ['打游戏'] },
  { id: 'shop_hoby_puzzle', name: '1000片拼图', category: 'hobby', tags: ['耐用品', '动手'], price: 68, description: '拼完想裱起来', stock: true, unlocks: ['拼拼图'] },
  { id: 'shop_hoby_baking', name: '烘焙工具套装', category: 'hobby', tags: ['耐用品', '烘焙'], price: 189, description: '烤箱伴侣', stock: true, unlocks: ['烘焙点心'] },
  { id: 'shop_hoby_plant', name: '多肉植物三件盆', category: 'hobby', tags: ['耐用品', '植物'], price: 39, description: '窗台的小生命', stock: true, unlocks: ['侍弄花草'] },
  { id: 'shop_hoby_camera', name: '拍立得相机', category: 'hobby', tags: ['耐用品', '摄影'], price: 459, description: '把瞬间留下来', stock: true, unlocks: ['出门拍照'] },
  { id: 'shop_hoby_diffuser', name: '香薰机', category: 'hobby', tags: ['耐用品', '氛围'], price: 129, description: '睡前仪式感', stock: true },
  { id: 'shop_hoby_knitting', name: '毛线编织套装', category: 'hobby', tags: ['耐用品', '手工'], price: 49, description: '织条围巾送人', stock: true, unlocks: ['织毛线'] },
  { id: 'shop_hoby_skate', name: '轮滑鞋', category: 'hobby', tags: ['耐用品', '运动'], price: 239, description: '风的自由', stock: true, unlocks: ['轮滑'] },
  { id: 'shop_hoby_badminton', name: '羽毛球拍对拍', category: 'hobby', tags: ['耐用品', '运动'], price: 139, description: '楼下就能打', stock: true, unlocks: ['打羽毛球'] },
  { id: 'shop_hoby_yogamat', name: '瑜伽垫', category: 'hobby', tags: ['耐用品', '运动'], price: 79, description: '客厅就是瑜伽馆', stock: true, unlocks: ['做瑜伽'] },
  { id: 'shop_hoby_dumbbell', name: '可调节哑铃', category: 'hobby', tags: ['耐用品', '健身'], price: 159, description: '在家也能练', stock: true, unlocks: ['力量训练'] },
  { id: 'shop_hoby_ukulele', name: '尤克里里', category: 'hobby', tags: ['耐用品', '音乐'], price: 219, description: '比吉他好上手', stock: true, unlocks: ['练尤克里里'] },
  { id: 'shop_hoby_calligraphy', name: '书法字帖套装', category: 'hobby', tags: ['耐用品', '静心'], price: 59, description: '练字即练心', stock: true, unlocks: ['练字'] },
  { id: 'shop_hoby_watercolor', name: '水彩颜料套装', category: 'hobby', tags: ['耐用品', '绘画'], price: 89, description: '颜色会透亮', stock: true, unlocks: ['画画'] },
  { id: 'shop_hoby_clay', name: '超轻黏土套装', category: 'hobby', tags: ['耐用品', '手工'], price: 29, description: '捏个小世界', stock: true, unlocks: ['捏黏土'] },
  { id: 'shop_hoby_boardgame', name: '桌游经典款', category: 'hobby', tags: ['耐用品', '聚会'], price: 99, description: '来客人的保留节目', stock: true, unlocks: ['玩桌游'] },
  { id: 'shop_hoby_fishing', name: '入门钓竿', category: 'hobby', tags: ['耐用品', '户外'], price: 129, description: '钓的是心境', stock: true, unlocks: ['钓鱼'] },
  { id: 'shop_hoby_campchair', name: '折叠露营椅', category: 'hobby', tags: ['耐用品', '户外'], price: 109, description: '公园草地专属座', stock: true, unlocks: ['去野餐'] },
  { id: 'shop_hoby_teapot', name: '功夫茶具', category: 'hobby', tags: ['耐用品', '茶'], price: 149, description: '慢下来喝杯茶', stock: true, unlocks: ['泡茶'] },
  { id: 'shop_hoby_coffee_press', name: '手冲咖啡壶', category: 'hobby', tags: ['耐用品', '咖啡'], price: 119, description: '早晨的手作仪式', stock: true, unlocks: ['手冲咖啡'] },
  { id: 'shop_hoby_vinyl', name: '黑胶唱片机', category: 'hobby', tags: ['耐用品', '音乐'], price: 599, description: '有温度的音质', stock: true, unlocks: ['听黑胶'] },
  { id: 'shop_hoby_switchgame', name: '游戏卡带', category: 'hobby', tags: ['游戏', '消耗'], price: 249, description: '新世界的大门', stock: true },
  { id: 'shop_hoby_kite', name: '传统风筝', category: 'hobby', tags: ['户外', '季节'], price: 45, description: '春风一起就想去', stock: true, availableMonths: [3, 4, 5], unlocks: ['放风筝'] },
  { id: 'shop_hoby_swim', name: '游泳装备套装', category: 'hobby', tags: ['运动', '季节'], price: 159, description: '夏天的正确打开方式', stock: true, availableMonths: [6, 7, 8], unlocks: ['游泳'] },
  { id: 'shop_hoby_sledge', name: '滑雪板', category: 'hobby', tags: ['运动', '季节'], price: 399, description: '冬天的期待', stock: true, availableMonths: [12, 1, 2], unlocks: ['滑雪'] },
  { id: 'shop_hoby_dumbbellband', name: '弹力带套装', category: 'hobby', tags: ['运动', '轻量'], price: 39, description: '出差也能练', stock: true, unlocks: ['拉伸训练'] },
  { id: 'shop_hoby_abacus', name: '算盘摆件', category: 'hobby', tags: ['复古', '装饰'], price: 69, description: '老物件的浪漫', stock: true },
  { id: 'shop_hoby_model', name: '拼装模型', category: 'hobby', tags: ['动手', '收藏'], price: 129, description: '完成那天很有成就感', stock: true, unlocks: ['拼模型'] },
  { id: 'shop_hoby_inkpad', name: '篆刻印章套装', category: 'hobby', tags: ['手工', '静心'], price: 79, description: '方寸之间见功夫', stock: true, unlocks: ['练篆刻'] },
  { id: 'shop_hoby_magnet', name: '冰箱贴收集套装', category: 'hobby', tags: ['收藏', '可爱'], price: 35, description: '旅行记忆的角落', stock: true },
  { id: 'shop_hoby_earbud', name: '监听耳机', category: 'hobby', tags: ['音乐', '数码'], price: 299, description: '听见细节', stock: true },
  { id: 'shop_hoby_eReader', name: '电子阅读器', category: 'hobby', tags: ['阅读', '数码'], price: 559, description: '泡面盖终结者', stock: true, unlocks: ['读书'] },
  { id: 'shop_hoby_deck', name: '塔罗牌', category: 'hobby', tags: ['神秘', '娱乐'], price: 55, description: '给生活一点仪式感', stock: true, unlocks: ['占卜娱乐'] },
  { id: 'shop_hoby_darts', name: '磁吸飞镖盘', category: 'hobby', tags: ['运动', '室内'], price: 89, description: '饭后两镖', stock: true, unlocks: ['玩飞镖'] },
  { id: 'shop_hoby_tent', name: '轻便帐篷', category: 'hobby', tags: ['户外', '大件'], price: 269, description: '说走就走', stock: true, unlocks: ['去露营'] },
  { id: 'shop_hoby_bikebell', name: '自行车配件包', category: 'hobby', tags: ['骑行', '户外'], price: 59, description: '骑行党细节', stock: true, unlocks: ['骑车兜风'] },
  { id: 'shop_hoby_scratch', name: '刮画本', category: 'hobby', tags: ['手工', '解压'], price: 19, description: '刮出星空', stock: true },
  { id: 'shop_hoby_bubble', name: '泡泡机', category: 'hobby', tags: ['玩', '可爱'], price: 29, description: '夏天阳台的快乐', stock: true, availableMonths: [5, 6, 7, 8, 9] },

  // —— 🆕 C3 耐用品·家居 ——
  { id: 'shop_home_lamp', name: '床头小台灯', category: 'home', tags: ['耐用品', '氛围'], price: 89, description: '暖光助眠', stock: true },
  { id: 'shop_home_airfryer', name: '空气炸锅', category: 'home', tags: ['耐用品', '厨房'], price: 299, description: '懒人料理神器', stock: true, unlocks: ['炸物料理'] },
  { id: 'shop_home_sofa', name: '懒人沙发', category: 'home', tags: ['耐用品', '家具'], price: 259, description: '陷进去就不想起来', stock: true },
  { id: 'shop_home_rug', name: '卧室地毯', category: 'home', tags: ['耐用品', '软装'], price: 129, description: '光脚踩上去的温柔', stock: true },
  { id: 'shop_home_curtain', name: '遮光窗帘', category: 'home', tags: ['耐用品', '睡眠'], price: 159, description: '睡懒觉保镖', stock: true },
  { id: 'shop_home_storage', name: '收纳箱组合', category: 'home', tags: ['耐用品', '整理'], price: 69, description: '房间整洁第一步', stock: true },
  { id: 'shop_home_mirror', name: '全身镜', category: 'home', tags: ['耐用品', '穿搭'], price: 99, description: '今日穿搭鉴定器', stock: true },
  { id: 'shop_home_humidifier', name: '加湿器', category: 'home', tags: ['耐用品', '健康'], price: 119, description: '秋冬必备', stock: true, availableMonths: [10, 11, 12, 1, 2, 3] },
  { id: 'shop_home_desk', name: '简约书桌', category: 'home', tags: ['耐用品', '家具'], price: 399, description: '认真生活的一角', stock: true },
  { id: 'shop_home_chair', name: '人体工学椅', category: 'home', tags: ['耐用品', '家具'], price: 459, description: '久坐救星', stock: true },
  { id: 'shop_home_shelf', name: '置物架', category: 'home', tags: ['耐用品', '整理'], price: 89, description: '杂物终结者', stock: true },
  { id: 'shop_home_kettle', name: '电热水壶', category: 'home', tags: ['耐用品', '厨房'], price: 79, description: '热水自由', stock: true },
  { id: 'shop_home_ricecooker', name: '迷你电饭煲', category: 'home', tags: ['耐用品', '厨房'], price: 139, description: '一人食刚好', stock: true },
  { id: 'shop_home_blender', name: '榨汁机', category: 'home', tags: ['耐用品', '厨房'], price: 159, description: '鲜榨自由', stock: true, unlocks: ['自制果汁'] },
  { id: 'shop_home_fan', name: '落地扇', category: 'home', tags: ['耐用品', '夏季'], price: 149, description: '安静大风力', stock: true, availableMonths: [5, 6, 7, 8, 9] },
  { id: 'shop_home_heater', name: '暖风机', category: 'home', tags: ['耐用品', '冬季'], price: 199, description: '冬天的小太阳', stock: true, availableMonths: [11, 12, 1, 2] },
  { id: 'shop_home_dehumid', name: '除湿盒（3盒）', category: 'home', tags: ['季节', '梅雨'], price: 25, description: '回南天救星', stock: true, availableMonths: [3, 4, 5, 6] },
  { id: 'shop_home_laundrybag', name: '脏衣篓', category: 'home', tags: ['耐用品', '整理'], price: 29, description: '不再到处扔', stock: true },
  { id: 'shop_home_doormat', name: '入门地垫', category: 'home', tags: ['耐用品', '玄关'], price: 35, description: '进家的第一声欢迎', stock: true },
  { id: 'shop_home_pots', name: '不粘锅套装', category: 'home', tags: ['耐用品', '厨房'], price: 199, description: '做饭信心+1', stock: true, unlocks: ['下厨做饭'] },
  { id: 'shop_home_knife', name: '菜刀砧板套装', category: 'home', tags: ['耐用品', '厨房'], price: 129, description: '工欲善其事', stock: true },
  { id: 'shop_home_drying', name: '落地晾衣架', category: 'home', tags: ['耐用品', '阳台'], price: 59, description: '晒被自由', stock: true },
  { id: 'shop_home_nightlight', name: '小夜灯', category: 'home', tags: ['耐用品', '睡眠'], price: 39, description: '起夜不摸黑', stock: true },
  { id: 'shop_home_laundry_dryer', name: '烘干机（迷你）', category: 'home', tags: ['耐用品', '阳台'], price: 349, description: '雨季不发愁', stock: true },
  { id: 'shop_home_clock', name: '静音挂钟', category: 'home', tags: ['耐用品', '装饰'], price: 65, description: '时间看得见', stock: true },

  // —— 🆕 C3 礼物（走情感而非饱腹） ——
  { id: 'shop_gift_rose', name: '一束玫瑰', category: 'gift', tags: ['浪漫', '送礼'], price: 66, description: '经典表白款', stock: false },
  { id: 'shop_gift_sunflower', name: '一束向日葵', category: 'gift', tags: ['治愈', '送礼'], price: 45, description: '朝着太阳的方向', stock: false },
  { id: 'shop_gift_tulip', name: '郁金香盆栽', category: 'gift', tags: ['治愈', '耐养'], price: 35, description: '会开花的心意', stock: true },
  { id: 'shop_gift_bracelet', name: '编织手链', category: 'gift', tags: ['手作', '纪念'], price: 88, description: '戴在手腕的心意', stock: false },
  { id: 'shop_gift_perfume', name: '淡香水', category: 'gift', tags: ['精致', '送礼'], price: 199, description: '记住这个味道', stock: false },
  { id: 'shop_gift_ticket', name: '演出门票两张', category: 'gift', tags: ['体验', '约会'], price: 260, description: '一起去看现场', stock: false },
  { id: 'shop_gift_movie', name: '电影票两张', category: 'gift', tags: ['体验', '约会'], price: 78, description: '周末的经典节目', stock: false },
  { id: 'shop_gift_dinner', name: '餐厅双人晚餐券', category: 'gift', tags: ['体验', '约会'], price: 328, description: '认真吃顿好的', stock: false },
  { id: 'shop_gift_photo', name: '定制相册', category: 'gift', tags: ['纪念', '手作'], price: 120, description: '把回忆印出来', stock: false },
  { id: 'shop_gift_plush', name: '大号玩偶', category: 'gift', tags: ['可爱', '陪伴'], price: 129, description: '抱抱型礼物', stock: false },
  { id: 'shop_gift_mug', name: '情侣马克杯', category: 'gift', tags: ['日常', '纪念'], price: 69, description: '每天都会用到', stock: false },
  { id: 'shop_gift_scarf_gift', name: '羊绒围巾（礼盒）', category: 'gift', tags: ['保暖', '送礼'], price: 239, description: '冬天的正式答案', stock: false, availableMonths: [11, 12, 1, 2] },
  { id: 'shop_gift_game', name: '联名周边礼盒', category: 'gift', tags: ['惊喜', '收藏'], price: 168, description: '懂的人会尖叫', stock: false },
  { id: 'shop_gift_handmade', name: '手作饼干礼盒', category: 'gift', tags: ['手作', '甜'], price: 58, description: '亲手烤的心意', stock: false },
  { id: 'shop_gift_letter', name: '手写信+火漆印章', category: 'gift', tags: ['手作', '纪念'], price: 25, description: '最便宜也最贵重', stock: false },

  // —— 🆕 C3 节日/限定（按现实日历上架） ——
  { id: 'shop_fest_cake', name: '生日蛋糕', category: 'festival', tags: ['生日', '仪式感'], price: 168, description: '吹蜡烛必备', stock: false },
  { id: 'shop_fest_xmas', name: '圣诞礼物盒', category: 'festival', tags: ['圣诞', '限定'], price: 99, description: '平安夜的期待', stock: false, availableMonths: [12] },
  { id: 'shop_fest_wreath', name: '圣诞花环', category: 'festival', tags: ['圣诞', '装饰'], price: 69, description: '挂在门上就有氛围', stock: true, availableMonths: [12] },
  { id: 'shop_fest_mooncake', name: '中秋月饼礼盒', category: 'festival', tags: ['中秋', '限定'], price: 128, description: '五仁还是蛋黄', stock: false, availableMonths: [8, 9] },
  { id: 'shop_fest_lantern', name: '兔子灯', category: 'festival', tags: ['中秋', '装饰'], price: 49, description: '中秋夜逛一逛', stock: true, availableMonths: [8, 9] },
  { id: 'shop_fest_dumpling', name: '饺子食材套装', category: 'festival', tags: ['春节', '年夜饭'], price: 58, description: '年夜饭主力', stock: true, availableMonths: [1, 2] },
  { id: 'shop_fest_couplet', name: '春联福字套装', category: 'festival', tags: ['春节', '装饰'], price: 25, description: '新年新气象', stock: true, availableMonths: [1, 2] },
  { id: 'shop_fest_redenv', name: '红包袋', category: 'festival', tags: ['春节', '传统'], price: 10, description: '压岁钱容器', stock: true, availableMonths: [1, 2] },
  { id: 'shop_fest_tangyuan', name: '汤圆', category: 'festival', tags: ['元宵', '甜'], price: 18, description: '团团圆圆', stock: true, availableMonths: [2, 3] },
  { id: 'shop_fest_qingtuan', name: '青团', category: 'festival', tags: ['清明', '时令'], price: 22, description: '春天的味道', stock: true, availableMonths: [3, 4] },
  { id: 'shop_fest_zongzi', name: '粽子礼盒', category: 'festival', tags: ['端午', '限定'], price: 68, description: '咸甜之争又起', stock: false, availableMonths: [5, 6] },
  { id: 'shop_fest_xiangbao', name: '香囊', category: 'festival', tags: ['端午', '传统'], price: 20, description: '端午的香气', stock: true, availableMonths: [5, 6] },
  { id: 'shop_fest_chocolate', name: '情人节巧克力', category: 'festival', tags: ['情人节', '甜'], price: 88, description: '甜有它的道理', stock: false, availableMonths: [2] },
  { id: 'shop_fest_pumpkin', name: '南瓜灯套装', category: 'festival', tags: ['万圣节', '玩'], price: 45, description: '捣蛋开始前先装饰', stock: true, availableMonths: [10] },
  { id: 'shop_fest_candy', name: '万圣糖果桶', category: 'festival', tags: ['万圣节', '甜'], price: 35, description: '不给糖就捣蛋', stock: true, availableMonths: [10] },

  // —— 🆕 C3 服务型（即时消耗不入库） ——
  { id: 'shop_srv_haircut', name: '理发', category: 'service', tags: ['服务', '形象'], price: 45, description: '换个心情从头开始', stock: false },
  { id: 'shop_srv_gym', name: '健身房月卡', category: 'service', tags: ['服务', '健身'], price: 199, description: '本月办卡本月练', stock: false, unlocks: ['去健身房'] },
  { id: 'shop_srv_delivery', name: '外卖配送费', category: 'service', tags: ['服务', '日常'], price: 6, description: '懒人税', stock: false },
  { id: 'shop_srv_manicure', name: '美甲（纯色）', category: 'service', tags: ['服务', '形象'], price: 88, description: '指尖的小心机', stock: false },
  { id: 'shop_srv_photo', name: '写真拍摄（基础）', category: 'service', tags: ['服务', '纪念'], price: 299, description: '认真记录一次自己', stock: false },
  { id: 'shop_srv_clean', name: '上门保洁（2小时）', category: 'service', tags: ['服务', '家务'], price: 120, description: '大扫除外援', stock: false },
  { id: 'shop_srv_repair', name: '手机屏幕维修', category: 'service', tags: ['服务', '数码'], price: 220, description: '碎屏焦虑解除', stock: false },
  { id: 'shop_srv_massage', name: '肩颈按摩（60分钟）', category: 'service', tags: ['服务', '健康'], price: 158, description: '久坐的救赎', stock: false },
  { id: 'shop_srv_cinema', name: '电影票（单人）', category: 'service', tags: ['服务', '娱乐'], price: 39, description: '一个人的包场', stock: false },
  { id: 'shop_srv_wash', name: '干洗外套', category: 'service', tags: ['服务', '形象'], price: 35, description: '贵重衣物专业洗护', stock: false },

  // —— 🆕 C3 补量：水果 +2 / 蔬菜 +3 ——
  { id: 'shop_fr_longan', name: '龙眼', category: 'fruit', tags: ['甜'], price: 12, description: '一颗一颗停不下来', stock: true },
  { id: 'shop_fr_pineapple', name: '菠萝', category: 'fruit', tags: ['春季'], price: 9, description: '盐水泡一泡更甜', stock: true },
  { id: 'shop_ve_spinach', name: '菠菜', category: 'vegetable', tags: ['绿叶菜', '补铁'], price: 4, description: '大力水手同款', stock: true },
  { id: 'shop_ve_tomato', name: '西红柿', category: 'vegetable', tags: ['万能食材'], price: 5, description: '炒蛋好搭档', stock: true },
  { id: 'shop_ve_lotus', name: '莲藕', category: 'vegetable', tags: ['煲汤'], price: 7, description: '排骨汤的灵魂', stock: true },

  // —— 🆕 C3 补量：饮品 +7 ——
  { id: 'shop_dr_soy', name: '豆浆', category: 'drink', tags: ['早餐'], price: 4, description: '清晨的热乎气', stock: false },
  { id: 'shop_dr_yogurt', name: '酸奶', category: 'drink', tags: ['助消化'], price: 8, description: '冰箱常驻嘉宾', stock: true },
  { id: 'shop_dr_greentea', name: '绿茶瓶装', category: 'drink', tags: ['清爽'], price: 5, description: '无糖就很好', stock: true },
  { id: 'shop_dr_coffee_can', name: '罐装咖啡', category: 'drink', tags: ['提神', '加班'], price: 9, description: '续命小罐', stock: true },
  { id: 'shop_dr_lemon_tea', name: '柠檬茶', category: 'drink', tags: ['夏日'], price: 12, description: '冰镇解暑', stock: true },
  { id: 'shop_dr_soda', name: '苏打气泡水', category: 'drink', tags: ['零卡'], price: 6, description: '快乐不胖', stock: true },
  { id: 'shop_dr_honey_water', name: '蜂蜜柚子茶冲饮', category: 'drink', tags: ['秋冬'], price: 16, description: '嗓子舒服一点', stock: true, availableMonths: [10, 11, 12, 1] },

  // —— 🆕 C3 补量：食材粮油 +5 ——
  { id: 'shop_fd_oatmeal', name: '即食燕麦片', category: 'food', tags: ['早餐', '轻食'], price: 22, description: '三分钟搞定早饭', stock: true },
  { id: 'shop_fd_noodles', name: '挂面一把', category: 'food', tags: ['快手饭'], price: 6, description: '深夜食堂标配', stock: true },
  { id: 'shop_fd_shrimp', name: '冷冻虾仁', category: 'food', tags: ['蛋白质'], price: 25, description: '偷懒也要吃好', stock: true },
  { id: 'shop_fd_tofu', name: '嫩豆腐', category: 'food', tags: ['家常菜'], price: 3, description: '便宜又温柔', stock: true },
  { id: 'shop_fd_mushroom', name: '香菇一把', category: 'food', tags: ['提鲜'], price: 8, description: '汤里的鲜味来源', stock: true },

  // —— 🆕 C3 补量：调味零食 +8 ——
  { id: 'shop_se_chilisauce', name: '辣酱一瓶', category: 'seasoning', tags: ['下饭'], price: 15, description: '拌什么都香', stock: true },
  { id: 'shop_se_sesameoil', name: '小磨香油', category: 'seasoning', tags: ['凉菜'], price: 18, description: '几滴就够味', stock: true },
  { id: 'shop_se_wine', name: '料酒', category: 'seasoning', tags: ['去腥'], price: 10, description: '炖肉必备', stock: true },
  { id: 'shop_sn_seaweed', name: '海苔小包装', category: 'seasoning', tags: ['追剧零食'], price: 8, description: '咔嚓咔嚓', stock: true },
  { id: 'shop_sn_nutbar', name: '每日坚果条', category: 'seasoning', tags: ['健康零食'], price: 20, description: '下午补一口', stock: true },
  { id: 'shop_sn_cookie', name: '黄油曲奇礼盒', category: 'seasoning', tags: ['下午茶', '甜'], price: 28, description: '配牛奶绝佳', stock: true },
  { id: 'shop_sn_driedmango', name: '芒果干', category: 'seasoning', tags: ['酸甜'], price: 14, description: ' tropical 味道', stock: true },
  { id: 'shop_sn_popcorn', name: '微波爆米花', category: 'seasoning', tags: ['观影'], price: 9, description: '电影之夜前奏', stock: true },

  // —— 🆕 C3 补量：日用品 +7 / 个护 +5 / 药品 +3 ——
  { id: 'shop_dl_scissors', name: '办公剪刀', category: 'daily', tags: ['工具'], price: 12, description: '拆快递利器', stock: true },
  { id: 'shop_dl_batteries', name: '五号电池四粒', category: 'daily', tags: ['常备'], price: 15, description: '遥控器救星', stock: true },
  { id: 'shop_dl_ledbulb', name: 'LED灯泡', category: 'daily', tags: ['家居'], price: 10, description: '坏掉的灯终于亮了', stock: true },
  { id: 'shop_dl_lintroller', name: '粘毛滚筒', category: 'daily', tags: ['衣物护理'], price: 9, description: '黑衣服克星', stock: true },
  { id: 'shop_dl_umbrella2', name: '折叠伞备用款', category: 'daily', tags: ['雨天'], price: 35, description: '包里再放一把', stock: true },
  { id: 'shop_dl_airfresh', name: '空气清新喷雾', category: 'daily', tags: ['居家'], price: 18, description: '客人来前必备', stock: true },
  { id: 'shop_dl_plate_set', name: '盘子两个装', category: 'daily', tags: ['厨房'], price: 24, description: '打碎盘子的赔偿计划', stock: true },
  { id: 'shp_fm_cleansing', name: '卸妆水大瓶', category: 'feminine', tags: ['护肤'], price: 55, description: '温和清洁', stock: true },
  { id: 'shp_fm_sunscreen', name: '防晒霜SPF50', category: 'feminine', tags: ['夏季必需'], price: 89, description: '紫外线防御战', stock: true },
  { id: 'shp_fm_hairmask', name: '发膜焗油膏', category: 'feminine', tags: ['护理'], price: 42, description: '周末的精致时刻', stock: true },
  { id: 'shp_fm_bodylotion', name: '身体乳', category: 'feminine', tags: ['冬季必囤'], price: 38, description: '洗澡后全身涂', stock: true },
  { id: 'shp_fm_nailkit', name: '指甲修剪套装', category: 'feminine', tags: ['个护工具'], price: 26, description: '整整齐齐', stock: true },
  { id: 'shp_md_stomach', name: '健胃消食片', category: 'medicine', tags: ['肠胃'], price: 16, description: '吃撑了别硬扛', stock: true },
  { id: 'shp_md_plaster', name: '膏药贴一盒', category: 'medicine', tags: ['腰酸联动'], price: 22, description: '久坐后的敷衍式自救', stock: true },
  { id: 'shp_md_vitaminc', name: '维生素C泡腾片', category: 'medicine', tags: ['感冒预防'], price: 30, description: '换季时喝起来', stock: true },

  // —— 🆕 C3 补量：衣物 +12（四季分层） ——
  { id: 'shp_cl_cardigan', name: '针织开衫', category: 'clothing', tags: ['秋季', '温柔'], price: 139, description: '空调房的救星', stock: true },
  { id: 'shp_cl_trenchcoat', name: '风衣', category: 'clothing', tags: ['秋季', '气质'], price: 299, description: '走路带风那种', stock: true },
  { id: 'shp_cl_downjacket', name: '轻薄羽绒服', category: 'clothing', tags: ['冬季'], price: 399, description: '冷风的对手', stock: true },
  { id: 'shp_cl_woolsweater', name: '羊毛毛衣', category: 'clothing', tags: ['冬季', '保暖'], price: 259, description: '摸起来就很暖', stock: true },
  { id: 'shp_cl_summerdress', name: '碎花连衣裙', category: 'clothing', tags: ['夏季', '甜美'], price: 179, description: '裙摆有夏天', stock: true },
  { id: 'shp_cl_linenshirt', name: '亚麻衬衫', category: 'clothing', tags: ['夏季', '透气'], price: 129, description: '高温天的好脾气', stock: true },
  { id: 'shp_cl_denimshorts', name: '牛仔短裤', category: 'clothing', tags: ['夏季'], price: 79, description: '腿要透透气', stock: true },
  { id: 'shp_cl_scarfwool', name: '羊毛围巾', category: 'clothing', tags: ['冬季', '配饰'], price: 99, description: '脖子先暖起来', stock: true },
  { id: 'shp_cl_beret', name: '贝雷帽', category: 'clothing', tags: ['配饰', '文艺'], price: 59, description: '气质开关', stock: true },
  { id: 'shp_cl_whitesneakers', name: '小白鞋经典款', category: 'clothing', tags: ['四季', '百搭'], price: 199, description: '怎么穿都对', stock: true },
  { id: 'shp_cl_homepajama', name: '珊瑚绒睡衣套装', category: 'clothing', tags: ['居家', '冬季'], price: 119, description: '像云一样软', stock: true },
  { id: 'shp_cl_sportbra', name: '运动内衣两件', category: 'clothing', tags: ['运动联动'], price: 109, description: '健身装备升级', stock: true },

  // —— 🆕 C3 补量：数码 +6 ——
  { id: 'shp_dg_powerbank2w', name: '充电宝20000毫安', category: 'digital', tags: ['出门必备'], price: 129, description: '安全感满满', stock: true },
  { id: 'shp_dg_btearbuds', name: '蓝牙耳机通勤款', category: 'digital', tags: ['音乐'], price: 249, description: '地铁上的小世界', stock: true },
  { id: 'shp_dg_keyboard', name: '静音机械键盘', category: 'digital', tags: ['生产力'], price: 349, description: '指尖的快乐', stock: true },
  { id: 'shp_dg_monitorarm', name: '显示器支架', category: 'digital', tags: ['桌面改造'], price: 159, description: '颈椎谢谢你', stock: true },
  { id: 'shp_dg_screenfix', name: '手机屏幕维修', category: 'digital', tags: ['服务型维修'], price: 299, description: '又活了', stock: false },
  { id: 'shp_dg_datacable', name: '编织数据线三条', category: 'digital', tags: ['耗材'], price: 39, description: '总有一根能用', stock: true },

  // —— 🆕 C3 补量：小娱乐 +8 ——
  { id: 'shp_fn_boardgame2', name: '双人桌游小品', category: 'fun', tags: ['休闲'], price: 69, description: '一个人也能玩的桌游', stock: true, unlocks: ['玩桌游'] },
  { id: 'shp_fn_diyhandmade', name: '手工材料包', category: 'fun', tags: ['动手'], price: 45, description: '成品能摆着看', stock: true },
  { id: 'shp_fn_phonecase', name: '可爱手机壳', category: 'fun', tags: ['心情道具'], price: 25, description: '换壳如换机', stock: true },
  { id: 'shp_fn_deskplant', name: '桌面迷你盆栽', category: 'fun', tags: ['治愈'], price: 19, description: '工作搭子', stock: true },
  { id: 'shp_fn_journal', name: '手账本年度款', category: 'fun', tags: ['记录'], price: 36, description: '把日子写下来', stock: true },
  { id: 'shp_fn_scratchart', name: '刮刮画星空版', category: 'fun', tags: ['解压'], price: 22, description: '刮出一幅画', stock: true },
  { id: 'shp_fn_kitesmall', name: '小型风筝', category: 'fun', tags: ['户外', '季节'], price: 28, description: '春天限定快乐', stock: true, availableMonths: [3, 4, 5] },
  { id: 'shp_fn_ferriswheel', name: '摩天轮双人票', category: 'fun', tags: ['浪漫', '体验'], price: 128, description: '把城市踩在脚下', stock: false },

  // —— 🆕 C3 宠物向 +12（可选类目，未养宠也可买给朋友家的毛孩子） ——
  { id: 'shp_pet_catfood', name: '猫粮1.5kg', category: 'gift', tags: ['宠物', '喵星人'], price: 65, description: '挑嘴猫也会捧场', stock: true },
  { id: 'shp_pet_dogsnack', name: '狗狗训练零食', category: 'gift', tags: ['宠物', '汪星人'], price: 32, description: '坐下握手全靠它', stock: true },
  { id: 'shp_pet_catteaser', name: '逗猫棒羽毛款', category: 'gift', tags: ['宠物', '玩具'], price: 12, description: '主子最爱战利品', stock: true },
  { id: 'shp_pet_dogtoy', name: '狗咬胶耐咬玩具', category: 'gift', tags: ['宠物'], price: 22, description: '沙发免于毒手', stock: true },
  { id: 'shp_pet_fishtank', name: '迷你鱼缸套装', category: 'home', tags: ['宠物', '治愈'], price: 88, description: '办公桌上的一片海', stock: true, unlocks: ['喂鱼时光'] },
  { id: 'shp_pet_catscraper', name: '瓦楞纸猫抓板', category: 'home', tags: ['宠物', '家具保护'], price: 35, description: '猫爪的天堂', stock: true },
  { id: 'shp_pet_petbowl', name: '双碗宠物餐位', category: 'daily', tags: ['宠物'], price: 28, description: '干湿分离很讲究', stock: true },
  { id: 'shp_pet_catlitter', name: '豆腐猫砂6L', category: 'daily', tags: ['宠物', '消耗'], price: 40, description: '除臭结团都在行', stock: true },
  { id: 'shp_pet_fishfood', name: '观赏鱼饲料', category: 'daily', tags: ['宠物', '鱼缸联动'], price: 10, description: '小小几粒刚刚好', stock: true },
  { id: 'shp_pet_petshirt', name: '宠物小衣服', category: 'gift', tags: ['宠物', '节日'], price: 33, description: '过年全家福穿', stock: true },
  { id: 'shp_pet_petcarrier', name: '宠物外出背包', category: 'hobby', tags: ['宠物', '出行'], price: 108, description: '带主子去看世界', stock: true },
  { id: 'shp_pet_vetcheck', name: '宠物基础体检券', category: 'service', tags: ['宠物', '健康'], price: 168, description: '负责的主人会做', stock: false },
];

// ---------------- 🆕 可扩展：用户 / AI 自定义商品与分类 ----------------

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const CUSTOM_ITEMS_KEY = 'shop_custom_items';
const CUSTOM_CATS_KEY = 'shop_custom_categories';

export interface CustomCategory { code: string; label: string }

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

/** 已有自定义分类 */
export function getCustomCategories(): CustomCategory[] {
  return readJson<CustomCategory[]>(CUSTOM_CATS_KEY, []);
}

/** 新增自定义分类（同名幂等），返回 code */
export function addCustomCategory(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return '';
  const list = getCustomCategories();
  const found = list.find((c) => c.label === trimmed);
  if (found) return found.code;
  const code = `custom_${Math.abs(hashStr(trimmed)).toString(36)}`;
  list.push({ code, label: trimmed });
  try { localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  return code;
}

/** 全部分类 Tab（内置 + 自定义，顺序保持） */
export function getAllCategoryTabs(): Array<{ key: string; label: string }> {
  const builtin = (Object.keys(SHOP_CATEGORY_META) as ShopCategory[]).map((k) => ({ key: k, label: SHOP_CATEGORY_META[k].label }));
  return [...builtin, ...getCustomCategories().map((c) => ({ key: c.code, label: c.label }))];
}

/** 解析分类显示信息（内置 || 自定义 || 兜底） */
export function resolveCategoryMeta(code: string): { label: string; invCategory: string } {
  const builtin = SHOP_CATEGORY_META[code as ShopCategory];
  if (builtin) return builtin;
  const custom = getCustomCategories().find((c) => c.code === code);
  if (custom) return { label: custom.label, invCategory: 'tool' };
  return { label: code || '其他', invCategory: 'tool' };
}

/** 用户 / AI 添加的自定义商品 */
export function getCustomShopItems(): ShopEntry[] {
  return readJson<ShopEntry[]>(CUSTOM_ITEMS_KEY, []);
}

/** 添加自定义商品（幂等：同名同分类不重复） */
export function addCustomShopItem(entry: Omit<ShopEntry, 'id'>): ShopEntry {
  const list = getCustomShopItems();
  const dup = list.find((e) => e.name === entry.name && e.category === entry.category);
  if (dup) return dup;
  const full: ShopEntry = { ...entry, id: `cshop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` };
  list.push(full);
  try { localStorage.setItem(CUSTOM_ITEMS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  useDebugLog.getState().add('ailife', `[AI-Life] 新增自定义商品: ${full.name}（¥${full.price}）`);
  return full;
}

/** 完整目录 = 内置（🆕 C3: 节日/季节限定按当前月份过滤上架窗口）+ 自定义 */
export function getAllShopItems(): ShopEntry[] {
  const month = new Date().getMonth() + 1;
  const onShelf = SHOP_CATALOG.filter((e) => !e.availableMonths || e.availableMonths.includes(month));
  return [...onShelf, ...getCustomShopItems()];
}

/** 按商品名查找目录项（含自定义） */
export function findShopItemByName(name: string): ShopEntry | undefined {
  const n = name.trim();
  return getAllShopItems().find((e) => e.name === n || e.name.startsWith(n) || n.startsWith(e.name));
}

/** 购买后的角色语气备注（纯本地模板） */
function purchaseComment(category: string, name: string): string {
  switch (category) {
    case 'fruit': return `AI：水果补上了，每天都要吃点。`;
    case 'vegetable': return `AI：买点蔬菜，吃得健康些。`;
    case 'drink': return `AI：饮料囤好了，冰箱塞得满满当当。`;
    case 'food': return `AI：买了${name}，冰箱又充实起来了。`;
    case 'seasoning': return `AI：调味料备齐，做饭更香了。`;
    case 'daily': return `AI：${name}补上了，生活要井井有条。`;
    case 'medicine': return `AI：备着${name}，以防万一。`;
    case 'clothing': return `AI：给自己添了${name}，开心。`;
    case 'digital': return `AI：新装备到手，研究一下${name}。`;
    case 'feminine': return `AI：${name}备齐了，好好照顾自己。`;
    case 'fun': return `AI：小小犒劳一下，${name}值得。`;
    case 'hobby': return `AI：买了${name}，以后的周末又多了一个盼头。`;
    case 'home': return `AI：家里添了${name}，房间又顺眼了一点。`;
    case 'gift': return `AI：这份${name}……是准备了送人的，别多想。`;
    case 'festival': return `AI：节日嘛，${name}必须有仪式感。`;
    case 'service': return `AI：花钱买省心，${name}这钱该花。`;
    default: return `AI：买好了${name}。`;
  }
}

export interface PurchaseResult {
  ok: boolean;
  reason?: string;
  comment?: string;
  cost?: number;
}

/**
 * 购买商品：余额校验 → 扣款 → 入库（或即时消耗）→ 记流水。
 * 全程本地，无 API。
 */
export async function purchaseItem(
  characterId: string,
  entry: ShopEntry,
  qty = 1,
): Promise<PurchaseResult> {
  const count = Math.max(1, Math.floor(qty));
  const cost = entry.price * count;
  const economy = await dbGetAiEconomy(characterId);
  const balance = economy?.balance ?? 0;
  if (!economy) return { ok: false, reason: '钱包数据未初始化' };
  if (balance < cost) return { ok: false, reason: `余额不足（还差 ¥${(cost - balance).toFixed(0)}）` };

  const nowIso = new Date().toISOString();

  // 1) 扣款
  await dbSaveAiEconomy({
    ...economy,
    balance: Math.round((balance - cost) * 100) / 100,
    monthlyExpense: economy.monthlyExpense + cost,
    updatedAt: nowIso,
  });

  // 2) 入库 / 即时消耗
  if (entry.stock) {
    const inv = await dbGetAiInventory(characterId);
    const invCategory = resolveCategoryMeta(entry.category).invCategory;
    const existing = inv.find((i) => i.name === entry.name && i.category === invCategory);
    let updated: AiInventoryItem;
    const extraWithUnlocks = { fromShop: true, ...(entry.unlocks && entry.unlocks.length > 0 ? { unlocks: entry.unlocks } : {}) };
    if (existing) {
      updated = {
        ...existing,
        quantity: existing.quantity + count,
        // 已有库存补上解锁标记（兼容旧数据）
        ...(entry.unlocks && entry.unlocks.length > 0 && !Array.isArray((existing.extra as Record<string, unknown>)?.unlocks)
          ? { extra: { ...existing.extra, unlocks: entry.unlocks } }
          : {}),
        updatedAt: nowIso,
      };
    } else {
      updated = {
        id: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        characterId,
        category: invCategory,
        name: entry.name,
        quantity: count,
        quality: 'good',
        extra: extraWithUnlocks,
        updatedAt: nowIso,
      };
    }
    await dbSaveAiInventoryItems([updated]);
  }

  // 3) 流水（备注带角色语气）
  const comment = purchaseComment(entry.category, entry.name);
  await dbAddAiTransaction({
    id: `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    characterId,
    type: 'expense',
    amount: cost,
    description: `购买${entry.name}${count > 1 ? ` ×${count}` : ''}｜${comment}`,
    timestamp: nowIso,
  });

  // 🆕 C3/B4: 耐用品解锁消遣 / 礼物与节日件 → 事件流记账（C2 抽签池与日记可消费）
  try {
    const { recordLifeEvent } = await import('./lifeEvents');
    if (entry.unlocks && entry.unlocks.length > 0) {
      await recordLifeEvent({
        characterId,
        type: 'purchase',
        description: `买下了${entry.name}，解锁了新的消遣：${entry.unlocks.join('、')}`,
        itemId: entry.id,
        meta: { unlocks: entry.unlocks, category: entry.category },
      });
    } else if (entry.category === 'gift' || entry.category === 'festival') {
      await recordLifeEvent({
        characterId,
        type: 'purchase',
        description: `准备了${entry.name}（${entry.category === 'gift' ? '一份心意' : '节日仪式感'}）`,
        itemId: entry.id,
        meta: { category: entry.category, salience: 2 },
      });
    }
  } catch { /* 静默 */ }

  useDebugLog.getState().add('ailife', `[AI-Life] 商店购买: ${entry.name}×${count}（-¥${cost}）`, { characterId });
  return { ok: true, comment, cost };
}
