# 优化执行方案 V1.0
## —— 基于 2026-07-19 复审的真实当前状态

> **文档版本**：V1.0
> **创建日期**：2026-07-19
> **复审基准**：工作区当前快照（非历史审计）
> **预估工时**：8-15 天
> **优先级**：🔥🔥🔥🔥

---

## 〇、为什么有这份文档

[06-engineering-audit.md](file:///c:/Users/nujia/Documents/trae_projects/Chat/docs/upgrade-plans/06-engineering-audit.md) 是"诊断书"——列出所有问题。
本文档是"手术方案"——**基于复审后的真实状态**，给出每项具体改什么、改哪里、怎么验证。

> ⚠️ **重要前提**：自 06 审计以来，**P0 的大部分项已经被修复**。本文档不再重复已完成项，只聚焦"还差什么"。

---

## 一、复审结果：已完成 vs 待办

### ✅ 已完成（无需再动）

| 原编号 | 项目 | 验证证据 |
|--------|------|---------|
| P0-1 | identifier / productName / version 统一 | `tauri.conf.json` → `com.xingmian.app` / "星眠" / `1.3.0`；`package.json` 同步 |
| P0-2 | CSP 白名单 | `tauri.conf.json` security.csp 已配置完整策略 |
| P0-4 | files 表建表顺序 + 版本化迁移 | `db.rs:69` `run_migrations` 用 `PRAGMA user_version`，dedup 加了 `EXISTS` 保护 |
| P1-2（部分） | .gitignore 补全 | `recover/`、`xingmian/`、`*.zip`、`crash*.log` 等已写入 |
| P1-4 | README 已知 bug 标注 | "重读修正"标记"已移除"；"主动回复"改为"实验性，默认关闭" |
| P2-1 Step1 | tsconfig noUnused 系列 | `noUnusedLocals/Parameters/forceConsistentCasingInFileNames` 已开启 |
| P2-3 | CI 配置 | `.github/workflows/ci.yml` 已建立，前后端 lint+check+test 全覆盖 |
| P2-4 | 数据库迁移版本化 | `run_migrations` 完整实现 |
| P3-3 | emotion_records 复合索引 | `idx_emotion_records_char` 已建 |

**结论**：06 文档里 9 项 P0/P2/P3 中的 9 项已完成。项目工程健康度从 ⭐⭐ 提升到 ⭐⭐⭐⭐。

---

### ❌ 待办清单（按当前真实优先级重排）

| 新编号 | 原编号 | 项目 | 当前状态 | 紧迫度 |
|--------|--------|------|---------|--------|
| **T1** | P0-3 | API Key 明文存储 | 🔴 仍明文（`db.rs:119`） | 🔥🔥🔥🔥🔥 |
| **T2** | P1-2 | 残留文件清理 + 开源目录管理 | 🟠 `recover/`、`crash*.log` 仍在；`xingmian/` 为**开源发布文件夹**需管理 | 🔥🔥🔥🔥 |
| **T3** | P1-3 | 孤儿组件接入 | 🟠 V2SettingsPanel/V2DebugDashboard 仍未 import | 🔥🔥🔥 |
| **T4** | P1-1 | 上帝文件拆分 | 🟠 5 个文件仍 70-149 KB | 🔥🔥🔥 |
| **T5** | P2-2 | 工程测试补充 | 🟡 仍只有 1 个测试文件 | 🔥🔥 |
| **T6** | P2-1 Step2-4 | strict 模式深化 | 🟡 Step1 完成，Step2-4 待做 | 🔥🔥 |
| **T7** | P3 | 小优化批处理 | 🟡 10 项里 7 项待做 | 🔥 |

---

## 二、T1 — API Key 加密存储（最高优先级）

### 2.1 当前问题

```rust
// src-tauri/src/db.rs:119
api_key TEXT NOT NULL DEFAULT '',  // ← 明文，任何同用户进程可读
```

**风险**：SQLite 文件位于 `%APPDATA%/com.xingmian.app/chat.db`，明文密钥可被同用户身份的任何进程直接读取；备份导出时密钥随 JSON 明文写出。

### 2.2 方案 B 实现（推荐，3 天）

采用 **Windows DPAPI + 跨平台回退**。原则：DB 不存明文，只存密文；解密在 Rust 侧完成，前端永远拿不到明文以外的形式（其实前端拿到明文是为了发给 API，所以解密后直接在 Rust 的 HTTP 代理层使用，前端完全不接触密钥更佳——见 2.3 进阶）。

**Step 1：Cargo.toml 加依赖**
```toml
# src-tauri/Cargo.toml
[dependencies]
# Windows 用 DPAPI
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Security_Cryptography",
    "Win32_Security_Cryptography_DataProtection",
] }
# 跨平台兜底（macOS/Linux）
[target.'cfg(not(windows))'.dependencies]
keyring = "2"
```

**Step 2：新建加密模块 `src-tauri/src/crypto.rs`**
```rust
use std::error::Error;

/// 加密：明文 → base64 密文（带 `enc:` 前缀以便识别）
pub fn encrypt(plaintext: &str) -> Result<String, Box<dyn Error>> {
    #[cfg(windows)]
    {
        use windows::Win32::Security::Cryptography::DataProtection::*;
        // CryptProtectData 绑定当前用户，换机/换用户即无法解密
        let bytes = plaintext.as_bytes();
        // ... 调用 CryptProtectData（略，约 20 行）
        Ok(format!("enc:{}", base64::encode(cipher_bytes)))
    }
    #[cfg(not(windows))]
    {
        // macOS/Linux 用 keyring 存 OS 密钥库
        // 简化版：用机器 ID 派生密钥 + AES-GCM
        Ok(format!("enc:{}", /* AES 加密结果 */))
    }
}

/// 解密：`enc:xxx` → 明文；非 `enc:` 前缀的视为历史明文（兼容旧数据）
pub fn decrypt(stored: &str) -> Result<String, Box<dyn Error>> {
    if !stored.starts_with("enc:") {
        return Ok(stored.to_string());  // 兼容旧明文，平滑迁移
    }
    // ... 解密逻辑
}
```

**Step 3：迁移逻辑（在 `run_migrations` 末尾追加 v7）**
```rust
// db.rs run_migrations 的 migrations 数组追加
(7, "UPDATE platforms SET api_key = '' WHERE api_key = ''"),  // 占位，实际迁移见下
```
> ⚠️ SQL 迁移无法调用 Rust 加密函数。正确做法是在 `init_db` 里、`run_migrations` 之后，**用 Rust 代码遍历 platforms 表，把所有非 `enc:` 前缀的 api_key 加密回写**。一次性迁移，幂等（已是 `enc:` 前缀则跳过）。

**Step 4：所有 `save_platforms` / `get_platforms` 命令加解密包装**
- 写入前：`api_key = crypto::encrypt(&api_key)?`
- 读出后：`api_key = crypto::decrypt(&api_key)?`

### 2.3 进阶：前端零密钥架构（可选，+2 天）

更彻底的方案——**前端完全不持有 API Key**：
1. 前端调 `invoke("proxy_chat_request", { platform_id, messages })`
2. Rust 侧解密 Key、组装 HTTP 请求、流式返回
3. 前端只看到流式 token，永远拿不到 Key

**收益**：即使 WebView 被完全攻破，XSS 也偷不到密钥。
**代价**：丧失前端灵活切换 baseUrl 的便利；需在 Rust 侧重新实现 streaming 解析。

> 建议：T1 先做 2.2 的方案 B（3 天），下个迭代再评估 2.3。

---

## 三、T2 — 残留文件清理与开源目录管理（0.5 天）

### 3.1 当前状态

| 路径 | 性质 | 状态 |
|------|------|------|
| `xingmian/` | **开源发布文件夹**（含完整源码副本 + 版本 zip 包） | ✅ 正常保留 |
| `recover/` | 旧代码快照副本（非开源） | ❌ 应清理 |
| `crash.log` / `crash_log.txt` | 运行时崩溃残留 | ❌ 应清理 |
| `stderr.txt` / `stdout.txt` | 调试重定向残留 | ❌ 应清理 |
| `README_v1.3.0.md` | 与 `README.md` 内容重叠 | ❌ 应归档 |
| `nul` | Windows 误操作空文件 | ✅ 已清理 |

> ⚠️ **重要修正**：`xingmian/` **不是僵尸目录**，是项目的开源发布物文件夹（含 v1.0~v1.3 的 zip 分发包 + 对外源码）。不应删除，也不应被 `.gitignore` 忽略。

### 3.2 执行命令

```powershell
cd C:\Users\nujia\Documents\trae_projects\Chat

# 1. 仅清理非开源残留
Remove-Item -Recurse -Force recover
Remove-Item -Force crash.log, crash_log.txt, stderr.txt, stdout.txt

# 2. README_v1.3.0.md 归档（不直接删）
New-Item -ItemType Directory -Force docs\archive
Move-Item README_v1.3.0.md docs\archive\README_v1.3.0.md
```

### 3.3 `.gitignore` 修正

当前 `.gitignore` 包含 `xingmian/`，这会阻止开源发布文件夹被跟踪。应移除此行，**让 `xingmian/` 进入版本管理**（或通过 git submodule 引用独立开源仓库）。

**方案 A：直接纳入主仓库**（简单，适合小团队）
```gitignore
# 移除此行：
# xingmian/

# 替换为仅忽略其中的 zip/7z（产物不入仓库）：
xingmian/*.zip
xingmian/*.7z
xingmian/*.rar
```

**方案 B：独立开源仓库 + submodule**（推荐，适合正式开源）
```powershell
# 1. 把 xingmian/ 初始化为独立仓库
cd xingmian
git init
git add .
git commit -m "xingmian v1.3 开源发布"
# 推送到 GitHub（例）
git remote add origin https://github.com/yourname/xingmian.git
git push -u origin main

# 2. 回到主项目，用 submodule 引用
cd ..
git rm -r --cached xingmian
git submodule add https://github.com/yourname/xingmian.git xingmian
git commit -m "feat: xingmian 作为 submodule 引入"
```

**方案 B 的优势**：
- 开源仓库可以独立打 tag / 发 release（zip 包从 release 上传，不污染主仓库）
- 主仓库 `.gitignore` 保持 `xingmian/` 忽略（submodule 机制替代）
- 开源仓库与闭源主仓库的 commit 历史解耦，闭源调试代码不会泄漏到开源

### 3.4 验证

```powershell
# 确认 recover/ 已删除
Test-Path recover   # 应为 False

# 确认 xingmian/ 完好
Test-Path xingmian  # 应为 True

# 确认 xingmian/ 内无敏感信息（api_key 全为空）
Select-String -Path xingmian\public\config.yaml -Pattern 'sk-' | Measure-Object
# 应为 0
```

---

## 四、T3 — 接入孤儿组件（1 天）

### 4.1 当前状态

```
src/components/settings/V2SettingsPanel.tsx   (11.7 KB，已写好，0 处 import)
src/components/debug/V2DebugDashboard.tsx      (已写骨架，0 处 import)
```

全局搜索 `import.*V2SettingsPanel` / `import.*V2DebugDashboard` 均为 **0 处引用**。

### 4.2 接入方案

**方案 A：直接挂到现有 SettingsPage（最小侵入）**

先定位 SettingsPage 现有的 Tab 结构：
```powershell
# 查 SettingsPage 的 Tab 定义
Select-String -Path src\components\common\SettingsPage.tsx -Pattern 'tab|Tab' | Select -First 20
```

然后在合适位置插入：
```tsx
// src/components/common/SettingsPage.tsx
import { V2SettingsPanel } from '../settings/V2SettingsPanel';

// 在现有 Tab 列表里新增一项
<Tab trigger="V2 高级设置">
  <V2SettingsPanel />
</Tab>
```

**方案 B：在 Debug 路由下挂 V2DebugDashboard**

```tsx
// 找到 Debug 面板入口（可能在 sidebar 或 settings）
import { V2DebugDashboard } from '../debug/V2DebugDashboard';

// 挂载
<Route path="debug-v2" element={<V2DebugDashboard />} />
```

### 4.3 执行步骤

1. 先 `npm run dev` 跑起来，确认两个组件能正常 render（不报错）
2. 按 A/B 方案接入
3. 进入对应面板，确认 UI 显示
4. 如果 V2SettingsPanel 需要从 `configStore` 读写数据（见 [05-todo-and-gaps.md](file:///c:/Users/nujia/Documents/trae_projects/Chat/docs/upgrade-plans/05-todo-and-gaps.md) 第 2.3 节），补上数据绑定
5. 接入后在 05 第 2.3/2.4 节把状态从"UI已写待绑定"更新为"已接入"

---

## 五、T4 — 上帝文件拆分（4-6 天）

### 5.1 当前规模

| 文件 | 行数 | 大小 |
|------|------|------|
| `src/components/common/SettingsPage.tsx` | 3086 | 149.4 KB |
| `src/services/aiService.ts` | 2159 | 90.2 KB |
| `src-tauri/src/commands.rs` | 2220 | 86.4 KB |
| `src/store/chatStore.ts` | 1627 | 71.4 KB |
| `src/lib/tauriBridge.ts` | 1432 | 42 KB |

### 5.2 拆分顺序（按收益/风险比）

**第 1 步：`commands.rs` 拆分（3 天，低风险）**

Rust 模块拆分是纯机械操作，行为完全等价，风险最低：

```
src-tauri/src/
├── lib.rs                  // invoke_handler 里把 commands::xxx 改成 commands::xxx::xxx
├── db.rs
├── commands/
│   ├── mod.rs              // pub mod debug_logs; pub mod characters; ...
│   ├── debug_logs.rs       // 从 commands.rs 剪切
│   ├── characters.rs
│   ├── conversations.rs
│   ├── memories.rs
│   ├── emotions.rs
│   ├── files.rs
│   ├── bots.rs
│   ├── backups.rs
│   ├── mbti.rs
│   ├── ui_config.rs
│   └── platforms.rs
└── bot/...
```

**操作流程**：
1. 新建 `commands/` 目录与 `mod.rs`
2. `lib.rs` 顶部加 `mod commands;`（替换原 `mod commands;`，路径不变）
3. 按域把函数从 `commands.rs` 剪切到对应子文件
4. 每个子文件加 `use crate::db::{DbState, ...};` 等必要 import
5. `lib.rs` 的 `invoke_handler!` 把 `commands::get_xxx` 改为 `commands::debug_logs::get_xxx` 等
6. `cargo check` 验证

**验证标准**：`cargo build` 通过 + 所有 Tauri 命令行为不变（手动测试 2-3 个关键命令）。

**第 2 步：`SettingsPage.tsx` 拆分（2 天，可与 T3 合并做）**

参见 06 文档 P1-1C，拆分时顺便接入 V2SettingsPanel（T3）。

**第 3 步：`aiService.ts` 拆分（2-3 天，需谨慎）**

这是核心业务文件，拆分需保证：
- 先加测试覆盖（T5）再拆，否则无法验证等价性
- 按已有 `services/{memory,output,emotion,learning}/` 子目录归类

**第 4 步：`chatStore.ts` / `tauriBridge.ts`（可选）**

这两个拆分收益相对低，可在 T4 主干完成后择机做。

---

## 六、T5 — 工程测试补充（2-3 天）

### 6.1 当前状态

- 仅 `src/__tests__/v2-systems.test.ts`（41 用例，全针对纯算法）
- CI 已配置 `npm test`，但跑的只有这一份
- 零覆盖：所有 store、Tauri 命令、prompt 构造、组件

### 6.2 优先补的测试（按价值）

| # | 测试目标 | 文件路径 | 类型 | 工时 |
|---|---------|---------|------|------|
| 1 | prompt 构造快照 | `src/__tests__/aiService.prompt.test.ts` | 快照 | 0.5 天 |
| 2 | outputPipeline 全链路 | `src/__tests__/outputPipeline.test.ts` | 单测 | 0.5 天 |
| 3 | edgeProtection 防护 | `src/__tests__/edgeProtection.test.ts` | 单测 | 0.5 天 |
| 4 | Rust db 迁移 | `src-tauri/src/db.rs` 内 `#[cfg(test)]` | Rust 单测 | 0.5 天 |
| 5 | chatStore 核心动作 | `src/__tests__/chatStore.test.ts` | 单测 | 0.5 天 |

### 6.3 示例：prompt 快照测试骨架

```typescript
// src/__tests__/aiService.prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../services/aiService';
import { mockCharacter, mockEmotionState } from './fixtures';

describe('buildSystemPrompt', () => {
  it('包含角色基本信息', () => {
    const prompt = buildSystemPrompt(mockCharacter, mockEmotionState);
    expect(prompt).toContain(mockCharacter.name);
    expect(prompt).toContain(mockCharacter.personality);
  });

  it('快照稳定（变更需审查）', () => {
    const prompt = buildSystemPrompt(mockCharacter, mockEmotionState);
    expect(prompt).toMatchInlineSnapshot();  // 或 toMatchSnapshot()
  });

  it('情绪低落时语气变化', () => {
    const sadState = { ...mockEmotionState, sadness: 80 };
    const prompt = buildSystemPrompt(mockCharacter, sadState);
    expect(prompt).toContain('低落');
  });
});
```

### 6.4 Rust 迁移测试骨架

```rust
// src-tauri/src/db.rs 文件末尾
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // 复用 init_db 的建表 SQL（需重构为可测试函数）
        conn
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = in_memory_db();
        run_migrations(&conn).unwrap();
        // 二次执行不应报错
        run_migrations(&conn).unwrap();
    }

    #[test]
    fn migration_v5_adds_character_id_column() {
        let conn = in_memory_db();
        run_migrations(&conn).unwrap();
        // 验证 emotion_records 表有 character_id 列
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(emotion_records)").unwrap()
            .query_map([], |r| r.get::<_, String>(1)).unwrap()
            .filter_map(|r| r.ok()).collect();
        assert!(cols.contains(&"character_id".to_string()));
    }
}
```

---

## 七、T6 — strict 模式深化（持续）

### 7.1 当前状态

```json
// tsconfig.json
"strict": false,                        // ❌ 未开
"noUnusedLocals": true,                 // ✅ 已开
"noUnusedParameters": true,             // ✅ 已开
"forceConsistentCasingInFileNames": true,  // ✅ 已开
"noFallthroughCasesInSwitch": false,    // ❌ 未开
```

### 7.2 下一步：Step 2

开启 `noFallthroughCasesInSwitch` + `noImplicitReturns`：

```json
"noFallthroughCasesInSwitch": true,
"noImplicitReturns": true,
```

```powershell
npm run check   # 看新增错误数，预计 10-20 处
```

逐个修复（通常是 switch 漏写 `break` 或函数路径漏 `return`）。

### 7.3 长期：Step 3-4

- `strictNullChecks`（2-3 天，预计 100-200 处错误）
- `strict: true` 全开（1-2 天）

建议在 T4 拆分完 `aiService.ts` 后再做 Step 3——拆分后单文件更小，修 null 检查更容易。

---

## 八、T7 — 小优化批处理（1-2 天）

### 8.1 仍未做的 P3 项

| # | 问题 | 当前证据 | 修复 |
|---|------|---------|------|
| P3-1 | `db.rs:107/109` `.expect()` panic 风险 | 仍存在 | 改 `?` 上抛 |
| P3-2 | `lib.rs:113` `.expect()` 启动失败无日志 | 仍存在 | 接 `tauri-plugin-log` |
| P3-4 | `vite-plugin-trae-solo-badge` 推广徽章 | 仍在 `vite.config.ts` | 评估移除或保留 |
| P3-5 | `rusqlite 0.31` 编译慢 | 仍是 0.31 | 升 0.32 |
| P3-6 | `aiService.ts` 40 处 console.* | 仍在 | 接 debug 分级日志 |
| P3-7 | JSON-in-TEXT 字段无 schema 校验 | 仍存在 | 加 zod |
| P3-8 | 外键约束关闭 | `PRAGMA foreign_keys = OFF` | 评估开启 |
| P3-10 | 错误消息直接暴露 | 仍存在 | 封装 AppError |

### 8.2 快速修复（P3-1、P3-2，0.5 天）

```rust
// src-tauri/src/db.rs:103-109 改为
pub fn init_db(app: &AppHandle) -> SqlResult<()> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(
            Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
        ))?;

    std::fs::create_dir_all(&app_data_dir)?;  // 去掉 .expect
    // ...
}
```

```rust
// src-tauri/src/lib.rs:110-113 改为
.run(tauri::generate_context!())
.unwrap_or_else(|e| {
    log::error!("启动失败: {}", e);
    std::process::exit(1);
});
```

---

## 九、整体执行路线图

```
Week 1 ─────────────────────────────────────────────
 ├─ T1  API Key 加密（方案 B）              [3 天] ← 最高优先
 ├─ T2  残留文件清理 + 开源目录管理         [0.5 天]
 └─ T7a P3-1/P3-2 expect 修复               [0.5 天]
 → 产出：v1.3.2，安全短板补齐

Week 2 ─────────────────────────────────────────────
 ├─ T3  接入 V2SettingsPanel/V2DebugDashboard [1 天]
 ├─ T4a commands.rs 拆分到 commands/        [3 天]
 └─ T6  Step 2：开启 noFallthrough/implicitReturn [0.5 天]
 → 产出：v1.4.0，可维护性显著提升

Week 3-4 ───────────────────────────────────────────
 ├─ T5  补 5 类工程测试                     [2-3 天]
 ├─ T4b SettingsPage.tsx 拆分（合并 T3）    [2 天]
 └─ T7b 其余 P3 小优化                      [1 天]
 → 产出：v1.4.1

Week 5+ ────────────────────────────────────────────
 ├─ T4c aiService.ts 拆分（需 T5 先行）     [2-3 天]
 ├─ T6  Step 3-4：strictNullChecks → strict  [持续]
 └─ T1  进阶：前端零密钥架构（可选）         [2 天]
 → 产出：v1.5.0
```

**总工时**：乐观 7.5 天 / 中性 11.5 天 / 悲观 14 天。

---

## 十、最终验收 Checklist

发布前逐项确认（基于当前真实状态）：

- [ ] `chat.db` 中 `platforms.api_key` 字段全部为 `enc:` 前缀密文
- [ ] 工作区根目录无 `recover/`、`crash*.log`、`stderr.txt`（`xingmian/` 保留为开源发布文件夹）
- [ ] `xingmian/` 内 `config.yaml` 的 apiKey 全为空（无敏感信息泄漏）
- [ ] `xingmian/` 已通过 submodule 管理或纳入版本控制
- [ ] `V2SettingsPanel` 已出现在某个设置 Tab 中并可交互
- [ ] `V2DebugDashboard` 已挂到 Debug 路由下
- [ ] `commands/` 目录已建立，`commands.rs` 不再存在或仅剩 re-export
- [ ] CI 在 main 分支绿色通过，且包含至少 2 个测试文件
- [ ] `db.rs:107-109` 不再使用 `.expect()`
- [ ] `npm run check` 在 `noFallthroughCasesInSwitch: true` 下通过
- [ ] 全新安装（删除 app_data_dir 后）首启不报错（验证 T1 迁移）
- [ ] 老版本 api_key 明文数据被自动加密迁移（启动后 `SELECT api_key FROM platforms` 全为 `enc:`）

---

## 十一、文档变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| V1.0 | 2026-07-19 | 基于 06 审计后的真实状态复审，重新梳理待办为 T1-T7，剔除已完成项，给出每项的具体代码修改方案 |
| V1.1 | 2026-07-19 | **重要修正**：`xingmian/` 是开源发布文件夹而非僵尸目录，T2 整节重写；补充 submodule 管理方案；工时从 8-15 天调整为 7.5-14 天 |

---

> **备注**：本文档是 06 的"执行版"。06 回答"有什么问题"，本文档回答"现在还差什么、怎么改"。完成 T1-T2 后即可标记 v1.3.2 发布。

> ⚠️ **关于 `xingmian/` 目录**：`xingmian/` 是项目的**开源发布文件夹**（含源码副本 + v1.0~v1.3 的 zip 分发包），不是僵尸目录。不应删除。建议通过 git submodule 管理（见 T2 §3.3 方案 B）。
