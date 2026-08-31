# 世界设定包规范 · formatVersion 2

> 星眠 · AI 一日（AI-Life）世界设定包的标准结构。
> 本目录下的 `*.json` 既是**规范示例文档**，也是**应用内置预设的单一数据源**——
> `src/services/ailife/builtinWorlds.ts` 直接引用这些文件，在应用启动时幂等播种到 SQLite。

---

## 一、设计原则

| 原则 | 说明 |
|------|------|
| 向后兼容 | v2 完整保留 v1 全部字段；旧包可直接导入，v1 消费方（日程生成、场景校验）不受影响 |
| 字段可选 | 除 `name` 与 `config` 外全部可选；缺失字段静默降级，不影响运行 |
| Prompt 预算 | 所有自由文本字段有长度上限，注入日程生成 Prompt 时二次截断，防止 token 爆炸 |
| 单一数据源 | 内置包以 JSON 文档为准，TS 侧只做类型定义与规范化，避免双份维护 |
| 合规 | 二游世界包均为**非官方同人参考资料**（世界观文字描述），不含官方美术/音频素材 |

## 二、文件格式

```jsonc
{
  "formatVersion": 2,              // 文档格式版本
  "id": "world_builtin_genshin",   // 包 ID（内置包必须稳定，保证幂等播种）
  "name": "原神 · 提瓦特",          // 显示名（必填）
  "worldType": "fantasy",          // 世界类型标签（自由字符串）
  "isBuiltin": true,               // 内置标记（isBuiltin=true 的包 UI 上不可删除）
  "config": { ... }                // 世界设定数据本体（见下）
}
```

- 导出的用户自定义包由应用生成 `id` / `updatedAt`，`formatVersion` 固定为 2。
- 导入时接受 formatVersion 1 / 2，字段级规范化清洗后入库。

## 三、config 字段定义

### v1 基础字段（日程生成的最小依赖）

| 字段 | 类型 | 说明 |
|------|------|------|
| `description` | string | 一句话描述 |
| `locations` | string[] | 可用地点库。日程场景校验的依据：不在库内的场景会回退到首项 |
| `transport` | string[] | 出行方式 |
| `currency` | string[] | 货币 |
| `activities` | object | 活动池，五类键：`daily` / `work` / `leisure` / `social` / `special`，值为 string[]。类别需与活动枚举对齐（sleep/personal_care/meal/travel/work/leisure/social/rest/special） |
| `events` | string[] | 日常风味事件素材 |
| `items` | object | 预留自由扩展槽 |

### v2 扩展字段（全部可选）

| 字段 | 类型 | 上限 | 说明 |
|------|------|------|------|
| `source` | string | — | 原作来源标注，如「游戏《原神》· 非官方同人参考包」 |
| `era` | string | 120 | 时代背景一句话 |
| `lore` | string | 400 | 世界观概述（建议 ≤200 字） |
| `terminology` | Record&lt;string,string&gt; | 注入前取前 6 条 | 术语表：术语 → 一句话释义（释义截断 60 字符） |
| `factions` | `{name, description?}[]` | 12 个（注入取 6） | 主要阵营/组织 |
| `characters` | `{name, nickname?, role?, affiliation?, rarity?, personality?, speechStyle?, deeds?, relation?}[]` | 2000 个 | 代表角色模板：供角色创建与对话风格参考。**`nickname` 外号/称号、`relation` 与主角（玩家角色）的关系为必填推荐项**；`affiliation` 分属、`rarity` 稀有度、`deeds` 事迹同样推荐填写；收录应覆盖低稀有度角色 |
| `taboos` | string[] | 8 条（注入取 6） | **世界禁忌**：该世界不存在的事物，用于禁止 AI 输出越界内容（如提瓦特出现手机） |
| `timeNotes` | string | 80 | 时间体系说明（历法/作息特点），如「暴雨使时光倒流，需先确认年份」 |
| `statsAsOf` | string | 20 | **资料统计截止日期**，格式 `YYYY-MM-DD`，所有世界包必填 |
| `gameVersion` | string | 20 | **资料对应的游戏最后版本**（如原神 `7.0`），所有游戏世界包必填 |
| `disclaimer` | string | 160 | **免责声明**：非官方同人资料、版权归原厂商等，所有游戏世界包必填 |

