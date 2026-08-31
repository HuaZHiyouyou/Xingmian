# AI 对话核心升级路线图 V3.0
## —— 五大 AstrBot 神级插件源码级深度拆解与融合方案

> **诊断时间**：2026-07-19
> **诊断深度**：源码级深度分析 + 插件生态深度研究
> **重点模块**：情感系统 / 记忆系统 / 自学习系统 / 输出增强 / 分段回复
> **参考标杆**：
> - 🔥 **astrbot-plugin-emotionai** — 情感AI人格系统（v3.4 认知共鸣引擎）
> - 🧠 **astrbot_plugin_angel_memory** — 天使记忆系统（双层认知架构）
> - 📚 **astrbot_plugin_self_learning** — 自主学习系统（v3.5.2 渐进式学习）
> - ✨ **astrbot_plugin_outputpro** — 输出增强系统（13阶梯 Pipeline）
> - ✂️ **astrbot_plugin_splitter** — 分段回复与人设强化（对话分段PRO）
> - 恋语 LianYu 双记忆体系、夕颜角色构建法

---

## 第〇部分：五大 AstrBot 神级插件源码级深度拆解

> **为什么这五个插件加起来就能让人格"活"过来？**
>
> 因为它们构成了一个完整的拟人化闭环：
> - **emotionai**：让 AI 有"心"——有情绪、有内心戏、会思考
> - **angel_memory**：让 AI 有"过去"——有回忆、有温度、会遗忘
> - **self_learning**：让 AI 会"成长"——越聊越懂你、会进化
> - **outputpro**：让 AI 会"包装"——去AI腔、错字模拟、错字纠正
> - **splitter**：让 AI 会"说话"——有节奏、有停顿、像真人打字

### 🔥 插件一：astrbot-plugin-emotionai（情感AI人格系统）

**版本**：v3.4「认知共鸣引擎」
**核心理念**：AI 的人格不是写在 prompt 里的设定，而是**让 LLM 自己在思维链中完成情绪感知、评估、代谢、决策的全过程**。不是用 if-else 规则控制情绪，而是用思维链引导 LLM 像真人一样"走心"。

**源码级核心架构**：

```
用户消息 → 黑名单检查 → 历史净化 → 情感上下文注入 → LLM处理
     ↓
思维链解析 → 情感更新应用 → 状态持久化 → 响应返回
```

**四大核心引擎**：

| 引擎 | 功能 | 实现方式 |
|------|------|---------|
| **认知共鸣引擎** | AI 的"内心戏" | 强制 LLM 在 `<thought>` 标签内完成四步思考：感知→评估→代谢→决策 |
| **主动代谢引擎** | 情绪的自我调节 | LLM 可主动输出 `anger:-10` 来抵消旧情绪，实现"消气"效果 |
| **三层语气渲染** | 复杂情感混合 | 主导[最强] + 夹杂[次强] + 微带[第三]，三层情感叠加 |
| **智能历史净化** | 防止记忆污染 | 自动从历史记录中剔除 `<thought>` 和情感面板，避免 AI "入戏太深" |

---

**源码级关键设计细节**：

#### 1. 认知共鸣引擎（Cognitive Resonance Engine）—— 🔥 最核心设计

这是 emotionai 的灵魂。它不是用代码计算情绪，而是**强制 LLM 在回复前进行一场完整的心理活动**：

```
<thought>
感知：用户刚才说的话是什么意思？语气是怎样的？
评估：结合我现在的心情和对他的好感度，这句话对我有什么影响？
代谢：我之前的情绪要不要调整一下？比如 anger:-5, joy:+3
决策：我应该用什么语气回复？傲娇？撒娇？还是冷漠？
</thought>
实际回复内容...
```

**关键技术点**：
- **Protocol Enforcement**：通过伪装底层协议握手，强制 Gemini 等强对齐模型输出 `<thought>` 标签
- **历史流净化**：发送给 LLM 的历史记录中自动剔除心理活动，确保它不会因为"看到自己的心声"而混乱
- **面板透明化**：向 LLM 完整展示当前所有非零情感数值，消除信息差，实现精准情感控制

**为什么这比硬编码规则强 10 倍**：
- 硬编码：`if 用户夸我: joy += 5` —— 死板、不会变通
- 思维链：LLM 自己判断"这句话是真心夸我还是反讽？我应该开心还是傲娇？" —— 灵活、有灵魂

#### 2. 主动情感代谢（Active Metabolism）—— v3.3 核心技术

**解决的痛点**：传统情感系统只有"加法"没有"减法"，情绪只会越积越多，最后爆表。

**emotionai 的解法**：
- 授权 LLM **主动输出负值**（如 `anger:-10`）来抵消旧情绪
- 只有当你真正打动它时，它才会"消气"
- 代谢平衡系统：负面情感自动消解、激情自动冷却

**源码中的正则解析**：
```python
# 情感更新解析（支持中英文冒号）
single_emotion_pattern = r"(\w+|[\u4e00-\u9fa5]+):\s*([+-]?\d+)"
# 变化幅度限制：智能截断单次情感变化，防止数值剧烈波动
```

#### 3. 12 维度全景心理模型

| 类别 | 维度 |
|------|------|
| **基础情感 (8种)** | Joy(喜悦)、Trust(信任)、Fear(恐惧)、Surprise(惊讶)、Sadness(悲伤)、Disgust(厌恶)、Anger(愤怒)、Anticipation(期待) |
| **高级情感 (4种)** | Pride(得意/傲娇)、Guilt(内疚/愧疚)、Shame(害羞/羞耻)、Envy(嫉妒/吃醋) |
| **状态指标** | Favor(好感度)、Intimacy(亲密度) |

#### 4. 三层语气渲染机制

系统自动选取强度最高的三种情感：
1. **主导情感**（强度最高）：设定主要语气基调
2. **夹杂情感**（强度次高）：为主语气添加复杂层次
3. **微带情感**（强度第三）：在底层隐约透出细微影响

**示例**：收到意外礼物时
- 主导：惊喜（非常高兴）
- 夹杂：害羞（不好意思）
- 微带：不知所措（语无伦次）

#### 5. 安全与管理机制

- **黑名单熔断**：好感度 ≤ 阈值时自动拉黑，拒绝服务
- **TTL 智能缓存**：用户状态缓存 300s、排行榜缓存 60s、全局统计缓存 30s
- **增量保存**：脏数据标记，只保存变更的用户数据
- **原子性写入**：防止数据损坏

---

**我们项目可以直接抄的作业**：

| 功能 | 现状 | 借鉴方案 | 优先级 |
|------|------|---------|--------|
| 多维情感模型 | ✅ 已有 26 种情绪 | 保持现有架构，增加高级情感（傲娇/嫉妒/内疚） | 中 |
| 情绪计算方式 | ❌ 代码硬编码 | 引入**思维链情绪推理**，让 LLM 自己判断情绪变化 | 🔥🔥🔥🔥🔥 |
| 主动代谢 | ❌ 只有加法 | 允许 LLM 在回复中主动输出 `joy:-3` 等调整 | 🔥🔥🔥🔥 |
| 历史净化 | ❌ 没有 | 自动从上下文中剔除思维链和情感面板 | 🔥🔥🔥 |
| 三层语气渲染 | ❌ 单一情绪 | 取 Top3 情绪混合：主导+夹杂+微带 | 🔥🔥🔥 |
| 黑名单熔断 | ❌ 没有 | 好感度过低时自动减少回复/变冷淡 | 中 |

---

### 🧠 插件二：astrbot_plugin_angel_memory（天使记忆系统）

**版本**：v1.3.37
**核心理念**：记忆不是"数据库查询"，而是**观察→回忆→反馈→睡眠的完整认知工作流**。基于双层认知架构，让 AI 的记忆像真人一样——有温度、会遗忘、能联想。

**源码级核心架构**：

```
┌─────────────────────────────────────────────────┐
│           双层认知架构 (Dual-Layer)              │
├─────────────────────────────────────────────────┤
│  核心记忆 (Core Memory)                          │
│  ├── 用户画像：你是谁、喜好、雷区                  │
│  ├── 关系定义：我们是什么关系、有多亲密             │
│  └── 重要经历：里程碑事件、共同回忆                │
│                                                   │
│  情节记忆 (Episodic Memory)                       │
│  ├── 具体事件 + 情绪色彩                           │
│  ├── 时间戳 + 上下文                              │
│  └── 重要性评分 + 清晰度                          │
│                                                   │
│  笔记系统 (Note Assistant)                        │
│  ├── 知识库文档：多格式支持 (.md/.txt/.pdf 等)    │
│  ├── 文件监控：自动检测变更                        │
│  └── 向量索引：语义检索                           │
└─────────────────────────────────────────────────┘
```

