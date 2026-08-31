# 技术方案：对话管线修复与 AI 一日系统重构

> 版本：v1.0（2026-08-28）
> 范围：Bot 外部接入（NapCat/微信）、对话管线（合并模式 / 好感度 / 主动回复 / 重试策略）、AI 一日生活系统大更迭
> 状态：已评审定稿，待实施
> 结论来源：本轮多轮需求讨论 + 全仓库代码调研（所有根因均定位到文件与行号）+ AstrBot / Generative Agents / 妹居物语 参考调研

---

## 目录

- [一、问题清单与根因分析](#一问题清单与根因分析)
- [二、总体架构原则](#二总体架构原则)
- [三、阶段 A：Bot 接入与对话管线修复](#三阶段-a-bot-接入与对话管线修复)
- [四、阶段 B：AI 一日系统大更迭](#四阶段-bai-一日系统大更迭)
- [五、配置项汇总（功能模块）](#五配置项汇总功能模块)
- [六、数据结构变更清单](#六数据结构变更清单)
- [七、实施顺序与里程碑](#七实施顺序与里程碑)
- [八、测试与验收方案](#八测试与验收方案)
- [九、风险与回滚](#九风险与回滚)
- [十、参考资料](#十参考资料)

---

## 一、问题清单与根因分析

### 1.1 Bot 外部接入（NapCat / 微信）

| # | 问题 | 根因 | 位置 |
|---|------|------|------|
| P1 | 回复一直套用合并模式发送 | 外部平台纯字符数阈值（≥150 即合并），无结构化判断；应用内 `aiMergeMessages` 开关开启后**无条件**合并 | `src/handlers/botHandler.ts:26`（MERGE_THRESHOLD=150）、`:383-441`；`src/store/chatStore.ts:2196-2222` |
| P2 | 应用重启后接入不自动恢复 | `startIntegration` 仅在 IntegrationPage 手动开关时调用，无启动自动拉起 | `src-tauri/src/commands.rs:2141-2176`、`src/components/settings/IntegrationPage.tsx:440` |
| P3 | 每次重启后微信发消息就新建会话 | ① 会话映射延迟 6s 加载（requestIdleCallback），早到消息查不到映射即新建；② `addConversation` 无 (integrationId, externalUserId) upsert 去重 | `src/App.tsx:240-245`、`src/handlers/botHandler.ts:174-212`、`src/store/integrationStore.ts:157-174` |
| P4 | 微信轮询重启后可能重复消费 | 游标 `get_updates_buf` 仅存内存，无持久化 | `src-tauri/src/bot/wechat.rs:53,66,87-171` |
| P5 | 群聊每条消息都触发回复 | 无 @机器人 / 唤醒词检测 | `src/handlers/botHandler.ts:128-172` |
| P6 | 连续重复回复、无限刷屏 | ① napcat.rs 未解析 `self_id`，未过滤 `message_sent` 自身消息（若 NapCat 开启上报自身消息即自循环）；② Rust 侧无 messageId 去重（仅前端有） | `src-tauri/src/bot/napcat.rs:130-158`、`src-tauri/src/bot/types.rs:5-26`、`src/handlers/botHandler.ts:25,83-92` |
| P7 | 无法手动控制新建对话 | Bot 消息无指令分支，直接进聊天管线 | `src/handlers/botHandler.ts`（全文件无指令处理） |

**已确认可复用的现有能力**：
- `BotIntegrationConfig`（`src/lib/tauriBridge.ts:1100-1115+`）已含 `private_chat_enabled / group_chat_enabled / allowed_users(_enabled) / allowed_groups(_enabled) / blocked_users(_enabled) / blocked_groups(_enabled)`，且 `botHandler.ts:122-172` 已实现过滤逻辑——**只缺编辑 UI**。
- NapCat 为反向 WebSocket 服务器，客户端断开可随时重连（服务端循环不退出），断开有 `bot-status: disconnected` 事件通知前端——被动重连机制本身健全。
- 项目已有完整 Agent 能力体系（`src/types/agent.ts`、`src/store/agentStore.ts`、`src/agent/toolRegistry.ts` + `src/agent/tools/` 18 个工具文件），应用内斜杠指令按工具**中文名**触发（如 `/切换角色`）。

### 1.2 对话管线

#### 1.2.1 好感度增量

- **现状**："+2/+1" 数值由 AI 在认知思维链中自由发挥（prompt 仅约束情绪 ±5，未约束好感度），落地前经 Rust 确定性算法二次修正：阶段递减因子（`chat.rs:238-244`：≥80→0.4，≥60→0.6，≥40→0.75，≥20→0.9）× 封顶 100 × AI 未给值时的随机浮动兜底（0.7~1.3，`chat.rs:249-259`）。
- **结论**：算法存在且有依据，保留现有框架。**修订**：AI 选值范围放宽至 **-3 ~ +3**，本地计算最终参量（见 A2）。
- 相关代码：`src-tauri/src/chat.rs:1489-1503`（prompt）、`:2506-2554`（parse_update_text）、`:763-793`（增量修正）；前端 `src/store/chatStore.ts:978,1304-1312`、`src/store/characterMindStore.ts:518-547`。

#### 1.2.2 主动回复（核心痛点）

主动回复（`src/store/proactiveReplyStore.ts:81-500` sendProactiveMessage）**确实复用了 Rust process_message 管线**，但与正常聊天存在严重不对齐：

| 症状 | 根因 | 位置 |
|------|------|------|
| 调用信息看不见 | 成功路径仅写 1 条 debug log（正常聊天写约 8 条）；DebugLogPanel 的 ALL_TYPES 过滤按钮**漏了 `proactive`** 类型 | `proactiveReplyStore.ts:330`、`src/components/debug/DebugLogPanel.tsx:52` |
| 上一句说爱我，下一句"在等你" | 触发词是**假元指令** `[你刚刚回复了用户，想要主动延续对话]`；suffix 只泛泛说"延续话题"；**没有把最后一轮真实对话注入**，无"禁止复述上一条"约束 | `proactiveReplyStore.ts:110,526-532,534,606-615` |
| 上面喜悦、下面变成期待 | 消息情绪标签**硬编码** `emotion: 'anticipation'`；maxTokens 的情绪参数也写死 `'anticipation'`（Rust 认知链其实正确返回了 emotion_update，但没用于消息标签） | `proactiveReplyStore.ts:409,214,287` |
| 温度对不上 | `getAdaptiveTemperature(convLen, undefined, undefined)` 未传真实用户消息与情绪，与 chatStore 正常调用输入不一致 | `proactiveReplyStore.ts:171` |
| 记忆对不上 | V2 双层记忆检索的 query 用的就是那条**假元指令**；`memoriesJson` 仅 `slice(0,5)` 无相关性排序 | `proactiveReplyStore.ts:133,144,183,206` |
| 主动回复重复刷屏 | req 不传 `forbiddenText`/`recentReplies` → **Rust 复读/违规拦截对主动回复完全失效**；前端 isDuplicate 检查在生成之后且命中即静默放弃 | `proactiveReplyStore.ts:193-255`（req 缺字段）、`:290-297` |
| 其他缺口 | 不传 conversationSummary/timeGapHint；不跑插件钩子、情绪咨询、生活状态注入；回复后主动入口不过 intentGate 闸门、不计预算；失败静默放弃无兜底 | 差异清单见调研 |

#### 1.2.3 重试策略与降级文案

现状为 **5 层重试栈**：

1. 业务拦截重试（chatStore Rust 路径）：`RUST_RETRY_MAX=2`，最多 **3 次完整重新生成**，参数原样重发（不升温、无修复 prompt），耗尽后**放行被拦截回复**（明知复读仍展示）。
2. 前端非流式重试（chatStore.ts:1568-1601）：最多 3 次全量重生成，**未使用**已定义的 `getRetryTemperature`/`getAntiRepeatBreakPrompt`（温度原样 → 相似回复的直接成因）。
3. Rust 推理耗尽兜底（chat.rs:590-700）：reasoning token 吃光时逐级降 effort → 简化 prompt 重试 → reasoning_content 兜底 → 前端兜底文案。
4. HTTP 层重试（ai.rs:56-188）：429/503 指数退避 2s/4s/8s，最多 4 次（基础设施层，保留）。
5. 模型候选切换（aiService.ts:670-860）：每候选可配置次数（默认 3）+ 候选间退避（保留）。

**问题**：① 拦截重试次数过多（3 次全量重生成，成本高且产出重复/AI 味重）；② 重试是全量重生成而非修改式；③ 不可配置。

**降级文案直接漏进对话**（用户聊天记录实证）：
- 「（星眠这边好像出了点状况，先简单回一下……）」→ Rust 报错兜底，硬编码（`chatStore.ts:1355-1357`）。
- 「……嗯？好像走神了，能再说一遍吗」连续出现 3 次 → 过短恢复文案 `getRoleRecoveryReply`（`aiService.ts:2092-2141`）随机抽取但可重复命中。
- 空回复兜底「轻轻应了一声」（`chatStore.ts:1202-1207`）。

**流式重复 bug**：`aiService.ts:737-797` 流式重试时 `chatStore.ts:1418` 的 `streamedContent` 不重置，第二轮 token 继续追加 → 同段文字两遍。

### 1.3 AI 一日系统现状

| 模块 | 现状 | 问题 |
|------|------|------|
| 初始创建 | `contentGenerator.ts:378-443`，prompt 仅"食品若干、1-2件衣物、常用药品，共4-8件"，物品**凭空生成**（不引用商店目录 localShop.ts）；**未传入角色性别** | 物品不符常理（无大米粮油）；性别物品缺失；AI 编的物品与后续扣库存/补货闭环接不上 |
| 活动结构 | `AiLifeActivity.processDescription` / `summary` 均为单字符串，无过程/笔记结构 | 违背"过程留痕"设计 |
| 属性系统 | `attributeSystem.ts` 六维（health/stamina/satiety/cleanliness/spirit/stress），小时衰减、活动效果、阈值触发均存在 | **无口渴维度**；且为单向（活动→属性），属性不反向驱动行为；状态差仍上班谈笑风生 |
| 状态-行为耦合 | 无 | 无需求抢占、无请假、无自动补救（进食/运动） |
| 日程 | `scheduleGenerator.ts` 模板+LLM，不知道星期几/节假日 | 每天雷打不动上班；无周末/请假/出游；isChanged 变更字段几乎不触发 |
| 经济 | `localEconomy.ts` 自主购物**不接收人设/世界观/关系图**；`creditDailySalary` 已有雏形 | 设定违背（星眠无本地亲人却给亲人买礼物）；工资未正式按日结；流水无按日分组 |
| 本地（非 Tauri） | 所有 ailife 数据函数空操作（`tauriBridge.ts:1654-1990`）；`dbGetAiLifeConfig` 恒 false → `ensureLifeEngineStarted` 直接 return | **生活引擎在浏览器模式根本不启动**；初始创建写入静默丢失；`src/lib/idb.ts` 现成但未被 ailife 使用 |

**关键事实**：生活引擎（lifeEngine/attributeSystem/scheduleGenerator/contentGenerator/localEconomy）全部是 TypeScript 前端实现，Rust 端只做 SQLite 持久化与查询——本地方案不需要重写引擎，只需数据层适配 + 启动门禁修复 + 时间补算。

---

## 二、总体架构原则

以下原则贯穿全部设计，是讨论中确认的决策：

1. **上下文构建器收敛（单一真源）**：主动回复与正常聊天必须共用同一条上下文组装路径（历史、记忆检索、摘要、人格、温度、maxTokens、拦截字段全部同源）。记忆一致性由**构造保证**，不靠补丁注入。参考 AstrBot 的 Session/Conversation 分离架构：ConversationManager 统一持有每会话的 LLM 对话历史，任何来源的回复（用户消息、插件、主动消息）从同一容器读、写回同一容器；主动路径**只读共享状态，绝不自建或覆盖历史**（吸取 AstrBot Issue #7622 主动回复覆盖长期历史的教训）。
2. **引擎掷骰，LLM 写作文**：概率性决策（事件触发、需求抢占、重试策略）由确定性引擎控制（可调、可调试、可复现），LLM 只负责叙事与个性化选择。
3. **决策层 LLM 参与**：生活念头决策（采纳/拖延/拒绝）由轻量模型角色参与判断（用户明确要求），LLM 失败/超时回退纯算法兜底。
4. **常识走模板，个性走 AI**：初始物品 = 条件基线目录（查表，确定性）+ 预算制 AI 采购（商店目录内自选）；经济事件先过"人设+世界观+关系图"硬规则过滤，LLM 只在合法集合内做选择。
5. **拟真优先**：1x 真实时间；离线期间"补算追赶"（数学快进 + 一次 LLM 补叙日记）而非冻结。
6. **配置进功能模块**：合并模式、重试策略、Bot 行为、性格决策参数全部在 `featureModuleStore` + FeatureModulePage 统一配置，与现有"好感度参数/情感参数/记忆参数"折叠区同一容器同一模式。
7. **指令进 Agent 能力**：Bot 指令注册为 AgentTool（中文命名，与全项目 `/切换角色` 风格一致），botHandler 复用同一套斜杠解析。
8. **时间预算可控**：LLM 调用按场景分配模型档位——生活念头决策用轻量档，主动回复/日常聊天用 cognitive 档，日记得用完整档，离线补算只调一次。

---

## 三、阶段 A：Bot 接入与对话管线修复

### A1 智能合并模式（参数进功能模块）

**行为定义**：合并模式仅用于"长内容 + 结构化"的回复（小短文、带标题/列表/序号/明显分节的内容）；日常短对话照常分段拟真发送。

**配置**（`featureModuleStore` 新增 `botBehavior` 组）：

```ts
interface BotBehaviorConfig {
  mergeEnable: boolean;          // 合并模式总开关（默认 true）
  mergeThreshold: number;        // 长度阈值（默认 150 字符）
  mergeRequireStructure: boolean; // 合并需结构化特征（默认 true）
  sendDebounceMs: number;        // 发送防抖窗口（默认 3000，原 BOT_DEBOUNCE_MS）
}
```

**结构检测工具**（新增 `src/utils/structureDetect.ts`）：

```ts
function isStructuredContent(text: string): boolean {
  // 命中任一特征即视为结构化：
  // 1. markdown 标题（#~###### 开头行 ≥1）
  // 2. 列表项（- / * / • / 1. 2. 序号开头行 ≥3，或占比 ≥30%）
  // 3. 明显分节（空行分隔的段落 ≥4 且平均段长 ≥40）
  // 4. 标题式短行（<20 字、无句末标点的独立行 ≥3）
}
```

**改造点**：
- `botHandler.ts:383-441`：合并条件从 `totalChars >= MERGE_THRESHOLD` 改为 `mergeEnable && totalChars >= mergeThreshold && (!mergeRequireStructure || isStructuredContent(joined))`；`BOT_DEBOUNCE_MS` 改读配置。
- `chatStore.ts:2196-2222`：`aiMergeMessages` 开启时，先判 `isStructuredContent(aiReply) || aiReply.length >= 阈值`，不满足则照常走分段路径。
- UI：FeatureModulePage 新增 `<ModuleSection icon={MessageSquare} title="Bot 接入行为">` 区块（与"Agent 能力"区块并列），内含合并参数（复用 SliderField / 开关组件）。

### A2 好感度：AI 选值 -3~+3，本地计算最终参量

**已确认决策**：算法框架保留（阶段递减 + 功能模块倍率 + clamp），仅做两点修订。

1. **Prompt 修订**（`src-tauri/src/chat.rs:1489-1503` 认知思维链第 5 步，及 `chatStore.ts:978` 前端同款 prompt）：

   > 更新 / Update：（格式：sadness +2, joy -1, 好感度 +1。每种情绪每次变化不得超过 ±5；**好感度每次变化在 -3 ~ +3 内选值，可含小数：日常普通对话通常 ±1，让角色有明显情绪波动的事件 ±2，重大事件（表白、冲突、惊喜、离别等）±3**。）

2. **本地计算链**（Rust 端 `chat.rs:763-793` 现有逻辑扩展）：

```
最终增量 = AI 选值(-3~+3)
         × 阶段递减因子(现有: ≥80→0.4 / ≥60→0.6 / ≥40→0.75 / ≥20→0.9)
         × 情绪基线系数(B5 接入: 低落日×0.5 ~ 开心日×1.2，默认 1.0)
         × 功能模块增长倍率(affinityGrowthRate, 现有)
→ 单次增量上限截断(affinitySingleMax, 现有) → ±100 clamp(现有)
```

3. **透明化**：debug log 输出全链路 `[好感度] AI选值=+2.0 → 阶段因子0.6 × 情绪基线1.1 × 增长倍率1.0 → 最终+1.32`；AI 未给值时走现有随机浮动兜底公式，同样记录。

### A3 重启自动恢复与会话复用

1. **自动拉起接入**：`src/App.tsx` 启动流程中，`loadIntegrations()` 完成后遍历 `integrations.filter(i => i.enabled)`，逐个调用现有 `startIntegration`（带错误捕获与 debug log）。注意：在 `loadConversations` 完成后再启动，保证早到消息能查到会话映射。
2. **会话映射 upsert**：`integrationStore.addConversation` 改为：写入前先按 `(integrationId, externalUserId)` 查重，存在则更新（含 group 维度，见 A4），不存在才 `generateId()` 新建。
3. **加载时序**：`src/App.tsx:240-245` 的 `requestIdleCallback 6000ms` 延迟改为：启动时同步 `await loadConversations()`（若启动耗时敏感，可保留 idle 加载，但 botHandler 在处理消息前 `await ensureConversationsLoaded()`——加一个"已加载"Promise 缓存）。
4. **微信游标持久化**：`wechat.rs` 的 `get_updates_buf` 每次成功拉取后写入现有 config/DB 通道（复用 `db.rs` 键值表或 config 存储），`start_bot_integration` 启动时读取恢复；游标带时间戳，超过 7 天视为失效从空开始（防极端重复消费）。

### A4 指令与群聊控制（参考 AstrBot）

#### 4.1 指令注册为 Agent 能力

新增 `src/agent/tools/botTools.ts`，注册进 `toolRegistry.ts`，category=`chat`，命名沿用项目中文风格：

| 工具 id | 中文名（指令） | 行为 |
|---------|--------------|------|
| `bot_new_conversation` | 新建对话 | 为当前外部用户/群新建 chatStore 会话并更新映射 |
| `bot_current_conversation` | 当前会话 | 返回当前会话信息（标题、消息数、创建时间） |
| `bot_help` | 帮助 | 列出全部 Bot 可用指令 |

**Bot 端指令路由**：
- 从 `InputArea.tsx:586-657` 抽出 `handleSlashCommand`/`executeSlashTool` 核心逻辑为公共模块（如 `src/agent/slashCommand.ts`），InputArea 与 botHandler 共用。
- `botHandler` 收到以唤醒前缀（默认 `/`）开头的 Bot 消息 → 走斜杠解析本地执行 → 结果以 Bot 消息回复；**不进聊天管线、不触发 AI**。
- 指令也自然出现在应用内斜杠菜单（SlashCommandMenu 自动收录）。
- 默认会话策略：**外部用户始终复用已有会话**（映射不存在时自动建首次会话），仅 `/新建对话` 指令才主动新建——满足"输入指令才新建对话"的需求。

#### 4.2 群聊唤醒与黑白名单（功能模块配置）

**配置**（并入 `botBehavior`）：

```ts
interface BotBehaviorConfig {
  // ... A1 字段
  commandEnabled: boolean;        // Bot 指令开关（默认 true）
  wakeupMode: 'mention_prefix' | 'all'; // 群聊唤醒模式，默认 mention_prefix
  wakeupPrefix: string;           // 唤醒前缀（默认 '/'，与指令前缀统一）
}
```

**群聊行为**：
- `wakeupMode = 'mention_prefix'`（默认，AstrBot 同款策略）：群消息**仅当 @机器人 或以唤醒前缀开头**才进入回复流程；私聊不受影响。
- 群会话按 `group_id` 维度隔离（群内共享一个会话，同 AstrBot 默认），私聊按 `user_id`；会话映射键升级为 `(integrationId, externalUserId | groupId)`。
- 群回复携带 OneBot reply segment（@发送者 + 引用）。

**黑白名单**：复用 `BotIntegrationConfig` 现有字段（`botHandler.ts:122-172` 过滤逻辑已实现），在功能模块"Bot 接入行为"区块补每接入编辑 UI：
- 白名单/黑名单模式切换（allowed_*_enabled / blocked_*_enabled）；
- 用户名单（QQ 号）与群名单（群号）两列，支持批量添加/删除；
- 群聊开关、私聊开关（现有字段补 UI）。
- IntegrationPage 现有"自动回复"、"关联角色"设置保持不动。

### A5 防刷屏（自循环 + 去重）

1. **自身消息过滤**：`src-tauri/src/bot/types.rs` NapCat 事件结构补 `self_id`、`sub_type` 字段解析；`napcat.rs` 处理分支增加：`sub_type == "message_sent"`（自发消息上报）或 `user_id == self_id` → 直接丢弃，不 emit。**这是自循环无限刷屏的根治点**。
2. **Rust 侧消息去重**：napcat.rs / wechat.rs 维护 `HashMap<String, i64>` 的 messageId→时间戳字典（滑动窗口清理超过 10 分钟的条目），重复 messageId 直接丢弃；与前端 `processedMessageIds`（`botHandler.ts:25,83-92`）构成双保险。参考 AstrBot Issue #5848 的 `message_id_timestamps` 方案。
3. 前端去重键升级为 `integrationId:messageId` 优先（现在含 userId+时间+内容的复合键在快速连发时可能误杀/漏杀）。

### A6 主动回复重构：上下文构建器收敛（AstrBot 模式）

**核心原则**：主动回复与正常聊天共用同一条上下文组装路径，记忆一致性由构造保证；主动路径只读共享对话状态，绝不自建或覆盖历史。

#### 6.1 统一上下文构建器

从 `chatStore.sendMessage` 抽出公共函数（建议 `src/services/chatContextBuilder.ts`）：

```ts
interface ChatContext {
  messages: ChatMessage[];          // 对话历史（含附件展开），不含任何伪造消息
  systemPrompt: string;             // getSystemPrompt + 锚定 + 多样性 + 用户画像 + 记忆V2 + 摘要 + 插件钩子
  temperature: number;              // 自适应温度（真实输入驱动）
  maxTokens: number;                // 自适应 maxTokens（真实情绪驱动）
  rustReq: object;                  // process_message req 公共字段（含 forbiddenText/recentReplies/
                                    // conversationSummary/timeGapHint/emotionValuesJson 等）
}
function buildChatContext(conversation, character, input: { kind: 'user', text } | { kind: 'proactive' }): ChatContext
```

- `sendMessage` 调 `buildChatContext(conv, char, { kind:'user', text })`。
- `sendProactiveMessage` 调 `buildChatContext(conv, char, { kind:'proactive' })`，差异仅有：
  - **不追加任何假 user 消息**（废除 `[你刚刚回复了用户...]` 元指令进 messagesJson 的做法）；
  - 追加 `proactiveSuffix`（接续策略指令，见 6.2）；
  - 其余（记忆检索 query、摘要、温度、maxTokens、拦截字段）与正常聊天**完全同源**。

#### 6.2 接续策略指令（proactiveSuffix 重写）

```
[系统提示] 你刚刚回复了用户，现在想主动再说一句。要求：
1. 接续锚点——用户最后一句话是「{userLastMsg}」，你最后的回复是「{aiLastReply}」。
2. 你的新消息必须接着这个话头往下走，禁止复述、换皮重复你上一条回复的内容。
3. 本次主动类型：{问暖关心 | 追问 | 转折 | 分享延伸}（引擎轮换，记录上次类型避免连续同款）。
4. 保持角色设定，自然口语，不要提到这是"主动消息"。
```

- 接续类型轮换状态存 proactiveReplyStore（`lastProactiveKind: Record<characterId, kind>`）。
- `{customPrompt}`（用户自定义主动提示）保留，追加在末尾。

#### 6.3 情绪连续

- 删除 `proactiveReplyStore.ts:409`（及段循环内同款）的 `emotion: 'anticipation'` 硬编码：消息情绪标签取 Rust `emotion_update` 中变化量最大的维度（无变化则用当前 `charEmotion.emotion`）。
- `getAdaptiveMaxTokens('', convLen, 'anticipation')`（L214/287）改传真实当前情绪。

#### 6.4 记忆检索对齐

- V2 双层检索 query（L133/144）从假元指令改为**最后一轮真实对话内容**（用户最后消息 + AI 最后回复拼接，截断至 200 字）。
- `memoriesJson`（L183-206）从 `slice(0,5)` 改为与正常聊天相同的相关性检索结果。

#### 6.5 Rust 拦截生效

req 补传：`forbiddenText`（character.forbiddenBehaviors）、`recentReplies`（最近 5 条 AI 回复）、`conversationSummary`、`timeGapHint`——Rust 复读/套话拦截从此对主动回复生效（根治主动回复重复刷屏）。

#### 6.6 调试可见

- 主动回复全链路写 debug log（对齐正常聊天的 8 条）：`[主动回复] buildChatContext 组装完成（含上下文摘要 hash）`、`process_message 调用`、`原始输出`、`思维链`、`情绪/好感度更新`、`完成（N段）/失败原因`。
- `DebugLogPanel.tsx:52` 的 ALL_TYPES 补 `proactive` 过滤按钮（typeColors/typeBadge 已有定义）。

#### 6.7 失败处理与闸门

- Rust 失败回退前端 callAI 时记录 warning 日志（现有），回退后同样走完整后处理。
- 不再"静默放弃"：过短/为空时走与正常聊天一致的恢复策略（见 A7 兜底文案治理）。
- 回复后主动入口（`triggerProactiveAfterReply`）纳入 intentGate 闸门（目前不计数、无退避），统一每日预算。

### A7 重试策略改造（功能模块可配置）

**配置**（`featureModuleStore` 新增 `retryPolicy` 组）：

```ts
interface RetryPolicyConfig {
  interceptRetryMax: number;       // 拦截重试次数，默认 1（用户要求）
  retryMode: 'rewrite' | 'regenerate'; // 默认 rewrite（修改式）
  enableTemperatureRamp: boolean;  // 重试升温 +0.1/次，默认 true
}
```

**修改式重试（rewrite）**：拦截触发（`post_aborted=true`，含违规原因 duplicate/cliche/personaCollapse/forbidden）时，构造改写请求：

```
[系统提示] 你刚才的回复被系统判定为「{违规原因}」：
「{被拦截回复原文}」
请在保持人设、语气和原有结构的前提下，只修改回复内容本身，重新给出这条回复。禁止原样或近义复读。
```

- 改写请求复用同一 messages（不重建上下文），温度 +0.1（可关）。
- 一次改写后**直接放行**（不再二次拦截循环）。
- `retryMode = 'regenerate'` 时保留现有全量重生成行为（降级选项）。

**其他改造**：
- 前端非流式重试（`chatStore.ts:1568-1601`）：默认重试 1 次 + 接入现有未使用的 `getRetryTemperature`/`getAntiRepeatBreakPrompt`；人格脱落时保留 `getCollapseRecoveryPrompt` 追加。
- **流式重复 bug 修复**：`aiService.ts` 流式重试入口在启动第二轮前，通过回调/状态重置 `chatStore.ts:1418` 的 `streamedContent`（抽一个 `onRetryStart` 钩子或返回前清空缓冲）。
- **兜底文案治理**：
  - `chatStore.ts:1355-1357`「出了点状况」与 `aiService.ts:2092-2141` `getRoleRecoveryReply` 改为**角色口吻模板**：以角色 catchphrases/responseStyle/当前情绪生成（本地模板拼接，不调 LLM），每个降级类型准备 3~5 个变体，**轮换**选取（记录上次使用的变体索引，杜绝"走神了"三连）。
  - 降级文案进入对话前写 debug log（类型：`fallback_degraded`），便于统计降级频率、评估上游质量。
- HTTP 层（429/503 指数退避）与模型候选切换重试**保持不变**（基础设施层，不产生重复内容）。

### A8 拦截器误杀修复与后处理质量治理（2026-08-28 日志实证新增）

对 2026-08-28 调试日志（xingmian-logs-2026-08-28.json）逐条分析后发现的问题与修复项：

#### 8.1 禁止项含引号字符导致连环误杀（最高优先级）

**实证**：`[Rust管道] 拦截(1/2/3): 违反禁止项: "`——被匹配的"禁止项"是**一个英文双引号字符**。角色回复引用用户原话时（如 `你说"怎么做才能让我一直好"`）必然命中 → 每条都触发 3 次全量重试 →"重试3次后仍被拦截，放行当前回复"。日志实证：04:38:25 发出消息，04:40:03 才收到回复（**单条消息总耗时 3.5 分钟**，三次生成分别 43.9s / 71.8s / 97.3s），且最终放行的回复仍含引号（拦截目的完全落空）。

**修复**：
- `forbiddenText` 列表入库/读取前清洗：过滤空串、单字符、纯标点条目；角色编辑 UI 对禁止项做最小长度（≥2 字符）与"包含标点"校验提示。
- 拦截原因日志打印被匹配的**完整禁止项与命中位置**（当前只打印一个引号，无法排查）。
- 拦截统计：连续 N 条消息因同一禁止项触发拦截时，debug log 高亮告警（提示配置问题而非模型问题）。

#### 8.2 后处理管线把回复改烂（用户"害，质量又变了"的直接原因）

对照原始输出与最终上屏文本，逐项实证：

| # | 问题 | 实证（原始 → 上屏） |
|---|------|---------------------|
| 1 | **动作括号行整行被剥离** | `（把脸埋进你怀里，声音闷闷的，带着藏不住的开心）你、你怎么又说这种话啦……` → `你、你怎么又说这种话啦……`——角色动作描写全部丢失，8/28 当天所有回复不再有动作行（8/14、8/15 的回复都有） |
| 2 | **口语化注入固定前缀** | 几乎每条"口语化注入: 2处"——上屏回复统一以 `额...` `嗯...` `害...` `emm` 开头（12:25/12:26/12:31/12:53 实证），模板感即"AI 味"主源 |
| 3 | **尾缀粒子不检查句末标点** | `想抱多久就抱多久，好不好？` → `……好不好？吧`；`嘛，你说好不好？` → `……好不好？呢`——句号/问号后再追加"吧/呢"，产生语病 |
| 4 | **length_randomize 截断产生残句** | 模型原文 `我、我也最喜欢主人了……小笨蛋就小笨蛋吧，哼。` → 上屏 `嗯...我、我也最喜欢主人了……吧`——后半句被截掉，留下悬空的"吧" |
| 5 | **自相矛盾**：口语化注入的开头词被自家拦截器判为套路词 | 04:25:53 `拦截(1): 套路词[high_freq_opening]: "嗯…"` 重试——一个模块注入"嗯…"、另一个模块因此拦截重试 |

**修复**：
- 口语化前缀/后缀注入加语境检查：句末已有标点或语气词（呢/吧/嘛/哦/呀）时**跳过**后缀注入；前缀注入概率大幅下调并与角色 catchphrases 联动（用角色自己的口头禅，而非全局"额/嗯"词库）；同一条回复禁止前后缀同时注入。
- length_randomize 截断点必须落在句末标点处（禁止截在语气词前/句中）。
- 动作括号剥离改为可配置且**默认关闭**（`removeActionTags` 是拟真质感的来源，剥离它反而去人机感倒退）；或仅在括号行占比过高时截断保留首尾。
- 统一"去人机感"词库与"套路词拦截"词库：注入源词不再出现在拦截词表中（构建时自动求差集并告警）。
- 新增后处理前后对照日志：`[后处理对照] 原文摘要 → 上屏摘要（模块: 动作列表）`，让每次改动可追溯。

#### 8.3 好感度解析双路径矛盾（A2 补充）

**实证**：同一条消息先后输出两条矛盾警告：`好感度增量 1 按阶段(0)缩放为 0` + `思维链未解析出好感度增量，按阶段收益计算默认 +0`——通用正则已解析到 +1，专用路径却报"未解析"，两路径都执行、都记日志，最终生效值不明。且高好感（≈97）时 +1 被缩放为 **0**（增长完全封死）；阶段标签打印为 `(0)` 而非阶段名。

**修复**（并入 A2）：解析路径合一（先专用后通用，命中即停，只记一条日志）；阶段因子设最低保底（≥0.1）不允许归零；日志打印阶段名与完整计算式。

#### 8.4 思维链协议与 reasoning 模型不匹配（新增）

**实证**：多条消息 content 无 `<thought>` 标签（模型把认知写进 reasoning_content 或直接裸输出），触发"已使用模型 reasoning 作为思维链源"的启发式拼接——拼出的链残缺失序（04:26:10 的链里混着"让我写思考过程："和互相矛盾的增量 `joy+3 … joy-2`）。且模型**认知写两遍**（reasoning_content 383~816 tokens + `<thought>` 正文），每条多耗 400~800 completion tokens。

**修复**：认知链协议二选一——对 reasoning 模型，prompt 明确"全部认知只写入 reasoning，正文只输出 <reply>"（省 token）；解析侧以 reasoning_content 为首选源、`<thought>` 为回退（当前相反）。拼接兜底必须按标签逐行重排校验，解析不出情绪/好感度增量时如实标注"协议未遵循"而非语义推断硬凑。

#### 8.5 情绪衰减与代谢混记（B5 补充）

**实证**：05:36 模型写 `sadness +3, joy -1, love +2`，实际应用 `anticipation-8, joy-13, trust-3, sadness-4, love-4, anger-7`——近 1 小时的时间衰减被合并进同一条"情绪更新"日志，深情告白场景显示 love -4；主导情绪值长期在 10~25 徘徊（anticipation:13），衰减速率压过代谢，情绪面板数值失去意义。

**修复**（并入 B5）：衰减与代谢**分开计算、分开记录、分开展示**（日志两行：`[衰减] joy -13（56min）` / `[代谢] love +2`）；重标定衰减参数使情绪值有正常动态范围；情绪基线（B5.2）落地时以重标定为基础。

#### 8.6 其他实证（并入既有方案）

- **重试无缓存**：三次重试 prompt_tokens 相同但 cached_tokens 全为 0（首轮 6528~6656）——重试未命中供应商前缀缓存；A7 改写式重试天然复用前缀，可顺带缓解。
- **自适应温度无上限**：对话 222 轮时温度爬到 0.98，高温加剧漂移与套路词——自适应温度加上限（默认 ≤0.95）并纳入 retryPolicy 配置。
- **AI 一日排程错乱**：12:31 中午状态"准备入睡（卧室）"、13:34 转"下午工作"，与"白天工作晚上休息"人设矛盾（B6 日历层实证）；13:34 四项属性阈值同时告警无人处理（B3 需求系统实证）。
- **生活生成降级链**：空闲续写 LLM（GLM-4.6V-Flash）输出 reasoning 被截断、JSON 解析失败 → 降级模板"下午工作"——"活动太死板"的直接成因之一；后台调用（记忆提取/反思/情绪分析）日志把模型 reasoning 全文当回复打印，无法看清实际解析结果——后台调用日志补"最终解析结果"一行。

---

## 四、阶段 B：AI 一日系统大更迭


### B1 数据与时间基座

#### 1.1 双后端数据层

- `src/lib/tauriBridge.ts` ailife 部分（约 L1654-1990）的每个函数改为路由：

```ts
export async function dbGetAiActivities(characterId: string) {
  if (isTauri) return invoke('db_get_ai_activities', { characterId });
  return idbGetAiActivities(characterId); // 新增 src/lib/ailifeIdb.ts
}
```

- 新增 `src/lib/ailifeIdb.ts`：按 SQLite 表结构（`db.rs:106-131` 的 ai_activities / ai_attribute_snapshots / ai_inventory / ai_economy / ai_diaries / ai_life_config 等）建 object store，唯一索引对齐（如 `ux_ai_activities_char_name_start`），写入语义对齐（INSERT OR REPLACE 等）。
- **修复启动门禁**：`dbGetAiLifeConfig` 非 Tauri fallback 从恒 `{enabled:false}` 改为读 IDB 配置（首次默认 `{enabled:false, 未初始化:true}`）；`AiLifePanel` 检测到"未初始化"时弹出引导流程（默认引导开启，用户可跳过）。
- **导出/导入**：一键导出全部生活数据为 JSON（活动/日记/库存/经济/属性/设定包），导入恢复——既是本地→Tauri 迁移通道，也是备份手段。

#### 1.2 时间模型：1x 真实时间 + 拟真补算

- 引擎 tick 保持现有分钟级（`lifeEngine.ts:157-194`）。
- **启动补算（catch-up）**：`ensureLifeEngineStarted` 启动时比对持久化的 `lastTickTime`：

```
elapsed = now - lastTickTime
if elapsed < 10min: 正常启动
elif elapsed < 3天:
  1) 小时衰减：applyHourlyDecay × hours（纯公式快进，睡眠状态按睡眠衰减率）
  2) 错过的活动：按 startTime 顺序批量结算——模板 summary（不逐个调 LLM）、
     applyActivityEffect、consumeFoodForMeal、creditDailySalary 照常执行
  3) 错过的随机事件：按概率补掷，只记录事件不生成叙事
  4) 一次 LLM 调用生成"离线日记"（汇总这段生活，第一人称补叙）
elif elapsed >= 3天:
  简化：只做 1) 衰减快进 + 4) 一份综合日记（"这几天"），不逐活动结算
```

- `lastTickTime` 每小时持久化一次（写入 IDB / SQLite 均可）。

### B2 属性与物品

#### 2.1 七维属性

- `AiLifeAttributes`（`tauriBridge.ts:1866-1875` + Rust 表）新增 `thirst`（口渴，默认 80）。
- `attributeSystem.ts`：小时衰减醒时 `thirst -4`（睡眠 -2）；新增饮水活动效果 `{thirst: +40}`；阈值 `thirst < 20 → 「有点渴了」`；`checkThresholds` 扩展口渴阈值与情绪偏移。
- UI：AiLifeDataEditor 的 ATTR_FIELDS、状态面板补口渴条。

#### 2.2 物品耐久双模型

- `ai_inventory` 表与 `AiLifeInventoryItem` 类型扩展：

```ts
interface AiLifeInventoryItem {
  // 现有字段...
  itemClass: 'consumable' | 'durable'; // 消耗品 | 耐用品
  durability?: number;   // 耐用品 0-100
}
```

- **消耗品**：按数量消耗；进食活动结束按**食谱**扣对应食材（meal 活动带 `recipe?: string[]`，如 早饭→鸡蛋×1+面包×1；喝水/饮料扣饮品并恢复口渴）——替换现有"无脑扣 2 件 food"（`attributeSystem.ts:222-245`）。
- **耐用品**：穿戴当日 -1~-2（`pickDailyOutfit` 时标记当日已穿戴），雨伞雨中使用 -5，工具按使用次数扣；`durability <= 0` → 生成"物品损坏丢弃"事件（进 B3 生活事件流），触发换新购物念头。
- 兜底：扣食材时对应食材不足 → 降级为"泡面/馒头"保底餐（饱腹 +15 而非 +35），并生成"该买菜了"念头。

#### 2.3 初始物品：条件基线 + 预算制 AI 采购

**条件基线目录**（新增 `src/services/ailife/baselineCatalog.ts`，数据驱动）：

```ts
interface BaselineItem {
  shopItemId: string;        // 必须对应 localShop.ts 目录内商品（保证闭环）
  minQuantity: number;
  conditions?: {
    gender?: 'female' | 'male';   // 性别条件（生理用品等）
    season?: ('spring'|'summer'|'autumn'|'winter')[];
    worldPackWhitelist?: string[]; // 世界包过滤（星眠的世界没有的自动剔除）
  };
}
// 分层类别：主食（大米/面粉）、粮油调味、饮用水/饮品、蔬果、
// 换洗衣物（按季节+性别）、洗漱用品、常备药品、性别必需品
```

**初始创建流程改造**（`AiLifeModals.tsx:616-760` InitialCreateModal 第三步"置办物资"）：

1. 按角色性别 + 当前季节 + 世界包条件，自动铺上基线物品（确定性，不走 LLM）。
2. 剩余预算（初始 balance 的一部分，如 30%）交给 AI：prompt 传入**商店目录**（名称/价格/类别）+ 人设 + 性别，要求在目录内自选 2~4 件个性化物品（爱钓鱼→鱼竿）；输出仅含 shopItemId 与数量，**从商店目录选，不允许编造**。
3. 校验：不在目录内的 item 直接剔除并记 debug log；预算超支自动砍单。
4. `generateInitialProfile` 的 prompt（`contentGenerator.ts:406-416`）同步传入性别字段；兜底默认清单（L394-404）改为按性别分化的两套。

### B3 念头-决策系统（LLM 参与决策）

#### 3.1 总循环

```
tick → 自监控（属性 / 库存 / 日历 / 财务 四路扫描）
     → 生成"念头"（提醒：饿了、米快没了、快迟到了、余额不足）
     → 决策（LLM 参与判定）
        ├─ 采纳 → 行动（吃饭 / 购物 / 休息）→ 物品消耗 → 状态恢复
        └─ 拖延 / 拒绝 → 状态继续恶化 → 注入念头 → 影响情绪和对话
     → 注入（短期上下文 + 每日日记沉淀长期记忆）
     → 影响（情绪基线 → 对话语气、好感增量系数、行为偏好）
```

#### 3.2 四路自监控 → 统一生活事件流

新增 `src/services/ailife/lifeEventBus.ts`：

```ts
interface LifeEvent {
  id: string; characterId: string;
  type: 'need' | 'inventory' | 'calendar' | 'finance' | 'item_broken' | 'random' | 'plan_changed' | 'chat_influence';
  severity: 1|2|3;          // 1 轻微 2 明显 3 重大
  payload: Record<string, unknown>;
  createdAt: number;
  consumedByChat?: boolean; // 是否已注入过对话
}
```

四路扫描（lifeEngine 每小时 tick，需求类每分钟检查）：
1. **属性路**：七维阈值检查（现有 checkThresholds 扩展），低于阈值产出 need 事件。
2. **库存路**：主食/饮用水余量 < 阈值 → inventory 事件；耐用品 durability < 20 → 换新念头。
3. **日历路**：结合 B6 日历层，"距上班开始 < 通勤时长 × 1.2 且尚未出门" → calendar 迟到风险事件。
4. **财务路**：余额 < 未来 7 天预估开销（日均开销 × 7）→ finance 事件（进入省钱模式）。

事件流同时是：注入的数据源（B5）、用户可见的"生活动态"时间线（按日分隔，复用 DateTimeline 视觉）。

#### 3.3 LLM 决策层

念头产生时（仅 severity ≥ 2 的念头走 LLM，轻微念头直接采纳省成本）：

```
输入（轻量模型角色）：
- 需求状态：satiety=18（阈值20），已持续 2.5 小时
- 当前情境：正在进行「加班赶方案」（22:40，预计 23:30 结束）
- 性格参数：自律度 0.35 / 节俭度 0.6 / 行动力 0.45
- 情绪基线：偏 low（loneliness 62, sadness 40）
- 选项：adopt 立即处理 / delay 推迟（15/30/60 分钟）/ refuse 不处理
输出 JSON：{ "decision": "delay", "duration": 30, "thought": "饿是饿了……但这个方案马上写完了，写完再吃" }
```

- 输出校验：decision ∈ 枚举、thought 长度 10~80 字；解析失败/超时（10s）→ 回退纯算法：

```
执行分 = 需求强度 × 自律度 × 情绪系数(0.5~1.0) × 情境系数 × (0.8~1.2 随机)
≥ 0.65 采纳 / 0.35~0.65 拖延 / < 0.35 拒绝
```

- 决策结果写回事件流（`decision` 字段），thought 进注入队列。

#### 3.4 后果链与保底

- 拖延：念头挂起，N 个 tick 后重掷，需求强度 +0.15/次（越来越难拒绝）。
- 拒绝：状态继续掉，thought 注入（影响当日情绪基线）。
- 下滑螺旋：饱腹/口渴归零 → health 每小时 -3 → health < 40 触发病假念头（强制采纳概率 ×2）→ 请假当日无薪 → 余额不足 → 购物降级（保底食物：馒头/泡面/白水，饱腹 +15）。
- **保底地板**：health < 20 → 生成 severity 3 强念头（执行分强制 ≥ 0.9：就医/吃饭/喝水），保证系统自愈、角色不死，但留下一份很惨的日记和低情绪记忆。
- **聊天反向干预**：聊天管线识别生活意图（用户说"去吃饭吧/早点睡/别买了"）→ 向事件流注入 `chat_influence` 事件，对应念头执行分强制 ≥ 0.85。识别方式：关键词规则起步（吃饭/睡觉/喝水/买菜/别熬夜等），后续可升级轻量 LLM 分类。

### B4 性格决策参数容器

- `DataOverrideConfig`（`featureModuleStore.ts:15-35`）新增：

```ts
personality?: {
  selfDiscipline: number;  // 自律度 0-1，默认 0.5
  frugality: number;       // 节俭度 0-1，默认 0.5
  actionDrive: number;     // 行动力 0-1，默认 0.5
}
```

- `dataOverrideBridge.ts` 新增 `getPersonalityFactor()`（沿用现有 6 个桥函数模式：总开关关闭时透传默认值）。
- UI：FeatureModulePage 数据覆盖容器内新增第四个 `CollapsibleSection embedded title="性格决策参数"`（与好感度/情感/记忆参数并列），复用 SliderField。
- 初始创建：`generateInitialProfile` 输出增加 `personality` 三参数（LLM 从人设推导，如"懒散"→selfDiscipline 0.3），InitialCreateModal 展示滑杆供用户确认调整后生效。

### B5 注入与影响（借鉴 Generative Agents 记忆流）

#### 5.1 生活状态卡（进聊天上下文）

并入 A6 的 `buildChatContext`（对正常聊天与主动回复统一生效）：

```
[生活状态] 现在是周五 22:40。星眠正在「加班赶方案」（已进行2.5小时，有点累 stamina 35）。
饱腹 18（有点饿，决定写完再吃）、口渴 25、情绪偏低（loneliness 62）。
今日值得注意：和用户聊了很久（+好感）、晚上没吃晚饭。
```

- 注入预算：普通事件 3~5 条；severity 3 事件（生病/翘班/计划变更）常驻；**生活状态卡总长 ≤ 300 字**。
- 记忆流排序（长期记忆检索，参考斯坦福 Generative Agents）：

```
score = recency(0.995^hoursAgo) × importance(事件权重1~10) × relevance(与当前话题关键词重合度)
```

取 top-N（默认 5）进记忆 prompt——替换/增强现有 `retrieveRelevantMemories` 的排序。

#### 5.2 每日日记与情绪基线

- 每日 23:30~24:00 由当日事件流汇总生成日记（一次 LLM 调用，现有 contentGenerator 的日记生成扩展输入源）。
- 日记写入记忆系统（importance 按 severity 映射）→ 成为长期记忆，影响之后几天的**情绪基线**：

```
情绪基线 = f(昨日事件加权情绪净值, 衰减 × 0.7/天, 当前属性)
低落日 ×0.5 ~ 开心日 ×1.2（连续区间，按净值线性映射）
```

- 情绪基线的三个出口：① 对话语气（状态卡内注明，模型自然体现）；② **好感度增量系数**（乘入 A2 计算链）；③ 行为偏好（心情差时日程生成偏向独处/散步）。

#### 5.3 生活生成 prompt 上下文补齐（用户昵称 + 记忆 + 状态）

**问题（实证）**：日记/活动文案中 AI 以泛称"用户"称呼主人（对话中的昵称完全丢失）；日记没有记忆、情绪、属性上下文。根因：主聊天管线经 `getUserPrompt()`（`userProfileStore.ts:76-91`，含 `## 你正在和谁聊天 昵称：xxx`）注入昵称，而 AI 一日的**全部生成器均未调用**——日记 prompt 甚至只有"用户"一词；活动过程 prompt 要求"可以提到用户或最近聊过的话题"却既没给昵称也没给对话上下文。

**修复**：新增公共注入函数 `buildLifeGenContext(characterId)`（建议放 `contentGenerator.ts` 导出或独立 `src/services/ailife/genContext.ts`），返回统一的"生成上下文前缀"，所有生活生成 prompt 拼接：

```ts
interface LifeGenContext {
  userPrompt: string;        // 复用 getUserPrompt()：昵称、年龄、性别、与用户的关系
  memoryPrompt: string;      // 复用聊天管线的 V2 双层记忆检索（query=今日互动内容/活动关键词）
  moodLine: string;          // 当前主导情绪 + 今日情绪基线（B5.2）
  attrLine: string;          // 七维属性快照（疲倦/饥饿等影响日记语气）
}
```

各生成器注入要求：

| 生成器 | 位置 | 注入项 |
|--------|------|--------|
| 日记 generateDiaryContent | `contentGenerator.ts:234-249` | **全部**：userPrompt + memoryPrompt + moodLine + attrLine；互动片段上限 16 条→保留但**去截断改摘要**（或升到 30 条）；要求"提到对方时使用昵称/称呼，禁止使用'用户'一词" |
| 活动过程 generateActivityProcess | `contentGenerator.ts:138-149` | userPrompt + memoryPrompt（最近聊过的话题从此有据可依） |
| 活动总结 generateActivitySummary | `contentGenerator.ts:169-175` | userPrompt + moodLine |
| 情绪转变 generateEmotionShiftPlan | `contentGenerator.ts:326-342` | userPrompt + memoryPrompt |
| 日程 generateAIPlanSchedule | `scheduleGenerator.ts:197-215` | userPrompt + memoryPrompt |
| 空闲续写 generateNextActivity | `scheduleGenerator.ts:409-415` | userPrompt + memoryPrompt |
| 初始档案 generateInitialProfile | `contentGenerator.ts:406-416` | userPrompt |

统一 prompt 规则（所有生成器末尾追加一行）：

```
[称呼规则] 提到聊天对象时，一律使用你对 TA 的称呼/昵称（如「{nickname}」），绝对不要用"用户"这个词。
```

**昵称来源增强**：`UserProfile.nickname` 为全局昵称；后续可扩展 per-character 称呼（用户在角色设置里给该角色单独定的称呼，如"主人"/"哥哥"），存 character 扩展字段，`buildLifeGenContext` 优先取角色专属称呼。聊天管线同步受益。

#### 5.4 分档人设语气（参考妹居物语）

- 好感度阶段（现有 80/60/40/20 分档）映射**语气档位**描述，注入 system prompt：

| 阶段 | 注入语气指令（示例） |
|------|---------------------|
| ≥80 恋人 | 亲密自然，会主动撒娇、提起两人的共同回忆，偶尔吃醋 |
| ≥60 挚友 | 熟络放松，开玩笑、吐槽，分享欲强 |
| ≥40 熟人 | 客气但有距离感，礼貌用词为主 |
| ≥20 认识 | 略带警惕，回复偏短，不主动展开话题 |
| <20 陌生/反感 | 冷淡、防备，可能不接话 |

（妹居物语实证：好感度分档驱动人设动态转变，是"角色随关系成长"的关键体验。）

### B6 日历与经济

#### 6.1 日历层

新增 `src/services/ailife/calendar.ts`：

```ts
interface WorkCalendar {
  workdays: number[];        // 工作日 [1,2,3,4,5]（周一=1）
  shiftStart: string;        // '09:00'
  shiftEnd: string;          // '18:00'
  commuteMinutes: number;    // 通勤时长（迟到判断提前量）
  holidays: { date: string; name: string }[]; // 法定节假日（内置2026年表 + 用户自定义）
  personalLeaveDays: string[];  // 已请假日期（事件触发后写入）
}
```

- 档案（AiLifeProfile）扩展存 calendar；初始创建 LLM 从职业推导（如"主播"→晚间班次）。
- 日程生成约束（`scheduleGenerator.ts`）：工作日→上班+通勤；周末→睡懒觉/出游/购物/宅家（活动池按性格参数加权：actionDrive 高偏出游）；节假日→特殊安排；健康 < 40 或病假 → 居家休养日程。
- **请假/翘班**：属性触发病假（B3 后果链）；LLM 主动翘班——日程生成时情绪基线很低 + actionDrive 高时小概率生成"今天不想上班"变体日程，写 `isChanged/changedFrom/changedReason`（激活现有几乎不触发的变更字段），当日无薪。
- 突发变更：引擎事件池掷中小事件（下雨/偶遇）→ 当前活动 interrupted + 变更记录。

#### 6.2 工资按日结与流水

- `activitySettlement.ts` 的 `creditDailySalary`（L61-89）正式化：每个出勤工作日 `shiftEnd` 活动结算时入账当日工资；迟到 > 30 分钟按 80% 计；请假/翘班当日无薪；加班（下班后继续工作活动）按 1.5 倍时薪补。
- **流水按日分隔**：账本 UI（AiLifeStatusPanels 经济区）按日期归组渲染，每日小计（收入/支出/结余），复用 DateTimeline 的日期分隔视觉；数据层按 `date` 索引查询。

#### 6.3 经济事件设定过滤

新增 `src/services/ailife/economyFilter.ts`——所有经济 LLM 决策（自主购物、送礼、消费）统一前置过滤：

```
硬规则（引擎判定，优先于 LLM）：
1. 送礼对象必须存在于该角色的关系图（无关系记录 → 直接禁止该类事件）
2. 世界包 taboos 命中 → 禁止
3. 余额不足 → 降级或取消
LLM 决策：仅在被过滤后的合法选项内做个性化选择
（购物/送礼 prompt 统一注入 人设 + 世界观 lore + 关系图）
```

- 星眠示例：设定包关系图中无"亲人" → 给亲人买礼物的事件从源头不存在。

#### 6.4 设定包（SettingPack）

```ts
interface SettingPack {
  id: string; name: string;
  keywords: string[];                    // 角色名/背景关键词（匹配用）
  worldLore: string;                     // 世界观
  characters: {                          // 关系图（含与主角的关系）
    name: string; relation: string; exists: boolean;
  }[];
  itemCatalogOverrides?: ShopItem[];     // 物品目录覆写/追加
  activityPool?: ActivityTemplate[];     // 专属活动池
  taboos: string[];                      // 该世界不存在/禁止的事物
}
```

- **生成**：初始创建流程允许 AI 为角色生成设定包（从人设/背景推导世界观与关系图），用户确认后入库。
- **匹配**：新角色创建时，取角色名+背景关键词与全部设定包 keywords 计分（命中数/权重），最高分 ≥ 阈值 → 弹确认对话框（避免误匹配），用户确认采用后：该角色的世界、关系图、物品目录、活动池、禁忌全部继承设定包。
- **管理**：AI 生活设置页（AiLifeDataEditor 或独立区块）手动增删改查设定包；设定包存 IDB/SQLite 双后端。

### B7 活动结构化过程

- `AiLifeActivity` 扩展（Rust 表同步加列，JSON 存储亦可）：

```ts
steps?: {
  time: number;      // 阶段时间戳
  phase: 'start' | 'mid' | 'end' | 'interrupted';
  note: string;      // 第一人称过程笔记（LLM 生成）
}[];
```

- 生成时机：活动 start 时生成 start 节点 + 计划的 mid 节点（内容留空）；进行中每小时由引擎按概率触发 mid 叙事（轻量 LLM 补写）；结束时生成 end 节点；interrupted 时记录打断点与原因。
- UI：活动卡片可展开"过程"视图（时间轴样式，与 steps 一一对应）。
- **引擎掷骰、LLM 叙事**：随机事件池（遇流浪猫/下雨忘伞/被表扬/同事分享零食…）每事件带 `weight` 与触发条件（天气/地点/属性区间/心情），引擎每小时掷骰抽事件并注入活动上下文，LLM 负责写成过程笔记——概率控制在引擎侧，确定性可调、可调试。

---

## 五、配置项汇总（功能模块）

FeatureModulePage 新增/变更的配置区块一览：

| 区块 | 配置项 | 默认值 |
|------|--------|--------|
| **Bot 接入行为**（新 ModuleSection） | mergeEnable / mergeThreshold / mergeRequireStructure / sendDebounceMs | true / 150 / true / 3000 |
| | commandEnabled / wakeupMode / wakeupPrefix | true / mention_prefix / '/' |
| | 每接入：群聊开关、私聊开关、用户/群 白名单·黑名单（QQ号/群号） | 沿用现有默认 |
| **重试策略**（新折叠区） | interceptRetryMax / retryMode / enableTemperatureRamp | 1 / rewrite / true |
| **性格决策参数**（数据覆盖容器第四折叠区） | selfDiscipline / frugality / actionDrive | 0.5 / 0.5 / 0.5 |

---

## 六、数据结构变更清单

### 前端 Store / 类型

| 位置 | 变更 |
|------|------|
| `src/store/featureModuleStore.ts` | +`BotBehaviorConfig`、+`RetryPolicyConfig`、`DataOverrideConfig` +`personality` |
| `src/store/proactiveReplyStore.ts` | +`lastProactiveKind`（接续类型轮换状态） |
| `src/store/integrationStore.ts` | `addConversation` 改 upsert（键含 group 维度） |
| `src/lib/tauriBridge.ts` | `AiLifeAttributes` +`thirst`；`AiLifeInventoryItem` +`itemClass/durability`；`AiLifeActivity` +`steps`；+`SettingPack`/`WorkCalendar`/`LifeEvent` 类型 |
| `src/agent/tools/botTools.ts` | 新文件（3 个指令工具） |

### Rust（src-tauri）

| 位置 | 变更 |
|------|------|
| `src/bot/types.rs` | NapCat 事件 +`self_id`/`sub_type` 解析 |
| `src/bot/napcat.rs` | +自身消息过滤、+messageId 去重字典 |
| `src/bot/wechat.rs` | 游标持久化读写 |
| `src/chat.rs` | 好感度 prompt ±3 约束；增量计算链 ×情绪基线系数；主动回复 req 新字段透传 |
| `src/db.rs` | ai_inventory +durability/item_class；ai_activities +steps；+setting_packs 表；+生活 lastTickTime/微信游标键值 |

### 新增文件

```
src/utils/structureDetect.ts          # 结构化内容检测
src/agent/tools/botTools.ts           # Bot 指令 Agent 工具
src/agent/slashCommand.ts             # 斜杠解析公共模块（从 InputArea 抽出）
src/services/chatContextBuilder.ts    # 统一上下文构建器（A6 核心）
src/lib/ailifeIdb.ts                  # ailife IndexedDB 双后端
src/services/ailife/lifeEventBus.ts   # 生活事件流
src/services/ailife/calendar.ts       # 日历层
src/services/ailife/economyFilter.ts  # 经济事件设定过滤
src/services/ailife/baselineCatalog.ts # 条件基线物品目录
src/services/ailife/genContext.ts     # 生活生成统一上下文（昵称+记忆+状态注入，B5.3）
```

---

## 七、实施顺序与里程碑

```
M1  Bot 基础修复          A1 合并模式 + A4 指令/群聊/黑白名单（含功能模块配置 UI）
M2  管线对齐              A6 上下文构建器收敛 + A7 重试策略改造（含流式 bug、兜底文案）
M3  Bot 收尾              A2 好感度 + A3 重启恢复 + A5 防刷屏
M4  生活基座              B1 双后端 + 补算 + B4 性格参数容器
M5  生活核心闭环          B3 念头-决策系统 + B5 注入与影响（与 A6 联动）
M6  生活内容              B2 属性/物品/初始创建 + B6 日历/经济/设定包
M7  生活过程              B7 活动结构化 + 事件池
```

每个里程碑交付均可独立验证、独立回滚（详见第九节）。

---

## 八、测试与验收方案

### 构建验证

- 前端：`npm run build`（tsc 全量类型检查）通过。
- Rust：`cargo check` 通过。

### 功能验收场景

**M1**：
- [ ] 日常短回复分段发送；带标题/列表的长结构化内容合并为一条（应用内 + Bot 平台两侧）
- [ ] 合并阈值/结构开关在功能模块调整后立即生效
- [ ] 群里非 @/非前缀消息不触发回复；@机器人 或 `/` 前缀消息正常回复且带 @发送者
- [ ] 黑名单群/用户消息不回复；白名单模式仅白名单回复
- [ ] Bot 端 `/新建对话` 新建会话、`/当前会话` 返回信息、`/帮助` 列出指令；应用内斜杠菜单同步出现
- [ ] 默认（不发指令）外部用户始终复用原会话

**M2**：
- [ ] 含引号/引用用户原话的回复不再触发"违反禁止项"误杀（forbiddenText 清洗后）
- [ ] 上屏回复保留动作括号行；无"额.../嗯..."统一前缀；句末不再出现"？吧""？呢"语病；无截断残句
- [ ] 同一条消息不再出现两条矛盾的好感度解析警告；高好感阶段增量为保底正值
- [ ] 后处理对照日志可见（原文 → 上屏，逐模块动作）
- [ ] reasoning 模型只写一遍认知（completion tokens 显著下降）
- [ ] debug log 并排对比：主动回复与正常聊天的 buildChatContext 输出同源（历史/记忆/摘要/温度一致）
- [ ] 主动回复接续上一轮话题（类型轮换：问暖→追问→转折→分享），不复述上一条
- [ ] 主动回复消息情绪标签与上文连续（不再恒为"期待"）
- [ ] 调试面板出现 proactive 筛选按钮，全链路日志可见
- [ ] 主动回复不再重复刷屏（连续触发 20 次无重复）
- [ ] 拦截触发后 debug log 显示"改写式重试 1 次"及改写前后对比
- [ ] 流式请求失败重试后消息内容不出现重复段落
- [ ] 降级文案符合角色口吻，连续触发不重复
- [ ] 重试策略配置（次数/mode/升温）在功能模块调整后生效

**M3**：
- [ ] 重启应用后已启用接入自动恢复（NapCat 重连、微信轮询自动跑）
- [ ] 重启后微信/NapCat 发消息复用原会话（不再新建）
- [ ] NapCat 开启"上报自身消息"后无自循环刷屏
- [ ] debug log 显示好感度全链路：AI选值 → 阶段因子 × 情绪基线 × 增长倍率 → 最终值

**M4~M7**：
- [ ] 浏览器模式（无 Tauri）生活引擎可启动，初始创建引导开启，数据落在 IndexedDB
- [ ] 关闭页面 1 天后重开：衰减正确补算、错过的活动批量结算、生成离线日记
- [ ] 饿/渴 → debug log 可见念头 → LLM 决策（含 thought）→ 拒绝路径状态继续掉、采纳路径插入进食活动并按食谱扣食材
- [ ] 健康 < 20 触发强制就医；下滑后可自愈
- [ ] 聊天说"去吃饭吧"后生活事件流出现 chat_influence 事件并采纳
- [ ] 初始创建：基线物品按性别/季节铺齐（含大米粮油），AI 补充物品全部来自商店目录
- [ ] 周末/节假日日程与工作日明显不同；健康低时自动病假（当日无薪）
- [ ] 工资每个出勤日入账；流水面板按日分组显示每日小计
- [ ] 设定包：创建含设定包的角色后，新角色关键词匹配弹确认，采用后送礼等经济事件受关系图过滤
- [ ] 活动/过程/日程/日记文案提到聊天对象时一律使用昵称或角色专属称呼，全文无"用户"泛称
- [ ] 日记包含当日记忆检索结果与情绪/属性上下文（疲倦、心情好坏体现在日记语气中）
- [ ] 活动卡片可展开查看 steps 过程时间轴

---

## 九、风险与回滚

| 风险 | 缓解 |
|------|------|
| A6 上下文构建器抽取引入回归（影响正常聊天主链路） | 抽取时保持 sendMessage 行为逐字段对齐；M2 交付前用 debug log 对比改造前后 process_message 入参 diff（应完全一致除新增字段） |
| LLM 决策层增加生活系统调用成本 | 仅 severity≥2 念头走 LLM；轻量模型角色；10s 超时回退算法；每日决策调用上限（默认 30 次，超限直接算法） |
| 情绪基线系数使好感度增长过慢/过快 | 系数范围锁定 0.5~1.2；功能模块预留可调节入口（沿用 affinityGrowthRate 补偿） |
| IndexedDB 与 SQLite 数据分叉 | 导出/导入 JSON 双向迁移；表结构/索引严格对齐；不做双写（一个环境只写一个后端） |
| 合并模式误判（把日常长倾诉合并） | 结构检测保守（多重特征与门限）；mergeRequireStructure 可关；debug log 记录每次判定依据 |
| 回滚 | 按里程碑独立交付：M1-M3 均为行为参数化改造，回滚 = 恢复默认配置；B 阶段新表/新文件不影响存量数据，可整模块禁用（aiLifeConfig.enabled=false） |

---

## 十、参考资料

### AstrBot（Bot 接入与上下文管理主要参考）

- [AstrBot 对话管理与上下文注入架构分析（Session/Conversation 分离）](https://blog.csdn.net/qq_45402715/article/details/161245865)
- [官方 AI 开发指南（ConversationManager / PersonaManager）](https://docs.astrbot.app/dev/star/guides/ai.html)
- [会话控制（群/私会话隔离粒度）](https://docs.astrbot.app/dev/star/guides/session-control.html)
- [FAQ：群聊唤醒词策略（@或前缀，默认 `/`）](https://docs.astrbot.app/faq.html)
- [Issue #7622：主动回复覆盖长期会话历史](https://github.com/AstrBotDevs/AstrBot/issues/7622)（A6"只读共享状态"原则的直接教训）
- [Issue #4427：长期记忆重复注入](https://github.com/AstrBotDevs/AstrBot/issues/4427)
- [Issue #5848：message_id_timestamps 去重方案](https://github.com/AstrBotDevs/AstrBot/issues/5848)

### AI 生活模拟（B 阶段参考）

- [斯坦福 Generative Agents（记忆流 recency×importance×relevance / 反思 / 计划）](https://github.com/x-glacier/GenerativeAgentsCN)——B5 记忆排序与日记反思直接借鉴
- [a16z AI Town（MIT，清晨生成日程的智能体小镇）](https://github.com/a16z-infra/ai-town)
- [WorldX（一句话生成 AI 世界、角色自主生活）](https://hub.baai.ac.cn/view/54405)
- [妹居物语好感度等级机制（九游）](https://a.9game.cn/news/11838525.html)——好感度分档驱动人设语气转变（B5.3）

---

> 本文档为本轮全部讨论的最终结论。实施时按里程碑推进，任何偏离本文档设计的改动需先更新文档再改代码。
