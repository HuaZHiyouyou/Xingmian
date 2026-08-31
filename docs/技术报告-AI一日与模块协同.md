# SoulChat 技术报告：AI 一日运转、模块协同与对话体验升级

> 版本：v1.0（2026-08-27）
> 性质：设计定稿 + 外包实施说明书。每个任务包含【现状】【方案】【验收标准】，承接方按任务卡独立实施即可。
> 所有文件路径均相对项目根目录。带行号的现状描述基于当前 master 工作区，实施前请复核。

---

## 0. 总览：一条主线，四个层次

本项目已具备完整的"AI 一日生活"雏形（日程生成 → 分钟级 tick → 活动状态注入对话 prompt → 睡眠门控 → 概率主动消息 → 日记），但存在三类系统性问题：

1. **生命周期问题**：所有定时逻辑在前端 JS（渲染进程），窗口关闭 = AI 死亡。
2. **闭环断裂问题**：大量机制"实现了但没接线"（死代码）、生成的内容"生产了但没消费"。
3. **体验一致性问题**：延迟、主动消息、通知各自为政，魔法数字散落各处。

改造主线：**模块化给系统骨架 → 内容池给血肉 → 创意工坊给生长能力**。

任务依赖关系（P0 → P2 顺序即建议实施顺序）：

```
P0（止血）：A1 用户延迟bug  A2 NO_REPLY bug  A3 回访关键词误触发  A4 模型配置检测
P1（骨架）：B1 模块注册表  B2 意图-闸门-管线  B3 调度下沉Rust  B4 活动事件流表
P2（血肉）：C1 经济闭环接线  C2 标签体系与加权抽样  C3 物品栏扩容  C4 随机事件扩容
P3（生长）：D1 消费审计  D2 日记回灌记忆  D3 睡眠固化窗口  D4 创意工坊  D5 Windows通知
横向（可并行）：E1 段间延迟实时化
```

---

## 0.5 设计思想与决策记录（对话全程结论溯源）

本章是整个方案的"为什么"。后续所有任务卡都是这些结论的具体化，承接方遇到方案取舍时应回到本章对齐。

### 0.5.1 对标结论：AstrBot 与恋语系项目

**AstrBot（开源多平台 LLM Chatbot 框架）给的是骨架启示**：常驻服务 + 事件总线 + 可插拔 pipeline（persona / 长期记忆 / function-calling 皆为独立 stage，按优先级和 token 预算组装）。我们现状是它的反面：后端纯被动 CRUD，所有"生命感"由前端 JS setInterval 驱动。由此得出本报告最重要的单点决策——**调度权下沉 Rust（B3）**，它解决的是产品生死问题：AI 不再随窗口关闭而死亡。若"关掉窗口但 bot 仍在 IM 上工作"是真实用户场景，下沉不是优化而是刚需。

**恋语系（本地陪伴类）项目给的是体验启示，三条经验已验证于本项目的差距分析**：
1. **异步性即真实感**：AI 该睡觉时真的不回、忙时回复慢。本项目已有 `isSleepBlocked()` 和回复延迟模拟，属于同类中做得较好的；改进方向是让延迟"有内容"（活动中途回一句"等下，画完这笔画"）。
2. **生活要闭环进记忆**：日记若只是展示，AI 的一天就与对话割裂——一周后用户问"你上周干嘛了"答不上来。这是 D2 的由来，也是本地陪伴项目拉开差距的关键闭环。
3. **主动消息低频高质、必带起因**：每次主动开口都携带理由（活动开始/想起上次话题/随机事件），并在 prompt 中显式说明"这是你主动开口，理由是 X"，否则 LLM 生成无来由的搭讪，瞬间出戏。

### 0.5.2 架构决策：Prompt 组装驻留 Rust 并 Provider 化

历史决策记录：项目早期 prompt 组装在前端做过两层异步，实测卡顿，因此整体下沉到 Rust（`chat.rs` 的 `process_message`）。**该决策保留，不回迁前端。** Provider 化（priority / token_budget / build 接口）在 Rust 侧实现（B3 第 4 点），收益：token 超限按优先级裁剪而非整段丢；模块与 chatStore 彻底解耦；prompt 单一事实来源（消除前端直连与 Rust 路径 prompt 不一致的风险）；前端序列化按 provider 声明精简传输。

### 0.5.3 从"推送注入"到"拉取检索"：一切体验皆记忆

