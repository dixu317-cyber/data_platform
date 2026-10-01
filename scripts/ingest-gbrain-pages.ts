// P53 · Gbrain 知识页入库点亮（后台可见 + 前台可检索）
// 走正路 ingest：createStoredScenario(visibility=company) → decideAdminIntakeRequest(selectedEngine="Gbrain")
//   → ingestGbrainFile → nano dream compile → 产出 nano 页 + KO + company-scope ready module_reference。
// 用法（repo root，需 nano-brain 8100 在跑 + AGENT_*/EMBEDDING_* env）：
//   bun scripts/ingest-gbrain-pages.ts            # dry-run：只读，打印计划 + slug 去重断言 + 现状，零写入零计费
//   bun scripts/ingest-gbrain-pages.ts --apply    # 真入库（compile 调 LLM+embedding 计费）
//   bun scripts/ingest-gbrain-pages.ts --rollback # 按 ledger 撤平台可见性（见 §rollback 边界）
// 真相源：PKP/specs/P53-Gbrain知识页入库点亮-执行spec.md（v0.2，codex 审过）。
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";

const ROOT = join(import.meta.dir, "..");
const DOCS = join(ROOT, "eval/corpus/gbrain-pages");
const LEDGER = join(ROOT, "eval/reports/ingest-gbrain-ledger.json");
const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.includes("--rollback");

const TEMPLATE_ID = "team-handbook"; // 纯 nano-brain wiki（required:true），与 selectedEngine="Gbrain" 一致
const ENGINE = "Gbrain" as const;

// ── .env 加载 + real mode（照 ingest-evalset-corpus.ts）──
const env: Record<string, string> = {};
for (const line of (await Bun.file(join(ROOT, ".env")).text()).split("\n")) {
  const t = line.trim();
  if (t && !t.startsWith("#") && t.includes("=")) { const i = t.indexOf("="); env[t.slice(0, i).trim()] = t.slice(i + 1).trim(); }
}
process.env.FF_PLATFORM_INGEST_MODE = "real";
for (const k of ["PLATFORM_DATABASE_URL", "RAG_INTERNAL_TOKEN", "NANO_BRAIN_HTTP_URL", "NANO_BRAIN_DATABASE_URL",
  "AGENT_API_KEY", "AGENT_BASE_URL", "AGENT_MODEL", "EMBEDDING_API_KEY", "EMBEDDING_BASE_URL", "EMBEDDING_MODEL"]) {
  if (env[k]) process.env[k] = env[k];
}

const { createStoredScenario, decideAdminIntakeRequest } = await import("@ff/platform/platform-store");
const admin = { userId: "p41-ingest-admin", name: "管理员", role: "admin" as const, organizationId: "org_companybrain", teamIds: ["platform-admin"] };

const pgc = new pg.Client({ connectionString: env.PLATFORM_DATABASE_URL });
await pgc.connect();

type Led = { fn: string; scenarioId?: string; taskId?: string; status: string; reason?: string; error?: string; at: string; note?: string };
const ledger: Led[] = existsSync(LEDGER) ? JSON.parse(await readFile(LEDGER, "utf8")) : [];

// ── 真实产出校验（不信 status==='已发布'，直查 module_references 有 Gbrain ready 行）──
async function verifyIngestSuccess(scenarioId: string): Promise<{ ok: boolean; reason?: string }> {
  const rows = (await pgc.query("SELECT engine, status FROM module_references WHERE scenario_id=$1", [scenarioId])).rows as { engine: string; status: string }[];
  const gb = rows.filter((r) => r.engine === ENGINE);
  if (gb.length === 0) return { ok: false, reason: "无 Gbrain module_reference" };
  if (!gb.some((r) => r.status === "ready")) return { ok: false, reason: `Gbrain ref 非 ready：${gb.map((r) => r.status).join(",")}` };
  return { ok: true };
}
async function findExistingScenarioId(name: string): Promise<string | null> {
  const r = (await pgc.query("SELECT id FROM scenarios WHERE data->>'name'=$1 LIMIT 1", [name])).rows[0];
  return r?.id ?? null;
}

// ── rollback 边界（codex Top2）：Gbrain public source 是组织共享的，禁删整个 nano source。
//   本 rollback 只删 platform 侧 scenario 关联记录（撤后台可见性 + 前台检索的 module_reference），
//   nano 底层 raw_document/page/chunk 保留（无精确删 API，物理清理另议）。这是「撤可见性不清底层」，不留假象。
async function doRollback() {
  if (!existsSync(LEDGER)) { console.log("[rollback] 无 ledger，无可回滚"); return; }
  const led: Led[] = JSON.parse(await readFile(LEDGER, "utf8"));
  for (const l of led) {
    if (!l.scenarioId) continue;
    for (const tbl of ["module_references", "knowledge_objects", "parsed_artifacts", "files", "scenarios"]) {
      const col = tbl === "scenarios" ? "id" : "scenario_id";
      await pgc.query(`DELETE FROM ${tbl} WHERE ${col}=$1`, [l.scenarioId]).catch(() => {});
    }
    console.log(`[rollback] 撤平台可见性 ${l.fn} scenario=${l.scenarioId}（nano 底层页保留，见脚本注释）`);
  }
}