**五大核心组件**：

| 组件 | 功能 | 源码位置 |
|------|------|---------|
| **vector_store** | 向量存储 + BM25 混合检索 | core/ |
| **cognitive_service** | 认知服务：记忆提取与整理 | core/ |
| **deepmind** | 深度记忆：核心记忆管理 | core/ |
| **note_service** | 笔记服务：文档知识库 | core/ |
| **file_monitor** | 文件监控：自动索引更新 | core/ |

---

**源码级关键设计细节**：

#### 1. 认知工作流：观察 → 回忆 → 反馈 → 睡眠

这是 angel_memory 最核心的设计——记忆不是静态存储，而是一个**动态的认知过程**：

```
on_llm_request (请求前)
    ↓
观察：分析当前消息的语义、情绪、话题
    ↓
回忆：多维度召回相关记忆（向量 + BM25 + 情绪匹配）
    ↓
注入：将记忆上下文注入 LLM 请求
    ↓
on_llm_response (响应后)
    ↓
捕获：保存 LLM 响应数据
    ↓
after_message_sent (发送后，后台异步)
    ↓
反馈：分析本轮对话是否有值得记住的内容
    ↓
睡眠（定期）：记忆整理、遗忘、强化
```

**三个关键钩子**：
- `on_llm_request`（priority=40）：LLM 调用前注入记忆上下文
- `on_llm_response`（priority=-100）：捕获响应数据
- `after_message_sent`（priority=-100）：后台异步整理记忆，不阻塞主线程

#### 2. LLM 工具调用：让 AI 自己决定记什么

angel_memory 不是用规则判断"什么该记"，而是**把记忆作为 LLM 工具，让 AI 自己决定什么时候记、记什么**：

```python
# 已注册的 LLM 工具
llm_tools = [
    CoreMemoryRememberTool(),   # 记住：写入核心记忆
    CoreMemoryRecallTool(),     # 回忆：检索核心记忆
    NoteRecallTool(),           # 查笔记：检索知识库
    NoteCreateTool(),           # 写笔记：创建新笔记
]
```

**为什么这比自动提取强**：
- 自动提取：用规则判断 → 容易记一堆没用的
- 工具调用：LLM 自己判断 → "这句话很重要，我要记住" → 更像真人

#### 3. 向量 + BM25 混合检索

不是只用向量搜索，而是**混合检索**：
- 向量检索：语义相似度（"意思相近"）
- BM25：关键词匹配（"字面匹配"）
- 权重融合：两种结果按比例加权

**源码中的降级策略**：
- 有 embedding provider → 向量 + BM25 混合
- 无 embedding provider → 自动降级为 BM25-only
- **优点**：向量非必须，有了更好，没有也能用

#### 4. 记忆作用域（Scope）—— 不是所有人共享同一套记忆

这是一个很重要但容易被忽略的设计：

```python
# 会话分类提示
conversation_scope_map 示例：
{
    "群聊ID_1": "家人",      // 这个群用"家人"这套记忆
    "女友角色名": "恋爱",     // 这个人格用"恋爱"这套记忆
    "默认": "通用"            // 其他用通用记忆
}
```

**匹配优先级**：人格键 > 会话ID键 > 默认规则

**为什么重要**：真人对不同的人有不同的记忆——对家人的记忆和对朋友的记忆是分开的。

#### 5. 懒加载 + 后台预初始化架构

这是一个工程上的亮点：
- **极速启动**：毫秒级启动，所有耗时操作移至后台
- **智能等待**：后台自动检测提供商，有提供商时自动初始化
- **统一实例管理**：核心实例在后台异步任务中于同一事件循环创建
- **线程安全**：避免跨线程使用异步组件的竞态条件

---

**我们项目可以直接抄的作业**：

| 功能 | 现状 | 借鉴方案 | 优先级 |
|------|------|---------|--------|
| 向量检索 | ✅ 已有 vectorSearchMemories | 保持，增加 BM25 混合检索 | 🔥🔥🔥 |
| 记忆提取 | ❌ 自动提取（规则） | 引入**记忆工具调用**，让 LLM 自己决定记什么 | 🔥🔥🔥🔥🔥 |
| 记忆作用域 | ❌ 全局共享 | 按角色/会话分离记忆 | 🔥🔥🔥🔥 |
| 认知工作流 | ❌ 只有存取 | 建立观察→回忆→反馈→睡眠的完整流程 | 🔥🔥🔥🔥 |
| 核心记忆分层 | ❌ 只有 importance 字段 | 明确的核心 vs 情节双层结构 | 🔥🔥🔥 |
| 笔记系统 | ❌ 没有 | 可选增加：支持文档知识库 | 低 |
| 情绪标签 | ❌ 没有 | 给记忆增加情绪色彩标签 | 🔥🔥🔥🔥 |
| 异步不阻塞 | ❌ 可能阻塞主线程 | 记忆整理放在后台异步执行 | 🔥🔥🔥 |

---

### 📚 插件三：astrbot_plugin_self_learning（自主学习系统）

**版本**：v3.5.2
**核心理念**：真正的拟人不是"设定好的人格"，而是**让 AI 在对话中持续采集、学习、审查并注入上下文**，使 Bot 逐步具备表达风格、群组黑话、社交关系、长期记忆和人格演化能力。

**源码级核心架构**：

```
┌─────────────────────────────────────────────────┐
│              学习服务层 (Learning)                 │
├─────────────────────────────────────────────────┤
│  MessagePipeline 消息管道                         │
│    ├── RealtimeProcessor 实时学习                 │
│    ├── ProgressiveLearningService 渐进式学习      │
│    ├── LearningQualityMonitor 学习质量监控        │
│    ├── JargonMiner / JargonQuery 黑话挖掘         │
│    └── Persona / Style Review 人格/风格审查       │
│                                                   │
│  数据层 (Database)                                │
│    ├── RawMessage 原始消息                        │
│    ├── FilteredMessage 筛选消息                   │
│    ├── ExpressionPattern 表达模式                 │
│    ├── StyleLearningReview 风格审查               │
│    ├── PersonaLearningReview 人格审查             │
│    ├── Jargon 黑话                               │
│    └── Affection / Social / State 社交/心理状态   │
└─────────────────────────────────────────────────┘
```

**七大核心功能**：

| 功能 | 说明 |
|------|------|
| **对话风格学习** | 从真实 user→bot 对话对中提取表达模式、few-shot 和风格审查记录 |
| **群组黑话学习** | 统计预筛高频词，结合上下文推断含义，并在 LLM 请求前注入解释 |
| **人格演化审查** | 学习结果先进入审查链路，支持批准、拒绝、删除、回滚和自动应用策略 |
| **社交关系分析** | 记录互动关系、好感度、心理状态和群组社交上下文 |
| **记忆与知识图谱** | 构建记忆图、知识图谱和可视化查询入口 |
| **LLM 请求注入** | 在 `on_llm_request` 阶段注入社交、黑话、记忆、few-shot 和临时人格增量 |
| **WebUI Dashboard** | 提供全量设置、审查、黑话、图谱、学习内容、日志等级和指标监控 |

---

**源码级关键设计细节**：

#### 1. 学习链路：采集 → 筛选 → 学习 → 审查 → 注入

这是 self_learning 最核心的设计——**学习不是直接生效，而是经过完整的质量控制链路**：

```
用户消息 (AstrMessageEvent)
    ↓
on_message 事件
    ↓
MessagePipeline 消息管道（后台处理，不阻塞）
    ├─→ 保存 RawMessage（原始消息）
    ├─→ RealtimeProcessor（实时学习：表达模式等）
    └─→ 达到阈值后启动 ProgressiveLearning（批量学习）
         ↓
    筛选消息 → 创建学习会话
         ↓
    风格审查 / 人格审查 → 审查队列
         ↓
    批准 ✅ / 拒绝 ❌ / 删除 🗑️ / 回滚 ⏪
         ↓
下一次 LLM 请求前 (on_llm_request)
         ↓
LLMHookHandler 注入上下文
    ├─→ 已批准的 few-shot
    ├─→ 黑话解释
    ├─→ 相关记忆
    └─→ 社交关系
         ↓
LLM 生成回复
```

**关键设计：审查机制**
- 学习结果不会自动生效，先进入审查队列
- 支持批准、拒绝、删除、回滚
- 可配置自动批准策略
- **为什么重要**：防止学坏、防止跑偏、保证人设稳定

