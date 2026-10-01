# Nano GBrain 产品需求文档

版本：v0.1
状态：草案
创建日期：2026-05-29
项目定位：多用户、source 级权限、事实审核流、dream 自动整理机制的轻量知识脑系统。

---

## 1. 背景与目标

Nano GBrain 是一个参考 GBrain 核心思想重新设计的轻量知识系统。它不是单纯的笔记工具，也不是单纯的向量数据库，而是一个面向用户与智能体的组织级知识脑。

系统需要支持：

1. 多用户体系。
2. 每个用户拥有独立的个人 source。
3. Nano Brain 内存在公共 source。
4. 普通用户只对自己的个人 source 拥有完整权限。
5. 公共 source 只能由管理员管理，普通用户最多拥有读取权限和事实提交入口。
6. 用户可以提交事实，但不能直接污染公共知识库。
7. 管理员审核事实后，决定是否写入公共 source。
8. dream 机制定期整理、抽取、合并和维护知识系统。

核心目标是形成如下闭环：

```txt
采集知识 → 权限隔离 → 检索问答 → 事实提交 → 管理员审核 → 公共知识沉淀 → dream 自动维护
```

---

## 2. 产品一句话

> Nano GBrain 是一个多用户、按 source 隔离、带事实审核流和 dream 自动整理机制的轻量知识脑。

---

## 3. 用户角色

### 3.1 普通用户

普通用户可以：

- 拥有自己的个人 source。
- 在自己的个人 source 中拥有完整读写权限。
- 在公共 source 中搜索、阅读知识。公共 source 默认对普通用户可读。
- 在自己的 source 中写入个人笔记、页面、事实草稿。
- 向公共 source 提交事实审核请求。
- 查看自己提交事实的审核状态。

普通用户不能：

- 直接写入、修改或删除公共 source 内容。
- 管理公共 source。
- 读取其他用户的个人 source。
- 触发公共 source 的 dream。
- 修改 source 权限。

### 3.2 管理员

管理员是唯一管理层级，拥有对所有知识库链路的完整管理权限。

在 Nano Brain 中，管理员可以：

- 管理 Nano Brain 下的所有私有 source 和公共 source。
- 配置用户对公共 source 的读取权限。
- 管理用户个人 source 的异常情况，例如封禁、迁移、归档。
- 审核用户提交的事实。
- 将通过审核的事实写入公共 source。
- 触发公共 source 的 dream 维护任务。
- 指定其他管理员。
- 管理全局系统配置。
- 管理模型、embedding 服务、dream 策略。
- 查看审计日志和系统健康状态。

系统不设计链路管理员、局部管理员或分级管理员。

### 3.3 系统智能体

系统智能体是系统任务执行身份，用于：

- 执行 dream。
- 处理 embedding。
- 自动抽取链接和事实。
- 生成管理员审核摘要。

系统智能体必须受权限边界约束，不能绕过审核直接写入公共事实库。

---

## 4. 核心概念

### 4.1 Nano Brain

Nano Brain 是整个系统的唯一组织边界，不再引入额外的组织层级。一个 Nano Brain 就是一套完整知识系统。

一个 Nano Brain 包含：

- 用户。
- source。
- 权限配置。
- 公共知识库。
- 审核队列。
- dream 任务。

### 4.2 source

source 是知识隔离和权限控制的核心单位。

source 只有两种类型：

```txt
私有 source
公共 source
```

示例：

```txt
source:user/alice          # Alice 的个人知识源
source:user/bob            # Bob 的个人知识源
source:public/wiki         # 公共百科
source:public/facts        # 已审核公共事实库
```

### 4.3 页面

页面是人类可读的知识页面，通常是 Markdown。

每个页面必须绑定：

```txt
source 标识
页面标识
```

页面标识在同一个 source 内唯一，不要求全局唯一。

### 4.4 chunk

chunk 是检索单元。

页面写入后会被切分为多个 chunk，并用于：

- 关键词检索。
- 向量检索。
- 混合检索。
- 带引用的问答。

### 4.5 事实

事实是结构化知识。

示例：

```json
{
  "entity_slug": "companies/acme",
  "predicate": "mrr",
  "value": "50000",
  "unit": "USD/month",
  "period": "2026-05",
  "evidence_url": "https://example.com/report",
  "confidence": 0.86
}
```

公共事实必须来自审核通过的提交、管理员直接录入或受信任系统导入。

### 4.6 知识图谱

知识图谱是 Nano Brain 内置的轻量关系网络，用于表达页面、实体、事实之间的连接。

