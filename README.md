# 赋范·企业知识中台

第四节课学员交付版。项目源码、Docker Compose 编排和已脱敏的课堂测试数据均已包含在压缩包中；解压后由 Docker 在本机完成构建、数据库初始化和测试数据导入。

## 你将运行什么

- 前台工作台：应用总览、全域问答、方案模板、业务场景、处理任务、知识资产与空间设置。
- 后台治理：用户与权限、知识库、三条 RAG 管线、图谱、评估、审计、监控与系统配置。
- 三条知识链路：Nano Brain、Traditional RAG、GraphRAG。
- Agent 编排：基于检索证据进行问答、任务处理和来源展示。
- 数据层：一套 PostgreSQL 实例内的 6 个业务数据库，以及 Neo4j 图数据库。

## 运行要求

- Docker Desktop，支持 Docker Compose v2。
- 建议至少为 Docker 分配 8 GB 内存，并预留 10 GB 可用磁盘。
- 首次构建需要联网下载 Docker 基础镜像和依赖。
- 准备自己的 Embedding API Key 与 Agent API Key；课程包不包含讲师密钥。

## 一键启动

在项目根目录执行：

```sh
cp deploy/compose/.env.example deploy/compose/.env
chmod 600 deploy/compose/.env
```

编辑 `deploy/compose/.env`，替换全部 `CHANGE_ME`，并填写自己的：

- `EMBEDDING_API_KEY`
- `AGENT_API_KEY`
- `ADMIN_PASSWORD`
- 数据库密码与至少 32 位的 `RAG_INTERNAL_TOKEN`

密码请使用字母、数字、`-`、`_` 等 URL 安全字符，不要直接使用包含 `@` 或 `:` 的密码。

然后运行：

```sh
deploy/compose/student-start.sh
```

脚本会依次构建镜像、初始化数据库、导入课堂测试数据并等待 Web 服务健康。完成后打开：

```text
http://127.0.0.1:3000
```

如果修改了 `WEB_HOST_PORT`，请使用对应端口。

构建模式会自动加载仅本机可访问的数据库观察端口，无需再手动追加 Compose 覆盖文件：

- PostgreSQL：`127.0.0.1:15432`
- Neo4j Browser：`http://127.0.0.1:17474`
- Neo4j Bolt：`127.0.0.1:17687`

如需只构建并启动服务，可直接执行：

```sh
FF_COMPOSE_ENV_FILE=deploy/compose/.env deploy/compose/up.sh build
```

端口均绑定到 `127.0.0.1`；如在 `.env` 修改了对应的 `*_DEV_HOST_PORT`，请使用修改后的端口。

## 登录账号

- 管理员：使用个人 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`。
- 学员测试账号：`student01` 至 `student15`。
- 学员测试账号统一密码：`student123456`。

首次导入会清除快照中的历史登录会话，并将管理员密码重新绑定为学员自己在 `.env` 中配置的密码。

## 已包含的测试数据

交付包保留了课程演示所需的脱敏数据，包括：

- 16 个账号（1 个管理员、15 个测试账号），不含历史会话；
- 10 个业务场景和 17 组全域问答历史会话；
- Traditional RAG 文档、GraphRAG 文档及对应文件；
- Neo4j 中的实体与关系图谱。

数据快照清单、预期数量和校验值位于 `deploy/compose/student-data/`。恢复脚本只会向首次初始化的空环境导入；如果检测到学员已产生数据，会拒绝覆盖。

## 查看状态与日志

```sh
FF_COMPOSE_ENV_FILE=deploy/compose/.env deploy/compose/status.sh

docker compose --project-name ff-companybrain \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.student.yml \
  -f deploy/compose/compose.build.yml \
  logs --tail 100
```

常见问题：

- 脚本拒绝启动：检查 `.env` 是否仍含 `CHANGE_ME` 或 `change-me-internal-token`。
- 构建失败：确认 Docker Desktop 已启动、网络可下载基础镜像和依赖，并检查磁盘空间。
- 迁移失败：查看 `migrate` 服务日志，不要手动修改数据库结构。
- 页面不可用：先运行状态命令，确认各服务为 `healthy`。

## 停止与重置

停止服务但保留数据：

```sh
docker compose --project-name ff-companybrain \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.student.yml \
  -f deploy/compose/compose.build.yml \
  down
```

重新启动时再次执行 `deploy/compose/student-start.sh`，脚本会识别已导入标记并保留当前数据。

彻底删除本项目容器和数据卷：

```sh
FF_COMPOSE_ENV_FILE=deploy/compose/.env deploy/compose/reset.sh --yes
```

重置不可恢复，只在确定要重新开始时执行。

## 目录说明

```text
apps/                  Web、API、Agent Gateway
modules/               Nano Brain、Traditional RAG、GraphRAG
packages/              身份、权限、平台领域与共享契约
deploy/compose/        Docker Compose、学员启动脚本、课堂数据快照
deploy/database/       数据库迁移镜像与初始化脚本
scripts/               迁移、初始化及维护脚本
docs/                  架构、接口、产品验收与部署说明
PRD.md                 当前交付版产品范围
```

更完整的部署说明见 `docs/deployment/student-start.md`，产品范围见 `PRD.md`。
