<div align="center">
  <img src="./image/xingmian.jpg" alt="星眠" width="120" style="border-radius: 20px;" />
  <h1>星眠</h1>
  <p>✨ 拟人化 AI 对话助手 · 情感陪伴 · 角色扮演</p>
</div>

---

## 简介

星眠是一款基于 **React + TypeScript + Vite + Tauri 2.x** 的桌面端 AI 聊天应用，专注于拟人化角色扮演和情感陪伴体验。通过丰富的角色设定、情绪模拟、记忆系统和好感度演化，让 AI 角色不再是冰冷的工具，而是有温度、有个性的陪伴者。

---

## 功能详解

### 🎭 角色系统
支持三种创建方式来打造独一无二的 AI 角色：

- **面板创建** — 5 步可视化向导，逐步填写角色信息（姓名、性格、背景、情绪规则、交互规则等）
- **简易文档创建** — 直接上传 JSON / MD / TXT 文件，通过文档编辑器快速导入角色设定
- **AI 辅助创建** — 通过对话告诉 AI 你想要的角色，AI 会引导你一步步完善设定，最终自动生成角色

### 💝 好感度系统
角色会对用户产生好感度变化，共 13 个阶段（陌生人 → 亲密无间），根据对话内容动态调整：

- 积极互动 → 好感度上升
- 负面行为 → 好感度下降
- 不同好感度阶段影响角色的语气、态度和行为

### 😊 情绪引擎
27 种情绪状态，角色会根据对话内容产生真实的情绪反应：

- **基础情绪**：愉悦、悲伤、愤怒、恐惧、惊讶、厌恶
- **复合情绪**：感动、嫉妒、委屈、焦虑、期待、失落等
- 情绪强度可调节，不同强度影响回复风格
- 情绪历史记录，可以看到角色情绪变化轨迹

### 🧠 记忆系统
自动从对话中提取重要信息，构建角色的长期记忆：

- **关键记忆提取** — 自动识别并存储对话中的重要事件和用户信息
- **分层存储** — 短期记忆 → 长期记忆 → 核心记忆
- **记忆回顾** — 角色在对话中可以引用过往记忆
- **重要性阈值** — 可调节记忆提取的敏感度

### 📖 学习系统
AI 会持续学习用户的对话风格，让角色越来越懂你：

- 提取用户的拟人化表达特征（语气词、句式、情感表达）
- 学习间隔可配置（按对话轮数或定时触发）
- 词汇和句式库持续积累，融入角色回复

### 🔮 反思能力
角色会对过往对话进行反思和总结，形成更深层的理解：

- **对话总结** — 每次对话结束后生成摘要
- **思想生成** — 角色会对特定事件产生思考
- **反思条目** — 跨对话的深度反思，影响角色价值观

### 📊 MBTI 性格测试
内置完整的 MBTI 测试系统：

- 93 道标准测试题目
- 自动计算性格维度（EI/SN/TF/JP）
- 测试结果融入用户画像，影响角色对用户的认知
- 支持重新测试，历史记录保存

### 🔧 输出处理管线
AI 回复经过多层处理，确保质量和角色一致性：

- ⚠️ **重读修正（有 bug）** — AI 对回复进行二次审核和修正（建议关闭）
- 格式清洗 — 去除多余标记和格式问题
- 角色一致性检查

### 🗄️ 数据备份
- 手动备份和自动备份
- 支持备份恢复
- 备份包含所有角色、对话、记忆、情绪数据

### 🤖 机器人集成（实验性）
支持接入外部聊天平台：

- **NapCat** — QQ 机器人接入
- **WeChat** — 微信机器人接入
- 消息自动同步，角色可在多个平台使用

---

## 技术栈

| 层 | 技术 |
|------|---------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 6 |
| 样式方案 | Tailwind CSS 3 + Framer Motion |
| 状态管理 | Zustand |
| 路由 | React Router v7 |
| 桌面框架 | Tauri 2.x |
| 后端语言 | Rust |
| 数据库 | SQLite (via rusqlite) |
| API 支持 | OpenAI / Anthropic / DeepSeek / 硅基流动 等 |

---

## 目录结构

