# 企业级知识中台 Docker 交付样本

本项目的学员交付采用 learner pull-only Compose：学员只拉取预构建镜像，不在本机构建 Web、Bun 或 Python 服务。

验收要点：只有 Web 发布宿主端口；API、Agent Gateway、Nano Brain、Traditional RAG、GraphRAG、PostgreSQL 和 Neo4j 只在 Compose 网络内通信；数据库初始化由一次性 migrate 服务完成。
