// P45 UI 点测 fixture（对应 spec §3.4）：造待审批请求供 UI-01~05（审批入库前端交互）浏览器点测用。
//   F1: 1 条待审批、含合格 .md 的 GraphRAG 意图请求（模板 customer-360 → 建议引擎含 GraphRAG）。
//   F2: 待审批 Gbrain 请求 + 待审批 Naive 请求各 1（模板 personal-wiki / policy-evidence）。
// 只造 createStoredScenario，不调 decideAdminIntakeRequest，请求停在「待管理员确认」（非"已发布"）。
// Layer 1 测试里审批动作全走 page.route() mock，本 seed 不需要真入库、不需要模块服务在跑。
//
// 用法（须从 apps/web 目录跑——@ff/platform workspace 只 hoist 到 apps/web/node_modules）：
//   cd apps/web && bun ../../scripts/seed-p43-ui-fixture.ts --run <runId>
//   cd apps/web && bun ../../scripts/seed-p43-ui-fixture.ts --rollback <runId>
//
// 命名空间隔离（codex §3.0 审）：所有产物统一前缀 P43-UI-<runId>-；rollback 只删该 runId 前缀，
// 禁止宽泛删除所有 P43-UI- 数据（防两个执行者互删）。
import { join } from "node:path";
import { getPlatformPool } from "@ff/platform";
import { createStoredScenario } from "@ff/platform/platform-store";

// 路径全部锚定 import.meta.dir（脚本自身位置），不依赖 process.cwd()——
// @ff/platform workspace 目前只 hoist 到 apps/web/node_modules，本脚本需从 apps/web cwd 跑
// （见文末用法），若用 process.cwd() 算路径会因 cwd=apps/web 而算错。
const repoRoot = join(import.meta.dir, "..");
const env: Record<string, string> = {};
for (const line of (await Bun.file(join(repoRoot, ".env")).text()).split("\n")) {
  const t = line.trim();
  if (t && !t.startsWith("#") && t.includes("=")) {
    const i = t.indexOf("=");
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}
if (env.PLATFORM_DATABASE_URL) process.env.PLATFORM_DATABASE_URL = env.PLATFORM_DATABASE_URL;
// 上传文件字节走 dataRoot()（默认 process.cwd()/.platform-data）；显式指到 apps/web/.platform-data
// 与真跑中的 Next server 对齐（业务数据本身落 PG，这里只是保持惯例整洁，不影响浏览器测试）。
process.env.FF_PLATFORM_DATA_DIR = process.env.FF_PLATFORM_DATA_DIR || join(repoRoot, "apps/web/.platform-data");
process.env.FF_PLATFORM_INGEST_MODE = process.env.FF_PLATFORM_INGEST_MODE || "local";

const admin = { userId: "p43-ui-admin", name: "管理员", role: "admin" as const, organizationId: "org-p43-ui", teamIds: ["platform-admin"] };
const owner = { userId: "p43-ui-owner", name: "P43测试用户", role: "member" as const, organizationId: "org-p43-ui", teamIds: ["sales"] };
const TEXT = "本文档用于验证 P43 审批入库前端交互，内容为自然语言正文，满足去空白不少于二十字的合格资料判定标准。";

const args = process.argv.slice(2);

async function seedOne(tag: string, label: string, templateId: string, fileLabel: string) {
  return createStoredScenario(owner, {
    templateId,
    name: `${tag}${label}`,
    description: "P45 UI 点测 fixture，用于验证审批入库前端交互（UI-01~05）。",
    visibility: "private",
    processingGoal: "验证审批入库前端交互链路。",
    files: [{ name: `${tag}${fileLabel}.md`, type: "text/markdown", bytes: new TextEncoder().encode(TEXT) }],
  });
}

async function rollback(runId: string) {
  const tag = `P43-UI-${runId}-`;
  const pool = getPlatformPool();
  const scenarioIds = (
    await pool.query(`SELECT id FROM scenarios WHERE data->>'name' LIKE $1`, [`${tag}%`])
  ).rows.map((row: { id: string }) => row.id);
  if (scenarioIds.length === 0) {
    console.log(`[rollback ${runId}] 无匹配场景，跳过。`);
    return;
  }
  await pool.query(`DELETE FROM module_references WHERE scenario_id = ANY($1)`, [scenarioIds]);
  await pool.query(`DELETE FROM knowledge_objects WHERE scenario_id = ANY($1)`, [scenarioIds]);
  await pool.query(`DELETE FROM parsed_artifacts WHERE scenario_id = ANY($1)`, [scenarioIds]);
  await pool.query(`DELETE FROM files WHERE scenario_id = ANY($1)`, [scenarioIds]);
  await pool.query(`DELETE FROM tasks WHERE scenario_id = ANY($1)`, [scenarioIds]);
  await pool.query(`DELETE FROM scenarios WHERE id = ANY($1)`, [scenarioIds]);
  console.log(`[rollback ${runId}] 已清理 ${scenarioIds.length} 个场景（及其 tasks/files）。`);
}

async function seedRun(runId: string) {
  const tag = `P43-UI-${runId}-`;
  const f1 = await seedOne(tag, "F1-GraphRAG", "customer-360", "f1");
  const f2Gbrain = await seedOne(tag, "F2-Gbrain", "personal-wiki", "f2a");
  const f2Naive = await seedOne(tag, "F2-Naive", "policy-evidence", "f2b");
  console.log(JSON.stringify({
    ok: true,
    runId,
    f1: { scenarioId: f1.scenario.id, requestId: `request_${f1.task.id}` },
    f2Gbrain: { scenarioId: f2Gbrain.scenario.id, requestId: `request_${f2Gbrain.task.id}` },
    f2Naive: { scenarioId: f2Naive.scenario.id, requestId: `request_${f2Naive.task.id}` },
  }, null, 2));
}

const rollbackIdx = args.indexOf("--rollback");
const runIdx = args.indexOf("--run");

if (rollbackIdx !== -1) {
  const runId = args[rollbackIdx + 1];
  if (!runId) {
    console.error("用法: bun scripts/seed-p43-ui-fixture.ts --rollback <runId>");
    process.exit(1);
  }
  await rollback(runId);
} else if (runIdx !== -1) {
  const runId = args[runIdx + 1];
  if (!runId) {
    console.error("用法: bun scripts/seed-p43-ui-fixture.ts --run <runId>");
    process.exit(1);
  }
  await seedRun(runId);
} else {
  console.error("用法: bun scripts/seed-p43-ui-fixture.ts --run <runId> | --rollback <runId>");
  process.exit(1);
}

process.exit(0);
