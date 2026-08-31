# 工程审计与优化方案 V1.0
## —— 安全、架构、发布前必修项（功能层之外的"工程健康度"）

> **文档版本**：V1.0
> **创建日期**：2026-07-19
> **审计范围**：代码组织、安全性、可维护性、构建发布、工程化基础设施
> **审计对象**：星眠（Chat）当前工作区
> **预估工时**：12-23 天
> **优先级**：🔥🔥🔥🔥 发布前必读

---

## 〇、本文档在文档体系中的位置

`docs/upgrade-plans/` 已有 01-05 共五份**功能层**升级文档（情感/记忆/输出/自学习/待办），关心的是"AI 能做什么、做得够不够好"。

本文档是**第六份**，关心的是**完全不同的维度**：

| 维度 | 已有文档（01-05） | 本文档（06） |
|------|-----------------|------------|
| 关注点 | AI 拟人化能力 | 代码本身健康度 |
| 视角 | 产品功能 | 工程基础设施 |
| 典型问题 | "思维链是否接入主流程" | "CSP 是否关闭、API Key 是否明文" |
| 失败后果 | 用户体验一般 | 安全事故、无法发布、维护困难 |
| 时间紧迫度 | 按路线图推进 | **发布前必须解决 P0** |

两者**互补不重叠**。建议先读完本文档的 P0 部分，再回到 01-05 推进功能升级。