核心转向：生活系统产出物（活动总结、日记、随机事件、属性变化）不再靠"生成后找地方塞进 prompt"的推送模型（注定有遗漏，且产生大量"生成了但从未被使用"的孤岛数据），而是**生成时即转写为带 salience 权重的记忆条目，进入既有向量记忆池**，对话时按相关性+新鲜度+salience 检索拉取 top-k。没有东西是"生成完等被引用"的——要么被检索到，要么确实不重要。此转向与 D2（日记回灌）共同构成记忆闭环。

### 0.5.4 消费侧审计：用数据代替怀疑

项目维护者长期怀疑"随机产出的内容被生成后抛弃不用"。解法是给生成物记账（D1）：每条生成物带 id，prompt 组装时记录注入了哪些 id；统计"过去 7 天生成的 N 条事件里有多少从未进入任何 prompt"。消费率极低的类别（预判：随机事件与属性变化是重灾区）说明其生成频率或注入策略有问题。**先做审计（1 天工作量）验证怀疑，再做结构解法**——这也是 M1 把 B4 事件流表提前的原因。

### 0.5.5 量变引起质变：量堆在标签上，不堆在条目上

针对"内容稀缺"问题的路线选择（维护者明确选择量变路线，讨论后收敛为）：
- **量的形态**：正交标签体系（≤6 维：sociality / cost / mood / energy / timeband / consumes）× 内容条目。6 维各 3~5 档即数千种组合气质，量堆在标签上比堆在条目上便宜一个数量级。
- **量的生产**：离线批量生成（LLM 按标签矩阵产候选，人工筛选入库）+ 应用内持续生长（D4 创意工坊）。
- **量的消化**：探索提权防死数据（D1），审计仪表盘是"量变是否兑现"的度量。
- **质变点**：内容池足够大且标签正交时，组合本身开始讲故事——"深夜+钱不多+情绪低落→便利店关东煮"与当时属性、日记、对话组合即产生"她在过具体生活"的体验。LLM 变奏降级为放大器：模板池提供骨架，LLM 只渲染当日细节。

### 0.5.6 主动行为统一模型：意图—闸门—管线

三套并行主动系统（AI-Life 活动触发、proactiveReplyStore 定时、chainProactiveStore 链式）的收敛模型（B2），三条设计公理：
1. **AI 的心跳不住在渲染进程**（0.5.1）；
2. **定时器只敲钟，决策权在模型**——链式主动的精髓（类比 Claude Code 的 agent loop：自续循环 + 模型决定"本回合不说话"），但必须补齐 Claude Code 有的三样：退避条件（被无视则收敛）、判断与表达分离（廉价裁决调用 REPLY/NO_REPLY 通过才走完整生成）、循环退出预算；
3. **所有出站消息走同一条管线**，且每条主动消息可追溯来源（`consumedBy`）——"她记得你说过要去开会"这类回访是最像"在乎"的主动行为，值得保留独立机制，但预算与退避必须是全局的。

### 0.5.7 真实感三件套的公共解法

用户延迟、段间延迟、通知、主动消息同属"AI 行为真实感"问题，公共解法是**上下文调制 + 全局预算 + 反馈环**，反对每处各写一套魔法数字：延迟 = 基础值 × 上下文系数（真实等待/节奏跟随/活动状态/兴奋度），主动频率 = 全局预算 × 被无视退避，通知 = 优先级 × 窗口焦点。（具体见 A1 / B2 / D5 / E1。）

---

## P0 · 近期修复（每项 ≤ 半天，先做）


### A1. 用户延迟恒为 5000ms、设置无效 —— 根因已定位

**现状**
- `src/store/chatStore.ts:609-626`：V7 设计为"用户点击输入框外部时记录真实等待时长 `_userWaitMs`，发送时**优先使用它**，仅无记录时回退设置项 `userReplyDelayMs`"。
- `src/store/chatStore.ts:2465`：`setUserWaitMs` 将值钳制上限 5000ms。
- 结果：用户只要在输入框外停留超 5 秒（绝大多数场景），实际延迟恒等于 5000，设置值永远不生效。

**方案**
1. 将"真实等待"从**覆盖**降级为**调制**：
   `最终延迟 = clamp(设置基础值 + 真实等待 × 0.2, 设置下限, 设置上限)`
