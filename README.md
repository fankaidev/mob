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
| **AI** | pi-mono (流式 + 工具调用) |
| **集成** | Slack Events API, isomorphic-git, just-bash |

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
| `web_fetch` | 获取网页内容 |
| `mount` | 挂载 Git 仓库 |
| `unmount` | 卸载挂载点 |
| `list-mounts` | 列出当前挂载 |

> 💡 **直接执行 bash**: 消息以 `!` 开头可以绕过 AI 直接执行 bash 命令，例如 `!ls -la`

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
- API Key 存储在 D1 数据库

## 快速开始

### 环境要求
- Node.js >= 20.0.0
- Cloudflare 账户
- Wrangler CLI

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
├── client/           # 前端代码 (React)
├── routes/           # HTTP 路由 (API, Admin, Slack, Web)
├── durable-objects/  # Durable Objects (ChatSession)
└── lib/              # 核心库
    ├── pi-agent/     # Agent 框架
    ├── pi-ai/        # LLM 接口层
    ├── fs/           # 文件系统抽象
    ├── tools/        # Agent 工具实现
    └── slack/        # Slack 集成
```

## 数据库模式

项目使用 8 张表:

| 表名 | 用途 |
|------|------|
| `sessions` | 会话元数据 |
| `messages` | 聊天消息存储 |
| `files` | 虚拟文件系统 |
| `mounts` | Git 挂载配置 |
| `llm_configs` | LLM 配置 |
| `slack_apps` | Slack 应用配置 |
| `slack_thread_mapping` | Slack 线程到会话映射 |
| `slack_users` | Slack 用户信息缓存 |

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

> ⚠️ **安全提示**: Admin API 应通过 Cloudflare Access 保护，避免未授权访问。

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

## 设计原则

### Fail Fast, Fail Explicitly

本项目遵循"快速失败，明确失败"的原则：

- **不要静默处理异常情况**：当遇到不应该发生的情况时，立即抛出错误而不是尝试修复
- **不要使用 fallback 隐藏 bug**：如果某个值不符合预期，报错而不是回退到默认值
- **让问题尽早暴露**：在开发阶段发现并修复问题，而不是在生产环境中出现神秘的行为

**示例**：
```typescript
// ❌ 错误：静默处理 ID 不匹配
if (event.sessionId !== sessionId) {
  setSessionId(event.sessionId)  // 隐藏了潜在的 bug
}

// ✅ 正确：立即报错
if (event.sessionId !== sessionId) {
  throw new Error(`Session ID mismatch! Expected: ${sessionId}, Got: ${event.sessionId}`)
}
```

这个原则帮助我们：
- 更快地发现和定位 bug
- 避免数据不一致
- 保持代码的可预测性
- 提高系统的可维护性

## 已知问题

- **Durable Object `state.id.name` 问题**：由于 Cloudflare Workers [bug #2240](https://github.com/cloudflare/workerd/issues/2240)，我们通过 HTTP header 传递 session ID 而非依赖 `state.id.name`。详见 [#22](https://github.com/fankaidev/mob/issues/22)

## License

MIT
