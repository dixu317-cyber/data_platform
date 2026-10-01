import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { User } from "../api";
import type { StoreUser } from "@ff/platform/platform-store";
import { defaultOrgTeamFor } from "@ff/platform/org-team-defaults";

export const AUTH_COOKIE_NAME = "ff_companybrain_session";
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type IdentityRole = "member" | "admin";
export type IdentityUser = User & {
  display_name: string;
  organization_id: string;
  team_ids: string[];
};

type StoredUser = IdentityUser & {
  password_salt: string;
  password_hash: string;
  created_at: string;
};

type StoredSession = {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
};

type AuthDb = {
  users: StoredUser[];
  sessions: StoredSession[];
};

const emptyDb = (): AuthDb => ({ users: [], sessions: [] });

export async function resetAuthStore() {
  await rm(authDbPath(), { force: true });
}

export async function registerUser(input: {
  username: string;
  password: string;
  displayName?: string;
  teamId?: string;
  role?: IdentityRole;
  organizationId?: string;
  teamIds?: string[];
}): Promise<IdentityUser> {
  // 真 identity 是 production 注册唯一真值；本地库仅在 development 且 identity 不可用时逃生。
  try {
    return await apiRegister({
      username: input.username,
      password: input.password,
      displayName: input.displayName,
      teamId: input.teamId,
    });
  } catch (error) {
    const mayUseDevelopmentFallback =
      isDevEnv() && error instanceof RegistrationError && error.status === 502;
    if (!mayUseDevelopmentFallback) throw error;
  }
  const username = normalizeUsername(input.username);
  assertPassword(input.password);
  const db = await readAuthDb();
  if (db.users.some((user) => user.username === username)) throw new Error("用户已存在");

  const now = new Date().toISOString();
  const salt = randomBytes(16).toString("base64url");
  const user: StoredUser = {
    id: `user_${randomUUID()}`,
    username,
    display_name: input.displayName?.trim() || username,
    is_admin: input.role === "admin",
    organization_id: "org_companybrain",
    team_ids: defaultOrgTeamFor(input.role === "admin").teamIds,
    password_salt: salt,
    password_hash: hashPassword(input.password, salt),
    created_at: now
  };

  db.users.push(user);
  await writeAuthDb(db);
  return publicUser(user);
}

// ===== 真 identity（apps/api → Postgres ff_identity）集成 =====
// 登录/注册/校验优先走统一 API 的真实 identity 库；不可用时回退本地 scrypt 用户库，保证可用性。
function platformIdentityBaseUrl(): string {
  const raw = process.env.API_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
  return raw.replace(/\/+$/, "");
}

function mapApiUser(value: unknown): IdentityUser {
  const apiUser = value as {
    id?: unknown;
    username?: unknown;
    is_admin?: unknown;
    organization_id?: unknown;
    team_ids?: unknown;
  } | null;
  if (
    !apiUser
    || typeof apiUser.id !== "string"
    || apiUser.id.trim().length === 0
    || typeof apiUser.username !== "string"
    || apiUser.username.trim().length === 0
    || typeof apiUser.is_admin !== "boolean"
    || typeof apiUser.organization_id !== "string"
    || apiUser.organization_id.trim().length === 0
    || !Array.isArray(apiUser.team_ids)
    || apiUser.team_ids.length === 0
    || !apiUser.team_ids.every((teamId) => typeof teamId === "string")
  ) {
    throw new Error("invalid identity user payload");
  }
  const teamIds = Array.from(
    new Set(apiUser.team_ids.map((teamId) => teamId.trim()).filter(Boolean)),
  );
  if (teamIds.length === 0) {
    throw new Error("invalid identity user payload");
  }
  return {
    id: apiUser.id.trim(),
    username: apiUser.username.trim(),
    display_name: apiUser.username.trim(),
    is_admin: apiUser.is_admin,
    organization_id: apiUser.organization_id.trim(),
    team_ids: teamIds
  };
}

export class RegistrationError extends Error {
  constructor(
    public readonly status: 400 | 409 | 429 | 502,
    public readonly code: string,
  ) {
    super(status === 502 ? "身份服务暂时不可用" : "注册请求被身份服务拒绝");
    this.name = "RegistrationError";
  }
}

export function isPlatformIdentityToken(token: string | null | undefined): boolean {
  return typeof token === "string" && token.startsWith("ff_");
}

// A3 fail-closed：仅 NODE_ENV 明确等于 'development' 才视为 dev；未设置/其他任何值一律按非 dev 处理（宁可拒绝也不留后门）。
function isDevEnv(): boolean {
  return process.env.NODE_ENV === "development";
}