2. 在分段回复设置中新增独立开关「真实等待模拟」（默认关）；关闭时纯粹走设置。
3. 5000 的钳制上限改为设置项（默认 5000）。

**验收**
- 开启模拟：停留 30 秒后发送，延迟 = 基础值 + min(等待×0.2, 上限)，不再是恒定 5000。
- 关闭模拟：延迟严格等于设置值。DebugLog 中 `[用户段间延迟]` 行数值与上述公式一致。

### A2. 链式主动 `NO_REPLY` 未处理（会当作消息发出去）

**现状**
- `src/store/chainProactiveStore.ts:282`：prompt 要求模型"不需要主动说话时回复 NO_REPLY"。
- 但 `sendChainMessage`（同文件 :76-264）的校验链（空回复/复读/客服腔/人设崩塌）中**没有任何一处检查 NO_REPLY 字面量**。模型若按指令返回 NO_REPLY，会被当作正常消息发送给用户。

**方案**
在 `sendChainMessage` 的 `while` 循环内、拿到 `aiReply` 后首先判断：
```ts
if (aiReply.trim().toUpperCase().startsWith('NO_REPLY')) return false; // 记一条 debug 日志后安静退出
```
同时在 DebugLog 记录 `[链式主动] 模型判断本轮不发言`，便于统计裁决命中率。

**验收**：将 LLM mock 为固定返回 `NO_REPLY`，验证不产生任何消息、无报错、下一次链正常自续。

### A3. 回访关键词裸 `includes` 匹配导致误触发

**现状**
- `src/store/chainProactiveStore.ts:16-21` 的 `CALLBACK_KEYWORDS` 用 `message.includes(kw)` 匹配。"我今天没吃饭"命中"吃饭"、"等一下看你发的"命中"等一下"，随后 AI 会莫名回访"你之前说要去吃饭"。

**方案**
1. 短期（本任务内）：正则加上下文否定过滤，如"没/不/别"后接关键词的排除；"等一下"类模糊词要求位于句尾或后跟标点。
2. 中期（并入 B1 模块化时）：由对话管道的情绪/认知分析阶段输出结构化字段 `user_departure_intent: {leaving: bool, reason: string, eta_minutes?: number}`，链式主动模块只消费该字段，不再自己猜。

**验收**：构造 20 条测试消息（含"没吃饭""等一下看这个""去洗澡了""不用去开会"），误触发 0、正例全中。

### A4. 模型配置检测（页面内）

**现状**
- `src/components/common/APIConfigPage.tsx:208-244` 已有单平台「测试」按钮（浏览器直接 fetch，Tauri 下绕过 Rust 代理）。
- 聊天侧仅有配置级预检 `isReplyPipelineReady()`（`src/services/aiService.ts:264`，不发真实请求）；未就绪时每条用户消息都会刷一条 `[预检] 未就绪` 日志（`chatStore.ts:2121`）。

**方案**（曾在本会话中实现验证过可行性，后按用户要求回退，可按此重建）
1. `aiService.ts` 新增 `checkModelConnectivity()`：先跑 `isReplyPipelineReady`；通过后取 `getAllEnabledChatModels()[0]`，经 Tauri `call_ai` 命令（非 Tauri 走 `fetchWithTimeout`）发一次 `max_tokens=1` 的真实请求，返回 `{ok, latencyMs, error, model, platform}`。
2. `ChatWindow.tsx` 进入时自动检测（模块级缓存 TTL 5 分钟，避免反复 ping）；`ok` 时不显示任何东西、正常走 AI 流程；失败时显示橙色提示条：原因 + 平台/模型名 +「重试」「前往配置」按钮（跳 `/api-config`，路由已存在 `App.tsx:108`）。
3. 日志去重：`chatStore` 增加模块级变量 `_lastNotReadyReason`，同一原因只记一条；恢复就绪时补记一条 `[预检] 回复管道已恢复就绪`。

**验收**：断网/错 Key/未配置三种情况下进入聊天页均出现提示条；修复后重试提示条消失；连续发 10 条消息在未就绪状态下日志只出现 1 条预检记录。

---

## P1 · 系统骨架

### B1. 功能模块注册表

**目标**：链式主动、定时回复（proactiveReplyStore）、AI-Life、随机事件、学习系统等各自为政的功能收敛为标准模块，统一生命周期、配置、意图出口。

