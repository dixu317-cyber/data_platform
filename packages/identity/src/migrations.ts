import type pg from 'pg';
import { getIdentityPool } from './db';

export async function migrateIdentityDatabase(pool: pg.Pool = getIdentityPool()): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        registration_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT teams_platform_admin_not_registerable
          CHECK (id <> 'platform-admin' OR registration_enabled = FALSE)
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_organization_slug
      ON teams(organization_id, slug);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_organization_name
      ON teams(organization_id, name);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_active_default_per_organization
      ON teams(organization_id)
      WHERE is_default = TRUE AND active = TRUE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_team_memberships (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, team_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_team_memberships_team_id
      ON user_team_memberships(team_id);
    `);

    await client.query(`
      INSERT INTO organizations (id, name, active)
      VALUES ('org_companybrain', 'CompanyBrain', TRUE)
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO teams (
        id,
        organization_id,
        name,
        slug,
        active,
        registration_enabled,
        is_default,
        sort_order
      )
      VALUES
        (
          'default-team',
          'org_companybrain',
          '默认团队',
          'default-team',
          TRUE,
          TRUE,
          TRUE,
          0
        ),
        (
          'sales',
          'org_companybrain',
          '销售团队',
          'sales',
          TRUE,
          TRUE,
          FALSE,
          10
        ),
        (
          'product',
          'org_companybrain',
          '产品团队',
          'product',
          TRUE,
          TRUE,
          FALSE,
          20
        ),
        (
          'platform-admin',
          'org_companybrain',
          '平台管理员',
          'platform-admin',
          TRUE,
          FALSE,
          FALSE,
          1000
        )
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO user_team_memberships (user_id, team_id)
      SELECT
        users.id,
        CASE WHEN users.is_admin THEN 'platform-admin' ELSE 'default-team' END
      FROM users
      WHERE NOT EXISTS (
        SELECT 1
        FROM user_team_memberships existing
        WHERE existing.user_id = users.id
      )
      ON CONFLICT (user_id, team_id) DO NOTHING;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
