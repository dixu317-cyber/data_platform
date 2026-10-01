import { randomUUID } from 'node:crypto';
import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../db';
import { assertCanManageSource, assertCanReadSource, NanoBrainPermissionError } from './permissions';

export type SourceKind = 'private' | 'public';

export type NanoSource = {
  id: string;
  name: string;
  kind: SourceKind;
  ownerUserId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export class NanoBrainError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_input' | 'not_found' | 'duplicate_source' | 'embedding_failed',
  ) {
    super(message);
    this.name = 'NanoBrainError';
  }
}

function normalizeSourceName(name: string): string {
  return name.trim().toLowerCase();
}

function assertValidSourceName(name: string): string {
  const normalized = normalizeSourceName(name);
  if (normalized.length < 3 || normalized.length > 96) {
    throw new NanoBrainError('source 名称长度必须在 3 到 96 个字符之间', 'invalid_input');
  }
  if (!/^[a-z0-9_./-]+$/.test(normalized)) {
    throw new NanoBrainError('source 名称只能包含字母、数字、下划线、点、斜杠或短横线', 'invalid_input');
  }
  return normalized;
}

function mapSource(row: any): NanoSource {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    ownerUserId: row.owner_user_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function defaultPrivateSourceName(username: string): string {
  const normalized = normalizeSourceName(username).replaceAll('@', '-at-');
  return `user/${normalized}`;
}

export async function ensureDefaultPrivateSource(input: {
  userId: string;
  username: string;
  actorUserId?: string;
}): Promise<NanoSource> {
  const pool = getNanoBrainPool();
  const name = assertValidSourceName(defaultPrivateSourceName(input.username));

  const existing = await pool.query(
    `
      SELECT id, name, kind, owner_user_id, created_by, created_at, updated_at
      FROM sources
      WHERE kind = 'private' AND owner_user_id = $1
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [input.userId],
  );

  if (existing.rows[0]) return mapSource(existing.rows[0]);

  const result = await pool.query(
    `
      INSERT INTO sources (id, name, kind, owner_user_id, created_by)
      VALUES ($1, $2, 'private', $3, $4)
      RETURNING id, name, kind, owner_user_id, created_by, created_at, updated_at
    `,
    [randomUUID(), name, input.userId, input.actorUserId ?? input.userId],
  );

  return mapSource(result.rows[0]);
}

export async function createPublicSource(ctx: UserContext, input: { name: string }): Promise<NanoSource> {
  if (!ctx.isAdmin) {
    throw new NanoBrainPermissionError('只有管理员可以创建公共 source');
  }

  const name = assertValidSourceName(input.name);
  const pool = getNanoBrainPool();

  try {
    const result = await pool.query(
      `
        INSERT INTO sources (id, name, kind, owner_user_id, created_by)
        VALUES ($1, $2, 'public', NULL, $3)
        RETURNING id, name, kind, owner_user_id, created_by, created_at, updated_at
      `,
      [randomUUID(), name, ctx.userId],
    );
    return mapSource(result.rows[0]);
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new NanoBrainError('公共 source 已存在', 'duplicate_source');
    }
    throw error;
  }
}

export async function getSourceById(sourceId: string): Promise<NanoSource | null> {
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT id, name, kind, owner_user_id, created_by, created_at, updated_at
      FROM sources
      WHERE id = $1
    `,
    [sourceId],
  );
  return result.rows[0] ? mapSource(result.rows[0]) : null;
}

export async function getReadableSource(ctx: UserContext, sourceId: string): Promise<NanoSource> {
  const source = await getSourceById(sourceId);
  if (!source) throw new NanoBrainError('source 不存在', 'not_found');
  assertCanReadSource(ctx, source);
  return source;
}

export async function listReadableSources(ctx: UserContext): Promise<NanoSource[]> {
  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT id, name, kind, owner_user_id, created_by, created_at, updated_at
      FROM sources
      WHERE $1::boolean = true
         OR kind = 'public'
         OR owner_user_id = $2
      ORDER BY kind ASC, name ASC
    `,
    [ctx.isAdmin, ctx.userId],
  );
  return result.rows.map(mapSource);
}

export async function updateSourceName(ctx: UserContext, sourceId: string, input: { name: string }): Promise<NanoSource> {
  const source = await getSourceById(sourceId);
  if (!source) throw new NanoBrainError('source 不存在', 'not_found');
  assertCanManageSource(ctx, source);

  const name = assertValidSourceName(input.name);
  const pool = getNanoBrainPool();

  try {
    const result = await pool.query(
      `
        UPDATE sources
        SET name = $1, updated_at = now()
        WHERE id = $2
        RETURNING id, name, kind, owner_user_id, created_by, created_at, updated_at
      `,
      [name, sourceId],
    );
    return mapSource(result.rows[0]);
  } catch (error: any) {
    if (error?.code === '23505') {
      throw new NanoBrainError('source 名称已存在', 'duplicate_source');
    }
    throw error;
  }
}
