# FF-CompanyBrain 开发计划

## 当前状态

第一阶段、第二阶段、第三阶段、第四阶段已完成。

第五阶段已完成 M32-M39，M40 尚未执行。

第六阶段计划：Traditional RAG 文档链路。

第一阶段范围：Nano Brain 本地完整链路，包括用户体系、管理员初始化、source 权限、Markdown page pipeline、chunk、embedding、检索、公共 source、知识图谱、MCP Server、本地端到端验收与中文复杂场景验收。

第二阶段范围：低认知负担 Capture 入口、事实提交队列、Agent 生成并保存结构化事实候选、管理员通过 MCP 审核、公共 facts 查询、真实 LangChain Agent 端到端实测。

第三阶段范围：Nano Brain Dream 第一版，包括 dream 数据模型、执行锁、dry-run、执行报告、链接重建、embedding 刷新、健康检查、审核队列规则化摘要、HTTP API、MCP Tools、中文复杂场景端到端验收。

第四阶段范围：Agent Gateway 真实 Chat 服务，包括 Hono HTTP API、LangChain createAgent、Nano Brain MCP Tools 接入、SSE Chat、LangGraph PostgresSaver checkpoint、conversation/run/tool-call 查询、管理员审核辅助流、中文复杂场景端到端验收。

第五阶段范围：前端开发、完整 API 对接与浏览器联调，包括 Next.js SaaS 壳层、认证、系统健康、Source/Page/Capture/Search/Ask/Graph/Facts/Dream 工作台、Agent Chat SSE、run/tool trace 与管理员相关页面。

第六阶段范围：为现有平台加入独立 Traditional RAG 文档链路，包括 PDF/DOCX/CSV/XLSX/Markdown/TXT 上传、MinerU API PDF 解析、异步处理 job、PostgreSQL + pgvector 索引、权限过滤检索、受限表格查询、HTTP API、MCP 只读工具、前端工作区与 API/浏览器端到端验收。

## 第一阶段完成记录

```txt
M1  用户体系与管理员初始化                 已完成
M2  Nano Brain 数据库与 source 权限         已完成
M3  Markdown 上传与 page pipeline           已完成
M4  chunk 与 OpenRouter embedding           已完成
M5  检索 API                                已完成
M6  公共 source 与管理员管理                已完成
M7  知识图谱基础能力                        已完成
M8  MCP Server 第一版                       已完成
M9  本地端到端验收                          已完成
M10 中文复杂场景验收                        已完成
```

## 第二阶段完成记录

```txt
M11 用户友好 Capture 入口                    已完成
M12 事实提交队列                             已完成
M13 Agent 生成并保存结构化事实候选            已完成
M14 管理员通过 Agent / MCP 审核事实提交       已完成
M15 公共 facts 查询                          已完成
M16 第二阶段端到端 + LangChain Agent 实测     已完成
```

## 第三阶段完成记录

```txt
M17 Dream 数据模型与 core 类型                 已完成
M18 Dream runner、锁、dry-run、执行报告          已完成
M19 extract_links phase                         已完成
M20 refresh_embeddings phase                    已完成
M21 health_check phase                          已完成
M22 review_queue_summary phase                  已完成
M23 Dream HTTP API 与 MCP Tools                 已完成
M24 第三阶段端到端验收                          已完成
```

## 第四阶段完成记录

```txt
M25 Agent Gateway HTTP API 与数据模型骨架          已完成
M26 LangChain createAgent 与模型配置               已完成
M27 Nano Brain MCP Tools 接入                      已完成
M28 SSE Chat API 与事件流                          已完成
M29 会话、checkpoint 消息、run、tool call 查询       已完成
M30 管理员 Agent 审核辅助流                         已完成
M31 第四阶段中文复杂场景端到端验收                  已完成
```

## 第五阶段完成记录

```txt
M32 设计系统迁移、Web 应用骨架与像素级基线              已完成
M33 API Client、认证状态、登录注册与系统健康页            已完成
M34 Source 工作台与权限可视化                            已完成
M35 Page 管理、Markdown 编辑、chunks 与页面详情           已完成
M36 Capture、Search/Ask、Graph/Links 一体化查询           已完成
M37 Fact submissions、facts 与实体事实页面                已完成
M38 管理员 public source、审核队列与 Dream 管理            已完成
M39 Agent Chat SSE、conversation 与 run/tool trace         已完成
M40 第五阶段中文复杂场景前端/API/Agent 端到端验收          待执行
```

## 归档说明

第一至第四阶段测试记录和测试脚本已归档到仓库顶层本地目录：

