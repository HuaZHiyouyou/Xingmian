# Bug 修复手册 V1.0
## —— 情绪/输出/流式系统的 12 个具体问题与修复教学

> **文档版本**：V1.0
> **创建日期**：2026-07-19
> **定位**：基于源码深度扫描的**可学习、可操作**手册。每个 bug 都讲"症状 → 根因 → 代码位置 → 修复 diff → 验证方法"。
> **适用读者**：项目维护者、想搞懂"为什么情绪一直平静/分段不连贯"的开发者。
> **预估总工时**：4-7 天（分三批做）

---

## 〇、阅读指南

### 文档结构

每个 bug 按**统一的 6 段式**编写，方便对照学习：

```
1. 症状        ← 用户/开发者观察到的现象
2. 根因        ← 为什么会这样（讲机理）
3. 代码位置    ← 精确到文件:行号
4. 修复 diff   ← 可直接复制的代码
5. 验证方法    ← 怎么确认修好了
6. 延伸学习    ← 相关知识点
```

### 修复顺序建议

**第一波（30 分钟，全是 10-30 分钟的小修）**：
- Bug 2 → Bug 4 → Bug 6 → Bug 5

**第二波（2-3 天，架构清理）**：
- Bug 1 → Bug 3 → 死板 1/2

**第三波（1-2 周，长期重构）**：
- Bug 7 → 死板 3/4 → 重复 1/2

> ⚠️ 修复前**务必读完每个 bug 的"根因"段**，不要直接跳到 diff 抄答案。理解机理才能避免改出新 bug。

---

## 🔴 第一波：立即可修的确定性 Bug

### Bug 2：主动代谢功能完全失效

#### 症状

README 宣传"AI 可以主动消气"（如 LLM 输出 `anger:-10` 把愤怒降下来），但实际观察：
- AI 输出了 `<thought>` 标签里的代谢建议
- 情绪状态却**完全没变化**
- 长时间生气后不会自然消气

#### 根因

代码已经正确解析了 LLM 的代谢建议，但**没有把它传递给情绪更新函数**——半路被丢掉了。

调用链：

```
LLM 输出 <thought>[代谢] anger:-10</thought>
        ↓
parseThoughtChain() 解析出 metabolisms 数组  ✅ 正确
        ↓
manager.update() 接收 metabolisms 参数        ✅ 正确
        ↓
chatStore 调用 manager.update(...) 时传入...  🔴 metabolisms: []  写死空数组！
```

#### 代码位置

`src/store/chatStore.ts:714-744`（sendMessage 函数内，流式回复完成后）

```typescript
// 当前代码（有 bug）
try {
  const thoughtChain = parseFeelingTag(aiReply);   // ← 只解析了 feeling，没解析 thought
  const manager = getEmotionStateManager();
  const currentMulti = useCharacterMindStore.getState().getMultiEmotion(character?.id || '');

  // ...
  const updated = manager.update(currentMulti, {
    newEmotion: emotion,
    intensity: intensity,
    triggerText: content,
    metabolisms: [],   // ← 🔴 写死！
  });
```

问题在两处：
1. 第 716 行用了 `parseFeelingTag`（只解析 `<feeling>` 标签），**没有调用 `parseThoughtChain`**（解析 `<thought>` 里的代谢建议）
2. 第 729 行 `metabolisms: []` 直接写死空数组

#### 修复 diff

```typescript
// 修复后
try {
  const feeling = parseFeelingTag(aiReply);            // feeling 标签（情绪维度值）
  const thought = parseThoughtChain(aiReply);          // 🆕 thought 标签（代谢建议）
  const manager = getEmotionStateManager();
  const currentMulti = useCharacterMindStore.getState().getMultiEmotion(character?.id || '');

  if (feeling) {
    useDebugLog.getState().add('emotion', `解析到feeling标签: ${JSON.stringify(feeling)}`, { ... });
  }
  if (thought && thought.metabolisms.length > 0) {     // 🆕 记录代谢日志
    useDebugLog.getState().add('emotion', `解析到代谢建议: ${JSON.stringify(thought.metabolisms)}`, { ... });
  }

  const updated = manager.update(currentMulti, {
    newEmotion: emotion,
    intensity: intensity,
    triggerText: content,
    metabolisms: thought?.metabolisms || [],           // ✅ 修复：传解析出的代谢
  });
```

记得在文件顶部 import 里加上 `parseThoughtChain`（如果还没有）：

```typescript
// src/store/chatStore.ts 顶部
import { getTop3Emotion, parseFeelingTag, parseThoughtChain, buildTop3EmotionPrompt } from '../services/emotion/thoughtChainParser';
```

#### 验证方法

1. 启动应用，让 AI 进入明显生气状态（连续刺激 anger）
2. 发送一条让 AI"消气"的消息（如道歉）
3. 打开调试日志面板（Debug 页），应看到：
   ```
   [emotion] 解析到代谢建议: [{"emotion":"anger","delta":-15,"reason":"代谢: anger -15"}]
   [emotion] 情绪更新完成: 主导=neutral:30, 维度数=...
   ```
