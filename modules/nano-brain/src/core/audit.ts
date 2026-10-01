import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { UserContext } from '@ff/contracts';
import { getNanoBrainPool } from '../db';
import { NanoBrainPermissionError } from './permissions';
import { NanoBrainError } from './sources';

export type AuditAction =
  | 'fact_submission.approve'
  | 'fact_submission.reject'
  | 'fact_submission.request_changes'
  // 015 · T4 · FR-397 · §5.4:事实冲突裁决审计动作(保留其一 = resolve / 两口径并存 = dismiss)。
  | 'fact_conflict.resolve'
  | 'fact_conflict.dismiss'
  // 015 · T1 · AM-1507 · FR-386:补链建议流 accept/reject 动作留痕。
  | 'link_suggestion.accept'
  | 'link_suggestion.reject';

const AUDIT_ACTIONS: ReadonlySet<AuditAction> = new Set([
  'fact_submission.approve',
  'fact_submission.reject',
  'fact_submission.request_changes',
  'fact_conflict.resolve',
  'fact_conflict.dismiss',
  'link_suggestion.accept',
  'link_suggestion.reject',
]);

export type AuditLog = {
  id: string;
  actorUserId: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  previousStatus: string | null;
  nextStatus: string | null;
  reviewComment: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type InsertAuditLogInput = {
  actorUserId: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  previousStatus?: string | null;
  nextStatus?: string | null;
  reviewComment?: string | null;
  payload?: Record<string, unknown>;
};

export type ListAuditLogsInput = {
  action?: AuditAction;
  targetType?: string;
  targetId?: string;
  actorUserId?: string;
  limit?: number;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new NanoBrainError(`limit 必须是 1 到 ${MAX_LIMIT} 的整数`, 'invalid_input');
  }
  return value;
}

function normalizeAuditAction(value: string | undefined): AuditAction | undefined {
  if (value === undefined) return undefined;
  if (AUDIT_ACTIONS.has(value as AuditAction)) {
    return value as AuditAction;
  }
  throw new NanoBrainError('audit action 不合法', 'invalid_input');
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function mapAuditLog(row: any): AuditLog {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    previousStatus: row.previous_status,
    nextStatus: row.next_status,
    reviewComment: row.review_comment,
    payload: parseJsonObject(row.payload),
    createdAt: row.created_at,
  };
}

export async function insertAuditLog(client: pg.PoolClient, input: InsertAuditLogInput): Promise<AuditLog> {
  const result = await client.query(
    `
      INSERT INTO audit_logs (
        id,
        actor_user_id,
        action,
        target_type,
        target_id,
        previous_status,
        next_status,
        review_comment,
        payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      RETURNING id, actor_user_id, action, target_type, target_id, previous_status, next_status, review_comment, payload, created_at
    `,
    [
      randomUUID(),
      input.actorUserId,
      input.action,
      input.targetType,
      input.targetId,
      input.previousStatus ?? null,
      input.nextStatus ?? null,
      input.reviewComment ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return mapAuditLog(result.rows[0]);
}

export async function listAuditLogs(ctx: UserContext, input: ListAuditLogsInput = {}): Promise<AuditLog[]> {
  if (!ctx.isAdmin) {
    throw new NanoBrainPermissionError('只有管理员可以读取审计日志');
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  const action = normalizeAuditAction(input.action);

  if (action) {
    values.push(action);
    conditions.push(`action = $${values.length}`);
  }
  if (input.targetType) {
    values.push(input.targetType);
    conditions.push(`target_type = $${values.length}`);
  }
  if (input.targetId) {
    values.push(input.targetId);
    conditions.push(`target_id = $${values.length}`);
  }
  if (input.actorUserId) {
    values.push(input.actorUserId);
    conditions.push(`actor_user_id = $${values.length}`);
  }

  values.push(normalizeLimit(input.limit));
  const limitPlaceholder = `$${values.length}`;
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const pool = getNanoBrainPool();
  const result = await pool.query(
    `
      SELECT id, actor_user_id, action, target_type, target_id, previous_status, next_status, review_comment, payload, created_at
      FROM audit_logs
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limitPlaceholder}
    `,
    values,
  );

  return result.rows.map(mapAuditLog);
}