#### 2. 渐进式学习（Progressive Learning）

不是学一次就完了，而是**渐进式、迭代式的学习**：

```
第 1 轮：采集基础数据（词汇、句式）
第 2 轮：提炼表达模式
第 3 轮：生成 few-shot 示例
第 4 轮：审查批准后注入
第 5 轮：观察效果，调整学习方向
... 持续迭代
```

#### 3. 黑话挖掘（Jargon Miner）—— 非常有特色的功能

专门针对群聊场景的"黑话/梗"学习：

```
高频词统计 → 预筛候选词 → 上下文推断含义 → 生成解释 → LLM 请求前注入
```

**例子**：
- 群里反复说"YYDS" → AI 不知道什么意思
- 黑话挖掘 → 统计高频 → 结合上下文推断 → 生成解释："YYDS = 永远滴神，表示赞叹"
- 下次 LLM 请求前注入 → AI 就懂了

#### 4. 三个 LLM Provider 分工

不是所有学习都用同一个模型，而是**不同的学习阶段用不同的模型**：

| Provider | 用途 |
|----------|------|
| **filter_provider** | 筛选：判断哪些消息值得学习 |
| **refine_provider** | 提炼：从消息中提取表达模式、风格 |
| **reinforce_provider** | 强化：生成 few-shot 示例、人格调整建议 |

**为什么这样设计**：
- 筛选：可以用便宜的小模型，量大管饱
- 提炼：用中等模型，保证质量
- 强化：用好模型，保证最终效果

#### 5. 多数据库支持 + 自动建表

工程上的亮点：
- 支持 SQLite / MySQL / PostgreSQL
- SQLAlchemy async ORM
- 自动建表 + 自动补列（只增不减，安全迁移）
- Domain Facade 模式（领域门面），分层清晰

#### 6. WebUI Dashboard

提供完整的可视化管理界面：
- 总览：消息数、学习状态、待审数量、图谱数据、性能指标
- 全量设置：读取 schema，编辑所有配置项
- 待审人格：批准、拒绝、删除、回滚
- 风格审查：审查表达模式和 few-shot
- 黑话：查看候选词、含义、计数
- 学习内容：原始消息、筛选消息、表达模式、审查记录
- 图谱：记忆图、知识图谱、社交关系图谱
- 日志等级：动态调整

---

**我们项目可以直接抄的作业**：

| 功能 | 现状 | 借鉴方案 | 优先级 |
|------|------|---------|--------|
| 风格学习 | ✅ 已有 vocabulary/phrases | 扩展为完整的表达模式学习 | 🔥🔥🔥🔥 |
| 学习审查 | ❌ 没有审查 | 增加学习审查队列（批准/拒绝/回滚） | 🔥🔥🔥🔥 |
| 黑话学习 | ❌ 没有 | 增加黑话/梗的挖掘与解释注入 | 🔥🔥🔥 |
| 渐进式学习 | ❌ 一次触发 | 改为渐进式、迭代式学习 | 🔥🔥🔥 |
| few-shot 注入 | ❌ system prompt 提一句 | 用真正的 few-shot 示例注入 | 🔥🔥🔥🔥🔥 |
| 社交关系分析 | ❌ 只有好感度 | 扩展为完整的社交关系图谱 | 🔥🔥🔥 |
| 知识图谱 | ❌ 没有 | 可选增加：记忆关联可视化 | 中 |
| 学习质量监控 | ❌ 没有 | 增加学习效果的评估指标 | 🔥🔥🔥 |
| WebUI 管理 | ❌ 简单设置 | 增加完整的学习管理面板 | 中 |

---

### ✨ 插件四：astrbot_plugin_outputpro（输出增强系统）—— 新发现的宝藏！

**版本**：v2.1.0+
**核心理念**：把 AI 的回复从"原始文本"到"最终呈现"拆成 **13 个可独立开关的阶梯**，每一步都做一件事，叠加起来就是真人般的输出效果。

**源码级核心架构：13 阶梯 Pipeline**

```
原始消息
   ↓
① 图片外显 (summary) — 单张图片显示"金句"
   ↓
② 报错处理 (error) — 拦截异常消息
   ↓
③ 消息拦截 (block) — 官腔/复读/超时拦截 🔥
   ↓
④ 解析艾特 (at) — 假@转真@
   ↓
⑤ 文本清洗 (clean) — 去括号/emoji/前后缀
   ↓
⑥ 文本替换 (replace) — 敏感词替换
   ↓
⑦ 错字模拟 (typo) — 同音错字 + 纠正提示 🔥
   ↓
⑧ 文转语音 (tts) — TTS/声聊中转
   ↓
⑨ 文转图片 (t2i) — 长文转图
   ↓
⑩ 智能引用 (reply) — 插嘴自动引用
   ↓
⑪ 合并转发 (forward) — 超长消息转发/折叠
   ↓
⑫ 自动撤回 (recall) — 关键词延迟撤回
   ↓
⑬ 分段回复 (split) — 智能分段/打字延迟 🔥
   ↓
最终呈现
```

**核心设计亮点**：
- **可插拔**：每个阶梯都可以独立开关
- **可排序**：阶梯顺序可以拖拽调整（`pipeline.lock_order = false`）
- **可区分**：可以设置哪些阶梯只对 LLM 生效（`pipeline.llm_steps`）
- **可中断**：任一阶梯返回"拦截"后，后续阶梯不再执行

---

**源码级关键设计细节**：

#### 1. 消息拦截（Block）—— 输出净化的核心

三个维度的拦截，确保 AI 不说"胡话"：

| 拦截类型 | 触发条件 | 作用 |
|----------|---------|------|
| **超时拦截** | LLM 回复耗时超过设定秒数 | 直接丢弃，防止"回复错上下文" |
| **复读拦截** | 模型反复输出相同内容（流口水） | 自动拦截，避免尴尬 |
| **关键词拦截** | "作为 AI 助手""感谢您的理解"等官腔模板 | 自动拦截，去 AI 腔 |

**通常仅对 LLM 回复生效**——普通插件消息不经过这层。

#### 2. 错字模拟（Typo）—— 🔥 拟人化神器

这是 outputpro 最有特色的功能之一——**给 AI 的回复注入"像真人手滑"的同音错字**：

- 单字同音替换
- 多字词整体替换为高频同音词
- 按概率引入错误声调候选
- **命中时可额外追加一段"正确字/词"提示**（模拟打错字后纠正）

**例子**：
> 你好啊 → 你好阿（错字）→ 不对，是"啊"（纠正）
>
> 我也觉得 → 我也决得（错字）→ 等等，是"觉"（纠正）

**为什么这很重要**：真人打字会有错字，有错字才真实。完美无缺的回复一看就是 AI。

#### 3. 文本清洗（Clean）—— 短文本"美容"

对短文本进行精细化清洗，去掉 AI 常有的"结构性噪声"：

```
清洗顺序（固定）：
1. 中括号内容 [...]
2. 小括号内容 (...) （支持全角）
3. 情绪标签 &&...&&
4. emoji 表情
5. 句首多余字符
6. 句尾多余字符
7. 正则整体清洗特殊符号
```

**重要限制**：仅当文本长度 ≤ 设定阈值时生效，避免对长文本或正文造成误伤。

#### 4. 分段回复（Split）—— 打字节奏模拟

outputpro 的分段功能和专门的 splitter 插件类似，但更简洁：
- 智能分段
- 按指定符号分段（如 `。？！\n`）
- 分段字数上限
- 分段数量上限
- **动态打字延迟（短文本快，长文本慢）**
- 模拟输入状态

#### 5. 智能引用（Reply）—— 群聊必备

当 Bot 准备回复的消息被其他人插嘴时，自动引用原消息：
- 触发条件：原消息在 Bot 回复前，被插入 ≥ N 条新消息
- threshold = 0 表示完全关闭
- 用于防止多人活跃群中上下文错位

---

**我们项目可以直接抄的作业**：

