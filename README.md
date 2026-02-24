# Mob Agent

基于 Cloudflare Workers 的 AI Agent，支持多会话、工具调用、Git 仓库挂载和 Slack 集成。

## 系统架构

```

  ┌─────────────────┐       ┌─────────────────┐
  │    Frontend     │       │   Slack Events  │
  │ React + Vite    │       │   API (Webhook) │
  └────────┬────────┘       └────────┬────────┘
           │ HTTP/SSE                │ POST
           └───────────┬─────────────┘
                       ▼
  ┌─────────────────────────────────────────────┐
  │          Cloudflare Workers (Hono)          │
  │     Routes: /api, /api/admin, /api/slack    │
  └─────────────────────┬───────────────────────┘
                        ▼
  ┌─────────────────────────────────────────────┐
  │      ChatSession (Durable Object)           │
  │  ┌─────────────────────────────────────┐    │
  │  │            pi-agent                 │    │
  │  │  ┌───────────┐    ┌─────────────┐   │    │
  │  │  │   Tools   │    │   pi-ai     │───┼────┼──► LLM API
  │  │  └─────┬─────┘    └─────────────┘   │    │
  │  └────────┼────────────────────────────┘    │
  │           ▼                                 │
  │  ┌─────────────────────────────────────┐    │
  │  │         MountableFs                 │    │
  │  │  ┌─────────--──┐  ┌─────────────┐   │    │
  │  │  │ D1FileSystem│  │  Git Mount  │   │    │
  │  │  └─────┬────--─┘  └─────────────┘   │    │
  │  └────────┼────────────────────────────┘    │
  └───────────┼─────────────────────────────────┘
              ▼
  ┌─────────────────┐
  │   D1 (SQLite)   │
  └─────────────────┘
```

### 技术栈

| 层级         | 技术                       |
| ------------ | -------------------------- |
| **Frontend** | React 19, TypeScript, Vite |
| **Backend**  | Hono, Cloudflare Workers   |
| **状态管理** | Durable Objects            |
| **数据存储** | Cloudflare D1 (SQLite)     |
| **AI**       | pi-mono (流式 + 工具调用)  |
| **文件操作** | isomorphic-git, just-bash  |
| **集成**     | Slack API                  |

## 核心概念

### App (Slack App Configuration)

在本项目中，**"App"** 指的是 **Slack 应用配置**，存储在 `slack_apps` 表中。

- 每个 App 代表一个独立的 Slack bot
- 包含：bot token、signing secret、关联的 LLM 配置、自定义 system prompt
- 一个 Cloudflare Worker 实例可以同时服务多个 Slack apps
- 通过 `app_id` (Slack 的 App ID，如 `A01XXXXX`) 唯一标识

**示例场景**：
```
claude-bot    (app_id: A01ABC, 使用 Claude Sonnet)
gpt-helper    (app_id: A02DEF, 使用 GPT-4)
code-reviewer (app_id: A03GHI, 使用 Claude Opus, 自定义 prompt)
```

这些 bot 可以部署在同一个 Worker 中，共享基础架构但保持配置独立。

### Session (会话)

- 每个会话是一个独立的对话上下文
- Web UI 中的会话：通过 UI 手动创建
- Slack 中的会话：自动从 thread 映射创建（格式：`slack:{app_id}:{channel}:{thread_ts}`）
- 每个 session 对应一个 ChatSession Durable Object 实例

### 异步任务处理

当前系统使用 `executionCtx.waitUntil()` 处理异步任务：

- **Slack 消息处理**：webhook 收到请求后立即返回 200（3 秒内），实际处理在后台异步执行
- **避免超时**：Slack 要求 3 秒内响应，否则会重试 webhook
- **错误处理**：后台任务失败会发送错误消息到 Slack thread

### 定时任务

系统支持基于文件的定时任务配置：