if (ROLLBACK) { await doRollback(); await pgc.end(); process.exit(0); }

// ── 计划 + slug 去重断言（codex Top1：共享 public source 下 (source_id, slug) 唯一键，slug 由文件名 stem 派生）──
const files = (await readdir(DOCS)).filter((f) => f.endsWith(".md")).sort();
const stems = files.map((f) => basename(f, ".md"));
const dupStem = stems.filter((s, i) => stems.indexOf(s) !== i);
if (dupStem.length) { console.error(`[BLOCK] 文件名 stem 撞车（slug 唯一键冲突）：${[...new Set(dupStem)].join(", ")}`); await pgc.end(); process.exit(1); }
console.log(`[计划] ${files.length} 篇 Gbrain 知识页 → templateId=${TEMPLATE_ID} / selectedEngine=${ENGINE} / visibility=company`);
for (const f of files) console.log(`  - ${f}（slug stem「${basename(f, ".md")}」唯一 ✓）`);

// ── 现状 ──
const before = (await pgc.query("SELECT count(*)::int n FROM module_references WHERE engine=$1", [ENGINE])).rows[0].n;
console.log(`[现状] 当前 module_references Gbrain=${before} 条`);

if (!APPLY) {
  console.log("\n[dry-run] 未写入。slug 去重通过、计划已列。加 --apply 真入库（compile 计费）。");
  await pgc.end();
  process.exit(0);
}

// ── 真入库 ──
let ok = 0, fail = 0, skip = 0;
for (const fn of files) {
  const scenarioName = `Gbrain知识页 · ${basename(fn, ".md")}`;
  const existingId = await findExistingScenarioId(scenarioName);
  if (existingId) {
    const v = await verifyIngestSuccess(existingId);
    if (v.ok) { ledger.push({ fn, scenarioId: existingId, status: "done", at: new Date().toISOString(), note: "既存 ready，跳过" }); console.log(`[skip-existing-ok] ${fn} → ${existingId}`); skip++; continue; }
    console.log(`[existing-stale] ${fn} → ${existingId}（${v.reason}）——留待人工清理，跳过本次`); skip++; continue;
  }
  const content = await readFile(join(DOCS, fn), "utf8");
  try {
    const created = await createStoredScenario(admin as any, {
      templateId: TEMPLATE_ID, name: scenarioName,
      description: "P53 Gbrain 知识页入库点亮（演示三引擎全亮）", visibility: "company" as any,
      processingGoal: "知识百科检索 + 全域问答召回",
      files: [{ name: fn, type: "text/markdown", bytes: new TextEncoder().encode(content) }],
    });
    await decideAdminIntakeRequest(admin as any, { requestId: `request_${created.task.id}`, action: "approve", selectedEngine: ENGINE });
    const v = await verifyIngestSuccess(created.scenario.id);
    if (!v.ok) { ledger.push({ fn, scenarioId: created.scenario.id, taskId: created.task.id, status: "failed", reason: v.reason, at: new Date().toISOString() }); await Bun.write(LEDGER, JSON.stringify(ledger, null, 2)); console.error(`[fail] ${fn}: ${v.reason}`); fail++; continue; }
    ledger.push({ fn, scenarioId: created.scenario.id, taskId: created.task.id, status: "done", at: new Date().toISOString() });
    await Bun.write(LEDGER, JSON.stringify(ledger, null, 2));
    console.log(`[ok] Gbrain ${fn} → ${created.scenario.id}（module_reference 已验证 ready）`);
    ok++;
  } catch (e) {
    ledger.push({ fn, status: "failed", error: String(e).slice(0, 200), at: new Date().toISOString() });
    await Bun.write(LEDGER, JSON.stringify(ledger, null, 2));
    console.error(`[fail] ${fn}: ${String(e).slice(0, 160)}`);
    fail++;
  }
}
const after = (await pgc.query("SELECT count(*)::int n FROM module_references WHERE engine=$1", [ENGINE])).rows[0].n;
console.log(`\n[apply 完成] ok=${ok} fail=${fail} skip=${skip}。module_references Gbrain: ${before} → ${after}。ledger: ${LEDGER}`);
await pgc.end();
if (fail > 0) process.exit(1);