**现状**：各模块在 `App.tsx` 启动时自行挂 `setInterval`/自续 `setTimeout` 链（`chainProactiveStore.ts:293-329` 甚至需要 window 句柄防 HMR 泄漏）；配置散落在 `modelRoleStore` 的多个 config 字段。

**方案**：定义统一接口并建立注册表：

```ts
interface FeatureModule {
  id: string;                       // 'chain-proactive' | 'proactive-reply' | 'ai-life' | ...
  name: string; version: string;
  defaultConfig: object;
  hooks: {
    onTick?(ctx: MinuteTickCtx): void;          // 统一分钟级节拍（含快进补偿）
    onUserMessage?(msg: UserMessageCtx): void;  // 取代各处对消息的旁路监听
    onActivityEnd?(act: AiLifeActivity): void;  // 活动结算钩子（C1 物品消耗的入口）
    produceIntents?(): Intent[];                // 意图生产，进 B2 全局闸门
  };
  settingsPanel?: React.ComponentType;          // 注册进设置页的配置 UI
}
```

迁移顺序建议：先迁链式主动（最小、收益立现，A2/A3 顺手完成），再迁定时回复，AI-Life 最后（它最重，且依赖 B3 一起迁）。

**验收**：注册表页可启停每个模块并显示运行状态；所有模块不再持有私有定时器；HMR/刷新后无重复触发（DebugLog 验证）。

### B2. 意图—闸门—管线：统一主动消息

**现状**：三条并行主动路径——AI-Life 活动概率触发（`chatIntegration.ts` 的 `maybeProactiveOnActivityStart`，10/25/45% 概率）、`proactiveReplyStore` 分钟级定时器、`chainProactiveStore` 链式判断——各有频控和睡眠判断，互不知情，叠加起来会对用户轰炸。

**方案**：三层模型
1. **意图生产**：上述三个来源（及未来的纪念日、天气提醒等）只产出 `Intent {priority, reason, source, payload}`，写入统一队列（Tauri 下落 `pending_intents` 表，见 B3）。
2. **统一闸门**（单点实现）：睡眠态拦截（复用 `isSleepBlocked`）→ 全局每日预算（默认 8 次/天，所有来源共享，定时任务>情绪触发>活动分享>随机闲聊）→ 被无视退避（连续 2 次未回应预算衰减 50%，3 次当日静默）→ 窗口焦点判断（决定走聊天流还是 D5 通知）。
3. **单一发送管线**：所有出站 AI 消息（UI 聊天、bot IM、主动行为）走同一条 prompt 组装 + 生成 + 拦截 + 发送路径。

每条主动消息携带来源（`consumedBy` 指向消息 id），实现"可追溯"——AI 后续能说出"我当时是因为想到你上次说的事才找你"。

**验收**：人为调高各触发源概率压测一天，主动消息总数 ≤ 预算；用户连续不回应后当日不再收到；每条主动消息在事件流中可查到来源意图。

### B3. 调度下沉 Rust（AI 的心跳不住在渲染进程）

**现状**：`src-tauri/src/commands.rs`（约 120 个命令）全部是同步 CRUD，`bot/mod.rs` 按需启停，**后端无常驻循环**。lifeEngine 分钟 tick、经济小时 tick、proactiveReplyStore、备份定时器全在前端。窗口一关、系统一休眠，AI 生活冻结。

**方案**
1. Rust 侧起一个 tokio 任务跑 `life_tick`（分钟级 interval；幂等设计已在 `lifeEngine.ts` 中具备，快进补偿逻辑平移：离线 <1 天补当日、1-7 天逐天补、>7 天只补今天）。
2. 主动行为产生**意图**而非直接发消息：写 `pending_intents` 表；前端在线时经 Tauri event 实时收到，不在线时下次启动仍被消费——"AI 一直活着，只是你没看到"。
3. 前端 lifeEngine 退化为**展示订阅者**：拉取/订阅活动状态渲染 UI，不再驱动状态机。
4. Prompt 组装已在 Rust（`chat.rs` 的 `process_message`，历史上因前端两层异步卡顿而下沉，此决策保留）：顺势在 Rust 侧做 **ContextProvider 化**——定义 trait（priority、token_budget、build(&CharacterState)），把 `chat.rs:939` 起的手工拼接拆为身份锚定/防漂移/说话方式/生活状态/记忆/情绪/学习等 provider，超预算按优先级裁剪。前端序列化传输按 provider 声明精简。