```txt
archive/phase-1/records/
archive/phase-1/tests/
archive/phase-2/records/
archive/phase-2/tests/
archive/phase-3/records/
archive/phase-3/tests/
archive/phase-4/records/
archive/phase-4/tests/
```

第五阶段测试记录、测试脚本和浏览器观测截图沿用本地归档目录：

```txt
archive/phase-5/records/
archive/phase-5/tests/
archive/phase-5/screenshots/
```

`archive/` 已加入 `.gitignore`，仅作为本地归档目录，不再作为后续开发计划的一部分维护。

## 第六阶段计划：Traditional RAG 文档链路

第六阶段目标：把 `modules/traditional-rag` 从骨架升级为完整可用的传统文档 RAG 服务，并在 `apps/web` 中新增与 Nano Brain 并列、完全隔离的 Traditional RAG 工作区。整个阶段必须坚持前后端同步开发，每个能力点交付时都要同时完成后端 API、前端界面和浏览器可用性验证，不能只完成后端能力或只停留在接口文档层面。

第六阶段只做文档型 RAG，不做业务数据库 Text-to-SQL，不做 GraphRAG，不做图搜图/文搜图图片库，不提供 `/traditional/ask`，也不提供 `traditional_ask` MCP tool。最终自然语言回答由 Agent Gateway 基于检索证据自行生成。

### 第六阶段核心决策

1. Traditional RAG 是独立链路，与 Nano Brain source/page/facts/Dream 不混用。
2. 统一 API 和 Agent Gateway 不允许直接操作 Traditional RAG 数据库。
3. Traditional RAG 使用 `TRADITIONAL_RAG_DATABASE_URL` 指向独立 PostgreSQL database，并启用 pgvector。
4. 原始文件、MinerU 解析产物、Markdown、图片资源等存入本地目录 `TRADITIONAL_RAG_STORAGE_DIR`。
5. PDF 解析必须使用 MinerU API，首版不考虑 MinerU 本地部署。
6. 支持文件类型：PDF、DOCX、CSV、XLSX、Markdown、TXT。
7. 上传处理采用异步 job，状态流转为 `uploaded -> parsing -> chunking -> embedding -> ready/failed`。
8. 检索只返回证据、引用、分数、页码、表格位置、图片资源引用，不生成最终答案。
9. CSV/XLSX 支持受限 Pandas 表格查询，可由 LLM 将自然语言转换为白名单操作，但禁止任意 Python 执行。
10. MCP 首版只读，不提供上传、删除、创建 public source、重新索引等写入工具。
11. 每个里程碑必须前后端同步交付，并同时通过 API 层实测和浏览器层实测，确保对应功能在真实页面中可操作、可观察、可验证。

### 第六阶段环境变量

```txt
TRADITIONAL_RAG_DATABASE_URL
TRADITIONAL_RAG_STORAGE_DIR
TRADITIONAL_RAG_HTTP_PORT
RAG_INTERNAL_TOKEN
MINERU_API_KEY
EMBEDDING_PROVIDER
EMBEDDING_BASE_URL
EMBEDDING_API_KEY
EMBEDDING_MODEL
AGENT_PROVIDER
AGENT_BASE_URL
AGENT_API_KEY
AGENT_MODEL
NEXT_PUBLIC_API_BASE_URL
NEXT_PUBLIC_AGENT_GATEWAY_BASE_URL
```

### 第六阶段 HTTP API

```txt
GET    /traditional/sources
POST   /traditional/sources
GET    /traditional/sources/:sourceId
PATCH  /traditional/sources/:sourceId

POST   /traditional/documents
GET    /traditional/documents
GET    /traditional/documents/:documentId
DELETE /traditional/documents/:documentId

GET    /traditional/jobs/:jobId
POST   /traditional/search
POST   /traditional/tables/query
```

### 第六阶段 MCP Tools

```txt
traditional_search
traditional_query_table
traditional_get_document
traditional_list_sources
traditional_get_job
```

MCP tools 必须基于当前用户上下文执行权限过滤。Agent Gateway 通过这些工具获取证据，再由 Agent 自行组织最终回答。

### 第六阶段权限模型

Traditional RAG 在模块内独立实现 source 权限：

```txt
private source：普通用户自己的文档空间
public source：管理员维护的公共文档空间
```

规则：

- 普通用户自动拥有自己的 private source。
- 普通用户只能上传、删除、查询自己的 private source 文档。
- 普通用户可以读取 public source。
- public source 只有管理员可以创建、上传、更新和删除文档。
- 管理员可以读取和维护所有 Traditional RAG source。
- 权限过滤必须发生在检索和表格查询执行前。

