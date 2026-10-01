// P45：为删源测试 UI-06~12 真 ingest 几个 GraphRAG 源（DB 被 reset 后 GraphRAG 源清零，需补）。
// 走真实 GraphRAG 入库（:8102 建图 + embedding，真实计费）——createStoredScenario + decideAdminIntakeRequest(GraphRAG)。
// 命名 P43-UI-del-<A/B/C>，供删源 rail 有源可点（Layer1 删除是 route-mock 不真删，这些源不会被真损坏）。
//
// 用法（须从 apps/web cwd 跑，同 seed 脚本，因 @ff/platform 只 hoist 到 apps/web/node_modules）：
//   cd apps/web && bun ../../scripts/ingest-p43-graph-sources.ts
import { join } from "node:path";
import { createStoredScenario, decideAdminIntakeRequest } from "@ff/platform/platform-store";

const repoRoot = join(import.meta.dir, "..");
const env: Record<string, string> = {};
for (const line of (await Bun.file(join(repoRoot, ".env")).text()).split("\n")) {
  const t = line.trim();
  if (t && !t.startsWith("#") && t.includes("=")) {
    const i = t.indexOf("=");
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
// 真 ingest 所需 env 全量注入（DB + 模块 URL + embedding + token）。
for (const k of [
  "PLATFORM_DATABASE_URL", "TRADITIONAL_RAG_HTTP_URL", "TRADITIONAL_RAG_DATABASE_URL",
  "GRAPH_RAG_HTTP_URL", "NANO_BRAIN_HTTP_URL", "RAG_INTERNAL_TOKEN",
  "EMBEDDING_API_KEY", "EMBEDDING_BASE_URL", "EMBEDDING_MODEL",
  "AGENT_API_KEY", "AGENT_BASE_URL", "AGENT_MODEL",
]) {
  if (env[k]) process.env[k] = env[k];
}
process.env.FF_PLATFORM_DATA_DIR = process.env.FF_PLATFORM_DATA_DIR || join(repoRoot, "apps/web/.platform-data");
process.env.FF_PLATFORM_INGEST_MODE = "real";

const admin = { userId: "p43-del-admin", name: "管理员", role: "admin" as const, organizationId: "org-p43-del", teamIds: ["platform-admin"] };
const owner = { userId: "p43-del-owner", name: "P43删源用户", role: "member" as const, organizationId: "org-p43-del", teamIds: ["sales"] };

// 各源用不同自然语言正文（含实体/关系，利于 GraphRAG 抽取），去空白 ≥20 字。
const CASES = [
  { label: "A", text: "启明星科技由陈启明创立，主营卫星通信，核心团队包括首席科学家林望和运营总监赵岚，与蓝鲸科技在导航领域有合作。" },
  { label: "B", text: "风行网络的创始人是周行，公司专注短视频推荐算法，投资方为红杉与高瓴，与启明星科技共享部分数据中台资源。" },
  { label: "C", text: "蓝鲸科技聚焦海洋大数据，董事长苏蓝，技术负责人钱深，与风行网络在算力采购上达成联合议价协议。" },
];

for (const c of CASES) {
  const name = `P43-UI-del-${c.label}`;
  const created = await createStoredScenario(owner, {
    templateId: "customer-360",
    name,
    description: "P45 删源测试用真实 GraphRAG 源。",
    visibility: "private",
    processingGoal: "供删源前端点测：rail 有真源可点。",
    files: [{ name: `${name}.md`, type: "text/markdown", bytes: new TextEncoder().encode(c.text) }],
  });
  const approved = await decideAdminIntakeRequest(admin, {
    requestId: `request_${created.task.id}`,
    action: "approve",
    selectedEngine: "GraphRAG",
  });
  console.log(`[${name}] 审批: ${approved?.status} | scenario=${created.scenario.id}`);
}
console.log("done — 3 个 GraphRAG 源已真入库");
process.exit(0);