- **配置方式**：每个 app 在 `/home/{agent_name}/crons.txt` 中定义任务
- **任务定义**：在 `/home/{agent_name}/commands/` 目录下创建 markdown 文件
- **调度精度**：最小 10 分钟间隔
  - 所有任务时间自动向上取整到 :00, :10, :20, :30, :40, :50
  - 例如：原定 09:07 执行 → 实际 09:10 执行
  - 推荐使用 10 分钟倍数的 cron 表达式（如 `*/10`, `*/20`, `*/30`）
  - 非 10 分钟倍数的表达式会在日志中显示警告
- **执行机制**：两步异步架构
  - Step 1: Cron Handler (每分钟扫描 `crons.txt`，创建 `.pending.json`)
  - Step 2: TaskExecutor DO (轮询执行 pending 任务，自适应间隔：1s/30s)
- **状态追踪**：`.pending.json` → `.running.json` → `.done.json`
- **错误通知**：失败时发送通知到 Slack 默认频道

## 核心功能

### 1. 多会话聊天
- 创建、切换、删除独立会话
- 消息历史持久化到 D1 数据库
- 流式响应 (Server-Sent Events)

### 2. Agent 工具调用
Agent 支持以下工具:

| 工具          | 功能           |
| ------------- | -------------- |
| `read`        | 读取文件内容   |
| `write`       | 创建或覆盖文件 |
| `edit`        | 查找替换编辑   |
| `list`        | 列出目录内容   |
| `bash`        | 执行 bash 命令 |
| `web_fetch`   | 获取网页内容   |
| `mount`       | 挂载 Git 仓库  |
| `unmount`     | 卸载挂载点     |
| `list-mounts` | 列出当前挂载   |

> 💡 **直接执行 bash**: 消息以 `!` 开头可以绕过 AI 直接执行 bash 命令，例如 `!ls -la`

### 3. 文件系统
- 基于 D1 的虚拟文件系统
- `/work` 目录跨会话共享
- 支持 Git 仓库克隆和挂载到 `/mnt`
- 完整的 bash 命令支持 (grep, sed, awk, find 等)

### 4. Slack 集成
- **多 Bot 会话隔离**: 每个 bot 在同一 thread 中维护独立 session
- **跨 Bot 对话**: 其他 bot 的消息显示为带 `bot:BotName` prefix 的 User Message
- **智能上下文**: 基于 timestamp 追踪，只加载新消息，避免重复
- 多应用支持 (每个应用可配置不同 LLM)
- @mention 触发对话，保留所有 mentions
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

| 表名                   | 用途                                                     |
| ---------------------- | -------------------------------------------------------- |
| `sessions`             | 会话元数据                                               |
| `messages`             | 聊天消息存储                                             |
| `files`                | 虚拟文件系统                                             |
| `mounts`               | Git 挂载配置                                             |
| `llm_configs`          | LLM 配置                                                 |
| `slack_apps`           | Slack 应用配置                                           |
| `slack_thread_mapping` | Slack 线程到会话映射 (含 `last_message_ts` 用于增量加载) |
| `slack_users`          | Slack 用户和 Bot 信息缓存 (通过 `users.info` API)        |

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
# 初始化数据库（首次部署）
npx wrangler d1 execute mob-session --local --file=schema.sql
npx wrangler d1 execute mob-session --remote --file=schema.sql

## 多 Bot 场景

### 会话隔离机制

系统支持多个 Slack bot 在同一 thread 中独立工作：

**Thread Key 格式**: `slack:{app_id}:{channel}:{thread_ts}`
- 每个 bot 通过 `app_id` 区分，维护独立的 session
- 同一 thread 中的不同 bot 不会共享对话历史

**消息追踪**: 使用 `last_message_ts` 字段
- 记录每个 bot 最后处理的 Slack 消息 timestamp
- 只加载 `ts > last_message_ts` 的新消息，避免重复
- 不依赖"找到 bot 消息"的假设，更准确可靠

### 跨 Bot 对话

当多个 bot 在同一 thread 中交互时：

**其他 Bot 的消息** → `User Message` with `prefix: "bot:BotName"`
```json
{
  "role": "user",
  "content": [{ "type": "text", "text": "Here's my answer" }],
  "prefix": "bot:GPTHelper"
}
```

