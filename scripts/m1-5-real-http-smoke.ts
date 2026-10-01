import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import pg from "pg";

const adminUrl = process.env.POSTGRES_ADMIN_URL;
const probeDb = `ff_m1_5_http_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const dataDir = join(tmpdir(), `ff-m1-5-http-${process.pid}-${randomUUID()}`);
let web: ChildProcess | undefined;

function assertSafeProbeDatabaseName(name: string) {
  if (!/^ff_m1_5_http_[0-9]+_[a-f0-9]{32}$/.test(name)) {
    throw new Error(`unsafe M1.5 HTTP probe database name: ${name}`);
  }
}

function assertStatus(response: Response, expected: number, label: string) {
  if (response.status !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, got ${response.status}`);
  }
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("failed to reserve a TCP port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl: string) {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/platform/auth/me`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 401) return;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(250);
  }
  throw new Error(`Next server did not become ready: ${String(lastError ?? "timeout")}`);
}

async function stopWebServer() {
  if (!web || web.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => web?.once("exit", () => resolve()));
  web.kill("SIGTERM");
  await Promise.race([exited, Bun.sleep(10_000)]);
  if (web.exitCode === null) web.kill("SIGKILL");
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function register(baseUrl: string, username: string, password: string, organizationId: string, teamIds: string[]) {
  const response = await fetch(`${baseUrl}/api/platform/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password, display_name: username, organization_id: organizationId, team_ids: teamIds })
  });
  assertStatus(response, 201, `register ${username}`);
}

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/platform/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  assertStatus(response, 200, `login ${username}`);
  const body = await response.json() as { token?: unknown };
  if (typeof body.token !== "string" || !body.token) throw new Error(`login ${username}: missing session token`);
  return body.token;
}

async function promoteIsolatedAdmin(username: string) {
  const authPath = join(dataDir, "auth-db.json");
  const db = JSON.parse(await readFile(authPath, "utf8")) as { users: Array<{ username: string; is_admin: boolean }> };
  const user = db.users.find((item) => item.username === username);
  if (!user) throw new Error("isolated admin candidate was not registered");
  user.is_admin = true;
  await writeFile(authPath, JSON.stringify(db));
}

async function createScenario(baseUrl: string, token: string, visibility: "private" | "team" | "company", label: string) {
  const form = new FormData();
  form.set("template_id", "custom-scenario");
  form.set("name", `M1.5 HTTP ${label}`);
  form.set("description", "isolated authorization smoke fixture");
  form.set("visibility", visibility);
  form.set("processing_goal", "acceptance fixture");
  form.append("files", new File([`${label} evidence`], `${label}.txt`, { type: "text/plain" }));
  const response = await fetch(`${baseUrl}/api/platform/scenarios`, { method: "POST", headers: bearer(token), body: form });
  assertStatus(response, 201, `create ${visibility} scenario`);
  const body = await response.json() as { scenario?: { id?: unknown } };
  if (typeof body.scenario?.id !== "string") throw new Error(`create ${visibility} scenario: missing scenario id`);
  return body.scenario.id;
}

async function listScenarioIds(baseUrl: string, token: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/platform/scenarios`, { headers: bearer(token) });
  assertStatus(response, 200, "list scenarios");
  const body = await response.json() as { scenarios?: Array<{ id?: unknown }> };
  return (body.scenarios ?? []).flatMap((item) => typeof item.id === "string" ? [item.id] : []);
}

function assertContains(ids: string[], expected: string[], label: string) {
  const missing = expected.filter((id) => !ids.includes(id));
  if (missing.length) throw new Error(`${label}: missing expected scenario ids ${missing.join(", ")}`);
}

function assertExcludes(ids: string[], unexpected: string[], label: string) {
  const leaked = unexpected.filter((id) => ids.includes(id));
  if (leaked.length) throw new Error(`${label}: leaked scenario ids ${leaked.join(", ")}`);
}

async function createScenarioSession(baseUrl: string, token: string, scenarioId: string, label: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/platform/scenarios/${scenarioId}/sessions`, {
    method: "POST", headers: { "content-type": "application/json", ...bearer(token) }, body: JSON.stringify({})
  });
  assertStatus(response, 201, `${label} scenario session create`);
  const body = await response.json() as { session?: { id?: unknown } };
  if (typeof body.session?.id !== "string") throw new Error(`${label} scenario session create: missing id`);
  return body.session.id;
}

async function listScenarioSessionIds(baseUrl: string, token: string, scenarioId: string, label: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/platform/scenarios/${scenarioId}/sessions`, { headers: bearer(token) });
  assertStatus(response, 200, label);
  const body = await response.json() as { sessions?: Array<{ id?: unknown }> };
  if (!Array.isArray(body.sessions)) throw new Error(`${label}: expected { sessions: [] } response shape`);
  return body.sessions.flatMap((item) => typeof item.id === "string" ? [item.id] : []);
}

