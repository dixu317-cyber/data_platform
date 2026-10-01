# FF-CompanyBrain API

本文档记录平台级 HTTP API。模块内部完整 API 以模块文档为准：

```txt
modules/nano-brain/docs/API.md
modules/graph-rag/docs/API.md
```

当前已实现：

- 统一平台 API：认证、模块清单、模块代理。
- Nano Brain HTTP API：通过 `/nano/*` 代理访问。
- Agent Gateway API：面向前端 Chat 的 SSE Agent 服务。

当前未实现：

- traditional-rag 实质业务 API。
- Agent Gateway 跨模块自动路由。
- 非流式 Chat API。

---

## 1. 服务入口

### 统一平台 API

默认：

```txt
http://localhost:${API_PORT:-3001}
```

职责：

- 用户注册、登录、当前用户查询。
- 平台模块清单与健康检查。
- 将 `/nano/*`、`/traditional/*`、`/graph/*` 代理到对应模块。

### Agent Gateway API

默认：

```txt
http://localhost:${AGENT_GATEWAY_PORT:-3002}
```

职责：

- 创建 Agent conversation。
- 提供 SSE Chat。
- 查询 conversation、checkpoint messages、runs、tool calls。
- 使用 LangChain `createAgent` + MCP Tools 调用当前 `active_module`。

---

## 2. 认证

除公开健康检查和注册 / 登录外，请携带 Bearer Token：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

通用错误格式：

```json
{
  "error": "invalid_input | unauthorized | forbidden | not_found | unsupported_module | internal_error",
  "message": "错误说明"
}
```

常见状态码：

- `400`：输入不合法。
- `401`：未认证或登录过期。
- `403`：无权限。
- `404`：资源不存在。
- `500`：服务内部错误。

---

# 统一平台 API

## System

### GET `/health`

健康检查。

响应：

```json
{
  "status": "ok",
  "service": "api"
}
```

### GET `/modules`

列出平台注册模块。

响应：

```json
{
  "modules": [
    { "id": "nano-brain", "name": "Nano Brain" },
    { "id": "traditional-rag", "name": "Traditional RAG" },
    { "id": "graph-rag", "name": "GraphRAG" }
  ]
}
```

### GET `/modules/health`

查询所有模块健康状态。

响应：

```json
{
  "modules": [
    { "module_id": "nano-brain", "status": "ok" }
  ]
}
```

---

## Auth

### POST `/auth/register`

注册普通用户。注册成功后会为用户初始化 Nano Brain 默认 private source。

请求：

```json
{
  "username": "alice",
  "password": "password-123"
}
```

响应：`201`

```json
{
  "user": {
    "id": "user-id",
    "username": "alice",
    "is_admin": false
  }
}
```

### POST `/auth/login`

登录并获取 Bearer Token。

请求：

```json
{
  "username": "alice",
  "password": "password-123"
}
```

响应：

```json
{
  "token": "bearer-token",
  "token_type": "Bearer",
  "user": {
    "id": "user-id",
    "username": "alice",
    "is_admin": false
  }
}
```

### GET `/auth/me`

读取当前登录用户。

响应：

```json
{
  "user": {
    "id": "user-id",
    "username": "alice",
    "is_admin": false
  }
}
```

---

## Module proxy

### `/nano/*`

统一平台 API 会将所有 `/nano/*` 请求代理到 Nano Brain 模块，并注入当前用户上下文。

示例：

```http
POST /nano/search
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "query": "星河智能 ARR",
  "limit": 10
}
```

Nano Brain 已实现完整 API，包括：

- sources
- pages
- capture
- search / ask
- graph / links
- fact submissions（含管理员审核：`POST /nano/fact-submissions/:submissionId/candidates`、`POST /nano/fact-submissions/:submissionId/review`）
- facts
- dream runs / status

管理员审核入口仅 `is_admin` 用户可用，权限在模块 core 层强制：

```txt
POST /nano/fact-submissions/:submissionId/candidates   保存结构化候选
POST /nano/fact-submissions/:submissionId/review        approve / reject / request_changes
```

完整文档见：

```txt
modules/nano-brain/docs/API.md
```

### `/traditional/*`

预留 Traditional RAG HTTP namespace。当前仅保留代理边界，业务尚未实质实现。

### `/graph/*`

GraphRAG HTTP namespace。统一平台 API 会代理到 GraphRAG 模块，并注入当前用户上下文。

已实现：

