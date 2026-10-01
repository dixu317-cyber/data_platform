# Nano Brain API

本文档记录当前 Nano Brain 已实现的 HTTP API 与 MCP Tools。

## 访问方式

### 统一 API（推荐）

通过平台统一后端访问：

```txt
http://localhost:${API_PORT:-3001}
```

除 `/health` 外，请携带平台登录后获得的 Bearer Token：

```http
Authorization: Bearer <token>
Content-Type: application/json
```

统一 API 会把 `/nano/*` 请求代理到 Nano Brain 模块，并注入用户上下文。

### 模块 HTTP 服务（内部调用）

Nano Brain 模块本地默认地址：

```txt
http://127.0.0.1:8100
```

模块 HTTP 服务面向 `apps/api` / gateway 内部调用。除 `/health` 外，直接调用需要内部 headers：

```http
x-ff-internal-token: <RAG_INTERNAL_TOKEN>
x-ff-user-id: <user id>
x-ff-username: <username>
x-ff-is-admin: true|false
Content-Type: application/json
```

## 通用错误格式

```json
{
  "error": "invalid_input | not_found | duplicate_source | forbidden | unauthorized | internal_error",
  "message": "错误说明"
}
```

常见状态码：

- `400`：输入不合法
- `401`：未认证或内部 token 无效
- `403`：无权限
- `404`：资源不存在
- `409`：资源冲突
- `500`：服务内部错误

## 权限模型摘要

- 普通用户：
  - 可读写自己的 private source。
  - 可读 public source。
  - 不可写 public source。
  - 不可读其他用户 private source。
- 管理员：
  - 可读写全部 source。
  - 可创建 public source。
  - 可通过 MCP 审核 fact submissions。
- facts 查询：
  - 普通用户可读公共 source 中已审核 facts。
  - 管理员可读全部 facts。
  - pending / rejected / needs_changes submissions 不会直接出现在 facts 查询中，因为只有 approved 审核会写入 facts 表。
- Dream：
  - 普通用户只能运行和查询自己的 `user_source` dream。
  - 管理员可以运行和查询 `public_source` / `review_queue` dream。
  - Dream 可以维护派生索引和生成报告，但不会自动 approve fact submissions，也不会自动合并或改写公共 facts。

---

## 第三阶段新增：Dream 第一版

第三阶段新增 Nano Brain Dream 机制。Dream 是后台整理与巡检能力，不是 LLM 自动写作能力。

已实现能力：

1. `dream_runs` / `dream_phase_runs` 执行报告。
2. `dream_locks` 同 target 执行锁，避免并发 dream。
3. `page_dream_state` 页面级处理水位，用于 `extract_links` 增量执行。
4. `pages.metadata`，用于标记后续 dream 生成页面，例如 `dream_generated=true`。
5. `extract_links` phase：重建页面 links。
6. `refresh_embeddings` phase：刷新 stale embedding chunks。
7. `health_check` phase：输出 source / review queue 健康报告。
8. `review_queue_summary` phase：用确定性规则汇总事实审核队列。
9. Dream HTTP API。
10. Dream MCP Tools。

本阶段未实现：

- LLM 合成页面。
- 自动合并事实或页面。
- 自动批准、拒绝或修改 fact submissions。
- 自动改写 public source 页面。
- 成本控制。

---

# HTTP API

## System

### GET `/health`

健康检查。

响应：

```json
{
  "status": "ok",
  "service": "nano-brain"
}
```

---

## Sources

### GET `/nano/sources`

列出当前用户可读 sources。

响应：

```json
{
  "sources": [
    {
      "id": "source-id",
      "name": "user/alice",
      "kind": "private",
      "owner_user_id": "user-id",
      "created_by": "user-id",
      "created_at": "2026-06-02T00:00:00.000Z",
      "updated_at": "2026-06-02T00:00:00.000Z"
    }
  ]
}
```

### POST `/nano/sources`

创建 public source。仅管理员可用。

请求：

```json
{
  "name": "public/company-brain"
}
```

响应：`201`

```json
{
  "source": {
    "id": "source-id",
    "name": "public/company-brain",
    "kind": "public",
    "owner_user_id": null,
    "created_by": "admin-user-id",
    "created_at": "2026-06-02T00:00:00.000Z",
    "updated_at": "2026-06-02T00:00:00.000Z"
  }
}
```

