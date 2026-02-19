# Mob Agent

基于 Cloudflare Workers 的 AI Agent，支持多会话、工具调用、Git 仓库挂载和 Slack 集成。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Browser)                       │
│              React 19 + TypeScript + Vite                   │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / EventStream (SSE)
┌────────────────────────▼────────────────────────────────────┐
│                  Cloudflare Workers Edge                    │
│  ├─ Hono Web Framework                                      │
│  ├─ Routes (API, Admin, Slack, Web)                         │
│  └─ Durable Objects (ChatSession)                           │
└────────┬─────────────┬──────────────────┬───────────────────┘
         │             │                  │
    ┌────▼───┐   ┌─────▼─────┐    ┌──────▼──────┐
    │   D1   │   │ Git Clone │    │  Slack API  │
    │ SQLite │   │ (isogit)  │    │   (xoxb)    │
    └────────┘   └───────────┘    └─────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │    Anthropic API    │
                              │   (Claude Models)   │
                              └─────────────────────┘
```

### 技术栈

| 层级 | 技术 |
|------|------|
| **Frontend** | React 19, TypeScript, Vite |
| **Backend** | Hono, Cloudflare Workers |
| **状态管理** | Durable Objects |
| **数据存储** | Cloudflare D1 (SQLite) |
| **AI** | Anthropic Claude API (流式 + 工具调用) |
| **集成** | Slack Events API, isomorphic-git |

## 核心功能

### 1. 多会话聊天
- 创建、切换、删除独立会话
- 消息历史持久化到 D1 数据库
- 流式响应 (Server-Sent Events)

### 2. Agent 工具调用
Agent 支持以下工具:

| 工具 | 功能 |
|------|------|
| `read` | 读取文件内容 |
| `write` | 创建或覆盖文件 |
| `edit` | 查找替换编辑 |
| `list` | 列出目录内容 |
| `bash` | 执行 bash 命令 |
| `mount` | 挂载 Git 仓库 |
| `unmount` | 卸载挂载点 |
| `list-mounts` | 列出当前挂载 |

### 3. 文件系统
- 基于 D1 的虚拟文件系统
- `/work` 目录跨会话共享
- 支持 Git 仓库克隆和挂载到 `/mnt`
- 完整的 bash 命令支持 (grep, sed, awk, find 等)

### 4. Slack 集成
- 多应用支持 (每个应用可配置不同 LLM)
- @mention 触发对话
- 线程上下文保持
- 签名验证 (HMAC-SHA256)

### 5. LLM 配置管理
- 支持多个 LLM 配置 (Anthropic/OpenAI/OpenRouter)
- Web UI 配置管理
- API Key 安全存储

## 快速开始

### 环境要求
- Node.js 18+
- npm 或 pnpm
- Cloudflare 账户 (用于 D1 数据库)

### 安装步骤

```bash
# 1. 安装依赖
npm install

# 2. 设置 D1 数据库
npm run setup:d1

# 3. 启动开发服务器
npm run dev
```

访问 http://localhost:8787

点击 **Settings** 配置 API Key 和 LLM 参数。

### 部署

```bash
npm run deploy
```

## 项目结构

```
src/
├── index.ts                    # Worker 入口
├── types.ts                    # 环境类型定义
│
├── client/                     # 前端代码
│   ├── index.tsx               # React 入口
│   ├── App.tsx                 # 主应用组件 (会话管理、消息处理)
│   └── components/
│       ├── ChatMessage.tsx     # 消息渲染组件
│       └── SettingsModal.tsx   # 配置管理面板
│
├── routes/                     # HTTP 路由
│   ├── api.ts                  # 会话/消息 API
│   ├── admin.ts                # LLM/Slack 配置管理
│   ├── slack.ts                # Slack Events webhook
│   └── web.tsx                 # HTML Shell
│
├── durable-objects/
│   └── ChatSession.ts          # 会话 DO (Agent 执行、文件系统)
│
└── lib/                        # 核心库
    ├── pi-agent/               # Agent 框架
    │   ├── agent.ts            # Agent 类 (工具调用循环)
    │   ├── agent-loop.ts       # 执行循环逻辑
    │   └── types.ts            # 类型定义
    │
    ├── pi-ai/                  # LLM 接口层
    │   ├── providers/
    │   │   └── anthropic.ts    # Anthropic SDK 封装
    │   └── utils/              # 流处理、JSON解析等
    │
    ├── fs/                     # 文件系统抽象
    │   ├── d1-fs.ts            # D1 持久化文件系统
    │   ├── mountable-fs.ts     # 可挂载文件系统
    │   ├── git-fs.ts           # Git 克隆存储
    │   └── mount-store.ts      # 挂载配置持久化
    │
    ├── tools/                  # Agent 工具实现
    │   ├── file-tools.ts       # 文件操作 (read/write/edit/list)
    │   ├── bash.ts             # Bash 命令执行
    │   └── mount-tools.ts      # 挂载管理
    │
    └── slack/                  # Slack 集成
        ├── api.ts              # Slack API 客户端
        ├── signature.ts        # 签名验证
        └── thread-history.ts   # 线程历史处理
```

## 数据库模式

项目使用 7 张表:

| 表名 | 用途 |
|------|------|
| `sessions` | 会话元数据 |
| `messages` | 聊天消息存储 |
| `files` | 虚拟文件系统 |
| `mounts` | Git 挂载配置 |
| `llm_configs` | LLM 配置 |
| `slack_apps` | Slack 应用配置 |
| `slack_thread_mapping` | Slack 线程到会话映射 |

详见 `schema.sql`。

## API 端点

### 会话管理
```
GET    /api/sessions              # 获取会话列表
POST   /api/session/:id/chat      # 发送消息 (SSE 流式响应)
GET    /api/session/:id/history   # 获取消息历史
DELETE /api/session/:id           # 删除会话
```

### 管理接口
```
GET/POST/PUT/DELETE  /api/admin/llm-configs      # LLM 配置管理
GET/POST/PUT/DELETE  /api/admin/slack-apps       # Slack 应用管理
```

### Slack 集成
```
POST   /api/slack/events          # Slack Events API webhook
```

## 配置说明

### wrangler.jsonc
```jsonc
{
  "durable_objects": {
    "bindings": [
      { "name": "CHAT_SESSION", "class_name": "ChatSession" }
    ]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "mob-session" }
  ]
}
```

### LLM 配置示例
```json
{
  "name": "claude-sonnet",
  "provider": "anthropic",
  "base_url": "https://api.anthropic.com",
  "api_key": "sk-ant-...",
  "model": "claude-sonnet-4-20250514"
}
```

## 开发指南

### 本地开发
```bash
npm run dev        # Vite watch + Wrangler dev
```

### 构建
```bash
npm run build      # Vite 构建前端到 public/static/
```

### 数据库操作
```bash
# 本地执行 SQL
npx wrangler d1 execute mob-session --local --file=schema.sql

# 远程执行 SQL
npx wrangler d1 execute mob-session --remote --file=schema.sql
```

## License

MIT