**验收**：关闭窗口（bot 仍在 IM 运行时）AI-Life 状态持续推进、意图被持久化；重开后活动时间线与离线时长吻合；Rust 侧单测覆盖 tick 快进补偿分支。

### B4. 活动事件流表 `ai_life_events`

**现状**：没有独立事件流。活动"日志"直接写在 `ai_activities` 行上（状态/summary）；细粒度生理行为（喝水、吃了个苹果）没有载体；日记与事件无法回灌记忆（见 D2）。

**方案**：新建表（Rust `db.rs` 建表 + `commands.rs` CRUD，模式与 `ai_activities` 一致）：

```
ai_life_events(id, character_id, ts, type,          // meal|drink|consume|purchase|random_event|plan_change|milestone|fallback
               description, activity_id?, item_id?, meta_json, injected_into_chat bool)
```

写入方：C1 的活动结算钩子、C4 的随机事件、变卦、用户打断、以及**兜底降级记录**（见 C2 适用域）。`injected_into_chat` 供 D1 审计消费。

**验收**：一天运转后事件流完整呈现"几点吃了什么、消耗了什么、发生了什么"；DebugLogPanel 可按日查看。

---

## P2 · 内容血肉

### C1. 经济闭环接线（把死代码接上）

**现状（调研已证实）**
- `consumeFoodForMeal()`（`attributeSystem.ts:214`，吃饭扣冰箱食材）与 `pickDailyOutfit()`（`:254`，每日穿搭）**导出后全工程零调用，是死代码**——吃饭不消耗食物、穿搭从不自动换，冰箱只进不出直到堆满。
- `monthlyIncome` 初始写死 0（`AiLifeModals.tsx:663`）且全工程无赋值点——工资逻辑（`localEconomy.ts:101-123`）永远不触发，AI 只出不进。
- 消费流水 `AiTransaction` 实际带 `timestamp`；"无日期"是 UI 展示问题（只显示最近 8 条且不带日期）——修复 `LedgerModal` 展示层即可。

**方案**：把消耗挂到**活动语义**而非再加随机层：
1. B1 的 `onActivityEnd` 钩子按类别结算：`meal` 类调 `consumeFoodForMeal`（并结算饱腹）；`work` 类按出勤日结薪（把月薪拆成日结，制造"请假亏钱"因果）；每天第一个非睡眠活动前触发 `pickDailyOutfit`。
2. 衣物购置已有（`localEconomy.ts` 3d 每月添衣 50% 概率），保留；食物补货（3a 冰箱见底买菜）保留——两者与消耗端接通后经济自然循环。
3. 每次结算写一条 `ai_life_events`（B4）。

**验收**：连续模拟 7 天：冰箱食材随三餐递减、见底后触发买菜、月末收支流水有日期且收支平衡点可解释、穿搭每日变化。

### C2. 标签体系与加权抽样（量变引起质变的调度基础）

**现状**：日程 = LLM 生成 + 失败回退固定模板（`scheduleGenerator.ts:105-199`）；设定包兜底静默发生（`worldConfig.ts:91` `sanitizeActivityAgainstWorld` 场景不在包内回退 `locations[0]`），导致日志里"活动和基底对不上一直兜底"却无人知晓。

**方案**
1. **活动 schema 增加正交标签**（≤6 维，放 `src/types/index.ts`，数据仍在 `docs/world-packs/*.json`）：
   `sociality: solo|casual|close`、`cost: free|low|mid|high`、`mood: healing|calm|excited|melancholy|tense`、`energy: low|mid|high`、`timeband`、`consumes/produces`。
2. **适用域三层**（实现"角色对应，没选则切普通，现实通用无需切换"）：每条内容 `world: <worldId> | 'modern-realistic' | 'untyped'`；解析顺序：当前世界专属 → 现实通用 → 无世界兜底池。**兜底必写事件流**（type='fallback'，"因 X 不可用降级为 Y"）——兜底不可怕，无声的兜底才可怕。
3. **调度改加权抽签为主、LLM 变奏为辅**：`pickActivity(state, timeband)` = 适用域过滤 → 时段/前置条件过滤（冰箱有食物才抽"在家做饭"）→ 按状态加权（饱腹低→`consumes:["food"]`提权；心情低→healing 提权；余额不足→free 提权）→ 抽签。权重 = base × 状态系数(1.0/1.5/2.0 三档) × 探索提权（D1）。LLM 降级为渲染器：把抽中的活动 + 当日上下文交 LLM 生成过程描述（复用 `contentGenerator.ts`），LLM 挂了纯模板照跑，保证本地可玩性。

