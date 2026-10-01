import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type pg from 'pg';
import { getNanoBrainPool } from '../../db';
import type { DreamLock, DreamTarget } from './types';

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
const MIN_LOCK_TTL_MS = 1_000;
const MAX_LOCK_TTL_MS = 60 * 60 * 1000;

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export type DreamLockTargetColumns = {
  targetType: DreamLock['targetType'];
  targetSourceId: string | null;
  targetUserId: string | null;
};

export type DreamLockAcquireResult =
  | { acquired: true; lock: DreamLock }
  | { acquired: false; lock: null; existingLock: DreamLock | null };

export type AcquireDreamLockOptions = {
  holderId?: string;
  holderHost?: string | null;
  ttlMs?: number;
  queryable?: Queryable;
};

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function getDreamLockTtlMs(input?: number): number {
  const configured = input ?? parsePositiveInteger(process.env.NANO_DREAM_LOCK_TTL_MS) ?? DEFAULT_LOCK_TTL_MS;
  return Math.min(Math.max(configured, MIN_LOCK_TTL_MS), MAX_LOCK_TTL_MS);
}

export function getDreamLockTargetColumns(target: DreamTarget): DreamLockTargetColumns {
  if (target.type === 'user_source') {
    return {
      targetType: target.type,
      targetSourceId: target.sourceId,
      targetUserId: target.userId,
    };
  }

  if (target.type === 'public_source') {
    return {
      targetType: target.type,
      targetSourceId: target.sourceId,
      targetUserId: null,
    };
  }

  return {
    targetType: target.type,
    targetSourceId: target.targetSourceId ?? null,
    targetUserId: null,
  };
}

function lockKeyPart(value: string | null): string {
  return value === null ? '_' : encodeURIComponent(value);
}

export function buildDreamLockId(target: DreamTarget): string {
  const columns = getDreamLockTargetColumns(target);
  return `nano-dream-lock:${columns.targetType}:${lockKeyPart(columns.targetSourceId)}:${lockKeyPart(columns.targetUserId)}`;
}

function mapDreamLock(row: any): DreamLock {
  return {
    id: row.id,
    targetType: row.target_type,
    targetSourceId: row.target_source_id,
    targetUserId: row.target_user_id,
    holderId: row.holder_id,
    holderHost: row.holder_host,
    acquiredAt: row.acquired_at,
    ttlExpiresAt: row.ttl_expires_at,
  };
}

export async function cleanupExpiredDreamLocks(queryable: Queryable = getNanoBrainPool()): Promise<number> {
  const result = await queryable.query(
    `
      DELETE FROM dream_locks
      WHERE ttl_expires_at <= now()
    `,
  );
  return result.rowCount ?? 0;
}

export async function getDreamLock(target: DreamTarget, queryable: Queryable = getNanoBrainPool()): Promise<DreamLock | null> {
  const result = await queryable.query(
    `
      SELECT id, target_type, target_source_id, target_user_id, holder_id, holder_host, acquired_at, ttl_expires_at
      FROM dream_locks
      WHERE id = $1
    `,
    [buildDreamLockId(target)],
  );
  return result.rows[0] ? mapDreamLock(result.rows[0]) : null;
}

export async function getActiveDreamLockForTarget(target: DreamTarget, queryable: Queryable = getNanoBrainPool()): Promise<DreamLock | null> {
  const columns = getDreamLockTargetColumns(target);
  const result = await queryable.query(
    `
      SELECT id, target_type, target_source_id, target_user_id, holder_id, holder_host, acquired_at, ttl_expires_at
      FROM dream_locks
      WHERE target_type = $1
        AND target_source_id IS NOT DISTINCT FROM $2
        AND target_user_id IS NOT DISTINCT FROM $3
        AND ttl_expires_at > now()
      ORDER BY acquired_at ASC
      LIMIT 1
    `,
    [columns.targetType, columns.targetSourceId, columns.targetUserId],
  );
  return result.rows[0] ? mapDreamLock(result.rows[0]) : null;
}

export async function acquireDreamLock(target: DreamTarget, options: AcquireDreamLockOptions = {}): Promise<DreamLockAcquireResult> {
  const queryable = options.queryable ?? getNanoBrainPool();
  const holderId = options.holderId ?? randomUUID();
  const holderHost = options.holderHost === undefined ? hostname() : options.holderHost;
  const ttlMs = getDreamLockTtlMs(options.ttlMs);
  const ttlExpiresAt = new Date(Date.now() + ttlMs);
  const columns = getDreamLockTargetColumns(target);
  const lockId = buildDreamLockId(target);

  await cleanupExpiredDreamLocks(queryable);

  const existingTargetLock = await getActiveDreamLockForTarget(target, queryable);
  if (existingTargetLock) {
    return { acquired: false, lock: null, existingLock: existingTargetLock };
  }

  const inserted = await queryable.query(
    `
      INSERT INTO dream_locks (
        id,
        target_type,
        target_source_id,
        target_user_id,
        holder_id,
        holder_host,
        ttl_expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO NOTHING
      RETURNING id, target_type, target_source_id, target_user_id, holder_id, holder_host, acquired_at, ttl_expires_at
    `,
    [lockId, columns.targetType, columns.targetSourceId, columns.targetUserId, holderId, holderHost, ttlExpiresAt],
  );

  if (inserted.rows[0]) {
    return { acquired: true, lock: mapDreamLock(inserted.rows[0]) };
  }

  return { acquired: false, lock: null, existingLock: await getActiveDreamLockForTarget(target, queryable) };
}

export async function releaseDreamLock(input: Pick<DreamLock, 'id' | 'holderId'>, queryable: Queryable = getNanoBrainPool()): Promise<boolean> {
  const result = await queryable.query(
    `
      DELETE FROM dream_locks
      WHERE id = $1 AND holder_id = $2
    `,
    [input.id, input.holderId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function refreshDreamLock(
  lock: Pick<DreamLock, 'id' | 'holderId'>,
  ttlMs?: number,
  queryable: Queryable = getNanoBrainPool(),
): Promise<boolean> {
  // G1 heartbeat：后台长 Dream 执行期定期续 ttl，避免超过 5min TTL 被清、同 target 并发。
  const ttl = getDreamLockTtlMs(ttlMs);
  const result = await queryable.query(
    `
      UPDATE dream_locks
      SET ttl_expires_at = now() + make_interval(secs => $3)
      WHERE id = $1 AND holder_id = $2
    `,
    [lock.id, lock.holderId, ttl / 1000],
  );
  return (result.rowCount ?? 0) > 0;
}