4. 打开情绪面板，确认 anger 维度值**真的降低了**

#### 延伸学习

**"主动代谢"的设计哲学**：

参考的是人类情绪的"自我调节"机制。传统情绪系统是"只增不减"——`joy += 5`，AI 会越来越开心。但真人会"我自己冷静一下"——主动把 anger 降下来。

实现方式是让 LLM 在思维链里输出类似 `[代谢] anger:-10, sadness:-5` 的指令，代码解析后从情绪状态里**减去**对应值。这是 `astrbot-plugin-emotionai` 的核心创新之一。

---

### Bug 4：分段回复后续段落情绪全错

#### 症状

AI 回复一段长消息，被自动分成 3 段发送：
- 第 1 段：显示"😊 开心"
- 第 2 段：显示"😐 平静"  ← 应该也是开心
- 第 3 段：显示"😐 平静"  ← 应该也是开心

用户感知：AI 像是"说完一句就冷漠了"，情绪不连贯。

#### 根因

一条 AI 回复无论分几段发出，**所有分段应当共用同一份情绪**（因为情绪是针对"整条回复"产生的）。但代码里后续每段都被**硬编码成 `emotion: 'neutral'`**。

```typescript
// 伪代码示意
const reply = await callAI(...);          // 完整回复
const emotion = analyze(reply);           // 解析出"开心"
send(reply.part1, emotion);               // ✅ 第 1 段用了 emotion
send(reply.part2, 'neutral');             // 🔴 第 2 段写死 neutral
send(reply.part3, 'neutral');             // 🔴 第 3 段写死 neutral
```

#### 代码位置

**共 3 处**，都是同一个 bug：

| 文件:行号 | 场景 |
|-----------|------|
| `src/store/chatStore.ts:638-644` | 流式分段 |
| `src/store/chatStore.ts:1077-1082` | 非流式分段 |
| `src/store/chatStore.ts:1199-1204` | 角色恢复回复分段 |

以第一处为例：

```typescript
// src/store/chatStore.ts:638（有 bug）
for (let i = 1; i < streamSegments.length; i++) {
  if (streamSegConfig.showTypingIndicator) {
    set({ isTyping: true });
  }
  await new Promise(resolve => setTimeout(resolve, streamSegConfig.delay));
  const segMsg: Message = {
    id: generateId(),
    content: streamSegments[i],
    sender: 'ai',
    timestamp: new Date(),
    emotion: 'neutral',   // ← 🔴 硬编码
  };
```

#### 修复 diff

**3 处都改成**用外层作用域的 `emotion` 和 `intensity`：

```typescript
// 修复后（第 643 行）
const segMsg: Message = {
  id: generateId(),
  content: streamSegments[i],
  sender: 'ai',
  timestamp: new Date(),
  emotion: emotion,              // ✅ 用真实情绪
  emotionIntensity: intensity,   // ✅ 顺带补上 intensity
};
```

**⚠️ 注意执行顺序陷阱**：

当前代码的情绪解析（第 714-754 行）在分段循环（第 633-658 行）**之后**执行。如果你直接改成 `emotion: emotion`，分段发送时 `emotion` 还没被解析更新，会用初始值。

正确的做法是**把情绪解析块整体上移到分段循环之前**：

```typescript
// 修复后的执行顺序
// 1. 拿到 aiReply（完整文本）
// 2. 🆕 解析 <thought>/<feeling> → 更新 multiEmotionState → 算出 dominant emotion
// 3. 历史净化（移除标签）
// 4. 走 Pipeline（分段在这里发生）
// 5. 分段发送（所有 segment 用 step 2 的 emotion）
```

具体来说，把 `chatStore.ts:714-754` 这段代码**剪切到 `:602` 之前**（分段判断之前）。

#### 验证方法

1. 配置一个会产生长回复的角色（responseStyle 设为"详细")
2. 发送一条需要长回复的消息（如"给我讲讲你的故事"）
3. 等 AI 分 3 段以上回复
4. 在消息气泡上检查每段的 emotion（DevTools → React DevTools → 查看 message 对象）
5. **所有分段应当 emotion 一致**

#### 延伸学习

**为什么会写出这个 bug**：

典型的"先写主干后补细节"导致的顺序错误。最初可能只有"发送完整回复"的逻辑，emotion 解析在末尾很合理。后来加了分段功能，分段代码插入在中间，但没人回头检查 emotion 解析的位置——于是分段用了未解析的初始值，开发者发现"显示不对"，简单粗暴地写死 `neutral` 应付，留下隐患。

这是**"症状修复"vs"根因修复"**的经典案例。写死 `neutral` 让显示不报错，但没解决"分段应当共享情绪"这个本质需求。

---

### Bug 6：流式响应的 RAF 永远不被取消（内存泄漏）

#### 症状

- 流式响应过程中切换对话，可能看到旧对话的消息内容**闪烁更新**
- 长时间使用后内存占用持续增长
- DevTools 里偶尔看到"对已卸载组件 setState"的警告