知识图谱不使用独立图数据库，而是使用现有关系型数据库中的页面、事实和链接记录共同表达：

```txt
页面 = 图谱节点
事实 = 结构化证据
链接 = 图谱关系
```

知识图谱数据主要由页面内容、事实记录和 dream 抽取流程派生，可重新生成，不作为唯一事实来源。

知识图谱支持：

- 正向链接。
- 反向链接。
- 按关系类型查询。
- 按方向查询。
- 多跳关系遍历。
- 按 source 权限过滤查询结果。

### 4.7 事实提交

事实提交是用户提交事实后的审核队列记录。

普通用户提交事实时，不直接写入公共 source，而是进入事实提交队列。

管理员可以对事实提交执行：

- 通过。
- 驳回。
- 要求修改。
- 合并重复提交。
- 编辑后通过。

### 4.8 dream

dream 是系统维护整理机制。

dream 会定期执行：

- 同步。
- 抽取链接并维护知识图谱。
- 抽取事实。
- 合成页面。
- 发现模式。
- 处理过期 chunk 的 embedding。
- 合并重复事实。
- 生成审核摘要。
- 健康检查。

---

## 5. 目标功能范围

## 5.1 第一阶段：多用户、source 权限、基础知识库

第一阶段必须支持：

1. 用户注册和登录。
2. 创建用户默认个人 source。
3. 创建公共 source。
4. source 权限配置：普通用户个人 source 自动完整权限，公共 source 仅管理员可管理。
5. 页面新增、读取、更新、删除。
6. chunk 切分。
7. embedding 生成。
8. 混合检索。
9. 权限过滤后的搜索。
10. HTTP API 和 MCP Server。

### 第一阶段验收标准

- 用户 A 不能读取用户 B 的私有 source。
- 用户 A 可以读取自己被授权的公共 source。
- 用户 A 只能写入自己的个人 source。
- 用户 A 不能写入、修改或删除公共 source。
- 搜索结果不会泄露无权限 source 的页面或 chunk。
- 每条页面、chunk、事实、链接都包含 source 标识。

---

## 5.2 第二阶段：事实提交与管理员审核流

第二阶段必须支持：

1. 用户提交事实。
2. 用户查看自己提交的事实状态。
3. 管理员查看待审核提交。
4. 管理员通过、驳回、要求修改。
5. 通过后写入公共事实 source。
6. 通过后可更新对应公共页面。
7. 审核动作写入审计日志。

### 第二阶段验收标准

- 普通用户提交事实后，公共 source 不会立即变化。
- 管理员通过后，事实出现在公共 source。
- 管理员驳回后，事实不会进入公共 source。
- 所有审核操作可追溯到审核人。

---

## 5.3 第三阶段：dream 机制

第三阶段必须支持：

1. 用户级 dream。
2. 公共 source dream。
3. 审核队列 dream。
4. dream 锁，避免并发执行。
5. dream 执行报告。
6. dream 预演模式。
7. dream 分阶段执行。
8. dream 成本控制。

### dream 类型

#### 用户级 dream

作用于用户自己的 source。

```txt
用户 source
  → 同步
  → 抽取链接
  → 合成个人笔记
  → 处理过期 chunk 的 embedding
  → 输出健康报告
```

#### 公共 source dream

作用于公共 source，仅管理员或系统可以触发。

```txt
公共 source
  → 合并事实
  → 合并重复页面
  → 刷新 embedding
  → 更新实体页面
  → 发现过期或冲突知识
```

#### 审核队列 dream

作用于待审核事实提交。

```txt
待审核提交
  → 按实体分组
  → 发现重复提交
  → 检查证据完整度
  → 生成管理员审核摘要
```

注意：审核队列 dream 只能生成建议，不能绕过管理员审核直接写入公共 source。

---

## 5.4 第四阶段：高级智能能力

第四阶段可选能力：

1. 事实冲突检测。
2. source 间知识对齐。
3. 知识图谱可视化。
4. 实体解析。
5. 时间线。
6. 模式页面。
7. 检索解释。
8. 结果重排。
9. MCP Server 能力增强。
10. 评测体系。

---

## 6. 核心用户流程

### 6.1 用户写入个人知识

第一阶段只支持 Markdown 内容上传。上传后采用同步处理，立即进入 page pipeline。

```txt
用户登录
  → 选择自己的 source
  → 上传或新建 Markdown 页面
  → 系统标准化页面
  → 校验权限
  → 保存页面
  → 切分 chunk
  → 同步生成 embedding
  → 更新检索索引
  → 可在用户 source 内搜索
```

### 6.2 用户搜索知识