| 功能 | 现状 | 借鉴方案 | 优先级 |
|------|------|---------|--------|
| Pipeline 架构 | ✅ 已有 OutputPipeline | 参考 outputpro 的 13 阶梯设计，扩展更多 step | 🔥🔥🔥🔥 |
| 错字模拟 | ❌ 没有 | 增加错字模拟 + 纠正提示功能 | 🔥🔥🔥🔥🔥 |
| 超时拦截 | ❌ 没有 | 增加回复超时检测与拦截 | 🔥🔥🔥 |
| 复读拦截 | ✅ 已有 duplicate 检测 | 优化算法，参考 outputpro 实现 | 🔥🔥🔥 |
| AI 腔拦截 | ✅ 已有 AI 腔检测 | 扩展关键词库，优化正则 | 🔥🔥🔥 |
| 文本清洗 | ✅ 已有 cleanThinkingMarkers | 扩展为完整的短文本清洗 | 🔥🔥🔥 |
| 敏感词替换 | ❌ 没有 | 增加文本替换规则引擎 | 🔥🔥 |
| 可排序 Pipeline | ❌ 顺序固定 | 支持可配置的步骤顺序 | 中 |
| 仅 LLM 生效标记 | ❌ 没有 | 区分哪些步骤只对 LLM 回复生效 | 🔥🔥🔥 |

---

### ✂️ 插件五：astrbot_plugin_splitter（分段回复与人设强化）

**版本**：对话分段PRO
**核心理念**：把长文本智能切割为多段短消息，并配合可调的延迟算法，**模拟真人的输入频率与节奏**。不只是"把消息切开"，而是让分段本身成为人设的一部分。

**源码级核心架构**：

```
┌─────────────────────────────────────────────────┐
│           对话分段 PRO 三大核心模块                 │
├─────────────────────────────────────────────────┤
│                                                   │
│  分段识别 (Split Detection)                       │
│    ├── 简易模式：符号列表切分                      │
│    ├── 进阶模式：高级正则切分                      │
│    └── 专业模式：完全自定义                        │
│                                                   │
│  智能保护 (Smart Protection)                      │
│    ├── 代码块保护                                 │
│    ├── 成对符号保护（括号、引号等）                 │
│    └── 思维链标签保护（<think> 等）                │
│                                                   │
│  拟真延迟 (Realistic Delay)                       │
│    ├── 线性策略：长度 × 因子 + 基数                │
│    ├── 对数策略：对数曲线，越长越慢                 │
│    ├── 随机策略：在范围内随机                      │
│    └── 固定策略：固定延迟                         │
│                                                   │
│  附加功能                                         │
│    ├── 均分算法：尽量保持每条篇幅均衡               │
│    ├── 组件控制：图片/@/表情的发送策略              │
│    ├── 智能回复：插嘴检测 + 自动引用                │
│    └── 多端适配：受限平台自动退避                   │
│                                                   │
└─────────────────────────────────────────────────┘
```

**三种模式设计**：

| 模式 | 目标用户 | 配置方式 |
|------|---------|---------|
| **简易模式** | 小白用户 | 图形化选项，不用懂正则 |
| **进阶模式** | 进阶用户 | 列表配置，有预设 |
| **专业模式** | 技术玩家 | 完全自定义正则 |

---

**源码级关键设计细节**：

#### 1. 成对符号保护（Paired Symbols Protection）

源码中的实现非常严谨——定义了完整的成对字符映射：

