import type { UserContext } from '@ff/contracts';
import { Hono } from 'hono';
import { listAuditLogs, type AuditAction } from '../../core/audit';
import { runDream } from '../../core/dream/runner';
import { isDreamPhase, type DreamPhase, type DreamTarget } from '../../core/dream/types';
import { NanoBrainError } from '../../core/sources';
import { internalRoute } from '../route';
import { toPublicAuditLog, toPublicDreamReport } from '../serializers';

const MCP_DREAM_TARGET_TYPES = new Set(['public_source', 'review_queue']);
const MCP_AUDIT_ACTIONS = new Set<AuditAction>([
  'fact_submission.approve',
  'fact_submission.reject',
  'fact_submission.request_changes',
]);

type AgentToolAdaptersDependencies = {
  runDream: typeof runDream;
  listAuditLogs: typeof listAuditLogs;
};

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NanoBrainError('请求 body 必须是对象', 'invalid_input');
  }
  return value as Record<string, unknown>;
}

function assertAllowedBodyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      throw new NanoBrainError(`Agent Tool body 不支持字段: ${key}`, 'invalid_input');
    }
  }
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new NanoBrainError(`${key} 必须是非空字符串`, 'invalid_input');
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  if (body[key] === undefined) return undefined;
  return requiredString(body, key);
}

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new NanoBrainError(`${key} 必须是 boolean`, 'invalid_input');
  return value;
}

function optionalDreamPhases(body: Record<string, unknown>): DreamPhase[] | undefined {
  const value = body.phases;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new NanoBrainError('phases 必须是非空 dream phase 数组', 'invalid_input');
  }
  return value.map((phase) => {
    if (typeof phase !== 'string' || !isDreamPhase(phase)) {
      throw new NanoBrainError(`dream phase 不合法: ${String(phase)}`, 'invalid_input');
    }
    return phase;
  });
}

function buildUserDreamInput(ctx: UserContext, body: Record<string, unknown>) {
  assertAllowedBodyKeys(body, ['source_id', 'phases', 'dry_run']);
  return {
    target: {
      type: 'user_source' as const,
      sourceId: requiredString(body, 'source_id'),
      // Deliberately derived from internal auth, never accepted from body.
      userId: ctx.userId,
    },
    phases: optionalDreamPhases(body),
    dryRun: optionalBoolean(body, 'dry_run'),
  };
}

function buildAdminDreamInput(body: Record<string, unknown>) {
  assertAllowedBodyKeys(body, ['target_type', 'source_id', 'target_source_id', 'phases', 'dry_run']);
  const targetType = requiredString(body, 'target_type');
  if (!MCP_DREAM_TARGET_TYPES.has(targetType)) {
    throw new NanoBrainError('target_type 必须是 public_source 或 review_queue', 'invalid_input');
  }
  const sourceId = optionalString(body, 'source_id');
  const targetSourceId = optionalString(body, 'target_source_id');
  const target: DreamTarget = targetType === 'public_source'
    ? { type: 'public_source', sourceId: sourceId ?? '' }
    : targetSourceId ?? sourceId
      ? { type: 'review_queue', targetSourceId: targetSourceId ?? sourceId }
      : { type: 'review_queue' };
  return {
    target,
    phases: optionalDreamPhases(body),
    dryRun: optionalBoolean(body, 'dry_run'),
  };
}

function parseOptionalAuditAction(value: string | undefined): AuditAction | undefined {
  if (value === undefined) return undefined;
  if (!MCP_AUDIT_ACTIONS.has(value as AuditAction)) {
    throw new NanoBrainError('audit action 不合法', 'invalid_input');
  }
  return value as AuditAction;
}

function parseOptionalLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new NanoBrainError('limit 必须是 1 到 200 的整数', 'invalid_input');
  }
  return parsed;
}

/**
 * Protected HTTP counterparts for MCP tools whose old public HTTP endpoints
 * could not preserve synchronous/authorization semantics. Kept separate from
 * `/nano/dream/runs`, whose asynchronous 202 contract remains unchanged.
 */
export function createAgentToolAdaptersRouter(
  dependencies: Partial<AgentToolAdaptersDependencies> = {},
): Hono {
  const runSyncDream = dependencies.runDream ?? runDream;
  const listLogs = dependencies.listAuditLogs ?? listAuditLogs;
  const router = new Hono();

  router.post(
    '/nano/agent-tools/dream/user-source',
    internalRoute('执行用户 dream 失败', async (c, ctx) => {
      const report = await runSyncDream(ctx, buildUserDreamInput(ctx, bodyObject(await c.req.json())));
      return c.json({ run: toPublicDreamReport(report) });
    }),
  );

  router.post(
    '/nano/agent-tools/dream/admin',
    internalRoute('执行管理员 dream 失败', async (c, ctx) => {
      const report = await runSyncDream(ctx, buildAdminDreamInput(bodyObject(await c.req.json())));
      return c.json({ run: toPublicDreamReport(report) });
    }),
  );

  router.get(
    '/nano/agent-tools/audit-logs',
    internalRoute('读取审计日志失败', async (c, ctx) => {
      const auditLogs = await listLogs(ctx, {
        action: parseOptionalAuditAction(c.req.query('action')),
        targetType: c.req.query('target_type'),
        targetId: c.req.query('target_id'),
        actorUserId: c.req.query('actor_user_id'),
        limit: parseOptionalLimit(c.req.query('limit')),
      });
      return c.json({ audit_logs: auditLogs.map(toPublicAuditLog) });
    }),
  );

  return router;
}

export const agentToolAdaptersRouter = createAgentToolAdaptersRouter();
