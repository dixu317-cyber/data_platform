# CLAUDE.md — GraphRAG

本文件是 `modules/graph-rag` 的模块级工作准则。进入本模块修改代码时，优先遵守本文件、`docs/API.md`、顶层 `README.md` 与仓库级 `CLAUDE.md`。

## 模块定位

GraphRAG 是 FF-CompanyBrain 平台中的图谱式检索链路。它负责 GraphRAG source、文档写入、LightRAG workspace、实体/关系抽取、图谱存储、图谱检索与问答入口。

GraphRAG 不负责：

- 平台用户登录和 Bearer Token 校验。
- 统一 API 的模块分发。
- Agent 会话、run、SSE、checkpoint。
- Nano Brain 的页面/facts/Dream。
- Traditional RAG 的文档 chunk、表格解析和 MinerU PDF 路径。

## 技术栈

```txt
运行时：Python 3.11+
包管理：uv
HTTP 框架：FastAPI / uvicorn
数据库：PostgreSQL + pgvector（KV/vector/doc-status）+ Neo4j（graph）
GraphRAG Core：LightRAG
MCP：mcp Python SDK
LLM/embedding：OpenAI-compatible API
```

## 目录职责

```txt
src/graph_rag/
  core/                业务逻辑：sources、documents、search、LightRAG service
  db/                  数据库连接与迁移
  http/                FastAPI app、鉴权 header 解析、错误映射、序列化
  http/routes/         HTTP 路由
  mcp/                 MCP Server 与只读 tools
  config.py            环境变量配置

docs/
  API.md               当前 HTTP API 与 MCP 能力
```

## 业务边界

1. GraphRAG 业务逻辑优先放在 `core/`。
2. HTTP routes 只做请求解析、调用 core、响应序列化。
3. MCP tools 只暴露 Agent 需要的模块能力，不复制业务逻辑。
4. 模块 HTTP 服务只接受统一 API 或内部调用方注入的用户上下文 headers。
5. 不解析平台 Bearer Token，不管理系统用户。
6. 不直接访问 Nano Brain、Traditional RAG 或 Agent Gateway 数据库。
7. 不绕过 LightRAG service 直接操作 LightRAG 内部工作区状态，除非是在迁移或明确的修复脚本中。

可接受的调用方向：

```txt
apps/api -> GraphRAG HTTP
apps/agent-gateway -> GraphRAG MCP
graph_rag.http/mcp -> graph_rag.core
graph_rag.core -> graph_rag database / LightRAG workspace
```

## 数据模型

GraphRAG 使用 `GRAPH_RAG_DATABASE_URL` 指向独立 PostgreSQL database。主要表包括：

| 表 | 职责 |
| --- | --- |
| `graph_sources` | private/public source 与 LightRAG workspace 映射 |
| `graph_documents` | 文档原文、状态、metadata、归档 |

LightRAG 在 PostgreSQL/pgvector 中维护 KV、向量与文档状态，在 Neo4j 中维护图。`graph_sources.workspace` 是 source 与 LightRAG/Neo4j workspace label 的隔离边界，必须稳定、唯一；禁止用全局 `NEO4J_WORKSPACE` 覆盖。

迁移位于 `src/graph_rag/db/migrations.py`，必须保持幂等。PostgreSQL 只依赖 `vector` 扩展；图能力依赖独立 Neo4j CE + 精确匹配的 APOC，并在 HTTP/MCP 启动和健康检查中 fail-closed。

## 权限模型

Source 分为 `private` 和 `public`：

- private source 只有 owner 和管理员可读；owner 和管理员可管理。
- public source 所有用户可读；只有管理员可创建和管理。
- 文档与 GraphRAG 查询都通过所属 source 做权限过滤。
- 普通用户读取 sources 时，如果还没有 private source，会自动创建默认 `user/<username>` source。

Agent Gateway 只能通过 GraphRAG MCP tools 调用模块能力，不允许直接访问 GraphRAG 数据库或 LightRAG workspace。