### GET `/nano/sources/:sourceId`

读取单个 source。需要对该 source 有读权限。

响应：

```json
{
  "source": { "id": "source-id", "name": "public/company-brain", "kind": "public" }
}
```

### PATCH `/nano/sources/:sourceId`

更新 source 名称。普通用户只能管理自己的 private source；管理员可管理全部。

请求：

```json
{
  "name": "public/new-name"
}
```

响应：

```json
{
  "source": { "id": "source-id", "name": "public/new-name", "kind": "public" }
}
```

---

## Pages

### POST `/nano/pages`

写入 Markdown 页面。若同一 `source_id + slug` 已存在，则更新页面并重新处理 chunk / embedding / links。

请求：

```json
{
  "source_id": "source-id",
  "slug": "acme-meeting",
  "title": "Acme Meeting",
  "body": "# Acme Meeting\n\n内容...",
  "content_type": "markdown"
}
```

响应：`201`

```json
{
  "page": {
    "id": "page-id",
    "source_id": "source-id",
    "slug": "acme-meeting",
    "title": "Acme Meeting",
    "body": "# Acme Meeting\n\n内容...",
    "content_hash": "...",
    "created_by": "user-id",
    "updated_by": "user-id",
    "created_at": "2026-06-02T00:00:00.000Z",
    "updated_at": "2026-06-02T00:00:00.000Z"
  }
}
```

### GET `/nano/sources/:sourceId/pages`

列出某个 source 下未归档页面。需要读权限。

响应：

```json
{
  "pages": [
    { "id": "page-id", "source_id": "source-id", "slug": "acme-meeting", "title": "Acme Meeting" }
  ]
}
```

### GET `/nano/pages/:sourceId/:slug`

读取单页。需要读权限。

响应：

```json
{
  "page": { "id": "page-id", "source_id": "source-id", "slug": "acme-meeting", "body": "..." }
}
```

### PUT `/nano/pages/:sourceId/:slug`

更新或写入指定页面。`sourceId` 和 `slug` 来自路径。

请求：

```json
{
  "title": "Acme Meeting Updated",
  "body": "# Acme Meeting Updated\n\n新内容...",
  "content_type": "markdown"
}
```

响应：

```json
{
  "page": { "id": "page-id", "source_id": "source-id", "slug": "acme-meeting" }
}
```

### DELETE `/nano/pages/:sourceId/:slug`

归档页面。需要写权限。

响应：

```json
{
  "page": { "id": "page-id", "source_id": "source-id", "slug": "acme-meeting" },
  "archived": true
}
```

### GET `/nano/pages/:sourceId/:slug/chunks`

读取页面 chunks。需要读权限。

响应：

```json
{
  "chunks": [
    {
      "id": "chunk-id",
      "page_id": "page-id",
      "source_id": "source-id",
      "slug": "acme-meeting",
      "chunk_index": 0,
      "chunk_text": "...",
      "content_hash": "...",
      "embedding_model": "qwen/qwen3-embedding-8b",
      "embedding_dimensions": 4096,
      "created_at": "2026-06-02T00:00:00.000Z",
      "updated_at": "2026-06-02T00:00:00.000Z"
    }
  ]
}
```

---

## Capture

### POST `/nano/capture`

低认知负担内容入口。写入文本或 Markdown，并复用 page pipeline 生成页面、chunks、embedding 和 links。

请求字段：

- `text`：普通文本，可选。
- `markdown`：Markdown 内容，可选。
- `title`：标题，可选。
- `format`：`text | markdown`，可选。不传时根据 `markdown/text` 推断。
- `target`：`private | public`，可选。普通用户只能 `private`；管理员可 `public`。
- `source_id`：当管理员写入 public source 时使用。
- `slug`：可选；不传则自动生成。

请求示例：

```json
{
  "markdown": "# Acme 会议记录\n\nAcme ARR 是 120 万美元。",
  "title": "Acme 会议记录",
  "format": "markdown",
  "target": "private"
}
```

响应：`201`

```json
{
  "capture": { "target": "private", "format": "markdown" },
  "source": { "id": "source-id", "name": "user/alice", "kind": "private" },
  "page": { "id": "page-id", "source_id": "source-id", "slug": "acme-hui-yi-ji-lu" }
}
```