#### 根因

`requestAnimationFrame`（RAF）是浏览器调度的回调，**必须**用 `cancelAnimationFrame` 取消，否则会一直挂起直到下一帧。当前代码只赋值了 `tokenRafId`，**从没取消过**。

```typescript
// 问题示意
let rafId = null;
onToken(() => {
  if (rafId === null) {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      set(...);   // 更新 React state
    });
  }
});
// 🔴 全程没有 cancelAnimationFrame(rafId)
```

如果流式过程中出错（进入 catch 块），那个挂起的 RAF 还会在下一帧执行 `set()`，操作可能已经不一致的状态。

#### 代码位置

`src/store/chatStore.ts:547-580`

```typescript
// 当前代码（有 bug）
try {
  let tokenRafId: number | null = null;
  aiReply = await callAIStream(messages, systemPrompt, maxTokens, temperature, {
    onToken: (token: string) => {
      streamedContent += token;
      if (tokenRafId === null) {
        tokenRafId = requestAnimationFrame(() => {
          tokenRafId = null;
          set((state) => { /* 更新消息内容 */ });
        });
      }
    },
    onComplete: (fullText: string) => { streamedContent = fullText; },
    onError: (error: Error) => { console.error(...); },
  });
} catch (streamErr) {
  // 🔴 这里没有取消 tokenRafId
  ...
}
```

#### 修复 diff

用 `try/finally` 保证无论成功还是失败都清理：

```typescript
// 修复后
try {
  let tokenRafId: number | null = null;
  try {
    aiReply = await callAIStream(messages, systemPrompt, maxTokens, temperature, {
      onToken: (token: string) => {
        streamedContent += token;
        if (tokenRafId === null) {
          tokenRafId = requestAnimationFrame(() => {
            tokenRafId = null;
            set((state) => { /* 更新消息内容 */ });
          });
        }
      },
      onComplete: (fullText: string) => {
        // 🆕 完成时也取消挂起的 RAF，立即最终化
        if (tokenRafId !== null) {
          cancelAnimationFrame(tokenRafId);
          tokenRafId = null;
        }
        streamedContent = fullText;
      },
      onError: (error: Error) => { console.error(...); },
    });
  } finally {
    // 🆕 无论成功失败，都清理挂起的 RAF
    if (tokenRafId !== null) {
      cancelAnimationFrame(tokenRafId);
      tokenRafId = null;
    }
  }
} catch (streamErr) {
  ...
}
```

#### 验证方法

1. 打开 DevTools → Performance → Memory
2. 开始一次长流式回复
3. **回复过程中**快速切换到另一个对话
4. 观察：
   - 控制台不应有"对已卸载组件 setState"警告
   - 内存曲线不应出现泄漏式增长
   - 旧对话的内容不应继续更新

#### 延伸学习

**为什么需要批处理 RAF**：

原始代码是这样写的（每个 token 都 set）：
```typescript
onToken: (token) => {
  streamedContent += token;
  set(...);   // 每个 token 触发一次 React 重渲染！
}
```

LLM 流式输出每秒可能产出 30-50 个 token，每个 token 都触发一次 Zustand state 更新 → 整个消息列表重渲染 → 卡顿。

RAF 批处理的思路：**把多个 token 的 set 合并到一帧内只执行一次**。浏览器每帧 16ms，所以最多 60 次/秒，比每个 token 都 set 高效得多。

但 RAF 的代价是**必须手动取消**，否则就是这次的 bug。

**类似需要清理的异步原语**：
- `setTimeout` → `clearTimeout`
- `setInterval` → `clearInterval`
- `requestAnimationFrame` → `cancelAnimationFrame`
- `fetch` → `AbortController.abort()`
- EventEmitter listener → `removeEventListener`
- Promise → 没有 cancel，但可以用 `AbortController` 信号

---

### Bug 5：Pipeline 执行顺序错误，segments 与最终文本不一致

#### 症状

- AI 回复被分段发送，但**分段数量和内容对不上**实际文本
- 偶尔看到消息分段里有"幽灵内容"（实际文本里没有的句子）
- Pipeline 调试日志显示分段 3 段，但实际发送了 2 段

#### 根因

Pipeline 的 10 个步骤按固定顺序执行：

```
Step 1 CleanMarkers   清洗标签
Step 2 BlockCliche    拦截复读/AI腔
Step 3 TypoSim        错字模拟
Step 4 SmartSegment   智能分段      ← 在这里算出 segments 数组
Step 5 TonePolish     语气微调
Step 6 LengthRandomize 长度随机化   ← 🔴 随机丢弃句子！processedText 变短了
Step 7 Colloquialism  口语化注入
Step 8 SmartPunctuation
Step 9 SpeakingRhythm
Step 10 FinalSanitize
```

`pipelineV2.ts:109` 只在 Step 4 执行后记录一次 `lastSegmentData`：

```typescript
if (step.name === 'segment' && result.data?.segments) {
  lastSegmentData = result.data;
}
```