### 第六阶段里程碑

```txt
M41 Traditional RAG 数据库、source 权限与本地存储基线        已完成
M42 文档上传、异步 job 与文件类型识别                         已完成
M43 MinerU API PDF 解析与解析产物缓存                         已完成
M44 DOCX/Markdown/TXT 解析与 chunk/embedding                   已完成
M45 CSV/XLSX 表格抽取、索引与受限 Pandas 查询                  已完成
M46 pgvector + PostgreSQL full-text 混合检索与 RRF 融合         已完成
M47 Traditional RAG MCP 只读工具                               已完成
M48 Web Traditional RAG 工作区                                  已完成
M49 第六阶段中文复杂场景 API/浏览器/Agent 端到端验收            待执行
```

### M41 Traditional RAG 数据库、source 权限与本地存储基线

交付：

- Traditional RAG 数据库迁移。
- pgvector 扩展初始化。
- `traditional_sources`、`traditional_documents`、`traditional_jobs` 基础表。
- 用户默认 private source 初始化。
- public source 管理权限。
- 本地存储目录布局与路径安全校验。

验收：

- 注册用户后可初始化 private source。
- 普通用户无法读取其他用户 private source。
- 普通用户无法创建或写入 public source。
- 管理员可创建 public source。
- API 层实测 source 列表、详情、创建、更新。
- 浏览器层实测 Traditional RAG source 工作台权限可见性。

### M42 文档上传、异步 job 与文件类型识别

交付：

- `POST /traditional/documents` 上传入口。
- 支持 PDF、DOCX、CSV、XLSX、Markdown、TXT 文件类型识别。
- 异步 job 状态机。
- 文档列表、详情、删除/归档。
- 上传后前端轮询 job 状态。

验收：

- 普通用户可上传到自己的 private source。
- 管理员可上传到 public source。
- 无权限 source 上传返回 forbidden。
- 不支持的文件类型返回明确错误。
- 删除文档后不再进入检索结果。
- API 层实测上传、列表、详情、删除、job 查询。
- 浏览器层实测上传流程、进度状态、失败提示和文档详情。

### M43 MinerU API PDF 解析与解析产物缓存

交付：

- MinerU API client。
- PDF 上传后调用 MinerU API。
- 保存 MinerU 原始 JSON、Markdown、图片资源和页码引用。
- PDF 解析失败记录到 job。
- 相同文件内容哈希命中解析缓存，避免重复调用 MinerU。

验收：

- PDF 可从 `uploaded` 流转到 `ready` 或明确 `failed`。
- PDF 文本、表格、图片资源引用可在文档详情中查看。
- MinerU API key 缺失时返回明确配置错误。
- 重复上传同内容 PDF 可复用缓存。
- API 层实测 PDF job 与解析产物。
- 浏览器层实测 PDF 上传、解析状态、Markdown/图片引用展示。

### M44 DOCX/Markdown/TXT 解析与 chunk/embedding

交付：

- DOCX 文本与表格内容抽取。
- Markdown/TXT 文本解析。
- chunk 切分。
- OpenRouter OpenAI-compatible embedding 接入。
- chunk、embedding、引用元数据入库。

验收：

- DOCX、Markdown、TXT 可完成处理并进入 `ready`。
- chunk 记录包含文档、source、页/段落或位置引用。
- embedding 缺失配置时失败清晰，不产生不可检索的半成品。
- API 层实测文档处理状态和 chunk 检索基础能力。
- 浏览器层实测文档详情、chunks 和处理错误状态。

### M45 CSV/XLSX 表格抽取、索引与受限 Pandas 查询

交付：

- CSV/XLSX sheet 抽取。
- 表格 schema、列类型、行数、sheet 元数据保存。
- 行级或块级索引。
- `POST /traditional/tables/query`。
- 受限表格操作 DSL；自然语言只做确定性模板转换，后续可接 LLM 生成同一 DSL。
- 白名单执行器：筛选、排序、聚合、分组、计数、求和、平均、最大、最小。
- 禁止任意 Python、文件系统、网络和 import。

验收：

- 用户只能查询自己有权限的表格文件。
- 常见统计问题可返回确定性结果和引用行列。
- 非法操作被拒绝。
- 表格查询不返回可执行代码给用户。
- API 层实测 CSV/XLSX 查询、权限、错误边界。
- 浏览器层实测 Table Query 页面、结果表格、执行摘要、引用信息。

### M46 pgvector + PostgreSQL full-text 混合检索与 RRF 融合

交付：