---

## Search / Ask

### POST `/nano/search`

在当前用户可读 sources 中进行关键词 + 向量混合检索。

请求：

```json
{
  "query": "Acme ARR",
  "limit": 10
}
```

响应：

```json
{
  "query": "Acme ARR",
  "results": [
    {
      "chunk_id": "chunk-id",
      "page_id": "page-id",
      "source_id": "source-id",
      "source_kind": "public",
      "source_name": "public/company-brain",
      "slug": "acme-meeting",
      "title": "Acme Meeting",
      "chunk_index": 0,
      "snippet": "...",
      "score": 0.91,
      "match_types": ["keyword", "vector"]
    }
  ]
}
```

### POST `/nano/ask`

问答接口。当前实现不调用生成模型，只返回检索引用与固定说明。

请求：

```json
{
  "query": "Acme ARR 是多少？",
  "limit": 5
}
```

响应：

```json
{
  "query": "Acme ARR 是多少？",
  "answer": "第一阶段问答仅返回检索引用，暂不调用生成模型。请参考 citations。",
  "citations": [
    { "chunk_id": "chunk-id", "page_id": "page-id", "snippet": "..." }
  ]
}
```

---

## Graph / Links

### GET `/nano/links?source_id=<sourceId>&slug=<slug>&link_type=<type>`

读取某页面出链。`source_id` 和 `slug` 必填，`link_type` 可选。

响应：

```json
{
  "links": [
    {
      "id": "link-id",
      "source_id": "source-id",
      "from_page_id": "page-id",
      "from_slug": "acme-meeting",
      "to_source_id": "source-id-or-null",
      "to_slug": "acme",
      "link_type": "mentions",
      "context": "...",
      "confidence": 1,
      "created_by": "user-id",
      "created_at": "2026-06-02T00:00:00.000Z"
    }
  ]
}
```

### GET `/nano/links/:sourceId/:slug?link_type=<type>`

同上，使用路径参数读取出链。

### GET `/nano/backlinks?slug=<slug>&link_type=<type>`

读取指向某 slug 的反链。结果按当前用户可读 source 过滤。

### GET `/nano/backlinks/:slug?link_type=<type>`

同上，使用路径参数读取反链。

### POST `/nano/graph/query`

从某个 slug 出发进行图谱遍历。

请求：

```json
{
  "slug": "acme",
  "depth": 1,
  "direction": "both",
  "link_type": "mentions"
}
```

字段：

- `slug`：起始节点 slug，必填。
- `depth`：`1 | 2`，可选，默认 `1`。
- `direction`：`out | in | both`，可选，默认 `both`。
- `link_type`：可选。

响应：

```json
{
  "root_slug": "acme",
  "depth": 1,
  "direction": "both",
  "nodes": [
    { "slug": "acme", "source_ids": ["source-id"] }
  ],
  "links": [
    { "id": "link-id", "from_slug": "acme-meeting", "to_slug": "acme" }
  ]
}
```

---

## Fact Submissions

### POST `/nano/fact-submissions`

提交自然语言事实线索到公共 source 的审核队列。不会直接写入 public facts，也不会修改公共页面。

请求：

```json
{
  "target_source_id": "public-source-id",
  "raw_claim": "Acme 2026 年 5 月 ARR 是 120 万美元",
  "raw_evidence_text": "会议记录显示 ARR 为 120 万美元。",
  "raw_evidence_url": "https://example.com/evidence",
  "raw_context": "来自 2026 年 5 月经营会"
}
```

响应：`201`

```json
{
  "submission": {
    "id": "submission-id",
    "target_source_id": "public-source-id",
    "submitted_by": "user-id",
    "raw_claim": "Acme 2026 年 5 月 ARR 是 120 万美元",
    "raw_evidence_text": "会议记录显示 ARR 为 120 万美元。",
    "raw_evidence_url": "https://example.com/evidence",
    "raw_context": "来自 2026 年 5 月经营会",
    "warnings": [],
    "status": "pending_review",
    "normalized_candidates": [],
    "created_at": "2026-06-02T00:00:00.000Z",
    "updated_at": "2026-06-02T00:00:00.000Z"
  }
}
```

