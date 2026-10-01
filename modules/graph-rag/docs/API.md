# GraphRAG API

本文档描述 `modules/graph-rag` 当前已经实现的 HTTP API 与 MCP 只读工具能力。

GraphRAG 模块自身是 FastAPI 服务，默认监听 `127.0.0.1:8102`，服务名为 `graph-rag`。平台统一 API 会把 `/graph/*` 转发到该模块；业务前端应优先调用统一 API，而不是直接调用模块服务。

模块内部采用 LightRAG Core。每个 GraphRAG source 对应一个隔离 workspace；KV/vector/doc-status 使用 PostgreSQL + pgvector，graph 仅使用 Neo4j。

## 调用入口

### 统一 API 入口

统一 API 负责校验平台 Bearer Token，并把用户上下文转成模块内部 headers：

```http
Authorization: Bearer <platform-token>
```

示例：

```http
GET /graph/sources
Authorization: Bearer ff_...
```

### 模块内部入口

模块 HTTP 服务不直接解析平台 Bearer Token，只接受统一 API 或内部调用方注入的 headers：

```http
x-ff-internal-token: <RAG_INTERNAL_TOKEN>
x-ff-user-id: <user-id>
x-ff-username: <username>
x-ff-is-admin: true | false
```

缺少 `RAG_INTERNAL_TOKEN` 配置时，受保护接口返回 500。内部 token 不匹配或缺少用户上下文时返回 401。

## 权限模型

Source 分为：

- `private`：只有 owner 和管理员可读；owner 和管理员可管理。
- `public`：所有用户可读；只有管理员可创建和管理。

文档和 GraphRAG 查询都通过所属 source 做读权限过滤。创建文档、上传文档、更新 source、归档文档属于管理操作，需要满足 source 管理权限。

普通用户调用 `GET /graph/sources` 时，如果还没有 private source，会自动创建默认 private source：`user/<username>`。

Agent Gateway 只能通过 GraphRAG MCP tools 调用模块能力，不允许直接访问 GraphRAG 数据库。

## 通用错误

模块业务错误会返回 FastAPI `HTTPException`，body 形态为：

```json
{
  "detail": {
    "error": "invalid_input",
    "message": "错误说明"
  }
}
```

主要错误码和状态：

| error | HTTP status | 含义 |
| --- | ---: | --- |
| `invalid_input` | 400 | 参数非法 |
| `unsupported_file_type` | 400 | 文件类型或编码不支持 |
| `forbidden` | 403 | 无权读取或管理目标资源 |
| `not_found` | 404 | source/document 不存在或不可见 |
| `duplicate_source` | 409 | source 名称冲突 |
| `config_error` | 500 | LightRAG、模型或必要环境变量配置错误 |
| `missing_config` | 500 | 数据库等模块配置缺失 |

FastAPI/Pydantic 参数校验错误使用框架默认 422 响应。

## 数据对象

### Source

```json
{
  "id": "source-id",
  "name": "user/alice",
  "description": "",
  "kind": "private",
  "workspace": "gsrc_14b3f7a3e5e2d95a",
  "owner_user_id": "user-id",
  "created_by": "user-id",
  "created_at": "2026-06-04T09:00:00+00:00",
  "updated_at": "2026-06-04T09:00:00+00:00",
  "archived_at": null
}
```

字段说明：

- `workspace`：GraphRAG source 对应的 LightRAG/Neo4j workspace label。实现生成短且稳定的唯一名称，禁止全局覆盖。

### Document

```json
{
  "id": "document-id",
  "source_id": "source-id",
  "original_filename": "example.md",
  "file_type": "markdown",
  "status": "ready",
  "content_hash": "sha256...",
  "metadata": {
    "ingest_type": "upload"
  },
  "uploaded_by": "user-id",
  "created_at": "2026-06-04T09:00:00+00:00",
  "updated_at": "2026-06-04T09:00:00+00:00",
  "archived_at": null
}
```

`GET /graph/documents/{document_id}` 会额外返回 `content_text`：

```json
{
  "document": {
    "id": "document-id",
    "content_text": "原始文本内容"
  }
}
```

支持的 `file_type`：

- `markdown`
- `txt`
- `text`

状态值：

- `processing`
- `ready`
- `failed`
- `archived`

当前处理流程是同步写入 LightRAG：接口会等待 LightRAG 完成解析、实体/关系抽取、embedding 和存储 flush 后返回。写入失败时 document 会标记为 `failed`，并在 `metadata.error` 中记录错误。

## Health

### GET `/health`

公开健康检查。

响应：

```json
{
  "status": "ok",
  "service": "graph-rag"
}
```

## Internal

### POST `/internal/users/default-source`

为当前用户创建或返回默认 private source。

权限：需要内部 headers。

响应：

```json
{
  "status": "ok",
  "service": "graph-rag",
  "user_id": "user-id",
  "source": {}
}
```

## Sources

### GET `/graph/sources`

列出当前用户可读 source。普通用户会自动确保默认 private source 存在。