## 文档与检索边界

当前支持文件类型：

- `markdown`
- `txt`
- `text`

处理规则：

- 文档上传或创建后，同步写入 LightRAG。
- 接口会等待 LightRAG 完成解析、实体/关系抽取、embedding、存储 flush 后返回。
- 写入失败时，document 状态应标记为 `failed`，并在 `metadata.error` 中记录结构化错误。
- 成功后状态应为 `ready`。

GraphRAG 适合图谱式证据检索和关系问答，不应承担 Traditional RAG 的表格查询、PDF MinerU 解析或通用 chunk 检索职责。

## HTTP 与 MCP

HTTP 服务默认地址：

```txt
http://127.0.0.1:8102
```

统一 API 会把 `/graph/*` 转发到本模块，并注入内部 headers：

```http
x-ff-internal-token: <RAG_INTERNAL_TOKEN>
x-ff-user-id: <user-id>
x-ff-username: <username>
x-ff-is-admin: true | false
```

除 `/health` 外，受保护接口必须校验内部 token 和用户上下文。

MCP Server 面向 Agent Gateway。当前文档描述为只读工具能力；新增写操作 tool 前要明确权限、成本、审计和误操作边界。

## 环境变量

```txt
GRAPH_RAG_DATABASE_URL
GRAPH_RAG_HTTP_PORT
GRAPH_RAG_HTTP_URL
RAG_INTERNAL_TOKEN

EMBEDDING_PROVIDER
EMBEDDING_BASE_URL
EMBEDDING_API_KEY
EMBEDDING_MODEL
EMBEDDING_DIMENSIONS

AGENT_BASE_URL
AGENT_API_KEY
AGENT_MODEL
```

约束：

- 禁止硬编码 embedding、LLM、内部 token 或 workspace 配置。
- `EMBEDDING_DIMENSIONS` 必须与实际 embedding 模型输出一致。
- `AGENT_API_KEY` 和 `EMBEDDING_API_KEY` 只能存在于本地 `.env` 或部署密钥系统。
- LightRAG 的 workspace 命名必须由模块统一生成，不能由用户输入直接决定。

## 实现准则

- LightRAG service 是图谱写入和查询的唯一业务封装点。
- 文档状态要准确反映 LightRAG 写入结果，失败不可伪装成 ready。
- Search/Ask 必须尊重 source 权限和 document 归档状态。
- workspace 生成和清理要谨慎，避免误删其他 source 的图谱数据。
- 外部模型调用错误应映射成稳定错误，不泄露密钥、完整提示词或过长响应。
- 不把 LightRAG 内部异常原样暴露给前端。
- 涉及成本的 LLM/embedding 调用要避免无界循环和重复写入。

## 常用命令

```bash
# 安装/同步 Python 依赖
uv sync --project modules/graph-rag

# 启动 HTTP
bun run dev:graph-rag

# 直接启动 HTTP
uv run --project modules/graph-rag python -m graph_rag.http.main

# 启动 MCP
uv run --project modules/graph-rag graph-rag-mcp

# 迁移数据库
uv run --project modules/graph-rag graph-rag-db-migrate

# 全仓部署预检
./scripts/deploy.sh --skip-install --skip-db --skip-admin
```

## 验证要求

按变更范围选择验证：

- 修改 Python 语法或模块入口：至少运行相关 `uv run --project modules/graph-rag ...` 命令。
- 修改迁移：运行 `uv run --project modules/graph-rag graph-rag-db-migrate`，确认扩展和迁移可用。
- 修改 HTTP API：启动服务并通过统一 API 或内部 headers 验证关键接口。
- 修改 MCP：通过 `graph-rag-mcp` 或 Agent Gateway 验证工具。
- 修改 LightRAG 写入/检索：用小文本覆盖 source 创建、document 写入、search/ask 查询和失败路径。

## 参考

- `docs/API.md`：GraphRAG HTTP API 与 MCP 工具能力。
- 顶层 `README.md`：本地启动、部署预检与服务拓扑。