```txt
用户输入查询
  → 系统计算用户可读 source
  → 关键词检索
  → 向量检索
  → 混合合并
  → source 权限过滤
  → 返回结果和引用
```

### 6.3 用户提交事实到公共知识库

```txt
用户填写事实
  → 选择目标公共 source
  → 提供证据
  → 提交到事实提交队列
  → 状态为待审核
```

### 6.4 管理员审核事实

```txt
管理员打开待审核提交
  → 查看事实、证据、重复提示
  → 通过、驳回或要求修改
  → 通过后写入公共事实
  → 更新公共页面或实体页面
  → 写入审计日志
```

### 6.5 dream 维护知识系统

```txt
定时任务触发
  → 获取执行锁
  → 执行各阶段
  → 写入执行报告
  → 释放执行锁
```

---

## 7. 权限模型

### 7.1 权限维度

source 权限包括：

```txt
读取      # 读取页面、chunk、事实
写入      # 写入页面、事实草稿；普通用户仅限自己的个人 source
管理      # 管理 source 配置；公共 source 仅管理员可管理
审核      # 审核进入公共 source 的事实提交；仅管理员可拥有
```

### 7.2 收紧后的权限规则

1. 每个普通用户默认拥有且仅拥有自己个人 source 的完整权限。
2. 普通用户不能获得公共 source 的写入权限、管理权限或审核权限。
3. 公共 source 的创建、更新、删除、权限配置、dream 写入任务只能由管理员执行。
4. 普通用户默认可以读取公共 source。
5. 普通用户向公共 source 贡献内容的唯一入口是事实提交队列。
6. 管理员审核通过后，由系统以管理员审核记录为依据写入公共 source。

### 7.3 权限原则

1. 默认拒绝。
2. 搜索前必须计算可读 source 集合。
3. 写入前必须检查写入权限。
4. 公共 source 写入只能由管理员直接操作，或由系统在管理员审核通过后代写。
5. dream 使用触发者权限或系统策略，不能无限制访问所有 source。
6. 所有后台任务必须记录执行者。

### 7.4 权限判断伪代码

```ts
async function assertCanRead(userId: string, sourceId: string) {
  const permission = await getPermission(userId, sourceId)
  if (!permission?.can_read) throw new PermissionDenied()
}

async function assertCanWrite(userId: string, sourceId: string) {
  const permission = await getPermission(userId, sourceId)
  if (!permission?.can_write) throw new PermissionDenied()
}

async function getReadableSourceIds(userId: string): Promise<string[]> {
  return db.sourcePermissions.findMany({
    where: { user_id: userId, can_read: true },
    select: ['source_id']
  })
}
```

说明：代码中的字段名和函数名属于实现标识，可以保留英文；产品描述和用户可见文案应使用中文。

---


## 8. 检索设计

### 8.1 检索流程

```txt
查询
  → 解析可读 source
  → 在可读 source 内执行关键词检索
  → 在可读 source 内执行向量检索
  → 合并排序
  → 可选重排
  → 返回引用
```

### 8.2 权限防泄漏要求

搜索必须在数据库层或向量检索层过滤 source，不允许先取全量结果再在应用层过滤。

错误示例：

```ts
const results = await vectorSearch(query)
return results.filter(r => readableSources.includes(r.source_id))
```

正确示例：

```ts
const results = await vectorSearch(query, { sourceIds: readableSources })
```

### 8.3 知识图谱辅助检索

知识图谱用于补足关键词检索和向量检索不擅长的关系问题。

示例问题：

```txt
谁和 Acme 有关系？
Alice 投资过哪些公司？
哪些人参加过这次会议？
```

处理方式：

```txt
识别查询对象
  → 查询可读 source 内的关系边
  → 按关系类型和方向过滤
  → 将相关页面加入候选结果
  → 与关键词检索、向量检索结果合并排序
```

权限要求：知识图谱查询必须在数据库层过滤可读 source，不能先查询全图再在应用层过滤。

---


## 9. 对外接口原则

Nano Brain 第一阶段不提供正式 CLI。CLI 可以作为开发调试脚本存在，但不作为产品接口、不作为验收标准，也不作为前端或 Agent 的调用入口。

Nano Brain 对外提供两类正式接口：

```txt
HTTP API      # 给平台后端和前端链路使用
MCP Server    # 给 Agent Gateway 使用
```

### 9.1 HTTP API

HTTP API 服务传统前后端链路，用于：

- 页面新增、读取、更新、删除。
- source 管理。
- 检索与问答。
- 事实提交与管理员审核。
- 知识图谱查询。
- dream 管理。
- 健康状态查询。