如果未提供证据文本和证据 URL，会返回 `missing_evidence` warning。

### GET `/nano/fact-submissions`

列出 fact submissions。

查询参数：

- `status`：`pending_review | needs_changes | approved | rejected`
- `submitted_by`：提交人 id。管理员可用于过滤；普通用户只能看到自己的提交。
- `target_source_id`：目标 public source id。
- `limit`：`1..200`，默认 `50`。

响应：

```json
{
  "submissions": [
    { "id": "submission-id", "status": "pending_review", "submitted_by": "user-id" }
  ]
}
```

### GET `/nano/fact-submissions/:submissionId`

读取单条 fact submission。普通用户只能读取自己的提交，管理员可读取全部。

响应：

```json
{
  "submission": { "id": "submission-id", "status": "pending_review" }
}
```

### POST `/nano/fact-submissions/:submissionId/candidates`

管理员保存结构化事实候选到 `fact_submissions.normalized_candidates`。等价于 MCP 工具 `nano_save_fact_candidates` 的 HTTP 入口。仅管理员可调用；已 `approved` 或 `rejected` 的 submission 不能再修改候选。

请求体：

```json
{
  "candidates": [
    {
      "entity_slug": "companies/acme",
      "fact": "Acme ARR 是 120 万美元",
      "kind": "fact",
      "confidence": 0.86,
      "notability": "high",
      "claim_metric": "arr",
      "claim_value": 1200000,
      "claim_unit": "USD",
      "claim_period": "2026-05",
      "evidence_quote": "证据摘录",
      "normalization_confidence": 0.82,
      "warnings": []
    }
  ],
  "generated_by": "agent",
  "generator": "admin-agent"
}
```

响应：

```json
{
  "submission": { "id": "submission-id", "normalized_candidates": [] }
}
```

### POST `/nano/fact-submissions/:submissionId/review`

管理员审核事实提交。等价于 MCP 工具 `nano_admin_review_fact_submission` 的 HTTP 入口。仅管理员可调用；已 `approved` 或 `rejected` 的 submission 不能再次审核。

请求体：

```json
{
  "action": "approve | reject | request_changes",
  "approved_fact": {
    "entity_slug": "companies/acme",
    "fact": "最终批准事实",
    "kind": "fact",
    "confidence": 0.9,
    "notability": "high",
    "context": "上下文",
    "valid_from": "2026-05-01",
    "valid_until": "2026-12-31",
    "claim_metric": "arr",
    "claim_value": 1200000,
    "claim_unit": "USD",
    "claim_period": "2026-05",
    "evidence_url": "https://example.com/evidence",
    "evidence_quote": "证据摘录"
  },
  "review_comment": "审核说明"
}
```

规则：

- `approve` 时必须提供 `approved_fact`，会写入 facts 表并把 submission 标记为 `approved`。
- `reject` 与 `request_changes` 时必须提供 `review_comment`，不会写入 facts 表，分别标记为 `rejected`、`needs_changes`。

响应：

```json
{
  "submission": { "id": "submission-id", "status": "approved" },
  "fact": { "id": "fact-id" },
  "audit_log": { "id": "audit-id", "action": "fact_submission.approve" }
}
```

---

## Facts

### GET `/nano/facts`

查询已审核写入 facts 表的事实。普通用户按 source 权限过滤；管理员可读全部。

查询参数：

- `source_id`：可选，按 source 过滤。
- `entity_slug`：可选，按实体过滤。
- `submitted_by`：可选，按提交人过滤。
- `status`：可选，按关联 submission 状态过滤。当前 facts 正常只对应 `approved`。
- `limit`：`1..200`，默认 `50`。

响应：

```json
{
  "facts": [
    {
      "id": "fact-id",
      "source_id": "source-id",
      "submission_id": "submission-id",
      "entity_slug": "companies/acme",
      "fact": "Acme 2026 年 5 月 ARR 约为 120 万美元",
      "kind": "fact",
      "confidence": 0.9,
      "notability": "high",
      "context": null,
      "valid_from": null,
      "valid_until": null,
      "claim_metric": "arr",
      "claim_value": 1200000,
      "claim_unit": "USD",
      "claim_period": "2026-05",
      "evidence_url": "https://example.com/evidence",
      "evidence_quote": "会议记录显示 ARR 为 120 万美元。",
      "approved_by": "admin-user-id",
      "approved_at": "2026-06-02T00:00:00.000Z",
      "submitted_by": "user-id",
      "submission_status": "approved",
      "created_at": "2026-06-02T00:00:00.000Z",
      "updated_at": "2026-06-02T00:00:00.000Z"
    }
  ]
}
```