之后 Step 6 改了 `ctx.processedText`，但 `lastSegmentData.segments` **不再更新**。最终返回：

```typescript
return {
  text: ctx.processedText,              // 被裁短了
  segments: lastSegmentData.segments,   // 🔴 还是基于原始长文本！
};
```

`text` 和 `segments` 对不上。

#### 代码位置

- 执行顺序：`src/services/output/pipelineV2.ts:60-73`（createSteps 函数）
- segments 固化：`src/services/output/pipelineV2.ts:109-111`
- 随机裁剪：`src/services/output/pipelineSteps.ts:326-383`（LengthRandomizeStepV2）

#### 修复方案

**方案 A（推荐）：调整步骤顺序**

把 `LengthRandomizeStepV2` 挪到 `SmartSegmentStep` **之前**。逻辑上应该"先决定保留哪些句子，再决定怎么分段"。

```typescript
// src/services/output/pipelineV2.ts:60 修复后
function createSteps(config: PipelineV2Config) {
  return [
    new CleanMarkersStepV2(config.cleanMarkers),      // 1
    new BlockClicheStepV2(config.blockCliche),        // 2
    new TypoSimStep(config.typoSim),                  // 3
    new LengthRandomizeStepV2(config.lengthRandomize),// 4 🆕 挪到这里
    new SmartSegmentStep(config.segment),             // 5 🆕 分段放后面
    new TonePolishStepV2(config.tonePolish),          // 6
    new ColloquialismStepV2(config.colloquialism),    // 7
    new SmartPunctuationStep(config.smartPunctuation),// 8
    new SpeakingRhythmStep(config.speakingRhythm),    // 9
    new FinalSanitizeStep(config.finalSanitize),      // 10
  ];
}
```

**方案 B：让 Segment 步骤之后不再修改 processedText**

强制 `TonePolish / Colloquialism / SmartPunctuation / SpeakingRhythm` 这些步骤**只允许局部微调（加语气词、改标点），不允许改变句子数量**。可以在每个步骤里加断言。

**方案 C（最干净）：分段放到最后一步**

把"分段计算"从 Pipeline 中抽出来，作为 Pipeline 执行完之后的独立步骤：

```typescript
// 修复后（伪代码）
const pipelineResult = runPipelineV2(ctx, config);  // 不含分段
const segments = pipelineResult.text.length > threshold
  ? splitIntoSegments(pipelineResult.text, segmentConfig)
  : [pipelineResult.text];
return { ...pipelineResult, segments };
```

#### 验证方法

1. 开启 Pipeline 调试日志
2. 触发一次长回复（确保触发分段）
3. 检查日志里：
   - `[segment] 分段: N段` 的 N
   - 实际发送的消息数
   - 这两个数应当**相等**
4. 检查分段内容拼接起来 = `text` 字段

#### 延伸学习

**Pipeline 模式的隐含约束**：

当你有一个数据处理 Pipeline，且某个步骤产出"结构化结果"（如这里的 segments 数组），**后续步骤必须保持该结构有效**，或者该结构必须随文本变化同步更新。

否则就会出现"缓存陈旧"（stale cache）问题——这是 React 开发者熟悉的概念，但在数据 Pipeline 里同样适用。

**判断步骤是否安全的快速规则**：
- ✅ 安全：标点替换、字符插入、空白清理（结构不变）
- ❌ 不安全：句子删除、句子重排、段落合并/拆分（结构改变）

---

## 🟠 第二波：架构层面的清理

### Bug 1：情绪状态更新逻辑三套并存

#### 症状

- 情绪变化"时灵时不灵"
- 同一个情绪状态，不同地方读出来的主导情绪不一样
- 调试时无法预测下一次情绪值是多少

#### 根因

项目里同时存在 **3 套**情绪更新逻辑，混用：

| # | 文件 | 函数 | 衰减模型 |
|---|------|------|---------|
| A | `utils/emotionAnalyzer.ts:298` | `updateMultiEmotionState` | 按小时 + 每次交互衰减 15% |
| B | `services/emotion/emotionStateManager.ts:82` | `EmotionStateManager.update` | 按分钟指数衰减（半衰期） |
| C | `chatStore.ts:725` | 调用 B 但 metabolisms 写死 `[]` | 用了 B 但禁用了主动代谢 |

**同一次 sendMessage 流程里**：
- `chatStore.ts:269` 调用 A（`updateMultiEmotionState`）更新一次
- `chatStore.ts:725` 又调用 B（`manager.update`）再更新一次

情绪被算了两遍，用了两套完全不同的衰减算法。

#### 代码位置

- 调用 A：`src/store/chatStore.ts:269`
- 调用 B：`src/store/chatStore.ts:725`
- 实现 A：`src/utils/emotionAnalyzer.ts:298`
- 实现 B：`src/services/emotion/emotionStateManager.ts:82`

#### 修复方案

