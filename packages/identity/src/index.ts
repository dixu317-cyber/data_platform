import { randomUUID } from 'node:crypto';
import { getIdentityPool } from './db';
import { hashPassword, verifyPassword } from './password';
import { createBearerToken, getSessionExpiry, hashBearerToken } from './tokens';

export { closeIdentityPool, getIdentityPool } from './db';
export { migrateIdentityDatabase } from './migrations';

export type IdentityUser = {
  id: string;
  username: string;
  isAdmin: boolean;
  organizationId: string;
  teamIds: string[];
  createdAt: Date;
};

export type RegistrationTeam = {
  id: string;
  name: string;
};

export type AuthResult = {
  token: string;
  user: IdentityUser;
};

export type IdentityErrorCode =
  | 'invalid_input'
  | 'username_taken'
  | 'invalid_credentials'
  | 'not_found'
  | 'data_integrity';

export class IdentityError extends Error {
  constructor(
    message: string,
    public readonly code: IdentityErrorCode,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function assertValidCredentialsInput(username: string, password: string): string {
  const normalized = normalizeUsername(username);
  if (normalized.length < 3 || normalized.length > 64) {
    throw new IdentityError('用户名长度必须在 3 到 64 个字符之间', 'invalid_input');
  }
  if (!/^[a-z0-9_.@-]+$/.test(normalized)) {
    throw new IdentityError('用户名只能包含字母、数字、下划线、点、@ 或短横线', 'invalid_input');
  }
  if (password.length < 8 || password.length > 256) {
    throw new IdentityError('密码长度必须在 8 到 256 个字符之间', 'invalid_input');
  }
  return normalized;
}

function mapUser(row: any): IdentityUser {
  const organizationCount = Number(row.organization_count);
  const organizationId =
    typeof row.organization_id === 'string' ? row.organization_id : '';
  const teamIds = Array.isArray(row.team_ids)
    ? row.team_ids.filter((teamId: unknown): teamId is string => typeof teamId === 'string')
    : [];

  if (organizationCount !== 1 || !organizationId || teamIds.length === 0) {
    throw new IdentityError(
      '用户组织或团队归属数据不完整',
      'data_integrity',
    );
  }

  return {
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin,
    organizationId,
    teamIds,
    createdAt: row.created_at,
  };
}

const USER_ATTRIBUTION_COLUMNS = `
  u.id,
  u.username,
  u.password_hash,
  u.is_admin,
  u.created_at,
  COUNT(DISTINCT t.organization_id)::INTEGER AS organization_count,
  MIN(t.organization_id) AS organization_id,
  COALESCE(
    ARRAY_AGG(DISTINCT m.team_id ORDER BY m.team_id)
      FILTER (WHERE m.team_id IS NOT NULL),
    ARRAY[]::TEXT[]
  ) AS team_ids
`;

async function selectAttributedUserById(
  queryable: Pick<import('pg').PoolClient, 'query'>,
  userId: string,
): Promise<IdentityUser> {
  const result = await queryable.query(
    `
      SELECT ${USER_ATTRIBUTION_COLUMNS}
      FROM users u
      LEFT JOIN user_team_memberships m ON m.user_id = u.id
      LEFT JOIN teams t ON t.id = m.team_id
      WHERE u.id = $1
      GROUP BY u.id
    `,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new IdentityError('用户不存在', 'not_found');
  }
  return mapUser(row);
}

export async function listRegistrationTeams(): Promise<RegistrationTeam[]> {
  const pool = getIdentityPool();
  const result = await pool.query(
    `
      SELECT id, name
      FROM teams
      WHERE organization_id = 'org_companybrain'
        AND active = TRUE
        AND registration_enabled = TRUE
        AND id <> 'platform-admin'
      ORDER BY sort_order, id
    `,
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function createUser(input: {
  username: string;
  password: string;
  isAdmin?: boolean;
  teamId?: string | null;
}): Promise<IdentityUser> {
  const username = assertValidCredentialsInput(input.username, input.password);
  if (input.teamId !== undefined && input.teamId !== null && typeof input.teamId !== 'string') {
    throw new IdentityError('团队参数不合法', 'invalid_input');
  }
  const explicitTeamId =
    typeof input.teamId === 'string' && input.teamId.trim()
      ? input.teamId.trim()
      : null;
  if (input.isAdmin && explicitTeamId) {
    throw new IdentityError('管理员初始化不接受公开注册团队', 'invalid_input');
  }
  const pool = getIdentityPool();
  if (explicitTeamId && !input.isAdmin) {
    const preflight = await pool.query(
      `
        SELECT 1
        FROM teams
        WHERE id = $1
          AND organization_id = 'org_companybrain'
          AND active = TRUE
          AND registration_enabled = TRUE
          AND id <> 'platform-admin'
      `,
      [explicitTeamId],
    );
    if (preflight.rowCount !== 1) {
      throw new IdentityError('所选团队不存在或不可注册', 'invalid_input');
    }
  }
  const passwordHash = await hashPassword(input.password);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const teamResult = await client.query(
      input.isAdmin
        ? `
            SELECT id
            FROM teams
            WHERE id = 'platform-admin'
              AND organization_id = 'org_companybrain'
              AND active = TRUE
            FOR SHARE
          `
        : explicitTeamId
          ? `
              SELECT id
              FROM teams
              WHERE id = $1
                AND organization_id = 'org_companybrain'
                AND active = TRUE
                AND registration_enabled = TRUE
                AND id <> 'platform-admin'
              FOR SHARE
            `
        : `
            SELECT id
            FROM teams
            WHERE organization_id = 'org_companybrain'
              AND is_default = TRUE
              AND active = TRUE
              AND registration_enabled = TRUE
              AND id <> 'platform-admin'
            FOR SHARE
          `,
      explicitTeamId && !input.isAdmin ? [explicitTeamId] : [],
    );
    if (teamResult.rowCount !== 1) {
      if (explicitTeamId && !input.isAdmin) {
        throw new IdentityError('所选团队不存在或不可注册', 'invalid_input');
      }
      throw new IdentityError(
        input.isAdmin
          ? '管理员团队配置不完整'
          : '默认注册团队配置不完整',
        'data_integrity',
      );
    }

    const result = await client.query(
      `
        INSERT INTO users (id, username, password_hash, is_admin)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `,
      [randomUUID(), username, passwordHash, input.isAdmin ?? false],
    );
    const userId = result.rows[0].id;
    await client.query(
      `
        INSERT INTO user_team_memberships (user_id, team_id)
        VALUES ($1, $2)
      `,
      [userId, teamResult.rows[0].id],
    );
    const user = await selectAttributedUserById(client, userId);
    await client.query('COMMIT');
    return user;
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') {
      throw new IdentityError('用户名已存在', 'username_taken');
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Idempotent bootstrap helper for the teaching database stack.
 *
 * An existing username is accepted only when it is already an administrator
 * and the configured password still matches.  This deliberately refuses to
 * elevate an ordinary account or silently rotate a password during migration.
 */
export async function ensureAdminUser(input: {
  username: string;
  password: string;
}): Promise<IdentityUser> {
  const username = assertValidCredentialsInput(input.username, input.password);
  const pool = getIdentityPool();
  const result = await pool.query(
    `
      SELECT ${USER_ATTRIBUTION_COLUMNS}
      FROM users u
      LEFT JOIN user_team_memberships m ON m.user_id = u.id
      LEFT JOIN teams t ON t.id = m.team_id
      WHERE u.username = $1
      GROUP BY u.id
    `,
    [username],
  );
  const row = result.rows[0];
  if (!row) return createUser({ username, password: input.password, isAdmin: true });

  const passwordMatches = await verifyPassword(input.password, row.password_hash);
  if (!row.is_admin || !passwordMatches) {
    throw new IdentityError(
      '同名账号已存在，但管理员身份或密码与初始化配置不一致',
      'invalid_credentials',
    );
  }
  return mapUser(row);
}

export async function login(input: { username: string; password: string }): Promise<AuthResult> {
  const username = normalizeUsername(input.username);
  const pool = getIdentityPool();
  const result = await pool.query(
    `
      SELECT ${USER_ATTRIBUTION_COLUMNS}
      FROM users u
      LEFT JOIN user_team_memberships m ON m.user_id = u.id
      LEFT JOIN teams t ON t.id = m.team_id
      WHERE u.username = $1
      GROUP BY u.id
    `,
    [username],
  );
  const row = result.rows[0];
  if (!row) {
    throw new IdentityError('用户名或密码错误', 'invalid_credentials');
  }

  const ok = await verifyPassword(input.password, row.password_hash);
  if (!ok) {
    throw new IdentityError('用户名或密码错误', 'invalid_credentials');
  }

  const user = mapUser(row);
  const token = createBearerToken();
  const tokenHash = hashBearerToken(token);
  await pool.query(
    `
      INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES ($1, $2, $3, $4)
    `,
    [randomUUID(), row.id, tokenHash, getSessionExpiry()],
  );

  return { token, user };
}

export async function getUserByBearerToken(token: string): Promise<IdentityUser | null> {
  const pool = getIdentityPool();
  const tokenHash = hashBearerToken(token);
  const result = await pool.query(
    `
      SELECT ${USER_ATTRIBUTION_COLUMNS}
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN user_team_memberships m ON m.user_id = u.id
      LEFT JOIN teams t ON t.id = m.team_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
      GROUP BY u.id
    `,
    [tokenHash],
  );
  const row = result.rows[0];
  return row ? mapUser(row) : null;
}

/**
 * Atomically invalidates exactly the unexpired session represented by this bearer.
 * The database keeps only its existing SHA-256 token hash; neither the raw bearer
 * nor the derived hash is logged or returned.
 */
export async function revokeBearerSession(token: string): Promise<boolean> {
  const pool = getIdentityPool();
  const result = await pool.query(
    `
      DELETE FROM sessions
      WHERE token_hash = $1
        AND expires_at > now()
      RETURNING id
    `,
    [hashBearerToken(token)],
  );
  return result.rowCount === 1;
}

export async function requireUserByBearerToken(token: string): Promise<IdentityUser> {
  const user = await getUserByBearerToken(token);
  if (!user) {
    throw new IdentityError('未登录或登录已过期', 'invalid_credentials');
  }
  return user;
}
