# CLAUDE.md — Traditional RAG

本文件是 `modules/traditional-rag` 的模块级工作准则。进入本模块修改代码时，优先遵守本文件、`docs/API.md`、顶层 `README.md` 与仓库级 `CLAUDE.md`。

## 模块定位

Traditional RAG 是 FF-CompanyBrain 平台中的传统文档检索链路。它负责 source、文档上传、解析、chunk、embedding、全文/向量混合检索、表格抽取与表格查询。

Traditional RAG 不负责：

- 平台用户登录和 Bearer Token 校验。
- 统一 API 的模块分发。
- Agent 会话、run、SSE、checkpoint。
- Nano Brain 的页面/facts/Dream。
- GraphRAG 的图谱工作空间和 LightRAG 能力。

## 技术栈

```txt
运行时：Python 3.11+
包管理：uv
HTTP 框架：FastAPI / uvicorn
数据库：PostgreSQL + pgvector + pg_trgm
MCP：mcp Python SDK
文档解析：内置解析器 + MinerU PDF 解析
embedding：OpenRouter OpenAI-compatible API
```

## 目录职责

```txt
src/traditional_rag/
  core/                业务逻辑：sources、documents、chunks、tables、search、parsers
  db/                  数据库连接与迁移
  http/                FastAPI app、鉴权 header 解析、错误映射、序列化
  http/routes/         HTTP 路由
  mcp/                 MCP Server 与只读 tools
  config.py            环境变量配置
  storage.py           本地文件与缓存目录

docs/
  API.md               当前 HTTP API 与 MCP 能力
  PLANS.md             模块计划
```

## 业务边界

1. 业务逻辑优先放在 `core/`。
2. HTTP routes 只做请求解析、调用 core、响应序列化。
3. MCP tools 只暴露 Agent 需要的模块能力，不复制业务逻辑。
4. 模块 HTTP 服务只接受统一 API 或内部调用方注入的用户上下文 headers。
5. 不解析平台 Bearer Token，不管理系统用户。
6. 不直接访问 Nano Brain、GraphRAG 或 Agent Gateway 数据库。

可接受的调用方向：

```txt
apps/api -> Traditional RAG HTTP
apps/agent-gateway -> Traditional RAG MCP
traditional_rag.http/mcp -> traditional_rag.core
traditional_rag.core -> traditional_rag database/storage
```

## 数据模型

Traditional RAG 使用 `TRADITIONAL_RAG_DATABASE_URL` 指向独立 PostgreSQL database。主要表包括：

| 表 | 职责 |
| --- | --- |
| `traditional_sources` | private/public source |
| `traditional_documents` | 上传文档、状态、metadata、归档 |
| `traditional_jobs` | 文档处理流程状态 |
| `traditional_chunks` | 文本 chunk、embedding、全文索引 |
| `traditional_tables` | CSV/XLSX 表结构 |
| `traditional_table_rows` | 表格行数据 |

迁移位于 `src/traditional_rag/db/migrations.py`，必须保持幂等。新增字段要考虑已有数据库和本地存储目录的兼容性。

## 权限模型

Source 分为 `private` 和 `public`：

- private source 只有 owner 和管理员可读；owner 和管理员可管理。
- public source 所有用户可读；只有管理员可创建和管理。
- 文档、chunks、tables、jobs 都通过所属 source 做权限过滤。
- 普通用户读取 sources 时，如果还没有 private source，会自动创建默认 `user/<username>` source。

权限过滤必须在 core 查询或服务边界完成，不能依赖前端隐藏入口。

## 文档处理边界

当前支持文件类型：

- `pdf`
- `docx`
- `csv`
- `xlsx`
- `markdown`
- `txt`

处理规则：

- `docx`、`markdown`、`txt`：解析文本，切分 chunks，调用 embedding，写入 `traditional_chunks`。
- `csv`、`xlsx`：抽取表结构和行数据，写入 `traditional_tables` 与 `traditional_table_rows`。
- `pdf`：调用 MinerU Precise API（或复用同 hash 的 MinerU cache）解析为 Markdown 后，`_index_pdf_markdown` 会切分 chunks、调用 embedding 写入 `traditional_chunks`（`core/documents.py`），并将解析 metadata/cache 记入 document.metadata。**PDF 正文可通过 `/traditional/search` 检索**。