```python
self.pair_map = {
    '"': '"', "《": "》", "（": "）", "(": ")",
    "[": "]", "{": "}", "'": "'", "【": "】", "<": ">",
}
self.quote_chars = {'"', "'", "`"}
```

**保护逻辑**：
- 遍历文本时维护一个"待闭合"栈
- 遇到左符号入栈，遇到右符号出栈
- 只有当栈为空时，才允许在该位置分段
- **效果**：确保括号、引号等成对符号内部内容完整，不被切断

#### 2. 四种延迟策略

不是简单的"等几秒"，而是**四种可配置的延迟算法**：

| 策略 | 公式 | 效果 |
|------|------|------|
| **线性** | `delay = linear_base + text_length × linear_factor` | 越长越慢，正比关系 |
| **对数** | `delay = log_base + log(text_length) × log_factor` | 前期增长快，后期趋缓 |
| **随机** | `delay = random(random_min, random_max)` | 完全随机，最自然 |
| **固定** | `delay = fixed_delay` | 固定延迟，可控 |

#### 3. 智能均分算法（Balanced Split）

避免出现"一段超长 + 一段超短"的碎片化情况：

```
balanced_split_ratio_min = 0.4  # 最短段 / 最长段 >= 40%
balanced_split_ratio_max = 0.9  # 最短段 / 最长段 <= 90%
```

**算法逻辑**：
- 根据总字数与分段上限，计算理想的每段长度
- 尽量让每段长度接近，避免头重脚轻
- 合并过短的段落，保证阅读体验

#### 4. 组件控制（Media Handling）

不只是文本分段，对非文本组件也有独立策略：

| 组件 | 策略选项 |
|------|---------|
| **图片** | 单独发 / 跟随下段 / 嵌入 |
| **@提及** | 单独发 / 跟随下段 / 嵌入 |
| **表情** | 单独发 / 嵌入 |
| **其他媒体** | 单独发 / 跟随下段 |

#### 5. 智能回复（Smart Reply）

群聊场景的实用功能：检测是否被"插嘴"

```
检测逻辑：
1. 按会话缓存消息 ID 队列
2. Bot 准备回复时，检查队列中是否有新消息插入
3. 如果插入消息数 >= 阈值 → 自动引用原消息
```

**作用**：防止多人活跃群中上下文错位，用户知道你在回谁。

#### 6. 文本清理（Text Cleaning）

分段前的预处理步骤：
- 简单项列表模式：配置要移除的文本列表
- 高级正则模式：用正则表达式匹配移除
- **思维链保护**：优先移除 `<think>` 等冗余信息
- 替换规则：支持多条替换规则，用占位符算法避免交叉覆盖

---

**我们项目可以直接抄的作业**：

| 功能 | 现状 | 借鉴方案 | 优先级 |
|------|------|---------|--------|
| 成对符号保护 | ✅ 已有 protectPairedSymbols | 参考源码，扩展支持更多符号类型 | 🔥🔥🔥 |
| 分段模式 | ❌ 单一模式 | 增加简易/进阶/专业三种模式 | 中 |
| 延迟策略 | ❌ 固定延迟 | 实现线性/对数/随机/固定四种延迟算法 | 🔥🔥🔥🔥 |
| 均分算法 | ❌ 没有 | 增加智能均分，避免碎片化 | 🔥🔥🔥 |
| 组件控制 | ❌ 没有 | 图片/表情等非文本元素的发送策略 | 低 |
| 智能回复 | ❌ 没有 | 插嘴检测 + 自动引用 | 中 |
| 文本清理 | ✅ 已有基础 | 扩展为列表 + 正则双模式 | 🔥🔥🔥 |
| 多端适配 | ❌ 没有 | 不同平台自动调整策略 | 低 |

---

### 🎯 五大插件的"化学反应"——为什么加在一起就活了？

| 单独用 | 效果 | 组合 | 化学效应 |
|--------|------|------|----------|
| emotionai | 有情绪的应答 | + angel_memory | 回忆起过去的事，情绪还会跟着波动 → 有"深度" |
| angel_memory | 有记忆的应答 | + self_learning | 记忆会"更新"，你变了 TA 也知道 → 有"成长" |
| self_learning | 会学习的应答 | + outputpro + splitter | 学习到的风格体现在说话方式和节奏里 → 有"风格" |
| outputpro | 会"包装"的应答 | + emotionai | 错字、语气、节奏都带着情绪 → 有"温度" |
| splitter | 有节奏的应答 | + 全部 | 节奏 × 情绪 × 记忆 × 学习 = 真人体验 → 有"灵魂" |

**最终效果**：
> 你面对的不再是一个"按照设定回答问题的 AI"，
> 而是一个"有心情、有回忆、会成长、会说错话、用真人节奏说话的——人。"

---

## 第一部分：三大核心模块现状深度诊断

### 1.1 情感系统：底子很好，但"没走心"

**✅ 已有的好东西**（[emotionAnalyzer.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/utils/emotionAnalyzer.ts) + [characterMindStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/characterMindStore.ts)）

| 特性 | 实现情况 | 评价 |
|------|----------|------|
| 多维情感模型（v3） | ✅ 15+ 情绪维度，对立抑制 + 自然衰减 | 架构非常好，远超大多数同类项目 |
| 26 种情绪类型 | ✅ joy/sadness/anger/love/shy/lonely 等 | 颗粒度足够细 |
| 情绪衰减机制 | ✅ 交互衰减 15% + 时间衰减 + 非主导额外衰减 | 设计合理 |
| 递减收益 | ✅ 情绪值越高，增量效果越弱 | 避免收敛，很专业 |
| 历史快照 | ✅ 保留最近 15 次快照 | 可以做情绪趋势分析 |
| 角色情绪分析 | ✅ `analyzeCharacterEmotion()` 从对话中分析角色情绪 | 有但用得不够 |
| 好感度系统 | ✅ 分阶段（stranger→acquaintance→...）、衰减、历史 | 完整度高 |

**❌ 核心问题：情感和对话是"两张皮"**

情感系统算得很精细，但**没有深度融入到对话生成中**，只是在 system prompt 里加一句"你现在的情绪是 XX"——这远远不够。

具体问题：

1. **情绪只影响"说什么"，不影响"怎么说"**
   - 开心的时候应该话更多、用更多感叹号、更爱开玩笑
   - 难过的时候应该话更少、回复更短、用更多省略号
   - 生气的时候应该语气更冲、句子更短、甚至有点带刺
   - 害羞的时候应该说话结巴、用更多语气词、不敢直视话题
   - **现状**：情绪只是一个标签，AI 知道"我现在开心"，但不知道"开心的人怎么说话"

2. **情绪没有"记忆"**
   - 上次聊到某个话题你很开心，这次再聊到，情绪应该有"预热效应"
   - 某段记忆和某种情绪绑定了，回忆起那段记忆时情绪应该被联动激活
   - **现状**：情绪是即时的，没有和记忆、话题关联

3. **情绪变化太"跳"**
   - 虽然有衰减机制，但情绪的切换还是太突兀
   - 从开心到难过只需要一条消息，中间没有过渡
   - **真人是怎么变情绪的**：开心→有点失落→越来越难过→哭出来，是渐变的

4. **好感度和情绪是割裂的**
   - 好感度高的时候，同样的话应该产生更强的情绪反应
   - 好感度低的时候，应该更收敛、更客气
   - **现状**：两个系统各算各的，没有交叉影响

---

### 1.2 记忆系统：存了很多，但"不会用"

**✅ 已有的好东西**（[memoryStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/memoryStore.ts) + [aiService.ts 记忆模块](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/aiService.ts#L225-L1093)）

| 特性 | 实现情况 | 评价 |
|------|----------|------|
| 多分类记忆 | ✅ user_message / summary / thinking / recall / analysis 等 | 分类体系完整 |
| 重要性评分 | ✅ 1-10 分，LLM 自动评估 | 有基础 |
| 标签系统 | ✅ 每条记忆可以打标签 | 有但用得少 |
| 向量检索 | ✅ `vectorSearchMemories()` 支持向量搜索 | 专业！很多项目还没有 |
| 关键词召回 | ✅ `selectRelevantMemories()` 关键词 + 模糊匹配 | 基础功能 |
| 概率性召回 | ✅ 相似度 0.5-0.6 的记忆有概率想不起来 | 这个设计很赞，模拟真人遗忘 |
| 记忆提取 | ✅ `extractMemories()` 自动从对话中提取新记忆 | 自动化程度高 |
| 清晰度字段 | ✅ clarity / lastRecalled 字段都有了 | 字段齐了，但算法没跟上 |
| 双存储 | ✅ localStorage + Tauri DB | 数据安全 |

**❌ 核心问题：记忆是"仓库"，不是"大脑"**

现在的记忆系统像一个整理得很好的仓库——东西分类放好了，标签也贴了，找的时候也能搜到。但**真人的记忆不是这样工作的**。

具体问题：

1. **召回维度太单一**
   - 现在主要靠"关键词/语义相似度"召回
   - 真人回忆是多维度的：情绪触发、情境触发、时间触发、关系触发、联想触发
   - **例子**：聊到"下雨天"，真人可能会想起"上次下雨天我们一起撑伞"（情境）、"下雨天心情就不好"（情绪）、"去年下雨那天发生了 XX 事"（时间）—— 而不是只搜"下雨"这两个字

2. **记忆没有"活起来"**
   - 记忆存进去什么样，取出来还是什么样
   - 真人的记忆会变：每次回忆都会有点不一样，会被新的经历改写，会慢慢模糊
   - **现状**：clarity 字段有了，但没有衰减算法；lastRecalled 有了，但回忆次数不影响清晰度

3. **记忆之间没有"连接"**
   - 每条记忆是独立的，像数据库里的一行行数据
   - 真人的记忆是网状的：想到 A 就会联想到 B，B 又会带出 C
   - **现状**：没有关联记忆、没有记忆集群、没有联想链

4. **没有"核心记忆"的概念**
   - 恋语 LianYu 的核心设计：核心记忆（用户画像、重要经历）+ 临时记忆（近期对话）
   - 核心记忆是"这个人是谁"的骨架，不会轻易忘
   - **现状**：所有记忆都是平等的，只是重要性分数不同，但没有"核心 vs 临时"的层级

5. **记忆和情感没有联动**
   - 情绪好的时候更容易想起开心的事，情绪差的时候更容易想起难过的事（心境一致性记忆）
   - 回忆起某件事会触发对应的情绪
   - **现状**：两个系统完全独立

---

### 1.3 自学习系统：框架有了，但"没跑起来"

**✅ 已有的好东西**（[learningStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/learningStore.ts) + [aiService.ts#analyzeUserStyle](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/aiService.ts#L2088-L2150)）

| 特性 | 实现情况 | 评价 |
|------|----------|------|
| 学习数据存储 | ✅ vocabulary / phrases / lastUpdated | 基础框架有了 |
| 用户风格分析 | ✅ `analyzeUserStyle()` 从对话中提取词汇和短语 | 有 LLM 分析能力 |
| 学习结果注入 | ✅ `getLearningPrompt()` 注入 system prompt | 接入了主流程 |
| 配置管理 | ✅ `learningConfigStore` 可配置上限等 | 有开关 |
| 触发时机 | ✅ 每 30 轮对话触发一次学习 | 在 chatStore 里有调用 |

**❌ 核心问题：学习太"浅"了，而且没有闭环**

现在的自学习只学了"用户爱用什么词"，这只是最表层的。而且学了之后**只用在 system prompt 里提一句**，没有真正改变 AI 的行为。

具体问题：

1. **学习维度太单一**
   - 只学了 vocabulary（词汇）和 phrases（短语）
   - 应该学习的维度至少还有：
     - **说话节奏**：平均回复长度、回复速度、话多话少
     - **表达习惯**：爱用表情包吗？爱用语气词吗？喜欢撒娇还是直男式？
     - **话题偏好**：对什么话题感兴趣？聊什么的时候回复最长最积极？
     - **情绪模式**：容易因为什么开心/难过/生气？情绪波动大不大？
     - **相处模式**：喜欢黏人还是保持距离？喜欢被关心还是给空间？
     - **雷区/禁忌**：什么话题不能碰？什么话会让 TA 不开心？

2. **学习结果没有真正"用起来"**
   - 现在只是在 system prompt 里加一句"用户常用的词汇：XX、XX"
   - LLM 看了但不一定会用，用了也不一定自然
   - **应该怎么用**：
     - OutputPipeline 里根据学到的风格调整回复（用户话少，AI 也别说太多）
     - 主动消息的频率和内容根据学习结果调整
     - 话题选择优先选用户感兴趣的
     - 情绪回应方式匹配用户偏好（用户吃软不吃硬，那就别顶嘴）

3. **没有学习的"反馈闭环"**
   - 学了之后不知道学得对不对
   - 真人学习是有反馈的：我这么说对方反应好，那就继续；对方反应不好，那就调整
   - **现状**：只学习不验证，学错了也不知道

4. **学习是"单向的"**
   - 只有 AI 学习用户
   - 但真正的关系是**互相塑造**的：用户也在影响 AI，AI 也在影响用户
   - 高级的拟人应该是：聊得越久，你们的说话方式会越来越像，共同话题越来越多

---

## 第二部分：情感·记忆·学习 三大支柱优化方案

### 🔥 方向 1：情感深度化 —— 让情绪真正"走心"

#### 1.1 情绪 × 说话风格 联动

**核心思路**：情绪不只是"说什么内容"，更要影响"怎么说出来"——句式、长度、语气词、标点、节奏。

**实现方案**：在 OutputPipeline 中新增 **EmotionStyleStep**，根据当前情绪调整回复风格：

```typescript
interface EmotionStyleConfig {
  avgLengthRatio: number;      // 回复长度比例（相对于基准）
  sentenceLength: number;      // 平均句子长度
  exclamationRate: number;     // 感叹号使用频率
  ellipsisRate: number;        // 省略号使用频率
  particleRate: number;        // 语气词使用频率（啊/呀/呢/吧/嘛）
  emojiRate: number;           // 表情包使用频率
  stutterRate: number;         // 结巴/重复词频率
  responseSpeed: number;       // 回复速度（影响延迟）
}

