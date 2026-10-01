# 数据库底座：学员运行说明

本目录交付课程项目的数据库底座：一个 PostgreSQL 17 实例、一个 Neo4j 5.26.28 实例，以及一次性 `migrate` 初始化服务。它不包含 Web、API、Agent Gateway 或三个 RAG 业务服务；完整应用 Compose 在 M3 完成。

## 第一次启动

只需安装 Docker Engine 和 Docker Compose：

```bash
./deploy/database/init-env.sh
./deploy/database/up.sh
./deploy/database/status.sh
```

`init-env.sh`生成权限为 `0600` 的本地 `.env.docker.local`，不会覆盖已有文件。`up.sh`启动两种数据库，等待healthcheck，运行一次migrate，并原样返回migrate退出码。失败时数据库保留在后台，按提示查看migrate日志。

同一volume再次执行`./deploy/database/up.sh`就是幂等重跑：六个数据库不会重复创建，默认管理员仍只有一个。

## 地址：宿主与容器不要混用

| 服务 | 从宿主运行应用 | M3 Compose 内部服务 |
|---|---|---|
| PostgreSQL | `localhost:55432` | `postgres:5432` |
| Neo4j Browser | `http://localhost:7474` | 不适用 |
| Neo4j Bolt | `bolt://localhost:7687` | `bolt://neo4j:7687` |

宿主应用的数据库URL示例：

```text
postgresql://ff_identity_app:<IDENTITY_APP_PASSWORD>@localhost:55432/platform_identity_db
postgresql://ff_platform_app:<PLATFORM_APP_PASSWORD>@localhost:55432/platform_core_db
postgresql://ff_nano_app:<NANO_APP_PASSWORD>@localhost:55432/nano_brain_db
postgresql://ff_agent_app:<AGENT_APP_PASSWORD>@localhost:55432/agent_gateway_db
postgresql://ff_traditional_app:<TRADITIONAL_APP_PASSWORD>@localhost:55432/traditional_rag_db
postgresql://ff_graph_app:<GRAPH_APP_PASSWORD>@localhost:55432/graph_rag_db
```

M3把应用放入同一Compose网络时，只把host改为`postgres:5432`；容器内不能使用`localhost`访问另一个容器。

## 三层账号与权限效果

- bootstrap账号只用于创建数据库账号、六个database和扩展。
- `ff_migrator`只在一次性migrate服务中执行DDL。
- 六个`ff_*_app`是业务运行账号，各自只能连接自己的database并做正常CRUD。
- 唯一例外是`ff_graph_app`可以在`graph_rag_db.lightrag`中执行LightRAG幂等初始化所需的受限CREATE；它仍不能建库、装扩展或连接其他五库。

每次`up.sh`运行的postcheck会验证六库、扩展、核心表、管理员唯一性，以及本库正向访问和跨库/建库/普通建表负例。看到migrate `Exited (0)`才表示数据库初始化完成。

## 停止、查看与重置

停止容器但保留数据：

```bash
./deploy/database/stop.sh
```

查看数据库和migrate状态：

```bash
./deploy/database/status.sh
```

预览reset目标（不会删除）：

```bash
./deploy/database/reset.sh
```

确实要清空本课程的Docker数据库时，必须逐字确认项目名：

```bash
./deploy/database/reset.sh --confirm-reset ff-companybrain-m2b
```

reset只允许删除Compose项目`ff-companybrain-m2b`及两个专名volume：

```text
ff_companybrain_m2b_postgres_data
ff_companybrain_m2b_neo4j_data
```

它不会执行任何prune，不会连接、导入或删除宿主PostgreSQL，也不会操作M2-A volume。reset后再次执行`up.sh`会得到全新空底座。