HTTP API 必须调用 Nano Brain 内部核心服务，不能另起一套业务逻辑。

### 9.2 MCP Server

MCP Server 服务后续 Agent 层，用于 Agent 对 Nano Brain 的受控访问。

Agent 层后续将基于 LangChain 设计。Nano Brain 第一阶段只需要保证 MCP Server 能力边界清晰、工具权限可控，不在 Nano Brain 内部设计 Agent 会话切换和上下文管理。

MCP Server 能力包括：

- 检索。
- 问答。
- 获取页面。
- 提交事实。
- 查询知识图谱。
- 获取 dream 状态。

写入型或管理型工具必须检查用户身份和管理员权限。

### 9.3 核心服务复用原则

Nano Brain 内部必须采用如下结构：

```txt
Nano Brain 核心服务
  → HTTP API
  → MCP Server
```

禁止 HTTP API 和 MCP Server 各自实现业务逻辑。

---

## 10. dream 详细设计

### 10.1 dream 阶段

建议初版阶段：

```txt
同步
抽取链接并维护知识图谱
抽取事实
审核摘要
合成
合并整理
embedding
健康检查
```

### 10.2 同步阶段

目标：同步文件或外部输入到页面。

输入：

- Markdown 文件。

输出：

- 页面。
- chunk。
- 过期 embedding 标记。

### 10.3 抽取链接与维护知识图谱阶段

目标：从页面正文、页面元信息和事实记录中抽取链接关系，维护知识图谱索引。

支持：

- `[[slug]]`。
- Markdown 链接。
- 实体提及。
- 事实转换为关系边。
- 页面元信息转换为关系边。

处理流程：

```txt
读取新增或变更页面
  → 删除该页面旧链接
  → 重新抽取链接
  → 推断关系类型
  → 批量写入链接表
  → 统计悬空链接和重复关系
```

输出：

- 链接记录。
- 正向链接。
- 反向链接。
- 知识图谱健康摘要。

### 10.4 抽取事实阶段

目标：从页面中抽取候选事实。

初版可以只对管理员指定的 source 执行。

输出：

- 私有 source 中可直接写入事实草稿。
- 公共 source 中建议进入事实提交队列或审核队列。

### 10.5 审核摘要阶段

目标：帮助管理员更快审核事实。

对待审核提交生成：

- 重复提交提示。
- 冲突事实提示。
- 证据缺失提示。
- 实体摘要。
- 推荐处理动作。

### 10.6 合成阶段

目标：将会话记录或原始笔记转成稳定页面。

流程：

```txt
发现输入
  → 计算内容哈希
  → 检查 dream 输入记录
  → 低成本判断是否值得处理
  → 如果值得处理，则调用模型合成
  → 写入带有 dream_generated: true 标记的页面
```

### 10.7 合并整理阶段

目标：合并重复知识。

包括：

- 重复事实。
- 重复页面。
- 实体别名。
- 过期事实。

### 10.8 embedding 阶段

目标：为过期 chunk 生成 embedding。

### 10.9 健康检查阶段

目标：输出系统健康报告。

检查：

- 页面数量。
- chunk 数量。
- 过期 chunk。
- 缺失 embedding。
- 悬空链接。
- 孤立页面。
- 重复关系。
- 待审核提交。
- 失败的 dream 执行记录。

---

## 11. dream 安全要求

1. dream 必须有执行锁。
2. dream 必须有执行者。
3. dream 写入必须符合 source 权限。
4. 用户级 dream 不能读其他用户私有 source。
5. 公共 dream 只能由管理员或系统触发。
6. 审核队列 dream 不能自动通过事实。
7. dream 生成页面必须标记 `dream_generated: true`。
8. dream 发现输入时必须跳过 `dream_generated: true` 的页面，避免自我吞噬。
9. dream 必须支持预演模式。
10. dream 必须记录执行报告。

---

## 12. 非功能性需求

### 12.1 安全

- 所有接口必须鉴权。
- 所有 source 操作必须鉴权和授权。
- 所有管理员操作必须写审计日志。
- 搜索结果不能泄露无权限 source。
- 用户上传内容需要限制大小。
- 远程接口不允许任意文件路径读取。

### 12.2 可观测性

系统需要记录：

- 接口请求日志。
- dream 执行报告。
- 审计日志。
- embedding 失败记录。
- 搜索耗时。
- 事实审核历史。

### 12.3 性能

第一版目标：

- 单个 Nano Brain 支持 100 用户。
- 单 source 支持 10,000 页面。
- 搜索第 95 百分位耗时小于 1.5 秒。
- 页面写入后 10 秒内可检索。