**统一到 B（EmotionStateManager），删除 A**。理由：
- B 使用指数衰减 + 半衰期，模型更科学
- B 支持主动代谢（A 不支持）
- B 是 OOP 封装，更易扩展

**步骤**：

1. **删除 `utils/emotionAnalyzer.ts:298-353` 的 `updateMultiEmotionState` 函数**
2. **修改 `chatStore.ts:269`**，把对 A 的调用改为 B：

```typescript
// 修复前（chatStore.ts:266-270）
analyzeEmotion(content).then(async (rawResult) => {
  if (rawResult) {
    const oldMulti = useCharacterMindStore.getState().getMultiEmotion(charId);
    const newMulti = updateMultiEmotionState(oldMulti, rawResult.emotion, rawResult.intensity);  // ← A
    useCharacterMindStore.getState().updateMultiEmotion(charId, rawResult.emotion, rawResult.intensity);
    // ...

// 修复后
analyzeEmotion(content).then(async (rawResult) => {
  if (rawResult) {
    const manager = getEmotionStateManager();
    const oldMulti = useCharacterMindStore.getState().getMultiEmotion(charId);
    const newMulti = manager.update(oldMulti, {              // ← B
      newEmotion: rawResult.emotion,
      intensity: rawResult.intensity,
      triggerText: content,
      metabolisms: [],  // 这里没有思维链，留空
    });
    useCharacterMindStore.getState().setMultiEmotion(charId, newMulti);  // 🆕 用 setMultiEmotion 而非 updateMultiEmotion
    // ...
```

3. **删除 import**：`chatStore.ts:6` 中去掉 `updateMultiEmotionState`

4. **全项目搜索是否还有其他地方用 A**：

```powershell
Select-String -Path src\**\*.ts, src\**\*.tsx -Pattern 'updateMultiEmotionState'
```

如果有，全部改为 `manager.update(...)`。

#### 验证方法

1. 搜索代码，确认 A 的函数定义和调用**都已删除**：

```powershell
Select-String -Path src\**\*.ts, src\**\*.tsx -Pattern 'updateMultiEmotionState'
# 期望输出：无
```

2. 连续聊 10 轮，观察情绪值变化是否平滑（不再出现"跳变"）

3. `npm run check` 类型检查通过

#### 延伸学习

**为什么会出现三套实现**：

典型的"渐进重构未完成"产物：
- 最早只有 A（`emotionAnalyzer.ts`），简单直接
- 后来设计 V2 系统，写了 B（`emotionStateManager.ts`），更先进
- 但 A 没删，调用点也没全改，于是新旧并存
- C 是 B 的"降级调用"——本该传 metabolisms 却传了空数组（Bug 2）

**重构的正确姿势**：
1. 先确认新旧实现的行为差异（写测试对比）
2. 用"适配器模式"让旧 API 内部调用新实现
3. 逐步迁移调用点
4. 最后删除旧实现

本项目跳过了第 1-3 步，直接写了新实现却没迁移，留下了双轨。

---

### Bug 3：getDominantEmotion 存在两份冲突的实现

#### 症状

- 同一个 multiEmotionState，在情绪面板显示的主导情绪 ≠ Pipeline 实际使用的情绪
- 调试日志里看到的主导情绪忽明忽暗

#### 根因

存在两份 `getDominant` 实现，逻辑不同：

| 位置 | neutral 阈值 | 映射表 |
|------|-------------|--------|
| `utils/emotionAnalyzer.ts:274` `getDominantEmotion` | intensity < 10 → neutral | `trust → grateful` |
| `services/emotion/emotionStateManager.ts:205` `getDominant` | maxVal === 0 → neutral（强度 30） | `trust → love` |

**同一个 trust=50 的状态**：
- 用前者：主导是 `grateful`（感激）
- 用后者：主导是 `love`（喜爱）

完全相反！

#### 代码位置

- 实现 A：`src/utils/emotionAnalyzer.ts:273-287`
- 实现 B：`src/services/emotion/emotionStateManager.ts:205-224`

#### 修复方案

**保留一份，删除另一份**。建议保留 A（`getDominantEmotion`），因为：
- 调用点更多（chatStore 用了 4 处）
- 函数签名返回 `{ type, intensity }`，信息更完整
- A 已经导出为独立函数，易复用

**步骤**：

1. **修改 `emotionStateManager.ts:205-224`**，让 B 内部调用 A：

```typescript
// 修复后
import { getDominantEmotion } from '../../utils/emotionAnalyzer';

class EmotionStateManager {
  // ...

  getDominant(state: MultiEmotionState): { type: EmotionType; intensity: number } {
    return getDominantEmotion(state);  // 🆕 直接委托给 A
  }
}
```

2. **或者直接删除 B**，让调用方改用 A：

```powershell
# 搜索 B 的调用点
Select-String -Path src\**\*.ts, src\**\*.tsx -Pattern 'manager\.getDominant|\.getDominant\('
```

#### 验证方法

1. 搜索代码，全项目应当只有**一份** `getDominantEmotion` 实现

