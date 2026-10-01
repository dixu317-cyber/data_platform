# RAG 模块服务边界

本分支把三条 RAG 链路收敛为一致的服务级边界：

```txt
apps/api
  → packages/gateway
  → modules/* HTTP API

apps/agent-gateway
  → modules/* MCP Server

modules/* HTTP API + modules/* MCP Server
  → modules/* core
```

## 原则

1. `apps/api` 只做平台认证、UserContext 注入和 HTTP 转发，不 import 模块 core，不访问模块数据库。
2. `packages/gateway` 负责模块注册、HTTP 地址解析、内部 token、用户上下文 header 和基础错误映射。
3. 每个 RAG 模块必须自带 HTTP adapter 与 MCP adapter，并共同复用模块 `core`。
4. stdio MCP 是进程级连接，当前按 Agent 会话/用户启动独立 MCP 子进程；未来可切换到 Streamable HTTP MCP。

## 内部 HTTP header

`packages/gateway` 调用模块 HTTP 服务时注入：

```txt
X-FF-Internal-Token
X-FF-User-Id
X-FF-Username
X-FF-Is-Admin
```

模块 HTTP 服务必须校验 `RAG_INTERNAL_TOKEN`，并在模块内部自行执行权限判断。

## 本地服务端口

```txt
apps/api              3001
nano-brain HTTP       8100
traditional-rag HTTP  8101
graph-rag HTTP        8102
```

GraphRAG 使用独立 `GRAPH_RAG_DATABASE_URL`，模块内部采用 PostgreSQL + pgvector（业务、KV、vector、doc-status）+ Neo4j CE/APOC（graph）+ LightRAG Core。每个 GraphRAG source 映射一个隔离 workspace；平台 API 和 Agent Gateway 都不得直接访问 GraphRAG 数据库或 Neo4j。

## 启动

```bash
bun run dev:nano-http
bun run dev:api
bun run dev:traditional-rag
bun run dev:graph-rag
bun run dev:nano-mcp
```

GraphRAG 本地数据库初始化只要求 PostgreSQL 安装 `vector` extension，并要求 Neo4j CE/APOC 已按 `NEO4J_*` 配置通过 readiness。`bun run db:init` 会创建 `GRAPH_RAG_DATABASE_URL` 指向的 database 并运行 PostgreSQL schema migration。