### GET `/nano/facts/:factId`

读取单条 fact。结果按 source 权限过滤。

响应：

```json
{
  "fact": { "id": "fact-id", "submission_id": "submission-id", "approved_by": "admin-user-id" }
}
```

### GET `/nano/entities/:entitySlug/facts`

按实体 slug 查询 facts。

支持查询参数：

- `source_id`
- `submitted_by`
- `status`
- `limit`

响应：

```json
{
  "facts": [
    { "id": "fact-id", "entity_slug": "companies/acme", "fact": "..." }
  ]
}
```

---

## Dream

Dream 是 Nano Brain 的后台整理与巡检机制。HTTP API 与 MCP Tools 都复用 `src/core/dream/runner.ts`；权限过滤在 core 查询中完成。

Dream target：

| target | 用途 | 触发权限 |
|---|---|---|
| `user_source` | 用户自己的 private source 后台维护 | 用户本人 / 管理员 / 系统 |
| `public_source` | public source 后台维护 | 管理员 / 系统 |
| `review_queue` | fact submissions 审核队列摘要 | 管理员 / 系统 |

权限规则：

- 普通用户只能触发自己的 `user_source`（private source）dream。
- 普通用户不能触发 `public_source` 或 `review_queue` dream。
- 普通用户只能查询自己的 `user_source` dream runs/status，不会看到其他用户 private source 或 public/review_queue runs。
- 管理员可以触发和查询 `public_source`、`review_queue` 以及所有 dream runs。

Dream phases：

| phase | 适用 target | 是否写业务数据 | 说明 |
|---|---|---:|---|
| `extract_links` | `user_source`, `public_source` | 是 | 重新抽取 Markdown wiki links / Markdown 内链并写入 `links`；跳过 archived 和 `metadata.dream_generated=true` 页面；用 `page_dream_state` 增量跳过未变页面。 |
| `refresh_embeddings` | `user_source`, `public_source` | 是 | 找出 `chunks.embedding_model` 与当前 `EMBEDDING_MODEL` 不一致的 stale chunks，重新生成 embedding 并更新 chunks。 |
| `health_check` | 全部 | 否 | 只读统计 pages、chunks、links、facts、pending submissions、stale embeddings、dangling links、orphan pages、最近失败 runs 等。 |
| `review_queue_summary` | `review_queue` | 否 | 只读汇总 `pending_review` / `needs_changes` submissions，输出缺证据、分组、疑似重复、疑似冲突。不会写 facts，不会修改 submission 状态。 |

Dry-run：

- `dry_run=true` 时仍会写 `dream_runs` / `dream_phase_runs` 报告。
- 不会写 links、page_dream_state、chunks embedding 等派生数据。
- 用于预览将处理页面数、将写入 links 数、stale chunks 数等。

执行状态：

- `clean`：没有需要处理的内容，或健康检查没有问题。
- `ok`：执行成功且有处理结果或发现健康信号。
- `partial`：部分 phase 失败。
- `skipped`：不适用或未获得 lock。
- `failed`：phase 或 run 失败。

### POST `/nano/dream/runs`

触发 dream。

请求：

```json
{
  "target": {
    "type": "user_source | public_source | review_queue",
    "source_id": "source-id",
    "user_id": "user-id",
    "target_source_id": "public-source-id"
  },
  "phases": ["extract_links", "refresh_embeddings", "health_check", "review_queue_summary"],
  "dry_run": true
}
```

说明：

- `user_source`：`source_id` 必填；普通用户可省略 `user_id`，默认使用当前用户。
- `public_source`：`source_id` 必填，仅管理员可用。
- `review_queue`：仅管理员可用；`target_source_id` 可选，用于限定某个 public source 的审核队列。
- `phases` 可省略；source dream 默认运行 `extract_links`、`refresh_embeddings`、`health_check`，review queue dream 默认运行 `review_queue_summary`、`health_check`。