```powershell
Select-String -Path src\**\*.ts -Pattern 'function getDominant|getDominant\s*\('
```

2. 写个测试验证一致性：

```typescript
// src/__tests__/emotion.test.ts
import { getDominantEmotion } from '../utils/emotionAnalyzer';
import { getEmotionStateManager } from '../services/emotion/emotionStateManager';

test('两份 getDominant 行为一致', () => {
  const state = { values: { trust: 50, joy: 30 }, lastUpdated: Date.now(), interactions: 0, history: [] };
  const a = getDominantEmotion(state);
  const b = getEmotionStateManager().getDominant(state);
  expect(a.type).toBe(b.type);
  expect(a.intensity).toBe(b.intensity);
});
```

#### 延伸学习

**单一数据源（Single Source of Truth）原则**：

同一个概念（"主导情绪是什么"）应当只有**一个权威实现**。否则：
- 修改一处忘改另一处 → 行为分裂
- 调用方不知道该信哪个 → 随机选一个
- 调试时看到不同结果 → 困惑

React 生态里类似的问题：Redux vs Zustand vs Context 三套 state 混用、React Query vs SWR 数据缓存混用。

**识别"重复实现"的信号**：
- 函数名相似但不同（`getDominant` vs `getDominantEmotion`）
- 同一概念有多种类型（`EmotionType` vs `EmotionDimension`）
- 代码评审时"这个不是已经有现成的了吗？"

---

### 死板 1/2：getAdaptiveMaxTokens 和 getAdaptiveTemperature 重写

#### 症状

- AI 回复长度感觉"被锁死"——总是差不多长
- 严肃话题和闲聊回复温度一样
- 情绪激动时回复不见得更长/更有感染力

#### 根因

两个函数都**只按对话长度分档**，完全没考虑其他因素：

```typescript
// aiService.ts:780 —— 3 个参数声明了，2 个没用
export function getAdaptiveMaxTokens(
  userMessage: string,        // ← 声明了没用
  conversationLength: number,
  currentEmotion: EmotionType // ← 声明了没用
): number {
  if (conversationLength < 5) return 400;
  if (conversationLength < 20) return 600;
  if (conversationLength < 50) return 800;
  return 1000;
}
```

温度函数同理。这是"死编译感"的核心来源——**该灵活的地方写死了**。

#### 代码位置

- `src/services/aiService.ts:780-792`

#### 修复方案

**让函数真的用上所有参数，输出连续值而非分档常量**。

```typescript
// 修复后：getAdaptiveMaxTokens
export function getAdaptiveMaxTokens(
  userMessage: string,
  conversationLength: number,
  currentEmotion: EmotionType
): number {
  // 基础值：根据用户消息长度动态决定
  const msgLen = userMessage.length;
  let base: number;
  if (msgLen < 10) base = 300;        // 短问候
  else if (msgLen < 50) base = 500;   // 普通对话
  else if (msgLen < 200) base = 800;  // 中等长度
  else base = 1200;                   // 长倾诉/故事

  // 情绪调节：激动情绪允许更长回复
  const emotionMultiplier: Record<string, number> = {
    joy: 1.2, excitement: 1.3, anger: 1.15, sadness: 1.1,
    neutral: 1.0, shy: 0.85, lonely: 0.9,
  };
  base *= emotionMultiplier[currentEmotion] || 1.0;

  // 对话熟悉度微调（越聊越熟，回复可以更简洁）
  if (conversationLength > 30) base *= 0.9;

  return Math.round(Math.max(200, Math.min(2000, base)));
}


// 修复后：getAdaptiveTemperature
export function getAdaptiveTemperature(
  conversationLength: number,
  currentEmotion?: { type: EmotionType; intensity: number }  // 🆕 加情绪
): number {
  // 基础温度：开场偏低（稳定），熟了之后升高
  let base: number;
  if (conversationLength < 5) base = 0.75;
  else if (conversationLength < 20) base = 0.85;
  else base = 0.92;

  // 情绪强度调节：高强度情绪 → 温度略降（保持表达稳定，不胡言乱语）
  if (currentEmotion && currentEmotion.intensity > 70) {
    base -= 0.05;
  }

  // 严肃情绪 → 降温度（悲伤/愤怒需要稳定表达）
  if (currentEmotion && ['sadness', 'anger', 'fear'].includes(currentEmotion.type)) {
    base -= 0.05;
  }

  return Math.max(0.6, Math.min(1.1, base));
}
```

**调用点也要改**：

```typescript
// chatStore.ts:499
const temperature = getAdaptiveTemperature(convLen, { type: emotion, intensity });
```

#### 验证方法

写单元测试覆盖各场景：

```typescript
// src/__tests__/adaptive.test.ts
describe('getAdaptiveMaxTokens', () => {
  it('短消息给少 token', () => {
    expect(getAdaptiveMaxTokens('嗯', 5, 'neutral')).toBeLessThan(500);
  });
  it('长倾诉给多 token', () => {
    expect(getAdaptiveMaxTokens('a'.repeat(300), 10, 'sadness')).toBeGreaterThan(1000);
  });
  it('激动情绪放大 token', () => {
    const calm = getAdaptiveMaxTokens('讲讲', 10, 'neutral');
    const excited = getAdaptiveMaxTokens('讲讲', 10, 'excitement');
    expect(excited).toBeGreaterThan(calm);
  });
});
```