权限：需要内部 headers / 统一 API Bearer Token。

响应：

```json
{
  "sources": []
}
```

### POST `/graph/sources`

创建 source。

权限：

- `private`：当前用户可创建。
- `public`：仅管理员可创建。

请求：

```json
{
  "name": "user/graph",
  "kind": "private",
  "description": "图谱知识空间"
}
```

字段限制：

- `name`：3 到 96 字符；不能包含控制字符。
- `kind`：`private` 或 `public`，默认 `private`。
- `description`：最长 1000 字符。

成功状态：201。

响应：

```json
{
  "source": {}
}
```

### GET `/graph/sources/{source_id}`

读取一个可见 source。

响应：

```json
{
  "source": {}
}
```

### PATCH `/graph/sources/{source_id}`

更新 source 名称和说明。

权限：source owner 可管理自己的 private source；管理员可管理全部 source。

请求：

```json
{
  "name": "user/renamed-graph",
  "description": "新说明"
}
```

响应：

```json
{
  "source": {}
}
```

### DELETE `/graph/sources/{source_id}`

级联硬删除 source：先清空该 source 的 Neo4j workspace，再清理 LightRAG PostgreSQL 内部表（doc_chunks/doc_full/doc_status/
full_entities/full_relations/llm_cache/entity_chunks/relation_chunks/vdb_chunks/vdb_entity/vdb_relation）、
`graph_documents` 与 `graph_sources` 行。按 workspace 精确匹配，不影响其它 source。幂等：图或行不存在不报错。

权限：source owner 可删除自己的 private source；管理员可删除全部 source。

响应：

```json
{
  "deleted": true,
  "source_id": "..."
}
```

## Documents

### POST `/graph/documents/text`

写入 raw text 文档，并同步插入对应 source 的 LightRAG workspace。

权限：需要 source 管理权限。

请求：

```json
{
  "source_id": "source-id",
  "title": "atlasflow.txt",
  "text": "正文内容",
  "metadata": {
    "origin": "manual"
  }
}
```

字段：

- `source_id`：目标 source ID。
- `title`：可选，最长 180 字符；默认 `raw-text.txt`。
- `text`：必填，非空，当前最多 2000000 字符。
- `metadata`：可选 JSON object。

成功状态：201。

响应：

```json
{
  "document": {}
}
```

### POST `/graph/documents/upload`

上传 Markdown/TXT 文件，并同步插入对应 source 的 LightRAG workspace。

权限：需要 source 管理权限。

请求类型：`multipart/form-data`

字段：

- `source_id`：目标 source ID。
- `file`：上传文件。

支持扩展名：

- `.md`
- `.markdown`
- `.txt`

文件编码：必须是 UTF-8 文本。

成功状态：201。

响应：

```json
{
  "document": {}
}
```

### GET `/graph/documents`

列出当前用户可读文档。

Query：

- `source_id` 可选；传入时只列出该 source 下文档，并先校验 source 可读。

响应：

```json
{
  "documents": []
}
```

### GET `/graph/documents/{document_id}`

读取一个可见文档详情。该接口会返回完整 `content_text`。

响应：

```json
{
  "document": {}
}
```

### DELETE `/graph/documents/{document_id}`

归档文档，并调用 LightRAG `adelete_by_doc_id` 删除对应 workspace 中的图谱、向量和文档状态数据。归档后的文档不会出现在普通列表和检索结果中。

权限：需要 source 管理权限。

响应：

```json
{
  "document": {},
  "archived": true
}
```

## Search

### POST `/graph/search`

执行 GraphRAG 检索，返回 LightRAG context/evidence，不生成最终答案。

权限：source 权限前置过滤；普通用户只能检索自己的 private source 和 public source；管理员可检索全部 source。

请求：

```json
{
  "query": "AtlasFlow 的核心能力是什么？",
  "limit": 10,
  "source_id": "source-id",
  "mode": "mix"
}
```

字段：

- `query`：必填字符串，1 到 2000 字符。
- `limit`：默认 10，范围 1 到 30。
- `source_id`：可选；传入时只查询该 source，并先校验 source 可读；不传时查询当前用户可读 source。
- `mode`：默认 `mix`；允许值为 `auto`、`local`、`global`、`hybrid`、`naive`、`mix`（`auto` = 交模块按问题智能路由 / admin 旋钮判决，见 `mode_router`）。
- `chunk_top_k`：可选整数（1~200）。检索召回的原文 chunk 数；不传落 `settings.graph_chunk_top_k` 或库默认（派生自 top_k）。（P22-P2）
- `max_total_tokens`：可选整数（1~100000）。喂给检索的图证据总 token 预算；不传落 settings 或库默认。（P22-P2）
- `enable_rerank`：可选布尔。是否对召回结果重排（无 rerank 模型时显式降级告警，不静默）；不传落 settings 或库默认。（P22-P2）
- 说明：`chunk_top_k`/`max_total_tokens`/`enable_rerank` 由平台后台「系统设置 > 按引擎检索召回 > GraphRAG」per-engine 配置传入，入参优先于 settings（`/graph/search` 与 `/graph/ask` 共用同一 `QueryRequest`）。