- `GET/POST/PATCH /graph/sources`
- `POST /graph/documents/text`
- `POST /graph/documents/upload`
- `GET/DELETE /graph/documents`
- `POST /graph/search`
- `POST /graph/ask`

完整文档见：

```txt
modules/graph-rag/docs/API.md
```

---

# Agent Gateway API

Agent Gateway 是面向前端 Chat 的服务。它使用：

```txt
LangChain createAgent
+ active_module MCP Tools
+ LangGraph PostgresSaver checkpoint
+ Agent Gateway run/tool-call audit tables
```

关键原则：

- 第一版只支持 `active_module = nano-brain`。
- 只提供 SSE Chat，不提供非流式 Chat 触发接口。
- Agent Gateway 不直接访问 Nano Brain 数据库。
- Agent 只能通过 Nano Brain MCP Tools 调用知识库能力。
- conversation id 直接作为 LangGraph `thread_id`。
- 消息正文以 LangGraph PostgresSaver checkpoint 为唯一来源。
- Agent Gateway 自有表只保存 conversation 索引、run 状态和 tool call 审计。

## Agent 权限模型

普通用户：

- 只能创建、读取、继续自己的 conversations。
- 只能使用普通 Nano Brain MCP tools。
- 不能进入 `admin_review` 模式。
- 不能调用管理员 MCP tools。

管理员：

- 可以创建普通 Agent conversation。
- 可以进入 `admin_review` 模式。
- 可以使用管理员审核辅助 tools。
- 不能让 Agent 自动 approve / reject / request_changes。

高风险审核工具：

```txt
nano_admin_review_fact_submission
```

默认不暴露给 Agent。管理员审核辅助流只允许 Agent 保存候选和生成建议，最终审核决定必须由人类管理员显式完成。

---

## GET `/health`

Agent Gateway 健康检查。

响应：

```json
{
  "status": "ok",
  "service": "agent-gateway"
}
```

---

## POST `/agent/conversations`

创建 Agent conversation。

请求：

```json
{
  "active_module": "nano-brain",
  "title": "分析星河智能 ARR",
  "metadata": {
    "locale": "zh-CN"
  }
}
```

字段：

- `active_module`：必填。当前只支持 `nano-brain`。
- `title`：可选，会话标题，最多 200 字符。
- `metadata`：可选对象。

响应：`201`

```json
{
  "conversation": {
    "id": "conversation-id",
    "user_id": "user-id",
    "username": "alice",
    "active_module": "nano-brain",
    "title": "分析星河智能 ARR",
    "status": "active",
    "thread_id": "conversation-id",
    "latest_checkpoint_id": null,
    "checkpoint_bootstrapped_at": null,
    "metadata": {
      "locale": "zh-CN"
    },
    "created_at": "2026-06-03T00:00:00.000Z",
    "updated_at": "2026-06-03T00:00:00.000Z"
  }
}
```

说明：

- `thread_id` 当前等于 `conversation.id`。
- 前端不需要直接管理 `thread_id`。
- 客户端不能通过请求体覆盖 conversation 的 `active_module`。

---

## GET `/agent/conversations`

列出当前用户 conversations。

查询参数：

- `limit`：`1..100`，默认 `20`。

响应：

```json
{
  "conversations": [
    {
      "id": "conversation-id",
      "user_id": "user-id",
      "active_module": "nano-brain",
      "title": "分析星河智能 ARR",
      "status": "active",
      "thread_id": "conversation-id",
      "created_at": "2026-06-03T00:00:00.000Z",
      "updated_at": "2026-06-03T00:00:00.000Z"
    }
  ]
}
```

普通用户只会看到自己的 conversations。

---

## GET `/agent/conversations/:conversationId`

读取 conversation 详情、checkpoint messages 和最近 runs。

查询参数：

- `message_limit`：预留，当前 checkpoint 读取以最新 thread state 为准。
- `run_limit`：`1..100`，默认 `20`。

响应：