#### 延伸学习

**"分档常量" vs "连续函数"**：

死板的根源是"阶梯函数"思维：
```typescript
if (x < 5) return 400;
if (x < 20) return 600;
```
边界处会突变（4.9 → 400, 5.0 → 600），且无法表达"中等程度"。

连续函数更自然：
```typescript
return 300 + msgLen * 4;  // 平滑增长
```

**设计的"参数多维化"**：

只看 `conversationLength` 一个维度 → 必然死板。加入 `userMessage.length` + `emotion.intensity` + `affinityStage` 等维度后，组合空间指数级扩大，输出自然就"灵动"了。

这是 **LLM prompt 工程的反面**——prompt 里塞各种情境描述让 AI 自己判断，但**代码侧的参数计算却很死板**，导致 AI 拿到的约束本身就是僵化的。

---

## 🟡 第三波：长期重构项

### Bug 7：流式 reader 不释放锁，切对话时不取消

#### 症状

- 用户在 AI 流式回复过程中切换对话
- 旧对话的 fetch 仍在后台进行
- 网络流量浪费、可能更新错误的状态

#### 根因

`doStreamFetch` 用了 ReadableStream API，但**没有 try/finally 保护**，也没有 AbortController。fetch 请求会一直跑到结束。

#### 代码位置

`src/services/aiService.ts:443-501`

#### 修复方案

引入 `AbortController`，支持外部取消：

```typescript
// 修复后
async function doStreamFetch(
  baseUrl: string,
  apiKey: string,
  body: string,
  candidateLabel: string,
  callbacks: { onToken: (t: string) => void; onComplete: (t: string) => void },
  signal?: AbortSignal,  // 🆕 接收外部信号
): Promise<string> {
  const response = await fetchWithTimeout(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { ... },
    body,
    timeout: 180000,
    signal,  // 🆕 传给 fetch
  });

  // ...
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取流式响应');

  try {   // 🆕 try/finally 保护
    // ... 原有的 while 循环
    callbacks.onComplete(fullText);
    return fullText;
  } finally {
    reader.releaseLock();   // 🆕 确保释放锁
  }
}
```

调用方（`chatStore`）持有一个全局 `AbortController`，切对话时 abort 它。

#### 验证方法

1. 开始一次长流式回复
2. 立即切换到另一对话
3. 打开 DevTools → Network，确认旧请求状态变为 `canceled`

---

### 死板 3：proactiveReplyStore 重复实现 getAdaptiveMaxTokens

#### 症状（维护性问题）

修 `aiService.ts` 的 `getAdaptiveMaxTokens` 时，`proactiveReplyStore.ts` 不会跟着更新——行为分裂。

#### 根因

`proactiveReplyStore.ts:16` 自己又写了一份同名函数（1 个参数版），逻辑不同。

#### 修复方案

删除 `proactiveReplyStore.ts:16` 的本地实现，改为 import：

```typescript
// 修复后（proactiveReplyStore.ts 顶部）
import { getAdaptiveMaxTokens } from '../services/aiService';

// 删除本地的 function getAdaptiveMaxTokens(...) { ... }
```

调用处补齐参数：

```typescript
// 修复前
const maxTokens = getAdaptiveMaxTokens(convLen);

// 修复后
const maxTokens = getAdaptiveMaxTokens(content, convLen, emotion);
```

---

### 死板 4：错字/口语化概率全硬编码

#### 症状

V2 配置面板号称"可调"，实际只能开关、不能调概率。所有概率写死在 `pipelineSteps.ts`。

#### 修复方案

把概率抽到配置接口：

```typescript
// pipelineSteps.ts 修改 TonePolishConfig
export interface TonePolishConfig extends StepEnabledConfig {
  emotionExpressions: Record<string, string[]>;
  prefixProbBase: number;     // 🆕
  prefixProbScale: number;    // 🆕
  suffixProbBase: number;     // 🆕
  suffixProbScale: number;    // 🆕
}

export const DEFAULT_TONE_POLISH_CONFIG: TonePolishConfig = {
  enabled: true,
  emotionExpressions: {},
  prefixProbBase: 0.06,
  prefixProbScale: 0.06,
  suffixProbBase: 0.08,
  suffixProbScale: 0.08,
};

// handle 内
const prefixProb = this.config.prefixProbBase + (intensity / 100) * this.config.prefixProbScale;
```

UI 侧（V2SettingsPanel）暴露滑块。

---

### 重复 1：情绪映射表散落 6 处

#### 症状

新增一个情绪类型（如 `jealousy`），要改 6 个文件。

#### 修复方案

统一到 `src/utils/constants.ts` 单一来源：