```
xingmian/
├── image/                      # App 图片资源
├── public/
│   └── config.yaml             # API 配置模板（需自行填写密钥）
├── src/
│   ├── components/
│   │   ├── backup/             # 备份管理
│   │   ├── character/          # 角色创建/编辑/选择
│   │   ├── chat/               # 对话界面（输入/气泡/表情/打字指示）
│   │   ├── common/             # 通用组件（设置/API配置/文件管理/时间线）
│   │   ├── debug/              # 调试日志面板
│   │   ├── emotion/            # 情绪面板 + 粒子动画效果
│   │   ├── learning/           # 学习状态面板
│   │   ├── mbti/               # MBTI 性格测试
│   │   ├── memory/             # 记忆管理面板
│   │   ├── settings/           # 外部集成设置
│   │   ├── sidebar/            # 对话列表侧边栏
│   │   └── userProfile/        # 用户资料编辑
│   ├── handlers/               # 机器人消息处理
│   ├── hooks/                  # 自定义 Hooks
│   ├── lib/                    # 工具库（Tauri Bridge / 数据迁移）
│   ├── services/               # AI 服务 + 输出处理管线 + 文本清洗
│   ├── store/                  # Zustand 状态管理（20+ store）
│   ├── types/                  # TypeScript 类型定义
│   └── utils/                  # 工具函数（情感分析/导出/MD解析等）
├── src-tauri/
│   ├── src/
│   │   ├── main.rs             # Tauri 入口
│   │   ├── lib.rs              # 应用初始化与命令注册（60+ 命令）
│   │   ├── commands.rs         # Tauri 命令实现
│   │   ├── db.rs               # SQLite 数据库（22+ 表）
│   │   └── bot/                # 机器人集成（NapCat / WeChat）
│   ├── icons/                  # 应用图标（16 个尺寸）
│   ├── Cargo.toml              # Rust 依赖
│   └── tauri.conf.json         # Tauri 配置
├── image/                      # 应用宣传图
├── package.json
├── start.bat                   # 一键启动脚本
└── README.md
```

---

## 部署与构建

### 环境要求

| 依赖 | 版本要求 | 安装方式 |
|------|---------|---------|
| Node.js | >= 18 | https://nodejs.org |
| Rust | stable | https://rustup.rs |
| Tauri CLI | ^2.0 | `cargo install tauri-cli --version "^2.0"` |

**Windows 额外要求：**
- WebView2（Win10+ 自带）
- Microsoft Visual Studio Build Tools（[下载](https://visualstudio.microsoft.com/visual-cpp-build-tools/)）— 安装时勾选"使用 C++ 的桌面开发"

### 快速开始

```bash
# 1. 克隆项目
git clone <你的仓库地址>
cd xingmian

# 2. 安装前端依赖
npm install

# 3. 配置 API 密钥
# 编辑 public/config.yaml，填入你的 API 密钥

# 4. 启动开发模式
npx tauri dev
```

或者双击 `start.bat` 一键启动（需要先完成步骤 2 和 3）。

### 构建安装包

```bash
npx tauri build
```

构建产物位置：
- **Windows**: `src-tauri/target/release/bundle/msi/` 或 `nsis/`
- **macOS**: `src-tauri/target/release/bundle/dmg/`
- **Linux**: `src-tauri/target/release/bundle/deb/` 或 `appimage/`

### 仅 Web 预览（无 Tauri 功能）

```bash
npm run dev        # 开发模式（仅前端）
npm run build      # 构建前端产物
npm run preview    # 预览构建产物
```

### NPM Scripts

| 命令 | 说明 |
|------|------|
| `npm run dev` | Vite 开发服务器 |
| `npm run build` | TypeScript 检查 + Vite 构建 |
| `npm run preview` | 预览构建产物 |
| `npm run lint` | ESLint 代码检查 |
| `npm run check` | TypeScript 类型检查 |

---

## 配置说明

### API 配置

编辑 `public/config.yaml`，配置你要使用的 AI 平台：

```yaml
platforms:
  - displayName: OpenAI
    enabled: true
    apiKey: "sk-your-api-key"      # 填入你的密钥
    baseUrl: "https://api.openai.com/v1"
    models:
      - name: "gpt-4o"
        type: chat
        enabled: true
```

支持多平台同时配置，前端设置页面可切换使用的平台和模型。

---

## 注意事项

### ⚠️ 重读修正（有 bug）
输出处理管线中的"重读"功能（AI 回复后让 AI 再次审核修正）存在已知 bug，可能导致回复异常或循环。**建议在设置中关闭此功能。**

### ⚠️ 主动回复（有 bug）
AI 在用户长时间未发言时主动发起对话的功能存在 bug，可能导致异常唤醒或无意义的主动消息。**建议在设置中关闭此功能。** 如果你仍想使用，请密切关注 API 调用情况，避免产生意外费用。

---

## 版本

**v1.0.0**

---

## 许可证

MIT