export class SessionRevocationError extends Error {
  constructor(public readonly status: 401 | 502) {
    super(status === 401 ? "未登录或登录已过期" : "身份服务暂时不可用");
    this.name = "SessionRevocationError";
  }
}

async function apiLogin(input: { username: string; password: string }): Promise<{ token: string; user: IdentityUser } | null> {
  try {
    const response = await fetch(`${platformIdentityBaseUrl()}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as any;
    if (!body?.token || !body?.user) return null;
    return { token: body.token, user: mapApiUser(body.user) };
  } catch {
    return null;
  }
}

async function apiRegister(input: {
  username: string;
  password: string;
  displayName?: string;
  teamId?: string;
}): Promise<IdentityUser> {
  try {
    const response = await fetch(`${platformIdentityBaseUrl()}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        ...(input.displayName ? { display_name: input.displayName } : {}),
        ...(input.teamId ? { team_id: input.teamId } : {}),
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      if (response.status === 400 || response.status === 409 || response.status === 429) {
        const body = (await response.json().catch(() => null)) as any;
        const code = typeof body?.error === "string" && body.error ? body.error : "identity_register_rejected";
        throw new RegistrationError(response.status, code);
      }
      throw new RegistrationError(502, "identity_unavailable");
    }
    const body = (await response.json().catch(() => null)) as any;
    if (!body?.user || typeof body.user.id !== "string" || typeof body.user.username !== "string") {
      throw new RegistrationError(502, "identity_unavailable");
    }
    return mapApiUser(body.user);
  } catch (error) {
    if (error instanceof RegistrationError) throw error;
    throw new RegistrationError(502, "identity_unavailable");
  }
}

export async function listRegistrationTeams(): Promise<Array<{ id: string; name: string }>> {
  try {
    const response = await fetch(`${platformIdentityBaseUrl()}/auth/registration-teams`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new RegistrationError(502, "identity_unavailable");
    }
    const body = (await response.json().catch(() => null)) as any;
    if (
      !Array.isArray(body?.teams)
      || !body.teams.every(
        (team: unknown) =>
          team
          && typeof team === "object"
          && typeof (team as any).id === "string"
          && (team as any).id.trim()
          && typeof (team as any).name === "string"
          && (team as any).name.trim(),
      )
    ) {
      throw new RegistrationError(502, "identity_unavailable");
    }
    return body.teams.map((team: any) => ({
      id: team.id.trim(),
      name: team.name.trim(),
    }));
  } catch (error) {
    if (error instanceof RegistrationError) throw error;
    throw new RegistrationError(502, "identity_unavailable");
  }
}

async function apiMe(token: string): Promise<IdentityUser | null> {
  try {
    const response = await fetch(`${platformIdentityBaseUrl()}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as any;
    return body?.user ? mapApiUser(body.user) : null;
  } catch {
    return null;
  }
}

export async function authenticateUser(input: { username: string; password: string }): Promise<{ token: string; user: IdentityUser } | null> {
  // 先走真 identity；真库无此用户或服务不可用时回退本地——仅限 dev 逃生口，非 dev fail-closed 直接拒绝。
  const viaApi = await apiLogin(input);
  if (viaApi) return viaApi;
  if (!isDevEnv()) return null;
  await ensureDefaultUsers();
  const db = await readAuthDb();
  const username = normalizeUsername(input.username);
  const user = db.users.find((item) => item.username === username);
  if (!user || !verifyPassword(input.password, user)) return null;

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const session: StoredSession = {
    id: `session_${randomUUID()}`,
    user_id: user.id,
    token_hash: hashToken(token),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + AUTH_COOKIE_MAX_AGE_SECONDS * 1000).toISOString()
  };
  db.sessions.unshift(session);
  db.sessions = db.sessions.filter((item) => new Date(item.expires_at).getTime() > now.getTime());
  await writeAuthDb(db);
  return { token, user: publicUser(user) };
}

export async function getSessionUser(token: string | null | undefined): Promise<IdentityUser | null> {
  if (!token) return null;
  // 真 identity 颁发的 token（ff_ 前缀）走统一 API 校验；本地 token 走本地库——仅限 dev 逃生口。
  if (isPlatformIdentityToken(token)) {
    return apiMe(token);
  }
  if (!isDevEnv()) return null;
  const db = await readAuthDb();
  const now = Date.now();
  const tokenHash = hashToken(token);
  const session = db.sessions.find((item) => item.token_hash === tokenHash && new Date(item.expires_at).getTime() > now);
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.user_id);
  return user ? publicUser(user) : null;
}

export async function revokeSession(token: string | null | undefined): Promise<void> {
  if (!token) throw new SessionRevocationError(401);
  if (isPlatformIdentityToken(token)) {
    try {
      const response = await fetch(`${platformIdentityBaseUrl()}/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000)
      });
      if (response.ok) return;
      throw new SessionRevocationError(response.status === 401 ? 401 : 502);
    } catch (error) {
      if (error instanceof SessionRevocationError) throw error;
      throw new SessionRevocationError(502);
    }
  }
  if (!isDevEnv()) throw new SessionRevocationError(401);
  const db = await readAuthDb();
  const tokenHash = hashToken(token);
  const session = db.sessions.find(
    (item) => item.token_hash === tokenHash && new Date(item.expires_at).getTime() > Date.now(),
  );
  if (!session) throw new SessionRevocationError(401);
  db.sessions = db.sessions.filter((item) => item.id !== session.id);
  await writeAuthDb(db);
}