### 角色条目结构示例

```json
{
  "name": "甘雨",
  "nickname": "麒麟血脉的月海亭秘书",
  "rarity": "5★",
  "affiliation": "璃月 · 月海亭",
  "role": "秘书",
  "personality": "温婉谦逊、工作狂",
  "speechStyle": "文雅柔和，常为加班道歉",
  "deeds": "三千年前与帝君缔约，半人半仙守护璃月至今",
  "relation": "旅行者的璃月挚友，可靠的协力者"
}
```

- `nickname` 取游戏官方称号或广为人知的外号；
- `relation` 以该游戏的「主角」（原神=旅行者、星铁=开拓者、方舟=博士、BA=老师等）为参照描述关系。

- `rarity` 取值随游戏而定：5★/4★（米哈游系）、6★/5★/4★/3★/2★/1★（明日方舟系）、SR/R（其他）等；NPC 用 `NPC`。
- 收录原则：**全量优先**——在文件体积可控的前提下尽量收录全部已实装角色（含低稀有度），至少覆盖各稀有度代表。

### 规范化规则（导入与播种共用）

实现在 `src/services/ailife/builtinWorlds.ts → normalizeWorldConfigData()`：

1. 字符串数组字段仅保留非空字符串项；
2. 自由文本按上表上限截断（超出部分以 `…` 结尾）；
3. `factions` / `characters` 缺少合法 `name` 的条目剔除；
4. 全部失败时返回空对象，等价于一个无约束世界。

## 四、消费链路

```
docs/world-packs/*.json                ← 数据源 + 规范示例
        │ import (resolveJsonModule)
        ▼
src/services/ailife/builtinWorlds.ts   ← 注册表 packToRecord() + normalizeWorldConfigData()
        │ ensureBuiltinWorlds()（App 启动幂等播种）
        ▼
SQLite world_configs 表                 ← WorldConfigRecord
        │ dbGetWorldConfigs()
        ├─→ 角色创建面板「世界设定包」下拉选择
        ├─→ AI 一日面板 世界包管理（选择/导入/导出/删除）
        └─→ scheduleGenerator.generateAIPlanSchedule()
                ├─ locations / activities  → 地点与活动池约束（v1）
                └─ lore/terminology/factions/taboos/timeNotes → Prompt 风味注入（v2，带截断预算）
```

## 五、如何新增一个世界包

1. 在本目录新建 `<slug>.json`，按第二节格式填写（id 建议用 `world_builtin_<slug>`）；
2. 在 `builtinWorlds.ts` 顶部 `import` 并追加进 `BUILTIN_GAME_WORLD_PACKS` 数组；
3. 重启应用即自动播种；老用户升级后同样生效（按 id 幂等，不会重复）。

编写要点：

- `locations` 覆盖「居住/工作/休闲/社交」四类场景，10–25 个为宜；
- `activities` 五类各 3–6 项，动词开头、贴合原作日常而非战斗主线；
- `taboos` 写「这个世界里不该出现的东西」（现代设备/其他作品名词/违和氛围）；
- `characters` 选辨识度最高的 3–5 人，`speechStyle` 是给 LLM 的说话方式提示。

## 六、内置包清单（2026-08 主流二游 · 统计截止 2026-08-24）