响应：`202`（G1 后台化）

Dream 已在后台启动，接口**立即返回 run 概要**（不等 phases 跑完）：`status` 为 `running`（已拿到并发锁）或 `skipped`（未拿到锁，同 target 已有 dream 在跑）。用 `GET /nano/dream/runs/:runId`（终态 report）或 `GET /nano/dream/runs`（列表，实时 status）轮询终态 `clean/ok/partial/failed`。

```json
{
  "run": {
    "id": "dream-run-id",
    "target": { "type": "user_source", "sourceId": "source-id", "userId": "user-id" },
    "status": "running",
    "dry_run": true,
    "requested_phases": ["health_check"],
    "started_at": "2026-07-01T00:00:00.000Z",
    "finished_at": null,
    "created_at": "2026-07-01T00:00:00.000Z"
  }
}
```

> 注：`GET /nano/dream/runs/:runId` 返回终态 report；run 未完成时其 `status` 反映真实的 `running`/`pending`（G1 后已不再伪装成 `partial`）。

### GET `/nano/dream/runs`

列出当前用户可读 dream runs。

查询参数：

- `target_type`：`user_source | public_source | review_queue`
- `source_id`：按 target source 过滤。
- `status`：`pending | running | clean | ok | partial | skipped | failed`
- `limit`：`1..100`，默认 `20`。

响应：

```json
{
  "runs": [
    {
      "id": "dream-run-id",
      "target": { "type": "user_source", "sourceId": "source-id", "userId": "user-id" },
      "triggered_by": "user",
      "triggered_by_user_id": "user-id",
      "dry_run": true,
      "status": "clean",
      "requested_phases": ["health_check"],
      "totals": {},
      "started_at": "2026-06-02T00:00:00.000Z",
      "finished_at": "2026-06-02T00:00:00.000Z",
      "created_at": "2026-06-02T00:00:00.000Z"
    }
  ]
}
```

### GET `/nano/dream/runs/:runId`

查询单次 dream run 报告。普通用户只能读取自己的 `user_source` run。

响应：

```json
{
  "run": {
    "schema_version": "1",
    "run_id": "dream-run-id",
    "target": { "type": "user_source", "sourceId": "source-id", "userId": "user-id" },
    "status": "ok",
    "dry_run": false,
    "requested_phases": ["extract_links", "health_check"],
    "phases": [
      {
        "phase": "health_check",
        "status": "clean",
        "durationMs": 5,
        "summary": "...",
        "details": {}
      }
    ],
    "totals": {}
  }
}
```

常见 phase `details` 字段：

```json
{
  "phaseVersion": "m21.v1",
  "dryRun": false,
  "pages": { "total": 12, "active": 11, "archived": 1, "dreamGenerated": 0 },
  "chunks": { "total": 48, "pagesWithChunks": 11, "missingEmbeddings": 0 },
  "links": { "total": 36 },
  "facts": { "total": 5 },
  "pendingSubmissions": { "pending": 3 },
  "staleEmbeddings": {
    "status": "available",
    "currentModel": "qwen/qwen3-embedding-8b",
    "staleChunks": 0,
    "stalePages": 0,
    "missingChunks": 0,
    "staleModelCounts": {}
  },
  "danglingLinks": { "count": 2, "samples": [] },
  "orphanPages": { "count": 1, "samples": [] },
  "recentFailedDreamRuns": { "count": 0, "items": [] }
}
```

`review_queue_summary` 的 `details` 示例：

```json
{
  "phaseVersion": "m22.v1",
  "dryRun": false,
  "targetType": "review_queue",
  "targetSourceId": "public-source-id",
  "statusCounts": {
    "pending_review": 2,
    "needs_changes": 1,
    "total": 3
  },
  "candidateCount": 3,
  "missingEvidence": {
    "count": 1,
    "submissionIds": ["submission-id"]
  },
  "groups": [
    {
      "key": {
        "entitySlug": "companies/acme",
        "claimMetric": "ARR",
        "claimPeriod": "2026Q1"
      },
      "candidateCount": 3,
      "submissionIds": ["submission-a", "submission-b"]
    }
  ],
  "possibleDuplicates": { "count": 1, "items": [] },
  "possibleConflicts": { "count": 1, "items": [] },
  "readOnly": true
}
```