```json
{
  "conversation": {
    "id": "conversation-id",
    "active_module": "nano-brain",
    "thread_id": "conversation-id",
    "title": "分析星河智能 ARR"
  },
  "messages": [
    {
      "id": "message-id",
      "type": "human",
      "role": "user",
      "content": "请总结星河智能 ARR",
      "text": "请总结星河智能 ARR",
      "name": null,
      "tool_call_id": null,
      "tool_calls": [],
      "invalid_tool_calls": [],
      "usage_metadata": null,
      "response_metadata": {},
      "status": null,
      "raw": {}
    },
    {
      "id": "message-id",
      "type": "ai",
      "role": "assistant",
      "content": "根据工具结果...",
      "text": "根据工具结果...",
      "tool_calls": []
    }
  ],
  "message_source": "langgraph_checkpoint",
  "checkpoint_id": "checkpoint-id",
  "runs": [
    {
      "id": "run-id",
      "conversation_id": "conversation-id",
      "status": "completed",
      "provider": "openai-compatible",
      "model": "agent-model",
      "active_module": "nano-brain",
      "stream_protocol": "langchain-event-stream",
      "stream_version": "v3",
      "latest_checkpoint_id": "checkpoint-id",
      "started_at": "2026-06-03T00:00:00.000Z",
      "finished_at": "2026-06-03T00:00:03.000Z"
    }
  ]
}
```

说明：

- `messages` 从 LangGraph PostgresSaver checkpoint 读取。
- Agent Gateway 不维护自有 `agent_messages` 表。
- 如果 Agent 模型或 checkpoint 尚未配置，接口仍可返回 conversation 索引和 runs，`messages` 可能为空。

---

## POST `/agent/conversations/:conversationId/stream`

唯一 Agent 触发接口。发送一条用户消息并通过 SSE 返回执行事件。

请求：

```json
{
  "message": "请总结星河智能的最新事实和相关页面"
}
```

管理员审核辅助模式：

```json
{
  "mode": "admin_review",
  "message": "请汇总待审核事实提交，保存候选，但不要自动通过"
}
```

字段：

- `message`：必填，非空字符串。
- `mode`：可选。
  - 不传或其他值：普通 Agent 模式。
  - `admin_review`：管理员审核辅助模式，仅管理员可用。

响应：`text/event-stream`

SSE 事件：

```txt
run_started
tool_call_started
tool_call_finished
message_delta
message_completed
run_completed
error
```

事件格式：

```txt
id: <run-id>:<seq>
event: message_delta
data: {"run_id":"run-id","text":"根据"}
```

### `run_started`

```json
{
  "run_id": "run-id",
  "conversation_id": "conversation-id",
  "active_module": "nano-brain",
  "thread_id": "conversation-id"
}
```

### `message_delta`

```json
{
  "run_id": "run-id",
  "seq": 7,
  "text": "根据工具结果，",
  "node": "model_request",
  "namespace": ["model_request:..."]
}
```

### `tool_call_started`

```json
{
  "run_id": "run-id",
  "seq": 17,
  "tool_call_id": "call-id",
  "tool_name": "nano_search",
  "input": "{\"query\":\"星河智能 ARR\"}"
}
```

### `tool_call_finished`

```json
{
  "run_id": "run-id",
  "seq": 18,
  "tool_call_id": "call-id",
  "tool_name": "nano_search",
  "status": "completed",
  "result_summary": "..."
}
```

### `message_completed`

```json
{
  "run_id": "run-id",
  "message": {
    "id": "message-id",
    "content": "根据 Nano Brain 中的记录..."
  },
  "latest_checkpoint_id": "checkpoint-id"
}
```

### `run_completed`

```json
{
  "run_id": "run-id",
  "status": "completed",
  "last_event_seq": 42
}
```

### `error`

```json
{
  "run_id": "run-id",
  "message": "错误说明"
}
```

说明：

- SSE 已开始后，执行错误通过 `error` 事件返回。
- 如果请求在 SSE 开始前不合法，例如无权限或空 message，会返回普通 JSON 错误。
- 浏览器断开连接时，run 会被标记为 `cancelled`。
- 模型或工具失败时，run 会被标记为 `failed`。
- `active_module` 始终从 conversation 读取，请求体不能临时覆盖。

---

## GET `/agent/conversations/:conversationId/runs/:runId`

查询某次 Agent run 详情。该接口只读，不触发 Agent。

用途：

- 前端展示本次回答使用了哪些工具。
- 调试 Agent 行为。
- 审计管理员审核辅助流。
- SSE 断线后补查 run 最终状态。

响应：

