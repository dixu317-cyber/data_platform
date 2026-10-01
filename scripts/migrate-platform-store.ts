/**
 * P12 Phase 1 T1b-1：平台业务数据 JSON ↔ PG 可逆迁移（spec §4 硬约束：迁移需可回滚）。
 *
 *   bun run scripts/migrate-platform-store.ts            # 正向：platform-db.json → PG
 *   bun run scripts/migrate-platform-store.ts --export   # 反向（回滚）：PG → platform-db.json
 *
 * 环境：PLATFORM_DATABASE_URL 指向目标库；PLATFORM_JSON_PATH 可覆盖 JSON 路径
 * （默认 apps/web/.platform-data/platform-db.json —— 旧文件存储的落点）。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { migratePlatformDatabase, saveDbToPg, loadDbFromPg, closePlatformPool } from "@ff/platform";

const JSON_PATH = process.env.PLATFORM_JSON_PATH || join(process.cwd(), "apps/web/.platform-data/platform-db.json");
const COLLECTIONS = [
  "scenarios", "tasks", "files", "parsedArtifacts", "knowledgeObjects", "moduleReferences",
  "chatSessions", "scenarioChatSessions", "templates", "auditEvents", "traces",
];

function counts(db: Record<string, unknown>): string {
  return COLLECTIONS.map((k) => `${k}=${Array.isArray(db[k]) ? (db[k] as unknown[]).length : 0}`).join(" ");
}

async function importJsonToPg() {
  const raw = await readFile(JSON_PATH, "utf8");
  const db = JSON.parse(raw) as Record<string, unknown>;
  await migratePlatformDatabase();
  await saveDbToPg(db);
  const back = await loadDbFromPg();
  console.log(`[import] ${JSON_PATH} → PG`);
  console.log(`[import] 源: ${counts(db)}`);
  console.log(`[import] PG: ${counts(back)}`);
  const ok = COLLECTIONS.every((k) => (Array.isArray(db[k]) ? (db[k] as unknown[]).length : 0) === (Array.isArray(back[k]) ? (back[k] as unknown[]).length : 0));
  console.log(ok ? "[import] 计数一致 ✓" : "[import] ⚠️ 计数不一致，请核查");
}

async function exportPgToJson() {
  const db = await loadDbFromPg();
  await mkdir(dirname(JSON_PATH), { recursive: true });
  await writeFile(JSON_PATH, JSON.stringify(db, null, 2));
  console.log(`[export] PG → ${JSON_PATH}（回滚：恢复 JSON 文件存储）`);
  console.log(`[export] ${counts(db)}`);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--export") {
    await exportPgToJson();
  } else {
    await importJsonToPg();
  }
  await closePlatformPool();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