### GET `/nano/dream/status`

查询当前可见的 active locks、最近 runs 和最近失败/partial runs。

查询参数：

- `limit`：`1..50`，默认 `10`。

响应：

```json
{
  "status": {
    "checked_at": "2026-06-02T00:00:00.000Z",
    "active_locks": [],
    "recent_runs": [],
    "recent_failures": []
  }
}
```

---

## Internal

### POST `/internal/users/default-source`

内部接口。注册或初始化用户时，确保用户拥有默认 private source。

请求体可为空。

响应：

```json
{
  "source": { "id": "source-id", "name": "user/alice", "kind": "private" }
}
```

---

# MCP Tools

Nano Brain MCP Server 通过 stdio 启动，默认使用环境变量 `NANO_BRAIN_MCP_TOKEN` 解析当前调用者身份。

```bash
NANO_BRAIN_MCP_TOKEN=<bearer-token> bun --cwd modules/nano-brain mcp
```

工具返回 JSON 文本；错误时 `isError=true`，内容形如：

```json
{
  "error": "forbidden",
  "message": "无权..."
}
```

## 已实现工具列表

### `nano_search`

检索 Nano Brain。

输入：

```json
{
  "query": "Acme ARR",
  "limit": 10
}
```

输出：

```json
{
  "query": "Acme ARR",
  "results": []
}
```

### `nano_capture`

Capture 文本或 Markdown。

输入：

```json
{
  "text": "普通文本",
  "markdown": "# Markdown",
  "title": "标题",
  "format": "text | markdown",
  "target": "private | public",
  "source_id": "source-id",
  "slug": "optional-slug"
}
```

输出：

```json
{
  "capture": { "target": "private", "format": "markdown" },
  "source": {},
  "page": {}
}
```

### `nano_run_my_source_dream`

触发当前用户自己的 private source dream。普通用户只能运行自己的 `user_source`，管理员调用时也按“当前用户自己的 private source”处理。

输入：

```json
{
  "source_id": "private-source-id",
  "phases": ["extract_links", "refresh_embeddings", "health_check"],
  "dry_run": true
}
```

输出：

```json
{
  "run": { "run_id": "dream-run-id", "target": { "type": "user_source" }, "status": "clean" }
}
```

### `nano_admin_run_dream`

管理员触发 `public_source` 或 `review_queue` dream。普通用户调用返回 `forbidden`。

输入：

```json
{
  "target_type": "public_source | review_queue",
  "source_id": "public-source-id",
  "target_source_id": "public-source-id",
  "phases": ["health_check", "review_queue_summary"],
  "dry_run": true
}
```

说明：

- `target_type=public_source` 时 `source_id` 必填。
- `target_type=review_queue` 时 `target_source_id` 可选；也可用 `source_id` 表示目标 public source。

输出：

```json
{
  "run": { "run_id": "dream-run-id", "target": { "type": "public_source" }, "status": "clean" }
}
```

### `nano_get_dream_status`

查询当前用户可见的 dream 状态。普通用户只会看到自己的 `user_source` locks/runs/failures。

输入：

```json
{
  "limit": 10
}
```

输出：

```json
{
  "status": {
    "checked_at": "2026-06-02T00:00:00.000Z",
    "active_locks": [],
    "recent_runs": [],
    "recent_failures": []
  }
}
```

### `nano_get_dream_run`

按 run id 查询 dream 执行报告。普通用户只能读取自己的 `user_source` dream run。

输入：

```json
{
  "run_id": "dream-run-id"
}
```

输出：

```json
{
  "run": { "run_id": "dream-run-id", "phases": [], "totals": {} }
}
```

### `nano_submit_fact`

提交事实线索。

输入：

```json
{
  "target_source_id": "public-source-id",
  "raw_claim": "事实线索",
  "raw_evidence_text": "证据文本",
  "raw_evidence_url": "https://example.com/evidence",
  "raw_context": "上下文"
}
```

输出：

```json
{
  "submission": {}
}
```

### `nano_list_my_fact_submissions`

列出当前用户自己的事实提交。管理员调用时默认列出全部，可按 `submitted_by` 过滤。

输入：

```json
{
  "status": "pending_review | needs_changes | approved | rejected",
  "submitted_by": "user-id",
  "target_source_id": "source-id",
  "limit": 50
}
```

