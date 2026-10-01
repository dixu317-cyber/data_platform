# CLAUDE.md — Nano Brain

本文件是 `modules/nano-brain` 的模块级工作准则。进入本模块修改代码时，优先遵守本文件、模块内 `docs/`、顶层 `README.md` 与仓库级 `CLAUDE.md`。

## 模块定位

Nano Brain 是 FF-CompanyBrain 平台中第一条主要完整知识链路。它负责 Markdown 知识页面、chunk、embedding、搜索、页面链接、facts、fact submissions、Dream 后台整理与 MCP 工具。

Nano Brain 不负责：

- 用户注册、登录、Bearer Token 生成。
- 管理员身份判定。
- 统一前端路由和页面布局。
- Agent 会话、run、SSE、checkpoint。
- Traditional RAG 或 GraphRAG 的业务能力。

这些能力分别属于 `packages/identity`、`apps/web`、`apps/agent-gateway` 和其他模块。

## 技术栈

```txt
运行时：Bun / TypeScript
HTTP 框架：Hono
数据库：PostgreSQL + pgvector
MCP：@modelcontextprotocol/sdk
embedding：OpenRouter OpenAI-compatible API
启动方式：纯本地进程
```

## 目录职责

```txt
src/
  core/                模块业务能力：sources、pages、chunks、search、facts、dream
  core/dream/          Dream runner、phase、locks、执行状态
  http/                Hono HTTP 适配层、路由、鉴权 header 解析、序列化
  http/routes/         模块 HTTP API 路由
  mcp/                 MCP Server 与 tools 暴露
  db.ts                数据库连接
  migrations.ts        Nano Brain 数据库迁移

docs/
  PRD.md
  ARCHITECTURE.md
  API.md
```

## 业务边界

1. 业务逻辑优先放在 `src/core/`。
2. HTTP routes 只做请求解析、权限上下文转换、调用 core、响应序列化。
3. MCP tools 只做工具入参校验、调用 core、输出工具结果。
4. 不把 Nano Brain 业务能力实现到 `apps/api` 或 `apps/agent-gateway`。
5. 不从 Traditional RAG 或 GraphRAG 导入业务代码。
6. 不在前端复制 Nano Brain 的最终权限判断。

可接受的调用方向：

```txt
apps/api -> Nano Brain HTTP
apps/agent-gateway -> Nano Brain MCP
Nano Brain http/mcp -> Nano Brain core
Nano Brain core -> Nano Brain database
```

## 数据模型

Nano Brain 使用 `NANO_BRAIN_DATABASE_URL` 指向独立 PostgreSQL database。主要表包括：

| 表 | 职责 |
| --- | --- |
| `sources` | private/public source |
| `pages` | Markdown 页面、slug、归档、metadata |
| `chunks` | 页面切分结果、embedding、模型信息 |
| `links` | 页面之间的图谱关系边 |
| `fact_submissions` | 用户提交的待审核事实 |
| `facts` | 已审核事实 |
| `audit_logs` | fact review 等关键动作审计 |
| `dream_runs` | Dream 执行记录 |
| `dream_phase_runs` | Dream phase 执行记录 |
| `dream_locks` | Dream 并发锁 |
| `page_dream_state` | 页面级 Dream 增量处理水位 |

迁移集中在 `src/migrations.ts`。新增表或字段时，要保持迁移幂等，使用 `IF NOT EXISTS` 或兼容现有数据的 `ALTER TABLE`。

## 权限模型

Source 权限：

- 普通用户可读写自己的 private source。
- 普通用户可读 public source。
- 普通用户不能写 public source。
- 普通用户不能读其他用户 private source。
- 管理员可读写全部 source，并可创建 public source。

Facts 权限：

- 普通用户可提交 fact submissions。
- 管理员负责审核 submissions。
- 只有 approved submission 会写入 `facts`。
- pending、rejected、needs_changes 不应直接出现在 facts 查询结果中。

Dream 权限：

- 普通用户只能运行和查询自己的 `user_source` dream。
- 管理员可以运行和查询 `public_source`、`review_queue` dream。
- Dream 可以维护派生索引和生成报告，但不能自动 approve fact submissions，也不能自动改写 public source 页面。

权限过滤应在 core/service 或 SQL 查询层完成，前端隐藏按钮只能作为体验优化。

## HTTP 与 MCP

HTTP 服务默认地址：

```txt
http://127.0.0.1:8100
```

统一 API 会把 `/nano/*` 转发到 Nano Brain，并注入内部 headers：

```http
x-ff-internal-token: <RAG_INTERNAL_TOKEN>
x-ff-user-id: <user-id>
x-ff-username: <username>
x-ff-is-admin: true | false
```

模块 HTTP 服务不直接解析平台 Bearer Token。除 `/health` 外，受保护接口必须依赖内部 headers。

MCP Server 是 Agent Gateway 使用的工具入口。新增能力时，如果该能力需要被 Agent 调用，应同时考虑 HTTP API 和 MCP Tool 是否都需要暴露，但业务实现仍应共用 core。

## 环境变量

```txt
NANO_BRAIN_DATABASE_URL
RAG_INTERNAL_TOKEN
NANO_BRAIN_HTTP_PORT
NANO_BRAIN_HTTP_URL

EMBEDDING_PROVIDER
EMBEDDING_BASE_URL
EMBEDDING_API_KEY
EMBEDDING_MODEL
```

约束：

- 禁止硬编码 embedding key、base URL、模型名或内部 token。
- `EMBEDDING_API_KEY` 只能存在于本地 `.env` 或部署密钥系统。
- embedding dimensions 与实际模型输出必须一致；修改模型时要检查数据库向量维度和检索逻辑。

## 实现准则

- 输入校验靠近入口，业务不变量放在 core。
- 错误类型保持稳定，HTTP 层负责映射状态码和响应格式。
- 写入页面后，必须维护 chunk、embedding、links 等派生数据的一致性。
- Search 要同时尊重 source 可见性、归档状态和 embedding 配置。
- Fact review 必须写审计信息，不能绕过审核直接写 facts。
- Dream phase 要可重复执行，失败要记录到 run/phase 状态中，避免半完成状态不可追踪。
- 数据库查询不要做应用层后过滤敏感资源。

## 常用命令

```bash
# 启动 Nano Brain HTTP
bun run dev:nano-http

# 启动 Nano Brain MCP
bun run dev:nano-mcp

# 直接在模块目录启动 HTTP
bun --cwd modules/nano-brain http

# 直接在模块目录启动 MCP
bun --cwd modules/nano-brain mcp

# 全仓类型检查
bun x tsc --noEmit

# 初始化/迁移数据库
bun run db:init
```

## 验证要求

按变更范围选择验证：

- 修改 TypeScript 类型、core、HTTP、MCP：运行 `bun x tsc --noEmit`。
- 修改 HTTP API：启动 `bun run dev:nano-http`，通过统一 API 或内部 headers 验证关键接口。
- 修改 MCP tools：启动 `bun run dev:nano-mcp` 或通过 Agent Gateway 验证工具可用。
- 修改 migrations：运行 `bun run db:init`，确认迁移幂等。
- 修改前端调用 Nano Brain 的页面：同时运行前端构建和浏览器检查。

## 参考

- `docs/API.md`：Nano Brain HTTP API 与 MCP Tools。
- `docs/ARCHITECTURE.md`：模块架构。
- `docs/PRD.md`：产品需求。
- 顶层 `README.md`：本地启动、部署预检与服务拓扑。
