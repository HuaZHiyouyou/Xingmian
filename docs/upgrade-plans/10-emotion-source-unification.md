# 情绪数据源统一设计方案

## 问题现状

当前情绪面板存在**数据源分裂**：

| UI 区域 | 数据来源 | 测的是什么 |
|---------|---------|-----------|
| 当前情绪球 | `characterMindStore.multiEmotions` | AI 的情绪状态（12维） |
| 情绪走势 | `chatStore.emotionRecords` | **用户**每条消息的情绪 |
| 情绪分布 | `chatStore.emotionRecords` | **用户**情绪的统计 |
| 情绪合成 | `characterMindStore.multiEmotions` | AI 的多维情绪合成 |

**绿球**测的是 AI 的情绪，**走势图**测的是用户的情绪。用户看到的是两套完全不同的数据。

---

## 设计目标

统一情绪面板的所有区域，让用户看到一个**完整的 AI 情绪画像**，包含三个来源：

1. **用户情绪影响** — 用户说的话触发 AI 的情绪反应
2. **AI 自身当日情绪** — AI 有自己的基础情绪状态（类似人的"今天心情好不好"）
3. **环境情绪** — AI 所处的场景/环境带来的情绪影响

---

## 三来源定义

### 来源 1：用户情绪影响（已有）

**触发时机**：每次用户发消息时
**分析方式**：`analyzeEmotion(content)` → 识别用户情绪
**存储位置**：`chatStore.emotionRecords`（扁平日志）+ `characterMindStore.multiEmotions`（通过 `EmotionStateManager.update()` 写入）
**数据结构**：`EmotionRecord { emotion, intensity, context, timestamp, characterId }`

**问题**：当前 `emotionRecords` 存储的是**用户的情绪类型**（如用户说"我好累"→ sadness:60），而不是 AI 对这句话的情绪反应。这两者是不同的。

**改进方向**：`emotionRecords` 应该存储 **AI 对用户消息的情绪反应**，而不是用户本身的情绪。

### 来源 2：AI 自身当日情绪（已有基础）

**触发时机**：认知管道的"更新"步骤（每次回复后）
**分析方式**：LLM 在 `<thought>` 链中输出 12 维情绪值 → `parseCognitiveOutput()` → `EmotionStateManager.applyCognitiveUpdate()`
**存储位置**：`characterMindStore.multiEmotions[characterId].values`
**数据结构**：`MultiEmotionState { values: Record<EmotionDimension, number>, history, interactions }`

**当前实现**：已完整。12 维情绪状态在每次认知管道执行后更新，有时间衰减、智能混合、代谢抑制等机制。

### 来源 3：环境情绪（尚未实现）

**定义**：AI 所处的场景/环境带来的情绪基调影响

**场景举例**：
- 工作场景 → 疲惫、焦虑、专注
- 做家务 → 平静、满足、或烦躁
- 被指使 → 不情愿、或服从（取决于好感度）
- 休息/娱乐 → 放松、开心
- 深夜 → 孤独、安静

**触发时机**：每次对话开始前，或用户消息中隐含场景信息时
**分析方式**：需要新增场景识别模块
**存储位置**：建议作为 `multiEmotions` 的一个独立维度层，或作为"基础情绪偏移量"

---

## 统一方案

### 核心思路：三层融合

```
┌─────────────────────────────────────────────┐
│              最终 AI 情绪状态                 │
│         characterMindStore.multiEmotions      │
│                                               │
│  ┌─────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ 用户影响 │  │ AI自身情绪│  │ 环境情绪    │ │
│  │ (动态)   │  │ (基础)   │  │ (场景偏移)  │ │
│  └─────────┘  └──────────┘  └─────────────┘ │
│       ↓             ↓              ↓          │
│    每轮更新     认知管道更新    场景切换时更新   │
└─────────────────────────────────────────────┘
```

### 数据流设计

```
用户发消息
    │
    ├─→ [1] 场景识别（新增）
    │       分析消息中的场景线索（工作/家务/休息/深夜...）
    │       → 输出 envEmotion: { tired: 30, calm: 20, ... }
    │
    ├─→ [2] 用户情绪分析（已有，改造）
    │       analyzeEmotion(content) → 识别用户情绪
    │       → 存入 emotionRecords（标注为"用户情绪"）
    │       → 同时计算 AI 对此的情绪反应（新增）
    │
    ├─→ [3] AI 自身基础情绪（已有）
    │       multiEmotions 中的时间衰减 + 历史惯性
    │
    └─→ [4] 三层融合（改造现有 EmotionStateManager）
            final = blend(userImpact, aiBase, envOffset)
            → 写入 multiEmotions
            → 写入 emotionRecords（标注为"AI情绪反应"）
```

### 情绪记录结构改造

**现有结构**：
```typescript
interface EmotionRecord {
  id: string;
  emotion: EmotionType;      // 单一情绪类型
  intensity: number;          // 强度
  timestamp: Date;
  context: string;
  characterId?: string;
}
```