注意：PDF 解析依赖有效的 `MINERU_API_KEY`（该 key 为有时效的 JWT，过期需刷新）与正确的 `MINERU_BASE_URL=https://mineru.net`（代码自行拼接 `/api/v4/...`，base 只填 host，切勿带 `/api/v4` 否则路径重复报 404）。修改 PDF 行为时，要同步更新 API 文档和前端状态提示。

## HTTP 与 MCP

HTTP 服务默认地址：

```txt
http://127.0.0.1:8101
```

统一 API 会把 `/traditional/*` 转发到本模块，并注入内部 headers：

```http
x-ff-internal-token: <RAG_INTERNAL_TOKEN>
x-ff-user-id: <user-id>
x-ff-username: <username>
x-ff-is-admin: true | false
```

除 `/health` 外，受保护接口必须校验内部 token 和用户上下文。

MCP Server 面向 Agent Gateway。当前文档描述为只读工具能力；新增写操作 tool 前要明确权限、审计和误操作边界。

## 环境变量

```txt
TRADITIONAL_RAG_DATABASE_URL
TRADITIONAL_RAG_HTTP_PORT
TRADITIONAL_RAG_HTTP_URL
TRADITIONAL_RAG_STORAGE_DIR
RAG_INTERNAL_TOKEN

EMBEDDING_PROVIDER
EMBEDDING_BASE_URL
EMBEDDING_API_KEY
EMBEDDING_MODEL

MINERU_API_KEY
MINERU_BASE_URL
MINERU_MODEL_VERSION
MINERU_LANGUAGE
MINERU_ENABLE_TABLE
MINERU_ENABLE_FORMULA
MINERU_IS_OCR
MINERU_POLL_INTERVAL_SECONDS
MINERU_TIMEOUT_SECONDS
```

约束：

- 禁止硬编码 embedding、MinerU 或内部 token。
- `TRADITIONAL_RAG_STORAGE_DIR` 默认 `.traditional-rag-storage`，不要提交存储内容。
- embedding dimensions 必须与实际模型输出、数据库向量列和检索逻辑一致。

## 实现准则

- 文件类型判断应同时考虑扩展名、内容头和解析器能力。
- 文档处理状态要可追踪：`uploaded`、`processing`、`ready`、`failed`、`archived`。
- job 状态和 document 状态要一致，失败时写入结构化 error。
- 搜索必须同时尊重 source 权限、文档归档状态和 chunk 可见性。
- 表格查询要限制可执行操作，避免把用户输入变成任意 SQL。
- MinerU 失败应映射为稳定错误，不泄露密钥或过长的外部响应。
- 本地文件存储路径必须通过 `storage.py` 管理，避免路径穿越。

## 常用命令

```bash
# 安装/同步 Python 依赖
uv sync --project modules/traditional-rag

# 启动 HTTP
bun run dev:traditional-rag

# 直接启动 HTTP
uv run --project modules/traditional-rag python -m traditional_rag.http.main

# 启动 MCP
uv run --project modules/traditional-rag traditional-rag-mcp

# 迁移数据库
uv run --project modules/traditional-rag traditional-rag-db-migrate

# 全仓部署预检
./scripts/deploy.sh --skip-install --skip-db --skip-admin
```

## 验证要求

按变更范围选择验证：

- 修改 Python 语法或模块入口：至少运行相关 `uv run --project modules/traditional-rag ...` 命令。
- 修改迁移：运行 `uv run --project modules/traditional-rag traditional-rag-db-migrate`，确认幂等。
- 修改 HTTP API：启动服务并通过统一 API 或内部 headers 验证关键接口。
- 修改 MCP：通过 `traditional-rag-mcp` 或 Agent Gateway 验证工具。
- 修改文档处理、embedding、MinerU：至少用一个小文件覆盖目标路径，并检查 document/job 状态。

## 参考

- `docs/API.md`：Traditional RAG HTTP API 与 MCP 工具能力。
- `docs/PLANS.md`：模块实施计划。
- 顶层 `README.md`：本地启动、部署预检与服务拓扑。
