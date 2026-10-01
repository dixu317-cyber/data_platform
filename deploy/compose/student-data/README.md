# 第四节课脱敏数据快照

本目录供 `restore-student-data.sh` 在学员首次启动时自动恢复，学员通常不需要手工操作。

## 数据范围

- `postgres/`：6 个业务数据库的自定义格式逻辑备份。
- `neo4j/neo4j.dump`：GraphRAG 使用的 Neo4j 数据库备份。
- `files/`：平台上传文件与 Traditional RAG 文件卷。
- `manifest.json`：来源版本、账号策略和预期数据数量。
- `SHA256SUMS`：恢复前执行的完整性校验。

## 脱敏策略

- 删除全部历史登录会话。
- 用户名统一替换为 `admin`、`student01` 至 `student15`。
- 测试账号统一密码为 `student123456`。
- 快照管理员密码不可用于登录；导入时必须使用学员 `.env` 中的 `ADMIN_PASSWORD` 重新绑定。
- 不包含讲师 `.env`、API Key、数据库密码或 Neo4j 密码。
- 不包含旧版 `auth-db.json`。

## 防覆盖策略

恢复脚本只接受“完成初始迁移但尚无业务数据”的新环境。成功恢复后会写入 `student_delivery_snapshot` 标记；后续再次执行只会保留现有数据，不会重复导入。