**改造后**：
```typescript
interface EmotionRecord {
  id: string;
  emotion: EmotionType;        // AI 的主导情绪
  intensity: number;            // 强度
  timestamp: Date;
  context: string;              // 触发文本
  characterId?: string;
  /** 数据来源标记 */
  source: 'user_trigger' | 'cognitive' | 'environment' | 'consultation';
  /** 多维情绪快照（可选，用于详情展示） */
  multiSnapshot?: Partial<Record<EmotionDimension, number>>;
}
```

---

## UI 展示方案

### 情绪面板改造

```
┌─────────────────────────────────────────┐
│           当前情绪                       │
│  ┌─────────────────────────────────┐    │
│  │     绿球（AI 主导情绪）          │    │
│  │     来自 multiEmotions 的主导维度 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  情绪构成（三来源可视化）：              │
│  ├─ 用户影响: ████████░░ 45%            │
│  ├─ AI自身:   ██████░░░░ 35%            │
│  └─ 环境:     ████░░░░░░ 20%            │
│                                         │
│  多维情绪雷达图（12维）                  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│           情绪走势                       │
│  折线图：AI 的 12 维情绪随时间变化       │
│  （替代当前的用户情绪柱状图）            │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│           情绪分布                       │
│  横向条形图：AI 各情绪出现频率           │
│  （替代当前的用户情绪分布）              │
└─────────────────────────────────────────┘
```

### 情绪记录列表改造

每条记录增加来源标签：

```
┌──────────────────────────────────────┐
│ 💗 喜悦 72%                          │
│ 来源: 用户触发 · "今天天气真好"       │
│ [用户影响 ████████ 60%]              │
│ [AI自身   ██░░░░░░ 25%]              │
│ [环境     █░░░░░░░ 15%]              │
└──────────────────────────────────────┘
```

---

## 实现步骤

### Phase 1：修复数据源一致性（低风险）

1. **改造 `emotionRecords` 的写入逻辑**
   - `chatStore.sendMessage()` 中的 `analyzeEmotion()` 回调：
     - 当前：存入用户情绪 `rawResult.emotion`
     - 改为：先分析用户情绪，再计算 AI 对此的反应，存入 AI 反应情绪
   - 新增 `analyzeAIReaction(userEmotion, currentMultiEmotion, context)` 函数

2. **统一走势图和分布图**
   - `EmotionTimeline` 组件：改为读取 `multiEmotions.history`（已有最近 20 个快照）
   - `DistributionBars` 组件：改为统计 `multiEmotions.history` 中的主导情绪分布

3. **保留 `emotionRecords` 作为原始日志**
   - 不删除，但标注 `source` 字段
   - 用于调试和"最近记录"列表

### Phase 2：AI 自身基础情绪（中风险）

1. **每日基础情绪初始化**
   - 新增 `dailyBaseEmotion` 字段在 `MultiEmotionState`
   - 每天首次对话时，根据时间/日期生成基础情绪偏移
   - 凌晨 → 偏向 tired/lonely
   - 早晨 → 偏向 neutral/contentment
   - 下午 → 偏向 curiosity/excitement
   - 晚上 → 偏向 calm/contentment

2. **情绪惯性增强**
   - 增强 `applyDecay()` 的历史惯性权重
   - 如果昨天很开心，今天的基础值略高

### Phase 3：环境情绪（新功能）

1. **场景识别模块**
   - 新增 `detectEnvironment(userMessage): EnvironmentEmotion`
   - 关键词匹配 + LLM 辅助判断
   - 输出：场景类型 + 情绪偏移量

2. **环境情绪融合**
   - 在 `EmotionStateManager` 中新增 `applyEnvironmentOffset()` 方法
   - 环境偏移量叠加到 multiEmotions 上
   - 偏移量较小（±5~15），不主导情绪

---

## 关键文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `src/types/index.ts` | `EmotionRecord` 加 `source` 和 `multiSnapshot` 字段 |
| `src/store/chatStore.ts` | `sendMessage()` 改造情绪分析回调 |
| `src/utils/emotionAnalyzer.ts` | 新增 `analyzeAIReaction()` |
| `src/services/emotion/emotionStateManager.ts` | 新增 `applyEnvironmentOffset()` |
| `src/components/emotion/EmotionDashboard.tsx` | 走势图/分布图改读 `multiEmotions` |
| `src/services/cognitive/cognitivePrompt.ts` | Prompt 中注入环境情绪 |
| 新增: `src/services/emotion/environmentDetector.ts` | 场景识别模块 |

---

## 兼容性考虑

- `emotionRecords` 保留向后兼容：老数据无 `source` 字段时默认 `'user_trigger'`
- `multiEmotions` 的 12 维结构不变，只是更新算法更精细
- UI 渐进改造，不影响其他功能