输出：

```json
{
  "submissions": []
}
```

### `nano_admin_list_fact_submissions`

管理员列出全部事实提交队列。

输入同 `nano_list_my_fact_submissions`。

### `nano_get_fact_submission`

读取单条事实提交。

输入：

```json
{
  "submission_id": "submission-id"
}
```

输出：

```json
{
  "submission": {}
}
```

### `nano_save_fact_candidates`

管理员 / Agent 保存结构化事实候选到 `fact_submissions.normalized_candidates`。

输入：

```json
{
  "submission_id": "submission-id",
  "candidates": [
    {
      "entity_slug": "companies/acme",
      "fact": "Acme ARR 是 120 万美元",
      "kind": "fact",
      "confidence": 0.86,
      "notability": "high",
      "claim_metric": "arr",
      "claim_value": 1200000,
      "claim_unit": "USD",
      "claim_period": "2026-05",
      "evidence_quote": "证据摘录",
      "normalization_confidence": 0.82,
      "warnings": []
    }
  ],
  "generated_by": "agent",
  "generator": "admin-agent"
}
```

输出：

```json
{
  "submission": {}
}
```

### `nano_admin_review_fact_submission`

管理员审核事实提交。

输入：

```json
{
  "submission_id": "submission-id",
  "action": "approve | reject | request_changes",
  "approved_fact": {
    "entity_slug": "companies/acme",
    "fact": "最终批准事实",
    "kind": "fact",
    "confidence": 0.9,
    "notability": "high",
    "context": "上下文",
    "valid_from": "2026-05-01",
    "valid_until": "2026-12-31",
    "claim_metric": "arr",
    "claim_value": 1200000,
    "claim_unit": "USD",
    "claim_period": "2026-05",
    "evidence_url": "https://example.com/evidence",
    "evidence_quote": "证据摘录"
  },
  "review_comment": "审核说明"
}
```

规则：

- `approve` 时必须提供 `approved_fact`，会写入 facts 表。
- `reject` 和 `request_changes` 时必须提供 `review_comment`，不会写入 facts 表。

输出：

```json
{
  "submission": {},
  "fact": {},
  "audit_log": {}
}
```

### `nano_list_facts`

列出当前用户可读 facts。

输入：

```json
{
  "source_id": "source-id",
  "entity_slug": "companies/acme",
  "submitted_by": "user-id",
  "status": "approved",
  "limit": 50
}
```

输出：

```json
{
  "facts": []
}
```

### `nano_get_fact`

读取单条 fact。

输入：

```json
{
  "fact_id": "fact-id"
}
```

输出：

```json
{
  "fact": {}
}
```

### `nano_get_entity_facts`

按实体 slug 读取 facts。

输入：

```json
{
  "entity_slug": "companies/acme",
  "source_id": "source-id",
  "submitted_by": "user-id",
  "status": "approved",
  "limit": 50
}
```

输出：

```json
{
  "facts": []
}
```

### `nano_admin_list_audit_logs`

管理员列出审计日志。

输入：

```json
{
  "action": "fact_submission.approve | fact_submission.reject | fact_submission.request_changes",
  "target_type": "fact_submission",
  "target_id": "submission-id",
  "actor_user_id": "admin-user-id",
  "limit": 50
}
```

输出：

```json
{
  "audit_logs": []
}
```

### `nano_get_page`

读取页面。

输入：

```json
{
  "source_id": "source-id",
  "slug": "page-slug"
}
```

输出：页面对象。

### `nano_get_links`

读取页面出链。

输入：

```json
{
  "source_id": "source-id",
  "slug": "page-slug",
  "link_type": "mentions"
}
```

输出：

```json
{
  "links": []
}
```

### `nano_get_backlinks`

读取反链。

输入：

```json
{
  "slug": "target-slug",
  "link_type": "mentions"
}
```

输出：

```json
{
  "links": []
}
```

### `nano_graph_query`

图谱遍历。

输入：

```json
{
  "slug": "acme",
  "depth": 1,
  "direction": "out | in | both",
  "link_type": "mentions"
}
```

输出：

```json
{
  "root_slug": "acme",
  "depth": 1,
  "direction": "both",
  "nodes": [],
  "links": []
}
```