行为：

- 每个 source 对应一个 LightRAG workspace。
- 内部使用 LightRAG `QueryParam(only_need_context=True)`，只返回 evidence/context。
- LightRAG 返回 `[no-context]` 或空 context 时，接口过滤为空结果。

响应：

```json
{
  "query": "AtlasFlow 的核心能力是什么？",
  "limit": 10,
  "mode": "mix",
  "results": [
    {
      "source_id": "source-id",
      "source_name": "user/graph",
      "source_kind": "private",
      "workspace": "gsrc_14b3f7a3e5e2d95a",
      "mode": "mix",
      "context": "Knowledge Graph Data..."
    }
  ],
  "degraded_sources": []
}
```

- `degraded_sources`：因超时/失败被跳过的 source id 列表（C-A2 fail-open；正常全空，返回部分证据时非空，调用方据此提示"N 个知识库未纳入"）。

### POST `/graph/ask`

兼容性接口。当前不在 GraphRAG 模块内生成最终答案，只把检索结果放入 `citations`，供 Agent 或调用方基于依据生成回答。

请求字段同 `/graph/search`。

响应：

```json
{
  "query": "AtlasFlow 的核心能力是什么？",
  "answer": "",
  "citations": [],
  "note": "GraphRAG MCP/HTTP 返回检索依据；最终回答由 Agent 基于依据生成。"
}
```

## MCP Tools

GraphRAG MCP Server 默认通过 stdio 启动：

```bash
uv run --project modules/graph-rag python -m graph_rag.mcp.server
```

Agent Gateway 启动 MCP 子进程时会注入：

```txt
GRAPH_RAG_MCP_TOKEN
FF_USER_ID
FF_USERNAME
FF_IS_ADMIN
GRAPH_RAG_DATABASE_URL
EMBEDDING_*
AGENT_*
```

当前 MCP 首版只暴露只读工具。

### `graph_search(query, limit=10, source_id=None, mode="mix")`

执行 GraphRAG 检索并返回 evidence/context。返回结构与 `POST /graph/search` 基本一致。

> 注（P22-P2）：core `search` 已扩 `chunk_top_k`/`max_total_tokens`/`enable_rerank` 检索旋钮（HTTP `/graph/search`+`/ask` 已暴露），但 MCP `graph_search` 本期**未**同步暴露——MCP 是 Agent 自主检索路径，不读平台后台 per-engine 面板配置（详见 `PKP/specs/P22` 决策 7）。如需 agent 自主传这些旋钮，另立项扩 MCP 签名。

### `graph_list_sources()`

列出当前用户可读 GraphRAG source。普通用户会自动确保默认 private source 存在。

响应：

```json
{
  "sources": []
}
```

### `graph_get_document(document_id)`

读取当前用户可见文档，包括原始 `content_text`。

响应：

```json
{
  "document": {}
}
```

## 本地运行前置条件

GraphRAG 需要以下环境变量：

```txt
GRAPH_RAG_DATABASE_URL
RAG_INTERNAL_TOKEN
EMBEDDING_BASE_URL
EMBEDDING_API_KEY
EMBEDDING_MODEL
AGENT_BASE_URL
AGENT_API_KEY
AGENT_MODEL
NEO4J_URI
NEO4J_USERNAME
NEO4J_PASSWORD
NEO4J_DATABASE
```

可选：

```txt
EMBEDDING_DIMENSIONS   # 默认 1024（与 qwen3-embedding-8b 当前降维配置一致；>2000 维无法建标准 HNSW 索引）
GRAPH_RAG_WORKING_DIR
GRAPH_RAG_MCP_TOOL_TIMEOUT_MS
```

PostgreSQL 必须安装并可创建：

- `vector`

Neo4j CE 必须使用 database=`neo4j`，内置与 Server 精确匹配的 APOC Core，
并通过 Bolt 认证、`RETURN 1`、`apoc.version()` 与路径探针。禁止设置全局
`NEO4J_WORKSPACE`。

初始化：

```bash
bun run db:init
```

启动模块 HTTP 服务：

```bash
bun run dev:graph-rag
```

实测注意：

- `qwen/qwen3-embedding-8b` 模型原生 embedding 维度为 4096，但 GraphRAG 当前通过 `EMBEDDING_DIMENSIONS=1024` 降维使用（默认亦为 1024）。
- pgvector 标准 HNSW 索引不支持超过 2000 维的普通 vector；GraphRAG **已默认创建 HNSW 索引**（`POSTGRES_VECTOR_INDEX_TYPE=HNSW`，见 C-A1/台账 I67），依赖 embedding 维度 ≤2000（当前 1024 满足）。若改用 >2000 维需切 `HNSW_HALFVEC` 或关闭索引。
- LightRAG 首次插入和首次查询会调用外部 LLM/embedding API，耗时可能达到几十秒。Agent Gateway 中 GraphRAG MCP tool 默认超时为 300000 ms。