**真实用户消息** → `User Message` with `prefix: "user:UserName"`
```json
{
  "role": "user",
  "content": [{ "type": "text", "text": "@Bot1 hello" }],
  "prefix": "user:John"
}
```

**Prefix 自动清理**: LLM 生成的响应中如果包含 `[bot:xxx]` 或 `[user:xxx]` 会被自动移除，避免在 Slack 中显示。

### 示例场景

```
Thread 消息:
1. User1: "@Bot1 hello"
2. Bot1: "Hi!"
3. User2: "question"
4. Bot2: "answer"
5. User3: "@Bot1 continue"
```

**Bot1 收到消息 5 时的 context**:
- User2 的消息 (prefix: `user:User2`)
- Bot2 的消息 (prefix: `bot:Bot2`)
- User3 的消息 (prefix: `user:User3`)

Bot1 看到 Bot2 的回复，可以基于它继续对话。

### 技术细节

**用户信息缓存**: `slack_users` 表缓存用户和 bot 信息
- 使用 `users.info` API 统一获取（对 bot 的 User ID 也有效）
- 无需单独的 `slack_bots` 表
- Bot 消息总是有 `user` 字段（bot 的 User ID）

**Mention 保留**: 所有 `@mention` 保持原样
- 格式：`<@USERID>` → `@DisplayName`
- 包括 bot mentions，让每个 bot 都能看到被 @ 的对象

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

## 架构决策

### 为什么使用 Durable Objects？

- **强一致性**：提供 read-after-write 一致性，避免并发冲突
- **有状态计算层**：每个 session 一个 DO 实例，管理 Agent 执行状态
- **与 D1 配合**：DO 处理实时状态，D1 提供持久化存储
- **自动扩展**：Cloudflare 自动管理 DO 实例的创建和销毁


### Slack 消息处理流程

```
Slack → POST /api/slack/events
         ↓
    [1. 验证签名 HMAC-SHA256]
         ↓
    [2. 立即返回 200 OK] ← 必须在 3 秒内
         ↓
    [3. waitUntil: 异步处理]
         ↓
    [4. 查询 last_message_ts]
         ↓
    [5. 加载新的 thread 消息]
         ↓
    [6. 获取或创建 ChatSession DO]
         ↓
    [7. 执行 Agent 对话循环]
         ↓
    [8. 回复 Slack thread]
         ↓
    [9. 更新 last_message_ts]
```

## Cloudflare Workers 平台限制

了解这些限制对设计新功能至关重要：

| 限制项            | 免费版 | 付费版  | 说明                           |
| ----------------- | ------ | ------- | ------------------------------ |
| **请求 CPU 时间** | 10ms   | 30s     | 单次 HTTP 请求的 CPU 执行时间  |
| **Cron CPU 时间** | -      | 30s     | 定时任务的 CPU 执行时间        |
| **Cron 墙钟时间** | -      | 15 分钟 | 定时任务的总运行时间（含 I/O） |
| **Cron 最小间隔** | -      | 1 分钟  | 支持标准 cron 表达式           |
| **D1 单查询大小** | 1MB    | 1MB     | 单个查询返回的最大数据量       |
| **D1 事务时间**   | 30s    | 30s     | 单个事务的最大执行时间         |
| **DO 内存**       | 128MB  | 128MB   | 单个 DO 实例的最大内存         |
| **请求体大小**    | 100MB  | 500MB   | 上传文件大小限制               |

**设计影响**：
- 长时间运行的任务需要拆分为多个小任务
- Bash 命令超时设置应考虑 CPU 时间限制
- 大量数据查询需要分页处理
- Agent 对话循环需要有合理的超时机制

## 已知问题

- **Durable Object `state.id.name` 问题**：由于 Cloudflare Workers [bug #2240](https://github.com/cloudflare/workerd/issues/2240)，我们通过 HTTP header 传递 session ID 而非依赖 `state.id.name`。详见 [#22](https://github.com/fankaidev/mob/issues/22)

## License

MIT
