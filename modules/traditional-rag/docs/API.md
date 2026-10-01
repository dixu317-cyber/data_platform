# Traditional RAG API

本文档描述 `modules/traditional-rag` 当前已经实现的 HTTP API 与 MCP 只读工具能力。

Traditional RAG 模块自身是 FastAPI 服务，默认监听 `127.0.0.1:8101`，服务名为 `traditional-rag`。平台统一 API 会把 `/traditional/*` 转发到该模块；业务前端应优先调用统一 API，而不是直接调用模块服务。

## 调用入口

### 统一 API 入口

统一 API 负责校验平台 Bearer Token，并把用户上下文转成模块内部 headers：

```http
Authorization: Bearer <platform-token>
```

示例：

```http
GET /traditional/sources
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

文档、chunks、tables、jobs 都通过所属 source 做读权限过滤。上传、更新 source、归档文档属于管理操作，需要满足 source 管理权限。

普通用户调用 `GET /traditional/sources` 时，如果还没有 private source，会自动创建默认 private source：`user/<username>`。

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
| `unsupported_file_type` | 400 | 文件类型或文件头不支持 |
| `parser_error` | 400 | 文档或表格解析失败 |
| `table_error` | 400 | 表格构建或查询错误 |
| `forbidden` | 403 | 无权读取或管理目标资源 |
| `not_found` | 404 | source/document/table/job 不存在或不可见 |
| `duplicate_source` | 409 | source 名称冲突 |
| `config_error` | 500 | 缺少必要配置 |
| `mineru_error` | 502 | MinerU 调用失败 |
| `embedding_error` | 502 | embedding 调用失败 |
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
  "owner_user_id": "user-id",
  "created_by": "user-id",
  "created_at": "2026-06-04T09:00:00+00:00",
  "updated_at": "2026-06-04T09:00:00+00:00",
  "archived_at": null
}
```

### Document

```json
{
  "id": "document-id",
  "source_id": "source-id",
  "original_filename": "example.md",
  "file_type": "markdown",
  "status": "ready",
  "content_hash": "sha256...",
  "storage_path": "files/source-id/document-id/example.md",
  "metadata": {},
  "uploaded_by": "user-id",
  "created_at": "2026-06-04T09:00:00+00:00",
  "updated_at": "2026-06-04T09:00:00+00:00",
  "archived_at": null
}
```

支持的 `file_type`：

- `pdf`
- `docx`
- `csv`
- `xlsx`
- `markdown`
- `txt`

状态值由处理流程写入，当前常见值包括：

- `uploaded`
- `processing`
- `ready`
- `failed`
- `archived`

### Job

```json
{
  "id": "job-id",
  "document_id": "document-id",
  "source_id": "source-id",
  "status": "ready",
  "stage": "embedded",
  "error": null,
  "created_by": "user-id",
  "created_at": "2026-06-04T09:00:00+00:00",
  "updated_at": "2026-06-04T09:00:00+00:00"
}
```

当前处理流程：

- `docx` / `markdown` / `txt`：解析文本，切分 chunks，调用 embedding，完成后 document metadata 写入 `processing`。
- `csv` / `xlsx`：抽取表格和行数据，完成后 document metadata 写入 `tables`。
- `pdf`：调用 MinerU Precise API 或复用同 hash 的 MinerU cache，完成后 document metadata 写入 `mineru`。

注意：当前 PDF 路径只落 MinerU 解析 metadata/cache，不会自动生成 `traditional_chunks`；因此 `/traditional/search` 不会因为上传 PDF 而自动检索到 PDF 内容。

### Chunk

```json
{
  "id": "chunk-id",
  "document_id": "document-id",
  "source_id": "source-id",
  "chunk_index": 0,
  "chunk_text": "正文片段",
  "metadata": {
    "segment_start": 0,
    "segment_end": 0,
    "segments": []
  },
  "embedding_model": "qwen/qwen3-embedding-8b",
  "embedding_dimensions": 4096,
  "created_at": "2026-06-04T09:00:00+00:00"
}
```

### Table

```json
{
  "id": "table-id",
  "document_id": "document-id",
  "source_id": "source-id",
  "table_index": 0,
  "sheet_name": "CSV",
  "columns": [
    {
      "name": "金额",
      "type": "number",
      "index": 1,
      "non_null_count": 2
    }
  ],
  "row_count": 2,
  "metadata": {
    "parser": "csv"
  },
  "created_at": "2026-06-04T09:00:00+00:00"
}
```

## Health

### GET `/health`

公开健康检查。

响应：

```json
{
  "status": "ok",
  "service": "traditional-rag"
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
  "service": "traditional-rag",
  "user_id": "user-id",
  "source": {}
}
```

## Sources

### GET `/traditional/sources`

列出当前用户可读 source。普通用户会自动确保默认 private source 存在。

权限：需要内部 headers / 统一 API Bearer Token。

响应：

```json
{
  "sources": []
}
```

### POST `/traditional/sources`

创建 source。

权限：

- `private`：当前用户可创建。
- `public`：仅管理员可创建。

请求：