async function listGlobalSessionIds(baseUrl: string, token: string, label: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/platform/chat-sessions`, { headers: bearer(token) });
  assertStatus(response, 200, label);
  const body = await response.json() as { sessions?: Array<{ id?: unknown }> };
  if (!Array.isArray(body.sessions)) throw new Error(`${label}: expected { sessions: [] } response shape`);
  return body.sessions.flatMap((item) => typeof item.id === "string" ? [item.id] : []);
}

async function main() {
  if (!adminUrl) throw new Error("POSTGRES_ADMIN_URL is required for the M1.5 real HTTP smoke");
  assertSafeProbeDatabaseName(probeDb);
  const probeUrl = new URL(adminUrl);
  probeUrl.pathname = `/${probeDb}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  const previousPlatformUrl = process.env.PLATFORM_DATABASE_URL;
  let adminConnected = false;

  try {
    await admin.connect();
    adminConnected = true;
    await admin.query(`CREATE DATABASE ${probeDb}`);
    const created = await admin.query("SELECT datname FROM pg_database WHERE datname = $1", [probeDb]);
    if (created.rowCount !== 1) throw new Error(`probe database creation was not verified: ${probeDb}`);

    process.env.PLATFORM_DATABASE_URL = probeUrl.toString();
    const platform = await import("@ff/platform");
    await platform.migratePlatformDatabase();
    await platform.closePlatformPool();
    if (previousPlatformUrl === undefined) delete process.env.PLATFORM_DATABASE_URL;
    else process.env.PLATFORM_DATABASE_URL = previousPlatformUrl;

    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    web = spawn(join(process.cwd(), "apps", "web", "node_modules", ".bin", "next"), ["dev", "--port", String(port)], {
      cwd: join(process.cwd(), "apps", "web"),
      env: {
        ...process.env,
        NODE_ENV: "development",
        PLATFORM_DATABASE_URL: probeUrl.toString(),
        FF_PLATFORM_DATA_DIR: dataDir,
        FF_PLATFORM_INGEST_MODE: "local",
        FF_PLATFORM_AGENT_MODE: "local",
        GLOBAL_QA_EMERGENCY_LEGACY: "on",
        API_INTERNAL_BASE_URL: "http://127.0.0.1:1"
      },
      stdio: "inherit"
    });
    await waitForServer(baseUrl);

    const suffix = randomUUID().replaceAll("-", "");
    const password = `probe-${randomUUID()}-password`;
    const users = {
      owner: `m15-owner-${suffix}`,
      peer: `m15-peer-${suffix}`,
      differentTeam: `m15-different-${suffix}`,
      outsider: `m15-outsider-${suffix}`,
      admin: `m15-admin-${suffix}`
    };
    await register(baseUrl, users.owner, password, "org-a", ["shared-team"]);
    await register(baseUrl, users.peer, password, "org-a", ["shared-team"]);
    await register(baseUrl, users.differentTeam, password, "org-a", ["different-team"]);
    await register(baseUrl, users.outsider, password, "org-b", ["shared-team"]);
    await register(baseUrl, users.admin, password, "org-admin", ["platform-admin"]);
    await promoteIsolatedAdmin(users.admin);

    const tokens = {
      owner: await login(baseUrl, users.owner, password),
      peer: await login(baseUrl, users.peer, password),
      differentTeam: await login(baseUrl, users.differentTeam, password),
      outsider: await login(baseUrl, users.outsider, password),
      admin: await login(baseUrl, users.admin, password)
    };

    const privateScenario = await createScenario(baseUrl, tokens.owner, "private", "private");
    const teamScenario = await createScenario(baseUrl, tokens.owner, "team", "team");
    const companyScenario = await createScenario(baseUrl, tokens.owner, "company", "company");
    const allIds = [privateScenario, teamScenario, companyScenario];
    assertContains(await listScenarioIds(baseUrl, tokens.owner), allIds, "owner list");
    const peerList = await listScenarioIds(baseUrl, tokens.peer);
    assertContains(peerList, [teamScenario, companyScenario], "same-team peer list");
    assertExcludes(peerList, [privateScenario], "same-team peer list");
    const differentList = await listScenarioIds(baseUrl, tokens.differentTeam);
    assertContains(differentList, [companyScenario], "same-org different-team list");
    assertExcludes(differentList, [privateScenario, teamScenario], "same-org different-team list");
    assertExcludes(await listScenarioIds(baseUrl, tokens.outsider), allIds, "cross-org same-team-id list");
    assertContains(await listScenarioIds(baseUrl, tokens.admin), allIds, "global admin list");

    assertStatus(await fetch(`${baseUrl}/api/platform/scenarios/${privateScenario}/workbench`, { headers: bearer(tokens.peer) }), 404, "peer private detail");
    assertStatus(await fetch(`${baseUrl}/api/platform/scenarios/${teamScenario}/workbench`, { headers: bearer(tokens.peer) }), 200, "peer team detail");
    assertStatus(await fetch(`${baseUrl}/api/platform/scenarios/${companyScenario}/workbench`, { headers: bearer(tokens.differentTeam) }), 200, "different-team company detail");
    assertStatus(await fetch(`${baseUrl}/api/platform/scenarios/${teamScenario}/workbench`, { headers: bearer(tokens.outsider) }), 404, "outsider team workbench");
    assertStatus(await fetch(`${baseUrl}/api/platform/scenarios/${teamScenario}/workbench`, { headers: bearer(tokens.admin) }), 200, "admin team detail");
    assertStatus(await fetch(`${baseUrl}/api/platform/scenarios/${teamScenario}/data-request`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer(tokens.peer) }, body: JSON.stringify({ action: "delete" })
    }), 404, "peer owner-only data request");
    assertStatus(await fetch(`${baseUrl}/api/platform/scenarios/${teamScenario}/data-request`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer(tokens.owner) }, body: JSON.stringify({ action: "update" })
    }), 201, "owner data request control");
    assertStatus(await fetch(`${baseUrl}/api/platform/scenarios/${companyScenario}/data-request`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer(tokens.differentTeam) }, body: JSON.stringify({ action: "delete" })
    }), 404, "different-team owner-only data request");
    assertStatus(await fetch(`${baseUrl}/api/platform/scenarios/${teamScenario}/data-request`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer(tokens.admin) }, body: JSON.stringify({ action: "update" })
    }), 201, "admin data request control");

    const privateSession = await createScenarioSession(baseUrl, tokens.owner, privateScenario, "owner private");
    const teamSession = await createScenarioSession(baseUrl, tokens.owner, teamScenario, "owner team");
    const companySession = await createScenarioSession(baseUrl, tokens.owner, companyScenario, "owner company");
    const sessionUrl = (scenarioId: string, sessionId: string) => `${baseUrl}/api/platform/scenarios/${scenarioId}/sessions/${sessionId}`;
    for (const [label, token, scenarioId, sessionId] of [
      ["peer private", tokens.peer, privateScenario, privateSession],
      ["admin private", tokens.admin, privateScenario, privateSession],
      ["peer team", tokens.peer, teamScenario, teamSession],
      ["different-team company", tokens.differentTeam, companyScenario, companySession],
      ["admin team", tokens.admin, teamScenario, teamSession],
      ["outsider team", tokens.outsider, teamScenario, teamSession]
    ] as const) {
      const url = sessionUrl(scenarioId, sessionId);
      assertStatus(await fetch(url, { headers: bearer(token) }), 404, `${label} session detail`);
      assertStatus(await fetch(`${url}/messages`, {
        method: "POST", headers: { "content-type": "application/json", ...bearer(token) }, body: JSON.stringify({ query: "unauthorized write" })
      }), 404, `${label} session append`);
    }
    assertExcludes(await listScenarioSessionIds(baseUrl, tokens.peer, privateScenario, "peer private session list"), [privateSession], "peer private session list");
    assertExcludes(await listScenarioSessionIds(baseUrl, tokens.admin, privateScenario, "admin private session list"), [privateSession], "admin private session list");
    assertExcludes(await listScenarioSessionIds(baseUrl, tokens.peer, teamScenario, "peer team session list"), [teamSession], "peer team session list");
    assertExcludes(await listScenarioSessionIds(baseUrl, tokens.differentTeam, companyScenario, "different-team company session list"), [companySession], "different-team company session list");
    assertExcludes(await listScenarioSessionIds(baseUrl, tokens.admin, teamScenario, "admin team session list"), [teamSession], "admin team session list");
    assertContains(await listScenarioSessionIds(baseUrl, tokens.owner, teamScenario, "owner team session list control"), [teamSession], "owner team session list control");
    assertContains(await listScenarioSessionIds(baseUrl, tokens.owner, companyScenario, "owner company session list control"), [companySession], "owner company session list control");
    assertStatus(await fetch(`${sessionUrl(teamScenario, teamSession)}/messages`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer(tokens.owner) }, body: JSON.stringify({ query: "owner write control" })
    }), 200, "owner team session append control");

    const globalCreated = await fetch(`${baseUrl}/api/platform/chat-sessions`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer(tokens.owner) }, body: JSON.stringify({ scope: "private" })
    });
    assertStatus(globalCreated, 201, "owner global session create");
    const globalBody = await globalCreated.json() as { session?: { id?: unknown } };
    if (typeof globalBody.session?.id !== "string") throw new Error("owner global session create: missing id");
    for (const [role, token] of Object.entries({ peer: tokens.peer, admin: tokens.admin })) {
      assertStatus(await fetch(`${baseUrl}/api/platform/chat-sessions/${globalBody.session.id}`, { headers: bearer(token) }), 404, `${role} global detail`);
      assertStatus(await fetch(`${baseUrl}/api/platform/chat-sessions/${globalBody.session.id}/messages`, {
        method: "POST", headers: { "content-type": "application/json", ...bearer(token) }, body: JSON.stringify({ query: "unauthorized global write" })
      }), 404, `${role} global session append`);
    }
    assertExcludes(await listGlobalSessionIds(baseUrl, tokens.peer, "peer global session list"), [globalBody.session.id], "peer global session list");
    assertExcludes(await listGlobalSessionIds(baseUrl, tokens.admin, "admin global session list"), [globalBody.session.id], "admin global session list");
    assertContains(await listGlobalSessionIds(baseUrl, tokens.owner, "owner global session list control"), [globalBody.session.id], "owner global session list control");
    assertStatus(await fetch(`${baseUrl}/api/platform/chat-sessions/${globalBody.session.id}`, { headers: bearer(tokens.owner) }), 200, "owner global detail control");
    assertStatus(await fetch(`${baseUrl}/api/platform/chat-sessions/${globalBody.session.id}/messages`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer(tokens.owner) }, body: JSON.stringify({ query: "owner global write control" })
    }), 200, "owner global session append control");

    assertStatus(await fetch(`${baseUrl}/api/platform/admin/page-curation/pages`, { headers: bearer(tokens.peer) }), 403, "member curation guard");
    assertStatus(await fetch(`${baseUrl}/api/platform/admin/page-curation/pages`, { headers: bearer(tokens.admin) }), 200, "admin curation control");
    console.log(JSON.stringify({ status: "ok", probe_database: probeDb, cleanup: "pending", roles: ["owner", "peer", "different-team", "outsider", "admin"] }));
  } finally {
    if (previousPlatformUrl === undefined) delete process.env.PLATFORM_DATABASE_URL;
    else process.env.PLATFORM_DATABASE_URL = previousPlatformUrl;
    await stopWebServer();
    await rm(dataDir, { recursive: true, force: true });
    if (adminConnected) {
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${probeDb}`);
        const remaining = await admin.query("SELECT datname FROM pg_database WHERE datname = $1", [probeDb]);
        if (remaining.rowCount !== 0) throw new Error(`probe database cleanup was not verified: ${probeDb}`);
        console.log(JSON.stringify({ probe_database: probeDb, cleanup: "verified" }));
      } finally {
        await admin.end().catch(() => undefined);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