```json
{
  "run": {
    "id": "run-id",
    "conversation_id": "conversation-id",
    "user_id": "user-id",
    "thread_id": "conversation-id",
    "status": "completed",
    "provider": "openai-compatible",
    "model": "agent-model",
    "active_module": "nano-brain",
    "input_message_id": null,
    "output_message_id": "message-id",
    "langsmith_run_id": null,
    "langsmith_trace_id": null,
    "run_name": "agent-chat-stream",
    "tags": [],
    "stream_protocol": "langchain-event-stream",
    "stream_version": "v3",
    "last_event_seq": 42,
    "latest_checkpoint_id": "checkpoint-id",
    "token_usage": {},
    "error": null,
    "metadata": {
      "mode": "default"
    },
    "started_at": "2026-06-03T00:00:00.000Z",
    "finished_at": "2026-06-03T00:00:03.000Z",
    "created_at": "2026-06-03T00:00:00.000Z"
  },
  "tool_calls": [
    {
      "id": "tool-call-record-id",
      "run_id": "run-id",
      "conversation_id": "conversation-id",
      "tool_name": "nano_search",
      "arguments": {
        "query": "星河智能 ARR"
      },
      "result_summary": "返回 5 条检索结果",
      "result": {},
      "status": "completed",
      "error": null,
      "sequence": 17,
      "langchain_tool_call_id": "call-id",
      "node_name": "tools",
      "namespace": "tools:...",
      "started_at": "2026-06-03T00:00:01.000Z",
      "finished_at": "2026-06-03T00:00:02.000Z",
      "created_at": "2026-06-03T00:00:01.000Z"
    }
  ],
  "events": []
}
```

`run.status`：

- `pending`
- `running`
- `completed`
- `failed`
- `cancelled`

`tool_calls.status`：

- `pending`
- `running`
- `completed`
- `failed`
- `skipped`

---

## Agent Gateway 管理员审核辅助流

`mode=admin_review` 用于管理员审核事实提交。

允许 Agent 使用的工具：

```txt
nano_admin_list_fact_submissions
nano_get_fact_submission
nano_save_fact_candidates
nano_get_dream_status
nano_get_dream_run
nano_list_facts
```

默认禁止：

```txt
nano_admin_review_fact_submission
```

规则：

- 普通用户不能进入 `admin_review` 模式。
- Agent 可以读取审核队列、dream 报告和 public facts。
- Agent 可以保存结构化事实候选。
- Agent 只能给出审核建议。
- Agent 不能自动 approve / reject / request_changes。
- 即使模型尝试调用高风险审核工具，也会被 middleware 拦截。

---

# 环境变量摘要

## 统一平台 API

```txt
API_PORT
IDENTITY_DATABASE_URL
RAG_INTERNAL_TOKEN
```

## Nano Brain

```txt
NANO_BRAIN_DATABASE_URL
EMBEDDING_PROVIDER
EMBEDDING_BASE_URL
EMBEDDING_API_KEY
EMBEDDING_MODEL
```

## Agent Gateway

```txt
AGENT_GATEWAY_PORT
AGENT_DATABASE_URL
AGENT_CHECKPOINT_SCHEMA       # 可选，默认 langgraph
AGENT_PROVIDER                # 当前支持 openai-compatible
AGENT_BASE_URL
AGENT_API_KEY
AGENT_MODEL
AGENT_TEMPERATURE             # 可选，默认 0
AGENT_STREAM_USAGE            # 可选，默认 false
BUN_PATH                      # 可选，MCP stdio 启动时指定 bun 路径
```

注意：

- `EMBEDDING_API_KEY`、`AGENT_API_KEY` 只能放在本地 `.env` 或部署环境变量，禁止提交。
- `AGENT_DATABASE_URL` 用于 Agent Gateway 自有表和 LangGraph PostgresSaver checkpoint；本地开发可与 `IDENTITY_DATABASE_URL`、`NANO_BRAIN_DATABASE_URL` 使用同一个 PostgreSQL 实例，但必须是独立 database，不能复用 nano-brain 的 database。
- `Agent Gateway` 不使用 embedding 环境变量作为聊天模型配置。

---

# API 边界总结

```txt
前端
  → 统一平台 API / Agent Gateway API

统一平台 API
  → packages/identity
  → packages/gateway
  → RAG 模块 HTTP API

Agent Gateway
  → LangChain createAgent
  → 当前 active_module 的 MCP Tools
  → RAG 模块 core
```

禁止：

- 统一平台 API 直接访问 RAG 模块数据库。
- Agent Gateway 直接访问 RAG 模块数据库。
- Agent Gateway 绕过 MCP Tools 操作 Nano Brain。
- Agent 自动执行高风险管理员审核动作。