| 文件 | 名称 | worldType | 角色数 |
|------|------|-----------|--------|
| `genshin.json` | 原神 · 提瓦特 | fantasy | 109 |
| `honkai-star-rail.json` | 星穹铁道 · 星海漫游 | sci_fi_space | 63 |
| `zenless-zone-zero.json` | 绝区零 · 新艾利都 | urban_post_apocalyptic | 47 |
| `wuthering-waves.json` | 鸣潮 · 今州纪行 | post_apocalyptic_fantasy | 39 |
| `arknights-endfield.json` | 终末地 · 塔卫二拓荒 | industrial_frontier | 31 |
| `arknights.json` | 明日方舟 · 泰拉大地 | dark_fantasy_scifi | 181 |
| `infinity-nikki.json` | 无限暖暖 · 奇迹大陆 | fantasy_dress_up | 17 |
| `blue-archive.json` | 蔚蓝档案 · 基沃托斯 | academy_city | 29 |
| `reverse-1999.json` | 重返未来1999 · 暴雨纪元 | mystic_retro | 14 |
| `nikke.json` | NIKKE · 地上方舟 | scifi_survival | 27 |
| `azur-lane.json` | 碧蓝航线 · 港区 | shipgirl_harbor | 33 |
| `path-to-nowhere.json` | 无期迷途 · 狄斯城 | dark_urban | 8 |
| `light-and-night.json` | 光与夜之恋 · 云川之约 | romance_designer | 6 |
| `gfl2.json` | 少前2追放 · 污染区之外 | tactical_scifi | 11 |
| `fgo.json` | FGO · 迦勒底 | holy_grail_scifi | 30 |
| `punishing-gray-raven.json` | 战双帕弥什 · 灰鸦信号 | post_apocalyptic_scifi | 12 |
| `honkai-impact-3.json` | 崩坏3 · 休伯利安 | honkai_scifi | 9 |
| `touhou.json` | 东方Project · 幻想乡 | touhou_fantasy | 11 |
| `ananta.json` | 异环 · 海特洛市（2026.4公测爆款） | urban_supernatural | 4 |
| `duet-night-abyss.json` | 二重螺旋 · 双线幻想 | dark_fantasy | 5 |
| `atri.json` | ATRI · 沉海之城（Steam 106万销量 galgame） | scifi_romance | 2 |
| `senren-banka.json` | 千恋万花 · 穗织温泉乡（Steam 100万销量 galgame） | wafu_romance | 4 |
| `guns-girlz.json` | 崩坏学园2 · 千羽学园 | apocalypse_school | 4 |
| `roco-kingdom.json` | 洛克王国：世界 · 精灵大陆（2026.3 公测黑马） | pet_adventure | 6 |
| `nekopara.json` | NEKOPARA · 巧克力和香子兰（Steam猫娘物语） | catgirl_bakery | 7 |
| `whmx.json` | 物华弥新 · 器者纪行（2026国宝拟人黑马） | relic_anthropomorphic | 6 |
| `sanoba-witch.json` | 魔女的夜宴（柚子社 30万销量 galgame） | witch_romance | 3 |
| `clannad.json` | CLANNAD · 光坂小镇（Key社经典 galgame） | school_tears | 8 |
| `jujutsu-kaisen.json` | 咒术回战 · 死灭回游（2026冬番播放第一） | cursed_energy | 5 |
| `frieren.json` | 葬送的芙莉莲 · 长旅之后（2026冬番第二） | high_fantasy | 5 |
| `kimetsu-no-yaiba.json` | 鬼灭之刃 · 大正斩鬼录 | taisho_supernatural | 6 |
| `bocchi-the-rock.json` | 孤独摇滚 · STARRY | band_music | 4 |
| `hatsune-miku.json` | 初音未来 · 虚拟歌姬舞台 | virtual_singer | 6 |
| `luo-tianyi.json` | 洛天依 · 中文Vsinger | cn_virtual_singer | 4 |
| `noelle.json` | 诺艾尔会努力的 · 打工小镇（Steam像素RPG） | fantasy_town_life | 3 |
| `jiu-fox.json` | 车万女仆 · 酒狐与方块幻想乡（TLM模组看板娘） | minecraft_touhou_maid | 2 |
| `riddle-joker.json` | Riddle Joker · 隐藏的魔法使（柚子社人气作） | hidden_magic | 4 |
| `white-album-2.json` | 白色相簿2 · 峰城大附属（丸户史明·三角关系神作） | love_triangle_tears | 3 |
| `ddlc.json` | 心跳文学部 · Just Monika（Steam千万下载元叙事恐怖） | meta_horror | 5 |
| `aokana.json` | 苍之彼方的四重奏 · 飞翔竞技（sprite人气作） | flying_sports | 5 |
| `hamidashi-creative.json` | 常轨脱离Creative · 同人创作部（Madosoft人气作） | doujin_creative | 6 |
| `subarashiki-hibi.json` | 素晴日 · 回归云上的哲学（galgame最高评分哲学神作） | philosophical_masterpiece | 4 |
| `g-senjou.json` | G弦上的魔王 · 智力对决（AKABEISOFT2推理名作） | detective_battle | 4 |
| `nine-nine.json` | 9-nine- · 斯皮亚的九次元市（Palette四部曲完结） | supernatural_artifact | 3 |
| `fate-stay-night.json` | Fate/stay night · 第五次圣杯战争（TYPE-MOON镇社之作） | holy_grail_war | 6 |
| `tsukihime.json` | 月姬 · 远野家的秘密（TYPE-MOON同人时代成名作） | vampire_mystery | 5 |
| `kusuriya.json` | 药师少女的独语 · 后宫解谜录（S3十月开播） | historical_mystery | 5 |
| `oshi-no-ko.json` | 我推的孩子 · 艺能界物语（S3人气前五） | entertainment_industry | 5 |
| `fate-strange-fake.json` | Fate/strange Fake · 雪原圣杯战争（Niconico第二） | holy_grail_fake | 4 |
| `chiikawa.json` | 吉伊卡哇 · 小小们的日常 | cute_healing | 3 |
| `cafe-stella.json` | 星光咖啡馆与死神之蝶（柚子社20万销量·动画化决定） | cafe_shinigami_romance | 4 |
| `summer-pockets.json` | Summer Pockets · 鸟白岛之夏（Key·RB版Steam上架+动画） | summer_island_tears | 6 |
| `dracu-riot.json` | DRACU-RIOT! · 夜之娱乐城（柚子社经典·2026.2 Steam上架） | vampire_city | 2 |
| `steins-gate.json` | 命运石之门 · 凤凰院凶真的选择（Bangumi满分） | scifi_timetravel | 7 |
| `attack-on-titan.json` | 进击的巨人 · 墙内与自由之翼（MAL史上第一系列） | dark_fantasy_war | 6 |
| `madoka-magica.json` | 魔法少女小圆 · 见泷原的轮回（Bangumi满分） | dark_magical_girl | 6 |
| `evangelion.json` | EVA · 第三新东京市 | mecha_apocalypse | 5 |
| `violet-evergarden.json` | 紫罗兰永恒花园 · 自动手记人偶 | letter_writing | 4 |
| `re-zero.json` | Re:从零开始的异世界生活（S3） | iseki_dark_fantasy | 5 |
| `sword-art-online.json` | 刀剑神域 · 浮游城艾恩葛朗特 | vr_mmo | 2 |
| `chainsaw-man.json` | 电锯人 · 公安对魔特异课 | devil_hunter | 4 |
| `monogatari.json` | 物语系列 · 怪异奇谭 | kaii_dialogue | 4 |
| `gintama.json` | 银魂 · 万事屋 | samurai_comedy | 5 |
| `code-geass.json` | Code Geass · 黑色骑士团（MAL 8.91） | mecha_strategy | 4 |
| `fullmetal-alchemist.json` | 钢之炼金术师 · 等价交换之旅 | alchemy_adventure | 4 |
| `summer-time-rendering.json` | 夏日重现 · 日都岛轮回（MAL 8.5） | time_loop_mystery | 4 |
| `anohana.json` | 未闻花名 · 超和平Busters | tears_summer | 6 |
| `kimi-no-uso.json` | 四月是你的谎言 · 春天的钢琴曲（MAL 8.65） | music_romance_tears | 2 |
| `aobuta.json` | 青春猪头少年 · 思春期症候群 | youth_scifi_romance | 5 |
| `natsume-yuujinchou.json` | 夏目友人帐 · 妖怪与温柔（第七季播出中） | youkai_healing | 4 |
| `haikyuu.json` | 排球少年！！ · 乌野高中（MAL 8.44） | sports_volleyball | 6 |
| `stellarrail-shiro.json` | 星空列车与白的旅行 · 银河号之梦（白玉社首作·Steam好评） | dream_train | 6 |

**合计 75 包 / 约 940 名角色。** 另有内置「现代日常」包（`world_builtin_modern`，代码内定义，见 `worldConfig.ts`）。

> 已移除：恋与深空（用户决定下架；老用户 DB 内的该包会在启动时自动清除）。

---

*以上所有游戏世界包为非官方同人创作，仅供本地个人化 AI 陪伴用途；各游戏名称与世界观设定版权归原厂商所有。*