**验收**：关闭 LLM 也能跑出按状态变化的日程；连续 30 天模拟中每个时段活动不重复率显著高于现状；兜底事件在事件流中可查。

### C3. 物品栏扩容到 300+

**现状**：`localShop.ts` 的 `SHOP_CATALOG` 硬编码约 130 件（11 类），几乎全是易耗品逻辑，无耐用品、无礼物、无节日件。

**方案**：目标约 320 件，分布（现有 130 件计入并补季节维度）：

| 类目 | 目标件数 | 要点 |
|---|---|---|
| 水果/蔬菜/饮品/食材/调味零食 | 16/10/14/16/16 | 补季节维度（西瓜·夏、姜茶·冬/感冒联动）；食材兼作做饭活动消耗品 |
| 日用品/个护/药品 | 22/14/8 | 周期消耗主力；药品与随机生病事件联动 |
| 衣物 | 30 | 按四季分层 + 配饰归入穿搭系统（`pickDailyOutfit`） |
| **耐用品·兴趣爱好（新增）** | 40 | **核心新增**：画板、吉他、Switch、拼图、烘焙工具、多肉、相机、香薰机…每件 `unlocks: ["activity_id"]` 解锁 1~2 个活动 |
| **耐用品·家居（新增）** | 25 | 台灯、空气炸锅（解锁新菜谱）、懒人沙发… |
| 数码 | 14 | 补充电宝、蓝牙耳机、屏幕维修（服务型） |
| 宠物向（可选） | 12 | 猫粮、狗玩具、鱼缸；不做宠物可砍 |
| **礼物类（新增）** | 15 | 鲜花、手链、演出门票——**走好感度逻辑而非饱腹**；AI 给用户送礼 / 用户送 AI 入物品栏 |
| **节日/限定（新增）** | 15 | 圣诞礼物盒、中秋月饼、生日蛋糕——按现实日历上架 |
| 服务型（新增） | 10 | 理发、健身月卡、外卖配送费——即时消耗不入库，丰富流水叙事 |

设计要点：耐用品是灵魂——买吉他 → 物品栏 → 活动池解锁"练吉他" → 日记/对话出现吉他 → 缺钱时纠结卖掉（回收机制）。礼物/节日件连情感线与日历。
**生产方式**：本表当批量生成 prompt 骨架，LLM 按类目生成候选（含价格/tags/消耗周期），人工筛选后入 `docs/world-packs` 同款 JSON，经 `ensureBuiltinWorlds()` 或独立 `content-pool` 文件播种。**内容池与世界包分离存放**，避免 80 个包各改一份（维护坑）。

**验收**：耐用品购买后对应活动出现在抽签池；节日商品仅在对应日历窗口上架；礼物消费产生好感度事件。

### C4. 随机事件扩容：9 → 80+，schema 升级

**现状**：`randomEvents.ts:31-41` 仅 9 条，字段仅 name/category/mood/attrEffect，触发纯概率（`eventChance` 按频率档 5/12/25%）无上下文条件。

**方案**：schema 升级 + 池扩容：

```ts
interface RandomEventDef {
  name: string;
  category: 'positive' | 'neutral' | 'negative' | 'social' | 'milestone';  // 后两类新增
  when?: { timeband?; weather?; season?; location?; activityCategory? };   // 条件过滤
  mood?: Record<string, number>;
  attrEffect?: Partial<Record<'health'|'stamina'|'cleanliness'|'spirit', number>>;
  cost?: number;                       // 花钱事件（奶茶15元）
  consumes?: string[]; produces?: string[];
  mayTriggerProactive?: boolean;       // 触发后经闸门可能主动告诉用户（"我看到一只超亲人的猫！"）
  memorySalience?: number;             // 转记忆条目权重；milestone 类设普通 3~5 倍
  worldTag?: string;                   // 适用域，同 C2
}
```