```typescript
// constants.ts 新增
export const EMOTION_DIMENSION_TO_TYPE: Record<EmotionDimension, EmotionType> = {
  joy: 'joy', sadness: 'sadness', anger: 'anger', fear: 'fear',
  // ... 完整映射
};

export const EMOTION_TYPE_TO_DIMENSION: Partial<Record<EmotionType, EmotionDimension>> =
  Object.fromEntries(
    Object.entries(EMOTION_DIMENSION_TO_TYPE).map(([k, v]) => [v, k])
  );
```

其他文件全部 import，删除本地映射表。

---

### 重复 2：默认角色硬编码

#### 症状

增删内置角色必须改代码 + 重新发版。

#### 修复方案

把 `defaultCharacters` 挪到 `public/builtin-characters.json`，启动时加载。

---

## 📋 总修复路线图

```
第一波（30 分钟 - 半天）─────────────────
 ├─ Bug 2  主动代谢失效              [10 分钟]
 ├─ Bug 4  分段情绪硬编码            [30 分钟]
 ├─ Bug 6  RAF 不取消                [10 分钟]
 └─ Bug 5  Pipeline 顺序错误         [30 分钟]
 → 产出：v1.3.3，情绪与分段行为修复

第二波（2-3 天）─────────────────────
 ├─ Bug 1  三套情绪逻辑统一          [1 天]
 ├─ Bug 3  两份 getDominant 合并     [0.5 天]
 ├─ 死板 1/2  adaptive 函数重写      [0.5 天]
 └─ 配套测试                         [0.5 天]
 → 产出：v1.4.0，真正"灵动"起来

第三波（1-2 周）─────────────────────
 ├─ Bug 7  流式加 AbortController    [0.5 天]
 ├─ 死板 3 删除重复 adaptive         [10 分钟]
 ├─ 死板 4 概率外置到 config         [0.5 天]
 ├─ 重复 1 情绪映射表统一            [0.5 天]
 └─ 重复 2 内置角色挪到 JSON         [0.5 天]
 → 产出：v1.5.0，架构清爽
```

---

## 🎯 验收 Checklist

每修一个 bug，对照确认：

### 第一波
- [ ] Bug 2：调试日志能看到"解析到代谢建议"，anger 真的会降
- [ ] Bug 4：分段回复的所有段落 emotion 一致
- [ ] Bug 6：流式中切对话不再有"幽灵更新"
- [ ] Bug 5：Pipeline 分段数 = 实际发送段数

### 第二波
- [ ] Bug 1：全项目搜 `updateMultiEmotionState` 无结果
- [ ] Bug 3：全项目只有一份 `getDominant*` 实现
- [ ] 死板 1/2：单元测试覆盖各情绪 × 长度组合

### 第三波
- [ ] Bug 7：Network 面板能看到流被 canceled
- [ ] 死板 3：全项目搜 `function getAdaptiveMaxTokens` 只有一处定义
- [ ] 死板 4：V2 设置面板有概率滑块
- [ ] 重复 1：新增情绪类型只需改 1 个文件
- [ ] 重复 2：`public/builtin-characters.json` 存在并被加载

---

## 📚 延伸：通用经验总结

### 1. "症状修复" vs "根因修复"

Bug 4 是典型案例——开发者发现分段显示不对，写死 `neutral` 让显示不报错，但没解决"分段应共享情绪"的本质。**遇到 bug 多问一句"为什么会这样"，而不是"怎么让报错消失"**。

### 2. "渐进重构未完成"的信号

- 同一概念有多份实现（Bug 1：三套情绪更新）
- 函数名相似但行为不同（Bug 3：getDominant vs getDominantEmotion）
- 新代码用了旧代码没用的参数（死板 1：参数声明了没用）

看到这些信号，说明有"未完成的重构"，应当补完而非放任。

### 3. "死板感"的来源

代码死板的本质是**"该多维的写成一维"**：
- 只看对话长度（死板 1/2）
- 只按阶梯函数返回（vs 连续函数）
- 概率写死不可调（死板 4）

让代码"灵动"的核心是**引入更多维度的输入 + 连续化的输出**。

### 4. 异步原语必须配对清理

| 创建 | 清理 |
|------|------|
| `setTimeout` | `clearTimeout` |
| `setInterval` | `clearInterval` |
| `requestAnimationFrame` | `cancelAnimationFrame` |
| `fetch` | `AbortController.abort()` |
| `addEventListener` | `removeEventListener` |

**规则：只要写了"创建"，就一定要写"清理"，且清理必须在 `finally` 或 cleanup 函数里**。

---

## 文档变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| V1.0 | 2026-07-19 | 初始版本，覆盖 12 个核心问题的修复方案与教学 |

---

> **学习建议**：第一波的 4 个 bug 最适合作为入门——每个都很小、根因清晰、修复 diff 明确。建议按 Bug 2 → 4 → 6 → 5 的顺序动手，每修一个就提交一次，配合"验证方法"确认效果，建立手感后再挑战第二波的架构重构。