```json
{
  "name": "user/docs",
  "kind": "private",
  "description": "文档空间"
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

### GET `/traditional/sources/{source_id}`

读取一个可见 source。

响应：

```json
{
  "source": {}
}
```

### PATCH `/traditional/sources/{source_id}`

更新 source 名称和说明。

权限：source owner 可管理自己的 private source；管理员可管理全部 source。

请求：

```json
{
  "name": "user/renamed",
  "description": "新说明"
}
```

响应：

```json
{
  "source": {}
}
```

## Documents

### POST `/traditional/documents`

上传文档并创建异步处理 job。接口返回后，FastAPI background task 会继续执行解析、切分、embedding 或表格抽取。

权限：需要 source 管理权限。

请求类型：`multipart/form-data`

字段：

- `source_id`：目标 source ID。
- `file`：上传文件。

支持扩展名：

- `.pdf`
- `.docx`
- `.csv`
- `.xlsx`
- `.md`
- `.markdown`
- `.txt`

文件头检查：

- PDF 必须以 `%PDF` 开头。
- DOCX / XLSX 必须是 zip 文件头，即以 `PK` 开头。

成功状态：201。

响应：

```json
{
  "document": {},
  "job": {}
}
```

### GET `/traditional/documents`

列出当前用户可读文档。

Query：

- `source_id` 可选；传入时只列出该 source 下文档，并先校验 source 可读。

响应：

```json
{
  "documents": []
}
```

### GET `/traditional/documents/{document_id}`

读取一个可见文档详情。

响应：

```json
{
  "document": {}
}
```

### DELETE `/traditional/documents/{document_id}`

归档文档。归档后的文档不会出现在普通列表和检索结果中。

权限：需要 source 管理权限。

响应：

```json
{
  "document": {},
  "archived": true
}
```

### GET `/traditional/documents/{document_id}/chunks`

列出一个可见文档的 chunks。

响应：

```json
{
  "chunks": []
}
```

当前只有 `docx`、`markdown`、`txt` 处理流程会自动创建 chunks。

### GET `/traditional/documents/{document_id}/tables`

列出一个可见文档的表格索引。

响应：

```json
{
  "tables": []
}
```

当前 `csv`、`xlsx` 处理流程会自动创建 tables。

## Jobs

### GET `/traditional/jobs`

列出当前用户可读 job。

Query：

- `source_id` 可选；按 source 过滤。
- `document_id` 可选；按 document 过滤，并先校验 document 可读。

响应：

```json
{
  "jobs": []
}
```

### GET `/traditional/jobs/{job_id}`

读取一个可见 job。

响应：

```json
{
  "job": {}
}
```

## Chunks

### GET `/traditional/chunks/search`

旧的关键词 chunk 检索接口。它做 PostgreSQL full-text + literal substring 检索，不返回 RRF 诊断，也不执行 dense vector recall。

Query：

- `q` 必填。
- `limit` 可选，默认 10，范围 1 到 50。

响应：

```json
{
  "chunks": []
}
```

新检索功能应优先使用 `POST /traditional/search`。

## Search

### POST `/traditional/search`

执行多路召回 + RRF 融合检索，返回 evidence chunks，不生成最终答案。

权限：source 权限前置过滤；普通用户只能检索自己的 private source 和 public source；管理员可检索全部 source。

请求：

```json
{
  "query": "Alpha-774",
  "limit": 10,
  "source_id": "source-id",
  "document_id": "document-id",
  "file_types": ["markdown", "txt"]
}
```

字段：

- `query`：必填字符串，1 到 500 字符。
- `limit`：默认 10，范围 1 到 30。
- `source_id`：可选，字符串。
- `document_id`：可选，字符串。
- `file_types`：可选，字符串数组；允许值为 `pdf`、`docx`、`csv`、`xlsx`、`markdown`、`txt`。

召回路径：

- `keyword`：PostgreSQL `plainto_tsquery('simple', query)` + `ts_rank`。
- `literal`：`ILIKE` substring recall；中文 query 会额外使用去空白 compact 版本。
- `vector`：基于 query embedding 和 pgvector `<=>` 距离；如果 embedding 配置缺失，该路会返回 diagnostics skipped，不影响 keyword/literal 结果。

融合：

- 使用 RRF。
- `k = 60`。
- candidate limit 为 `max(limit * 5, 50)`。

响应：

```json
{
  "query": "Alpha-774",
  "limit": 10,
  "results": [
    {
      "chunk": {
        "id": "chunk-id",
        "document_id": "document-id",
        "source_id": "source-id",
        "chunk_index": 0,
        "text": "完整 chunk 文本",
        "snippet": "命中片段",
        "metadata": {},
        "embedding_model": "qwen/qwen3-embedding-8b",
        "embedding_dimensions": 4096,
        "created_at": "2026-06-04T09:00:00+00:00"
      },
      "score": 0.0325,
      "match_types": ["keyword", "literal", "vector"],
      "rank_details": {
        "keyword": { "rank": 1, "raw_score": 0.1 },
        "literal": { "rank": 1, "raw_score": 1 },
        "vector": { "rank": 1, "raw_score": 0.8 }
      },
      "document": {
        "id": "document-id",
        "filename": "example.md",
        "file_type": "markdown",
        "status": "ready",
        "metadata": {},
        "created_at": "2026-06-04T09:00:00+00:00"
      },
      "source": {
        "id": "source-id",
        "name": "user/docs",
        "kind": "private",
        "owner_user_id": "user-id"
      },
      "references": {
        "segments": [],
        "segment_start": 0,
        "segment_end": 0,
        "tables": [],
        "images": [],
        "pages": null
      }
    }
  ],
  "diagnostics": [
    { "type": "keyword", "status": "ok", "candidates": 1 },
    { "type": "literal", "status": "ok", "candidates": 1 },
    { "type": "vector", "status": "ok", "model": "...", "dimensions": 4096, "candidates": 1 }
  ],
  "filters": {
    "source_id": "source-id",
    "document_id": "document-id",
    "file_types": ["markdown"]
  },
  "fusion": {
    "method": "rrf",
    "k": 60,
    "candidate_limit": 50
  }
}
```

## Tables

### GET `/traditional/tables`

列出当前用户可读表格。

Query：

- `document_id` 可选；如果传入，内部走 `list_document_tables` 并校验 document 可读。
- `source_id` 可选；如果未传 `document_id`，可按 source 过滤。

响应：

```json
{
  "tables": []
}
```

### POST `/traditional/tables/query`

对可读 CSV/XLSX 表格执行受限查询。该接口不执行任意 Python，不导入模块，不访问文件系统或网络；只在已经抽取入库的 table rows 上执行白名单操作。

请求：

```json
{
  "table_id": "table-id",
  "operation": "sum",
  "column": "金额",
  "filters": [
    { "column": "部门", "op": "eq", "value": "研发" }
  ],
  "limit": 50
}
```

定位表格：

- 优先使用 `table_id`。
- 不传 `table_id` 时，会按 `document_id`、`source_id`、`sheet_name` 找到第一个可读表格。

支持字段：

- `query`：可选自然语言提示，最长 500 字符。目前只做确定性模板解析，可识别计数、求和、平均、最大、最小、按列分组等常见中文/英文词。
- `operation`：`filter`、`sort`、`count`、`sum`、`average`、`min`、`max`、`group`。
- `aggregate`：分组聚合时使用，支持 `count`、`sum`、`average`、`min`、`max`。
- `table_id`
- `source_id`
- `document_id`
- `sheet_name`
- `column`
- `group_by`
- `sort_column`
- `sort_direction`：`asc` 或 `desc`。当前代码只把 `desc` 作为倒序，其它值按升序处理。
- `filters`
- `columns`
- `limit`：默认 50，范围 1 到 200。

支持 filter op：

- `eq`
- `ne`
- `gt`
- `gte`
- `lt`
- `lte`
- `contains`
- `starts_with`
- `ends_with`
- `in`

响应：

```json
{
  "table": {
    "id": "table-id",
    "document_id": "document-id",
    "source_id": "source-id",
    "table_index": 0,
    "sheet_name": "CSV",
    "columns": [],
    "row_count": 2,
    "metadata": {}
  },
  "result": {
    "kind": "scalar",
    "value": 30,
    "matched_numeric_rows": 2,
    "plan": {
      "operation": "sum",
      "column": "金额",
      "filters": []
    },
    "references": {
      "row_indices": [0, 1],
      "columns": ["金额"]
    }
  },
  "generated_at": "2026-06-04T09:00:00Z"
}
```

`result.kind` 可能为：

- `rows`：返回 `rows`、`total_matched`、`returned`。
- `scalar`：返回 `value`，聚合类操作可能返回 `matched_numeric_rows`。
- `groups`：返回 `groups`、`total_groups`。

## MCP Tools

Traditional RAG MCP Server 位于：

```bash
uv run --project modules/traditional-rag python -m traditional_rag.mcp.server
```

MCP Server 是 stdio 进程级服务，Agent Gateway 应按用户会话启动独立进程，并注入：

```bash
TRADITIONAL_RAG_MCP_TOKEN=<bearer-token>
FF_USER_ID=<user-id>
FF_USERNAME=<username>
FF_IS_ADMIN=true|false
```

当前 MCP 工具：

- `traditional_search`
- `traditional_query_table`
- `traditional_get_document`
- `traditional_list_sources`
- `traditional_get_job`

MCP 工具复用同一套 core 权限和业务逻辑。`traditional_search` 返回 evidence，不返回最终自然语言答案。

## 当前未实现或需要注意的边界

- 不提供 `/traditional/ask`。
- 不提供生成式回答接口；最终回答应由 Agent Gateway 基于检索 evidence 生成。
- 不提供业务数据库 Text-to-SQL。
- 不提供任意 SQL / Python 执行。
- 不提供正式 CLI；HTTP API 和 MCP 是当前产品接口。
- PDF 当前只实现 MinerU 解析 metadata/cache；不会自动写入 chunks 或 tables。
- CSV/XLSX 当前创建 table rows，但不会自动创建 searchable chunks。
- `GET /traditional/chunks/search` 是旧关键词接口；完整混合检索应使用 `POST /traditional/search`。