- 真正的多路召回检索，不只是在单一路径上补关键词过滤。
- dense vector search：基于 pgvector 的语义召回。
- lexical full-text search：PostgreSQL full-text，中文内容需引入分词方案或应用侧分词生成可检索 token。
- literal phrase / substring recall：用于中文连续词、精确短语、编号、术语等 FTS 不稳定场景，可基于 trigram/短语匹配实现。
- metadata / structured recall：source、document、文件类型、页码、表格、图片等结构化过滤与引用定位。
- 多路候选去重、归一化与 RRF 融合，保留每条结果的 `match_types` 和各路召回分数解释。
- source 权限前置过滤。
- 文件类型、source、document 过滤。
- 检索结果统一格式：chunk、score、match_types、document、source、page、table、image references。

验收：

- 私有文档不会跨用户泄露。
- public source 普通用户可检索。
- keyword-only 查询可命中精确术语。
- 连续中文关键词查询可稳定命中，不依赖 `simple` 配置的天然空格切分。
- semantic 查询可命中语义相关 chunk。
- literal phrase / substring recall 可命中编号、短语和未被分词器切开的中文词。
- RRF 结果稳定可解释。
- API 层实测 `/traditional/search`。
- 浏览器层实测 Search 页面、引用跳转和空结果状态。

### M47 Traditional RAG MCP 只读工具

交付：

- `traditional_search`。
- `traditional_query_table`。
- `traditional_get_document`。
- `traditional_list_sources`。
- `traditional_get_job`。
- MCP 与 HTTP API 复用同一套 core 权限和业务逻辑。

验收：

- 普通用户 MCP 看不到其他用户 private source。
- 管理员 MCP 可读取全部 source。
- MCP `traditional_search` 返回证据而非最终答案。
- MCP `traditional_query_table` 可返回表格计算结果和引用。
- Agent Gateway 可调用 Traditional RAG MCP tools。
- API 层和 MCP 层权限结果一致。
- 浏览器层通过 Agent Chat 验证 Agent 可使用 Traditional RAG 证据回答。

### M48 Web Traditional RAG 工作区

交付：

- 与 Nano Brain 并列的 Traditional RAG 导航入口。
- Source 工作台。
- 文档上传与 job 状态页。
- 文档详情页：元数据、解析产物、chunks、PDF 图片/Markdown 引用、表格 sheet。
- Search 页面。
- Table Query 页面。
- 管理员 public source 管理。

验收：

- 普通用户与管理员页面能力按身份区分。
- 上传、状态、详情、搜索、表格查询在 PC 浏览器中可用。
- 页面不出现 Nano Brain 概念混用。
- 错误态、空状态、长文件名、长表格字段不破版。
- API 层实测与浏览器层实测均通过。

### M49 第六阶段中文复杂场景 API/浏览器/Agent 端到端验收

交付：

- 构造管理员、Alice、Bob 三类用户。
- 构造 private source 与 public source。
- 上传中文 PDF、DOCX、CSV/XLSX、Markdown、TXT。
- 使用 MinerU API 解析中文 PDF。
- 完成文档检索、表格查询、MCP 工具调用和 Agent Gateway 回答。
- 产出第六阶段总结测试报告。

验收：

- Alice 不能检索 Bob private 文档。
- Bob 不能检索 Alice private 文档。
- 普通用户可检索 public source。
- 管理员可维护 public source。
- 中文 PDF 解析结果可检索并带页码/图片引用。
- 中文 DOCX/Markdown/TXT 可检索。
- 中文 CSV/XLSX 可做受限表格查询。
- Agent 通过 MCP 获取 Traditional RAG 证据后回答。
- 前端主要页面在 PC 浏览器下无明显错位、遮挡、水平滚动、字体错误。

### 第六阶段测试与报告规则

每个里程碑完成时必须产出：

```txt
archive/phase-6/tests/test-mxx.ts 或 test-mxx.py 或 test-mxx.sh
archive/phase-6/records/Mxx_TEST_RECORD.md
archive/phase-6/screenshots/Mxx/*.png
```

每份测试报告至少包含：

```txt
1. 里程碑编号与目标
2. 测试环境
3. 执行命令
4. API 层验证结果
5. 浏览器层观测步骤
6. 截图清单
7. 权限断言
8. 文件解析与检索断言
9. 失败项与修复记录
10. 最终结论：通过 / 未通过
```

浏览器观测固定要求：

- 每个里程碑至少覆盖一个 PC 浏览器宽度，建议 `1440x1000`。
- 必须截图，不允许只看命令行测试结果。
- 必须实际点击、上传、输入、提交和观察结果。
- 必须审查错位、遮挡、水平滚动、默认链接样式、长文本溢出、错误态和加载态。