export async function getRequestUser(request: Request): Promise<IdentityUser | null> {
  return getSessionUser(getRequestSessionToken(request));
}

export function getRequestSessionToken(request: Request) {
  return readBearerToken(request) ?? readCookie(request, AUTH_COOKIE_NAME);
}

export function userToStoreUser(user: IdentityUser): StoreUser {
  return {
    userId: user.id,
    name: user.display_name || user.username,
    role: user.is_admin ? "admin" : "member",
    organizationId: user.organization_id,
    teamIds: user.team_ids
  };
}

export function sessionCookie(token: string) {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function dataRoot() {
  return process.env.FF_PLATFORM_DATA_DIR || join(process.cwd(), ".platform-data");
}

function authDbPath() {
  return join(dataRoot(), "auth-db.json");
}

async function readAuthDb(): Promise<AuthDb> {
  try {
    const raw = await readFile(authDbPath(), "utf8");
    return { ...emptyDb(), ...JSON.parse(raw) };
  } catch {
    return emptyDb();
  }
}

async function writeAuthDb(db: AuthDb) {
  await mkdir(dataRoot(), { recursive: true });
  await writeFile(authDbPath(), JSON.stringify(db, null, 2));
}

async function ensureDefaultUsers() {
  if (!isDevEnv()) return; // 仅 dev 播种默认账号；非 dev fail-closed（Δ2-c，与调用点 Δ2-b 双重把关）。
  const db = await readAuthDb();
  if (db.users.length > 0) return;
  const now = new Date().toISOString();
  db.users.push(createSeedUser("muyu", "muyu123456", "木羽", false, now, "org_companybrain", ["default-team"]));
  db.users.push(createSeedUser("admin", "admin123456", "管理员", true, now, "org_companybrain", ["platform-admin"]));
  await writeAuthDb(db);
}

function createSeedUser(username: string, password: string, displayName: string, isAdmin: boolean, now: string, organizationId: string, teamIds: string[]): StoredUser {
  const salt = randomBytes(16).toString("base64url");
  return {
    id: `user_${randomUUID()}`,
    username,
    display_name: displayName,
    is_admin: isAdmin,
    organization_id: organizationId,
    team_ids: teamIds,
    password_salt: salt,
    password_hash: hashPassword(password, salt),
    created_at: now
  };
}

function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase();
  if (!username) throw new Error("请输入账号");
  return username;
}

function assertPassword(value: string) {
  if (value.length < 8) throw new Error("密码至少需要 8 位");
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString("base64url");
}

function verifyPassword(password: string, user: StoredUser) {
  const actual = Buffer.from(hashPassword(password, user.password_salt));
  const expected = Buffer.from(user.password_hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function publicUser(user: StoredUser): IdentityUser {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    is_admin: user.is_admin,
    organization_id: normalizeOrganizationId(user.organization_id),
    team_ids: normalizeTeamIds(user.team_ids, user.is_admin)
  };
}

function normalizeOrganizationId(value?: string) {
  return value?.trim() || "org_companybrain";
}

function normalizeTeamIds(value?: string[], isAdmin = false) {
  const ids = Array.from(new Set((value ?? []).map((item) => item.trim()).filter(Boolean)));
  if (ids.length > 0) return ids;
  return defaultOrgTeamFor(isAdmin).teamIds;
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice("bearer ".length).trim();
}

function readCookie(request: Request, key: string) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === key) return decodeURIComponent(rest.join("="));
  }
  return null;
}
