# M5 真实链路验收清单

1. 用学员自己的有效 embedding 与 Agent/Graph LLM key 启动 Compose。
2. 分别上传 `m5-nano-source.md`、`m5-traditional-source.md`、`m5-graph-source.md` 到课程指定的三条链路；每条链路都必须命中自己的唯一事实和对应 source。
   - Nano：回答 `M5_NANO_SENTINEL 的值是什么？`，命中 `北斗知识页`。
   - Traditional：回答 `M5_TRADITIONAL_SENTINEL 的值是什么？`，命中 `青鸟文档库`。
   - GraphRAG：回答 `谁负责天枢交付？`，命中 `林知`，并保留该图谱任务完成态。
3. 在 Web 的全域问答中提问：`请分别给出 M5_NANO_SENTINEL、M5_TRADITIONAL_SENTINEL，以及负责天枢交付的人，并列出三份资料来源。`答案必须同时包含“北斗知识页、青鸟文档库、林知”。
4. 用户 A 将 `m5-private-source.md` 上传到仅自己可见的场景；用户 B 就 `M5_PRIVATE_SENTINEL 的值是什么？` 提问时，不得获得“紫微私有资料”、文件名、原文或私有 Agent trace。管理员能力必须仍受服务端策略限制。
5. 重启服务但不删除命名卷，再次检索并保留日志/截图。
6. 记录 Docker 内存/CPU 快照、镜像 tag、Compose 状态和失败时的脱敏日志。

本清单不允许使用阶段 4 的假 key 作为真实 SaaS 成功证据。