### 12.4 可扩展性

系统应支持后续扩展：

- PostgreSQL + pgvector 可扩展为独立集群或托管数据库。
- 本地 embedding 可替换为云端或私有模型服务。
- HTTP API 和 MCP Server 可在不改变核心服务的前提下独立演进。
- 单机 dream 可替换为队列化工作进程。

---

## 13. 推荐技术栈

### 13.1 第一版

```txt
运行环境：Bun
包管理：Bun workspaces
开发语言：TypeScript
数据库：PostgreSQL + pgvector
HTTP API：Hono 或 Fastify
embedding：第一阶段使用 OpenRouter OpenAI-compatible API，模型为 qwen/qwen3-embedding-8b，后续支持其他可插拔服务
处理方式：上传后同步执行 page pipeline，并使用平台级 embedding 环境变量同步完成 embedding
HTTP 框架：Hono
MCP Server：基于 TypeScript MCP SDK 或同类实现
```

### 13.2 生产增强版

```txt
数据库：托管 PostgreSQL + pgvector 或独立 PostgreSQL 集群
任务队列：BullMQ、pg-boss 或同类队列
对象存储：S3 或 Supabase Storage
认证：复用平台 identity
MCP Server：模型上下文协议服务
```

---

## 14. 里程碑计划

### 里程碑 1：基础知识库

交付：

- 用户、source、权限。
- 页面新增、读取、更新、删除。
- chunk 切分。
- 检索。
- 权限隔离。

### 里程碑 2：事实审核流

交付：

- 事实提交队列。
- 管理员审核 HTTP API。
- 通过后写入公共事实。
- 审计日志。

### 里程碑 3：dream 第一版

交付：

- dream 执行。
- 阶段：抽取链接、embedding、健康检查。
- 执行锁。
- 执行报告。
- 预演模式。

### 里程碑 4：dream 智能增强

交付：

- 合成。
- 审核摘要。
- 合并整理。
- 冲突检测。

### 里程碑 5：MCP Server 集成

交付：

- Nano Brain MCP Server。
- Agent Gateway 可挂载 Nano Brain MCP 工具。
- 读取、写入、管理三类权限范围。
- 远程调用信任边界。

---

## 15. 风险与应对

### 风险 1：权限泄漏

应对：

- 所有查询必须带 source 标识过滤。
- 写测试覆盖跨 source 搜索。
- 禁止应用层后过滤作为唯一权限控制。

### 风险 2：公共知识被污染

应对：

- 普通用户不能直接写公共 source。
- 事实提交必须审核。
- dream 不能自动通过事实。

### 风险 3：dream 生成垃圾内容

应对：

- 低成本预判。
- 预演模式。
- 最大预算。
- 公共 source 只能由管理员或系统在审核通过后写入。
- dream 生成标记。

### 风险 4：模型成本失控

应对：

- 每次 dream 有预算上限。
- 默认只处理新内容。
- 缓存判断结果。
- 大文件切分处理。

### 风险 5：数据模型后期难以支持多用户隔离

应对：

- 第一版所有核心表都包含 source 标识。
- 页面标识只在 source 内唯一。
- 权限控制以 source 为基本单位。

---

## 16. 成功指标

### 16.1 产品指标

- 用户能在个人 source 中稳定写入和搜索知识。
- 公共 source 的知识增长来自审核通过的事实。
- 管理员审核效率提升。
- dream 能减少过期 chunk、悬空链接和重复事实。

### 16.2 技术指标

- 无跨 source 权限泄漏。
- 搜索第 95 百分位耗时小于 1.5 秒。
- dream 可重复执行且具备幂等性。
- 通过和驳回操作全部有审计日志。

---

## 17. 待确认问题

1. 事实通过时是否允许管理员编辑事实内容？
2. dream 合成生成的公共页面是否也必须进入审核？
3. 是否需要用户组权限，还是第一版只保留用户到 source 的读取权限？
4. embedding 服务首选云端还是本地？
5. 第一版 MCP Server 需要暴露哪些写入型工具？

---

## 18. 第一版建议结论

第一版不要追求完整复刻 GBrain。建议明确为：

```txt
多用户 + 个人 source 完整权限 + 公共 source 管理员治理 + 页面 / chunk / 检索 + 事实审核 + dream 第一版
```

最小核心闭环：

```txt
用户写入个人知识
  → 搜索时按权限可见
  → 用户提交公共事实
  → 管理员审核
  → 公共 source 沉淀
  → dream 定期整理和维护
```

只要这个闭环稳定，Nano GBrain 就已经具备独立产品价值。
