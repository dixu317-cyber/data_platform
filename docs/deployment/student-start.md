# 学员部署说明

本交付包采用“源码 ZIP + Docker Compose 本地构建 + 脱敏课堂数据快照”的方式。它用于本机教学和可信局域网演示，不是公网生产部署方案。

## 1. 准备环境

- 安装并启动 Docker Desktop，确认 `docker compose version` 可用。
- 建议 Docker 内存不少于 8 GB，磁盘剩余空间不少于 10 GB。
- 首次构建需要联网拉取基础镜像和依赖。
- 准备 Embedding 与 Agent 模型服务的 API Key。

## 2. 配置私有环境变量

```sh
cp deploy/compose/.env.example deploy/compose/.env
chmod 600 deploy/compose/.env
```

编辑 `.env`：

1. 替换全部 `CHANGE_ME`。
2. 将 `change-me-internal-token` 替换为至少 32 位的随机值。
3. 填写 `EMBEDDING_API_KEY` 与 `AGENT_API_KEY`。
4. 为管理员、PostgreSQL、Neo4j 配置自己的密码。

`.env` 只保留在学员本机，不要提交、分享或重新打进压缩包。

## 3. 首次启动

```sh
deploy/compose/student-start.sh
```

脚本执行四个阶段：

1. 从源码构建并启动全部容器；
2. 等待数据库迁移完成；
3. 校验并导入脱敏课堂数据；
4. 等待 Web 服务健康。

启动后访问 `http://127.0.0.1:3000`。管理员账号来自 `.env`；测试账号为 `student01` 至 `student15`，统一密码为 `student123456`。

启动脚本内部使用 `up.sh build`，会自动加载仅本机可访问的数据库观察端口：PostgreSQL `127.0.0.1:15432`、Neo4j Browser `http://127.0.0.1:17474`、Neo4j Bolt `127.0.0.1:17687`。

## 4. 快照安全边界

- PostgreSQL、Neo4j 和上传文件均来自已脱敏课堂数据。
- 历史登录会话已清除。
- 讲师个人用户名、密码和 API Key 不在交付包中。
- 管理员密码在首次导入时使用学员 `.env` 重新生成。
- 恢复脚本校验快照 SHA-256，并只允许向首次初始化的空环境导入。
- 如果环境已有业务记录，恢复脚本会停止，不会覆盖学员数据。

详细清单见 `deploy/compose/student-data/README.md` 与 `manifest.json`。

## 5. 状态、日志与二次启动

查看状态：

```sh
FF_COMPOSE_ENV_FILE=deploy/compose/.env deploy/compose/status.sh
```

查看日志：

```sh
docker compose --project-name ff-companybrain \
  --env-file deploy/compose/.env \
  -f deploy/compose/compose.student.yml \
  -f deploy/compose/compose.build.yml \
  -f deploy/compose/compose.dev-ports.yml \
  logs --tail 100
```

后续启动仍可直接运行：

```sh
deploy/compose/student-start.sh
```

已存在快照标记时，脚本会保留当前数据。

## 6. 本机查看数据库

构建模式已自动加载数据库端口覆盖文件，且只绑定到 `127.0.0.1`，不需要再执行第二条 Compose 命令。直接构建和启动时可使用：

```sh
FF_COMPOSE_ENV_FILE=deploy/compose/.env deploy/compose/up.sh build
```

- PostgreSQL：`127.0.0.1:15432`
- Neo4j Browser：`http://127.0.0.1:17474`
- Neo4j Bolt：`127.0.0.1:17687`

密码使用学员自己的 `.env`，不要把端口改为公网监听。

## 7. 重置

```sh
FF_COMPOSE_ENV_FILE=deploy/compose/.env deploy/compose/reset.sh --yes
```

该命令会删除当前 `ff-companybrain` 项目的容器和命名卷。执行后课堂数据与学员新增数据都不可恢复。