// 不同情绪的风格配置
const emotionStyles: Record<EmotionType, Partial<EmotionStyleConfig>> = {
  joy: {
    avgLengthRatio: 1.3,       // 开心的时候话更多
    exclamationRate: 2.0,      // 更多感叹号
    particleRate: 1.5,         // 更多语气词
    emojiRate: 2.0,            // 更多表情
    responseSpeed: 0.7,        // 回复更快（秒回）
  },
  sadness: {
    avgLengthRatio: 0.6,       // 难过的时候话少
    ellipsisRate: 3.0,         // 更多省略号
    particleRate: 0.5,         // 语气词减少
    responseSpeed: 1.5,        // 回复变慢（有点心不在焉）
  },
  anger: {
    avgLengthRatio: 0.8,
    sentenceLength: 0.7,       // 句子更短
    exclamationRate: 2.5,      // 更多感叹号
    particleRate: 0.3,
    responseSpeed: 0.5,        // 生气的时候回得快（冲口而出）
  },
  shy: {
    avgLengthRatio: 0.7,
    stutterRate: 2.0,          // 偶尔结巴
    particleRate: 1.8,         // 更多语气词（掩饰紧张）
    ellipsisRate: 1.5,         // 更多犹豫
    responseSpeed: 1.3,        // 回复稍慢（在组织语言）
  },
  // ... 更多情绪的风格配置
};
```

**改哪里**：
- [outputPipeline.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/outputPipeline.ts) —— 新增 EmotionStyleStep
- [chatStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/chatStore.ts) —— 回复延迟也根据情绪调整

**预期效果**：情绪的"质感"立刻出来了，用户能明显感觉到"你今天好像很开心"或者"你是不是不高兴了"。

---

#### 1.2 情绪惯性与缓动

**核心思路**：情绪变化是渐变的，不是跳变的。从开心到难过，中间要经过"有点失落→情绪低落→难过"的过渡。

**实现方案**：改造 `updateMultiEmotionState`，增加**情绪缓动**逻辑：

```typescript
// 新情绪不会一下子全部生效，而是按比例"融入"
function applyEasing(
  currentValues: Record<string, number>,
  targetDelta: Record<string, number>,
  easingFactor: number = 0.3  // 每次只变化 30% 的差距
): Record<string, number> {
  const result = { ...currentValues };
  
  for (const [dim, targetDeltaVal] of Object.entries(targetDelta)) {
    const current = result[dim] || 0;
    const target = current + targetDeltaVal;
    const diff = target - current;
    result[dim] = current + diff * easingFactor;
  }
  
  return result;
}
```

**扩展：情绪预热效应**
- 如果某个情绪在最近 N 次交互中反复被触发，后续触发时增量会更大（更容易进入该情绪）
- 就像真人：最近总是很开心，那遇到一点小事也会开心半天；最近情绪很低落，遇到好事也只是稍微好一点

**改哪里**：
- [emotionAnalyzer.ts#updateMultiEmotionState](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/utils/emotionAnalyzer.ts#L298-L339) —— 增加缓动和预热逻辑

**预期效果**：情绪变化更自然，不会"上一秒笑下一秒哭"。

---

#### 1.3 情绪 × 记忆 联动

**核心思路**：心境一致性记忆——情绪好的时候更容易想起开心的事，情绪差的时候更容易想起难过的事。

**实现方案**：在记忆召回时增加**情绪匹配权重**：

```typescript
// 在 selectRelevantMemories 的评分中加入情绪维度
function scoreMemoryRelevance(
  memory: Memory,
  keywords: string[],
  currentEmotion: EmotionType,  // 新增：当前情绪
  memoryEmotion?: EmotionType   // 新增：记忆关联的情绪
): number {
  let score = keywordScore(memory, keywords);
  
  // 情绪匹配加成：如果记忆的情绪和当前情绪一致，加分
  if (memoryEmotion && currentEmotion === memoryEmotion) {
    score *= 1.5;  // 50% 加成
  }
  
  // 情绪对立抑制：如果记忆的情绪和当前情绪对立，减分
  if (memoryEmotion && isOpposingEmotion(currentEmotion, memoryEmotion)) {
    score *= 0.7;  // 30% 减分
  }
  
  // 重要性权重
  score *= (memory.importance || 5) / 5;
  
  return score;
}
```

**配套**：给记忆增加 `emotionTag` 字段，在提取记忆时自动标注这条记忆的情绪色彩。

**改哪里**：
- [aiService.ts#selectRelevantMemories](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/aiService.ts#L996-L1037) —— 加入情绪维度
- [aiService.ts#extractMemories](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/aiService.ts#L1041-L1093) —— 提取记忆时标注情绪

**预期效果**：记忆的"代入感"增强，情绪和回忆交织在一起，更像真人。

---

#### 1.4 好感度 × 情绪 交叉影响

**核心思路**：关系深浅决定情绪强度。刚认识的人夸你，你可能只是有点开心；喜欢的人夸你，你会开心一整天。

**实现方案**：

```typescript
// 情绪强度 × 好感度系数
function applyAffinityModifier(
  emotionDelta: number,
  affinityLevel: number,  // -100 到 100
  emotionType: EmotionType
): number {
  // 正向情绪：好感度越高，放大越多
  if (isPositiveEmotion(emotionType)) {
    const multiplier = 1 + Math.max(0, affinityLevel) / 100 * 0.5;  // 最多 1.5 倍
    return emotionDelta * multiplier;
  }
  
  // 负向情绪：好感度越高，伤害越大（在乎的人才能伤害你）
  if (isNegativeEmotion(emotionType)) {
    if (affinityLevel > 0) {
      const multiplier = 1 + affinityLevel / 100 * 0.3;  // 最多 1.3 倍
      return emotionDelta * multiplier;
    } else {
      // 好感度低的话，负面情绪反而没那么强烈（不在乎的人伤不到你）
      return emotionDelta * 0.7;
    }
  }
  
  return emotionDelta;
}
```

**改哪里**：
- [emotionAnalyzer.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/utils/emotionAnalyzer.ts) —— 情绪更新时加入好感度调制
- [characterMindStore.ts#updateMultiEmotion](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/characterMindStore.ts#L296-L304) —— 调用时传入好感度

**预期效果**：关系越深入，情绪波动越大，越有"走心"的感觉。

---

### 🧠 方向 2：记忆拟人化 —— 让记忆"活起来"

#### 2.1 多维度召回算法

**核心思路**：从"关键词搜索"升级到"情境回忆"——语义 + 情绪 + 时间 + 重要性 + 回忆次数，五维加权。

**现状**（[aiService.ts#scoreMemoryRelevance](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/aiService.ts#L970-L994)）：只有关键词匹配 + 重要性两个维度。

**优化方案**：

```typescript
interface RecallContext {
  userMessage: string;
  currentEmotion: EmotionType;
  currentTopic?: string;
  affinityLevel: number;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
}