池子分布（新增约 71 条）：positive 小确幸 15（亲人的猫/快递/晚霞/旧衣口袋翻出钱/桂花香）· neutral 日常涟漪 10（突然下雨/排队久/电梯遇邻居）· negative 小倒霉 12（切到手/鸽子屎/打碎盘子 `consumes:["盘子"]`/网购踩雷 `cost`）· **social 社交向 12**（老朋友消息/同事分享零食/家人来电/店员夸穿搭联动 outfit）· **milestone 里程碑 8**（存款破整数/坚持活动满一月/完成一幅画）· 消费物品联动 10（看中超出预算的衣服→"想要"记忆/化妆品见底）· 健康天气 8（换季感冒联动药品/久坐腰酸）。

现有 `generateAiEvent()`（LLM 现编）保留，作为模板池之上的变奏层；`checkRandomEvent` 的触发改为"条件过滤 → 加权抽签"，加权同 C2。

**验收**：同一天不同角色/状态/天气触发出的事件分布明显不同；milestone 事件次日出现在日记摘要中。

---

## P3 · 生长能力

### D1. 消费审计与探索提权（防死数据）

**方案**
1. 每条池内容（活动/事件/商品）记录 `lastPickedAt`、`pickCount`（SQLite 小表或复用现有 extra 字段）。
2. 探索提权：超 N 天未中 ×2（封顶）；刚被抽中 ×0.5（防短期重复）。
3. DebugLogPanel 增加统计视图：池总量 / 7 天命中率 / 从未命中清单。**这个数字是"量变是否兑现"的仪表盘**——500 条里 200 条从未命中说明标签或权重设计有问题，而不是量不够。

**验收**：模拟 30 天后从未命中比例 < 20%，且可通过提权观察其下降。

### D2. 日记回灌记忆（生活闭环进对话）

**方案**：`maybeGenerateDiary`（日终日记生成）完成后，将日记摘要转写为 memoryStore 记忆条目（带 `memorySalience` 权重），进入既有向量检索池。一周后用户问"你上周干嘛了"，AI 靠检索命中日记真实作答。Prompt 注入生活状态改为摘要槽 `[今天的经历: ...]`，并要求回复自然体现；响应解析时校验是否真的使用，未使用记审计——消费审计的一部分。

**验收**：模拟 7 天后对话中询问上周活动，回复内容与日记一致（人工评估）。

### D3. 睡眠固化窗口（睡眠不是死时间）

**方案**：入睡 tick 变为后台任务窗口：日终固化 = 日记摘要（D2）+ 记忆合并去重 + 属性衰减 + 生成明日日程 + **D4 的内容提案**。产品叙事："她睡觉时真的在消化这一天"——次日"你睡得怎么样"的回答来自昨晚固化产物。

**验收**：睡眠时段完成固化任务且不产生任何对外消息；次日日程在醒来前已生成。

### D4. 创意工坊：AI 自我扩充内容（应用内生长循环）

**方案**：把"离线批量生成管道"变成产品内循环
1. **提案**：D3 睡眠固化时回顾当天实际经历，生成 1~3 条新事件/活动/商品候选——从"当天真实发生但池子里没有的事"提炼，天然贴合角色与世界。
2. **审核**：提案以完整 schema 存 `ai_content_proposals` 表；用户面板看到"她提议了 N 个新事件"，批准/修改/拒绝；批准入池并标记 `source: 'ai-authored'`。
3. **边界**：AI 只能扩充**数据**（事件/活动/商品/主动消息话题模板），永不能生成代码或改模块行为——只需 schema 校验，无需沙箱。限频（如每周 ≤3 条）。
4. **淘汰**：D1 审计反向作用——连续一个月零命中的 AI 条目自动降权/进隔离区；批准界面展示该 AI 历史提案平均命中率。

**验收**：端到端跑通"提案→审核→入池→被抽中→审计统计"全链路；拒绝路径不污染池子。

### D5. Windows 通知栏提醒

**方案**
1. Tauri v2 `tauri-plugin-notification`：`Cargo.toml` 加插件、`src-tauri/capabilities/default.json` 加 `notification:default` 权限、调用侧一行 `NotificationExt`。
2. **两个必须提前告知承接方的坑**：① Windows 通知要求 AppUserModelID——`tauri dev` 开发模式下常静默失败，需在打包构建中验证，调试期不显示≠代码错误；② 通知点击的 deep-link 在 Windows 支持有限，稳妥做法是通知携带会话 id、点击后 `app.emit` 前端路由跳转，至少做到"点击聚焦主窗口"。
3. 触发规则：B2 闸门的一条——窗口失焦/托盘化时高优先级意图（定时任务、情绪事件）走通知；低优先级（活动分享）只写聊天流；前台时一律聊天流。通知节流（防轰炸）由闸门统一管。