> **与 [05-todo-and-gaps.md](file:///c:/Users/nujia/Documents/trae_projects/Chat/docs/upgrade-plans/05-todo-and-gaps.md) 的关系**：05 已识别"测试/持久化/UI 绑定"等功能层缺口，但**未覆盖**安全/架构/发布工程。本文档在第 4 节给出两者交叉项的对照表，避免重复建议。

---

## 一、TL;DR — 执行摘要

### 1.1 六维度评分

| 维度 | 评分 | 一句话结论 |
|------|------|-----------|
| 功能完整度 | ⭐⭐⭐⭐⭐ | 拟人化核心功能非常丰富，README 自述详尽 |
| 类型安全 | ⭐⭐⭐ | `tsc` 通过，但 `strict: false`，存在 4-6 处 `any`/文件 |
| 代码组织 | ⭐⭐ | 多个 1500+ 行"上帝文件"，模块边界模糊 |
| 安全性 | ⭐⭐ | CSP 关闭、API Key 明文、identifier 仍是模板默认值 |
| 工程化 | ⭐⭐ | 无 CI、无迁移版本号、测试仅覆盖纯算法 |
| 可发布性 | ⭐⭐ | 元数据不一致、僵尸目录 26 MB、README 列已知 bug |

### 1.2 核心结论

产品功能成熟，但"工程外壳"还没跟上产品成熟度。**当前状态不建议直接打包发布**，需先完成下文 P0 级别修复。

### 1.3 工时预估（与 [00-implementation-roadmap.md](file:///c:/Users/nujia/Documents/trae_projects/Chat/docs/upgrade-plans/00-implementation-roadmap.md) 格式对齐）

| 阶段 | 乐观 | 中性 | 悲观 |
|------|------|------|------|
| P0 发布阻塞项 | 5 天 | 7 天 | 9 天 |
| P1 架构重构 | 4 天 | 6 天 | 8 天 |
| P2 工程化 | 2 天 | 4 天 | 6 天 |
| P3 小优化 | 1 天 | 3 天 | — |
| **合计** | **12 天** | **20 天** | **23 天** |

> 与 01-05 功能升级路线图（18-29 天）**可部分并行**：P0 必须先做，P1/P2 可与功能升级穿插进行。

---

## 二、问题清单（按优先级分级）

### 🔴 P0 — 发布阻塞项（必须修，否则不能打包发版）

#### P0-1. 应用标识符仍是 Tauri 脚手架默认值

**证据**：
```json
// src-tauri/tauri.conf.json
"identifier": "com.tauri.dev",   // ← Tauri 官方示例值！
"productName": "AI Chat",
"version": "0.1.0"
```
```json
// package.json
"name": "trae-project",
"version": "0.0.0"
```
```html
<!-- index.html -->
<title>My Trae Project</title>
```

**为何严重**：
- `identifier` 是操作系统层识别应用的唯一标识。Windows 用它写注册表、macOS 用它做 Bundle ID、所有 `app_data_dir` / `app_config_dir` 路径都绑定它。
- 一旦用户安装，**之后再改 identifier 会丢失所有历史数据**（旧 SQLite、备份、UI 配置全部找不到了）。
- `com.tauri.dev` 是 Tauri 官方示例值，与所有用脚手架创建且没改名的人撞 ID。

**修复**：
```json
// tauri.conf.json
"productName": "星眠",
"version": "1.3.0",
"identifier": "com.xingmian.app"
```
```json
// package.json
"name": "xingmian",
"version": "1.3.0"
```
```html
<!-- index.html -->
<title>星眠</title>
```

> ⚠️ **数据迁移风险**：若已有内测用户安装过 `com.tauri.dev` 版本，需配套写一个 identifier 迁移脚本（把旧 app_data_dir 的数据搬到新路径），否则老用户升级即丢数据。建议在首次启动检测旧路径存在时弹窗引导。

---

#### P0-2. CSP 完全关闭

**证据**：
```json
// src-tauri/tauri.conf.json
"security": { "csp": null }
```

**为何严重**：
WebView 会渲染大量不可信内容——用户上传的角色 JSON、Bot 接收到的 QQ/微信消息、URL/远程壁纸。在 CSP 关闭的情况下，任何一处 XSS 可直接调用 Tauri IPC（`invoke`），进而读写 SQLite、调用文件系统、取出 API Key 发往外部。

**修复**：在 `tauri.conf.json` 配置白名单 CSP：
```json
"security": {
  "csp": "default-src 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.openai.com https://*.anthropic.com https://*.deepseek.com https://*.siliconflow.cn https://*.groq.com https://generativelanguage.googleapis.com https://*; font-src 'self' data:"
}
```

> `connect-src` 用 `https://*` 是兜底（因为用户可自定义 baseUrl）；若要更严格，可在运行时按用户配置的 baseUrl 动态生成 CSP 并通过 Tauri 的动态 CSP 注入。

---

#### P0-3. API Key 明文存储于 SQLite

**证据**：
```rust
// src-tauri/src/db.rs
CREATE TABLE IF NOT EXISTS platforms (
    ...
    api_key TEXT NOT NULL DEFAULT '',  // 明文存储
    ...
)
```

**为何严重**：
- SQLite 文件位于 `%APPDATA%/com.tauri.dev/chat.db`，**任何运行在同一用户身份下的进程都能直接打开读取**（恶意软件、其他无关应用、磁盘取证）。
- 备份导出 JSON 时（`backups` 表 `data_json`），密钥随备份文件一起以明文写出，用户往往把备份放到网盘 → 密钥外泄。

**修复方案（按推荐度排序）**：

| 方案 | 复杂度 | 安全度 | 说明 |
|------|-------|-------|------|
| A. 操作系统密钥库 | 中 | ⭐⭐⭐⭐⭐ | 用 `keyring` crate 接 Windows Credential Manager / macOS Keychain / Linux Secret Service。DB 只存 platform id，密钥不入库 |
| B. DPAPI 加密后入库 | 低 | ⭐⭐⭐⭐ | Windows 用 `dpapi` 绑定用户态加密；跨平台用 `age` 或 `ring` + 机器 ID 派生密钥 |
| C. Stronghold | 高 | ⭐⭐⭐⭐⭐ | Tauri 官方 `tauri-plugin-stronghold`，IOTA 加密存储，但集成成本高 |

**短期建议**：方案 B（一周内可完成）；**长期目标**：方案 A。

---

#### P0-4. `files` 表创建顺序缺陷

**证据**：
```rust
// src-tauri/src/db.rs:354
// 这段在 init_db 末尾执行，但 files 表并不在本文件创建
let _ = conn.execute(
    "DELETE FROM files WHERE id NOT IN (SELECT MIN(id) FROM files GROUP BY filename, size)",
    [],
);
// files 表实际定义在 src-tauri/src/commands.rs:1470 和 1990（重复两次！）
```

**为何严重**：
- 全新安装时 `init_db` 执行 dedup 语句会因 `files` 表不存在抛错——虽然 `let _ =` 静默吞掉，但**首次启动行为不可预测**。
- 表结构散落两处，schema 漂移风险高。

**修复**：
1. 把 `files` 的 `CREATE TABLE IF NOT EXISTS` 从 `commands.rs` 删除，**统一**移到 `db.rs::init_db`。
2. `init_db` 末尾的 dedup 语句改为判断表存在后再执行：
   ```rust
   conn.execute(
       "DELETE FROM files WHERE id NOT IN (
           SELECT MIN(id) FROM files GROUP BY filename, size
       ) WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='files')",
       [],
   ).ok();
   ```

---

### 🟠 P1 — 架构 / 可维护性

#### P1-1. 上帝文件清单（God Files）

| 文件 | 行数 | 大小 | 问题 |
|------|------|------|------|
| `src/components/common/SettingsPage.tsx` | ~3500 | **149 KB** | 单文件聚合所有设置面板 |
| `src/services/aiService.ts` | 1856 | 90 KB | 记忆/embedding/对话/prompt 拼装全在一起 |
| `src-tauri/src/commands.rs` | 1904 | 88 KB | 80+ 个 Tauri 命令挤在一起 |
| `src/store/chatStore.ts` | 1489 | 71 KB | Zustand store 过载 |
| `src/lib/tauriBridge.ts` | 1290 | 42 KB | 所有 IPC 封装堆叠 |

**影响**：
- 热重载慢、TypeScript 增量编译慢
- code review 困难，merge conflict 高发
- 新人无法快速定位逻辑

**拆分方案**：

**(A) Rust 后端拆分**（成本最低，收益最高）：
```
src-tauri/src/
├── lib.rs                  // 只留 setup + invoke_handler 注册
├── db.rs                   // 所有 CREATE TABLE 集中
├── commands/
│   ├── mod.rs              // pub use ...
│   ├── debug_logs.rs       // 8 个命令
│   ├── characters.rs       // 角色 CRUD
│   ├── conversations.rs    // 对话/消息
│   ├── memories.rs         // 记忆/回想
│   ├── emotions.rs         // 情绪
│   ├── files.rs            // 文件存储
│   ├── bots.rs            // Bot 集成
│   ├── backups.rs          // 备份
│   ├── mbti.rs             // MBTI
│   ├── ui_config.rs        // UI 配置
│   └── platforms.rs        // API 平台配置
└── bot/...
```

**(B) 前端 `aiService.ts` 拆分**：项目已有 `services/{emotion,memory,output,learning,persistence}/` 子目录雏形，继续把 `aiService.ts` 里：
- `calculateMemoryClarity` / `updateMemoryClarity` / `generateEmbedding` → `services/memory/`
- prompt 构建相关函数 → 新建 `services/prompt/`
- `doFetch` / `doStreamFetch` → `services/api/transport.ts`
- 仅留顶层编排函数 `generateReply()` 在 `aiService.ts`

**(C) `SettingsPage.tsx` 拆分**：
```
src/components/settings/
├── SettingsPage.tsx        // 仅做 Tab 容器
├── AppearanceTab.tsx       // 外观
├── ApiConfigTab.tsx        // 复用现有 APIConfigPage
├── IntegrationTab.tsx      // 复用现有 IntegrationPage
├── BackupTab.tsx           // 复用现有 BackupPanel
├── ModelRoleTab.tsx
└── AboutTab.tsx
```

> 拆分 (C) 时可顺便合并已写好但未接入的 `V2SettingsPanel.tsx`（见 P1-3）。

---

#### P1-2. 残留文件清理与开源目录管理

**证据**：
| 路径 | 大小 | 性质 |
|------|------|------|
| `xingmian/` | 25.7 MB | **开源发布文件夹**（源码副本 + v1.0~v1.3 的 zip 分发包），`config.yaml` 中 apiKey 全为空 ✅ |
| `recover/` | 0.5 MB | 旧代码快照副本（非开源） |
| `nul` | 0 B | Windows 误操作产生的空文件 |
| `crash.log` / `crash_log.txt` | — | 运行时崩溃残留 |
| `stderr.txt` / `stdout.txt` | — | 调试重定向残留 |
| `README_v1.3.0.md` | 21 KB | 与 `README.md` 内容高度重叠 |

> ⚠️ **重要说明**：`xingmian/` **不是僵尸目录**，是项目的开源发布文件夹。详见 [07-optimization-execution-plan.md](file:///c:/Users/nujia/Documents/trae_projects/Chat/docs/upgrade-plans/07-optimization-execution-plan.md) T2 §3.3 的 submodule 管理方案。

**修复**：

1. `.gitignore` 调整（不再忽略 `xingmian/` 目录本身，仅忽略其中的 zip 产物）：
```gitignore
# 开源发布目录（仅忽略产物，目录本身应入版本管理或作为 submodule）
xingmian/*.zip
xingmian/*.7z
xingmian/*.rar

# 非开源残留（应清理）
recover/
nul
crash*.log
crash*.txt
stderr.txt
stdout.txt

# 旧版本文档
README_v*.md

# 编辑器
.trae/
.codebuddy/
.vscode/
.idea/
```

2. 清理非开源残留（**不要删 xingmian/**）：
```powershell
Remove-Item -Recurse -Force recover
Remove-Item -Force nul, crash.log, crash_log.txt, stderr.txt, stdout.txt
```

3. 把 `README_v1.3.0.md` 内容合并进 `README.md`，旧版本归档到 `docs/archive/README_v1.x.md`。
4. `xingmian/` 建议通过 git submodule 管理为独立开源仓库（见 07 执行方案 T2 §3.3 方案 B）。

---

#### P1-3. 孤儿组件：写了但从未接入

**证据**（本次审计新发现）：
```
src/components/settings/V2SettingsPanel.tsx   (11.7 KB，已写好)
src/components/debug/V2DebugDashboard.tsx      (已写骨架)
```
全局搜索 `import.*V2SettingsPanel` / `import.*V2DebugDashboard` —— **0 处引用**。

**与 05-todo-and-gaps.md 的对照**：05 第 2.3/2.4 节标记为"UI已写待绑定"，但实际是**完全没接入主路由/主组件**，比 05 描述的更严重。

**为何严重**：
- 用户在 SettingsPage 里根本看不到 V2 设置面板 → 调不了任何 V2 参数
- V2 调试仪表盘同理 → 开发者无法可视化调试
- 代码"看起来完成"但实际 dead code，维护时容易被误删

**修复**：
1. `SettingsPage.tsx` 拆分时（见 P1-1C）把 `V2SettingsPanel` 作为新 Tab 接入
2. 或在 Debug 路由下挂载 `V2DebugDashboard`
3. 接入后更新 05 第 2.3/2.4 节状态从"UI已写待绑定"→"已接入"

---

#### P1-4. README 自述"已知 bug 未修"

**证据**（README.md 第 331-337 行）：
```
### ⚠️ 重读修正（有 bug）
... 建议在设置中关闭此功能。
### ⚠️ 主动回复（有 bug）
... 建议在设置中关闭此功能。
```

**问题**：
- 带已知 bug 发布是产品质量红线
- "建议关闭"是文档承诺，但代码默认值未必是关闭

**修复**：
1. 在 issue tracker 中建立独立 issue 跟踪
2. 在代码里**强制 `default: false`**（仅靠文档不可靠）
3. 修完前在 UI 设置项上加红色"实验性"标签 + 确认弹窗

---

### 🟡 P2 — 工程化 / 质量保障

#### P2-1. TypeScript 配置过松

**证据**：
```json
// tsconfig.json
"strict": false,
"noUnusedLocals": false,
"noUnusedParameters": false,
"noFallthroughCasesInSwitch": false,
"forceConsistentCasingInFileNames": false
```

**影响**：
- `aiService.ts` / `tauriBridge.ts` / `chatStore.ts` 各有 4-6 处 `any`
- 未使用变量、隐式 `any` 全部漏检
- 重构时类型系统提供不了保护

**分阶段开启计划**（避免一次性炸出几百个错误）：

| 阶段 | 开启项 | 预计错误数 | 工作量 |
|------|-------|----------|-------|
| Step 1 | `noUnusedLocals`, `noUnusedParameters`, `forceConsistentCasingInFileNames` | 50-100 | 0.5 天 |
| Step 2 | `noFallthroughCasesInSwitch`, `noImplicitReturns` | 10-20 | 0.5 天 |
| Step 3 | `strictNullChecks` | 100-200 | 2-3 天 |
| Step 4 | `strict: true`（剩余全开） | 50 | 1-2 天 |

> 05 第 323 行已声明"类型检查 100% 通过"——指的是当前 `strict: false` 下的通过，开启 strict 后会有大量新错误，需重新评估。

---

#### P2-2. 测试覆盖严重不足

> **与 05 第 2.5/3.4 节交叉**：05 已识别测试缺口，但仅从"V2 算法测试"角度。本节补充**工程测试视角**。

**现状**：
- 仅 1 个测试文件 `src/__tests__/v2-systems.test.ts`，41 个用例
- 全部针对 `services/{memory,output,emotion,learning}/` 的**纯算法**
- 零覆盖：21 个 store、所有 Tauri 命令、所有 React 组件、prompt 构造逻辑、Bot 通信
- **无 CI 自动运行测试**——测试是否通过全靠开发者手动 `npm test`

**工程测试补充目标**（与 05 的算法测试互补）：

| 优先级 | 测试对象 | 类型 | 理由 |
|-------|---------|------|------|
| ⭐⭐⭐ | `aiService.ts` 的 prompt 构造 | 快照测试 | 产品核心逻辑，改一处影响全部对话 |
| ⭐⭐⭐ | `outputPipeline.ts` / `edgeProtection.ts` | 单测 | AI 腔检测、注入检测是安全防线 |
| ⭐⭐ | `db.rs` 建表 + 迁移 | Rust `#[cfg(test)]` | 防止 P0-4 这类问题再现 |
| ⭐⭐ | 核心 store（`chatStore` / `memoryStore`） | 单测 | 数据流核心 |
| ⭐ | 关键组件（`MessageBubble` / `InputArea`） | RTL 组件测试 | 防回归 |

---

#### P2-3. 无 CI / CD

**证据**：项目根目录无 `.github/workflows/`、无 `.gitlab-ci.yml`。

**最小可用 CI**（GitHub Actions 示例）：
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm run check
      - run: npm test
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo check --manifest-path src-tauri/Cargo.toml
      - run: cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
      - run: cargo test --manifest-path src-tauri/Cargo.toml
```

> 05 第 184 行提到"配置 vitest 测试环境"——CI 应包含此步骤，确保测试在每次提交时自动运行。

---

#### P2-4. 数据库迁移机制脆弱

**证据**：当前迁移是一连串 `let _ = conn.execute("ALTER TABLE ... ADD COLUMN ...", [])`，静默吞错、无版本号、不可重入。

**优化**：引入 `PRAGMA user_version` 版本化迁移：

```rust
// db.rs
fn run_migrations(conn: &Connection) -> Result<(), String> {
    let current: u32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let migrations: &[(u32, &str)] = &[
        (1, "ALTER TABLE messages ADD COLUMN attachments TEXT"),
        (2, "ALTER TABLE messages ADD COLUMN recalled INTEGER NOT NULL DEFAULT 0"),
        (3, "ALTER TABLE emotion_records ADD COLUMN character_id TEXT"),
        (4, "CREATE INDEX IF NOT EXISTS idx_emotion_records_char ON emotion_records(character_id)"),
        // ... 后续新增迁移追加在此
    ];

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (version, sql) in migrations {
        if *version > current {
            tx.execute(sql, []).map_err(|e| e.to_string())?;
        }
    }
    tx.execute(
        &format!("PRAGMA user_version = {}", migrations.len()),
        [],
    ).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
```

---

### 🟢 P3 — 小改进 / 优化

| # | 问题 | 修复 |
|---|------|------|
| P3-1 | `db.rs:72-74` 用 `.expect()` 取 app_data_dir，失败即 panic | 改用 `?` 上抛错误 |
| P3-2 | `lib.rs:112` `.expect("error while running...")` 启动失败无日志 | 接 `tauri-plugin-log`，失败写日志文件 |
| P3-3 | `emotion_records` 加了 `character_id` 列但无复合索引 | 加 `CREATE INDEX idx_emotion_char_time ON emotion_records(character_id, timestamp DESC)` |
| P3-4 | `vite-plugin-trae-solo-badge` 会向生产构建注入推广徽章 + `clickUrl` | 正式发布"星眠"前评估移除 |
| P3-5 | `rusqlite 0.31 + bundled` 编译慢 | 评估升级到 `0.32`，或用 `bundled-sqlcipher-vendored-openssl` 顺带加密（一举解决 P0-3） |
| P3-6 | `aiService.ts` 有 40 处 `console.*` | 用 `debug` 库做分级日志，生产构建自动剔除 |
| P3-7 | `model_roles.config_json` 等 JSON-in-TEXT 字段无 schema 校验 | 用 zod 在 Tauri 命令入口做反序列化校验 |
| P3-8 | 22+ 张表无外键约束（`PRAGMA foreign_keys = OFF`） | 评估开启外键，或在应用层补关系约束 |
| P3-9 | `dist/` 存在于工作区但被 gitignore，未做清理自动化 | `npm run dev` 启动前自动 `rimraf dist`，避免脏构建 |
| P3-10 | 错误消息直接 `e.to_string()` 暴露给前端 | 统一封装 `AppError` 类型，对敏感错误脱敏 |

---

## 三、推荐执行顺序与里程碑

```
Week 1 ─────────────────────────────────────────────
 ├─ P0-1  统一 identifier / productName / version   [0.5 天]
 ├─ P0-4  files 表建表顺序修复                       [0.5 天]
 ├─ P1-2  .gitignore 补全 + 清理僵尸目录             [0.5 天]
 └─ P3-3  emotion_records 索引补全                   [0.5 天]
 → 产出：v1.3.1 候选构建

Week 2 ─────────────────────────────────────────────
 ├─ P0-2  CSP 白名单配置 + 联调所有 API 平台         [2 天]
 ├─ P0-3  API Key 加密存储（方案 B：DPAPI）          [3 天]
 └─ P1-4  "已知 bug" 改默认关闭 + 标"实验性"          [0.5 天]
 → 产出：可安全发布的 v1.4.0

Week 3-4 ───────────────────────────────────────────
 ├─ P1-1A commands.rs 拆分到 commands/ 子模块        [3 天]
 ├─ P1-3  接入孤儿组件 V2SettingsPanel/Dashboard     [1 天]
 ├─ P2-3  GitHub Actions CI 搭建                     [1 天]
 └─ P2-1  Step 1-2：开启 noUnused* 系列检查          [1 天]
 → 产出：v1.4.1，可维护性显著提升

Week 5-6 ───────────────────────────────────────────
 ├─ P1-1B aiService.ts 拆分到 services/ 子目录       [4 天]
 ├─ P1-1C SettingsPage.tsx 拆分                      [3 天]
 └─ P2-2  prompt 构造 + 输出管线的单测               [3 天]
 → 产出：v1.5.0

Week 7+ ────────────────────────────────────────────
 ├─ P2-1  Step 3-4：strictNullChecks → strict: true  [持续]
 ├─ P2-4  数据库迁移版本化重构                        [2 天]
 ├─ P0-3  API Key 升级到方案 A（OS 密钥库）           [3 天]
 └─ P3    其余小优化逐项消化
```

> **与 01-05 功能路线图的协同**：P0 阶段（Week 1-2）建议**暂停功能开发**集中修复；P1/P2 阶段可与 01-05 的功能升级穿插，例如拆分 `aiService.ts`（P1-1B）正好与 02 记忆系统升级、04 自学习升级并行。

---

## 四、与现有文档（01-05）的交叉项对照

为避免与已有功能层文档重复建议，下表明确"哪些话题归 05 管、哪些归本文档管"：

| 话题 | 05-todo-and-gaps 视角 | 本文档视角 | 归属 |
|------|---------------------|----------|------|
| 测试 | "V2 算法测试用例已写"（第 2.5 节） | "无 CI、store/Rust 零覆盖"（P2-2/P2-3） | **互补**：05 管算法测试，本文管工程测试 + CI |
| 持久化 | "接口已写待调用"（第 2.1 节） | 不涉及 | **归 05** |
| 设置面板 | "UI已写待绑定"（第 2.3 节） | "孤儿组件未接入主路由"（P1-3） | **本文更深入**：05 说"待绑定"，实际是"完全没接入" |
| 调试面板 | "骨架完成待绑数据"（第 2.4 节） | 同上（P1-3） | **本文更深入** |
| 类型检查 | "100% 通过"（第 323 行） | "strict 关闭，开启后会爆错误"（P2-1） | **本文补充**：05 的结论基于 `strict:false` |
| 已知 bug | 不涉及 | "README 列 2 个未修 bug"（P1-4） | **归本文档** |
| 安全（CSP/Key/identifier） | 不涉及 | P0-1/2/3 | **归本文档**（05 完全未覆盖） |
| 架构（上帝文件拆分） | 不涉及 | P1-1 | **归本文档** |
| 发布工程（CI/迁移/清理） | 不涉及 | P2-3/4, P1-2 | **归本文档** |

> 建议本文档落地后，在 05 顶部加一行交叉引用："工程层缺口见 [06-engineering-audit.md](file:///c:/Users/nujia/Documents/trae_projects/Chat/docs/upgrade-plans/06-engineering-audit.md)"。

---

## 五、验收 Checklist

发布前请逐项确认：

- [ ] `tauri.conf.json` 的 `identifier` 不再是 `com.tauri.dev`
- [ ] `productName` / `package.json.name` / `index.html <title>` / 文档品牌名一致
- [ ] `version` 在 `package.json`、`tauri.conf.json`、README 中三处一致
- [ ] `tauri.conf.json` 的 `security.csp` 不为 `null`
- [ ] `chat.db` 中 `platforms.api_key` 字段为密文或已迁出
- [ ] 全新安装（删除 app_data_dir 后）首启不报错
- [ ] `.gitignore` 包含 `recover/`、`xingmian/`、`*.zip`、`crash*.log`
- [ ] 工作区根目录无 `nul`、`crash.log`、`stderr.txt` 等残留
- [ ] README 中"已知 bug"对应功能默认关闭
- [ ] `V2SettingsPanel` / `V2DebugDashboard` 已接入主路由
- [ ] CI 在 main 分支绿色通过
- [ ] `npm run lint` / `npm run check` / `npm test` / `cargo clippy` 全部通过
- [ ] 旧版本 identifier 迁移脚本（若有内测用户）经过测试

---

## 六、附录：审计过程关键数据

| 指标 | 数值 |
|------|------|
| Git 跟踪文件数 | 99 |
| 前端 `.ts`/`.tsx` 文件 ≥ 20 KB | 15 个 |
| 最大单文件 | `SettingsPage.tsx` 149 KB |
| Rust 最大单文件 | `commands.rs` 88 KB / 1904 行 |
| Tauri 命令数 | 80+ |
| 测试文件数 | 1 |
| 测试用例数 | 41 |
| `unwrap()` 出现次数（Rust 业务代码） | 0 ✅ |
| SQL 参数化覆盖率 | 100% ✅ |
| `dangerouslySetInnerHTML` / `eval` 出现次数 | 0 ✅ |
| 孤儿组件（写了未 import） | 2 个（V2SettingsPanel / V2DebugDashboard） |
| 僵尸目录占用空间 | 26.2 MB |
| TypeScript strict 模式 | 关闭 ❌ |
| CI 配置 | 无 ❌ |

---

## 七、文档变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| V1.0 | 2026-07-19 | 初始版本，基于工作区源码审计编制。覆盖安全/架构/发布工程层缺口，与 01-05 功能层文档互补 |

---

> **备注**：本文档随项目进展动态更新。P0 修复完成后建议做一次复审，重点验证 CSP 联调、API Key 加密、identifier 迁移是否真正落地。