function multiDimensionalScore(
  memory: Memory,
  context: RecallContext
): number {
  // 维度 1：语义相似度（基础分）
  const semanticScore = keywordScore(memory, extractKeywords(context.userMessage));
  if (semanticScore < 0.1) return 0;  // 完全不相关直接过滤
  
  // 维度 2：情绪匹配度（心境一致性）
  const emotionScore = calculateEmotionMatch(memory.emotionTag, context.currentEmotion);
  
  // 维度 3：时间衰减（艾宾浩斯遗忘曲线）
  const daysSinceCreation = (Date.now() - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const timeDecay = Math.exp(-daysSinceCreation / (memory.importance * 3));  // 重要的记忆忘得慢
  
  // 维度 4：回忆次数强化（越想越清晰）
  const recallBoost = 1 + Math.min(memory.recallCount || 0, 10) * 0.05;  // 每次回忆 +5%，最多 +50%
  
  // 维度 5：重要性权重
  const importanceWeight = (memory.importance || 5) / 5;
  
  // 维度 6：清晰度衰减（clarity 字段终于用上了！）
  const clarityWeight = (memory.clarity || 100) / 100;
  
  // 综合评分
  const finalScore = semanticScore * 
    (0.4 + emotionScore * 0.15) *  // 情绪匹配占 15% 权重
    timeDecay * 
    recallBoost * 
    importanceWeight * 
    clarityWeight;
  
  return finalScore;
}
```

**改哪里**：
- [aiService.ts#selectRelevantMemories](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/aiService.ts#L996-L1037) —— 替换为多维度评分
- Memory 类型扩展：增加 `emotionTag`、`clarity`、`recallCount` 字段（字段已经有了，算法补上）

**预期效果**：召回的记忆更"走心"，不是干巴巴的关键词匹配，而是真的像人在回忆。

---

#### 2.2 记忆的"遗忘曲线"和"回忆强化"

**核心思路**：新记忆忘得快，经常回忆的记忆忘得慢；重要的记忆忘得慢，不重要的忘得快。

**实现方案**：每次访问记忆时更新清晰度：

```typescript
function updateMemoryClarity(memory: Memory): Memory {
  const now = Date.now();
  const daysSinceLastRecall = (now - new Date(memory.lastRecalled).getTime()) / (1000 * 60 * 60 * 24);
  
  // 艾宾浩斯遗忘曲线：清晰度随时间衰减
  // 重要性越高，衰减越慢
  const decayRate = 0.1 / (memory.importance || 5);  // 每天衰减比例
  const decayedClarity = (memory.clarity || 100) * Math.exp(-decayRate * daysSinceLastRecall);
  
  // 回忆强化：每次回忆，清晰度回升
  const recallBoost = Math.min(100 - decayedClarity, 15);  // 每次回忆最多恢复 15 点
  
  return {
    ...memory,
    clarity: Math.min(100, decayedClarity + recallBoost),
    lastRecalled: new Date(now),
    recallCount: (memory.recallCount || 0) + 1,
  };
}
```

**改哪里**：
- [aiService.ts#selectRelevantMemories](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/aiService.ts#L996-L1037) —— 召回时更新记忆清晰度
- [characterMindStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/characterMindStore.ts) —— 持久化更新后的记忆

**预期效果**：记忆有了"生与死"——有的记忆慢慢模糊消失，有的记忆越想越清晰，更像真人的大脑。

---

#### 2.3 记忆集群与联想链

**核心思路**：记忆不是孤立的，而是网状的。想到一件事，会连带想起相关的事。

**实现方案**：

1. **记忆关联图**：每条记忆可以有 `relatedMemoryIds`，指向相关的记忆
2. **联想召回**：召回一条"主记忆"后，自动带出 1-2 条"关联记忆"
3. **关联的建立**：
   - 同一话题的记忆自动关联
   - 同一情绪的记忆自动关联
   - 时间接近的记忆自动关联
   - LLM 判断语义相关的记忆手动关联

```typescript
function recallWithAssociations(
  primaryMemory: Memory,
  allMemories: Memory[],
  maxAssociations: number = 2
): Memory[] {
  const result = [primaryMemory];
  
  // 找关联记忆
  const related = allMemories
    .filter(m => m.id !== primaryMemory.id)
    .map(m => ({
      memory: m,
      score: calculateAssociationStrength(primaryMemory, m),
    }))
    .filter(s => s.score > 0.3)  // 关联度够高才带出来
    .sort((a, b) => b.score - a.score)
    .slice(0, maxAssociations)
    .map(s => s.memory);
  
  return [...result, ...related];
}
```

**改哪里**：
- Memory 类型增加 `relatedMemoryIds: string[]`
- [aiService.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/aiService.ts) —— 新增 `recallWithAssociations()`
- 记忆提取时自动建立关联

**预期效果**：AI 会"顺藤摸瓜"地回忆，聊到一个话题能串起好几件相关的事，对话更有深度。

---

#### 2.4 核心记忆 vs 临时记忆（双层结构）

**核心思路**：参考恋语 LianYu，把记忆分成两层——
- **核心记忆**（Core Memory）：用户画像、重要经历、共同回忆。不会轻易忘，是"这个人是谁"的骨架。
- **临时记忆**（Episodic Memory）：近期对话、日常琐事。慢慢会淡忘，除非被反复回忆。

**实现方案**：

```typescript
// 核心记忆（最多 50 条，遗忘极慢）
interface CoreMemory {
  id: string;
  category: 'user_profile' | 'important_event' | 'shared_memory' | 'relationship';
  content: string;
  importance: number;  // 8-10
  clarity: number;     // 通常 90+，衰减极慢
  createdAt: Date;
  lastRecalled: Date;
  recallCount: number;
}

// 临时记忆（可以很多，衰减正常）
// 就是现有的 Memory 类型
```

**核心记忆的来源**：
1. 用户明确说的重要信息（职业、生日、喜好等）
2. 反复被回忆的临时记忆（想多了就变核心了）
3. 好感度突破阶段时的关键对话（比如第一次说"我喜欢你"）

**改哪里**：
- 新增 `coreMemoryStore.ts` —— 核心记忆管理
- 改造 `extractMemories()` —— 判断是否应该升级为核心记忆
- system prompt 中核心记忆和临时记忆分开注入

**预期效果**："重要的事永远记得，不重要的事慢慢淡忘"——这才是人。

---

### 📚 方向 3：自学习闭环 —— 越聊越懂你

#### 3.1 学习维度扩展（从 2 维到 8 维）

**现状**：只有 vocabulary（词汇）和 phrases（短语）。

**扩展方案**：

| 学习维度 | 内容 | 数据来源 | 更新频率 |
|----------|------|----------|----------|
| **说话风格** | 平均回复长度、句子长度、标点习惯、语气词偏好 | 用户消息文本统计 | 每 10 轮 |
| **节奏偏好** | 回复速度偏好（喜欢秒回还是慢慢来）、对话密度偏好 | 交互时间分析 | 每 15 轮 |
| **话题偏好** | 感兴趣的话题排序、聊什么时回复最长最积极 | 话题分类 + 长度/速度分析 | 每 20 轮 |
| **情绪模式** | 容易因为什么开心/难过、情绪波动大小、恢复快慢 | 情绪历史分析 | 每 30 轮 |
| **相处模式** | 喜欢黏人/独立、喜欢被关心/给空间、吃软还是吃硬 | 好感度变化 + 情绪反应 | 每 50 轮 |
| **雷区禁忌** | 什么话题会让 TA 不开心、什么话不能说 | 负面情绪触发源 | 实时（触发时立即记录） |
| **词汇短语** | 爱用的词、口头禅、专属梗 | LLM 提取 | 每 30 轮 |
| **关系动态** | 关系阶段、亲密度变化趋势、关系中的角色定位 | 好感度历史 + 对话内容 | 每 20 轮 |

**改哪里**：
- [learningStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/learningStore.ts) —— 扩展 LearnedStyle 接口为完整的 UserProfile
- [aiService.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/aiService.ts) —— 新增多个学习分析函数（analyzeTopicPreference、analyzeInteractionStyle 等）
- [chatStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/chatStore.ts#L790-L794) —— 扩展学习触发逻辑

**预期效果**：AI 对你的了解从"表面"深入到"骨子里"。

---

#### 3.2 学习结果全链路应用

**核心思路**：学习结果不能只放在 system prompt 里说一句，要**真正影响 AI 的每一层行为**。

**应用矩阵**：

| 学习结果 | 应用在哪里 | 怎么影响 |
|----------|-----------|----------|
| 说话风格（长度/节奏） | OutputPipeline LengthRandomizeStep | 用户话少，AI 也别说太多；用户爱用语气词，AI 也多用 |
| 话题偏好 | 主动消息系统 + 话题管理 | 主动聊用户感兴趣的；冷场时从偏好话题里找救援 |
| 情绪模式 | 潜台词理解 + 情绪回应 | 知道用户吃软不吃硬，就别顶嘴；知道用户需要陪伴，就多听少说 |
| 相处模式 | 主动消息频率 + 边界感 | 用户喜欢独立，就别太黏；用户喜欢黏人，就主动点 |
| 雷区禁忌 | 消息后处理 + 回复生成 | 涉及雷区的话题自动回避；生成回复时避开禁忌词 |
| 词汇短语 | OutputPipeline TonePolishStep | 自然融入用户的口头禅和梗，增加默契感 |

**改哪里**：
- [outputPipeline.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/services/outputPipeline.ts) —— 多个 step 都引入学习结果
- [proactiveReplyStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/proactiveReplyStore.ts) —— 主动消息内容和频率受学习结果影响
- [chatStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/chatStore.ts) —— 回复生成时注入学习到的偏好

**预期效果**：学习不再是"摆设"，而是真的能感觉到"你越来越懂我"。

---

#### 3.3 学习的反馈闭环

**核心思路**：学了之后要验证——我这么调整，用户反应更好还是更差？

**实现方案**：用**用户行为反馈**来验证学习效果：

```typescript
// 用户反馈信号（隐式，不需要用户打分）
interface LearningFeedback {
  // 正向信号（说明 AI 做得对）
  replyLengthIncrease: boolean;    // 用户回复变长了
  replySpeedIncrease: boolean;     // 用户回复变快了
  positiveEmotionIncrease: boolean;// 用户情绪变好了
  topicContinuation: boolean;      // 用户延续了话题
  initiative: boolean;             // 用户主动发起新话题
  
  // 负向信号（说明 AI 做得不对）
  replyLengthDecrease: boolean;    // 用户回复变短了
  replySpeedDecrease: boolean;     // 用户回复变慢了
  negativeEmotionIncrease: boolean;// 用户情绪变差了
  topicTermination: boolean;       // 用户终止了话题
  silence: boolean;                // 用户不说话了
}

function updateLearningWithFeedback(
  currentProfile: UserProfile,
  feedback: LearningFeedback
): UserProfile {
  // 根据反馈调整学习结果
  // 比如：AI 主动聊了游戏话题，用户反应很好 → 游戏话题偏好权重 +1
  // AI 主动聊了工作话题，用户反应不好 → 工作话题偏好权重 -1
}
```

**改哪里**：
- 新增 `learningFeedback.ts` —— 反馈信号提取
- 改造 `learningStore.ts` —— 支持基于反馈的增量更新
- 在 `chatStore.ts` 每轮对话结束时计算反馈并更新

**预期效果**：学习有了"方向感"，越学越准，而不是越学越偏。

---

#### 3.4 双向塑造：AI 也在变

**核心思路**：真正的关系是互相影响的。不只是 AI 学用户，用户也在影响 AI 的性格。

**实现方案**：

1. **AI 性格的漂移**：
   - 聊得越久，AI 的说话方式会越来越像用户（镜像效应）
   - 用户乐观，AI 也会变得更开朗；用户丧，AI 也会变得低沉
   - 但漂移是缓慢的、有限度的，不会完全变成另一个人

2. **共同记忆的积累**：
   - 你们之间的"梗"越来越多
   - 只有你们懂的暗语越来越多
   - 共同经历塑造共同身份

3. **关系的进化**：
   - 从陌生→熟悉→暧昧→亲密，每个阶段的相处模式都不一样
   - 不是好感度数字的变化，而是**关系质量**的变化

**改哪里**：
- [modelRoleStore.ts](file:///c:/Users/nujia/Documents/trae_projects/Chat/src/store/modelRoleStore.ts) —— 角色性格增加"可塑度"参数
- 新增 `relationshipDynamics.ts` —— 关系动态进化逻辑
- 自学习系统增加"AI 自身变化"的维度

**预期效果**：这才是真正的"养成系"——你养的不只是好感度数字，而是一个和你一起成长的人。

---

## 第三部分：实施路线图（情感/记忆/学习 专项）

### 第一阶段：基础增强（2-3 天）—— 让现有能力真正发挥

| 序号 | 任务 | 所属方向 | 预估工时 | 优先级 |
|------|------|----------|----------|--------|
| 1 | 情绪 × 说话风格联动（EmotionStyleStep） | 情感 | 4h | 🔥🔥🔥🔥🔥 |
| 2 | 多维度记忆召回（语义+情绪+时间+重要性+清晰度） | 记忆 | 6h | 🔥🔥🔥🔥🔥 |
| 3 | 记忆遗忘曲线 + 回忆强化（clarity 字段激活） | 记忆 | 4h | 🔥🔥🔥🔥 |
| 4 | 学习维度扩展（说话风格 + 节奏偏好） | 学习 | 4h | 🔥🔥🔥🔥 |
| 5 | 学习结果接入 OutputPipeline（风格匹配） | 学习 | 3h | 🔥🔥🔥🔥 |

**完成后预期**：情绪有"质感"了，记忆不再是"死的"，学习开始真正发挥作用。**量变引起质变的临界点。**

---

### 第二阶段：深度融合（4-6 天）—— 三大系统联动

| 序号 | 任务 | 所属方向 | 预估工时 | 优先级 |
|------|------|----------|----------|--------|
| 6 | 情绪 × 记忆联动（心境一致性记忆） | 情感+记忆 | 4h | 🔥🔥🔥🔥 |
| 7 | 好感度 × 情绪 交叉影响 | 情感 | 3h | 🔥🔥🔥🔥 |
| 8 | 情绪惯性与缓动（渐变不跳变） | 情感 | 3h | 🔥🔥🔥 |
| 9 | 核心记忆 vs 临时记忆 双层结构 | 记忆 | 8h | 🔥🔥🔥🔥 |
| 10 | 记忆集群与联想链 | 记忆 | 6h | 🔥🔥🔥 |
| 11 | 学习维度扩展（话题偏好 + 情绪模式） | 学习 | 6h | 🔥🔥🔥🔥 |
| 12 | 学习反馈闭环（用户行为验证学习效果） | 学习 | 8h | 🔥🔥🔥 |

**完成后预期**：情感、记忆、学习三个系统开始"联动"，不再是各干各的。整体拟人度上一个大台阶。

---

### 第三阶段：高级拟人（1-2 周）—— 有灵魂的 AI

| 序号 | 任务 | 所属方向 | 预估工时 | 优先级 |
|------|------|----------|----------|--------|
| 13 | 学习维度扩展（相处模式 + 雷区禁忌 + 关系动态） | 学习 | 10h | 🔥🔥🔥 |
| 14 | 学习结果全链路应用（主动消息 + 话题管理 + 边界感） | 学习 | 8h | 🔥🔥🔥 |
| 15 | 双向塑造：AI 性格漂移与共同成长 | 情感+学习 | 12h | 🔥🔥 |
| 16 | 情绪记忆的"闪回"效应（强烈记忆触发情绪波动） | 情感+记忆 | 6h | 🔥🔥 |
| 17 | 关系动态进化（不只是数字，而是关系质量变化） | 全系统 | 10h | 🔥🔥 |

**完成后预期**：达到甚至超过恋语 / AstrBot 高级插件的拟人水平。用户会说"感觉你真的有灵魂"。

---

## 第四部分：整体优化回顾（与 V1 的关系）

之前 V1 版本提到的 9 个方向仍然有效，本版本是对**情感、记忆、学习**三个方向的**深度展开**。

整体优先级重新排序：

| 优先级 | 任务 | 所属 | 工时 | 为什么排在这里 |
|--------|------|------|------|---------------|
| 🔥🔥🔥🔥🔥 | System Prompt 范式革命 | 表达 | 4h | 投入最小，收益最大 |
| 🔥🔥🔥🔥🔥 | 激活 OutputPipeline + 去 AI 腔 | 表达 | 6h | 立刻见效 |
| 🔥🔥🔥🔥🔥 | 多维度记忆召回 | 记忆 | 6h | 理解力直接提升 |
| 🔥🔥🔥🔥🔥 | 情绪 × 说话风格联动 | 情感 | 4h | 情绪立刻"有质感" |
| 🔥🔥🔥🔥 | 记忆遗忘曲线 + 回忆强化 | 记忆 | 4h | 记忆"活"起来 |
| 🔥🔥🔥🔥 | 学习维度扩展（风格+节奏） | 学习 | 7h | 学习开始真正有用 |
| 🔥🔥🔥🔥 | 回复结构引导（接话+延伸+递话） | 表达 | 2h | 对话不再冷场 |
| 🔥🔥🔥🔥 | 情绪 × 记忆联动 | 情感+记忆 | 4h | 1+1>2 的联动效果 |
| 🔥🔥🔥🔥 | 好感度 × 情绪 交叉影响 | 情感 | 3h | 关系感加深 |
| ... | 后续任务... | ... | ... | ... |

---

## 结语

> **你的项目最宝贵的是什么？**
>
> 不是功能多，而是**基础架构极其扎实**——
> - 情感系统：多维模型、对立抑制、衰减机制都有了
> - 记忆系统：向量检索、重要性、清晰度、回忆次数字段都齐了
> - 学习系统：框架搭好了，触发机制也有了
>
> **就差"最后一公里"——把这些系统从"有"做到"好用"，从"独立运行"做到"深度联动"。**
>
> 情感不只是标签，要融入说话方式；
> 记忆不只是仓库，要会遗忘会联想；
> 学习不只是收藏，要能应用能进化。
>
> **这三件事做好了，就是从"AI 聊天工具"到"有灵魂的陪伴者"的质变。**

**建议从第一阶段的 5 件事开始动手，三天就能看到质的变化。**