**验收**：打包构建中，窗口最小化时高优先级主动消息产生系统通知，点击激活窗口并跳转会话；前台时不弹通知。

---

## 横向 · E1. AI 段间延迟实时化

**现状**：V7 已按**段长度 + 情绪强度**计算（Rust `compute_segment_delays` 优先、前端兜底）——这两个是消息内在属性，不是"对话实时"因子。

**方案**：公式 `延迟 = (每字符打字速度 × 段长) × 情绪系数 × 节奏系数 × 活动系数`，新增三个对话上下文系数（各 clamp）：
1. **节奏跟随（entrainment，收益最大）**：取用户最近 2~3 条消息间隔，归一化为 0.6~1.5 系数——用户连发快消息时 AI 分段也快。
2. **活动系数**：复用 `getReplyDelayForActivity()`（现仅用于首条回复延迟），扩展作用于段间。
3. **对话兴奋度**：最近双方消息平均长度倒数作代理——短消息互抛（斗嘴/接梗）压短，长段落讨论拉长。

每字符速度取"看得出在打字"量级（中文 80~150ms/字），长段延迟封顶；延迟期间联动打字指示器。

**验收**：同一回复在"用户秒回模式"与"用户慢回模式"下段间延迟可测差异 ≥ 30%；延迟期间显示"正在输入"。

---

## 附：关键现状事实速查（承接方复核用）

| 事实 | 位置 |
|---|---|
| 链式主动完整实现（含 NO_REPLY 缺陷、关键词匹配） | `src/store/chainProactiveStore.ts` |
| 回复编排/prompt 组装主流程 | `src/store/chatStore.ts`（sendMessage 约 :930-1100；Rust 路径 `process_message`） |
| Rust 端 prompt 构建 | `src-tauri/src/chat.rs`（构建约 :939 起） |
| 预检 `isReplyPipelineReady` | `src/services/aiService.ts:264` |
| 用户延迟覆盖逻辑 / 5000 钳制 | `chatStore.ts:609-626` / `:2465` |
| AI-Life 引擎/tick/快进 | `src/services/ailife/lifeEngine.ts` |
| 经济 tick（月薪死逻辑、日用品消耗） | `src/services/ailife/localEconomy.ts` |
| 死代码：`consumeFoodForMeal` / `pickDailyOutfit` | `src/services/ailife/attributeSystem.ts:214 / :254` |
| 商店硬编码 130 件 | `src/services/ailife/localShop.ts:51-179` |
| 随机事件 9 条池 | `src/services/ailife/randomEvents.ts:31-41` |
| 设定包兜底 `sanitizeActivityAgainstWorld` | `src/services/ailife/worldConfig.ts:91` |
| 生活状态注入对话（`buildLifeStatePrompt`/`isSleepBlocked`/回复延迟/主动概率） | `src/services/ailife/chatIntegration.ts` |
| 定时回复调度器 | `src/store/proactiveReplyStore.ts` |
| API 配置页测试按钮 | `src/components/common/APIConfigPage.tsx:208` |
| 后端无常驻循环（全同步 CRUD） | `src-tauri/src/commands.rs` / `db.rs` / `bot/mod.rs` |

## 附：实施里程碑建议

- **M1（1 周）**：P0 全部 + B4 事件流表 → 立刻止血并具备审计地基。
- **M2（2~3 周）**：B1 + B2（先迁链式主动与定时回复）+ C1 经济闭环 → 主动消息不再轰炸、生活开始"真的过"。
- **M3（2 周）**：C2 标签与抽样 + C4 事件扩容 + D1 审计 → 量变引擎就位。
- **M4（2 周）**：B3 调度下沉 + D2/D3 记忆闭环与睡眠固化 → AI 不再随窗口死亡。
- **M5（持续）**：C3 物品扩容（数据生产可并行）+ D4 创意工坊 + D5 通知 + E1 延迟实时化。

> 注：M2 起可多承接方并行（前端模块化 / Rust 调度 / 数据生产三条线互不阻塞），接口以 B1 的 FeatureModule 与 B2 的 Intent 契约为准先行冻结。
